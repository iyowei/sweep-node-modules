# 行为契约 (behavior contract)

> 用途: 语料 `specRefs` 的背书目标; 每条语料期望必须能由这里的条款原文辩护 (**严禁「跑一遍记下来」式捕获**)。
> 条款的权威出处以 `docs/designs/` 四份设计文档为主, 实现级细节以各条标注的代码载体为准: 本文件是其面向「转写与验收」的编号化视图。
>
> 可验收性列: ✓ = 黑盒 CLI 面可验收 (本套件覆盖对象); 其余标注不可黑盒的理由 (由模块级测试钉死)。

## BC · 行为契约

| 编号  | 条款                                                                                                    | 权威出处                                                                 | 可验收                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| BC-01 | 目录名恰为 node_modules 时记录其父目录为项目, 且不再下钻 (嵌套天然解决)                                 | scan-and-size.md「扫描算法」1                                            | ✓                                                                                |
| BC-02 | 符号链接目录不跟进 (防环、防误出根)                                                                     | scan-and-size.md「扫描算法」2                                            | ✓                                                                                |
| BC-03 | 排除判定在进入目录时进行: 从根到命中点任意一级目录名命中 exclude 即整棵子树跳过                         | scan-and-size.md「扫描算法」3                                            | ✓                                                                                |
| BC-04 | 多根结果合并, 按 realpath 去重 (重复根只遍历一次)                                                       | scan-and-size.md「扫描算法」4                                            | ✓                                                                                |
| BC-05 | 跳过 .git 目录                                                                                          | scan-and-size.md「扫描算法」5                                            | ✓                                                                                |
| BC-06 | 命中清单按 target 升序输出 (与并发完成次序解耦, 输出确定)                                               | scan-and-size.md「扫描算法」; types.ts「按 target 排序」                 | ✓                                                                                |
| BC-07 | 根预检失败按病因分流告警并跳过 (不存在 / 权限不足 / 不是目录 / 其他), 不中断其余根                      | scan-and-size.md「扫描算法」6; 「错误与边界」                            | ✓                                                                                |
| BC-08 | 目录不可读: 告警并跳过, 不中断                                                                          | scan-and-size.md「错误与边界」                                           | ✓                                                                                |
| BC-09 | exclude 名未匹配到任何目录 → 告警 (保命名单不得静默失效)                                                | scan-and-size.md「扫描算法」10; types.ts「excludeMatches」               | ✓                                                                                |
| BC-10 | 根自身名为 node_modules 不记录 (根 = 容器语义)                                                          | scan-and-size.md「扫描算法」8                                            | ✓                                                                                |
| BC-11 | 根自身为符号链接 → 照常扫描 (显式即授权), realpath 去重防重复                                           | scan-and-size.md「扫描算法」9                                            | ✓                                                                                |
| BC-12 | 体积: du 可用走快路径 (磁盘占用口径), 批量单次调用, 不逐处 spawn                                        | scan-and-size.md「体积统计」                                             | ✓ (unix)                                                                         |
| BC-13 | 不存在的 target 跳过 (告警), 不产生 entry、不伪造 0 字节                                                | scan-and-size.md「体积统计」                                             | 模块级 (需竞态时序缝: 扫描命中后、体积统计前目标消失, CLI 不可造; 与 EC-01 同源) |
| BC-14 | 存在但测不到的目标结构化记 unmeasured, 清单以占位行呈现 (不静默移出)                                    | scan-and-size.md「体积统计」; cli.ts toEntries                           | ✓                                                                                |
| BC-15 | 未测到体积的目标不执行删除, 并计入失败 (退出码 1)                                                       | scan-and-size.md「体积统计」; cli.ts sweep                               | ✓                                                                                |
| BC-16 | 配置路径三级覆盖: `--config` > `SWEEP_NM_CONFIG` > 平台默认                                             | config-and-initialization.md                                             | ✓ (posix 分支)                                                                   |
| BC-17 | 显式来源 (旗标 / 环境变量) 指向的文件不存在 → 硬报错「配置不存在 (<path>), 请检查路径」, 退 1           | config-and-initialization.md「错误与边界」                               | ✓                                                                                |
| BC-18 | 平台默认来源缺失: 非 TTY 回退「以当前目录为根」并在 stderr 明确提示                                     | config-and-initialization.md「配置初始化模型」                           | ✓                                                                                |
| BC-19 | 配置损坏 (JSON 解析失败 / 形状不符) → 报错含路径与逐字段原因, 退 1                                      | config-and-initialization.md「错误与边界」                               | ✓                                                                                |
| BC-20 | 缺 `exclude` / `include` 字段视为 `[]`, 不判损坏; `roots` 必填                                          | config-and-initialization.md「配置规格」                                 | ✓                                                                                |
| BC-21 | 删除安全闸四不变量 (末段 node_modules / realpath 位于 roots 之下 / 非根与 home 本体 / realpath 去重)    | deletion-guard.md「校验不变量」                                          | 模块级 (见 EC-02)                                                                |
| BC-22 | 任一目标被拒 → 整批拒绝、零删除、退 1 (保守优先)                                                        | deletion-guard.md                                                        | 模块级 (见 EC-02)                                                                |
| BC-23 | 删除动作只在 `--yes` 下发生; 预览零副作用                                                               | cli-surface.md; deletion-guard.md「执行语义」                            | ✓                                                                                |
| BC-24 | 逐条删除, 单条失败不中断整批; 末尾分桶汇总                                                              | deletion-guard.md「执行语义」                                            | ✓                                                                                |
| BC-25 | 失败文案 = 错误码 + 人话 + 目标定位 + 部分删除复查提示                                                  | deletion-guard.md「错误与边界」; delete.ts                               | ✓                                                                                |
| BC-26 | 退出码: 预览 / 空结果 0; 删除有失败或未测到目标 1; 参数错误 / 配置损坏 1                                | cli-surface.md「退出码」; cli.ts                                         | ✓                                                                                |
| BC-27 | 参数面: 未知参数 / 旗标缺值 / 多余位置参数一律退 1                                                      | cli-surface.md「命令面」;「退出码」                                      | ✓                                                                                |
| BC-28 | 无配置 + `--yes` → 硬拒绝退 1, 零删除                                                                   | cli-surface.md「退出码」                                                 | ✓                                                                                |
| BC-29 | `init` 子命令非 TTY → 报错退 1                                                                          | config-and-initialization.md「配置初始化模型」                           | ✓                                                                                |
| BC-30 | `--help` 退 0, 含命令面 / `--exclude` 与 `--include` 匹配口径 / 默认配置位置                            | cli-surface.md「命令面」; config-and-initialization.md「配置规格」       | ✓                                                                                |
| BC-31 | 包含判定 (白名单) 与排除同款口径: 从根到 node_modules 的任意一级目录名命中 include 才纳入; 空数组不过滤 | scan-and-size.md「扫描算法」11; types.ts                                 | ✓                                                                                |
| BC-32 | include 与 exclude 同时命中同一级目录时 exclude 优先: 该子树无条件跳过 (先按白名单筛候选, 再排排除)     | scan-and-size.md「扫描算法」11; config-and-initialization.md「配置规格」 | ✓                                                                                |
| BC-33 | include 名未匹配到任何目录 → 告警 (白名单零命中时结果必为空, 比排除写错更不能静默)                      | scan-and-size.md「扫描算法」10; types.ts「includeMatches」               | ✓                                                                                |

