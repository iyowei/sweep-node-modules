/**
 * 初始化向导测试: fake IO 脚本化答案, 钉死交互流与落盘契约。
 * 权威: sweep-node-modules 设计文档「配置初始化模型」与 ADR 0004。
 * 交互壳 createReadlineIO 属薄壳, 由 init.smoke.test.ts 双载体回归覆盖。
 */
import { describe, expect, test } from 'bun:test';

import { homedir } from 'node:os';
import { join } from 'node:path';

import { type InitDeps, type InitIO, parseList, runInit } from './init.ts';

const CONFIG_PATH = '/Users/iyowei/.config/sweep-node-modules/config.json';

/** 脚本化的 fake IO: 按序弹出预设答案; 脚本耗尽即抛错, 防漏配答案静默退化成取消态 */
function makeFakeIO(script: {
  asks?: (string | null)[];
  confirms?: boolean[];
}) {
  const askCalls: { question: string; hint?: string }[] = [];
  const confirmCalls: { question: string; defaultYes: boolean }[] = [];
  const prints: string[] = [];
  const pendingAsks = [...(script.asks ?? [])];
  const pendingConfirms = [...(script.confirms ?? [])];

  const io: InitIO = {
    async ask(question, hint) {
      askCalls.push({ question, hint });
      if (pendingAsks.length === 0)
        throw new Error('fake IO: ask 答案脚本已耗尽');
      return pendingAsks.shift()!;
    },
    async confirm(question, defaultYes) {
      confirmCalls.push({ question, defaultYes });
      if (pendingConfirms.length === 0)
        throw new Error('fake IO: confirm 答案脚本已耗尽');
      return pendingConfirms.shift()!;
    },
    print(line) {
      prints.push(line);
    },
  };

  return { io, askCalls, confirmCalls, prints };
}

/** 组装被测 deps: 文件系统与 IO 全部 fake, 落盘只记录不写盘 */
function makeDeps(options: {
  /** configPath 是否存在 (覆盖保护分流) */
  configExists?: boolean;
  /** 非 configPath 路径的存在性谓词 (根校验); 缺省一律视为存在 */
  rootExists?: (path: string) => boolean;
  asks?: (string | null)[];
  confirms?: boolean[];
}) {
  const { io, askCalls, confirmCalls, prints } = makeFakeIO(options);
  const writes: { path: string; text: string }[] = [];
  const deps: InitDeps = {
    configPath: CONFIG_PATH,
    fileExists: async (path) =>
      path === CONFIG_PATH
        ? (options.configExists ?? false)
        : (options.rootExists?.(path) ?? true),
    writeFile: async (path, text) => {
      writes.push({ path, text });
    },
    io,
  };

  return { deps, writes, askCalls, confirmCalls, prints };
}

describe('runInit: written 路径', () => {
  test('开场提示 + 空答取默认根, 排除留空; 回显后默认确认写入', async () => {
    const { deps, writes, askCalls, confirmCalls, prints } = makeDeps({
      asks: ['', ''],
      confirms: [true],
    });

    const result = await runInit(deps);

    const expected = { roots: [process.cwd()], exclude: [] };
    expect(result).toEqual({ state: 'written', config: expected });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.path).toBe(CONFIG_PATH);
    expect(writes[0]!.text).toBe(`${JSON.stringify(expected, null, 2)}\n`);
    expect(askCalls[0]!.hint).toContain(process.cwd());
    // 开场一句, 回显解析结果在确认前可见, 收尾落盘回执
    expect(prints[0]).toBe('首次使用, 先确定扫描范围');
    expect(prints).toContain(
      `将写入 roots: ${JSON.stringify([process.cwd()])} · exclude: []`,
    );
    // 写入确认为最后一问且默认 Y
    expect(confirmCalls).toHaveLength(1);
    expect(confirmCalls[0]!.defaultYes).toBe(true);
  });

  test('逗号与空白混用的多根, 排除名单非空; 回显两侧解析结果', async () => {
    const { deps, writes, prints } = makeDeps({
      asks: ['/a, /b  /c', 'dist, coverage'],
      confirms: [true],
    });

    const result = await runInit(deps);

    expect(result).toEqual({
      state: 'written',
      config: { roots: ['/a', '/b', '/c'], exclude: ['dist', 'coverage'] },
    });
    expect(writes).toHaveLength(1);
    expect(prints).toContain(
      '将写入 roots: ["/a","/b","/c"] · exclude: ["dist","coverage"]',
    );
  });

  test('已存在配置且确认覆盖: 覆盖确认默认否, 写入确认默认 Y', async () => {
    const { deps, writes, confirmCalls } = makeDeps({
      configExists: true,
      confirms: [true, true],
      asks: ['/root', ''],
    });

    const result = await runInit(deps);

    expect(result.state).toBe('written');
    expect(confirmCalls).toHaveLength(2);
    expect(confirmCalls[0]!.defaultYes).toBe(false);
    expect(confirmCalls[0]!.question).toContain('覆盖');
    expect(confirmCalls[1]!.defaultYes).toBe(true);
    expect(writes).toHaveLength(1);
  });

  test('根不存在: 逐个提示后重问该问, 坏输入不进配置', async () => {
    const { deps, askCalls, prints } = makeDeps({
      rootExists: (path) => path === '/ok',
      asks: ['/missing-a /missing-b', '/ok', ''],
      confirms: [true],
    });

    const result = await runInit(deps);

    expect(result).toEqual({
      state: 'written',
      config: { roots: ['/ok'], exclude: [] },
    });
    expect(prints).toContain('根不存在: /missing-a');
    expect(prints).toContain('根不存在: /missing-b');
    // 根问了两次 (重问), 加排除一次, 共三次
    expect(askCalls).toHaveLength(3);
    expect(askCalls[1]!.question).toBe(askCalls[0]!.question);
  });
});

