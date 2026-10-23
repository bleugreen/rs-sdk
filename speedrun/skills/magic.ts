// Magic: S02 Wind Strike 1-7 at the Lumbridge chicken coop, and S04 60 enchants 7-59 standing at
// the Firemaking row's end with the rings delivered by trade (STEP-MANIFEST.md entry 24;
// docs/speedrun/skills/magic.md, section 9 for this module).
//
// S02. Wind Strike on the nearest live chicken, re-clicked every tick (a click while the 5-tick
// spell attack delay is pending re-queues itself), retargeting at once after a kill. Wind Strike
// does not close the level-up page, so each level gained is answered blind: the label that shows
// the new level is R, the page opens on R+1 (one queued [advancestat] script per leveling xp
// drop), and on R+1 the step sends pagesAt(level) continues, two at a level with an unlock page
// (levelup_unlocks_magic.rs2), so the answer lands on R+2 (research/levelup-cost.md sections 1
// and 5). A page still open a tick after its answer gets one more continue (the backstop).
//
// S04. Every enchant ends in p_delay(1), and OPHELDT is dropped while the player is delayed
// (OpHeldTHandler), so a cast at server tick T blocks T+1 and T+2 and the next lands on T+3.
// The loop therefore never waits for the xp: on every tick it sends one spell-on-item on the
// first ring it can enchant (lowest tier first, then lowest slot), and the server's floor sets
// the 3-tick cadence. A cast also closes any level-up page (clearPendingAction), so S04 needs no
// dismissal while casting. Rings come in loads of 20 from the ring giver (SUPPLIES.md's H3 row,
// RING_CONTRACT), one giver per load: the first load is a pure receive, each later one a
// lib/trade.ts swap() that hands the previous load's enchanted rings to that load's giver in the
// same trade. The last load's 20 enchanted rings stay with SCORED (rs/158's ruling): S05's trade
// at Doric's (SUPPLIES.md hand-off H4) takes them as a swap, offering enchantedRingSpecs. Every
// trade's first click is sent on the label two after the load's last cast, so it lands on the
// tick the cast's delay clears; a click inside the delay is dropped and swap() would only re-send
// it after SWAP_RECLICK_TICKS.
//
// Both steps read the live game state and run from wherever it stands: S04 infers how many loads
// were delivered from the Magic xp and the rings held (loadsDelivered), so a restart resumes at
// the next cast or the next trade. Nothing here walks: the start tile and the kit come from the
// run (S02 arrives at the coop gate by leg T01-02; S04 starts where S03's row ends).

import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, InventoryItem, NearbyNpc } from '../../sdk/types';
import { INVENTORY_SIZE } from '../lib/items';
import { levelUpChain } from '../lib/levelup';
import { swap, type GiveSpec, type SwapResult, type SwapSdk, type WantSpec } from '../lib/trade';
import { failureReason, onStates, waitUntil, type StateSource } from '../lib/wait';
import { chebyshev, invCount, opIndex, worn } from '../lib/world';
import type { RuneUseTable } from '../lib/travel';
import { levelForXp, XP_RATE, xpForLevel } from '../lib/xp';
import type { Step, StepContext } from '../runner/step';

export const skill = 'magic';

export const S02_ID = 'S02 magic';
export const S04_ID = 'S04 magic';

// ------------------------------------------------------------------ content

/** Spell components (sdk/spells.ts; magic.if). */
export const WIND_STRIKE = 1152;

/** The Lumbridge east chicken coop, where magic.md measured Wind Strike 1-7 (`magic-strike.ts`). */
export const COOP = { x: 3233, z: 3295 } as const;
/** S02 may start within this many tiles of COOP (the leg T01-02 ends at the coop gate, 3235,3295). */
export const COOP_RADIUS = 12;
const CHICKEN = /^chicken$/i;

export type Tier = 'sapphire' | 'emerald' | 'ruby' | 'diamond';
export const TIER_ORDER: readonly Tier[] = ['sapphire', 'emerald', 'ruby', 'diamond'];

export type Rune = 'cosmic' | 'air' | 'fire' | 'earth';
export const RUNE_NAMES: Record<Rune, string> = { cosmic: 'Cosmic rune', air: 'Air rune', fire: 'Fire rune', earth: 'Earth rune' };

export interface Enchant {
    /** The ring's in-game name (rings.obj). */
    ring: string;
    /** The unnoted ring's obj id; its note is the next id, and S04 casts on, wants and counts this one only. */
    ringId: number;
    /** The enchanted ring's name (enchanted_jewelry.obj; magic_spells.dbrow convertobj). */
    product: string;
    level: number;
    com: number;
    /** Base xp per cast (magic_spells.dbrow experience / 10). */
    base: number;
    /** Runes per cast with the staff of water worn: Lvl-1's water rune is the staff's. */
    runes: Partial<Record<Rune, number>>;
}

/** magic_spells.dbrow: levelrequired, runesrequired, experience; components from sdk/spells.ts. */
export const ENCHANTS: Record<Tier, Enchant> = {
    sapphire: { ring: 'Sapphire ring', ringId: 1637, product: 'Ring of recoil', level: 7, com: 1155, base: 17.5, runes: { cosmic: 1 } },
    emerald: { ring: 'Emerald ring', ringId: 1639, product: 'Ring of dueling(8)', level: 27, com: 1165, base: 37, runes: { cosmic: 1, air: 3 } },
    ruby: { ring: 'Ruby ring', ringId: 1641, product: 'Ring of forging', level: 49, com: 1176, base: 59, runes: { cosmic: 1, fire: 5 } },
    diamond: { ring: 'Diamond ring', ringId: 1643, product: 'Ring of life', level: 57, com: 1180, base: 67, runes: { cosmic: 1, earth: 10 } },
};

