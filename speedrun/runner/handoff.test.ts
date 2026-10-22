import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { BotWorldState, InventoryItem, TradeItem } from '../../sdk/types';
import { baseState, drive, FakeSdk, type SentAction } from '../lib/fake-sdk';
import { noteOf } from '../lib/items';
import { TickLog } from '../lib/ticks';
import { MANIFEST, parseLedger } from '../tools/slot-ledger';
import {
    giveSpecs, handOffFrom, handOffMissing, handOffPre, handOffRoom, handOffStep, itemPattern, loadHandOff, planHandOff, runHandOff, toUnequip, tradeKind, tradeLanded,
    type HandOffPlan, type HandOffReport,
} from './handoff';
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
`;

const plan = (id: string) => handOffFrom(TABLE, id);
const PARTNER = 'Helper';

// ------------------------------------------------------------------ fixtures

const IDS: Record<string, number> = {
    'Staff of water': 1383, 'Cosmic rune': 564, 'Air rune': 556, 'Law rune': 563, 'Staff of fire': 1387, Knife: 946, 'Blood rune': 565,
    'Prayer potion(4)': 2434, 'Magic shortbow': 861, 'Cannon base': 6, Cannonball: 2, 'Mithril scimitar': 1329, Logs: 1511, Coins: 995,
    Shark: 385, Tinderbox: 590, 'Bronze axe': 1351,
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

/** Put items into the first free inventory slots, merging stacks. */
function addTo(inv: InventoryItem[], items: readonly TradeItem[]): InventoryItem[] {
    const out = [...inv];
    const free = () => { for (let s = 0; ; s++) if (!out.some(i => i.slot === s)) return s; };
    for (const t of items) {
        const stack = stacks(t) ? out.find(i => i.id === t.id) : undefined;
        if (stack) out[out.indexOf(stack)] = { ...stack, count: stack.count + t.count };
        else if (stacks(t)) out.push({ ...item(free(), t.name, t.count), id: t.id });
        else for (let k = 0; k < t.count; k++) out.push({ ...item(free(), t.name), id: t.id });
    }
    return out;
}

/**
 * The server and a partner whose request stands (the hand-off giver on its tile): our trade click
 * opens the screens with its offer up and accepted; an offer of ours resets both accepts and the
 * partner re-accepts two ticks later; the confirm accept swaps the items. Equip clicks land a tick
 * later, a wield displacing the worn weapon into the pack. `logoutAt`: the session drops on that
 * tick with the trade open, and the server refunds our offer.
 */
class TradeServer extends FakeSdk {
    private queue: Array<{ due: number; fx: (s: BotWorldState) => Partial<BotWorldState> }> = [];
    tradeClicks: number[] = [];
    unequipTicks: number[] = [];

    constructor(s: BotWorldState, private theirs: TradeItem[], private opts: { logoutAt?: number } = {}) {
        super(s);
        this.onSend = a => this.serve(a);
    }

    sendCloseModal() { return this.sendAction({ method: 'sendCloseModal', args: [] }); }

    private later(fx: (s: BotWorldState) => Partial<BotWorldState>, d = 1) {
        this.queue.push({ due: this.state!.tick + d, fx });
    }

    private serve(a: SentAction) {
        const s = this.state!;
        const toConfirm = (tr: NonNullable<BotWorldState['trade']>) => ({ trade: { ...tr, screen: 'confirm' as const, myAccepted: false, partnerAccepted: true } });
        switch (a.method) {
            case 'sendTradeRequest':
                this.tradeClicks.push(s.tick);
                this.later(cur => ({
                    gameMessages: [...cur.gameMessages, { type: 0, text: 'Sending trade offer...', tick: cur.tick, sender: '', fromSelf: false }],
                    trade: cur.trade?.isOpen ? undefined : { isOpen: true, screen: 'offer', partner: PARTNER, myOffer: [], theirOffer: this.theirs, myAccepted: false, partnerAccepted: true },
                }));
                break;
            case 'sendOfferItem': {
                const slot = a.args[0] as number;
                this.later(cur => {
                    const it = cur.inventory.find(i => i.slot === slot);
                    if (!it || !cur.trade?.isOpen) return {};
                    const moved = cur.inventory.filter(i => i.id === it.id).reduce((n, i) => n + i.count, 0);
                    return { inventory: cur.inventory.filter(i => i.id !== it.id), trade: { ...cur.trade, myOffer: [...cur.trade.myOffer, { slot: 0, id: it.id, name: it.name, count: moved }], myAccepted: false, partnerAccepted: false } };
                });
                this.later(cur => {
                    const tr = cur.trade;
                    if (!tr?.isOpen || tr.screen !== 'offer') return {};
                    return tr.myAccepted ? toConfirm(tr) : { trade: { ...tr, partnerAccepted: true } };
                }, 2);
                break;
            }
            case 'sendAcceptTrade':
                this.later(cur => {
                    const tr = cur.trade;
                    if (!tr?.isOpen) return {};
                    if (tr.screen === 'offer') return tr.partnerAccepted ? toConfirm(tr) : { trade: { ...tr, myAccepted: true } };
                    return { trade: undefined, inventory: addTo(cur.inventory, tr.theirOffer), gameMessages: [...cur.gameMessages, { type: 0, text: 'Accepted trade.', tick: cur.tick, sender: '', fromSelf: false }] };
                });
                break;
            case 'sendDeclineTrade':
                this.later(cur => (cur.trade?.isOpen ? { trade: undefined, inventory: addTo(cur.inventory, cur.trade.myOffer) } : {}));
                break;
            case 'sendUseEquipmentItem': {
                this.unequipTicks.push(s.tick);
                const slot = a.args[0] as number;
                this.later(cur => {
                    const e = cur.equipment.find(x => x.slot === slot);
                    return e ? { equipment: cur.equipment.filter(x => x !== e), inventory: addTo(cur.inventory, [{ slot: 0, id: e.id, name: e.name, count: 1 }]) } : {};
                });
                break;
            }
            case 'sendUseItem': {
                const slot = a.args[0] as number;
                this.later(cur => {
                    const it = cur.inventory.find(i => i.slot === slot);
                    if (!it) return {};
                    const displaced = cur.equipment.filter(e => WEAPON.test(e.name) && WEAPON.test(it.name));
                    const inventory = addTo(cur.inventory.filter(i => i !== it), displaced.map(e => ({ slot: 0, id: e.id, name: e.name, count: 1 })));
                    return { inventory, equipment: [...cur.equipment.filter(e => !displaced.includes(e)), { ...wornItem(it.name), id: it.id }] };
                });
                break;
            }
        }
    }

    override tick(patch: Partial<BotWorldState> | ((s: BotWorldState) => Partial<BotWorldState>) = {}): BotWorldState {
        return this.push(cur => {
            let next: BotWorldState = { ...cur, tick: cur.tick + 1, ...(typeof patch === 'function' ? patch(cur) : patch) };
            if (this.opts.logoutAt !== undefined && next.tick >= this.opts.logoutAt) {
                // The session is gone: the server closes the trade and refunds our offer.
                const refund = next.trade?.isOpen ? next.trade.myOffer : [];
                this.queue = [];
                return { ...next, trade: undefined, inventory: addTo(next.inventory, refund), inGame: false };
            }
            for (let i = 0; i < this.queue.length; ) {
                if (this.queue[i]!.due <= next.tick) next = { ...next, ...this.queue.splice(i, 1)[0]!.fx(next) };
                else i++;
            }
            return next;
        });
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
        expect(() => plan('H99')).toThrow(/bronze axe \(drop\) is not given in the trade/);
        expect(() => plan('H98')).toThrow(/tree items x\? has no count/);
        expect(() => plan('H77')).toThrow(/no ledger row H77/);
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
        expect(reports[0]).toMatchObject({ trade: 'swap', ok: true, gave: ['Magic shortbow x1'] });
        expect(sdk.tradeClicks).toHaveLength(1);
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
