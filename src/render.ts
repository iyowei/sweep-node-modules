/**
 * 清单渲染 (纯函数, 零 IO): 入参决定全部输出; 颜色由调用方按 TTY / NO_COLOR 判定后传入;
 * 路径风味由调用方注入 (缺省平台原生), 保证同一份实现在 posix / win32 语义下均可测。
 * 视觉规范: 紧凑式 + 色块 (设计: cli-surface.md「输出规格」)。
 * 可移植性: docs/adrs/0007-platform-portability.md。
 */
import { type PathStyle, nativeStyle } from './guard.ts';

/** 顶栏命令名短变体 (设计: cli-surface.md「命令面」) */
const BANNER = 'SWEEP-NM';

/**
 * 顶栏标识块: 输出规范的一部分, 导出给 cli 等消费方复用
 * (同一视觉常量只应有一处定义, 各消费方各写一份即规范漂移)。
 */
export const BAR_BLOCK = '▍';

/** 合计块 / 空结果中性块 (render 内部使用) */
const TOTAL_BLOCK = '█';
const NEUTRAL_BLOCK = '░';

/** 缺省路径风味: 平台原生 (模块加载时定格一次, 调用期不再读环境, 保持 render 纯函数) */
const PLATFORM_STYLE = nativeStyle();

/** 档位块的中性形态: 体积测不到的条目用 (与空结果提示同族, 表示不表态) */
const NEUTRAL_TIER = { block: NEUTRAL_BLOCK, sgr: '2' };

/** 顶栏列出根路径的上限: 根数不超过此值时直接列路径 (只报数量时用户无法确认扫描范围) */
const ROOT_LIST_LIMIT = 3;

/**
 * 体积档位阈值 (绝对初值, 可调: 待真实工作区 node_modules 分布实测后按分位数重标)。
 * 大 >= 1 GiB; 中 >= 100 MiB; 小 < 100 MiB。
 */
const TIER_BIG = 1024 ** 3;
const TIER_MID = 100 * 1024 ** 2;

export interface RenderEntry {
  /** node_modules 绝对路径 */
  target: string;
  /** 字节数; undefined = 体积测不到 (体积列显示 ?, 档位块转中性, 不计入合计总量) */
  bytes?: number;
  /** 项目名 */
  project: string;
  /** 执行模式: 删除是否成功 (缺省视为成功) */
  ok?: boolean;
  /** 执行模式: 失败原因 (ok === false 时附在行尾) */
  error?: string;
  /** 行尾补充说明 (如体积统计失败原因); 与失败原因同位并置, note 在前 */
  note?: string;
}

export interface RenderOptions {
  /** 预览 (零副作用) 或执行 (逐行结果 + 汇总) */
  mode: 'preview' | 'execute';
  /** 扫描根: 仅用于顶栏计数 */
  roots: string[];
  entries: RenderEntry[];
  /** false (非 TTY / NO_COLOR) 时输出零 ANSI, 信息与行结构与着色版一致 */
  color: boolean;
  /** 家目录前缀: 命中则缩写为 ~; 缺省不缩写 (保持纯函数, 不读环境) */
  home?: string;
  /** 执行模式: 已释放的字节总量; 提供时汇总行补 "释放 X", 缺省维持原文案 */
  releasedBytes?: number;
  /** 路径风味 (分隔符与大小写敏感性): 缺省平台原生; 传入 WIN32_STYLE 可在 posix 上测 win32 语义 */
  pathStyle?: PathStyle;
  /** 运行时自述 (如 `bun 1.4.2`): 提供时接在顶栏尾部; 缺省不显示 (调用方按 TTY 决定) */
  runtime?: string;
  /** 顶栏下方的中性提示行 (如名单回执); 缺省无。走 stdout 而非 stderr: 它们是本次运行的说明, 与清单同属一次输出 */
  notes?: string[];
}

