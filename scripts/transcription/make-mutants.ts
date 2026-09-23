/**
 * 变异生成器 (反向验收的自证件): 从 src/ 复制一份实现并注入单点缺陷, 生成到 mutants/gen-<id>/。
 *
 * 用途 (变异自证): 语料必须能抓住每一个 mutant; 抓不住 = 语料盲区 (或该 mutant 定义过弱),
 * 不是「实现没问题」。注入面见下方 MUTANTS 清单 (重跑纪律见 docs/protocol/README.md「维护规则」),
 * 每个 mutant 只做一行级补丁。
 *
 * 幂等: 每次重建自己的 gen-* 目录, 并清掉清单之外的陈旧 gen-*; 锚点失配 (源码在漂移) 时显式
 * 失败并报出文件, 严禁静默产出一份「没注入缺陷」的副本 (那会把反向验收变成永远绿的空转)。
 *
 * 用法: bun scripts/transcription/make-mutants.ts [--src <dir>] [--help]
 *   --src <dir>  被测源目录 (默认: 仓库根下 src/)
 *
 * 产物结构: mutants/gen-<id>/src/*.ts (注入后的实现) + mutants/gen-<id>/mutant.json (注入记录)。
 * 运行某 mutant: bun scripts/transcription/mutants/gen-<id>/src/cli.ts (与 --target 配合喂给 run-conformance.ts)。
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 仓库根 (scripts/transcription/ 上溯两级): 默认 src 与相对路径展示都以它为基准 */
const REPO_ROOT = resolve(HERE, '..', '..');
const DEFAULT_SRC_DIR = join(REPO_ROOT, 'src');

/** mutant 产物根 (本脚本独占命名空间; 其下 gen-* 已由 .gitignore 忽略) */
const MUTANTS_DIR = join(HERE, 'mutants');

/** 生成目录前缀 (本脚本的产物命名空间, 清理只动这个前缀) */
const GEN_PREFIX = 'gen-';

// ---------------------------------------------------------------------------
// mutant 清单 (每个 mutant 只注入一处; effect 与 expectCaughtBy 是变异自证时的核对依据)
// ---------------------------------------------------------------------------

interface PatchSpec {
  /** 源文件名 (src/ 下, 含 .ts) */
  file: string;
  /** 注入锚点: 必须在目标文件中恰好出现一次, 否则脚本失败 (源码漂移的显式信号) */
  find: string;
  replace: string;
  /** 这行补丁在行为面上的效果 (人读) */
  effect: string;
}

interface MutantSpec {
  id: string;
  title: string;
  /** 预期抓住它的语料类型; 变异自证时逐条核对 */
  expectCaughtBy: string;
  patches: PatchSpec[];
}

