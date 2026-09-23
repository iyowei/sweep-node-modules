# sweep-node-modules 设计总纲

> **状态**: 已定稿 (Accepted)
> **日期**: 2026-09-23
> **决策者**: 沈委
> **标签**: [工程]
> **影响范围**: [全项目]

## 修订记录

| 日期       | 修订                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-23 | 初稿: 立项设计, 含命令面、配置规格、扫描与安全闸、代码结构、测试策略、明确不做清单                                                              |
| 2026-09-23 | 补记: 配置初始化模型 (`sweep-nm init` 子命令 + 首次自动向导), 见 [ADR 0004](../adrs/0004-config-initialization-wizard.md)                       |
| 2026-09-23 | 补记: 工程闸门 (oxlint / prettier / lefthook), 见 [ADR 0005](../adrs/0005-engineering-gates-and-hooks.md)                                       |
| 2026-09-23 | 补记: 双运行时 (Bun 优先 / Node 回退) 与性能要点, 见 [ADR 0006](../adrs/0006-dual-runtime-bun-first.md)                                         |
| 2026-09-23 | 拆分: 单篇设计拆为总纲 + 四份分册; 分册后续修订各自在文件内补「修订记录」                                                                       |
| 2026-09-23 | 分册索引收为指针行; 设计索引权威归 [designs/README.md](README.md) (含推荐阅读顺序)                                                              |
| 2026-09-23 | 补记: 三平台 (Windows / macOS / Linux) 可移植性与配置定位, 见 [ADR 0007](../adrs/0007-platform-portability.md); CLI 输出规格升级为色块视觉规范  |
| 2026-09-23 | 实现落地回写: 模块表补 delete / 门面 / bench / scripts; 测试策略补实现覆盖指针; 关联 [ADR 0008](../adrs/0008-transcription-kit.md) 转写契约套件 |
| 2026-09-23 | 分发形态: 编译产物 + 单文件打包发布到 npm (`@iyowei/sweep-node-modules`); 「明确不做」清单移除 npm 发布项                                       |
| 2026-09-23 | 代码树补 npm 分发入口 `bin/sweep-nm.mjs`; 实测规模改为指代验收命令的实时输出 (不写死条数)                                                       |
| 2026-09-23 | 分发形态回写: 代码树补 `dist/cli.js` 与三入口差异 (见 [ADR 0009](../adrs/0009-npm-distribution-form.md)); 导出面补 `runtimeLabel`               |

## 分册索引

本总纲只承载项目级设计 (定位、结构、测试、全局边界); 各「不可再拆分的设计块」独立成册, 分册总目与推荐阅读顺序见 [设计文档索引](README.md)。

## 一、定位与成功标准

工作区级 `node_modules` 清理工具: 一次扫描多个根目录, 跨项目列出各处 `node_modules` 与体积, 确认后批量删除。与单项目清理工具分层共存, 见 [ADR 0001](../adrs/0001-workspace-level-cleaner.md)。

成功标准 (按个人小工具档位):

- **正确**: 扫描不漏不重, 删除只命中目标;
- **失败响亮**: 任何失败以非零退出码与汇总清单呈现, 不静默吞掉;
- **易改**: 零依赖、小模块、纯逻辑与 IO 分离;
- **可移植**: Windows / macOS / Linux 三平台可用, 见 [ADR 0007](../adrs/0007-platform-portability.md);
- **够用就停**: 见「明确不做清单」, 不预建投机能力。

## 二、代码结构与运行时基座

