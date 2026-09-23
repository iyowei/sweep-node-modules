# 转写契约套件 (transcription kit)

> 用途: 在 TS 参考实现之外, 提供一套「精准转写工具包」: 未来以 Rust / C / 任意语言重写时, 以语言中立契约 + 金样本语料 + 确定性验收器保证等价实现可被机械验收; AI 只承担「按契约实施」的角色, 且被验收器兜底。
> 权威: 行为语义的出处是 `docs/designs/` 四份设计文档; 本目录是其面向「转写与验收」的编号化视图。

## 套件结构

| 件          | 位置                                                                                               | 说明                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 行为契约    | [`behavior-contract.md`](behavior-contract.md)                                                     | 编号条款 (BC-* / OF-* / EC-*), 语料 `specRefs` 的背书目标                                     |
| 语料 schema | [`conformance/corpus.schema.json`](conformance/corpus.schema.json)                                 | 金样本字段语义的权威 (验收器的手写校验是其物化子集)                                           |
| 金样本语料  | [`conformance/corpus/`](conformance/corpus/)                                                       | 40 条; 每条期望必须能由条款 + fixture 尺寸推演辩护                                            |
| 覆盖表      | [`conformance/coverage.md`](conformance/coverage.md)                                               | 条款 × 语料覆盖 + 变异自证结果                                                                |
| 验收器      | [`../../scripts/transcription/run-conformance.ts`](../../scripts/transcription/run-conformance.ts) | 确定性、零 AI、语言中立 (被测命令是参数)                                                      |
| 变异生成器  | [`../../scripts/transcription/make-mutants.ts`](../../scripts/transcription/make-mutants.ts)       | 反向验收自证件 (语料抓不住 mutant 即语料盲区)                                                 |
| 实施提示词  | [`prompts/`](prompts/)                                                                             | 辩证中正纪律: 角色 = 实施者; 未覆盖处停手报缺口; 只许等价不许「更优」; conformance 全绿才算完 |

## 用本套件转写一门新语言

1. 通读 [`behavior-contract.md`](behavior-contract.md) 与 `docs/designs/` 对应分册 (行为权威);
2. 按 [`prompts/common-discipline.md`](prompts/common-discipline.md) + 目标语言模板 ([`prompts/transcribe-rust.md`](prompts/transcribe-rust.md) 为范例) 实施;
   交付物 = 条款→代码映射表 + 缺口清单 + conformance 原始报告;
3. 以验收器对抗你的实现 (被测命令即你的可执行入口, 如 `./sweep-nm-rs`):

   ```bash
   bun scripts/transcription/run-conformance.ts --target "<你的可执行命令>"
   ```

   40 条全绿且快照类逐字节一致, 才算等价;

4. 语料抓不住你实现里的哪块, 不是「没问题」, 是语料盲区: 对照 [`conformance/coverage.md`](conformance/coverage.md) 的豁免理由逐条核对。

## 维护规则

- 语料**只增不改既有期望**; 改期望须先过「三向定责」(修语料 / 修契约 / 修实现), 并写明依据;
- 新增语料: 文件名 = `id`, `specRefs` 非空且指向真实条款, 期望可推演辩护;
- 重大改动后重跑反向验收: `bun scripts/transcription/make-mutants.ts` 生成 mutant, 逐个过验收器 (预期有失败);
- 体积数字口径依赖文件系统块大小 (本机 4096), 跨平台复跑前须按块口径重校准;
- 本套件与实现同批演进: 行为契约条款变更须同步语料与设计文档 (同一事实, 三处一致)。
