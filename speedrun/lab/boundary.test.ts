import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { QUESTS } from '../data/quest-stages';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { buildChain, KIT_PARTNER_ROWS, PLACEMENT, type RunConfig } from '../runner/chain';
import { MANIFEST } from '../tools/slot-ledger';
import { xpForLevel } from '../lib/xp';
import { bands } from '../skills/runecraft';
import { craftedRunes, staffJumps } from './boundary';
import { applyBoundary, boundaryAt, chunkStart, DOC_LEVELS, endOf, rowLevels, STAGED, stagedOff, stepRows, type Boundary } from './boundary';

const manifest = readFileSync(MANIFEST, 'utf8');
const runOrder = readFileSync(join(import.meta.dir, '../../docs/speedrun/RUN-ORDER.md'), 'utf8');
const partners = Object.fromEntries([...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS].map(id => [id, 'p']));
const cfg: RunConfig = { partners, firemakingTiles: '3240,3296', rings: { giver: 'r' }, bones: { giver: 'b' }, courier: { giver: 'c', below: 3 }, anvil: { giver: 'a' }, cueDir: '/tmp/boundary-test' };
const chain = buildChain(cfg, { cues: { open: async () => {}, stop: () => {} } });
const at = (chunk: string): Boundary => boundaryAt(chain, chunkStart(chain, chunk), { runOrder, manifest });
const lv = (b: Boundary) => Object.fromEntries(Object.entries(b.levels).filter(([s, v]) => v.level > (s === 'hitpoints' ? 10 : 1) || s === 'hitpoints').map(([s, v]) => [s, `${v.approx ? '~' : ''}${v.level}`]));
const items = (list: Boundary['inv']) => list.map(i => `${i.obj} x${i.n}`);

describe('reading RUN-ORDER levels', () => {
    test("a value leaves the skill at its range's end; ~, +, a/b and a range as the end are approx", () => {
        expect(endOf('1-99')).toEqual({ level: 99, approx: false });
        expect(endOf('99')).toEqual({ level: 99, approx: false });
        expect(endOf('1-~80')).toEqual({ level: 80, approx: true });
        expect(endOf('to ~94')).toEqual({ level: 94, approx: true });
        expect(endOf('1-50+')).toEqual({ level: 50, approx: true });
        expect(endOf('76-80/81')).toEqual({ level: 80, approx: true });
        expect(endOf('1 to ~53-55')).toEqual({ level: 54, approx: true });
        expect(endOf('~53-55 to 99')).toEqual({ level: 99, approx: false });
    });

    test('the first mention of each skill before any `;`, parentheticals and later prose ignored; a reward given as xp', () => {
        const rows = Object.fromEntries(stepRows(runOrder).map(r => [r.id, r.levels]));
        const ends = (id: string) => Object.fromEntries(Object.entries(rowLevels(id, rows[id]!).levels).map(([s, v]) => [s, v.level]));
        expect(ends('S04')).toEqual({ magic: 59 });
        expect(ends('S25b')).toEqual({ prayer: 99 });
        expect(ends('S18')).toEqual({ thieving: 99, magic: 99, fletching: 99, smithing: 54 });
        expect(ends('S12')).toEqual({ attack: 99, thieving: 57, magic: 76, hitpoints: 31 });
        expect(ends('S27')).toEqual({ defence: 99, ranged: 99, hitpoints: 99 });
        expect(rowLevels('S15', rows.S15!).rewards.map(r => `${r.skill} ${r.base}`)).toEqual(['strength 35000', 'hitpoints 35000', 'attack 20000', 'defence 20000']);
    });

    test('every level the column does not state is a phrase its cited row still holds', () => {
        const text = Object.fromEntries(runOrder.split('\n').filter(l => /^\| *[ST]\d/.test(l)).map(l => [l.split('|')[1]!.trim(), l]));
        for (const d of DOC_LEVELS) expect(`${d.row}: ${text[d.row]?.includes(d.phrase)}`).toBe(`${d.row}: true`);
    });

    test('every staged quest stage exists in quest-stages.ts, past the completion value', () => {
        for (const [k, s] of Object.entries(STAGED)) {
            const q = QUESTS[k as keyof typeof QUESTS];
            const st = q.stages.find(x => x.name === s!.stage);
            expect(st && st.value >= q.complete.value).toBe(true);
        }
    });
});

