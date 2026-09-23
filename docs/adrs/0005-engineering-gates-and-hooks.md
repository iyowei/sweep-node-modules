# ADR 0005: 工程闸门与提交钩子

> **状态**: 已接受 (Accepted)
> **日期**: 2026-09-23
> **决策者**: 沈委
> **标签**: [工程]
> **影响范围**: [全项目]

## 上下文与问题陈述 (Context & Problem)

项目需要一套与既有个人项目一致的工程闸门: 格式、Lint、类型检查挂在提交路径上自动执行, 不依赖人记着手动跑; 且本地钩子要覆盖到 push 前的全量兜底。参考实现: `fiu-kits` 与 `buffett`, 两者均采用 lefthook + 「pre-commit 增量 / pre-push 全量只读」的分层结构。

## 被放弃的替代方案 (Options Considered & Rejected)

**[纯手动跑校验, 不装钩子]**

放弃理由: 依赖纪律而非常态, 格式与 Lint 债务会在「先欠着」中累积; 参考项目的实践正是把校验挂上提交路径。

**[husky + lint-staged]**

放弃理由: 参考项目统一用 lefthook (单二进制、并行控制、`stage_fixed` 原语、glob 过滤), 不引第二套钩子体系制造生态分裂。

**[只设 pre-commit, 不设 pre-push]**

放弃理由: rebase / merge / cherry-pick 重放的提交不触发 pre-commit, base 的改动会让代码产生「语义冲突」(如 import 失配); push 是代码外流的唯一必经闸门, 必须有全量只读兜底。

## 决策结论与选择原因 (Decision & Why)

1. **钩子框架 lefthook**, `prepare` 按 CI 安全形态安装: `[ -z "$CI" ] && lefthook install || true` (取自 buffett)。
2. **Lint 用 oxlint, 格式用 prettier** (配 `@trivago/prettier-plugin-sort-imports` 的 import 排序); `.oxlintrc.json` 锚定 fiu-kits 规则集 (max-depth / max-lines / import 族 / unicorn 族等)。
3. **分层门禁**: pre-commit 增量 (prettier `--write` 后自动重暂存 + oxlint 只扫暂存文件; type-check 例外, 不传 `{staged_files}` 全项目 `tsc --noEmit`); pre-push 全量只读 (typecheck / test / oxlint / prettier `--check`, 不设 `stage_fixed`)。
4. **`.editorconfig`** 与两个参考项目一致: 2 空格 / LF / UTF-8 / 去行尾空格 / 文件末换行, `*.md` 例外不去尾空格。
5. **依赖版本精确锁定**: 全部 devDependencies 无 `^` / `~` 范围符号, 安装后从 `node_modules` 回读实装版本校准 (见配置治理规范)。

选择原因: 三个仓库同一套闸门结构与心智; `stage_fixed` 让「格式化 → 重暂存」自动化; pre-push 只读全量补齐 rebase 盲区。

## 后果与权衡妥协 (Consequences & Trade-offs)

**正面收益**

- 提交路径自动挡下格式 / Lint / 类型问题; push 前全量兜底防重放提交的语义冲突。
- 与 fiu-kits / buffett 同构, 维护心智一致, 配置可直接对照。

**权衡妥协**

- 每次提交多几秒检查耗时 (项目规模小, 可忽略)。
- 继承 fiu-kits 的严档规则集 (max-lines 450 / max-depth 4 等), 实现代码须按此规模切分。

## 验证方式与关联引用 (Validation & References)

**验证口径 (本次落地核验)**

1. `bun install` 触发 `prepare`, pre-commit / pre-push 钩子安装到位;
2. `bunx tsc --noEmit`、`bunx oxlint`、`bunx prettier --check` 全绿; `bun test` 的核验随实现批次落地 (此前无测试文件, 对空测试集报错属占位阶段预期);
3. 六个 devDependencies 实装版本与 lock 声明逐一吻合。

**关联引用**

- 依赖与构建策略见 [ADR 0003](0003-zero-runtime-deps.md)。
- 门禁的操作级细节以仓库根 `lefthook.yml`、`.oxlintrc.json`、`.prettierrc`、`.editorconfig` 为准, 本条不复述。
