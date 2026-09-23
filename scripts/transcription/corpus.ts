/**
 * 转写契约套件 · 语料层。
 *
 * 职责: 语料字段类型 (与 docs/protocol/conformance/corpus.schema.json 对应) + $FIXTURE 变量替换
 * 契约 + 目录加载与手写校验。字段语义以 schema 为准; 本模块的手写校验是 schema 的物化子集,
 * 只为尽早给出可读报错, 不复刻 schema 的全部约束。
 */
import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

// ---------------------------------------------------------------------------
// 语料类型 (与 corpus.schema.json 对应)
// ---------------------------------------------------------------------------

export interface ProjectSpec {
  dir: string;
  files?: number;
  bytesPerFile?: number;
  nested?: boolean;
  git?: boolean;
}

export interface SymlinkSpec {
  at: string;
  to: string;
}

export interface FixtureSpec {
  projects?: ProjectSpec[];
  symlinks?: SymlinkSpec[];
  unreadable?: string[];
  /** 只读目录 (chmod 0500): 可读可进入、不可写, 供删除失败 / 部分删除类用例 */
  readonly?: string[];
}

export interface SetupStep {
  write: { path: string; text: string };
}

export interface RunSpec {
  argv?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export type FsState = 'gone' | 'exists' | 'empty';

export interface FsExpectation {
  path: string;
  state: FsState;
}

export interface ExpectSpec {
  exitCode: number;
  stdoutExact?: string;
  stdoutContains?: string[];
  /** 「不该出现」面: 剪枝 / 排除 / 诱饵类用例的禁含断言 */
  stdoutMustNotContain?: string[];
  stderrContains?: string[];
  fs?: FsExpectation[];
}

export interface CorpusCase {
  id: string;
  specRefs: string[];
  fixture: FixtureSpec;
  setup?: SetupStep[];
  run: RunSpec;
  expect: ExpectSpec;
}

// ---------------------------------------------------------------------------
// 变量替换契约 ($FIXTURE)
// ---------------------------------------------------------------------------

/** 语料中的 fixture 根变量 (字符串字段内出现即替换为 realpath 形态的绝对路径) */
export const FIXTURE_VAR = '$FIXTURE';

/** 字符串字段的变量替换 (仅 $FIXTURE 一个变量, 保持最小面) */
export const applyVars = (text: string, root: string): string =>
  text.split(FIXTURE_VAR).join(root);

// ---------------------------------------------------------------------------
// 手写校验 (schema 的物化子集)
// ---------------------------------------------------------------------------

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SPEC_REF_PATTERN = /^[A-Z]{2,4}-[0-9]+$/;

/** 相对路径判定: 非空、非绝对 (含 win 盘符)、不含反斜杠与 '..' 段 */
function isSafeRelPath(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false;
  if (isAbsolute(value) || /^[a-zA-Z]:/.test(value)) return false;
  if (value.includes('\\')) return false;
  return !value.split('/').includes('..');
}

/** 校验单条 fixture.projects 项 (抽出以压平嵌套深度; 报错文案与顺序与内联时一致) */
function validateProjectEntry(
  item: unknown,
  index: number,
  problems: string[],
): void {
  const project = asRecord(item);
  if (project === null || !isSafeRelPath(project.dir)) {
    problems.push(`fixture.projects[${index}].dir 须为相对路径`);
    return;
  }
  for (const key of ['files', 'bytesPerFile'] as const) {
    const value = project[key];
    if (
      value !== undefined &&
      (!Number.isInteger(value) || (value as number) < 0)
    ) {
      problems.push(`fixture.projects[${index}].${key} 须为非负整数`);
    }
  }
}

function validateFixture(fixture: unknown, problems: string[]): void {
  const record = asRecord(fixture);
  if (record === null) {
    problems.push('fixture 缺失或不是对象');
    return;
  }
  const projects = record.projects;
  if (projects !== undefined) {
    if (!Array.isArray(projects)) {
      problems.push('fixture.projects 须为数组');
    } else {
      for (const [index, item] of projects.entries()) {
        validateProjectEntry(item, index, problems);
      }
    }
  }
  const symlinks = record.symlinks;
  if (symlinks !== undefined) {
    if (!Array.isArray(symlinks)) {
      problems.push('fixture.symlinks 须为数组');
    } else {
      for (const [index, item] of symlinks.entries()) {
        const link = asRecord(item);
        if (
          link === null ||
          !isSafeRelPath(link.at) ||
          !isSafeRelPath(link.to)
        ) {
          problems.push(`fixture.symlinks[${index}] 的 at / to 须为相对路径`);
        }
      }
    }
  }
  const unreadable = record.unreadable;
  if (unreadable !== undefined) {
    if (!Array.isArray(unreadable) || !unreadable.every(isSafeRelPath)) {
      problems.push('fixture.unreadable 须为相对路径数组');
    }
  }
  const readonly = record.readonly;
  if (readonly !== undefined) {
    if (!Array.isArray(readonly) || !readonly.every(isSafeRelPath)) {
      problems.push('fixture.readonly 须为相对路径数组');
    }
  }
}

function validateSetup(setup: unknown, problems: string[]): void {
  if (setup === undefined) return;
  if (!Array.isArray(setup)) {
    problems.push('setup 须为数组');
    return;
  }
  for (const [index, item] of setup.entries()) {
    const step = asRecord(item);
    const write = step === null ? null : asRecord(step.write);
    if (
      write === null ||
      !isSafeRelPath(write.path) ||
      typeof write.text !== 'string'
    ) {
      problems.push(
        `setup[${index}] 须为 { write: { path: 相对路径, text: 字符串 } }`,
      );
    }
  }
}

function validateRun(run: unknown, problems: string[]): void {
  const record = asRecord(run);
  if (record === null) {
    problems.push('run 缺失或不是对象');
    return;
  }
  const argv = record.argv;
  if (
    argv !== undefined &&
    (!Array.isArray(argv) || !argv.every((item) => typeof item === 'string'))
  ) {
    problems.push('run.argv 须为字符串数组');
  }
  const env = record.env;
  if (env !== undefined) {
    const envRecord = asRecord(env);
    if (
      envRecord === null ||
      !Object.values(envRecord).every((item) => typeof item === 'string')
    ) {
      problems.push('run.env 须为字符串值对象');
    }
  }
  if (record.cwd !== undefined && !isSafeRelPath(record.cwd)) {
    problems.push('run.cwd 须为相对路径');
  }
}

function validateExpect(expect: unknown, problems: string[]): void {
  const record = asRecord(expect);
  if (record === null) {
    problems.push('expect 缺失或不是对象');
    return;
  }
  if (!Number.isInteger(record.exitCode)) {
    problems.push('expect.exitCode 须为整数 (必填)');
  }
  if (
    record.stdoutExact !== undefined &&
    typeof record.stdoutExact !== 'string'
  ) {
    problems.push('expect.stdoutExact 须为字符串');
  }
  for (const key of [
    'stdoutContains',
    'stdoutMustNotContain',
    'stderrContains',
  ] as const) {
    const value = record[key];
    if (
      value !== undefined &&
      (!Array.isArray(value) ||
        !value.every((item) => typeof item === 'string'))
    ) {
      problems.push(`expect.${key} 须为字符串数组`);
    }
  }
  const fs = record.fs;
  if (fs !== undefined) {
    if (!Array.isArray(fs)) {
      problems.push('expect.fs 须为数组');
    } else {
      for (const [index, item] of fs.entries()) {
        const entry = asRecord(item);
        const state = entry === null ? undefined : entry.state;
        if (
          entry === null ||
          !isSafeRelPath(entry.path) ||
          !['gone', 'exists', 'empty'].includes(String(state))
        ) {
          problems.push(
            `expect.fs[${index}] 须为 { path: 相对路径, state: gone|exists|empty }`,
          );
        }
      }
    }
  }
}

/** 校验单条 case; 返回问题清单 (空数组即通过) */
export function validateCase(data: unknown): string[] {
  const problems: string[] = [];
  const record = asRecord(data);
  if (record === null) return ['case 顶层须为 JSON 对象'];

  if (typeof record.id !== 'string' || !ID_PATTERN.test(record.id)) {
    problems.push('id 缺失或不合 kebab-case 形态 (小写字母数字与 -)');
  }
  const refs = record.specRefs;
  if (
    !Array.isArray(refs) ||
    refs.length === 0 ||
    !refs.every(
      (item) => typeof item === 'string' && SPEC_REF_PATTERN.test(item),
    )
  ) {
    problems.push(
      'specRefs 须为非空数组, 元素为条款编号形态 (如 BC-3 / OF-1 / EC-12)',
    );
  }
  validateFixture(record.fixture, problems);
  validateSetup(record.setup, problems);
  validateRun(record.run, problems);
  validateExpect(record.expect, problems);
  return problems;
}

/**
 * 读语料目录下全部 .json (按文件名升序, 执行次序确定)。
 * 任一文件非法即抛错 (语料缺陷属于 runner 级错误, 不降级为用例失败)。
 *
 * ### 数据追踪示例
 * ```text
 * Input（真实 Payload）
 *   dir = 'docs/protocol/conformance/corpus' (含 scan-nested-prune.json 与 delete-execute-ok.json)
 *
 * 步骤 1：取 .json 文件名并排序
 *   names = ['delete-execute-ok.json', 'scan-nested-prune.json']
 *
 * 步骤 2：逐文件 JSON 解析 + validateCase + 文件名/id 一致性 + id 唯一性
 *   全部通过 → cases = [两条 case 对象]
 *
 * Output（数据契约）
 *   return 按文件名的 case 数组; 任一环节失败即 throw (调用方落退出码 2)
 * ```
 */
export async function loadCorpus(dir: string): Promise<CorpusCase[]> {
  let names: string[];
  try {
    names = (await readdir(dir))
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch (error) {
    throw new Error(`语料目录不可读: ${dir} (${(error as Error).message})`);
  }
  if (names.length === 0) {
    throw new Error(
      `语料目录没有 .json 用例: ${dir} (空语料按 runner 级错误处理, 退 2 不假绿; 约定见 corpus/README.md)`,
    );
  }

  const cases: CorpusCase[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const file = join(dir, name);
    const text = await readFile(file, 'utf8');
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error(
        `语料非法 (${name}): JSON 解析失败: ${(error as Error).message}`,
      );
    }
    const problems = validateCase(data);
    if (problems.length > 0) {
      throw new Error(`语料非法 (${name}):\n  - ${problems.join('\n  - ')}`);
    }
    const caseSpec = data as CorpusCase;
    if (`${caseSpec.id}.json` !== name) {
      throw new Error(
        `语料非法 (${name}): 文件名须与 id 一致 (期望 ${caseSpec.id}.json)`,
      );
    }
    if (seen.has(caseSpec.id)) {
      throw new Error(`语料非法 (${name}): id 重复: ${caseSpec.id}`);
    }
    seen.add(caseSpec.id);
    cases.push(caseSpec);
  }
  return cases;
}
