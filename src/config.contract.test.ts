/**
 * 配置契约测试: 定位 (三级覆盖 + 平台矩阵) 与装载 (ok / absent / 损坏三态) 的统一尺子。
 * 平台 / 环境变量表 / 家目录全部注入, mac 上直接跑 win32 矩阵 (设计: 分册「配置与初始化」)。
 */
import { afterEach, describe, expect, test } from 'bun:test';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadConfig,
  loadResolvedConfig,
  mergeNames,
  resolveConfigPath,
} from './config.ts';

const dirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sweep-lab-config-'));
  dirs.push(dir);
  return dir;
}

/** 写入任意文本的配置文件并返回其路径 */
async function writeConfig(name: string, text: string): Promise<string> {
  const path = join(await makeDir(), name);
  await writeFile(path, text);
  return path;
}

afterEach(async () => {
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  dirs.length = 0;
});

describe('config 契约: 定位 (resolveConfigPath)', () => {
  test('优先级: 旗标 > 环境变量 > 平台默认', () => {
    const env = { SWEEP_NM_CONFIG: '/env/config.json' };
    const base = { platform: 'darwin', homedir: '/Users/u', env };

    expect(resolveConfigPath({ ...base, flag: './custom.json' })).toEqual({
      path: './custom.json',
      source: 'flag',
    });
    expect(resolveConfigPath(base)).toEqual({
      path: '/env/config.json',
      source: 'env',
    });
    expect(resolveConfigPath({ ...base, env: {} })).toEqual({
      path: '/Users/u/.config/sweep-node-modules/config.json',
      source: 'platform-default',
    });
  });

  test('非 win32 默认: 家目录下的 .config', () => {
    expect(
      resolveConfigPath({
        platform: 'darwin',
        homedir: '/Users/iyowei',
        env: {},
      }),
    ).toEqual({
      path: '/Users/iyowei/.config/sweep-node-modules/config.json',
      source: 'platform-default',
    });
    expect(
      resolveConfigPath({ platform: 'linux', homedir: '/home/u', env: {} }),
    ).toEqual({
      path: '/home/u/.config/sweep-node-modules/config.json',
      source: 'platform-default',
    });
  });

  test('win32 默认: APPDATA 为基准', () => {
    expect(
      resolveConfigPath({
        platform: 'win32',
        homedir: 'C:\\Users\\u',
        env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' },
      }),
    ).toEqual({
      path: 'C:\\Users\\u\\AppData\\Roaming\\sweep-node-modules\\config.json',
      source: 'platform-default',
    });
  });

  test('win32 默认: APPDATA 缺失兜底 USERPROFILE\\AppData\\Roaming', () => {
    expect(
      resolveConfigPath({
        platform: 'win32',
        homedir: 'C:\\Users\\u',
        env: { USERPROFILE: 'D:\\home\\u' },
      }),
    ).toEqual({
      path: 'D:\\home\\u\\AppData\\Roaming\\sweep-node-modules\\config.json',
      source: 'platform-default',
    });
  });

  test('win32 默认: 两变量均缺失时以注入家目录为基准', () => {
    expect(
      resolveConfigPath({
        platform: 'win32',
        homedir: 'C:\\Users\\u',
        env: {},
      }),
    ).toEqual({
      path: 'C:\\Users\\u\\AppData\\Roaming\\sweep-node-modules\\config.json',
      source: 'platform-default',
    });
  });

  test('win32 矩阵: 环境变量覆盖通道仍优先于平台默认', () => {
    expect(
      resolveConfigPath({
        platform: 'win32',
        homedir: 'C:\\Users\\u',
        env: {
          SWEEP_NM_CONFIG: 'D:\\etc\\sweep.json',
          APPDATA: 'C:\\Users\\u\\AppData\\Roaming',
        },
      }),
    ).toEqual({ path: 'D:\\etc\\sweep.json', source: 'env' });
  });
});

