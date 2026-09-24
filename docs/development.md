# 开发指南

> 面向本仓库的维护者与贡献者。使用说明见根 [README](../README.md); 设计决策见 [设计文档索引](designs/README.md); 转写套件见 [转写契约](protocol/README.md)。

## 环境准备

```shell
# 装 devDependencies, 并自动装好 git 钩子 (lefthook)
bun install
```

## 常用命令

```shell
# 类型检查 (tsc --noEmit)
bun run typecheck

# 代码检查 (oxlint)
bun run lint

# 格式化 (prettier --write)
bun run format

# 单元测试 (契约 / 鲁棒 / 压测 / 双载体 e2e / 伪终端冒烟 / 启动器冒烟 等)
bun test

# 基准四组 (扫描 / 体积 / 真实工作区 / 压测)
bun run bench

# 转写一致性验收 (金样本语料见 docs/protocol/)
bun run conformance -- --target "bun src/cli.ts"

# 打包单文件 dist/cli.js (npm 分发的编译产物; 发布时由 prepublishOnly 自动跑)
bun run build
```

## 运行时双跑

`bun src/cli.ts` 与 `node src/cli.ts` 均可直接运行。**双运行时是项目的硬约束**, 改动须在两个载体上都验证, 而两个验证通道的行为不同:

- **单测**已参数化: e2e 用例按 `bun` / `node` 各注册一遍, 跑一次 `bun test` 即覆盖两侧, 且它在 pre-push 闸门内。**前提是机器上两个运行时都装了**: 缺哪一侧, 那一侧的用例会静默 skip, 整体仍显示全绿 (该 skip 是有意设计, 机制落点见 `src/cli.e2e.test.ts` 的 `RUNNERS` 与逐载体注册循环; 同类说明另见 `src/runtime.test.ts` 文件头), 故 bun-only 机器上闸门不构成 node 侧的把关;
- **转写验收不参数化**: `--target` 一次只收一个载体, 且**不在任何闸门内**: 改动了输出面就必须手动跑两遍, 都全通过才算数:

```shell
# bun 载体
bun run conformance -- --target "bun src/cli.ts"

# node 载体
bun run conformance -- --target "node src/cli.ts"
```

## 提交与推送

由 lefthook 把关 (操作级细节以仓库根 `lefthook.yml` 为准):

- **pre-commit** (增量): prettier 重暂存 + oxlint 扫暂存文件; 类型检查例外, 跑全项目 `tsc --noEmit`
- **pre-push** (全量只读): typecheck / test / oxlint / prettier `--check`

提交信息按 Conventional Commits 前缀 (`feat` / `fix` / `chore` / `test` 等), 并守单一主题原则: 一个提交只含一个完整逻辑变更, 跨主题须拆分。仓库目前没有 commit-msg 钩子强制该约定, 靠自觉。

## 相关文档

- [工程技术文档总索引](README.md)
- [设计文档索引](designs/README.md): 设计总纲与各分册
- [架构决策记录](adrs/README.md): ADR
- [转写契约套件](protocol/README.md): 编号行为契约与金样本语料
