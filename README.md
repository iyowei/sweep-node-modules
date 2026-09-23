# sweep-node-modules

工作区级 `node_modules` 清理工具: 一次扫描多个根目录, 跨项目列出各处 `node_modules` 与体积, 确认后批量删除, 回收磁盘空间。

> 分层说明: `@atom/cli-cleaner` 一类工具管「进入某个项目, 清它自己的产物」; 本工具管「站在工作区层面, 一次清理很多个项目」。两者分层共存, 见 [ADR 0001](docs/adrs/0001-workspace-level-cleaner.md)。

## 要求

- [bun](https://bun.sh) 运行时 (零第三方依赖, 只用内置能力)。

## 安装

```shell
chmod +x src/cli.ts

# 软链进 ~/.local/bin, 命令名取短变体
ln -sf "$HOME/self/development/sweep-node-modules/src/cli.ts" ~/.local/bin/sweep-nm
```

## 使用

```shell
# 预览: 列出配置中各根目录下所有 node_modules 与体积, 不动手
sweep-nm

# 复核无误后执行删除
sweep-nm --yes

# 临时追加排除(可重复)
sweep-nm --exclude fiu-kits --exclude shortime

# 初始化向导: 交互式生成配置文件
sweep-nm init
```

## 配置

配置文件: `~/.config/sweep-node-modules/config.json`

```json
{
  "roots": [
    "/Users/iyowei/rongmai/development",
    "/Users/iyowei/self/development"
  ],
  "exclude": ["fiu-kits"]
}
```

- `roots`: 扫描根目录, 任意多个; 重复或嵌套的根按真实路径去重。
- `exclude`: 排除名单; 从根到 `node_modules` 的任意一级目录名命中即跳过 (多排除 = 少删, 安全方向)。
- 首次运行且无配置: 交互终端下自动进入初始化向导; 非交互环境 (脚本等) 以当前工作目录为根并提示, 不询问; 随时可用 `sweep-nm init` 重进向导。

## 文档

- [工程技术文档总索引](docs/README.md)
