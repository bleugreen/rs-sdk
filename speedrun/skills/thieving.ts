// Thieving: STEP-MANIFEST.md entry 6 (S18), pickpocketing from any level to `to`
// with the in-page `pickpocket` program (server/webclient/src/bot/programs/pickpocket.ts;
// cadence and route in docs/speedrun/skills/thieving.md).
//
// One step per band, so every band boundary is logout-safe and gets its own measure
// row. Each band reads the base level from state and is a no-op once it is at the
// band's end, so the same list serves a fresh rehearsal account (men in Lumbridge,
// the leg to Ardougne, a bank stop, then warrior women, guards and knights) and the
// scored run, which arrives from Fight Arena at 57 with its food and only runs
// `thieving:knights`. `thieving:knights-55` stops at 57 so that the 57-99 row has the
// same shape in a rehearsal as in the run.
//
// Technique: Thieving has one. The program clicks the target blindly every tick, so
// there is no knife or plain cadence for HostGate to choose and no in-band probe;
// `technique` is accepted for the module convention and ignored.
//
// Helper top-ups (`topUp`, the scored run's path; a rehearsal restocks at the bank). The
// program clicks the knight on every tick, stun ticks included, and a click closes an open
// trade, so a top-up has to own the account while the trade is open. Two modes:
// - `idle` (default): the program sends the trade request itself, as a `player` stun action
//   on the stun's +2 once fewer than `below` food items are left, and with
//   `idleOnInterface` sends nothing while the trade is open; this module's TopUpReceiver
//   accepts the offer and confirm screens (`lib/trade.ts` `decideReceiver`). `resend: true`
//   (off by default) has the program send a request the engine never answered once more,
//   TOPUP_RESEND_TICKS after it and inside the program's request hold.
// - `restart` (the fallback): the module stops the program on the first failure with food
//   below `below`, receives the trade (`receiveFrom`, re-sending a request the stun's delay
//   dropped), and starts the program again by TOPUP_RESTART_BY ticks after the failure, whose
//   click lands on the next attempt's tick. Every wait in it counts game ticks.
// rs/106's trades requested at +2 completed at +7 or +8.
//
// The stun pack (`stunPack`, off by default; rs/106's design, docs/speedrun/research/stun-pack.md;
// the program side is rs/132's `stunActions`). On the 57-99 knights band only (S18), with a
// top-up: every stun also buries bones and casts Charge until Magic 99, then fletches arrows, all
// in the stun's window. In idle mode the program's list is the food top-up, a second top-up
// request gated on bones (fewer than `bonesBelow`, default 3, one stocked stun's burials), then
// the presets `bury`, `charge` and `arrows`: the first request that is due owns its stun's +2, so
// a top-up stun buries nothing, and the others carry three delay-free actions and a bury at +2,
// +4 and +6 (sections 2 and 10). In restart mode the program gets the three presets and the
// module also stops it for a top-up on a failure with bones below the bar. The bones, the
// arrowheads still to come and the food all arrive through that one trade; sizing the load is
// the giver's. Before the band starts (and again before its first program run, which a resume
// enters without the preconditions) it refuses with a reason: Charge, while Magic is below 99,
// needs base Magic 80, Mage Arena stage 8 (the varp is not transmitted, rs/114, so the evidence
// is a god staff held or worn, or `chargeUnlocked` from the run's own record), a fire staff worn
// and a cast's blood and air runes; arrows, while Fletching is below 99, need headless arrows and
// an arrowhead tier the level can use; and the giver must stand on a side tile of the account,
// never a corner, because the stunned account cannot step round one to reach it (rs/279). The
// detail row reports what the pack sent (`stun:*` counters summed over the band's program runs)
// and the Prayer, Magic and Fletching experience and levels it gained.

import type { BotWorldState, InventoryItem, NearbyNpc } from '../../sdk/types';
import { depositMatching, withdrawMany } from '../lib/bank';
import { advance } from '../lib/dialogue';
import { withLevelUpDismissal } from '../lib/levelup';
import { overBudgetMeta, runProgram, stopProgram, type ProgramStatus } from '../lib/programs';
import { decideReceiver, newReceiverCtx, receiveFrom, sameName, type ReceiverCtx } from '../lib/trade';
import { currentTick, nextTick, tickMs, waitUntil } from '../lib/wait';
import type { Step, StepContext } from '../runner/step';

export const skill = 'thieving';

export interface Tile {
    x: number;
    z: number;
}

// ------------------------------------------------------------------ food

export type FoodName = 'cake' | 'shark' | 'swordfish' | 'lobster' | 'tuna' | 'salmon' | 'trout';

export interface Food {
    /** HP per bite (consume_normal.dbrow). */
    heal: number;
    /** Every edible stage of the item, for the program's `food` regex. */
    names: readonly string[];
    /** The whole item as it sits in the bank. */
    bankName: string;
}

export const FOODS: Record<FoodName, Food> = {
    // three bites of 4 per slot: 12 HP a slot, the most at a 10 HP cap
    cake: { heal: 4, names: ['Cake', '2/3 cake', 'Slice of cake'], bankName: 'Cake' },
    shark: { heal: 20, names: ['Shark'], bankName: 'Shark' },
    swordfish: { heal: 14, names: ['Swordfish'], bankName: 'Swordfish' },
    lobster: { heal: 12, names: ['Lobster'], bankName: 'Lobster' },
    tuna: { heal: 10, names: ['Tuna'], bankName: 'Tuna' },
    salmon: { heal: 9, names: ['Salmon'], bankName: 'Salmon' },
    trout: { heal: 7, names: ['Trout'], bankName: 'Trout' }
};

