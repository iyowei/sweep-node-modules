/**
 * 体积统计契约测试: 同一套尺子参数化跑全部候选 (js / du)。
 * 口径差异 (js = 逻辑字节, du = 磁盘占用) 是已知且保留的设计差异, 契约不断言两者相等;
 * 结果三桶: entries (可测量) / unmeasured (存在但测不到) / warnings (非致命告警);
 * 「不存在」的路径跳过, 不入任何桶; du 候选依赖系统 du 探针, 探针缺失时整组按可用性跳过。
 */
import { afterEach, describe, expect, test } from 'bun:test';

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  type Workspace,
  type WorkspaceSpec,
  makeWorkspace,
} from './fixtures.ts';
import { createDuSizer, findDu } from './size-du.ts';
import { createJsSizer } from './size-js.ts';
import type { Sizer } from './types.ts';

interface Candidate {
  sizer: Sizer;
  /** 依赖系统 du 的候选: 探针缺失时整组跳过 */
  needsDu: boolean;
  /** 口径断言: js 精确等值 (逻辑字节); du 下界 (磁盘占用 ≥ 逻辑字节) */
  assertBytes(actual: number, logical: number): void;
}

/** 与 size-du 同一探针约定, 供 du 组可用性判定 */
const duAvailable = findDu() !== null;
const runningAsRoot =
  typeof process.getuid === 'function' && process.getuid() === 0;

const candidates: Candidate[] = [
  {
    sizer: createJsSizer(),
    needsDu: false,
    assertBytes(actual, logical) {
      expect(actual).toBe(logical);
    },
  },
  {
    sizer: createDuSizer(),
    needsDu: true,
    assertBytes(actual, logical) {
      expect(actual).toBeGreaterThanOrEqual(logical);
    },
  },
];

const workspaces: Workspace[] = [];
async function make(spec: WorkspaceSpec): Promise<Workspace> {
  const workspace = await makeWorkspace(spec);
  workspaces.push(workspace);
  return workspace;
}

afterEach(async () => {
  await Promise.all(workspaces.map((workspace) => workspace.cleanup()));
  workspaces.length = 0;
});

/** 断言取值: 目标元素缺失即抛错 (元素不存在属用例自身缺陷, 不得静默降级成 undefined) */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`断言目标缺失: 索引 ${index}`);
  return item;
}

