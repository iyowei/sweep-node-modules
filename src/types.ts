/**
 * 扫描契约: 候选实现共享的接口与返回形态 (设计: 分册「扫描与体积」)。
 * 候选差异只允许存在于接口内部, 调用方无感。
 */

export interface ScanOptions {
  /** 扫描根 (调用方保证为绝对路径) */
  roots: string[];
  /** 排除名单: 目录名; 从根到命中点的任意一级命中即整棵子树跳过 */
  exclude: string[];
}

export interface ScanHit {
  /** 直接包含 node_modules 的项目目录 */
  project: string;
  /** node_modules 绝对路径 */
  target: string;
}

export interface ScanResult {
  /** 命中清单: 按 target 排序, 已按 realpath 去重 */
  hits: ScanHit[];
  /** 非致命告警 (如不可读目录), 不中断扫描 */
  warnings: string[];
  /**
   * 排除名单命中统计 (名称 → 命中次数); 未命中的名称也在列 (hits === 0)。
   * 性质: 破坏性动作的「保命名单」反馈通道 —— 名字打错/大小写不符时不得静默。
   * 胜出门面 (parallel) 必须提供; 历史候选可缺省。
   */
  excludeMatches?: { name: string; hits: number }[];
}

export interface Scanner {
  /** 候选中立名, 供基准与日志区分 */
  name: string;
  scan(options: ScanOptions): Promise<ScanResult>;
}

export interface SizeEntry {
  /** node_modules 绝对路径 (对应 ScanHit.target) */
  target: string;
  /** 字节数; 口径: du 候选 = 磁盘占用, js 候选 = 逻辑大小 (差异由基准环节记录裁定) */
  bytes: number;
}

/** 存在但无法测量的目标 (权限等): 结构化上报, 下游不得静默移出清单 */
export interface UnmeasuredEntry {
  /** node_modules 绝对路径 (对应 ScanHit.target) */
  target: string;
  /** 人话中文原因 (不含路径本身, 与 target 字段各司其职) */
  reason: string;
}

export interface SizeResult {
  /** 可测量目标的体积, 按 target 排序 */
  entries: SizeEntry[];
  /** 非致命告警 (如子目录不可读), 不中断统计 */
  warnings: string[];
  /** 存在但无法测量的目标 (如权限不足), 按 target 排序; 「不存在」的路径跳过、不入任何桶 */
  unmeasured: UnmeasuredEntry[];
}

export interface Sizer {
  /** 候选中立名, 供基准与日志区分 */
  name: string;
  measure(targets: string[]): Promise<SizeResult>;
}