/** The tutorial's shrimps and bread: eaten too, until the bank stop deposits them. */
const STARTER_FOOD = ['Shrimps', 'Bread'];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** The program's food regex (it compiles it case-insensitively). */
export function foodPattern(food: Food): string {
    return `^(${[...food.names, ...STARTER_FOOD].map(escape).join('|')})$`;
}

const hasEat = (i: InventoryItem) => i.optionsWithIndex.some(o => /^eat$/i.test(o.text));

export function edibleFood(s: BotWorldState, food: Food): InventoryItem[] {
    return s.inventory.filter(i => food.names.includes(i.name) && hasEat(i));
}

/** Banknotes of the food: the same name, no Eat option. */
export function notedFood(s: BotWorldState, food: Food): InventoryItem[] {
    return s.inventory.filter(i => i.name === food.bankName && !hasEat(i));
}

/**
 * The food a program run eats: the first of the kit's foods the inventory holds, else the first.
 * One food per run, because the eat thresholds are per food (eatPolicy): at a 10 HP cap a cake is
 * eaten at 6 and a shark at 4.
 */
export function heldFood(s: BotWorldState, foods: readonly Food[]): Food {
    return foods.find(f => edibleFood(s, f).length > 0) ?? foods[0]!;
}

/** `food` as a list in order of use: a name, a list, or a comma-separated string (`--skill-opt=food=cake,shark`). */
export function parseFoods(food: unknown): Food[] {
    const names = Array.isArray(food) ? food.map(String) : String(food ?? 'shark').split(',').map(n => n.trim()).filter(Boolean);
    if (names.length === 0) throw new Error('food needs at least one name');
    for (const n of names) if (!(n in FOODS)) throw new Error(`unknown food '${n}' (one of ${Object.keys(FOODS).join(', ')})`);
    return names.map(n => FOODS[n as FoodName]);
}

/**
 * Eat thresholds. At `stunDamage` HP or below one failure kills, so the program eats
 * at once there (`forcedBelow`). Otherwise it eats in a success window once a whole
 * bite fits under the cap, but never so late that the window eat comes at the
 * forced threshold: at a 10 HP cap a shark is eaten at 4 against knights (3 damage),
 * a cake at 6.
 */
export function eatPolicy(maxHp: number, heal: number, stunDamage: number): { eatBelow: number; forcedBelow: number } {
    return { eatBelow: maxHp - Math.min(heal, maxHp - stunDamage - 1), forcedBelow: stunDamage };
}

// ------------------------------------------------------------------ places

export const LUMBRIDGE_START: Tile = { x: 3222, z: 3222 };
/** East Ardougne south bank: booths at (2656,3283) and (2656,3286) (map m41_51). */
export const ARDOUGNE_SOUTH_BANK: Tile = { x: 2654, z: 3285 };

export function inEastArdougne(s: BotWorldState): boolean {
    const p = s.player;
    return !!p && p.level === 0 && p.worldX >= 2560 && p.worldX <= 2750 && p.worldZ >= 3250 && p.worldZ <= 3350;
}

export function onKaramja(s: BotWorldState): boolean {
    const p = s.player;
    return !!p && p.level === 0 && p.worldX >= 2740 && p.worldX <= 2990 && p.worldZ >= 3120 && p.worldZ <= 3240;
}

const dist = (s: BotWorldState, t: Tile) => (s.player ? Math.max(Math.abs(s.player.worldX - t.x), Math.abs(s.player.worldZ - t.z)) : Infinity);

// ------------------------------------------------------------------ bands

export interface Band {
    name: string;
    from: number;
    to: number;
    npc: string;
    /** Where the targets spawn (map files); the band starts at the nearest. */
    anchors: readonly Tile[];
    /** HP per failure (pickpocket.dbrow stun_damage). */
    stunDamage: number;
    /** The band `stunPack` runs on (S18, Thieving 57-99). */
    stunPack?: true;
}

/** The route below 55 is thieving.md section 2's; spawns are read from the map files. */
export const BANDS: readonly Band[] = [
    // Lumbridge men around the tutorial's exit; Ardougne market men for an account already there
    { name: 'thieving:men', from: 1, to: 25, npc: '^(Man|Woman)$', anchors: [{ x: 3221, z: 3219 }, { x: 2614, z: 3318 }], stunDamage: 1 },
    // the two market spawns of five (the others are west, at 2584-2587)
    { name: 'thieving:warrior-women', from: 25, to: 40, npc: '^Warrior woman$', anchors: [{ x: 2630, z: 3297 }], stunDamage: 2 },
    { name: 'thieving:guards', from: 40, to: 55, npc: '^Guard$', anchors: [{ x: 2661, z: 3306 }], stunDamage: 2 },
    // the eastern knights wander least (thieving.md section 6)
    { name: 'thieving:knights-55', from: 55, to: 57, npc: '^Knight of Ardougne$', anchors: [{ x: 2670, z: 3305 }], stunDamage: 3 },
    { name: 'thieving:knights', from: 57, to: 99, npc: '^Knight of Ardougne$', anchors: [{ x: 2670, z: 3305 }], stunDamage: 3, stunPack: true }
];

export function thievingLevel(s: BotWorldState): number {
    return s.skills.find(k => k.name.toLowerCase() === 'thieving')?.baseLevel ?? 1;
}

/** The browser page publishes `program` (null before any run); the lite client has no such key. */
export function hasPagePrograms(s: BotWorldState): boolean {
    return Object.prototype.hasOwnProperty.call(s, 'program');
}

// ------------------------------------------------------------------ options

export type Restock = 'bank' | ((ctx: StepContext<Record<string, never>>) => Promise<void>);

