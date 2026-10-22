// Cannon helper: a fresh demo account that completes Dwarf Cannon, buys the
// multicannon sets from Nulodion and makes cannonballs, for the scored account's
// hand-offs H11, H11r and H23 (docs/speedrun/SUPPLIES.md).
//
//   ROLE_OPTIONS='{"sets":2,"balls":1400}' bun speedrun/helpers/cannon.ts cairn_h92
//
// Options (all optional):
//   sets: number            cannon sets to hold (default 2: one for the route, one spare)
//   balls: number           cannonballs to hold (default 1160: 290 steel bars, rs/129's pricing)
//   funders: string[]       login-name RegExps whose trades are accepted (default ^cairn_h\d+$)
//   crossingHitpoints: n    Hitpoints to train on cows before White Wolf Mountain (default 30)
//   food: n                 sharks to buy at the Grand Exchange before the railings (default 5;
//                           0 rests instead, about 4,400 extra ticks at Crafting 1)
//   foodWaitMinutes: n      how long to wait at Varrock West for food money (default 10)
//   steelMaxPrice: n        with no steel bars left, buy up to 27 at the exchange at no more than
//                           this (default 0: never; wait for steel by trade instead)
//   stopAfter: 'quest'      stop once the quest is complete (development)
//   serve: {...}            hand the set and balls to the scored account instead (below)
//
// Serve mode (H11, H23 in docs/speedrun/SUPPLIES.md): with `serve` set, the role
// does no quest or production. It carries one set (the four parts) and `balls`
// cannonballs from the bank, stands on `tile`, keeps a trade request standing with
// the scored account (bone-giver.ts requestUntilOpen), and gives the whole load in
// one trade (lib/trade.ts give) when the scored account's own click opens it, with any
// `extras` (H11: the mithril scimitar, runes and sharks; H23: the magic shortbow) in the same
// offer, taking back whatever the scored account offers in that trade (nothing is expected). With
// `returnTile`, it then waits there for the set and the leftover balls to come back
// (H11r) and keeps them. With `returnExtras` (H11r: Monkey Madness's magic shortbow and
// 200 rune arrows) that take-back is two-way: the holder carries them from the bank with the
// load, and offers them in the same trade as the set comes back (lib/trade.ts swap); without,
// it only receives (receiveFrom). The scored account is never named: it is whoever in sight
// matches `receiver` (the sha256 of its canonical name, altar-cue.ts nameHash) or,
// without it, the receiver hash in the cue directory's cue.json.
//   serve.tile {x,z}        where the holder stands (required)
//   serve.balls n           cannonballs in the load (required)
//   serve.extras [{ item, count, obj? }]  more items in the same trade, by exact name; the load
//                           (4 parts, the balls, the extras) must fit 28 slots; `obj` is the
//                           staff-give name for labStock
//   serve.receiver hex      sha256 of the scored account's canonical name (default: the cue)
//   serve.bank {x,z}        where to load from (default Falador west; every bank is one bank)
//   serve.returnTile {x,z}  after the give, take the set back here
//   serve.returnExtras [{ item, count, obj? }]  given in the take-back trade (needs returnTile); as
//                           extras, and distinct from them; carried from the start, so the load
//                           and these together must fit 28 slots
//   serve.labStock          local lab only: make the load with staff commands
//   serve.id                names the hand-off in ctx.state (default tile and balls); a restart
//                           resumes it, so a hand-off that completed is never given twice
//   serve.noReplyTicks, serve.resendTicks, serve.cueDir   as bone-giver.ts
//   serve.scope             { step, family: 'cannon' }: the cue to read the receiver from
//                           (altar-cue.ts CueScope; S14 or S27); required without serve.receiver
//
// Only Nulodion's sale and the base's Set-up check the quest (nulodion.rs2:1-5,
// cannon_setup.rs2 [opheld1,twpart1]); the parts and the balls trade to anyone
// (no tradeable=no in quest_mcannon.obj; trade.rs2 movetotrade checks nothing else).
//
// Only a player who has completed Dwarf Cannon can buy the cannon or make
// cannonballs (nulodion.rs2:1-6, cannonballs.rs2:14-17; the ammo mould is
// untradeable), so this one account does the quest. Nulodion's shop
// (dwarven_workshop.inv) stocks the four parts, the manual and the mould but no
// cannonballs, and the Grand Exchange has none, so the balls are made: one steel bar
// used on a furnace gives 4 (Smithing 35, cannonballs.rs2).
//
// The quest stage is read from the quest journal (questlist:mcannon), so the role
// restarts from any point: the SDK exposes no varps, but every %mcannon stage has
// its own journal text (mcannon_journal.rs2).
//
// After the quest, `nextWork` picks each step from what the account holds: Smithing
// 1-15 on bronze from copper and tin it mines west of Falador (the exchange has no
// copper, tin or bronze), 15-35 on iron ore bought at the exchange, the mould from
// Nulodion's shop (Lawgof keeps the quest's), then cannonballs from steel bars handed
// over by trade. Every trade (coins, noted steel bars) meets at Varrock West bank;
// the bank is shared by every booth, so what arrives there is withdrawn in Falador.
// The sets are bought as soon as their coins are in hand, otherwise last.
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, NearbyLoc, TradeItem } from '../../sdk/types';
import { TRADE_REQUEST_CHAT_TYPE } from '../../sdk/types';
import { advance } from '../lib/dialogue';
import { ANY_OFFER, give, DROPPED_TICKS, offerSatisfies, receiveFrom, swap, tradeOf, type GiveResult, type GiveSpec, type SwapSdk, type TradeSdk, type WantSpec } from '../lib/trade';
import { INVENTORY_SIZE } from '../lib/items';
import { tickMs } from '../lib/wait';
import { assertUntracked, cueDir, CueWatcher, nameHash, scopeOption, type Cue, type CueScope } from './altar-cue';
import { cheat, isLocalServer, labTele, standOn } from './altar-room';
import { partnerIs, requestUntilOpen } from './bone-giver';
import { Buyer } from './buyer';
import { CROSSING_HITPOINTS, crossingSettings, TAVERLEY, trainHitpointsOnCows, type Pt } from '../lib/kandarin';
import { accountMatches, ChatCursor, DEFAULT_COURIERS, isStackableName, MULE_STAND, toRegExps } from './mule';
import type { Role, RoleContext, RoleFinish } from './role';
import { runStandalone } from './role';
import { inTutorial } from './wine-common';

// ------------------------------------------------------------------ places
// Read from the quest scripts and maps, checked in docs/speedrun/scripts/quest-mcannon-run.ts.

const LAWGOF: Pt = { x: 2571, z: 3461 }; // Commander Lawgof's spawn is 2571,3463
const SEERS: Pt = { x: 2725, z: 3491 }; // a leg between Taverley and the camp
/** Railing locs mcannonrailing1..6 (ids 15-20; bits 5-10 of %mcannonmulti). */
const RAILINGS: { x: number; z: number; id: number }[] = [
    { x: 2556, z: 3475, id: 15 },
    { x: 2558, z: 3472, id: 16 },
    { x: 2557, z: 3464, id: 17 },
    { x: 2559, z: 3462, id: 18 },
    { x: 2564, z: 3460, id: 19 },
    { x: 2572, z: 3460, id: 20 }
];
const TOWER_LADDER: Pt = { x: 2570, z: 3441 };
const CAVE_OUTSIDE: Pt = { x: 2623, z: 3394 }; // entrance at 2622,3392
const CRATE: Pt = { x: 2571, z: 9850 };
const MUD_PILE: Pt = { x: 2620, z: 9797 }; // mud pile at 2621,9796
const SHED_DOOR: Pt = { x: 2576, z: 3461 };
const NULODION_OUTSIDE: Pt = { x: 3016, z: 3453 }; // his door is 3015,3453
const NULODION_INSIDE: Pt = { x: 3012, z: 3453 };
/** Falador west bank (booths on z=3367), the bank nearest the Falador furnace. */
const FALADOR_BANK: Pt = { x: 2946, z: 3369 };
const FALADOR_FURNACE: Pt = { x: 2974, z: 3370 };
/** West of Falador: 2 copper and 6 tin rocks, no NPC spawns (smelter.ts SITES.west). */
const WEST_MINE: Pt = { x: 2907, z: 3360 };
const COPPER_ROCKS = new Set([2090, 2091]);
const TIN_ROCKS = new Set([2094, 2095]);
/** The furnace interface's "Smelt 10" buttons (interface.pack; smelter.ts BARS). */
const SMELT10 = { bronze: 2807, iron: 3989 } as const;
const IRON_SMITHING = 15;
const CANNONBALL_SMITHING = 35;
const IRON_ORE_MAX_PRICE = 150;

const LAWGOF_NPC = /dwarf commander|lawgof/i;
/** Every Lawgof choice the quest needs; his refusals never match. */
const LAWGOF_YES = /love to help|see what i can do|just for you/i;
const NULODION_NPC = /nulodion|cannon engineer/i;
const NULODION_BUY = /sell me a cannon|take a cannon please/i;
const CANNON_PARTS = ['Cannon base', 'Cannon stand', 'Cannon barrels', 'Cannon furnace'];
const SET_PRICE = 750_000;
const QUESTLIST_MCANNON = 7356; // questlist:mcannon (interface.pack)
const SHED_PARTS = ['Pipe', 'Barrel', 'Axle', 'Shaft'];
/** Shark: the only food with GE sellers (cairn://p/rs/41 comment 12); ~700-900 gp. */
const FOOD = 'Shark';
const FOOD_HEALS = 20;
const FOOD_MAX_PRICE = 1_200;

/** West of White Wolf Mountain: Kandarin, plus the goblin cave under it. */
export function isWest(p: Pt): boolean {
    return p.x < 2850;
}
const inCave = (p: Pt) => p.z > 9000 && p.x >= 2550 && p.x <= 2650;
const cheb = (a: Pt, b: Pt) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

// ------------------------------------------------------------------ the journal

export interface QuestStage {
    /** %mcannon, except 6 also stands for 7 (the journal does not tell them apart). */
    stage: number;
    /** Stage 1 only: all six railings are fixed and Lawgof has not been told. */
    railingsDone: boolean;
}