const STAFF = /^staff of water$/i;
const PRODUCTS = new Set(TIER_ORDER.map(t => ENCHANTS[t].product.toLowerCase()));

/** Levels whose level-up shows an unlock page after the level-up box (levelup_unlocks_magic.rs2). */
export const MAGIC_UNLOCK_LEVELS: ReadonlySet<number> = new Set([
    3, 5, 7, 9, 11, 13, 15, 17, 19, 20, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 43, 45, 47, 49, 50, 51, 53, 55, 56, 57, 58, 59,
    60, 61, 62, 63, 65, 66, 68, 70, 73, 75, 79, 80,
]);

/** Continues that answer a Magic level-up page at `level`: the box, and the unlock page if the level has one. */
export function pagesAt(level: number): number {
    return MAGIC_UNLOCK_LEVELS.has(level) ? 2 : 1;
}

// ------------------------------------------------------------------ ring loads

export type RingCounts = Partial<Record<Tier, number>>;

/** One trade's rings, and the account that gives them (default: the step's `giver`). */
export interface RingLoad {
    rings: RingCounts;
    giver?: string;
}

/**
 * The route's three loads of 20 (SUPPLIES.md H3): 12 sapphire, 27 emerald, 16 ruby and 5
 * diamond, cut so that every load is castable in order from the bottom of Magic 7.
 */
export const ROUTE_LOADS: readonly RingCounts[] = [
    { sapphire: 12, emerald: 8 },
    { emerald: 19, ruby: 1 },
    { ruby: 15, diamond: 5 },
];

export function ringTotal(r: RingCounts): number {
    return TIER_ORDER.reduce((a, t) => a + (r[t] ?? 0), 0);
}

/** Base xp the rings pay when every one is enchanted. */
export function ringBase(r: RingCounts): number {
    return TIER_ORDER.reduce((a, t) => a + (r[t] ?? 0) * ENCHANTS[t].base, 0);
}

/**
 * The hand-off with the ring giver (SUPPLIES.md H3, "trade giver"), as proposed to rs/41 at
 * cairn://p/rs/41/1/coordinator/messages. run.ts passes the giver's account as `giver` (or one
 * per load); this module imports nothing from helpers/.
 */
export const RING_CONTRACT = {
    helper: 'H3 ring giver (SUPPLIES.md), the trade giver role (rs/41)',
    /**
     * Within a tile or two of SCORED and on its side of any wall or fence: the trade request
     * paths to the partner, so a giver behind an obstacle makes both players walk around it to
     * meet (lab: about 20 ticks, and the next load's giver left out of view).
     */
    where: "beside SCORED at the Firemaking row's end, same side of any wall, staged during S03",
    loads: ROUTE_LOADS,
    /** Each load unnoted, in the giver's inventory, with at most 8 other items (it takes 20 rings back). */
    giverHolds: 'the load, unnoted, and at most 8 other items',
    /** SCORED trade-ops the giver on the label two after the load's last cast, every few ticks until the screens open; a standing request from the giver opens on that click. */
    opens: 'SCORED, at the last cast + 2 (lands as the delay clears)',
    /**
     * The giver's request follows bone-giver.ts decideRequest: re-sent on the frame after a "busy"
     * bounce (SCORED is delayed two ticks of every three while casting) or after 3 frames without
     * an answer, and never once "Sending trade offer..." came back. A request that lands on the
     * open trade closes it (OpPlayerHandler), so a giver re-requesting on a timer fails trades.
     */
    giverRequests: 'standing: re-send only after a busy bounce or no reply (decideRequest)',
    /** The giver offers exactly the load and accepts, re-accepts once SCORED's offer lands, and accepts the confirm screen: give() with expectTheirs ANY_OFFER, or mule.ts giveOpenTrade. */
    giverHalf: 'offer the load, accept, re-accept after our offer, confirm; take whatever SCORED offers',
    /** Loads 2 and 3 come in the same trade that takes the previous load's 20 enchanted rings; the last 20 stay with SCORED for S05's swap at Doric's (rs/158). */
    scoredGives: 'the previous load\'s enchanted rings (none on load 1; load 3\'s go in S05\'s H4 swap)',
    /** A load is cast in 60 ticks, so the next one must be in a giver's inventory by then: one account per load (rs/41: cairn_h81-h83), since each takes 20 rings back and no bank is near. */
    restockWithin: 60,
} as const;

// ------------------------------------------------------------------ state readers

const magicSkill = (s: BotWorldState | null | undefined) => s?.skills.find(k => k.name.toLowerCase() === 'magic');

export function magicXp(s: BotWorldState | null | undefined): number {
    return magicSkill(s)?.experience ?? 0;
}

export function magicLevel(s: BotWorldState | null | undefined): number {
    return magicSkill(s)?.baseLevel ?? 1;
}

export function tierOf(name: string): Tier | undefined {
    const n = name.trim().toLowerCase();
    return TIER_ORDER.find(t => ENCHANTS[t].ring.toLowerCase() === n);
}