export interface TopUp {
    /** The helper's name: it stands next to the account and offers the food. */
    giver: string;
    /** A top-up is due once fewer than this many food items are left. */
    below: number;
    /** See the header (default 'idle'). */
    mode?: 'idle' | 'restart';
    /** Idle mode only: re-send an unanswered request once, TOPUP_RESEND_TICKS after it (default off). */
    resend?: boolean;
}

/** Ticks after the failure by which a stopped program must be running again (the header). */
export const TOPUP_RESTART_BY = 9;
/**
 * Restart mode re-sends its trade request when neither "Sending trade offer..." nor a refusal
 * came back after this many ticks. The first request goes out on the failure's own tick, inside
 * the stun's p_delay, and the engine drops a delayed player's op without a word
 * (OpPlayerHandler): in the lab every one of 13 such requests vanished and no top-up landed.
 */
export const TOPUP_NO_REPLY_TICKS = 2;
/**
 * Idle mode's `resend`: the program's `requestResend`, ticks after the +2 request. A request that
 * has drawn neither a trade nor "Sending trade offer..." by then was dropped: in rs/279's
 * side-tile lab, 1 of 10 requests never reached the giver. 3 is the last tick of the program's
 * request hold (REQUEST_HOLD), so the re-send displaces no click, and a request that ran even
 * 2 ticks late has already been answered.
 */
export const TOPUP_RESEND_TICKS = 3;

/** The `player` stun action that requests the top-up on a stun's +2. */
export function topUpAction(topUp: TopUp, food: Food): Record<string, unknown> {
    return {
        name: 'topup', kind: 'player', player: `^${escape(topUp.giver)}$`,
        fewer: [{ item: `^(${food.names.map(escape).join('|')})$`, than: topUp.below }],
        window: [2, 2]
    };
}

export interface TopUpTrade {
    openTick: number;
    endTick: number;
    ok: boolean;
    /** Items received (stack counts summed). */
    received: number;
    reason?: string;
}

/**
 * The module's half of an idle-mode top-up: fed every published state, it names the trade
 * packet to send (accept or decline) and sends nothing while no trade is open. The
 * program sends nothing while the trade is open, so these are the account's only packets.
 */
export class TopUpReceiver {
    readonly trades: TopUpTrade[] = [];
    private ctx: ReceiverCtx | null = null;
    private openTick = -1;
    private before: InventoryItem[] = [];
    /** A trade we declined (wrong partner, our offer not empty): wait for it to close. */
    private declined = false;

    constructor(private readonly giver: string) {}

    step(s: BotWorldState): 'accept' | 'decline' | null {
        const open = !!s.trade?.isOpen;
        if (this.declined) {
            if (!open) this.declined = false;
            this.before = s.inventory;
            return null;
        }
        if (!this.ctx) {
            if (!open) {
                this.before = s.inventory;
                return null;
            }
            this.ctx = newReceiverCtx(this.giver, this.before);
            this.openTick = s.tick;
        }
        const d = decideReceiver(s, this.ctx);
        this.ctx = d.next;
        switch (d.action) {
            case 'accept':
                return 'accept';
            case 'decline':
                if (!d.settle) {
                    this.end(s, false, 0, d.reason);
                    this.declined = true;
                }
                return 'decline';
            case 'done':
                this.end(s, true, d.received.reduce((a, i) => a + i.count, 0));
                return null;
            case 'closed':
                this.end(s, false, 0, d.reason ?? 'closed without the items arriving');
                return null;
            default:
                return null;
        }
    }

    private end(s: BotWorldState, ok: boolean, received: number, reason?: string): void {
        this.trades.push({ openTick: this.openTick, endTick: s.tick, ok, received, ...(reason ? { reason } : {}) });
        this.ctx = null;
        this.before = s.inventory;
    }
}

/**
 * Restart mode: this status shows a failure the last one did not, with food below `below`, or,
 * with the stun pack, fewer than `bones.below` bones held.
 */
export function topUpDue(status: Pick<ProgramStatus, 'counters' | 'gauges'>, seenFails: number, below: number, bones?: { held: number; below: number }): boolean {
    if ((status.counters.fails ?? 0) <= seenFails) return false;
    return (status.gauges.food ?? Infinity) < below || (!!bones && bones.held < bones.below);
}

// ------------------------------------------------------------------ stun pack

/** `stunPack` (the header). `true` takes the defaults. */
export interface StunPackOptions {
    /** A top-up is also due once fewer than this many bones are held (default STUN_PACK_BONES_BELOW). */
    bonesBelow?: number;
    /**
     * Mage Arena stage 8 (staff_given) on the run's own record, from S16's step. The varp is not
     * transmitted (rs/114), so without it the precondition wants a god staff, held or worn.
     */
    chargeUnlocked?: boolean;
}

/** A stocked stun buries 3 (stun-pack.md section 5): with fewer held, the next stun's top-up is due. */
export const STUN_PACK_BONES_BELOW = 3;

/** The pack after the top-up: the program's presets in rs/106's priority order (stun-pack.md sections 2 and 10). */
export const STUN_PACK_ACTIONS = ['bury', 'charge', 'arrows'] as const;

/** The bury preset's item (stun-actions.ts STUN_PRESETS.bury). */
const BONES_PATTERN = 'bones$';

/** The `player` stun action that requests a top-up on a stun's +2 when the bones run low (the food's is topUpAction). */
export function bonesTopUpAction(topUp: TopUp, bonesBelow: number): Record<string, unknown> {
    return { name: 'topup:bones', kind: 'player', player: `^${escape(topUp.giver)}$`, fewer: [{ item: BONES_PATTERN, than: bonesBelow }], window: [2, 2] };
}