## OF · 输出规格 (字节级, 非 TTY)

| 编号  | 条款                                                                                        | 权威出处                         | 可验收          |
| ----- | ------------------------------------------------------------------------------------------- | -------------------------------- | --------------- |
| OF-01 | 顶栏 `▍ SWEEP-NM  预览 · N 个根`; 根数 ≤3 时列出根路径 (`·` 连接), 超过只报数量             | cli-surface.md「输出规格」       | ✓               |
| OF-02 | 清单按体积降序 (体积测不到的排末尾), 同体积保持输入序                                       | cli-surface.md; render.ts        | ✓               |
| OF-03 | 行结构: 档位块 + 右对齐体积 + 项目名 + 路径; 路径剥尾部 `/node_modules`, 家目录前缀缩写 `~` | cli-surface.md「输出规格」       | ✓               |
| OF-04 | 档位: 大 ≥ 1 GiB (█) / 中 ≥ 100 MiB (▓) / 小 < 100 MiB (▒)                                  | render.ts 常量 (待真实分布重标)  | ✓ (小 / 中两档) |
| OF-05 | 体积格式: 逐级 1024 (B / KB / MB / GB / TB), 1 位小数, 整数省小数尾                         | render.ts formatBytes            | ✓               |
| OF-06 | 对齐按终端显示列宽 (CJK 双宽), 不按 code unit                                               | cli-surface.md「输出规格」       | ✓               |
| OF-07 | 空结果: 中性块提示「未发现 node_modules」, 退 0                                             | cli-surface.md                   | ✓               |
| OF-08 | 预览末行: `合计 N 处 · 总量` + `加 --yes 执行删除` 提示                                     | cli-surface.md                   | ✓               |
| OF-09 | 执行模式: 逐行 ✓ / ✗ (失败带原因), 末行 `汇总 成功 N 处 · 释放 X · 失败 M 处`               | cli-surface.md「输出规格」       | ✓               |
| OF-10 | 非 TTY / `NO_COLOR` → 零 ANSI 纯文本, 信息与结构不丢失                                      | cli-surface.md「降级」; ADR 0007 | ✓ (非 TTY 面)   |
| OF-11 | 占位行: 体积列 `?` + 中性块 + note 原因 (仅预览; 执行模式按失败呈现)                        | cli.ts toEntries; render.ts      | ✓               |
| OF-12 | 清单走 stdout; 告警 / 提示 / 错误走 stderr, 不污染清单                                      | cli.ts print / warn / notice     | ✓               |

