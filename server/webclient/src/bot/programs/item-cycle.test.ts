import { describe, expect, test } from 'bun:test';

import '../../lite/test-support/browser-globals.js';

import { createItemCycle, keepCovers, keepNeed, planMixedLoad, planMixes, withdrawAmounts, type CycleRecipe, type ItemCycleResult, type ItemCycleShared } from './item-cycle.js';
import { Harness, makeState, type Sent } from './testkit.js';

// obj ids (server/content/pack/obj.pack); a note is its item's id + 1
const GUAM_UNF = 91;
const IRIT_UNF = 101;
const EYE = 221;
const ATTACK = 121;
const SUPER_ATTACK = 145;
const CHISEL = 1755;
const UNCUT_OPAL = 1625;
const OPAL = 1609;
const CRUSHED = 1633;
const HEADLESS = 53;
const RUNE_HEADS = 44;
const RUNE_ARROW = 892;
const NEEDLE = 1733;
const THREAD = 1734;
const HARD_LEATHER = 1743;
const HARD_BODY = 1131;
// helpers/jeweller.ts GEM: uncut -> cut
const UNCUT_SAPPHIRE = 1623;
const SAPPHIRE = 1607;
const UNCUT_EMERALD = 1621;
const EMERALD = 1605;
const UNCUT_RUBY = 1619;
const RUBY = 1603;
const UNCUT_DIAMOND = 1617;
const DIAMOND = 1601;
/** Noted unfermented wine (wine-common.ts ITEM.wineNote): held through W1, never a recipe's. */
const WINE_NOTE = 1996;

const attack: CycleRecipe = { name: 'attack', level: 3, xp: 25, a: GUAM_UNF, b: EYE, products: [ATTACK] };
const superAttack: CycleRecipe = { name: 'superattack', level: 45, xp: 100, a: IRIT_UNF, b: EYE, products: [SUPER_ATTACK] };
const opal: CycleRecipe = { name: 'opal', level: 1, xp: 15, a: UNCUT_OPAL, tool: CHISEL, products: [OPAL, CRUSHED] };
const runeArrow: CycleRecipe = { name: 'runearrow', level: 75, xp: 187.5, a: HEADLESS, b: RUNE_HEADS, products: [RUNE_ARROW] };
/** leather.rs2 @craft_leather(hardleather_body): needle on hard leather, a thread worn out every 5th body. */
const body: CycleRecipe = { name: 'hardleather_body', level: 28, xp: 35, a: HARD_LEATHER, tool: NEEDLE, keep: [{ id: THREAD, every: 5 }], products: [HARD_BODY] };
/** The cooking windows' gems (uncut_gem.rs2, gem.dbrow), listed low xp first so the program must sort them. */
const GEMS: CycleRecipe[] = [
    { name: 'sapphire', level: 20, xp: 50, a: UNCUT_SAPPHIRE, tool: CHISEL, products: [SAPPHIRE] },
    { name: 'emerald', level: 27, xp: 67.5, a: UNCUT_EMERALD, tool: CHISEL, products: [EMERALD] },
    { name: 'ruby', level: 34, xp: 85, a: UNCUT_RUBY, tool: CHISEL, products: [RUBY] },
    { name: 'diamond', level: 43, xp: 107.5, a: UNCUT_DIAMOND, tool: CHISEL, products: [DIAMOND] }
];
const byXpDesc = [...GEMS].sort((x, y) => y.xp - x.xp);

const BOOTH = { x: 3186, z: 3436, id: 2213, option: 2 };
const STACKABLE = new Set([HEADLESS, RUNE_HEADS, RUNE_ARROW, GUAM_UNF + 1, IRIT_UNF + 1, EYE + 1, NEEDLE, THREAD, WINE_NOTE]);
const NOTES = new Map([[GUAM_UNF + 1, GUAM_UNF], [IRIT_UNF + 1, IRIT_UNF], [EYE + 1, EYE]]);

/** speedrun/lib/xp.ts: LEVEL_XP[level] in game xp. */
const LEVEL_XP: number[] = (() => {
    const table = [0, 0];
    let acc = 0;
    for (let level = 1; level < 99; level++) {
        acc += Math.floor(level + Math.pow(2, level / 10) * 300);
        table[level + 1] = Math.floor(acc / 4);
    }
    return table;
})();
const levelOf = (xp: number) => {
    let l = 1;
    while (l < 99 && LEVEL_XP[l + 1]! <= xp) l++;
    return l;
};

interface Obj {
    id: number;
    count: number;
}

interface WorldOpts {
    recipes: CycleRecipe[];
    mode: 'pair' | 'tool' | 'stack';
    xp: number;
    inventory?: Array<Obj | null>;
    bank?: Obj[];
    bankOpen?: boolean;
    params?: Record<string, unknown>;
    /** Tool mode: whether the n-th cut (from 0) smashes into crushed gemstone. */
    smash?: (n: number) => boolean;
    /** Called after the server applies a close: may disturb the inventory (drift). */
    onClose?: (closeNumber: number, w: World) => void;
    /** No booth loc in the scene. */
    noBooth?: boolean;
    /** Give the booth its stand tile (3185,3436), so the click may go unrouted (default true). */
    stand?: boolean;
    /** Where the player stands (default the stand tile). */
    at?: { x: number; z: number };
    /** The client finds the stand out of reach and refuses every unrouted click. */
    refuseUnrouted?: boolean;
    /** Tool mode with a worn keep item: the content's wear counter at the start (%thread_used, 0-4). */
    wear?: number;
}

const STAND = { x: 3185, z: 3436 };

/** User events a packet costs on the browser client: a routed loc click is MOVE_OPCLICK + OPLOC. */
const eventsOf = (a: { type: string; route?: boolean }) => (a.type === 'interactLoc' && a.route !== false ? 2 : 1);

/**
 * A deterministic model of the booth (herblore.md section 4, read from the engine).
 * Each tick the server decodes at most 5 user events of what the page sent, in order,
 * leaving the rest for the next tick (a routed booth click is two: its MOVE_OPCLICK can be
 * decoded on one tick and its OPLOC on the next). Of what it decodes: an OPHELDU deletes the first matching items and adds its product to the first
 * free slot and closes an open chat page; a deposit-All moves every item of that id
 * (a note banks unnoted); a withdraw moves up to the amount into free slots; a close
 * shuts the bank and drops emptied stacks, which shifts the later bank slots. Then the
 * player's turn: a queued level-up page (one per xp drop that raised the level) pops
 * when none is open and holds a pending booth interaction; otherwise the booth click
 * opens the bank.
 */
class World {
    readonly h = new Harness('item-cycle', createItemCycle);
    inv: Array<Obj | null>;
    bank: Obj[];
    bankOpen: boolean;
    xp: number;
    tick = 100;
    pagesQueued = 0;
    pageOpen = false;
    cuts = 0;
    closes = 0;
    wear: number;
    ignored: string[] = [];
    private pending: Sent[] = [];
    /** Packets the server has not decoded yet, with the user events each still costs. */
    private queue: Array<{ action: Sent['action']; events: number }> = [];

    constructor(readonly o: WorldOpts) {
        this.inv = Array.from({ length: 28 }, (_, i) => o.inventory?.[i] ?? null);
        this.bank = (o.bank ?? []).map(b => ({ ...b }));
        this.bankOpen = o.bankOpen ?? false;
        this.xp = o.xp;
        this.wear = o.wear ?? 0;
        // the browser client: a routed click reports its two events; an unrouted one may be refused
        this.h.respond = a => {
            if (a.type !== 'interactLoc') return undefined;
            if (a.route === false) return o.refuseUnrouted ? { success: false, message: 'not_in_reach', reason: 'not_in_reach' } : undefined;
            return { success: true, message: 'ok', userEvents: 2 };
        };
    }

