/**
 * cli 端到端契约 (TDD 驱动件: 本文件先行, 驱动 src/cli.ts 的实现)。
 * 断言面与分册「命令面与输出」「配置与初始化」的规格一一对应; 同一批用例参数化跑 bun 与 node 两个载体 (双运行时)。
 * 向导的 TTY 交互按设计不做端到端自动化 (管道冒烟见 `init.smoke.test.ts`), 不在此覆盖。
 */
import { afterEach, describe, expect, test } from 'bun:test';

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type Workspace,
  type WorkspaceSpec,
  makeWorkspace,
} from './fixtures.ts';

const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));
const RUNNERS = ['bun', 'node'];

/** 权限注入用例在 root 下失效 (chmod 拦不住 root), 与 guard 契约测试同一口径 */
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

/** 伪终端冒烟可用性: 经 script 分配 pty (BSD 形式, 实测仅 darwin 可靠), 探针失败即 skip */
const ptyAvailable =
  process.platform === 'darwin' &&
  spawnSync('script', ['-q', '/dev/null', 'true'], { timeout: 10_000 })
    .status === 0;

/** 伪终端冒烟超时: 向导死锁或子进程不退一律判失败, 不无限等待 */
const PTY_TIMEOUT_MS = 20_000;

/** 伪终端用例自身的时间上限 (向导三问 + 预览远低于此值) */
const PTY_TEST_TIMEOUT_MS = 30_000;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const workspaces: Workspace[] = [];
async function make(spec: WorkspaceSpec): Promise<Workspace> {
  const workspace = await makeWorkspace(spec);
  workspaces.push(workspace);
  return workspace;
}

afterEach(async () => {
  await Promise.all(workspaces.map((workspace) => workspace.cleanup()));
  workspaces.length = 0;
});

interface RunOptions {
  cwd?: string;
  /** 额外环境变量 (默认注入 NO_COLOR 以稳定断言; 降级用例单独覆盖) */
  env?: Record<string, string>;
  noColor?: boolean;
}

function runCli(runner: string, args: string[], options: RunOptions = {}) {
  // 宿主变量不得泄漏进用例: SWEEP_NM_CONFIG 一律先清, 需要时经 options.env 显式给
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
  };
  delete env.SWEEP_NM_CONFIG;
  Object.assign(env, options.env);
  if (options.noColor === false) {
    delete env.NO_COLOR;
  } else {
    env.NO_COLOR = '1';
  }
  return spawnSync(runner, [CLI, ...args], {
    encoding: 'utf8',
    cwd: options.cwd,
    env,
    timeout: 10_000,
  });
}

function writeConfig(
  workspace: Workspace,
  roots: string[],
  exclude: string[] = [],
  include: string[] = [],
): string {
  const file = join(workspace.root, 'sweep-config.json');
  writeFileSync(file, JSON.stringify({ roots, exclude, include }));
  return file;
}

/** 空家目录: 平台默认配置路径 (HOME/.config/...) 因此保证 absent, 「无配置」类用例不受宿主影响 */
function emptyHome(workspace: Workspace): string {
  const home = join(workspace.root, '.home');
  mkdirSync(home, { recursive: true });
  return home;
}

/**
 * 驱动伪终端: script 分配 pty, 见到提示再投喂下一条 (整段投喂实测不可靠 —— script 会把 stdin 的
 * EOF 透传成 pty 的 EOT, readline 立即折算取消), stdin 全程开口, 收尾等子进程自行退出。
 * stdout / stderr 经 pty 合流, 调用方按合并文本断言。
 */
