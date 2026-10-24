import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { BotWorldState, InventoryItem, PlayerState, TradeItem } from '../../sdk/types';
import { readMulePreparation, writeMuleReady } from '../helpers/mule-readiness';
import { muleCued, tag } from './chain';
import { CueKeeper } from './cue-keeper';
import { DeliveryOwner, READY_MAX_TICKS } from './delivery-owner';
import { baseState, drive, FakeSdk, FakeTradePartner } from '../lib/fake-sdk';
import { noteOf, untradeable } from '../lib/items';
import { TickLog } from '../lib/ticks';
import { MANIFEST, parseLedger } from '../tools/slot-ledger';
import { ASK_FILE, readTopUpAsk } from '../helpers/altar-cue';
import {
    askFor, giveSpecs, handOffFrom, handOffMissing, handOffPre, handOffRoom, handOffStep, itemPattern, loadHandOff, planHandOff, resolvePlan, rollbackWitnesses, runHandOff, runHandOffOnCue, slotPlan, toUnequip, tradeKind, tradeLanded,
    type Given, type HandOffPlan, type HandOffReport, type Meeting,
} from './handoff';
import { AttemptRecord, ATTEMPT_RECORD_FILE } from './attempt-record';
import { PLACEMENT } from './chain';
import { Observation, resolveResume } from './resume';
import type { Step, StepContext } from './step';

// Rows in the inventory ledger's grammar (STEP-MANIFEST.md, "Row grammar"), one per trade shape.
// The items are the test's own; the real rows are read from the manifest below.
const TABLE = `
| row | in | out | equip | needAtStart | source |
|---|---|---|---|---|---|
| H1 | staff of water x1 [u]; cosmic rune x60 [s]; air rune x81 [s]; law rune x1 [s] (a note) | - | - | 4 | fixture (r) |
| S01 | - | - | +staff of water | 0 | fixture (r) |
| H13 | staff of fire x1 [u]; knife x1 [u]; blood rune x70 [s]; prayer potion x2 [u] | magic shortbow x1 (swap) | +staff of fire | 4 | fixture (r) |
| H11r | - | cannon base x1 (trade: back to the holder); cannonball all (trade) | - | 0 | fixture (r) |
| H12 | magic shortbow x1 [u]; normal logs x2 [u] | mithril scimitar x1 (swap: unwielded) | +magic shortbow | 3 | fixture (r) |
| H9 | coins x5 [s] | shark x? (swap) | - | 1 | fixture (r) |
| T01-02 | - | bronze axe x1 (drop) | - | 0 | fixture (r) |
| H99 | - | bronze axe x1 (drop) | - | 0 | fixture (r) |
| H98 | tree items x? [u] | - | - | 0 | fixture (r) |
| H96 | staff of fire x1 [u] | magic shortbow x1 (swap); khazard helmet x1 (drop: unworn first) | +staff of fire | 1 | fixture (r) |
| H95 | staff of fire x1 [u] | khazard helmet x1 (swap: unworn first) | - | 1 | fixture (r) |
| H94 | staff of fire x1 [u] | khazard armour @75 x1 (trade) | - | 1 | fixture (r) |
| H93 | staff of fire x1 [u] | magic shortbow x1 (swap); khazard helmet x1 (drop: unworn first); khazard armour x1 (drop: unworn first) | +staff of fire | 1 | fixture (r) |
`;

const plan = (id: string) => handOffFrom(TABLE, id);
const PARTNER = 'Helper';

// ------------------------------------------------------------------ fixtures

const IDS: Record<string, number> = {
    'Staff of water': 1383, 'Cosmic rune': 564, 'Air rune': 556, 'Law rune': 563, 'Staff of fire': 1387, Knife: 946, 'Blood rune': 565,
    'Prayer potion(4)': 2434, 'Magic shortbow': 861, 'Cannon base': 6, Cannonball: 2, 'Mithril scimitar': 1329, Logs: 1511, Coins: 995,
    Shark: 385, Tinderbox: 590, 'Bronze axe': 1351, 'Khazard helmet': 74, 'Khazard armour': 75,
};
const STACKS = /rune$|^coins$|^cannonball$/i;
/** Banknotes stack whatever their name (obj.pack: cert_guamvial, cert_iritvial). */
const NOTES = new Set([92, 102]);
const stacks = (t: { id: number; name: string }) => STACKS.test(t.name) || NOTES.has(t.id);
const WEAPON = /staff|bow|scimitar|knife|axe/i;

const item = (slot: number, name: string, count = 1): InventoryItem => ({
    slot, id: IDS[name] ?? 9999, name, count,
    optionsWithIndex: WEAPON.test(name) ? [{ text: 'Wield', opIndex: 2 }] : [],
});
/** Inventory items in slots 0.. (unstackables one per slot). */
function pack(...entries: Array<[string, number?]>): InventoryItem[] {
    const out: InventoryItem[] = [];
    for (const [name, n = 1] of entries) {
        if (STACKS.test(name)) out.push(item(out.length, name, n));
        else for (let k = 0; k < n; k++) out.push(item(out.length, name));
    }
    return out;
}
const filler = (n: number) => Array.from({ length: n }, (_, i) => ({ ...item(i, 'Tinderbox'), id: 10_000 + i, name: `Junk ${i}` }));
const wornItem = (name: string): InventoryItem => ({ ...item(3, name), optionsWithIndex: [{ text: 'Remove', opIndex: 1 }] });
const partnerInView = [{ index: 7, name: PARTNER, x: 0, z: 0, level: 3 }] as unknown as BotWorldState['nearbyPlayers'];

function state(inventory: InventoryItem[], equipment: InventoryItem[] = [], o: Partial<BotWorldState> = {}): BotWorldState {
    return baseState({ inventory, equipment, nearbyPlayers: partnerInView, ...o });
}

const tradeItems = (entries: Array<[string, number?]>): TradeItem[] =>
    entries.map(([name, n = 1]) => ({ slot: 0, id: IDS[name] ?? 9999, name, count: n }));

/**
 * lib/fake-sdk.ts's trade partner under this file's item rules. `logoutAt`: the session drops on
 * that tick with the trade open, and the server refunds our offer.
 */
class TradeServer extends FakeTradePartner {
    constructor(s: BotWorldState, theirs: TradeItem[], opts: { logoutAt?: number } = {}) {
        super(s, theirs, { partner: PARTNER, stacks, weapon: name => WEAPON.test(name), ...opts });
    }
}

const ctxOf = (sdk: FakeSdk): StepContext<Record<string, never>> =>
    ({ sdk, bot: {}, c: {}, log: TickLog.memory(), session: { sdk, bot: {}, name: 't', sessionId: 1 } }) as unknown as StepContext<Record<string, never>>;

async function runStep(sdk: TradeServer, p: HandOffPlan, reports: HandOffReport[] = []) {
    const step = handOffStep<Record<string, never>>(p, { partner: PARTNER, onReport: r => reports.push(r) });
    expect(step.preconditions(sdk.state!, {})).toBe(true);
    await drive(sdk, step.run(ctxOf(sdk)), 200);
    return { step, reports };
}

// ------------------------------------------------------------------ the plan

