import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { BotWorldState, InventoryItem, TradeItem } from '../../sdk/types';
import { baseState, FakeSdk, flush, type SentAction } from '../lib/fake-sdk';
import { fakeClock, microtasks, peek, useFakeTicks } from '../lib/fake-ticks';
import { TickLog } from '../lib/ticks';
import { levelForXp, xpForLevel } from '../lib/xp';
import { Observation, resolveResume } from '../runner/resume';
import { runSteps, type RunnerSession } from '../runner/step';
import {
    ANVIL, ANVIL_LOC, barRoom, barsIn, barTotals, BARS, bestProduct, otherItems, chooseMake, countsOf, firstAnnouncement, giveBackItems, handBack, heldSegments, itemXp, milestones, openBooth,
    PLAN_DEFAULTS, PRODUCTS, resolveOptions, routePlan, SCORED_TILE, SMITHING_IF, stepPlan, steps, type AnvilPlanMsg, type Bar, type InventoryReport,
} from './smithing';

// ---------------------------------------------------------------- the content tables

const CONTENT = join(import.meta.dir, '../../server/content/scripts/skill_smithing/configs/smithing');

interface Row { id: string; level: number; bar: string; bars: number; com: number; slot: number }

/** Every anvil item, read the way smithing-trade.ts reads them (dbrow + inv). */
function contentRows(): Row[] {
    const slotOf = new Map<string, { com: number; slot: number }>();
    let col = '';
    for (const l of readFileSync(join(CONTENT, 'smithing.inv'), 'utf8').split('\n')) {
        const h = l.match(/^\[smithing_[a-z]+(\d)\]$/);
        if (h) { col = h[1]!; continue; }
        if (l.startsWith('[')) { col = ''; continue; }
        const m = l.match(/^stock(\d+)=(\w+),/);
        if (m && col) slotOf.set(m[2]!, { com: 1119 + Number(col) - 1, slot: Number(m[1]) - 1 });
    }
    const rows: Row[] = [];
    let cur: Record<string, string> = {};
    let name = '';
    const flushRow = () => {
        const pos = slotOf.get(name);
        if (cur.bar && pos && !/dart_tip|claws/.test(name)) rows.push({ id: name, level: Number(cur.levelrequired), bar: cur.bar, bars: Number(cur.bar_amount), ...pos });
    };
    for (const l of readFileSync(join(CONTENT, 'smithing.dbrow'), 'utf8').split('\n')) {
        const h = l.match(/^\[(\w+)\]$/);
        if (h) { flushRow(); cur = {}; name = h[1]!; continue; }
        const m = l.match(/^data=(\w+),(.*)$/);
        if (m) cur[m[1]!] = m[2]!;
    }
    flushRow();
    return rows;
}

function xpPerBar(): Record<string, number> {
    const out: Record<string, number> = {};
    let cur: Record<string, string> = {};
    const flushBar = () => { if (cur.namedobj) out[cur.namedobj] = Number(cur.xpperbar) / 10; };
    for (const l of readFileSync(join(CONTENT, 'smithing.struct'), 'utf8').split('\n')) {
        if (l.startsWith('[')) { flushBar(); cur = {}; }
        const m = l.match(/^param=(\w+),(.*)$/);
        if (m) cur[m[1]!] = m[2]!;
    }
    flushBar();
    return out;
}

describe('content', () => {
    test('PRODUCTS and BARS match smithing.dbrow, smithing.inv and smithing.struct', () => {
        const rows = contentRows();
        for (const p of PRODUCTS) expect(rows.find(r => r.id === p.id)).toEqual({ id: p.id, level: p.level, bar: p.bar, bars: p.bars, com: p.com, slot: p.slot });
        const xp = xpPerBar();
        for (const [bar, b] of Object.entries(BARS)) expect(b.base).toBe(xp[bar]!);
    });

    test('the best item at every level 1-98, among all anvil items, is in PRODUCTS (trade and bank overheads)', () => {
        const xp = xpPerBar();
        const all = contentRows().filter(r => r.bar in BARS).map(r => ({ ...r, name: r.id, bar: r.bar as Bar }));
        for (const overhead of [7, 17]) {
            const c = { ...PLAN_DEFAULTS, overhead };
            for (let level = 1; level < 99; level++) {
                const best = bestProduct(level, c, all)!;
                const ours = bestProduct(level, c)!;
                // Equivalent, not necessarily the same row: the bronze mace is the bronze dagger again (1 bar, 12.5).
                expect([ours.bar, ours.bars]).toEqual([best.bar, best.bars]);
            }
        }
    });
});

// ---------------------------------------------------------------- the plan

