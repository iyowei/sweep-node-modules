/**
 * npm 启动器冒烟: `bin/sweep-nm.mjs` 挑选运行时后透传参数与退出码。
 * 它是 npm 分发形态的用户入口 (经 bin shim 调用), 与仓库内的 sh / cmd 启动器同职责;
 * 三者逻辑一致, 本测试钉住其中的参数透传与退出码透传两条外部可观测契约。
 */
import { describe, expect, test } from 'bun:test';

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const LAUNCHER = join(ROOT, 'bin', 'sweep-nm.mjs');

/** 以当前运行时执行启动器, 断言其对外行为而非内部实现 */
const run = (...args: string[]) =>
  spawnSync(process.execPath, [LAUNCHER, ...args], { encoding: 'utf8' });

describe('npm 启动器', () => {
  test('透传 --help 且零退出', () => {
    const { status, stdout } = run('--help');

    expect(status).toBe(0);
    expect(stdout).toContain('SWEEP-NM');
  });

  test('非零退出码原样回传 (参数错误退 1, 见行为契约 BC-27)', () => {
    const { status } = run('--definitely-not-a-flag');

    expect(status).toBe(1);
  });
});
