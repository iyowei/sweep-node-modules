/**
 * 转写契约套件 · 比对层。
 *
 * 职责: 拿一条语料的 expect 面逐项量被测进程的实际结果 (退出码 / stdout 逐字节 / contains /
 * 禁含 / stderr / 文件系统终态), 产出失败清单。本层只判不修: 不触碰现场, 不改被测行为。
 */
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { type ExpectSpec, type FsExpectation, applyVars } from './corpus.ts';
import type { ExecOutcome } from './fixture.ts';
import { type FailureItem, clip } from './report.ts';

/** 找两段文本的首个差异行, 返回人话摘要 (行号从 1 起) */
export function firstLineDiff(expected: string, actual: string): string {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const max = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < max; index += 1) {
    const exp = expectedLines[index];
    const act = actualLines[index];
    if (exp === act) continue;
    if (exp === undefined)
      return `第 ${index + 1} 行起实际输出更长: 实际 "${clip(act ?? '')}"`;
    if (act === undefined)
      return `第 ${index + 1} 行起期望输出更长: 期望 "${clip(exp)}"`;
    return `首个差异在第 ${index + 1} 行: 期望 "${clip(exp)}", 实际 "${clip(act)}"`;
  }
  return '全文逐行相等但不逐字节相等 (差异在行尾字节)';
}

/**
 * 文件系统终态断言: gone (不存在) / exists (存在, lstat 语义) / empty (存在且空目录)。
 * 返回 null 即通过, 否则返回失败说明。
 */
export async function checkFs(
  root: string,
  item: FsExpectation,
): Promise<string | null> {
  const full = join(root, item.path);
  let info: Awaited<ReturnType<typeof lstat>> | null;
  try {
    info = await lstat(full);
  } catch {
    info = null;
  }

  if (item.state === 'gone') {
    return info === null ? null : `期望不存在, 实际存在 (${item.path})`;
  }
  if (info === null) return `期望存在, 实际不存在 (${item.path})`;
  if (item.state === 'exists') return null;

  if (!info.isDirectory()) return `期望为空目录, 实际不是目录 (${item.path})`;
  const entries = await readdir(full);
  return entries.length === 0
    ? null
    : `期望为空目录, 实际有 ${entries.length} 项 (${item.path})`;
}

/**
 * 逐项比对一条用例的全部断言。超时与执行级失败为短路项 (后续断言无意义, 只报该条)。
 *
 * ### 数据追踪示例
 * ```text
 * Input（真实 Payload）
 *   expect = { exitCode: 0, stdoutExact: '▍ SWEEP-NM  预览 · 1 个根: $FIXTURE/zone\n…', fs: [{ path: 'zone/a/node_modules', state: 'exists' }] }
 *   exec = { status: 0, stdout: '…与期望一致…', stderr: '', timedOut: false }
 *
 * 步骤 1：短路项检查
 *   timedOut / spawnError 均为假, 继续逐项比对
 *
 * 步骤 2：逐项 (退出码 → stdoutExact → contains → fs)
 *   全部通过 → failures = []
 *
 * Output（数据契约）
 *   return [] (通过) 或 FailureItem[] (逐项失败原因与期望 / 实际)
 * ```
 */
export async function compareCase(
  expect: ExpectSpec,
  exec: ExecOutcome,
  root: string,
): Promise<FailureItem[]> {
  const failures: FailureItem[] = [];

  if (exec.timedOut) {
    failures.push({
      kind: 'timeout',
      message: '执行超时 (超时守卫击中, 进程已被杀), 判失败',
    });
    return failures;
  }
  if (exec.spawnError !== undefined) {
    failures.push({
      kind: 'spawn',
      message: `被测命令无法执行: ${exec.spawnError}`,
    });
    return failures;
  }

  if (exec.status !== expect.exitCode) {
    failures.push({
      kind: 'exitCode',
      message: `退出码不符: 期望 ${expect.exitCode}, 实际 ${exec.status}`,
      expected: String(expect.exitCode),
      actual: String(exec.status),
    });
  }

  if (expect.stdoutExact !== undefined) {
    const wanted = applyVars(expect.stdoutExact, root);
    if (exec.stdout !== wanted) {
      failures.push({
        kind: 'stdoutExact',
        message: `stdout 与期望不逐字节相等 (${firstLineDiff(wanted, exec.stdout)})`,
        expected: wanted,
        actual: exec.stdout,
      });
    }
  }

  for (const needle of expect.stdoutContains ?? []) {
    const wanted = applyVars(needle, root);
    if (!exec.stdout.includes(wanted)) {
      failures.push({
        kind: 'stdoutContains',
        message: `stdout 缺少子串: "${clip(wanted)}"`,
      });
    }
  }

  for (const needle of expect.stdoutMustNotContain ?? []) {
    const forbidden = applyVars(needle, root);
    if (exec.stdout.includes(forbidden)) {
      failures.push({
        kind: 'stdoutMustNotContain',
        message: `stdout 出现了禁含子串: "${clip(forbidden)}"`,
      });
    }
  }

  for (const needle of expect.stderrContains ?? []) {
    const wanted = applyVars(needle, root);
    if (!exec.stderr.includes(wanted)) {
      failures.push({
        kind: 'stderrContains',
        message: `stderr 缺少子串: "${clip(wanted)}"`,
      });
    }
  }

  for (const item of expect.fs ?? []) {
    const problem = await checkFs(root, item);
    if (problem !== null) failures.push({ kind: 'fs', message: problem });
  }

  return failures;
}