/**
 * The knights band's `stunActions`, or none: idle mode puts the food top-up first and, with the
 * pack, the bones top-up and the presets after it; restart mode's module requests its own top-ups,
 * so the program gets only the presets.
 */
export function stunActionsFor(topUp: TopUp | undefined, food: Food, pack: Required<StunPackOptions> | undefined): unknown[] | undefined {
    const mode = topUp?.mode ?? 'idle';
    if (topUp && mode === 'idle') return [topUpAction(topUp, food), ...(pack ? [bonesTopUpAction(topUp, pack.bonesBelow), ...STUN_PACK_ACTIONS] : [])];
    if (pack) return [...STUN_PACK_ACTIONS];
    return undefined;
}

const baseOf = (s: BotWorldState, name: string) => s.skills.find(k => k.name.toLowerCase() === name)?.baseLevel ?? 1;
const held = (s: BotWorldState, re: RegExp) => s.inventory.filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);

export function bonesHeld(s: BotWorldState): number {
    return held(s, new RegExp(BONES_PATTERN, 'i'));
}

/** Kolodion's reward at Mage Arena stage 8 (quest-stages.ts magearena: the god staff given). */
const GOD_STAFF = /^(saradomin|guthix|zamorak) staff$/i;
/** A worn staff that supplies Charge's three fire runes. */
const FIRE_STAFF = /^(staff of fire|fire battlestaff|mystic fire staff)$/i;
/** Arrowhead tiers and the Fletching level each needs (stun-actions.ts ARROW_TIERS; the tests check they agree). */
export const ARROWHEAD_TIERS: ReadonlyArray<readonly [string, number]> = [['rune', 75], ['adamant', 60], ['mithril', 45], ['steel', 30], ['iron', 15], ['bronze', 1]];

/**
 * The pack's start check (the header): true, or why the band refuses. Read from the band's
 * start state: Charge's and the arrows' supplies for their first stun (more arrive by top-up)
 * and the giver's tile.
 */
export function stunPackCheck(s: BotWorldState, giver: string, pack: Required<StunPackOptions>): true | string {
    const p = s.player;
    if (!p) return 'no player';
    const magic = baseOf(s, 'magic');
    if (magic < 99) {
        if (magic < 80) return `the stun pack's Charge needs base Magic 80 (base Magic ${magic})`;
        const staff = [...s.inventory, ...s.equipment].some(i => GOD_STAFF.test(i.name));
        if (!pack.chargeUnlocked && !staff) return "the stun pack's Charge needs Mage Arena stage 8 (staff_given): no god staff held or worn, and no chargeUnlocked from the run's record";
        if (!s.equipment.some(i => FIRE_STAFF.test(i.name))) return "the stun pack's Charge needs a staff of fire wielded (its fire runes)";
        const blood = held(s, /^blood runes?$/i);
        const air = held(s, /^air runes?$/i);
        if (blood < 3 || air < 3) return `the stun pack's Charge needs 3 blood and 3 air runes (holding ${blood} and ${air})`;
    }
    const fletching = baseOf(s, 'fletching');
    if (fletching < 99) {
        if (held(s, /^headless arrows?$/i) === 0) return "the stun pack's arrows need headless arrows";
        const usable = ARROWHEAD_TIERS.filter(([, lvl]) => lvl <= fletching).map(([t]) => t);
        if (!usable.some(t => held(s, new RegExp(`^${t} arrow(head|tip)s$`, 'i')) > 0)) return `the stun pack's arrows need arrowheads Fletching ${fletching} can use (${usable.join(', ')})`;
    }
    const g = s.nearbyPlayers.find(q => sameName(q.name, giver));
    if (!g) return `the stun pack's giver ${giver} is not in sight`;
    const dx = g.x - p.worldX, dz = g.z - p.worldZ;
    if (Math.abs(dx) + Math.abs(dz) !== 1) return `the stun pack's giver ${giver} is at ${dx},${dz} from the account, not on a side tile (a stunned account cannot step round a corner to reach it, rs/279)`;
    return true;
}

/** `stunPack` as given: off, or every field set (validated: it may come off a command line). */
export function parseStunPack(value: unknown, topUp: TopUp | undefined): Required<StunPackOptions> | undefined {
    if (value === undefined || value === false) return undefined;
    if (value !== true && (typeof value !== 'object' || value === null || Array.isArray(value))) throw new Error(`stunPack must be true or { bonesBelow?, chargeUnlocked? } (got ${JSON.stringify(value)})`);
    const o = (value === true ? {} : value) as StunPackOptions;
    for (const k of Object.keys(o)) if (k !== 'bonesBelow' && k !== 'chargeUnlocked') throw new Error(`stunPack has no option '${k}' (bonesBelow, chargeUnlocked)`);
    const bonesBelow = o.bonesBelow ?? STUN_PACK_BONES_BELOW;
    if (!Number.isInteger(bonesBelow) || bonesBelow < 1) throw new Error(`stunPack.bonesBelow must be a whole number of at least 1 (got ${JSON.stringify(o.bonesBelow)})`);
    if (o.chargeUnlocked !== undefined && typeof o.chargeUnlocked !== 'boolean') throw new Error('stunPack.chargeUnlocked must be true or false');
    if (!topUp) throw new Error('stunPack needs topUp: its bones arrive through the top-up trade (stun-pack.md section 5)');
    return { bonesBelow, chargeUnlocked: o.chargeUnlocked ?? false };
}

const PACK_SKILLS = ['prayer', 'magic', 'fletching'] as const;

