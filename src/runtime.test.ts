/**
 * 运行时适配层契约测试 (设计: 总纲「二、代码结构与运行时基座」; ADR 0006)。
 * 本文件由 `bun test` 承载 (Bun 侧契约); Node 侧由 `runtime.node-smoke.ts` 直跑冒烟,
 * 经文末「node 冒烟」用例以子进程方式实测 (未装 node 时 skip)。
 */
import { expect, test } from 'bun:test';

import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isBun, readTextFile, spawnCapture, writeTextFile } from './runtime.ts';

test('isBun: 功能检测命中 (本文件由 bun test 承载, 恒为 true)', () => {
  expect(isBun).toBe(true);
});

test('spawnCapture: 正常命令捕获 stdout 与 exit 0', async () => {
  const result = await spawnCapture('/bin/echo', ['hi']);

  expect(result.stdout).toBe('hi\n');
  expect(result.exitCode).toBe(0);
});

test('spawnCapture: 退出码非零原样返回, 不抛错 (交由调用方判定)', async () => {
  const result = await spawnCapture('/bin/sh', ['-c', 'exit 3']);

  expect(result.stdout).toBe('');
  expect(result.exitCode).toBe(3);
});

test('spawnCapture: 命令不存在抛含命令名的错误', async () => {
  const promise = spawnCapture('sweep-lab-no-such-cmd-xyz', []);

  await expect(promise).rejects.toThrow(/sweep-lab-no-such-cmd-xyz/);
});

test('读写往返: UTF-8 文本写入系统临时目录后读回一致', async () => {
  const path = join(tmpdir(), `sweep-lab-runtime-${crypto.randomUUID()}.txt`);
  const text = '第一行\n第二行: 中文与 ASCII mix\n\n';

  try {
    await writeTextFile(path, text);
    expect(await readTextFile(path)).toBe(text);
  } finally {
    await rm(path, { force: true });
  }
});

const nodeProbe = spawnSync('node', ['--version'], { encoding: 'utf8' });
const hasNode = nodeProbe.error === undefined && nodeProbe.status === 0;

if (!hasNode) {
  console.warn('[skip] 未检测到 node, node 冒烟用例跳过');
}

test.skipIf(!hasNode)(
  'node 冒烟: runtime.node-smoke.ts 直跑通过 (exit 0)',
  () => {
    const smokePath = fileURLToPath(
      new URL('./runtime.node-smoke.ts', import.meta.url),
    );
    const cwd = fileURLToPath(new URL('..', import.meta.url));

    const result = spawnSync('node', [smokePath], { cwd, encoding: 'utf8' });

    expect(result.status, `冒烟脚本非零退出 (stderr: ${result.stderr})`).toBe(
      0,
    );
  },
);