describe('planHandOff: a ledger row as a hand-off', () => {
    test('the four shapes: receive-only, give-and-receive, give-only, and an equip change', () => {
        expect(tradeKind(plan('H1'))).toBe('receive');
        expect(plan('H1').receive.map(r => [r.name, r.count, r.kind])).toEqual([['staff of water', 1, 'u'], ['cosmic rune', 60, 's'], ['air rune', 81, 's'], ['law rune', 1, 's']]);
        expect(plan('H1').wield).toEqual([]);
        const h13 = plan('H13');
        expect(tradeKind(h13)).toBe('swap');
        expect(h13.give.map(g => [g.name, g.count])).toEqual([['magic shortbow', 1]]);
        expect(h13.wield.map(w => w.name)).toEqual(['staff of fire']);
        expect(h13.drop).toEqual([]);
        const h11r = plan('H11r');
        expect(tradeKind(h11r)).toBe('swap');
        expect(h11r.receive).toEqual([]);
        expect(h11r.give.map(g => [g.name, g.count])).toEqual([['cannon base', 1], ['cannonball', 'all']]);
        expect(plan('H9').give.map(g => [g.name, g.count])).toEqual([['shark', 'all']]);
    });

    test('ledger names match the game names: exact, case-blind, a dose suffix, and normal logs as Logs', () => {
        expect(itemPattern('prayer potion').test('Prayer potion(4)')).toBe(true);
        expect(itemPattern('prayer potion').test('Super prayer potion(4)')).toBe(false);
        expect(itemPattern('normal logs').test('Logs')).toBe(true);
        expect(itemPattern('normal logs').test('Oak logs')).toBe(false);
        expect(itemPattern('knife').test('Knife')).toBe(true);
        expect(itemPattern('knife').test('Rune knife')).toBe(false);
        expect(itemPattern("wizard's mind bomb").test("Wizard's mind bomb")).toBe(true);
    });

    test('refuses a row the trade cannot carry out', () => {
        expect(() => plan('T01-02')).toThrow(/not a hand-off row/);
        // A drop alone is no trade.
        expect(() => plan('H99')).toThrow(/^H99 \(line \d+\): nothing given and nothing received$/);
        expect(() => plan('H98')).toThrow(/tree items x\? has no count/);
        expect(() => plan('H77')).toThrow(/no ledger row H77/);
        expect(() => handOffFrom(TABLE.replace('(drop: unworn first) | +staff', '(consume) | +staff'), 'H96')).toThrow(/out khazard helmet \(consume\) is neither given in the trade nor dropped on the tile/);
    });

    test('drop entries are never given; a swap or trade of an untradeable obj is refused when the row is planned, by name or by id', () => {
        expect([untradeable(74), untradeable(75), untradeable(IDS['Magic shortbow']!), untradeable(IDS.Knife!)]).toEqual([true, true, false, false]);
        const h96 = plan('H96');
        expect(tradeKind(h96)).toBe('swap');
        expect(h96.give.map(g => g.name)).toEqual(['magic shortbow']);
        expect(h96.drop.map(g => [g.name, g.count])).toEqual([['khazard helmet', 1]]);
        expect(() => plan('H95')).toThrow(/^H95 \(line \d+\): out khazard helmet \(swap\): the engine refuses it in a trade \(obj 74 untradeable in the content's obj config; trade\.rs2\), so the row must drop it$/);
        expect(() => plan('H94')).toThrow(/^H94 \(line \d+\): out khazard armour.*\(trade\): the engine refuses it in a trade \(obj 75 /);
        expect(() => handOffFrom('no table here', 'H1')).toThrow(/does not parse/);
        const both = parseLedger('| row | in | out | equip | needAtStart | source |\n| H5 | knife x1 [u] | knife x1 (swap) | - | 0 | x (r) |').rows[0]!;
        expect(() => planHandOff(both)).toThrow(/knife both given and received/);
    });
});

// ------------------------------------------------------------------ preconditions

describe('handOffPre', () => {
    test('refuses when the partner is not in view', () => {
        expect(handOffPre(state(pack(['Tinderbox'])), plan('H1'), 'Someone else')).toMatch(/Someone else is not in view/);
        expect(handOffPre(state(pack(['Tinderbox']), [], { nearbyPlayers: [] }), plan('H1'), PARTNER)).toMatch(/not in view/);
    });

    test('the free-slot rule: unstackables take a slot each, a held stack takes none', () => {
        const h1 = plan('H1');
        // H1 adds the staff (1) and three new stacks (3): 4 slots.
        expect(handOffPre(state(filler(24)), h1, PARTNER)).toBe(true);
        expect(handOffPre(state(filler(25)), h1, PARTNER)).toMatch(/3 free slots, 0 freed by what it gives: the trade adds 4, 1 short/);
        // Holding air and law already: only the staff and the cosmic stack are new.
        expect(handOffPre(state([...filler(24), item(24, 'Air rune', 5), item(25, 'Law rune', 2)]), h1, PARTNER)).toBe(true);
    });

    test('what it gives counts as freed (trade.rs2), and a worn give takes a slot first', () => {
        const h13 = plan('H13');
        // 4 adds (staff, knife, 2 potions; blood is a new stack: 5), the bow frees 1, the wield frees 1.
        const full = (n: number) => [...filler(n), item(n, 'Magic shortbow')];
        expect(handOffPre(state(full(23)), h13, PARTNER)).toBe(true);
        expect(handOffPre(state(full(24)), h13, PARTNER)).toMatch(/the trade adds 5, 1 short/);
        // The H12 shape gives the worn scimitar: off first (a slot), then freed by the offer.
        const h12 = plan('H12');
        expect(handOffPre(state(filler(25), [wornItem('Mithril scimitar')]), h12, PARTNER)).toBe(true);
        expect(handOffPre(state(filler(28), [wornItem('Mithril scimitar')]), h12, PARTNER)).toMatch(/0 free slots, and taking off Mithril scimitar to give needs 1/);
    });

    test('refuses when SCORED does not hold what it gives, or holds more than the row gives', () => {
        expect(handOffPre(state(filler(3)), plan('H13'), PARTNER)).toMatch(/holds no magic shortbow to give/);
        expect(handOffPre(state(pack(['Magic shortbow', 2])), plan('H13'), PARTNER)).toMatch(/holds 2 magic shortbow and gives 1/);
    });

    test('handOffRoom is the slot rule alone: no partner needed, the same refusals as handOffPre', () => {
        const h13 = plan('H13');
        const full = (n: number) => [...filler(n), item(n, 'Magic shortbow')];
        const alone = (inv: InventoryItem[], eq: InventoryItem[] = []) => state(inv, eq, { nearbyPlayers: [] });
        expect(handOffPre(alone(full(23)), h13, PARTNER)).toMatch(/not in view/);
        expect(handOffRoom(alone(full(23)), h13)).toBe(true);
        expect(handOffRoom(alone(full(24)), h13)).toBe(handOffPre(state(full(24)), h13, PARTNER));
        expect(handOffRoom(alone(full(24)), h13)).toMatch(/the trade adds 5, 1 short/);
        expect(handOffRoom(alone(filler(28), [wornItem('Mithril scimitar')]), plan('H12'))).toMatch(/taking off Mithril scimitar to give needs 1/);
    });

    test("the split leaves handOffPre's verdicts as they were, and handOffRoom gives the same slot verdict with or without a partner", () => {
        // Packs from roomy to full for three trade shapes: receive only (H1), a held give (H13), a worn give (H12).
        const bow = (n: number) => [...filler(n), item(n, 'Magic shortbow')];
        const sweep: Array<[string, BotWorldState, HandOffPlan]> = [
            ...[22, 23, 24, 25, 26].map((n): [string, BotWorldState, HandOffPlan] => [`H1 filler ${n}`, state(filler(n)), plan('H1')]),
            ...[20, 21, 22, 23, 24, 25, 26, 27].map((n): [string, BotWorldState, HandOffPlan] => [`H13 filler ${n} + bow`, state(bow(n)), plan('H13')]),
            ...[24, 25, 26, 27, 28].map((n): [string, BotWorldState, HandOffPlan] => [`H12 filler ${n}, scimitar worn`, state(filler(n), [wornItem('Mithril scimitar')]), plan('H12')]),
        ];
        // handOffPre on the sweep before handOffRoom was split out of it (main's handoff.ts at ee75d700).
        const PRE_SPLIT: Array<[string, true | string]> = [
            ["H1 filler 22", true],
            ["H1 filler 23", true],
            ["H1 filler 24", true],
            ["H1 filler 25", "H1: 3 free slots, 0 freed by what it gives: the trade adds 4, 1 short"],
            ["H1 filler 26", "H1: 2 free slots, 0 freed by what it gives: the trade adds 4, 2 short"],
            ["H13 filler 20 + bow", true],
            ["H13 filler 21 + bow", true],
            ["H13 filler 22 + bow", true],
            ["H13 filler 23 + bow", true],
            ["H13 filler 24 + bow", "H13: 3 free slots, 1 freed by what it gives: the trade adds 5, 1 short"],
            ["H13 filler 25 + bow", "H13: 2 free slots, 1 freed by what it gives: the trade adds 5, 2 short"],
            ["H13 filler 26 + bow", "H13: 1 free slots, 1 freed by what it gives: the trade adds 5, 3 short"],
            ["H13 filler 27 + bow", "H13: 0 free slots, 1 freed by what it gives: the trade adds 5, 4 short"],
            ["H12 filler 24, scimitar worn", true],
            ["H12 filler 25, scimitar worn", true],
            ["H12 filler 26, scimitar worn", "H12: 2 free slots, 1 freed by what it gives: the trade adds 3, 1 short"],
            ["H12 filler 27, scimitar worn", "H12: 1 free slots, 1 freed by what it gives: the trade adds 3, 2 short"],
            ["H12 filler 28, scimitar worn", "H12: 0 free slots, and taking off Mithril scimitar to give needs 1"],
        ];
        expect(sweep.map(([at, s, p]) => [at, handOffPre(s, p, PARTNER)])).toEqual(PRE_SPLIT);
        expect(sweep.map(([at, s, p]) => [at, handOffRoom(s, p)])).toEqual(PRE_SPLIT);
        expect(sweep.map(([at, s, p]) => [at, handOffRoom({ ...s, nearbyPlayers: [] }, p)])).toEqual(PRE_SPLIT);
        // The sweep reaches a pass and both slot refusals it can: the trade short, and no room to take a worn give off.
        const verdicts = PRE_SPLIT.map(([, v]) => v);
        expect(verdicts).toContain(true);
        expect(verdicts.some(v => typeof v === 'string' && / short$/.test(v))).toBe(true);
        expect(verdicts.some(v => typeof v === 'string' && /to give needs 1$/.test(v))).toBe(true);
        // The drop rows (H96 one worn drop, H93 two) have no pre-split verdict: handOffPre, handOffRoom with or
        // without a partner, and the verdict read off slotPlan agree, over the H13 packs with the drops worn.
        const slotVerdict = (s: BotWorldState, p: HandOffPlan): true | string => {
            const { free, off, freed, adds, room, after } = slotPlan(s, p);
            if (free < off.length) return `${p.id}: ${free} free slots, and taking off ${off.map(i => i.name).join(', ')} to give needs ${off.length}`;
            if (room < adds) return `${p.id}: ${free} free slots, ${freed} freed by what it gives: the trade adds ${adds}, ${adds - room} short`;
            if (after < 0) return `${p.id}: the equip changes after the trade need ${-after} more free slots`;
            return true;
        };
        expect(sweep.map(([at, s, p]) => [at, slotVerdict(s, p)])).toEqual(PRE_SPLIT);
        const helmet = wornItem('Khazard helmet');
        const armour = { ...wornItem('Khazard armour'), slot: 4 };
        const drops: Array<[string, BotWorldState, HandOffPlan]> = [
            ...[20, 21, 22, 23, 24, 25, 26, 27].map((n): [string, BotWorldState, HandOffPlan] => [`H96 filler ${n} + bow, helmet worn`, state(bow(n), [helmet]), plan('H96')]),
            ...[20, 21, 22, 23, 24, 25, 26, 27].map((n): [string, BotWorldState, HandOffPlan] => [`H93 filler ${n} + bow, helmet and armour worn`, state(bow(n), [helmet, armour]), plan('H93')]),
        ];
        const DROP_VERDICTS: Array<[string, true | string]> = [
            ...[20, 21, 22, 23, 24, 25, 26].map((n): [string, true] => [`H96 filler ${n} + bow, helmet worn`, true]),
            ["H96 filler 27 + bow, helmet worn", "H96: 0 free slots, and taking off Khazard helmet to give needs 1"],
            ...[20, 21, 22, 23, 24, 25].map((n): [string, true] => [`H93 filler ${n} + bow, helmet and armour worn`, true]),
            ["H93 filler 26 + bow, helmet and armour worn", "H93: 1 free slots, and taking off Khazard helmet, Khazard armour to give needs 2"],
            ["H93 filler 27 + bow, helmet and armour worn", "H93: 0 free slots, and taking off Khazard helmet, Khazard armour to give needs 2"],
        ];
        expect(drops.map(([at, s, p]) => [at, slotVerdict(s, p)])).toEqual(DROP_VERDICTS);
        expect(drops.map(([at, s, p]) => [at, handOffPre(s, p, PARTNER)])).toEqual(DROP_VERDICTS);
        expect(drops.map(([at, s, p]) => [at, handOffRoom(s, p)])).toEqual(DROP_VERDICTS);
        expect(drops.map(([at, s, p]) => [at, handOffRoom({ ...s, nearbyPlayers: [] }, p)])).toEqual(DROP_VERDICTS);
    });
});

// ------------------------------------------------------------------ done and in progress

describe('the post-hand-off state', () => {
    test('done: every in held at its count (worn counts), the given items gone, the equip in place', () => {
        const h13 = plan('H13');
        const after = state(pack(['Knife'], ['Blood rune', 70], ['Prayer potion(4)', 2]), [wornItem('Staff of fire')]);
        expect(handOffMissing(after, h13)).toEqual([]);
        const before = state(pack(['Magic shortbow'], ['Blood rune', 3]));
        expect(handOffMissing(before, h13)).toEqual(['staff of fire 0 of 1', 'knife 0 of 1', 'blood rune 3 of 70', 'prayer potion 0 of 2', 'magic shortbow x1 still held', 'staff of fire not worn']);
        expect(tradeLanded(before, h13)).toBe(false);
    });

    test('landed but not equipped is in progress, not done', () => {
        const h13 = plan('H13');
        const landed = state(pack(['Staff of fire'], ['Knife'], ['Blood rune', 70], ['Prayer potion(4)', 2]));
        expect(tradeLanded(landed, h13)).toBe(true);
        expect(handOffMissing(landed, h13)).toEqual(['staff of fire not worn']);
    });

    test('a worn item the row gives is taken off; one it gives from the pack is not', () => {
        expect(toUnequip(state([], [wornItem('Mithril scimitar')]), plan('H12')).map(i => i.name)).toEqual(['Mithril scimitar']);
        expect(toUnequip(state(pack(['Magic shortbow'])), plan('H13'))).toEqual([]);
    });
});

// ------------------------------------------------------------------ `any`: whatever is held, zero or more

describe("an `any` count gives or drops whatever is held, and none held is nothing to give (main's ruling, rs/663)", () => {
    const ANY = `
| row | in | out | equip | needAtStart | source |
|---|---|---|---|---|---|
| H13 | knife x1 [u] | magic shortbow x1 (swap); blood rune any (swap: dead stock); shark any (drop: a backstop) | - | 1 | fixture (r) |
| H15 | knife x1 [u] | blood rune any (swap) | - | 1 | fixture (r) |
| H16 | knife x1 [u] | blood rune all (swap) | - | 1 | fixture (r) |
`;
    const p = (id: string) => handOffFrom(ANY, id);
    const counts = (gs: readonly Given[]) => gs.map(g => [g.name, g.count]);

    test('the plan keeps `any`; resolvePlan makes it `all` when some is held and drops the entry when none is', () => {
        expect(counts(p('H13').give)).toEqual([['magic shortbow', 1], ['blood rune', 'any']]);
        expect(counts(p('H13').drop)).toEqual([['shark', 'any']]);
        const some = resolvePlan(state(pack(['Magic shortbow'], ['Blood rune', 12], ['Shark', 2])), p('H13'));
        expect([counts(some.give), counts(some.drop)]).toEqual([[['magic shortbow', 1], ['blood rune', 'all']], [['shark', 'all']]]);
        const none = resolvePlan(state(pack(['Magic shortbow'])), p('H13'));
        expect([counts(none.give), counts(none.drop)]).toEqual([[['magic shortbow', 1]], []]);
        // a row of `any` gives alone, none held, only receives
        expect(tradeKind(p('H15'))).toBe('swap');
        expect(tradeKind(resolvePlan(state(filler(2)), p('H15')))).toBe('receive');
    });

    test('handOffPre: an `any` give with none held is no refusal; `all` with none held still refuses, and a count still needs its count', () => {
        expect(handOffPre(state(pack(['Magic shortbow'])), p('H13'), PARTNER)).toBe(true);
        expect(handOffPre(state(filler(2)), p('H15'), PARTNER)).toBe(true);
        expect(handOffPre(state(filler(2)), p('H16'), PARTNER)).toMatch(/H16: holds no blood rune to give/);
        expect(handOffPre(state(pack(['Blood rune', 9])), p('H13'), PARTNER)).toMatch(/holds no magic shortbow to give/);
    });

    test('the slots: an `any` held frees its slots, none held frees none', () => {
        expect(slotPlan(state(pack(['Magic shortbow'], ['Blood rune', 12], ['Shark', 2])), p('H13')).freed).toBe(4);
        expect(slotPlan(state(pack(['Magic shortbow'])), p('H13')).freed).toBe(1);
    });

    test('the trade offers an `any` give that is held, all of it; with none held the row only receives', async () => {
        const some = new TradeServer(state(pack(['Tinderbox'], ['Blood rune', 30])), tradeItems([['Knife']]));
        const a = await runStep(some, p('H15'));
        expect(a.reports[0]).toMatchObject({ id: 'H15', trade: 'swap', ok: true, gave: ['Blood rune x30'], received: ['Knife x1'] });
        expect(giveSpecs(state(pack(['Blood rune', 30])), p('H15'))).toEqual([{ item: p('H15').give[0]!.pattern, n: 'all' }]);
        expect(a.step.postconditions(some.state!, {})).toBe(true);

        const none = new TradeServer(state(pack(['Tinderbox'])), tradeItems([['Knife']]));
        const b = await runStep(none, p('H15'));
        expect(b.reports[0]).toMatchObject({ id: 'H15', trade: 'receive', ok: true, gave: [], received: ['Knife x1'] });
        expect(none.sent.some(x => x.method === 'sendOfferItem')).toBe(false);
        expect(b.step.postconditions(none.state!, {})).toBe(true);
    });

    describe("the manifest's exhaustible gives (rs/158's classification): none held passes, held is given", () => {
        const ANY_GIVES: Record<string, string[]> = {
            // a dose family (`antipoison(*)`) plans under its bare name
            H12: ['antipoison', 'coins', 'death rune', 'chaos rune'],
            H13: ['coins', 'superantipoison', 'fire rune'],
            H15: ['bronze arrow', 'iron arrow', 'steel arrow', 'mithril arrow', 'adamant arrow', 'coins', 'shark', 'blood rune', 'nature rune'],
        };
        const cap = (n: string) => n.charAt(0).toUpperCase() + n.slice(1);
        /** One held item `g` matches: a family by one dose, an @id by its obj. */
        const heldOf = (g: Given, slot: number, count: number): InventoryItem => {
            const name = g.pattern.test(cap(g.name)) ? cap(g.name) : `${cap(g.name)}(2)`;
            return { slot, id: g.ids?.[0] ?? IDS[name] ?? 9999, name, count, optionsWithIndex: [] };
        };
        /** The row's other gives at their counts (`all` as one), slot by slot. */
        const mustHave = (plan: HandOffPlan) => plan.give.filter(g => g.count !== 'any').flatMap(g => Array.from({ length: typeof g.count === 'number' ? g.count : 1 }, () => g));

        for (const id of Object.keys(ANY_GIVES)) {
            test(`${id}: the \`any\` gives are ${ANY_GIVES[id]!.join(', ')}; with none of them held the hand-off passes, with all held each is given`, () => {
                const row = loadHandOff(id);
                expect(row.give.filter(g => g.count === 'any').map(g => g.name)).toEqual(ANY_GIVES[id]!);
                const kit = mustHave(row).map((g, slot) => heldOf(g, slot, 1));
                const without = state(kit);
                expect(handOffPre(without, row, PARTNER)).toBe(true);
                expect(resolvePlan(without, row).give.map(g => g.name)).toEqual(row.give.filter(g => g.count !== 'any').map(g => g.name));
                const exhaustible = row.give.filter(g => g.count === 'any').map((g, k) => heldOf(g, kit.length + k, 5));
                expect(resolvePlan(state([...kit, ...exhaustible]), row).give.filter(g => ANY_GIVES[id]!.includes(g.name)).map(g => g.count)).toEqual(ANY_GIVES[id]!.map(() => 'all'));
            });
        }

        test("H11r keeps `all`: the cannon set without its cannonballs still refuses, because a missing cannon is a real loss", () => {
            const row = loadHandOff('H11r');
            expect(row.give.map(g => [g.name, g.count])).toEqual([['cannon base', 1], ['cannon stand', 1], ['cannon barrels', 1], ['cannon furnace', 1], ['cannonball', 'all']]);
            const parts = mustHave(row).filter(g => g.name !== 'cannonball').map((g, slot) => heldOf(g, slot, 1));
            expect(handOffPre(state(parts), row, PARTNER)).toMatch(/H11r: holds no cannonball to give/);
            expect(handOffPre(state([...parts, heldOf(row.give[4]!, 4, 30)]), row, PARTNER)).toBe(true);
        });
    });
});

// ------------------------------------------------------------------ the trade, per row shape

describe('run: the trade through lib/trade.ts', () => {
    test('receive-only (H1): receiveFrom, nothing offered, the package held', async () => {
        const sdk = new TradeServer(state(pack(['Tinderbox'], ['Air rune', 25])), tradeItems([['Staff of water'], ['Cosmic rune', 60], ['Air rune', 81], ['Law rune', 1]]));
        const { step, reports } = await runStep(sdk, plan('H1'));
        expect(reports[0]).toMatchObject({ id: 'H1', trade: 'receive', ok: true, gave: [] });
        expect(sdk.sent.some(a => a.method === 'sendOfferItem')).toBe(false);
        expect(step.postconditions(sdk.state!, {})).toBe(true);
        expect(step.done!(new Observation(sdk.state!), {})).toBe(true);
    });

    test('give-and-receive (H13): one swap, the bow out, the staff and knife in, the staff wielded', async () => {
        const sdk = new TradeServer(state([...filler(5), item(5, 'Magic shortbow')]), tradeItems([['Staff of fire'], ['Knife'], ['Blood rune', 70], ['Prayer potion(4)'], ['Prayer potion(4)']]));
        const { step, reports } = await runStep(sdk, plan('H13'));
        expect(reports[0]).toMatchObject({ trade: 'swap', ok: true, gave: ['Magic shortbow x1'], dropped: [] });
        expect(sdk.tradeClicks).toHaveLength(1);
        // A row with no drop sends none: the trade's packets are as they were.
        expect(sdk.sent.some(a => a.method === 'sendDropItem')).toBe(false);
        expect(sdk.state!.equipment.map(e => e.name)).toEqual(['Staff of fire']);
        expect(step.postconditions(sdk.state!, {})).toBe(true);
    });

    test('give-only (H11r): a swap that wants nothing back', async () => {
        const sdk = new TradeServer(state(pack(['Cannon base'], ['Cannonball', 30], ['Tinderbox'])), []);
        const { step, reports } = await runStep(sdk, plan('H11r'));
        expect(reports[0]).toMatchObject({ trade: 'swap', ok: true, received: [] });
        expect(sdk.state!.inventory.map(i => i.name)).toEqual(['Tinderbox']);
        expect(step.postconditions(sdk.state!, {})).toBe(true);
    });

    test('an equip change (H12): the worn scimitar comes off before the first trade click, the bow goes on after', async () => {
        const sdk = new TradeServer(state(filler(4), [wornItem('Mithril scimitar')]), tradeItems([['Magic shortbow'], ['Logs'], ['Logs']]));
        const { step, reports } = await runStep(sdk, plan('H12'));
        expect(reports[0]).toMatchObject({ ok: true, gave: ['Mithril scimitar x1'], unequipped: ['Mithril scimitar'] });
        expect(sdk.unequipTicks[0]!).toBeLessThan(sdk.tradeClicks[0]!);
        expect(sdk.state!.equipment.map(e => e.name)).toEqual(['Magic shortbow']);
        expect(sdk.state!.inventory.filter(i => i.name === 'Logs')).toHaveLength(2);
        expect(step.postconditions(sdk.state!, {})).toBe(true);
    });

    test('a drop row (H96): the worn helmet comes off and is dropped before the first trade click, never offered; the bow is traded', async () => {
        const start = state([...filler(5), item(5, 'Magic shortbow')], [wornItem('Khazard helmet')]);
        const before = slotPlan(start, plan('H96'));
        const sdk = new TradeServer(start, tradeItems([['Staff of fire']]));
        const { step, reports } = await runStep(sdk, plan('H96'));
        expect(reports[0]).toMatchObject({ trade: 'swap', ok: true, gave: ['Magic shortbow x1'], unequipped: ['Khazard helmet'], dropped: ['Khazard helmet'] });
        const methods = sdk.sent.map(a => a.method);
        expect(methods.filter(m => m === 'sendDropItem')).toHaveLength(1);
        expect(methods.indexOf('sendDropItem')).toBeLessThan(methods.indexOf('sendTradeRequest'));
        // One offer, the bow's: the confirm never carries the helmet, and the engine never refused one.
        expect(methods.filter(m => m === 'sendOfferItem')).toHaveLength(1);
        expect(sdk.state!.gameMessages.some(m => /can't trade/.test(m.text))).toBe(false);
        // Free slots: 22 before; the helmet's unequip takes one, the bow and the helmet free two, the staff
        // takes one and its wield gives it back: 23 after, as the slot plan said.
        expect(before).toMatchObject({ free: 22, freed: 2, adds: 1, after: 23 });
        expect(before.off.map(i => i.name)).toEqual(['Khazard helmet']);
        expect(28 - sdk.state!.inventory.length).toBe(23);
        expect(sdk.state!.equipment.map(e => e.name)).toEqual(['Staff of fire']);
        expect(step.postconditions(sdk.state!, {})).toBe(true);
        expect(step.done!(new Observation(sdk.state!), {})).toBe(true);
    });

    test('a restart partway through the drops (H93): what is already gone is neither dropped again nor a refusal', async () => {
        // The helmet was dropped before the restart; the armour is still worn.
        const half = new TradeServer(state([...filler(5), item(5, 'Magic shortbow')], [wornItem('Khazard armour')]), tradeItems([['Staff of fire']]));
        const first = await runStep(half, plan('H93'));
        expect(first.reports[0]).toMatchObject({ ok: true, dropped: ['Khazard armour'], gave: ['Magic shortbow x1'] });
        expect(half.sent.filter(a => a.method === 'sendDropItem')).toHaveLength(1);
        expect(first.step.postconditions(half.state!, {})).toBe(true);
        // Both gone before the restart: no drop is sent at all, and the trade runs.
        const none = new TradeServer(state([...filler(5), item(5, 'Magic shortbow')]), tradeItems([['Staff of fire']]));
        const second = await runStep(none, plan('H93'));
        expect(second.reports[0]).toMatchObject({ ok: true, dropped: [], gave: ['Magic shortbow x1'] });
        expect(none.sent.some(a => a.method === 'sendDropItem')).toBe(false);
        expect(second.step.postconditions(none.state!, {})).toBe(true);
    });

    test('an untradeable obj under a give (a hand-built plan): handOffPre refuses it, and the engine refuses its offer', async () => {
        const h96 = plan('H96');
        const bad: HandOffPlan = { ...h96, give: [...h96.give, ...h96.drop], drop: [] };
        const s = state([...filler(5), item(5, 'Magic shortbow')], [wornItem('Khazard helmet')]);
        expect(handOffPre(s, bad, PARTNER)).toBe('H96: gives khazard helmet, but the engine refuses Khazard helmet (obj 74) in a trade: the row must drop it');
        const sdk = new TradeServer(s, tradeItems([['Staff of fire']]));
        await expect(drive(sdk, runHandOff(sdk, bad, PARTNER, { maxTicks: 15 }), 200)).rejects.toThrow(/^H96 with Helper/);
        expect(sdk.state!.gameMessages.some(m => m.text === "You can't trade this item.")).toBe(true);
    });

    test('receive-only opens on an observed-tick bound: a partner who never answers fails at openTicks, not on the wall clock', async () => {
        // The partner is in view but never opens the trade: the request is re-sent every
        // DROPPED_TICKS silent ticks, and the open gives up once openTicks ticks have passed.
        const sdk = new FakeSdk(state(pack(['Tinderbox'])));
        const reports: HandOffReport[] = [];
        const run = runHandOff(sdk as unknown as Parameters<typeof runHandOff>[0], plan('H1'), PARTNER, { openTicks: 8, onReport: r => reports.push(r) });
        await expect(drive(sdk, run, 30)).rejects.toThrow(/H1 with Helper: no_response/);
        expect(reports[0]).toMatchObject({ trade: 'receive', ok: false, reason: 'no_response' });
        const clicks = sdk.sent.filter(a => a.method === 'sendTradeRequest').length;
        expect(clicks).toBeGreaterThan(1);
        expect(sdk.state!.tick - 100).toBeLessThanOrEqual(10);
    });

    test('a failed trade throws with the reason, after reporting it', async () => {
        const sdk = new TradeServer(state(pack(['Tinderbox'])), tradeItems([['Cosmic rune', 10]]));
        const reports: HandOffReport[] = [];
        const step = handOffStep<Record<string, never>>(plan('H1'), { partner: PARTNER, onReport: r => reports.push(r), maxTicks: 10 });
        await expect(drive(sdk, step.run(ctxOf(sdk)), 200)).rejects.toThrow(/^H1 with Helper: /);
        expect(reports[0]!.ok).toBe(false);
    });
});

// ------------------------------------------------------------------ top up (rs/158's ruling on H12)

describe('a top-up row: top up to N counting what is held', () => {
    // As slot-ledger.ts's parser will hand it over once the grammar carries the form (an `in`
    // entry with `topUp`); built by hand here.
    const row = parseLedger('| row | in | out | equip | needAtStart | source |\n| H10 | shark x8 [u] | - | - | 8 | x (r) |').rows[0]!;
    const h10 = planHandOff({ ...row, in: [{ ...row.in[0]!, topUp: true } as (typeof row.in)[number]] });

    test('asks for what SCORED lacks, and sizes the free-slot rule on it', () => {
        expect(h10.receive[0]!.topUp).toBe(true);
        // 3 sharks held: 5 to come, so 5 free slots are enough.
        expect(handOffPre(state([...filler(20), ...pack(['Shark', 3]).map((i, k) => ({ ...i, slot: 20 + k }))]), h10, PARTNER)).toBe(true);
        expect(handOffPre(state([...filler(21), ...pack(['Shark', 3]).map((i, k) => ({ ...i, slot: 21 + k }))]), h10, PARTNER)).toMatch(/the trade adds 5, 1 short/);
    });

    test('a stackable top-up takes a slot only when SCORED holds none of it', () => {
        const r = parseLedger('| row | in | out | equip | needAtStart | source |\n| H9 | law rune x4 [s] | - | - | 1 | x (r) |').rows[0]!;
        const law = planHandOff({ ...r, in: [{ ...r.in[0]!, topUp: true } as (typeof r.in)[number]] });
        expect(handOffPre(state(filler(27)), law, PARTNER)).toBe(true);
        expect(handOffPre(state(filler(28)), law, PARTNER)).toMatch(/the trade adds 1, 1 short/);
        expect(handOffPre(state([...filler(27), item(27, 'Law rune', 1)]), law, PARTNER)).toBe(true);
    });

    test('the trade wants the difference; done at the total', async () => {
        const sdk = new TradeServer(state(pack(['Shark', 3])), tradeItems([['Shark', 5]]));
        const { step, reports } = await runStep(sdk, h10);
        expect(reports[0]).toMatchObject({ trade: 'receive', ok: true });
        expect(sdk.state!.inventory.filter(i => i.name === 'Shark')).toHaveLength(8);
        expect(step.postconditions(sdk.state!, {})).toBe(true);
    });

    test('end to end: a `NAME to N` row read through slot-ledger.ts and loadHandOff tops up to the total', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'handoff-'));
        const file = join(dir, 'ledger.md');
        writeFileSync(file, '| row | in | out | equip | needAtStart | source |\n|---|---|---|---|---|---|\n| H10 | shark to 8 [u]; law rune to 4 [s] | - | - | 6 | x (r) |\n');
        const p = loadHandOff('H10', file);
        expect(p.receive.map(r => [r.name, r.count, r.topUp])).toEqual([['shark', 8, true], ['law rune', 4, true]]);
        // 3 sharks and 1 law rune held: the trade asks for 5 sharks and 3 law runes, and the step is done at 8 and 4.
        const sdk = new TradeServer(state([...pack(['Shark', 3]), item(3, 'Law rune', 1)]), tradeItems([['Shark', 5], ['Law rune', 3]]));
        const { step, reports } = await runStep(sdk, p);
        expect(reports[0]).toMatchObject({ trade: 'receive', ok: true });
        expect(sdk.state!.inventory.filter(i => i.name === 'Shark')).toHaveLength(8);
        expect(sdk.state!.inventory.find(i => i.name === 'Law rune')!.count).toBe(4);
        expect(step.done!(new Observation(sdk.state!), {})).toBe(true);
    });

    test('every top-up already met: no trade at all', async () => {
        const sdk = new TradeServer(state(pack(['Shark', 8])), []);
        const reports: HandOffReport[] = [];
        await drive(sdk, runHandOff(sdk, h10, PARTNER, { onReport: r => reports.push(r) }), 20);
        expect(sdk.sent).toEqual([]);
        expect(reports[0]).toMatchObject({ ok: true, ticks: 0 });
    });
});

describe("the mule's top-up ask: every `to N` entry asked on the trade's first open frame (rs/429's format)", () => {
    const ledger = readFileSync(MANIFEST, 'utf8');
    const row = (id: string) => handOffFrom(ledger, id);
    const shark = itemPattern('shark').source;
    const coins = itemPattern('coins').source;

    test('H10 `shark to 8`: holding 3, asks 5', () => {
        expect(askFor(state(pack(['Shark', 3])), row('H10'))).toEqual([{ item: shark, count: 5 }]);
    });

    test('H12 `shark to 15`: holding 6, asks 9', () => {
        expect(askFor(state(pack(['Shark', 6])), row('H12'))).toEqual([{ item: shark, count: 9 }]);
    });

    test('H22 `coins to 126000` and `shark to 10`: both entries in one ask, in the row\'s order', () => {
        expect(askFor(state([item(0, 'Coins', 100_000), ...pack(['Shark', 2]).map((i, k) => ({ ...i, slot: 1 + k }))]), row('H22'))).toEqual([{ item: coins, count: 26_000 }, { item: shark, count: 8 }]);
    });

    test('an entry already met is not asked (H22 holding the coins)', () => {
        expect(askFor(state([item(0, 'Coins', 126_000), ...pack(['Shark', 2]).map((i, k) => ({ ...i, slot: 1 + k }))]), row('H22'))).toEqual([{ item: shark, count: 8 }]);
    });

    test('every entry met: no ask (H10 holding 8)', () => {
        expect(askFor(state(pack(['Shark', 8])), row('H10'))).toEqual([]);
    });

    const TOPUPS = '| row | in | out | equip | needAtStart | source |\n|---|---|---|---|---|---|\n| H10 | shark to 8 [u]; law rune to 4 [s] | - | - | 6 | x (r) |\n';
    const scope = { step: 'S13', family: 'mule' as const };

    test('end to end: the scoped ask is on disk on the first frame showing the trade open, and the trade wants exactly it', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'handoff-ask-'));
        const p = handOffFrom(TOPUPS, 'H10');
        const sdk = new TradeServer(state([...pack(['Shark', 3]), item(3, 'Law rune', 1)]), tradeItems([['Shark', 5], ['Law rune', 3]]));
        const reports: HandOffReport[] = [];
        const run = runHandOff(sdk, p, PARTNER, { cue: { scope, ask: { dir } }, onReport: r => reports.push(r) });
        let onOpen = null as boolean | null;
        sdk.onStateUpdate(st => {
            if (onOpen === null && st.trade?.isOpen) queueMicrotask(() => (onOpen = existsSync(join(dir, ASK_FILE))));
        });
        await drive(sdk, run, 60);
        expect(onOpen).toBe(true);
        const ask = readTopUpAsk(dir)!;
        expect(ask.scope).toEqual(scope);
        expect(ask.items).toEqual([{ item: shark, count: 5 }, { item: itemPattern('law rune').source, count: 3 }]);
        expect(reports[0]).toMatchObject({ ok: true, asked: ask.items });
        expect(sdk.state!.inventory.filter(i => i.name === 'Shark')).toHaveLength(8);
    });

    test('every top-up met: no ask written and no trade', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'handoff-ask-'));
        const sdk = new TradeServer(state([...pack(['Shark', 8]), item(8, 'Law rune', 4)]), []);
        const reports: HandOffReport[] = [];
        await drive(sdk, runHandOff(sdk, handOffFrom(TOPUPS, 'H10'), PARTNER, { cue: { scope, ask: { dir } }, onReport: r => reports.push(r) }), 20);
        expect(sdk.sent).toEqual([]);
        expect(existsSync(join(dir, ASK_FILE))).toBe(false);
        expect(reports[0]).toMatchObject({ ok: true, ticks: 0 });
    });

    test('a standing partner (an ask, no cue to open) must be in view, as any placed giver', () => {
        const step = handOffStep(handOffFrom(TOPUPS, 'H10'), { partner: PARTNER, cue: { scope, ask: { dir: '/tmp/x' } } });
        expect(step.preconditions(state(pack(['Shark', 3]), [], { nearbyPlayers: [] }), {})).toMatch(/not in view/);
    });
});

