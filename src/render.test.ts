/**
 * 清单渲染契约测试: 锁定「紧凑式 + 色块」视觉规范 (设计: cli-surface.md「输出规格」)。
 * 结构断言钉死契约; 快照锁住视觉细节的意外漂移。
 * 样例数据与断言工具见 render.fixtures.ts; 边界输入 (净化 / 平台风味) 见 robustness.render.test.ts。
 */
import { describe, expect, test } from 'bun:test';

import { assertGolden } from './golden.ts';
import {
  ACME_WEB,
  DATA_PIPELINE,
  DOCS_SITE,
  GIB,
  HOME,
  MIB,
  NOTE_BOOK,
  RESULTS,
  REWRITTEN,
  ROOT_DEV,
  SAMPLES,
  TIER_BIG,
  TIER_MID,
  UNMEASURED,
  linesOf,
  listLines,
  previewOptions,
  rowOf,
  stripAnsi,
} from './render.fixtures.ts';
import { formatBytes, render } from './render.ts';

/** 从清单行反查样例项目名 (排序断言用) */
const projectOf = (line: string): string | undefined =>
  SAMPLES.find((entry) => line.includes(entry.project))?.project;

describe('体积格式化', () => {
  test('逐级 1024, 1 位小数且整数省略小数尾', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(366 * MIB)).toBe('366 MB');
    expect(formatBytes(620 * MIB)).toBe('620 MB');
    expect(formatBytes(Math.round(4.6 * GIB))).toBe('4.6 GB');
    expect(formatBytes(1024 ** 4)).toBe('1 TB');
  });
});

describe('顶栏', () => {
  test('含命令名、模式与根数量', () => {
    const [head] = linesOf(render({ ...previewOptions, roots: ['/a', '/b'] }));

    expect(head).toContain('SWEEP-NM');
    expect(head).toContain('预览');
    expect(head).toContain('2 个根');
  });

  test('执行模式标记为执行', () => {
    const [head] = linesOf(
      render({ ...previewOptions, mode: 'execute', entries: RESULTS }),
    );

    expect(head).toContain('执行');
  });

  test('根数 <= 3 时直接列出根路径 (复用家目录缩写)', () => {
    const [head] = linesOf(
      render({ ...previewOptions, roots: [ROOT_DEV, `${HOME}/work`] }),
    );

    expect(head).toContain('2 个根: ~/workspace/development · ~/work');
  });

  test('根数为 3 时仍列出 (边界)', () => {
    const [head] = linesOf(
      render({
        ...previewOptions,
        roots: [`${HOME}/a`, `${HOME}/b`, `${HOME}/c`],
      }),
    );

    expect(head).toContain('3 个根: ~/a · ~/b · ~/c');
  });

  test('根数 > 3 时只报计数', () => {
    const roots = [`${HOME}/a`, `${HOME}/b`, `${HOME}/c`, `${HOME}/d`];
    const [head] = linesOf(render({ ...previewOptions, roots }));

    expect(head).toContain('4 个根');
    expect(head).not.toContain('~/a');
  });

  test('根数为 0 时不列路径', () => {
    const [head] = linesOf(render({ ...previewOptions, roots: [] }));

    expect(head).toContain('0 个根');
  });

  test('传入 runtime 时接在顶栏尾部, 缺省不显示', () => {
    const [withRuntime] = linesOf(
      render({ ...previewOptions, runtime: 'bun 1.4.2' }),
    );
    const [without] = linesOf(render(previewOptions));

    expect(withRuntime).toContain('bun 1.4.2');
    expect(without).not.toContain('bun');
  });

  test('notes 呈为顶栏下方的中性块行, 缺省无', () => {
    const lines = linesOf(
      render({ ...previewOptions, notes: ['排除生效: beta (1 处)'] }),
    );

    expect(lines[1]).toContain('░ 排除生效: beta (1 处)');
    expect(linesOf(render(previewOptions))[1]).not.toContain('排除生效');
  });

  test('空结果时 notes 仍呈现 (置于未发现行之前)', () => {
    const lines = linesOf(
      render({
        ...previewOptions,
        entries: [],
        notes: ['排除生效: beta (1 处)'],
      }),
    );

    expect(lines[1]).toContain('排除生效');
    expect(lines[2]).toContain('未发现 node_modules');
  });
});

describe('清单行', () => {
  test('按体积降序, 与输入顺序无关', () => {
    const shuffled = [DOCS_SITE, ACME_WEB, NOTE_BOOK, DATA_PIPELINE];

    const out = render({ ...previewOptions, entries: shuffled });

    expect(listLines(out).map(projectOf)).toEqual([
      'acme-web',
      'data-pipeline',
      'docs-site',
      '学习笔记',
    ]);
  });
});

