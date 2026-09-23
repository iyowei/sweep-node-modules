/**
 * 配置定位与装载: 三级覆盖 (旗标 > 环境变量 > 平台默认) 与三态装载 (ok / absent / 损坏)。
 * 平台 / 环境变量表 / 家目录均可注入, 供测试在任意宿主上跑平台矩阵 (设计: 分册「配置与初始化」)。
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

export interface Config {
  /** 扫描根, 任意多个 */
  roots: string[];
  /** 排除名单: 从根到命中点的任意一级目录名命中即跳过 */
  exclude: string[];
  /** 包含名单 (白名单): 从根到 node_modules 的任意一级目录名命中才纳入; 空数组 = 不过滤 */
  include: string[];
}

/** 配置路径来源 */
export type ConfigSource = 'flag' | 'env' | 'platform-default';

/** 环境变量表 (注入; 生产默认 process.env) */
export type EnvTable = Record<string, string | undefined>;

export interface ResolveConfigPathOptions {
  /** `--config` 旗标值, 最高优先级 */
  flag?: string;
  /** 平台标识, 默认 process.platform; 测试注入 'win32' 等 */
  platform?: string;
  /** 家目录, 默认 os.homedir() */
  homedir?: string;
  /** 环境变量表, 默认 process.env; 承载 SWEEP_NM_CONFIG 与 win32 的 APPDATA / USERPROFILE */
  env?: EnvTable;
}

export interface ResolvedConfigPath {
  /** 配置文件路径 (旗标 / 环境变量值原样透传, 平台默认按目标平台拼装) */
  path: string;
  /** 命中来源, 供调用方日志与分流 */
  source: ConfigSource;
}

export type LoadConfigResult =
  { state: 'ok'; config: Config } | { state: 'absent' };

/**
 * 平台默认配置路径 (按其目标平台拼装, 与宿主平台无关):
 * - win32: `%APPDATA%\sweep-node-modules\config.json`, APPDATA 缺失时以 `USERPROFILE\AppData\Roaming` 兜底, 再缺则退到注入的家目录;
 * - 其余 (macOS / Linux): `~/.config/sweep-node-modules/config.json`。
 */
function platformDefaultPath(
  platform: string,
  env: EnvTable,
  home: string,
): string {
  if (platform === 'win32') {
    const roaming =
      env.APPDATA || win32.join(env.USERPROFILE || home, 'AppData', 'Roaming');
    return win32.join(roaming, 'sweep-node-modules', 'config.json');
  }
  return posix.join(home, '.config', 'sweep-node-modules', 'config.json');
}

/**
 * 解析配置路径: 按 `--config` 旗标 > 环境变量 SWEEP_NM_CONFIG > 平台默认 的顺序取首个可用来源。
 *
 * ### 数据追踪示例
 * ```text
 * Input（真实 Payload）
 *   options = { flag: undefined, env: { SWEEP_NM_CONFIG: '/env/config.json' }, platform: 'win32', homedir: 'C:\\Users\\u' }
 *
 * 步骤 1：旗标缺失, 环境变量命中
 *   path = '/env/config.json'
 *   source = 'env'
 *
 * Output（数据契约）
 *   return { path: '/env/config.json', source: 'env' }
 * ```
 */
export function resolveConfigPath(
  options: ResolveConfigPathOptions,
): ResolvedConfigPath {
  if (options.flag) {
    return { path: options.flag, source: 'flag' };
  }

  const env = options.env ?? process.env;
  if (env.SWEEP_NM_CONFIG) {
    return { path: env.SWEEP_NM_CONFIG, source: 'env' };
  }

  const platform = options.platform ?? process.platform;
  const home = options.homedir ?? homedir();
  return {
    path: platformDefaultPath(platform, env, home),
    source: 'platform-default',
  };
}