async function runPty(
  runner: string,
  args: string[],
  answers: { prompt: string; input: string }[],
  options: { cwd: string; env: Record<string, string> },
): Promise<{ output: string; status: number | null }> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
  };
  delete env.SWEEP_NM_CONFIG;
  Object.assign(env, options.env, { NO_COLOR: '1' });

  // script 的 stdin 须是真管道: Bun 的 spawn 给的是 socketpair, BSD script 对其 tcgetattr 直接报错,
  // 故经 sh 的 `cat | script` 转一手 (cat 即读即转, 无缓冲延迟, 实测)
  const child = spawn(
    'sh',
    ['-c', 'cat | script -q /dev/null "$@"', 'sh', runner, CLI, ...args],
    {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );

  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });

  const deadline = Date.now() + PTY_TIMEOUT_MS;
  for (const step of answers) {
    while (!output.includes(step.prompt)) {
      if (Date.now() > deadline) {
        child.kill('SIGKILL');
        throw new Error(
          `伪终端冒烟超时 (未见提示 ${step.prompt}), 已收输出: ${output}`,
        );
      }
      await delay(20);
    }
    child.stdin.write(step.input);
  }

  // 问答已结束: 关 stdin 让中转的 cat 收尾退出, 管道整体收口 (此时 EOF 不再影响向导)
  child.stdin.end();

  const status = await Promise.race([
    new Promise<number | null>((resolve) => {
      child.on('exit', (code) => resolve(code));
    }),
    delay(PTY_TIMEOUT_MS).then(() => {
      child.kill('SIGKILL');
      return null;
    }),
  ]);
  return { output, status };
}