/**
 * 人类可读体积: 逐级 1024 (B / KB / MB / GB / TB), 保留 1 位小数、整数省略小数尾
 * (对齐示意里的 "4.6 GB" 与 "366 MB" 两种形态); 最小单位 B 取整。
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = -1;
  do {
    value /= 1024;
    index += 1;
  } while (value >= 1024 && index < units.length - 1);
  return `${Math.round(value * 10) / 10} ${units[index]}`;
}

/**
 * 渲染清单。
 *
 * **执行步骤**：
 * 1. 顶栏按模式与根数量成行 (根数不超过 ROOT_LIST_LIMIT 时直接列出根路径), 提供 runtime 时把运行时自述接在尾部;
 * 2. 提供 notes 时先出顶栏下方的中性提示行 (如名单回执; 空结果分支同样呈现);
 * 3. 无条目则只出中性提示行并提前返回;
 * 4. 条目按体积降序 (体积测不到的排末尾), 由当前数据的最长体积与最长项目名定列宽 (二者右 / 左对齐);
 * 5. 逐行成清单 (预览出档位块, 执行出结果标记; 体积测不到的显示 ? 与中性块), 末行出合计或汇总;
 *    合计只累加已测到的条目, 行数照常计入。
 *
 * ### 数据追踪示例
 * ```text
 * Input（真实 Payload）
 *   options.mode = 'preview', options.roots = ['/Users/iyowei/workspace/development']
 *   options.entries = [
 *     { target: '/Users/iyowei/workspace/development/docs-site/node_modules', bytes: 90177536, project: 'docs-site' },
 *     { target: '/Users/iyowei/workspace/development/acme-web/node_modules', bytes: 4939212390, project: 'acme-web' },
 *   ]
 *   options.color = false, options.home = '/Users/iyowei'
 *
 * 步骤 1：按体积降序
 *   rows = [acme-web 4939212390, docs-site 90177536]
 *
 * 步骤 2：定列宽 (按显示宽度)
 *   volumeWidth = 6 ("4.6 GB" 与 "86 MB" 取长), nameWidth = 9 ("docs-site")
 *
 * 步骤 3：成行 (档位块随档位变, 体积右对齐, 项目名左对齐, 路径缩写)
 *   body = ['  █ 4.6 GB  acme-web     ~/workspace/development/acme-web',
 *           '  ▓  86 MB  docs-site    ~/workspace/development/docs-site']
 *
 * 步骤 4：末行合计
 *   foot = '  █ 合计 2 处 · 4.6 GB   加 --yes 执行删除'
 *
 * Output（数据契约）
 *   return 多行文本 (行以 \n 分隔, 无尾换行)
 * ```
 */