describe("H13's `shark to 2` (T15-16b's Wilderness food): the top-up counts what SCORED holds", () => {
    const real = () => handOffFrom(readFileSync(MANIFEST, 'utf8'), 'H13');
    // The top-up's trade shape on a minimal row: one give, one fixed receive, and the shark line.
    const ROW = '| row | in | out | equip | needAtStart | source |\n|---|---|---|---|---|---|\n| H13 | knife x1 [u]; shark to 2 [u] | magic shortbow x1 (swap) | - | 3 | fixture (r) |\n';
    const sharks = (s: BotWorldState) => s.inventory.filter(i => i.name === 'Shark').length;

    test('the real row carries it: an unstackable top-up to 2, asked only for what is missing', () => {
        const shark = real().receive.find(r => r.name === 'shark')!;
        expect([shark.count, shark.topUp, shark.kind]).toEqual([2, true, 'u']);
        const sharkAsk = { item: itemPattern('shark').source, count: 2 };
        expect(askFor(state(pack(['Magic shortbow'])), real())).toContainEqual(sharkAsk);
        expect(askFor(state(pack(['Shark'])), real())).toContainEqual({ ...sharkAsk, count: 1 });
        expect(askFor(state(pack(['Shark', 2])), real()).some(a => a.item === sharkAsk.item)).toBe(false);
    });

    test('held 2: the partner offers no shark and the trade still lands (the shark wants 0, so it is not in the trade)', async () => {
        const sdk = new TradeServer(state(pack(['Magic shortbow'], ['Shark', 2])), tradeItems([['Knife']]));
        const { step, reports } = await runStep(sdk, handOffFrom(ROW, 'H13'));
        expect(reports[0]).toMatchObject({ trade: 'swap', ok: true, gave: ['Magic shortbow x1'] });
        expect(sharks(sdk.state!)).toBe(2);
        expect(tradeLanded(sdk.state!, handOffFrom(ROW, 'H13'))).toBe(true);
        expect(step.postconditions(sdk.state!, {})).toBe(true);
    });

    test('held 0: asks 2, the partner offers 2, the trade lands with 2 held', async () => {
        const sdk = new TradeServer(state(pack(['Magic shortbow'])), tradeItems([['Knife'], ['Shark'], ['Shark']]));
        const { step, reports } = await runStep(sdk, handOffFrom(ROW, 'H13'));
        expect(reports[0]).toMatchObject({ trade: 'swap', ok: true });
        expect(sharks(sdk.state!)).toBe(2);
        expect(tradeLanded(sdk.state!, handOffFrom(ROW, 'H13'))).toBe(true);
        expect(step.postconditions(sdk.state!, {})).toBe(true);
    });

    test("room: the real row fits SCORED's pack after T15-16 (slot-ledger.ts's held-after) with 0, 1 or 2 sharks held", () => {
        const worn = ['Khazard helmet', 'Khazard armour', 'Rune arrow', "M'speak amulet", 'Monkey greegree'].map((n, k) => ({ ...wornItem(n), slot: k }));
        const at = (n: number) => state(pack(
            ...(n ? [['Shark', n] as [string, number]] : []),
            ['Air rune', 237], ['Fire rune', 2], ['Law rune', 3], ['Water rune', 2], ['Prayer potion(4)', 2], ['Superantipoison(4)'],
            ['Amulet of magic'], ['Magic shortbow'], ['Coins', 10_000], ['Diamond', 3],
        ), worn);
        for (const n of [0, 1, 2]) expect(handOffRoom(at(n), real())).toBe(true);
        // The top-up adds only the sharks SCORED lacks: 2 slots at 0 held, none at 2.
        expect(slotPlan(at(0), real()).adds - slotPlan(at(2), real()).adds).toBe(2);
    });
});