export function isProduct(name: string): boolean {
    return PRODUCTS.has(name.trim().toLowerCase());
}

/**
 * Unenchanted rings held, lowest tier first, then by slot: the order they are cast in. Unnoted only
 * (by obj id): a noted stack shares the ring's name, but the spell refuses it ('This spell can only be
 * cast on Emerald Amulets and Rings'), so it is no ring to cast or count (attempt 2: 1640 x19).
 */
export function heldRings(s: BotWorldState): Array<InventoryItem & { tier: Tier }> {
    const out: Array<InventoryItem & { tier: Tier }> = [];
    for (const i of s.inventory) {
        const tier = tierOf(i.name);
        if (tier && i.id === ENCHANTS[tier].ringId) out.push({ ...i, tier });
    }
    return out.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.slot - b.slot);
}

/** Ring stacks held under a ring's name but not its unnoted id: noted rings, which S04 refuses. */
export function notedRings(s: BotWorldState): InventoryItem[] {
    return s.inventory.filter(i => {
        const tier = tierOf(i.name);
        return !!tier && i.id !== ENCHANTS[tier].ringId;
    });
}

/** S04's refusal for noted rings held, or null. */
export function notedRingRefusal(s: BotWorldState): string | null {
    const noted = notedRings(s);
    if (!noted.length) return null;
    const what = noted.map(i => `${i.name} @${i.id} x${i.count} (unnoted is @${ENCHANTS[tierOf(i.name)!].ringId})`).join(', ');
    return `noted rings held: ${what}; S04 enchants unnoted rings only, so the ring givers must stage them unnoted`;
}

export function heldRingCounts(s: BotWorldState): RingCounts {
    const out: RingCounts = {};
    for (const r of heldRings(s)) out[r.tier] = (out[r.tier] ?? 0) + r.count;
    return out;
}

export function heldProducts(s: BotWorldState): InventoryItem[] {
    return s.inventory.filter(i => isProduct(i.name));
}

export function freeSlots(s: BotWorldState): number {
    return INVENTORY_SIZE - s.inventory.length;
}

export function runesHeld(s: BotWorldState): Record<Rune, number> {
    return { cosmic: invCount(s, /^cosmic rune$/i), air: invCount(s, /^air rune$/i), fire: invCount(s, /^fire rune$/i), earth: invCount(s, /^earth rune$/i) };
}

// ------------------------------------------------------------------ the plan

export interface PlanResult {
    /** Every ring held and to come is castable in order and Magic reaches the target. */
    ok: boolean;
    reason?: string;
    /** Casts the plan makes, by tier (it stops at the target level). */
    casts: RingCounts;
    runes: Record<Rune, number>;
    /** Magic level when the plan ends. */
    level: number;
}

/**
 * Simulate S04 from `xp` with the rings `held` and the loads still to come: each load is cast
 * out, lowest tier first, before the next arrives, stopping at `untilLevel`. Fails when a ring
 * comes up for casting that the level then cannot enchant, or when the rings run out first.
 */
export function simulatePlan(xp: number, held: RingCounts, loads: readonly RingCounts[], untilLevel: number): PlanResult {
    const casts: RingCounts = {};
    const runes: Record<Rune, number> = { cosmic: 0, air: 0, fire: 0, earth: 0 };
    let x = xp;
    const done = (): PlanResult => ({ ok: true, casts, runes, level: levelForXp(x) });
    const batches: RingCounts[] = [held, ...loads];
    for (let b = 0; b < batches.length; b++) {
        for (const t of TIER_ORDER) {
            for (let n = batches[b]![t] ?? 0; n > 0; n--) {
                if (levelForXp(x) >= untilLevel) return done();
                const e = ENCHANTS[t];
                const lvl = levelForXp(x);
                if (lvl < e.level) {
                    const where = b === 0 ? 'held' : `in load ${b}`;
                    return { ok: false, reason: `a ${e.ring.toLowerCase()} ${where} comes up at Magic ${lvl}, below its ${e.level}`, casts, runes, level: lvl };
                }
                x += e.base * XP_RATE;
                casts[t] = (casts[t] ?? 0) + 1;
                for (const [r, k] of Object.entries(e.runes) as [Rune, number][]) runes[r] += k;
            }
        }
    }
    if (levelForXp(x) >= untilLevel) return done();
    return { ok: false, reason: `the rings end at Magic ${levelForXp(x)}, short of ${untilLevel}`, casts, runes, level: levelForXp(x) };
}

/** Wind Strike's runes a cast (magic_combat_spells.dbrow `magic_spell_wind_strike`). */
export const WIND_STRIKE_RUNES = { mindrune: 1, airrune: 1 } as const;
/**
 * S02's casts, the measured maximum: 3 strikes in 3 of 4 lab runs, 4 in 1 (magic.md section 9,
 * rs/285). Five happen only if every strike splashes (4 x 5.5 base is short of level 7's 23.3).
 */
export const S02_MAX_STRIKES = 4;

/** The route's S04 plan: ROUTE_LOADS enchanted from the bottom of Magic 7 to 59. */
const S04_ROUTE = simulatePlan(xpForLevel(7), {}, ROUTE_LOADS, 59);