```text
src/
├── cli.ts      # 入口编排: 参数 / 配置分流 / 扫描 / 体积 / 渲染 / 安全闸 / 删除 (分册: 命令面与输出)
├── runtime.ts  # 运行时适配: Bun 优先 / Node 回退 (spawn 与文件读写)
├── config.ts   # 配置读取与合并 (分册: 配置与初始化)
├── init.ts     # 初始化向导: 交互 IO 与配置生成纯逻辑分离 (分册: 配置与初始化)
├── scan.ts     # 扫描门面: 对外只暴露胜出候选 (候选: scan-parallel / scan-prune / scan-native)
├── size.ts     # 体积门面: 策略 A 双轨选择 (du 快路径 / 纯实现基线)
├── guard.ts    # 安全闸: 校验不变量 (分册: 删除安全闸)
├── delete.ts   # 删除执行: 组件级复核 / 三桶结果 / 整批中止 (分册: 删除安全闸)
├── render.ts   # 清单渲染: 色块视觉规范与降级 (分册: 命令面与输出)
├── types.ts / fixtures.ts / golden.ts / render.fixtures.ts  # 基建: 候选共享接口 / 合成工作区 / 金样板断言 / 渲染共享样例
├── init.smoke.ts / runtime.node-smoke.ts  # 双载体冒烟入口: 向导真实管道 / Node 直跑 (由对应 *.test.ts spawn 驱动)
└── *.test.ts   # 与模块同名并置或按维度命名的单测 (contract / robustness / stress / e2e / smoke)

bench/                  # 基准仪器 (扫描 / 体积 / 真实工作区 / 压测四组)
bin/sweep-nm            # sh 启动器: 挑选运行时 (Bun 优先, Node 回退) 后 exec src/cli.ts
bin/sweep-nm.cmd        # cmd 启动器 (Windows): 与 sh 启动器同逻辑
bin/sweep-nm.mjs        # npm 分发的 bin 入口: 优先跑 dist/cli.js, 无产物回退 src/cli.ts; 三者职责同逻辑, 差异在宿主与入口选择
dist/cli.js             # 构建产物 (派生件, 由 bun run build 生成, 不入库): 仅 npm 分发态需要
scripts/transcription/  # 转写契约套件的验收器与变异生成器 (见 docs/protocol/)
```

双运行时策略见 [ADR 0006](../adrs/0006-dual-runtime-bun-first.md); `src/runtime.ts` 导出面约定:

- `isBun`: 运行时探测 (功能检测 `typeof Bun !== 'undefined'`: 有 Bun 走 Bun 实现, 无则回退 Node);
- `spawnCapture(cmd, args)`: 子进程执行并捕获 stdout (Bun 走 `Bun.spawn`, Node 走 `node:child_process`; stderr 直通不捕获);
- `readTextFile(path)` / `writeTextFile(path, text)`: 文本读写 (Bun 走 `Bun.file` / `Bun.write`, Node 走 `node:fs/promises`);
- `runtimeLabel`: 运行时自述 (形如 `bun 1.4.2`, 取运行时在 `process.versions` 自报的字段, 直接跑与经启动器跑都报真身), 供顶栏如实展示本次执行环境 (分册: 命令面与输出);
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

测试文件按语义命名 (如 `scan.contract.test.ts`, `guard.contract.test.ts`); 向导的 TTY 交互不做端到端自动化 (管道冒烟见 `init.smoke.test.ts`), 由「答案到配置对象再到落盘决策」的纯逻辑单测覆盖。

实现落地后实测覆盖远超本表: 用例与语料规模以 `bun test` 与 `bun run conformance` 的实时输出为准 (含压测长跑、伪终端冒烟、双载体 e2e); 明细见各 `*.test.ts` 与 [转写契约套件](../protocol/README.md) 的覆盖表。

## 四、明确不做 (YAGNI)

- 交互勾选界面;
- 活跃度智能推荐;
- `--json` 等机器输出 (暂无下游消费者);
- 体积阈值过滤;
- 其他清理能力 (模拟器等) 与共享基础库抽取。

以上均等真实需要出现时再议。

## 关联引用

- [ADR 0001: 工作区级清理工具定位](../adrs/0001-workspace-level-cleaner.md)
- [ADR 0002: 固定配置与预览执行模型](../adrs/0002-fixed-config-and-preview-execution.md)
- [ADR 0003: 零运行时依赖](../adrs/0003-zero-runtime-deps.md)
- [ADR 0004: 配置初始化向导](../adrs/0004-config-initialization-wizard.md)
- [ADR 0005: 工程闸门与提交钩子](../adrs/0005-engineering-gates-and-hooks.md)
- [ADR 0006: 双运行时支持与 Bun 优先的 API 策略](../adrs/0006-dual-runtime-bun-first.md)
- [ADR 0007: 三平台可移植性与配置定位](../adrs/0007-platform-portability.md)
- [ADR 0008: 转写契约套件](../adrs/0008-transcription-kit.md)
- [ADR 0009: npm 分发形态](../adrs/0009-npm-distribution-form.md)
- 工程闸门操作细节以仓库根 `lefthook.yml`、`.oxlintrc.json`、`.prettierrc` 为准; 文档体系与命名约定见 [docs/README](../README.md)。
