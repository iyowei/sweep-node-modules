/**
 * render 鲁棒性套件: 非默认输入下的呈现契约 —— 对抗性字符 (控制类 / 换行) 与平台风味 (posix / win32)。
 * 与 render.test.ts 的分工: 那边钉正常渲染契约与快照, 本套件钉边界输入的行为。
 */
import { describe, expect, test } from 'bun:test';

import { POSIX_STYLE, WIN32_STYLE } from './guard.ts';
import {
  ACME_WEB,
  HOME,
  MIB,
  REWRITTEN,
  SAMPLES,
  linesOf,
  previewOptions,
  stripAnsi,
} from './render.fixtures.ts';
import { type RenderEntry, type RenderOptions, render } from './render.ts';

describe('控制字符与换行净化', () => {
  const newlineEntry: RenderEntry = {
    project: 'evil\nname',
    bytes: 620 * MIB,
    target: `${HOME}/x/evil\nname/node_modules`,
  };
  test('换行不得撑破行结构', () => {
    const out = render({ ...previewOptions, entries: [newlineEntry] });

    expect(linesOf(out)).toHaveLength(3);
    expect(out).toContain('evil name');
  });

  test('ESC 不得外泄 (非 TTY 零 ANSI 强契约)', () => {
    const out = render({
      ...previewOptions,
      color: false,
      entries: [REWRITTEN],
    });

    expect(out).not.toContain('\u001b');
  });

  test('着色模式下 ESC 同样净化 (只剩规范自身的 SGR)', () => {
    // 注入样本取非 SGR 序列 (清屏), 否则会被 stripAnsi 连带剥掉, 掩盖净化缺失
    const clearEntry: RenderEntry = {
      project: 'clear\u001b[2Jname',
      bytes: 620 * MIB,
      target: `${HOME}/x/clear\u001b[2Jname/node_modules`,
    };
    const out = render({
      ...previewOptions,
      color: true,
      entries: [clearEntry],
    });

    expect(stripAnsi(out)).not.toContain('\u001b');
  });

  test('顶栏根路径同样净化', () => {
    const out = render({
      ...previewOptions,
      roots: [`${HOME}/a\nb`],
      entries: SAMPLES,
    });
    const lines = linesOf(out);

    expect(lines).toHaveLength(SAMPLES.length + 2);
    expect(lines[0]).toContain('~/a b');
  });

  test('note 与失败原因中的换行同样折成单行', () => {
    const out = render({
      ...previewOptions,
      mode: 'execute',
      entries: [
        {
          ...ACME_WEB,
          ok: false,
          error: 'EACCES: denied\n  at async rm',
          note: '体积统计失败\n权限不足',
        },
      ],
    });

    expect(linesOf(out)).toHaveLength(3);
    expect(out).toContain('体积统计失败 权限不足  EACCES: denied at async rm');
  });

  test('C1 控制区 / bidi 控制 / 零宽 / BOM 一并剥除', () => {
    // 码点: C1 NEL / RLO / LRI / ZWSP / BOM (均以转义书写, 避免源码里混入不可见字符)
    const codes = ['\u0085', '\u202e', '\u2066', '\u200b', '\ufeff'];
    const entries: RenderEntry[] = codes.map((code, index) => ({
      project: `evil${code}${index}`,
      bytes: 12 * MIB,
      target: `${HOME}/x/evil${code}${index}/node_modules`,
    }));
    const out = render({ ...previewOptions, entries });

    for (const code of codes) expect(out).not.toContain(code);
    expect(out).toContain('evil0');
    expect(out).toContain('evil4');
  });

  test('净化改写显示名时行尾补提示 (照显示名复制会失效)', () => {
    const out = render({ ...previewOptions, entries: [REWRITTEN] });

    expect(out).toContain('名字已净化显示');
  });

  test('未改写时不留提示 (零误报)', () => {
    expect(render(previewOptions)).not.toContain('已净化显示');
  });

  test('净化提示与既有 note 并置', () => {
    const out = render({
      ...previewOptions,
      entries: [{ ...REWRITTEN, note: '体积统计失败: 权限不足' }],
    });

    expect(out).toContain('名字已净化显示  体积统计失败: 权限不足');
  });
});

describe('路径风味矩阵 (posix / win32)', () => {
  const WIN_TARGET = 'C:\\work\\acme-web\\node_modules';
  const WIN_HOME = 'C:\\Users\\iyowei';
  const winBase: RenderOptions = {
    mode: 'preview',
    roots: ['C:\\work'],
    entries: [{ project: 'acme-web', bytes: 620 * MIB, target: WIN_TARGET }],
    color: false,
    home: WIN_HOME,
    pathStyle: WIN32_STYLE,
  };

  test('win32 后缀剥除: 反斜杠 node_modules 后缀被剥掉', () => {
    const out = render(winBase);

    expect(out).toContain('C:\\work\\acme-web');
    expect(out).not.toContain('node_modules');
  });

  test('win32 家目录祖先: 反斜杠前缀可缩写为 ~', () => {
    const entries = [
      {
        project: 'acme-web',
        bytes: 620 * MIB,
        target: `${WIN_HOME}\\acme-web\\node_modules`,
      },
    ];
    const out = render({ ...winBase, entries });

    expect(out).toContain('~\\acme-web');
    expect(out).not.toContain(WIN_HOME);
  });

  test('win32 大小写不敏感: 前缀与后缀大小写不同仍命中', () => {
    const entries = [
      {
        project: 'acme-web',
        bytes: 620 * MIB,
        target: 'C:\\users\\IYOWEI\\acme-web\\NODE_MODULES',
      },
    ];
    const out = render({ ...winBase, entries });

    expect(out).toContain('~\\acme-web');
  });

  test('posix 风味不误伤 win32 形式路径 (风味确由注入决定)', () => {
    const entries = [
      { project: 'acme-web', bytes: 620 * MIB, target: WIN_TARGET },
    ];
    const out = render({
      ...winBase,
      entries,
      pathStyle: POSIX_STYLE,
      home: '/Users/iyowei',
    });

    expect(out).toContain(WIN_TARGET);
  });

  test('posix 风味仍按正斜杠剥除与缩写 (回归)', () => {
    const entries = [
      {
        project: 'acme-web',
        bytes: 620 * MIB,
        target: '/Users/iyowei/work/acme-web/node_modules',
      },
    ];
    const out = render({
      ...winBase,
      entries,
      pathStyle: POSIX_STYLE,
      home: '/Users/iyowei',
    });

    expect(out).toContain('~/work/acme-web');
    expect(out).not.toContain('node_modules');
  });
});