// ------------------------------------------------------------------ item identity (rs/365)

describe('item identity: NAME @ID by obj id, NAME(*) by any dose, <NAME> left to the module', () => {
    const LEDGER = `
| row | in | out | equip | needAtStart | source |
|---|---|---|---|---|---|
| H21d | guam potion (unf) @91 x41 [n]; irit potion (unf) @101 x405 [n] | <platebody> x5 (swap: smithing.ts's); hammer x1 (swap) | - | 2 | fixture (r) |
| H15 | torch @596 x1 [u] (unlit) | torch @594 x1 (swap: the lit one) | - | 1 | fixture (r) |
| H15n | torch x1 [u] | torch x1 (swap) | - | 1 | fixture (r) |
| H13 | blood rune x70 [s] | antipoison(*) all (swap: whatever doses are left) | - | 1 | fixture (r) |
| H13n | blood rune x70 [s] | antipoison all (swap) | - | 1 | fixture (r) |
| H3 | <gem ring> x20 [u] | - | - | 20 | fixture (r) |
| H90 | torch @595 x1 [u] | - | - | 1 | fixture (r) |
| H91 | torch @99999 x1 [u] | - | - | 1 | fixture (r) |
| H92 | monkey greegree @4031 x1 [n] | - | - | 1 | fixture (r) |
`;
    const idPlan = (id: string) => handOffFrom(LEDGER, id);
    const obj = (slot: number, id: number, name: string, count = 1): InventoryItem => ({ slot, id, name, count, optionsWithIndex: [] });
    const unf = (id: number, count: number): TradeItem => ({ slot: 0, id, name: 'Unfinished potion', count });
    const hammer = (slot: number) => obj(slot, 2347, 'Hammer');

    test('the plan: ids checked against obj.pack, a noted in by its note (the cert link), an out by either form', () => {
        const h21d = idPlan('H21d');
        expect(h21d.receive.map(r => [r.name, r.ids, r.kind])).toEqual([['guam potion (unf)', [92], 'n'], ['irit potion (unf)', [102], 'n']]);
        expect(h21d.give.map(g => [g.name, g.ids, g.perObj])).toEqual([['hammer', undefined, false]]);
        expect(h21d.placeholders).toEqual(['<platebody>']);
        expect(idPlan('H15').receive[0]!.ids).toEqual([596]);
        expect(idPlan('H15').give[0]!.ids).toEqual([594, 595]);
        // The notes are read by name from obj.pack (cert_guamvial, cert_iritvial); the greegree has none.
        expect([noteOf(91), noteOf(101), noteOf(4031), noteOf(92)]).toEqual([92, 102, undefined, undefined]);
        expect(() => idPlan('H90')).toThrow(/torch @595 is a banknote \(cert_torch_lit\)/);
        expect(() => idPlan('H91')).toThrow(/obj.pack has no obj 99999/);
        expect(() => idPlan('H92')).toThrow(/monkey greegree @4031 \[n\]: mm_monkey_greegree_for_normal_monkey has no note/);
    });

    test('H21d: the two unfinished potions, both named so in game, are told apart by id', async () => {
        const h21d = idPlan('H21d');
        // Two noted stacks to come, the hammer's slot freed: 1 free is enough, 0 is not.
        expect(handOffPre(state([...filler(26), hammer(26)]), h21d, PARTNER)).toBe(true);
        expect(handOffPre(state([...filler(27), hammer(27)]), h21d, PARTNER)).toMatch(/the trade adds 2, 1 short/);
        // Irit notes held: only the guam stack is new. Unnoted guam is not the noted stack.
        expect(handOffPre(state([...filler(26), hammer(26), obj(27, 102, 'Unfinished potion', 5)]), h21d, PARTNER)).toBe(true);
        expect(handOffPre(state([...filler(26), hammer(26), obj(27, 91, 'Unfinished potion')]), h21d, PARTNER)).toMatch(/the trade adds 2, 1 short/);
        // 446 guam notes are not 41 guam and 405 irit.
        expect(handOffMissing(state([obj(0, 92, 'Unfinished potion', 446)]), h21d)).toEqual(['irit potion (unf) 0 of 405']);
        // The swap: the hammer out, both stacks in, the placeholder's platebodies not offered.
        const sdk = new TradeServer(state([...filler(3), hammer(3)]), [unf(92, 41), unf(102, 405)]);
        const { step, reports } = await runStep(sdk, h21d);
        expect(reports[0]).toMatchObject({ trade: 'swap', ok: true, gave: ['Hammer x1'] });
        expect(sdk.state!.inventory.filter(i => i.name === 'Unfinished potion').map(i => [i.id, i.count])).toEqual([[92, 41], [102, 405]]);
        expect(step.postconditions(sdk.state!, {})).toBe(true);
        // An offer of the right name and the wrong obj is not accepted.
        const wrong = new TradeServer(state([...filler(3), hammer(3)]), [unf(92, 446)]);
        await expect(drive(wrong, runHandOff(wrong, h21d, PARTNER, { maxTicks: 10 }), 100)).rejects.toThrow(/^H21d with Helper/);
        expect(wrong.state!.inventory.some(i => i.id === 92)).toBe(false);
    });

    test("H15: the unlit torch in and the lit one out, which by name would be one item both ways", async () => {
        const h15 = idPlan('H15');
        const lit = (slot: number) => obj(slot, 594, 'Torch');
        const unlit = (slot: number) => obj(slot, 596, 'Torch');
        expect(() => idPlan('H15n')).toThrow(/torch both given and received/);
        expect(handOffMissing(state([lit(0)]), h15)).toEqual(['torch 0 of 1', 'torch x1 still held']);
        expect(handOffMissing(state([unlit(0)]), h15)).toEqual([]);
        // Holding both: one lit torch held, one given, so the row gives all of it.
        expect(handOffPre(state([lit(0), unlit(1)]), h15, PARTNER)).toBe(true);
        expect(giveSpecs(state([lit(0), unlit(1)]), h15)).toEqual([{ item: 594, n: 1 }]);
        const sdk = new TradeServer(state([...filler(2), lit(2)]), [{ slot: 0, id: 596, name: 'Torch', count: 1 }]);
        const { step, reports } = await runStep(sdk, h15);
        expect(reports[0]).toMatchObject({ trade: 'swap', ok: true, gave: ['Torch x1'] });
        expect(sdk.state!.inventory.filter(i => i.name === 'Torch').map(i => i.id)).toEqual([596]);
        expect(step.postconditions(sdk.state!, {})).toBe(true);
    });

    test('H13: antipoison(*) all gives back every dose form held, one offer each', async () => {
        const h13 = idPlan('H13');
        const s = state([...filler(5), obj(5, 175, 'Antipoison(3)'), obj(6, 179, 'Antipoison(1)'), obj(7, 179, 'Antipoison(1)')]);
        expect(giveSpecs(s, h13)).toEqual([{ item: 175, n: 'all' }, { item: 179, n: 'all' }]);
        // Unmarked, the row stays one name pattern, which planOffers turns into one obj's offer.
        const named = giveSpecs(s, idPlan('H13n'));
        expect(named.map(g => String(g.item))).toEqual([String(itemPattern('antipoison'))]);
        expect(handOffPre(s, h13, PARTNER)).toBe(true);
        const sdk = new TradeServer(s, tradeItems([['Blood rune', 70]]));
        const { step, reports } = await runStep(sdk, h13);
        expect(reports[0]).toMatchObject({ trade: 'swap', ok: true });
        expect([...reports[0]!.gave].sort()).toEqual(['Antipoison(1) x2', 'Antipoison(3) x1']);
        expect(sdk.state!.inventory.some(i => /^Antipoison/.test(i.name))).toBe(false);
        expect(step.postconditions(sdk.state!, {})).toBe(true);
    });

    test("a <placeholder> is the module's: not traded, not checked, never a refusal", async () => {
        const h3 = idPlan('H3');
        expect(h3).toMatchObject({ receive: [], give: [], placeholders: ['<gem ring>'] });
        expect(handOffPre(state(filler(28)), h3, PARTNER)).toBe(true);
        expect(handOffMissing(state([]), h3)).toEqual([]);
        const sdk = new TradeServer(state(filler(2)), []);
        await drive(sdk, runHandOff(sdk, h3, PARTNER), 20);
        expect(sdk.sent).toEqual([]);
    });

    test("rs/158's fold-in 18 table in the id grammar: its H rows plan as the names did", () => {
        const read = (f: string) => parseLedger(readFileSync(join(import.meta.dir, '../tools/fixtures/slot-ledger', `${f}.md`), 'utf8')).rows.filter(r => /^H/.test(r.row));
        const plans = (rows: ReturnType<typeof read>) => rows.map(r => {
            try {
                planHandOff(r);
                return `${r.row}: plans`;
            } catch (e) {
                return (e as Error).message;
            }
        });
        const ids = read('fold-in-18-ids');
        expect(plans(ids)).toEqual(plans(read('fold-in-18')));
        const row = (id: string) => planHandOff(ids.find(r => r.row === id)!);
        expect(row('H13').give.filter(g => g.perObj).map(g => g.name)).toEqual(['antipoison']);
        expect(row('H14').give.filter(g => g.perObj).map(g => g.name)).toEqual(['prayer potion', 'magic potion']);
        expect(row('H21d').receive.filter(r => r.ids).map(r => [r.name, r.ids])).toEqual([['guam potion (unf)', [92]], ['irit potion (unf)', [102]]]);
        expect(row('H21d').placeholders).toEqual(['<platebody>']);
        expect(row('H15').receive.find(r => r.name === 'torch')!.ids).toEqual([596]);
    });
});

