# 覆盖表与变异自证 (终稿)

> 判据 (见 [套件门面](../README.md)「维护规则」): 每 case `specRefs` 非空且指向真实条款; 产出「契约条款 × 语料」
> 覆盖表, 未被覆盖的条款要么补 case, 要么显式标注「不可黑盒验收」并给出理由。
> **终稿数据**: 双载体 (bun / node) 各三连跑全绿, 判定层逐字节一致;
> 判定基准为 2026-09-23 白名单 (`include`) 落地后的快照 (`cli.ts` 名单反馈通道扩展后);
> 可追溯校验 (jq): 台账与语料引用逐条对齐, 无悬空引用, 未被引用者恰为下表豁免项。
> **派生声明**: 本表由 `corpus/*.json` 的 `specRefs` 机械汇总 (jq) 生成, 权威在语料与条款台账,
> 本表是派生索引, 严禁反向手改本表来「修」覆盖关系。

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
| BC-16 | 2      | config-env-source, config-flag-over-env                                                                                                                                                                                                                                                      |
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
| BC-32 | 1      | scan-include-exclude-priority                                                                                                                                                                                                                                                                |
| BC-33 | 1      | scan-include-unmatched-warn                                                                                                                                                                                                                                                                  |
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
| OF-12 | 7      | cli-help, cli-unknown-arg, scan-basic-preview, scan-exclude-unmatched-warn, scan-include-unmatched-warn, scan-root-missing-warn, scan-unreadable-dir-warn                                                                                                                                    |
| EC-05 | 1      | delete-partial-failure-shell                                                                                                                                                                                                                                                                 |

## 二、未覆盖条款 (显式标注与理由)

| 条款               | 状态                | 理由                                                                                                                                           |
| ------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| BC-13              | 不可黑盒 (竞态)     | 「target 在扫描命中后、体积统计前消失」需竞态时序缝, CLI 黑盒面不可静态构造; 语义与 EC-01 同源 (模块级已钉死)                                  |
| BC-21 / BC-22      | 不可黑盒 (竞态)     | 安全闸「拒绝 → 整批拒绝」需在校验与删除之间换掉目标 (转写 / 逃逸 / 重复), 属竞态时序缝; 语义见 `deletion-guard.md`「校验不变量」, 模块级已钉死 |
| EC-01              | 不可黑盒 (竞态)     | TOCTOU missing 桶同上                                                                                                                          |
| EC-02              | 不可黑盒 (竞态)     | 与 BC-21 / BC-22 同源                                                                                                                          |
| EC-03              | 不可黑盒 (平台矩阵) | win32 路径折叠与 `%APPDATA%` 默认路径需 win32 宿主 (或平台 CI); 模块级注入 `platform` 已钉死                                                   |
| EC-04              | 不可黑盒 (不可造)   | 「符号链接作删除目标只删链接本身」: 扫描不跟进符号链接, 黑盒面拿不到这样的删除目标; 模块级已钉死                                               |
| EC-06 / OF-04 大档 | 成本性未覆盖        | 大档 (≥1GiB) 展示需真实写入 1 GiB 数据, 超出语料运行预算; 档位逻辑经小 / 中两档与 OF-05 覆盖                                                   |
| OF-10 TTY 彩色面   | 二期 (pty)          | 彩色 / 着色只在 TTY 下开启, 需 pty 运行器 (设计定为二期); 非 TTY 降级面已覆盖                                                                  |

## 三、变异自证 (语料抓缺陷能力)

inject mutant (经 `make-mutants.ts` 从冻结源复制 + 单行级补丁生成), 逐一对全量语料跑:
**全部被抓住** (判据要求 ≥3)。经多轮复核 (含新快照重建), mutant 重建后判定数字
完全一致 (26 / 11 / 4 / 3 / 6 / 26), 抓取面稳定。

| mutant (注入缺陷)                | 抓住它的用例数 | 代表用例                                                                   |
| -------------------------------- | -------------- | -------------------------------------------------------------------------- |
| prune-negated (剪枝谓词取反)     | 26             | scan-basic-preview, scan-nested-prune, scan-include-config                 |
| exit-swallowed (退出码吞掉)      | 11             | cli-unknown-arg, config-corrupt-json, size-unmeasured-blocks-delete        |
| sort-missing (排序缺失)          | 4              | scan-order-target-asc, scan-basic-preview, scan-include-cli-merge          |
| exclude-silent (排除静默失效)    | 3              | scan-exclude-config, scan-exclude-cli-merge, scan-include-exclude-priority |
| message-removed (提示语删改)     | 6              | render-empty-result, render-banner-4-roots, scan-include-unmatched-warn    |
| size-unit-wrong (体积计数单位错) | 26             | render-tier-mid-and-order, scan-basic-preview, scan-include-cli-merge      |

观察: `sort-missing` 抓取面最窄, 因它依赖「并发完成序 ≠ 升序」; 语料以同体积清单
(`scan-order-target-asc` 与 `scan-include-cli-merge`) 作主抓点, 抓取稳定
(三轮重跑均被抓)。
