import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { hopNeeds, type Hop } from '../lib/travel';
import {
    analyze, ledgerLegs, legRow, loadModules, PENDING, runeOf, STAND_INS,
    type Finding, type LegLike, type ModuleDecl, type Pending, type Report,
} from './rune-pins';
import { MANIFEST, parseLedger, summary, walk, type LedgerRow } from './slot-ledger';

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
