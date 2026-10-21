import { afterEach, expect, test } from 'bun:test';

import '../lite/test-support/browser-globals.js';

import IfType from '#/config/IfType.js';
import { Client } from '#/client/Client.js';
import { getInterfaceOptions, searchGE } from '../lite/actions.js';
import { collectGEState } from './ge-state.js';
import type { GEState } from '../../../../sdk/ge-types.js';
import Packet from '#/io/Packet.js';
import { MarketSearchInput } from '../client/MarketSearchInput.js';
import { ClientProt } from '#/io/ClientProt.js';
const original = IfType.list;
afterEach(() => {
    IfType.list = original;
});

test('viewport collectors omit hidden descendants and prefer displayed text', () => {
    IfType.list = [
        { type: 0, children: [1, 3, 4] },
        { type: 0, hide: true, children: [2] },
        { type: 4, buttonType: 1, buttonText: 'Confirm offer', text: '' },
        { type: 4, buttonType: 1, buttonText: 'Select', text: 'Collect as banknotes and coins' }
    ] as any;
    for (const options of [getInterfaceOptions({ mainModalId: 0 } as any), Client.prototype.getInterfaceOptions.call({ mainModalId: 0 } as any)]) {
        expect(options).toEqual([{ index: 1, text: 'Collect as banknotes and coins', componentId: 3 }]);
    }
});

test('GE metadata is atomic, root-scoped, and unavailable when closed or invalid', () => {
    const state: GEState = {
        isOpen: true, session: 1, revision: 2, actionRevision: 0, screen: 'home', offers: [],
        controls: {home: 10}, selectedOffer: null, draft: null, search: null, input: null,
        notice: '', error: null, receipt: null,
    };
    const list = [
        { clientCode: 0, text: null, children: [1] },
        { clientCode: 30403, text: JSON.stringify(state), children: null }
    ];
    expect(collectGEState(list, 0)).toEqual(state);
    expect(collectGEState(list, -1)).toBeNull();
    expect(collectGEState(list, 999)).toBeNull();
    list[1]!.text = '{';
    expect(collectGEState(list, 0)).toBeNull();
    list[1]!.text = '';
    expect(collectGEState(list, 0)).toBeNull();
});

test('bot search uses the native MARKET_SEARCH wire packet and requires visible catalogue', () => {
    IfType.list = [
        { id: 0, type: 0, children: [1] },
        { id: 1, type: 4, clientCode: 30400, children: null }
    ] as any;
    for (const normal of [false, true]) {
        const out = Packet.alloc(1);
        const marketSearchInput = new MarketSearchInput(
            (query, item) => {
                out.p1(ClientProt.MARKET_SEARCH);
                out.p1(query.length + 3);
                out.pjstr(query);
                out.p2(item);
            },
            () => {}
        );
        const client = {
            marketSearchInput,
            ingame: true,
            isInGame: () => true,
            mainModalId: 0,
            dialogInputOpen: false,
            out,
            writeOpcode: (id: number) => out.p1(id)
        };
        const send = (query: string) => (normal ? Client.prototype.searchGE.call(client as any, query) : searchGE(client as any, query));
        expect(send('rscim')).toBe(true);
        out.pos = 0;
        expect(out.g1()).toBe(ClientProt.MARKET_SEARCH);
        expect(out.g1()).toBe(8);
        expect(out.gjstr()).toBe('rscim');
        expect(out.g2()).toBe(0);
        out.pos = 0;
        client.mainModalId = -1;
        expect(send('logs')).toBe(false);
        expect(out.pos).toBe(0);
        client.mainModalId = 0;
        client.dialogInputOpen = true;
        expect(send('logs')).toBe(false);
        expect(out.pos).toBe(0);
        client.dialogInputOpen = false;
        expect(send('x'.repeat(49))).toBe(false);
        expect(send('☃')).toBe(false);
        expect(out.pos).toBe(0);
        out.release();
    }
});
