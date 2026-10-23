// S25a Smithing: STEP-MANIFEST.md entry 10, docs/speedrun/skills/smithing.md.
//
// SCORED stands beside the Varrock west anvil (3188,3426) on (3187,3426) and only hammers.
// Each inventory is one trade with the anvil helper H5 on (3187,3427) (speedrun/helpers/anvil.ts,
// rs/188): the helper offers the next inventory's bars and takes back what SCORED just made, in
// the same trade (lib/trade.ts swap), and SCORED then makes the inventory with one make-5 click
// per product (use-bar-on-anvil opens the smithing interface; INV_BUTTON2 on the product's slot).
// Every item costs 5 ticks whatever its bar count, so the planner takes the best xp per tick at
// each level with the inventory turnaround spread over the item's bars (smithing-model.ts's rule).
// From level 1 that is one mixed bronze/iron inventory to 34, then platebodies: iron (33), steel
// (48), mithril (68), adamant (88), 31 inventories in all.
//
// Steps: one per inventory of the plan from level 1, each logout-safe and a milestone by xp.
// Every step reads the live xp: a passed inventory is a no-op, and a step smiths whole
// inventories, planned from the live xp, until its milestone. So the module runs from any level,
// and a restart resumes at the next trade (held bars are smithed first).
//
// The trades are pipelined: SCORED announces inventory N+1 to the helper on the tick N's bars
// arrive, so the helper restocks during N's ~25 smithing ticks and is requesting again before
// N's last item (ANVIL_CONTRACT). The fallback, `supply: 'bank'`, takes the bars from the
// Varrock west booth instead: the booth re-clicked every tick from the last xp, products
// deposited and bars withdrawn in the tick it opens (42 ticks a cycle, measured, smithing.md
// section 4).

import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, InventoryItem, NearbyLoc } from '../../sdk/types';
import { withdrawMany } from '../lib/bank';
import { matchesItem } from '../lib/items';
import { startLevelUpWatcher } from '../lib/levelup';
import { swap, type GiveSpec, type SwapResult, type WantSpec } from '../lib/trade';
import { tickMs, waitUntil, type StateSource } from '../lib/wait';
import { levelForXp, XP_RATE, xpForLevel } from '../lib/xp';
import type { Step, StepContext } from '../runner/step';

export const skill = 'smithing';

// ------------------------------------------------------------------ place

/** Varrock west anvil (loc 2783), and the tiles SCORED and the helper stand on beside it. */
export const ANVIL = { x: 3188, z: 3426 } as const;
export const ANVIL_LOC = 2783;
export const SCORED_TILE = { x: 3187, z: 3426 } as const;
export const HELPER_TILE = { x: 3187, z: 3427 } as const;
/** loc 2213 = bankbooth; Varrock west's booths are about 10 tiles north of the anvil. */
export const BOOTH_LOC = 2213;
/** The step may start within this many tiles of the anvil; it walks the rest itself. */
export const NEAR = 15;

// ------------------------------------------------------------------ content

/** The smithing interface (interface.pack 994). */
export const SMITHING_IF = 994;
export type MakeCount = 1 | 5 | 10;
/** INV_BUTTON1/2/3 on a column's slot is make-1/5/10 (smithing.rs2); there is no make-X. */
export const MAKE_OPTION: Record<MakeCount, number> = { 1: 1, 5: 2, 10: 3 };

export type Bar = 'bronze_bar' | 'iron_bar' | 'steel_bar' | 'mithril_bar' | 'adamantite_bar';

/** Base xp per bar (smithing.struct xpperbar, tenths / 10) and the in-game name. */
export const BARS: Record<Bar, { name: string; base: number }> = {
    bronze_bar: { name: 'Bronze bar', base: 12.5 },
    iron_bar: { name: 'Iron bar', base: 25 },
    steel_bar: { name: 'Steel bar', base: 37.5 },
    mithril_bar: { name: 'Mithril bar', base: 50 },
    adamantite_bar: { name: 'Adamantite bar', base: 62.5 },
};
export const BAR_ORDER: readonly Bar[] = ['bronze_bar', 'iron_bar', 'steel_bar', 'mithril_bar', 'adamantite_bar'];

export interface Product {
    /** Debug name (smithing.dbrow). */
    id: string;
    /** In-game name. */
    name: string;
    level: number;
    bar: Bar;
    bars: number;
    /** smithing:column1..5 = 1119..1123 (interface.pack), and the 0-based slot in it (smithing.inv). */
    com: number;
    slot: number;
}

/**
 * Every item the route can pick: one of each kind (bar type and count) that is the best xp per
 * tick at some level 1-98 among all anvil items, on the trade's or the bank's turnaround
 * (smithing.test.ts proves this against the content tables, so the planner never misses one).
 */
export const PRODUCTS: readonly Product[] = [
    { id: 'bronze_dagger', name: 'Bronze dagger', level: 1, bar: 'bronze_bar', bars: 1, com: 1119, slot: 0 },
    { id: 'bronze_scimitar', name: 'Bronze scimitar', level: 5, bar: 'bronze_bar', bars: 2, com: 1119, slot: 2 },
    { id: 'bronze_warhammer', name: 'Bronze warhammer', level: 9, bar: 'bronze_bar', bars: 3, com: 1120, slot: 2 },
    { id: 'bronze_2h_sword', name: 'Bronze 2h sword', level: 14, bar: 'bronze_bar', bars: 3, com: 1119, slot: 4 },
    { id: 'bronze_platebody', name: 'Bronze platebody', level: 18, bar: 'bronze_bar', bars: 5, com: 1121, slot: 3 },
    // On the bank's 17-tick turnaround a 2-bar iron item beats the bronze platebody at 20-23.
    { id: 'iron_scimitar', name: 'Iron scimitar', level: 20, bar: 'iron_bar', bars: 2, com: 1119, slot: 2 },
    { id: 'iron_warhammer', name: 'Iron warhammer', level: 24, bar: 'iron_bar', bars: 3, com: 1120, slot: 2 },
    { id: 'iron_2h_sword', name: 'Iron 2h sword', level: 29, bar: 'iron_bar', bars: 3, com: 1119, slot: 4 },
    { id: 'iron_platebody', name: 'Iron platebody', level: 33, bar: 'iron_bar', bars: 5, com: 1121, slot: 3 },
    // ... and a 3-bar steel item beats the iron platebody at 39-47.
    { id: 'steel_warhammer', name: 'Steel warhammer', level: 39, bar: 'steel_bar', bars: 3, com: 1120, slot: 2 },
    { id: 'steel_platebody', name: 'Steel platebody', level: 48, bar: 'steel_bar', bars: 5, com: 1121, slot: 3 },
    { id: 'mithril_platebody', name: 'Mithril platebody', level: 68, bar: 'mithril_bar', bars: 5, com: 1121, slot: 3 },
    { id: 'adamant_platebody', name: 'Adamant platebody', level: 88, bar: 'adamantite_bar', bars: 5, com: 1121, slot: 3 },
];

