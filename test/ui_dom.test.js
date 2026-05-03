/**
 * setDescription / clearDescription の DOM 副作用テスト。
 *
 * vitest の environment は node 固定（vitest.config.js）なので、
 * 依存追加を避けるために document を最小限スタブする。
 * 検証対象は classList と textContent のみで、レイアウト計算には踏み込まない。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    setDescription,
    setDescriptionFailed,
    clearDescription,
    setDescriptionLoadingPhase,
} from '../public/assets/ui.js';

function makeEl() {
    const classes = new Set();
    return {
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c),
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
    };
    // 初期状態: skeleton と loading-text は hidden（index.html の初期状態と同じ）
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
        // 再生成中の状態を作る: loading-text に文言が出ている
        setDescriptionLoadingPhase('regenerating');
        expect(els['description-loading-text'].classList.contains('hidden')).toBe(false);
        expect(els['description-loading-text'].textContent).toBe('✏️ より良い表現に書き直しています…');

        setDescription('土地のたより本文');

        expect(els.description.textContent).toBe('土地のたより本文');
        expect(els['description-skeleton'].classList.contains('hidden')).toBe(true);
        // 「より良い表現に書き直しています…」が画面に残らないこと
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
