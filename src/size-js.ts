/**
 * 候选 B (统一): 纯 JS 递归统计逻辑字节 (跨平台单一代码路径)。
 * 口径: 目录内普通文件大小求和 (磁盘占用口径由 du 候选承担, 差异交基准裁定);
 * 符号链接一律不跟随 (与扫描同策);
 * 根目录存在但不可读 → 结构化记入 unmeasured; 子目录失败 → 告警并继续累计已读部分。
 */
import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { SizeEntry, SizeResult, Sizer, UnmeasuredEntry } from './types.ts';

/** 失败原因的中文短语 (人话); 未知错误码保留码值便于诊断 */
function describeFailure(code: string | undefined): string {
  switch (code) {
    case 'ENOENT':
      return '不存在';
    case 'EACCES':
    case 'EPERM':
      return '权限不足, 无法读取';
    case 'ENOTDIR':
      return '不是目录';
    case 'ELOOP':
      return '符号链接层级过深';
    default:
      return code === undefined ? '读取失败' : `读取失败 (${code})`;
  }
}

/** 取错误码; 非对象或缺失时返回 undefined */
function errorCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

/**
 * 递归累计目录条目内普通文件字节数。
 * 子目录 / 文件读取失败记中文告警并跳过该子树, 同级其余条目照常累计;
 * 根层 readdir 已由 measure 完成, 失败分流 (不存在 / unmeasured) 不进入本函数。
 */
async function sumEntries(
  dirents: Dirent[],
  dir: string,
  warnings: string[],
): Promise<number> {
  let total = 0;
  for (const dirent of dirents) {
    // 符号链接不跟随: 防环、防越出 target
    if (dirent.isSymbolicLink()) continue;

    const path = join(dir, dirent.name);
    if (dirent.isDirectory()) {
      try {
        total += await sumEntries(
          await readdir(path, { withFileTypes: true }),
          path,
          warnings,
        );
      } catch (error) {
        warnings.push(
          `体积统计失败 (${describeFailure(errorCode(error))}): ${path}`,
        );
      }
    } else if (dirent.isFile()) {
      try {
        total += (await stat(path)).size;
      } catch (error) {
        warnings.push(
          `体积统计失败 (${describeFailure(errorCode(error))}): ${path}`,
        );
      }
    }
  }
  return total;
}

export function createJsSizer(): Sizer {
  return {
    name: 'js',
    async measure(targets: string[]): Promise<SizeResult> {
      const warnings: string[] = [];
      const entries: SizeEntry[] = [];
      const unmeasured: UnmeasuredEntry[] = [];

      // 排序副本: 不改动调用方数组, 输出按 target 升序稳定
      for (const target of [...targets].sort()) {
        let dirents: Dirent[];
        try {
          dirents = await readdir(target, { withFileTypes: true });
        } catch (error) {
          const code = errorCode(error);
          if (code === 'ENOENT') {
            // 「不存在」维持裁定: 告警并跳过, 不入任何桶
            warnings.push(`体积统计失败 (不存在): ${target}`);
          } else {
            // 存在但测不到: 结构化上报, 下游不得静默移出清单
            unmeasured.push({ target, reason: describeFailure(code) });
          }
          continue;
        }
        entries.push({
          target,
          bytes: await sumEntries(dirents, target, warnings),
        });
      }

      return { entries, warnings, unmeasured };
    },
  };
}
