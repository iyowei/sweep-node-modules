# 金样本语料 (corpus)

> 状态: **40 条**金样本, bun / node 双载体 40/40 全绿; 变异自证 6/6
> (覆盖与自证结果详见 [`../coverage.md`](../coverage.md))。

## 抽取约定

- 一个文件一条用例, 文件名必须为 `<id>.json` (与 case 的 `id` 字段一致); 字段语义见
  [`../corpus.schema.json`](../corpus.schema.json), 设计原则三条: fixture 声明式 / env 白名单 / expect 四件套。
- 每条 `specRefs` 非空且指向 `../behavior-contract.md` 契约里的真实条款 (形态如 `BC-03` / `OF-01` / `EC-02`);
  期望必须能由条款原文 + fixture 尺寸推演辩护, **严禁「跑一遍记下来」式捕获** (忠于规则不忠于实现)。
- 字符串字段内用 `$FIXTURE` 引用 fixture 根 (realpath 形态绝对路径), 例: `"SWEEP_NM_CONFIG": "$FIXTURE/config.json"`。
  运行器会把被测进程的 `HOME` 指向 `$FIXTURE/home`:
  - 想让路径在清单里显示为 `~` 前缀, 把项目放进 `$FIXTURE/home/` 下 (见 `render-path-tilde`);
  - 其余位置 (如 `$FIXTURE/zone/a`) 不会被缩写, 期望文本可安全地用 `$FIXTURE` 变量书写。
- 非 TTY 路径 100% 可字节级确定: 格式类用例首选 `stdoutExact` (体积数字按 du 块口径推演);
  行为类用例可用 `stdoutContains` + `stdoutMustNotContain` 组合降低环境耦合。
- 体积数字依赖文件系统块大小 (本机 APFS 4096 块: 文件向上取整、目录不计); **跨平台复跑须按块口径重校准**,
  属已登记的已知风险。

## 运行

```bash
bun scripts/transcription/run-conformance.ts --target "bun src/cli.ts"                  # bun 载体全量
bun scripts/transcription/run-conformance.ts --target "node src/cli.ts"                 # node 载体全量
bun scripts/transcription/run-conformance.ts --target "bun src/cli.ts" --filter scan-   # 按 id 子串筛选
bun scripts/transcription/run-conformance.ts --target "bun scripts/transcription/mutants/gen-<id>/src/cli.ts"   # 变异自证 (预期有失败)
```
