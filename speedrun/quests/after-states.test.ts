// rs/723: the quest milestones whose live evidence is gone after their step stay done at the states the run
// reaches later, built as rs/577's chain-monotonic fixtures build them: the pack and worn set walked from
// STEP-MANIFEST.md's inventory ledger (tools/slot-ledger.ts `walk`) to the later step's row, SCORED on the
// tile the run leaves it on (runner/legs.ts TILES), and each quest finished before it complete on the tab.
// resolveResume (runner/resume.ts) walks to the first milestone that reads undone, so one that turns false
// later sends every resume after it back into its step.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import type { BotWorldState, PlayerState, QuestJournalState } from '../../sdk/types';
import type { QuestKey } from '../data/quest-stages';
import { baseState } from '../lib/fake-sdk';
import { TILES } from '../runner/legs';
import type { Observed } from '../runner/step';
import { MANIFEST, parseLedger, walk, type Held } from '../tools/slot-ledger';
import * as dorics from './dorics-quest';
import * as mageArena from './mage-arena';
import * as mm from './monkey-madness';
import { questSteps, recorded } from './segments';
import * as treeGnome from './tree-gnome-village';

const STACKS = new Map(walk(parseLedger(readFileSync(MANIFEST, 'utf8')).rows).map(e => [e.row.row, e.stacks]));

/** The game's item names are capitalised; a stack at an unknown count shows 100 (rs/577's fixture). */
function items(list: readonly Held[]): BotWorldState['inventory'] {
    const out: BotWorldState['inventory'] = [];
    const put = (h: Held, count: number) => out.push({ slot: out.length, id: h.id ?? 20_000 + out.length, name: h.name[0]!.toUpperCase() + h.name.slice(1), count, optionsWithIndex: [] });
    for (const h of list) {
        if (h.kind === 'u') for (let n = 0; n < (h.count ?? 1); n++) put(h, 1);
        else put(h, h.count ?? 100);
    }
    return out;
}

/** The route's quests in run order, through Monkey Madness (S15); Mage Arena is off the quest list. */
const BEFORE_S16: readonly QuestKey[] = ['doric', 'elena', 'tree', 'grandtree', 'arena', 'mcannon', 'mm'];

/** SCORED at the end of ledger row `row`, on `tile`, with `complete` finished on the quest tab. */
function after(row: string, tile: { x: number; z: number; level?: number }, complete: readonly QuestKey[], quests: Partial<Record<QuestKey, string>> = {}): BotWorldState {
    const stacks = STACKS.get(row);
    if (!stacks) throw new Error(`the ledger has no row ${row}`);
    return baseState({
        inGame: true,
        player: { name: 'Scored', x: tile.x, z: tile.z, worldX: tile.x, worldZ: tile.z, level: tile.level ?? 0 } as PlayerState,
        inventory: items(stacks.inv),
        equipment: items(stacks.worn),
        quests: { ...Object.fromEntries(complete.map(q => [q, 'complete'])), ...quests },
    } as Partial<BotWorldState>);
}

/** The attempt's step record as rs/724's runner/step.ts StepMarks: a run's `Observed.record`. */
const marks = (...names: string[]) => ({ has: (n: string) => names.includes(n) });
const view = (state: BotWorldState, record?: { has(n: string): boolean }, probed: Record<string, unknown> = {}): Observed => {
    const o: Observed & { record?: { has(n: string): boolean } } = { state, probed, ...(record ? { record } : {}) };
    return o;
};

// The tiles the later steps leave SCORED on.
const KNIGHTS = TILES.knights;
/** S11a's gnome course upper platform, where tonight's band stopped (2483,3420, plane 2). */
const GNOME_PLATFORM = { x: 2483, z: 3420, level: 2 };

describe('S16 D/E/F: done past the arena from the attempt record (%magearena is not transmitted)', () => {
    const S16 = mageArena.steps();
    const step = (letter: string) => S16.find(s => s.name.startsWith(`S16:${letter}-`))!;
    const DEF = ['D', 'E', 'F'].map(step);
    const names = DEF.map(s => s.name);
    expect(names).toEqual(['S16:D-pool', 'S16:E-statue', 'S16:F-guardian']);
    const LATER: [string, BotWorldState][] = [
        ['H14 at the knights (after the exit and T16-18)', after('H14', KNIGHTS, BEFORE_S16)],
        ['S18 knights finished', after('S18', KNIGHTS, BEFORE_S16)],
        ['S22 fishing', after('S22', { x: 3104, z: 3424 }, [...BEFORE_S16, 'seaslug', 'fishingcompo'])],
        ['S17, the run\'s last step', after('S17', { x: 3004, z: 3937 }, [...BEFORE_S16, 'seaslug', 'fishingcompo', 'cook', 'gobdip', 'druid', 'romeojuliet', 'dragon'])],
    ];

    for (const [label, state] of LATER) {
        test(`${label}: undone from the game alone, done with the record`, () => {
            for (const s of DEF) {
                expect(s.done!(view(state), {})).toBe(false);
                expect(s.done!(view(state, marks(...names)), {})).toBe(true);
            }
        });
    }

    test('each reads its own name only: a record of D alone leaves E and F undone', () => {
        const s = after('S18', KNIGHTS, BEFORE_S16);
        expect(DEF.map(x => x.done!(view(s, marks('S16:D-pool')), {}))).toEqual([true, false, false]);
        expect(DEF.map(x => x.done!(view(s, marks('S16:A-kit', 'S16:C-fight')), {}))).toEqual([false, false, false]);
    });

    test('the live checks still decide during S16: the cellar before the pool is undone, the chamber done', () => {
        const cellar = after('H13', TILES.kolodionCellar, BEFORE_S16);
        expect(step('D').done!(view(cellar), {})).toBe(false);
        expect(step('D').done!(view(cellar, marks()), {})).toBe(false);
        const chamber = after('S16', { x: 2509, z: 4689 }, BEFORE_S16);
        expect(step('D').done!(view(chamber), {})).toBe(true);
    });
});

