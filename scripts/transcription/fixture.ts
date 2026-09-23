/**
 * 转写契约套件 · 现场层 (fixture 建树 / setup 预置 / 最小 env / 执行 / 清理)。
 *
 * 职责: 把语料声明的 fixture 物化成真实目录树, 以最小白名单 env 启动被测命令, 跑完回收现场。
 * 建树与体积口径语义与 src/fixtures.ts 同构 (被测的既有测试口径即验收口径)。
 */
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  type CorpusCase,
  type FixtureSpec,
  type SetupStep,
  applyVars,
} from './corpus.ts';

/** fixture 内的家目录名 (被测进程的 HOME 指向此处, 见 buildEnv 注释) */
const HOME_DIR_NAME = 'home';

/** 默认散文件数与字节数 (与 src/fixtures.ts 同值, 保语料与既有测试口径一致) */
const DEFAULT_FILES = 2;
const DEFAULT_BYTES_PER_FILE = 256;

/** 嵌套 node_modules 与 .git 诱饵文件的小字节数 (与 src/fixtures.ts 同值) */
const BAIT_FILE_BYTES = 64;

/**
 * 最小环境白名单 (不继承宿主环境: 防宿主语义变量如 SWEEP_NM_CONFIG 泄漏进断言面, 保可移植)。
 * - PATH / TMPDIR 族: 运行基础 (被测 spawn 子进程、取临时目录时用);
 * - HOME / USERPROFILE: 家目录, 由本运行器改写指向 fixture 内的 home (见 buildEnv);
 * - SystemRoot / PATHEXT / ComSpec: Windows 下子进程运行基础;
 * - QUOTING_STYLE: GNU coreutils 在非 TTY 下默认对文件名做 shell 转义, 会破坏 du 输出解析,
 *   强制 literal (BSD du 无此变量, 设了无害)。
 */
const BASE_ENV_KEYS = [
  'PATH',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SystemRoot',
  'PATHEXT',
  'ComSpec',
  'QUOTING_STYLE',
];

/** 一次运行期的固定上下文 (由调用方解析 CLI 后组装) */
export interface RunContext {
  /** 被测命令 argv (由 --target 拆分而来) */
  targetArgv: string[];
  timeoutMs: number;
  keep: boolean;
  /** fixture 根基座 (调用方保证已存在) */
  workBase: string;
}

export interface ExecOutcome {
  status: number | null;
  stdout: string;
  stderr: string;
  /** 超时守卫击中 (进程已被杀, 判失败) */
  timedOut: boolean;
  /** 非超时的执行级失败 (命令不存在 / cwd 不存在等) */
  spawnError?: string;
}

/**
 * 按声明建工作区树。外部副作用：在 root 下创建目录与文件 (root 由调用方创建并保证为空)。
 */
export async function buildFixture(
  root: string,
  fixture: FixtureSpec,
): Promise<void> {
  for (const project of fixture.projects ?? []) {
    const nodeModules = join(root, project.dir, 'node_modules');
    await mkdir(nodeModules, { recursive: true });
    const files = project.files ?? DEFAULT_FILES;
    const bytes = project.bytesPerFile ?? DEFAULT_BYTES_PER_FILE;
    for (let index = 0; index < files; index += 1) {
      await writeFile(join(nodeModules, `pkg-${index}.js`), 'x'.repeat(bytes));
    }
    if (project.nested === true) {
      const inner = join(nodeModules, 'dep', 'node_modules');
      await mkdir(inner, { recursive: true });
      await writeFile(join(inner, 'inner.js'), 'x'.repeat(BAIT_FILE_BYTES));
    }
    if (project.git === true) {
      const bait = join(root, project.dir, '.git', 'x', 'node_modules');
      await mkdir(bait, { recursive: true });
      await writeFile(join(bait, 'bait.js'), 'x'.repeat(BAIT_FILE_BYTES));
    }
  }
  for (const link of fixture.symlinks ?? []) {
    await symlink(join(root, link.to), join(root, link.at));
  }
  for (const dir of fixture.unreadable ?? []) {
    await mkdir(join(root, dir), { recursive: true });
    await chmod(join(root, dir), 0o000);
  }
  for (const dir of fixture.readonly ?? []) {
    // chmod 0500 (r-x): 内容可读可进入 (扫描与体积统计正常), 不可写 (删除条目 EACCES)
    await chmod(join(root, dir), 0o500);
  }
  // 家目录: 被测进程的 HOME 指向此处 (存在但空)。放 fixture 内一举两得:
  // 既让 home 防线与 ~ 缩写行为可控可测, 又不引入 root 之外的残留。
  await mkdir(join(root, HOME_DIR_NAME), { recursive: true });
}

