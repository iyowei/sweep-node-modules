/**
 * 候选 C: 有界并发遍历。语义与候选 A (scan-prune) 逐条对齐, 差异只在遍历的并行度。
 *
 * 并发模型: 每个根一个「栈 + 在飞计数」的协作式工作池。
 *   - 待遍历目录压在显式栈上 (数组 pop, O(1)), 无递归, 故 200 层深嵌套不耗栈;
 *   - 池内同时在飞的任务数硬上限为 CONCURRENCY, 由 pump() 独占地补齐空位,
 *     目录发现只入栈、不就地展开, 杜绝「对子树无界并发」的 promise 爆炸;
 *   - 任务完成时递减计数并再补位; 计数恒等于「栈深 + 在飞」, 归零即本轮结束。
 *
 * 与候选 A 相同的部分: 命中 node_modules 即记录并剪枝; exclude / include 与 .git 在进入目录时判定
 * (include 命中那一级起, 整棵子树随栈上携带的标记一路继承); 符号链接不跟进 (Dirent 为 lstat 语义);
 * 命中按 target 的 realpath 去重键去重 (target 保留调用方拼写); 结尾统一按 target 升序排序后再输出,
 * 与并发完成次序无关, 输出保持确定性。
 *
 * 去重键与删除安全闸同源: 取自 guard 的 dedupeKey (win32 折叠大小写), 使 scan 判「两条」与
 * guard 判「重复」不再打架 (大小写双写时 guard 曾逐条拒删, 文案误导)。
 *
 * 根预检两道: realpath 失败按错误码分流病因 (不存在 / 权限不足 / 不是目录 / 其他); 成功后补一次
 * 类型判定, 因 realpath 只解析不校验类型 —— 根指向普通文件时会成功返回, 不拦则会由 readdir 的
 * ENOTDIR 落进「目录不可读」, 诱导用户去查权限。
 *
 * 名单反馈通道 (候选 A 无此字段): 逐名统计「因该名跳过的子树数」(exclude) 与「命中该名的子树数」
 * (include), 未命中的名字以 0 保留在列, 顺序同输入名单 — 供破坏性动作在名字打错 / 大小写不符时
 * 仍能提示「这条名单没生效」; 白名单零命中的后果更重 (筛选结果为空), 同款通道更不可缺。
 * 计数点在各名单的判定处, 故 node_modules 命中优先、根自身同名均不计入 (与既有裁决一致);
 * include 的计数点即「该子树由未纳入翻为已纳入」的那一级 (更深层的同名不再重复计), 且该判定
 * 独立于 exclude 优先: 名字命中白名单即计数, 随后被 exclude 截走仍计入 (截走不等于没匹配上)。
 *
 * 已知差异 (两套尺子均不约束): warnings 次序为并发完成序, 契约不约束, 亦不等价于 A 的遍历次序。
 * 失败形态: readdir / realpath 的失败照 A 降级为告警; 其余非预期异常取首个、池排空后原样抛出,
 * 不因并发而静默丢弃 (void visit 的 unhandled rejection 陷阱)。
 *
 * 上限取值依据: 瓶颈是 readdir 的往返延迟而非 CPU (r1 实测真实工作区约 3.8 万目录 /
 * 3746ms, 折合约 98µs/目录, 远高于单次系统调用本身的耗时), 故上限的目标是「持续填满
 * I/O 队列」而非「堆更多并行」。取值经实跑校准, 数据见下方常量注释。
 */
import type { Dirent } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { type PathStyle, dedupeKey, nativeStyle } from './guard.ts';
import type { ScanHit, ScanOptions, ScanResult, Scanner } from './types.ts';

const NODE_MODULES = 'node_modules';
const GIT_DIR = '.git';

/**
 * 同时最多在飞的目录数 (readdir 并发上限)。
 * 32 为实测校准值: 真实工作区 (约 3.8 万目录) 扫描耗时自 8 → 32 明显下降
 * (min 748ms → 678~697ms), 32 起进入平台区 (32 / 64 / 128 在 5 次采样下互在噪声内,
 * 256 起回退), 故取平台起点而非更大值: 并发越大, 冷缓存与网络盘上的抖动面越宽。
 */
const CONCURRENCY = 32;

/** 待遍历目录: 绝对路径 + 自根到该目录的路径上是否已命中白名单 */
interface Pending {
  dir: string;
  included: boolean;
}

/** 按 target 码元序升序 */
function compareTarget(a: ScanHit, b: ScanHit): number {
  if (a.target < b.target) return -1;
  if (a.target > b.target) return 1;
  return 0;
}

/**
 * 根预检失败的原因分句 (不含路径): 按 realpath 的错误码分流为「不存在 / 权限不足 / 不是目录 / 其他」
 * 四类, 让用户分清该修路径还是修权限; 未识别的错误码把原码带出, 便于上报。
 */