describe('routePlan', () => {
    const plan = routePlan(0);

    test('from level 1: 31 inventories, the mixed one first, the manifest bar list', () => {
        expect(plan).toHaveLength(31);
        expect(plan[0]!.segs.map(s => [s.product.id, s.count])).toEqual([
            ['bronze_dagger', 2], ['bronze_scimitar', 1], ['bronze_warhammer', 1], ['bronze_2h_sword', 1], ['bronze_platebody', 1], ['iron_warhammer', 2], ['iron_2h_sword', 1],
        ]);
        expect(plan[1]!.segs.map(s => [s.product.id, s.count])).toEqual([['iron_platebody', 5]]);
        expect(plan[2]!.segs.map(s => [s.product.id, s.count])).toEqual([['iron_platebody', 1], ['steel_platebody', 4]]);
        expect(plan[30]!.segs.map(s => [s.product.id, s.count])).toEqual([['adamant_platebody', 4]]);
        // STEP-MANIFEST.md entry 10 preconditions: 15 bronze, 39 iron, 95 steel, 280 mithril, 340 adamant.
        expect(barTotals(plan)).toEqual({ bronze_bar: 15, iron_bar: 39, steel_bar: 95, mithril_bar: 280, adamantite_bar: 340 });
        expect(levelForXp(plan[0]!.xp)).toBe(34);
        for (const inv of plan) expect(Object.values(inv.bars).reduce((a, n) => a + n!, 0)).toBeLessThanOrEqual(27);
    });

    test('milestones climb to level 99 exactly', () => {
        const marks = milestones(plan, 0, PLAN_DEFAULTS);
        expect(marks).toHaveLength(31);
        for (let i = 1; i < marks.length; i++) expect(marks[i]!).toBeGreaterThan(marks[i - 1]!);
        expect(marks[30]).toBe(xpForLevel(99));
        expect(marks[0]).toBe(Math.floor(plan[0]!.xp));
    });

    test('re-planning from a milestone gives the rest of the plan (a resume lines up with the steps)', () => {
        const marks = milestones(plan, 0, PLAN_DEFAULTS);
        const rest = routePlan(marks[9]!);
        expect(rest.map(i => Object.entries(i.bars))).toEqual(plan.slice(10).map(i => Object.entries(i.bars)));
    });

    test('without adamantite, mithril platebodies run on past 88 (SUPPLIES.md H21a fallback)', () => {
        const c = { ...PLAN_DEFAULTS, bars: ['bronze_bar', 'iron_bar', 'steel_bar', 'mithril_bar'] as Bar[] };
        const totals = barTotals(routePlan(0, c));
        expect(totals.adamantite_bar).toBeUndefined();
        expect(totals.mithril_bar! - 280).toBeGreaterThan(400);
    });

    test('from level 99 there is nothing to make; untilLevel caps the plan', () => {
        expect(routePlan(xpForLevel(99))).toEqual([]);
        const short = routePlan(0, { ...PLAN_DEFAULTS, untilLevel: 48 });
        expect(levelForXp(short.reduce((a, i) => a + i.xp, 0))).toBeGreaterThanOrEqual(48);
    });
});

