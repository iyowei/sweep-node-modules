/**
 * `config` 子命令查询面的端到端契约: 报告本次实际生效的配置来源 / 路径 / 文件状态。
 * 与 `cli.e2e.test.ts` 分文件承载 (max-lines 门禁要求实现按规模切分, 见 ADR 0005);
 * 查询面不扫描、不建工作区树 (只认配置文件路径), 故不复用其 fixture 组装。
 * 同一批用例参数化跑 bun 与 node 两个载体 (双运行时)。
 */
import { afterEach, describe, expect, test } from 'bun:test';

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));
const RUNNERS = ['bun', 'node'];

const dirs: string[] = [];

/** 临时目录 (用例隔离): 兼作家目录与配置文件父目录, afterEach 统一清理 */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-config-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

/** 写一份真实形状的配置 (查询面不装载内容, 只探存在性; 内容取正常形态免误导) */
function writeConfig(dir: string): string {
  const file = join(dir, 'sweep-config.json');
  writeFileSync(
    file,
    JSON.stringify({ roots: [dir], exclude: [], include: [] }),
  );
  return file;
}

/** 跑一次 CLI: 宿主变量不得泄漏进用例 (SWEEP_NM_CONFIG 一律先清, 需要时经 env 显式给) */
function runCli(
  runner: string,
  args: string[],
  options: { env?: Record<string, string> } = {},
) {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
  };
  delete env.SWEEP_NM_CONFIG;
  env.NO_COLOR = '1';
  Object.assign(env, options.env);
  return spawnSync(runner, [CLI, ...args], {
    encoding: 'utf8',
    env,
    timeout: 10_000,
  });
}

/** config 查询面 (命令 `config` 与旗标 `--config` 形近义反) 的用例组, 逐 runner 注册 */
function defineQueryCases(runner: string, available: boolean): void {
  describe(`cli e2e [${runner}] 配置查询面`, () => {
    test.skipIf(!available)(
      'config: 平台默认来源报平台默认路径与不存在状态, 退出码 0',
      () => {
        const home = tempDir();

        const result = runCli(runner, ['config'], { env: { HOME: home } });

        expect(result.status).toBe(0);
        // 降级形态 (管道 + NO_COLOR): 零 ANSI 但保留顶栏与中性块字符
        expect(result.stdout).toContain('▍ SWEEP-NM  配置 · 来源: 平台默认');
        expect(result.stdout).toContain(
          join(home, '.config', 'sweep-node-modules', 'config.json'),
        );
        expect(result.stdout).toContain('  ░ 文件状态: 不存在');
      },
    );

    test.skipIf(!available)(
      'config: --config 指定时报 flag 来源与该路径 (优先于环境变量)',
      () => {
        const flagConfig = writeConfig(tempDir());
        const envConfig = writeConfig(tempDir());

        const result = runCli(runner, ['--config', flagConfig, 'config'], {
          env: { SWEEP_NM_CONFIG: envConfig },
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('配置 · 来源: --config 指定');
        expect(result.stdout).toContain(flagConfig);
        expect(result.stdout).toContain('文件状态: 存在');
        expect(result.stdout).not.toContain(envConfig);
      },
    );

    test.skipIf(!available)(
      'config: 环境变量来源报 SWEEP_NM_CONFIG 与该路径, 退出码 0',
      () => {
        const config = writeConfig(tempDir());

        const result = runCli(runner, ['config'], {
          env: { SWEEP_NM_CONFIG: config },
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(
          '配置 · 来源: 环境变量 SWEEP_NM_CONFIG',
        );
        expect(result.stdout).toContain(config);
        expect(result.stdout).toContain('文件状态: 存在');
      },
    );
  });
}

for (const runner of RUNNERS) {
  const available = spawnSync(runner, ['-v']).status === 0;
  defineQueryCases(runner, available);
}
