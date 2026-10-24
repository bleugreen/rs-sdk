import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { baseState } from '../lib/fake-sdk';
import { matchesItem, type ItemPattern } from '../lib/items';
import { objPack } from '../lib/obj-pack';
import { hopNeeds, type Hop, type RuneName } from '../lib/travel';
import * as cooksAssistant from '../quests/cooks-assistant';
import * as doricsQuest from '../quests/dorics-quest';
import * as dragonSlayer from '../quests/dragon-slayer';
import * as fishingContest from '../quests/fishing-contest';
import * as grandTree from '../quests/grand-tree';
import * as mageArena from '../quests/mage-arena';
import * as monkeyMadness from '../quests/monkey-madness';
import * as plagueCity from '../quests/plague-city';
import * as seaSlug from '../quests/sea-slug';
import { kitWant, type KitItem } from '../quests/segments';
import * as treeGnomeVillage from '../quests/tree-gnome-village';
import { handOffMissing } from '../runner/handoff';
import {
    analyze, isRune, ledgerLegs, legRow, loadModules, PENDING, runeLabel, runeOf, STAND_INS,
    type Finding, type LegLike, type ModuleDecl, type Pending, type Report,
} from './rune-pins';
import { MANIFEST, parseLedger, summary, walk, type LedgerEntry, type LedgerRow } from './slot-ledger';

const HEAD = '| row | in | out | equip | needAtStart | source |\n|---|---|---|---|---|---|\n';
const rowsOf = (...lines: string[]): LedgerRow[] => {
    const { rows, errors } = parseLedger(HEAD + lines.join('\n') + '\n');
    expect(errors).toEqual([]);
    return rows;
};
const ARDOUGNE: Hop = { kind: 'teleport', spell: 'ardougne' };
const VARROCK: Hop = { kind: 'teleport', spell: 'varrock' };
const FALADOR: Hop = { kind: 'teleport', spell: 'falador' };
const leg = (id: string, after: string, before: string, ...hops: Hop[]): LegLike => ({ id, after, before, hops });
const brief = (fs: readonly Finding[]) => fs.map(f => [f.kind, f.row, f.rune ?? null, f.declared ?? null, f.ledger ?? null]);

/** H8, S11b and T11-12 as main's ledger has them before fold-in 25. */
const H8_CASE = (h8Law = 5, h8Water = 4, s11bLaw = 3, s11bWater = 2) => rowsOf(
    '| H7 | staff of fire x1 [u]; air rune x10 [s] | - | +staff of fire | 2 | (r) |',
    `| H8 | law rune x${h8Law} [s]; water rune x${h8Water} [s]; air rune x3 [s] | - | - | 2 | (r) |`,
    `| S11b | - | law rune x${s11bLaw} (consume); water rune x${s11bWater} (consume); air rune x3 (consume) | - | 0 | (r) |`,
    '| T11-12 | - | law rune x2 (consume: Ardougne teleport); water rune x2 (consume) | - | 0 | (r) |',
);
const GT: ModuleDecl = {
    file: 'quests/gt.ts', stepId: 'S11b',
    RUNE_USE: { B: { lawrune: 2, waterrune: 2 }, C: { lawrune: 2, waterrune: 2 }, J: { lawrune: 1, airrune: 3 } },
    RUNE_STAFF: 'staff of fire',
};
const T11_12 = leg('T11-12', 'S11b', 'S12', ARDOUGNE, { kind: 'run', to: { x: 2566, z: 3199 } });

describe('the H8 class: a step that uses more than its row says', () => {
    test('the slot ledger passes it, the pins do not', () => {
        const rows = H8_CASE();
        expect(summary(walk(rows)).ok).toBe(true);
        const r = analyze(rows, { legs: [T11_12], modules: [GT] });
        expect(brief(r.failing)).toEqual([
            ['mismatch', 'S11b', 'lawrune', 5, 3],
            ['mismatch', 'S11b', 'waterrune', 4, 2],
            ['short', 'T11-12', 'waterrune', 2, 0],
            ['short', 'T11-12', 'lawrune', 2, 0],
        ]);
        expect(r.failing[3]!.text).toMatch(/^T11-12: leg T11-12 needs law rune 2 held, has 0/);
    });

    test('the fold-in 25 numbers clear it', () => {
        const r = analyze(H8_CASE(7, 6, 5, 4), { legs: [T11_12], modules: [GT] });
        expect(r.findings).toEqual([]);
    });

    test('a leg is held to its own row: the leg alone, on the old ledger, passes', () => {
        expect(analyze(H8_CASE(), { legs: [T11_12], modules: [] }).failing).toEqual([]);
    });
});