// ------------------------------------------------------------------ resume

describe('resume after a mid-trade logout', () => {
    const h12 = plan('H12');
    const BOW_XP = { name: 'Ranged', level: 50, experience: 101_333, baseLevel: 50 } as unknown as BotWorldState['skills'][number];
    // The run around the hand-off: a milestone before it, the hand-off, and the next milestone
    // (here, Ranged xp), whose done the hand-off takes as supersededBy.
    const nextDone = (o: { state: BotWorldState }) => o.state.skills.some(k => k.name === 'Ranged' && k.experience > 0);
    const before: Step<Record<string, never>> = { name: 'S14 before', logoutSafe: true, preconditions: () => true, postconditions: () => true, run: async () => {}, done: () => true };
    const after: Step<Record<string, never>> = { name: 'S15 after', logoutSafe: true, preconditions: () => true, postconditions: () => true, run: async () => {}, done: nextDone };
    const steps = [before, handOffStep<Record<string, never>>(h12, { partner: PARTNER, supersededBy: nextDone }), after];
    const where = async (s: BotWorldState) => {
        const p = await resolveResume(steps, new Observation(s), {});
        return [p.step, p.mode];
    };

    test('the session drops with the trade open: the server refunds, and the walk runs the hand-off again', async () => {
        const sdk = new TradeServer(state(filler(4), [wornItem('Mithril scimitar')]), tradeItems([['Magic shortbow'], ['Logs'], ['Logs']]), { logoutAt: 105 });
        const step = steps[1]!;
        await expect(drive(sdk, step.run(ctxOf(sdk)), 60)).rejects.toThrow(/H12 with Helper/);
        expect(sdk.sent.some(a => a.method === 'sendOfferItem')).toBe(true);
        // Back in: the scimitar went into the pack before the trade, and came back from the offer.
        const back = { ...sdk.state!, inGame: true };
        expect(back.inventory.some(i => i.name === 'Mithril scimitar')).toBe(true);
        expect(await where(back)).toEqual(['H12 hand-off', 'run']);
        // And the second attempt, from the pack this time, completes it.
        const again = new TradeServer(back, tradeItems([['Magic shortbow'], ['Logs'], ['Logs']]));
        await drive(again, step.run(ctxOf(again)), 200);
        expect(step.postconditions(again.state!, {})).toBe(true);
        expect(await where(again.state!)).toEqual(['S15 after', 'run']);
    });

    test('the trade landed but the bow is not on: in progress, and resume only wields it', async () => {
        const landed = state(pack(['Magic shortbow'], ['Logs', 2]));
        expect(await where(landed)).toEqual(['H12 hand-off', 'resume']);
        const sdk = new TradeServer(landed, []);
        await drive(sdk, steps[1]!.resume!(ctxOf(sdk)), 20);
        expect(sdk.sent.map(a => a.method)).toEqual(['sendUseItem']);
        expect(steps[1]!.postconditions(sdk.state!, {})).toBe(true);
    });

    test('once the next milestone is done, the hand-off stays done whatever its items became', async () => {
        const later = state(filler(3), [], { skills: [BOW_XP] });
        expect(steps[1]!.done!(new Observation(later), {})).toBe(true);
        expect(await where(later)).toEqual([null, 'finished']);
    });
});

