# ADR 0009: npm 分发形态

> **状态**: 已接受 (Accepted)
> **日期**: 2026-09-23
> **决策者**: 沈委
> **标签**: [工程]
> **影响范围**: [全项目]
> **取代关系**: 本 ADR 局部取代 [ADR 0003](0003-zero-runtime-deps.md) 决策条第 2 条「零构建」与 [ADR 0006](0006-dual-runtime-bun-first.md) 对「构建产物分发」的弃用判断。判断反转的理由: 当时弃用的是「为运行而构建」(与源码直跑互斥, 且彼时分发形态未定), 现在只加「为分发而构建」, 开发运行路径未变; 两处按「已接受的决定不原地改写」保留原文, 仅在决策条内加修订指引。

## 上下文与问题陈述 (Context & Problem)

工具要发布到 npm (包名 `@iyowei/sweep-node-modules`)。npm 分发暴露了一个开发态不存在的问题: 安装后的代码位于 `node_modules` 之下, 而 node 拒绝对 `node_modules` 目录下的 TypeScript 文件做类型剥离。

实测 (本机 node v26.7.0): 加载一个 `node_modules` 内的 `.ts` 文件直接抛 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`; 该错误码自 node v22.6.0 起存在, 官方描述为「Type stripping is not supported for files descendant of a `node_modules` directory」(见 nodejs.org/api/errors.html)。

后果: 包内若只发 TypeScript 源码, 只装 Node 的机器在 npm 安装后完全不可用, 与 [ADR 0006](0006-dual-runtime-bun-first.md)「装任一运行时即可使用」直接冲突; 分发形态必须重新裁定。

## 被放弃的替代方案 (Options Considered & Rejected)

**[包内只发源码, 靠安装方的类型剥离直跑]**

放弃理由: node 侧被上述错误码堵死, 该冲突在源码直跑轨道内无解; 为 node 另发一份实现则违反单源码原则 ([ADR 0006](0006-dual-runtime-bun-first.md))。

**[发 `bun build --compile` 的独立可执行文件]**

放弃理由: 编译产物按平台与架构分叉, 单一 npm 包要分发全部平台的二进制, 包体积与发布流程复杂度都不成比例; 本工具的形态是「装任一运行时即可用」, 不需自带运行时。

**[为分发引入完整打包 / 转译链]**

放弃理由: 无第三方依赖可捆, 转译目标单一 (只需去掉类型注解), `bun build` 一条命令即足; 引入配置文件与插件生态换不来额外收益。

## 决策结论与选择原因 (Decision & Why)

1. **开发态仍源码直跑**: 仓库内 `bun src/cli.ts` / `node src/cli.ts` 与 sh / cmd 启动器一切照旧, 不要求先构建再运行 ([ADR 0003](0003-zero-runtime-deps.md)「零构建」在开发运行路径继续成立)。
2. **仅 npm 分发态产出单文件编译产物**: `bun build src/cli.ts --target=node --outfile=dist/cli.js` (package.json 的 `build` 脚本), 发布前由 `prepublishOnly` 触发; `dist/` 是派生件不入库 (`.gitignore` 忽略), package.json 的 `files` 只列 `bin/sweep-nm.mjs` 与 `dist`。
3. **npm 入口为 `bin/sweep-nm.mjs`**: package.json 的 `bin` 目标 (命令名仍是 `sweep-nm`); 挑选运行时 (Bun 优先, Node 回退) 后, 按「优先跑 `dist/cli.js`, 无产物则回退 `src/cli.ts`」选入口, 一条选择逻辑同时服务包态与仓库开发态 (包内只有产物, 开发态通常无产物)。它与 sh / cmd 启动器职责同逻辑, 差异在宿主与这条入口选择 (见 [ADR 0007](0007-platform-portability.md))。
4. **node 下限两条获取方式同限**: 源码方式需类型剥离默认启用的版本, 编译产物方式跑的是 JS、本身不需要该能力, 但两种获取方式取同一数值下限 `>= 22.18.0`, 不因获取方式放宽 (依据与版本快照见 [ADR 0006](0006-dual-runtime-bun-first.md)「版本要求」)。

选择原因: 以最小代价解掉「只装 node 的机器在 npm 通道不可用」这一冲突, 只为分发加一条构建命令, 开发运行路径与单源码原则都不动; 分发产物是单文件 JS, 无平台分叉、无运行时捆绑。

> **适用边界（勿与 ADR 0006 的目标混读）**: 本 ADR 解决的是「只装 node 的机器跑不了源码形态」。安装通道对 node 的依赖须按**包管理器**区分 (实测: 入口文件的 shebang 是 node, 而 Unix 的 bin 是符号链接、执行时由内核读 shebang 选解释器, 应用层无法介入):
>
> - **`npm install -g`**: 需有 node (npm 用户必然满足)。
> - **`bun install -g`**: 同样生成指向本入口的符号链接, 故**同样需有 node**。
> - **`bunx <pkg>`**: **不生成符号链接、不经 shebang**, 由 bun 直接执行目标文件, 故**只有 bun 的机器可用** (本机实测: 在仅含 bun/bunx 的 PATH 下 `bunx cowsay@1.6.0` 正常运行, 该包 shebang 同为 node)。
> - **从源码**: sh / cmd 启动器由系统 shell 执行, 装 bun 或 node 任一即可。
>
> ADR 0006「装任一运行时即可使用」的适用范围是**业务逻辑**与**从源码使用的入口**; npm / bun install 两个通道的运行时挑选 (Bun 优先) 只在入口被 node 启动之后生效。

## 后果与权衡妥协 (Consequences & Trade-offs)

**正面收益**

- npm 安装后业务逻辑在 Bun / Node 双运行时下均可用 (入口由 node 启动, 之后仍按 Bun 优先挑选运行时), 与仓库内开发态同源 (同一份 `src/cli.ts` 派生);
- 构建面只有一条 `bun build` 命令, 无打包配置文件、无依赖树。

**权衡妥协**

- 产物需在发布前重建, `prepublishOnly` 已绑定, 漏跑即发出旧产物;
- 「零构建」的表述从此需带限定: 零的是开发运行路径的构建, 不是分发链;
- 源码与产物之间存在潜在漂移面, v1 以发布前重建收敛, 不为它另设产物比对闸门。

## 验证方式与关联引用 (Validation & References)

**验证口径 (本次落地核验)**

1. `bun run build` 产出 `dist/cli.js`, `node dist/cli.js --help` 与 `bun dist/cli.js --help` 均可运行 (已实测);
2. `bin/sweep-nm.mjs` 在无产物的仓库态回退 `src/cli.ts`、在有产物的形态下走 `dist/cli.js`, 两种形态输出一致 (已实测);
3. `npm pack --dry-run` 的包清单含 `bin/sweep-nm.mjs` 与 `dist/cli.js` (已实测)。

**关联引用**

- 被局部取代的两处判断见 [ADR 0003](0003-zero-runtime-deps.md) 与 [ADR 0006](0006-dual-runtime-bun-first.md); 入口分轨见 [ADR 0007](0007-platform-portability.md)。
- 代码树与模块结构见 [设计总纲](../designs/sweep-node-modules-design.md); 文档命名约定见 [docs/README](../README.md)。
