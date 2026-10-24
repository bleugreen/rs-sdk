import { describe, expect, test } from 'bun:test';
import { BODY_ROSTER_SIZE, giverEntries, handBackSlot } from '../helpers/roster';
import { parseLaunchConfig } from '../helpers/standalone';
import { STAND_IN_STEP } from '../runner/run-report';
import { objPack } from '../lib/obj-pack';
import { runsS21, s21GiverGaps, s21GiverLaunch, S21_PORT_OFFSET } from './s21-launch';

const GIVERS = Array.from({ length: BODY_ROSTER_SIZE }, (_, i) => `cairn_ds${String(i + 1).padStart(2, '0')}`);
const S21 = [{ id: 'T20-21', name: 'leg' }, { id: 'S21', name: 'S21 runecraft:pre-login' }, { id: 'S21', name: 'S21 runecraft' }];

describe('s21GiverLaunch', () => {
    const c = s21GiverLaunch({ givers: GIVERS, botsDir: '/tmp/b', runDir: '/tmp/r', gatewayPort: 8300 + S21_PORT_OFFSET });
    const hb = handBackSlot(undefined, GIVERS.length);

    test("the production roster's entries (slots 0-2, direct, 27 a trade, {S21, altar} scope and loginOn), only the restock the lab's", () => {
        expect(c.gatewayPort).toBe(8313);
        const prod = giverEntries(GIVERS, { role: 'altar-giver' }) as { options: Record<string, unknown> }[];
        for (const [i, e] of c.accounts.entries()) {
            const { restock: _, ...lab } = e.options as Record<string, unknown>;
            const { restock: __, ...day } = prod[i]!.options;
            expect(lab).toEqual(day);
            expect([e.options.altar, e.options.slot, e.options.essence, e.path, e.loginOn]).toEqual(['body', i % 3, 27, 'direct', { step: 'S21', family: 'altar' }]);
        }
    });

    test("every essence giver restocks by ::give; the hand-back giver's bank is seeded with its trades' essence and the runes, so its last trip is runes-only", () => {
        expect(c.accounts.filter((_, i) => i !== hb.index).every(e => (e.options.restock as { kind: string }).kind === 'cheat')).toBe(true);
        const h = c.accounts[hb.index]!;
        expect(h.options.handBack).toEqual([{ item: 'Law rune', n: 1 }, { item: 'Air rune', n: 3 }, { item: 'Earth rune', n: 1 }]);
        expect(h.options.restock).toEqual({ kind: 'bank', labSeed: { essence: hb.essence, items: [{ obj: 'lawrune', n: 1 }, { obj: 'airrune', n: 3 }, { obj: 'earthrune', n: 1 }] } });
        const pack = objPack();
        for (const i of (h.options.restock as { labSeed: { items: { obj: string }[] } }).labSeed.items) expect(pack.ids.has(i.obj)).toBe(true);
    });

    test('standalone.ts takes it as written: logged out until {S21, altar} opens, out on its close', () => {
        const parsed = parseLaunchConfig(c);
        expect(parsed.accounts).toHaveLength(BODY_ROSTER_SIZE);
        for (const e of parsed.accounts) {
            expect([e.role, e.path, e.final, e.loginOn?.step, e.loginOn?.family, e.stopOn]).toEqual(['altar-giver', 'direct', false, 'S21', 'altar', { step: 'S21', family: 'altar' }]);
        }
    });
});

describe('s21GiverGaps', () => {
    test('a slice running S21 needs the roster; a staff-jumped S21 or none needs nothing', () => {
        expect(s21GiverGaps(S21, {})[0]).toContain('--s21-givers=');
        expect(s21GiverGaps(S21, { givers: GIVERS })).toEqual([]);
        expect(s21GiverGaps([{ id: 'S22' }], {})).toEqual([]);
        expect(runsS21([{ id: 'S21', name: `${STAND_IN_STEP} S21` }])).toBe(false);
    });

    test('22 distinct cairn_ names, none on LAB_HELPERS or another flag', () => {
        expect(s21GiverGaps(S21, { givers: GIVERS.slice(0, 7) })[0]).toContain('names 7 giver(s)');
        expect(s21GiverGaps(S21, { givers: [...GIVERS.slice(0, 21), 'cairn_ds01'] })).toContain('S21: --s21-givers names a giver twice');
        expect(s21GiverGaps(S21, { givers: GIVERS, labHelpers: ['cairn_ds03'] })[0]).toContain('is on LAB_HELPERS');
        expect(s21GiverGaps(S21, { givers: GIVERS, others: { '--altar-givers': ['cairn_ds04'] } })[0]).toContain('named by both --altar-givers and --s21-givers');
    });
});
