# 覆盖表与变异自证 (终稿)

> 判据 (见 [套件门面](../README.md)「维护规则」): 每 case `specRefs` 非空且指向真实条款; 产出「契约条款 × 语料」
> 覆盖表, 未被覆盖的条款要么补 case, 要么显式标注「不可黑盒验收」并给出理由。
> **终稿数据**: 双载体 (bun / node) 各三连跑全绿, 判定层逐字节一致;
> 判定基准为白名单 (`include`) 落地及其后续修正后的实现态: 起点为白名单落地提交 `15bc404`,
> 含 `7e2c9bd` (名单静默剔除) 与 `b8297e9` (include 命中计数修正); 本次校准的末位提交为 `d0b64b3` (新增名单语料与 `stderrMustNotContain` 原语);
> 可追溯校验 (jq): 台账与语料引用逐条对齐, 无悬空引用, 未被引用者恰为下表豁免项。
> **派生声明**: 本表由 `corpus/*.json` 的 `specRefs` 机械汇总 (jq) 生成, 权威在语料与条款台账,
> 本表是派生索引, 严禁反向手改本表来「修」覆盖关系。
> **本次加固依据 (维护规则「只增不改既有期望」的三向定责记录)**: 新增语料 `scan-node-modules-and-git-in-lists-noop` (BC-34),
> 并给 `scan-include-exclude-priority` 补 `stderrMustNotContain` 与 BC-33 背书; 既有期望逐条未动, 属加固而非改判。
> 定责结论: 修条款 (BC-33 补计数口径 / BC-34 新立) + 修语料 (两处), 实现侧对照 `7e2c9bd` 与 `b8297e9` 已正确, 无需改实现。
>
> **`config` 子命令一轮的定责记录 (2026-09-24)**: 新增子命令 `config` (BC-35 新立, 可验收性 posix 分支)
> 与其三条语料 `cli-config-default-source` / `cli-config-env-source` / `cli-config-flag-source`
> (后两条兼背书 BC-16 的三级覆盖, flag 条同时钉住「旗标优先于环境变量」)。
> `cli-help` 的逐字节期望随命令面扩展同步更新 (帮助新增 `sweep-nm config` 行, 「默认配置位置」行补
> 「仅为平台默认、覆盖通道下不成立」的限定并补 `查实际生效的路径: sweep-nm config` 指引), BC-30 条款补记该要求;
> 属需求变更引发的同步, 非基准降级 (期望由 BC-30 / BC-35 条款原文辩护, 非按实现反推)。
> 本轮双载体 (bun / node) 全量各跑一遍全绿。

## 一、条款 × 语料覆盖

