# 命令面与输出

> **状态**: 已定稿 (Accepted)
> **日期**: 2026-09-23
> **决策者**: 沈委
> **父文档**: [设计总纲](sweep-node-modules-design.md)

## 修订记录

| 日期       | 修订                                       |
| ---------- | ------------------------------------------ |
| 2026-09-23 | 输出规格升级为色块视觉规范 (紧凑式 + 色块) |

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

## 输出规格 (视觉规范: 紧凑式 + 色块)

设计语言: 少线多色块、紧凑排版, 零依赖手写 ANSI。示意:

```text
▍ SWEEP-NM  预览 · 2 个根
  █ 4.6 GB  hdapp        ~/rongmai/development/hdapp
  ▓ 1.6 GB  neuralfin    ~/rongmai/development/neuralfin
  ▒ 366 MB  xueyan       ~/rongmai/development/xueyan
  █ 合计 3 处 · 6.5 GB   加 `--yes` 执行删除
```

- 顶栏: 反色色块 + 模式 (预览 / 执行) + 根数量;
- 清单按体积降序; 每行: 体积档位色块 (大 / 中 / 小 三档) + 右对齐体积 + 项目名 (亮) + 路径 (暗);
- 末行合计色块 (处数 + 总量), 预览模式附 `--yes` 提示;
- 执行模式: 逐行删除结果色块 (成功 / 失败), 结尾汇总色块;
- 空结果: 中性色块提示「未发现 node_modules」, 退出码 0;
- 降级: 非 TTY / `NO_COLOR` / 终端能力不足 → 纯文本 (空格对齐, 零 ANSI), 信息不丢失 (见 [ADR 0007](../adrs/0007-platform-portability.md))。