describe('helpers', () => {
    const inv = (slot: number, name: string, count = 1, id = slot + 100): InventoryItem => ({ slot, id, name, count, optionsWithIndex: [] });

    test('chooseMake: one click per run of a bar; make-1 only when a later item shares the bar', () => {
        expect(chooseMake(5, true)).toBe(5);
        expect(chooseMake(4, true)).toBe(5);
        expect(chooseMake(2, false)).toBe(1);
        expect(chooseMake(1, true)).toBe(1);
        expect(chooseMake(7, true)).toBe(10);
        expect(chooseMake(7, false)).toBe(5);
    });

    test('handBack takes products and unwanted bars, never the hammer, wanted bars or other kit', () => {
        const items = [inv(0, 'Hammer'), inv(1, 'Adamant platebody'), inv(2, 'Adamant platebody'), inv(3, 'Iron bar'), inv(4, 'Mithril bar'), inv(5, 'Law rune', 30)];
        expect(handBack(items, { mithril_bar: 25 }, new Map()).map(i => i.name)).toEqual(['Adamant platebody', 'Adamant platebody', 'Iron bar']);
        expect(barRoom(baseState({ inventory: items }), 27, new Map())).toBe(26);
        expect(barRoom(baseState({ inventory: [] }), 27, new Map())).toBe(27);
    });

    test('handBack returns only what was made since the baseline: an arriving bronze dagger stays', () => {
        const start = [inv(0, 'Bronze dagger', 1, 1205), inv(1, 'Bronze axe', 1, 1351), inv(2, 'Bronze bar', 1, 2349)];
        const baseline = countsOf(start);
        // Nothing made yet: nothing goes, and the dagger and the arriving bar take slots.
        expect(handBack(start, {}, baseline)).toEqual([]);
        expect(barRoom(baseState({ inventory: start }), 27, baseline)).toBe(28 - 3 - 1);
        // Two daggers made: two go, the arriving one stays.
        const later = [...start, inv(3, 'Bronze dagger', 1, 1205), inv(4, 'Bronze dagger', 1, 1205)];
        expect(handBack(later, {}, baseline).map(i => i.slot)).toEqual([3, 4]);
        // A stacked item straddling the baseline goes with its excess count only.
        const stack = [inv(0, 'Iron bar', 30, 2351)];
        expect(handBack(stack, {}, new Map([[2351, 25]])).map(i => i.count)).toEqual([5]);
    });

    test('heldSegments: what held bars make at the live level', () => {
        const s = baseState({ skills: [{ name: 'Smithing', level: 70, baseLevel: 70, experience: xpForLevel(70) }], inventory: Array.from({ length: 12 }, (_, i) => inv(i, 'Mithril bar', 1, 2359)) });
        expect(heldSegments(s, PLAN_DEFAULTS).map(g => [g.product.id, g.count])).toEqual([['mithril_platebody', 2]]);
    });

    test('firstAnnouncement: seq 0 for the live xp, with the hammer when none is held', () => {
        const s = baseState({ skills: [{ name: 'Smithing', level: 1, baseLevel: 1, experience: 0 }] });
        expect(firstAnnouncement(s, 'run/1')).toEqual({ session: 'run/1', seq: 0, give: { bronze_bar: 15, iron_bar: 9, hammer: 1 } });
        const at99 = baseState({ skills: [{ name: 'Smithing', level: 99, baseLevel: 99, experience: xpForLevel(99) }] });
        expect(firstAnnouncement(at99, 'run/1')).toBeNull();
    });

    test('the planner never picks an item over the inventory cap', () => {
        const plan = routePlan(xpForLevel(20), { ...PLAN_DEFAULTS, cap: 3, untilLevel: 25, bars: ['bronze_bar'] });
        expect(plan.length).toBeGreaterThan(0);
        for (const inv of plan) expect(inv.bars.bronze_bar).toBeLessThanOrEqual(3);
        expect(plan[0]!.segs[0]!.product.id).toBe('bronze_2h_sword');
    });

    test('firstAnnouncement with bars held: seq 0 is the inventory after the held bars are made', () => {
        const plan = { cap: 6, bars: ['bronze_bar' as const] };
        const held = [inv(0, 'Hammer', 1, 2347), ...Array.from({ length: 4 }, (_, i) => inv(1 + i, 'Bronze bar', 1, 2349))];
        const s = baseState({ skills: [{ name: 'Smithing', level: 1, baseLevel: 1, experience: 0 }], inventory: held });
        // The 4 held bars are the plan's first inventory (2 daggers and a scimitar to 11); seq 0 is the next, 6 bars.
        expect(firstAnnouncement(s, 'run/1', { untilLevel: 30, plan })).toEqual({ session: 'run/1', seq: 0, give: { bronze_bar: 6 } });
    });

    test('resolveOptions: bank supply ranks items on the bank turnaround', () => {
        expect(resolveOptions({ supply: 'bank' }).plan.overhead).toBe(17);
        expect(resolveOptions().plan.overhead).toBe(7);
        expect(() => resolveOptions({ untilLevel: 100 })).toThrow();
    });
});

// ---------------------------------------------------------------- steps and the resume walk

const atAnvil = (xp: number, inventory: InventoryItem[] = []) => baseState({
    skills: [{ name: 'Smithing', level: levelForXp(xp), baseLevel: levelForXp(xp), experience: xp }],
    player: { name: 'scored', worldX: SCORED_TILE.x, worldZ: SCORED_TILE.z, level: 0 } as BotWorldState['player'],
    inventory,
});