| 条款  | 用例数 | 覆盖用例                                                                                                                                                                                                                                                                                     |
| ----- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BC-01 | 2      | scan-basic-preview, scan-nested-prune                                                                                                                                                                                                                                                        |
| BC-02 | 1      | scan-symlink-not-followed                                                                                                                                                                                                                                                                    |
| BC-03 | 2      | scan-exclude-cli-merge, scan-exclude-config                                                                                                                                                                                                                                                  |
| BC-04 | 2      | scan-multi-root-dedupe, scan-symlink-not-followed                                                                                                                                                                                                                                            |
| BC-05 | 1      | scan-git-bait                                                                                                                                                                                                                                                                                |
| BC-06 | 3      | scan-basic-preview, scan-multi-root-dedupe, scan-order-target-asc                                                                                                                                                                                                                            |
| BC-07 | 3      | scan-root-eacces-warn, scan-root-is-file-warn, scan-root-missing-warn                                                                                                                                                                                                                        |
| BC-08 | 1      | scan-unreadable-dir-warn                                                                                                                                                                                                                                                                     |
| BC-09 | 1      | scan-exclude-unmatched-warn                                                                                                                                                                                                                                                                  |
| BC-10 | 1      | scan-root-is-node-modules                                                                                                                                                                                                                                                                    |
| BC-11 | 1      | scan-root-symlink-followed                                                                                                                                                                                                                                                                   |
| BC-12 | 1      | render-tier-mid-and-order                                                                                                                                                                                                                                                                    |
| BC-14 | 1      | size-unmeasured-preview                                                                                                                                                                                                                                                                      |
| BC-15 | 1      | size-unmeasured-blocks-delete                                                                                                                                                                                                                                                                |
| BC-16 | 4      | cli-config-env-source, cli-config-flag-source, config-env-source, config-flag-over-env                                                                                                                                                                                                       |
| BC-17 | 1      | config-explicit-missing-hard-error                                                                                                                                                                                                                                                           |
| BC-18 | 2      | cli-no-config-non-tty-cwd-fallback, config-env-source                                                                                                                                                                                                                                        |
| BC-19 | 3      | config-corrupt-json, config-corrupt-shape-roots-missing, config-shape-item-type                                                                                                                                                                                                              |
| BC-20 | 2      | config-corrupt-shape-roots-missing, config-exclude-default-ok                                                                                                                                                                                                                                |
| BC-23 | 3      | cli-no-config-non-tty-cwd-fallback, delete-execute-ok, scan-basic-preview                                                                                                                                                                                                                    |
| BC-24 | 2      | delete-execute-multi-summary, delete-execute-ok                                                                                                                                                                                                                                              |
| BC-25 | 1      | delete-partial-failure-shell                                                                                                                                                                                                                                                                 |
| BC-26 | 9      | cli-no-config-non-tty-cwd-fallback, cli-no-config-yes-hard-reject, config-corrupt-json, config-explicit-missing-hard-error, delete-execute-multi-summary, delete-execute-ok, delete-partial-failure-shell, render-empty-result, size-unmeasured-blocks-delete                                |
| BC-27 | 3      | cli-extra-positional, cli-missing-value, cli-unknown-arg                                                                                                                                                                                                                                     |
| BC-28 | 1      | cli-no-config-yes-hard-reject                                                                                                                                                                                                                                                                |
| BC-29 | 1      | cli-init-non-tty                                                                                                                                                                                                                                                                             |
| BC-30 | 1      | cli-help                                                                                                                                                                                                                                                                                     |
| BC-31 | 2      | scan-include-cli-merge, scan-include-config                                                                                                                                                                                                                                                  |
| BC-32 | 2      | scan-include-exclude-priority, scan-ancestor-excluded-unmatched-warn                                                                                                                                                                                                                         |
| BC-33 | 3      | scan-include-exclude-priority, scan-include-unmatched-warn, scan-ancestor-excluded-unmatched-warn                                                                                                                                                                                            |
| BC-34 | 1      | scan-node-modules-and-git-in-lists-noop                                                                                                                                                                                                                                                      |
| BC-35 | 3      | cli-config-default-source, cli-config-env-source, cli-config-flag-source                                                                                                                                                                                                                     |
| OF-01 | 4      | render-banner-4-roots, render-empty-result, render-path-tilde, scan-basic-preview                                                                                                                                                                                                            |
| OF-02 | 4      | render-tier-mid-and-order, scan-basic-preview, scan-order-target-asc, size-unmeasured-preview                                                                                                                                                                                                |
| OF-03 | 13     | delete-execute-ok, render-align-cjk, render-path-tilde, scan-basic-preview, scan-exclude-cli-merge, scan-exclude-config, scan-git-bait, scan-include-cli-merge, scan-include-config, scan-include-exclude-priority, scan-nested-prune, scan-root-symlink-followed, scan-symlink-not-followed |
| OF-04 | 1      | render-tier-mid-and-order (小 / 中两档; 大档见下)                                                                                                                                                                                                                                            |
| OF-05 | 1      | render-tier-mid-and-order                                                                                                                                                                                                                                                                    |
| OF-06 | 1      | render-align-cjk                                                                                                                                                                                                                                                                             |
| OF-07 | 4      | render-empty-result, scan-root-eacces-warn, scan-root-is-file-warn, scan-root-is-node-modules                                                                                                                                                                                                |
| OF-08 | 1      | scan-basic-preview                                                                                                                                                                                                                                                                           |
| OF-09 | 3      | delete-execute-multi-summary, delete-execute-ok, size-unmeasured-blocks-delete                                                                                                                                                                                                               |
| OF-10 | 2      | cli-help, render-no-color-degraded (非 TTY 面; TTY 彩色面见下)                                                                                                                                                                                                                               |
| OF-11 | 2      | size-unmeasured-blocks-delete, size-unmeasured-preview                                                                                                                                                                                                                                       |
| OF-12 | 8      | cli-help, cli-unknown-arg, scan-basic-preview, scan-exclude-unmatched-warn, scan-include-unmatched-warn, scan-root-missing-warn, scan-ancestor-excluded-unmatched-warn, scan-unreadable-dir-warn (非 TTY 面; 名单回执为 TTY 专属, 见下)                                                      |
| EC-05 | 1      | delete-partial-failure-shell                                                                                                                                                                                                                                                                 |

## 二、未覆盖条款 (显式标注与理由)

