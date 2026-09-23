/**
 * 扫描鲁棒性套件 (多维度选型仪器之一): 对抗性边角输入, 任一候选红即淘汰。
 * 维度: 深嵌套 / 海量单目录 / 怪名 / 符号链接环与悬空 / 名为 node_modules 的文件 / 根不存在。
 * 末段另起 parallel 专属块 (根病因分流文案), 全候选循环内的用例一律保持行为级。
 */
import { afterEach, describe, expect, test } from 'bun:test';

import { mkdir, writeFile } from 'node:fs/promises';
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

/** root 下 chmod 拦不住, 权限类用例一律 skip (与 size / cli 套件同口径) */
const runningAsRoot =
  typeof process.getuid === 'function' && process.getuid() === 0;

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
  describe(`鲁棒性 [${scanner.name}]`, () => {
    test('深嵌套: 200 层路径下的 node_modules 正常命中且不炸栈', async () => {
      const chain = Array.from({ length: 200 }, (_, i) => `d${i}`).join('/');
      const { root } = await make({ projects: [{ dir: `${chain}/leaf` }] });

      const { hits } = await scanner.scan({ roots: [root], exclude: [] });

      expect(hits).toHaveLength(1);
      expect(hits[0]?.target.endsWith(join('leaf', 'node_modules'))).toBe(true);
    });

    test('海量单目录: 2000 个兄弟条目不阻塞、结果正确', async () => {
      const { root } = await make({ projects: [{ dir: 'alpha' }] });
      const bulk = join(root, 'bulk');
      await mkdir(bulk, { recursive: true });
      for (let i = 0; i < 2000; i += 1) {
        await writeFile(join(bulk, `f-${i}.txt`), 'x');
      }

      const { hits } = await scanner.scan({ roots: [root], exclude: [] });

      expect(hits.map((hit) => hit.project)).toEqual([join(root, 'alpha')]);
    });

    test('怪名: 中文 / 空格 / emoji / 引号目录名均正常', async () => {
      const { root } = await make({
        projects: [{ dir: "怪异 目录/proj 🔥 'quoted'" }],
      });

      const { hits } = await scanner.scan({ roots: [root], exclude: [] });

      expect(hits).toHaveLength(1);
      expect(hits[0]?.target).toBe(
        join(root, '怪异 目录', "proj 🔥 'quoted'", 'node_modules'),
      );
    });

    test('符号链接环与悬空链接: 不挂、不炸、不误报', async () => {
      const { root } = await make({
        projects: [{ dir: 'alpha' }],
        symlinks: [
          { at: 'loop-a', to: 'loop-b' },
          { at: 'loop-b', to: 'loop-a' },
          { at: 'dangling', to: 'nowhere-xyz' },
        ],
      });

      const { hits } = await scanner.scan({ roots: [root], exclude: [] });

      expect(hits.map((hit) => hit.project)).toEqual([join(root, 'alpha')]);
    });

    test('名为 node_modules 的文件: 不是目录, 不得计入', async () => {
      const { root } = await make({ projects: [] });
      await mkdir(join(root, 'weird'), { recursive: true });
      await writeFile(join(root, 'weird', 'node_modules'), 'i am a file');

      const { hits } = await scanner.scan({ roots: [root], exclude: [] });

      expect(hits).toEqual([]);
    });

    test('根不存在: 记告警且可定位到该根, 不中断其余根的命中', async () => {
      const { root } = await make({ projects: [{ dir: 'alpha' }] });
      const ghost = join(root, 'ghost-root');

      const result = await scanner.scan({ roots: [root, ghost], exclude: [] });

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((warning) => warning.includes(ghost))).toBe(
        true,
      );
      expect(result.hits.map((hit) => hit.project)).toEqual([
        join(root, 'alpha'),
      ]);
    });
  });
}

/**
 * 根病因分流文案属 parallel 专属契约 (候选 A / B 无分流), 故不进上方全候选参数化循环。
 * 覆盖四条分支: 指向普通文件 / 中间段是文件 (同落「不是目录」), 父链 EACCES, 未识别错误码。
 */
describe('鲁棒性 [parallel] 根病因分流', () => {
  test('根指向普通文件: 病因落在「不是目录」, 不得降级为「目录不可读」', async () => {
    const { root } = await make({ projects: [] });
    const file = join(root, 'plain.txt');
    await writeFile(file, 'x');

    const result = await createParallelScanner().scan({
      roots: [file],
      exclude: [],
    });

    expect(result.hits).toEqual([]);
    expect(result.warnings).toEqual([`根不是目录, 已跳过: ${file}`]);
  });

  test('路径中间段是文件: 与上条同落「不是目录」(realpath 侧 ENOTDIR)', async () => {
    const { root } = await make({ projects: [] });
    const file = join(root, 'plain.txt');
    await writeFile(file, 'x');
    const throughFile = join(file, 'sub');

    const result = await createParallelScanner().scan({
      roots: [throughFile],
      exclude: [],
    });

    expect(result.warnings).toEqual([`根不是目录, 已跳过: ${throughFile}`]);
  });

  test.skipIf(runningAsRoot)(
    '根的父链不可读: 病因落在「权限不足」(realpath 侧 EACCES)',
    async () => {
      const { root } = await make({ projects: [], unreadable: ['sealed'] });
      const underSealed = join(root, 'sealed', 'child');

      const result = await createParallelScanner().scan({
        roots: [underSealed],
        exclude: [],
      });

      expect(result.hits).toEqual([]);
      expect(result.warnings).toEqual([
        `根不可读 (权限不足), 已跳过: ${underSealed}`,
      ]);
    },
  );

  test('未识别错误码: 原码带出, 不吞不猜', async () => {
    const { root } = await make({
      projects: [],
      symlinks: [{ at: 'loop', to: 'loop' }],
    });
    const loop = join(root, 'loop');

    const result = await createParallelScanner().scan({
      roots: [loop],
      exclude: [],
    });

    // 本机 (darwin) 自指符号链接实报 ELOOP; 换平台若报别的码, 失败信息即带出实际值
    expect(result.warnings).toEqual([`根不可用 (ELOOP), 已跳过: ${loop}`]);
  });
});
