import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { handOffFrom } from '../runner/handoff';
import { STAND_IN_STEP } from '../runner/run-report';
import { GIVER_TILE, WINES } from '../skills/cooking';
import { MANIFEST } from '../tools/slot-ledger';
import { giverGaps } from './dress-rehearsal';
import { runsS25c, stageWineGiver, wineGiverGaps } from './wine-giver';

const S25C = [{ id: 'S25e', name: 'S25e herblore' }, { id: 'S25c', name: 'S25c cooking' }, { id: 'T25-26', name: 'leg' }];
const JUMPED = [{ id: 'S25e', name: 'S25e herblore' }, { id: 'S25c', name: `${STAND_IN_STEP} S25c (staff jump to T25-26)` }, { id: 'T25-26', name: 'leg' }];
const none = { ringers: [], altarGivers: [] };

describe('stageWineGiver', () => {
    test("H21c's row is the 520 noted wines the giver is staged with", () => {
        const plan = handOffFrom(readFileSync(MANIFEST, 'utf8'), 'H21c');
        expect(plan.receive.map(r => [r.name, r.count])).toEqual([['unfermented wine', WINES]]);
    });

    test('clears the pack, stands beside the booth stand, then the notes by ::give', async () => {
        const said: string[] = [];
        let state = { tick: 1, player: { worldX: 3200, worldZ: 3200, level: 0 }, inventory: [{ id: 1 }] as unknown[] };
        const listeners: ((s: unknown) => void)[] = [];
        const sdk = {
            getState: () => state,
            onStateUpdate: (f: (s: unknown) => void) => (listeners.push(f), () => {}),
            sendSay: async (t: string) => {
                said.push(t);
                const m = /^::tele 0,(\d+),(\d+),(\d+),(\d+)$/.exec(t);
                const tele = /^::tele/.test(t);
                state = { ...state, tick: state.tick + 1, ...(t === '::~clearinv inv' ? { inventory: [] } : {}), ...(tele ? { player: { worldX: GIVER_TILE.x, worldZ: GIVER_TILE.z, level: 0 } } : {}) };
                void m;
                for (const f of listeners) f(state);
            },
        };
        // Ticks keep coming while the helpers wait their settle ticks.
        const timer = setInterval(() => {
            state = { ...state, tick: state.tick + 1 };
            for (const f of listeners) f(state);
        }, 5);
        try {
            await stageWineGiver({ sdk: sdk as never });
        } finally {
            clearInterval(timer);
        }
        expect(said[0]).toBe('::~clearinv inv');
        expect(said.some(t => t.startsWith('::tele'))).toBe(true);
        expect(said.at(-1)).toBe(`::give cert_jug_unfermented_wine ${WINES}`);
    });

    test('cooking-accept.ts and dress-rehearsal.ts stage and serve the giver through it', () => {
        for (const f of ['cooking-accept.ts', 'dress-rehearsal.ts']) {
            const src = readFileSync(join(import.meta.dir, f), 'utf8');
            expect(src).toMatch(/import \{[^}]*\bstageWineGiver\b[^}]*\} from '\.\/wine-giver'/);
            expect(src).toMatch(/\bserveWine\(/);
            expect(src).not.toContain('give cert_jug_unfermented_wine');
        }
    });
});

describe('wineGiverGaps (S25c without its wine giver refuses, before SCORED logs in)', () => {
    test('a slice running S25c with no --wine-giver refuses, naming S25c, the flag and --staff-steps', () => {
        const gaps = wineGiverGaps(S25C, {});
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toContain('S25c');
        expect(gaps[0]).toContain('--wine-giver=');
        expect(gaps[0]).toContain('--staff-steps=S25c');
    });

    test('a slice without S25c, or with S25c staff-jumped, needs no wine giver', () => {
        expect(wineGiverGaps([{ id: 'S25a' }], {})).toEqual([]);
        expect(runsS25c(JUMPED)).toBe(false);
        expect(wineGiverGaps(JUMPED, {})).toEqual([]);
    });

    test('the giver needs a lite runner (on LAB_HELPERS when it is set), and no other flag names it', () => {
        expect(wineGiverGaps(S25C, { wineGiver: 'lab_wine' })).toEqual([]);
        expect(wineGiverGaps(S25C, { wineGiver: 'lab_wine', labHelpers: ['lab_wine'] })).toEqual([]);
        expect(wineGiverGaps(S25C, { wineGiver: 'lab_wine', labHelpers: ['lab_r1'] })[0]).toContain('is not on LAB_HELPERS');
        expect(wineGiverGaps(S25C, { wineGiver: 'lab_r1', others: ['lab_r1'] })[0]).toContain('named by --wine-giver and by another giver flag');
    });

    test('giverGaps carries it: refused without --wine-giver, clear with it, clear when --staff-steps jumped S25c', () => {
        expect(giverGaps(S25C, none)[0]).toContain('--wine-giver=');
        expect(giverGaps(S25C, { ...none, wineGiver: 'lab_wine' })).toEqual([]);
        expect(giverGaps(JUMPED, none)).toEqual([]);
        expect(giverGaps(S25C, { ringers: ['lab_wine'], altarGivers: [], wineGiver: 'lab_wine' }).join(' ')).toContain('lab_wine is named by --wine-giver and by another giver flag');
    });
});