describe('chunk boundaries (pinned: a change here is a change in the docs or the chain)', () => {
    test('each chunk starts on the leg into it, with the hand-offs and cue steps on that leg', () => {
        expect(['S00', 'S05', 'S10', 'S15', 'S22'].map(c => chain[chunkStart(chain, c)]!.id)).toEqual(['S00', 'T04-05', 'T09-10', 'T14-15a', 'T21-22']);
        expect(() => chunkStart(chain, 'S99')).toThrow('no step');
    });

    test('S05: S04 done, its last 20 rings kept (magic.ts ROUTE_LOADS), at the row', () => {
        const b = at('S05');
        expect(lv(b)).toEqual({ hitpoints: '10', magic: '59', firemaking: '99' });
        expect(b.quests).toEqual([]);
        expect(b.ledgerAfter).toBe('S04');
        expect(items(b.inv)).toEqual(['tinderbox x1', 'airrune x21', 'earthrune x4', 'lawrune x1', 'ring_of_forging x15', 'ring_of_life x5']);
        expect(items(b.worn)).toEqual(['staff_of_water x1']);
        expect(b.tile).toEqual({ x: 3240, z: 3296 });
        expect(b.unresolved).toEqual([]);
    });

    test("S10: Doric's and Plague City (scroll read: the Ardougne teleport) done, at the zoo iron", () => {
        const b = at('S10');
        expect(lv(b)).toEqual({ hitpoints: '10', prayer: '99', magic: '59', woodcutting: '99', firemaking: '99', mining: '99', runecraft: '44' });
        expect(b.quests.map(q => `${q.key}=${q.value}`)).toEqual(['doric=100', 'elena=30']);
        expect(b.qp).toBe(2);
        expect(b.ledgerAfter).toBe('S10a');
        expect(items(b.inv)).toEqual(['knife x1']);
        expect(items(b.worn)).toEqual(['staff_of_water x1']);
        expect(b.tile).toEqual({ x: 2604, z: 3235 });
        expect(b.unresolved).toEqual([]);
    });

    test('S15: HP 42 (S15\'s row), the cannon set and 30 balls for H11r, at the spiders', () => {
        const b = at('S15');
        expect(lv(b)).toEqual({ attack: '99', hitpoints: '42', ranged: '~50', prayer: '99', magic: '~76', woodcutting: '99', firemaking: '99', crafting: '42', mining: '99', agility: '75', thieving: '57', runecraft: '44' });
        expect(b.quests.map(q => q.key)).toEqual(['doric', 'elena', 'tree', 'grandtree', 'arena', 'mcannon']);
        expect(b.qp).toBe(12);
        expect(b.ledgerAfter).toBe('S14');
        expect(items(b.inv)).toEqual(['knife x1', '3doseantipoison x1', 'shark x8', 'deathrune x49', 'chaosrune x16', 'airrune x234', 'firerune x1', 'coins x1000', 'twpart1 x1', 'twpart2 x1', 'twpart3 x1', 'twpart4 x1', 'mcannonball x30', 'lawrune x4', 'waterrune x4', 'staff_of_fire x1']);
        expect(items(b.worn)).toEqual(['amulet_of_magic x1', 'khazard_helmet x1', 'khazard_platemail x1', 'mithril_scimitar x1']);
        expect(b.tile).toEqual({ x: 3288, z: 3810 });
        expect(b.unresolved).toEqual([]);
    });

    test("S22: S15's reward from its xp (HP 42 to 97), Mage Arena's staff given, S21's body runes reported unstaged", () => {
        const b = at('S22');
        expect(lv(b)).toEqual({ attack: '99', defence: '89', strength: '97', hitpoints: '97', ranged: '~50', prayer: '99', magic: '99', woodcutting: '99', fletching: '99', fishing: '78', firemaking: '99', crafting: '42', smithing: '~54', mining: '99', agility: '75', thieving: '99', runecraft: '99' });
        expect(b.quests.map(q => `${q.key}=${q.value}`)).toEqual(['doric=100', 'elena=30', 'tree=9', 'grandtree=160', 'arena=14', 'mcannon=11', 'magearena=8', 'seaslug=12', 'fishingcompo=5', 'mm=9']);
        expect(b.qp).toBe(17);
        expect(b.ledgerAfter).toBe('H17e');
        expect(items(b.inv)).toEqual(['lawrune x1', 'airrune x3', 'earthrune x1']);
        expect(items(b.worn)).toEqual(['mm_amulet_of_monkey_speak x1', 'staff_of_fire x1', 'rune_arrow x570']);
        expect(b.unresolved).toEqual(['body rune: the ledger carries it at an unknown count (after H17e)']);
    });
});

describe('staffJumps: a helper-fed step staged past by staff', () => {
    const docs = { runOrder, manifest };
    const world = () => ({ staffLevel: '4', server: 'localhost', gateway: 'ws://localhost:8300' });

    test("each listed step's block becomes one STAND-IN jump to the step after it; every other step is untouched", () => {
        const from = chunkStart(chain, 'S22');
        const slice = chain.slice(from);
        const r = staffJumps(slice, ['S25a', 'S25c'], docs, world);
        expect(r.jumped).toEqual(['S25a', 'S25c']);
        const names = r.chain.filter(s => s.id === 'S25a' || s.id === 'S25c').map(s => s.name);
        expect(names).toEqual(['STAND-IN S25a (staff jump to H21d)', 'STAND-IN S25c (staff jump to T25-26)']);
        const kept = (c: readonly { id: string }[]) => c.filter(s => s.id !== 'S25a' && s.id !== 'S25c').map(s => s.id);
        expect(kept(r.chain)).toEqual(kept(slice));
        expect(staffJumps(slice, [], docs, world).chain).toEqual([...slice]);
    });

    test('an id not in the slice, or a block that is not contiguous, refuses', () => {
        expect(() => staffJumps(chain.slice(chunkStart(chain, 'S22')), ['S04'], docs, world)).toThrow('--staff-steps: S04 not in the slice');
        const split = [...chain.slice(0, 3), chain[0]!];
        expect(() => staffJumps(split, [chain[0]!.id], docs, world)).toThrow('not one contiguous block');
    });
});