describe('steps', () => {
    const list = steps({ giver: 'anvilhelper' });
    const { marks } = stepPlan();

    test('one logout-safe milestone per inventory, named by S25a and the inventory', () => {
        expect(list).toHaveLength(31);
        expect(list[0]!.name).toBe('S25a smithing 01/31 2 bronze dagger + 1 bronze scimitar + 1 bronze warhammer + 1 bronze 2h sword + 1 bronze platebody + 2 iron warhammer + 1 iron 2h sword');
        expect(list[30]!.name).toBe('S25a smithing 31/31 4 adamant platebody');
        expect(new Set(list.map(s => s.name)).size).toBe(31);
        expect(list.every(s => s.logoutSafe && s.done && s.inProgress && s.resume)).toBe(true);
    });

    test('done by xp, true from the milestone on; passed steps admit any state', () => {
        const at = (xp: number) => ({ state: atAnvil(xp), probed: {} });
        expect(list[5]!.done!(at(marks[5]! - 1), {})).toBe(false);
        expect(list[5]!.done!(at(marks[5]!), {})).toBe(true);
        expect(list[5]!.done!(at(xpForLevel(99)), {})).toBe(true);
        const away = baseState({ skills: [{ name: 'Smithing', level: 99, baseLevel: 99, experience: marks[5]! }], player: { worldX: 3222, worldZ: 3222, level: 0 } as BotWorldState['player'] });
        expect(list[5]!.preconditions(away, {})).toBe(true);
        expect(list[6]!.preconditions(away, {})).toMatch(/not within 15 tiles/);
    });

    test('the resume walk at level 60 by the anvil resumes the inventory that holds level 60', async () => {
        const xp = xpForLevel(60);
        const k = marks.findIndex(m => m > xp);
        const point = await resolveResume(list, new Observation(atAnvil(xp)), {});
        expect(point).toMatchObject({ index: k, mode: 'resume', lastDone: k - 1, firstUndone: k });
    });

    test('the resume walk at level 1 runs the first step; at 99 with nothing held the module is finished', async () => {
        const fresh = await resolveResume(list, new Observation(atAnvil(0)), {});
        expect(fresh).toMatchObject({ index: 0, mode: 'run' });
        const finished = await resolveResume(list, new Observation(atAnvil(xpForLevel(99))), {});
        expect(finished.mode).toBe('finished');
    });

    test('the free-slot precondition: the hammer and the inventory\'s bars beside everything else held', () => {
        const it = (slot: number, name: string, count = 1, id = 500 + slot): InventoryItem => ({ slot, id, name, count, optionsWithIndex: [] });
        // Inventory 1 is 24 bars: with the hammer, 25 slots, so 3 other items fit and a 4th does not.
        const three = [it(0, 'Law rune', 4), it(1, 'Air rune', 12), it(2, 'Gold bar')];
        expect(list[0]!.preconditions(atAnvil(0, three), {})).toBe(true);
        expect(list[0]!.preconditions(atAnvil(0, [...three, it(3, 'Hammer')]), {})).toBe(true);
        expect(list[0]!.preconditions(atAnvil(0, [...three, it(4, 'Tinderbox')]), {})).toBe('4 other items (Law rune, Air rune, Gold bar, Tinderbox): need 25 free slots (the hammer and 24 bars)');
        // Later inventories are 25 bars: 2 other items at most. Held bars are the module's own.
        const k = 5;
        const at = atAnvil(marks[k - 1]!, [it(0, 'Law rune', 4), it(1, 'Air rune', 12), it(2, 'Iron bar', 1, 2351)]);
        expect(list[k]!.preconditions(at, {})).toBe(true);
        expect(list[k]!.preconditions(atAnvil(marks[k - 1]!, [...at.inventory, it(3, 'Coins', 50)]), {})).toBe('3 other items (Law rune, Air rune, Coins): need 26 free slots (the hammer and 25 bars)');
        // A passed inventory is a no-op whatever is held.
        expect(list[0]!.preconditions(atAnvil(marks[0]!, Array.from({ length: 28 }, (_, i) => it(i, 'Bones'))), {})).toBe(true);
    });

    test('otherItems: products made since the baseline leave in the next trade; one SCORED arrived with stays', () => {
        const plate = (slot: number): InventoryItem => ({ slot, id: 1115, name: 'Iron platebody', count: 1, optionsWithIndex: [] });
        const s = atAnvil(0, [{ slot: 0, id: 2347, name: 'Hammer', count: 1, optionsWithIndex: [] }, plate(1), plate(2), { slot: 3, id: 563, name: 'Law rune', count: 4, optionsWithIndex: [] }]);
        expect(otherItems(s, new Map())).toEqual(['Law rune']);
        expect(otherItems(s, new Map([[1115, 1]]))).toEqual(['Iron platebody', 'Law rune']);
        expect(otherItems(s, countsOf(s.inventory))).toEqual(['Iron platebody', 'Iron platebody', 'Law rune']);
        expect(barsIn(stepPlan().plan[0]!)).toBe(24);
    });

    test('a supply helper with no giver is refused at the precondition, not thrown', () => {
        expect(steps()[0]!.preconditions(atAnvil(0), {})).toMatch(/needs a giver/);
        expect(steps({ supply: 'bank' })[0]!.preconditions(atAnvil(0), {})).toBe(true);
    });
});

// ---------------------------------------------------------------- a run against a simulated anvil and helper

const HELPER = { name: 'anvilhelper', index: 7 } as unknown as BotWorldState['nearbyPlayers'][number];
const ANVIL_NEARBY = { id: ANVIL_LOC, name: 'Anvil', x: ANVIL.x, z: ANVIL.z, level: 0, distance: 1, optionsWithIndex: [] } as unknown as BotWorldState['nearbyLocs'][number];
const NAMES: Record<string, string> = { hammer: 'Hammer', ...Object.fromEntries(Object.entries(BARS).map(([k, v]) => [k, v.name])) };
const ids = new Map<string, number>();
const idOf = (name: string) => ids.get(name) ?? (ids.set(name, 5000 + ids.size), ids.get(name)!);

class AnvilFake extends FakeSdk {
    sendCloseModal() { return this.sendAction({ method: 'sendCloseModal', args: [] }); }
    sendUseItemOnLoc(slot: number, x: number, z: number, id: number) { return this.sendAction({ method: 'sendUseItemOnLoc', args: [slot, x, z, id] }); }
    sendClickComponentWithOption(com: number, opt = 1, slot = 0) { return this.sendAction({ method: 'sendClickComponentWithOption', args: [com, opt, slot] }); }
}

/**
 * The server and H5 as agreed: the helper's request stands and it offers the latest plan's
 * `give`; packets land a tick after they are sent; one item every other tick after a make click;
 * a level-up opens a chat page. Returns the per-tick step and the helper's log.
 */
