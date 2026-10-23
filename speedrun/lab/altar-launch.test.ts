import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseLaunchConfig } from '../helpers/standalone';
import { S06_LOAD, S21_HAND_BACK } from '../skills/runecraft';
import { altarGiverLaunch } from './altar-launch';
import { S06_BAND } from './dress-rehearsal';

const GIVERS = Array.from({ length: 7 }, (_, i) => `cairn_rcg${i + 1}`);

describe('altarGiverLaunch', () => {
    test("S06's givers: role altar-giver on the given path, 26 essence (the band's load), restock by ::give, the {S06, altar} scope, slots round the altar", () => {
        expect(S06_BAND).toMatchObject({ id: 'S06', altar: 'air', load: S06_LOAD });
        const c = altarGiverLaunch({ givers: GIVERS, band: S06_BAND, botsDir: '/tmp/b', runDir: '/tmp/r', gatewayPort: 8305, path: 'direct' });
        expect(c).toMatchObject({ gatewayPort: 8305, botsDir: '/tmp/b', runDir: '/tmp/r', loginSpacingMs: 2000 });
        expect(c.accounts.map(e => e.account)).toEqual(GIVERS);
        for (const [i, e] of c.accounts.entries()) {
            expect(e).toEqual({ account: GIVERS[i]!, role: 'altar-giver', path: 'direct', options: { altar: 'air', slot: i % 3, essence: 26, restock: { kind: 'cheat' }, scope: { step: 'S06', family: 'altar' } } });
        }
    });

    test("standalone.ts's own parser takes it as written", () => {
        const c = parseLaunchConfig(altarGiverLaunch({ givers: GIVERS, band: S06_BAND, botsDir: '/tmp/b', runDir: '/tmp/r', gatewayPort: 8305, path: 'direct' }));
        expect(c.accounts.map(e => [e.account, e.role, e.path, e.after, e.receiver])).toEqual(GIVERS.map(g => [g, 'altar-giver', 'direct', 'login', false]));
        expect(c.accounts[0]!.options).toMatchObject({ essence: 26, restock: { kind: 'cheat' } });
    });

    test("a band without a load gives 27; no path leaves standalone's default; the hand-back giver comes last, bank restock, carrying its items", () => {
        const c = altarGiverLaunch({ givers: ['cairn_rcg1', 'cairn_rcg2'], band: { id: 'LAB', altar: 'nature' }, botsDir: 'b', runDir: 'r', gatewayPort: 8305, handBack: { account: 'cairn_rch1', items: S21_HAND_BACK.items } });
        expect(c.accounts.map(e => [e.account, e.options.essence, e.options.restock.kind, e.options.slot, 'path' in e])).toEqual([
            ['cairn_rcg1', 27, 'cheat', 0, false],
            ['cairn_rcg2', 27, 'cheat', 1, false],
            ['cairn_rch1', 27, 'bank', 2, false],
        ]);
        expect(c.accounts[2]!.options.handBack).toEqual(S21_HAND_BACK.items.map(i => ({ ...i })));
    });

    test('runecraft-accept.ts and dress-rehearsal.ts launch their altar givers through it, with no config of their own', () => {
        for (const f of ['runecraft-accept.ts', 'dress-rehearsal.ts']) {
            const src = readFileSync(join(import.meta.dir, f), 'utf8');
            expect(src).toMatch(/import \{[^}]*\baltarGiverLaunch\b[^}]*\} from '\.\/altar-launch'/);
            expect(src).toMatch(/\bspawnAltarGivers\(/);
            expect(src).not.toContain("role: 'altar-giver'");
            expect(src).not.toMatch(/spawn\(\[[^\]]*standalone\.ts/);
        }
    });
});
