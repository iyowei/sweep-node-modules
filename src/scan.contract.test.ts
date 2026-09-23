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

      const { hits } = await scanner.scan({ roots: [root], exclude: [] });

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
      });
      expect(byProjectName.hits.map((hit) => hit.project)).toEqual([
        join(root, 'container', 'beta'),
      ]);

      const byContainerName = await scanner.scan({
        roots: [root],
        exclude: ['container'],
      });
      expect(byContainerName.hits.map((hit) => hit.project)).toEqual([
        join(root, 'alpha'),
      ]);
    });

    test('符号链接: 目录不跟进, 不产生重复命中', async () => {
      const { root } = await make({
        projects: [{ dir: 'real' }],
        symlinks: [{ at: 'mirror', to: 'real' }],
      });

      const { hits } = await scanner.scan({ roots: [root], exclude: [] });

      expect(hits.map((hit) => hit.target)).toEqual([
        join(root, 'real', 'node_modules'),
      ]);
    });

    test('.git: 整棵子树跳过 (内含诱饵 node_modules 不得命中)', async () => {
      const { root } = await make({ projects: [{ dir: 'alpha', git: true }] });

      const { hits } = await scanner.scan({ roots: [root], exclude: [] });

      expect(hits.map((hit) => hit.target)).toEqual([
        join(root, 'alpha', 'node_modules'),
      ]);
    });

    test('多根: 重复根与嵌套根按 realpath 去重', async () => {
      const { root } = await make({ projects: [{ dir: 'alpha' }] });

      const duplicated = await scanner.scan({
        roots: [root, root],
        exclude: [],
      });
      expect(duplicated.hits).toHaveLength(1);

      const nested = await scanner.scan({
        roots: [root, join(root, 'alpha')],
        exclude: [],
      });
      expect(nested.hits).toHaveLength(1);
    });

    test('排序: 按 target 升序确定输出', async () => {
      const { root } = await make({
        projects: [{ dir: 'zeta' }, { dir: 'alpha' }, { dir: 'mid' }],
      });

      const { hits } = await scanner.scan({ roots: [root], exclude: [] });

      const targets = hits.map((hit) => hit.target);
      expect(targets).toEqual([...targets].sort());
    });

    test('空工作区: 零命中零告警', async () => {
      const { root } = await make({ projects: [] });

      const result = await scanner.scan({ roots: [root], exclude: [] });

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

        const result = await scanner.scan({ roots: [root], exclude: [] });

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
    });

    expect(result.excludeMatches).toEqual([{ name: 'vendor', hits: 2 }]);
    expect(result.hits.map((hit) => hit.project)).toEqual([join(root, 'keep')]);
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
    });

    expect(result.hits).toEqual([
      {
        project: join(root, 'CaseDir'),
        target: join(root, 'CaseDir', 'node_modules'),
      },
    ]);
  });
});
