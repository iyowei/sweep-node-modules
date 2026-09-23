/**
 * render 测试的共享样例数据与断言工具 (主干契约 render.test.ts 与鲁棒性套件共用)。
 * 单一事实来源: 样例改动须同步影响两支测试, 防止两处 fixture 漂移。
 */
import type { RenderEntry, RenderOptions } from './render.ts';

export const HOME = '/Users/iyowei';
/** 主根: 顶栏列根与样例目标路径共用 */
export const ROOT_DEV = `${HOME}/workspace/development`;
/** 预览入参的默认根清单 (样例目标路径与之一致) */
const ROOTS = [ROOT_DEV];
export const GIB = 1024 ** 3;
export const MIB = 1024 ** 2;

/** 档位阈值 (与实现约定的绝对初值, 改动需双方同步) */
export const TIER_BIG = GIB;
export const TIER_MID = 100 * MIB;

/** 固定样例: 覆盖大 / 中 / 小三档 + 中文项目名与中文路径 */
export const ACME_WEB: RenderEntry = {
  project: 'acme-web',
  bytes: Math.round(4.6 * GIB),
  target: `${ROOT_DEV}/acme-web/node_modules`,
};
export const DATA_PIPELINE: RenderEntry = {
  project: 'data-pipeline',
  bytes: 620 * MIB,
  target: `${ROOT_DEV}/data-pipeline/node_modules`,
};
export const DOCS_SITE: RenderEntry = {
  project: 'docs-site',
  bytes: 86 * MIB,
  target: `${ROOT_DEV}/docs-site/node_modules`,
};
export const NOTE_BOOK: RenderEntry = {
  project: '学习笔记',
  bytes: 12 * MIB,
  target: `${HOME}/笔记/学习笔记/node_modules`,
};
export const SAMPLES: RenderEntry[] = [
  ACME_WEB,
  DATA_PIPELINE,
  DOCS_SITE,
  NOTE_BOOK,
];

/** 执行模式样例: 1 处失败并附原因 */
export const RESULTS: RenderEntry[] = [
  { ...ACME_WEB, ok: true },
  { ...DATA_PIPELINE, ok: false, error: 'EACCES: permission denied' },
  { ...DOCS_SITE, ok: true },
  { ...NOTE_BOOK, ok: true },
];

/** 未测到体积的占位样例 (权限不足, 只带 note) */
export const UNMEASURED: RenderEntry = {
  project: 'locked',
  target: `${ROOT_DEV}/locked/node_modules`,
  note: '体积统计失败: 权限不足',
};

/** 需净化的样例: 项目名与路径均含控制类字符 (ESC 控制序列), 显示名与磁盘名不一致 */
export const REWRITTEN: RenderEntry = {
  project: 'esc\u001b[31mname',
  bytes: 12 * MIB,
  target: `${HOME}/笔记/esc\u001b[31mname/node_modules`,
};

export const previewOptions: RenderOptions = {
  mode: 'preview',
  roots: ROOTS,
  entries: SAMPLES,
  color: false,
  home: HOME,
};

/** 剥去 SGR 颜色码 (测试侧独立实现, 不复用实现内部) */
export const stripAnsi = (text: string): string =>
  // 有意匹配 ESC (\x1b): 剥色断言的对象就是控制字符序列本身
  // eslint-disable-next-line no-control-regex
  text.replace(/\x1b\[[0-9;]*m/g, '');

export const linesOf = (text: string): string[] => text.split('\n');

/** 清单行: 缩进开头且含缩写路径的数据行 (顶栏无缩进, 合计 / 汇总行无路径, 均自然排除) */
export const listLines = (text: string): string[] =>
  linesOf(text).filter((line) => line.startsWith('  ') && line.includes('~/'));

export const rowOf = (text: string, project: string): string => {
  const row = listLines(text).find((line) => line.includes(project));
  if (!row) throw new Error(`未找到项目行: ${project}`);
  return row;
};
