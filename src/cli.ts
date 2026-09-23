/**
 * 入口编排: 参数解析 → 配置定位与装载 (缺失按交互与否分流) → 扫描 → 体积 → 预览渲染
 * → (`--yes`) 安全闸校验 → 删除 → 执行报告。业务全在模块内, 本层只做接线与退出码。
 * 权威: docs/designs/cli-surface.md (命令面 / 退出码) 与 config-and-initialization.md。
 */
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname } from 'node:path';

import {
  type Config,
  type ResolvedConfigPath,
  loadResolvedConfig,
  mergeExcludes,
  resolveConfigPath,
} from './config.ts';
import { type RemovalResult, removeTargets } from './delete.ts';
import { validateTargets } from './guard.ts';
import { type InitResult, createReadlineIO, runInit } from './init.ts';
import { BAR_BLOCK, type RenderEntry, paint, render } from './render.ts';
import { writeTextFile } from './runtime.ts';
import { createScanner } from './scan.ts';
import { createSizer } from './size.ts';
import type { ScanHit, ScanResult, SizeResult } from './types.ts';

/** 帮助页命令列宽度 (元变量取 ASCII, 免去全角宽度换算) */
const COMMAND_COLUMN = 25;

interface CliOptions {
  /** 子命令: 缺省为清理流程, init 只跑向导 */
  command: 'sweep' | 'init';
  /** 执行删除 (缺省为预览) */
  yes: boolean;
  /** `--exclude` 可重复, 与配置名单合并 */
  exclude: string[];
  /** `--config` 旗标值 (配置路径的最高优先级来源) */
  config?: string;
  help: boolean;
}

type ParseOutcome =
  { ok: true; options: CliOptions } | { ok: false; message: string };

/**
 * 解析参数: `--yes` / `--exclude <name>` / `--config <path>` / `--help` 与 `init` 子命令;
 * 未知参数、旗标缺值、多余位置参数一律判错 (调用方落退出码 1)。
 *
 * ### 数据追踪示例
 * ```text
 * Input（真实 Payload）
 *   argv = ['--exclude', 'my-kits', '--yes']
 *
 * 步骤 1：逐项识别
 *   --exclude 收值 'my-kits'; --yes 置位; 无位置参数
 *
 * Output（数据契约）
 *   return { ok: true, options: { command: 'sweep', yes: true, exclude: ['my-kits'], help: false } }
 * ```
 */
function parseArgs(argv: string[]): ParseOutcome {
  const options: CliOptions = {
    command: 'sweep',
    yes: false,
    exclude: [],
    help: false,
  };
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    // 索引由循环条件保证在界内, 此判仅为 noUncheckedIndexedAccess 的类型收窄
    if (arg === undefined) continue;
    if (arg === '--yes') {
      options.yes = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--exclude' || arg === '--config') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) {
        return { ok: false, message: `参数 ${arg} 缺少取值` };
      }
      if (arg === '--exclude') options.exclude.push(value);
      else options.config = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) return { ok: false, message: `未知参数: ${arg}` };
    positionals.push(arg);
  }

  const [only] = positionals;
  if (positionals.length > 1 || (only !== undefined && only !== 'init')) {
    return { ok: false, message: `未知参数: ${positionals.join(' ')}` };
  }
  if (only === 'init') options.command = 'init';
  return { ok: true, options };
}

/** 着色开关: 仅标准输出为 TTY 且未设 NO_COLOR (空值按未设处理) */
function colorEnabled(): boolean {
  return process.stdout.isTTY === true && !process.env.NO_COLOR;
}

/** 交互判定: stdin 与 stdout 均为 TTY 才进向导; 管道 / 重定向一律回退, 不阻塞脚本与定时任务 */
function interactive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/** 清单主体走 stdout */
function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** 诊断信息 (错误 / 告警) 走 stderr, 不污染清单输出; TTY 下带红色 ✗ 前缀, 非 TTY 零 ANSI 纯文本 */
function warn(line: string, color: boolean): void {
  process.stderr.write(
    color ? `${paint('✗', '31', color)} ${line}\n` : `${line}\n`,
  );
}