/** S02's and S04's runes on the route (lib/travel.ts RuneUseTable), net of the staff of water (Lvl-1 enchant's water). */
export const RUNE_USE: RuneUseTable = {
    S02: { mindrune: WIND_STRIKE_RUNES.mindrune * S02_MAX_STRIKES, airrune: WIND_STRIKE_RUNES.airrune * S02_MAX_STRIKES },
    S04: { cosmicrune: S04_ROUTE.runes.cosmic, airrune: S04_ROUTE.runes.air, firerune: S04_ROUTE.runes.fire, earthrune: S04_ROUTE.runes.earth },
};
export const RUNE_STAFF = 'staff of water';

/** Slack on load inference, in base xp: covers S02 ending a few base past its level (one Wind Strike is at most ~13). */
export const RESUME_SLACK_BASE = 100;

/**
 * How many of `loads` have been delivered, from the Magic xp and the rings held: the progress
 * since `startXp` (cast plus still held) matches a whole number of loads, because the module
 * trades only once a load is cast out. Every load is worth far more than the slack, so the
 * answer is exact while S04 started within RESUME_SLACK_BASE of `startXp`.
 */
export function loadsDelivered(xp: number, held: RingCounts, loads: readonly RingCounts[], startXp: number): number {
    const progress = (xp - startXp) / XP_RATE + ringBase(held);
    let k = 0;
    let cum = 0;
    for (const load of loads) {
        cum += ringBase(load);
        if (cum > progress + RESUME_SLACK_BASE) break;
        k++;
    }
    return k;
}

// ------------------------------------------------------------------ level-up pages

export interface PageMemory {
    level: number | null;
    /** The label to send the blind burst on (the one after the level rose); -1 when none is due. */
    burstAt: number;
    /** The label the last continue went out on. */
    sentAt: number;
    chain: (s: BotWorldState) => boolean;
}

export function newPageMemory(): PageMemory {
    return { level: null, burstAt: -1, sentAt: -Infinity, chain: levelUpChain() };
}

/**
 * Continues to send on this label (call once per label). A Magic level rise seen on label R
 * schedules pagesAt(level) continues on R+1, the label the page opens on (a continue sent on R
 * would land before the page and be refused). The backstop answers a level-up page still open
 * two labels after the last continue, one page at a time.
 */
export function pageStep(mem: PageMemory, s: BotWorldState): number {
    const lvl = magicLevel(s);
    if (mem.level !== null && lvl > mem.level) mem.burstAt = s.tick + 1;
    mem.level = lvl;
    const isPage = mem.chain(s);
    if (mem.burstAt >= 0 && s.tick >= mem.burstAt) {
        mem.burstAt = -1;
        mem.sentAt = s.tick;
        return pagesAt(lvl);
    }
    if (isPage && !s.dialog.isWaiting && s.tick - mem.sentAt >= 2) {
        mem.sentAt = s.tick;
        return 1;
    }
    return 0;
}

/** A level-up burst is scheduled and not yet sent. */
export function burstPending(mem: PageMemory): boolean {
    return mem.burstAt >= 0;
}

// ------------------------------------------------------------------ S02: Wind Strike

export type StrikeSdk = StateSource & Pick<BotSDK, 'sendSpellOnNpc' | 'sendClickDialog'>;

/** Ticks without a live chicken in view before S02 gives up. */
export const NO_CHICKEN_TICKS = 10;

/** The chicken to strike: the current target while it is in view and alive, else the nearest live one, preferring one nobody fights. */
export function strikeTarget(s: BotWorldState, current: number | null): NearbyNpc | null {
    const live = s.nearbyNpcs.filter(n => CHICKEN.test(n.name) && n.hp !== 0);
    const cur = current === null ? undefined : live.find(n => n.index === current);
    if (cur) return cur;
    return [...live].sort((a, b) => Number(a.inCombat) - Number(b.inCombat) || a.distance - b.distance)[0] ?? null;
}

export interface StrikeResult {
    ok: boolean;
    reason?: string;
    /** Labels from the first click to the label the goal level showed. */
    ticks: number;
    clicks: number;
    xpTicks: number[];
    pagesSent: number;
    endTick: number;
}

/** Wind Strike chickens until Magic `until`, answering every level-up page on the label after the level shows. */
export async function strikeTo(sdk: StrikeSdk, until: number, opts: { maxTicks?: number } = {}): Promise<StrikeResult> {
    const s0 = sdk.getState();
    if (!s0) throw new Error('strikeTo: no state');
    const mem = newPageMemory();
    let target: number | null = null;
    let last = -1;
    let first = -1;
    let clicks = 0;
    let pagesSent = 0;
    let noChickenSince = -1;
    let reachedAt = -1;
    let prevXp = magicXp(s0);
    const xpTicks: number[] = [];
    type Out = { ok: boolean; reason?: string; tick: number };
    const r = await onStates<Out>(sdk, opts.maxTicks ?? 150, s => {
        if (s.tick === last) return undefined;
        last = s.tick;
        const xp = magicXp(s);
        if (xp > prevXp) xpTicks.push(s.tick);
        prevXp = xp;
        const pages = pageStep(mem, s);
        for (let i = 0; i < pages; i++) void sdk.sendClickDialog(0);
        pagesSent += pages;
        if (magicLevel(s) >= until) {
            if (reachedAt < 0) reachedAt = s.tick;
            return burstPending(mem) ? undefined : { ok: true, tick: s.tick };
        }
        const t = strikeTarget(s, target);
        if (!t) {
            if (noChickenSince < 0) noChickenSince = s.tick;
            if (s.tick - noChickenSince >= NO_CHICKEN_TICKS) return { ok: false, reason: `no live chicken in view for ${NO_CHICKEN_TICKS} ticks`, tick: s.tick };
            return undefined;
        }
        noChickenSince = -1;
        target = t.index;
        if (first < 0) first = s.tick;
        void sdk.sendSpellOnNpc(t.index, WIND_STRIKE);
        clicks++;
        return undefined;
    });
    const endTick = sdk.getState()?.tick ?? last;
    const base = { clicks, xpTicks, pagesSent, endTick, ticks: reachedAt >= 0 && first >= 0 ? reachedAt - first : endTick - Math.max(first, s0.tick) };
    if (!r.ok) return { ok: false, reason: failureReason(r.reason), ...base };
    return { ok: r.value.ok, ...(r.value.reason ? { reason: r.value.reason } : {}), ...base };
}

