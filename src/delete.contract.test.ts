/**
 * 删除执行器契约测试: 真删 fixture 目标, 钉死六条语义 (正常 / TOCTOU 缺失 / 权限失败且
 * 错误串附复查提示 / 桶内保输入序 / 空输入 / 组件级安全复核), 正常路径并断言邻居目录不被波及。
 * 设计: docs/designs/deletion-guard.md「执行语义」。
 */
import { afterEach, describe, expect, test } from 'bun:test';

import {
  chmod,
  mkdir,
  rename,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import { removeTargets } from './delete.ts';
import {
  type Workspace,
  type WorkspaceSpec,
  makeWorkspace,
} from './fixtures.ts';

const workspaces: Workspace[] = [];

async function make(spec: WorkspaceSpec): Promise<Workspace> {
  const workspace = await makeWorkspace(spec);
  workspaces.push(workspace);
  return workspace;
}

/** 权限注入的还原登记: 不还原会把临时目录锁成清不掉的墓地 */
const modeRestores: { path: string; mode: number }[] = [];

/** 降权目录 (默认 0o500: 只读可搜索, 其内子项不可删); 还原统一在 afterEach 执行 */
async function lockDir(dir: string, mode = 0o500): Promise<void> {
  // 无符号文件权限位运算: 取低 9 位 (rwxrwxrwx), 掩掉文件类型高位
  // eslint-disable-next-line no-bitwise
  const original = (await stat(dir)).mode & 0o777;
  modeRestores.push({ path: dir, mode: original });
  await chmod(dir, mode);
}

afterEach(async () => {
  for (const { path, mode } of modeRestores)
    await chmod(path, mode).catch(() => {});
  modeRestores.length = 0;
  await Promise.all(workspaces.map((workspace) => workspace.cleanup()));
  workspaces.length = 0;
});

/** 只探存在性, 不抛 */
const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

/** root 下权限位形同虚设 (0o500 照样可删), 依赖权限注入的用例跳过 */
const isRoot = (process as { getuid?: () => number }).getuid?.() === 0;

describe('removeTargets 契约', () => {
  test('正常: 目标真删 (含多级路径), 邻居目录完整保留', async () => {
    const { root } = await make({
      projects: [
        { dir: 'zone/alpha', files: 3 },
        { dir: 'zone/beta' },
        { dir: 'zone/sub/deep' },
      ],
    });
    const alpha = join(root, 'zone', 'alpha', 'node_modules');
    const beta = join(root, 'zone', 'beta', 'node_modules');
    const deep = join(root, 'zone', 'sub', 'deep', 'node_modules');

    // 邻居样本: 项目自身文件与兄弟目录, 两者都不在删除目标内
    const neighborFile = join(root, 'zone', 'alpha', 'package.json');
    await writeFile(neighborFile, '{"name":"alpha"}');
    const sibling = join(root, 'zone', 'gamma');
    await mkdir(sibling, { recursive: true });

    const result = await removeTargets([alpha, beta, deep], { roots: [root] });

    expect(result).toEqual({
      removed: [alpha, beta, deep],
      missing: [],
      failed: [],
    });
    expect(await exists(alpha)).toBe(false);
    expect(await exists(beta)).toBe(false);
    expect(await exists(deep)).toBe(false);
    expect(await exists(neighborFile)).toBe(true);
    expect(await exists(sibling)).toBe(true);
  });

  test('missing: 父链完好而目标本体不在, 归 missing (TOCTOU 视为成功侧)', async () => {
    const { root } = await make({ projects: [{ dir: 'app' }] });
    const target = join(root, 'app', 'node_modules');
    // 父链为真目录、从未有过 node_modules: 复核全通过, rm 阶段才 ENOENT, 这才是真 missing
    await mkdir(join(root, 'bare'), { recursive: true });
    const neverHad = join(root, 'bare', 'node_modules');

    const first = await removeTargets([target], { roots: [root] });
    expect(first.removed).toEqual([target]);
    expect(first.missing).toEqual([]);

    // 次轮: 目标已在上轮删除, 连同从未有过的目标一并归 missing (保输入序)
    const second = await removeTargets([target, neverHad], { roots: [root] });
    expect(second.removed).toEqual([]);
    expect(second.missing).toEqual([target, neverHad]);
    expect(second.failed).toEqual([]);
  });

  test.skipIf(isRoot)(
    'failed: 父目录 0o500 注入不可删, 错误串含码与目标并附复查提示',
    async () => {
      const { root } = await make({ projects: [{ dir: 'locked' }] });
      const parent = join(root, 'locked');
      const target = join(parent, 'node_modules');
      await lockDir(parent);

      const result = await removeTargets([target], { roots: [root] });

      expect(result.removed).toEqual([]);
      expect(result.missing).toEqual([]);
      expect(result.failed.map((entry) => entry.target)).toEqual([target]);
      const [entry] = result.failed;
      expect(entry?.error).toMatch(/E[A-Z]+/); // 含错误码
      expect(entry?.error).toContain(target); // 含目标定位
      expect(entry?.error).toContain('权限'); // 含人话
      // 复查提示 (rm 递归先删内容后删壳, 失败时内容可能已残缺, 不能读成「什么都没发生」)
      expect(entry?.error).toContain('可能已被部分或全部删除');
      expect(entry?.error).toContain('请复查');
      // 只保证空壳还在: 其内容在失败前可能已被删掉, 提示语正是为这种磁盘实况而设
      expect(await exists(target)).toBe(true);
    },
  );

  test('顺序: 打乱输入, removed 与 missing 各自保输入序', async () => {
    const { root } = await make({
      projects: [{ dir: 'zeta' }, { dir: 'alpha' }],
    });
    const zeta = join(root, 'zeta', 'node_modules');
    const alpha = join(root, 'alpha', 'node_modules');
    // 缺失侧样本: 父链为真目录、目标本体不在 (rm 阶段 ENOENT, 真 missing)
    await mkdir(join(root, 'bare-b'), { recursive: true });
    await mkdir(join(root, 'bare-a'), { recursive: true });
    const bareB = join(root, 'bare-b', 'node_modules');
    const bareA = join(root, 'bare-a', 'node_modules');

    // 输入序刻意与字典序相反 (字典序应为 alpha < zeta、bare-a < bare-b)
    const result = await removeTargets([zeta, bareB, alpha, bareA], {
      roots: [root],
    });

    expect(result.removed).toEqual([zeta, alpha]);
    expect(result.missing).toEqual([bareB, bareA]);
    expect(result.failed).toEqual([]);
    expect(await exists(zeta)).toBe(false);
    expect(await exists(alpha)).toBe(false);
  });

  test.skipIf(isRoot)(
    '失败不中断: 中段失败, 其后目标照常删除; failed 桶保输入序',
    async () => {
      const { root } = await make({
        projects: [{ dir: 'lock-b' }, { dir: 'ok' }, { dir: 'lock-a' }],
      });
      const lockB = join(root, 'lock-b', 'node_modules');
      const ok = join(root, 'ok', 'node_modules');
      const lockA = join(root, 'lock-a', 'node_modules');
      await lockDir(join(root, 'lock-b'));
      await lockDir(join(root, 'lock-a'));

      const result = await removeTargets([lockB, ok, lockA], { roots: [root] });

      expect(result.removed).toEqual([ok]);
      expect(result.failed.map((entry) => entry.target)).toEqual([
        lockB,
        lockA,
      ]);
      expect(result.failed.every((entry) => /E[A-Z]+/.test(entry.error))).toBe(
        true,
      );
      expect(await exists(ok)).toBe(false);
    },
  );

  test('符号链接: 只删链接本身, 不跟进解析到真实目录', async () => {
    const { root } = await make({ projects: [{ dir: 'precious' }] });
    await mkdir(join(root, 'app'), { recursive: true });
    const target = join(root, 'app', 'node_modules');
    // 目标位置被换成指向真实目录的符号链接 (末段替换: 由 fs.rm 的 lstat 语义安全处理)
    await symlink(join(root, 'precious', 'node_modules'), target);

    const result = await removeTargets([target], { roots: [root] });

    expect(result.removed).toEqual([target]);
    expect(await exists(target)).toBe(false);
    // 链接指向的真实目录必须原样活着 (删它会是灾难)
    expect(await exists(join(root, 'precious', 'node_modules'))).toBe(true);
  });

  test('空输入: 三桶皆空', async () => {
    const result = await removeTargets([], { roots: [] });

    expect(result).toEqual({ removed: [], missing: [], failed: [] });
  });
});

describe('组件级安全复核 (中间路径组件替换 → root 外删除)', () => {
  test('中间组件被换成符号链接: 整批中止, root 外完好, 已成功条目如实报告', async () => {
    const { root } = await make({
      projects: [
        { dir: 'zone/ok' },
        { dir: 'zone/later' },
        { dir: 'outside', files: 3 },
      ],
    });
    const trust = join(root, 'zone'); // 信任根: outside 在其外
    const ok = join(trust, 'ok', 'node_modules');
    const swapped = join(trust, 'sub', 'node_modules');
    const later = join(trust, 'later', 'node_modules');
    const victim = join(root, 'outside', 'node_modules');
    const victimFile = join(victim, 'pkg-0.js');

    // 攻击形态: 中间组件 sub 被换成指向 root 外的符号链接 (rm 会跟进它删到 root 外)
    await symlink(join(root, 'outside'), join(trust, 'sub'));
    expect(await exists(victimFile)).toBe(true);

    const result = await removeTargets([ok, swapped, later], {
      roots: [trust],
    });

    expect(result.removed).toEqual([ok]); // 已成功条目如实报告
    expect(result.failed).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.aborted?.target).toBe(swapped);
    expect(result.aborted?.reason).toContain('路径组件被替换');
    expect(result.aborted?.reason).toContain(join(trust, 'sub')); // 定位到被替换的组件
    // root 外完好 (含内容), 剩余条目一律不删
    expect(await exists(victim)).toBe(true);
    expect(await exists(victimFile)).toBe(true);
    expect(await exists(later)).toBe(true);
  });

  test('组件消失 (父链被 mv 走): 归 failed 而非 missing, 不伪造成功报告', async () => {
    const { root } = await make({ projects: [{ dir: 'zone/moved' }] });
    const trust = join(root, 'zone');
    const target = join(trust, 'moved', 'node_modules');
    // mv 走整个目标目录: 目标仍存活, 只是原路径不可达 (in-root 变体)
    const newHome = join(trust, 'moved.bak');
    await rename(join(trust, 'moved'), newHome);

    const result = await removeTargets([target], { roots: [trust] });

    // 报 missing 会让调用方收到 ✓ 与退出码 0 (cli 以 failed 非空定 1), 而目标还在占盘
    expect(result.removed).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.failed.map((entry) => entry.target)).toEqual([target]);
    const [entry] = result.failed;
    expect(entry?.error).toContain('路径组件消失');
    expect(entry?.error).toContain('请复查目标是否仍存在');
    expect(entry?.error).toContain('未执行删除');
    expect(entry?.error).toContain('若目标确已不存在, 可忽略此条'); // 降噪说明
    expect(entry?.error).not.toContain('可能已被部分或全部删除'); // 未删过, 不附内容残缺提示
    expect(result.aborted).toBeUndefined(); // 无替换证据, 不牵连整批
    // 目标确实仍存活于新位置, 正是「不能报成功」的原因
    expect(await exists(join(newHome, 'node_modules'))).toBe(true);
  });

  test('目标不在任何 roots 之下: 整批中止, 不删任何条目', async () => {
    const { root } = await make({
      projects: [{ dir: 'zone/app' }, { dir: 'outside' }],
    });
    const stray = join(root, 'outside', 'node_modules');
    const inside = join(root, 'zone', 'app', 'node_modules');

    const result = await removeTargets([stray, inside], {
      roots: [join(root, 'zone')],
    });

    expect(result.aborted?.target).toBe(stray);
    expect(result.aborted?.reason).toContain('不在任何 roots 之下');
    expect(result.removed).toEqual([]);
    expect(await exists(inside)).toBe(true);
  });

  test.skipIf(isRoot)(
    '组件不可核验 (无搜索位): 该条 failed 且注明未执行删除, 不中止整批',
    async () => {
      const { root } = await make({
        projects: [{ dir: 'opaque/inner' }, { dir: 'ok' }],
      });
      const opaque = join(root, 'opaque');
      await lockDir(opaque, 0o000); // 其下组件 lstat 不可达
      const blocked = join(opaque, 'inner', 'node_modules');
      const ok = join(root, 'ok', 'node_modules');

      const result = await removeTargets([blocked, ok], { roots: [root] });

      expect(result.failed.map((entry) => entry.target)).toEqual([blocked]);
      expect(result.failed[0]?.error).toContain('安全复核未完成');
      expect(result.failed[0]?.error).toContain('未执行删除');
      expect(result.aborted).toBeUndefined();
      expect(await exists(ok)).toBe(false); // 无替换证据, 不牵连后续条目
    },
  );
});