export function render(options: RenderOptions): string {
  const { mode, roots, entries, color, home, releasedBytes, pathStyle } =
    options;
  const style = pathStyle ?? PLATFORM_STYLE;
  const scope =
    roots.length > 0 && roots.length <= ROOT_LIST_LIMIT
      ? `${roots.length} 个根: ${roots.map((root) => oneLine(shortenPath(root, style, home))).join(' · ')}`
      : `${roots.length} 个根`;
  const runtime = options.runtime ? ` · ${oneLine(options.runtime)}` : '';
  const head = paint(
    `${BAR_BLOCK} ${BANNER}  ${mode === 'execute' ? '执行' : '预览'} · ${scope}${runtime}`,
    '1;7',
    color,
  );
  // 顶栏下方的中性提示: 与清单同一视觉语言 (缩进 2 + 中性块), 不打断顶栏与清单的紧邻关系
  const notes = (options.notes ?? []).map(
    (note) => `  ${paint(`${NEUTRAL_BLOCK} ${oneLine(note)}`, '2', color)}`,
  );

  if (entries.length === 0) {
    return [
      head,
      ...notes,
      `  ${paint(`${NEUTRAL_BLOCK} 未发现 node_modules`, '2', color)}`,
    ].join('\n');
  }

  const rows = [...entries].sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1));
  const volumeWidth = Math.max(
    ...rows.map((row) => displayWidth(volumeOf(row))),
  );
  const nameWidth = Math.max(
    ...rows.map((row) => displayWidth(oneLine(row.project))),
  );

  const body = rows.map((row) => {
    const fail = mode === 'execute' && row.ok === false;
    const tier = row.bytes === undefined ? NEUTRAL_TIER : tierOf(row.bytes);
    const mark =
      mode === 'execute'
        ? paint(fail ? '✗' : '✓', fail ? '31' : '32', color)
        : paint(tier.block, tier.sgr, color);
    const volume = padStart(volumeOf(row), volumeWidth);
    const name = oneLine(row.project);
    const rawPath = displayPath(row.target, style, home);
    const path = oneLine(rawPath);
    // 净化改写了显示名即与磁盘名不一致: 补提示, 防用户照显示名复制路径
    const rewritten = name !== row.project || path !== rawPath;
    const tail = tailsOf(row, fail, rewritten);
    const shown = `${paint(padEnd(name, nameWidth), '1', color)}    ${paint(path, '2', color)}`;
    return `  ${mark} ${volume}  ${shown}${tail ? `  ${paint(tail, '2', color)}` : ''}`;
  });

  // 提示整段压暗, 仅 --yes 加粗 (可执行动作是这行的落点; 空格留在着色段之外, 不入色)
  const hint = [
    paint('加', '2', color),
    paint('--yes', '1', color),
    paint('执行删除', '2', color),
  ].join(' ');
  const foot =
    mode === 'execute'
      ? footExecute(rows, color, releasedBytes)
      : `  ${paint(TOTAL_BLOCK, '7', color)} ${paint(`合计 ${rows.length} 处 · ${formatBytes(sum(rows))}`, '1', color)}   ${hint}`;

  return [head, ...notes, ...body, foot].join('\n');
}

/** 执行模式末行: 成功 / 失败计数汇总 (取代预览的合计); 提供 releasedBytes 时补释放体积 */
function footExecute(
  rows: RenderEntry[],
  color: boolean,
  releasedBytes?: number,
): string {
  const failed = rows.filter((row) => row.ok === false).length;
  const released =
    releasedBytes === undefined ? '' : ` · 释放 ${formatBytes(releasedBytes)}`;
  return `  ${paint(TOTAL_BLOCK, '7', color)} ${paint(`汇总 成功 ${rows.length - failed} 处${released} · 失败 ${failed} 处`, '1', color)}`;
}

/** 体积列文本: 未测到 (bytes undefined) 用 ? 占位 (与 0 B 区分开) */
const volumeOf = (row: RenderEntry): string =>
  row.bytes === undefined ? '?' : formatBytes(row.bytes);

/** 显示名被净化改写时的行尾提示 (控制类字符剥除或空白折叠都会改写显示名, 照显示名复制路径即失效) */
const SANITIZED_NOTE = '名字已净化显示';

/**
 * 行尾补充: 净化提示 / note / 执行失败原因并置
 * (净化提示最前 —— 它关乎整行显示名的可信度, 读者须先知道;
 * note 属目标属性, 失败原因属动作结果, 依次在后)。
 */
function tailsOf(row: RenderEntry, fail: boolean, rewritten: boolean): string {
  const parts: string[] = [];
  if (rewritten) parts.push(SANITIZED_NOTE);
  if (row.note) parts.push(oneLine(row.note));
  if (fail && row.error) parts.push(oneLine(row.error));
  return parts.join('  ');
}

/** 档位: 大 (红) / 中 (黄) / 小 (青); 返回色块字符与 SGR 前景码 */
function tierOf(bytes: number): { block: string; sgr: string } {
  if (bytes >= TIER_BIG) return { block: '█', sgr: '31' };
  if (bytes >= TIER_MID) return { block: '▓', sgr: '33' };
  return { block: '▒', sgr: '36' };
}

