/**
 * 体验基线: 真实工作区 (~/rongmai/development) 的只读扫描 + 体积统计端到端耗时。
 * **只读**: 绝不执行任何删除; 目标目录不存在时返回空样本并说明。
 * 验收目标: 预览耗时「感觉不到等待」(真实工作区预览 < 1s 的体验基线)。
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createScanner } from '../src/scan.ts';
import { createDuSizer } from '../src/size-du.ts';
import { createJsSizer } from '../src/size-js.ts';
import type { BenchSample } from './scan.bench.ts';

export async function runRealWorkspaceBench(): Promise<BenchSample[]> {
  const root = join(homedir(), 'rongmai', 'development');
  if (!existsSync(root)) {
    console.log(`[real-workspace] 跳过: ${root} 不存在`);
    return [];
  }

  const scanner = createScanner();
  const exclude = ['fiu-kits'];

  const scanStarted = performance.now();
  const { hits } = await scanner.scan({ roots: [root], exclude });
  const scanMs = performance.now() - scanStarted;

  const samples: BenchSample[] = [
    {
      name: scanner.name,
      case: 'real-scan',
      iterations: 1,
      minMs: scanMs,
      medianMs: scanMs,
      size: hits.length,
    },
  ];

  const targets = hits.map((hit) => hit.target);
  for (const sizer of [createJsSizer(), createDuSizer()]) {
    const started = performance.now();
    const result = await sizer.measure(targets);
    const elapsed = performance.now() - started;
    samples.push({
      name: sizer.name,
      case: 'real-size',
      iterations: 1,
      minMs: elapsed,
      medianMs: elapsed,
      size: result.entries.length,
    });
  }

  return samples;
}
