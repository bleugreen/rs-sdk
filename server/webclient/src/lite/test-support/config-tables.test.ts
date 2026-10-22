// useOwnConfigTables hands back the config tables a suite found, so stubs it
// installs never reach a later file.

import { beforeAll, describe, expect, test } from 'bun:test';

import './browser-globals.js';

import LocType from '#/config/LocType.js';
import NpcType from '#/config/NpcType.js';

import { useOwnConfigTables } from './config-tables.js';

describe('with config tables already loaded', () => {
    useOwnConfigTables(LocType, NpcType);

    const found = { locIdx: Int32Array.from([0, 5, 9]), locRecent: [new LocType()], npcIdx: Int32Array.from([0, 7]) };
    beforeAll(() => {
        LocType.idx = found.locIdx;
        LocType.recent = found.locRecent;
        LocType.recentPos = 0;
        NpcType.idx = found.npcIdx;
    });

    describe('a suite that installs one-entry tables', () => {
        useOwnConfigTables(LocType, NpcType);

        test('reads its own tables', () => {
            LocType.idx = Int32Array.from([1]);
            LocType.recent = [];
            LocType.recentPos = 3;
            NpcType.idx = Int32Array.from([1]);
            expect(LocType.idx).not.toBe(found.locIdx);
        });
    });

    test('the loaded tables are back once that suite ends', () => {
        expect(LocType.idx).toBe(found.locIdx);
        expect(LocType.recent).toBe(found.locRecent);
        expect(LocType.recentPos).toBe(0);
        expect(NpcType.idx).toBe(found.npcIdx);
    });
});