    state() {
        return makeState({
            tick: this.tick,
            x: this.o.at?.x ?? STAND.x,
            z: this.o.at?.z ?? STAND.z,
            skills: { [this.skill]: { xp: this.xp, level: levelOf(this.xp) } },
            inventory: this.inv.map(o => (o ? { name: `obj ${o.id}`, id: o.id, count: o.count } : null)),
            bank: { isOpen: this.bankOpen, items: this.bank },
            dialogOpen: this.pageOpen,
            locs: this.o.noBooth ? [] : [{ id: BOOTH.id, x: BOOTH.x, z: BOOTH.z, name: 'Bank booth', options: ['Use', 'Use-quickly'] }]
        });
    }

    get skill() {
        return this.o.mode === 'tool' ? 'Crafting' : this.o.mode === 'stack' ? 'Fletching' : 'Herblore';
    }

    start(params: Record<string, unknown> = {}) {
        const booth = this.o.stand === false ? BOOTH : { ...BOOTH, stand: STAND };
        const base: Record<string, unknown> = { mode: this.o.mode, skill: this.skill.toLowerCase(), recipes: this.o.recipes, untilLevel: 99, ...(this.o.mode === 'stack' ? {} : { booth }) };
        return this.h.start('item-cycle', { ...base, ...this.o.params, ...params }, this.state());
    }

    /** Run until the program ends or `ticks` pass. */
    run(ticks: number) {
        for (let i = 0; i < ticks; i++) {
            this.tick++;
            this.apply(this.pending);
            this.pending = this.h.step(this.state());
            if (this.h.status.phase !== 'running') break;
        }
        return this.h.status;
    }

    private firstFree(): number {
        return this.inv.findIndex(o => o === null);
    }

    private firstOf(id: number): number {
        return this.inv.findIndex(o => o?.id === id);
    }

    private addInv(id: number, count = 1): void {
        if (STACKABLE.has(id)) {
            const at = this.firstOf(id);
            if (at >= 0) {
                this.inv[at]!.count += count;
                return;
            }
            const free = this.firstFree();
            if (free >= 0) this.inv[free] = { id, count };
            return;
        }
        for (let k = 0; k < count; k++) {
            const free = this.firstFree();
            if (free < 0) return;
            this.inv[free] = { id, count: 1 };
        }
    }

    private gain(base: number): void {
        const before = levelOf(this.xp);
        this.xp += base * 25;
        if (levelOf(this.xp) > before) this.pagesQueued++;
    }

    private apply(packets: Sent[]): void {
        this.queue.push(...packets.map(p => ({ action: p.action, events: eventsOf(p.action as { type: string; route?: boolean }) })));
        const decoded: Sent['action'][] = [];
        let used = 0;
        while (this.queue.length) {
            const q = this.queue[0]!;
            if (used + q.events <= 5) {
                used += q.events;
                decoded.push(q.action);
                this.queue.shift();
            } else {
                // a routed click split across ticks: its MOVE_OPCLICK now, its OPLOC next tick
                if (q.events === 2 && used < 5) q.events = 1;
                break;
            }
        }
        let interact = false;
        for (const a of decoded) {
            switch (a.type) {
                case 'useItemOnItem': {
                    this.pageOpen = false;
                    const src = this.inv[a.sourceSlot];
                    const dst = this.inv[a.targetSlot];
                    if (!src || !dst) {
                        this.ignored.push(`use ${a.sourceSlot}->${a.targetSlot}: empty slot`);
                        break;
                    }
                    const level = levelOf(this.xp);
                    if (this.o.mode === 'stack') {
                        const r = this.o.recipes.find(x => x.b === src.id && x.a === dst.id && x.level <= level);
                        if (!r) break;
                        const k = Math.min(r.per ?? 15, src.count, dst.count);
                        for (const o of [src, dst]) o.count -= k;
                        for (const slot of [a.sourceSlot, a.targetSlot]) if (this.inv[slot]!.count <= 0) this.inv[slot] = null;
                        this.addInv(r.products[0]!, k);
                        this.gain((r.xp * k) / (r.per ?? 15));
                        break;
                    }
                    if (this.o.mode === 'tool') {
                        const r = this.o.recipes.find(x => x.tool === src.id && x.a === dst.id && x.level <= level);
                        if (!r) break;
                        // leather.rs2: no thread opens an objbox and makes nothing
                        const worn = r.keep?.find(k => k.every);
                        if (worn && this.firstOf(worn.id) < 0) {
                            this.pageOpen = true;
                            this.ignored.push(`use ${a.sourceSlot}->${a.targetSlot}: objbox, no obj ${worn.id}`);
                            break;
                        }
                        this.inv[this.firstOf(r.a)] = null;
                        const smashed = this.o.smash?.(this.cuts++) ?? false;
                        this.addInv(smashed ? r.products[1]! : r.products[0]!);
                        if (!smashed) this.gain(r.xp);
                        if (worn && ++this.wear > worn.every! - 1) {
                            this.wear = 0;
                            const at = this.firstOf(worn.id);
                            if (--this.inv[at]!.count <= 0) this.inv[at] = null;
                        }
                        break;
                    }
                    const r = this.o.recipes.find(x => x.b === src.id && x.a === dst.id && x.level <= level);
                    if (!r) {
                        this.ignored.push(`use ${a.sourceSlot}->${a.targetSlot}: no recipe for ${src.id} on ${dst.id}`);
                        break;
                    }
                    this.inv[this.firstOf(r.a)] = null;
                    this.inv[this.firstOf(r.b!)] = null;
                    this.addInv(r.products[0]!);
                    this.gain(r.xp);
                    break;
                }
                case 'interactLoc':
                    this.pageOpen = false;
                    if (a.locId === BOOTH.id) interact = true;
                    break;
                case 'clickDialogOption':
                    this.pageOpen = false;
                    break;
                case 'bankDeposit': {
                    const it = this.inv[a.slot];
                    if (!this.bankOpen || !it) break;
                    let n = 0;
                    for (let i = 0; i < 28; i++) {
                        if (this.inv[i]?.id === it.id) {
                            n += this.inv[i]!.count;
                            this.inv[i] = null;
                        }
                    }
                    const id = NOTES.get(it.id) ?? it.id;
                    const stack = this.bank.find(b => b.id === id);
                    if (stack) stack.count += n;
                    else this.bank.push({ id, count: n });
                    break;
                }
                case 'bankWithdraw': {
                    const b = this.bank[a.slot];
                    if (!this.bankOpen || !b) break;
                    const want = a.amount === -1 ? b.count : Math.min(a.amount, b.count);
                    let moved = 0;
                    if (STACKABLE.has(b.id)) {
                        this.addInv(b.id, want);
                        moved = want;
                    } else {
                        while (moved < want && this.firstFree() >= 0) {
                            this.addInv(b.id);
                            moved++;
                        }
                    }
                    b.count -= moved;
                    break;
                }
                case 'closeModal':
                    if (this.bankOpen) {
                        this.bankOpen = false;
                        this.bank = this.bank.filter(b => b.count > 0);
                        this.o.onClose?.(++this.closes, this);
                    }
                    break;
                default:
                    this.ignored.push(a.type);
            }
        }
        // the player's turn: a queued level-up page holds the booth interaction
        if (this.pagesQueued > 0 && !this.pageOpen) {
            this.pageOpen = true;
            this.pagesQueued--;
        } else if (interact && !this.pageOpen) {
            this.bankOpen = true;
        }
    }

    /** Packets per tick, by tick. */
    perTick(): number[] {
        const by = new Map<number, number>();
        for (const s of this.h.sent) by.set(s.tick, (by.get(s.tick) ?? 0) + 1);
        return [...by.values()];
    }

    sentAt(tick: number): string[] {
        return this.h.sent.filter(s => s.tick === tick).map(({ action: a }) => {
            if (a.type === 'bankWithdraw') return `withdraw ${this.slotNote(a.slot)} ${a.amount}`;
            if (a.type === 'bankDeposit') return `deposit ${a.slot}`;
            if (a.type === 'useItemOnItem') return `use ${a.sourceSlot}->${a.targetSlot}`;
            return a.type;
        });
    }

    private slotNote(slot: number): string {
        return `#${slot}`;
    }

