import { expect, test } from 'bun:test';

import '../lite/test-support/browser-globals.js';

import { MarketSearchInput, displayedSearchItem, SEARCH_FIELD, SEARCH_CLEAR, SEARCH_ACK, RESULT_BUTTON, RESULT_ICON, SEARCH_PLACEHOLDER, type SearchComponent } from '../client/MarketSearchInput';

function fixture() {
    const list: SearchComponent[] = Array.from({ length: 7 }, (_, id) => ({ id, clientCode: 0, type: 4, hide: false, children: null, text: '' }));
    Object.assign(list[0], { type: 0, children: [1, 2, 3, 4, 5] });
    Object.assign(list[1], { clientCode: SEARCH_FIELD, text: SEARCH_PLACEHOLDER });
    list[2].clientCode = SEARCH_CLEAR;
    list[3].clientCode = SEARCH_ACK;
    list[4].clientCode = RESULT_BUTTON;
    Object.assign(list[5], { clientCode: RESULT_ICON, type: 2, linkObjType: [1334] });
    const sent: { query: string; item: number }[] = [];
    let closed = false;
    const input = new MarketSearchInput(
        (query, item) => sent.push({ query, item }),
        () => (closed = true)
    );
    input.sync(list, 0, false, 0);
    const type = (s: string, now = 10) => {
        for (const char of s) expect(input.key(char.charCodeAt(0), now)).toBe(true);
    };
    return { list, input, sent, type, closed: () => closed };
}
test('typing debounces, stays out of chat, and Enter flushes immediately', () => {
    const { input, list, sent, type } = fixture();
    type('rscim');
    input.sync(list, 0, false, 189);
    expect(sent).toHaveLength(0);
    input.sync(list, 0, false, 190);
    expect(sent).toEqual([{ query: 'rscim', item: 0 }]);
    expect(list[1].text).toBe('rscim*');
    expect(input.key(8, 200)).toBe(true);
    input.key(13, 201);
    expect(sent[1]).toEqual({ query: 'rsci', item: 0 });
    expect(input.key('@'.charCodeAt(0))).toBe(true);
});
test('stale results cannot select another item while filtering is in flight', () => {
    const { input, list, sent, type } = fixture();
    type('rune');
    input.click(4);
    expect(sent).toEqual([{ query: 'rune', item: 0 }]);
    list[3].text = 'rune';
    input.click(4);
    expect(sent[1]).toEqual({ query: 'rune', item: 1333 });
    expect(displayedSearchItem(list, 0, 99)).toBeUndefined();
    list[0].hide = true;
    expect(displayedSearchItem(list, 0, 4)).toBeUndefined();
});

test('reopening uses the server receipt, never the painted cursor or truncated query', () => {
    const { input, list, sent } = fixture();
    input.sync(list, -1);
    list[1].text = '...a truncated display*';
    list[3].text = 'rscim';
    input.sync(list, 0);
    input.click(4);
    expect(sent).toEqual([{query:'rscim',item:1333}]);
});
test('clear, navigation, input bounds and modal closure flush or discard as appropriate', () => {
    const { input, list, sent, type, closed } = fixture();
    type('x'.repeat(60));
    input.key(13);
    expect(sent[0].query).toHaveLength(48);
    input.click(2);
    expect(sent[1]).toEqual({ query: '', item: 0 });
    type('logs');
    expect(input.click(6)).toBe(false);
    expect(sent[2]).toEqual({ query: 'logs', item: 0 });
    type('oops');
    input.sync(list, -1, false, 1000);
    input.sync(list, -1, false, 2000);
    expect(sent).toHaveLength(3);
    expect(input.key(65)).toBe(false);
    list[1].text = 'logs';
    input.sync(list, 0, false, 2001);
    input.key(27);
    expect(closed()).toBe(true);
});