/** 值的实际类型描述 (供逐字段报错文案): 缺失 / null / array / typeof */
function describeActual(value: unknown): string {
  if (value === undefined) return '缺失';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * 单字段形状校验: 字段须为字符串数组, 返回首个错误原因; 通过返回 null。
 * optional 为 true 时字段缺省放行 (由调用方补默认值), 出现但类型不符仍报错。
 */
function fieldError(
  container: Record<string, unknown>,
  field: string,
  optional: boolean,
): string | null {
  const value = container[field];
  if (value === undefined) {
    return optional ? null : `${field} 应为字符串数组 (实际: 缺失)`;
  }
  if (!Array.isArray(value)) {
    return `${field} 应为字符串数组 (实际: ${describeActual(value)})`;
  }
  const badIndex = value.findIndex((item) => typeof item !== 'string');
  if (badIndex !== -1) {
    return `${field} 第 ${badIndex + 1} 项应为字符串 (实际: ${describeActual(value[badIndex])})`;
  }
  return null;
}

/**
 * 配置形状校验 (最小口径, 只校验类型不校验语义): 顶层须为非数组对象;
 * roots 必填, exclude / include 均可缺省 (视为 []); 返回首个错误原因 (逐字段具体), 通过返回 null。
 */
function shapeError(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `顶层应为对象 (实际: ${describeActual(value)})`;
  }
  const candidate = value as Record<string, unknown>;
  const rootsError = fieldError(candidate, 'roots', false);
  if (rootsError !== null) return rootsError;
  const excludeError = fieldError(candidate, 'exclude', true);
  if (excludeError !== null) return excludeError;
  return fieldError(candidate, 'include', true);
}

/**
 * 装载配置: 文件缺失是正常状态 (absent), 供 init 向导分流, 不作为错误;
 * 损坏 (JSON 解析失败 / 形状不符) 与读取失败一律抛出含文件路径的明确错误。
 *
 * ### 数据追踪示例
 * ```text
 * Input（真实 Payload）
 *   path = '/Users/iyowei/.config/sweep-node-modules/config.json'
 *
 * 步骤 1：读文件
 *   text = '{"roots":["/a"],"exclude":["x"]}'
 *   *(ENOENT 时提前返回 { state: 'absent' }, 其余读取失败立即抛错)*
 *
 * 步骤 2：JSON 解析 + 形状校验 (roots 须为字符串数组, exclude / include 缺省视为 [])
 *   data = { roots: ['/a'], exclude: ['x'] }
 *
 * Output（数据契约）
 *   return { state: 'ok', config: { roots: ['/a'], exclude: ['x'], include: [] } }
 * ```
 */
export async function loadConfig(path: string): Promise<LoadConfigResult> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT')
      return { state: 'absent' };
    throw new Error(`配置读取失败 (${path}): ${(error as Error).message}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `配置损坏 (${path}): JSON 解析失败: ${(error as Error).message}`,
    );
  }

  const error = shapeError(data);
  if (error !== null) {
    throw new Error(`配置损坏 (${path}): ${error}`);
  }

  // 形状已保证: roots 为字符串数组, exclude / include 缺省补空数组
  const raw = data as {
    roots: string[];
    exclude?: string[];
    include?: string[];
  };
  return {
    state: 'ok',
    config: {
      roots: raw.roots,
      exclude: raw.exclude ?? [],
      include: raw.include ?? [],
    },
  };
}

/**
 * 装载已解析路径的配置: 显式来源 (--config 旗标 / SWEEP_NM_CONFIG) 指向的文件不存在时抛错,
 * 防打错的路径被静默降级为「配置缺失」而回退扫 cwd (配 --yes 会删错地方);
 * 平台默认来源保留软行为, absent 交上层走向导 / cwd 回退。
 * 须在 scan 之前调用, 保证显式路径写错时不进入扫描与删除。
 */
export async function loadResolvedConfig(
  resolved: ResolvedConfigPath,
): Promise<LoadConfigResult> {
  const result = await loadConfig(resolved.path);
  if (result.state === 'absent' && resolved.source !== 'platform-default') {
    throw new Error(`配置不存在 (${resolved.path}), 请检查路径`);
  }
  return result;
}

/** 合并名单 (排除与包含共用): 配置名单在前、命令行追加在后, 跨来源去重 (保留首见顺序) */
export function mergeNames(
  configNames: string[],
  cliNames: string[],
): string[] {
  return [...new Set([...configNames, ...cliNames])];
}