    get shared(): ItemCycleShared {
        return this.h.status.shared as ItemCycleShared;
    }

    get result(): ItemCycleResult {
        return this.h.status.result as ItemCycleResult;
    }
}

const inv14 = (a: number, b: number): Array<Obj | null> => [...Array(14).fill({ id: a, count: 1 }), ...Array(14).fill({ id: b, count: 1 })].map(o => ({ ...o }));

function expectBudget(w: World): void {
    expect(Math.max(0, ...w.perTick())).toBeLessThanOrEqual(5);
}

describe('planMixes', () => {
    const item = (slot: number, id: number) => ({ slot, id, name: `obj ${id}`, count: 1, optionsWithIndex: [] });
    test('pair: B@14+i on A@i, and B after A when a reset withdrew n < 14', () => {
        const full = [...Array(14).keys()].map(i => item(i, GUAM_UNF)).concat([...Array(14).keys()].map(i => item(14 + i, EYE)));
        expect(planMixes(full, attack, 'pair')).toEqual([...Array(14).keys()].map(i => ({ src: 14 + i, dst: i })));
        const reset = [...Array(13).keys()].map(i => item(i, GUAM_UNF)).concat([...Array(13).keys()].map(i => item(13 + i, EYE)));
        expect(planMixes(reset, attack, 'pair')).toEqual([...Array(13).keys()].map(i => ({ src: 13 + i, dst: i })));
        expect(planMixes(full, attack, 'pair', 3)).toHaveLength(3);
    });

    test('pair: no blind list when a B lies below an A or a hole lies below an A', () => {
        const swapped = [item(0, EYE), item(1, GUAM_UNF), item(2, GUAM_UNF), item(3, EYE)];
        expect(planMixes(swapped, attack, 'pair')).toBeNull();
        const holed = [item(0, GUAM_UNF), item(2, GUAM_UNF), item(14, EYE), item(15, EYE)];
        expect(planMixes(holed, attack, 'pair')).toBeNull();
        expect(planMixes([item(0, GUAM_UNF)], attack, 'pair')).toBeNull();
    });

    test('tool: the tool on every A, all A below the first hole', () => {
        const gems = [item(0, CHISEL), item(1, UNCUT_OPAL), item(2, UNCUT_OPAL)];
        expect(planMixes(gems, opal, 'tool')).toEqual([{ src: 0, dst: 1 }, { src: 0, dst: 2 }]);
        expect(planMixes([item(0, CHISEL), item(2, UNCUT_OPAL)], opal, 'tool')).toBeNull();
        expect(planMixes([item(1, UNCUT_OPAL)], opal, 'tool')).toBeNull();
    });

    test('withdrawAmounts: All when it gives n, else 10s, a 5, then 1s (never the count dialog)', () => {
        expect(withdrawAmounts(14, 14)).toEqual([-1]);
        expect(withdrawAmounts(14, 100)).toEqual([10, 1, 1, 1, 1]);
        expect(withdrawAmounts(13, 20)).toEqual([10, 1, 1, 1]);
        expect(withdrawAmounts(26, 27)).toEqual([10, 10, 5, 1]);
        expect(withdrawAmounts(1, -2)).toEqual([1]);
    });
});