function packSkills(s: BotWorldState): Record<(typeof PACK_SKILLS)[number], { xp: number; level: number }> {
    const one = (n: string) => {
        const k = s.skills.find(x => x.name.toLowerCase() === n);
        return { xp: k?.experience ?? 0, level: k?.baseLevel ?? 1 };
    };
    return { prayer: one('prayer'), magic: one('magic'), fletching: one('fletching') };
}

/** The pack's line in the detail row: what it sent (summed `stun:*` counters) and the experience it gained. */
export function packReport(counters: Readonly<Record<string, number>>, before: ReturnType<typeof packSkills>, after: ReturnType<typeof packSkills>, bonesBelow: number) {
    const sent = (re: RegExp) => Object.entries(counters).filter(([k]) => re.test(k)).reduce((a, [, n]) => a + n, 0);
    return {
        bonesBelow,
        buried: sent(/^stun:bury$/),
        charges: sent(/^stun:charge$/),
        arrowActions: sent(/^stun:arrows:/),
        topUpRequests: sent(/^stun:topup(:bones)?$/),
        fired: counters.stunFired ?? 0,
        rejected: counters.stunRejected ?? 0,
        counters: Object.fromEntries(Object.entries(counters).filter(([k]) => k.startsWith('stun'))),
        xp: Object.fromEntries(PACK_SKILLS.map(k => [k, after[k].xp - before[k].xp])),
        levels: Object.fromEntries(PACK_SKILLS.map(k => [k, [before[k].level, after[k].level]]))
    };
}

export interface ThievingOptions {
    to?: number;
    /** Accepted for the module convention; Thieving has one technique (see the header). */
    technique?: 'auto' | 'knife' | 'plain';
    /**
     * Default shark (the scored run at 40+ HP); a fresh 10 HP account eats cake. A list (or
     * 'cake,shark') is the order of use: each bank stop withdraws the first food the bank still
     * holds, and each program run eats the first one the inventory holds.
     */
    food?: FoodName | readonly FoodName[] | string;
    /** The food stop when a band runs out (default: the East Ardougne south bank). */
    restock?: Restock;
    /** Helper top-ups inside the bands (the scored run); without it a band only restocks. */
    topUp?: TopUp;
    /** rs/106's stun pack on the 57-99 knights band (the header); needs `topUp`. Off unless passed. */
    stunPack?: StunPackOptions | boolean;
    [k: string]: unknown;
}

interface Config {
    to: number;
    /** In order of use (ThievingOptions.food). */
    foods: readonly Food[];
    restock: Restock;
    topUp?: TopUp;
    stunPack?: Required<StunPackOptions>;
}

// ------------------------------------------------------------------ movement

type Ctx = StepContext<Record<string, never>>;

const state = (ctx: Ctx): BotWorldState => {
    const s = ctx.sdk.getState();
    if (!s?.player) throw new Error('no published player state');
    return s;
};

/** Stock walkTo with a timeout scaled to the distance (2 tiles a tick running, 1 walking). */
async function walk(ctx: Ctx, to: Tile, tolerance = 2): Promise<void> {
    const d = dist(state(ctx), to);
    if (d <= tolerance) return;
    const r = await ctx.bot.walkTo(to.x, to.z, tolerance, { timeout: Math.max(60_000, (d + 40) * tickMs() * 1.5) });
    if (!r.success) throw new Error(`walk to ${to.x},${to.z}: ${r.message}`);
}

async function walkPath(ctx: Ctx, path: readonly Tile[]): Promise<void> {
    for (const t of path) await walk(ctx, t, 3);
}

const nearestNpc = (s: BotWorldState, re: RegExp): NearbyNpc | undefined => s.nearbyNpcs.filter(n => re.test(n.name)).sort((a, b) => a.distance - b.distance)[0];

/**
 * Talk to a ship's NPC and answer its dialogue until the ship has moved the player
 * (a level change or 40+ tiles), then cross the gangplank off the deck.
 */
/** Ticks without a dialogue page after which a talk-to click is taken as dropped. */
export const RETALK_QUIET_TICKS = 12;

/**
 * Whether `sail` re-sends its talk-to: nothing has been on screen since the last click or the
 * last dialogue page for RETALK_QUIET_TICKS. Two of four lab legs stalled for 90 ticks beside
 * the sailor after one click; a click sent inside a delay is dropped without a message.
 */
export function retalkDue(tick: number, lastTalkTick: number, lastDialogTick: number): boolean {
    return tick - Math.max(lastTalkTick, lastDialogTick) >= RETALK_QUIET_TICKS;
}

/** Talk to the ship's NPC and answer until the ship moves the player; resolves to the talk-to clicks it took. */
async function sail(ctx: Ctx, npc: RegExp, choose: RegExp, maxTicks = 90): Promise<number> {
    const s0 = state(ctx);
    const p0 = s0.player!;
    let talks = 0, lastTalk = -1, lastDialog = -1, dialogTicks = 0, lastText = '', name = String(npc);
    const talkTo = async () => {
        const s = state(ctx);
        const n = nearestNpc(s, npc);
        if (!n) throw new Error(`no ${npc} in sight at ${s.player!.worldX},${s.player!.worldZ}`);
        const talk = n.optionsWithIndex.find(o => /^talk/i.test(o.text));
        if (!talk) throw new Error(`${n.name} has no talk option`);
        name = n.name;
        await ctx.sdk.sendInteractNpc(n.index, talk.opIndex);
        talks++;
        lastTalk = s.tick;
    };
    await talkTo();
    const sailed = (s: BotWorldState) => !!s.player && (s.player.level !== p0.level || Math.max(Math.abs(s.player.worldX - p0.worldX), Math.abs(s.player.worldZ - p0.worldZ)) > 40);
    for (;;) {
        const s = state(ctx);
        if (sailed(s)) break;
        if (s.tick - s0.tick > maxTicks) {
            throw new Error(`still at ${s.player!.worldX},${s.player!.worldZ} ${maxTicks} ticks after talking to ${name} (${talks} talk clicks, ${dialogTicks} dialogue ticks, last page "${lastText}")`);
        }
        if (s.dialog.isOpen) {
            if (lastDialog !== s.tick) dialogTicks++;
            lastDialog = s.tick;
            const text = (s.dialog.allComponents ?? []).map(c => c.text).filter(Boolean).join(' / ');
            if (text) lastText = text.slice(0, 160);
        }
        if (s.dialog.isOpen && !s.dialog.isWaiting) {
            const r = await advance(ctx.sdk, { choose, maxTicks: 2 });
            if (!r.ok && r.kind === 'choice') throw new Error(`no answer for "${r.text}"`);
        } else if (!s.dialog.isOpen && retalkDue(s.tick, lastTalk, lastDialog)) await talkTo();
        else await nextTick(ctx.sdk);
    }
    await disembark(ctx);
    return talks;
}

