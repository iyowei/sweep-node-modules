# ADR 0006: 双运行时支持与 Bun 优先的 API 策略

> **状态**: 已接受 (Accepted)
> **日期**: 2026-09-23
> **决策者**: 沈委
> **标签**: [工程]
> **影响范围**: [全项目]

## 上下文与问题陈述 (Context & Problem)

工具面向跨机个人使用: 有的机器只有 Node, 有的只有 Bun, 应做到「装任一运行时即可使用」(适用范围: 业务逻辑与从源码使用的入口; npm 分发通道的入口由 node 启动、需有 node, 见 [ADR 0009](0009-npm-distribution-form.md)「适用边界」)。同时定调两条硬要求: 不考虑旧版本兼容 (直接用各运行时最新一代的 API); 性能不能差。API 选型取向: 首选 Bun API (文件操作等性能强), 但不能为此牺牲 Node 可用性。

## 被放弃的替代方案 (Options Considered & Rejected)

**[只支持 Bun]**

放弃理由: 只装 Node 的机器直接不可用, 与「装任一运行时即可」冲突。

**[只支持 Node]**

放弃理由: 放弃主力运行时的启动性能与原生文件 API; 本机日常为 Bun, 主路径应是快路径。

**[双实现分叉 (Bun 版 / Node 版各写一份)]**

放弃理由: 同一份逻辑维护两份实现, 规则漂移风险随时间累积, 与「单一事实来源」相悖。

**[构建产物分发 (`bun build --compile` 或转译 JS)]**

放弃理由: 引入构建步骤与产物管理, 与 [ADR 0003](0003-zero-runtime-deps.md)「零构建、源码直跑、改完即生效」相悖。

(该弃用判断已被 [ADR 0009](0009-npm-distribution-form.md) 局部取代: 当时的「构建」指为运行而构建, 现仅 npm 分发态为分发而构建, 开发运行路径未变。)

## 决策结论与选择原因 (Decision & Why)

1. **单源码双运行时**: 同一份 TypeScript 源码在 Bun 与 Node 上都直跑 (两侧均原生支持 TS 类型剥离直跑, 已实测)。
2. **Bun 优先的薄适配层**: `src/runtime.ts` 集中封装两处有实质差异的能力, 子进程 spawn (`Bun.spawn` / `node:child_process`) 与文件读写 (`Bun.file` / `Bun.write` / `node:fs/promises`); 探测方式为功能检测 `typeof Bun !== 'undefined'`: 有 Bun 能力则优先走 Bun 实现, 无则回退 Node 实现 (分支集中在适配层内部, 调用方无感)。其余一律走 `node:` 兼容 API, 不搞「为 Bun 而 Bun」的双份代码 (Bun 对 `node:fs` 的实现本身就是原生加速, 无需另写分支)。
3. **语法约束 (为 Node 类型剥离而设)**: 仅使用可擦除 TS 语法 (禁 `enum` / `namespace` / 参数属性等需 emit 的特性); tsconfig 开启 `erasableSyntaxOnly`, 把约束物理钉死在类型检查上。
4. **入口形态**: `src/cli.ts` 不再自带 shebang、不再直接软链; 新增 `bin/sweep-nm` 启动器 (sh), 按「Bun 优先, Node 回退」挑选运行时后 `exec` 真实入口; `~/.local/bin/sweep-nm` 软链指向启动器 (修订 [ADR 0003](0003-zero-runtime-deps.md) 的安装形态与运行时要求; 其零依赖与零构建策略不变, 该「零构建」的适用范围后由 [ADR 0009](0009-npm-distribution-form.md) 收窄为开发运行路径)。
5. **版本要求**: 双侧都要「最新一代」: Bun 任意近期版本; Node 需原生支持 TypeScript 直跑的版本, 下限为 `>= 22.18.0` (该版本起类型剥离默认启用, 见 nodejs.org/api/typescript.html 的 History 表: v23.6.0 / v22.18.0「Type stripping is enabled by default」), 已落为 package.json 的 `engines.node`。该下限对两条获取方式同限: 从源码运行需要类型直跑能力, npm 安装拿到的是编译产物 JS、跑 JS 本身不需要该能力, 但两种获取方式取同一数值下限, 不因获取方式放宽 (分发形态见 [ADR 0009](0009-npm-distribution-form.md))。本机实测: bun 1.4.2 与 node 26.7.0 双跑同一入口通过。
6. **性能取向**: 热路径 (目录遍历) 按 [扫描与体积](../designs/scan-and-size.md)「性能要点」的手册执行 (withFileTypes 免逐个 lstat、命中剪枝、跳过 `.git`、符号链接不跟进; 体积统计候选与裁定见该分册)。

选择原因: 任一运行时均可用; Bun 主路径拿到启动与 spawn 性能; 单源码无分叉; 约束落在可物理校验的闸门 (tsconfig 选项) 之上。

## 后果与权衡妥协 (Consequences & Trade-offs)

**正面收益**

- 装 Bun 或装 Node 均可使用; 主力机器走 Bun 快路径 (npm 安装路径同享, 见 [ADR 0009](0009-npm-distribution-form.md))。
- 无分叉实现, 开发运行路径无构建步骤。

**权衡妥协**

- 回归需在两种运行时下各跑一遍 (测试命令双跑; **修订 (2026-09-23)**: 单测侧此后已参数化, e2e 按两个载体各注册一遍, 跑一次 `bun test` 即覆盖两侧, 故 "双跑" 现仅对**转写验收**通道成立, 其 `--target` 为单值且不在任何闸门内);
- TS 语法受可擦除约束 (对本项目所需特性无损失);
- 入口多一层 sh 启动器跳转 (开销可忽略)。

## 验证方式与关联引用 (Validation & References)

**验证口径 (本次落地核验)**

1. `bun src/cli.ts` 与 `node src/cli.ts` 双跑, 输出与退出码一致;
2. 启动器经软链实跑, 运行时挑选正确; PATH 无 bun 时回退 Node;
3. `bunx tsc --noEmit` (含 `erasableSyntaxOnly`) 通过。

**关联引用**

- 安装形态与运行时要求的被修订方见 [ADR 0003](0003-zero-runtime-deps.md); npm 分发形态 (编译产物与入口) 见 [ADR 0009](0009-npm-distribution-form.md)。
- 性能手册见 [扫描与体积](../designs/scan-and-size.md); 代码结构与运行时基座见 [设计总纲](../designs/sweep-node-modules-design.md)。