describe('item-cycle pair mode', () => {
    test('reset visit, then a 4-tick cycle: 5, 5, 4 + booth, 4 bank packets', () => {
        const w = new World({ mode: 'pair', recipes: [attack], xp: LEVEL_XP[20]!, bank: [{ id: GUAM_UNF, count: 100 }, { id: EYE, count: 100 }] });
        w.start();
        w.run(16);
        expect(w.h.status.phase).toBe('running');
        expect(w.ignored).toEqual([]);
        // T101 booth; T102 bank seen: 14 A by 10+1x4; T103 All B, close; T104 refill
        expect(w.sentAt(101)).toEqual(['interactLoc']);
        expect(w.sentAt(102)).toEqual(['withdraw #0 10', 'withdraw #0 1', 'withdraw #0 1', 'withdraw #0 1', 'withdraw #0 1']);
        expect(w.sentAt(103)).toEqual(['withdraw #1 -1', 'closeModal']);
        expect(w.sentAt(104)).toEqual(['use 14->0', 'use 15->1', 'use 16->2', 'use 17->3', 'use 18->4']);
        expect(w.sentAt(105)).toHaveLength(5);
        expect(w.sentAt(106)).toEqual(['use 24->10', 'use 25->11', 'use 26->12', 'use 27->13', 'interactLoc']);
        expect(w.h.status.counters.levelups).toBeGreaterThan(0);
        expectBudget(w);
    });

    test('canonical visit on the bank-open tick: withdraw-All B, deposit-All the product, withdraw-All A, close', () => {
        // just past 90: no level-up page holds the booth in three inventories (a level there is about 41,000 game xp)
        const w = new World({ mode: 'pair', recipes: [attack], xp: LEVEL_XP[90]! + 1, inventory: inv14(GUAM_UNF, EYE), bank: [{ id: GUAM_UNF, count: 100 }, { id: EYE, count: 100 }] });
        w.start();
        w.run(12);
        // started canonical: the first visit sees 14 potions in 0-13 only after the first inventory
        const visits = w.shared.visits;
        expect(visits.map(v => v.kind)).toEqual(['reset', 'canonical', 'canonical']);
        const canon = visits[1]!.seen;
        expect(w.sentAt(canon)).toEqual(['withdraw #1 -1', 'deposit 0', 'withdraw #0 -1', 'closeModal']);
        expect(w.sentAt(canon + 1)).toHaveLength(5);
        expect(w.sentAt(canon + 3)).toEqual(['use 24->10', 'use 25->11', 'use 26->12', 'use 27->13', 'interactLoc']);
        expect(visits[2]!.seen - visits[1]!.seen).toBe(4);
        expect(w.shared.sendsPerTick[5]).toBeGreaterThan(0);
        expectBudget(w);
    });

    test('reset visit with n = 13 (the remainder), then out of supplies with the counts', () => {
        const w = new World({ mode: 'pair', recipes: [attack], xp: LEVEL_XP[60]!, bank: [{ id: GUAM_UNF, count: 13 }, { id: EYE, count: 20 }] });
        w.start();
        const st = w.run(20);
        expect(w.sentAt(102)).toEqual(['withdraw #0 -1', 'withdraw #1 10', 'withdraw #1 1', 'withdraw #1 1', 'withdraw #1 1']);
        expect(w.sentAt(103)).toEqual(['closeModal']);
        expect(w.sentAt(104)).toEqual(['use 13->0', 'use 14->1', 'use 15->2', 'use 16->3', 'use 17->4']);
        expect(w.sentAt(106)).toEqual(['use 23->10', 'use 24->11', 'use 25->12', 'interactLoc']);
        expect(st.phase).toBe('fault');
        expect(st.fault).toContain('out of supplies');
        const detail = (st.faultDetail as { detail: { supplies: Record<string, { level: number; a: number; b: number }> } }).detail;
        expect(detail.supplies.attack).toEqual({ level: 3, a: 0, b: 7 });
        expect((st.faultDetail as ItemCycleResult).actions).toBe(13);
        expectBudget(w);
    });

    test('recipe switch at a band boundary: the next canonical visit takes the new pair, after the emptied stack shifts the bank', () => {
        // two attack potions (625 game xp each) take Herblore 44 to 45, so the second visit is at 45
        const w = new World({ mode: 'pair', recipes: [attack, superAttack], xp: LEVEL_XP[45]! - 2 * 625 + 1, bank: [{ id: GUAM_UNF, count: 14 }, { id: IRIT_UNF, count: 28 }, { id: EYE, count: 50 }] });
        expect(levelOf(w.xp)).toBe(44);
        w.start();
        w.run(14);
        const [first, second] = w.shared.visits;
        expect(first!.recipe).toBe('attack');
        expect(second).toMatchObject({ kind: 'canonical', recipe: 'superattack' });
        // guam's emptied stack left the bank on close: irit is slot 0 now, eye slot 1
        expect(w.sentAt(second!.seen)).toEqual(['withdraw #1 -1', 'deposit 0', 'withdraw #0 -1', 'closeModal']);
        expect(w.ignored).toEqual([]);
        expect(w.h.status.counters.actions).toBeGreaterThan(14);
        expect((w.h.runtime.status()!.shared as ItemCycleShared).recipe).toBe('superattack');
    });

    test('a level-up page during opening: continue, then re-click the booth until the bank opens', () => {
        const w = new World({ mode: 'pair', recipes: [attack], xp: LEVEL_XP[5]!, inventory: inv14(GUAM_UNF, EYE), bank: [{ id: GUAM_UNF, count: 100 }, { id: EYE, count: 100 }] });
        w.start();
        w.run(30);
        const continues = w.h.sent.filter(s => s.action.type === 'clickDialogOption');
        const clicks = w.h.sent.filter(s => s.action.type === 'interactLoc');
        expect(continues.length).toBeGreaterThan(0);
        // every continue goes out ahead of a booth click on the same tick
        for (const c of continues) expect(w.sentAt(c.tick).slice(-2)).toEqual(['clickDialogOption', 'interactLoc']);
        expect(clicks.length).toBeGreaterThan(w.shared.visits.length);
        expect(w.shared.visits.length).toBeGreaterThanOrEqual(2);
        expect(w.h.status.marks.levelup!.count).toBeGreaterThan(0);
        expectBudget(w);
    });

    test('drift after a canonical visit leads to a reset visit; the run carries on', () => {
        const w = new World({
            mode: 'pair', recipes: [attack], xp: LEVEL_XP[60]!, inventory: inv14(GUAM_UNF, EYE), bank: [{ id: GUAM_UNF, count: 200 }, { id: EYE, count: 200 }],
            onClose: (n, world) => {
                if (n === 2) [world.inv[0], world.inv[27]] = [world.inv[27]!, world.inv[0]!];
            }
        });
        w.start();
        w.run(30);
        expect(w.h.status.phase).toBe('running');
        expect(w.h.status.counters.drift).toBe(1);
        expect(w.shared.visits.map(v => v.kind).slice(0, 4)).toEqual(['reset', 'canonical', 'reset', 'canonical']);
        expect(w.ignored).toEqual([]);
        expectBudget(w);
    });

    test('a second drift, after the reset visit, faults rather than mixing wrong slots', () => {
        const w = new World({
            mode: 'pair', recipes: [attack], xp: LEVEL_XP[60]!, inventory: inv14(GUAM_UNF, EYE), bank: [{ id: GUAM_UNF, count: 200 }, { id: EYE, count: 200 }],
            onClose: (n, world) => {
                if (n === 2 || n === 3) [world.inv[0], world.inv[27]] = [world.inv[27]!, world.inv[0]!];
            }
        });
        w.start();
        const st = w.run(30);
        expect(st.phase).toBe('fault');
        expect(st.fault).toBe('layout drift after a reset visit');
        expect(w.ignored).toEqual([]);
    });

    test('out of supplies at the first visit: the fault carries the counts', () => {
        const w = new World({ mode: 'pair', recipes: [attack, superAttack], xp: LEVEL_XP[50]!, bank: [{ id: EYE, count: 40 }] });
        w.start();
        const st = w.run(5);
        expect(st.phase).toBe('fault');
        expect(st.fault).toContain('out of supplies');
        expect((st.faultDetail as { detail: { supplies: unknown } }).detail.supplies).toEqual({ attack: { level: 3, a: 0, b: 40 }, superattack: { level: 45, a: 0, b: 40 } });
    });

    test('banknotes in the inventory (the H21e hand-off): deposit, read the bank a tick later, then withdraw', () => {
        const w = new World({ mode: 'pair', recipes: [attack, superAttack], xp: LEVEL_XP[60]!, inventory: [{ id: IRIT_UNF + 1, count: 30 }, { id: EYE + 1, count: 30 }, { id: GUAM_UNF + 1, count: 5 }] });
        w.start();
        w.run(8);
        expect(w.sentAt(102)).toEqual(['deposit 0', 'deposit 1', 'deposit 2']);
        // the bank now holds irit 0, eye 1, guam 2 (in deposit order)
        expect(w.sentAt(103)).toEqual(['withdraw #0 10', 'withdraw #0 1', 'withdraw #0 1', 'withdraw #0 1', 'withdraw #0 1']);
        expect(w.sentAt(104)).toEqual(['withdraw #1 -1', 'closeModal']);
        expect(w.sentAt(105)).toHaveLength(5);
        expect(w.shared.visits[0]).toMatchObject({ kind: 'reset', recipe: 'superattack', n: 14 });
        expect(w.ignored).toEqual([]);
    });

    test('resume mid-inventory: a reset visit banks the potions and both partial stacks', () => {
        const mid: Array<Obj | null> = [...Array(7).fill({ id: ATTACK, count: 1 }), ...Array(7).fill({ id: GUAM_UNF, count: 1 }), ...Array(7).fill(null), ...Array(7).fill({ id: EYE, count: 1 })].map(o => (o ? { ...o } : null));
        const w = new World({ mode: 'pair', recipes: [attack], xp: LEVEL_XP[60]!, inventory: mid, bank: [{ id: GUAM_UNF, count: 50 }, { id: EYE, count: 50 }] });
        w.start();
        w.run(8);
        expect(w.sentAt(102)).toEqual(['deposit 0', 'deposit 7', 'deposit 21', 'withdraw #0 10', 'withdraw #0 1']);
        expect(w.shared.visits[0]).toMatchObject({ kind: 'reset', recipe: 'attack', n: 14 });
        expect(w.sentAt(105)).toHaveLength(5);
        expect(w.ignored).toEqual([]);
    });

    test('the target level ends the run done, with the result', () => {
        const w = new World({ mode: 'pair', recipes: [attack], xp: LEVEL_XP[60]!, inventory: inv14(GUAM_UNF, EYE), bank: [{ id: GUAM_UNF, count: 200 }, { id: EYE, count: 200 }], params: { untilLevel: 63 } });
        w.start();
        const st = w.run(200);
        expect(st.phase).toBe('done');
        expect(w.result.ended).toBe('target');
        expect(levelOf(w.xp)).toBe(63);
        expect(w.result.actions).toBe(w.result.byRecipe.attack);
        expect(w.result.visits).toBeGreaterThan(1);
        expectBudget(w);
    });

    test('with no stand tile the routed click is two events: 4 mixes alone, the click next tick, a 5-tick cycle', () => {
        const w = new World({ mode: 'pair', recipes: [attack], xp: LEVEL_XP[90]! + 1, inventory: inv14(GUAM_UNF, EYE), bank: [{ id: GUAM_UNF, count: 100 }, { id: EYE, count: 100 }], stand: false });
        w.start();
        w.run(16);
        const [, second, third] = w.shared.visits;
        expect(w.sentAt(second!.seen - 2)).toEqual(['use 24->10', 'use 25->11', 'use 26->12', 'use 27->13']);
        expect(w.sentAt(second!.seen - 1)).toEqual(['interactLoc']);
        expect(third!.seen - second!.seen).toBe(5);
        expect(w.h.status.counters.routedClicks).toBeGreaterThan(0);
        // the program kept to 5 events a tick, so the runtime saw no tick over budget
        expect(w.h.status.counters.overBudget).toBeUndefined();
        expect(w.ignored).toEqual([]);
    });

    test('on the stand tile the click goes unrouted and rides with the last 4 mixes: a 4-tick cycle', () => {
        const w = new World({ mode: 'pair', recipes: [attack], xp: LEVEL_XP[90]! + 1, inventory: inv14(GUAM_UNF, EYE), bank: [{ id: GUAM_UNF, count: 100 }, { id: EYE, count: 100 }] });
        w.start();
        w.run(16);
        const [, second, third] = w.shared.visits;
        const clicks = w.h.sent.filter(s => s.action.type === 'interactLoc');
        expect(clicks.length).toBeGreaterThan(1);
        expect(clicks.every(s => (s.action as { route?: boolean }).route === false)).toBe(true);
        expect(third!.seen - second!.seen).toBe(4);
        expect(w.h.status.counters.routedClicks).toBeUndefined();
    });

    test('off the stand tile the click is routed', () => {
        const w = new World({ mode: 'pair', recipes: [attack], xp: LEVEL_XP[90]! + 1, inventory: inv14(GUAM_UNF, EYE), bank: [{ id: GUAM_UNF, count: 100 }, { id: EYE, count: 100 }], at: { x: 3185, z: 3435 } });
        w.start();
        w.run(10);
        const clicks = w.h.sent.filter(s => s.action.type === 'interactLoc');
        expect(clicks.length).toBeGreaterThan(0);
        expect(clicks.every(s => (s.action as { route?: boolean }).route === undefined)).toBe(true);
    });

    test('the client refusing the unrouted click (not in reach): the routed click goes instead, counted', () => {
        const w = new World({ mode: 'pair', recipes: [attack], xp: LEVEL_XP[90]! + 1, inventory: inv14(GUAM_UNF, EYE), bank: [{ id: GUAM_UNF, count: 100 }, { id: EYE, count: 100 }], refuseUnrouted: true });
        w.start();
        w.run(16);
        expect(w.h.status.counters.unroutedRefused).toBeGreaterThan(0);
        expect(w.h.status.counters.routedClicks).toBeGreaterThan(0);
        expect(w.shared.visits.length).toBeGreaterThanOrEqual(3);
        expect(w.ignored).toEqual([]);
    });

    test('no booth in view faults after a short grace', () => {
        const w = new World({ mode: 'pair', recipes: [attack], xp: LEVEL_XP[60]!, bank: [{ id: GUAM_UNF, count: 20 }, { id: EYE, count: 20 }], noBooth: true });
        w.start();
        const st = w.run(10);
        expect(st.phase).toBe('fault');
        expect(st.fault).toContain('no booth');
    });

    test('bad parameters fault at the start', () => {
        const h = new Harness('item-cycle', createItemCycle);
        expect(h.start('item-cycle', { mode: 'pair', skill: 'herblore', recipes: [attack], untilLevel: 99 }).fault).toContain('booth must be');
        expect(h.start('item-cycle', { mode: 'pair', skill: 'herblore', recipes: [attack], booth: BOOTH }).fault).toContain('untilLevel, untilXp or maxActions');
        expect(h.start('item-cycle', { skill: 'herblore', recipes: [attack], booth: BOOTH, untilLevel: 99 }).fault).toContain('mode is required');
        expect(h.start('item-cycle', { mode: 'pair', skill: 'herblore', recipes: [{ ...attack, b: undefined }], booth: BOOTH, untilLevel: 99 }).fault).toContain('recipes[0].b');
    });
});