/** Close the arrival message and cross the gangplank when the ship lands the player on deck. */
async function disembark(ctx: Ctx): Promise<void> {
    let s = state(ctx);
    if (s.player!.level === 0) return;
    for (let i = 0; i < 20 && s.player!.level !== 0; i++) {
        if (s.dialog.isOpen && !s.dialog.isWaiting) await ctx.sdk.sendClickDialog(0);
        const plank = s.nearbyLocs
            .filter(l => /gangplank/i.test(l.name) && l.optionsWithIndex.some(o => /^cross/i.test(o.text)))
            .sort((a, b) => a.distance - b.distance)[0];
        if (plank) {
            await ctx.sdk.sendInteractLoc(plank.x, plank.z, plank.id, plank.optionsWithIndex.find(o => /^cross/i.test(o.text))!.opIndex);
            const r = await waitUntil(ctx.sdk, st => st.player?.level === 0, { maxTicks: 12 });
            if (r.ok) return;
        } else await nextTick(ctx.sdk);
        s = state(ctx);
    }
    if (state(ctx).player!.level !== 0) throw new Error('could not leave the ship deck');
}

/**
 * Lumbridge to East Ardougne by sea: Port Sarim, the ship to Musa Point (30 gp), the
 * Karamja path to Brimhaven, the customs officer's ship to Ardougne (30 gp). It took 303
 * ticks with no HP lost in the lab. Overland is no alternative for a 10 HP account: the
 * lab walk by Falador and Taverley died to White Wolf Mountain's wolves at (2847,3472)
 * after 411 ticks.
 */
export const SHIP_ROUTE = {
    portSarim: { x: 3029, z: 3217 } as Tile,
    sailors: /^(Seaman Lorris|Seaman Thresnor|Captain Tobias)$/i,
    // Musa Point to the Brimhaven dock, whose customs officers stand at (2772-2773, 3225-3231)
    karamjaPath: [{ x: 2775, z: 3228 }] as Tile[],
    customs: /^Customs officer$/i,
    answers: /^Yes please|journey on this ship|Search away|^Ok\.?$/i,
    // from the Ardougne landing (2683,3268) into the market
    market: [{ x: 2665, z: 3290 }] as Tile[]
};

const coins = (s: BotWorldState) => s.inventory.filter(i => /^coins$/i.test(i.name)).reduce((a, i) => a + i.count, 0);

/** One sub-leg of the ship route: the tick it ended and where. */
export interface LegMark {
    leg: 'port-sarim' | 'sail-musa' | 'karamja' | 'sail-ardougne' | 'market';
    tick: number;
    x: number;
    z: number;
    /** A sailing's talk-to clicks (1 unless one was dropped). */
    talks?: number;
}

async function travel(ctx: Ctx, marks: LegMark[]): Promise<void> {
    const r = SHIP_ROUTE;
    const mark = (leg: LegMark['leg'], talks?: number) => {
        const p = state(ctx).player!;
        marks.push({ leg, tick: currentTick(ctx.sdk), x: p.worldX, z: p.worldZ, ...(talks === undefined ? {} : { talks }) });
    };
    if (!onKaramja(state(ctx))) {
        if (coins(state(ctx)) < 60) throw new Error(`the ship route needs 60 coins, the inventory holds ${coins(state(ctx))}`);
        await walk(ctx, r.portSarim, 3);
        mark('port-sarim');
        mark('sail-musa', await sail(ctx, r.sailors, r.answers));
    }
    await walkPath(ctx, r.karamjaPath);
    mark('karamja');
    mark('sail-ardougne', await sail(ctx, r.customs, r.answers));
    await walkPath(ctx, r.market);
    mark('market');
}

// ------------------------------------------------------------------ bank

async function openBankAt(ctx: Ctx, bank: Tile): Promise<void> {
    await walk(ctx, bank, 2);
    const opened = await ctx.bot.openBank();
    if (!opened.success) throw new Error(`openBank: ${opened.message}`);
}

/** Fill the free slots with the first of the foods the bank still holds, unnoted (one food per stop). */
async function withdrawFood(ctx: Ctx, foods: readonly Food[]): Promise<number> {
    for (const food of foods) {
        const w = await withdrawMany(ctx.sdk, [{ item: new RegExp(`^${escape(food.bankName)}$`), n: 'fill' }]);
        const got = w.gained.get(food.bankName) ?? 0;
        if (w.reason === 'missing' || got === 0) continue;
        if (!w.ok && w.reason !== undefined) throw new Error(`withdraw ${food.bankName}: ${w.reason}`);
        return got;
    }
    throw new Error(`the bank holds no ${foods.map(f => f.bankName).join(' or ')}`);
}