/** 非诊断性提示 (回退说明 / 拒绝详情) 走 stderr 但不加标记, 与告警区分层级 */
function notice(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** 平台默认配置路径 (帮助里的「默认配置位置」; 屏蔽环境变量, 只答平台默认) */
function defaultConfigPath(): string {
  return resolveConfigPath({ env: {} }).path;
}

/** 帮助: 命令面速查 + 关键口径 (简洁; 顶栏着色, 降级纯文本) */
function helpText(color: boolean): string {
  const row = (command: string, desc: string): string =>
    `  ${command.padEnd(COMMAND_COLUMN)}  ${desc}`;
  return [
    `${paint(`${BAR_BLOCK} SWEEP-NM`, '1;7', color)}  工作区 node_modules 清理`,
    '',
    row('sweep-nm', '预览: 清单 + 体积 + 合计, 零副作用'),
    row('sweep-nm --yes', '执行删除'),
    row('sweep-nm --exclude <name>', '临时追加排除 (可重复, 与配置合并)'),
    row('sweep-nm --config <path>', '指定配置文件 (优先于 SWEEP_NM_CONFIG)'),
    row('sweep-nm init', '初始化向导: 交互生成配置文件'),
    row('sweep-nm --help', '帮助'),
    '',
    '说明:',
    '  --exclude 按目录名精确匹配 (区分大小写), 从根到命中点的任意一级命中即跳过',
    `  默认配置位置 (平台自适应): ${defaultConfigPath()}`,
    '',
    '退出码: 0 成功 (含预览与空结果); 1 删除失败 / 配置损坏 / 参数错误',
  ].join('\n');
}

/**
 * 跑初始化向导 (交互全在 init 模块, 本层只注入 readline 与落盘通道)。
 * 落盘前先建目标目录: 平台默认配置路径首跑时父目录尚不存在 (如 ~/.config/sweep-node-modules)。
 */
function runWizard(configPath: string): Promise<InitResult> {
  return runInit({
    configPath,
    async fileExists(path) {
      try {
        await lstat(path);
        return true;
      } catch {
        return false;
      }
    },
    async writeFile(path, text) {
      await mkdir(dirname(path), { recursive: true });
      await writeTextFile(path, text);
    },
    io: createReadlineIO(),
  });
}

/**
 * 装载结果: 配置来源决定本轮语义 ——
 * file = 既有配置文件 (正常走预览 / 执行); wizard = 本轮向导刚生成 (本轮强制预览);
 * fallback = 无配置的 cwd 回退态 (不承载 --yes 的执行语义)。
 */
interface ResolvedConfig {
  config: Config;
  source: 'file' | 'wizard' | 'fallback';
}

/**
 * 装载配置 (须在 scan 之前, 显式路径写错时不得进入扫描与删除);
 * 缺失 (absent) 只可能来自平台默认来源 (旗标 / 环境变量指向不存在文件由 loadResolvedConfig 抛错),
 * 此时按交互与否分流 (设计: config-and-initialization.md「配置初始化模型」):
 * TTY 进向导, 完成后继续本次预览; 非 TTY 回退「以当前目录为根」并标记回退态, 由调用方分流提示与拒绝。
 *
 * ### 数据追踪示例
 * ```text
 * Input（真实 Payload）
 *   resolved = { path: '/Users/iyowei/.config/sweep-node-modules/config.json', source: 'platform-default' }
 *
 * 步骤 1：装载 (显式来源不存在即抛错 `配置不存在`, 平台默认来源保留软行为)
 *   loadResolvedConfig → { state: 'absent' }
 *
 * 步骤 2：非交互 → 以当前目录为根并标记回退态
 *   return { config: { roots: ['/Users/iyowei/workspace/development'], exclude: [] }, fallback: true }
 *
 * Output（数据契约）
 *   return ResolvedConfig (向导取消 / 拒绝覆盖时 return null, 本次不启动清理)
 * ```
 */
async function resolveConfig(
  resolved: ResolvedConfigPath,
): Promise<ResolvedConfig | null> {
  const loaded = await loadResolvedConfig(resolved);
  if (loaded.state === 'ok') return { config: loaded.config, source: 'file' };

  if (!interactive())
    return {
      config: { roots: [process.cwd()], exclude: [] },
      source: 'fallback',
    };

  const result = await runWizard(resolved.path);
  if (result.state === 'written' && result.config !== undefined) {
    return { config: result.config, source: 'wizard' };
  }

  print('配置未写入, 本次未执行清理');
  return null;
}

/** 单条删除结果 (对应 render 条目的 ok / error 字段) */
interface RemovalOutcome {
  ok: boolean;
  error?: string;
}

/** 整批中止时给未被删除条目的统一说明 (与普通删除失败区分: 这些目标根本没被动过) */
const ABORTED_HINT = '整批中止, 未执行删除';

/**
 * 删除复核用的信任根: 须与 target 同源拼写 (target 已由 guard realpath 化; 见 delete.ts 头的
 * 调用方约定)。realpath 失败的根保留原拼写 —— 该根下不可能有已通过 guard 的目标, 不会误伤。
 */
async function realRoots(roots: string[]): Promise<string[]> {
  return Promise.all(
    roots.map(async (root) => (await realpath(root).catch(() => null)) ?? root),
  );
}

/**
 * 把删除结果挂回清单条目, 供执行报告逐行呈现。
 * batch (实际删除批次) 与 accepted (guard 已 realpath 化) 逐位对应: guard 保输入顺序, 且整批拒绝时
 * 不会走到这里, 故不存在剔除错位; 未入批的条目 (体积未测到, 不执行删除) 一律按失败呈现并计入失败。
 *
 * ### 数据追踪示例
 * ```text
 * Input（真实 Payload）
 *   entries = [{ project: 'alpha', target: '/var/w/alpha/node_modules', bytes: 4939212390 },
 *              { project: 'locked', target: '/var/w/locked/node_modules', note: '体积统计失败: 权限不足, 无法读取' }]
 *   batch = ['/var/w/alpha/node_modules']              // 只有测到体积的进删除批次
 *   accepted = ['/private/var/w/alpha/node_modules']   // realpath 归一 (macOS /var 符号链接陷阱)
 *   removal = { removed: ['/private/var/w/alpha/node_modules'], missing: [], failed: [] }
 *
 * 步骤 1：三桶并成结果表 (键为 realpath 目标)
 *   outcomes = { '/private/var/w/alpha/node_modules' → { ok: true } }
 *
 * 步骤 2：逐位回挂 (accepted[0] 对应 batch[0]), 未入批条目落回默认
 *   report = [alpha { ok: true }, locked { ok: false }]
 *
 * Output（数据契约）
 *   return 执行报告条目 (保清单顺序)
 * ```
 */
function withOutcomes(
  entries: RenderEntry[],
  batch: string[],
  accepted: string[],
  removal: RemovalResult,
): RenderEntry[] {
  const outcomes = new Map<string, RemovalOutcome>();
  for (const target of removal.removed) outcomes.set(target, { ok: true });
  // missing = 校验与删除之间目标已消失 (TOCTOU): 目标已达成的语义, 计成功侧
  for (const target of removal.missing) outcomes.set(target, { ok: true });
  for (const item of removal.failed)
    outcomes.set(item.target, { ok: false, error: item.error });

  const byTarget = new Map<string, RemovalOutcome>();
  for (const [index, target] of batch.entries()) {
    const real = accepted[index];
    const outcome = real === undefined ? undefined : outcomes.get(real);
    if (outcome !== undefined) byTarget.set(target, outcome);
  }

  // 未入批 (体积未测到) 与整批中止的条目一律按失败呈现; 中止时附统一说明, 供与普通删除失败区分
  const fallback: RemovalOutcome =
    removal.aborted === undefined
      ? { ok: false }
      : { ok: false, error: ABORTED_HINT };
  return entries.map((entry) => ({
    ...entry,
    ...(byTarget.get(entry.target) ?? fallback),
  }));
}

/** 排除名单命中统计 (字段可选, 胜出门面提供) */
type ExcludeMatches = NonNullable<ScanResult['excludeMatches']>;

/**
 * 排除名反馈 (破坏性动作的保命名单通道, 见 types.ts「excludeMatches」):
 * 未命中的名字一律告警 (名字打错不得静默); 命中的只在真终端补一行确认, 非 TTY 下不增噪音。
 */
function reportExcludeMatches(
  matches: ExcludeMatches | undefined,
  color: boolean,
): void {
  if (matches === undefined) return;
  const tty = process.stderr.isTTY === true;
  for (const item of matches) {
    if (item.hits === 0)
      warn(`排除名未匹配到任何目录: ${item.name} (按目录名精确匹配)`, color);
    else if (tty) notice(`排除生效: ${item.name} (${item.hits} 处)`);
  }
}

/**
 * 清单条目: 已测到体积的 (bytes) + 存在但测不到的 (note 占位, bytes 留空, 不参与删除)。
 * 「不存在」类 (既未测到也不在 unmeasured, size 已告警) 不入清单; project 取目录名 (scan 给的是目录路径)。
 */
function toEntries(hits: ScanHit[], sizeResult: SizeResult): RenderEntry[] {
  const bytesOf = new Map<string, number>(
    sizeResult.entries.map((entry): [string, number] => [
      entry.target,
      entry.bytes,
    ]),
  );
  const reasonOf = new Map<string, string>(
    sizeResult.unmeasured.map((item): [string, string] => [
      item.target,
      item.reason,
    ]),
  );

  const entries: RenderEntry[] = [];
  for (const hit of hits) {
    const project = basename(hit.project);
    const bytes = bytesOf.get(hit.target);
    if (bytes !== undefined) {
      entries.push({ project, target: hit.target, bytes });
      continue;
    }
    const reason = reasonOf.get(hit.target);
    if (reason !== undefined) {
      entries.push({
        project,
        target: hit.target,
        note: `体积统计失败: ${reason}`,
      });
    }
  }
  return entries;
}

/**
 * 清理流程: 扫描 → 体积 → 预览; `--yes` 时经安全闸校验后删除并出执行报告。
 * 退出码: 预览 / 空结果 / 仅 missing 记 0; 安全闸整批拒绝 / 删除复核整批中止 / 删除有失败 /
 * 有未测到体积的目标 记 1 (设计: cli-surface.md「退出码」)。
 *
 * ### 数据追踪示例
 * ```text
 * Input（真实 Payload）
 *   config = { roots: ['/w'], exclude: [] }
 *   options = { command: 'sweep', yes: true, exclude: [], help: false }
 *   磁盘树 = /w/alpha/node_modules (4.6 GB, 可读), /w/locked/node_modules (权限不足, 测不到体积)
 *
 * 步骤 1：扫描 + 实测体积 (测不到的以占位行上清单, 不再静默移出)
 *   entries = [alpha 4.6 GB, locked '?' + note 体积统计失败]
 *
 * 步骤 2：删除批次只含测到体积的条目 → 安全闸校验
 *   accepted = ['/w/alpha/node_modules'], rejected = []
 *
 * 步骤 3：删除并回挂结果 (未入批的 locked 落 ok: false)
 *   report = [alpha ✓, locked ✗], releasedBytes = 4939212390
 *
 * Output（数据契约）
 *   print 执行报告 (render mode: 'execute'); return 1 (locked 计入失败)
 * ```
 */
async function sweep(
  config: Config,
  options: CliOptions,
  color: boolean,
): Promise<number> {
  const roots = config.roots;
  const exclude = mergeExcludes(config.exclude, options.exclude);

  const scanResult = await createScanner().scan({ roots, exclude });
  for (const warning of scanResult.warnings) warn(warning, color);
  reportExcludeMatches(scanResult.excludeMatches, color);

  const sizeResult = await createSizer().measure(
    scanResult.hits.map((hit) => hit.target),
  );
  for (const warning of sizeResult.warnings) warn(warning, color);

  const entries = toEntries(scanResult.hits, sizeResult);
  const home = homedir();
  if (!options.yes) {
    print(render({ mode: 'preview', roots, entries, color, home }));
    return 0;
  }

  // 删除批次 = 测到体积的条目: 体积测不到的只上清单占位行, 一律不执行删除
  const batch = entries
    .filter((entry) => entry.bytes !== undefined)
    .map((entry) => entry.target);

  // 安全闸: 任一目标被拒即整批拒绝, 不做任何删除 (保守优先; 设计: deletion-guard.md)
  const { accepted, rejected } = await validateTargets(batch, { roots });
  if (rejected.length > 0) {
    warn(
      `整批拒绝: ${rejected.length} 个目标未通过安全闸, 未执行任何删除`,
      color,
    );
    for (const item of rejected) notice(`  ${item.target} (${item.reason})`);
    return 1;
  }

  // 删除复核的信任根须与 target 同源拼写, 否则 delete 的逐级 lstat 复核会判「不在任何 roots 之下」而整批中止
  const removal = await removeTargets(accepted, {
    roots: await realRoots(roots),
  });
  const report = withOutcomes(entries, batch, accepted, removal);
  // 释放量按成功侧条目累计 (与汇总的「成功」计数同口径); 恒提供数值, 让 0 B 与「未提供」可区分
  const releasedBytes = report.reduce(
    (total, entry) => (entry.ok === false ? total : total + (entry.bytes ?? 0)),
    0,
  );
  print(
    render({
      mode: 'execute',
      roots,
      entries: report,
      color,
      home,
      releasedBytes,
    }),
  );

  // 复核中止与逐条失败区分展示 (紧贴汇总, 便于诊断): 此时整批目标一个都没动
  if (removal.aborted !== undefined) {
    warn(`整批中止: ${removal.aborted.reason}`, color);
    notice(`  本轮未执行删除: ${batch.length} 处`);
  }

  return report.some((entry) => entry.ok === false) ? 1 : 0;
}

async function main(): Promise<number> {
  const color = colorEnabled();
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    warn(`参数错误: ${parsed.message} (用 --help 查看用法)`, color);
    return 1;
  }

  const { options } = parsed;
  if (options.help) {
    print(helpText(color));
    return 0;
  }

  try {
    // 路径与其来源一并保留: 来源决定「文件不存在」是硬错 (旗标 / 环境变量打错) 还是软态 (平台默认)
    const resolvedPath = resolveConfigPath({ flag: options.config });

    // init 子命令: 只跑向导重写配置, 不进入清理流程; 向导要逐问逐答, 无交互终端即报错退出
    if (options.command === 'init') {
      if (!interactive()) {
        warn('init 需要交互终端 (请在终端直接运行, 不要重定向或经管道)', color);
        return 1;
      }
      const result = await runWizard(resolvedPath.path);
      if (result.state === 'written') print('运行 sweep-nm 查看预览');
      else print('配置未变更');
      return 0;
    }

    const resolved = await resolveConfig(resolvedPath);
    if (resolved === null) return 0;

    // 无配置的 cwd 回退态不承载执行语义: 首次用户可能只凭一行提示就删掉整棵目录树的 node_modules
    if (resolved.source === 'fallback') {
      const roots = resolved.config.roots.join(', ');
      if (options.yes) {
        warn('拒绝执行: 当前无配置文件, --yes 不可用', color);
        notice(`  将扫的根: ${roots}`);
        notice('  先 sweep-nm init 生成配置, 或用 --config 指定配置文件');
        return 1;
      }
      notice(
        `未找到配置文件, 本次以当前目录为根: ${roots} (想固定此设置, 运行 sweep-nm init)`,
      );
    }

    // 向导刚写入配置的这一轮强制预览: 用户尚未见过任何清单, 带 --yes 也不得直删
    // (设计: config-and-initialization.md「生成后继续本次预览」)
    const freshConfig = resolved.source === 'wizard';
    if (freshConfig && options.yes) {
      notice('首次配置已生成; 本轮先预览, 复核后可再运行 --yes 执行');
    }

    return await sweep(
      resolved.config,
      freshConfig ? { ...options, yes: false } : options,
      color,
    );
  } catch (error) {
    warn(error instanceof Error ? error.message : String(error), color);
    return 1;
  }
}

process.exitCode = await main();
