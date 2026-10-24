import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { objPack } from '../lib/obj-pack';
import { CANNON_ROWS, PLACEMENT } from '../runner/chain';
import { handOffFrom } from '../runner/handoff';
import { MANIFEST } from '../tools/slot-ledger';
import { debugNameFor, LEDGER_OBJS } from '../lib/ledger-objs';
import { stageRows } from './stub-giver';

const manifest = readFileSync(MANIFEST, 'utf8');

describe('stub-giver staging', () => {
    test("H4m's loads, which share one fallback row H4m.1-H4m.N, each stage that row's bones", () => {
        const { rows: staged, unresolved } = stageRows(manifest, { rows: [{ row: 'H4m.1', tile: { x: 0, z: 0 } }, { row: 'H4m.5', tile: { x: 0, z: 0 } }] });
        expect(unresolved).toEqual([]);
        for (const r of staged) {
            expect(r.stage).toEqual([{ obj: 'babydragon_bones', n: 20 }]);
            expect(r.want).toEqual([]);
        }
        expect(() => stageRows(manifest, { rows: [{ row: 'H4m.6', tile: { x: 0, z: 0 } }] })).toThrow('no ledger row H4m.6');
    });

    test("every placed row but the cannon rows (cannon.ts's lab mode serves those) stages with a ::give name for each item", () => {
        const rows = Object.keys(PLACEMENT).filter(r => !CANNON_ROWS[r] && manifest.includes(`| ${r} |`)).map(row => ({ row, tile: { x: 0, z: 0 } }));
        const { rows: staged, unresolved } = stageRows(manifest, { rows });
        expect(unresolved).toEqual([]);
        expect(staged.map(r => r.row)).toEqual(rows.map(r => r.row));
        const h1 = staged.find(r => r.row === 'H1')!;
        expect(h1.stage).toContainEqual({ obj: 'staff_of_water', n: 1 });
        // H11r as the row in force has it (two-way since fold-in 23): its `in` staged and offered, its `out` (the set, the balls) wanted back.
        const plan = handOffFrom(manifest, 'H11r');
        const h11r = staged.find(r => r.row === 'H11r')!;
        expect([h11r.stage.length, h11r.offer.length, h11r.want.length]).toEqual([plan.receive.length, plan.receive.length, plan.give.length]);
        expect(h11r.want.length).toBe(5);
    });

    test("every noted [n] entry stages as its note, by id or by name: H21d's gems, leather, unfinished potions and secondaries (S25d, S25e and S25c's supply)", () => {
        const plan = handOffFrom(manifest, 'H21d');
        const { rows: staged, unresolved } = stageRows(manifest, { rows: [{ row: 'H21d', tile: { x: 0, z: 0 } }] });
        expect(unresolved).toEqual([]);
        const stage = staged[0]!.stage;
        expect(stage).toHaveLength(plan.receive.length);
        plan.receive.forEach((r, i) => expect(stage[i]!.obj.startsWith('cert_')).toBe(r.kind === 'n'));
        expect(stage).toContainEqual({ obj: 'cert_uncut_sapphire', n: 51 });
        expect(stage).toContainEqual({ obj: 'cert_hard_leather', n: 1049 });
        expect(stage).toContainEqual({ obj: 'cert_guamvial', n: 330 });
        expect(stage).toContainEqual({ obj: 'chisel', n: 1 });
        expect(stage).toContainEqual({ obj: 'thread', n: 206 });
    });

    test('every LEDGER_OBJS name is in obj.pack; an id entry resolves by id; an override wins', () => {
        for (const obj of Object.values(LEDGER_OBJS)) expect(objPack().ids.has(obj)).toBe(true);
        expect(debugNameFor('monkey bones', 3183)).toBe(objPack().names.get(3183)!);
        expect(debugNameFor('air rune', undefined)).toBe('airrune');
        expect(debugNameFor('fly fishing rod', undefined)).toBe('fly_fishing_rod');
        expect(debugNameFor('air rune', undefined, { 'air rune': 'x' })).toBe('x');
        expect(debugNameFor('no such thing', undefined)).toBeNull();
    });
});