function simulate(sdk: AnvilFake, startTenths: number) {
    let tenths = startTenths;
    let plan: AnvilPlanMsg | null = null;
    const announced: AnvilPlanMsg[] = [];
    const received: string[][] = [];
    let making: { product: (typeof PRODUCTS)[number]; left: number; next: number } | null = null;
    let ifBar: Bar | null = null;
    const queue: Array<{ due: number; fx: (s: BotWorldState) => Partial<BotWorldState> }> = [];
    let slotSeq = 50;
    const item = (name: string): InventoryItem => ({ slot: slotSeq++, id: idOf(name), name, count: 1, optionsWithIndex: [] });
    const smith = (s: BotWorldState) => s.skills.find(k => k.name === 'Smithing')!;
    const announce = (m: AnvilPlanMsg) => { announced.push(m); plan = m; };

    sdk.onSend = (a: SentAction) => {
        const s = sdk.state!;
        const later = (fx: (s: BotWorldState) => Partial<BotWorldState>, d = 1) => queue.push({ due: s.tick + d, fx });
        switch (a.method) {
            case 'sendTradeRequest':
                later(cur => {
                    if (cur.trade?.isOpen || making || !plan || plan.stop) return {};
                    const theirs: TradeItem[] = Object.entries(plan.give).map(([k, n]) => ({ slot: 0, id: idOf(NAMES[k]!), name: NAMES[k]!, count: n }));
                    return { trade: { isOpen: true, screen: 'offer', partner: 'anvilhelper', myOffer: [], theirOffer: theirs, myAccepted: false, partnerAccepted: true } };
                });
                break;
            case 'sendCloseModal':
                later(() => ({ dialog: { isOpen: false, options: [], isWaiting: false }, modalOpen: false }));
                break;
            case 'sendClickDialog':
                later(() => ({ dialog: { isOpen: false, options: [], isWaiting: false } }));
                break;
            case 'sendOfferItem':
                later(cur => {
                    const it = cur.inventory.find(i => i.slot === a.args[0]);
                    if (!it || !cur.trade?.isOpen) return {};
                    const moved = cur.inventory.filter(i => i.id === it.id);
                    return { inventory: cur.inventory.filter(i => i.id !== it.id), trade: { ...cur.trade, myOffer: [...cur.trade.myOffer, { slot: 0, id: it.id, name: it.name, count: moved.length }], myAccepted: false, partnerAccepted: false } };
                });
                // H5 re-accepts; with our accept standing, both screens move to confirm.
                later(cur => {
                    const tr = cur.trade;
                    if (!tr?.isOpen || tr.screen !== 'offer') return {};
                    return { trade: tr.myAccepted ? { ...tr, screen: 'confirm', myAccepted: false, partnerAccepted: true } : { ...tr, partnerAccepted: true } };
                }, 2);
                break;
            case 'sendAcceptTrade':
                later(cur => {
                    const tr = cur.trade;
                    if (!tr?.isOpen) return {};
                    if (tr.screen === 'offer') return tr.partnerAccepted ? { trade: { ...tr, screen: 'confirm', myAccepted: false, partnerAccepted: true } } : { trade: { ...tr, myAccepted: true } };
                    received.push(tr.myOffer.flatMap(i => Array(i.count).fill(i.name)));
                    const gained = tr.theirOffer.flatMap(i => Array.from({ length: i.count }, () => item(i.name)));
                    // The server's word, which a pure hand-back is judged by (lib/trade.ts sawTradeAccepted).
                    const said = { type: 0, text: 'Accepted trade.', tick: cur.tick, fromSelf: false } as unknown as BotWorldState['gameMessages'][number];
                    return { trade: undefined, inventory: [...cur.inventory, ...gained], gameMessages: [...cur.gameMessages, said] };
                });
                break;
            case 'sendUseItemOnLoc':
                later(cur => {
                    const it = cur.inventory.find(i => i.slot === a.args[0]);
                    ifBar = it ? (Object.keys(BARS) as Bar[]).find(b => BARS[b].name === it.name) ?? null : null;
                    return { interface: { isOpen: true, interfaceId: SMITHING_IF, options: [], inventories: [] }, dialog: { isOpen: false, options: [], isWaiting: false } };
                });
                break;
            case 'sendClickComponentWithOption':
                later(cur => {
                    const [com, opt, slot] = a.args as number[];
                    const product = PRODUCTS.find(p => p.com === com && p.slot === slot && p.bar === ifBar)!;
                    making = { product, left: ({ 1: 1, 2: 5, 3: 10 } as Record<number, number>)[opt!]!, next: cur.tick + 1 };
                    return { interface: { isOpen: false, interfaceId: -1, options: [], inventories: [] } };
                });
                break;
        }
    };

    const step = () =>
        sdk.tick(cur => {
            let next: BotWorldState = { ...cur, tick: cur.tick + 1 };
            for (let i = 0; i < queue.length; ) {
                if (queue[i]!.due <= next.tick) next = { ...next, ...queue.splice(i, 1)[0]!.fx(next) };
                else i++;
            }
            if (making && next.tick >= making.next) {
                const barName = BARS[making.product.bar].name;
                const have = next.inventory.filter(i => i.name === barName);
                if (have.length < making.product.bars) making = null;
                else {
                    const used = new Set(have.slice(0, making.product.bars).map(i => i.slot));
                    tenths += itemXp(making.product) * 10;
                    const xp = Math.floor(tenths / 10);
                    const before = smith(next).baseLevel;
                    next = {
                        ...next,
                        inventory: [...next.inventory.filter(i => !used.has(i.slot)), item(making.product.name)],
                        skills: [{ name: 'Smithing', level: levelForXp(xp), baseLevel: levelForXp(xp), experience: xp }],
                        ...(levelForXp(xp) > before ? { dialog: { isOpen: true, options: [], isWaiting: false } } : {}),
                    };
                    making.left--;
                    making.next = next.tick + 2;
                    if (making.left <= 0) making = null;
                }
            }
            return next;
        });
    return { step, announce, announced, received };
}

