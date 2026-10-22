// Actions inside the pickpocket stun: rs/106's stun pack (docs/speedrun/research/stun-pack.md,
// sections 2 and 10), as templates the pickpocket program resolves on every stun tick.
//
// Timing. For an attempt landing on tick T the roll is on T+1, the tick whose state shows the
// failure: offset k = 0. A packet sent on k lands on T+2+k. T+2 and T+3 are delayed (every
// packet is dropped), T+4..T+10 accept packets while the stun only makes the pickpocket script
// return, and T+11 starts the next attempt. Xp landing on T+10 (k = 8) queues a level-up page
// that opens on T+11 and blocks the attempt, so the window is at most k = 2..7.
//
// What an action costs is declared on its template as `delay` (stun-pack.md section 10):
//   'none'    delay-free: Charge, arrowheads on headless arrows, a page resume, a drop.
//   'tick'    p_delay(0): the rest of its tick and the whole next tick are rejected (Bury).
//             It goes last among the tick's actions, at most one per tick, and the next
//             tick sends none.
//   'tick2'   p_delay(1): as 'tick', but the next two ticks send none (Superheat Item,
//             stun-pack.md sections 15-16). Keep its window inside [2, 5]: from k = 6 its
//             delay covers T+10 and refuses the knight click that starts the next attempt.
//   'action'  writes %action_delay (eating): the next attempt slips by the item's delay. It
//             fires, and counts as costly.
//
// `skipClick` on a 'tick' or 'tick2' action: the knight click behind it would only be refused
// (OpNpcHandler while delayed), so its tick sends no click, and the click's slot carries one more
// delay-free action before it. Without it the click goes out behind the action as before.
//
// The templates are a priority list. Each window tick fills up to `perTick` slots (one packet
// of the tick's 5 always stays for the knight click), taking each template as often as it
// resolves, up to its `max`. Resolution reads the inventory and skills of the tick itself, with a
// per-tick ledger of what the tick's earlier picks will use, and never a position remembered in
// the list, so a program restarted mid-run picks up from game state (rs/127).
//
// A `player` action (a trade request, OPPLAYER4 by default) owns its tick: it is the tick's only
// stun action and the knight click is skipped, because a click after it would replace the
// request's interaction, and a bury before it would stop it. The program then holds every
// packet back until the trade opens, for at most REQUEST_HOLD ticks (rs/106's account sent
// nothing between its request and the open trade; the helper answers on the next tick).
// If no trade has opened by then, the program carries on. It fires at most once per stun and
// only on a player standing next to the account (a stunned player cannot walk). Gate it with
// `fewer` (e.g. fewer than 3 bones) so it goes out only when a top-up is due, and give it
// `window: [2, 4]`: rs/106's trades took 5-6 ticks from the request, so one sent later than +4
// is still open on the attempt tick and delays the attempt. The pickpocket
// program's `idleOnInterface` then keeps every packet back while the trade is open.
//
// With rs/106's list [bury, charge, arrows] and the default window this gives its measured
// plan: k = 2, 4 and 6 carry three delay-free actions and a bury, k = 3, 5 and 7 rest behind the
// bury, and with no bones left every window tick carries four delay-free actions.

import type { BotWorldState, InventoryItem } from '../types.js';
import type { ProgramAction, ProgramContext } from './types.js';
import { baseLevel, num } from './util.js';

export type StunDelay = 'none' | 'tick' | 'tick2' | 'action';
export type StunKind = 'item' | 'itemOnItem' | 'spellOnItem' | 'button' | 'player';