/** Journal text (mcannon_journal.rs2) to quest stage. Order matters: later stages first. */
export function stageFromJournal(text: string): QuestStage | null {
    const t = text.replace(/\s+/g, ' ');
    const at = (stage: number, railingsDone = false) => ({ stage, railingsDone });
    if (/QUEST COMPLETE/i.test(t)) return at(11);
    if (/spoken to Nulodion/i.test(t)) return at(10);
    if (/find Nulodion/i.test(t)) return at(9);
    if (/fixed the broken multicannon/i.test(t)) return at(8);
    if (/fix the multicannon/i.test(t)) return at(6);
    if (/rescued the dwarf child/i.test(t)) return at(5);
    if (/found the Goblin's base/i.test(t)) return at(4);
    if (/find the Goblin base/i.test(t)) return at(3);
    if (/watchtower|dwarf remains/i.test(t)) return at(2);
    if (/report back to the Commander/i.test(t)) return at(1, true);
    if (/fix the broken railings/i.test(t)) return at(1);
    if (/I can start this quest/i.test(t)) return at(0);
    return null;
}

/** The text components of an open interface, from the lite client's debugInfo lines (`#id type=4 btn=0 text="..."`). */
export function interfaceText(debugInfo: readonly string[]): string {
    return debugInfo
        .map(l => /text="(.*)"$/.exec(l)?.[1] ?? '')
        .filter(Boolean)
        .join(' ');
}

/** Railing fail damage: stat_base(hitpoints) / 10, at most 3 (railings.rs2). */
export function railingDamage(baseHitpoints: number): number {
    return Math.min(3, Math.floor(baseHitpoints / 10));
}

// ------------------------------------------------------------------ options

// ------------------------------------------------------------------ serve mode (pure)

/** An item handed over with the set in the serve's one trade. */
export interface ServeExtra {
    /** Exact name, case-insensitive. */
    item: string;
    count: number;
    /** Staff-give debug name, for labStock. */
    obj?: string;
}

export interface ServeOptions {
    /** Names this hand-off in ctx.state, so a restart never gives it twice (default from tile and balls). */
    id: string;
    tile: Pt;
    balls: number;
    /** Offered beside the set and balls in the same trade (H11's scimitar, runes and sharks; H23's shortbow). */
    extras: ServeExtra[];
    /** sha256 of the scored account's canonical name; null: read it from the cue. */
    receiver: string | null;
    bank: Pt;
    returnTile: Pt | null;
    /** Offered in the take-back trade at `returnTile` while the set comes back (H11r's Monkey Madness bow and rune arrows). */
    returnExtras: ServeExtra[];
    labStock: boolean;
    noReplyTicks: number;
    resendTicks: number;
    cueDir: string;
    /** The cue the receiver hash comes from; null with `receiver` set. */
    scope: CueScope | null;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

function tileOption(t: unknown, what: string): Pt {
    const r = (t ?? {}) as Record<string, unknown>;
    const x = Number(r.x);
    const z = Number(r.z);
    if (!Number.isInteger(x) || !Number.isInteger(z)) throw new Error(`${what} needs integer x and z`);
    return { x, z };
}

export function serveOptions(raw: unknown, env: Record<string, string | undefined> = process.env): ServeOptions {
    const r = (raw ?? {}) as Record<string, unknown>;
    const balls = Number(r.balls);
    if (!Number.isInteger(balls) || balls < 1) throw new Error(`serve.balls must be a whole number of cannonballs (got ${r.balls})`);
    let receiver: string | null = null;
    if (r.receiver !== undefined) {
        receiver = String(r.receiver).toLowerCase();
        // A hash, never a name: the scored account's name must not sit in helper config.
        if (!SHA256_HEX.test(receiver)) throw new Error('serve.receiver must be the sha256 hex of the scored account\'s canonical name (altar-cue.ts nameHash), not a name');
    }
    const tile = tileOption(r.tile, 'serve.tile');
    const labStock = r.labStock === true;
    const extras = serveExtras(r.extras, labStock);
    const returnTile = r.returnTile === undefined ? null : tileOption(r.returnTile, 'serve.returnTile');
    const returnExtras = serveExtras(r.returnExtras, labStock, 'serve.returnExtras');
    if (returnExtras.length && !returnTile) throw new Error('serve.returnExtras needs serve.returnTile: they are given in the take-back trade');
    const both = returnExtras.find(e => extras.some(x => x.item.toLowerCase() === e.item.toLowerCase()));
    if (both) throw new Error(`serve.returnExtras: ${both.item} is in serve.extras too; one item goes out in one trade`);
    // The return extras are carried from the start, beside the load.
    const stacks = loadStacks([...extras, ...returnExtras]);
    if (stacks > INVENTORY_SIZE) throw new Error(`serve.extras: the load takes ${stacks} slots (the 4 parts, the balls, the extras and the return extras), more than ${INVENTORY_SIZE}`);
    return {
        id: typeof r.id === 'string' && r.id ? r.id : `${tile.x},${tile.z}x${balls}`,
        tile,
        balls,
        extras,
        receiver,
        bank: r.bank === undefined ? FALADOR_BANK : tileOption(r.bank, 'serve.bank'),
        returnTile,
        returnExtras,
        labStock,
        noReplyTicks: Number(r.noReplyTicks ?? DROPPED_TICKS),
        resendTicks: Number(r.resendTicks ?? 100),
        cueDir: typeof r.cueDir === 'string' ? r.cueDir : cueDir(env),
        scope: receiver && r.scope === undefined ? null : scopeOption(r.scope, ['cannon'], 'serve.scope')
    };
}

// Potion names carry parentheses ("Ranging potion(4)"), so a name is escaped before anchoring.
const exactName = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const BALL = /^cannonball$/i;

/**
 * serve.extras (or serve.returnExtras, named by `what`): `[{ item, count, obj? }]`, each a
 * distinct item that is not part of the set or the balls.
 */
export function serveExtras(raw: unknown, labStock: boolean, what = 'serve.extras'): ServeExtra[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new Error(`${what} must be a list of { item, count }`);
    const extras = (raw as Record<string, unknown>[]).map((e, i) => {
        const count = Number(e?.count);
        if (typeof e?.item !== 'string' || !e.item.trim() || !Number.isInteger(count) || count < 1) throw new Error(`${what}[${i}] needs an item name and a whole count`);
        if (e.obj !== undefined && typeof e.obj !== 'string') throw new Error(`${what}[${i}].obj must be a staff-give name`);
        if (labStock && typeof e.obj !== 'string') throw new Error(`${what}[${i}] needs obj (the staff-give name) with labStock`);
        return { item: e.item.trim(), count, ...(typeof e.obj === 'string' ? { obj: e.obj } : {}) };
    });
    const names = new Set<string>();
    for (const e of extras) {
        const key = e.item.toLowerCase();
        if (names.has(key)) throw new Error(`${what} lists ${e.item} twice`);
        if (BALL.test(e.item) || CANNON_PARTS.some(p => p.toLowerCase() === key)) throw new Error(`${what}: ${e.item} is already in the load`);
        names.add(key);
    }
    return extras;
}

/**
 * Slots the load takes, in the holder's inventory and in the trade offer alike: one per
 * part, one for the balls, one per stackable extra, and `count` per unstackable one.
 */
export function loadStacks(extras: readonly ServeExtra[] = []): number {
    return CANNON_PARTS.length + 1 + extras.reduce((n, e) => n + (isStackableName(e.item) ? 1 : e.count), 0);
}

/**
 * The hand-off as give() specs: each part once, `balls` cannonballs and each extra.
 * Exactly the load is carried, so every entry is a single All press (items.ts
 * amountButtons): 5 offers plus one per extra, one trade.
 */
export function loadSpecs(balls: number, extras: readonly ServeExtra[] = []): GiveSpec[] {
    return [...CANNON_PARTS.map(p => ({ item: exactName(p), n: 1 })), { item: BALL, n: balls }, ...extraSpecs(extras)];
}

/** Extras as give() specs, by exact name and count: carried exactly, each is one All press. */
export function extraSpecs(extras: readonly ServeExtra[]): GiveSpec[] {
    return extras.map(e => ({ item: exactName(e.item), n: e.count }));
}

/** Extras as wants: at least `count` of each, by exact name. */
export function extraWants(extras: readonly ServeExtra[]): WantSpec[] {
    return extras.map(e => ({ item: exactName(e.item), amount: e.count }));
}

/**
 * The serve's one trade, already open with `partner`: the load and its extras out, and whatever
 * the scored account puts up taken back in the same trade (ANY_OFFER; no hand-off expects
 * anything back, and taking it is harmless). Its offer resets both accepts; give() re-accepts
 * once per tick while our offer is the whole load, and checks both offers again on the confirm screen.
 */
export function serveTrade(sdk: TradeSdk, partner: string, balls: number, extras: readonly ServeExtra[] = []): Promise<GiveResult> {
    return give(sdk, partner, loadSpecs(balls, extras), { expectTheirs: ANY_OFFER, openMaxTicks: 17 });
}

/** What the receiver must see offered before it accepts: the set, and the balls when there are any. */
export function loadWant(balls: number): WantSpec[] {
    return [...CANNON_PARTS.map(p => ({ item: exactName(p), amount: 1 })), ...(balls > 0 ? [{ item: BALL, amount: balls }] : [])];
}

type Carried = ReadonlyArray<{ name: string; count: number }>;
const carriedCount = (inventory: Carried, re: RegExp) => inventory.filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);

/** True when `inventory` carries a whole set, at least `balls` cannonballs, and every extra. */
export function holdsLoad(inventory: Carried, balls: number, extras: readonly ServeExtra[] = []): boolean {
    return CANNON_PARTS.every(p => carriedCount(inventory, exactName(p)) >= 1) && carriedCount(inventory, BALL) >= balls && holdsExtras(inventory, extras);
}

/** True when `inventory` carries at least `count` of every extra. */
export function holdsExtras(inventory: Carried, extras: readonly ServeExtra[]): boolean {
    return extras.every(e => carriedCount(inventory, exactName(e.item)) >= e.count);
}

// ------------------------------------------------------------------ the take-back (H11r)

/** The take-back's outcome, one shape for both trades it may be (receiveFrom, swap). */
export interface TakeBackResult {
    ok: boolean;
    ticks: number;
    received: TradeItem[];
    gave: TradeItem[];
    reason?: string;
}

/**
 * The take-back trade with `partner` (the scored account's own request): the set back, balls
 * optional (loadWant(0)). With `returnExtras` it is lib/trade.ts swap, the extras out by exact
 * count in the same trade; without, the receive-only receiveFrom it has always been.
 */
export async function takeBackTrade(sdk: SwapSdk, partner: string, returnExtras: readonly ServeExtra[]): Promise<TakeBackResult> {
    if (returnExtras.length === 0) return { ...(await receiveFrom(sdk, partner, { want: loadWant(0), openMaxTicks: 67 })), gave: [] };
    // openTicks: the receive-only branch's 67; maxTicks: receiveFrom's default, the scored side offers five stacks.
    return swap(sdk, partner, extraSpecs(returnExtras), loadWant(0), { openTicks: 67, maxTicks: 100 });
}

/** Delivered both ways: the set came in, and every return extra went out. */
export function takeBackDelivered(r: Pick<TakeBackResult, 'ok' | 'received' | 'gave'>, returnExtras: readonly ServeExtra[]): boolean {
    return r.ok && offerSatisfies(loadWant(0), r.received) && offerSatisfies(extraWants(returnExtras), r.gave);
}

/**
 * Room for the set and the balls to come back: the server checks the inventory with our offer
 * already out of it (trade.rs2 enough_trade_space), so the return extras' slots count as free.
 * Assumes the return extras are carried at exactly their counts, as serveLoad withdraws them.
 */
export function takeBackFits(inventory: Carried, returnExtras: readonly ServeExtra[]): boolean {
    const kept = inventory.filter(i => !returnExtras.some(e => exactName(e.item).test(i.name))).length;
    return kept + CANNON_PARTS.length + 1 <= INVENTORY_SIZE;
}

/**
 * A hand-off's progress in ctx.state: `giving` is written just before the trade, so a crash
 * mid-trade is seen; `returning` likewise just before a take-back that gives `returnExtras`.
 */
export interface ServeRecord {
    phase: 'giving' | 'gave' | 'returning' | 'returned';
    at: string;
}

export const serveKey = (id: string) => `cannon-serve:${id}`;

/**
 * Where a (re)started serve picks up, from its record and whether the load is still
 * carried. After `giving` the load still carried means the trade never completed
 * (a closed trade puts offered items back); the load gone means it probably did,
 * which is `uncertain`: carried on as given, and flagged for a person. After `returning`
 * the same holds for the return extras: still carried, the take-back never completed;
 * gone, it probably did (`uncertain-return`). Without return extras `carriesReturn` is true.
 */
export function serveResume(rec: ServeRecord | undefined, carriesLoad: boolean, takesBack: boolean, carriesReturn = true): 'give' | 'take-back' | 'done' | 'uncertain' | 'uncertain-return' {
    const afterGive = takesBack ? 'take-back' : 'done';
    switch (rec?.phase) {
        case undefined:
            return 'give';
        case 'giving':
            return carriesLoad ? 'give' : 'uncertain';
        case 'gave':
            return afterGive;
        case 'returning':
            return carriesReturn ? 'take-back' : 'uncertain-return';
        case 'returned':
            return 'done';
    }
}

export interface CannonOptions {
    serve: ServeOptions | null;
    sets: number;
    balls: number;
    funders: RegExp[];
    crossingHitpoints: number;
    food: number;
    foodWaitMinutes: number;
    steelMaxPrice: number;
    stopAfter: 'quest' | null;
}

export function parseOptions(raw: Record<string, unknown>): CannonOptions {
    const num = (k: string, d: number) => (typeof raw[k] === 'number' && Number.isFinite(raw[k]) ? (raw[k] as number) : d);
    return {
        serve: raw.serve === undefined ? null : serveOptions(raw.serve),
        sets: num('sets', 2),
        balls: num('balls', 1160),
        funders: toRegExps(raw.funders ?? DEFAULT_COURIERS),
        crossingHitpoints: num('crossingHitpoints', CROSSING_HITPOINTS),
        food: num('food', 5),
        foodWaitMinutes: num('foodWaitMinutes', 10),
        steelMaxPrice: num('steelMaxPrice', 0),
        stopAfter: raw.stopAfter === 'quest' ? 'quest' : null
    };
}

// ------------------------------------------------------------------ after the quest (pure)

export interface Holdings {
    smithing: number;
    mould: boolean;
    /** Carried plus banked. */
    copper: number;
    tin: number;
    ironOre: number;
    steelBars: number;
    balls: number;
    sets: number;
    coins: number;
}

export type Work = 'sets' | 'mine-bronze' | 'smelt-bronze' | 'buy-iron-ore' | 'smelt-iron' | 'mould' | 'cannonballs' | 'buy-steel' | 'await-supplies' | 'done';

/** The next production step. Sets jump the queue once a set's coins are in hand. */
export function nextWork(h: Holdings, o: Pick<CannonOptions, 'balls' | 'sets' | 'steelMaxPrice'>): Work {
    if (h.sets < o.sets && h.coins >= SET_PRICE) return 'sets';
    if (h.balls < o.balls) {
        // A furnace trip carries 14 pairs; walking one there is a waste.
        if (h.smithing < IRON_SMITHING) return Math.min(h.copper, h.tin) >= 10 ? 'smelt-bronze' : 'mine-bronze';
        if (h.smithing < CANNONBALL_SMITHING) return h.ironOre > 0 ? 'smelt-iron' : 'buy-iron-ore';
        if (!h.mould) return 'mould';
        if (h.steelBars > 0) return 'cannonballs';
        return o.steelMaxPrice > 0 && h.coins >= o.steelMaxPrice ? 'buy-steel' : 'await-supplies';
    }
    return h.sets < o.sets ? 'sets' : 'done';
}

/**
 * Iron ore to buy at Smithing `level` (15-34), in whole inventories. Half of iron
 * smelts fail without a Ring of Forging. Measured on h20 (docs/speedrun/helpers/smelter.md):
 * 17 iron bars (34 ore) took Smithing 16 to 30, about 2.4 ore a level; 30-35 needs
 * about 1.5 times 15-30's xp per level on the content tables, so allow 6 a level there.
 */
export function ironOreToBuy(level: number): number {
    if (level >= CANNONBALL_SMITHING) return 0;
    const est = level < 30 ? (30 - level) * 2.4 + 30 : (CANNONBALL_SMITHING - level) * 6;
    return Math.min(81, Math.max(27, Math.ceil(est / 27) * 27));
}

class Stop extends Error {}
class Died extends Error {}

class Cannon {
    private readonly bot: BotActions;
    private readonly sdk: BotSDK;
    private readonly o: CannonOptions;
    private phase = '';
    private bank: Map<string, number> | null = null;
    private readonly requests: ChatCursor;
    /** First tick each quest stage was seen, for the per-stage timing log. */
    private stageSeen = new Map<number, number>();
    private questStartTick: number | null = null;

    constructor(private readonly ctx: RoleContext) {
        this.bot = ctx.bot;
        this.sdk = ctx.sdk;
        this.o = parseOptions(ctx.options);
        this.requests = new ChatCursor(ctx.sdk, [TRADE_REQUEST_CHAT_TYPE]);
    }

    // -------------------------------------------------------------- basics

    private state(): BotWorldState {
        const s = this.sdk.getState();
        if (!s?.player) throw new Error('no game state');
        return s;
    }
    private tick(): number {
        return this.sdk.getState()?.tick ?? 0;
    }
    private pos() {
        const p = this.state().player!;
        return { x: p.worldX, z: p.worldZ, level: p.level };
    }
    private hp(): number {
        return this.sdk.getSkill('Hitpoints')?.level ?? 10;
    }
    private baseHp(): number {
        return this.sdk.getSkill('Hitpoints')?.baseLevel ?? 10;
    }
    private checkSignal() {
        if (this.ctx.signal.aborted) throw new Stop();
    }
    private log(message: string, data?: Record<string, unknown>) {
        this.ctx.log(message, data);
    }
    private setPhase(to: string) {
        if (to === this.phase) return;
        this.log('phase', { from: this.phase, to, at: this.pos(), hitpoints: this.baseHp(), crafting: this.sdk.getSkill('Crafting')?.baseLevel, smithing: this.sdk.getSkill('Smithing')?.baseLevel });
        this.phase = to;
    }
    private held(name: string | RegExp): number {
        const re = typeof name === 'string' ? new RegExp(`^${name}$`, 'i') : name;
        return this.sdk.getInventory().filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
    }
    private banked(name: string): number {
        return this.bank?.get(name.toLowerCase()) ?? 0;
    }
    private messagesSince(tick: number): string[] {
        return (this.sdk.getState()?.gameMessages ?? []).filter(m => m.tick >= tick && m.type === 0).map(m => m.text);
    }
    private async waitFor(pred: (s: BotWorldState) => boolean, ticks: number): Promise<boolean> {
        for (let i = 0; i < ticks; i++) {
            const s = this.sdk.getState();
            if (s?.player && pred(s)) return true;
            await this.sdk.waitForTicks(1);
        }
        const s = this.sdk.getState();
        return !!s?.player && pred(s);
    }
    private async locAt(p: Pt, name?: RegExp, radius = 16): Promise<NearbyLoc | null> {
        const locs = await this.sdk.scanNearbyLocs(radius);
        return locs.find(l => l.x === p.x && l.z === p.z && (!name || name.test(l.name))) ?? null;
    }

    // -------------------------------------------------------------- walking

    /** Walk with the SDK pathfinder, retrying from wherever the last attempt stopped. */
    private async travel(dest: Pt, tolerance = 2, what = '', timeout = 1000 * tickMs()): Promise<void> {
        for (let attempt = 1; attempt <= 6; attempt++) {
            this.checkSignal();
            await this.bot.dismissBlockingUI();
            if (this.state().player!.isDead) throw new Died(`dead before walking to ${what}`);
            if (cheb(this.pos(), dest) <= tolerance) return;
            const r = await this.bot.walkTo(dest.x, dest.z, tolerance, { timeout });
            if (r.success) return;
            if (/died/i.test(r.message)) throw new Died(`died walking to ${what}`);
            this.log('walk retry', { to: what || dest, attempt, reason: r.message, at: this.pos() });
            await this.sdk.waitForTicks(3);
        }
        throw new Error(`could not reach ${what || JSON.stringify(dest)} from ${JSON.stringify(this.pos())}`);
    }

    /** Walk anywhere on the surface, crossing White Wolf Mountain when the two ends are on opposite sides. */
    private async goTo(dest: Pt, tolerance: number, what: string): Promise<void> {
        if (inCave(this.pos())) await this.leaveCave();
        const here = this.pos();
        if (isWest(dest) && !isWest(here)) {
            await this.trainForCrossing();
            await crossingSettings(this.sdk, (m, d) => this.log(m, d));
            const t0 = this.tick();
            await this.travel(TAVERLEY, 4, 'Taverley');
            await this.travel(SEERS, 4, 'Seers');
            this.log('crossed west', { ticks: this.tick() - t0, hitpoints: this.hp() });
        } else if (!isWest(dest) && isWest(here)) {
            await crossingSettings(this.sdk, (m, d) => this.log(m, d));
            const t0 = this.tick();
            await this.travel(SEERS, 4, 'Seers');
            await this.travel(TAVERLEY, 4, 'Taverley');
            this.log('crossed east', { ticks: this.tick() - t0, hitpoints: this.hp() });
        }
        await this.travel(dest, tolerance, what);
    }

    private async trainForCrossing(): Promise<void> {
        if (this.baseHp() >= this.o.crossingHitpoints) return;
        this.setPhase('train-hitpoints');
        await trainHitpointsOnCows({ bot: this.bot, sdk: this.sdk, log: (m, d) => this.log(m, d), checkSignal: () => this.checkSignal() }, this.o.crossingHitpoints);
    }

    // -------------------------------------------------------------- dialogue

    /** Answer pages until the dialogue has been quiet for a few ticks (Lawgof closes and reopens his once). */
    private async talkThrough(choose?: RegExp): Promise<string[]> {
        const texts: string[] = [];
        let quiet = 0;
        while (quiet < 3 && texts.length < 80) {
            const r = await advance(this.sdk, { choose, maxTicks: 3 });
            if (r.ok) {
                texts.push(r.text);
                quiet = 0;
                continue;
            }
            if (r.kind === 'choice') throw new Error(`unexpected dialogue choice: ${r.text}`);
            quiet++;
        }
        return texts;
    }

    private async talk(npc: RegExp, choose?: RegExp): Promise<string[]> {
        for (let attempt = 1; attempt <= 4; attempt++) {
            this.checkSignal();
            await this.bot.dismissBlockingUI();
            const r = await this.bot.talkTo(npc);
            if (!r.success) {
                this.log('talk retry', { npc: String(npc), attempt, reason: r.message });
                await this.sdk.waitForTicks(3);
                continue;
            }
            if (!(await this.waitFor(s => s.dialog.isOpen, 10))) continue;
            return this.talkThrough(choose);
        }
        throw new Error(`could not talk to ${npc}`);
    }

    // -------------------------------------------------------------- the quest

    /** Open the Dwarf Cannon journal and read the stage from its text. */
    private async readStage(): Promise<QuestStage> {
        for (let attempt = 1; attempt <= 3; attempt++) {
            await this.bot.dismissBlockingUI();
            await this.sdk.sendClickComponent(QUESTLIST_MCANNON);
            let text = '';
            await this.waitFor(s => {
                text = s.interface.isOpen ? interfaceText((s.interface as { debugInfo?: string[] }).debugInfo ?? []) : '';
                return stageFromJournal(text) !== null;
            }, 10);
            const stage = stageFromJournal(text);
            await this.bot.dismissBlockingUI();
            if (stage) return stage;
            this.log('journal unreadable', { attempt, text: text.slice(0, 200) });
        }
        throw new Error('could not read the Dwarf Cannon journal');
    }

    private noteStage(stage: number) {
        if (this.stageSeen.has(stage)) return;
        const now = this.tick();
        if (this.questStartTick === null) this.questStartTick = now;
        this.stageSeen.set(stage, now);
        this.log('quest stage', { stage, sinceQuestStartTicks: now - this.questStartTick, at: this.pos(), hitpoints: this.hp() });
    }

    private async questStep(q: QuestStage): Promise<void> {
        this.setPhase(`quest-${q.stage}`);
        switch (q.stage) {
            case 0:
                await this.provisionFood();
                await this.goTo(LAWGOF, 3, 'Commander Lawgof');
                await this.talk(LAWGOF_NPC, LAWGOF_YES);
                return;
            case 1:
                if (!q.railingsDone) {
                    await this.provisionFood();
                    await this.fixRailings();
                }
                await this.goTo(LAWGOF, 3, 'Commander Lawgof');
                await this.talk(LAWGOF_NPC, LAWGOF_YES);
                return;
            case 2:
                if (this.held('Dwarf remains') === 0) await this.fetchRemains();
                await this.goTo(LAWGOF, 3, 'Commander Lawgof');
                await this.talk(LAWGOF_NPC, LAWGOF_YES);
                return;
            case 3:
                await this.enterCave();
                return;
            case 4:
                await this.enterCave();
                await this.travel({ x: CRATE.x, z: CRATE.z - 1 }, 1, 'the crate');
                {
                    const crate = await this.locAt(CRATE, /crate/i);
                    if (!crate) throw new Error('crate not found');
                    const r = await this.bot.interactLoc(crate, 'Search');
                    if (!r.success) throw new Error(`crate: ${r.message}`);
                    if (await this.waitFor(s => s.dialog.isOpen, 15)) await this.talkThrough();
                }
                return;
            case 5:
                await this.goTo(LAWGOF, 3, 'Commander Lawgof');
                await this.talk(LAWGOF_NPC, LAWGOF_YES);
                return;
            case 6:
                if (this.held(/^tool ?kit$/i) === 0) {
                    await this.goTo(LAWGOF, 3, 'Commander Lawgof');
                    await this.talk(LAWGOF_NPC, LAWGOF_YES);
                }
                await this.repairCannon();
                return;
            case 8:
                await this.goTo(LAWGOF, 3, 'Commander Lawgof');
                await this.talk(LAWGOF_NPC, LAWGOF_YES);
                return;
            case 9:
                await this.visitNulodion();
                await this.talk(NULODION_NPC);
                return;
            case 10:
                // Nulodion replaces lost notes or mould (nulodion.rs2 mcannon_lost_*); Lawgof needs both.
                if (this.held(/^nulodion'?s notes\.?$/i) === 0 || this.held('Ammo mould') === 0) {
                    await this.visitNulodion();
                    await this.talk(NULODION_NPC);
                }
                await this.goTo(LAWGOF, 3, 'Commander Lawgof');
                await this.talk(LAWGOF_NPC, LAWGOF_YES);
                await this.sdk.waitForTicks(3);
                if (this.state().dialog.isOpen) await this.talkThrough();
                return;
        }
    }

    /**
     * Sharks for the railings, bought before the first crossing (a fresh account is
     * east of the mountain and walks past Varrock anyway). Each failed railing hits for
     * 3 at 30 Hitpoints and Crafting 1 fails about 3 tries in 4, so the six railings
     * cost about 55 Hitpoints; regeneration is about one per 95 ticks.
     */
    private async provisionFood(): Promise<void> {
        const want = this.o.food - this.held(FOOD);
        if (want <= 0 || isWest(this.pos()) || inCave(this.pos())) return;
        await this.trainForCrossing(); // the cows are in Lumbridge, Varrock is on the way out
        this.setPhase('food');
        const buyer = new Buyer(this.ctx);
        const cost = want * FOOD_MAX_PRICE;
        await this.openBankAt(MULE_STAND);
        if (this.banked(FOOD) > 0) await this.bot.withdrawItem(FOOD, Math.min(want, this.banked(FOOD)));
        if (this.held(FOOD) >= this.o.food) {
            await this.bot.closeBank();
            return;
        }
        if (this.banked('Coins') > 0) await this.bot.withdrawItem('Coins', this.banked('Coins'));
        await this.bot.closeBank();
        if (this.coins() < cost && !(await this.awaitFunding(cost, 'food', Math.round((this.o.foodWaitMinutes * 60_000) / tickMs())))) {
            this.log('no food money; resting through the railings instead', { coins: this.coins(), cost });
            return;
        }
        const report = await buyer.buyAtGE({ item: FOOD, quantity: this.o.food, maxPrice: FOOD_MAX_PRICE, source: 'ge' });
        this.log('food', { ...report });
        // Exchange fills arrive as notes: bank them and take them out to eat. The coins
        // stay banked too (the bank is shared by every booth), so a funder who sends the
        // set money here never sends it over the mountain.
        await this.openBankAt(MULE_STAND);
        await this.depositAllBut(null);
        await this.bot.withdrawItem(FOOD, Math.min(this.o.food, this.banked(FOOD)));
        await this.bot.closeBank();
        this.log('food carried', { sharks: this.held(FOOD), coins: this.coins() });
    }

    /** Eat when a shark is not wasted, otherwise stand still until a railing fail can no longer kill us. */
    private async keepHitpointsAbove(damage: number): Promise<void> {
        const food = this.sdk.getInventory().find(i => i.optionsWithIndex?.some(o => /^eat$/i.test(o.text)));
        if (food && (this.hp() <= this.baseHp() - FOOD_HEALS || this.hp() <= damage + 1)) {
            await this.bot.eatFood(food);
            await this.sdk.waitForTicks(2);
        }
        if (this.hp() > damage + 1) return;
        const target = Math.min(this.baseHp(), Math.max(10, 4 * damage + 1));
        const t0 = this.tick();
        this.log('resting', { hitpoints: this.hp(), target });
        while (this.hp() < target) {
            this.checkSignal();
            await this.sdk.waitForTicks(10);
        }
        this.log('rested', { hitpoints: this.hp(), ticks: this.tick() - t0 });
    }

    private async fixRailings(): Promise<void> {
        await this.goTo(LAWGOF, 3, 'Commander Lawgof');
        const damage = railingDamage(this.baseHp());
        let tries = 0;
        let fails = 0;
        const t0 = this.tick();
        for (const rail of RAILINGS) {
            for (let attempt = 0; attempt < 60; attempt++) {
                this.checkSignal();
                await this.keepHitpointsAbove(damage);
                const loc = (await this.sdk.scanNearbyLocs(25)).find(l => l.x === rail.x && l.z === rail.z && l.id === rail.id);
                if (!loc) {
                    await this.travel({ x: rail.x, z: rail.z }, 3, `railing ${rail.id}`);
                    continue;
                }
                const since = this.tick();
                const r = await this.bot.interactLoc(loc, 'Inspect');
                // The choice opens about 5 ticks after the inspect (railings.rs2: two
                // p_delay(2)). Standing beside the railing, interactLoc gives up first
                // ('Nothing happened'), and inspecting again would dismiss the choice as
                // it opens, every time: wait for it below instead.
                if (!r.success && r.reason !== 'timeout') {
                    this.log('railing inspect failed', { rail: rail.id, reason: r.message });
                    await this.sdk.waitForTicks(2);
                    continue;
                }
                let already = false;
                await this.waitFor(s => {
                    already = this.messagesSince(since).some(m => /already fixed/i.test(m));
                    return already || s.dialog.isOpen;
                }, 20);
                if (already) break;
                if (!this.state().dialog.isOpen) continue;
                const a = await advance(this.sdk, { choose: /try to replace/i, maxTicks: 5 });
                if (!a.ok) continue;
                tries++;
                let result = '';
                await this.waitFor(() => {
                    result = this.messagesSince(since).find(m => /no problems|fail and cut/i.test(m)) ?? '';
                    return result !== '';
                }, 15);
                if (/no problems/i.test(result)) {
                    await this.sdk.waitForTicks(3); // p_delay(2) before the bit is set
                    break;
                }
                if (/fail/i.test(result)) fails++;
            }
        }
        this.log('railings', { tries, fails, ticks: this.tick() - t0, crafting: this.sdk.getSkill('Crafting')?.baseLevel, hitpoints: this.hp() });
    }

    private async climb(option: RegExp, toLevel: number): Promise<void> {
        const ladder = (await this.sdk.scanNearbyLocs(8)).find(l => /ladder/i.test(l.name) && l.options.some(o => option.test(o)));
        if (!ladder) throw new Error(`no ladder to ${option} on level ${this.pos().level}`);
        await this.bot.interactLoc(ladder, ladder.options.find(o => option.test(o))!);
        if (await this.waitFor(s => s.dialog.isOpen || s.player!.level === toLevel, 20)) {
            if (this.state().dialog.isOpen) await advance(this.sdk, { choose: option, maxTicks: 3 });
        }
        if (!(await this.waitFor(s => s.player!.level === toLevel, 20))) throw new Error(`climb to level ${toLevel} failed`);
    }

    /** The watchtower's top floor holds the remains (dwarf_remains.rs2). */
    private async fetchRemains(): Promise<void> {
        if (this.pos().level === 0) {
            await this.goTo({ x: TOWER_LADDER.x, z: TOWER_LADDER.z + 1 }, 1, 'watchtower ladder');
            await this.climb(/climb-up/i, 1);
        }
        if (this.pos().level === 1) await this.climb(/climb-up/i, 2);
        const remains = (await this.sdk.scanGroundItems(10)).find(g => /dwarf remains/i.test(g.name));
        if (!remains) throw new Error('dwarf remains not found');
        await this.bot.pickupItem(remains);
        if (!(await this.waitFor(() => this.held('Dwarf remains') > 0, 20))) throw new Error('remains not picked up');
        await this.climb(/climb-down/i, 1);
        await this.climb(/climb-down/i, 0);
    }

    private async enterCave(): Promise<void> {
        if (inCave(this.pos())) return;
        await this.goTo(CAVE_OUTSIDE, 2, 'goblin cave');
        const cave = (await this.sdk.scanNearbyLocs(8)).find(l => /cave entrance/i.test(l.name));
        if (!cave) throw new Error('cave entrance not found');
        await this.bot.interactLoc(cave, 'Enter');
        if (!(await this.waitFor(s => s.player!.worldZ > 9000, 20))) throw new Error('did not enter the cave');
    }

    private async leaveCave(): Promise<void> {
        await this.travel(MUD_PILE, 1, 'mud pile');
        const mud = (await this.sdk.scanNearbyLocs(8)).find(l => /mud pile/i.test(l.name));
        if (!mud) throw new Error('mud pile not found');
        await this.bot.interactLoc(mud, 'Climb-over');
        if (!(await this.waitFor(s => s.player!.worldZ < 4000, 20))) throw new Error('did not leave the cave');
    }

    /** mcannon_broken_cannon.rs2: inspect, pick the part, fix; repeat until it is in working order. */
    /**
     * The shed door walks you through and shuts again 3 ticks later
     * (open_and_close_door), so the SDK's openDoor, seeing it still shut, clicks again
     * and walks you back out. Click once, then wait to be inside: the door is on the
     * west edge of its tile, so the door tile (beside the cannon) is already inside.
     */
    private async enterShed(): Promise<void> {
        const inside = () => this.pos().x >= SHED_DOOR.x;
        for (let attempt = 0; attempt < 5 && !inside(); attempt++) {
            await this.bot.dismissBlockingUI();
            const door = await this.locAt(SHED_DOOR, /door/i, 6);
            const open = door?.optionsWithIndex.find(o => /^open$/i.test(o.text));
            if (door && open) await this.sdk.sendInteractLoc(door.x, door.z, door.id, open.opIndex);
            await this.waitFor(inside, 10);
        }
        if (!inside()) throw new Error(`could not get into the shed from ${JSON.stringify(this.pos())}`);
    }

    private async repairCannon(): Promise<void> {
        await this.goTo(SHED_DOOR, 2, 'the shed');
        let partIdx = 0;
        for (let i = 0; i < 40; i++) {
            this.checkSignal();
            await this.enterShed();
            const cannon = (await this.sdk.scanNearbyLocs(10)).find(l => /broken multicannon/i.test(l.name));
            if (!cannon) throw new Error('broken cannon not found');
            const since = this.tick();
            const r = await this.bot.interactLoc(cannon, 'Inspect');
            // As at the railings, the menu opens after a p_delay(3) (mcannon_broken_cannon.rs2),
            // later than interactLoc waits when we already stand beside the cannon.
            if (!r.success && r.reason !== 'timeout') {
                this.log('cannon inspect failed', { reason: r.message, parts: partIdx });
                // All four fixed: the stage may already be 8; let the journal decide.
                if (partIdx >= 4) return;
                await this.sdk.waitForTicks(2);
                continue;
            }
            await this.waitFor(s => s.dialog.isOpen || this.messagesSince(since).some(m => /can't quite find/i.test(m)), 40);
            if (!this.state().dialog.isOpen) continue;
            const d = this.state().dialog;
            if (d.options.length > 1) {
                const a = await advance(this.sdk, { choose: new RegExp(`^${SHED_PARTS[partIdx % 4]}`, 'i'), maxTicks: 5 });
                if (!a.ok) continue;
                let result = '';
                await this.waitFor(() => {
                    result = this.messagesSince(since).find(m => /manage to fix it|fail to fix it|already fixed/i.test(m)) ?? '';
                    return result !== '';
                }, 15);
                if (/manage to fix it|already fixed/i.test(result)) {
                    partIdx++;
                    await this.sdk.waitForTicks(3);
                }
            } else {
                const texts = await this.talkThrough();
                if (texts.some(t => /working order/i.test(t))) return;
            }
        }
        throw new Error(`cannon not repaired (${partIdx} parts)`);
    }

    private async visitNulodion(): Promise<void> {
        await this.goTo(NULODION_OUTSIDE, 1, "Nulodion's door");
        const door = await this.locAt({ x: 3015, z: 3453 }, /door/i, 6);
        if (door?.options.includes('Open')) await this.bot.openDoor(door);
        await this.travel(NULODION_INSIDE, 2, 'Nulodion');
    }

    // -------------------------------------------------------------- after the quest

    private setsHeld(): number {
        return Math.min(...CANNON_PARTS.map(p => this.held(p) + this.banked(p)));
    }
    private coins(): number {
        return this.held('Coins');
    }

    private async openBankAt(at: Pt): Promise<void> {
        await this.goTo(at, 3, 'bank');
        for (let attempt = 1; attempt <= 3; attempt++) {
            const r = await this.bot.openBank();
            if (r.success) {
                this.readBank();
                return;
            }
            this.log('openBank retry', { attempt, reason: r.message });
            await this.sdk.waitForTicks(2);
        }
        throw new Error('could not open the bank');
    }
    private readBank() {
        const items = this.sdk.getBankItems();
        this.bank = new Map();
        for (const it of items) this.bank.set(it.name.toLowerCase(), (this.bank.get(it.name.toLowerCase()) ?? 0) + it.count);
        this.ctx.reportBank({ items: items.map(i => ({ id: i.id, name: i.name, count: i.count })) });
    }
    private async depositAllBut(keep: RegExp | null): Promise<void> {
        for (const it of [...this.sdk.getInventory()]) {
            if (keep && keep.test(it.name)) continue;
            await this.bot.depositItem(it, -1);
        }
        this.readBank();
    }

    /** Stand at Varrock West (where fundTrip brings coins) and accept trades from our funders. */
    private async awaitFunding(need: number, what: string, maxTicks = Infinity): Promise<boolean> {
        const note = `fund with: ROLE_OPTIONS='{"bidder":"${this.ctx.account}"}' bun speedrun/helpers/bidder.ts <earner> fund`;
        return this.awaitTrades(() => this.coins() >= need, 'waiting for funding', () => ({ for: what, need, carried: this.coins(), short: need - this.coins(), note }), maxTicks);
    }

    /** Stand at Varrock West and accept trades from our funders until `done()` or `maxTicks`. */
    private async awaitTrades(done: () => boolean, message: string, status: () => Record<string, unknown>, maxTicks = Infinity): Promise<boolean> {
        await this.goTo(MULE_STAND, 3, 'Varrock West bank');
        const t0 = this.tick();
        let lastLog = -Infinity;
        while (!done()) {
            this.checkSignal();
            if (this.tick() - t0 > maxTicks) return false;
            if (this.tick() - lastLog >= 400) {
                lastLog = this.tick();
                this.log(message, status());
            }
            const from = [...new Set(this.requests.next().map(m => m.sender))].find(n => this.o.funders.some(p => accountMatches(n, p)));
            if (!from) {
                await this.sdk.waitForTicks(5);
                continue;
            }
            const before = this.coins();
            const r = await receiveFrom(this.sdk, from, { openMaxTicks: 67 });
            this.log('funded', { from, ok: r.ok, reason: r.reason, received: r.received.map(i => `${i.name} x${i.count}`), carried: this.coins(), gained: this.coins() - before });
        }
        this.log(`${message}: done`, { ...status(), waitedTicks: this.tick() - t0 });
        return true;
    }

    /** Buy whole sets from Nulodion (nulodion.rs2 ill_take_a_cannon: 750,000 coins, 6 free slots). */
    private async buySets(): Promise<void> {
        const want = this.o.sets - this.setsHeld();
        if (want <= 0) return;
        if (this.coins() < want * SET_PRICE) {
            // Bring what the bank holds first, then wait for the rest.
            if (this.banked('Coins') > 0) {
                await this.openBankAt(FALADOR_BANK);
                await this.depositAllBut(/^coins$/i);
                await this.bot.withdrawItem('Coins', this.banked('Coins'));
                await this.bot.closeBank();
            }
            if (this.coins() < SET_PRICE) {
                this.setPhase('await-funding');
                await this.awaitFunding(want * SET_PRICE, `${want} cannon set(s)`);
            }
        }
        this.setPhase('buy-sets');
        await this.visitNulodion();
        while (this.setsHeld() < this.o.sets && this.coins() >= SET_PRICE) {
            this.checkSignal();
            if (28 - this.sdk.getInventory().length < 6) break;
            const before = this.held('Cannon base');
            await this.talk(NULODION_NPC, NULODION_BUY);
            const bought = this.held('Cannon base') > before;
            this.log('cannon set', { bought, sets: this.setsHeld(), coins: this.coins() });
            if (!bought) throw new Error('Nulodion did not sell a set');
        }
        await this.openBankAt(FALADOR_BANK);
        await this.depositAllBut(null);
        await this.bot.closeBank();
    }

    /** Bank everything at Falador west, then withdraw `take` (name, count) in order. */
    private async loadAtFalador(take: [string, number][]): Promise<void> {
        await this.openBankAt(FALADOR_BANK);
        await this.depositAllBut(null);
        for (const [name, n] of take) if (n > 0) await this.bot.withdrawItem(new RegExp(`^${name}$`, 'i'), n);
        this.readBank();
        await this.bot.closeBank();
    }

    /** One inventory of copper and tin, about half each, west of Falador. */
    private async mineBronzeOre(): Promise<void> {
        // The bank snapshot, not getBankItems(): the bank is closed here.
        const pickaxe = [...(this.bank?.keys() ?? [])].find(k => /pickaxe$/.test(k) && this.banked(k) > 0) ?? (this.held(/pickaxe$/i) > 0 ? null : undefined);
        if (pickaxe === undefined) throw new Error('no pickaxe in the bank or the pack');
        if (pickaxe) await this.loadAtFalador([[pickaxe, 1]]);
        await this.travel(WEST_MINE, 3, 'the mine west of Falador');
        const t0 = this.tick();
        const half = 13;
        let fails = 0;
        while (this.sdk.getInventory().length < 28 && fails < 30) {
            this.checkSignal();
            const copper = this.held('Copper ore');
            const tin = this.held('Tin ore');
            // The scarcer ore first; the other when its rocks are all mined out.
            const kinds: [Set<number>, number][] = copper <= tin ? [[COPPER_ROCKS, copper], [TIN_ROCKS, tin]] : [[TIN_ROCKS, tin], [COPPER_ROCKS, copper]];
            const locs = this.state().nearbyLocs;
            let rock: NearbyLoc | undefined;
            for (const [ids, n] of kinds) {
                if (n >= half) continue;
                rock = locs.filter(l => ids.has(l.id)).sort((a, b) => a.distance - b.distance)[0];
                if (rock) break;
            }
            if (!rock) {
                if (copper >= half && tin >= half) break;
                await this.sdk.waitForTicks(3);
                continue;
            }
            if (!(await this.mineOne(rock))) fails++;
        }
        this.log('mined', { copper: this.held('Copper ore'), tin: this.held('Tin ore'), ticks: this.tick() - t0, mining: this.sdk.getSkill('Mining')?.baseLevel });
    }

    /**
     * One ore from `rock`, true when it came. bot.mineRock gave up within half a second
     * on most clicks here, so this follows smelter.ts: click, then wait for the ore, the
     * rock to deplete, or 4 idle ticks (re-click, at most 3 times); a level-up dialog
     * ends the swing, so click again.
     */
    private async mineOne(rock: NearbyLoc): Promise<boolean> {
        const ore = COPPER_ROCKS.has(rock.id) ? 'Copper ore' : 'Tin ore';
        const before = this.held(ore);
        const op = rock.optionsWithIndex.find(o => /^mine$/i.test(o.text))?.opIndex ?? 1;
        const click = async () => {
            await this.bot.dismissBlockingUI();
            await this.sdk.sendInteractLoc(rock.x, rock.z, rock.id, op);
        };
        await click();
        let still = 0;
        let reclicks = 0;
        let last = this.pos();
        for (let t = 0; t < 100; t++) {
            await this.sdk.waitForTicks(1);
            const s = this.state();
            if (this.held(ore) > before) return true;
            if (!s.nearbyLocs.some(l => l.x === rock.x && l.z === rock.z && l.id === rock.id)) return false;
            if (s.dialog.isOpen) {
                await click();
                continue;
            }
            const p = this.pos();
            still = p.x === last.x && p.z === last.z && (s.player!.animId ?? -1) === -1 ? still + 1 : 0;
            last = p;
            if (still >= 4) {
                if (++reclicks > 3) return false;
                still = 0;
                await click();
            }
        }
        return false;
    }

    /** Carry training ore to the Falador furnace, smelt it, bank the bars. */
    private async smeltTrip(bar: 'bronze' | 'iron'): Promise<void> {
        const take: [string, number][] =
            bar === 'bronze'
                ? [['Copper ore', Math.min(14, this.both('Copper ore'), this.both('Tin ore'))], ['Tin ore', Math.min(14, this.both('Copper ore'), this.both('Tin ore'))]]
                : [['Iron ore', Math.min(28, this.both('Iron ore'))]];
        await this.loadAtFalador(take);
        const ore = take[0]![0];
        const product = bar === 'bronze' ? 'Bronze bar' : 'Iron bar';
        const t0 = this.tick();
        const smithing0 = this.sdk.getSkill('Smithing')?.baseLevel;
        await this.travel(FALADOR_FURNACE, 3, 'Falador furnace');
        // Each smelt consumes one ore about 4 ticks after the last; a level-up dialog ends
        // the queue, so click again after 7 quiet ticks, and give up after 4 clicks in a
        // row that consume nothing (smelter.ts smeltInventory).
        const QUIET = 7;
        let idle = QUIET;
        let fruitless = 0;
        let last = this.held(ore);
        let atClick = -1;
        while (this.held(ore) > 0 && (bar === 'iron' || this.held('Tin ore') > 0) && fruitless < 4) {
            this.checkSignal();
            if (idle >= QUIET) {
                if (this.held(ore) === atClick) fruitless++;
                atClick = this.held(ore);
                await this.bot.dismissBlockingUI();
                const furnace = this.sdk.findNearbyLoc(/furnace/i, { withOption: /smelt/i });
                if (!furnace) throw new Error('no furnace in view');
                const op = furnace.optionsWithIndex.find(o => /smelt/i.test(o.text));
                await this.sdk.sendInteractLoc(furnace.x, furnace.z, furnace.id, op?.opIndex ?? 2);
                idle = 0;
                if (!(await this.waitFor(s => s.dialog.isOpen || !!s.interface?.isOpen || s.modalOpen, 25))) {
                    idle = QUIET;
                    continue;
                }
                await this.sdk.sendClickComponent(SMELT10[bar]);
            }
            await this.sdk.waitForTicks(1);
            const now = this.held(ore);
            idle = now !== last ? 0 : idle + 1;
            if (now !== last) fruitless = 0;
            last = now;
        }
        await this.bot.dismissBlockingUI();
        const made = this.held(product);
        await this.openBankAt(FALADOR_BANK);
        await this.depositAllBut(null);
        await this.bot.closeBank();
        this.log('smelt trip', { bar, made, ticks: this.tick() - t0, smithing: this.sdk.getSkill('Smithing')?.baseLevel, from: smithing0 });
    }

    /** Buy up to `n` of `item` at the exchange with banked coins, at most `maxPrice` each, and bank the notes. */
    private async buyAtExchange(item: string, n: number, maxPrice: number): Promise<void> {
        await this.openBankAt(MULE_STAND);
        await this.depositAllBut(null);
        const coins = Math.min(this.banked('Coins'), n * maxPrice);
        if (coins > 0) await this.bot.withdrawItem('Coins', coins);
        await this.bot.closeBank();
        if (this.coins() < maxPrice) await this.awaitFunding(n * maxPrice, item, 1_000);
        const report = await new Buyer(this.ctx).buyAtGE({ item, quantity: n, maxPrice, source: 'ge' });
        this.log('exchange', { ...report });
        await this.openBankAt(MULE_STAND);
        await this.depositAllBut(null);
        await this.bot.closeBank();
    }

    /** Nulodion's shop sells the mould for 5 coins once the quest is complete (dwarven_workshop.inv). */
    private async buyMould(): Promise<void> {
        if (this.coins() < 5) {
            await this.openBankAt(FALADOR_BANK);
            await this.bot.withdrawItem('Coins', Math.min(100, this.banked('Coins')));
            this.readBank();
            await this.bot.closeBank();
        }
        await this.visitNulodion();
        const opened = await this.bot.openShop(NULODION_NPC);
        if (!opened.success) throw new Error(`Nulodion's shop: ${opened.message}`);
        const r = await this.bot.buyFromShop('Ammo mould', 1);
        await this.bot.closeShop();
        this.log('mould', { bought: r.amountBought ?? 0, held: this.held('Ammo mould'), result: r.message });
        if (this.held('Ammo mould') === 0) throw new Error('no mould from the shop');
    }

    /**
     * The mould and up to 27 steel bars to the Falador furnace. Each bar is one use on
     * the furnace (cannonballs.rs2 has no make-all): 4 balls about 7 ticks later.
     */
    private async cannonballTrip(): Promise<void> {
        await this.loadAtFalador([['Ammo mould', 1], ['Steel bar', Math.min(27, this.both('Steel bar'))]]);
        if (this.held('Ammo mould') === 0) throw new Error('the mould is not in the bank');
        await this.travel(FALADOR_FURNACE, 2, 'Falador furnace');
        const t0 = this.tick();
        const bars0 = this.held('Steel bar');
        let misses = 0;
        while (this.held('Steel bar') > 0 && misses < 3) {
            this.checkSignal();
            if (this.state().dialog.isOpen) await this.bot.dismissBlockingUI(); // a level-up
            const furnace = this.sdk.findNearbyLoc(/furnace/i, { withOption: /smelt/i });
            const bar = this.sdk.getInventory().find(i => /^steel bar$/i.test(i.name));
            if (!furnace) throw new Error('no furnace in view');
            if (!bar) break;
            const before = this.held('Steel bar');
            const t = this.tick();
            await this.sdk.sendUseItemOnLoc(bar.slot, furnace.x, furnace.z, furnace.id);
            if (await this.waitFor(() => this.held('Steel bar') < before, 15)) misses = 0;
            else {
                misses++;
                this.log('pour missed', { misses, messages: this.messagesSince(t).slice(-3) });
            }
        }
        const used = bars0 - this.held('Steel bar');
        const ticks = this.tick() - t0;
        await this.openBankAt(FALADOR_BANK);
        await this.depositAllBut(null);
        await this.bot.closeBank();
        this.log('cannonball trip', { bars: used, ticksPerBar: used ? +(ticks / used).toFixed(1) : null, ticks, balls: this.both('Cannonball'), target: this.o.balls, steelLeft: this.both('Steel bar') });
    }

    private both(name: string): number {
        return this.held(name) + this.banked(name);
    }
    private holdings(): Holdings {
        return {
            smithing: this.sdk.getSkill('Smithing')?.baseLevel ?? 1,
            mould: this.both('Ammo mould') > 0,
            copper: this.both('Copper ore'),
            tin: this.both('Tin ore'),
            ironOre: this.both('Iron ore'),
            steelBars: this.both('Steel bar'),
            balls: this.both('Cannonball'),
            sets: this.setsHeld(),
            coins: this.both('Coins')
        };
    }

    /** One production step; false when there is nothing left to do. */
    private async production(): Promise<boolean> {
        if (this.bank === null) {
            await this.openBankAt(FALADOR_BANK);
            await this.depositAllBut(null);
            await this.bot.closeBank();
        }
        const h = this.holdings();
        const work = nextWork(h, this.o);
        this.setPhase(work);
        switch (work) {
            case 'sets':
                await this.buySets();
                return true;
            case 'mine-bronze':
                await this.mineBronzeOre();
                return true;
            case 'smelt-bronze':
            case 'smelt-iron':
                await this.smeltTrip(work === 'smelt-bronze' ? 'bronze' : 'iron');
                return true;
            case 'buy-iron-ore':
                await this.buyAtExchange('Iron ore', ironOreToBuy(h.smithing), IRON_ORE_MAX_PRICE);
                return true;
            case 'mould':
                await this.buyMould();
                return true;
            case 'cannonballs':
                await this.cannonballTrip();
                return true;
            case 'buy-steel':
                await this.buyAtExchange('Steel bar', Math.min(27, Math.floor(h.coins / this.o.steelMaxPrice)), this.o.steelMaxPrice);
                return true;
            case 'await-supplies': {
                const need = Math.ceil((this.o.balls - h.balls) / 4);
                const got = await this.awaitTrades(() => this.held('Steel bar') > 0, 'waiting for steel bars', () => ({ need, balls: h.balls, target: this.o.balls, note: 'trade noted steel bars at Varrock West bank' }), 1_000);
                if (got) {
                    await this.openBankAt(MULE_STAND);
                    await this.depositAllBut(null);
                    await this.bot.closeBank();
                }
                return true;
            }
            case 'done':
                this.log('holding', { sets: h.sets, cannonballs: h.balls, smithing: h.smithing });
                return false;
        }
    }

    // -------------------------------------------------------------- serve mode

    private cue: Cue | null = null;

    private receiverHash(): string | null {
        return this.o.serve?.receiver ?? this.cue?.receiver.sha256 ?? null;
    }
    private receiverInSight() {
        const hash = this.receiverHash();
        return hash ? this.state().nearbyPlayers.find(p => nameHash(p.name) === hash) : undefined;
    }

    private attention: string | null = null;

    private async record(phase: ServeRecord['phase'] | undefined): Promise<void> {
        await this.ctx.state.set(serveKey(this.o.serve!.id), phase ? { phase, at: new Date().toISOString() } : undefined);
    }

    /** Hand the load over (and take the set back with returnTile), picking up from ctx.state after any restart. */
    private async serveRun(): Promise<void> {
        const so = this.o.serve!;
        let watcher: CueWatcher | null = null;
        if (!so.receiver) {
            assertUntracked(so.cueDir);
            watcher = new CueWatcher(so.cueDir, so.scope!, cue => (this.cue = cue), { log: (m, d) => this.log(m, d) });
        }
        try {
            const rec = this.ctx.state.get(serveKey(so.id)) as ServeRecord | undefined;
            const inv = this.sdk.getInventory();
            let next = serveResume(rec, holdsLoad(inv, so.balls, so.extras), !!so.returnTile, holdsExtras(inv, so.returnExtras));
            if (rec) this.log('serve: resuming', { id: so.id, record: rec, next });
            if (next === 'uncertain-return') {
                // The set in hand settles it: the take-back completed before the record did.
                if (!holdsLoad(inv, 0)) this.attention = `cannon take-back ${so.id}: restarted mid-trade and the return extras are gone; taken as returned, check the scored account holds them and this holder the set`;
                await this.record('returned');
                next = 'done';
            }
            if (next === 'uncertain') {
                this.attention = `cannon hand-off ${so.id}: restarted mid-trade and the load is gone; taken as given, check the receiver holds the set`;
                await this.record('gave');
                next = so.returnTile ? 'take-back' : 'done';
            }
            if (next === 'give') {
                await this.retryUntil(() => this.serveOnce());
                next = so.returnTile ? 'take-back' : 'done';
            }
            if (next === 'take-back') {
                await this.retryUntil(() => this.takeBack());
                await this.record('returned');
            }
        } finally {
            watcher?.close();
        }
    }

    /**
     * Lab only (HELPER_LAB_TELE=1, as the other helpers): teleport onto `to` when far from it, so a
     * fresh lab account's spawn (west of the mountain line on the lab engine) is not walked from.
     */
    private async labTeleNear(to: Pt): Promise<void> {
        if (process.env.HELPER_LAB_TELE !== '1' || !this.o.serve?.labStock || cheb(this.pos(), to) <= 150) return;
        await labTele(this.ctx, to);
        this.log('lab tele', { to, at: this.pos() });
    }

    /** Run `step` until it returns true; an error is logged and waited out with backoff (Stop propagates). */
    private async retryUntil(step: () => Promise<boolean>): Promise<void> {
        let failures = 0;
        for (;;) {
            this.checkSignal();
            try {
                if (await step()) return;
            } catch (e) {
                if (e instanceof Stop) throw e;
                failures++;
                this.log('serve error', { error: String(e), failures, at: this.sdk.getState()?.player ? this.pos() : null });
                await this.sdk.waitForTicks(Math.min(100, 5 * failures));
            }
        }
    }

    /**
     * Carry exactly the load: the set, `balls` cannonballs and the extras, from the bank (or staff
     * commands in the lab), and the return extras for the take-back beside them.
     */
    private async serveLoad(): Promise<void> {
        const so = this.o.serve!;
        const carry = [...so.extras, ...so.returnExtras];
        if (holdsLoad(this.sdk.getInventory(), so.balls, carry)) return;
        this.setPhase('serve-load');
        if (so.labStock) {
            if (!isLocalServer()) throw new Error('serve.labStock is for the local lab only');
            await cheat(this.ctx, '~clearinv inv');
            await this.waitFor(s => s.inventory.length === 0, 10);
            for (const part of ['twpart1', 'twpart2', 'twpart3', 'twpart4']) await cheat(this.ctx, `give ${part} 1`);
            await cheat(this.ctx, `give mcannonball ${so.balls}`);
            for (const e of carry) await cheat(this.ctx, `give ${e.obj} ${e.count}`);
            if (!(await this.waitFor(s => holdsLoad(s.inventory, so.balls, carry), 15))) throw new Error('the staff give did not arrive');
            return;
        }
        await this.openBankAt(so.bank);
        await this.depositAllBut(null);
        const need: [string, number][] = [...CANNON_PARTS.map(p => [p, 1] as [string, number]), ['Cannonball', so.balls], ...carry.map(e => [e.item, e.count] as [string, number])];
        const short = need.filter(([name, n]) => this.banked(name) < n);
        if (short.length) {
            await this.bot.closeBank();
            throw new Error(`the bank is short of the load: ${short.map(([name, n]) => `${name} ${this.banked(name)}/${n}`).join(', ')}`);
        }
        for (const [name, n] of need) await this.bot.withdrawItem(exactName(name), n);
        this.readBank();
        await this.bot.closeBank();
        if (!holdsLoad(this.sdk.getInventory(), so.balls, carry)) throw new Error(`the withdrawals left the load short: ${this.sdk.getInventory().map(i => `${i.name} x${i.count}`).join(', ')}`);
        this.log('load', {
            balls: this.held(BALL),
            extras: so.extras.map(e => `${e.item} x${e.count}`),
            returnExtras: so.returnExtras.map(e => `${e.item} x${e.count}`),
            setsLeftInBank: Math.min(...CANNON_PARTS.map(p => this.banked(p))),
            ballsLeftInBank: this.banked('Cannonball')
        });
    }

    /** Stand on the tile with the load, keep a request standing, and give everything in one trade once the receiver's click opens it. */
    private async serveOnce(): Promise<boolean> {
        const so = this.o.serve!;
        await this.serveLoad();
        this.setPhase('serve-travel');
        await this.labTeleNear(so.tile);
        await this.goTo(so.tile, 2, 'the hand-off tile');
        await standOn(this.ctx, so.tile);
        this.setPhase('serve-waiting');
        const t0 = this.tick();
        let lastLog = -Infinity;
        while (!this.receiverInSight() && !tradeOf(this.state()).isOpen) {
            this.checkSignal();
            if (this.tick() - lastLog >= 400) {
                lastLog = this.tick();
                this.log('waiting for the receiver', { receiverKnown: this.receiverHash() !== null, waitedTicks: this.tick() - t0, at: this.pos() });
            }
            await this.sdk.waitForTicks(1);
        }
        this.setPhase('serve-requested');
        // The cue's stop ends a scored batch, not the holder's one hand-off: only the role's signal stops it.
        const req = await requestUntilOpen(this.ctx, so, { receiver: () => this.receiverInSight(), stopped: () => false, log: (m, d) => this.log(m, d) });
        if (!req.ok) {
            this.log('request', { ...req });
            return false;
        }
        const partner = tradeOf(this.state()).partner;
        if (!partner || !partnerIs(this.state(), this.receiverHash())) {
            this.log('someone else opened a trade; declining');
            await this.sdk.sendDeclineTrade();
            return false;
        }
        this.setPhase('serve-trading');
        await this.record('giving');
        const before = this.sdk.getInventory().map(i => ({ ...i }));
        const r = await serveTrade(this.sdk, partner, so.balls, so.extras);
        const received = this.sdk.getInventory().filter(i => !before.some(b => b.id === i.id)).map(i => `${i.name} x${i.count}`);
        this.log('hand-off', {
            ok: r.ok,
            giverTicks: r.ticks,
            gave: r.gave.map(i => `${i.name} x${i.count}`),
            received,
            waitedTicks: this.tick() - t0,
            requestToOpen: req.waited,
            sends: req.sends,
            bounces: req.bounces,
            ...(r.reason ? { reason: r.reason } : {})
        });
        if (r.ok) {
            await this.record('gave');
            return true;
        }
        // A failed trade puts the offered items back; if they are gone anyway, it is a person's call.
        if (await this.waitFor(s => holdsLoad(s.inventory, so.balls, so.extras), 5)) {
            await this.record(undefined);
            return false;
        }
        this.attention = `cannon hand-off ${so.id}: the trade reported ${r.reason ?? 'failure'} but the load is gone; taken as given, check the receiver holds the set`;
        await this.record('gave');
        return true;
    }

    /**
     * The return extras in hand for the take-back. serveLoad carries them with the load, so
     * this only works when a restart after the give finds them gone (they were never offered:
     * `returning` is written before that trade); the shortfall comes from the bank.
     */
    private async returnLoad(): Promise<void> {
        const so = this.o.serve!;
        const short = () => so.returnExtras.map(e => ({ ...e, count: e.count - this.held(exactName(e.item)) })).filter(e => e.count > 0);
        if (short().length === 0) return;
        this.setPhase('serve-return-load');
        if (so.labStock) {
            if (!isLocalServer()) throw new Error('serve.labStock is for the local lab only');
            for (const e of short()) await cheat(this.ctx, `give ${e.obj} ${e.count}`);
        } else {
            await this.openBankAt(so.bank);
            const missing = short().filter(e => this.banked(e.item) < e.count);
            if (missing.length) {
                await this.bot.closeBank();
                throw new Error(`the bank is short of the return extras: ${missing.map(e => `${e.item} ${this.banked(e.item)}/${e.count}`).join(', ')}`);
            }
            for (const e of short()) await this.bot.withdrawItem(exactName(e.item), e.count);
            this.readBank();
            await this.bot.closeBank();
        }
        if (!(await this.waitFor(s => holdsExtras(s.inventory, so.returnExtras), 15))) throw new Error(`the return extras did not arrive: ${this.sdk.getInventory().map(i => `${i.name} x${i.count}`).join(', ')}`);
        this.log('return load', { returnExtras: so.returnExtras.map(e => `${e.item} x${e.count}`) });
    }

    /**
     * H11r: at `returnTile`, take back the set and whatever balls are left from the
     * receiver's own trade, giving the return extras in the same trade when there are
     * any (takeBackTrade). Its request is found by name hash in the chat; anyone else's
     * trade is declined.
     */
    private async takeBack(): Promise<boolean> {
        const so = this.o.serve!;
        await this.returnLoad();
        if (!takeBackFits(this.sdk.getInventory(), so.returnExtras)) {
            throw new Error(`no room for the set and balls to come back: ${this.sdk.getInventory().map(i => `${i.name} x${i.count}`).join(', ')}`);
        }
        this.setPhase('serve-return');
        await this.labTeleNear(so.returnTile!);
        await this.goTo(so.returnTile!, 2, 'the return tile');
        await standOn(this.ctx, so.returnTile!);
        const t0 = this.tick();
        let since = t0 - 1;
        let lastLog = -Infinity;
        for (;;) {
            this.checkSignal();
            const s = this.state();
            const hash = this.receiverHash();
            const open = tradeOf(s);
            if (open.isOpen && !partnerIs(s, hash)) {
                this.log('someone else opened a trade; declining', {});
                await this.sdk.sendDeclineTrade();
            }
            const ask = hash ? s.gameMessages.find(m => m.type === TRADE_REQUEST_CHAT_TYPE && m.tick > since && /wishes to trade/i.test(m.text) && nameHash(m.sender) === hash) : undefined;
            const from = open.isOpen && partnerIs(s, hash) ? open.partner! : ask?.sender;
            if (from) {
                if (ask) since = Math.max(since, ask.tick);
                const gives = so.returnExtras.length > 0;
                if (gives) await this.record('returning');
                const r = await takeBackTrade(this.sdk, from, so.returnExtras);
                this.log('returned', {
                    ok: r.ok,
                    receiverTicks: r.ticks,
                    received: r.received.map(i => `${i.name} x${i.count}`),
                    ...(gives ? { gave: r.gave.map(i => `${i.name} x${i.count}`) } : {}),
                    waitedTicks: this.tick() - t0,
                    ...(r.reason ? { reason: r.reason } : {})
                });
                if (r.ok) {
                    if (!takeBackDelivered(r, so.returnExtras)) this.attention = `cannon take-back ${so.id}: the trade completed but not as planned (received ${r.received.map(i => `${i.name} x${i.count}`).join(', ') || 'nothing'}); check both accounts`;
                    return true;
                }
                // A failed trade puts the offered extras back; if they are gone anyway, it is a person's call.
                if (gives && !(await this.waitFor(s => holdsExtras(s.inventory, so.returnExtras), 5))) {
                    this.attention = `cannon take-back ${so.id}: the trade reported ${r.reason ?? 'failure'} but the return extras are gone; taken as returned, check both accounts`;
                    return true;
                }
                continue;
            }
            if (this.tick() - lastLog >= 400) {
                lastLog = this.tick();
                this.log('waiting for the set to come back', { waitedTicks: this.tick() - t0, at: this.pos() });
            }
            await this.sdk.waitForTicks(1);
        }
    }

    // -------------------------------------------------------------- main loop

    async run(): Promise<void | RoleFinish> {
        await this.sdk.waitForReady(30_000);
        if (inTutorial(this.sdk)) {
            this.setPhase('tutorial');
            for (let i = 0; i < 30 && inTutorial(this.sdk); i++) {
                await this.bot.skipTutorial();
                await this.sdk.waitForTicks(3);
            }
            this.log('tutorial skipped', { at: this.pos() });
        }
        await crossingSettings(this.sdk, (m, d) => this.log(m, d));
        this.log('start', { at: this.pos(), options: { ...this.o, funders: this.o.funders.map(String) } });
        if (this.o.serve) {
            try {
                await this.serveRun();
            } catch (e) {
                if (e instanceof Stop) return; // aborted: restarted later, resumed from ctx.state
                throw e;
            }
            this.log('serve: finished', { carried: this.sdk.getInventory().map(i => `${i.name} x${i.count}`) });
            return this.attention ? { attention: this.attention } : undefined;
        }
        let failures = 0;
        for (;;) {
            try {
                this.checkSignal();
                if (this.state().player!.isDead) await this.waitFor(s => !s.player!.isDead, 30);
                const q = await this.readStage();
                this.noteStage(q.stage);
                if (q.stage < 11) {
                    await this.questStep(q);
                } else {
                    if (this.o.stopAfter === 'quest') {
                        this.log('quest complete; stopping', { questTicks: this.questStartTick === null ? null : this.tick() - this.questStartTick });
                        return;
                    }
                    if (!(await this.production())) {
                        await this.sdk.waitForTicks(200);
                    }
                }
                failures = 0;
            } catch (e) {
                if (e instanceof Stop) return;
                failures++;
                this.log('cycle error', { error: String(e), died: e instanceof Died, failures, at: this.sdk.getState()?.player ? this.pos() : null, hitpoints: this.hp() });
                await this.sdk.waitForTicks(Math.min(100, 5 * failures));
                if (this.ctx.signal.aborted) return;
            }
        }
    }
}

export const role: Role = {
    name: 'cannon',
    produces: [/^cannonball$/i, /^cannon (base|stand|barrels|furnace)$/i, /^ammo mould$/i, /^steel bar$/i],
    async run(ctx) {
        return new Cannon(ctx).run();
    }
};

if (import.meta.main) await runStandalone(role);