describe('legs', () => {
    test("a leg's runes are hopNeeds less the element of the staff the ledger has worn", () => {
        const rows = rowsOf(
            '| H1 | staff of water x1 [u]; law rune x2 [s]; water rune x2 [s] | - | +staff of water | 2 | (r) |',
            '| T08-09 | - | law rune x2 (consume: Ardougne; the staff covers the water) | - | 0 | (r) |',
        );
        const t = leg('T08-09', 'S08', 'S09', ARDOUGNE);
        expect(hopNeeds(t.hops).runes).toEqual({ water: 2, law: 2 });
        expect(analyze(rows, { legs: [t], modules: [] }).findings).toEqual([]);
        const taking = rowsOf(
            '| H1 | staff of water x1 [u]; law rune x2 [s]; water rune x2 [s] | - | +staff of water | 2 | (r) |',
            '| T08-09 | - | law rune x2 (consume); water rune x2 (consume) | - | 0 | (r) |',
        );
        expect(brief(analyze(taking, { legs: [t], modules: [] }).failing)).toEqual([['mismatch', 'T08-09', 'waterrune', 0, 2]]);
    });

    test("legs inside a step share the step's `legs` row, summed", () => {
        const rows = rowsOf(
            '| H20 | law rune x2 [s]; air rune x6 [s]; water rune x1 [s]; fire rune x1 [s] | - | - | 4 | (r) |',
            '| S24 | - | - | - | 0 | (r) |',
            '| S24 legs | - | law rune x2 (consume); air rune x6 (consume); water rune x1 (consume); fire rune x1 (consume) | - | 0 | (r) |',
        );
        const legs = [
            leg('L24a', 'S24 Goblin Diplomacy', 'S24 Druidic Ritual', FALADOR),
            leg('L24b', 'S24 Druidic Ritual', 'S24 Goblin Village', { kind: 'run', to: { x: 2957, z: 3511 } }),
            leg('L24c', 'S24 Goblin Village', 'S24 Romeo and Juliet', VARROCK),
        ];
        const ids = new Set(rows.map(r => r.row));
        expect(legs.map(l => legRow(l, ids))).toEqual(['S24 legs', 'S24 legs', 'S24 legs']);
        expect(analyze(rows, { legs, modules: [] }).findings).toEqual([]);
    });

    test('a leg that casts with no ledger row fails; one that casts nothing needs none', () => {
        const rows = rowsOf('| S01 | - | - | - | 0 | (r) |');
        const r = analyze(rows, { legs: [leg('T01-02', 'S01', 'S02', FALADOR), leg('T02-03', 'S02', 'S03', { kind: 'run', to: { x: 1, z: 1 } })], modules: [] });
        expect(brief(r.failing)).toEqual([['no-row', 'T01-02', null, null, null]]);
    });
});

