/**
 * 金样板断言 (自制, 替代 bun 内置快照)。
 *
 * 为何不用 bun 快照: 其样板目录被硬编码为「测试文件同级 / __snapshots__」, 官方不提供任何
 * 配置入口 (文档与二进制探针双证), 而本仓要求语义化的样板名与自控的落点; 金样板是普通
 * 文本文件, 命名与位置由调用方给定, 可直接人工审阅与 diff, 也不引入测试框架的隐式状态。
 */
import { expect } from 'bun:test';

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 样板落点: 与本模块同级的 goldens 目录 (相对 import.meta.url 解析, 与进程 cwd 无关) */
const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), 'goldens');

/** 更新开关: 置 1 时写入样板并直接通过 (仅在有意改动输出后用于再生成) */
const UPDATE = process.env.UPDATE_GOLDEN === '1';

/**
 * 断言实际输出与金样板逐字相等 (差异经 expect().toBe() 呈现)。
 * 样板缺失 (首次运行) 时抛出带生成指引的错误, 不静默通过。
 */
export function assertGolden(name: string, actual: string): void {
  const file = join(GOLDEN_DIR, `${name}.txt`);

  if (UPDATE) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(file, actual);
    return;
  }

  let expected: string;
  try {
    expected = readFileSync(file, 'utf8');
  } catch {
    throw new Error(
      `金样板缺失: ${file}\n首次生成, 或有意改动输出后: UPDATE_GOLDEN=1 bun test`,
    );
  }

  expect(actual).toBe(expected);
}