// ------------------------------------------------------------------ S04: enchanting

export type EnchantSdk = StateSource & Pick<BotSDK, 'sendSpellOnItem' | 'sendClickDialog' | 'sendUseItem'>;

/** Ticks a cast's p_delay(1) holds the player after the cast's own tick. */
export const CAST_DELAY_TICKS = 2;

/** The casts to send this label: the first `n` rings Magic `level` can enchant, lowest tier first. */
export function castPicks(s: BotWorldState, level: number, n = 1): Array<{ slot: number; com: number; tier: Tier }> {
    return heldRings(s)
        .filter(r => ENCHANTS[r.tier].level <= level)
        .slice(0, n)
        .map(r => ({ slot: r.slot, com: ENCHANTS[r.tier].com, tier: r.tier }));
}

export interface EnchantRun {
    ok: boolean;
    reason?: string;
    casts: number;
    /** Labels on which Magic xp rose: one per landed cast. */
    xpTicks: number[];
    /** The last cast raised the level, so its page opens on the label after it. */
    lastRose: boolean;
    clicks: number;
    endTick: number;
}

/**
 * Enchant every ring held, one spell-on-item per label on the next castable ring, until none is
 * left or Magic reaches `untilLevel`. Never waits for the xp: a click inside a cast's delay is
 * dropped by the server at no cost, so the first click after the delay clears is the next cast.
 */
export async function enchantHeld(sdk: EnchantSdk, opts: { untilLevel: number; clicksPerTick?: number; maxTicks?: number }): Promise<EnchantRun> {
    const s0 = sdk.getState();
    if (!s0) throw new Error('enchantHeld: no state');
    const per = Math.max(1, opts.clicksPerTick ?? 1);
    const rings = heldRings(s0).length;
    let last = -1;
    let clicks = 0;
    let prevXp = magicXp(s0);
    let lastRose = false;
    const xpTicks: number[] = [];
    type Out = { ok: boolean; reason?: string };
    const r = await onStates<Out>(sdk, opts.maxTicks ?? rings * 3 + 20, s => {
        const xp = magicXp(s);
        if (xp > prevXp) {
            xpTicks.push(s.tick);
            lastRose = levelForXp(xp) > levelForXp(prevXp);
        }
        prevXp = xp;
        if (s.tick === last) return undefined;
        const level = magicLevel(s);
        if (level >= opts.untilLevel) return { ok: true };
        const picks = castPicks(s, level, per);
        if (picks.length === 0) {
            const stuck = heldRings(s);
            return stuck.length === 0 ? { ok: true } : { ok: false, reason: `${stuck.length} rings held that Magic ${level} cannot enchant (lowest: ${ENCHANTS[stuck[0]!.tier].ring.toLowerCase()}, ${ENCHANTS[stuck[0]!.tier].level})` };
        }
        last = s.tick;
        for (const p of picks) void sdk.sendSpellOnItem(p.slot, p.com);
        clicks += picks.length;
        return undefined;
    });
    const endTick = sdk.getState()?.tick ?? last;
    const out = { casts: xpTicks.length, xpTicks, lastRose, clicks, endTick };
    if (!r.ok) return { ok: false, reason: `enchanting: ${failureReason(r.reason)}`, ...out };
    return { ok: r.value.ok, ...(r.value.reason ? { reason: r.value.reason } : {}), ...out };
}

/**
 * A swap's gives for the enchanted rings held: one offer-all entry per item id. S04's later loads
 * offer the previous load's with it, and S05's trade at Doric's offers load 3's (ruby and diamond
 * products, two entries) with it.
 */
export function enchantedRingSpecs(s: BotWorldState): GiveSpec[] {
    const ids = new Set<number>();
    for (const i of s.inventory) if (isProduct(i.name)) ids.add(i.id);
    return [...ids].map(id => ({ item: id }));
}

export function wantFor(load: RingCounts): WantSpec[] {
    // By the unnoted obj id: a name want would take the noted stack too (lib/trade.ts's want rule).
    return TIER_ORDER.filter(t => (load[t] ?? 0) > 0).map(t => ({ item: ENCHANTS[t].ringId, amount: load[t]! }));
}

// ------------------------------------------------------------------ options

