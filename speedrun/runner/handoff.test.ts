import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import type { BotWorldState, InventoryItem, TradeItem } from '../../sdk/types';
import { baseState, drive, FakeSdk, type SentAction } from '../lib/fake-sdk';
import { TickLog } from '../lib/ticks';
import { MANIFEST, parseLedger } from '../tools/slot-ledger';
import {
    handOffFrom, handOffMissing, handOffPre, handOffStep, itemPattern, planHandOff, runHandOff, toUnequip, tradeKind, tradeLanded,
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
        const stack = STACKS.test(t.name) ? out.find(i => i.id === t.id) : undefined;
        if (stack) out[out.indexOf(stack)] = { ...stack, count: stack.count + t.count };
        else if (STACKS.test(t.name)) out.push(item(free(), t.name, t.count));
        else for (let k = 0; k < t.count; k++) out.push(item(free(), t.name));
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

    test('every top-up already met: no trade at all', async () => {
        const sdk = new TradeServer(state(pack(['Shark', 8])), []);
        const reports: HandOffReport[] = [];
        await drive(sdk, runHandOff(sdk, h10, PARTNER, { onReport: r => reports.push(r) }), 20);
        expect(sdk.sent).toEqual([]);
        expect(reports[0]).toMatchObject({ ok: true, ticks: 0 });
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
