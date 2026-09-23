/**
 * 删除执行器: 对安全闸已校验 (realpath 化、去重) 的目标逐条执行 fs.rm(recursive)。
 * 语义 (设计: docs/designs/deletion-guard.md「执行语义」): 逐条删除、单条失败不中断整批、
 * 末尾分桶汇总。ENOENT 分两种, 不可混同: rm 阶段的 ENOENT (链路已全验为真目录, 消失的
 * 即目标本体) 归 missing, 视为成功侧 (目标已达成的语义, 不计失败); 复核阶段的组件级
 * ENOENT 归 failed (组件消失不等于目标消失: 目标可能只是被 mv 走仍在占盘, 报成功会伪造
 * 成功报告与退出码 0, 脚本化调用方无从察觉)。
 *
 * 安全复核 (HIGH-1: 中间组件替换 → root 外任意删除): fs.rm 只对末段取 lstat 语义,
 * 中间组件一律跟随符号链接; guard 的 realpath 只固定校验时刻的解析结果, 二者之间把某个
 * 中间组件换成指向 root 外的符号链接, rm 就会删到 root 外。故每条删除前自 root 向下逐级
 * lstat 复核 (末段除外: 链接本体由 fs.rm 自身安全处理), 检出替换即整批中止。
 * 残余风险 (复核只缩短窗口, 不构成零窗口保证): 复核与 rm 之间仍有竞态窗口, 路径级 API
 * 无法彻底消除 (需 fd 级 openat / O_NOFOLLOW, Node 未暴露); 同型真实目录的整目录换位
 * lstat 亦不可识别。调用方须传与 target 同源拼写的 roots (建议即 guard 判根用的 realpath 结果)。
 */
