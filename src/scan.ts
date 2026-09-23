/**
 * 扫描模块门面: 对外只暴露胜出候选, 换候选只改此一处 (调用方无感)。
 * 裁定 (基准 r2): 候选 C parallel 胜出 (契约 / 鲁棒双绿, 真实工作区 3.4s → 0.7s, 4.8~5.0×);
 * 并发上限 32 与扫描算法的完整裁定见 docs/designs/scan-and-size.md「实现裁定」。
 */
export { createParallelScanner as createScanner } from './scan-parallel.ts';