// ------------------------------------------------------------------ steps

function bandStep(band: Band, cfg: Config): Step {
    const end = Math.min(band.to, cfg.to);
    return {
        name: band.name,
        preconditions: s => {
            const lvl = thievingLevel(s);
            if (lvl >= end) return true;
            if (lvl < band.from) return `Thieving ${lvl} is below ${band.name}'s ${band.from}`;
            if (!hasPagePrograms(s)) return 'thieving needs the in-page pickpocket program (browser client)';
            if (band.stunPack && cfg.stunPack) return stunPackCheck(s, cfg.topUp!.giver, cfg.stunPack);
            return true;
        },
        run: ctx => runBand(ctx, band, end, cfg),
        postconditions: s => (thievingLevel(s) >= end ? true : `Thieving ${thievingLevel(s)} < ${end}`),
        logoutSafe: true,
        done: o => thievingLevel(o.state) >= end,
        inProgress: o => thievingLevel(o.state) >= band.from && thievingLevel(o.state) < end
    };
}

interface PickpocketResult {
    reason?: 'level' | 'rolls' | 'maxTicks' | 'food';
    [k: string]: unknown;
}

async function runBand(ctx: Ctx, band: Band, end: number, cfg: Config): Promise<void> {
    if (thievingLevel(state(ctx)) >= end) return;
    const s = state(ctx);
    const anchor = [...band.anchors].sort((a, b) => dist(s, a) - dist(s, b))[0]!;
    if (dist(s, anchor) > 8) await walk(ctx, anchor, 3);
    const topUp = cfg.topUp;
    const mode = topUp?.mode ?? 'idle';
    const pack = band.stunPack ? cfg.stunPack : undefined;
    if (pack) {
        // again here: a resumed band skips the preconditions
        const ok = stunPackCheck(state(ctx), topUp!.giver, pack);
        if (ok !== true) throw new Error(ok);
    }
    const skills0 = packSkills(state(ctx));
    const stunCounters: Record<string, number> = {};
    const paramsFor = (food: Food) => {
        const stunActions = stunActionsFor(topUp, food, pack);
        return {
            npc: band.npc,
            untilLevel: end,
            food: foodPattern(food),
            heal: food.heal,
            eat: 'window',
            ...eatPolicy(state(ctx).player!.maxHp, food.heal, band.stunDamage),
            stopWhenFoodBelow: 1,
            retargetTicks: 12,
            ...(topUp && mode === 'idle' ? { idleOnInterface: true } : {}),
            ...(stunActions ? { stunActions } : {}),
            ...(topUp && mode === 'idle' && topUp.resend ? { requestResend: TOPUP_RESEND_TICKS } : {})
        };
    };
    let policy = eatPolicy(s.player!.maxHp, heldFood(s, cfg.foods).heal, band.stunDamage);
    const restocks: Array<{ ticks: number; food: number; hp: number }> = [];
    const runs: Array<Pick<ProgramStatus, 'runId' | 'startedTick' | 'endedTick'> & { food: string; overBudget?: number }> = [];
    const restarts: Array<{ failTick: number; restartTick: number; ok: boolean; received: number; reason?: string }> = [];
    const receiver = topUp && mode === 'idle' ? new TopUpReceiver(topUp.giver) : null;
    const unsubscribe = receiver
        ? ctx.sdk.onStateUpdate(s => {
            const a = receiver.step(s);
            if (a === 'accept') void ctx.sdk.sendAcceptTrade();
            else if (a === 'decline') void ctx.sdk.sendDeclineTrade();
        })
        : () => {};
    try {
        for (;;) {
            let failTick: number | null = null;
            let seenFails = 0;
            const onProgress = topUp && mode === 'restart'
                ? (st: ProgramStatus) => {
                    const s = ctx.sdk.getState();
                    const bones = pack && s ? { held: bonesHeld(s), below: pack.bonesBelow } : undefined;
                    if (failTick === null && topUpDue(st, seenFails, topUp.below, bones)) {
                        failTick = st.tick;
                        void stopProgram(ctx.sdk).catch(() => {});
                    }
                    seenFails = st.counters.fails ?? 0;
                }
                : undefined;
            const food = heldFood(state(ctx), cfg.foods);
            const params = paramsFor(food);
            policy = { eatBelow: params.eatBelow, forcedBelow: params.forcedBelow };
            const st = await runProgram(ctx.sdk, 'pickpocket', params, onProgress ? { onProgress } : {});
            runs.push({ runId: st.runId, startedTick: st.startedTick, ...(st.endedTick !== undefined ? { endedTick: st.endedTick } : {}), food: food.bankName, ...overBudgetMeta(st) });
            for (const [k, n] of Object.entries(st.counters ?? {})) if (k.startsWith('stun')) stunCounters[k] = (stunCounters[k] ?? 0) + n;
            if (st.phase === 'stopped' && failTick !== null) {
                // the open and the trade both end by failTick + TOPUP_RESTART_BY
                const left = failTick + TOPUP_RESTART_BY - currentTick(ctx.sdk);
                const r = left > 0
                    ? await receiveFrom(ctx.sdk, topUp!.giver, { openMaxTicks: left, maxTicks: left, noReplyTicks: TOPUP_NO_REPLY_TICKS })
                    : { ok: false, received: [], reason: 'no ticks left before the attempt' };
                // a trade still open is closed by the restarted program's first click
                restarts.push({ failTick, restartTick: currentTick(ctx.sdk), ok: r.ok, received: r.received.reduce((a, i) => a + i.count, 0), ...(r.reason ? { reason: r.reason } : {}) });
                continue;
            }
            const result = (st.result ?? {}) as PickpocketResult;
            if (st.phase !== 'done') throw new Error(`pickpocket ended ${st.phase}${st.fault ? `: ${st.fault}` : ''}`);
            if (result.reason !== 'food') break;
            const t0 = currentTick(ctx.sdk);
            await restock(ctx, cfg);
            await walk(ctx, anchor, 3);
            restocks.push({ ticks: currentTick(ctx.sdk) - t0, food: edibleFood(state(ctx), heldFood(state(ctx), cfg.foods)).length, hp: state(ctx).player!.hp });
        }
    } finally {
        unsubscribe();
    }
    if (thievingLevel(state(ctx)) < end) throw new Error(`pickpocket finished at Thieving ${thievingLevel(state(ctx))}, short of ${end}`);
    // Detail only (0 ticks, so the report's total is unchanged): the harness logs the
    // program status rows; the restock trips are this step's own.
    const t = currentTick(ctx.sdk);
    ctx.log.append({
        v: 1, runId: ctx.log.runId, account: ctx.session.name, sessionId: ctx.session.sessionId, step: `${band.name}:detail`,
        startTick: t, endTick: t, ticks: 0, wallMs: 0, ok: true,
        meta: {
            anchor, policy, food: cfg.foods.map(f => f.bankName).join(','), runs, restocks,
            ...(topUp ? { topUp: { mode, trades: receiver?.trades ?? [], restarts } } : {}),
            ...(pack ? { pack: packReport(stunCounters, skills0, packSkills(state(ctx)), pack.bonesBelow) } : {})
        },
        tickMs: tickMs(), at: new Date().toISOString()
    });
}