/** 预览 / 参数 / 安全闸面 (无 pty 依赖) 的用例组, 逐 runner 注册 */
function definePreviewCases(runner: string, available: boolean): void {
  describe(`cli e2e [${runner}] 预览与参数面`, () => {
    test.skipIf(!available)(
      '预览: 列清单与 --yes 提示, 零副作用, 退出码 0',
      async () => {
        const workspace = await make({
          projects: [{ dir: 'alpha' }, { dir: 'beta' }],
        });
        const config = writeConfig(workspace, [workspace.root]);

        const result = runCli(runner, [], { env: { SWEEP_NM_CONFIG: config } });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('alpha');
        expect(result.stdout).toContain('beta');
        expect(result.stdout).toContain('--yes');
        expect(existsSync(join(workspace.root, 'alpha', 'node_modules'))).toBe(
          true,
        );
        expect(existsSync(join(workspace.root, 'beta', 'node_modules'))).toBe(
          true,
        );
      },
    );

    test.skipIf(!available)(
      '--exclude 与配置合并: 被排除项不列出',
      async () => {
        const workspace = await make({
          projects: [{ dir: 'alpha' }, { dir: 'beta' }],
        });
        const config = writeConfig(workspace, [workspace.root]);

        const result = runCli(runner, ['--exclude', 'alpha'], {
          env: { SWEEP_NM_CONFIG: config },
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('beta');
        expect(result.stdout).not.toContain('alpha');
      },
    );

    test.skipIf(!available)(
      '--exclude 未命中: stderr 警告且不污染清单流',
      async () => {
        const workspace = await make({ projects: [{ dir: 'alpha' }] });
        const config = writeConfig(workspace, [workspace.root]);

        const result = runCli(runner, ['--exclude', 'nosuchdir'], {
          env: { SWEEP_NM_CONFIG: config },
        });

        expect(result.status).toBe(0);
        expect(result.stderr).toContain('排除名未匹配到任何目录: nosuchdir');
        expect(result.stdout).not.toContain('排除名未匹配');
      },
    );

    test.skipIf(!available)(
      '--include 可重复且与配置合并: 只列出白名单命中的项',
      async () => {
        const workspace = await make({
          projects: [
            { dir: 'alpha' },
            { dir: 'beta' },
            { dir: 'gamma' },
            { dir: 'delta' },
          ],
        });
        const config = writeConfig(workspace, [workspace.root], [], ['alpha']);

        const result = runCli(
          runner,
          ['--include', 'beta', '--include', 'gamma'],
          {
            env: { SWEEP_NM_CONFIG: config },
          },
        );

        expect(result.status).toBe(0);
        for (const name of ['alpha', 'beta', 'gamma'])
          expect(result.stdout).toContain(name);
        expect(result.stdout).not.toContain('delta');
      },
    );

    test.skipIf(!available)(
      '--include 未命中: stderr 警示白名单未生效且结果为空',
      async () => {
        const workspace = await make({ projects: [{ dir: 'alpha' }] });
        const config = writeConfig(
          workspace,
          [workspace.root],
          [],
          ['typo-name'],
        );

        const result = runCli(runner, [], { env: { SWEEP_NM_CONFIG: config } });

        expect(result.status).toBe(0);
        expect(result.stderr).toContain('包含名未匹配到任何目录: typo-name');
        // 与排除名写错的后果不同: 白名单全零命中直接意味着扫不出东西, 须点明
        expect(result.stderr).toContain(
          '包含名单无一条命中, 本次扫描必为空结果',
        );
        expect(result.stdout).toContain('未发现');
        expect(result.stdout).not.toContain('包含名未匹配');
      },
    );

    test.skipIf(!available)('--yes 执行: 目标删除且邻居完好', async () => {
      const workspace = await make({ projects: [{ dir: 'alpha' }] });
      const config = writeConfig(workspace, [workspace.root]);
      writeFileSync(join(workspace.root, 'alpha', 'keep.txt'), 'keep');

      const result = runCli(runner, ['--yes'], {
        env: { SWEEP_NM_CONFIG: config },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/释放 [\d.]+ (B|KB|MB|GB)/);
      expect(existsSync(join(workspace.root, 'alpha', 'node_modules'))).toBe(
        false,
      );
      expect(existsSync(join(workspace.root, 'alpha', 'keep.txt'))).toBe(true);
    });

    test.skipIf(!available)(
      '安全闸整批拒绝: 零删除且不出清单, 退出码 1',
      async () => {
        const workspace = await make({ projects: [{ dir: 'alpha' }] });
        const config = writeConfig(workspace, [workspace.root]);

        // HOME 指向目标本体: 非竞态地命中安全闸不变量 ③b (home 本体), 构造整批拒绝
        const result = runCli(runner, ['--yes', '--config', config], {
          env: { HOME: join(workspace.root, 'alpha', 'node_modules') },
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('整批拒绝');
        expect(result.stderr).toContain('home 本体');
        expect(result.stdout).not.toContain('SWEEP-NM');
        expect(result.stdout).not.toContain('alpha');
        expect(existsSync(join(workspace.root, 'alpha', 'node_modules'))).toBe(
          true,
        );
      },
    );

    test.skipIf(!available)(
      '参数错误: 未知参数 / 缺值 / 多余位置参数一律退 1',
      async () => {
        const cases = [['--bogus'], ['--exclude'], ['--yes', 'extra']];

        for (const args of cases) {
          const result = runCli(runner, args);

          expect(result.status).toBe(1);
          expect(result.stderr).toContain('参数错误:');
        }
      },
    );

    test.skipIf(!available)(
      '--help: 退出码 0 且给出默认配置位置与两份名单的匹配口径',
      async () => {
        const result = runCli(runner, ['--help']);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(
          join('sweep-node-modules', 'config.json'),
        );
        expect(result.stdout).toContain('--exclude 按目录名精确匹配');
        expect(result.stdout).toContain('--include 同款匹配口径');
      },
    );
  });
}

/** 执行 / 拒绝 / 配置面 (含伪终端向导) 的用例组, 逐 runner 注册 */
function defineExecuteCases(runner: string, available: boolean): void {
  describe(`cli e2e [${runner}] 执行与拒绝面`, () => {
    test.skipIf(!available)('init 非 TTY: 报错退 1 且不落盘', async () => {
      const workspace = await make({ projects: [{ dir: 'alpha' }] });
      const config = join(workspace.root, 'new-config.json');

      const result = runCli(runner, ['init', '--config', config]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('需要交互终端');
      expect(existsSync(config)).toBe(false);
    });

    test.skipIf(!available || isRoot)(
      '不可读目标: 占位行计失败且不删除, 退出码 1',
      async () => {
        const workspace = await make({
          projects: [{ dir: 'alpha' }, { dir: 'locked' }],
          unreadable: ['locked/node_modules'],
        });
        const config = writeConfig(workspace, [workspace.root]);

        const result = runCli(runner, ['--yes'], {
          env: { SWEEP_NM_CONFIG: config },
        });

        expect(result.status).toBe(1);
        expect(result.stdout).toContain('?');
        expect(result.stdout).toContain('体积统计失败');
        expect(result.stdout).toContain('✗');
        expect(result.stdout).toContain('失败 1 处');
        expect(existsSync(join(workspace.root, 'locked', 'node_modules'))).toBe(
          true,
        );
        expect(existsSync(join(workspace.root, 'alpha', 'node_modules'))).toBe(
          false,
        );
      },
    );

    test.skipIf(!available)('空结果: 提示未发现, 退出码 0', async () => {
      const workspace = await make({ projects: [] });
      const config = writeConfig(workspace, [workspace.root]);

      const result = runCli(runner, [], { env: { SWEEP_NM_CONFIG: config } });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('未发现');
    });

    test.skipIf(!available)(
      '无配置 + 非 TTY: 回退 cwd 模式并提示, 不阻塞',
      async () => {
        const workspace = await make({ projects: [{ dir: 'alpha' }] });

        const result = runCli(runner, [], {
          cwd: workspace.root,
          env: { HOME: emptyHome(workspace) },
        });

        expect(result.status).toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('当前');
        expect(result.stdout).toContain('alpha');
      },
    );

    test.skipIf(!available)(
      '无配置 + --yes: 硬拒绝并零删除, 退出码 1',
      async () => {
        const workspace = await make({ projects: [{ dir: 'alpha' }] });

        const result = runCli(runner, ['--yes'], {
          cwd: workspace.root,
          env: { HOME: emptyHome(workspace) },
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(workspace.root);
        expect(result.stderr).toContain('sweep-nm init');
        expect(existsSync(join(workspace.root, 'alpha', 'node_modules'))).toBe(
          true,
        );
      },
    );

    test.skipIf(!available || !ptyAvailable)(
      '首次向导 + --yes: 本轮强制预览且零删除 (伪终端, 分段投喂)',
      async () => {
        const workspace = await make({ projects: [{ dir: 'alpha' }] });
        const home = emptyHome(workspace);
        // 向导默认根是家目录, 故在家目录下备一处 node_modules, 让默认根能扫出结果
        mkdirSync(join(home, 'beta', 'node_modules'), { recursive: true });

        const { output, status } = await runPty(
          runner,
          ['--yes'],
          [
            { prompt: '扫描根', input: '\n' }, // 取默认根 (家目录)
            { prompt: '排除名单', input: '\n' },
            { prompt: '确认写入', input: 'y\n' },
          ],
          { cwd: workspace.root, env: { HOME: home } },
        );

        expect(status).toBe(0);
        expect(output).toContain('首次配置已生成'); // 说明行 (stderr 经 pty 合流)
        expect(output).toContain('合计'); // 走的是预览
        expect(output).not.toContain('汇总'); // 未进入执行
        expect(
          existsSync(
            join(home, '.config', 'sweep-node-modules', 'config.json'),
          ),
        ).toBe(true);
        expect(existsSync(join(workspace.root, 'alpha', 'node_modules'))).toBe(
          true,
        );
      },
      PTY_TEST_TIMEOUT_MS,
    );

    test.skipIf(!available)('非 TTY 自动降级: 输出零 ANSI 转义', async () => {
      const workspace = await make({ projects: [{ dir: 'alpha' }] });
      const config = writeConfig(workspace, [workspace.root]);

      const result = runCli(runner, [], {
        env: { SWEEP_NM_CONFIG: config },
        noColor: false,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain('\x1b[');
    });

    test.skipIf(!available)('--config 旗标优先于环境变量', async () => {
      const workspace = await make({ projects: [{ dir: 'alpha' }] });
      const other = await make({ projects: [{ dir: 'gamma' }] });
      const envConfig = writeConfig(workspace, [workspace.root]);
      const flagConfig = writeConfig(other, [other.root]);

      const result = runCli(runner, ['--config', flagConfig], {
        env: { SWEEP_NM_CONFIG: envConfig },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('gamma');
      expect(result.stdout).not.toContain('alpha');
    });

    test.skipIf(!available)(
      '--config 打错路径: 硬报错且未扫描, 退出码 1',
      async () => {
        const workspace = await make({ projects: [{ dir: 'alpha' }] });

        const result = runCli(
          runner,
          ['--config', join(workspace.root, 'nope.json')],
          { cwd: workspace.root },
        );

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('配置不存在');
        expect(result.stdout).not.toContain('alpha');
      },
    );
  });
}

for (const runner of RUNNERS) {
  const available = spawnSync(runner, ['-v']).status === 0;
  definePreviewCases(runner, available);
  defineExecuteCases(runner, available);
}
