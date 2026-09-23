/**
 * 删除安全闸: 四不变量 (末段恰为 node_modules / realpath 位于某 root 之下 /
 * 非根与 home 本体 / realpath 去重) 的逐条判定与理由。
 * 分层: 字符串级判定是可注入 path 风格的纯函数 (posix / win32 语义可在任意平台测试),
 * realpath 等 IO 集中在 validateTargets 一层; 是否整批拒绝由调用方定夺。
 * 设计: docs/designs/deletion-guard.md; 可移植性: docs/adrs/0007-platform-portability.md。
 */
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

/** 纯判定依赖的最小 path 能力集 (node:path 的 posix / win32 均满足) */
export type PathOps = Pick<
  typeof posix,
  'sep' | 'basename' | 'relative' | 'isAbsolute' | 'parse'
>;

export interface PathStyle {
  name: 'posix' | 'win32';
  ops: PathOps;
  /** win32 文件系统大小写不敏感: 一切路径比较前先折叠大小写 */
  caseInsensitive: boolean;
}

export const POSIX_STYLE: PathStyle = {
  name: 'posix',
  ops: posix,
  caseInsensitive: false,
};
export const WIN32_STYLE: PathStyle = {
  name: 'win32',
  ops: win32,
  caseInsensitive: true,
};

/** 当前平台的判定风格 */
export function nativeStyle(): PathStyle {
  return process.platform === 'win32' ? WIN32_STYLE : POSIX_STYLE;
}

/** 大小写折叠: 仅 win32 生效, 不依赖 path 实现的内部大小写行为 */
function fold(p: string, style: PathStyle): string {
  return style.caseInsensitive ? p.toLowerCase() : p;
}

/** 去重键: realpath 折叠后的形态 (不变量 ④ 的比较基准) */
export function dedupeKey(realPath: string, style: PathStyle): string {
  return fold(realPath, style);
}

/** 不变量 ①: 路径末段恰为 node_modules (win32 大小写不敏感) */
export function hasNodeModulesLeaf(target: string, style: PathStyle): boolean {
  return fold(style.ops.basename(target), style) === 'node_modules';
}

/**
 * 不变量 ②: realPath 严格位于某个 root 之下。
 * 以 path.relative 语义判定 (禁字符串前缀比较): 结果为空串 (等于 root 本体)、
 * 以 '..' 起头 (上溯逃逸) 或为绝对路径 (win32 跨盘) 均视为不通过。
 */
export function insideAnyRoot(
  realPath: string,
  roots: string[],
  style: PathStyle,
): boolean {
  return roots.some((root) => {
    const rel = style.ops.relative(fold(root, style), fold(realPath, style));
    if (rel === '' || style.ops.isAbsolute(rel)) return false;
    return rel !== '..' && !rel.startsWith(`..${style.ops.sep}`);
  });
}

/** 不变量 ③ a: realPath 是文件系统根本体 (posix 的 /、win32 的盘根) */
export function isFilesystemRootBody(
  realPath: string,
  style: PathStyle,
): boolean {
  return fold(style.ops.parse(realPath).root, style) === fold(realPath, style);
}

/** 不变量 ③ b: realPath 是 home 本体; home 传 null 即关闭该防线 */
export function isHomeBody(
  realPath: string,
  home: string | null,
  style: PathStyle,
): boolean {
  return home !== null && dedupeKey(realPath, style) === dedupeKey(home, style);
}

export interface ValidateOptions {
  /** 扫描根 (调用方给定; 内部先 realpath 归一, 使符号链接根与 target 同形态比较) */
  roots: string[];
  /** home 本体防线; 缺省取 os.homedir(), 显式传 null 关闭 */
  home?: string | null;
  /** path 判定风格; 缺省随当前平台 */
  style?: PathStyle;
}

export interface RejectedTarget {
  /** 调用方传入的原始目标 */
  target: string;
  /** 拒绝理由 */
  reason: string;
}

export interface ValidationResult {
  /** 通过四不变量、已 realpath 化并去重的可删目标 (保输入顺序); 空数组即无可删项 */
  accepted: string[];
  /** 未通过的目标与理由, 与输入逐条对应 */
  rejected: RejectedTarget[];
}

async function tryRealpath(p: string): Promise<string | null> {
  try {
    return await realpath(p);
  } catch {
    return null;
  }
}

/**
 * 对候选删除目标做四不变量判定。
 *
 * 判定顺序 (逐条短路):
 *   1. 末段不是 node_modules → 拒;
 *   2. realpath 失败 (不存在或不可读) → 拒;
 *   3. realpath 是根本体或 home 本体 → 拒;
 *   4. realpath 末段不是 node_modules (符号链接指向别处) → 拒;
 *   5. realpath 不在任何 root 之下 → 拒;
 *   6. realpath 与已通过项重复 → 拒。
 *
 * 数据追踪示例:
 *   Input  targets = ['/work/zone/app/node_modules', '/work/zone/app']
 *   步骤 1  首项末段命中, 次项末段为 app 即拒; 首项 realpath 后仍在 zone 之下, 通过
 *   Output accepted = ['/work/zone/app/node_modules']
 *          rejected = [{ target: '/work/zone/app', reason: '路径末段不是 node_modules' }]
 */
export async function validateTargets(
  targets: string[],
  options: ValidateOptions,
): Promise<ValidationResult> {
  const style = options.style ?? nativeStyle();
  const homeOption = options.home === undefined ? homedir() : options.home;

  // roots 与 home 先 realpath 归一: macOS 的 /tmp、/var 等符号链接下,
  // 未归一的 root 会把根内目标误判为逃逸; realpath 失败的 root 不可能包含存在的目标, 跳过
  const roots: string[] = [];
  for (const root of options.roots) {
    const real = await tryRealpath(root);
    if (real !== null) roots.push(real);
  }
  const home =
    homeOption === null
      ? null
      : ((await tryRealpath(homeOption)) ?? homeOption);

  const accepted: string[] = [];
  const rejected: RejectedTarget[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    if (!hasNodeModulesLeaf(target, style)) {
      rejected.push({ target, reason: '路径末段不是 node_modules' });
      continue;
    }

    const real = await tryRealpath(target);
    if (real === null) {
      rejected.push({ target, reason: 'realpath 失败 (目标不存在或不可读)' });
      continue;
    }

    if (isFilesystemRootBody(real, style)) {
      rejected.push({ target, reason: '目标是文件系统根本体' });
      continue;
    }

    if (isHomeBody(real, home, style)) {
      rejected.push({ target, reason: '目标是 home 本体' });
      continue;
    }

    if (!hasNodeModulesLeaf(real, style)) {
      rejected.push({ target, reason: 'realpath 后的末段不是 node_modules' });
      continue;
    }

    if (!insideAnyRoot(real, roots, style)) {
      rejected.push({ target, reason: 'realpath 后不在任何 root 之下' });
      continue;
    }

    const key = dedupeKey(real, style);
    if (seen.has(key)) {
      rejected.push({ target, reason: '重复目标 (realpath 去重)' });
      continue;
    }
    seen.add(key);
    accepted.push(real);
  }

  return { accepted, rejected };
}