describe('the completion record: done once marked, whatever the band after it consumed (rs/562)', () => {
    const h13 = plan('H13');
    const attemptIn = (attempt = 'a1') => new AttemptRecord(mkdtempSync(join(tmpdir(), 'handoffs-')), attempt);
    const recordIn = (attempt = 'a1') => attemptIn(attempt).handOffs;
    const PACKAGE = tradeItems([['Staff of fire'], ['Knife'], ['Blood rune', 70], ['Prayer potion(4)'], ['Prayer potion(4)']]);
    /** Past the trade, the band has spent blood runes and a prayer potion: the post-hand-off state no longer shows. */
    const spent = state(pack(['Knife'], ['Blood rune', 12], ['Prayer potion(4)']), [wornItem('Staff of fire')]);

    test('per attempt, on disk, marked once: a new process reads it, another attempt does not', () => {
        const r = attemptIn();
        expect(r.handOffs.has('H13')).toBe(false);
        r.handOffs.mark('H13', 120);
        r.handOffs.mark('H13', 130);
        const again = new AttemptRecord(r.dir, 'a1');
        expect(again.handOffs.has('H13')).toBe(true);
        expect(again.entries().map(e => [e.attempt, e.kind, e.key, e.tick])).toEqual([['a1', 'handoff', 'H13', 120]]);
        expect(new AttemptRecord(r.dir, 'a2').handOffs.has('H13')).toBe(false);
        expect(existsSync(join(r.dir, ATTEMPT_RECORD_FILE))).toBe(true);
    });

    test('run marks it once the post-hand-off state shows; then done holds after the band consumes', async () => {
        const r = recordIn();
        const step = handOffStep<Record<string, never>>(h13, { partner: PARTNER, record: r });
        const sdk = new TradeServer(state([...filler(5), item(5, 'Magic shortbow')]), PACKAGE);
        expect(step.done!(new Observation(spent), {})).toBe(false);
        await drive(sdk, step.run(ctxOf(sdk)), 200);
        expect(r.has('H13')).toBe(true);
        expect(step.done!(new Observation(spent), {})).toBe(true);
    });

    test('a failed trade marks nothing', async () => {
        const r = recordIn();
        const step = handOffStep<Record<string, never>>(h13, { partner: PARTNER, record: r, maxTicks: 10 });
        const sdk = new TradeServer(state([...filler(5), item(5, 'Magic shortbow')]), tradeItems([['Knife']]));
        await expect(drive(sdk, step.run(ctxOf(sdk)), 200)).rejects.toThrow(/^H13 with Helper: /);
        expect(r.has('H13')).toBe(false);
    });

    test('resume marks it once the pending wield is on', async () => {
        const r = recordIn();
        const step = handOffStep<Record<string, never>>(h13, { partner: PARTNER, record: r });
        const landed = state(pack(['Staff of fire'], ['Knife'], ['Blood rune', 70], ['Prayer potion(4)', 2]));
        expect(step.inProgress!(new Observation(landed), {})).toBe(true);
        const sdk = new TradeServer(landed, []);
        await drive(sdk, step.resume!(ctxOf(sdk)), 20);
        expect(r.has('H13')).toBe(true);
    });

    test('marked, but what it gave is held again (a rollback across the swap): not done, and the walk runs it again', async () => {
        const r = recordIn();
        r.mark('H13', 120);
        const step = handOffStep<Record<string, never>>(h13, { partner: PARTNER, record: r });
        const rolledBack = state(pack(['Magic shortbow'], ['Blood rune', 3]));
        expect(step.done!(new Observation(rolledBack), {})).toBe(false);
        const p = await resolveResume([step], new Observation(rolledBack), {});
        expect([p.step, p.mode]).toEqual(['H13 hand-off', 'run']);
    });
});

