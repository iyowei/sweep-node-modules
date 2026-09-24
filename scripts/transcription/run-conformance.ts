/**
 * 转写契约套件 · 确定性验收器 (conformance runner) 入口。
 *
 * 职责: 解析 CLI → 加载语料 → 逐条建 fixture 树、以最小白名单 env 执行被测命令、逐项比对、
 * 清理现场 → 汇总报告, 任一条失败即非零退出。纯程序、零 AI、零第三方依赖 (bun / node 直跑)。
 *
 * 模块划分 (同目录, 本文件只留 CLI 解析 / 编排 / 帮助):
 * - corpus.ts   语料类型、$FIXTURE 变量替换契约、目录加载与手写校验;
 * - fixture.ts  fixture 建树 / setup 预置 / 最小 env / 执行 / 清理;
 * - compare.ts  逐项比对 (退出码 / stdout 与 stderr 的子串含与禁含 / fs 终态);
 * - report.ts   报告数据结构与人读 / JSON 渲染。
 *
 * 语料权威: docs/protocol/conformance/corpus.schema.json (字段语义以 schema 为准; 手写校验是
 * schema 的物化子集, 只为尽早给出可读报错, 不复刻 schema 的全部约束)。
 *
 * 用法: bun scripts/transcription/run-conformance.ts --target "bun src/cli.ts" [--corpus <dir>] [--filter <id 子串>]
 *       [--timeout <ms>] [--json] [--keep] [--help]
 *
 * 退出码: 0 全部通过; 1 存在失败用例; 2 用法 / 语料 / 环境错误 (runner 自身问题, 非被测缺陷)。
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareCase } from './compare.ts';
import { type CorpusCase, loadCorpus } from './corpus.ts';
import {
  type ExecOutcome,
  type RunContext,
  applySetup,
  buildFixture,
  cleanupFixture,
  executeCase,
} from './fixture.ts';
import {
  type CaseReport,
  type FailureItem,
  printHumanReport,
  printJsonReport,
} from './report.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 默认语料目录: 语料的权威落点在协议区 (docs/protocol/conformance/corpus), 脚本不随身携带语料 */
const DEFAULT_CORPUS_DIR = join(
  HERE,
  '..',
  '..',
  'docs',
  'protocol',
  'conformance',
  'corpus',
);
const DEFAULT_TIMEOUT_MS = 15000;

interface CliOptions {
  target: string;
  corpusDir: string;
  filter?: string;
  timeoutMs: number;
  json: boolean;
  keep: boolean;
  help: boolean;
}

type ParseOutcome =
  { ok: true; options: CliOptions } | { ok: false; message: string };

// ---------------------------------------------------------------------------
// 命令行解析
// ---------------------------------------------------------------------------

const HELP_TEXT = [
  '用法: bun scripts/transcription/run-conformance.ts --target "<被测命令>" [选项]',
  '',
  '  --target <cmd>    被测进程命令 (如 "bun src/cli.ts" 或 "./sweep-nm"); 按空白拆分, 不支持含空格的路径',
  '  --corpus <dir>    语料目录 (默认: docs/protocol/conformance/corpus)',
  '  --filter <text>   只跑 id 含该子串的用例',
  '  --timeout <ms>    单条用例执行超时 (默认 15000), 到期即判失败 (超时守卫)',
  '  --json            输出结构化 JSON 报告 (stdout 仅 JSON, 诊断走 stderr)',
  '  --keep            保留 fixture 目录并打印路径 (调试用; 默认跑完即清理)',
  '  --help            显示本帮助',
  '',
  '退出码: 0 全部通过; 1 存在失败用例; 2 用法 / 语料 / 环境错误',
].join('\n');

/**
 * 解析参数: 仅支持 `--flag value` 与布尔旗标; 未知参数、缺值一律判错 (调用方落退出码 2)。
 *
 * ### 数据追踪示例
 * ```text
 * Input（真实 Payload）
 *   argv = ['--target', 'bun src/cli.ts', '--filter', 'scan-']
 *
 * 步骤 1：逐项识别
 *   --target 收值 'bun src/cli.ts'; --filter 收值 'scan-'; 其余取默认
 *
 * Output（数据契约）
 *   return { ok: true, options: { target: 'bun src/cli.ts', corpusDir: 'docs/protocol/conformance/corpus', filter: 'scan-', timeoutMs: 15000, json: false, keep: false, help: false } }
 * ```
 */