/**
 * 着色: color 为 false 时原样返回, 即降级开关 —— false (非 TTY / NO_COLOR) 时输出退化为
 * 纯文本, 零 ANSI 转义码, 且行结构、列对齐与全部信息与着色版逐字等价 (仅差颜色码)。
 * 导出给 cli 复用, 使整个 CLI 的降级契约同源。
 */
export const paint = (text: string, sgr: string, color: boolean): string =>
  color ? `\u001b[${sgr}m${text}\u001b[0m` : text;

/** 合计: 只累加已测到的条目 (未测到按 0 计, 不贡献总量; 全未测到时即 0 B) */
const sum = (rows: RenderEntry[]): number =>
  rows.reduce((total, row) => total + (row.bytes ?? 0), 0);

/** 大小写折叠: 仅 win32 生效 (与 guard 的折叠约定同源, 保证两处对同一 PathStyle 的解读一致) */
const fold = (text: string, style: PathStyle): string =>
  style.caseInsensitive ? text.toLowerCase() : text;

/** 家目录缩写: 命中前缀 (含家目录本身) 才替换为 ~; 前缀按风味分隔符拼装, 比较按风味折叠 */
function shortenPath(path: string, style: PathStyle, home?: string): string {
  if (!home) return path;
  if (fold(path, style) === fold(home, style)) return '~';
  const prefix = `${home}${style.ops.sep}`;
  return fold(path, style).startsWith(fold(prefix, style))
    ? `~${path.slice(home.length)}`
    : path;
}

/**
 * 家目录缩写 (平台原生风味): 与清单渲染内部同源, 导出供向导等复用。
 * home 缺省时不缩写 (保持纯函数, 不读环境)。
 */
export function shortenHome(path: string, home?: string): string {
  return shortenPath(path, PLATFORM_STYLE, home);
}

/**
 * 展示路径: 先剥掉尾部 node_modules (每行恒定的后缀, 与左侧项目名重复, 属噪声;
 * 示意里展示的是项目目录), 再做家目录缩写。后缀与前缀均按风味分隔符拼装。
 */
function displayPath(target: string, style: PathStyle, home?: string): string {
  const suffix = `${style.ops.sep}node_modules`;
  const dir = fold(target, style).endsWith(fold(suffix, style))
    ? target.slice(0, -suffix.length)
    : target;
  return shortenPath(dir, style, home);
}

/**
 * 净化行内文本 (项目名 / 路径 / note / 错误原因一律经此):
 * 先剥控制类字符 (C0 含 ESC / DEL、C1、bidi 控制含可视觉反转路径的 RLO、零宽与 BOM) ——
 * 既守住非 TTY 零 ANSI 强契约, 也防终端控制序列注入与显示名伪造; 制表与换行留给下一步。
 * 再把剩余空白 (含换行) 折成单空格, 使任意输入都压成一行, 不撑破清单行结构。
 * 列宽计算与渲染必须用同一份净化结果, 否则补位错位。
 */
const oneLine = (text: string): string =>
  text
    .replace(
      // \u6709\u610f\u5339\u914d\u63a7\u5236\u5b57\u7b26 (C0 / DEL / C1 / bidi / \u96f6\u5bbd\u4e0e BOM): \u5265\u9664\u5373\u672c\u51fd\u6570\u7684\u804c\u8d23, \u975e\u8bef\u7528
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();

/** 按显示宽度左对齐 (补齐尾部空格) */
const padEnd = (text: string, width: number): string =>
  text + ' '.repeat(Math.max(0, width - displayWidth(text)));

/** 按显示宽度右对齐 (补齐前导空格) */
const padStart = (text: string, width: number): string =>
  ' '.repeat(Math.max(0, width - displayWidth(text))) + text;

/**
 * 终端显示列宽: 汉字 / 全角标点 / 韩文按 2 列计, 其余按 1 列。
 * 只覆盖常见全角区间, 不求穷尽 East Asian Width 全表 (紧凑对齐够用即止)。
 */
function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    width += isFullWidth(code) ? 2 : 1;
  }
  return width;
}

function isFullWidth(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  );
}