const HAMMER = /^hammer$/i;

// ------------------------------------------------------------------ the hand-off contract (H5)

/** What SCORED tells the anvil helper: the shape of anvil.ts's anvil-plan.json (writeAnvilPlan). */
export interface AnvilPlanMsg {
    /** New at every entry of the step (`<runId>/<entry tick>`), so a resume never collides with a delivered seq. */
    session: string;
    /** Index of the inventory SCORED wants next, from 0 in each session. */
    seq: number;
    /** Items for that inventory by debug name, unnoted. */
    give: Record<string, number>;
    /** The final hand-back: offer nothing, accept SCORED's last products. */
    collect?: true;
    stop?: true;
}

/**
 * The S25a hand-off with H5, as agreed with rs/188 through rs/41 (cairn://p/rs/41/1/coordinator/
 * messages and cairn://p/rs/197/1/builder/messages, 2026-10-21; anvil.ts at 635afcdc). run.ts
 * wires `announce` to anvil.ts's writeAnvilPlan and publishes the cue; this module imports
 * nothing from helpers/.
 */
export const ANVIL_CONTRACT = {
    helper: 'H5, speedrun/helpers/anvil.ts (rs/188)',
    anvil: ANVIL,
    scoredTile: SCORED_TILE,
    helperTile: HELPER_TILE,
    planFile: 'anvil-plan.json',
    /** The helper keeps a trade request standing; SCORED's own click then opens both screens. */
    requests: 'helper',
    /** SCORED trade-ops the helper on every tick from the tick after the inventory's last xp until the screens open, with CLOSE_MODAL while a modal is open. */
    scoredClicks: 'every tick from last xp + 1',
    /** The helper offers exactly `give`, one press per id. */
    helperGives: 'plan.give',
    /** SCORED offers every product it holds (the previous inventory), and any held bars the plan does not want. */
    scoredGives: 'products',
    /** SCORED announces seq N+1 on the tick seq N's bars arrive. */
    announceNext: 'on bars in',
    /** seq 0 is announced before SCORED reaches the anvil (firstAnnouncement), at the latest on entry. */
    first: 'staged before arrival',
    /** Published with seq 0: the helper requests only the player matching cue.json's receiver hash (altar-cue.ts CueWriter), once in sight. */
    cue: 'cue.json receiver hash',
    /** When SCORED holds no hammer, seq 0's give carries hammer: 1. */
    hammer: { hammer: 1 },
    /** After the last inventory: `{give: {}, collect: true}`, one more trade, then `{stop: true}`. */
    last: 'collect, then stop',
    /** Bars per inventory: at most `cap` (hammer + 27 = 28 slots). */
    cap: 27,
} as const;

// ------------------------------------------------------------------ the plan

export interface PlanConfig {
    untilLevel: number;
    /** Per-inventory turnaround in ticks, spread over its bars when ranking items (7 trade, 17 bank). */
    overhead: number;
    /** Bars per inventory. */
    cap: number;
    /** Bars the helper can supply; without adamantite, mithril platebodies run on past 88 (SUPPLIES.md H21a). */
    bars: readonly Bar[];
}

export const PLAN_DEFAULTS: PlanConfig = { untilLevel: 99, overhead: 7, cap: 27, bars: BAR_ORDER };

export interface Segment {
    product: Product;
    count: number;
}

export interface PlannedInventory {
    segs: Segment[];
    bars: Partial<Record<Bar, number>>;
    /** Game xp the inventory awards. */
    xp: number;
}

/** Game xp for one item. */
export function itemXp(p: Product): number {
    return p.bars * BARS[p.bar].base * XP_RATE;
}

function rate(p: Product, c: PlanConfig): number {
    return (p.bars * BARS[p.bar].base) / (5 + (p.bars * c.overhead) / c.cap);
}

/**
 * The best item at `level` among `candidates`. Ties go to the larger xp, then to the later
 * unlock (the 2h sword over the warhammer: same bars, same xp, as the measured route made them).
 */
export function bestProduct(level: number, c: PlanConfig, candidates: readonly Product[] = PRODUCTS): Product | null {
    let best: Product | null = null;
    const better = (p: Product, b: Product) => rate(p, c) - rate(b, c) || itemXp(p) - itemXp(b) || p.level - b.level;
    for (const p of candidates) {
        // An item over the inventory's bar cap could never be supplied in one inventory.
        if (p.level > level || !c.bars.includes(p.bar) || p.bars > c.cap) continue;
        if (!best || better(p, best) > 0) best = p;
    }
    return best;
}

/** The inventories from `fromXp` (game xp) to `untilLevel`, item by item, a new inventory when the next item's bars do not fit. */
export function routePlan(fromXp: number, c: PlanConfig = PLAN_DEFAULTS): PlannedInventory[] {
    const target = xpForLevel(c.untilLevel);
    const invs: PlannedInventory[] = [];
    let xp = fromXp;
    let used = c.cap;
    while (xp < target) {
        const p = bestProduct(levelForXp(xp), c);
        if (!p) throw new Error(`no anvil item at Smithing ${levelForXp(xp)} with bars ${c.bars.join(', ')}`);
        if (used + p.bars > c.cap) {
            invs.push({ segs: [], bars: {}, xp: 0 });
            used = 0;
        }
        const inv = invs[invs.length - 1]!;
        const last = inv.segs[inv.segs.length - 1];
        if (last && last.product === p) last.count++;
        else inv.segs.push({ product: p, count: 1 });
        inv.bars[p.bar] = (inv.bars[p.bar] ?? 0) + p.bars;
        inv.xp += itemXp(p);
        used += p.bars;
        xp += itemXp(p);
    }
    return invs;
}

/** Bars per id over a plan (the helper's stock list). */
export function barTotals(plan: readonly PlannedInventory[]): Partial<Record<Bar, number>> {
    const out: Partial<Record<Bar, number>> = {};
    for (const inv of plan) for (const [b, n] of Object.entries(inv.bars) as [Bar, number][]) out[b] = (out[b] ?? 0) + n;
    return out;
}

/**
 * The xp milestones of a plan from `fromXp`: the observed xp once each inventory is made. The
 * state carries floor(tenths / 10), hence the floor; the last one is the target level's xp.
 */