export interface MagicOptions {
    /** S02's goal (default 7, the Lvl-1 Enchant). */
    strikeUntil?: number;
    /**
     * Stacks S02 drops on its exit, once nothing on the route casts with them (default the mind
     * runes: rs/158's ruling, so H4 at Doric's fits with a slot spare). One drop per stack, sent
     * without waiting: the walk that follows keeps its queue.
     */
    dropAtStrikeExit?: readonly RegExp[];
    /** S04's goal (default 59: Fire Blast, and the Ardougne teleport's 51 on the way). */
    untilLevel?: number;
    /** The ring loads in delivery order (default ROUTE_LOADS). */
    loads?: ReadonlyArray<RingCounts | RingLoad>;
    /** The ring giver's account, for every load that names none. */
    giver?: string;
    /** Spell-on-item clicks per label while enchanting (default 1, levelup-cost.md's measured 26 of 26 gaps of 3). */
    clicksPerTick?: number;
    /** The Magic xp S04 started from, for load inference on a resume (default the bottom of `strikeUntil`). */
    startXp?: number;
    /** S02's site (default the coop). */
    site?: { x: number; z: number; radius: number };
    /** Per-step measurements, for the lab and the run's log. */
    onReport?: (r: MagicReport) => void;
}

export interface TradeReport {
    load: number;
    giver: string;
    ok: boolean;
    ticks: number;
    openTicks: number;
    gave: number;
    received: number;
    reason?: string;
}

export type MagicReport =
    | { step: 'S02'; strike: StrikeResult; dropped: string[] }
    | {
          step: 'S04';
          casts: number;
          /** Cast-to-cast gaps inside a load (ticks: count). */
          gaps: Record<number, number>;
          /** Last cast of a load to the first cast of the next: the trade's cost on the cast clock. */
          turnarounds: number[];
          trades: TradeReport[];
          pagesSent: number;
          startTick: number;
          endTick: number;
          /** The tick the staff of water showed worn, and the wield clicks it took (0: already worn). */
          wield: { tick: number; sends: number };
      };

export interface Resolved {
    strikeUntil: number;
    dropAtStrikeExit: readonly RegExp[];
    untilLevel: number;
    loads: Array<{ rings: RingCounts; giver: string | undefined }>;
    clicksPerTick: number;
    startXp: number;
    site: { x: number; z: number; radius: number };
    onReport?: (r: MagicReport) => void;
}

export function resolveOptions(o: MagicOptions = {}): Resolved {
    const strikeUntil = o.strikeUntil ?? 7;
    const untilLevel = o.untilLevel ?? 59;
    if (strikeUntil < 2 || strikeUntil > 99 || untilLevel < 2 || untilLevel > 99) throw new Error('magic: levels must be 2-99');
    const loads = (o.loads ?? ROUTE_LOADS).map(l => ('rings' in l && typeof l.rings === 'object' ? { rings: { ...(l as RingLoad).rings }, giver: (l as RingLoad).giver ?? o.giver } : { rings: { ...(l as RingCounts) }, giver: o.giver }));
    for (const [i, l] of loads.entries()) if (ringTotal(l.rings) <= 0) throw new Error(`magic: load ${i + 1} holds no rings`);
    return {
        strikeUntil,
        dropAtStrikeExit: o.dropAtStrikeExit ?? [/^mind rune$/i],
        untilLevel,
        loads,
        clicksPerTick: Math.max(1, Math.floor(o.clicksPerTick ?? 1)),
        startXp: o.startXp ?? xpForLevel(strikeUntil),
        site: o.site ?? { ...COOP, radius: COOP_RADIUS },
        ...(o.onReport ? { onReport: o.onReport } : {}),
    };
}

// ------------------------------------------------------------------ S02 step

export type S02Sdk = StrikeSdk & Pick<BotSDK, 'sendDropItem'>;

/** Send one drop per held stack matching `which`, without waiting; returns the names sent. */
export function dropStacks(sdk: S02Sdk, which: readonly RegExp[]): string[] {
    const s = sdk.getState();
    if (!s || !which.length) return [];
    const items = s.inventory.filter(i => which.some(re => re.test(i.name)));
    for (const i of items) void sdk.sendDropItem(i.slot);
    return items.map(i => i.name);
}

const inGame = (s: BotWorldState) => s.inGame && !!s.player;

export function s02Pre(s: BotWorldState, o: Resolved): true | string {
    if (!inGame(s)) return 'not in game';
    const level = magicLevel(s);
    if (level >= o.strikeUntil) return true;
    const p = s.player!;
    const d = chebyshev({ x: p.worldX, z: p.worldZ }, o.site);
    if (d > o.site.radius) return `at ${p.worldX},${p.worldZ}, ${d} tiles from the chickens at ${o.site.x},${o.site.z} (S02 starts within ${o.site.radius})`;
    // Worst case every cast misses: 5.5 base each (magic_combat_spells.dbrow).
    const casts = Math.ceil((xpForLevel(o.strikeUntil) - magicXp(s)) / (5.5 * XP_RATE));
    const air = invCount(s, /^air rune$/i);
    const mind = invCount(s, /^mind rune$/i);
    if (air < casts || mind < casts) return `Wind Strike to ${o.strikeUntil} needs up to ${casts} air and mind runes; holding ${air} air, ${mind} mind (the starter kit's 25 and 15)`;
    // Main's slot rule: S02 takes no item (the chickens' drops stay on the ground), so it needs no
    // free slot; its items are the runes above.
    return true;
}