/** A stun action as a caller writes it (a `stunActions` entry). Regular expressions are case-insensitive strings. */
export interface StunActionSpec {
    /** Start from a preset (STUN_PRESETS) and override its fields. */
    preset?: string;
    /** Counter and summary key; defaults to the preset's or the kind. */
    name?: string;
    kind?: StunKind;
    /** The item used: `item` (by its option) and `itemOnItem` (the source). */
    item?: string;
    /** The item's option for `item`, e.g. '^bury$'. */
    option?: string;
    /** The target item of `itemOnItem` and `spellOnItem`. */
    on?: string;
    /** The spell's component for `spellOnItem`. */
    spell?: number;
    /** The button's component for `button` (IF_BUTTON). */
    component?: number;
    /** The player's name for `player`. */
    player?: string;
    /**
     * The player op for `player` (default 4, trade); for `item` without `option`, the OPHELD op
     * by index (1-5): 5 is the client's implicit Drop, which the published options leave out
     * when the object declares no op 5 (Client.ts's menu builder adds it; StateCollector does not).
     */
    op?: number;
    /** Taken from `item` and `on` per fire (default 1; 15 for an arrow action). */
    uses?: number;
    /** Other items each fire needs and uses, e.g. a spell's runes. */
    needs?: Array<{ item: string; count: number }>;
    /** Fire only while the inventory holds fewer than `than` of each item (a top-up that is due). */
    fewer?: Array<{ item: string; than: number }>;
    /** Fire only while `from` <= base level of `skill` < `below` (game state, not a counter). */
    skill?: string;
    from?: number;
    below?: number;
    /** Fires per tick (a 'tick' delay is always 1). */
    max?: number;
    delay?: StunDelay;
    /** A 'tick' or 'tick2' action's tick sends no knight click; the slot goes to a delay-free action (the header). */
    skipClick?: boolean;
    /** [from, to]: the offsets this action may fire on, inside the pack's window (a top-up: [2, 4]). */
    window?: [number, number];
}

/** Every key an action object may carry: any other is refused, so a spec written for a later program faults here instead of running differently. */
const SPEC_KEYS: ReadonlyArray<keyof StunActionSpec> = ['preset', 'name', 'kind', 'item', 'option', 'on', 'spell', 'component', 'player', 'op', 'uses', 'needs', 'fewer', 'skill', 'from', 'below', 'max', 'delay', 'skipClick', 'window'];

export interface StunTemplate {
    name: string;
    kind: StunKind;
    delay: StunDelay;
    /** Ticks after its own on which the pack sends nothing: 1 for 'tick', 2 for 'tick2', else 0. */
    rest: number;
    skipClick: boolean;
    max: number;
    item?: RegExp;
    option?: RegExp;
    on?: RegExp;
    spell?: number;
    component?: number;
    player?: RegExp;
    op?: number;
    uses: number;
    needs: Array<{ re: RegExp; count: number }>;
    fewer: Array<{ re: RegExp; than: number }>;
    skill?: string;
    from: number;
    below: number;
    window: [number, number];
}

/** IF_BUTTON for Charge on the standard spellbook (stun-pack-thieve.ts). */
export const CHARGE_COMPONENT = 1193;

/** Arrowhead tiers, best first, with the Fletching level each needs (stun-pack-thieve.ts TIERS). */
const ARROW_TIERS: Array<[string, number]> = [['rune', 75], ['adamant', 60], ['mithril', 45], ['steel', 30], ['iron', 15], ['bronze', 1]];

/**
 * rs/106's actions (stun-pack.md section 10). `arrows` expands to one template per tier, best
 * first, each gated on its Fletching level, so the best tier held and usable is the one used.
 */
export const STUN_PRESETS: Record<string, StunActionSpec[]> = {
    bury: [{ name: 'bury', kind: 'item', item: 'bones$', option: '^bury$', delay: 'tick' }],
    charge: [{ name: 'charge', kind: 'button', component: CHARGE_COMPONENT, needs: [{ item: '^blood runes?$', count: 3 }, { item: '^air runes?$', count: 3 }], skill: 'magic', below: 99 }],
    arrows: ARROW_TIERS.map(([tier, level]) => ({ name: `arrows:${tier}`, kind: 'itemOnItem' as const, item: `^${tier} arrow(head|tip)s$`, on: '^headless arrows?$', uses: 15, skill: 'fletching', from: level, below: 99 }))
};

const KINDS: readonly StunKind[] = ['item', 'itemOnItem', 'spellOnItem', 'button', 'player'];
const DELAYS: readonly StunDelay[] = ['none', 'tick', 'tick2', 'action'];
const REST: Record<StunDelay, number> = { none: 0, tick: 1, tick2: 2, action: 0 };

function re(value: unknown, name: string): RegExp | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !value) throw new Error(`${name} must be a regular expression string`);
    return new RegExp(value, 'i');
}