/**
 * 应用 setup 预置态 (在 fixture 建树之后按序执行); 写文件时自动创建父目录。
 * 外部副作用：在 root 下写入文件。
 */
export async function applySetup(
  root: string,
  steps: SetupStep[],
): Promise<void> {
  for (const step of steps) {
    const full = join(root, step.write.path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, applyVars(step.write.text, root));
  }
}

/**
 * 清理 fixture: 先把 chmod 000 的目录恢复可写 (否则 rm 无法穿透), 再整棵删除。
 * 清理失败不掩盖: 打 stderr 警告 (不改变用例判定)。
 */
export async function cleanupFixture(
  rawRoot: string,
  fixture: FixtureSpec,
): Promise<void> {
  for (const dir of fixture.unreadable ?? []) {
    await chmod(join(rawRoot, dir), 0o700).catch(() => {});
  }
  for (const dir of fixture.readonly ?? []) {
    await chmod(join(rawRoot, dir), 0o700).catch(() => {});
  }
  await rm(rawRoot, { recursive: true, force: true }).catch(
    (error: unknown) => {
      process.stderr.write(
        `[Warning] fixture 清理失败 (${rawRoot}): ${String(error)}\n`,
      );
    },
  );
}

/**
 * 组装被测进程环境: 白名单宿主变量 + fixture 内家目录 + case 增量 (后覆盖前)。
 * 外部副作用：无 (纯构造)。
 */
export function buildEnv(
  root: string,
  extra: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of BASE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  // HOME 改写为 fixture 内目录: 被测的 ~ 缩写与 home 防线都落在可控域内, 且不与 fixture 根的
  // 绝对路径互为前缀 (否则清单里的路径会被缩成 ~ 形态, 语料的逐字节期望无法用 $FIXTURE 表达)。
  const fakeHome = join(root, HOME_DIR_NAME);
  env.HOME = fakeHome;
  env.USERPROFILE = fakeHome;
  for (const [key, value] of Object.entries(extra)) {
    env[key] = applyVars(value, root);
  }
  return env;
}

/**
 * 执行被测命令一次 (带超时守卫)。
 * 外部副作用：启动子进程 (cwd 为 fixture 内目录, 环境为白名单), 可能改动 fixture 文件系统。
 *
 * ### 数据追踪示例
 * ```text
 * Input（真实 Payload）
 *   ctx.targetArgv = ['bun', '/abs/src/cli.ts']; caseSpec.run = { cwd: 'zone', argv: ['--json'] }
 *
 * 步骤 1：拼装 argv 与 cwd
 *   argv = ['bun', '/abs/src/cli.ts', '--json']; cwd = '<fixture>/zone'
 *
 * 步骤 2：白名单 env 启动子进程 (超时守卫 timeoutMs, 到期 SIGKILL)
 *   result = { status: 0, stdout: '…', stderr: '' }
 *
 * Output（数据契约）
 *   return { status, stdout, stderr, timedOut, spawnError? } (spawn 级失败只填 spawnError)
 * ```
 */
export function executeCase(
  caseSpec: CorpusCase,
  root: string,
  ctx: RunContext,
): ExecOutcome {
  const run = caseSpec.run;
  const argv = [
    ...ctx.targetArgv,
    ...(run.argv ?? []).map((item) => applyVars(item, root)),
  ];
  // 收窄 argv[0] 的类型 (noUncheckedIndexedAccess): --target 非空由 parseArgs 保证, 拆分必出元素,
  // 此分支不引入 as / @ts-ignore, 把不可达态按「执行级失败」同口径返回。
  const command = argv[0];
  if (command === undefined) {
    return {
      status: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      spawnError: '被测命令为空 (--target 未给出可执行命令)',
    };
  }
  const cwd = resolve(root, run.cwd ?? '.');
  const env = buildEnv(root, run.env ?? {});

  const result = spawnSync(command, argv.slice(1), {
    cwd,
    env,
    timeout: ctx.timeoutMs,
    // 超时后硬杀: 被测若死在 readline 等 stdin 上, SIGTERM 可能被吞
    killSignal: 'SIGKILL',
    encoding: 'utf8',
  });

  const error = result.error as (Error & { code?: string }) | undefined;
  const timedOut =
    error !== undefined &&
    (error.code === 'ETIMEDOUT' || /ETIMEDOUT/.test(error.message));
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut,
    spawnError: error !== undefined && !timedOut ? error.message : undefined,
  };
}
