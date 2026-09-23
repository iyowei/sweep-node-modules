# sweep-node-modules 设计总纲

> **状态**: 已定稿 (Accepted)
> **日期**: 2026-09-23
> **决策者**: 沈委
> **标签**: [工程]
> **影响范围**: [全项目]

## 修订记录

| 日期       | 修订                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-23 | 初稿: 立项设计, 含命令面、配置规格、扫描与安全闸、代码结构、测试策略、明确不做清单                                        |
| 2026-09-23 | 补记: 配置初始化模型 (`sweep-nm init` 子命令 + 首次自动向导), 见 [ADR 0004](../adrs/0004-config-initialization-wizard.md) |
| 2026-09-23 | 补记: 工程闸门 (oxlint / prettier / lefthook), 见 [ADR 0005](../adrs/0005-engineering-gates-and-hooks.md)                 |
| 2026-09-23 | 补记: 双运行时 (Bun 优先 / Node 回退) 与性能要点, 见 [ADR 0006](../adrs/0006-dual-runtime-bun-first.md)                   |
| 2026-09-23 | 拆分: 单篇设计拆为总纲 + 四份分册; 分册后续修订各自在文件内补「修订记录」                                                 |
| 2026-09-23 | 分册索引收为指针行; 设计索引权威归 [designs/README.md](README.md) (含推荐阅读顺序)                                        |

## 分册索引

本总纲只承载项目级设计 (定位、结构、测试、全局边界); 各「不可再拆分的设计块」独立成册, 分册总目与推荐阅读顺序见 [设计文档索引](README.md)。

## 一、定位与成功标准

工作区级 `node_modules` 清理工具: 一次扫描多个根目录, 跨项目列出各处 `node_modules` 与体积, 确认后批量删除。与单项目工具 (cli-cleaner 一类) 分层共存, 见 [ADR 0001](../adrs/0001-workspace-level-cleaner.md)。

成功标准 (按个人小工具档位):

- **正确**: 扫描不漏不重, 删除只命中目标;
- **失败响亮**: 任何失败以非零退出码与汇总清单呈现, 不静默吞掉;
- **易改**: 零依赖、小模块、纯逻辑与 IO 分离;
- **够用就停**: 见「明确不做清单」, 不预建投机能力。

## 二、代码结构与运行时基座

```text
src/
├── cli.ts      # 入口: 参数解析、流程编排、帮助 (分册: 命令面与输出)
├── runtime.ts  # 运行时适配: Bun 优先 / Node 回退 (spawn 与文件读写)
├── config.ts   # 配置读取与合并 (分册: 配置与初始化)
├── init.ts     # 初始化向导: 交互 IO 与配置生成纯逻辑分离 (分册: 配置与初始化)
├── scan.ts     # 纯函数: 递归扫描 (分册: 扫描与体积)
├── size.ts     # 批量 du 调用与解析 (分册: 扫描与体积)
├── guard.ts    # 安全闸: 删除目标合法性校验 (分册: 删除安全闸)
└── *.test.ts   # 与模块同名并置的单测

bin/
└── sweep-nm    # sh 启动器: 挑选运行时 (Bun 优先, Node 回退) 后 exec src/cli.ts
```

双运行时策略见 [ADR 0006](../adrs/0006-dual-runtime-bun-first.md); `src/runtime.ts` 导出面约定:

- `isBun`: 运行时探测 (功能检测 `typeof Bun !== 'undefined'`: 有 Bun 走 Bun 实现, 无则回退 Node);
- `spawnCapture(cmd, args)`: 子进程执行并捕获 stdout (Bun 走 `Bun.spawn`, Node 走 `node:child_process`);
- `readTextFile(path)` / `writeTextFile(path, text)`: 文本读写 (Bun 走 `Bun.file` / `Bun.write`, Node 走 `node:fs/promises`);
- 其余能力 (目录遍历、删除等) 一律直接走 `node:` 兼容 API, 不设分支。

## 三、测试策略

`bun test`; fixture 在系统临时目录动态搭建, 用完即删:

| 用例     | 从属分册     | 断言                                                                                   |
| -------- | ------------ | -------------------------------------------------------------------------------------- |
| 剪枝     | 扫描与体积   | 嵌套 `node_modules` 只报最外层                                                         |
| 排除     | 扫描与体积   | 项目名级与容器名级排除均命中                                                           |
| 符号链接 | 扫描与体积   | 不跟进, 不计入                                                                         |
| 安全闸   | 删除安全闸   | 非 `node_modules` 末段、根外路径、`/` 与 `$HOME` 一律拒绝                              |
| 执行     | 删除安全闸   | 真删 fixture, 目标消失且邻居完好                                                       |
| 失败路径 | 删除安全闸   | 注入不可删目标, 退出码非零且汇总呈现                                                   |
| 初始化   | 配置与初始化 | 非 TTY + 无配置走 cwd 回退不阻塞; 配置生成纯逻辑 (答案 → 配置对象); 已存在时默认不覆盖 |

测试文件按语义命名 (如 `scan.test.ts`, `guard.test.ts`); 向导的 readline 交互不做端到端自动化, 由「答案到配置对象再到落盘决策」的纯逻辑单测覆盖。

## 四、明确不做 (YAGNI)

- 交互勾选界面;
- 活跃度智能推荐;
- `--json` 等机器输出 (暂无下游消费者);
- 体积阈值过滤;
- 其他清理能力 (模拟器等) 与共享基础库抽取;
- npm 发布与跨平台适配。

以上均等真实需要出现时再议。

## 关联引用

- [ADR 0001: 工作区级清理工具定位](../adrs/0001-workspace-level-cleaner.md)
- [ADR 0002: 固定配置与预览执行模型](../adrs/0002-fixed-config-and-preview-execution.md)
- [ADR 0003: bun + TypeScript 零运行时依赖](../adrs/0003-bun-zero-runtime-deps.md)
- [ADR 0004: 配置初始化向导](../adrs/0004-config-initialization-wizard.md)
- [ADR 0005: 工程闸门与提交钩子](../adrs/0005-engineering-gates-and-hooks.md)
- [ADR 0006: 双运行时支持与 Bun 优先的 API 策略](../adrs/0006-dual-runtime-bun-first.md)
- 工程闸门操作细节以仓库根 `lefthook.yml`、`.oxlintrc.json`、`.prettierrc` 为准; 文档体系与命名约定见 [docs/README](../README.md)。
