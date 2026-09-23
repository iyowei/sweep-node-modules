/**
 * Node 侧直跑冒烟: `node src/runtime.node-smoke.ts` (Node ≥ 22.6 类型剥离直跑 TS)。
 * 断言: isBun 为 false; 读写往返与 spawnCapture (正常 / 非零退出码 / 命令不存在) 全通。
 * 全通 exit 0; 有失败项则逐条打印后 exit 1 (失败响亮, 不在首个失败处中断以便一次看清)。
 * 命令路径为 POSIX (/bin/*), 只在类 Unix 环境可跑, 本机 macOS 实测。
 */
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isBun, readTextFile, spawnCapture, writeTextFile } from './runtime.ts';

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

check(!isBun, 'isBun 为 false (Node 运行时)');

const path = join(tmpdir(), `sweep-lab-node-smoke-${process.pid}.txt`);
const text = '第一行\n第二行: 中文\n';
try {
  await writeTextFile(path, text);
  check((await readTextFile(path)) === text, '读写往返一致');
} finally {
  await rm(path, { force: true });
}

const echo = await spawnCapture('/bin/echo', ['hi']);
check(
  echo.stdout === 'hi\n' && echo.exitCode === 0,
  'spawnCapture 正常命令 (stdout 与 exit 0)',
);

const failed = await spawnCapture('/bin/sh', ['-c', 'exit 3']);
check(failed.exitCode === 3, 'spawnCapture 非零退出码原样返回, 不抛错');

let missingThrew = false;
try {
  await spawnCapture('sweep-lab-no-such-cmd-xyz', []);
} catch (err) {
  missingThrew =
    err instanceof Error && err.message.includes('sweep-lab-no-such-cmd-xyz');
}
check(missingThrew, 'spawnCapture 命令不存在抛含命令名的错误');

if (failures.length > 0) {
  console.error(`node smoke: ${failures.length} 项失败`);
  process.exit(1);
}

console.log('node smoke: 全部通过');