| 条款               | 状态                | 理由                                                                                                                                                |
| ------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| BC-13              | 不可黑盒 (竞态)     | 「target 在扫描命中后、体积统计前消失」需竞态时序缝, CLI 黑盒面不可静态构造; 语义与 EC-01 同源 (模块级已钉死)                                       |
| BC-21 / BC-22      | 不可黑盒 (竞态)     | 安全闸「拒绝 → 整批拒绝」需在校验与删除之间换掉目标 (转写 / 逃逸 / 重复), 属竞态时序缝; 语义见 `deletion-guard.md`「校验不变量」, 模块级已钉死      |
| EC-01              | 不可黑盒 (竞态)     | TOCTOU missing 桶同上                                                                                                                               |
| EC-02              | 不可黑盒 (竞态)     | 与 BC-21 / BC-22 同源                                                                                                                               |
| EC-03              | 不可黑盒 (平台矩阵) | win32 路径折叠与 `%APPDATA%` 默认路径需 win32 宿主 (或平台 CI); 模块级注入 `platform` 已钉死                                                        |
| EC-04              | 不可黑盒 (不可造)   | 「符号链接作删除目标只删链接本身」: 扫描不跟进符号链接, 黑盒面拿不到这样的删除目标; 模块级已钉死                                                    |
| EC-06 / OF-04 大档 | 成本性未覆盖        | 大档 (≥1GiB) 展示需真实写入 1 GiB 数据, 超出语料运行预算; 档位逻辑经小 / 中两档与 OF-05 覆盖                                                        |
| OF-10 TTY 彩色面   | TTY 专属面 (需 pty) | 彩色 / 着色只在 TTY 下开启, 需 pty 承载 (语料运行器无 pty 通道, e2e 侧 pty 冒烟未覆盖此面); 非 TTY 降级面已覆盖                                     |
| 运行时自述         | TTY 专属面 (需 pty) | 顶栏尾部的运行时版本段 (` · bun 1.4.2`) 仅在 stdout 为真终端时出现, 非 TTY 下整段省略, 需 pty 承载; 不编条款号, 见 `behavior-contract.md`「OF」区注 |
| 名单回执           | TTY 专属面 (需 pty) | 顶栏下方的 `░ 排除生效 / 包含命中` 回执所在行同属 TTY 专属面 (非 TTY 下整段省略), 需 pty 承载; 名单未匹配警示走 stderr, 那一面已由语料覆盖          |

## 三、变异自证 (语料抓缺陷能力)

inject mutant (经 `make-mutants.ts` 从冻结源复制 + 单行级补丁生成), 逐一对全量语料 (本次快照) 跑:
**全部被抓住** (判据要求 ≥2 条用例; 该门槛对全部 mutant 均有实测支撑, 含抓取面最窄者)。五个 mutant 三连跑数字完全一致
(27 / 11 / 4 / 7 / 26), 抓取面稳定; `sort-missing` 见下方观察, 数字本身不稳定。

| mutant (注入缺陷)                | 抓住它的用例数 | 代表用例                                                                   |
| -------------------------------- | -------------- | -------------------------------------------------------------------------- |
| prune-negated (剪枝谓词取反)     | 27             | scan-basic-preview, scan-nested-prune, scan-include-config                 |
| exit-swallowed (退出码吞掉)      | 11             | cli-unknown-arg, config-corrupt-json, size-unmeasured-blocks-delete        |
| sort-missing (排序缺失)          | 波动 (见观察)  | delete-execute-multi-summary, scan-basic-preview                           |
| exclude-silent (排除静默失效)    | 4              | scan-exclude-config, scan-exclude-cli-merge, scan-include-exclude-priority |
| message-removed (提示语删改)     | 7              | render-empty-result, render-banner-4-roots, scan-include-unmatched-warn    |
| size-unit-wrong (体积计数单位错) | 26             | render-tier-mid-and-order, scan-basic-preview, scan-include-cli-merge      |

观察: `sort-missing` 抓取面最窄, 因它依赖「并发完成序 ≠ 升序」是否在本次调度中落败,
抓到的用例数随调度波动, 是本表唯一数字不稳定的 mutant (多次重跑从未见 0 抓);
其判据按该随机性取 ≥2 (与其余 mutant 同口径)。**本 mutant 无每轮必抓的用例**: 同体积清单类语料
(`scan-order-target-asc` 与 `scan-include-cli-merge`) 与 `delete-execute-multi-summary`
等命中率最高, 但放大样本后仍见缺席轮, 故本 mutant 的抓取集合整体随调度浮动。

> **`config` 子命令一轮的重测校准 (2026-09-24)**: 随本轮全量重跑一并重测全部 mutant (三连跑逐条一致)。
> 两个数字相对本表旧值上调: `exclude-silent` 3 → 4、`message-removed` 6 → 7; 归因已实证:
> 用剔除 `scan-ancestor-excluded-unmatched-warn` 的子集语料复跑, 两者即回落至 3 / 6, 故增量的来源即该条语料。
> 该条由 `8f9e9b8` 引入, 而该提交只重算了本表第一部分的覆盖关系 (三行), 未重测变异自证, 属遗留漂移, 本轮以实测校准。
> 本轮新增的三条 `cli-config-*` 语料不被任何 mutant 抓住: mutant 注入面在扫描 / 渲染 / 退出码主链路上, 与 `config` 子命令无交集。
