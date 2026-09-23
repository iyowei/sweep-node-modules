# sweep-node-modules

工作区级 `node_modules` 清理工具: 一次扫描多个根目录, 跨项目列出各处 `node_modules` 与体积, 确认后批量删除, 回收磁盘空间。

> 分层说明: 单项目清理工具管「进入某个项目, 清它自己的产物」; 本工具管「站在工作区层面, 一次清理很多个项目」。两者分层共存, 见 [ADR 0001](docs/adrs/0001-workspace-level-cleaner.md)。

## 要求

- 业务逻辑**双运行时**: 有 bun 走 bun, 否则 node (功能一致, bun 启动更快)。
- 取最新一代运行时 API: bun 任意近期版本; node 需原生支持 TypeScript 直跑的版本 (两种获取方式取同一版本下限; 版本快照与实测记录见 [ADR 0006](docs/adrs/0006-dual-runtime-bun-first.md))。
- 零第三方运行时依赖 (只用运行时内置能力)。
- 平台: Windows / macOS / Linux 三平台均可运行 (见 [ADR 0007](docs/adrs/0007-platform-portability.md))。

## 安装

三种方式, 按你机器上已有的运行时挑。**每条下的「需要」是硬门槛**:

### ① 免安装 (试用或偶尔用)

```shell
# 机器上有 bun
bunx @iyowei/sweep-node-modules

# 机器上有 node (npx 随 npm 一同安装, 本身就需要 node)
npx @iyowei/sweep-node-modules
```

- **需要**: bun 或 node, 与所选命令对应
- 特点: 零安装; 每次运行会解析一次包
- 注意: `bunx` 与 `npx` 各自依附一个运行时, 不是可互换的通用选项: 只有 bun 的机器没有 `npx`, 只有 node 的机器没有 `bunx`

### ② 包管理器全局安装 (常用推荐)

```shell
npm install -g @iyowei/sweep-node-modules
bun install -g @iyowei/sweep-node-modules
```

- **需要**: **node** (两条命令都要)。npm 本身跑在 node 上; `bun install -g` 生成的是指向入口文件的符号链接, 执行时由系统内核读该文件的 shebang (node) 来决定解释器, 应用层插不上手
- 特点: 装一次后直接敲 `sweep-nm`; 有 bun 时业务逻辑仍优先走 bun
- **机器上只有 bun、且不想装 node**: 请走 ① 或 ③

### ③ 从源码 (开发, 或无 node 环境)

```shell
chmod +x bin/sweep-nm

# 软链进 ~/.local/bin, 启动器会挑选运行时 (Bun 优先, Node 回退)
ln -sf "$HOME/self/development/sweep-node-modules/bin/sweep-nm" ~/.local/bin/sweep-nm
```

- **需要**: bun 或 node 任一 (启动器是 shell 脚本, 由系统 shell 执行, 不依赖 node)
- 特点: 入口最直接; Windows 用户入口为 `bin\sweep-nm.cmd`

## 使用

```shell
# 预览: 列出配置中各根目录下所有 node_modules 与体积, 不动手
sweep-nm

# 复核无误后执行删除
sweep-nm --yes

# 临时追加排除(可重复)
sweep-nm --exclude my-kits --exclude url-tool

# 只清理名单命中的目录(可重复, 与配置合并)
sweep-nm --include my-kits

# 初始化向导: 交互式生成配置文件
sweep-nm init
```

清单顶栏尾部会标注本次实际使用的运行时 (如 `bun 1.4.2`), 仅交互终端显示 (非 TTY 不增噪音)。

## 配置

配置文件位置 (平台自适应): Windows 为 `%APPDATA%\sweep-node-modules\config.json`, 其余为 `~/.config/sweep-node-modules/config.json`; 可用 `--config` 或环境变量 `SWEEP_NM_CONFIG` 覆盖。

```json
{
  "roots": [
    "/Users/iyowei/workspace/development",
    "/Users/iyowei/self/development"
  ],
  "exclude": ["my-kits"],
  "include": []
}
```

- `roots`: 扫描根目录, 任意多个; 重复或嵌套的根按真实路径去重。
- `exclude`: 排除名单; 从根到 `node_modules` 的任意一级目录名命中即跳过 (多排除 = 少删, 安全方向)。
- `include`: 包含名单 (白名单); 命中才纳入, 口径与 `exclude` 同款; 缺省或空数组 = 不过滤 (多包含 = 多删); 与 `exclude` 同时命中时 `exclude` 优先。写错名字会让结果直接为空, 故未命中的名字会在 stderr 警示。
- 两份名单里的 `node_modules` 一律被剔除: 它就是本工具的目标, 列入排除等于排掉唯一目标, 列入包含则永久零命中; 剔除后 `include` 为空数组 = 不过滤 (不是「只扫 node_modules」)。
- 首次运行且无配置: 交互终端下自动进入初始化向导 (扫描根默认家目录); 非交互环境 (脚本等) 以当前工作目录为根并提示, 不询问; 随时可用 `sweep-nm init` 重进向导。

> 字段定义以[设计文档](docs/designs/config-and-initialization.md)为准。

## 开发

```shell
bun install        # 安装 devDependencies, 并自动装好 git 钩子 (lefthook)

bun run typecheck  # tsc --noEmit
bun run lint       # oxlint
bun run format     # prettier --write
bun test           # bun test (契约 / 鲁棒 / 压测 / 双载体 e2e / 伪终端冒烟)
bun run bench      # 基准四组 (扫描 / 体积 / 真实工作区 / 压测)
bun run conformance -- --target "bun src/cli.ts"  # 转写一致性验收 (金样本语料见 docs/protocol/)
bun run build      # 打包单文件 dist/cli.js (npm 分发的编译产物; 发布时由 prepublishOnly 自动跑)
```

运行时双跑验证: `bun src/cli.ts` 与 `node src/cli.ts` 均可直接运行。

提交与推送由 lefthook 把关: pre-commit 增量 (prettier 重暂存 + oxlint + 全量类型检查), pre-push 全量只读 (typecheck / test / oxlint / prettier `--check`)。

## 文档

- [工程技术文档总索引](docs/README.md)