describe('item-cycle tool mode (gems)', () => {
    test('chisel in slot 0: 27 per inventory, both product types banked each visit', () => {
        const w = new World({ mode: 'tool', recipes: [opal], xp: LEVEL_XP[10]!, inventory: [{ id: CHISEL, count: 1 }], bank: [{ id: UNCUT_OPAL, count: 60 }], smash: n => n % 4 === 3, params: { maxActions: 60, untilLevel: undefined } });
        w.start();
        const st = w.run(40);
        expect(st.phase).toBe('done');
        expect(w.result.ended).toBe('maxActions');
        expect(w.result.sent).toBe(60);
        expect(w.sentAt(102)).toEqual(['withdraw #0 -1', 'closeModal']);
        expect(w.sentAt(103)).toEqual(['use 0->1', 'use 0->2', 'use 0->3', 'use 0->4', 'use 0->5']);
        const second = w.shared.visits[1]!;
        // cut opal and crushed gemstone, then All of the 33 uncut left fills 27
        expect(w.sentAt(second.seen)).toEqual(['deposit 1', 'deposit 4', 'withdraw #0 -1', 'closeModal']);
        expect(w.shared.visits.map(v => v.n)).toEqual([27, 27, 6]);
        expect(w.inv.filter(o => o?.id === UNCUT_OPAL)).toHaveLength(0);
        expect(w.ignored).toEqual([]);
        expectBudget(w);
    });

    test('the gem-window call shape: bank already open, no booth click first, stops at maxActions with the last withdraw exact', () => {
        const w = new World({ mode: 'tool', recipes: [opal], xp: LEVEL_XP[10]!, inventory: [{ id: CHISEL, count: 1 }], bank: [{ id: UNCUT_OPAL, count: 200 }], bankOpen: true, params: { maxActions: 107, untilLevel: undefined } });
        w.start();
        const st = w.run(60);
        expect(w.sentAt(101)).toEqual(['withdraw #0 -1', 'closeModal']);
        expect(w.h.sent.findIndex(s => s.action.type === 'interactLoc')).toBeGreaterThan(2);
        expect(st.phase).toBe('done');
        expect(w.result.ended).toBe('maxActions');
        expect(w.result.sent).toBe(107);
        expect(w.result.actions).toBe(107);
        expect(w.shared.visits.map(v => v.n)).toEqual([27, 27, 27, 26]);
        const last = w.shared.visits[3]!.seen;
        expect(w.h.sent.filter(s => s.tick >= last && s.action.type === 'bankWithdraw').map(s => (s.action as { amount: number }).amount)).toEqual([10, 10, 5, 1]);
        expect(w.inv.filter(o => o?.id === UNCUT_OPAL)).toHaveLength(0);
        expectBudget(w);
    });

    test('no chisel held: a reset visit withdraws one into slot 0 first', () => {
        const w = new World({ mode: 'tool', recipes: [opal], xp: LEVEL_XP[10]!, bank: [{ id: UNCUT_OPAL, count: 40 }, { id: CHISEL, count: 1 }], params: { maxActions: 27, untilLevel: undefined } });
        w.start();
        w.run(12);
        expect(w.sentAt(102)).toEqual(['withdraw #1 1', 'withdraw #0 -1', 'closeModal']);
        expect(w.sentAt(103)[0]).toBe('use 0->1');
        expect(w.ignored).toEqual([]);
    });
});

