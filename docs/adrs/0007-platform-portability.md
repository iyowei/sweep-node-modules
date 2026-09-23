# ADR 0007: 三平台可移植性与配置定位

> **状态**: 已接受 (Accepted)
> **日期**: 2026-09-23
> **决策者**: 沈委
> **标签**: [工程]
> **影响范围**: [全项目]

## 上下文与问题陈述 (Context & Problem)

工具需要在 Windows / macOS / Linux 三平台顺利执行; 配置文件位置不得写死 (原规格写死 `~/.config/...`, Windows 无此约定); 原体积统计方案依赖 `/usr/bin/du` (POSIX 专属), 在 Windows 缺席。平台差异不得散落进业务代码。

## 被放弃的替代方案 (Options Considered & Rejected)

**[维持单平台, 不扩三平台]**

放弃理由: 需求明确要求三平台; 单平台实现对路径与命令的隐含假设会在跨平台时集中爆发。

**[依赖平台命令完成核心功能]**

放弃理由: Windows 无 `du` / `rm` / `readlink` 等对应物; 核心功能必须由运行时 API 纯实现, 平台命令最多作「可用时的优化快路径」。

**[用单一 shell 启动器统管三平台入口]**

放弃理由: Windows 无 `/bin/sh`; 入口必须分轨或借包管理器 shim。

**[配置位置写死单一路径]**

放弃理由: 三平台家目录约定不同 (Windows 无 `~/.config`); 写死即在 Windows 直接失效。

## 决策结论与选择原因 (Decision & Why)

1. **路径全面可移植**: 只用 `node:path` 拼装与比较路径; 家目录经 `os.homedir()` (禁 `$HOME` 字符串拼接); 目录包含性判定以 `path.relative` 结果为准 (禁用字符串前缀比较), win32 下按大小写不敏感比较; 禁硬编码 `/` 与 `\` 分隔符。
2. **配置定位 (平台自适应 + 可覆盖)**: 默认路径 Windows 为 `%APPDATA%\sweep-node-modules\config.json`, macOS / Linux 为 `~/.config/sweep-node-modules/config.json`; 优先级 `--config <path>` > 环境变量 `SWEEP_NM_CONFIG` > 平台默认 (覆盖通道亦服务测试与受控环境)。
3. **核心零 POSIX 假设**: 扫描 / 体积 / 删除 / 配置全走运行时 API; 平台命令仅允许作可用时的快路径, 且必须存在等价的纯实现基线 (体积统计的两候选与裁定落点见 [扫描与体积](../designs/scan-and-size.md))。
4. **入口分轨**: macOS / Linux 用 `bin/sweep-nm` (sh); Windows 用 `bin/sweep-nm.cmd` (同逻辑的 cmd 包装, Bun 优先 / Node 回退, 不用 `readlink`); 包管理器 bin shim 亦兼容。
5. **终端能力降级**: 颜色在非 TTY / `NO_COLOR` / 能力不足终端降级为纯文本, 信息零丢失 (视觉规范见 [命令面与输出](../designs/cli-surface.md))。

## 后果与权衡妥协 (Consequences & Trade-offs)

**正面收益**

- 一次实现三平台可用, 平台差异集中在少数适配点 (路径解析 / 包含性判定 / 入口 / 颜色), 可审可测;
- 纯实现基线让核心逻辑不依赖任何平台命令, 跨平台行为可预测。

**权衡妥协**

- 体积统计失去「平台命令」的免费加速, 需接受纯实现性能或维护双轨 (由试验场基准裁定);
- 入口与颜色层多一档平台分支。

## 验证方式与关联引用 (Validation & References)

**验证口径 (落地后核验)**

1. 平台路径矩阵单测: win32 / darwin (linux 同 unix 轨) 两套路径样本下, 配置定位与包含性判定全绿;
2. 非 TTY 与 `NO_COLOR` 环境下输出为纯文本;
3. 体积统计两候选的基准数据产出, 作为 [扫描与体积](../designs/scan-and-size.md) 定稿依据。

**关联引用**

- 双运行时与入口基线见 [ADR 0006](0006-dual-runtime-bun-first.md)。
- 视觉规范见 [命令面与输出](../designs/cli-surface.md); 配置定位落点见 [配置与初始化](../designs/config-and-initialization.md)。