async function drain<T>(p: Promise<T>, step: () => unknown, max = 5000): Promise<T> {
    let settled = false;
    void p.finally(() => (settled = true));
    for (let i = 0; i < max && !settled; i++) {
        await flush();
        if (!settled) step();
    }
    return p;
}

function session(sdk: AnvilFake): RunnerSession {
    return { sdk: sdk as unknown as RunnerSession['sdk'], bot: { walkTo: async () => ({ success: true, message: 'ok' }) } as unknown as RunnerSession['bot'], name: 'scored', sessionId: 1 };
}

describe('the cycle on a simulated anvil', () => {
    test('level 86 to 90 by trade: pipelined announcements, every product handed back, a turnaround per inventory', async () => {
        const xp0 = xpForLevel(86);
        const sdk = new AnvilFake(atAnvil(xp0, [{ slot: 0, id: idOf('Hammer'), name: 'Hammer', count: 1, optionsWithIndex: [] }]));
        sdk.state = { ...sdk.state!, nearbyPlayers: [HELPER], nearbyLocs: [ANVIL_NEARBY] };
        const sim = simulate(sdk, xp0 * 10);
        const reports: InventoryReport[] = [];
        const list = steps({ giver: 'anvilhelper', untilLevel: 90, announce: sim.announce, onInventory: r => reports.push(r) });
        const log = TickLog.memory();
        await drain(runSteps(session(sdk), list, { log, c: {}, shouldStop: () => false }), sim.step);

        const s = sdk.state!;
        expect(levelForXp(s.skills[0]!.experience)).toBeGreaterThanOrEqual(90);
        expect(s.inventory.map(i => i.name)).toEqual(['Hammer']);
        // One session, seq 0..n in order, then the hand-back plan and the stop.
        const sessions = new Set(sim.announced.map(m => m.session));
        expect(sessions.size).toBe(1);
        expect(sim.announced.map(m => m.seq)).toEqual(sim.announced.map((_, i) => i));
        expect(sim.announced.at(-2)).toMatchObject({ give: {}, collect: true });
        expect(sim.announced.at(-1)).toMatchObject({ give: {}, stop: true });
        // Mithril platebodies until 88, then adamant.
        expect(sim.announced[0]!.give).toEqual({ mithril_bar: 25 });
        expect(sim.announced.some(m => m.give.adamantite_bar)).toBe(true);
        // Every trade after the first handed back the previous inventory's products.
        expect(sim.received[0]).toEqual([]);
        for (const r of sim.received.slice(1)) expect(r.length).toBeGreaterThan(0);
        expect(sim.received.flat().every(n => /platebody/.test(n))).toBe(true);
        expect(reports.length).toBe(sim.received.length - 1);
        expect(reports.slice(1).every(r => r.turnaround !== null && r.turnaround > 0 && r.turnaround <= 12)).toBe(true);
        expect(log.rows.filter(r => r.step.startsWith('S25a') && r.ok).length).toBe(list.length);
    });

    test('a hand-back that failed at the anvil (rs/562 E): a fresh process walks to the last inventory and hands the products back', async () => {
        const xp = xpForLevel(90);
        const plate = (slot: number): InventoryItem => ({ slot, id: idOf('Adamant platebody'), name: 'Adamant platebody', count: 1, optionsWithIndex: [] });
        const left = [{ slot: 0, id: idOf('Hammer'), name: 'Hammer', count: 1, optionsWithIndex: [] }, plate(1), plate(2), plate(3), plate(4)];
        const sdk = new AnvilFake(atAnvil(xp, left));
        sdk.state = { ...sdk.state!, nearbyPlayers: [HELPER], nearbyLocs: [ANVIL_NEARBY] };
        const sim = simulate(sdk, xp * 10);
        // A new process: a fresh steps() whose Smithy never saw the step's entry.
        const list = steps({ giver: 'anvilhelper', untilLevel: 90, announce: sim.announce });
        const last = list.length - 1;
        expect(list[last]!.done!(new Observation(sdk.state!), {})).toBe(false);
        expect(list[last]!.postconditions(sdk.state!, {})).toBe('4 products still held after the last inventory');
        const point = await resolveResume(list, new Observation(sdk.state!), {});
        expect(point).toMatchObject({ index: last, mode: 'run', lastDone: last - 1 });
        await drain(runSteps(session(sdk), list, { log: TickLog.memory(), c: {}, shouldStop: () => false, from: point.index }), sim.step);
        expect(sim.received.at(-1)).toEqual(['Adamant platebody', 'Adamant platebody', 'Adamant platebody', 'Adamant platebody']);
        expect(sim.announced.map(m => [m.collect ?? false, m.stop ?? false])).toEqual([[true, false], [false, true]]);
        expect(sdk.state!.inventory.map(i => i.name)).toEqual(['Hammer']);
        expect(list[last]!.done!(new Observation(sdk.state!), {})).toBe(true);
    });

    test('the last inventory is done away from the anvil whatever the pack holds (a milestone stays done)', () => {
        const list = steps({ giver: 'anvilhelper', untilLevel: 90 });
        const plate: InventoryItem = { slot: 1, id: idOf('Adamant platebody'), name: 'Adamant platebody', count: 1, optionsWithIndex: [] };
        const away = { ...atAnvil(xpForLevel(90), [plate]), player: { name: 'scored', worldX: 3191, worldZ: 3362, level: 0 } as BotWorldState['player'] };
        expect(list.at(-1)!.done!(new Observation(away), {})).toBe(true);
        expect(list.at(-1)!.done!(new Observation(atAnvil(xpForLevel(90), [])), {})).toBe(true);
    });

    test('a resume holding bars makes them first, then opens a new helper session at seq 0', async () => {
        const xp0 = xpForLevel(70) + 100;
        const held = Array.from({ length: 10 }, (_, i) => ({ slot: i + 1, id: idOf('Mithril bar'), name: 'Mithril bar', count: 1, optionsWithIndex: [] }));
        const sdk = new AnvilFake(atAnvil(xp0, [{ slot: 0, id: idOf('Hammer'), name: 'Hammer', count: 1, optionsWithIndex: [] }, ...held]));
        sdk.state = { ...sdk.state!, nearbyPlayers: [HELPER], nearbyLocs: [ANVIL_NEARBY] };
        const sim = simulate(sdk, xp0 * 10);
        const reports: InventoryReport[] = [];
        const list = steps({ giver: 'anvilhelper', announce: sim.announce, onInventory: r => reports.push(r) });
        const point = await resolveResume(list, new Observation(sdk.state!), {});
        expect(point.mode).toBe('resume');
        const only = list[point.index]!;
        await drain(runSteps(session(sdk), [only], { log: TickLog.memory(), c: {}, shouldStop: () => false, startMode: 'resume' }), sim.step);
        expect(reports[0]).toMatchObject({ supply: 'held', plan: '2 mithril platebody' });
        expect(sim.announced[0]).toMatchObject({ seq: 0 });
        expect(sim.received[0]).toEqual(['Mithril platebody', 'Mithril platebody']);
        expect(sdk.state!.skills[0]!.experience).toBeGreaterThanOrEqual(stepPlan().marks[point.index]!);
    });
});