describe('runInit: cancelled 路径 (统一措辞, 均不落盘)', () => {
  test('扫描根一问取消', async () => {
    const { deps, writes, prints } = makeDeps({ asks: [null] });

    const result = await runInit(deps);

    expect(result).toEqual({ state: 'cancelled' });
    expect(writes).toHaveLength(0);
    expect(prints).toContain('已取消, 未写入配置');
  });

  test('排除名单一问取消', async () => {
    const { deps, writes, askCalls, prints } = makeDeps({
      asks: ['/root', null],
    });

    const result = await runInit(deps);

    expect(result).toEqual({ state: 'cancelled' });
    expect(writes).toHaveLength(0);
    expect(askCalls).toHaveLength(2);
    expect(prints).toContain('已取消, 未写入配置');
  });

  test('回显确认被拒: 同一措辞, 不落盘', async () => {
    const { deps, writes, confirmCalls, prints } = makeDeps({
      asks: ['/a', ''],
      confirms: [false],
    });

    const result = await runInit(deps);

    expect(result).toEqual({ state: 'cancelled' });
    expect(writes).toHaveLength(0);
    expect(confirmCalls[0]!.defaultYes).toBe(true);
    expect(prints).toContain('已取消, 未写入配置');
  });
});

describe('runInit: declined-overwrite 路径', () => {
  test('拒绝覆盖 (默认否): 不落盘, 不再提问, 不打印取消措辞', async () => {
    const { deps, writes, askCalls, prints } = makeDeps({
      configExists: true,
      confirms: [false],
    });

    const result = await runInit(deps);

    expect(result).toEqual({ state: 'declined-overwrite' });
    expect(writes).toHaveLength(0);
    expect(askCalls).toHaveLength(0);
    expect(prints).toHaveLength(0);
  });
});

describe('parseList: 答案解析', () => {
  test('空串与全空白回落 fallback', () => {
    expect(parseList('', ['/default'])).toEqual(['/default']);
    expect(parseList('   \t ', ['/default'])).toEqual(['/default']);
    expect(parseList('', [])).toEqual([]);
  });

  test('null (取消态) 回落 fallback', () => {
    expect(parseList(null, ['/default'])).toEqual(['/default']);
    expect(parseList(null, [])).toEqual([]);
  });

  test('逗号分隔: 半角与全角均成立', () => {
    expect(parseList('/a,/b', [])).toEqual(['/a', '/b']);
    expect(parseList('/a，/b', [])).toEqual(['/a', '/b']);
  });

  test('空白分隔: 多空格 / 制表符 / 首尾空白', () => {
    expect(parseList('  /a   /b\t/c  ', [])).toEqual(['/a', '/b', '/c']);
  });

  test('混合分隔与空项过滤', () => {
    expect(parseList(', /a ,, /b ,', [])).toEqual(['/a', '/b']);
  });

  test('中文路径不被破坏', () => {
    expect(
      parseList('/Users/iyowei/我的文档，/Users/iyowei/项目数据', []),
    ).toEqual(['/Users/iyowei/我的文档', '/Users/iyowei/项目数据']);
  });

  test('成对引号: 空格与逗号保留, 引号本身剥离', () => {
    expect(parseList('"/tmp/My Projects"', [])).toEqual(['/tmp/My Projects']);
    expect(parseList('"/tmp/a, b"', [])).toEqual(['/tmp/a, b']);
    expect(parseList("'/tmp/a b' /c", [])).toEqual(['/tmp/a b', '/c']);
  });

  test('未配对引号按普通字符处理, 不吞后续内容', () => {
    expect(parseList('/a "b c', [])).toEqual(['/a', '"b', 'c']);
  });

  test('~ 展开为家目录 (含引号内的 ~ 与 win32 习惯的 ~\\)', () => {
    expect(parseList('~', [])).toEqual([homedir()]);
    expect(parseList('~/lab', [])).toEqual([join(homedir(), 'lab')]);
    expect(parseList('~\\lab', [])).toEqual([join(homedir(), 'lab')]);
    expect(parseList('"~/My Projects" ~/lab', [])).toEqual([
      join(homedir(), 'My Projects'),
      join(homedir(), 'lab'),
    ]);
  });
});
