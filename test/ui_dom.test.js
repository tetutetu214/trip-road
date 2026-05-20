/**
 * setDescription / clearDescription / setDescriptionNoWikipedia の DOM 副作用テスト。
 *
 * vitest の environment は node 固定（vitest.config.js）なので、
 * document を最小限スタブして classList と textContent のみ検証する。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    setDescription,
    setDescriptionFailed,
    setDescriptionNoWikipedia,
    clearDescription,
    setDescriptionLoadingPhase,
    setElevation,
    setHillshadeToggleState,
} from '../public/assets/ui.js';

function makeEl() {
    const classes = new Set();
    return {
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c),
            toggle: (c, force) => {
                const want = force === undefined ? !classes.has(c) : !!force;
                if (want) classes.add(c); else classes.delete(c);
                return want;
            },
        },
        style: {},
        textContent: '',
    };
}

let savedDocument;
let savedRAF;
let els;

beforeEach(() => {
    savedDocument = globalThis.document;
    savedRAF = globalThis.requestAnimationFrame;
    els = {
        description: makeEl(),
        'description-skeleton': makeEl(),
        'description-loading-text': makeEl(),
        elevation: makeEl(),
        'hillshade-toggle': makeEl(),
    };
    // hillshade-toggle に最小限の属性 API を追加
    els['hillshade-toggle'].attrs = {};
    els['hillshade-toggle'].setAttribute = function (k, v) { this.attrs[k] = v; };
    els['hillshade-toggle'].getAttribute = function (k) { return this.attrs[k] ?? null; };
    els['description-skeleton'].classList.add('hidden');
    els['description-loading-text'].classList.add('hidden');
    globalThis.document = {
        getElementById: (id) => els[id] ?? null,
    };
    globalThis.requestAnimationFrame = (fn) => fn();
});

afterEach(() => {
    globalThis.document = savedDocument;
    globalThis.requestAnimationFrame = savedRAF;
});

describe('setDescription', () => {
    it('本文を反映し、skeleton と loading-text を hidden にする（再生成完了時の文言残留防止）', () => {
        setDescriptionLoadingPhase('regenerating');
        expect(els['description-loading-text'].classList.contains('hidden')).toBe(false);
        expect(els['description-loading-text'].textContent).toBe('✏️ より良い表現に書き直しています…');

        setDescription('土地のたより本文');

        expect(els.description.textContent).toBe('土地のたより本文');
        expect(els['description-skeleton'].classList.contains('hidden')).toBe(true);
        expect(els['description-loading-text'].classList.contains('hidden')).toBe(true);
    });

    it('muted クラスは外す', () => {
        els.description.classList.add('muted');
        setDescription('本文');
        expect(els.description.classList.contains('muted')).toBe(false);
    });
});

describe('clearDescription', () => {
    it('本文と loading-text を共にクリアする', () => {
        els.description.textContent = '前回の表示';
        setDescriptionLoadingPhase('judging');
        expect(els['description-loading-text'].classList.contains('hidden')).toBe(false);

        clearDescription();

        expect(els.description.textContent).toBe('');
        expect(els['description-skeleton'].classList.contains('hidden')).toBe(true);
        expect(els['description-loading-text'].classList.contains('hidden')).toBe(true);
    });
});

describe('setDescriptionFailed', () => {
    it('失敗時もエラー表示と共に loading-text を hidden にする', () => {
        setDescriptionLoadingPhase('generating');
        expect(els['description-loading-text'].classList.contains('hidden')).toBe(false);

        setDescriptionFailed();

        expect(els.description.textContent).toBe('解説を取得できませんでした');
        expect(els.description.classList.contains('muted')).toBe(true);
        expect(els['description-skeleton'].classList.contains('hidden')).toBe(true);
        expect(els['description-loading-text'].classList.contains('hidden')).toBe(true);
    });
});

describe('setDescriptionNoWikipedia (Plan I)', () => {
    it('Wikipedia 記事なしのメッセージを表示し、loading-text を hidden にする', () => {
        setDescriptionLoadingPhase('generating');
        expect(els['description-loading-text'].classList.contains('hidden')).toBe(false);

        setDescriptionNoWikipedia();

        expect(els.description.textContent).toBe('この市町村の Wikipedia 記事が見つかりませんでした');
        expect(els.description.classList.contains('muted')).toBe(true);
        expect(els['description-skeleton'].classList.contains('hidden')).toBe(true);
        expect(els['description-loading-text'].classList.contains('hidden')).toBe(true);
    });
});

describe('setElevation (Issue #46)', () => {
    it('数値を渡すと textContent にその文字列が入る', () => {
        setElevation(123);
        expect(els.elevation.textContent).toBe('123');
    });
    it('0 も "0" として表示する（海抜 0m）', () => {
        setElevation(0);
        expect(els.elevation.textContent).toBe('0');
    });
    it('null は "--" 表示', () => {
        setElevation(null);
        expect(els.elevation.textContent).toBe('--');
    });
    it('undefined も "--" 表示', () => {
        setElevation(undefined);
        expect(els.elevation.textContent).toBe('--');
    });
});

describe('setHillshadeToggleState (Issue #46)', () => {
    it('true で hillshade-on クラスと aria-pressed=true を付与', () => {
        setHillshadeToggleState(true);
        expect(els['hillshade-toggle'].classList.contains('hillshade-on')).toBe(true);
        expect(els['hillshade-toggle'].getAttribute('aria-pressed')).toBe('true');
    });
    it('false で hillshade-on クラスを外し、aria-pressed=false を付与', () => {
        setHillshadeToggleState(true);
        setHillshadeToggleState(false);
        expect(els['hillshade-toggle'].classList.contains('hillshade-on')).toBe(false);
        expect(els['hillshade-toggle'].getAttribute('aria-pressed')).toBe('false');
    });
});