function describeRootFailure(error: unknown): string {
  const { code } = error as { code?: string };
  switch (code) {
    case 'ENOENT':
      return '根不存在';
    case 'EACCES':
    case 'EPERM':
      return '根不可读 (权限不足)';
    case 'ENOTDIR':
      return '根不是目录';
    default:
      return `根不可用 (${code ?? 'UNKNOWN'})`;
  }
}

/**
 * 单根遍历的共享上下文: 名单判定所需的集合与计数、结果落点与路径风味。
 * 各根共用同一份 (计数与结果按根累加, 不按根重置); 打包成对象而非逐个传参, 免参数表膨胀。
 */
interface WalkContext {
  style: PathStyle;
  /** 排除名单: 名字命中即整棵子树跳过 */
  exclude: Set<string>;
  /** 排除名的跳过计数 (名字 → 次数), 未命中名同样在列 */
  excludeCounts: Map<string, number>;
  /** 包含名单 (白名单): 非空时, 路径一级都未命中的候选不记录 */
  include: Set<string>;
  /** 包含名的命中计数 (名字 → 次数), 未命中名同样在列; 命中后被 exclude 截走的同样计入 */
  includeCounts: Map<string, number>;
  /** 去重键 = target 的 realpath; 值为对外输出 (调用方按 target 升序排序后返回) */
  hits: Map<string, ScanHit>;
  /** 非致命告警 (不可读目录 / 根预检失败), 不中断扫描 */
  warnings: string[];
}

/**
 * 有界并发遍历单个根, 收集其中的 node_modules 命中。
 * 外部副作用：向传入的 hits / warnings 追加命中与告警, 并向 excludeCounts / includeCounts
 * 分别累加排除名的跳过计数与包含名的纳入计数。
 *
 * hits 以 target 的 realpath 为键去重 (键重复时先到者胜), 因此跨根本序地并发遍历会
 * 让「同一 realpath 的两个拼写」由完成次序裁定; 故各根串行推进, 与候选 A 的先到先得一致。
 */
async function walkRoot(root: string, ctx: WalkContext): Promise<void> {
  const {
    style,
    exclude,
    excludeCounts,
    include,
    includeCounts,
    hits,
    warnings,
  } = ctx;
  /** 待遍历目录栈 (LIFO 取子树局部性, pop 为 O(1)) */
  const stack: Pending[] = [{ dir: root, included: include.size === 0 }];
  /** 恒等于「栈深 + 在飞」; 归零即本轮遍历结束 */
  let outstanding = 1;
  /** 当前在飞的任务数, 上限 CONCURRENCY */
  let active = 0;
  /**
   * 非预期异常的暂存位 (只留首个): readdir 与 realpath 的失败已就地降级为告警, 能走到这里的
   * 才是真异常。在飞任务不得静默丢弃异常 (void visit 会退化成 unhandled rejection), 记下待
   * 池排空后抛出, 与候选 A「遇错即中断并 reject」的失败形态对齐。
   */
  const failures: unknown[] = [];
  let resolveDrained: (() => void) | null = null;
  const drained = new Promise<void>((resolve) => {
    resolveDrained = resolve;
  });

  /** 补齐并发空位; outstanding 归零时释放等待方 */
  function pump(): void {
    while (active < CONCURRENCY && stack.length > 0) {
      const next = stack.pop()!;
      active += 1;
      void visit(next.dir, next.included);
    }
    if (outstanding === 0 && resolveDrained !== null) {
      const resolve = resolveDrained;
      resolveDrained = null;
      resolve();
    }
  }

  async function visit(dir: string, included: boolean): Promise<void> {
    try {
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
          // 命中即剪枝, 不下钻; 白名单非空且本路径一级未命中时不记录 (排除已在上级剪掉)
          if (!included) continue;
          // 去重键走 guard 同源的 dedupeKey (失败时退回字面路径)
          const target = join(dir, name);
          const key = dedupeKey(
            await realpath(target).catch(() => target),
            style,
          );
          if (!hits.has(key)) hits.set(key, { project: dir, target });
          continue;
        }
        if (name === GIT_DIR) continue;

        // 白名单判定先于 exclude (与设计「先按白名单筛出候选, 再排掉命中排除的」同序):
        // 名字确已命中白名单即计数, 随后是否被 exclude 截走不改变命中这一事实, 免得
        // 「被排除优先截走」冒充「名字没匹配上」而误报未命中。
        // 计数点仍是「该子树由未纳入翻为已纳入」的那一级 (更深层的同名不再重复计)
        const childIncluded = included || include.has(name);
        if (!included && include.has(name)) {
          includeCounts.set(name, (includeCounts.get(name) ?? 0) + 1);
        }

        if (exclude.has(name)) {
          // 每次因该名跳过一棵子树计 1, 与「任意一级命中即整棵跳过」同一判定点
          excludeCounts.set(name, (excludeCounts.get(name) ?? 0) + 1);
          continue;
        }

        // 只入栈, 由 pump 统一分配并发额度; 就地展开会退化为无界递归并发
        stack.push({ dir: join(dir, name), included: childIncluded });
        outstanding += 1;
      }
    } catch (error) {
      // 取首个异常为准 (对齐 A 的遇错即中断), 抛点推迟到池排空之后
      if (failures.length === 0) failures.push(error);
    } finally {
      active -= 1;
      outstanding -= 1;
      pump();
    }
  }

  pump();
  await drained;
  if (failures.length > 0) throw failures[0];
}

