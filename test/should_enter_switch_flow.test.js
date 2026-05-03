/**
 * F-4: shouldEnterSwitchFlow の純粋関数テスト。
 *
 * - 通常時（市町村が変わったとき）は true
 * - 通常時（市町村が同じ）は false
 * - 初回 fix のときは市町村が同じでも true（自宅起動で解説を出すための条件）
 */

import { describe, it, expect } from 'vitest';
import { shouldEnterSwitchFlow } from '../public/assets/switch_flow.js';

// テスト用の架空市町村コード（実在の自宅と紐付かない値を意図的に使う）
const CODE_A = '13101';
const CODE_B = '13104';

describe('shouldEnterSwitchFlow', () => {
    it('市町村が変わったときは true', () => {
        expect(shouldEnterSwitchFlow(CODE_A, CODE_B, false)).toBe(true);
    });

    it('市町村が同じで初回 fix でないときは false', () => {
        expect(shouldEnterSwitchFlow(CODE_A, CODE_A, false)).toBe(false);
    });

    it('市町村が同じでも初回 fix なら true（自宅起動で解説を出す）', () => {
        expect(shouldEnterSwitchFlow(CODE_A, CODE_A, true)).toBe(true);
    });

    it('currentCode が null（初回起動時）は当然 true', () => {
        expect(shouldEnterSwitchFlow(CODE_A, null, true)).toBe(true);
        expect(shouldEnterSwitchFlow(CODE_A, null, false)).toBe(true);
    });

    it('wasFirstFix が undefined / 非 true は通常判定（false 扱い）', () => {
        expect(shouldEnterSwitchFlow(CODE_A, CODE_A, undefined)).toBe(false);
        expect(shouldEnterSwitchFlow(CODE_A, CODE_A, 0)).toBe(false);
    });
});