export function milestones(plan: readonly PlannedInventory[], fromXp: number, c: PlanConfig): number[] {
    let xp = fromXp;
    return plan.map((inv, i) => {
        xp += inv.xp;
        return i === plan.length - 1 ? xpForLevel(c.untilLevel) : Math.floor(xp + 1e-9);
    });
}

/** One line per inventory: "5 adamant platebody", "2 bronze dagger + ... ". */
export function describe(inv: PlannedInventory): string {
    return inv.segs.map(s => `${s.count} ${s.product.id.replace(/_/g, ' ')}`).join(' + ');
}

// ------------------------------------------------------------------ state reads

export function smithingXp(s: BotWorldState): number {
    return s.skills.find(k => k.name === 'Smithing')?.experience ?? 0;
}

export function smithingLevel(s: BotWorldState): number {
    return levelForXp(smithingXp(s));
}

const nameRe = (name: string) => new RegExp(`^${name}$`, 'i');

export function countOf(items: ReadonlyArray<{ name: string; count: number }>, name: string): number {
    const re = nameRe(name);
    return items.filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
}

export function hasHammer(s: BotWorldState): boolean {
    return s.inventory.some(i => HAMMER.test(i.name));
}

export function barOf(item: { name: string }): Bar | null {
    return BAR_ORDER.find(b => nameRe(BARS[b].name).test(item.name)) ?? null;
}

export function isProduct(item: { name: string }): boolean {
    return PRODUCTS.some(p => nameRe(p.name).test(item.name));
}

/** What SCORED holds that is not the step's own to hand back: everything but the products. */
export function entryBaseline(s: BotWorldState): Counts {
    return countsOf(s.inventory.filter(i => !isProduct(i)));
}

export function heldBars(s: BotWorldState): Partial<Record<Bar, number>> {
    const out: Partial<Record<Bar, number>> = {};
    for (const i of s.inventory) {
        const b = barOf(i);
        if (b) out[b] = (out[b] ?? 0) + i.count;
    }
    return out;
}

/** Items SCORED hands back in a trade or deposits: products, and held bars the next inventory does not use. */
/** Item counts by id. */
export type Counts = ReadonlyMap<number, number>;

export function countsOf(items: readonly InventoryItem[]): Map<number, number> {
    const m = new Map<number, number>();
    for (const i of items) m.set(i.id, (m.get(i.id) ?? 0) + i.count);
    return m;
}

/**
 * What goes to the helper (or into the bank): the products this step made and the bars it will not
 * use (bar types outside `keep`). `baseline` is the inventory before the step made anything; up to its
 * count of each id stays, so an item SCORED arrived with that merely looks like a product (a starter
 * bronze dagger) or a bar is never handed over. The entry that straddles the baseline is returned
 * with the excess count.
 */
export function handBack(inventory: readonly InventoryItem[], keep: Partial<Record<Bar, number>>, baseline: Counts): InventoryItem[] {
    const allowance = new Map(baseline);
    const out: InventoryItem[] = [];
    for (const i of inventory) {
        if (!isProduct(i) && (barOf(i) === null || keep[barOf(i)!])) continue;
        const left = allowance.get(i.id) ?? 0;
        allowance.set(i.id, Math.max(0, left - i.count));
        if (left >= i.count) continue;
        out.push(left > 0 ? { ...i, count: i.count - left } : i);
    }
    return out;
}

/**
 * The held items the give-back names: each spec takes the first held id it matches (as lib/trade.ts
 * planOffers does), every one held or `n` of them, one entry per slot it leaves from. The hammer and
 * bars are the module's own and never given back.
 */
export function giveBackItems(inventory: readonly InventoryItem[], specs: readonly GiveSpec[]): InventoryItem[] {
    const inSlotOrder = [...inventory].sort((a, b) => a.slot - b.slot).filter(i => !HAMMER.test(i.name) && !barOf(i));
    const taken = new Set<number>();
    const out: InventoryItem[] = [];
    for (const spec of specs) {
        const first = inSlotOrder.find(i => !taken.has(i.id) && matchesItem(i, spec.item));
        if (!first) continue;
        taken.add(first.id);
        let left = spec.n === undefined || spec.n === 'all' ? Infinity : spec.n;
        for (const i of inSlotOrder) {
            if (i.id !== first.id || left <= 0) continue;
            const n = Math.min(i.count, left);
            out.push(n === i.count ? i : { ...i, count: n });
            left -= n;
        }
    }
    return out;
}

/** The inventory once `leaving` (entries of it, by slot) has gone. */
export function afterLeaving(inventory: readonly InventoryItem[], leaving: readonly InventoryItem[]): InventoryItem[] {
    const gone = new Map<number, number>();
    for (const i of leaving) gone.set(i.slot, (gone.get(i.slot) ?? 0) + i.count);
    return inventory.flatMap(i => {
        const n = i.count - (gone.get(i.slot) ?? 0);
        return n <= 0 ? [] : [n === i.count ? i : { ...i, count: n }];
    });
}

/** Everything a supply takes: handBack's items, then the give-back's among what is left. */
export function leavingItems(inventory: readonly InventoryItem[], keep: Partial<Record<Bar, number>>, baseline: Counts, giveBack: readonly GiveSpec[]): InventoryItem[] {
    const back = handBack(inventory, keep, baseline);
    return [...back, ...giveBackItems(afterLeaving(inventory, back), giveBack)];
}

/** Slots free for bars once the hand-back items (and any pending give-back) leave: the cap for the next inventory. */
export function barRoom(s: BotWorldState, cap: number, baseline: Counts, giveBack: readonly GiveSpec[] = []): number {
    const kept = afterLeaving(s.inventory, leavingItems(s.inventory, {}, baseline, giveBack)).length;
    return Math.max(0, Math.min(cap, 28 - kept - (hasHammer(s) ? 0 : 1)));
}

/**
 * Items outside the module's own list: anything but the hammer, bars, and the products made since
 * `baseline`, which leave in the next trade. An item SCORED arrived with that looks like a product
 * stays, so it counts here.
 */
export function otherItems(s: BotWorldState, baseline: Counts): string[] {
    const allowance = new Map(baseline);
    const out: string[] = [];
    for (const i of s.inventory) {
        if (HAMMER.test(i.name) || barOf(i)) continue;
        if (isProduct(i)) {
            const left = allowance.get(i.id) ?? 0;
            allowance.set(i.id, Math.max(0, left - i.count));
            if (left < i.count) continue;
        }
        out.push(i.name);
    }
    return out;
}