const MUTANTS: MutantSpec[] = [
  {
    id: 'prune-negated',
    title: '剪枝谓词取反',
    expectCaughtBy: '任一命中 node_modules 的用例 (stdoutExact / fs 断言)',
    patches: [
      {
        file: 'scan-parallel.ts',
        find: '        if (name === NODE_MODULES) {',
        replace: '        if (name !== NODE_MODULES) {',
        effect:
          '命中判定反转: 普通目录被当作命中记录并剪枝, node_modules 反被下钻, 清单全面错乱',
      },
    ],
  },
  {
    id: 'exit-swallowed',
    title: '退出码吞掉',
    expectCaughtBy:
      '期望 exitCode 为 1 的用例 (参数错误 / 配置损坏 / 删除失败 / 无配置 --yes)',
    patches: [
      {
        file: 'cli.ts',
        find: 'process.exitCode = await main();',
        replace: 'await main();',
        effect: 'main 的返回值被丢弃, 全部错误路径退出码退化为 0 (恒成功)',
      },
    ],
  },
  {
    id: 'sort-missing',
    title: '排序缺失',
    expectCaughtBy: '≥2 个命中的用例 (stdoutExact 逐字节比较), 或复现性三连跑',
    patches: [
      {
        file: 'scan-parallel.ts',
        find: '      const hits = [...hitsByRealTarget.values()].sort(compareTarget);',
        replace: '      const hits = [...hitsByRealTarget.values()];',
        effect:
          '命中序退化为并发完成序 (不确定), 与「按 target 升序」的输出契约相悖',
      },
    ],
  },
  {
    id: 'exclude-silent',
    title: '排除静默失效',
    expectCaughtBy:
      '使用 exclude (配置 exclude 或 --exclude) 的用例: 被排除子树重新出现在清单里',
    patches: [
      {
        file: 'scan-parallel.ts',
        find: '        if (exclude.has(name)) {',
        replace: '        if (false) {',
        effect:
          '排除判定被短路: 名单静默失效, 被排除子树照常扫出, 且无任何提示',
      },
    ],
  },
  {
    id: 'message-removed',
    title: '提示语删改',
    expectCaughtBy:
      '空结果用例 (stdoutExact / stdoutContains 对「未发现」文案的断言)',
    patches: [
      {
        file: 'render.ts',
        find: '`${NEUTRAL_BLOCK} 未发现 node_modules`',
        replace: '`${NEUTRAL_BLOCK} 无结果`',
        effect: '空结果中性提示文案被改, 用户面文案与契约不符',
      },
    ],
  },
  {
    id: 'size-unit-wrong',
    title: '体积计数单位错',
    expectCaughtBy:
      '带体积数字断言的用例; 注意: 仅 du 可用平台 (unix) 生效, Windows 走 js 候选时抓不住',
    patches: [
      {
        file: 'size-du.ts',
        find: '    sizes.set(path, Number(sizeKiB) * 1024);',
        replace: '    sizes.set(path, Number(sizeKiB) * 1000);',
        effect: 'du 的 Ki 单位换算错误 (1024 → 1000), 展示体积全线偏移',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

const HELP_TEXT = [
  '用法: bun scripts/transcription/make-mutants.ts [--src <dir>]',
  '',
  '  --src <dir>  被测源目录 (默认: <仓库根>/src)',
  '  --help       显示本帮助',
  '',
  '产出: mutants/gen-<id>/src/*.ts + mutants/gen-<id>/mutant.json (幂等重建)',
].join('\n');

/** 统计 needle 在 text 中的出现次数 (不重叠) */
function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

/** 找 needle 首次出现的行号 (从 1 起) */
const lineOf = (text: string, needle: string): number =>
  text.slice(0, text.indexOf(needle)).split('\n').length;

/** 取 src 下应复制的文件清单: 全部 .ts, 排除测试文件; 排序保证复制次序确定 */
async function listSourceFiles(srcDir: string): Promise<string[]> {
  const entries = await readdir(srcDir, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts'),
    )
    .map((entry) => entry.name)
    .sort();
}

interface AppliedPatch {
  file: string;
  anchorLine: number;
  find: string;
  replace: string;
  effect: string;
}

/**
 * 生成单个 mutant: 先清掉旧目录, 复制源文件, 再逐个应用补丁。
 * 外部副作用：删除并重建 mutants/gen-<id>/。
 *
 * ### 数据追踪示例
 * ```text
 * Input（真实 Payload）
 *   mutant = { id: 'exit-swallowed', patches: [{ file: 'cli.ts', find: 'process.exitCode = await main();', … }] }
 *   sourceFiles = ['cli.ts', 'config.ts', …] (src/ 下全部非测试 .ts)
 *
 * 步骤 1：重建目录并复制源码
 *   gen-exit-swallowed/src/ = 源文件全量副本
 *
 * 步骤 2：逐补丁校验锚点唯一后替换
 *   锚点出现 1 次 → 替换并记录 anchorLine (第 370 行)
 *
 * Output（数据契约）
 *   return 已注入的实现目录 + 注入记录 (写盘 mutant.json)
 * ```
 */
async function makeMutant(
  mutant: MutantSpec,
  srcDir: string,
): Promise<AppliedPatch[]> {
  const outDir = join(MUTANTS_DIR, `${GEN_PREFIX}${mutant.id}`);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, 'src'), { recursive: true });

  const files = await listSourceFiles(srcDir);
  for (const name of files) {
    await writeFile(
      join(outDir, 'src', name),
      await readFile(join(srcDir, name)),
    );
  }

  const applied: AppliedPatch[] = [];
  for (const patch of mutant.patches) {
    const target = join(outDir, 'src', patch.file);
    const text = await readFile(target, 'utf8');
    const occurrences = countOccurrences(text, patch.find);
    if (occurrences !== 1) {
      throw new Error(
        `mutant ${mutant.id}: 锚点失配 (${patch.file}, 出现 ${occurrences} 次, 期望 1 次): ${JSON.stringify(patch.find)}\n` +
          '  源码已漂移: 校准 --src 或更新 make-mutants.ts 里的锚点后重跑, 严禁带着失配继续。',
      );
    }
    const anchorLine = lineOf(text, patch.find);
    await writeFile(target, text.split(patch.find).join(patch.replace));
    applied.push({ ...patch, anchorLine });
  }

  const manifest = {
    id: mutant.id,
    title: mutant.title,
    expectCaughtBy: mutant.expectCaughtBy,
    sourceDir: srcDir,
    runHint: `bun ${join(MUTANTS_DIR, `${GEN_PREFIX}${mutant.id}`, 'src', 'cli.ts')}`,
    patches: applied,
  };
  await writeFile(
    join(outDir, 'mutant.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return applied;
}

/** 清掉清单之外的陈旧 gen-* 目录 (本脚本自己的产物命名空间, 不留垃圾) */
async function sweepStale(knownIds: Set<string>): Promise<string[]> {
  const removed: string[] = [];
  let entries;
  try {
    entries = await readdir(MUTANTS_DIR, { withFileTypes: true });
  } catch {
    return removed;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(GEN_PREFIX)) continue;
    if (knownIds.has(entry.name.slice(GEN_PREFIX.length))) continue;
    await rm(join(MUTANTS_DIR, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  let srcDir = DEFAULT_SRC_DIR;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${HELP_TEXT}\n`);
      return 0;
    }
    if (arg === '--src') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) {
        process.stderr.write(`参数错误: --src 缺少取值\n\n${HELP_TEXT}\n`);
        return 1;
      }
      srcDir = resolve(value);
      index += 1;
      continue;
    }
    process.stderr.write(`参数错误: 未知参数 ${arg}\n\n${HELP_TEXT}\n`);
    return 1;
  }

  try {
    await readdir(srcDir);
  } catch (error) {
    process.stderr.write(
      `源目录不可读: ${srcDir} (${(error as Error).message})\n`,
    );
    return 1;
  }

  const removed = await sweepStale(new Set(MUTANTS.map((mutant) => mutant.id)));
  for (const name of removed) {
    process.stdout.write(`清理陈旧产物: ${name}\n`);
  }

  for (const mutant of MUTANTS) {
    const applied = await makeMutant(mutant, srcDir);
    process.stdout.write(`gen-${mutant.id} (${mutant.title})\n`);
    for (const patch of applied) {
      process.stdout.write(
        `  ${patch.file}:${patch.anchorLine}  ${patch.effect}\n`,
      );
    }
  }

  process.stdout.write(
    `\n合计 ${MUTANTS.length} 个 mutant → ${join(MUTANTS_DIR, 'gen-*/src/cli.ts')}\n`,
  );
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
}