describe('item-cycle held, bank: false and mixed loads (the cooking wine windows)', () => {
    const item = (slot: number, id: number) => ({ slot, id, name: `obj ${id}`, count: 1, optionsWithIndex: [] });
    const gems = (id: number, n: number): Obj[] => Array.from({ length: n }, () => ({ id, count: 1 }));
    /** W1's inventory: the 491 notes, the chisel, then 26 uncut sapphires (the one stack burst 1 withdraws). */
    const w1Inventory = (): Array<Obj | null> => [{ id: WINE_NOTE, count: 491 }, { id: CHISEL, count: 1 }, ...gems(UNCUT_SAPPHIRE, 26)];
    /** The bank after burst 1: what is left of the 107 for W2 and P2. */
    const w2Bank = (): Obj[] => [{ id: UNCUT_DIAMOND, count: 2 }, { id: UNCUT_RUBY, count: 20 }, { id: UNCUT_EMERALD, count: 23 }, { id: UNCUT_SAPPHIRE, count: 36 }];
    const crafting96 = LEVEL_XP[96]!;

    test('planMixedLoad: each type ascending in xp order, capped, and a type with a hole below it left out', () => {
        const inv = [item(0, CHISEL), item(1, UNCUT_EMERALD), item(2, UNCUT_DIAMOND), item(3, UNCUT_RUBY), item(4, UNCUT_DIAMOND), item(5, UNCUT_EMERALD)];
        expect(planMixedLoad(inv, byXpDesc)!.map(x => [x.recipe.name, x.mix.dst])).toEqual([['diamond', 2], ['diamond', 4], ['ruby', 3], ['emerald', 1], ['emerald', 5]]);
        expect(planMixedLoad(inv, byXpDesc)!.every(x => x.mix.src === 0)).toBe(true);
        expect(planMixedLoad(inv, byXpDesc, 3)!.map(x => x.recipe.name)).toEqual(['diamond', 'diamond', 'ruby']);
        // a hole at 2 lies below the emerald at 3: the whole type is left out, the ruby below it still planned
        const holed = [item(0, CHISEL), item(1, UNCUT_RUBY), item(3, UNCUT_EMERALD)];
        expect(planMixedLoad(holed, byXpDesc)!.map(x => x.recipe.name)).toEqual(['ruby']);
        expect(planMixedLoad([item(0, CHISEL)], byXpDesc)).toBeNull();
        expect(planMixedLoad([item(1, UNCUT_RUBY)], byXpDesc)).toBeNull();
    });

    test('W1: held + bank:false cuts the 26 held with no booth click and no bank packet, the notes untouched, then ends load done', () => {
        const w = new World({ mode: 'tool', recipes: GEMS, xp: crafting96, inventory: w1Inventory(), bank: w2Bank(), params: { untilLevel: undefined, maxActions: 107, held: true, bank: false, mixed: true } });
        w.start();
        const st = w.run(20);
        expect(st.phase).toBe('done');
        expect(w.result).toMatchObject({ ended: 'load done', sent: 26, actions: 26, visits: 0, byRecipe: { sapphire: 26 } });
        // the first tick sends cuts: the held load is planned on the start state
        expect(w.sentAt(101)).toEqual(['use 1->2', 'use 1->3', 'use 1->4', 'use 1->5', 'use 1->6']);
        expect(w.h.sent.every(s => s.action.type === 'useItemOnItem')).toBe(true);
        expect(w.inv[0]).toEqual({ id: WINE_NOTE, count: 491 });
        expect(w.inv.filter(o => o?.id === SAPPHIRE)).toHaveLength(26);
        expect(w.bank).toEqual(w2Bank());
        expect(w.ignored).toEqual([]);
        expectBudget(w);
    });

    test('W1 with a mixed held load (a resume, or a burst that took two stacks): every type cut, credited by type', () => {
        const inv: Array<Obj | null> = [{ id: WINE_NOTE, count: 491 }, { id: CHISEL, count: 1 }, ...gems(UNCUT_SAPPHIRE, 4), ...gems(UNCUT_DIAMOND, 2), ...gems(UNCUT_RUBY, 20)];
        const w = new World({ mode: 'tool', recipes: GEMS, xp: crafting96, inventory: inv, params: { untilLevel: undefined, maxActions: 107, held: true, bank: false, mixed: true } });
        w.start();
        w.run(20);
        expect(w.result).toMatchObject({ ended: 'load done', sent: 26, actions: 26, byRecipe: { diamond: 2, ruby: 20, sapphire: 4 } });
        // highest xp first: the diamonds at 6-7, then the rubies, then the sapphires at 2-5
        expect(w.sentAt(101)).toEqual(['use 1->6', 'use 1->7', 'use 1->8', 'use 1->9', 'use 1->10']);
        expect(w.xp - crafting96).toBe((2 * 107.5 + 20 * 85 + 4 * 50) * 25);
        expect(w.ignored).toEqual([]);
    });

    test('held with a maxActions inside the load stops there (maxActions, not load done)', () => {
        const w = new World({ mode: 'tool', recipes: GEMS, xp: crafting96, inventory: w1Inventory(), params: { untilLevel: undefined, maxActions: 7, held: true, bank: false, mixed: true } });
        w.start();
        w.run(10);
        expect(w.result).toMatchObject({ ended: 'maxActions', sent: 7, actions: 7 });
        expect(w.inv.filter(o => o?.id === UNCUT_SAPPHIRE)).toHaveLength(19);
    });

    test('held with nothing plannable faults at once, never clicking the booth', () => {
        const w = new World({ mode: 'tool', recipes: GEMS, xp: crafting96, inventory: [{ id: WINE_NOTE, count: 491 }, { id: CHISEL, count: 1 }], bank: w2Bank(), params: { untilLevel: undefined, maxActions: 26, held: true, bank: false, mixed: true } });
        w.start();
        const st = w.run(3);
        expect(st.phase).toBe('fault');
        expect(st.fault).toBe('held load not plannable');
        expect(w.h.sent).toEqual([]);
    });

    test('held with banking (no bank:false): the held load first, then the normal booth cycle', () => {
        const w = new World({ mode: 'tool', recipes: [opal], xp: LEVEL_XP[10]!, inventory: [{ id: CHISEL, count: 1 }, ...gems(UNCUT_OPAL, 10)], bank: [{ id: UNCUT_OPAL, count: 27 }], params: { untilLevel: undefined, maxActions: 37, held: true } });
        w.start();
        const st = w.run(30);
        expect(w.sentAt(101)[0]).toBe('use 0->1');
        expect(st.phase).toBe('done');
        expect(w.result).toMatchObject({ ended: 'maxActions', sent: 37 });
        expect(w.shared.visits.map(v => v.n)).toEqual([27]);
        expect(w.ignored).toEqual([]);
    });

    test('W2 + P2: mixed canonical loads of exactly 27, 27, 27 from four stacks, then the stow; 107 over both windows is 6,567.5 base', () => {
        // W1 already cut 26 sapphires
        const w = new World({ mode: 'tool', recipes: GEMS, xp: crafting96 + 26 * 50 * 25, inventory: [{ id: CHISEL, count: 1 }], bank: w2Bank(), params: { untilLevel: undefined, maxActions: 81, mixed: true, stow: true } });
        w.start();
        const st = w.run(60);
        expect(st.phase).toBe('done');
        expect(w.result).toMatchObject({ ended: 'maxActions', stowed: true, sent: 81, actions: 81, byRecipe: { diamond: 2, ruby: 20, emerald: 23, sapphire: 36 } });
        expect(w.shared.visits.map(v => [v.kind, v.recipe, v.n])).toEqual([
            ['canonical', 'diamond+ruby+emerald', 27],
            ['canonical', 'emerald+sapphire', 27],
            ['canonical', 'sapphire', 27],
            ['stow', null, 0]
        ]);
        // the first visit: All of diamond, ruby, then emerald (All gives the 5 that fit), close
        expect(w.sentAt(w.shared.visits[0]!.seen)).toEqual(['withdraw #0 -1', 'withdraw #1 -1', 'withdraw #2 -1', 'closeModal']);
        expect(w.inv.every(o => o === null)).toBe(true);
        // W1's 26 sapphires and these 81: the windows' 6,567.5 base (crafting.ts WINDOW_GEM_BASE_XP)
        expect((w.xp - crafting96) / 25).toBe(6567.5);
        expect(w.bank).toEqual(expect.arrayContaining([{ id: DIAMOND, count: 2 }, { id: RUBY, count: 20 }, { id: EMERALD, count: 23 }, { id: SAPPHIRE, count: 36 }, { id: CHISEL, count: 1 }]));
        expect(w.ignored).toEqual([]);
        expectBudget(w);
    });

    test('mixed with maxActions short of the stacks: the last load withdraws exactly the rest, and a 108th gem stays banked', () => {
        const bank = [...w2Bank().slice(0, 3), { id: UNCUT_SAPPHIRE, count: 37 }];
        const w = new World({ mode: 'tool', recipes: GEMS, xp: crafting96, inventory: [{ id: CHISEL, count: 1 }], bank, params: { untilLevel: undefined, maxActions: 30, mixed: true } });
        w.start();
        const st = w.run(30);
        expect(st.phase).toBe('done');
        expect(w.result).toMatchObject({ ended: 'maxActions', sent: 30, byRecipe: { diamond: 2, ruby: 20, emerald: 8 } });
        expect(w.shared.visits.map(v => v.n)).toEqual([27, 3]);
        const second = w.shared.visits[1]!.seen;
        expect(w.h.sent.filter(s => s.tick >= second && s.action.type === 'bankWithdraw').map(s => (s.action as { amount: number }).amount)).toEqual([1, 1, 1]);
        expect(w.bank.find(b => b.id === UNCUT_SAPPHIRE)!.count).toBe(37);
        expect(w.ignored).toEqual([]);
    });

    test('mixed with no chisel held: the reset withdraws it, then fills the 27 in xp order', () => {
        const w = new World({ mode: 'tool', recipes: GEMS, xp: crafting96, bank: [{ id: CHISEL, count: 1 }, { id: UNCUT_RUBY, count: 20 }, { id: UNCUT_SAPPHIRE, count: 40 }], params: { untilLevel: undefined, maxActions: 27, mixed: true } });
        w.start();
        w.run(20);
        expect(w.sentAt(102)).toEqual(['withdraw #0 1', 'withdraw #1 -1', 'withdraw #2 -1', 'closeModal']);
        expect(w.shared.visits[0]).toMatchObject({ kind: 'reset', recipe: 'ruby', n: 27 });
        expect(w.result).toMatchObject({ sent: 27, byRecipe: { ruby: 20, sapphire: 7 } });
        expect(w.ignored).toEqual([]);
    });

    test('mixed below a recipe level: the gem the level does not allow stays banked', () => {
        const w = new World({ mode: 'tool', recipes: GEMS, xp: LEVEL_XP[30]!, inventory: [{ id: CHISEL, count: 1 }], bank: [{ id: UNCUT_DIAMOND, count: 5 }, { id: UNCUT_EMERALD, count: 10 }], params: { untilLevel: undefined, maxActions: 10, mixed: true } });
        w.start();
        w.run(20);
        expect(w.result).toMatchObject({ sent: 10, byRecipe: { emerald: 10 } });
        expect(w.bank.find(b => b.id === UNCUT_DIAMOND)!.count).toBe(5);
    });

    test('bad held, bank and mixed parameters fault at the start; bank:false needs no booth', () => {
        const h = new Harness('item-cycle', createItemCycle);
        const tool = { mode: 'tool', skill: 'crafting', booth: BOOTH, recipes: GEMS, maxActions: 10 };
        expect(h.start('item-cycle', { ...tool, held: 'yes' }).fault).toContain('held must be a boolean');
        expect(h.start('item-cycle', { ...tool, mixed: 1 }).fault).toContain('mixed must be a boolean');
        expect(h.start('item-cycle', { ...tool, bank: false }).fault).toContain('bank: false needs held: true');
        expect(h.start('item-cycle', { ...tool, held: true, bank: false, stow: true }).fault).toContain('stow needs a bank visit');
        expect(h.start('item-cycle', { mode: 'pair', skill: 'herblore', booth: BOOTH, maxActions: 10, recipes: [attack], mixed: true }).fault).toContain('mixed applies to tool mode only');
        expect(h.start('item-cycle', { ...tool, recipes: [body], mixed: true }).fault).toContain('mixed loads take no keep items');
        expect(h.start('item-cycle', { mode: 'stack', skill: 'fletching', maxActions: 10, recipes: [runeArrow], held: true }).fault).toContain('held applies to the pair and tool modes');
        const noBooth = h.start('item-cycle', { mode: 'tool', skill: 'crafting', recipes: GEMS, maxActions: 10, held: true, bank: false });
        expect(noBooth.fault).toBeUndefined();
        expect(createItemCycle.params).toEqual(expect.arrayContaining(['held', 'bank', 'mixed']));
    });
});