## EC · 边界与错误语义 (重点是不可黑盒项与半完成语义)

| 编号  | 条款                                                                    | 权威出处                                                                                                | 可验收                                            |
| ----- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| EC-01 | TOCTOU: 校验与删除之间消失的目标归 missing 桶, 计成功侧                 | deletion-guard.md「执行语义」; delete.ts                                                                | 模块级 (需竞态时序缝, CLI 不可造)                 |
| EC-02 | 安全闸整批拒绝路径 (转写 / 替换 / 逃逸 / 重复目标)                      | deletion-guard.md「校验不变量」                                                                         | 模块级 (需竞态时序缝, CLI 不可造; 登记为已知)     |
| EC-03 | 平台矩阵: win32 路径大小写折叠 + `%APPDATA%` 默认路径; du 快路径仅 unix | deletion-guard.md「校验不变量」; config-and-initialization.md「配置规格」; scan-and-size.md「体积统计」 | 模块级 (需 win32 宿主; 注入 platform 已钉死)      |
| EC-04 | 符号链接作为删除目标只删链接本身 (fs.rm lstat 语义)                     | deletion-guard.md「执行语义」                                                                           | 模块级 (扫描不跟进符号链接, 黑盒面不可造)         |
| EC-05 | 半完成语义: 删除中途失败时内容可能已清空只剩空壳, 失败文案必须提示复查  | deletion-guard.md「错误与边界」; delete.ts PARTIAL_DELETION_HINT                                        | ✓                                                 |
| EC-06 | 大档 (≥ 1 GiB) 展示: 黑盒造数据需真实写入 1 GiB, 成本超出语料运行预算   | render.ts 常量                                                                                          | 成本性未覆盖 (阈值逻辑经小 / 中两档与 OF-05 覆盖) |