describe('a measured level no doc states', () => {
    test('Hitpoints is 10 into S12, the measured 31 after it (approx, the log cited), and the doc\'s 42 after S14', () => {
        expect(at('S12').levels.hitpoints).toMatchObject({ level: 10, approx: false });
        for (const c of ['S13', 'S14']) expect(at(c).levels.hitpoints).toMatchObject({ level: 31, approx: true, source: expect.stringContaining('rs393t123236') });
        expect(at('S15').levels.hitpoints).toMatchObject({ level: 42, approx: false });
    });
});

describe("a crafted stack the ledger carries as `x?`", () => {
    test("S06's band crafts 572 air runes in seven 26-essence loads (runecraft.rs2: floor(level / 11) + 1 per essence)", () => {
        const band = bands({ untilLevel: 44 })[0]!;
        expect(craftedRunes(band)).toBe(572);
        expect(craftedRunes({ ...band, untilLevel: 2 })).toBe(26);
        expect(() => craftedRunes({ ...band, altar: 'nature' })).toThrow('no rune multiple');
    });

    test("S07's boundary holds the 21 air runes held before S06 plus S06's 572 crafted ones, from the ledger now that its S06 row states the stack (fold-in 28)", () => {
        const b = at('S07');
        const air = b.inv.find(i => i.obj === 'airrune')!;
        expect(air.n).toBe(21 + 572);
        expect(air.source).toBe('ledger, after S06');
        expect(b.unresolved.filter(u => /air rune/.test(u))).toEqual([]);
    });

    test('an unknown stack before the crafting row leaves it unresolved rather than guessed', () => {
        const unknown = manifest.replace(/^(\| S05 \| )/m, '$1air rune x? [s]; ');
        expect(unknown).not.toBe(manifest);
        const b = boundaryAt(chain, chunkStart(chain, 'S07'), { runOrder, manifest: unknown });
        expect(b.unresolved.some(u => /air rune.*unknown count/.test(u))).toBe(true);
        expect(b.inv.some(i => i.obj === 'airrune')).toBe(false);
    });
});

describe('staging', () => {
    test('refuses off a lab before sending anything', async () => {
        const sdk = new FakeSdk(baseState({ inGame: true }));
        await expect(applyBoundary(sdk as never, at('S10'), { staffLevel: '4', server: 'rs-sdk-demo.fly.dev', gateway: 'ws://localhost:8300' }, async () => {})).rejects.toThrow('stage T09-10');
        expect(sdk.sent).toEqual([]);
    });

    const skill = (name: string, level: number) => ({ name: name[0]!.toUpperCase() + name.slice(1), level, baseLevel: level, experience: xpForLevel(level) });
    const stagedState = (b: Boundary, quests: Record<string, 'started' | 'complete'>, qp: number) =>
        baseState({
            inGame: true,
            skills: Object.entries(b.levels).map(([s, v]) => skill(s, v.level)),
            quests,
            questPoints: qp,
            inventory: b.inv.map((i, slot) => ({ slot, id: 0, name: i.name[0]!.toUpperCase() + i.name.slice(1), count: i.n, optionsWithIndex: [] })),
            equipment: b.worn.map((i, slot) => ({ slot, id: 0, name: i.name, count: i.n, optionsWithIndex: [] })),
        } as never);

    test('a staged quest varp the quest tab does not show yet (no relog) is off, read as the steps read it', () => {
        const b = at('S10');
        expect(stagedOff(stagedState(b, {}, 0), b)).toEqual([
            'quest doric: not_started on the quest tab (staged doricquest=100, complete)',
            'quest elena: not_started on the quest tab (staged elenaquest=30, complete)',
            'quest points 0 (staged 2)',
        ]);
        expect(stagedOff(stagedState(b, { doric: 'complete', elena: 'complete' }, 2), b)).toEqual([]);
    });

    test('a level or a pack count that came out different is off', () => {
        const b = at('S10');
        const s = stagedState(b, { doric: 'complete', elena: 'complete' }, 2);
        s.skills.find(k => k.name === 'Mining')!.baseLevel = 98;
        s.inventory.pop();
        expect(stagedOff(s, b)).toEqual(['mining 98 (staged 99)', 'pack knife x0 (staged 1)']);
    });
});