// ------------------------------------------------------------------ S04 step

export interface S04Status {
    level: number;
    held: RingCounts;
    /** Loads delivered so far (inferred), and the ones still to come. */
    delivered: number;
    remaining: Array<{ rings: RingCounts; giver: string | undefined }>;
    products: number;
    /** The step's goal is met (the last load's enchanted rings stay held for S05). */
    passed: boolean;
}

export function s04Status(s: BotWorldState, o: Resolved): S04Status {
    const level = magicLevel(s);
    const held = heldRingCounts(s);
    const delivered = loadsDelivered(magicXp(s), held, o.loads.map(l => l.rings), o.startXp);
    const products = heldProducts(s).length;
    const passed = level >= o.untilLevel;
    return { level, held, delivered, remaining: o.loads.slice(delivered), products, passed };
}

export function s04Pre(s: BotWorldState, o: Resolved): true | string {
    if (!inGame(s)) return 'not in game';
    const st = s04Status(s, o);
    if (st.passed) return true;
    if (st.level < ENCHANTS.sapphire.level) return `Magic ${st.level}, below Lvl-1 Enchant's ${ENCHANTS.sapphire.level} (S02 first)`;
    if (!worn(s, STAFF) && !invCount(s, STAFF)) return 'no staff of water, worn or held (H1)';
    const noted = notedRingRefusal(s);
    if (noted) return noted;
    const plan = simulatePlan(magicXp(s), st.held, st.remaining.map(l => l.rings), o.untilLevel);
    if (!plan.ok) return `the ring loads cannot take Magic ${st.level} to ${o.untilLevel}: ${plan.reason}`;
    const runes = runesHeld(s);
    const short = (Object.keys(RUNE_NAMES) as Rune[]).filter(r => runes[r] < plan.runes[r]);
    if (short.length) return `runes short for the plan: ${short.map(r => `${RUNE_NAMES[r].toLowerCase()} ${runes[r]} of ${plan.runes[r]}`).join(', ')}`;
    const nameless = st.remaining.findIndex(l => !l.giver);
    if (nameless >= 0) return `ring load ${st.delivered + nameless + 1} has no giver (opts.giver or the load's giver)`;
    // Main's slot rule (runecraft.ts's form): the next ring load must fit, counting the enchanted
    // rings that leave in the same trade as room. The last load's rings are kept for H4, but they
    // are that load enchanted in place, so they need no slot of their own.
    if (ringTotal(st.held) === 0 && st.remaining.length) {
        const next = ringTotal(st.remaining[0]!.rings);
        const other = s.inventory.filter(i => !isProduct(i.name) && !tierOf(i.name));
        const room = 28 - other.length;
        if (room < next) return `${other.length} other items (${[...new Set(other.map(i => i.name))].join(', ')}): need ${next} free slots for ring load ${st.delivered + 1} (${st.products} enchanted rings go back in its trade)`;
    }
    return true;
}

function histogram(xs: readonly number[]): Record<number, number> {
    const h: Record<number, number> = {};
    for (const x of xs) h[x] = (h[x] ?? 0) + 1;
    return h;
}

export type S04Sdk = EnchantSdk & SwapSdk;

/** Wield sends before S04 refuses, and the observed ticks each waits for the staff to show worn. */
export const WIELD_SENDS = 3;
export const WIELD_WAIT_TICKS = 3;

export type WieldResult = { ok: true; tick: number; sends: number } | { ok: false; sends: number; reason: string };

/**
 * The staff of water worn before S04's first cast, confirmed on observed ticks: send the wield,
 * wait up to WIELD_WAIT_TICKS for it in the equipment, re-send, at most WIELD_SENDS times. The run
 * reaches S04 on the tick S03's last fire moves SCORED, when a click can be dropped, with no water
 * runes: every enchant then fails without the staff (rs/627).
 */
export async function wieldStaff(sdk: Pick<S04Sdk, 'sendUseItem'> & StateSource, o: { sends?: number; waitTicks?: number } = {}): Promise<WieldResult> {
    const sends = o.sends ?? WIELD_SENDS;
    const waitTicks = o.waitTicks ?? WIELD_WAIT_TICKS;
    let sent = 0;
    for (;;) {
        const s = sdk.getState();
        if (s && worn(s, STAFF)) return { ok: true, tick: s.tick, sends: sent };
        const staff = s?.inventory.find(i => STAFF.test(i.name));
        if (!staff) return { ok: false, sends: sent, reason: 'no staff of water held or worn' };
        if (sent >= sends) return { ok: false, sends: sent, reason: `staff of water not worn after ${sent} wield clicks, ${waitTicks} observed ticks each` };
        void sdk.sendUseItem(staff.slot, opIndex(staff, /^(wield|wear)$/i) ?? 2);
        sent++;
        await waitUntil(sdk, st => !!worn(st, STAFF), { maxTicks: waitTicks });
    }
}

/** Resolve on the label `n` after `tick` (the trade click sent there lands as the cast's delay clears). */
async function labelAfter(sdk: StateSource, tick: number, n: number): Promise<void> {
    const r = await waitUntil(sdk, s => s.tick >= tick + n, { maxTicks: n + 3 });
    if (!r.ok) throw new Error(`waiting ${n} ticks after the last cast: ${failureReason(r.reason)}`);
}