for (const candidate of candidates) {
  const gate = candidate.needsDu && !duAvailable;
  const it = (name: string, fn: () => Promise<void>) =>
    test.skipIf(gate)(name, fn);

  describe(`size 契约 [${candidate.sizer.name}] · 通用`, () => {
    it('空输入: 空结果', async () => {
      const result = await candidate.sizer.measure([]);

      expect(result.entries).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.unmeasured).toEqual([]);
    });

    it('多 target: 与输入一一对应并按 target 升序', async () => {
      const { root } = await make({
        projects: [
          { dir: 'alpha', files: 3, bytesPerFile: 512 },
          { dir: 'beta', files: 1, bytesPerFile: 100 },
        ],
      });
      const alpha = join(root, 'alpha', 'node_modules');
      const beta = join(root, 'beta', 'node_modules');

      // 故意乱序传入, 输出必须稳定有序
      const result = await candidate.sizer.measure([beta, alpha]);

      expect(result.entries.map((entry) => entry.target)).toEqual([
        alpha,
        beta,
      ]);
      expect(result.warnings).toEqual([]);
      expect(result.unmeasured).toEqual([]);
      candidate.assertBytes(at(result.entries, 0).bytes, 3 * 512);
      candidate.assertBytes(at(result.entries, 1).bytes, 1 * 100);
    });

    it('嵌套 node_modules: 内层体积计入外层 target', async () => {
      const { root } = await make({
        projects: [{ dir: 'alpha', files: 2, bytesPerFile: 256, nested: true }],
      });

      const { entries } = await candidate.sizer.measure([
        join(root, 'alpha', 'node_modules'),
      ]);

      // 逻辑口径: 2 × 256 + 内层 inner.js 64
      candidate.assertBytes(at(entries, 0).bytes, 2 * 256 + 64);
    });

    it('符号链接: 不跟随, 链接目标体积不计入', async () => {
      const { root } = await make({
        projects: [
          { dir: 'alpha', files: 2, bytesPerFile: 256 },
          { dir: 'bulk', files: 1, bytesPerFile: 102400 },
        ],
        symlinks: [
          { at: 'alpha/node_modules/bulk-link', to: 'bulk/node_modules' },
        ],
      });

      const { entries } = await candidate.sizer.measure([
        join(root, 'alpha', 'node_modules'),
      ]);

      const logical = 2 * 256;
      candidate.assertBytes(at(entries, 0).bytes, logical);
      // 链接目标 (100 KiB) 不得被吞入
      expect(at(entries, 0).bytes).toBeLessThan(logical + 102400);
    });

    it('怪名 target (空格 / 引号 / 中文): 路径解析逐字保真', async () => {
      const { root } = await make({
        projects: [
          { dir: 'sp ace/quo"te/中文 目录', files: 2, bytesPerFile: 256 },
        ],
      });
      const target = join(
        root,
        'sp ace',
        'quo"te',
        '中文 目录',
        'node_modules',
      );

      const result = await candidate.sizer.measure([target]);

      // 路径不得被解析吞字符或截断; 也不得落进「原因未知」类告警
      expect(result.entries.map((entry) => entry.target)).toEqual([target]);
      candidate.assertBytes(at(result.entries, 0).bytes, 2 * 256);
      expect(result.warnings).toEqual([]);
    });

    it('不存在的路径: 记告警、跳过该根, 不入任何桶', async () => {
      const { root } = await make({
        projects: [{ dir: 'alpha', files: 2, bytesPerFile: 256 }],
      });
      const real = join(root, 'alpha', 'node_modules');
      const ghost = join(root, 'ghost', 'node_modules');

      const { entries, warnings, unmeasured } = await candidate.sizer.measure([
        real,
        ghost,
      ]);

      expect(entries.map((entry) => entry.target)).toEqual([real]);
      candidate.assertBytes(at(entries, 0).bytes, 2 * 256);
      expect(warnings.some((warning) => warning.includes('ghost'))).toBe(true);
      expect(unmeasured).toEqual([]);
    });

    // root 无视权限位, 该用例在 root 下失效
    test.skipIf(gate || runningAsRoot)(
      '存在但不可读的目标: 结构化记入 unmeasured',
      async () => {
        const { root } = await make({
          projects: [{ dir: 'alpha', files: 2, bytesPerFile: 256 }],
          unreadable: ['alpha/node_modules'],
        });
        const target = join(root, 'alpha', 'node_modules');

        const result = await candidate.sizer.measure([target]);

        // 下游得见「存在但测不到」, 不得只在 warnings 里飘着被静默丢弃
        expect(result.entries).toEqual([]);
        expect(result.unmeasured.map((item) => item.target)).toEqual([target]);
        expect(at(result.unmeasured, 0).reason).toContain('权限');
      },
    );

    // root 无视权限位, 该用例在 root 下失效
    test.skipIf(gate || runningAsRoot)(
      '不可读子目录: 记告警并继续统计',
      async () => {
        const { root } = await make({
          projects: [{ dir: 'alpha', files: 2, bytesPerFile: 256 }],
          unreadable: ['alpha/node_modules/locked'],
        });

        const { entries, warnings, unmeasured } = await candidate.sizer.measure(
          [join(root, 'alpha', 'node_modules')],
        );

        expect(warnings.some((warning) => warning.includes('locked'))).toBe(
          true,
        );
        candidate.assertBytes(at(entries, 0).bytes, 2 * 256);
        // 目标本身可测 (只是少算了 locked 子树), 不属「存在但测不到」
        expect(unmeasured).toEqual([]);
      },
    );
  });

  // du 候选专属用例: 探针缺失时整组跳过 (磁盘口径与 stderr 归因只有 du 侧存在)
  if (candidate.needsDu) {
    describe(`size 契约 [${candidate.sizer.name}] · du 专属`, () => {
      it('磁盘/逻辑比值报告 (供基准裁定)', async () => {
        const { root } = await make({
          projects: [
            { dir: 'alpha', files: 4, bytesPerFile: 1024 },
            { dir: 'beta', files: 1, bytesPerFile: 64, nested: true },
          ],
        });

        const { entries } = await candidate.sizer.measure([
          join(root, 'alpha', 'node_modules'),
          join(root, 'beta', 'node_modules'),
        ]);

        const disk = entries.reduce((sum, entry) => sum + entry.bytes, 0);
        const logical = 4 * 1024 + 64 + 64;
        console.log(
          `[du 比值报告] 磁盘 ${disk} B / 逻辑 ${logical} B = ${(disk / logical).toFixed(2)}`,
        );

        expect(disk).toBeGreaterThanOrEqual(logical);
      });

      it('stderr 中文化: 不得透传 du: 前缀原文', async () => {
        const { root } = await make({
          projects: [{ dir: 'alpha', files: 2, bytesPerFile: 256 }],
          unreadable: ['alpha/node_modules'],
        });

        const result = await candidate.sizer.measure([
          join(root, 'alpha', 'node_modules'),
          join(root, 'ghost', 'node_modules'),
        ]);

        // 告警流 (含 unmeasured.reason) 里不得混入 du 的英文原文
        const texts = [
          ...result.warnings,
          ...result.unmeasured.map((item) => item.reason),
        ];
        expect(texts.length).toBeGreaterThan(0);
        expect(
          texts.some((text) =>
            /du:|permission denied|no such file/i.test(text),
          ),
        ).toBe(false);
      });

      // [证据缺口] GNU du 非 TTY 下对文件名做 shell 转义 (Linux 侧待验), 触发本分支的形态更多;
      // 本用例只覆盖 BSD du 实测形态 (换行原样输出破坏行结构)。
      it('目录名含换行: 前置拒绝为控制字符', async () => {
        const { root } = await make({
          projects: [{ dir: 'line\nbreak', files: 2, bytesPerFile: 256 }],
        });
        const target = join(root, 'line\nbreak', 'node_modules');

        const result = await candidate.sizer.measure([target]);

        // 换行会劈裂 du 输出行 (伪造面): 前置拒绝, 不进 du 命令行, 也不得静默丢弃
        expect(result.entries).toEqual([]);
        expect(result.unmeasured.map((item) => item.target)).toEqual([target]);
        expect(at(result.unmeasured, 0).reason).toContain('控制字符');
      });

      it('以 - 开头的根: 不被 du 当选项 (-- 终止符)', async () => {
        const result = await candidate.sizer.measure(['-P']);

        // 未被当选项 (否则 du 会静默输出 cwd 统计并污染输出面); 按「不存在」路径处置
        expect(result.entries).toEqual([]);
        expect(result.unmeasured).toEqual([]);
        expect(
          result.warnings.some((warning) => warning.includes('不存在')),
        ).toBe(true);
      });

      // 审计样本形态: 伪造目录真实存在, 目录名含换行, 使 du 输出被劈出 `数字\t<victim>` 伪行
      it('伪造覆盖: 排序靠后的伪行不得覆盖受害 target 的体积', async () => {
        const { root } = await make({
          projects: [{ dir: 'aa', files: 1, bytesPerFile: 1024 }],
        });
        const victim = join(root, 'aa', 'node_modules');
        const spoofDir = join(root, `zz-spoof\n88888888\t${join(root, 'aa')}`);
        await mkdir(join(spoofDir, 'node_modules'), { recursive: true });
        await writeFile(join(spoofDir, 'node_modules', 'f.txt'), 'x');
        const forged = join(spoofDir, 'node_modules');

        const result = await candidate.sizer.measure([victim, forged]);

        expect(result.unmeasured.map((item) => item.target)).toEqual([forged]);
        expect(result.entries.map((entry) => entry.target)).toEqual([victim]);
        candidate.assertBytes(at(result.entries, 0).bytes, 1 * 1024);
        // 伪造值 (88888888 KiB) 不得胜出
        expect(at(result.entries, 0).bytes).toBeLessThan(88888888 * 1024);
      });

      // 审计样本形态: 伪行把不可读 target 拖进可测桶 (拖桶); root 无视权限位, 该用例在 root 下失效
      test.skipIf(gate || runningAsRoot)(
        '拖桶: 伪行不得把不可读 target 拖进可测桶',
        async () => {
          const { root } = await make({
            projects: [{ dir: 'vv', files: 1, bytesPerFile: 1024 }],
            unreadable: ['vv/node_modules'],
          });
          const victim = join(root, 'vv', 'node_modules');
          const spoofDir = join(root, `spoof\n777777\t${join(root, 'vv')}`);
          await mkdir(join(spoofDir, 'node_modules'), { recursive: true });
          await writeFile(join(spoofDir, 'node_modules', 'f.txt'), 'x');
          const forged = join(spoofDir, 'node_modules');

          const result = await candidate.sizer.measure([victim, forged]);

          expect(result.entries).toEqual([]);
          expect(result.unmeasured.map((item) => item.target)).toEqual([
            forged,
            victim,
          ]);
          expect(at(result.unmeasured, 1).reason).toContain('权限');
        },
      );
    });
  }
}

