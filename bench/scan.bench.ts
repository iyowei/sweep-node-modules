/**
 * 扫描候选基准: 大 fixture 上对比 prune / native / parallel 的耗时, 并交叉核对候选间命中数一致。
 * 输出为结构化样本 (机器可读), 汇总与存档由 bench/run.ts 负责。
 */
import { makeWorkspace } from '../src/fixtures.ts';
import { createNativeScanner } from '../src/scan-native.ts';
import { createParallelScanner } from '../src/scan-parallel.ts';
import { createPruningScanner } from '../src/scan-prune.ts';
import type { Scanner } from '../src/types.ts';

export interface BenchSample {
  name: string;
  case: string;
  iterations: number;
  minMs: number;
  medianMs: number;
  /** 规模元数据: 命中数 / 条目数等 */
  size: number;
  /** 运行前后堆内存增量 (MB, 过程指示值, 受 GC 时序影响) */
  heapDeltaMB?: number;
}

function bigProjects() {
  const projects: {
    dir: string;
    files: number;
    bytesPerFile: number;
    nested: boolean;
  }[] = [];
  for (let i = 0; i < 40; i += 1) {
    projects.push({
      dir: `proj-${String(i).padStart(2, '0')}/web`,
      files: 150,
      bytesPerFile: 512,
      nested: i % 5 === 0,
    });
  }
  return projects;
}

async function timeScan(
  scanner: Scanner,
  roots: string[],
  exclude: string[],
  iterations: number,
) {
  await scanner.scan({ roots, exclude }); // 预热
  const heapBefore = process.memoryUsage().heapUsed;
  const times: number[] = [];
  let hits = 0;
  for (let i = 0; i < iterations; i += 1) {
    const started = performance.now();
    const result = await scanner.scan({ roots, exclude });
    times.push(performance.now() - started);
    hits = result.hits.length;
  }
  times.sort((a, b) => a - b);
  const heapDeltaMB =
    Math.round(((process.memoryUsage().heapUsed - heapBefore) / 1048576) * 10) /
    10;
  return {
    minMs: times[0] ?? 0,
    medianMs: times[Math.floor(times.length / 2)] ?? 0,
    hits,
    heapDeltaMB,
  };
}

export async function runScanBench(iterations = 5): Promise<BenchSample[]> {
  const workspace = await makeWorkspace({ projects: bigProjects() });
  try {
    const roots = [workspace.root];
    const exclude = ['proj-05'];
    const scanners = [
      createPruningScanner(),
      createNativeScanner(),
      createParallelScanner(),
    ];
    const samples: BenchSample[] = [];

    for (const scanner of scanners) {
      const time = await timeScan(scanner, roots, exclude, iterations);
      samples.push({
        name: scanner.name,
        case: 'scan-large',
        iterations,
        minMs: time.minMs,
        medianMs: time.medianMs,
        size: time.hits,
        heapDeltaMB: time.heapDeltaMB,
      });
    }

    const reference = samples[0];
    for (const sample of samples.slice(1)) {
      if (reference && sample.size !== reference.size) {
        throw new Error(
          `基准前置校验失败: 候选命中数不一致 (${reference.name}=${reference.size} vs ${sample.name}=${sample.size}), 数据不可比`,
        );
      }
    }
    return samples;
  } finally {
    await workspace.cleanup();
  }
}