function parseArgs(argv: string[]): ParseOutcome {
  let target: string | undefined;
  let corpusDir = DEFAULT_CORPUS_DIR;
  let filter: string | undefined;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let json = false;
  let keep = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--keep') {
      keep = true;
      continue;
    }
    if (
      arg === '--target' ||
      arg === '--corpus' ||
      arg === '--filter' ||
      arg === '--timeout'
    ) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) {
        return { ok: false, message: `参数 ${arg} 缺少取值` };
      }
      if (arg === '--target') target = value;
      if (arg === '--corpus') corpusDir = value;
      if (arg === '--filter') filter = value;
      if (arg === '--timeout') {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          return {
            ok: false,
            message: `--timeout 须为正整数毫秒, 收到: ${value}`,
          };
        }
        timeoutMs = parsed;
      }
      index += 1;
      continue;
    }
    return { ok: false, message: `未知参数: ${arg}` };
  }

  if (help) {
    return {
      ok: true,
      options: {
        target: target ?? '',
        corpusDir,
        filter,
        timeoutMs,
        json,
        keep,
        help: true,
      },
    };
  }
  if (target === undefined || target.trim() === '') {
    return { ok: false, message: '缺少 --target (被测命令)' };
  }

  return {
    ok: true,
    options: { target, corpusDir, filter, timeoutMs, json, keep, help: false },
  };
}

/**
 * 把 target 命令里按启动目录写的相对路径绝对化。
 * 必要原因: 被测进程的 cwd 会被设为 fixture 目录 (用例可声明), 而 `--target "bun src/cli.ts"`
 * 里 `src/cli.ts` 是相对 runner 启动目录书写的; 不绝对化就会在 fixture cwd 下解析而找不到文件。
 * 规则保守: 只动 index >= 1 (argv[0] 是命令名, 留给 PATH 解析)、非旗标、且相对启动目录真实存在
 * 的路径串, 其余原样透传。
 */
function absolutizeTargetArgv(
  targetArgv: string[],
  launchDir: string,
): string[] {
  return targetArgv.map((part, index) => {
    if (index === 0 || isAbsolute(part) || part.startsWith('-')) return part;
    const candidate = resolve(launchDir, part);
    return existsSync(candidate) ? candidate : part;
  });
}

// ---------------------------------------------------------------------------
// 单条用例编排
// ---------------------------------------------------------------------------

/**
 * 跑一条用例: 建树 → setup → 执行 → 比对 → 清理 (keep 时保留现场)。
 * 外部副作用：fixture 目录的创建与删除 (keep 时仅创建)。
 */
async function runCase(
  caseSpec: CorpusCase,
  ctx: RunContext,
): Promise<CaseReport> {
  const startedAt = Date.now();
  const rawRoot = await mkdtemp(join(ctx.workBase, 'sweep-conformance-'));
  // realpath 归一: macOS 上 /var 与 /private/var 是同一位置的两种拼写, 统一用 realpath 形态
  // 作 $FIXTURE 的替换值, 使期望文本与 process.cwd() / realpath 化输出一致。
  const root = await realpath(rawRoot);
  let failures: FailureItem[] = [];
  let exec: ExecOutcome | undefined;

  try {
    await buildFixture(root, caseSpec.fixture);
    await applySetup(root, caseSpec.setup ?? []);
    exec = executeCase(caseSpec, root, ctx);
    failures = await compareCase(caseSpec.expect, exec, root);
  } finally {
    if (ctx.keep) {
      process.stderr.write(`[keep] fixture 保留于: ${root}\n`);
    } else {
      await cleanupFixture(rawRoot, caseSpec.fixture);
    }
  }

  return {
    id: caseSpec.id,
    specRefs: caseSpec.specRefs,
    status: failures.length === 0 ? 'pass' : 'fail',
    durationMs: Date.now() - startedAt,
    failures,
    ...(failures.length > 0 && exec !== undefined
      ? { diagnostics: { stdout: exec.stdout, stderr: exec.stderr } }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`参数错误: ${parsed.message}\n\n${HELP_TEXT}\n`);
    return 2;
  }
  const options = parsed.options;
  if (options.help) {
    process.stdout.write(`${HELP_TEXT}\n`);
    return 0;
  }

  const targetArgv = absolutizeTargetArgv(
    options.target.trim().split(/\s+/),
    process.cwd(),
  );
  let cases: CorpusCase[];
  try {
    cases = await loadCorpus(resolve(options.corpusDir));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 2;
  }

  const selected =
    options.filter === undefined
      ? cases
      : cases.filter((item) => item.id.includes(options.filter!));
  if (selected.length === 0) {
    process.stderr.write(
      `--filter "${options.filter}" 未匹配到任何用例 (合计 ${cases.length} 条)\n`,
    );
    return 2;
  }

  const workBase = join(homedir(), 'tmp');
  await mkdir(workBase, { recursive: true });
  const ctx: RunContext = {
    targetArgv,
    timeoutMs: options.timeoutMs,
    keep: options.keep,
    workBase,
  };

  const reports: CaseReport[] = [];
  for (const caseSpec of selected) {
    reports.push(await runCase(caseSpec, ctx));
  }

  if (options.json) printJsonReport(options.corpusDir, options.target, reports);
  else printHumanReport(options.corpusDir, options.target, reports);

  return reports.some((report) => report.status === 'fail') ? 1 : 0;
}

process.exitCode = await main();