/** Bars in a planned inventory. */
export function barsIn(inv: PlannedInventory): number {
    return Object.values(inv.bars).reduce((a, n) => a + (n ?? 0), 0);
}

/**
 * The step's slot precondition: its inventory's bars and the hammer (held, or in seq 0's give) need
 * that many slots beside everything else SCORED holds. Without it barRoom would shrink the trade and
 * the step would need more inventories than its plan. A pending give-back is counted as gone: the first
 * trade takes it before the bars arrive.
 */
export function slotReason(s: BotWorldState, inv: PlannedInventory, baseline: Counts, giveBack: readonly GiveSpec[] = []): string | null {
    const gone = leavingItems(s.inventory, {}, baseline, giveBack).slice(handBack(s.inventory, {}, baseline).length);
    const other = otherItems({ ...s, inventory: afterLeaving(s.inventory, gone) }, baseline);
    const need = barsIn(inv) + 1;
    if (other.length <= 28 - need) return null;
    const after = gone.length ? ` after the give-back (${[...new Set(gone.map(i => i.name))].join(', ')})` : '';
    return `${other.length} other items (${[...new Set(other)].join(', ')})${after}: need ${need} free slots (the hammer and ${barsIn(inv)} bars)`;
}

/** What the held bars make at `level`: the best item per bar type, as many as the bars allow. */
export function heldSegments(s: BotWorldState, c: PlanConfig): Segment[] {
    const level = smithingLevel(s);
    const segs: Segment[] = [];
    for (const [bar, n] of Object.entries(heldBars(s)) as [Bar, number][]) {
        const p = bestProduct(level, { ...c, bars: [bar] });
        if (p && n >= p.bars) segs.push({ product: p, count: Math.floor(n / p.bars) });
    }
    return segs;
}