async function restock(ctx: Ctx, cfg: Config): Promise<void> {
    if (typeof cfg.restock === 'function') return cfg.restock(ctx);
    if (!inEastArdougne(state(ctx))) throw new Error('out of food away from the East Ardougne bank');
    await openBankAt(ctx, ARDOUGNE_SOUTH_BANK);
    await withdrawFood(ctx, cfg.foods);
}

function legStep(cfg: Config): Step {
    const idle = (s: BotWorldState) => thievingLevel(s) >= cfg.to || inEastArdougne(s);
    return {
        name: 'thieving:to-ardougne',
        preconditions: s => (s.player ? true : 'no player'),
        run: async ctx => {
            if (idle(state(ctx))) return;
            const p0 = state(ctx).player!;
            const t0 = currentTick(ctx.sdk);
            // the sub-legs' end ticks (Port Sarim walk, the two sailings, the Karamja path, the market walk)
            const marks: LegMark[] = [];
            await withLevelUpDismissal(ctx.sdk, () => travel(ctx, marks));
            const t = currentTick(ctx.sdk);
            ctx.log.append({
                v: 1, runId: ctx.log.runId, account: ctx.session.name, sessionId: ctx.session.sessionId, step: 'thieving:to-ardougne:detail',
                startTick: t, endTick: t, ticks: 0, wallMs: 0, ok: true,
                meta: { hpLost: p0.hp - state(ctx).player!.hp, coins: coins(state(ctx)), from: { tick: t0, x: p0.worldX, z: p0.worldZ }, marks },
                tickMs: tickMs(), at: new Date().toISOString()
            });
        },
        postconditions: s => (idle(s) ? true : 'not in East Ardougne'),
        logoutSafe: true
    };
}

function provisionStep(cfg: Config): Step {
    const idle = (s: BotWorldState) => thievingLevel(s) >= cfg.to || (cfg.foods.some(f => edibleFood(s, f).length > 0) && cfg.foods.every(f => notedFood(s, f).length === 0));
    return {
        name: 'thieving:provision',
        preconditions: s => (idle(s) || inEastArdougne(s) ? true : 'not in East Ardougne'),
        run: async ctx => {
            if (idle(state(ctx))) return;
            await openBankAt(ctx, ARDOUGNE_SOUTH_BANK);
            // everything but coins: the starter kit and the food's notes
            const d = await depositMatching(ctx.sdk, [/^(?!coins$)/i]);
            if (!d.ok) throw new Error(`deposit: ${d.reason}`);
            await withdrawFood(ctx, cfg.foods);
        },
        postconditions: s => (idle(s) ? true : `no ${cfg.foods.map(f => f.bankName).join(' or ')} in the inventory`),
        logoutSafe: true
    };
}

export function steps(opts: ThievingOptions = {}): Step[] {
    const foods = parseFoods(opts.food);
    const topUp = opts.topUp;
    if (topUp && (!topUp.giver || !(topUp.below >= 1) || !['idle', 'restart', undefined].includes(topUp.mode))) throw new Error(`topUp needs a giver, below >= 1 and mode idle or restart (got ${JSON.stringify(topUp)})`);
    if (topUp?.resend !== undefined && typeof topUp.resend !== 'boolean') throw new Error(`topUp.resend must be true or false (got ${JSON.stringify(topUp.resend)})`);
    if (topUp?.resend && topUp.mode === 'restart') throw new Error('topUp.resend is for idle mode; restart mode re-sends through receiveFrom');
    const stunPack = parseStunPack(opts.stunPack, topUp);
    const cfg: Config = { to: opts.to ?? 99, foods, restock: opts.restock ?? 'bank', ...(topUp ? { topUp } : {}), ...(stunPack ? { stunPack } : {}) };
    const [men, ...ardougne] = BANDS;
    return [bandStep(men!, cfg), legStep(cfg), provisionStep(cfg), ...ardougne.map(b => bandStep(b, cfg))];
}