import { lstat, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

export interface FailedTarget {
  /** 调用方传入的目标 (原样回显, 不做二次 realpath) */
  target: string;
  /**
   * 「错误码: 人话 (目标: 路径; …)」形态的可读串。
   * 删除已尝试而失败时附复查提示 (内容可能已残缺); 复核未通过而根本未删则注明「未执行删除」。
   */
  error: string;
}

/** 整批中止信息 (首个复核未通过的目标) */
export interface AbortedBatch {
  /** 触发中止的目标 (未被删除) */
  target: string;
  /** 中止原因 (人话, 含定位) */
  reason: string;
}

export interface RemovalResult {
  /** 实际删除成功的目标 (保输入顺序) */
  removed: string[];
  /** rm 阶段发现目标本体已不存在 (ENOENT) 的目标; 目标已达成, 计成功侧 (保输入顺序) */
  missing: string[];
  /** 删除失败与复核未完成 (组件消失 / 不可核验) 的目标及原因 (保输入顺序); 后者未执行删除 */
  failed: FailedTarget[];
  /** 安全复核未通过即中止整批, 其间条目一律不删; 未触发时缺省 */
  aborted?: AbortedBatch;
}

export interface RemovalOptions {
  /**
   * 可删目标所属的信任根 (与 guard 同源; 拼写须与 targets 一致, 建议同为 realpath 化结果)。
   * 目标不在任何根之下时无可信复核, 整批中止。
   */
  roots: string[];
}

/** 常见错误码的人话映射, 未收录的码回落通用提示 */
const ERROR_HINTS: Record<string, string> = {
  EACCES: '权限不足, 拒绝删除',
  EPERM: '操作不被允许',
  EBUSY: '目标被占用',
  ENOTEMPTY: '目录非空',
  EROFS: '目标位于只读文件系统',
};

/** fs 错误对象的最小形态 (避免依赖 NodeJS 命名空间) */
interface FsError {
  code?: string;
  message?: string;
}

/**
 * 失败桶统一附带的复查提示: rm 递归是先删内容、最后删壳, 中途失败时内容往往已残缺
 * (实测父目录只读场景: 内容清空、只剩空壳), 不提示会误导用户以为「依赖还安全」。
 */
const PARTIAL_DELETION_HINT = '注意: 目录内容可能已被部分或全部删除, 请复查';

/** 错误码到人话前缀 */
function describeCode(error: unknown): string {
  const fsError = error as FsError | null;
  const code = fsError?.code;
  if (typeof code !== 'string' || code === '') {
    return `未知错误: ${fsError?.message ?? String(error)}`;
  }
  return `${code}: ${ERROR_HINTS[code] ?? '删除未成功'}`;
}

/** 拼「错误码 + 人话 + 目标定位 + 复查提示」的删除失败串 */
function describeRemovalError(target: string, error: unknown): string {
  return `${describeCode(error)} (目标: ${target}; ${PARTIAL_DELETION_HINT})`;
}

/** 复核阶段自身出错 (未尝试删除, 故不附「内容可能已残缺」提示) */
function describeReviewError(
  target: string,
  path: string,
  error: unknown,
): string {
  return `安全复核未完成 (${describeCode(error)}) (目标: ${target}; 组件: ${path}; 未执行删除)`;
}

/**
 * 复核时链上组件消失 (ENOENT) 的可读串: 组件消失不等于目标消失 (可能只是被 mv 走仍存活),
 * 故要求复查, 并附「确已不存在可忽略」的降噪说明; 未尝试删除, 同样不附「内容可能已残缺」提示。
 */
function describeVanishedReview(target: string, path: string): string {
  return `安全复核未完成 (ENOENT: 路径组件消失) (目标: ${target}; 组件: ${path}; 请复查目标是否仍存在; 未执行删除; 若目标确已不存在, 可忽略此条)`;
}

/** 严格包含判定 (path.relative 语义, 与 guard 的 insideAnyRoot 同型): 等于根本体或越界均不通过 */
function isUnder(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (rel === '' || isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

/**
 * 复核链: 自 root 至 target 父目录 (root 含, target 本体不含)。
 * 末段不查: 若 target 本体是符号链接, fs.rm 按 lstat 语义只删链接、不跟进, 本已安全。
 * 例: root=/w, target=/w/a/b/node_modules → ['/w', '/w/a', '/w/a/b']
 */
function componentChain(root: string, target: string): string[] {
  const chain = [root];
  let cursor = root;
  for (const part of relative(root, target).split(sep).slice(0, -1)) {
    cursor = join(cursor, part);
    chain.push(cursor);
  }
  return chain;
}

type ReviewFinding =
  | { kind: 'unsafe'; path: string }
  | { kind: 'vanished'; path: string }
  | { kind: 'unverified'; path: string; error: unknown };

/** 逐级复核链上组件: 全通过返回 null; 符号链接与非目录统一由 isDirectory 判定拦下 (lstat 不 follow 末段) */
async function reviewComponents(
  chain: string[],
): Promise<ReviewFinding | null> {
  for (const path of chain) {
    try {
      const stats = await lstat(path);
      if (!stats.isDirectory()) return { kind: 'unsafe', path };
    } catch (error) {
      const code = (error as FsError | null)?.code;
      if (code === 'ENOENT') return { kind: 'vanished', path };
      return { kind: 'unverified', path, error };
    }
  }
  return null;
}

/**
 * 逐条复核并删除目标, 失败不中断整批, 复核不通过则整批中止, 按结果分桶
 * (removed / missing / failed 均保输入顺序)。
 *
 * 数据追踪示例:
 *   Input  targets = ['/w/zeta/node_modules', '/w/lock/node_modules', '/w/bare/node_modules'],
 *          options.roots = ['/w']  (三者父链均为真目录)
 *   步骤 0  逐条复核: 自 /w 向下 lstat 至目标父目录; 检出符号链接即整批中止,
 *           链上组件 ENOENT 归 failed (可能只是被 mv 走)
 *   步骤 1  首项 rm 成功 → removed
 *   步骤 2  次项 rm 抛 EACCES (父目录只读) → failed, 错误串 'EACCES: 权限不足, 拒绝删除
 *            (目标: ...; 注意: 目录内容可能已被部分或全部删除, 请复查)'
 *   步骤 3  末项复核通过, rm 抛 ENOENT (目标本体已消失) → missing, 不中断
 *   Output { removed: ['/w/zeta/node_modules'], missing: ['/w/bare/node_modules'], failed: [...] }
 *          (aborted 缺省; 若 /w/zeta 被换成符号链接, 则首条即中止, 输出只含 aborted)
 */
export async function removeTargets(
  targets: string[],
  options: RemovalOptions,
): Promise<RemovalResult> {
  const result: RemovalResult = { removed: [], missing: [], failed: [] };
  // 防 JS 调用方漏传选项: 无信任根即无可信复核, 一律中止 (保守)
  const roots = options?.roots ?? [];

  for (const target of targets) {
    const root = roots.find((candidate) => isUnder(candidate, target));
    if (root === undefined) {
      result.aborted = {
        target,
        reason: `安全复核失败 (目标不在任何 roots 之下): ${target}`,
      };
      break;
    }

    // 复核紧跟删除: 尽可能压缩两者之间的替换窗口
    const finding = await reviewComponents(componentChain(root, target));
    if (finding !== null) {
      if (finding.kind === 'vanished') {
        // 组件消失 ≠ 目标消失 (可能只是被 mv 走): 归 missing 会伪报成功, 必须交回人工复查
        result.failed.push({
          target,
          error: describeVanishedReview(target, finding.path),
        });
        continue;
      }
      if (finding.kind === 'unsafe') {
        result.aborted = {
          target,
          reason: `安全复核失败 (路径组件被替换): ${finding.path}`,
        };
        break;
      }
      // 复核不可达但无替换证据: 只拒该条, 不牵连整批
      result.failed.push({
        target,
        error: describeReviewError(target, finding.path, finding.error),
      });
      continue;
    }

    try {
      await rm(target, { recursive: true, force: false });
      result.removed.push(target);
    } catch (error) {
      if ((error as FsError | null)?.code === 'ENOENT') {
        result.missing.push(target);
        continue;
      }
      result.failed.push({
        target,
        error: describeRemovalError(target, error),
      });
    }
  }

  return result;
}
