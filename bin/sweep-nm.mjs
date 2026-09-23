#!/usr/bin/env node
/**
 * npm 安装场景的启动器: 挑选运行时 (Bun 优先, 其次 Node) 后启动真实入口。
 * 与 bin/sweep-nm (sh) / bin/sweep-nm.cmd (cmd) 同逻辑, 三者的差异只在宿主:
 * 本文件同时承担 Unix 与 Windows 的 npm shim 目标 (shebang 必须是 node, 否则
 * npm 的 cmd-shim 会按 shebang 解释器生成 Windows 上不存在的调用)。
 * 退出码原样透传; 两个运行时都缺席时给出可操作提示并非零退出。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 探测命令是否可执行 (以 --version 的实际退出码为准, 不依赖 shell 内建) */
const available = (command) =>
  spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;

/** 挑选运行时: Bun 优先, 其次 Node; 皆无则 null (由调用处报错退出) */
const pickRuntime = () => {
  if (available('bun')) return 'bun';
  if (available('node')) return 'node';
  return null;
};

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// npm 包内是编译产物 (node 拒绝对 node_modules 内的 TS 做类型剥离, 见 package.json 的 build 脚本);
// 仓库开发态无 dist, 回退直跑源码 (bun / node 皆可)
const built = join(root, 'dist', 'cli.js');
const entry = existsSync(built) ? built : join(root, 'src', 'cli.ts');
const runtime = pickRuntime();

if (runtime === null) {
  process.stderr.write('sweep-nm: 未找到 bun 或 node, 请至少安装其一\n');
  process.exit(1);
}

const { status } = spawnSync(runtime, [entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

process.exit(status ?? 1);