function count(value: unknown, fallback: number, name: string): number {
    const n = num(value, fallback, name);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a whole number of at least 1`);
    return n;
}

function parseOne(spec: StunActionSpec, at: string): StunTemplate {
    const unknown = Object.keys(spec).filter(k => !(SPEC_KEYS as readonly string[]).includes(k));
    if (unknown.length) throw new Error(`${at} has no key ${unknown.map(k => `'${k}'`).join(', ')} (keys: ${SPEC_KEYS.join(', ')})`);
    const kind = spec.kind;
    if (!kind || !KINDS.includes(kind)) throw new Error(`${at}.kind must be one of ${KINDS.join(', ')}`);
    const delay = spec.delay ?? 'none';
    if (!DELAYS.includes(delay)) throw new Error(`${at}.delay must be one of ${DELAYS.join(', ')}`);
    if (spec.skipClick !== undefined && typeof spec.skipClick !== 'boolean') throw new Error(`${at}.skipClick must be true or false`);
    if (spec.skipClick && REST[delay] === 0) throw new Error(`${at}.skipClick needs a 'tick' or 'tick2' delay: only a delay refuses the click behind it`);
    const t: StunTemplate = {
        name: spec.name ?? kind,
        kind,
        delay,
        rest: REST[delay],
        skipClick: spec.skipClick ?? false,
        max: REST[delay] > 0 ? 1 : spec.max === undefined ? Infinity : count(spec.max, 1, `${at}.max`),
        item: re(spec.item, `${at}.item`),
        option: re(spec.option, `${at}.option`),
        on: re(spec.on, `${at}.on`),
        uses: count(spec.uses, 1, `${at}.uses`),
        needs: [],
        fewer: [],
        skill: spec.skill,
        from: num(spec.from, 0, `${at}.from`),
        below: num(spec.below, Infinity, `${at}.below`),
        window: [-Infinity, Infinity]
    };
    if (spec.window !== undefined) {
        const w = spec.window;
        if (!Array.isArray(w) || w.length !== 2 || !w.every(v => Number.isInteger(v)) || w[0] > w[1]) throw new Error(`${at}.window must be [from, to], stun offsets`);
        t.window = [w[0], w[1]];
    }
    if (delay === 'tick2' && !(t.window[1] <= 5)) throw new Error(`${at}: a 'tick2' action needs a window ending by +5: from +6 its p_delay(1) covers T+10 and refuses the click that starts the next attempt`);
    if (spec.skill !== undefined && (typeof spec.skill !== 'string' || !spec.skill)) throw new Error(`${at}.skill must be a skill name`);
    if (spec.needs !== undefined) {
        if (!Array.isArray(spec.needs)) throw new Error(`${at}.needs must be a list of { item, count }`);
        t.needs = spec.needs.map((n, i) => ({ re: re(n?.item, `${at}.needs[${i}].item`)!, count: count(n?.count, 1, `${at}.needs[${i}].count`) }));
        if (t.needs.some(n => !n.re)) throw new Error(`${at}.needs entries need an item`);
    }
    if (spec.fewer !== undefined) {
        if (!Array.isArray(spec.fewer)) throw new Error(`${at}.fewer must be a list of { item, than }`);
        t.fewer = spec.fewer.map((n, i) => ({ re: re(n?.item, `${at}.fewer[${i}].item`)!, than: count(n?.than, 1, `${at}.fewer[${i}].than`) }));
        if (t.fewer.some(n => !n.re)) throw new Error(`${at}.fewer entries need an item`);
    }
    switch (kind) {
        case 'item':
            if (!t.item || (!t.option && spec.op === undefined)) throw new Error(`${at}: an item action needs item and option (or op)`);
            if (!t.option) {
                t.op = count(spec.op, 5, `${at}.op`);
                if (t.op > 5) throw new Error(`${at}.op must be an OPHELD op, 1 to 5`);
            }
            break;
        case 'itemOnItem':
            if (!t.item || !t.on) throw new Error(`${at}: an itemOnItem action needs item and on`);
            break;
        case 'spellOnItem':
            if (!t.on || !Number.isInteger(spec.spell)) throw new Error(`${at}: a spellOnItem action needs spell (a component id) and on`);
            t.spell = spec.spell;
            break;
        case 'button':
            if (!Number.isInteger(spec.component)) throw new Error(`${at}: a button action needs component (a component id)`);
            t.component = spec.component;
            break;
        case 'player':
            t.player = re(spec.player, `${at}.player`);
            if (!t.player) throw new Error(`${at}: a player action needs player (a name)`);
            t.op = count(spec.op, 4, `${at}.op`);
            t.max = 1;
            break;
    }
    return t;
}

/** Parse `stunActions`: preset names or action objects, in priority order (validated: it comes off the wire). */
export function parseStunActions(value: unknown): StunTemplate[] {
    if (!Array.isArray(value) || value.length === 0) throw new Error('stunActions must be a non-empty list of preset names or action objects');
    const out: StunTemplate[] = [];
    value.forEach((entry, i) => {
        const at = `stunActions[${i}]`;
        const spec: StunActionSpec | null = typeof entry === 'string' ? { preset: entry } : entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as StunActionSpec) : null;
        if (!spec) throw new Error(`${at} must be a preset name or an action object`);
        if (spec.preset === undefined) {
            out.push(parseOne(spec, at));
            return;
        }
        const base = STUN_PRESETS[spec.preset];
        if (!base) throw new Error(`${at}: unknown preset '${spec.preset}' (presets: ${Object.keys(STUN_PRESETS).join(', ')})`);
        const { preset: _preset, ...overrides } = spec;
        for (const b of base) out.push(parseOne({ ...b, ...overrides, ...(base.length > 1 && overrides.name ? { name: `${overrides.name}:${b.name}` } : {}) }, at));
    });
    return out;
}

/** What one tick's earlier picks will take from the inventory, so later picks see what is left. */
class Ledger {
    private readonly left = new Map<number, number>();

    constructor(private readonly inventory: readonly InventoryItem[]) {
        for (const i of inventory) this.left.set(i.slot, i.count);
    }

    find(re: RegExp, option?: RegExp, except?: number): InventoryItem | undefined {
        return this.inventory.find(i => i.slot !== except && (this.left.get(i.slot) ?? 0) > 0 && re.test(i.name) && (!option || i.optionsWithIndex.some(o => option.test(o.text))));
    }

    total(re: RegExp): number {
        return this.inventory.filter(i => re.test(i.name)).reduce((a, i) => a + (this.left.get(i.slot) ?? 0), 0);
    }

    take(slot: number, n: number): void {
        this.left.set(slot, Math.max(0, (this.left.get(slot) ?? 0) - n));
    }

    takeAll(re: RegExp, n: number): void {
        for (const i of this.inventory) {
            if (n <= 0) return;
            if (!re.test(i.name)) continue;
            const have = this.left.get(i.slot) ?? 0;
            const t = Math.min(have, n);
            this.left.set(i.slot, have - t);
            n -= t;
        }
    }
}

interface Pick {
    t: StunTemplate;
    action: ProgramAction;
    what: string;
}

/** Resolve one fire of a template against the tick's state and ledger, and book what it uses. */
function resolve(t: StunTemplate, s: BotWorldState, ledger: Ledger): Pick | null {
    if (t.skill) {
        const lvl = baseLevel(s, t.skill);
        if (lvl < t.from || lvl >= t.below) return null;
    }
    if (t.needs.some(n => ledger.total(n.re) < n.count)) return null;
    if (t.fewer.some(n => ledger.total(n.re) >= n.than)) return null;
    let pick: Pick;
    let used: InventoryItem[] = [];
    switch (t.kind) {
        case 'item': {
            const it = ledger.find(t.item!, t.option);
            if (!it) return null;
            const op = t.option ? it.optionsWithIndex.find(o => t.option!.test(o.text))! : { opIndex: t.op!, text: `op ${t.op}` };
            pick = { t, action: { type: 'useInventoryItem', slot: it.slot, optionIndex: op.opIndex }, what: `${t.name}: ${op.text} ${it.name}` };
            used = [it];
            break;
        }
        case 'itemOnItem': {
            const a = ledger.find(t.item!);
            const b = a && ledger.find(t.on!, undefined, a.slot);
            if (!a || !b) return null;
            pick = { t, action: { type: 'useItemOnItem', sourceSlot: a.slot, targetSlot: b.slot }, what: `${t.name}: ${a.name} on ${b.name}` };
            used = [a, b];
            break;
        }
        case 'spellOnItem': {
            const b = ledger.find(t.on!);
            if (!b) return null;
            pick = { t, action: { type: 'spellOnItem', slot: b.slot, spellComponent: t.spell! }, what: `${t.name}: spell ${t.spell} on ${b.name}` };
            used = [b];
            break;
        }
        case 'button':
            pick = { t, action: { type: 'clickComponent', componentId: t.component! }, what: `${t.name}: button ${t.component}` };
            break;
        case 'player': {
            const p = s.nearbyPlayers.find(q => t.player!.test(q.name) && q.distance <= 1);
            if (!p) return null;
            pick = { t, action: { type: 'interactPlayer', playerIndex: p.index, optionIndex: t.op! }, what: `${t.name}: op ${t.op} on ${p.name}` };
            break;
        }
    }
    for (const it of used) ledger.take(it.slot, t.uses);
    for (const n of t.needs) ledger.takeAll(n.re, n.count);
    return pick;
}

export interface StunPackOptions {
    actions: unknown;
    /** [from, to]: offsets k from the tick whose state shows the failure (default [2, 7]). */
    window?: unknown;
    /** Stun actions per tick, at most the budget less the knight click (default 4). */
    perTick?: unknown;
}

export interface StunSummary {
    window: [number, number];
    stuns: number;
    /** Stuns whose window passed with nothing fired (the pack ran dry). */
    dry: number;
    fired: number;
    rejected: number;
    /** Fired actions that write the action delay (they push the next attempt). */
    costly: number;
    firedPerStun: number;
    byAction: Record<string, number>;
    /** Window ticks skipped because an interface (a trade) was open. */
    modalTicks: number;
    /** Ticks a `player` action owned (the knight click skipped). */
    ownedTicks: number;
}

/** Ticks after a trade request in which the program sends nothing while it waits for the trade to open. */
export const REQUEST_HOLD = 3;

/** A main modal (a trade, a bank) is open: an inventory op, a button or a click would close it. */
export function modalOpen(s: BotWorldState): boolean {
    return !!(s.modalOpen || s.trade?.isOpen);
}

/** The stun pack's state through a run: the current stun's offset and what fired. */
export class StunPack {
    readonly templates: StunTemplate[];
    readonly from: number;
    readonly to: number;
    private readonly perTick: number;
    private failTick: number | null = null;
    /** The last tick a delayed action's rest covers. */
    private restUntil = -1;
    private firedThisStun = 0;
    private stuns = 0;
    private dry = 0;
    private fired = 0;
    private rejected = 0;
    private costly = 0;
    private modalTicks = 0;
    private ownedTicks = 0;
    private playerSentThisStun = false;
    private requestTick: number | null = null;
    private readonly byAction: Record<string, number> = {};

    constructor(opts: StunPackOptions) {
        this.templates = parseStunActions(opts.actions);
        const w = opts.window ?? [2, 7];
        if (!Array.isArray(w) || w.length !== 2 || !w.every(v => Number.isInteger(v))) throw new Error('stunWindow must be [from, to], offsets from the failure tick');
        [this.from, this.to] = w as [number, number];
        // k 0-1 land on the delayed T+2 and T+3; xp from k 8 on blocks the attempt with a page.
        if (this.from < 2 || this.to > 7 || this.from > this.to) throw new Error('stunWindow must lie inside [2, 7]: k 0 and 1 land while delayed, and xp from k 8 opens a page on the attempt tick');
        this.perTick = count(opts.perTick, 4, 'stunPerTick');
    }

    /** The tick whose state shows a failure (k = 0). */
    failure(t: number): void {
        this.close();
        this.failTick = t;
        this.firedThisStun = 0;
        this.playerSentThisStun = false;
        this.stuns++;
    }

    /**
     * True while a trade request waits for its trade to open: send nothing. Ends when a modal
     * opens (the caller's interface rule takes over) or REQUEST_HOLD ticks have passed.
     */
    holding(t: number, s: BotWorldState): boolean {
        if (this.requestTick === null) return false;
        if (modalOpen(s) || t > this.requestTick + REQUEST_HOLD) {
            this.requestTick = null;
            return false;
        }
        return t > this.requestTick;
    }

    /**
     * Send this tick's stun actions; call it after any page resume or eat, before the knight
     * click. True when the tick takes no click: a `player` action went out and owns the tick, or
     * a `skipClick` action went out (its delay would refuse the click).
     */
    act(ctx: ProgramContext): boolean {
        if (this.failTick === null) return false;
        const t = ctx.tick;
        const k = t - this.failTick;
        if (k > this.to) {
            this.close();
            return false;
        }
        if (k < this.from || t <= this.restUntil) return false;
        const s = ctx.state;
        if (modalOpen(s)) {
            // an open trade closes on any inventory op or button
            this.modalTicks++;
            ctx.count('stunModal');
            return false;
        }
        const slots = Math.min(this.perTick, ctx.budget - 1);
        if (slots <= 0) return false;
        const ledger = new Ledger(s.inventory);
        const picks: Pick[] = [];
        const taken = new Map<StunTemplate, number>();
        let owned = false;
        // Templates in priority order, each as often as it resolves (up to its max), until `limit` picks.
        const fill = (limit: number) => {
            for (const tpl of this.templates) {
                if (owned) return;
                if (k < tpl.window[0] || k > tpl.window[1]) continue;
                if (tpl.kind === 'player') {
                    // only as the tick's first pick, once per stun
                    if (picks.length || this.playerSentThisStun) continue;
                    const p = resolve(tpl, s, ledger);
                    if (p) {
                        picks.push(p);
                        owned = true;
                    }
                    continue;
                }
                while ((taken.get(tpl) ?? 0) < tpl.max && picks.length < limit) {
                    if (tpl.rest > 0 && picks.some(p => p.t.rest > 0)) break;
                    const p = resolve(tpl, s, ledger);
                    if (!p) break;
                    picks.push(p);
                    taken.set(tpl, (taken.get(tpl) ?? 0) + 1);
                }
            }
        };
        fill(slots);
        // the click's slot, when the tick's delayed action takes no click behind it
        if (!owned && picks.some(p => p.t.skipClick)) fill(Math.min(this.perTick + 1, ctx.budget));
        // A p_delay action rejects whatever follows it in the tick, so it goes last.
        picks.sort((a, b) => Number(a.t.rest > 0) - Number(b.t.rest > 0));
        let skipClick = false;
        for (const p of picks) {
            if (!ctx.send(p.action, p.what)) {
                this.rejected++;
                ctx.count('stunRejected');
                continue;
            }
            this.fired++;
            this.firedThisStun++;
            this.byAction[p.t.name] = (this.byAction[p.t.name] ?? 0) + 1;
            ctx.count('stunFired');
            ctx.count(`stun:${p.t.name}`);
            if (p.t.rest > 0) this.restUntil = t + p.t.rest;
            if (p.t.skipClick) skipClick = true;
            if (p.t.delay === 'action') {
                this.costly++;
                ctx.count('stunCostly');
            }
            if (p.t.kind === 'player') {
                this.playerSentThisStun = true;
                this.requestTick = t;
            }
        }
        if (owned) {
            this.ownedTicks++;
            return true;
        }
        if (skipClick) {
            ctx.count('stunClickSkips');
            return true;
        }
        return false;
    }

    /** End the current stun's record (its window has passed, or a new failure came). */
    private close(): void {
        if (this.failTick === null) return;
        if (this.firedThisStun === 0) this.dry++;
        this.failTick = null;
    }

    summary(): StunSummary {
        return {
            window: [this.from, this.to],
            stuns: this.stuns,
            dry: this.dry,
            fired: this.fired,
            rejected: this.rejected,
            costly: this.costly,
            firedPerStun: this.stuns ? Math.round((this.fired / this.stuns) * 100) / 100 : 0,
            byAction: { ...this.byAction },
            modalTicks: this.modalTicks,
            ownedTicks: this.ownedTicks
        };
    }
}