export function cheb(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

function where(s: BotWorldState): { x: number; z: number } | null {
    return s.player ? { x: s.player.worldX, z: s.player.worldZ } : null;
}

export function nearAnvil(s: BotWorldState, r = NEAR): boolean {
    const p = where(s);
    return !!p && (s.player?.level ?? 0) === 0 && cheb(p, ANVIL) <= r;
}

export function anvilLoc(s: BotWorldState): NearbyLoc | undefined {
    return s.nearbyLocs.find(l => l.id === ANVIL_LOC && l.x === ANVIL.x && l.z === ANVIL.z);
}

export function boothOf(s: BotWorldState): { loc: NearbyLoc; op: number } | null {
    const loc = s.nearbyLocs.filter(l => l.id === BOOTH_LOC).sort((a, b) => cheb(a, ANVIL) - cheb(b, ANVIL))[0];
    if (!loc) return null;
    const op = (loc.optionsWithIndex.find(o => /^use-quickly$/i.test(o.text)) ?? loc.optionsWithIndex.find(o => /^(bank|use)$/i.test(o.text)))?.opIndex ?? 1;
    return { loc, op };
}

export function smithingOpen(s: BotWorldState): boolean {
    return !!s.interface?.isOpen && s.interface.interfaceId === SMITHING_IF;
}

// ------------------------------------------------------------------ the make click

export type AnvilSdk = StateSource & Pick<BotSDK, 'sendUseItemOnLoc' | 'sendClickComponentWithOption'>;

/** The make click on the open smithing interface: INV_BUTTON<1|2|3> on the product's slot. */
export function makeClick(sdk: Pick<BotSDK, 'sendClickComponentWithOption'>, p: Product, count: MakeCount) {
    return sdk.sendClickComponentWithOption(p.com, MAKE_OPTION[count], p.slot);
}

/**
 * Which make option for `left` items. When no later item of the inventory uses this bar, a
 * make-5 or make-10 runs until the bars are gone (smithing.rs2 stops with a mesbox), so any
 * count is one click.
 */
export function chooseMake(left: number, lastOfBar: boolean): MakeCount {
    if (left >= 10 || (lastOfBar && left > 5)) return 10;
    if (left >= 5 || (lastOfBar && left > 1)) return 5;
    return 1;
}

export interface SegmentResult {
    /** Tick of the first make click and of the last item's xp. */
    firstClick: number;
    lastXp: number;
    /** Make clicks re-sent because the interface was still open (InvButtonHandler refused it), and fresh use-bars. */
    resends: number;
}

/** Ticks with no xp before a segment counts as stalled. */
export const STALL_TICKS = 30;

/**
 * Make `seg.count` items: use a bar on the anvil (re-sent every 3 ticks until the interface
 * opens), click make-N, and count the xp updates, one per item 5 ticks apart. A make click is
 * re-sent when the interface is still open 2 ticks later (`attempt_smithing` starts with
 * `if_close`, so an open interface means the click was refused); a click that closed the
 * interface without xp falls back to a fresh use-bar after 8 ticks.
 */
export function smithSegment(sdk: AnvilSdk, seg: Segment, lastOfBar: boolean): Promise<SegmentResult> {
    return new Promise((resolve, reject) => {
        let phase: 'use' | 'smith' = 'use';
        let left = seg.count;
        let expect = 0;
        let lastXpVal = -1;
        let lastXpTick = -1;
        let useTick = -99;
        let clickTick = -99;
        let clickArgs: MakeCount = 1;
        let firstClick = -1;
        let progress = -1;
        let resends = 0;
        let lastTick = -1;
        let done = false;
        const finish = (err?: Error) => {
            if (done) return;
            done = true;
            unsub();
            clearTimeout(wall);
            if (err) reject(err);
            else resolve({ firstClick, lastXp: lastXpTick, resends });
        };
        const handle = (s: BotWorldState) => {
            if (done) return;
            const xp = smithingXp(s);
            if (lastXpVal < 0) lastXpVal = xp;
            if (progress < 0) progress = s.tick;
            if (xp > lastXpVal) {
                lastXpVal = xp;
                lastXpTick = s.tick;
                progress = s.tick;
                left--;
                expect--;
                if (left <= 0) return finish();
                if (expect <= 0) phase = 'use';
            }
            if (s.tick === lastTick) return;
            lastTick = s.tick;
            if (s.tick - progress > STALL_TICKS) {
                const seen = `phase ${phase}, interface ${s.interface?.isOpen ? s.interface.interfaceId : 'closed'}, modal ${s.modalOpen ? s.modalInterface : 'none'}, bank ${s.bank.isOpen ? 'open' : 'closed'}, ${countOf(s.inventory, BARS[seg.product.bar].name)} bars, at ${s.player?.worldX},${s.player?.worldZ}, anvil ${anvilLoc(s) ? 'in view' : 'not in view'}, use ${useTick} click ${clickTick}; messages: ${s.gameMessages.slice(-3).map(m => m.text).join(' | ')}`;
                return finish(new Error(`no Smithing xp for ${STALL_TICKS} ticks making ${seg.product.name} (${left} left): ${seen}`));
            }
            if (phase === 'smith') {
                if (lastXpTick >= clickTick) return;
                if (smithingOpen(s) && s.tick >= clickTick + 2) {
                    void makeClick(sdk, seg.product, clickArgs);
                    clickTick = s.tick;
                    resends++;
                } else if (!smithingOpen(s) && s.tick - clickTick > 8) {
                    phase = 'use';
                    resends++;
                }
                return;
            }
            if (smithingOpen(s)) {
                clickArgs = chooseMake(left, lastOfBar);
                void makeClick(sdk, seg.product, clickArgs);
                expect = Math.min(clickArgs, left);
                clickTick = s.tick;
                if (firstClick < 0) firstClick = s.tick;
                phase = 'smith';
                return;
            }
            if (s.tick - useTick < 3) return;
            const bar = s.inventory.find(i => nameRe(BARS[seg.product.bar].name).test(i.name));
            const a = anvilLoc(s);
            if (!bar) return finish(new Error(`no ${BARS[seg.product.bar].name} left for ${left} ${seg.product.name}`));
            if (!a) return;
            void sdk.sendUseItemOnLoc(bar.slot, a.x, a.z, a.id);
            useTick = s.tick;
        };
        const unsub = sdk.onStateUpdate(handle);
        const wall = setTimeout(() => finish(new Error('smithSegment: the client stopped publishing')), (seg.count * 12 + STALL_TICKS + 20) * tickMs());
        const cur = sdk.getState();
        if (cur) handle(cur);
    });
}

// ------------------------------------------------------------------ options

export interface InventoryReport {
    session: string | null;
    seq: number;
    supply: 'helper' | 'bank' | 'held';
    plan: string;
    /** The previous inventory's last xp (-1 for the first of an entry). */
    prevLastXp: number;
    /** The trade or bank cycle: first click, screens or bank open, bars in. */
    supplyStart: number;
    supplyOpen: number;
    barsIn: number;
    firstClick: number;
    lastXp: number;
    /** prevLastXp -> firstClick: the turnaround the manifest bounds at 10 ticks. */
    turnaround: number | null;
    tries: number;
    resends: number;
}

/** The per-inventory table the lab and demo drivers print: supply legs, turnaround, retries. */
export function inventoryTable(reports: readonly InventoryReport[]): string {
    const rows = [' seq  supply  plan                                      start  ->open  ->bars  ->click  lastXp  turnaround  tries  resends'];
    for (const r of reports) {
        const opened = r.supplyOpen >= 0 ? r.supplyOpen : r.supplyStart;
        rows.push(`${String(r.seq).padStart(4)}  ${r.supply.padEnd(6)}  ${r.plan.slice(0, 40).padEnd(40)}  ${String(r.supplyStart).padStart(6)}  ${String(r.supplyOpen >= 0 ? r.supplyOpen - r.supplyStart : '-').padStart(6)}  ${String(r.barsIn - opened).padStart(6)}  ${String(r.firstClick - r.barsIn).padStart(7)}  ${String(r.lastXp).padStart(6)}  ${String(r.turnaround ?? '-').padStart(10)}  ${String(r.tries).padStart(5)}  ${String(r.resends).padStart(7)}`);
    }
    return rows.join('\n');
}

export interface SmithingOptions {
    /** The anvil helper's account name (supply 'helper'). */
    giver?: string;
    supply?: 'helper' | 'bank';
    untilLevel?: number;
    plan?: Partial<Omit<PlanConfig, 'untilLevel'>>;
    /** Publish a plan to the helper (run.ts: anvil.ts writeAnvilPlan). */
    announce?: (msg: AnvilPlanMsg) => void | Promise<void>;
    /** Hand the last products back to the helper (or deposit them, banking) before the step ends (default true). */
    returnLast?: boolean;
    /** Ticks to wait for the helper's screens per trade attempt (default 100). */
    openTicks?: number;
    /** Called once per inventory made. */
    onInventory?: (r: InventoryReport) => void;
    log?: (msg: string, data?: Record<string, unknown>) => void;
    /**
     * Dead items SCORED arrives with, handed to the helper in the chain's first trade beside the
     * products (deposited at the first bank visit, banking), so the hammer and bars fit. run.ts
     * supplies it from STEP-MANIFEST.md's inventory ledger (H21a's swap outs); nothing here names an item.
     */
    giveBack?: readonly GiveSpec[];
}

export interface Resolved {
    giver: string | null;
    supply: 'helper' | 'bank';
    plan: PlanConfig;
    announce: (msg: AnvilPlanMsg) => void | Promise<void>;
    returnLast: boolean;
    openTicks: number;
    onInventory: (r: InventoryReport) => void;
    log: (msg: string, data?: Record<string, unknown>) => void;
    giveBack: readonly GiveSpec[];
}

export function resolveOptions(o: SmithingOptions = {}): Resolved {
    const supply = o.supply ?? 'helper';
    if (supply !== 'helper' && supply !== 'bank') throw new Error(`supply must be helper or bank (got ${supply})`);
    const untilLevel = o.untilLevel ?? 99;
    if (!Number.isInteger(untilLevel) || untilLevel < 2 || untilLevel > 99) throw new Error(`untilLevel must be 2-99 (got ${untilLevel})`);
    const giveBack = o.giveBack ?? [];
    for (const g of giveBack) {
        if (g.n !== undefined && g.n !== 'all' && !(Number.isInteger(g.n) && g.n > 0)) throw new Error(`giveBack ${String(g.item)}: n must be a positive integer or 'all' (got ${g.n})`);
    }
    return {
        giver: o.giver ?? null,
        supply,
        plan: { ...PLAN_DEFAULTS, overhead: supply === 'bank' ? 17 : PLAN_DEFAULTS.overhead, ...o.plan, untilLevel },
        announce: o.announce ?? (() => {}),
        returnLast: o.returnLast ?? true,
        openTicks: o.openTicks ?? 100,
        onInventory: o.onInventory ?? (() => {}),
        log: o.log ?? (() => {}),
        giveBack,
    };
}

/** The bars an inventory asks the helper for (debug names), with the hammer when SCORED has none. */
export function giveOf(inv: PlannedInventory, withHammer: boolean): Record<string, number> {
    const give: Record<string, number> = {};
    for (const b of BAR_ORDER) if (inv.bars[b]) give[b] = inv.bars[b]!;
    if (withHammer) Object.assign(give, ANVIL_CONTRACT.hammer);
    return give;
}

/** seq 0 of a session for this state: what run.ts publishes before SCORED reaches the anvil. */
export function firstAnnouncement(s: BotWorldState, session: string, opts: SmithingOptions = {}): AnvilPlanMsg | null {
    const o = resolveOptions(opts);
    // Nothing is made yet: the whole inventory is the baseline. Bars already held are made first
    // (Smithy.inventory), so seq 0 is the inventory after them.
    const held = heldSegments(s, o.plan).reduce((a, g) => a + g.count * itemXp(g.product), 0);
    const fromXp = smithingXp(s) + held;
    if (fromXp >= xpForLevel(o.plan.untilLevel)) return null;
    const inv = nextInventory(s, o.plan, fromXp, countsOf(s.inventory), o.giveBack);
    return inv ? { session, seq: 0, give: giveOf(inv, !hasHammer(s)) } : null;
}

function nextInventory(s: BotWorldState, c: PlanConfig, fromXp: number, baseline: Counts, giveBack: readonly GiveSpec[]): PlannedInventory | null {
    return routePlan(fromXp, { ...c, cap: Math.min(c.cap, barRoom(s, c.cap, baseline, giveBack)) })[0] ?? null;
}

// ------------------------------------------------------------------ the cycle

type Ctx = StepContext<any>;
type CycleSdk = AnvilSdk & Parameters<typeof swap>[0] & Pick<BotSDK, 'sendInteractLoc' | 'sendBankDeposit' | 'sendBankWithdraw' | 'sendClickComponent' | 'sendClickDialog'>;

/**
 * The pipeline shared by one `steps()` chain: the helper session, the inventory announced and
 * not yet received, and the previous inventory's last xp tick (for the turnaround).
 */
export class Smithy {
    session: string | null = null;
    seq = 0;
    /** Announced to the helper and not yet traded. */
    pending: PlannedInventory | null = null;
    prevLastXp = -1;
    finished = false;
    /**
     * The inventory before this chain made anything (handBack), taken on its first entry. A resume in
     * the same process keeps it; a new process takes it afresh, so products held across a process
     * restart stay with SCORED rather than risk handing over something it arrived with.
     */
    baseline: Map<number, number> | null = null;
    /** The give-back has left in a completed supply. A restart keeps it: the items are gone. */
    givenBack = false;

    constructor(readonly o: Resolved) {}

    /** The give-back still to go: all of it until the first completed trade or bank visit. */
    pendingGiveBack(): readonly GiveSpec[] {
        return this.givenBack ? [] : this.o.giveBack;
    }

    /**
     * The baseline, or, in a process that has not entered the step, this state's inventory less any
     * product: SCORED arrives at S25a holding none (the ledger's T24-25 pack), so a product held then is
     * the step's own, made before a restart, and is owed back (each next trade, or the last hand-back).
     */
    baselineFor(s: BotWorldState): Counts {
        return this.baseline ?? entryBaseline(s);
    }

    /** A new entry (a resume after a restart): start a new helper session from the live state. */
    restart(): void {
        this.session = null;
        this.seq = 0;
        this.pending = null;
        this.prevLastXp = -1;
        this.finished = false;
    }

    private sdk(ctx: Ctx): CycleSdk {
        return ctx.sdk as unknown as CycleSdk;
    }

    private state(ctx: Ctx): BotWorldState {
        const s = ctx.sdk.getState();
        if (!s) throw new Error('no state');
        return s;
    }

    private async announce(msg: AnvilPlanMsg): Promise<void> {
        await this.o.announce(msg);
        this.o.log('announce', { ...msg });
    }

    /** Smith until the observed xp reaches `mark` (the last step: the target level, then the hand-back). */
    async until(ctx: Ctx, mark: number, last: boolean): Promise<void> {
        if (this.o.supply === 'helper' && !this.o.giver) throw new Error('supply helper needs a giver');
        const target = xpForLevel(this.o.plan.untilLevel);
        this.baseline ??= entryBaseline(this.state(ctx));
        const reached = () => smithingXp(this.state(ctx)) >= Math.min(mark, target);
        if (!reached()) await this.toTile(ctx);
        while (!reached()) await this.inventory(ctx);
        if (last && smithingXp(this.state(ctx)) >= target) await this.finish(ctx);
    }

    private async toTile(ctx: Ctx): Promise<void> {
        const s = this.state(ctx);
        const p = where(s);
        if (p && cheb(p, SCORED_TILE) <= 1) return;
        const r = await ctx.bot.walkTo(SCORED_TILE.x, SCORED_TILE.z, 0);
        if (!r.success && !(where(this.state(ctx)) && cheb(where(this.state(ctx))!, SCORED_TILE) <= 2)) throw new Error(`walk to the anvil tile: ${r.message}`);
    }

    /** One inventory: supply it (trade, bank, or the bars already held), then make it. */
    private async inventory(ctx: Ctx): Promise<void> {
        const s = this.state(ctx);
        const held = heldSegments(s, this.o.plan);
        let inv: PlannedInventory;
        let supply: SupplyTicks;
        if (held.length) {
            // Resume with bars in hand: make them before the next trade.
            inv = { segs: held, bars: {}, xp: held.reduce((a, g) => a + g.count * itemXp(g.product), 0) };
            for (const g of held) inv.bars[g.product.bar] = (inv.bars[g.product.bar] ?? 0) + g.count * g.product.bars;
            supply = { kind: 'held', start: s.tick, open: s.tick, barsIn: s.tick, tries: 0 };
            if (this.o.supply === 'helper' && !this.pending) await this.announceAfter(ctx, inv);
        } else if (this.o.supply === 'helper') {
            ({ inv, supply } = await this.trade(ctx));
        } else {
            ({ inv, supply } = await this.bank(ctx));
        }
        const made = await this.make(ctx, inv);
        this.o.onInventory({
            session: this.session,
            seq: supply.kind === 'helper' ? this.seq - 1 : this.seq,
            supply: supply.kind,
            plan: describe(inv),
            prevLastXp: this.prevLastXp,
            supplyStart: supply.start,
            supplyOpen: supply.open,
            barsIn: supply.barsIn,
            firstClick: made.firstClick,
            lastXp: made.lastXp,
            turnaround: this.prevLastXp >= 0 ? made.firstClick - this.prevLastXp : null,
            tries: supply.tries,
            resends: made.resends,
        });
        this.prevLastXp = made.lastXp;
    }

    /** Announce the inventory after `inv` (or the collect / stop plan when `inv` reaches the target). */
    private async announceAfter(ctx: Ctx, inv: PlannedInventory): Promise<void> {
        const s = this.state(ctx);
        if (!this.session) {
            this.session = `${ctx.log.runId}/${s.tick}`;
            this.seq = 0;
        }
        const afterXp = smithingXp(s) + inv.xp;
        const next = afterXp >= xpForLevel(this.o.plan.untilLevel) ? null : routePlan(afterXp, this.o.plan)[0] ?? null;
        this.pending = next;
        if (next) await this.announce({ session: this.session, seq: this.seq, give: giveOf(next, false) });
        else if (this.o.returnLast) await this.announce({ session: this.session, seq: this.seq, give: {}, collect: true });
        else await this.announce({ session: this.session, seq: this.seq, give: {}, stop: true });
    }

    private async trade(ctx: Ctx): Promise<{ inv: PlannedInventory; supply: SupplyTicks }> {
        const s0 = this.state(ctx);
        if (!this.session || !this.pending) {
            this.session ??= `${ctx.log.runId}/${s0.tick}`;
            const inv = nextInventory(s0, this.o.plan, smithingXp(s0), this.baselineFor(s0), this.pendingGiveBack());
            if (!inv) throw new Error('nothing left to make');
            this.pending = inv;
            await this.announce({ session: this.session, seq: this.seq, give: giveOf(inv, !hasHammer(s0)) });
        }
        const inv = this.pending;
        const want: WantSpec[] = BAR_ORDER.filter(b => inv.bars[b]).map(b => ({ item: nameRe(BARS[b].name), amount: inv.bars[b]! }));
        let tries = 0;
        let r: SwapResult | null = null;
        let start = -1;
        while (tries < 3) {
            tries++;
            const s = this.state(ctx);
            const wantNow = hasHammer(s) ? want : [...want, { item: HAMMER, amount: 1 }];
            const back = leavingItems(s.inventory, inv.bars, this.baselineFor(s), this.pendingGiveBack());
            r = await swap(this.sdk(ctx), this.o.giver!, giveSpecs(back, s.inventory), wantNow, { closeModals: true, openTicks: this.o.openTicks });
            if (start < 0) start = this.state(ctx).tick - r.ticks;
            if (r.ok) break;
            this.o.log('trade failed', { seq: this.seq, reason: r.reason, ticks: r.ticks });
        }
        if (!r?.ok) throw new Error(`the anvil trade failed ${tries} times (last: ${r?.reason})`);
        if (!this.givenBack && this.o.giveBack.length) this.o.log('given back', { seq: this.seq, items: this.o.giveBack.map(g => String(g.item)) });
        this.givenBack = true;
        const barsIn = this.state(ctx).tick;
        this.seq++;
        await this.announceAfter(ctx, inv);
        return { inv, supply: { kind: 'helper', start, open: r.openTicks >= 0 ? start + r.openTicks : -1, barsIn, tries } };
    }

    private async bank(ctx: Ctx): Promise<{ inv: PlannedInventory; supply: SupplyTicks }> {
        const sdk = this.sdk(ctx);
        const s0 = this.state(ctx);
        const inv = nextInventory(s0, this.o.plan, smithingXp(s0), this.baselineFor(s0), this.pendingGiveBack());
        if (!inv) throw new Error('nothing left to make');
        const start = s0.tick;
        const open = await openBooth(sdk);
        const s = this.state(ctx);
        const specs = BAR_ORDER.filter(b => inv.bars[b]).map(b => ({ item: nameRe(BARS[b].name), n: inv.bars[b]! }));
        if (!hasHammer(s)) specs.push({ item: HAMMER, n: 1 });
        for (const spec of specs) {
            const banked = s.bank.items.filter(i => spec.item.test(i.name)).reduce((a, i) => a + i.count, 0);
            if (banked < spec.n) throw new Error(`the bank holds ${banked} ${spec.item.source}, ${spec.n} needed`);
        }
        // Deposits go out in the same tick, ahead of the withdrawals: the server takes them in order.
        depositEach(sdk, leavingItems(s.inventory, {}, this.baselineFor(s), this.pendingGiveBack()), s.inventory);
        const w = await withdrawMany(sdk, specs);
        if (!w.ok) throw new Error(`withdraw for ${describe(inv)}: ${w.reason ?? 'failed'}`);
        this.givenBack = true;
        return { inv, supply: { kind: 'bank', start, open, barsIn: this.state(ctx).tick, tries: 1 } };
    }

    /**
     * Make the inventory with the level-up watcher on (lib/levelup.ts); it is off for the trade.
     *
     * Level-ups wait out the make chain: each item that crosses a level queues [advancestat] on
     * the engine queue, which runs only when the player is accessible, and a make-5 chain keeps
     * SCORED delayed throughout. When the last item's delay ends they run one per tick, each
     * opening a page that makes SCORED busy. SCORED's trade click closes the open page
     * (OpPlayerHandler -> clearPendingAction -> closeModal), but that tick's engine queue opens
     * the next before the trade interaction runs, so an inventory whose k items crossed a level
     * opens its trade about k ticks later (measured: 5 pages, ticks 79-83, trade open at 84).
     * A continue click there would only add the unlock pages (levelup.rs2 ~levelup_unlocks);
     * the close skips them.
     */
    private async make(ctx: Ctx, inv: PlannedInventory): Promise<SegmentResult> {
        let first = -1;
        let lastXp = -1;
        let resends = 0;
        const watcher = startLevelUpWatcher(ctx.sdk as unknown as Parameters<typeof startLevelUpWatcher>[0]);
        try {
            for (let i = 0; i < inv.segs.length; i++) {
                const g = inv.segs[i]!;
                const lastOfBar = !inv.segs.slice(i + 1).some(x => x.product.bar === g.product.bar);
                const r = await smithSegment(this.sdk(ctx), g, lastOfBar);
                if (first < 0) first = r.firstClick;
                lastXp = r.lastXp;
                resends += r.resends;
            }
        } finally {
            watcher.stop();
        }
        return { firstClick: first, lastXp, resends };
    }

    /** After the target level: hand the last products back (or deposit them), then tell the helper to stop. */
    private async finish(ctx: Ctx): Promise<void> {
        if (this.finished) return;
        const s = this.state(ctx);
        const base = this.baselineFor(s);
        const back = handBack(s.inventory, {}, base);
        if (this.o.returnLast && back.length) {
            if (this.o.supply === 'helper') {
                if (!this.session) {
                    this.session = `${ctx.log.runId}/${s.tick}`;
                    await this.announce({ session: this.session, seq: this.seq, give: {}, collect: true });
                }
                const r = await swap(this.sdk(ctx), this.o.giver!, giveSpecs(back, s.inventory), [], { closeModals: true, openTicks: this.o.openTicks });
                if (!r.ok) throw new Error(`the hand-back trade failed: ${r.reason}`);
                this.seq++;
            } else {
                await openBooth(this.sdk(ctx));
                depositEach(this.sdk(ctx), back, s.inventory);
                const gone = await waitUntil(ctx.sdk, st => handBack(st.inventory, {}, base).length === 0, { maxTicks: 5 });
                if (!gone.ok) throw new Error('the products did not leave the inventory at the bank');
            }
        }
        if (this.o.supply === 'helper' && this.session) await this.announce({ session: this.session, seq: this.seq, give: {}, stop: true });
        this.finished = true;
    }
}

interface SupplyTicks {
    kind: 'helper' | 'bank' | 'held';
    start: number;
    open: number;
    barsIn: number;
    tries: number;
}

/** How many of each `back` id leave, or 'all' when that is every one held (inventory). */
function leaving(back: readonly InventoryItem[], inventory: readonly InventoryItem[]): Map<number, number | 'all'> {
    const out = countsOf(back) as Map<number, number | 'all'>;
    const held = countsOf(inventory);
    for (const [id, n] of out) if (n === held.get(id)) out.set(id, 'all');
    return out;
}

/** One offer per distinct name: Offer-All when every one held goes, else the count (the rest is baseline). */
function giveSpecs(back: readonly InventoryItem[], inventory: readonly InventoryItem[]): GiveSpec[] {
    const n = leaving(back, inventory);
    const names = new Map(back.map(i => [i.name, i.id] as const));
    return [...names].map(([name, id]) => ({ item: nameRe(name), n: n.get(id)! }));
}

/** One deposit per distinct id, Deposit-All unless some of it is baseline, fired without waiting. */
function depositEach(sdk: Pick<BotSDK, 'sendBankDeposit'>, back: readonly InventoryItem[], inventory: readonly InventoryItem[]): void {
    const n = leaving(back, inventory);
    const seen = new Set<number>();
    for (const i of back) {
        if (seen.has(i.id)) continue;
        seen.add(i.id);
        const amount = n.get(i.id)!;
        void sdk.sendBankDeposit(i.slot, amount === 'all' ? -1 : amount);
    }
}

/** Re-click the Varrock west booth every tick until the bank is open with its items listed; returns the tick it opened. */
export function openBooth(sdk: StateSource & Pick<BotSDK, 'sendInteractLoc'>, maxTicks = 40): Promise<number> {
    return new Promise((resolve, reject) => {
        let lastTick = -1;
        let clicks = 0;
        let done = false;
        const finish = (tick: number | Error) => {
            if (done) return;
            done = true;
            unsub();
            clearTimeout(wall);
            if (tick instanceof Error) reject(tick);
            else resolve(tick);
        };
        const handle = (st: BotWorldState) => {
            // The bank's item list can arrive a frame after the modal.
            if (st.bank.isOpen && st.bank.items.length) return finish(st.tick);
            if (st.tick === lastTick || st.bank.isOpen) return;
            lastTick = st.tick;
            if (++clicks > maxTicks) return finish(new Error(`the Varrock west bank did not open in ${maxTicks} ticks`));
            const b = boothOf(st);
            if (b) void sdk.sendInteractLoc(b.loc.x, b.loc.z, b.loc.id, b.op);
        };
        const unsub = sdk.onStateUpdate(handle);
        const wall = setTimeout(() => finish(new Error('openBooth: the client stopped publishing')), (maxTicks + 10) * tickMs());
        const cur = sdk.getState();
        if (cur) handle(cur);
    });
}

// ------------------------------------------------------------------ steps

export interface SmithingStepsInfo {
    plan: PlannedInventory[];
    marks: number[];
}

/** The plan from level 1 the steps are cut from, and each step's xp milestone. */
export function stepPlan(opts: SmithingOptions = {}): SmithingStepsInfo {
    const o = resolveOptions(opts);
    const plan = routePlan(0, o.plan);
    return { plan, marks: milestones(plan, 0, o.plan) };
}

/** S25a as one logout-safe step per inventory of the plan from level 1 (31 at the defaults). */
export function steps(opts: SmithingOptions = {}): Step<any>[] {
    const o = resolveOptions(opts);
    const { plan, marks } = stepPlan(opts);
    const smithy = new Smithy(o);
    const n = plan.length;
    const target = xpForLevel(o.plan.untilLevel);
    return plan.map((inv, k): Step<any> => {
        const mark = marks[k]!;
        const last = k === n - 1;
        const passed = (s: BotWorldState) => smithingXp(s) >= Math.min(mark, target);
        // The last inventory's hand-back is owed where it runs, at the anvil: a hand-back trade that
        // failed leaves the products held there, and the step is not done until they go. Away from the
        // anvil the step is done at its xp whatever the pack holds, as a milestone must stay done.
        const owedBack = (s: BotWorldState) => last && o.returnLast && nearAnvil(s) && handBack(s.inventory, {}, smithy.baselineFor(s)).length > 0;
        return {
            name: `S25a smithing ${String(k + 1).padStart(2, '0')}/${n} ${describe(inv)}`,
            preconditions: s => {
                if (passed(s) && !last) return true;
                if (!s.inGame || !s.player) return 'not in game';
                if (last && passed(s) && (!o.returnLast || handBack(s.inventory, {}, smithy.baselineFor(s)).length === 0)) return true;
                if (!nearAnvil(s)) return `not within ${NEAR} tiles of the Varrock west anvil (at ${s.player.worldX},${s.player.worldZ},${s.player.level})`;
                if (o.supply === 'helper' && !o.giver) return 'supply helper needs a giver';
                return slotReason(s, inv, smithy.baselineFor(s), smithy.pendingGiveBack()) ?? true;
            },
            run: ctx => smithy.until(ctx, mark, last),
            resume: ctx => {
                smithy.restart();
                return smithy.until(ctx, mark, last);
            },
            postconditions: s => {
                if (!passed(s)) return `Smithing ${smithingXp(s)} xp, below this inventory's ${mark}`;
                const held = handBack(s.inventory, {}, smithy.baselineFor(s)).length;
                if (last && o.returnLast && held) return `${held} products still held after the last inventory`;
                return true;
            },
            logoutSafe: true,
            done: ({ state }) => passed(state) && !owedBack(state),
            inProgress: ({ state }) => !passed(state) && nearAnvil(state) && (smithingXp(state) > 0 || Object.keys(heldBars(state)).length > 0),
        };
    });
}
