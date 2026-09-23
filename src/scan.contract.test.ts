/**
 * 扫描契约测试: 同一套尺子参数化跑全部候选。
 * 行为等价由本套契约钉死, 性能差异交由基准裁定。
 */
import { afterEach, describe, expect, test } from 'bun:test';

import { join } from 'node:path';

import {
  type Workspace,
  type WorkspaceSpec,
  makeWorkspace,
} from './fixtures.ts';
import { createNativeScanner } from './scan-native.ts';
import { createParallelScanner } from './scan-parallel.ts';
import { createPruningScanner } from './scan-prune.ts';

const candidates = [
  createPruningScanner(),
  createNativeScanner(),
  createParallelScanner(),
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

for (const scanner of candidates) {
  describe(`scan 契约 [${scanner.name}]`, () => {
    test('剪枝: 嵌套 node_modules 只报最外层', async () => {
      const { root } = await make({
        projects: [{ dir: 'alpha', nested: true }],
      });

      const { hits } = await scanner.scan({
        roots: [root],
        exclude: [],
        include: [],
      });

      expect(hits).toEqual([
        {
          project: join(root, 'alpha'),
          target: join(root, 'alpha', 'node_modules'),
        },
      ]);
    });

    test('排除: 项目名级与容器名级均命中', async () => {
      const { root } = await make({
        projects: [{ dir: 'alpha' }, { dir: 'container/beta' }],
      });

      const byProjectName = await scanner.scan({
        roots: [root],
        exclude: ['alpha'],
        include: [],
      });
      expect(byProjectName.hits.map((hit) => hit.project)).toEqual([
        join(root, 'container', 'beta'),
      ]);

      const byContainerName = await scanner.scan({
        roots: [root],
        exclude: ['container'],
        include: [],
      });
      expect(byContainerName.hits.map((hit) => hit.project)).toEqual([
        join(root, 'alpha'),
      ]);
    });

    test('包含: 任意一级目录名命中即纳入, 未命中即排除', async () => {
      const { root } = await make({
        projects: [
          { dir: 'beta/container/proj' },
          { dir: 'alpha/kept' },
          { dir: 'gamma/lost' },
        ],
      });

      // 容器名级命中: beta 之下还有两级, 命中点不要求是 node_modules 的直接父目录
      const byContainer = await scanner.scan({
        roots: [root],
        exclude: [],
        include: ['beta'],
      });
      expect(byContainer.hits.map((hit) => hit.project)).toEqual([
        join(root, 'beta', 'container', 'proj'),
      ]);

      // 项目名级命中: 命中点即 node_modules 的直接父目录
      const byProject = await scanner.scan({
        roots: [root],
        exclude: [],
        include: ['alpha'],
      });
      expect(byProject.hits.map((hit) => hit.project)).toEqual([
        join(root, 'alpha', 'kept'),
      ]);

      // 名字打错 (无一处命中): 命中集为空, 不是「不过滤」
      const unmatched = await scanner.scan({
        roots: [root],
        exclude: [],
        include: ['typo-name'],
      });
      expect(unmatched.hits).toEqual([]);
    });

    test('包含: 空数组不过滤 (与不传名单等价)', async () => {
      const { root } = await make({
        projects: [{ dir: 'alpha' }, { dir: 'container/beta' }],
      });

      const { hits } = await scanner.scan({
        roots: [root],
        exclude: [],
        include: [],
      });

      expect(hits.map((hit) => hit.project)).toEqual([
        join(root, 'alpha'),
        join(root, 'container', 'beta'),
      ]);
    });

    test('包含与排除同时命中: exclude 优先, 整棵子树跳过', async () => {
      const { root } = await make({
        projects: [{ dir: 'both/proj' }, { dir: 'self/proj' }],
      });

      const { hits } = await scanner.scan({
        roots: [root],
        exclude: ['both'],
        include: ['both', 'self'],
      });

      expect(hits.map((hit) => hit.project)).toEqual([
        join(root, 'self', 'proj'),
      ]);
    });

    test('包含与排除同时命中同一名字: 被 exclude 截走不等于名字没匹配上', async () => {
      const { root } = await make({
        projects: [{ dir: 'alpha' }, { dir: 'beta' }, { dir: 'gamma' }],
      });

      const result = await scanner.scan({
        roots: [root],
        exclude: ['beta'],
        include: ['alpha', 'beta'],
      });

      // exclude 优先: beta 目录客观存在且命中白名单, 整棵子树仍被截走, 结果只剩 alpha
      expect(result.hits.map((hit) => hit.project)).toEqual([
        join(root, 'alpha'),
      ]);

      // 名单反馈通道仅胜出门面 (parallel) 提供 (候选 A / B 无此字段, 见 types.ts):
      // 计数为 0 即被调用方译为「包含名未匹配到任何目录」, 故 beta 必须计入 —— 它只是被
      // exclude 优先截走, 与「名字压根没匹配上」是两回事, 不得冒充后者误报。
      if (result.includeMatches !== undefined) {
        expect(result.includeMatches).toEqual([
          { name: 'alpha', hits: 1 },
          { name: 'beta', hits: 1 },
        ]);
      }
    });

    test('符号链接: 目录不跟进, 不产生重复命中', async () => {
      const { root } = await make({
        projects: [{ dir: 'real' }],
        symlinks: [{ at: 'mirror', to: 'real' }],
      });

      const { hits } = await scanner.scan({
        roots: [root],
        exclude: [],
        include: [],
      });

      expect(hits.map((hit) => hit.target)).toEqual([
        join(root, 'real', 'node_modules'),
      ]);
    });

    test('.git: 整棵子树跳过 (内含诱饵 node_modules 不得命中)', async () => {
      const { root } = await make({ projects: [{ dir: 'alpha', git: true }] });

      const { hits } = await scanner.scan({
        roots: [root],
        exclude: [],
        include: [],
      });

      expect(hits.map((hit) => hit.target)).toEqual([
        join(root, 'alpha', 'node_modules'),
      ]);
    });

    test('多根: 重复根与嵌套根按 realpath 去重', async () => {
      const { root } = await make({ projects: [{ dir: 'alpha' }] });

      const duplicated = await scanner.scan({
        roots: [root, root],
        exclude: [],
        include: [],
      });
      expect(duplicated.hits).toHaveLength(1);

      const nested = await scanner.scan({
        roots: [root, join(root, 'alpha')],
        exclude: [],
        include: [],
      });
      expect(nested.hits).toHaveLength(1);
    });

    test('排序: 按 target 升序确定输出', async () => {
      const { root } = await make({
        projects: [{ dir: 'zeta' }, { dir: 'alpha' }, { dir: 'mid' }],
      });

      const { hits } = await scanner.scan({
        roots: [root],
        exclude: [],
        include: [],
      });

      const targets = hits.map((hit) => hit.target);
      expect(targets).toEqual([...targets].sort());
    });

    test('空工作区: 零命中零告警', async () => {
      const { root } = await make({ projects: [] });

      const result = await scanner.scan({
        roots: [root],
        exclude: [],
        include: [],
      });

      expect(result.hits).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    test.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
      '不可读目录: 记告警并继续',
      async () => {
        const { root } = await make({
          projects: [{ dir: 'beta' }],
          unreadable: ['locked'],
        });

        const result = await scanner.scan({
          roots: [root],
          exclude: [],
          include: [],
        });

        expect(result.hits.map((hit) => hit.project)).toEqual([
          join(root, 'beta'),
        ]);
        expect(
          result.warnings.some((warning) => warning.includes('locked')),
        ).toBe(true);
      },
    );
  });
}

/**
 * 保命名单反馈为 parallel 侧新增契约 (候选 A / B 无此字段), 故不进上方全候选参数化循环。
 */
describe('scan 契约 [parallel] 保命名单反馈', () => {
  test('excludeMatches: 未命中名计 0 仍在列, 命中名计数正确, 顺序同输入', async () => {
    const { root } = await make({
      projects: [
        { dir: 'alpha' },
        { dir: 'container/beta' },
        { dir: 'container/gamma' },
      ],
    });

    const result = await createParallelScanner().scan({
      roots: [root],
      exclude: ['alpha', 'typo-name', 'container'],
      include: [],
    });

    expect(result.excludeMatches).toEqual([
      { name: 'alpha', hits: 1 },
      { name: 'typo-name', hits: 0 },
      { name: 'container', hits: 1 },
    ]);
    expect(result.hits).toEqual([]);
  });

  test('excludeMatches: 同名多处命中逐个累加, 未被排除的项目照常命中', async () => {
    const { root } = await make({
      projects: [
        { dir: 'a/vendor/proj' },
        { dir: 'b/vendor/other' },
        { dir: 'keep' },
      ],
    });

    const result = await createParallelScanner().scan({
      roots: [root],
      exclude: ['vendor'],
      include: [],
    });

    expect(result.excludeMatches).toEqual([{ name: 'vendor', hits: 2 }]);
    expect(result.hits.map((hit) => hit.project)).toEqual([join(root, 'keep')]);
  });
});

/**
 * 包含名单反馈同为 parallel 侧新增契约 (候选 A / B 无此字段): 名字写错时筛选直接为空,
 * 比 exclude 写错更需在名单通道上留痕, 故与上方 exclude 反馈同一套统计口径。
 */
describe('scan 契约 [parallel] 包含名单反馈', () => {
  test('includeMatches: 未命中名计 0 仍在列, 命中名按纳入的子树计数', async () => {
    const { root } = await make({
      projects: [
        { dir: 'self/proj' },
        { dir: 'self/nested/proj2' },
        { dir: 'other/proj3' },
      ],
    });

    const result = await createParallelScanner().scan({
      roots: [root],
      exclude: [],
      include: ['self', 'typo-name'],
    });

    // self 之下两处命中只计 1: 计数点是「由未纳入翻为已纳入」的那一级 (self 自身)
    expect(result.includeMatches).toEqual([
      { name: 'self', hits: 1 },
      { name: 'typo-name', hits: 0 },
    ]);
    expect(result.hits.map((hit) => hit.project)).toEqual([
      join(root, 'self', 'nested', 'proj2'),
      join(root, 'self', 'proj'),
    ]);
  });

  test('includeMatches: 两处同名目录各计一次; 白名单为空时无条目可报', async () => {
    const { root } = await make({
      projects: [{ dir: 'a/vendor/proj' }, { dir: 'b/vendor/other' }],
    });

    const byName = await createParallelScanner().scan({
      roots: [root],
      exclude: [],
      include: ['vendor'],
    });
    expect(byName.includeMatches).toEqual([{ name: 'vendor', hits: 2 }]);

    const unfiltered = await createParallelScanner().scan({
      roots: [root],
      exclude: [],
      include: [],
    });
    expect(unfiltered.includeMatches).toEqual([]);
  });
});

/**
 * 平台去重键: scan 直接复用 guard 的 dedupeKey, 大小写双写不得判成两条 (曾与 guard 判「重复」打架)。
 * 折叠语义本身由 guard 套件以可注入风格钉住 (此处不重复造尺子); 本机为大小写不敏感卷, realpath
 * 已把大小写拼写归一, 故这里只锁 scan 侧可见契约 —— 换大小写写法, 仍是同一条 (大小写敏感卷上该
 * 根不存在, 命中数断言同样成立)。
 */
describe('scan 契约 [parallel] 平台去重键', () => {
  test('大小写双写的同一根: 只遍历一次, 不产出重复命中', async () => {
    const { root } = await make({ projects: [{ dir: 'CaseDir' }] });
    const variant = join(root, 'casedir');

    const result = await createParallelScanner().scan({
      roots: [root, variant],
      exclude: [],
      include: [],
    });

    expect(result.hits).toEqual([
      {
        project: join(root, 'CaseDir'),
        target: join(root, 'CaseDir', 'node_modules'),
      },
    ]);
  });
});
