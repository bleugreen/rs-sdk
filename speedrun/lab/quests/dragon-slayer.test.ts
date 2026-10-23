import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import * as pathfinding from '../../../sdk/pathfinding';
import { LOCS, TILES } from '../../quests/dragon-slayer';
import { add, FIXTURES, packSlots } from './dragon-slayer';

const CONTENT = join(import.meta.dir, '..', '..', '..', 'server', 'content');

/** Obj debug names the content marks `stackable=yes`, from every .obj config under scripts/. */
function stackableObjs(): Set<string> {
    const out = new Set<string>();
    const files = readdirSync(join(CONTENT, 'scripts'), { recursive: true, encoding: 'utf8' }).filter(f => f.endsWith('.obj'));
    for (const f of files) {
        let name: string | null = null;
        for (const line of readFileSync(join(CONTENT, 'scripts', f), 'utf8').split('\n')) {
            const m = /^\[([^\]]+)\]/.exec(line);
            if (m) name = m[1]!;
            else if (name && line.trim() === 'stackable=yes') out.add(name);
        }
    }
    return out;
}

const STACKABLE = stackableObjs();
const stackable = (k: string) => STACKABLE.has(k);
const objNames = new Set(readFileSync(join(CONTENT, 'pack', 'obj.pack'), 'utf8').split('\n').map(l => l.slice(l.indexOf('=') + 1).trim()));

describe('lab fixtures', () => {
    test('the content flags read as expected', () => {
        for (const k of ['coins', 'nails', 'lawrune', 'airrune']) expect([k, stackable(k)]).toEqual([k, true]);
        for (const k of ['shark', 'woodplank', 'rune_chainbody', 'melzarkey']) expect([k, stackable(k)]).toEqual([k, false]);
    });

    test('every item is an obj debug name; every worn item is given', () => {
        for (const f of FIXTURES) {
            const items = add(f.items ?? {}, f.late?.items ?? {});
            for (const k of Object.keys(items)) expect([f.letter, k, objNames.has(k)]).toEqual([f.letter, k, true]);
            for (const w of [...(f.worn ?? []), ...(f.late?.worn ?? [])]) expect([f.letter, w, (items[w] ?? 0) >= 1]).toEqual([f.letter, w, true]);
        }
    });

    // applyFixture gives every item before it wears any; a give into a full pack drops silently.
    test('the gives before the wear fit 28 slots', () => {
        for (const f of FIXTURES) expect([f.letter, packSlots(f.items ?? {}, [], stackable) <= 28]).toEqual([f.letter, true]);
    });

    test('the late gives fit after the wear', () => {
        for (const f of FIXTURES) {
            const slots = packSlots(add(f.items ?? {}, f.late?.items ?? {}), [...(f.worn ?? []), ...(f.late?.worn ?? [])], stackable);
            expect([f.letter, slots <= 28]).toEqual([f.letter, true]);
        }
    });

    test("A and B start at the ledger's S26 inventory: 3 free (fold-in 28: H22 carries no Varrock set)", () => {
        for (const f of FIXTURES.filter(x => ['A', 'B'].includes(x.letter))) {
            expect(packSlots(add(f.items ?? {}, f.late?.items ?? {}), [...(f.worn ?? []), ...(f.late?.worn ?? [])], stackable)).toBe(25);
        }
    });

    test('D and E start with the rune armour worn, E with the key held', () => {
        for (const l of ['D', 'E']) {
            const f = FIXTURES.find(x => x.letter === l)!;
            expect([...(f.worn ?? []), ...(f.late?.worn ?? [])]).toEqual(expect.arrayContaining(['rune_chainbody', 'rune_platelegs']));
        }
        expect(add(FIXTURES.find(x => x.letter === 'E')!.items ?? {}, FIXTURES.find(x => x.letter === 'E')!.late?.items ?? {}).melzarkey).toBe(1);
    });
});

describe('lab fixture tiles (offline pathfinder)', () => {
    // Loaded at collection: bun holds hooks to the 5 s test timeout, and the load took 4.8 s on a loaded host.
    pathfinding.initPathfinding();
    test("D's tile reaches the guild door from inside", () => {
        const d = FIXTURES.find(f => f.letter === 'D')!;
        const path = pathfinding.findLongPath(0, d.tile.x, d.tile.z, LOCS.guildDoor.x, LOCS.guildDoor.z - 1);
        expect(path.at(-1)).toMatchObject({ x: LOCS.guildDoor.x, z: LOCS.guildDoor.z - 1 });
    }, 10_000);

    test("I's tile reaches Klarense at the dock", () => {
        const i = FIXTURES.find(f => f.letter === 'I')!;
        const path = pathfinding.findLongPath(0, i.tile.x, i.tile.z, TILES.dock.x, TILES.dock.z);
        expect(path.at(-1)).toMatchObject({ x: TILES.dock.x, z: TILES.dock.z });
    }, 10_000);
});