describe('modules', () => {
    const S15 = (between = 'law rune x1 [s]') => rowsOf(
        '| H12 | law rune x2 [s]; water rune x2 [s]; air rune x3 [s] | - | - | 3 | (r) |',
        '| S15 | - | law rune x2 (consume: T); water rune x2 (consume) | - | 0 | (r) |',
        `| H99 | ${between} | - | - | 1 | (r) |`,
        '| S15 Y | - | law rune x1 (consume: Y); air rune x3 (consume) | - | 0 | (r) |',
    );
    const MM: ModuleDecl = { file: 'quests/mm.ts', stepId: 'S15', LETTERS: ['A', 'T', 'X', 'Y', 'Z'], RUNE_USE: { T: { lawrune: 2, waterrune: 2 }, Y: { lawrune: 1, airrune: 3 } } };

    test('a lettered sub-row takes its segments onward, so a row between them counts', () => {
        expect(analyze(S15(), { legs: [], modules: [MM] }).findings).toEqual([]);
        // Without H99's law the Y teleport is short at its own row, not at the step's start.
        expect(brief(analyze(S15('air rune x1 [s]'), { legs: [], modules: [MM] }).failing)).toEqual([['short', 'S15 Y', 'lawrune', 1, 0]]);
    });

    test('RUNE_NEED is checked held at its segment, before the use of later segments', () => {
        const rows = rowsOf(
            '| H7 | staff of fire x1 [u]; chaos rune x31 [s]; air rune x200 [s] | - | +staff of fire | 2 | (r) |',
            '| S11b | - | chaos rune x24 (consume); air rune x72 (consume) | - | 0 | (r) |',
        );
        const gt = (need: number): ModuleDecl => ({ file: 'quests/gt.ts', stepId: 'S11b', RUNE_USE: { N2: { chaosrune: 24, airrune: 72 } }, RUNE_NEED: { A: { chaosrune: need } }, RUNE_STAFF: 'staff of fire' });
        expect(analyze(rows, { legs: [], modules: [gt(31)] }).findings).toEqual([]);
        const r = analyze(rows, { legs: [], modules: [gt(35)] });
        expect(brief(r.failing)).toEqual([['short', 'S11b', 'chaosrune', 35, 31]]);
        expect(r.failing[0]!.text).toMatch(/at A needs chaos rune 35 held, has 31/);
    });

    test('RUNE_STAFF not worn where the use falls fails', () => {
        const rows = rowsOf('| H8 | law rune x5 [s]; water rune x4 [s]; air rune x3 [s] | - | - | 3 | (r) |', '| S11b | - | law rune x5 (consume); water rune x4 (consume); air rune x3 (consume) | - | 0 | (r) |');
        const r = analyze(rows, { legs: [], modules: [GT] });
        expect(brief(r.failing)).toEqual([['staff', 'S11b', null, null, null]]);
        expect(r.failing[0]!.text).toBe("S11b: S11b quests/gt.ts leaves out the staff of fire's element, but the ledger has nothing worn there");
    });

    test('a key that is a row id is that row (a skill module over several steps)', () => {
        const rows = rowsOf('| S00 | air rune x25 [s]; mind rune x15 [s] | - | - | 2 | (r) |', '| S02 | - | air rune x4 (consume); mind rune x4 (consume) | - | 0 | (r) |');
        expect(analyze(rows, { legs: [], modules: [{ file: 'skills/magic.ts', RUNE_USE: { S02: { airrune: 4, mindrune: 4 } } }] }).findings).toEqual([]);
    });

    test('an export not in the agreed shape fails (the legacy travel.ts `RUNES` totals, a bad key)', () => {
        const rows = rowsOf('| S13 | - | law rune x3 (consume) | - | 0 | (r) |');
        const bad = (RUNE_USE: unknown) => analyze(rows, { legs: [], modules: [{ file: 'quests/dc.ts', stepId: 'S13', RUNE_USE }] }).failing.map(f => f.text);
        expect(bad({ law: 3, water: 3 })).toEqual(['S13 quests/dc.ts: RUNE_USE.law is not a record of runes (the agreed shape is per segment: { B: { lawrune: 2 } })']);
        expect(bad({ A: { law: 3 } })).toEqual(['S13 quests/dc.ts: RUNE_USE.A.law is not a rune debug name (runes.obj)']);
    });

    test('modules without RUNE_USE are listed, and a step shared with one is not pinned', () => {
        const rows = rowsOf('| H20 | law rune x1 [s] | - | - | 1 | (r) |', '| S24 | - | law rune x1 (consume) | - | 0 | (r) |');
        const r = analyze(rows, { legs: [], modules: [{ file: 'quests/gd.ts', stepId: 'S24', RUNE_USE: { G1: { lawrune: 1 } } }, { file: 'quests/rj.ts', stepId: 'S24' }] });
        expect(r.findings).toEqual([]);
        expect(r.missing).toEqual(['quests/rj.ts (S24): no RUNE_USE; the ledger\'s S24 rows consume law rune 1']);
        expect(r.unclaimed).toEqual(['S24: consumes law rune 1, pinned by nothing']);
        expect(r.notes).toEqual(['S24 quests/gd.ts: not pinned, other modules of S24 export no RUNE_USE']);
    });

    test('a `?` count is listed as unknown, not failed', () => {
        const rows = rowsOf('| H13 | blood rune x90 [s] | - | - | 1 | (r) |', '| S16 | - | blood rune x? (consume: Fire Wave) | - | 0 | (r) |');
        const r = analyze(rows, { legs: [], modules: [{ file: 'quests/ma.ts', stepId: 'S16', RUNE_USE: { C: { bloodrune: 59 } } }] });
        expect(r.failing).toEqual([]);
        expect(brief(r.findings)).toEqual([['unknown', 'S16', 'bloodrune', 59, null]]);
    });
});