describe('size 契约 [候选间一致]', () => {
  test.skipIf(!duAvailable)('js 与 du: 同输入下 entries 顺序一致', async () => {
    const { root } = await make({
      projects: [
        { dir: 'zeta' },
        { dir: 'alpha', nested: true },
        { dir: 'mid', files: 4 },
      ],
    });
    const targets = [
      join(root, 'zeta', 'node_modules'),
      join(root, 'alpha', 'node_modules'),
      join(root, 'mid', 'node_modules'),
      join(root, 'ghost', 'node_modules'),
    ];

    const js = await createJsSizer().measure(targets);
    const du = await createDuSizer().measure(targets);

    expect(du.entries.map((entry) => entry.target)).toEqual(
      js.entries.map((entry) => entry.target),
    );
  });

  test.skipIf(!duAvailable || runningAsRoot)(
    'js 与 du: 同输入下 unmeasured 顺序一致',
    async () => {
      const { root } = await make({
        projects: [{ dir: 'alpha', files: 2, bytesPerFile: 256 }],
        unreadable: ['alpha/node_modules'],
      });
      const targets = [
        join(root, 'alpha', 'node_modules'),
        join(root, 'ghost', 'node_modules'),
      ];

      const js = await createJsSizer().measure(targets);
      const du = await createDuSizer().measure(targets);

      expect(du.unmeasured.map((item) => item.target)).toEqual(
        js.unmeasured.map((item) => item.target),
      );
      // 两候选对同一失败给同一人话原因
      expect(du.unmeasured.map((item) => item.reason)).toEqual(
        js.unmeasured.map((item) => item.reason),
      );
    },
  );
});
