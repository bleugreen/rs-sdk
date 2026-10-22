import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import * as pathfinding from '../../../sdk/pathfinding';
import { grandTree } from './grand-tree';

const CONTENT = join(import.meta.dir, '..', '..', '..', 'server', 'content');

/** Obj debug names the content marks `stackable=yes`. */
function stackableObjs(): Set<string> {
    const out = new Set<string>();
    for (const f of readdirSync(join(CONTENT, 'scripts'), { recursive: true, encoding: 'utf8' }).filter(f => f.endsWith('.obj'))) {
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
const objNames = new Set(readFileSync(join(CONTENT, 'pack', 'obj.pack'), 'utf8').split('\n').map(l => l.slice(l.indexOf('=') + 1).trim()));

describe('Grand Tree lab fixtures', () => {
    test('every item is an obj debug name, and every worn item is given', () => {
        for (const f of grandTree.fixtures) {
            for (const k of Object.keys(f.items ?? {})) expect([f.letter, k, objNames.has(k)]).toEqual([f.letter, k, true]);
            for (const w of f.worn ?? []) expect([f.letter, w, (f.items?.[w] ?? 0) >= 1]).toEqual([f.letter, w, true]);
        }
    });

    // The fixture gives every item before it wears any; a give into a full pack drops silently.
    test('the gives before the wear fit 28 slots', () => {
        for (const f of grandTree.fixtures) {
            const slots = Object.entries(f.items ?? {}).reduce((a, [k, n]) => a + (STACKABLE.has(k) ? 1 : n), 0);
            expect([f.letter, slots <= 28]).toEqual([f.letter, true]);
        }
    });
});

describe('Grand Tree lab fixture tiles (offline pathfinder)', () => {
    // Loaded at collection: bun holds hooks to the 5 s test timeout.
    pathfinding.initPathfinding();
    test('every start tile can be stood on', () => {
        for (const f of grandTree.fixtures) {
            const t = f.tile!;
            expect([f.letter, pathfinding.isTileWalkable(t.level ?? 0, t.x, t.z)]).toEqual([f.letter, true]);
        }
    });
});