export function createParallelScanner(): Scanner {
  return {
    name: 'parallel',
    /**
     * 遍历各根, 收集直接包含 node_modules 的项目目录。
     * 外部副作用：只读文件系统 (readdir / realpath), 不写入。
     *
     * ### 数据追踪示例
     *
     * ```text
     * Input (roots = ['/w'], exclude = ['container'], include = [])
     *   磁盘树 = /w/container/beta/node_modules, /w/alpha/node_modules/dep/node_modules
     *
     * 步骤 1: 根按 realpath 去重 (重复根、嵌套根只遍历一次)
     *   待遍历根 = ['/w']
     *
     * 步骤 2: 每根一个有界并发池 (并发上限见 CONCURRENCY) 下探, 进入目录时判定 exclude / include 与 .git
     *   /w/container -> 名字命中 exclude, 整棵子树跳过
     *   /w/alpha -> 见 node_modules, 记录后剪枝 (内层 dep/node_modules 不再下探)
     *
     * 步骤 3: 按 realpath 去重后按 target 升序排序 (与并发完成次序解耦)
     *
     * Output
     *   hits = [{ project: '/w/alpha', target: '/w/alpha/node_modules' }]
     *   warnings = []  // 不可读 / 不存在的路径、根预检失败按病因分流, 在此逐条累积, 不中断
     *   excludeMatches = [{ name: 'container', hits: 1 }]  // 未命中名同样在列, hits 为 0
     *   includeMatches = []  // 白名单为空时无条目可报 (有名字则同样逐名在列)
     * ```
     */
    async scan(options: ScanOptions): Promise<ScanResult> {
      const warnings: string[] = [];
      const exclude = new Set(options.exclude);
      /** 每个 exclude 名一条计数, 未命中的名字预置 0 以保证仍在列; 按名计数, 与遍历次序无关 */
      const excludeCounts = new Map<string, number>();
      for (const name of options.exclude) {
        if (!excludeCounts.has(name)) excludeCounts.set(name, 0);
      }
      const include = new Set(options.include);
      /** 每个 include 名一条计数, 未命中的名字同样预置 0 留在列 (含义同 excludeCounts) */
      const includeCounts = new Map<string, number>();
      for (const name of options.include) {
        if (!includeCounts.has(name)) includeCounts.set(name, 0);
      }
      /** 去重键 = target 的 realpath; 值为对外输出 (target 保留调用方拼写, 不被 realpath 改写) */
      const hitsByRealTarget = new Map<string, ScanHit>();

      // 根去重: 同一去重键只遍历一次; 预检失败的根按病因分流文案记告警后跳过
      const style = nativeStyle();
      const seenRoots = new Set<string>();
      const roots: string[] = [];
      for (const root of options.roots) {
        let key: string;
        try {
          // realpath 只解析不校验类型, 故随后补一次类型判定 (根指向文件 → 根不是目录)
          const resolved = await realpath(root);
          if (!(await stat(resolved)).isDirectory()) {
            warnings.push(`根不是目录, 已跳过: ${root}`);
            continue;
          }
          key = dedupeKey(resolved, style);
        } catch (error) {
          warnings.push(`${describeRootFailure(error)}, 已跳过: ${root}`);
          continue;
        }
        if (seenRoots.has(key)) continue;
        seenRoots.add(key);
        roots.push(root);
      }

      const context: WalkContext = {
        style,
        exclude,
        excludeCounts,
        include,
        includeCounts,
        hits: hitsByRealTarget,
        warnings,
      };
      for (const root of roots) {
        await walkRoot(root, context);
      }

      const hits = [...hitsByRealTarget.values()].sort(compareTarget);
      // 顺序取自输入名单: 未命中的名字同样在列 (hits 0), 供调用方提示「这条名单没生效」
      const excludeMatches = options.exclude.map((name) => ({
        name,
        hits: excludeCounts.get(name) ?? 0,
      }));
      const includeMatches = options.include.map((name) => ({
        name,
        hits: includeCounts.get(name) ?? 0,
      }));
      return { hits, warnings, excludeMatches, includeMatches };
    },
  };
}