// ------------------------------------------------------------------ the manifest's rows

// The rows this module owns, read from STEP-MANIFEST.md's inventory ledger once it is on the
// branch (rs/158's fold-in 16). Each must plan as a hand-off.
const OWNED = ['H1', 'H13', 'H16', 'H18', 'H22', 'H23'];
const manifest = existsSync(MANIFEST) ? readFileSync(MANIFEST, 'utf8') : '';
const hasLedger = parseLedger(manifest).rows.length > 0;

describe('the manifest rows this module owns', () => {
    test.if(hasLedger)('each plans as a hand-off', () => {
        for (const id of OWNED) expect(() => handOffFrom(manifest, id)).not.toThrow();
    });
});

describe('a cue-served hand-off (the cannon holder): the cue, the partner in sight, its request, the whole row', () => {
    const CANNON = `
| row | in | out | equip | needAtStart | source |
|---|---|---|---|---|---|
| H11 | cannon base x1 [u]; cannonball x100 [s]; mithril scimitar x1 [u] | - | - | 3 | fixture (r) |
`;
    const h11 = handOffFrom(CANNON, 'H11');
    const row = tradeItems([['Cannon base'], ['Cannonball', 100], ['Mithril scimitar']]);
    const request = (tick: number) => ({ type: 4, text: 'Helper wishes to trade with you.', tick, sender: PARTNER, fromSelf: false });
    const arrive = (at: number) => (s: BotWorldState): Partial<BotWorldState> => (s.tick === at ? { nearbyPlayers: partnerInView, gameMessages: [...s.gameMessages, request(at)] } : {});

    test('the partner need not be in view at arrival; the cue opens first, the row arrives whole', async () => {
        const sdk = new TradeServer(state([], [], { tick: 10, nearbyPlayers: [] }), row);
        const opened: string[] = [];
        const reports: HandOffReport[] = [];
        const step = handOffStep<Record<string, never>>(h11, {
            partner: PARTNER, onReport: r => reports.push(r),
            cue: { scope: { step: 'S14', family: 'cannon' }, open: async () => void opened.push(`open@${sdk.state!.tick}`), waitTicks: 50 },
        });
        expect(step.preconditions(sdk.state!, {})).toBe(true);
        expect(handOffPre(sdk.state!, h11, PARTNER)).toContain('not in view');
        await drive(sdk, step.run(ctxOf(sdk)), 300, arrive(16));
        expect(opened).toEqual(['open@10']);
        expect(sdk.tradeClicks[0]).toBeGreaterThanOrEqual(16);
        expect(handOffMissing(sdk.state!, h11)).toEqual([]);
        expect(reports[0]?.received.sort()).toEqual(['Cannon base x1', 'Cannonball x100', 'Mithril scimitar x1']);
    });

    test('runHandOffOnCue reports the request standing at the click and the ticks to arrival', async () => {
        const sdk = new TradeServer(state([], [], { tick: 10, nearbyPlayers: [] }), row);
        const r = await drive(sdk, runHandOffOnCue(ctxOf(sdk), h11, PARTNER, { scope: { step: 'S14', family: 'cannon' }, open: async () => {}, waitTicks: 50 }), 300, arrive(14));
        // drive's patch at tick 14 lands in tick 15's state: the cue at 10, the partner in sight at 15.
        expect([r.ok, r.standingAtClick, r.arriveTicks]).toEqual([true, true, 5]);
    });

    test("a holder offering the set and balls without the row's extras is never accepted", async () => {
        const sdk = new TradeServer(state([], [], { tick: 10, nearbyPlayers: [] }), tradeItems([['Cannon base'], ['Cannonball', 100]]));
        const step = handOffStep<Record<string, never>>(h11, { partner: PARTNER, maxTicks: 20, cue: { scope: { step: 'S14', family: 'cannon' }, open: async () => {}, waitTicks: 50 } });
        await expect(drive(sdk, step.run(ctxOf(sdk)), 400, arrive(12))).rejects.toThrow('H11 with Helper');
        expect(handOffMissing(sdk.state!, h11)).toContain('mithril scimitar 0 of 1');
    });

    test('a partner that never comes: refused with the reason after the give-up bound', async () => {
        const sdk = new TradeServer(state([], [], { tick: 10, nearbyPlayers: [] }), row);
        const step = handOffStep<Record<string, never>>(h11, { partner: PARTNER, cue: { scope: { step: 'S27', family: 'cannon' }, open: async () => {}, waitTicks: 8 } });
        await expect(drive(sdk, step.run(ctxOf(sdk)), 100)).rejects.toThrow('did not come into sight within 8 ticks of the S27/cannon cue');
        expect(sdk.tradeClicks).toEqual([]);
    });
});

