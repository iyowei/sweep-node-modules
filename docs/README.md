# sweep-node-modules 工程技术文档总索引

> 文档类型: 全工程技术文档总入口
> 适用对象: 本项目维护者与 AI Agent
> 范围说明: 本索引收录决策与设计类文档; 新增文档必须在本索引登记, 严禁产生散落的孤岛文档。
>
> 命名约定: `designs/` 下文件名不带日期, 文档修订在内容内以「修订记录」登记日期; ADR 按编号顺序追加, 已接受的决定不原地改写。

## 决策与模版

**架构决策记录**
[架构决策记录索引](adrs/README.md)
收录本项目演进过程中的重大单项技术决策 (ADRs) 及上下文权衡。

## 设计文档

**设计总纲**
[sweep-node-modules 设计总纲](designs/sweep-node-modules-design.md)
定位与成功标准、代码结构与运行时基座、测试策略、明确不做清单; 各设计块分册的索引入口。

**命令面与输出**
[命令面与输出](designs/cli-surface.md)
命令、旗标、退出码与清单渲染规格。

**配置与初始化**
[配置与初始化](designs/config-and-initialization.md)
配置文件规格、roots / exclude 语义与初始化向导。

**扫描与体积**
[扫描与体积](designs/scan-and-size.md)
目录遍历算法、剪枝与排除、体积统计与性能要点。

**删除安全闸**
[删除安全闸](designs/deletion-guard.md)
删除目标的合法性校验与执行语义。