describe('pending and stand-ins', () => {
    const pend = (p: Partial<Pending>): Pending => ({ kind: 'mismatch', row: 'S11b', rune: 'lawrune', declared: 5, ledger: 3, why: 'test', ...p });

    test('a pending entry holds back exactly its finding, and re-arms when the ledger changes', () => {
        const r = analyze(H8_CASE(), { legs: [T11_12], modules: [GT] }, [pend({})]);
        expect(r.findings.filter(f => f.pending).map(f => f.rune)).toEqual(['lawrune']);
        expect(r.failing).toHaveLength(3);
        // Another wrong count is not the pending one.
        expect(analyze(H8_CASE(5, 4, 4, 2), { legs: [T11_12], modules: [GT] }, [pend({})]).failing.map(f => [f.rune, f.ledger])).toContainEqual(['lawrune', 4]);
    });

    test('a pending entry that matches nothing is stale, listed, not failed', () => {
        const r = analyze(H8_CASE(7, 6, 5, 4), { legs: [T11_12], modules: [GT] }, [pend({})]);
        expect(r.failing).toEqual([]);
        expect(r.stale).toEqual(['pending mismatch S11b law rune 5 against 3 matches nothing now (test): delete it']);
    });

    test('a stand-in serves until its module exports, then is stale', () => {
        const standIn = { file: 'quests/gt.ts', stepId: 'S11b', RUNE_USE: GT.RUNE_USE as never, RUNE_STAFF: 'staff of fire', source: 'test' };
        const r = analyze(H8_CASE(), { legs: [T11_12], modules: [{ file: 'quests/gt.ts', stepId: 'S11b' }], standIns: [standIn] });
        expect(r.missing).toEqual([]);
        expect(r.failing.map(f => f.kind)).toEqual(['mismatch', 'mismatch', 'short', 'short']);
        const later = analyze(H8_CASE(), { legs: [T11_12], modules: [{ ...GT, RUNE_USE: { B: { lawrune: 2, waterrune: 2 }, J: { lawrune: 1, airrune: 3 } } }], standIns: [standIn] });
        expect(later.stale).toEqual(['stand-in for quests/gt.ts (S11b): the module exports RUNE_USE now, so delete it from STAND_INS']);
        expect(later.failing).toEqual([]);
    });
});

describe('rune names', () => {
    test('by name, by obj id through obj.pack, and nothing else', () => {
        expect(runeOf({ name: 'law rune' })).toBe('lawrune');
        expect(runeOf({ name: 'whatever', id: 563 })).toBe('lawrune');
        expect(runeOf({ name: 'rune arrow' })).toBeNull();
        expect(runeOf({ name: 'rune essence' })).toBeNull();
        expect(runeOf({ name: 'antipoison', family: true })).toBeNull();
    });
});

// ------------------------------------------------------------------ main's ledger

const MAIN_ROWS = (() => {
    const { rows, errors } = parseLedger(readFileSync(MANIFEST, 'utf8'));
    if (errors.length) throw new Error(`STEP-MANIFEST.md's ledger does not parse: ${errors.join('; ')}`);
    return rows;
})();
const MODULES = await loadModules();
const REPORT: Report = analyze(MAIN_ROWS, { legs: ledgerLegs(), modules: MODULES, standIns: STAND_INS }, PENDING);

