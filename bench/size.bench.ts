/**
 * 体积统计候选基准: js (纯实现) / du (平台命令快路径) 在大目标集上的耗时对比。
 * 口径差异 (磁盘占用 vs 逻辑字节) 由契约测试界定, 本基准只比耗时与条目数一致性。
 */
import { join } from 'node:path';

import { makeWorkspace } from '../src/fixtures.ts';
import { createDuSizer } from '../src/size-du.ts';
import { createJsSizer } from '../src/size-js.ts';
import type { BenchSample } from './scan.bench.ts';

function bigProjects() {
  const projects: {
    dir: string;
    files: number;
    bytesPerFile: number;
    nested: boolean;
  }[] = [];
  for (let i = 0; i < 30; i += 1) {
    projects.push({
      dir: `proj-${String(i).padStart(2, '0')}`,
      files: 200,
      bytesPerFile: 512,
      nested: false,
    });
  }
  return projects;
}

export async function runSizeBench(iterations = 3): Promise<BenchSample[]> {
  const spec = { projects: bigProjects() };
  const workspace = await makeWorkspace(spec);
  try {
    const targets = spec.projects.map((project) =>
      join(workspace.root, project.dir, 'node_modules'),
    );
    const sizers = [createJsSizer(), createDuSizer()];
    const samples: BenchSample[] = [];
    const counts: number[] = [];

    for (const sizer of sizers) {
      await sizer.measure(targets); // 预热
      const heapBefore = process.memoryUsage().heapUsed;
      const times: number[] = [];
      let entries = 0;
      for (let i = 0; i < iterations; i += 1) {
        const started = performance.now();
        const result = await sizer.measure(targets);
        times.push(performance.now() - started);
        entries = result.entries.length;
      }
      times.sort((a, b) => a - b);
      counts.push(entries);
      const heapDeltaMB =
        Math.round(
          ((process.memoryUsage().heapUsed - heapBefore) / 1048576) * 10,
        ) / 10;
      samples.push({
        name: sizer.name,
        case: 'size-large',
        iterations,
        minMs: times[0] ?? 0,
        medianMs: times[Math.floor(times.length / 2)] ?? 0,
        size: entries,
        heapDeltaMB,
      });
    }

    const [first, second] = counts;
    if (first !== undefined && second !== undefined && first !== second) {
      throw new Error(
        `基准前置校验失败: 两候选条目数不一致 (${first} vs ${second})`,
      );
    }
    return samples;
  } finally {
    await workspace.cleanup();
  }
}