async function runS04(ctx: StepContext<any>, o: Resolved): Promise<void> {
    const sdk = ctx.sdk as unknown as S04Sdk;
    const s0 = sdk.getState()!;
    const startTick = s0.tick;
    const trades: TradeReport[] = [];
    const castTicks: number[][] = [];
    let casts = 0;
    let pagesSent = 0;
    const wield = await wieldStaff(sdk);
    if (!wield.ok) throw new Error(`S04 refuses: ${wield.reason}`);

    const trade = async (load: number, giver: string, want: WantSpec[], afterTick: number): Promise<SwapResult> => {
        const give = enchantedRingSpecs(sdk.getState()!);
        if (afterTick >= 0) await labelAfter(sdk, afterTick, CAST_DELAY_TICKS);
        const r = await swap(sdk, giver, give, want, { closeModals: true });
        // Rings only: the staff's wield can land inside the first trade and read as a loss.
        const count = (xs: ReadonlyArray<{ name: string; count: number }>) => xs.filter(i => isProduct(i.name) || tierOf(i.name)).reduce((a, i) => a + i.count, 0);
        trades.push({ load, giver, ok: r.ok, ticks: r.ticks, openTicks: r.openTicks, gave: count(r.gave), received: count(r.received), ...(r.reason ? { reason: r.reason } : {}) });
        return r;
    };

    let lastCast = -1;
    let lastRose = false;
    for (;;) {
        // A load that came noted is refused at once with its reason, never clicked until the cast times out.
        const noted = notedRingRefusal(sdk.getState()!);
        if (noted) throw new Error(`S04 refuses: ${noted}`);
        const run = await enchantHeld(sdk, { untilLevel: o.untilLevel, clicksPerTick: o.clicksPerTick });
        casts += run.casts;
        if (run.xpTicks.length) {
            castTicks.push(run.xpTicks);
            lastCast = run.xpTicks.at(-1)!;
            lastRose = run.lastRose;
        }
        if (!run.ok) throw new Error(run.reason ?? 'enchanting failed');
        const st = s04Status(sdk.getState()!, o);
        if (st.level >= o.untilLevel) break;
        const next = st.remaining[0];
        if (!next) throw new Error(`Magic ${st.level} with every ring load delivered; ${o.untilLevel} needs more rings`);
        const n = st.delivered + 1;
        const r = await trade(n, next.giver!, wantFor(next.rings), lastCast);
        if (!r.ok) throw new Error(`ring load ${n} from ${next.giver}: ${r.reason ?? 'failed'}`);
    }

    if (lastRose) {
        // No trade follows to close the last cast's level-up page (T04-05's IF_BUTTON teleport
        // would not): answer it blind on the label it opens on.
        await labelAfter(sdk, lastCast, 1);
        const k = pagesAt(magicLevel(sdk.getState()!));
        for (let i = 0; i < k; i++) void sdk.sendClickDialog(0);
        pagesSent += k;
    }

    const inLoad = castTicks.flatMap(ts => ts.slice(1).map((t, i) => t - ts[i]!));
    const turnarounds = castTicks.slice(1).map((ts, i) => ts[0]! - castTicks[i]!.at(-1)!);
    o.onReport?.({ step: 'S04', casts, gaps: histogram(inLoad), turnarounds, trades, pagesSent, startTick, endTick: sdk.getState()?.tick ?? startTick, wield: { tick: wield.tick, sends: wield.sends } });
}

// ------------------------------------------------------------------ steps

export function steps(opts: MagicOptions = {}): Step<any>[] {
    const o = resolveOptions(opts);
    const s02: Step<any> = {
        name: S02_ID,
        preconditions: s => s02Pre(s, o),
        run: async ctx => {
            const sdk = ctx.sdk as unknown as S02Sdk;
            if (magicLevel(sdk.getState()) >= o.strikeUntil) {
                dropStacks(sdk, o.dropAtStrikeExit);
                return;
            }
            const r = await strikeTo(sdk, o.strikeUntil);
            const dropped = r.ok ? dropStacks(sdk, o.dropAtStrikeExit) : [];
            o.onReport?.({ step: 'S02', strike: r, dropped });
            if (!r.ok) throw new Error(`Wind Strike to ${o.strikeUntil}: ${r.reason}`);
        },
        postconditions: s => (magicLevel(s) >= o.strikeUntil ? true : `Magic ${magicLevel(s)}, below ${o.strikeUntil}`),
        logoutSafe: true,
        done: ({ state }) => magicLevel(state) >= o.strikeUntil,
    };
    const s04: Step<any> = {
        name: S04_ID,
        preconditions: s => s04Pre(s, o),
        run: async ctx => {
            if (s04Status(ctx.sdk.getState()!, o).passed) return;
            await runS04(ctx, o);
        },
        postconditions: s => {
            const st = s04Status(s, o);
            return st.passed ? true : `Magic ${st.level}, below ${o.untilLevel}`;
        },
        logoutSafe: true,
        done: ({ state }) => s04Status(state, o).passed,
        inProgress: ({ state }) => {
            const st = s04Status(state, o);
            return !st.passed && st.level >= ENCHANTS.sapphire.level && (st.delivered > 0 || st.products > 0 || ringTotal(st.held) > 0);
        },
    };
    return [s02, s04];
}