describe('档位色块', () => {
  /** 单条样例: 取清单行 (第二行) 首的档位色块字符 */
  const blockOf = (bytes: number): string => {
    const single = render({
      ...previewOptions,
      entries: [{ project: 'x', bytes, target: '/x/node_modules' }],
    });
    const row = linesOf(single)[1];
    if (row === undefined) throw new Error('清单行缺失');
    return row.charAt(2);
  };

  test('大 / 中 / 小三档各有其块', () => {
    const out = render(previewOptions);

    expect(blockOf(TIER_BIG)).toBe('█');
    expect(blockOf(TIER_MID)).toBe('▓');
    expect(blockOf(TIER_MID - 1)).toBe('▒');
    expect(out).toContain('█');
    expect(out).toContain('▓');
    expect(out).toContain('▒');
  });

  test('阈值边界: 1 GiB 与 100 MiB', () => {
    expect(blockOf(TIER_BIG)).toBe('█');
    expect(blockOf(TIER_BIG - 1)).toBe('▓');
    expect(blockOf(TIER_MID)).toBe('▓');
    expect(blockOf(TIER_MID - 1)).toBe('▒');
  });
});

describe('对齐', () => {
  const out = render(previewOptions);

  test('体积右对齐: 短体积前补空格, 最长项不补', () => {
    // 列宽由最长项 "4.6 GB" (6 列) 决定, 故 5 列的 "86 MB" 前补 1 空格
    expect(out).toContain('█ 4.6 GB');
    expect(out).toContain('▒  86 MB');
  });

  test('项目名与路径同列起 (列宽自适应最长项)', () => {
    const starts = ['acme-web', 'data-pipeline', 'docs-site'].map((project) =>
      rowOf(out, project).indexOf(project),
    );
    const paths = ['acme-web', 'data-pipeline', 'docs-site'].map((project) =>
      rowOf(out, project).indexOf('~/'),
    );

    expect(new Set(starts).size).toBe(1);
    expect(new Set(paths).size).toBe(1);
  });

  test('汉字按 2 列计, 中文项目名的补位空格少于字符数算法', () => {
    // "学习笔记" 显示宽 8, 最长名 "data-pipeline" 显示宽 13: 补 5 + 间隔 4 = 9 空格
    expect(rowOf(out, '学习笔记')).toContain(
      '学习笔记         ~/笔记/学习笔记',
    );
  });

  test('路径展示为项目目录, node_modules 后缀不外露', () => {
    expect(out).toContain('~/workspace/development/acme-web');
    expect(out).not.toContain('node_modules');
  });
});

describe('合计行', () => {
  test('处数 + 总量 + --yes 提示', () => {
    const last = linesOf(render(previewOptions)).at(-1) as string;

    expect(last).toContain('合计');
    expect(last).toContain('4 处');
    expect(last).toContain('5.3 GB');
    // 反引号是设计文档 markdown 残留, 终端 UI 输出纯 --yes
    expect(last).toContain('加 --yes 执行删除');
    expect(last).not.toContain('`');
  });
});

describe('空结果', () => {
  test('中性色块提示, 无合计行', () => {
    const out = render({ ...previewOptions, entries: [] });

    expect(out).toContain('未发现 node_modules');
    expect(out).not.toContain('合计');
    expect(linesOf(out)).toHaveLength(2);
  });
});

describe('执行模式', () => {
  const out = render({ ...previewOptions, mode: 'execute', entries: RESULTS });

  test('逐行结果标记, 失败行附原因', () => {
    const rows = listLines(out);

    expect(rows).toHaveLength(4);
    expect(rows.filter((line) => line.includes('✓'))).toHaveLength(3);
    expect(rows.filter((line) => line.includes('✗'))).toHaveLength(1);
    expect(rows[1]).toContain('data-pipeline');
    expect(rows[1]).toContain('EACCES: permission denied');
  });

  test('结尾汇总按成功 / 失败计数, 无 --yes 提示', () => {
    const last = linesOf(out).at(-1) as string;

    expect(last).toContain('汇总');
    expect(last).toContain('成功 3 处');
    expect(last).toContain('失败 1 处');
    expect(out).not.toContain('--yes');
  });

  test('全成功时失败计数为 0', () => {
    const allOk = RESULTS.map((entry) => ({
      ...entry,
      ok: true,
      error: undefined,
    }));
    const last = linesOf(
      render({ ...previewOptions, mode: 'execute', entries: allOk }),
    ).at(-1) as string;

    expect(last).toContain('成功 4 处');
    expect(last).toContain('失败 0 处');
  });
});

describe('降级 (color: false)', () => {
  test('输出零 ANSI 转义码', () => {
    expect(render(previewOptions)).not.toContain('\u001b[');
    expect(
      render({ ...previewOptions, mode: 'execute', entries: RESULTS }),
    ).not.toContain('\u001b[');
    expect(render({ ...previewOptions, entries: [] })).not.toContain('\u001b[');
  });

  test('与着色版信息与行结构一致, 仅差颜色码', () => {
    const colored = render({ ...previewOptions, color: true });

    expect(colored).toContain('\u001b[');
    expect(stripAnsi(colored)).toBe(render(previewOptions));
  });

  test('家目录未命中时不缩写, 原样输出绝对路径', () => {
    const out = render({ ...previewOptions, home: '/nope' });

    expect(out).toContain(`${HOME}/workspace/development/acme-web`);
    expect(out).not.toContain('~/');
  });
});

