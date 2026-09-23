# ADR 0003: bun + TypeScript 零运行时依赖

> **状态**: 已接受 (Accepted)
> **日期**: 2026-09-23
> **决策者**: 沈委
> **标签**: [工程]
> **影响范围**: [全项目]

## 上下文与问题陈述 (Context & Problem)

个人工具需要「随手可用、易改即生效」: 本机日常以 bun 为运行时; 工具在寿命内会被反复微调 (排除名单、输出样式), 每次改动都走构建或安装流程会显著拖慢节奏。

## 被放弃的替代方案 (Options Considered & Rejected)

**[npm 全局安装分发 (cli-cleaner 的形态)]**

放弃理由: 全局安装把工具自身装进某个 `node_modules`, 对「删除 `node_modules` 为职责」的工具是结构性尴尬 (cli-cleaner 在 Windows 上就有「删到自己运行中的目录」而报 EPERM 的记录); 个人工具也没有分发需求。

**[编译独立二进制 (`bun build --compile`)]**

放弃理由: 每一步改动都要重新编译; 在本机已常驻 bun 的前提下, shebang 直跑 TypeScript 已完全够用, 编译是多余的仪式。

**[延续旧项目的老栈 (node + babel + mocha 那套)]**

放弃理由: 那是当年运行时约束下的方案 (如 `flatten-folder-cli`); 现代 bun 免构建直跑 TS 且内置测试, 无需延续。

## 决策结论与选择原因 (Decision & Why)

1. **运行时与语言**: bun + TypeScript, 源码直跑。
2. **零运行时依赖**: 只用 bun / Node 内置能力 (文件系统、子进程、`bun test`), 不引第三方包 (ANSI 颜色与参数解析手写)。
3. **安装形态**: 入口 `src/cli.ts` 带 `#!/usr/bin/env bun`, `chmod +x` 后软链进 `~/.local/bin/sweep-nm` (用户级 CLI 软链统一放 `~/.local/bin`)。

选择原因: 零依赖让工具没有供应链面与升级负担; shebang 软链实现「改完即生效」, 无构建步骤。

## 后果与权衡妥协 (Consequences & Trade-offs)

**正面收益**

- 无构建步骤, 无依赖升级, 无锁文件漂移。
- 代码全部是业务逻辑, 评审面小。

**权衡妥协**

- 依赖本机已装 bun (个人单机自用, 可接受)。
- 参数解析与颜色输出需手写少量样板 (规模可控)。

## 验证方式与关联引用 (Validation & References)

**验证口径 (实现落地后核验)**

1. `bun test` 全量通过;
2. 软链命令 `sweep-nm --help` 与预览模式实跑通过。

**关联引用**

- 软链路径约定同源: `~/.local/bin` 为用户级 CLI 软链统一点。
- 定位见 [ADR 0001](0001-workspace-level-cleaner.md)。
