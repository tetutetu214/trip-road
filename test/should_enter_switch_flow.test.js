/**
 * F-4: shouldEnterSwitchFlow の純粋関数テスト。
 *
 * - 通常時（市町村が変わったとき）は true
 * - 通常時（市町村が同じ）は false
 * - 初回 fix のときは市町村が同じでも true（自宅起動で解説を出すための条件）
 */

import { describe, it, expect } from 'vitest';
import { shouldEnterSwitchFlow } from '../public/assets/switch_flow.js';

describe('shouldEnterSwitchFlow', () => {
    it('市町村が変わったときは true', () => {
        expect(shouldEnterSwitchFlow('14218', '14150', false)).toBe(true);
    });

    it('市町村が同じで初回 fix でないときは false', () => {
        expect(shouldEnterSwitchFlow('14218', '14218', false)).toBe(false);
    });

    it('市町村が同じでも初回 fix なら true（自宅起動で解説を出す）', () => {
        expect(shouldEnterSwitchFlow('14218', '14218', true)).toBe(true);
    });

    it('currentCode が null（初回起動時）は当然 true', () => {
        expect(shouldEnterSwitchFlow('14218', null, true)).toBe(true);
        expect(shouldEnterSwitchFlow('14218', null, false)).toBe(true);
    });

    it('wasFirstFix が undefined / 非 true は通常判定（false 扱い）', () => {
        expect(shouldEnterSwitchFlow('14218', '14218', undefined)).toBe(false);
        expect(shouldEnterSwitchFlow('14218', '14218', 0)).toBe(false);
    });
});
