/**
 * 长跑压力套件: 中等规模合成工作区上反复扫描, 把「不崩 / 不泄漏 / 两候选一致」钉成回归门。
 * 与 bench/stress.bench.ts 的分工: 基准出超大规模的资源画像, 本套件把长跑行为钉死。
 * 维度: 命中一致性 / 反复扫描下的堆增量 / 句柄回落到基线。
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type Workspace, makeWorkspace } from './fixtures.ts';
import { createParallelScanner } from './scan-parallel.ts';
import { createPruningScanner } from './scan-prune.ts';
import type { ScanOptions } from './types.ts';

/** 规模: 300 个项目 + 1 个 3000 条目宽目录, 取中等规模以保证套件秒级完成 */
const PROJECT_COUNT = 300;
const WIDE_FILES = 2970;
const WIDE_PROJECTS = 30;
const EXPECTED_HITS = PROJECT_COUNT + WIDE_PROJECTS;

/** 每轮 = 两候选各扫一遍; 轮数取到足以让泄漏类缺陷累积暴露 */
const ROUNDS = 24;

/**
 * 超时守卫 (ms): 实测耗时留一个数量级余量, 挂死即失败。
 * 守卫只拦 await 链上的挂死, 同步死循环无法被打断, 故套件内不引入长同步循环。
 */
const TEST_TIMEOUT_MS = 90000;

/** 堆增量上限 (MB): 长跑后堆涨过此值即判泄漏 */
const HEAP_LIMIT_MB = 100;

/** 句柄回归容差 (个): 采样通道自身占用一个句柄, 允许 ±2 的测量抖动 */
const FD_TOLERANCE = 2;

let workspace: Workspace;
let options: ScanOptions;

/**
 * 句柄采样: macOS / Linux 经 /dev/fd 可读 (Linux 侧为指向 /proc/self/fd 的软链)。
 * 读不到时返回 null, 由调用方显式跳过句柄断言而不是伪造 0。
 */
function fdCount(): number | null {
  try {
    return readdirSync('/dev/fd').length;
  } catch {
    return null;
  }
}

/**
 * 等句柄数回落到基线容差内: readdir 的句柄由运行时池化, 扫描返回后可能有极短的收尾延迟,
 * 立即比对会把正常抖动误判成泄漏。超期仍未回落则返回当时的实测值, 由断言判定成败。
 */
async function settleFd(
  baseline: number | null,
  deadlineMs = 500,
): Promise<number | null> {
  if (baseline === null) return null;
  const until = Date.now() + deadlineMs;
  for (;;) {
    const current = fdCount();
    if (current === null || Math.abs(current - baseline) <= FD_TOLERANCE)
      return current;
    if (Date.now() >= until) return current;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** 分块并发建 fixture: 逐条 await 串行到秒级, 一次性全并发又会堆满在飞句柄 */
async function buildInChunks(
  count: number,
  chunkSize: number,
  job: (index: number) => Promise<void>,
): Promise<void> {
  for (let start = 0; start < count; start += chunkSize) {
    const end = Math.min(start + chunkSize, count);
    await Promise.all(
      Array.from({ length: end - start }, (_, offset) => job(start + offset)),
    );
  }
}

describe('长跑压力 [scan-prune / scan-parallel]', () => {
  beforeAll(async () => {
    workspace = await makeWorkspace({
      projects: Array.from({ length: PROJECT_COUNT }, (_, index) => ({
        dir: `proj-${String(index).padStart(4, '0')}`,
        files: 1,
      })),
    });

    // 宽目录: 散文件压 readdir 的返回宽度, 混杂其中的项目压待遍历栈的深度
    const wide = join(workspace.root, 'wide');
    await mkdir(wide, { recursive: true });
    await buildInChunks(WIDE_FILES, 64, async (index) => {
      await writeFile(join(wide, `f-${index}.txt`), '');
    });
    await buildInChunks(WIDE_PROJECTS, 8, async (index) => {
      await mkdir(join(wide, `sub-${index}`, 'node_modules'), {
        recursive: true,
      });
    });

    options = { roots: [workspace.root], exclude: [], include: [] };
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await workspace.cleanup();
  });

  test(
    '两候选在中等规模下命中一致且全程不崩',
    async () => {
      const reference = await createPruningScanner().scan(options);
      const candidate = await createParallelScanner().scan(options);

      expect(reference.hits).toHaveLength(EXPECTED_HITS);
      // 命中清单逐字对齐: parallel 的完成次序不影响输出序 (按 target 升序)
      expect(candidate.hits.map((hit) => hit.target)).toEqual(
        reference.hits.map((hit) => hit.target),
      );
      // 告警数组按实际完成次序累积, parallel 侧即并发完成序, 故不逐条对撞, 只判两候选均无告警
      expect(reference.warnings).toEqual([]);
      expect(candidate.warnings).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    '长跑无泄漏: 堆增量有界、句柄回到基线',
    async () => {
      const fdBaseline = fdCount();
      const heapBefore = process.memoryUsage().heapUsed;
      const scanners = [createPruningScanner(), createParallelScanner()];
      let hits = 0;

      // 每轮结果随作用域落地即弃, 长跑若在闭包或模块级累积状态, 堆增量会把它暴露出来
      for (let round = 0; round < ROUNDS; round += 1) {
        for (const scanner of scanners) {
          const result = await scanner.scan(options);
          hits = result.hits.length;
        }
      }

      expect(hits).toBe(EXPECTED_HITS);

      const heapDeltaMB =
        (process.memoryUsage().heapUsed - heapBefore) / 1048576;
      expect(heapDeltaMB).toBeLessThan(HEAP_LIMIT_MB);

      const settled = await settleFd(fdBaseline);
      if (fdBaseline === null || settled === null) {
        console.warn(
          '[stress] /dev/fd 不可读, 句柄断言跳过 (显式跳过, 非静默通过)',
        );
      } else {
        expect(Math.abs(settled - fdBaseline)).toBeLessThanOrEqual(
          FD_TOLERANCE,
        );
      }
    },
    TEST_TIMEOUT_MS,
  );
});
