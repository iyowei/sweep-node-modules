/**
 * 初始化向导真实壳冒烟: runInit + createReadlineIO 走真实管道 stdin 与真实文件落盘。
 * 三态: 多行投喂 (真实存在的子目录做根 + 排除 + 写入确认回车) → written (钉落盘内容);
 * 空输入 EOF → cancelled (不落盘); 预置配置 + 投喂 n → declined-overwrite (既有文件原样不动)。
 * 三态各需独立 stdin, 单进程只有一个, 故驱动器派生自身逐场景投喂 (真实管道, 非伪终端);
 * 逐项打印 ok / FAIL 且失败不中断, 收尾任一不符 exit 1, 全通 exit 0 (失败响亮)。
 * 用法: <bun|node> src/init.smoke.ts <config-path>   (路径经 argv 注入, 脚本不自选位置)
 * 由 init.smoke.test.ts 以 bun / node 双载体 spawn 并带 timeout 守卫:
 * 历史失败模式是 readline 壳死锁, 挂死必须判失败而非无限等待。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReadlineIO, runInit } from './init.ts';

const SELF = fileURLToPath(new URL('./init.smoke.ts', import.meta.url));

/** 派生 worker 的超时守卫: 单场景挂死 (历史缺陷形态) 即杀子进程判失败, 不拖垮整轮 */
const WORKER_TIMEOUT_MS = 3000;

/** written 场景的两个根: 真实存在的子目录 (过存在性校验); 投喂答案与断言两侧同源派生 */
function sceneRoots(configPath: string): string[] {
  const base = dirname(configPath);
  return [join(base, 'root-a'), join(base, 'root-b')];
}

/** 场景表: name 为 worker 分派键; input 为投喂给 worker stdin 的真实管道内容 */
function makeScenes(configPath: string): { name: string; input: string }[] {
  return [
    // 三行: 多根 / 排除名单 / 写入确认 (空行取默认 Y)
    {
      name: 'written',
      input: `${sceneRoots(configPath).join(', ')}\ndist\n\n`,
    },
    { name: 'eof', input: '' },
    { name: 'decline', input: 'n\n' },
  ];
}

/** decline 场景预置的既有配置: 覆盖保护下应原样不动 */
const EXISTING_CONFIG_TEXT = `${JSON.stringify({ roots: ['/existing'], exclude: [] }, null, 2)}\n`;

const failures: string[] = [];

/** 记录单条检查结果; 不中断执行, 收尾统一判定退出码 */
function check(ok: boolean, label: string): void {
  if (ok) {
    console.log(`ok: ${label}`);
    return;
  }

  failures.push(label);
  console.error(`FAIL: ${label}`);
}

/** 单场景 worker: 自建入口态 → 真实壳提问 → 断言 → 清理; 任一不符 exit 1 */
async function runWorker(name: string, configPath: string): Promise<void> {
  const roots = sceneRoots(configPath);

  // 清掉任何残留, 使场景可独立重复运行 (written 需文件与子目录均不存在, decline 需预置配置)
  rmSync(configPath, { force: true });
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  if (name === 'written') {
    for (const root of roots) mkdirSync(root, { recursive: true });
  }
  if (name === 'decline') {
    await writeFile(configPath, EXISTING_CONFIG_TEXT);
  }

  try {
    const result = await runInit({
      configPath,
      fileExists: async (path) => existsSync(path),
      writeFile: async (path, text) => {
        await writeFile(path, text);
      },
      io: createReadlineIO(),
    });

    if (name === 'written') {
      const expected = { roots, exclude: ['dist'], include: [] };
      check(
        result.state === 'written',
        `written: state 为 written (实际 ${result.state})`,
      );
      check(
        JSON.stringify(result.config) === JSON.stringify(expected),
        `written: 返回 config 命中期望 (实际 ${JSON.stringify(result.config)})`,
      );

      const persisted = existsSync(configPath);
      check(persisted, 'written: 配置已落盘');
      const text = persisted ? readFileSync(configPath, 'utf8') : '';
      check(
        text === `${JSON.stringify(expected, null, 2)}\n`,
        'written: 落盘内容为 2 空格缩进 + 末尾换行',
      );
    } else if (name === 'eof') {
      check(
        result.state === 'cancelled',
        `eof: state 为 cancelled (实际 ${result.state})`,
      );
      check(!existsSync(configPath), 'eof: 未落盘');
    } else if (name === 'decline') {
      check(
        result.state === 'declined-overwrite',
        `decline: state 为 declined-overwrite (实际 ${result.state})`,
      );
      check(
        existsSync(configPath) &&
          readFileSync(configPath, 'utf8') === EXISTING_CONFIG_TEXT,
        'decline: 既有配置原样未动',
      );
    } else {
      check(false, `未知场景: ${name}`);
    }
  } catch (error) {
    check(
      false,
      `${name}: 未捕获异常 (${error instanceof Error ? error.message : String(error)})`,
    );
  } finally {
    // 完成后清理, 不留残留 (断言已在清理前读盘完成)
    rmSync(configPath, { force: true });
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`init smoke [${name}]: ${failures.length} 项失败`);
    process.exit(1);
  }

  console.log(`init smoke [${name}]: 全部通过`);
}

/** 驱动器: 逐场景派生 worker 并透传其输出; 任一场景未通过即收尾 exit 1 */
function driveScenes(configPath: string): void {
  const scenes = makeScenes(configPath);
  const failedScenes: string[] = [];

  for (const scene of scenes) {
    console.log(`--- 场景 ${scene.name}: 派生 worker, 管道投喂 stdin ---`);
    const worker = spawnSync(
      process.execPath,
      [SELF, '--case', scene.name, configPath],
      {
        input: scene.input,
        encoding: 'utf8',
        timeout: WORKER_TIMEOUT_MS,
      },
    );

    // 透传 worker 逐项输出; 挂死或失败时同样保留已产生的诊断
    if (worker.stdout) process.stdout.write(worker.stdout);
    if (worker.stderr) process.stderr.write(worker.stderr);

    if (worker.status === 0) continue;

    let reason: string;
    if (worker.error !== undefined)
      reason = `运行错误 (${worker.error.message})`;
    else if (worker.signal !== null)
      reason = `被 ${worker.signal} 终止, 疑似挂死`;
    else reason = `退出码 ${worker.status}`;

    failedScenes.push(scene.name);
    console.error(`FAIL: 场景 ${scene.name} (${reason})`);
  }

  if (failedScenes.length > 0) {
    console.error(
      `init smoke: ${failedScenes.length}/${scenes.length} 个场景失败 (${failedScenes.join(', ')})`,
    );
    process.exit(1);
  }

  console.log(`init smoke: 全部通过 (${scenes.length} 个场景)`);
}

const args = process.argv.slice(2);

function usage(): never {
  console.error('用法: <bun|node> src/init.smoke.ts <config-path>');
  process.exit(2);
}

if (args[0] === '--case') {
  const name = args[1];
  const configPath = args[2];
  if (name === undefined || configPath === undefined) usage();
  await runWorker(name, configPath);
} else {
  const configPath = args[0];
  if (configPath === undefined) usage();
  driveScenes(configPath);
}
