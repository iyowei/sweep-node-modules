/**
 * 基准编排: 依次跑 扫描 / 体积 / 真实工作区 / 压测 四组基准, 汇总打印并追加 JSONL 存档。
 *
 * 收敛记账: 每轮跑完看 results/bench.jsonl 前后对比, **连续 3 轮无收益即收口**。
 * 用法: bun bench/run.ts [--label r1]
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { runRealWorkspaceBench } from './real-workspace.ts';
import { type BenchSample, runScanBench } from './scan.bench.ts';
import { runSizeBench } from './size.bench.ts';
import { runStressBench } from './stress.bench.ts';

const labelIndex = process.argv.indexOf('--label');
const label =
  labelIndex >= 0 ? (process.argv[labelIndex + 1] ?? 'unlabeled') : 'unlabeled';

const samples: BenchSample[] = [];
samples.push(...(await runScanBench()));
samples.push(...(await runSizeBench()));
samples.push(...(await runRealWorkspaceBench()));
samples.push(...(await runStressBench(label)));

console.log('\n=== 基准汇总 ===');
for (const sample of samples) {
  console.log(
    `${sample.case.padEnd(12)} ${sample.name.padEnd(8)} min=${sample.minMs.toFixed(1)}ms ` +
      `median=${sample.medianMs.toFixed(1)}ms n=${sample.size} ` +
      `heap=${sample.heapDeltaMB ?? '-'}MB`,
  );
}

await mkdir(join(import.meta.dir, 'results'), { recursive: true });
const file = join(import.meta.dir, 'results', 'bench.jsonl');
for (const sample of samples) {
  await appendFile(
    file,
    `${JSON.stringify({ ts: Date.now(), label, ...sample })}\n`,
  );
}
console.log(`\n已存档 ${samples.length} 条 → ${file} (label=${label})`);