// ---------------------------------------------------------------- the give-back (H21a's swap outs)

describe('giveBack: the dead items leave in the first trade, and the slots are counted after it', () => {
    const it = (slot: number, name: string, count = 1): InventoryItem => ({ slot, id: idOf(name), name, count, optionsWithIndex: [] });
    /**
     * The items the route still carries into S25a that nothing after it uses (STEP-MANIFEST.md's
     * inventory ledger at H21a): 26 slots of them beside two rune stacks that stay, a full pack.
     */
    const DEAD = ['Rune axe', 'Rune pickaxe', 'Knife', ...Array(16).fill('Logs'), 'Spade', ...Array(4).fill('Bucket'), 'Gas mask', 'Lit torch'] as string[];
    const full = () => [it(0, 'Law rune', 8), it(1, 'Water rune', 8), ...DEAD.map((n, i) => it(i + 2, n))];
    const ALL_DEAD = ['Rune axe', 'Rune pickaxe', 'Knife', 'Logs', 'Spade', 'Bucket', 'Gas mask', 'Lit torch'].map(item => ({ item }));
    const { marks } = stepPlan();
    // Inventory 6 is 25 bars: with the hammer it needs 26 free slots, H21a's needAtStart.
    const k = 5;

    test('(b) the precondition and the bar room count the pending give-back as gone: 0 free before, 26 after', () => {
        const s = atAnvil(marks[k - 1]!, full());
        expect(s.inventory).toHaveLength(28);
        expect(barsIn(stepPlan().plan[k]!)).toBe(25);
        expect(steps({ giver: 'anvilhelper' })[k]!.preconditions(s, {})).toMatch(/^28 other items \(Law rune, Water rune, Rune axe, .*\): need 26 free slots \(the hammer and 25 bars\)$/);
        expect(steps({ giver: 'anvilhelper', giveBack: ALL_DEAD })[k]!.preconditions(s, {})).toBe(true);
        const baseline = countsOf(s.inventory);
        expect(barRoom(s, 27, baseline)).toBe(0);
        // 28 less the two rune stacks less the hammer's slot.
        expect(barRoom(s, 27, baseline, ALL_DEAD)).toBe(25);
        expect(giveBackItems(s.inventory, ALL_DEAD)).toHaveLength(26);
    });

    test('(c) a give-back that still leaves too few slots is refused with a reason, not thrown', () => {
        const s = atAnvil(marks[k - 1]!, full());
        const noLogs = ALL_DEAD.filter(g => g.item !== 'Logs');
        expect(steps({ giver: 'anvilhelper', giveBack: noLogs })[k]!.preconditions(s, {})).toBe(
            '18 other items (Law rune, Water rune, Logs) after the give-back (Rune axe, Rune pickaxe, Knife, Spade, Bucket, Gas mask, Lit torch): need 26 free slots (the hammer and 25 bars)',
        );
        // A spec matching nothing held gives nothing back and changes no count.
        expect(steps({ giver: 'anvilhelper', giveBack: [{ item: 'Fishing rod' }] })[k]!.preconditions(s, {})).toMatch(/^28 other items .*: need 26 free slots/);
        expect(() => steps({ giveBack: [{ item: 'Spade', n: 0 }] })).toThrow(/giveBack Spade: n must be a positive integer/);
    });

    test('(a) a fresh chain offers the give-back in its first trade, and only there; the first inventory gets the full bar room', async () => {
        const xp0 = xpForLevel(86);
        const dead = [it(1, 'Spade'), it(2, 'Bucket'), it(3, 'Bucket'), it(4, 'Lit torch')];
        const sdk = new AnvilFake(atAnvil(xp0, [it(0, 'Hammer'), ...dead]));
        sdk.state = { ...sdk.state!, nearbyPlayers: [HELPER], nearbyLocs: [ANVIL_NEARBY] };
        const sim = simulate(sdk, xp0 * 10);
        const logged: string[] = [];
        const list = steps({ giver: 'anvilhelper', untilLevel: 87, announce: sim.announce, giveBack: [{ item: 'Spade' }, { item: 'Bucket' }, { item: 'Lit torch' }], log: msg => logged.push(msg) });
        await drain(runSteps(session(sdk), list, { log: TickLog.memory(), c: {}, shouldStop: () => false }), sim.step);

        expect(sim.received[0]).toEqual(['Spade', 'Bucket', 'Bucket', 'Lit torch']);
        expect(sim.received.length).toBeGreaterThan(1);
        expect(sim.received.slice(1).flat().every(n => /platebody/.test(n))).toBe(true);
        // Counted after the give-back, the first inventory is the empty-pack plan, not one cut to 24.
        expect(sim.announced[0]!.give).toEqual({ mithril_bar: 25 });
        expect(logged.filter(m => m === 'given back')).toHaveLength(1);
        expect(sdk.state!.inventory.map(i => i.name)).toEqual(['Hammer']);
    });

    test('(a) a resume holding bars offers the give-back alongside the first products handed back', async () => {
        const xp0 = xpForLevel(70) + 100;
        const bars = Array.from({ length: 10 }, (_, i) => it(i + 1, 'Mithril bar'));
        const sdk = new AnvilFake(atAnvil(xp0, [it(0, 'Hammer'), ...bars, it(11, 'Spade'), it(12, 'Gas mask')]));
        sdk.state = { ...sdk.state!, nearbyPlayers: [HELPER], nearbyLocs: [ANVIL_NEARBY] };
        const sim = simulate(sdk, xp0 * 10);
        const list = steps({ giver: 'anvilhelper', announce: sim.announce, giveBack: [{ item: 'Spade' }, { item: 'Gas mask' }] });
        const point = await resolveResume(list, new Observation(sdk.state!), {});
        expect(point.mode).toBe('resume');
        await drain(runSteps(session(sdk), [list[point.index]!], { log: TickLog.memory(), c: {}, shouldStop: () => false, startMode: 'resume' }), sim.step);
        expect(sim.received[0]).toEqual(['Mithril platebody', 'Mithril platebody', 'Spade', 'Gas mask']);
        expect(sdk.state!.inventory.some(i => i.name === 'Spade' || i.name === 'Gas mask')).toBe(false);
    });
});


for (const ms of [300, 400]) {
    describe(`openBooth at ${ms} ms a tick: the client-stopped backstop is maxTicks + 10 ticks of it`, () => {
        useFakeTicks(ms);

        test('a client that never publishes again rejects after 50 ticks of wall time, not before', async () => {
            const sdk = new FakeSdk(baseState({ tick: 5 }));
            const p = openBooth(sdk as never, 40);
            p.catch(() => {});
            await microtasks();
            fakeClock.advanceTimersByTime(50 * ms - 1);
            expect(await peek(p.catch(e => e))).toBeUndefined();
            fakeClock.advanceTimersByTime(1);
            await expect(p).rejects.toThrow(/stopped publishing/);
        });
    });
}