describe('keepNeed and keepCovers (thread, one worn every 5th body at worst)', () => {
    const thread = { id: THREAD, every: 5 };
    test('a load of 26 needs 6 thread; 6 covers 26, 5 covers 21, 1 covers 1', () => {
        expect([0, 1, 2, 5, 6, 21, 25, 26].map(n => keepNeed(thread, n))).toEqual([0, 1, 2, 2, 2, 5, 6, 6]);
        expect([0, 1, 2, 5, 6].map(h => keepCovers(thread, h))).toEqual([0, 1, 6, 21, 26]);
        expect(keepNeed({ id: NEEDLE }, 26)).toBe(1);
        expect(keepCovers({ id: NEEDLE }, 1)).toBe(Infinity);
    });

    test('both sides of the boundary: keepNeed(n) covers n, one fewer does not', () => {
        for (let n = 1; n <= 60; n++) {
            expect({ n, covers: keepCovers(thread, keepNeed(thread, n)) >= n }).toEqual({ n, covers: true });
            expect({ n, short: keepCovers(thread, keepNeed(thread, n) - 1) < n }).toEqual({ n, short: true });
        }
    });

    test('the bound is the content: from wear 4, a held count covers exactly keepCovers bodies', () => {
        for (const held of [1, 2, 3, 6]) {
            const w = new World({ mode: 'tool', recipes: [body], xp: LEVEL_XP[45]!, wear: 4, inventory: [{ id: NEEDLE, count: 1 }, { id: THREAD, count: held }], bank: [{ id: HARD_LEATHER, count: 26 }], params: { maxActions: 26, untilLevel: undefined } });
            w.start();
            w.run(20);
            expect({ held, made: w.inv.filter(o => o?.id === HARD_BODY).length + w.bank.filter(b => b.id === HARD_BODY).reduce((n, b) => n + b.count, 0), objbox: w.ignored.length }).toEqual({ held, made: keepCovers({ id: THREAD, every: 5 }, held), objbox: 0 });
        }
    });
});