describe('未测到体积的占位 (bytes undefined)', () => {
  const mixed = [...SAMPLES, UNMEASURED];
  const out = render({ ...previewOptions, entries: mixed });

  test('体积列显示 ?, 档位块转中性 ░', () => {
    const row = rowOf(out, 'locked');

    expect(row).toContain('░');
    expect(row).toContain('?');
    expect(row).not.toContain('undefined');
    expect(row).not.toContain('NaN');
  });

  test('未测到的排在清单末尾', () => {
    expect(listLines(out).at(-1)).toContain('locked');
  });

  test('note 附行尾', () => {
    expect(rowOf(out, 'locked')).toContain(
      '~/workspace/development/locked  体积统计失败: 权限不足',
    );
  });

  test('合计只累加已测到的条目, 行数照常', () => {
    const last = linesOf(out).at(-1) as string;

    expect(last).toContain('5 处');
    expect(last).toContain('5.3 GB');
  });

  test('全未测到: 合计 0 B, 行数照常', () => {
    const all = [
      UNMEASURED,
      {
        ...UNMEASURED,
        project: 'locked2',
        target: `${HOME}/x/locked2/node_modules`,
      },
    ];
    const text = render({ ...previewOptions, entries: all });
    const last = linesOf(text).at(-1) as string;

    expect(listLines(text)).toHaveLength(2);
    expect(last).toContain('合计 2 处');
    expect(last).toContain('0 B');
  });

  test('降级模式零 ANSI (占位行与 note 同样不外泄转义码)', () => {
    expect(out).not.toContain('\u001b[');
  });

  test('着色模式 note 压暗, 剥色后与降级版一致', () => {
    const colored = render({ ...previewOptions, entries: mixed, color: true });

    expect(colored).toContain('\u001b[2m体积统计失败: 权限不足\u001b[0m');
    expect(stripAnsi(colored)).toBe(out);
  });

  test('执行模式: 未测到体积的行仍按 ok 给标记, 计数口径不变', () => {
    const text = render({
      ...previewOptions,
      mode: 'execute',
      entries: [UNMEASURED, { ...ACME_WEB, ok: true }],
    });
    const last = linesOf(text).at(-1) as string;

    expect(rowOf(text, 'locked')).toContain('?');
    expect(rowOf(text, 'locked')).toContain('✓');
    expect(rowOf(text, 'locked')).toContain('体积统计失败: 权限不足');
    expect(last).toContain('成功 2 处');
    expect(last).toContain('失败 0 处');
  });
});

describe('释放体积 (releasedBytes)', () => {
  test('提供时汇总行补释放体积', () => {
    const last = linesOf(
      render({
        ...previewOptions,
        mode: 'execute',
        entries: RESULTS,
        releasedBytes: Math.round(4.6 * GIB),
      }),
    ).at(-1) as string;

    expect(last).toContain('成功 3 处');
    expect(last).toContain('释放 4.6 GB');
    expect(last).toContain('失败 1 处');
  });

  test('缺省时维持原文案 (向后兼容)', () => {
    const last = linesOf(
      render({ ...previewOptions, mode: 'execute', entries: RESULTS }),
    ).at(-1) as string;

    expect(last).toBe('  █ 汇总 成功 3 处 · 失败 1 处');
  });

  test('释放 0 与未提供区分开', () => {
    const last = linesOf(
      render({
        ...previewOptions,
        mode: 'execute',
        entries: RESULTS,
        releasedBytes: 0,
      }),
    ).at(-1) as string;

    expect(last).toContain('释放 0 B');
  });
});

describe('金样板', () => {
  test('预览 (着色)', () => {
    assertGolden(
      'render-preview-color',
      render({ ...previewOptions, color: true }),
    );
  });

  test('执行 (降级)', () => {
    assertGolden(
      'render-execute-degraded',
      render({ ...previewOptions, mode: 'execute', entries: RESULTS }),
    );
  });

  test('预览 (含未测到体积的占位行)', () => {
    assertGolden(
      'render-preview-placeholder',
      render({
        ...previewOptions,
        entries: [...SAMPLES, UNMEASURED],
        color: true,
      }),
    );
  });

  test('执行 (含 releasedBytes)', () => {
    assertGolden(
      'render-execute-released',
      render({
        ...previewOptions,
        mode: 'execute',
        entries: RESULTS,
        releasedBytes: Math.round(4.6 * GIB),
      }),
    );
  });

  test('预览 (含净化改写行)', () => {
    assertGolden(
      'render-preview-sanitized',
      render({
        ...previewOptions,
        entries: [...SAMPLES, REWRITTEN],
        color: true,
      }),
    );
  });
});
