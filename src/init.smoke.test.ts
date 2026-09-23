/**
 * 初始化向导真实壳长驻回归: spawn init.smoke.ts 走真实管道 stdin, 双载体 (bun / node)。
 * spawnSync 必带 timeout: 历史失败模式是 readline 壳死锁 (每问新开 interface 遇已发生的 EOF
 * 永久挂起), 无超时守卫则挂死不可判, 该回归就锁不住它 (对齐 runtime.test.ts 冒烟先例, 补超时)。
 */
import { describe, expect, test } from 'bun:test';

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SMOKE = fileURLToPath(new URL('./init.smoke.ts', import.meta.url));
const CWD = fileURLToPath(new URL('..', import.meta.url));

/** 挂死守卫: 正常全跑 (三场景) 远低于此值, 超时即判失败 */
const TIMEOUT_MS = 10_000;

for (const runner of ['bun', 'node']) {
  const available =
    spawnSync(runner, ['--version'], { encoding: 'utf8' }).status === 0;

  describe(`init smoke [${runner}]`, () => {
    test.skipIf(!available)(
      '向导三态全通: 多行投喂 / EOF 取消 / 覆盖保护拒绝 (exit 0, 含超时守卫)',
      () => {
        const dir = mkdtempSync(join(tmpdir(), 'sweep-lab-init-smoke-'));
        try {
          const configPath = join(dir, 'config.json');
          const result = spawnSync(runner, [SMOKE, configPath], {
            cwd: CWD,
            encoding: 'utf8',
            timeout: TIMEOUT_MS,
          });

          const detail = `signal=${result.signal} status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`;
          expect(result.status, `冒烟挂死或失败 (${detail})`).toBe(0);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
    );
  });
}