describe("main's ledger (docs/speedrun/STEP-MANIFEST.md)", () => {
    test('every leg and every declared module matches its ledger rows', () => {
        console.log(REPORT.text);
        expect(REPORT.failing.map(f => f.text)).toEqual([]);
    });

    test('the skill modules that cast declare their use', () => {
        const declared = MODULES.filter(m => m.RUNE_USE !== undefined).map(m => m.file);
        expect(declared).toEqual(expect.arrayContaining(['skills/magic.ts', 'skills/thieving.ts']));
    });

    test("fold-in 25's H8 / S11b / T11-12 runes stay clear on the rows", () => {
        const lawWater = (f: Finding) => (f.rune === 'lawrune' || f.rune === 'waterrune') && (f.row === 'S11b' || f.row === 'T11-12');
        expect(REPORT.findings.filter(lawWater)).toEqual([]);
        expect(REPORT.stale).toEqual([]);
    });

    for (const f of REPORT.findings.filter(f => f.pending)) test.skip(`pending: ${f.text} (${f.pending!.why})`, () => {});
    for (const m of REPORT.missing) test.skip(`no RUNE_USE: ${m}`, () => {});
    for (const u of REPORT.unclaimed) test.skip(`unpinned: ${u}`, () => {});
    for (const f of REPORT.findings.filter(f => f.kind === 'unknown')) test.skip(`unknown: ${f.text}`, () => {});
    for (const s of REPORT.stale) test.skip(`stale: ${s}`, () => {});
});

// ------------------------------------------------------------------ quest kits against the rows that feed them
//
// The pins hold what a step casts to its rows; a quest kit check holds what the step's segment A wants
// held before it starts, which is a separate list in the module. A kit check counts held runes only
// (segments.ts kitWant; the hand-written checks the same), because a kit line is what the trade
// delivers. So a kit that still lists a rune the ledger stopped delivering stops the run at A:
// fold-in 25 took H6's 2 water runes off (T08-09 casts on the worn staff of water) and Plague
// City's KIT kept them ('kit: missing 2 x /^water rune$/i and no kitFrom to receive it from').

const gameName = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);
const gameItem = (name: string, id: number, count: number, slot: number): InventoryItem =>
    ({ slot, id, name: gameName(name), count, optionsWithIndex: [] }) as unknown as InventoryItem;

/** Every rune obj (runes.obj) as the game names it, for telling a kit's rune lines from the rest. */
const RUNE_ITEMS: InventoryItem[] = [...objPack().names]
    .filter(([, debug]) => isRune(debug))
    .map(([id, debug], i) => gameItem(runeLabel(debug as RuneName), id, 1, i));
const isRunePattern = (p: ItemPattern) => RUNE_ITEMS.some(i => matchesItem(i, p));
const runeId = (r: RuneName) => objPack().ids.get(r) ?? -1;

/**
 * SCORED as the ledger walk has it once `entry`'s row is done: its rune stacks held and its worn set
 * (the equip columns, so a worn staff is worn here). Nothing else is held and Agility is 99, so a
 * check that also judges a potion, a level or free slots (the Grand Tree's) answers on runes alone.
 */
function ledgerState(entry: LedgerEntry): BotWorldState {
    const runes = entry.stacks.inv.filter(h => runeOf(h) !== null);
    return baseState({
        skills: [{ name: 'Agility', level: 99, baseLevel: 99, experience: 0 }] as BotWorldState['skills'],
        inventory: runes.map((h, i) => gameItem(runeLabel(runeOf(h)!), runeId(runeOf(h)!), h.count ?? 0, i)),
        equipment: entry.stacks.worn.map((h, i) => gameItem(h.name, h.id ?? -1, h.count ?? 1, i)),
    });
}

/** A quest module's kit check, and the hand-off row that delivers its kit. */
interface KitConsumer {
    file: string;
    step: string;
    /** The row the kit comes in, the ledger's row just before the step's. */
    feed: string;
    /** The kit check's rune lines still wanted on `s`, one string each; [] when the runes are covered. */
    short(s: BotWorldState): string[];
}

const wantedRunes = (want: ReadonlyArray<{ item: ItemPattern; amount?: number }>) =>
    want.filter(w => isRunePattern(w.item)).map(w => `${w.amount ?? 1} x ${String(w.item)}`);
const kitRunes = (kit: readonly KitItem[]) => (s: BotWorldState) => wantedRunes(kitWant(s, kit));

const S08_PLAGUE_CITY: KitConsumer = { file: 'quests/plague-city.ts', step: 'S08', feed: 'H6', short: kitRunes(plagueCity.KIT) };

