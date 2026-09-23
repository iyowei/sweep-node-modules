# 命令面与输出

> **状态**: 已定稿 (Accepted)
> **日期**: 2026-09-23
> **决策者**: 沈委
> **父文档**: [设计总纲](sweep-node-modules-design.md)

## 命令面 (v1)

```text
sweep-nm                    预览: 清单 + 体积 + 合计, 零副作用
sweep-nm --yes              执行删除
sweep-nm --exclude <名字>   临时追加排除, 可重复
sweep-nm init               初始化向导: 交互式生成配置文件
sweep-nm --help             帮助
```

- 项目名 `sweep-node-modules`, 命令名取短变体 `sweep-nm` (仿 `flatten-folder-cli` → `flatten-folder` 的旧例)。
- **主命令 + 子命令形态**: 缺省 `sweep-nm` 即清理流程 (预览; 加 `--yes` 执行); `init` 为子命令, 承载初始化向导。子命令位只为工具自身的辅助动作保留, 不承载其他清理能力 (模拟器等另立兄弟项目)。
- 判定模型与执行模型见 [ADR 0002](../adrs/0002-fixed-config-and-preview-execution.md); 初始化向导的交互见 [配置与初始化](config-and-initialization.md)。

## 退出码

| 码  | 含义                                          |
| --- | --------------------------------------------- |
| 0   | 成功 (含预览、空结果)                         |
| 1   | 任一失败 (删除失败汇总 / 配置损坏 / 参数错误) |

## 输出规格

- 清单按体积降序; 每行: 体积 + 项目名 + 完整路径;
- 末行合计 (处数 + 总量);
- ANSI 色彩手写实现, 零依赖; 紧凑排版;
- 预览模式尾部提示「加 `--yes` 执行删除」;
- 空结果: 提示「未发现 node_modules」, 退出码 0。