describe('a delivery carrier that comes after SCORED: the meeting, the cue\'s ready gate, then the trade (rs/603)', () => {
    const TILE = { x: 3222, z: 3222, level: 0 };
    const MEETING: Meeting = { tile: TILE, within: 12 };
    const SCORED = 'Scored Name';
    const RUN = 'a2-20261024';
    const H1_ROW = tradeItems([['Staff of water'], ['Cosmic rune', 60], ['Air rune', 81], ['Law rune', 1]]);
    const player = (x: number, z: number, level = 0) => ({ name: SCORED, x, z, worldX: x, worldZ: z, level }) as unknown as PlayerState;
    const at = (inv: InventoryItem[] = pack(['Tinderbox']), x = TILE.x, z = TILE.z, level = 0) => state(inv, [], { tick: 10, player: player(x, z, level), nearbyPlayers: [] });

    /** A carrier stand-in (mule.ts publishDelivery): travelling to the prepared stand until tick `readyAt`, then ready on it. */
    function carrier(sdk: TradeServer, dir: string, readyAt: number): () => void {
        return sdk.onStateUpdate(s => {
            const c = readMulePreparation(dir, PARTNER);
            if (c?.op !== 'prepare') return;
            const ready = s.tick >= readyAt;
            writeMuleReady(dir, {
                runId: c.runId, account: PARTNER, row: c.row, session: c.session, receiverHash: c.receiverHash,
                phase: ready ? 'ready' : 'travel', tile: { ...TILE }, staged: true, preparationSeq: c.seq, tick: s.tick, ms: Date.now(),
            });
        });
    }

    /** H1 as the chain runs a placed mule row: the hand-off inside its {H1, mule} cue, on the run's keeper bound to the run owner. */
    function rig(o: { meeting: boolean; readyAt: number; inView?: boolean }) {
        const dir = mkdtempSync(join(tmpdir(), 'handoff-meeting-'));
        const sdk = new TradeServer({ ...at(), ...(o.inView ? { nearbyPlayers: partnerInView } : {}) }, H1_ROW);
        const keeper = new CueKeeper(dir, SCORED, new DeliveryOwner(dir, RUN, SCORED, [{ row: 'H1', account: PARTNER, at: TILE }]));
        const offs = [keeper.attach(sdk), carrier(sdk, dir, o.readyAt)];
        const reports: HandOffReport[] = [];
        const inner = handOffStep<Record<string, never>>(plan('H1'), { partner: PARTNER, onReport: r => reports.push(r), ...(o.meeting ? { meeting: MEETING } : {}) });
        const step = muleCued(tag('S01', 'handoff', inner), 'H1', keeper);
        return { sdk, step, reports, done: () => offs.forEach(f => f()) };
    }
    /** The carrier comes into SCORED's view on tick `tick` (drive's patch lands in the next tick's state). */
    const arrives = (tick: number) => (s: BotWorldState): Partial<BotWorldState> => (s.tick >= tick - 1 && !s.nearbyPlayers.length ? { nearbyPlayers: partnerInView } : {});

    test('preconditions: SCORED within reach of the stand on its level, and not already holding some of everything the row brings', () => {
        const h1 = plan('H1');
        const pre = (s: BotWorldState) => handOffPre(s, h1, PARTNER, { meeting: MEETING });
        expect(pre(at())).toBe(true);
        expect(pre(at(undefined, TILE.x + 12, TILE.z - 12))).toBe(true);
        expect(pre(at(undefined, TILE.x + 13, TILE.z))).toBe('H1: SCORED at 3235,3222,0 is not within 12 of the meeting tile 3222,3222,0');
        expect(pre(at(undefined, TILE.x, TILE.z, 1))).toBe('H1: SCORED at 3222,3222,1 is not within 12 of the meeting tile 3222,3222,0');
        expect(pre({ ...at(), player: null })).toBe('H1: the state carries no player to place at the meeting');
        // Some of what the row brings, held before it (runes left from an earlier step), is no refusal; some of all of it is.
        expect(pre(at(pack(['Tinderbox'], ['Air rune', 25])))).toBe(true);
        expect(pre(at(pack(['Staff of water'], ['Cosmic rune', 59], ['Air rune', 81], ['Law rune', 1])))).toBe('H1: already holds some of everything the row brings (staff of water, cosmic rune, air rune, law rune): its trade has landed');
        // The partner-in-view rule is unchanged for a row without a meeting.
        expect(handOffPre(at(), h1, PARTNER)).toContain('Helper is not in view');
    });

    test('a carrier 60 ticks late: the step starts at the meeting with nobody in view, the cue waits for its readiness, then the row is served', async () => {
        const r = rig({ meeting: true, readyAt: 70 });
        try {
            expect(r.step.preconditions(r.sdk.state!, {})).toBe(true);
            // Today's rule refused here and ended the attempt.
            expect(handOffPre(r.sdk.state!, plan('H1'), PARTNER)).toContain('not in view');
            await drive(r.sdk, r.step.run(ctxOf(r.sdk)), READY_MAX_TICKS, arrives(70));
            expect(r.sdk.tradeClicks).toHaveLength(1);
            expect(r.sdk.tradeClicks[0]!).toBeGreaterThanOrEqual(70);
            expect(r.sdk.tradeClicks[0]!).toBeLessThan(80);
            expect(r.reports[0]).toMatchObject({ id: 'H1', trade: 'receive', ok: true });
            expect(handOffMissing(r.sdk.state!, plan('H1'))).toEqual([]);
        } finally {
            r.done();
        }
    });

    test('a carrier that never readies: refused at the gate\'s bound with its status line, nothing clicked', async () => {
        const r = rig({ meeting: true, readyAt: Infinity });
        try {
            expect(r.step.preconditions(r.sdk.state!, {})).toBe(true);
            await expect(drive(r.sdk, r.step.run(ctxOf(r.sdk)), READY_MAX_TICKS + 50)).rejects.toThrow(
                new RegExp(`^H1: carrier Helper was not ready within ${READY_MAX_TICKS} ticks \\(maxTicks\\): H1 travel, staged true, preparation \\d+ of \\d+$`),
            );
            expect(r.sdk.tradeClicks).toEqual([]);
            expect(r.sdk.sent.some(a => a.method === 'sendTradeRequest')).toBe(false);
        } finally {
            r.done();
        }
    });

    test('a ready carrier that does not show: refused after the sight bound, nothing clicked', async () => {
        const r = rig({ meeting: true, readyAt: 0 });
        try {
            await expect(drive(r.sdk, r.step.run(ctxOf(r.sdk)), 100)).rejects.toThrow('H1: Helper did not come into sight within 10 ticks at the meeting tile 3222,3222,0');
            expect(r.sdk.tradeClicks).toEqual([]);
        } finally {
            r.done();
        }
    });

    test('an on-time carrier: the meeting row sends exactly the actions, at the same ticks, that the partner-in-view row sends', async () => {
        const run = async (meeting: boolean) => {
            const r = rig({ meeting, readyAt: 0, inView: true });
            try {
                expect(r.step.preconditions(r.sdk.state!, {})).toBe(true);
                await drive(r.sdk, r.step.run(ctxOf(r.sdk)), 300);
                return { actions: r.sdk.sent.map(a => [a.method, ...a.args]), clicks: r.sdk.tradeClicks, ok: r.reports[0]?.ok, end: r.sdk.state!.tick };
            } finally {
                r.done();
            }
        };
        const today = await run(false);
        const now = await run(true);
        expect(today.ok).toBe(true);
        expect(today.actions.length).toBeGreaterThan(0);
        expect(now).toEqual(today);
    });
});

describe('rollbackWitnesses: what the record clause reads as a rollback (rs/577)', () => {
    const text = readFileSync(MANIFEST, 'utf8');
    const rows = parseLedger(text).rows;
    const later = (id: string) => rows.slice(rows.findIndex(r => r.row === id) + 1);
    const placed = (row: string) => PLACEMENT[row] !== undefined;
    const witnesses = (id: string) => rollbackWitnesses(handOffFrom(text, id), later(id), placed).map(w => [w.give.name, w.until]);

    test("H13: S18's rune arrows and coins are no evidence; H23's shortbow and superantipoison wait for H23; the rest always", () => {
        expect(witnesses('H13')).toEqual([
            ['magic shortbow', ['H23']], ['amulet of magic', []], ['diamond', []], ['superantipoison', ['H23']], ['fire rune', []], ['khazard helmet', []], ['khazard armour', []],
        ]);
    });

    test("H14's knife waits for H18 and H23 (rs/562 A's rollback case); H11r's cannon for H23; with nothing after it, every give and drop", () => {
        expect(witnesses('H14')).toEqual([['knife', ['H18', 'H23']]]);
        expect(witnesses('H11r').every(([, until]) => (until as string[]).join() === 'H23')).toBe(true);
        const h13 = handOffFrom(text, 'H13');
        expect(rollbackWitnesses(h13, [], placed).map(w => w.give.name)).toEqual([...h13.give, ...h13.drop].map(g => g.name));
    });

    test('a recorded hand-off with a returned item held: done only with the witnesses, and H14 only once H18 is recorded', () => {
        const record = new AttemptRecord(mkdtempSync(join(tmpdir(), 'handoff-witness-')), 'attempt-1').handOffs;
        const step = (id: string, w: boolean) => handOffStep(handOffFrom(text, id), { partner: 'p', record, ...(w ? { witnesses: rollbackWitnesses(handOffFrom(text, id), later(id), placed) } : {}) });
        const holding = (id: string, name: string, count: number) => {
            const g = handOffFrom(text, id).give.find(x => x.name === name)!;
            return new Observation(baseState({ inventory: [{ slot: 0, id: g.ids?.[0] ?? 995, name: name[0]!.toUpperCase() + name.slice(1), count, optionsWithIndex: [] }] }));
        };
        record.mark('H13', 1);
        expect(step('H13', false).done!(holding('H13', 'coins', 22450), {})).toBe(false);
        expect(step('H13', true).done!(holding('H13', 'coins', 22450), {})).toBe(true);
        record.mark('H14', 2);
        expect(step('H14', true).done!(holding('H14', 'knife', 1), {})).toBe(false);
        record.mark('H18', 3);
        expect(step('H14', true).done!(holding('H14', 'knife', 1), {})).toBe(true);
    });
});