const KIT_CONSUMERS: readonly KitConsumer[] = [
    // h4Plan is built from the ledger's own H4 row, so this one holds by construction.
    {
        file: 'quests/dorics-quest.ts', step: 'S05', feed: 'H4',
        short: s => {
            const plan = doricsQuest.h4Plan(s);
            return handOffMissing(s, { ...plan, receive: plan.receive.filter(r => runeOf({ name: r.name }) !== null), give: [], drop: [], wield: [], unwield: [] });
        },
    },
    S08_PLAGUE_CITY,
    { file: 'quests/tree-gnome-village.ts', step: 'S10b', feed: 'H7', short: s => wantedRunes(treeGnomeVillage.h7Want(s)) },
    {
        file: 'quests/grand-tree.ts', step: 'S11b', feed: 'H8',
        short: s => {
            const r = grandTree.kitCheck(s);
            return r === true ? [] : [r];
        },
    },
    // The bow line is matched by id and is not a rune; any id serves.
    { file: 'quests/monkey-madness.ts', step: 'S15', feed: 'H12', short: s => wantedRunes(monkeyMadness.kitMissing(s, 861).map(([item, amount]) => ({ item, amount }))) },
    { file: 'quests/mage-arena.ts', step: 'S16', feed: 'H13', short: kitRunes(mageArena.kit(mageArena.DEFAULT_SPELL)) },
    { file: 'quests/sea-slug.ts', step: 'S19', feed: 'H15', short: kitRunes(seaSlug.KIT) },
    { file: 'quests/fishing-contest.ts', step: 'S20', feed: 'H16', short: kitRunes(fishingContest.KIT) },
    { file: 'quests/cooks-assistant.ts', step: 'S23', feed: 'H19', short: kitRunes(cooksAssistant.KIT) },
    { file: 'quests/dragon-slayer.ts', step: 'S26', feed: 'H22', short: kitRunes(dragonSlayer.kitItems()) },
];

/** The exports that make a quest module a kit consumer: a kit list, or a check or want over one. */
const KIT_EXPORTS = ['KIT', 'kit', 'kitItems', 'kitCheck', 'kitMissing', 'h7Want', 'h4Plan'] as const;

const MAIN_WALK = walk(MAIN_ROWS);

function kitFindings(entries: readonly LedgerEntry[], c: KitConsumer): string[] {
    const who = `${c.step} ${c.file}`;
    const i = entries.findIndex(e => e.row.row === c.feed);
    if (i < 0) return [`${who}: the ledger has no row ${c.feed}`];
    const next = entries[i + 1]?.row.row;
    if (next !== c.step) return [`${who}: ${c.step} is not the row after ${c.feed} (${next ?? 'nothing'} is)`];
    const e = entries[i]!;
    const runes = e.stacks.inv.filter(h => runeOf(h) !== null);
    const unknown = runes.filter(h => h.count === null);
    if (unknown.length) return [`${who}: ${c.feed} leaves ${unknown.map(h => h.name).join(', ')} at an unknown count`];
    const short = c.short(ledgerState(e));
    if (!short.length) return [];
    const held = runes.map(h => `${h.name} ${h.count}`).join(', ') || 'no runes';
    const worn = e.stacks.worn.map(h => h.name).join(', ') || 'nothing';
    return [`${who} after ${c.feed}: the kit wants ${short.join('; ')}; the ledger has ${held} held, ${worn} worn`];
}

describe("quest kits' rune lines against the ledger rows that feed them", () => {
    for (const c of KIT_CONSUMERS) {
        test(`${c.step} ${c.file}: covered once ${c.feed} is done`, () => {
            expect(kitFindings(MAIN_WALK, c)).toEqual([]);
        });
    }

    test('every quest module that exports a kit is held here', async () => {
        const dir = join(import.meta.dir, '../quests');
        const kitModules: string[] = [];
        for (const f of readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort()) {
            const m = await import(join(dir, f));
            if (KIT_EXPORTS.some(k => m[k] !== undefined)) kitModules.push(`quests/${f}`);
        }
        expect(kitModules.filter(f => !KIT_CONSUMERS.some(c => c.file === f))).toEqual([]);
    });

    test("the H6 class: a kit rune the row stopped delivering, its element on the worn staff, is caught", () => {
        const before25 = { ...S08_PLAGUE_CITY, short: kitRunes([...plagueCity.KIT.filter(k => String(k.item) !== String(/^water rune$/i)), { item: /^water rune$/i, n: 2 }]) };
        expect(kitFindings(MAIN_WALK, before25)).toEqual([
            'S08 quests/plague-city.ts after H6: the kit wants 2 x /^water rune$/i; the ledger has law rune 2 held, staff of water worn',
        ]);
    });
});
