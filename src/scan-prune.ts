/**
 * 候选 A: 手写剪枝递归 —— 命中 node_modules 即记录并停止下钻 (嵌套天然解决);
 * 排除名单与 .git 在进入目录时判定; 符号链接不跟进; 命中按 realpath 去重、按 target 升序输出。
 */
import type { Dirent } from 'node:fs';
import { readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import type { ScanHit, ScanOptions, ScanResult, Scanner } from './types.ts';

const NODE_MODULES = 'node_modules';
const GIT_DIR = '.git';

/** target 升序比较 (码点序, 不依赖 locale, 保证跨平台输出稳定) */
function compareTarget(a: ScanHit, b: ScanHit): number {
  if (a.target < b.target) return -1;
  if (a.target > b.target) return 1;
  return 0;
}

export function createPruningScanner(): Scanner {
  return {
    name: 'prune',
    /**
     * 遍历各根, 收集直接包含 node_modules 的项目目录。
     * 外部副作用：只读文件系统 (readdir / realpath), 不写入。
     *
     * ### 数据追踪示例
     *
     * ```text
     * Input (roots = ['/w'], exclude = ['container'])
     *   磁盘树 = /w/container/beta/node_modules, /w/alpha/node_modules/dep/node_modules
     *
     * 步骤 1: 根按 realpath 去重 (重复根、嵌套根只遍历一次)
     *   待遍历根 = ['/w']
     *
     * 步骤 2: 递归下探, 进入目录时判定 exclude 与 .git
     *   /w/container -> 名字命中 exclude, 整棵子树跳过
     *   /w/alpha -> 见 node_modules, 记录后剪枝 (内层 dep/node_modules 不再下探)
     *
     * 步骤 3: 按 realpath 去重后按 target 升序排序
     *
     * Output
     *   hits = [{ project: '/w/alpha', target: '/w/alpha/node_modules' }]
     *   warnings = []  // 不可读 / 不存在的路径在此逐条累积, 不中断
     * ```
     */
    async scan(options: ScanOptions): Promise<ScanResult> {
      const warnings: string[] = [];
      const exclude = new Set(options.exclude);
      /** 去重键 = target 的 realpath; 值为对外输出 (target 保留调用方拼写, 不被 realpath 改写) */
      const hitsByRealTarget = new Map<string, ScanHit>();

      // 根去重: 同一 realpath 只遍历一次; 不存在的根记告警后跳过
      const seenRoots = new Set<string>();
      const roots: string[] = [];
      for (const root of options.roots) {
        const key = await realpath(root).catch(() => null);
        if (key === null) {
          warnings.push(`根不可用, 已跳过: ${root}`);
          continue;
        }
        if (seenRoots.has(key)) continue;
        seenRoots.add(key);
        roots.push(root);
      }

      // 热路径 = 目录遍历: 单次 readdir withFileTypes 取类型, 免逐个 lstat
      const walk = async (dir: string): Promise<void> => {
        let entries: Dirent[];
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          warnings.push(`目录不可读, 已跳过: ${dir}`);
          return;
        }

        for (const entry of entries) {
          // 符号链接 (含指向目录的) 的 dirent 类型为 symlink, 此处一并跳过, 不跟进
          if (!entry.isDirectory()) continue;

          const name = entry.name;
          if (name === NODE_MODULES) {
            // 命中即剪枝, 不下钻; realpath 仅作去重键, 失败时退回字面路径
            const target = join(dir, name);
            const key = await realpath(target).catch(() => target);
            if (!hitsByRealTarget.has(key))
              hitsByRealTarget.set(key, { project: dir, target });
            continue;
          }
          if (name === GIT_DIR || exclude.has(name)) continue;

          await walk(join(dir, name));
        }
      };

      for (const root of roots) {
        await walk(root);
      }

      const hits = [...hitsByRealTarget.values()].sort(compareTarget);
      return { hits, warnings };
    },
  };
}