describe('item-cycle tool mode (hard leather bodies: needle, thread kept)', () => {
    const leatherWorld = (o: Partial<WorldOpts> & { params?: Record<string, unknown> } = {}) =>
        new World({ mode: 'tool', recipes: [body], xp: LEVEL_XP[45]!, inventory: [{ id: NEEDLE, count: 1 }, { id: THREAD, count: 230 }], bank: [{ id: HARD_LEATHER, count: 60 }], ...o, params: { untilLevel: undefined, ...o.params } });

    test('needle in slot 0 and thread in slot 1 stay through every visit: 26 a load, the bodies banked', () => {
        const w = leatherWorld({ params: { maxActions: 52 } });
        w.start();
        const st = w.run(40);
        expect(st.phase).toBe('done');
        expect(w.result.ended).toBe('maxActions');
        expect(w.result.stowed).toBeUndefined();
        expect(w.sentAt(102)).toEqual(['withdraw #0 -1', 'closeModal']);
        expect(w.sentAt(103)).toEqual(['use 0->2', 'use 0->3', 'use 0->4', 'use 0->5', 'use 0->6']);
        expect(w.sentAt(w.shared.visits[1]!.seen)).toEqual(['deposit 2', 'withdraw #0 -1', 'closeModal']);
        expect(w.shared.visits.map(v => [v.kind, v.n])).toEqual([['canonical', 26], ['canonical', 26]]);
        expect(w.inv[0]).toEqual({ id: NEEDLE, count: 1 });
        expect(w.inv[1]).toEqual({ id: THREAD, count: 230 - Math.floor(52 / 5) });
        expect(w.result.actions).toBe(52);
        expect(w.ignored).toEqual([]);
        expectBudget(w);
    });

    test('thread held short of a load and more banked: the same visit withdraws All of it ahead of the leather', () => {
        const w = leatherWorld({ inventory: [{ id: NEEDLE, count: 1 }, { id: THREAD, count: 5 }], bank: [{ id: HARD_LEATHER, count: 60 }, { id: THREAD, count: 100 }], params: { maxActions: 26 } });
        w.start();
        const st = w.run(20);
        expect(st.phase).toBe('done');
        expect(w.sentAt(102)).toEqual(['withdraw #1 -1', 'withdraw #0 -1', 'closeModal']);
        expect(w.inv[1]).toEqual({ id: THREAD, count: 105 - 5 });
        expect(w.result.actions).toBe(26);
        expect(w.ignored).toEqual([]);
    });

    test('thread held at exactly a load (6 for 26) is not topped up', () => {
        const w = leatherWorld({ wear: 4, inventory: [{ id: NEEDLE, count: 1 }, { id: THREAD, count: 6 }], bank: [{ id: HARD_LEATHER, count: 60 }, { id: THREAD, count: 100 }], params: { maxActions: 26 } });
        w.start();
        w.run(20);
        expect(w.sentAt(102)).toEqual(['withdraw #0 -1', 'closeModal']);
        expect(w.result.actions).toBe(26);
        expect(w.ignored).toEqual([]);
    });

    test('thread short and none banked: the load shrinks to what the thread covers, then out of supplies', () => {
        const w = leatherWorld({ wear: 4, inventory: [{ id: NEEDLE, count: 1 }, { id: THREAD, count: 2 }], params: { maxActions: 52 } });
        w.start();
        const st = w.run(30);
        expect(w.sentAt(102)).toEqual(['withdraw #0 5', 'withdraw #0 1', 'closeModal']);
        expect(st.phase).toBe('fault');
        expect(st.fault).toContain('out of supplies');
        expect((st.faultDetail as { detail: { supplies: unknown } }).detail.supplies).toEqual({ hardleather_body: { level: 28, a: 54, tool: 1, keep: { [THREAD]: 0 } } });
        expect((st.faultDetail as ItemCycleResult).actions).toBe(6);
        expect(w.ignored).toEqual([]);
    });

    test('no needle or thread held: a reset withdraws the needle, then the thread, then 26 leather', () => {
        const w = leatherWorld({ inventory: [], bank: [{ id: HARD_LEATHER, count: 60 }, { id: NEEDLE, count: 1 }, { id: THREAD, count: 230 }], params: { maxActions: 26 } });
        w.start();
        w.run(20);
        expect(w.sentAt(102)).toEqual(['withdraw #1 1', 'withdraw #2 -1', 'withdraw #0 -1', 'closeModal']);
        expect(w.sentAt(103)[0]).toBe('use 0->2');
        expect(w.result.actions).toBe(26);
        expect(w.ignored).toEqual([]);
    });

    test('a thread worn out mid-load anyway: the objbox is closed and the run faults, rather than stalling', () => {
        // something outside the model took the thread down to 1 after the visit (wear 4: the first body takes it)
        const w = leatherWorld({
            wear: 4,
            params: { maxActions: 52 },
            onClose: (_n, world) => {
                world.inv[1] = { id: THREAD, count: 1 };
            }
        });
        w.start();
        const st = w.run(20);
        expect(st.phase).toBe('fault');
        expect(st.fault).toMatch(/^out of obj 1734 mid-load: \d+ hardleather_body unsent/);
        expect(w.ignored.some(x => x.includes('objbox'))).toBe(true);
        // the objbox was open when the fault tick began: its close is the fault tick's one packet
        const last = w.h.sent[w.h.sent.length - 1]!;
        expect(last.action.type).toBe('closeModal');
        expect(w.h.sent.filter(s => s.tick === last.tick)).toHaveLength(1);
    });

    test('stow at maxActions: the booth click rides with the last bodies, the last visit deposits bodies, needle and thread', () => {
        const w = leatherWorld({ params: { maxActions: 30, stow: true } });
        w.start();
        const st = w.run(40);
        expect(st.phase).toBe('done');
        expect(w.result).toMatchObject({ ended: 'maxActions', stowed: true, actions: 30, sent: 30 });
        expect(w.shared.visits.map(v => [v.kind, v.n])).toEqual([['canonical', 26], ['canonical', 4], ['stow', 0]]);
        const lastUse = w.h.sent.filter(s => s.action.type === 'useItemOnItem').pop()!.tick;
        expect(w.h.sent.filter(s => s.tick === lastUse).map(s => s.action.type)).toEqual(['useItemOnItem', 'useItemOnItem', 'useItemOnItem', 'useItemOnItem', 'interactLoc']);
        expect(w.sentAt(w.shared.visits[2]!.seen)).toEqual(['deposit 0', 'deposit 1', 'deposit 2', 'closeModal']);
        expect(w.inv.every(o => o === null)).toBe(true);
        expect(w.bank).toEqual(expect.arrayContaining([{ id: HARD_LEATHER, count: 30 }, { id: NEEDLE, count: 1 }, { id: THREAD, count: 230 - 6 }, { id: HARD_BODY, count: 30 }]));
        expect(w.ignored).toEqual([]);
        expectBudget(w);
    });

    test('stow at untilXp: no more bodies once the target shows, then the stow visit', () => {
        const xp = LEVEL_XP[45]!;
        const w = leatherWorld({ xp, params: { untilXp: xp + 3 * 35 * 25, stow: true } });
        w.start();
        const st = w.run(30);
        expect(st.phase).toBe('done');
        expect(w.result).toMatchObject({ ended: 'target', stowed: true });
        // the first work tick's 5 were in flight when the target showed; none after it
        expect(w.result.sent).toBe(5);
        expect(w.inv.every(o => o === null)).toBe(true);
        expect(w.bank.find(b => b.id === HARD_LEATHER)!.count).toBe(55);
    });

    test('a run started past its stop only stows (a resume after the last body)', () => {
        const w = leatherWorld({ inventory: [{ id: NEEDLE, count: 1 }, { id: THREAD, count: 40 }, ...Array(5).fill(0).map(() => ({ id: HARD_BODY, count: 1 }))], bank: [], params: { maxActions: 0, stow: true } });
        w.start();
        const st = w.run(10);
        expect(st.phase).toBe('done');
        expect(w.result).toMatchObject({ ended: 'maxActions', stowed: true, actions: 0, sent: 0 });
        expect(w.h.sent.map(s => s.action.type)).toEqual(['interactLoc', 'bankDeposit', 'bankDeposit', 'bankDeposit', 'closeModal']);
        expect(w.inv.every(o => o === null)).toBe(true);
    });

    test('stow with nothing held ends at once, without a visit', () => {
        const w = leatherWorld({ inventory: [], params: { maxActions: 0, stow: true } });
        w.start();
        const st = w.run(5);
        expect(st.phase).toBe('done');
        expect(w.result).toMatchObject({ stowed: true, visits: 0 });
        expect(w.h.sent).toEqual([]);
    });

    test('bad keep and stow parameters fault at the start', () => {
        const h = new Harness('item-cycle', createItemCycle);
        const tool = { mode: 'tool', skill: 'crafting', booth: BOOTH, maxActions: 10 };
        expect(h.start('item-cycle', { ...tool, recipes: [{ ...body, keep: [{ id: THREAD, every: 0 }] }] }).fault).toContain('every must be at least 1');
        expect(h.start('item-cycle', { ...tool, recipes: [{ ...body, keep: [{ id: NEEDLE }] }] }).fault).toContain("the recipe's own input or tool");
        expect(h.start('item-cycle', { ...tool, recipes: [{ ...body, keep: THREAD }] }).fault).toContain('keep must be an array');
        expect(h.start('item-cycle', { ...tool, recipes: [body], stow: 'yes' }).fault).toContain('stow must be a boolean');
        expect(h.start('item-cycle', { mode: 'pair', skill: 'herblore', booth: BOOTH, maxActions: 10, recipes: [{ ...attack, keep: [{ id: THREAD }] }] }).fault).toContain('keep applies to tool mode only');
        expect(h.start('item-cycle', { mode: 'stack', skill: 'fletching', maxActions: 10, recipes: [runeArrow], stow: true }).fault).toContain('stow applies to the pair and tool modes');
    });
});

describe('item-cycle stack mode (arrows)', () => {
    test('ceil(stack / 15) uses a tick, at most 5, then done when a stack runs out', () => {
        const w = new World({ mode: 'stack', recipes: [runeArrow], xp: LEVEL_XP[80]!, inventory: [{ id: HEADLESS, count: 1000 }, { id: RUNE_HEADS, count: 100 }] });
        w.start();
        const st = w.run(10);
        expect(st.phase).toBe('done');
        expect(w.result.ended).toBe('out of supplies');
        expect(w.h.timeline()).toEqual(['T101 useItemOnItem,useItemOnItem,useItemOnItem,useItemOnItem,useItemOnItem', 'T102 useItemOnItem,useItemOnItem']);
        expect(w.inv.find(o => o?.id === RUNE_ARROW)!.count).toBe(100);
        expect(w.result.actions).toBe(7);
        expect(w.shared.sendsPerTick).toEqual({ 5: 1, 2: 1 });
    });
});
