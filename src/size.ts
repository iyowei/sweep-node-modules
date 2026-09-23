/**
 * 体积模块门面 (已裁定: 策略 A 双轨): du 可用走快路径, 否则纯实现基线。
 * 策略与展示口径见 docs/designs/scan-and-size.md「体积统计」; 换策略只改此一处。
 */
import { createDuSizer, findDu } from './size-du.ts';
import { createJsSizer } from './size-js.ts';
import type { Sizer } from './types.ts';

export function createSizer(): Sizer {
  return findDu() !== null ? createDuSizer() : createJsSizer();
}
