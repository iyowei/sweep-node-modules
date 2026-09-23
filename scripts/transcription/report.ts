/**
 * 转写契约套件 · 报告层。
 *
 * 职责: 定义用例报告的数据结构 (FailureItem / CaseReport) 与人读 / JSON 两种渲染。
 * 报告字段与 JSON 形状是对外契约面 (转写方按它对照缺口), 只增不改。
 */

export interface FailureItem {
  /**
   * 断言类别 (枚举, 由 compare.ts 产出; 新增断言原语时须同步本行):
   * timeout | spawn | exitCode | stdoutExact | stdoutContains | stderrContains
   * | stdoutMustNotContain | stderrMustNotContain | fs
   */
  kind: string;
  /** 单行摘要 (面向人读) */
  message: string;
  /** stdoutExact 失败时的期望 / 实际全文, 供 diff 工具消费 */
  expected?: string;
  actual?: string;
}

export interface CaseReport {
  id: string;
  specRefs: string[];
  status: 'pass' | 'fail';
  durationMs: number;
  failures: FailureItem[];
  /** 失败时的 stdout / stderr 原文 (诊断附件; 通过时为 undefined, 避免报告膨胀) */
  diagnostics?: { stdout: string; stderr: string };
}

/** 行内容裁剪 (失败摘要保持单行可读) */
export const clip = (text: string, max = 120): string =>
  text.length <= max ? text : `${text.slice(0, max)}…`;

export function printHumanReport(
  corpusDir: string,
  target: string,
  reports: CaseReport[],
): void {
  const lines: string[] = [];
  lines.push(`转写一致性验收 (target: "${target}" · 语料: ${corpusDir})`);
  lines.push('');
  for (const report of reports) {
    const mark = report.status === 'pass' ? '✓' : '✗';
    lines.push(
      `  ${mark} ${report.id}  [${report.specRefs.join(', ')}] ${report.durationMs}ms`,
    );
    for (const failure of report.failures) {
      lines.push(`      ${failure.message}`);
    }
    if (
      report.diagnostics !== undefined &&
      report.diagnostics.stderr.trim() !== ''
    ) {
      lines.push(
        `      [stderr] ${clip(report.diagnostics.stderr.trim(), 300)}`,
      );
    }
  }
  const failed = reports.filter((report) => report.status === 'fail').length;
  lines.push('');
  lines.push(
    `合计 ${reports.length} 条: ${reports.length - failed} 通过, ${failed} 失败`,
  );
  process.stdout.write(`${lines.join('\n')}\n`);
}

export function printJsonReport(
  corpusDir: string,
  target: string,
  reports: CaseReport[],
): void {
  const failed = reports.filter((report) => report.status === 'fail').length;
  const payload = {
    target,
    corpusDir,
    total: reports.length,
    passed: reports.length - failed,
    failed,
    cases: reports,
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