describe('S05:C: the exit-drop clause past S05 from the attempt record; the quest stays required', () => {
    const C = dorics.steps().find(s => s.name === 'S05:C-doric-hand-in')!;
    const all = [...BEFORE_S16];
    test('later states holding coins (H9 on) read done with the record, undone without', () => {
        for (const s of [after('H9', TILES.doric, ['doric', 'elena', 'tree', 'grandtree']), after('S18', KNIGHTS, all), after('H22', KNIGHTS, all)]) {
            expect(s.inventory.some(i => /^coins$/i.test(i.name))).toBe(true);
            expect(C.done!(view(s), {})).toBe(false);
            expect(C.done!(view(s, marks(C.name)), {})).toBe(true);
        }
    });
    test('a recorded C with the quest not complete reads undone (a rollback across the hand-in)', () => {
        const s = after('S05', TILES.doric, [], { doric: 'started' });
        expect(C.done!(view(s, marks(C.name)), {})).toBe(false);
    });
    test('at S05 itself the coins still decide: held after the hand-in is undone, dropped is done', () => {
        const handedIn = after('S05', TILES.doric, ['doric']);
        const coins = { slot: handedIn.inventory.length, id: 995, name: 'Coins', count: 180, optionsWithIndex: [] };
        expect(C.done!(view({ ...handedIn, inventory: [...handedIn.inventory, coins] }), {})).toBe(false);
        expect(C.done!(view({ ...handedIn, inventory: handedIn.inventory.filter(i => !/^coins$/i.test(i.name)) }), {})).toBe(true);
    });
});

describe('S10b:H: plane 0 binds only while the orb is in hand (a game fact, no record)', () => {
    const H = treeGnome.steps().find(s => s.name === 'S10b:H-stronghold')!;
    const journal = (line: string): QuestJournalState => ({ title: 'Tree Gnome Village', lines: [line], open: false, tick: 0 });
    test('later states on an upper plane read done: S11a\'s gnome platform, and the knights', () => {
        expect(H.done!(view(after('S11a', GNOME_PLATFORM, ['doric', 'elena', 'tree'])), {})).toBe(true);
        expect(H.done!(view(after('S18', { ...KNIGHTS, level: 1 }, BEFORE_S16)), {})).toBe(true);
    });
    test('during S10b: upstairs with the orb is undone, down with it is done, upstairs after Bolren has it is done', () => {
        const orb = after('S10b', { x: 2503, z: 3253, level: 1 }, ['doric', 'elena'], { tree: 'started' });
        const has = (line: string) => ({ 'journal:tree': journal(line) });
        expect(H.done!(view(orb, undefined, has('I should return the orb to King Bolren immediately')), {})).toBe(false);
        expect(H.done!(view({ ...orb, player: { ...orb.player!, level: 0 } }, undefined, has('I should return the orb to King Bolren immediately')), {})).toBe(true);
        expect(H.done!(view(orb, undefined, has('I should retrieve the two remaining orbs from the warlord')), {})).toBe(true);
    });
});

describe('S15:Z: done past S15 from its journal probe (durable text), with no record', () => {
    const Z = mm.steps({ dialogue: 'fixed' }).find(s => s.name.startsWith('S15:Z-'))!;
    const enrolled: QuestJournalState = { title: 'Monkey Madness', lines: ['I found Daero and enrolled in his training'], open: false, tick: 0 };
    test('Z declares the journal probe the walk answers', () => {
        expect(Z.probes).toContain(mm.JOURNAL_PROBE);
    });
    test('at H14 and S18 with the journal read it is done; unanswered (rs/577\'s fixtures) it is not', () => {
        for (const s of [after('H14', KNIGHTS, BEFORE_S16), after('S18', KNIGHTS, BEFORE_S16)]) {
            expect(Z.done!(view(s, undefined, { [mm.JOURNAL_PROBE]: enrolled }), {} as never)).toBe(true);
            expect(Z.done!(view(s, undefined, { [mm.JOURNAL_PROBE]: null }), {} as never)).toBe(false);
        }
    });
});

describe('segments.ts recorded', () => {
    const seg = (over: object) => questSteps('S99', [{ letter: 'A', label: 'x', logoutSafe: true, run: async () => {}, ...over }])[0]!;
    test('`recorded: true` ORs the record of the step\'s own name into done; absent record reads the live check', () => {
        const s = seg({ done: () => false, recorded: true });
        const st = baseState({});
        expect(s.done!(view(st), {})).toBe(false);
        expect(s.done!(view(st, marks('S99:A-x')), {})).toBe(true);
        expect(s.done!(view(st, marks('S99:B-x')), {})).toBe(false);
        expect(seg({ done: () => false }).done!(view(st, marks('S99:A-x')), {})).toBe(false);
        expect(recorded(view(st), 'S99:A-x')).toBe(false);
    });
    test('a recorded segment with no done is refused', () => {
        expect(() => seg({ recorded: true })).toThrow(/recorded but has no done/);
    });
});