describe('config 契约: 装载 (loadConfig)', () => {
  test('ok: 合法配置按原样读出', async () => {
    const path = await writeConfig(
      'config.json',
      JSON.stringify({ roots: ['/a', '/b'], exclude: ['x'], include: ['y'] }),
    );

    expect(await loadConfig(path)).toEqual({
      state: 'ok',
      config: { roots: ['/a', '/b'], exclude: ['x'], include: ['y'] },
    });
  });

  test('ok: 空数组合法 (排除与包含名单均可留空)', async () => {
    const path = await writeConfig(
      'config.json',
      JSON.stringify({ roots: ['/a'], exclude: [], include: [] }),
    );

    expect(await loadConfig(path)).toEqual({
      state: 'ok',
      config: { roots: ['/a'], exclude: [], include: [] },
    });
  });

  test('absent: 文件与目录均不存在是正常状态, 不抛错', async () => {
    const dir = await makeDir();

    expect(await loadConfig(join(dir, 'no-such-dir', 'config.json'))).toEqual({
      state: 'absent',
    });
  });

  test('损坏: JSON 解析失败, 报错含文件路径', async () => {
    const path = await writeConfig('config.json', '{ broken json');

    await expect(loadConfig(path)).rejects.toThrow(path);
  });

  test('损坏: 空文件 (0 字节) 走 JSON 解析失败路径', async () => {
    const path = await writeConfig('config.json', '');

    const failure = loadConfig(path);
    await expect(failure).rejects.toThrow('配置损坏');
    await expect(failure).rejects.toThrow(path);
  });

  test('损坏: 漏 roots 字段, 报错指名字段', async () => {
    const path = await writeConfig(
      'config.json',
      JSON.stringify({ exclude: ['x'] }),
    );

    // 报错须同时含文件路径与具体病因
    const failure = loadConfig(path);
    await expect(failure).rejects.toThrow(path);
    await expect(failure).rejects.toThrow('roots 应为字符串数组 (实际: 缺失)');
  });

  test('损坏: roots 类型错, 报错指明实际类型', async () => {
    const path = await writeConfig(
      'config.json',
      JSON.stringify({ roots: 'not-array', exclude: [] }),
    );

    const failure = loadConfig(path);
    await expect(failure).rejects.toThrow(path);
    await expect(failure).rejects.toThrow(
      'roots 应为字符串数组 (实际: string)',
    );
  });

  test('损坏: roots 元素类型错, 报错指名位置与实际类型', async () => {
    const path = await writeConfig(
      'config.json',
      JSON.stringify({ roots: ['/a', 42], exclude: [] }),
    );

    await expect(loadConfig(path)).rejects.toThrow(
      'roots 第 2 项应为字符串 (实际: number)',
    );
  });

  test('损坏: exclude 类型错 (非数组), 报错指明实际类型', async () => {
    const path = await writeConfig(
      'config.json',
      JSON.stringify({ roots: ['/a'], exclude: 'x' }),
    );

    await expect(loadConfig(path)).rejects.toThrow(
      'exclude 应为字符串数组 (实际: string)',
    );
  });

  test('损坏: exclude 元素类型错, 报错指名位置与实际类型', async () => {
    const path = await writeConfig(
      'config.json',
      JSON.stringify({ roots: ['/a'], exclude: ['ok', 42] }),
    );

    const failure = loadConfig(path);
    await expect(failure).rejects.toThrow(path);
    await expect(failure).rejects.toThrow(
      'exclude 第 2 项应为字符串 (实际: number)',
    );
  });

  test('损坏: include 类型错 (非数组), 报错指明实际类型', async () => {
    const path = await writeConfig(
      'config.json',
      JSON.stringify({ roots: ['/a'], include: 'x' }),
    );

    await expect(loadConfig(path)).rejects.toThrow(
      'include 应为字符串数组 (实际: string)',
    );
  });

  test('损坏: include 元素类型错, 报错指名位置与实际类型', async () => {
    const path = await writeConfig(
      'config.json',
      JSON.stringify({ roots: ['/a'], include: ['ok', 42] }),
    );

    const failure = loadConfig(path);
    await expect(failure).rejects.toThrow(path);
    await expect(failure).rejects.toThrow(
      'include 第 2 项应为字符串 (实际: number)',
    );
  });

  test('损坏: 顶层非对象 (数组 / null), 报错指明实际类型', async () => {
    const asArray = await writeConfig('array.json', '[]');
    await expect(loadConfig(asArray)).rejects.toThrow(
      '顶层应为对象 (实际: array)',
    );

    const asNull = await writeConfig('null.json', 'null');
    await expect(loadConfig(asNull)).rejects.toThrow(
      '顶层应为对象 (实际: null)',
    );
  });

  test('ok: 缺 exclude / include 字段默认空数组 (自然极简配置)', async () => {
    const path = await writeConfig(
      'config.json',
      JSON.stringify({ roots: ['/a'] }),
    );

    expect(await loadConfig(path)).toEqual({
      state: 'ok',
      config: { roots: ['/a'], exclude: [], include: [] },
    });
  });
});

describe('config 契约: 显式来源缺失报错 (loadResolvedConfig)', () => {
  const base = { platform: 'darwin', homedir: '/no-such-home', env: {} };

  test('flag 来源: 路径不存在抛错, 不降级为配置缺失', async () => {
    const missing = join(await makeDir(), 'no-such.json');
    const failure = loadResolvedConfig(
      resolveConfigPath({ ...base, flag: missing }),
    );

    await expect(failure).rejects.toThrow('配置不存在');
    await expect(failure).rejects.toThrow(missing);
    await expect(failure).rejects.toThrow('请检查路径');
  });

  test('env 来源: 路径不存在抛错, 不降级为配置缺失', async () => {
    const missing = join(await makeDir(), 'no-such.json');
    const failure = loadResolvedConfig(
      resolveConfigPath({ ...base, env: { SWEEP_NM_CONFIG: missing } }),
    );

    await expect(failure).rejects.toThrow('配置不存在');
    await expect(failure).rejects.toThrow(missing);
  });

  test('平台默认来源: 路径不存在维持软行为 (absent)', async () => {
    const resolved = resolveConfigPath(base);

    expect(await loadResolvedConfig(resolved)).toEqual({ state: 'absent' });
  });

  test('显式来源: 文件存在时正常装载 (含 exclude / include 缺省)', async () => {
    const path = await writeConfig(
      'config.json',
      JSON.stringify({ roots: ['/a'] }),
    );

    expect(
      await loadResolvedConfig(resolveConfigPath({ ...base, flag: path })),
    ).toEqual({
      state: 'ok',
      config: { roots: ['/a'], exclude: [], include: [] },
    });
  });
});

describe('config 契约: 合并 (mergeNames)', () => {
  test('追加与去重: 配置在前, 命令行在后, 保序', () => {
    expect(
      mergeNames(['my-kits', 'url-tool'], ['url-tool', 'docs-site']),
    ).toEqual(['my-kits', 'url-tool', 'docs-site']);
  });

  test('空输入与配置自身重复一并归并', () => {
    expect(mergeNames([], [])).toEqual([]);
    expect(mergeNames(['a', 'a'], ['a'])).toEqual(['a']);
  });

  test('不改动入参', () => {
    const config = ['a'];
    const cli = ['b'];

    mergeNames(config, cli);

    expect(config).toEqual(['a']);
    expect(cli).toEqual(['b']);
  });
});
