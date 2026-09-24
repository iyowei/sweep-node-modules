/**
 * 候选 B: 原生递归 + 后过滤。
 * 遍历阶段不做剪枝, 逐目录 readdir (withFileTypes) 展开整棵树并收集候选;
 * 排除名单 / .git / 嵌套 node_modules 等价剪枝 / 符号链接策略 / 去重排序,
 * 全部在 JS 侧后过滤完成 (差异交由基准裁定)。
 *
 * 未采用 fs.readdir(recursive: true) 的原因 (bun 1.4.2 与 node 26 实测):
 * 首个不可读目录直接抛错, 整次调用拿不到任何部分结果; bun 侧还会跟进符号链接
 * (镜像目录被整棵重复展开)。两处均与契约冲突, 故退化为逐目录 readdir 的等价实现。
 */
import type { Dirent } from 'node:fs';
import { readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import type { ScanHit, ScanOptions, ScanResult, Scanner } from './types.ts';

/** 遍历产出的未过滤候选: 含嵌套命中与待排除项, 一律交给后过滤裁决 */
interface Candidate {
  /** 直接包含该 node_modules 的目录 */
  project: string;
  /** node_modules 绝对路径 */
  target: string;
  /** 自根到该 node_modules 的相对路径段 (末段恒为 node_modules) */
  segments: string[];
}

/** 待展开的目录: 绝对路径 + 自根起算的相对路径段 */
interface Pending {
  dir: string;
  segments: string[];
}

/**
 * 展开单根下的全部目录, 收集 node_modules 候选。
 * 不可读目录记告警跳过, 不中断整次扫描。
 * 外部副作用：向传入的 warnings 数组追加告警文本。
 */
async function collect(root: string, warnings: string[]): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const queue: Pending[] = [{ dir: root, segments: [] }];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const { dir, segments } = queue[cursor]!;

    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      const { code } = error as { code?: string };
      warnings.push(`读取失败, 已跳过: ${dir} [${code ?? 'UNKNOWN'}]`);
      continue;
    }

    for (const entry of entries) {
      // 符号链接不跟进: Dirent 为 lstat 语义, 链接条目的 isDirectory() 为 false
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
      const child = join(dir, entry.name);
      const childSegments = [...segments, entry.name];
      if (entry.name === 'node_modules') {
        candidates.push({
          project: dir,
          target: child,
          segments: childSegments,
        });
      }
      queue.push({ dir: child, segments: childSegments });
    }
  }

  return candidates;
}

/**
 * 后过滤: 排除名单命中 / .git 子树 / 嵌套 node_modules 只留最外层 / 白名单未命中。
 * 三条判定一律只看 node_modules 之前的目录级别: 末段是 node_modules 自身, 不构成路径上
 * 的一级 (与剪枝候选「进入目录时才判定」的口径一致, 两候选对同一输入须给出同一结论)。
 */
function rejected(
  segments: string[],
  exclude: Set<string>,
  include: Set<string>,
): boolean {
  let included = include.size === 0;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]!;
    if (segment === '.git' || exclude.has(segment)) return true;
    if (segment === 'node_modules') return true;
    if (include.has(segment)) included = true;
  }
  return !included;
}

/** 按 target 码元序升序 (与 Array#sort 默认序一致) */
function compareTarget(a: ScanHit, b: ScanHit): number {
  if (a.target < b.target) return -1;
  if (a.target > b.target) return 1;
  return 0;
}

export function createNativeScanner(): Scanner {
  return {
    name: 'native',
    async scan({ roots, exclude, include }: ScanOptions): Promise<ScanResult> {
      const warnings: string[] = [];
      const excluded = new Set(exclude);
      const included = new Set(include);
      const hits = new Map<string, ScanHit>();

      for (const root of roots) {
        for (const candidate of await collect(root, warnings)) {
          if (rejected(candidate.segments, excluded, included)) continue;
          // 多根重复与嵌套根按 realpath 去重; realpath 失败 (扫描中被移除) 回退原路径
          const key = await realpath(candidate.target).catch(
            () => candidate.target,
          );
          if (!hits.has(key)) {
            hits.set(key, {
              project: candidate.project,
              target: candidate.target,
            });
          }
        }
      }

      return { hits: [...hits.values()].sort(compareTarget), warnings };
    },
  };
}
