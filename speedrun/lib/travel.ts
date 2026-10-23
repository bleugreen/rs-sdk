// Travel: the speedrun's one route walker and transport layer (STEP-MANIFEST.md entry 11).
//
// Every move between two places goes through `travel(hops)`: spell teleports, chained runs with
// doors opened and webs slashed on the way, spirit trees, the Ardougne wilderness lever, the
// ships, gnome gliders and Lumdo's boat. Each transport confirms its arrival from published
// state: a hop is ok only once the player stands inside that transport's landing area, never
// because a click was sent.
//
// Built on act.ts, which keeps the single-click primitives this file composes: `act` (a click
// re-sent while evidently dropped), `actConverse`, `castTeleport`, `clickWalk` and `walkTo`
// (the SDK pathfinder, the fallback when the chained run gives up). The chained run lives here
// and nowhere else.
//
// Rules (docs/speedrun/research/run-transitions.md): no amulet of glory (rs/123: unobtainable
// on the demo), and no casting while walking (section 5: the enchant ride measured about 31
// ticks slower than casting standalone and teleporting), so `runTo` has no cast option.

import type { BotSDK } from '../../sdk/index';
import type { BotActions } from '../../sdk/actions';
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { act, actConverse, castTeleport, clickWalk, settle, slotOf, walkTo, TELEPORTS, type ActSdk, type JumpCounts } from './act';
import { converse, type ConverseSdk } from './converse';
import type { OptionPattern } from './dialogue';
import type { ItemPattern } from './items';
import { currentTick, waitUntil, type StateSource } from './wait';
import { chebyshev, findLoc, invCount, invItem, messageCursor, messagesAfter, messagesSince, opIndex, pos, skillLevel, stateOf, tileCounter, waitForNpc, type LocQuery, type OpPattern, type StateLike, type Tile } from './world';

export type TravelSdk = ActSdk & ConverseSdk & Pick<BotSDK, 'findPath'>;
export type WalkBot = Pick<BotActions, 'walkTo'>;

// ------------------------------------------------------------------ places

/** A tile with a Chebyshev tolerance; `level` defaults to 0, `tol` to 0. */
export interface Area {
    x: number;
    z: number;
    level?: number;
    tol?: number;
}

export function inArea(src: StateLike, a: Area): boolean {
    const p = pos(src);
    return p.level === (a.level ?? 0) && chebyshev(p, a) <= (a.tol ?? 0);
}

/** An inclusive rectangle of tiles; `level` defaults to 0. */
export interface Region {
    x: readonly [number, number];
    z: readonly [number, number];
    level?: number;
}

export function inRegion(src: StateLike, r: Region): boolean {
    const p = pos(src);
    return p.level === (r.level ?? 0) && p.x >= r.x[0] && p.x <= r.x[1] && p.z >= r.z[0] && p.z <= r.z[1];
}

export function within(src: StateLike, place: Area | Region): boolean {
    return typeof place.x === 'number' ? inArea(src, place as Area) : inRegion(src, place as Region);
}

/** The bounding box of two tiles, grown by `margin` on every side. */
export function boxAround(a: { x: number; z: number }, b: { x: number; z: number }, margin: number, level = 0): Region {
    return { x: [Math.min(a.x, b.x) - margin, Math.max(a.x, b.x) + margin], z: [Math.min(a.z, b.z) - margin, Math.max(a.z, b.z) + margin], level };
}

export const fmtTile = (t: { x: number; z: number; level?: number }) => `${t.x},${t.z}${t.level ? `,${t.level}` : ''}`;

/**
 * Wilderness level as the content computes it (wilderness_levels.rs2 over wilderness_zones.dbrow):
 * (z - zone south edge) / 8 + 1 inside the main zone (2944-3391, 3520-6399) or the Edgeville
 * dungeon's (2944-3391, 9920-12799); 0 elsewhere.
 */
export function wildernessLevel(t: { x: number; z: number }): number {
    if (t.x < 2944 || t.x > 3391) return 0;
    if (t.z >= 3520 && t.z <= 6399) return Math.floor((t.z - 3520) / 8) + 1;
    if (t.z >= 9920 && t.z <= 12799) return Math.floor((t.z - 9920) / 8) + 1;
    return 0;
}

// ------------------------------------------------------------------ spells and runes

export type Rune = 'air' | 'water' | 'earth' | 'fire' | 'law';
export type Runes = Partial<Record<Rune, number>>;
export type Spell = keyof typeof TELEPORTS;

export interface SpellInfo {
    magic: number;
    runes: Readonly<Runes>;
    /** `tele_coord` with map_findsquare's radius 2 (teleport.rs2 `magic_teleport`). */
    landing: Area;
}

/** skill_magic/configs/magic_spells.dbrow. Ardougne also needs Plague City done and its scroll read (%elenaquest). */
export const SPELLS: Readonly<Record<Spell, SpellInfo>> = {
    varrock: { magic: 25, runes: { fire: 1, air: 3, law: 1 }, landing: { x: 3213, z: 3424, tol: 2 } },
    lumbridge: { magic: 31, runes: { earth: 1, air: 3, law: 1 }, landing: { x: 3221, z: 3218, tol: 2 } },
    falador: { magic: 37, runes: { water: 1, air: 3, law: 1 }, landing: { x: 2965, z: 3378, tol: 2 } },
    camelot: { magic: 45, runes: { air: 5, law: 1 }, landing: { x: 2757, z: 3478, tol: 2 } },
    ardougne: { magic: 51, runes: { water: 2, law: 2 }, landing: { x: 2661, z: 3301, tol: 2 } },
};

const RUNES: readonly Rune[] = ['air', 'water', 'earth', 'fire', 'law'];
const STAFF = /^(?:staff of (air|water|earth|fire)|(air|water|earth|fire) battlestaff|mystic (air|water|earth|fire) staff)$/i;

/** The element a worn item supplies without runes: a staff, battlestaff or mystic staff's; null for anything else. */
export function staffElement(name: string): Rune | null {
    const m = STAFF.exec(name);
    return ((m?.[1] ?? m?.[2] ?? m?.[3])?.toLowerCase() as Rune | undefined) ?? null;
}

/** Runes in the inventory; a worn elemental staff makes its element unlimited. */
export function runesHeld(src: StateLike): Record<Rune, number> {
    const s = stateOf(src);
    const held = Object.fromEntries(RUNES.map(r => [r, invCount(s, new RegExp(`^${r} rune$`, 'i'))])) as Record<Rune, number>;
    for (const w of s?.equipment ?? []) {
        const el = staffElement(w.name);
        if (el) held[el] = Infinity;
    }
    return held;
}

/** A rune's obj debug name (obj.pack 554-566, skill_magic/configs/runes.obj): the key of a declared rune use. */
export type RuneName =
    | 'airrune' | 'waterrune' | 'earthrune' | 'firerune' | 'mindrune' | 'bodyrune' | 'deathrune'
    | 'naturerune' | 'chaosrune' | 'lawrune' | 'cosmicrune' | 'bloodrune' | 'soulrune';

/** Runes consumed, by debug name, net of the element a worn staff supplies. */
export type RuneUse = Readonly<Partial<Record<RuneName, number>>>;

/**
 * A step module's declared rune use on the route path, exported as `RUNE_USE` (agreed with rs/185,
 * 2026-10-22): keyed by a segment letter of the module's `stepId`, or by a ledger row id where a
 * skill module covers several steps (`S04`). Combat casts with a measured range count the measured
 * maximum. Beside it, optionally: `RUNE_STAFF`, the worn staff (its ledger name, `staff of fire`)
 * whose element the counts leave out, and `RUNE_USE_FALLBACK`, a fallback path's use in the same
 * shape. speedrun/tools/rune-pins.ts holds them to STEP-MANIFEST.md's inventory ledger.
 */
export type RuneUseTable = Readonly<Record<string, RuneUse>>;

export const runeName = (r: Rune): RuneName => `${r}rune`;

/** A rune cost by element (a teleport's `SPELLS[spell].runes`) as a rune use. */
export function runeUseOf(runes: Runes): RuneUse {
    const out: Partial<Record<RuneName, number>> = {};
    for (const [r, n] of Object.entries(runes) as [Rune, number][]) if (n) out[runeName(r)] = n;
    return out;
}

/** `use` taken `times` over, less the element `staff` (a worn staff's name, `staff of fire`) supplies. */
export function scaleUse(use: RuneUse, times: number, staff?: string): RuneUse {
    const supplied = staff ? staffElement(staff) : null;
    const out: Partial<Record<RuneName, number>> = {};
    for (const [r, n] of Object.entries(use) as [RuneName, number][]) {
        if (n * times && !(supplied && r === runeName(supplied))) out[r] = n * times;
    }
    return out;
}

/** A teleport's runes for `times` casts as a rune use, less the element `staff` supplies. */
export const spellUse = (spell: Spell, times = 1, staff?: string): RuneUse => scaleUse(runeUseOf(SPELLS[spell].runes), times, staff);

export function sumUse(...uses: readonly RuneUse[]): RuneUse {
    const out: Partial<Record<RuneName, number>> = {};
    for (const u of uses) for (const [r, n] of Object.entries(u) as [RuneName, number][]) if (n) out[r] = (out[r] ?? 0) + n;
    return out;
}

export function addRunes(a: Runes, b: Runes): Runes {
    const out: Runes = { ...a };
    for (const [r, n] of Object.entries(b) as [Rune, number][]) out[r] = (out[r] ?? 0) + n;
    return out;
}

/** Null when `need` is held, else what is short. */
export function missingRunes(src: StateLike, need: Runes): string | null {
    const held = runesHeld(src);
    const short = (Object.entries(need) as [Rune, number][]).filter(([r, n]) => held[r] < n).map(([r, n]) => `${n} ${r} (have ${held[r]})`);
    return short.length ? `runes short: ${short.join(', ')}` : null;
}

/** Why the content would refuse this teleport from this state, or null. Plague City is not readable from state. */
export function teleportRefusal(src: StateLike, spell: Spell): string | null {
    const info = SPELLS[spell];
    const magic = skillLevel(src, 'magic');
    if (magic < info.magic) return `Magic ${magic} is below ${info.magic} for the ${spell} teleport`;
    const w = wildernessLevel(pos(src));
    if (w > 20) return `Wilderness level ${w} is above 20`;
    return missingRunes(src, info.runes);
}

// ------------------------------------------------------------------ transports

export type SpiritTree = 'stronghold' | 'village' | 'varrock' | 'khazard';

/** areas/area_gnome/configs/spirit_tree.constant (p_telejump, exact tile). */
export const SPIRIT_TREES: Readonly<Record<SpiritTree, { landing: Area; choice: RegExp }>> = {
    stronghold: { landing: { x: 2461, z: 3444, tol: 1 }, choice: /^gnome stronghold/i },
    village: { landing: { x: 2542, z: 3169, tol: 1 }, choice: /^tree gnome village/i },
    varrock: { landing: { x: 3179, z: 3507, tol: 1 }, choice: /^forest north of varrock/i },
    khazard: { landing: { x: 2555, z: 3259, tol: 1 }, choice: /^battlefield of khazard/i },
};
/** spirit_tree.rs2: `ent` (the stronghold's tree), `stronghold_ent` (the village's), `loc_1317` (the young trees, village only). */
const TREE_LOCS: Readonly<Record<number, SpiritTree | 'young'>> = { 1293: 'stronghold', 1294: 'village', 1317: 'young' };

export type Lever = 'ardougne' | 'keep';
/** areas/area_ardougne_east/scripts/wilderness_lever.rs2 and its .constant (~player_teleport_normal, exact tile). */
export const LEVERS: Readonly<Record<Lever, { loc: number; landing: Area }>> = {
    ardougne: { loc: 1814, landing: { x: 3154, z: 3924, tol: 1 } },
    keep: { loc: 1815, landing: { x: 2562, z: 3311, tol: 1 } },
};

export type Ship = 'brimhaven' | 'karamja';
/** karamja_sailor_dialogue (sailors.rs2): 30 coins, ~set_sail's p_delay(7), then the deck (level 1) and its gangplank. */
export const SHIPS: Readonly<Record<Ship, { npc: RegExp; deck: Area; fare: number }>> = {
    brimhaven: { npc: /^captain barnaby$/i, deck: { x: 2775, z: 3234, level: 1 }, fare: 30 },
    karamja: { npc: /^(seaman lorris|seaman thresnor|captain tobias)$/i, deck: { x: 2956, z: 3143, level: 1 }, fare: 30 },
};

export type GliderStop = 'ta_quir_priw' | 'gandius' | 'sindarpos' | 'lemanto_andra' | 'kar_hewo';
/**
 * areas/area_gnome: glider.constant, gnome_glider.rs2 (`glidermap:com_21`-`com_25`; one end of every
 * flight is Ta Quir Priw; p_teleport to map_findsquare radius 1). Lemanto Andra's pilot has crashed,
 * so it is a destination only. This content has no Ape Atoll glider.
 */
export const GLIDERS: Readonly<Record<GliderStop, { component: number; landing: Area }>> = {
    gandius: { component: 824, landing: { x: 2971, z: 2969, tol: 2 } },
    ta_quir_priw: { component: 825, landing: { x: 2465, z: 3501, level: 3, tol: 2 } },
    sindarpos: { component: 826, landing: { x: 2850, z: 3497, tol: 2 } },
    lemanto_andra: { component: 827, landing: { x: 3320, z: 3430, tol: 2 } },
    kar_hewo: { component: 828, landing: { x: 3284, z: 3211, tol: 2 } },
};
export const GLIDER_MAP = 802;
const PILOT = /^(gnome pilot|captain errdo)$/i;

export type LumdoStop = 'crash_island' | 'ape_atoll';
/** quest_mm/scripts/mm_lumdo.rs2 (p_teleport): the atoll leg needs %mm_lumdo = lumdo_travelled. */
export const LUMDO: Readonly<Record<LumdoStop, Area>> = {
    crash_island: { x: 2894, z: 2726, tol: 1 },
    ape_atoll: { x: 2802, z: 2707, tol: 1 },
};

// ------------------------------------------------------------------ hops

export type Hop =
    | { kind: 'teleport'; spell: Spell }
    /** Chained run to `to` on the SDK route, or through `via` (click targets) where the pathfinder has no map. */
    | { kind: 'run'; to: Area; via?: ReadonlyArray<{ x: number; z: number }>; wildernessAtMost?: number }
    /** One destination click routed by the client, re-sent when it stops short (act.ts clickWalk). */
    | { kind: 'click'; to: Area }
    /** Walk through each goal in turn, slashing the webs in the way with a knife. */
    | { kind: 'webs'; goals: ReadonlyArray<readonly [number, number]> }
    /** Operate a loc (a ladder, a gate) until `arrive` holds, or the level becomes `level`, or (neither given) the level changes. */
    | { kind: 'loc'; loc: LocQuery; op?: OpPattern; arrive?: Area | Region; level?: number; answers?: OptionPattern[]; label?: string }
    /** Use an item on a loc until `arrive` holds (a talisman on the altar ruins). */
    | { kind: 'item-on-loc'; item: ItemPattern; loc: LocQuery; arrive: Area; label?: string }
    /** Through a gate (`passGate`) to its side `to`. */
    | { kind: 'gate'; gate: Gate; to: Region }
    | { kind: 'tree'; to: SpiritTree }
    | { kind: 'lever'; lever: Lever }
    | { kind: 'ship'; route: Ship }
    | { kind: 'glider'; to: GliderStop }
    | { kind: 'lumdo'; to: LumdoStop };

export type HopKind = Hop['kind'];

/**
 * Transports that run ~post_tele_checks and so delete Karamja rum, the plague sample, the monkey
 * in a backpack and peer-trial items (teleport.rs2 `post_tele_checks`, called from spells, the
 * lever's ~player_teleport_normal and spirit_tree.rs2). Ships, gliders and Lumdo jump without it.
 */
export const DELETES_FOLLOWER_ITEM: Readonly<Record<HopKind, boolean>> = {
    teleport: true, tree: true, lever: true,
    run: false, click: false, webs: false, loc: false, 'item-on-loc': false, gate: false, ship: false, glider: false, lumdo: false,
};

export function deletesFollowerItem(hops: readonly Hop[]): boolean {
    return hops.some(h => DELETES_FOLLOWER_ITEM[h.kind]);
}

export interface HopNeeds {
    runes: Runes;
    magic: number;
    coins: number;
    knife: boolean;
    items: ItemPattern[];
}

/** What a hop list consumes or needs held. */
export function hopNeeds(hops: readonly Hop[]): HopNeeds {
    const n: HopNeeds = { runes: {}, magic: 0, coins: 0, knife: false, items: [] };
    for (const h of hops) {
        if (h.kind === 'teleport') {
            n.runes = addRunes(n.runes, SPELLS[h.spell].runes);
            n.magic = Math.max(n.magic, SPELLS[h.spell].magic);
        } else if (h.kind === 'ship') n.coins += SHIPS[h.route].fare;
        else if (h.kind === 'webs') n.knife = true;
        else if (h.kind === 'item-on-loc') n.items.push(h.item);
    }
    return n;
}

export function hopLabel(h: Hop): string {
    switch (h.kind) {
        case 'teleport': return `${h.spell} teleport`;
        case 'run': return `run to ${fmtTile(h.to)}${h.wildernessAtMost !== undefined ? ` (or Wilderness ${h.wildernessAtMost})` : ''}`;
        case 'click': return `click to ${fmtTile(h.to)}`;
        case 'webs': return `webs to ${h.goals.map(g => `${g[0]},${g[1]}`).join(' ')}`;
        case 'loc': return h.label ?? `loc ${String(h.loc.name ?? h.loc.id)}`;
        case 'item-on-loc': return h.label ?? `${String(h.item)} on loc ${String(h.loc.name ?? h.loc.id)}`;
        case 'gate': return `through the ${h.gate.label}`;
        case 'tree': return `spirit tree to ${h.to}`;
        case 'lever': return `${h.lever} lever`;
        case 'ship': return `ship to ${h.route}`;
        case 'glider': return `glider to ${h.to}`;
        case 'lumdo': return `Lumdo to ${h.to}`;
    }
}

// ------------------------------------------------------------------ results

/** A door or gate the walker met on its route: closed (and opened) or already open. */
export interface DoorSeen {
    x: number;
    z: number;
    level: number;
    id: number;
    name: string;
    state: 'closed' | 'open';
    tick: number;
}

export interface Segment {
    hop: string;
    ok: boolean;
    startTick: number;
    ticks: number;
    note?: string;
}

export interface TravelResult {
    ok: boolean;
    startTick: number;
    endTick: number;
    ticks: number;
    at: Tile;
    segments: Segment[];
    clicks: number;
    /** Tiles actually stepped (teleports excluded). */
    tiles: number;
    doors: DoorSeen[];
    webTries: number;
    ate: number;
    hpMin: number;
    /** Set when a fallback carried the trip: a refused teleport walked, or bot.walkTo after the run gave up. */
    fellBack?: string;
    reason?: string;
    /** Set when `stopIf` stopped the trip: its reason. */
    stopped?: string;
}

export interface EatOptions {
    /** Default: any of the usual cooked fish. */
    food?: ItemPattern;
    /** Eat below this many hitpoints (default 15). */
    below?: number;
}

export interface TravelOptions {
    /** The SDK pathfinder walk a run falls back to after it stalls `maxStalls` times. */
    bot?: WalkBot;
    /** Eat while running (the Wilderness legs). */
    eat?: EatOptions;
    /** A refused teleport walks the next run hop from where the player stands (default true). */
    walkOnRefusal?: boolean;
    /** Start at this hop (a resumed leg). */
    from?: number;
    /** Run tuning: click the furthest route tile within `reach` (20), re-click `lead` (3) tiles before it. */
    reach?: number;
    lead?: number;
    /** Give up a run hop after this many ticks (900) or stalls (8). */
    maxTicks?: number;
    maxStalls?: number;
    /** Print each hop as it ends. */
    log?: boolean;
    /**
     * Checked before each hop and on every published tick of a run: a reason stops the trip there
     * (a run halts with a walk to the tile it stands on) and becomes the result's `stopped`. A run
     * with `stopIf` never falls back to bot.walkTo, which cannot be stopped part way.
     */
    stopIf?: (s: BotWorldState) => string | null;
    /**
     * Awaited before each hop's first click, with the hop's index (also the hop a refused teleport
     * falls back to): a reason stops the trip there, as `stopIf`'s does. runner/legs.ts drops here
     * what no remaining hop needs.
     */
    beforeHop?: (i: number) => Promise<string | null>;
}

interface HopOutcome {
    ok: boolean;
    reason?: string;
    /** A teleport the content (or the precheck) refused: no runes, Wilderness above 20, not learnt. */
    refused?: string;
    /** `stopIf`'s reason, when it stopped the hop. */
    stopped?: string;
    note?: string;
}

class Trip {
    readonly startTick: number;
    clicks = 0;
    webTries = 0;
    ate = 0;
    hpMin: number;
    fellBack?: string;
    readonly doors: DoorSeen[] = [];
    readonly segments: Segment[] = [];
    private readonly counter;
    private readonly stopHp: () => void;

    constructor(private readonly sdk: StateSource) {
        this.startTick = currentTick(sdk);
        this.hpMin = sdk.getState()?.player?.hp ?? 0;
        this.counter = tileCounter(sdk);
        this.stopHp = sdk.onStateUpdate(s => {
            const hp = s.player?.hp;
            if (hp !== undefined && hp < this.hpMin) this.hpMin = hp;
        });
    }

    door(l: NearbyLoc, state: DoorSeen['state'], tick: number): void {
        const level = pos(this.sdk).level;
        if (this.doors.some(d => d.x === l.x && d.z === l.z && d.level === level)) return;
        this.doors.push({ x: l.x, z: l.z, level, id: l.id, name: l.name, state, tick });
    }

    finish(ok: boolean, reason?: string, stopped?: string): TravelResult {
        this.counter.stop();
        this.stopHp();
        const endTick = currentTick(this.sdk);
        return {
            ok, startTick: this.startTick, endTick, ticks: endTick - this.startTick, at: pos(this.sdk), segments: this.segments,
            clicks: this.clicks, tiles: this.counter.tiles, doors: this.doors, webTries: this.webTries, ate: this.ate, hpMin: this.hpMin,
            ...(this.fellBack ? { fellBack: this.fellBack } : {}), ...(reason ? { reason } : {}), ...(stopped ? { stopped } : {}),
        };
    }
}

// ------------------------------------------------------------------ the trip

/**
 * Run `hops` in order. A teleport refused (by the precheck or the content) walks the next run
 * hop from where the player stands, unless `walkOnRefusal` is false. The result's ticks run from
 * the call to the first published state that showed the last hop's arrival.
 */
export async function travel(sdk: TravelSdk, hops: readonly Hop[], opts: TravelOptions = {}): Promise<TravelResult> {
    const trip = new Trip(sdk);
    try {
        for (let i = opts.from ?? 0; i < hops.length; i++) {
            const h = hops[i]!;
            const s0 = sdk.getState();
            const halt = s0 ? opts.stopIf?.(s0) : null;
            if (halt) return trip.finish(false, `stopped before ${hopLabel(h)}: ${halt}`, halt);
            const held = await opts.beforeHop?.(i);
            if (held) return trip.finish(false, `stopped before ${hopLabel(h)}: ${held}`, held);
            const t0 = currentTick(sdk);
            const r = await runHop(sdk, trip, h, opts);
            const note = r.note ?? r.refused ?? r.reason;
            trip.segments.push({ hop: hopLabel(h), ok: r.ok, startTick: t0, ticks: currentTick(sdk) - t0, ...(note ? { note } : {}) });
            if (opts.log) console.log(`  [travel] ${hopLabel(h)}: ${r.ok ? 'ok' : 'FAILED'} ${currentTick(sdk) - t0} ticks${note ? ` (${note})` : ''}`);
            if (r.ok) continue;
            if (r.stopped) return trip.finish(false, `${hopLabel(h)}: stopped: ${r.stopped}`, r.stopped);
            const next = hops.findIndex((x, j) => j > i && x.kind === 'run');
            if (h.kind === 'teleport' && r.refused && opts.walkOnRefusal !== false && next > i) {
                trip.fellBack = `walked: ${hopLabel(h)} refused (${r.refused})`;
                i = next - 1;
                continue;
            }
            return trip.finish(false, `${hopLabel(h)}: ${note ?? 'failed'}`);
        }
        return trip.finish(true);
    } catch (e) {
        trip.finish(false);
        throw e;
    }
}

/** Cast a teleport and confirm the landing. Refused (no runes, Wilderness above 20) without a click when the state says so. */
export function teleport(sdk: TravelSdk, spell: Spell, opts: TravelOptions = {}): Promise<TravelResult> {
    return travel(sdk, [{ kind: 'teleport', spell }], opts);
}

export interface RunOptions extends TravelOptions {
    via?: ReadonlyArray<{ x: number; z: number }>;
    /** Stop as soon as the Wilderness level is at most this (the walk out to a teleport). */
    wildernessAtMost?: number;
}

/**
 * Run to `to` with chained clicks: the furthest route tile within `reach` (Chebyshev), re-clicked
 * `lead` tiles before it is reached (quests/primitives.md section 2: 0.51 ticks per route tile).
 * A closed door or gate on the route ahead is opened as part of the run; a stall of 3 ticks opens
 * the nearest door (never the one the run last went through) or slashes the nearest web, then
 * re-routes. A click the player does not move on is re-sent at the first idle tick.
 */
export function runTo(sdk: TravelSdk, to: Area, opts: RunOptions = {}): Promise<TravelResult> {
    return travel(sdk, [{ kind: 'run', to, ...(opts.via ? { via: opts.via } : {}), ...(opts.wildernessAtMost !== undefined ? { wildernessAtMost: opts.wildernessAtMost } : {}) }], opts);
}

export function throughWebs(sdk: TravelSdk, goals: ReadonlyArray<readonly [number, number]>, opts: TravelOptions = {}): Promise<TravelResult> {
    return travel(sdk, [{ kind: 'webs', goals }], opts);
}

export function spiritTree(sdk: TravelSdk, to: SpiritTree, opts: TravelOptions = {}): Promise<TravelResult> {
    return travel(sdk, [{ kind: 'tree', to }], opts);
}

export function pullLever(sdk: TravelSdk, lever: Lever, opts: TravelOptions = {}): Promise<TravelResult> {
    return travel(sdk, [{ kind: 'lever', lever }], opts);
}

export function sail(sdk: TravelSdk, route: Ship, opts: TravelOptions = {}): Promise<TravelResult> {
    return travel(sdk, [{ kind: 'ship', route }], opts);
}

export function glide(sdk: TravelSdk, to: GliderStop, opts: TravelOptions = {}): Promise<TravelResult> {
    return travel(sdk, [{ kind: 'glider', to }], opts);
}

export function lumdoBoat(sdk: TravelSdk, to: LumdoStop, opts: TravelOptions = {}): Promise<TravelResult> {
    return travel(sdk, [{ kind: 'lumdo', to }], opts);
}

async function runHop(sdk: TravelSdk, trip: Trip, h: Hop, opts: TravelOptions): Promise<HopOutcome> {
    // Every hop starts from a settled position (act.ts `settle`): straight after a landing the
    // browser client is still rebuilding the region, its loc lists are empty and its collision maps
    // stale, so a lookup there finds nothing (the village spirit tree) and a walk click is misrouted.
    const settled = await settle(sdk, 60);
    if (!settled.ok) return { ok: false, reason: 'the region never finished loading' };
    switch (h.kind) {
        case 'teleport': return hopTeleport(sdk, trip, h.spell);
        case 'run': return hopRun(sdk, trip, h.to, opts, h.via ?? [], h.wildernessAtMost);
        case 'click': {
            trip.clicks++;
            const r = await clickWalk(sdk, h.to.x, h.to.z, { tol: h.to.tol ?? 0, maxTicks: opts.maxTicks ?? 120 });
            return inArea(sdk, h.to) ? { ok: true } : { ok: false, reason: `stopped at ${fmtTile(r.at)}` };
        }
        case 'webs': return hopWebs(sdk, trip, h.goals, opts);
        case 'loc': return hopLoc(sdk, trip, h);
        case 'gate': {
            const r = await passGate(sdk, h.gate, h.to);
            trip.clicks += r.clicks;
            return r.ok ? { ok: true, note: `${r.clicks} clicks, ${r.dialogues} dialogues` } : { ok: false, reason: r.reason };
        }
        case 'item-on-loc': return hopItemOnLoc(sdk, trip, h);
        case 'tree': return hopTree(sdk, trip, h.to);
        case 'lever': return hopLever(sdk, trip, h.lever);
        case 'ship': return hopShip(sdk, trip, h.route);
        case 'glider': return hopGlider(sdk, trip, h.to);
        case 'lumdo': return hopLumdo(sdk, trip, h.to);
    }
}

// ------------------------------------------------------------------ teleport

async function hopTeleport(sdk: TravelSdk, trip: Trip, spell: Spell): Promise<HopOutcome> {
    const why = teleportRefusal(sdk, spell);
    if (why) return { ok: false, refused: why };
    trip.clicks++;
    const landing = SPELLS[spell].landing;
    const r = await castTeleport(sdk, spell, 25, s => inArea(s, landing));
    if (!r.ok) return r.reason?.startsWith('refused') ? { ok: false, refused: r.reason } : { ok: false, reason: r.reason ?? 'no jump' };
    // The jump is published with the landing tile; one more tick covers an interpolated position.
    const landed = await waitUntil(sdk, s => inArea(s, landing), { maxTicks: 1 });
    return landed.ok ? { ok: true } : { ok: false, reason: `landed at ${fmtTile(pos(sdk))}, outside ${fmtTile(landing)}` };
}

// ------------------------------------------------------------------ the chained run

const CLOSED_DOOR = (l: NearbyLoc) => /door|gate/i.test(l.name) && opIndex(l, /^open$/i) !== undefined;
const OPEN_DOOR = (l: NearbyLoc) => /door|gate/i.test(l.name) && opIndex(l, /^close$/i) !== undefined;
const WEB = (l: NearbyLoc) => /^web$/i.test(l.name) && opIndex(l, /^slash$/i) !== undefined;
const DOORISH = (l: NearbyLoc) => /door|gate/i.test(l.name);
const doorKey = (l: { x: number; z: number }) => `${l.x},${l.z}`;
/** The cooked fish `eat` takes by default (and legs.ts counts as food). */
export const FOOD = /^(shark|swordfish|lobster|tuna|salmon|trout|bass|monkfish|pike)$/i;

type XZ = { x: number; z: number };

/** Tiles from `from` through each point in turn, one step at a time (straight or diagonal). */
export function expandRoute(from: XZ, points: readonly XZ[]): XZ[] {
    const out: XZ[] = [];
    let cur = { x: from.x, z: from.z };
    for (const w of points) {
        let guard = 0;
        while ((cur.x !== w.x || cur.z !== w.z) && guard++ < 4096) {
            cur = { x: cur.x + Math.sign(w.x - cur.x), z: cur.z + Math.sign(w.z - cur.z) };
            out.push(cur);
        }
    }
    return out;
}

/** The SDK route to `goal` (or straight through `via`), always ending on the goal tile. */
function buildRoute(sdk: TravelSdk, goal: Area, via: readonly XZ[]): XZ[] {
    const from = pos(sdk);
    let points: XZ[] = [...via, goal];
    if (!via.length) {
        const path = sdk.findPath(goal.x, goal.z, 500);
        if (path.success && path.waypoints.length) points = [...path.waypoints, goal];
    }
    const route = expandRoute(from, points);
    return route.length ? route : [{ x: goal.x, z: goal.z }];
}

/**
 * Whether `s.nearbyLocs` describes the scene around the player. The browser publishes a frame while
 * it rebuilds the map region (`sceneReady` false), and that frame's loc list is not the scene's: on
 * S12 B the closed house door (2609,3190) was missing from it on exactly the tick the run clicked
 * past the door (rs/484). Nothing is decided from such a frame, and no loc click goes out on one:
 * the browser drops a door click sent mid-rebuild (S12 B: 48 ticks against 37 when it did). The
 * lite client is always ready.
 */
const sceneBuilt = (s: BotWorldState) => s.sceneReady !== false;

/** The last route index from `from` on within `reach` of `p`: the furthest tile a click from `p` would take. */
function reachEnd(route: readonly XZ[], from: number, p: XZ, reach: number): number {
    let end = from;
    for (let i = from; i < route.length && chebyshev(route[i]!, p) <= reach; i++) end = i;
    return end;
}

/** The route index nearest `p` in [from, to]; past it when the player stands on that tile, so a door under the player is never ahead. */
function routeAhead(route: readonly XZ[], p: XZ, from: number, to: number): number {
    let best = from;
    let bd = Infinity;
    for (let i = from; i <= to && i < route.length; i++) {
        const d = chebyshev(route[i]!, p);
        if (d < bd) {
            bd = d;
            best = i;
        }
    }
    return bd === 0 ? best + 1 : best;
}

function onRoute(s: BotWorldState, route: readonly XZ[], from: number, to: number, pred: (l: NearbyLoc) => boolean): NearbyLoc | null {
    const locs = s.nearbyLocs.filter(pred);
    if (!locs.length) return null;
    for (let j = from; j <= to && j < route.length; j++) {
        const l = locs.find(q => q.x === route[j]!.x && q.z === route[j]!.z);
        if (l) return l;
    }
    return null;
}

function eater(sdk: TravelSdk, trip: Trip, o?: EatOptions): (s: BotWorldState) => Promise<void> {
    if (!o) return async () => {};
    let last = -99;
    return async s => {
        const hp = s.player?.hp ?? 99;
        if (hp >= (o.below ?? 15) || s.tick - last < 3) return;
        const f = invItem(s, o.food ?? FOOD);
        if (!f) return;
        last = s.tick;
        trip.ate++;
        trip.clicks++;
        await sdk.sendUseItem(f.slot, opIndex(f, /^eat$/i) ?? 1);
    };
}

/** Open the closed door or gate nearest the player within 2 tiles, except those in `passed`; the door opened, or null. */
async function openNearbyDoor(sdk: TravelSdk, trip: Trip, passed: ReadonlySet<string>): Promise<NearbyLoc | null> {
    const p = pos(sdk);
    const door = (await sdk.scanNearbyLocs(4)).filter(l => CLOSED_DOOR(l) && chebyshev(l, p) <= 2 && !passed.has(doorKey(l))).sort((a, b) => a.distance - b.distance)[0];
    if (!door) return null;
    await openDoorOnRoute(sdk, trip, door);
    return door;
}

/**
 * The door a run has just gone through, as loc keys: `door` and every door or gate loc within a
 * tile of it (a double door; the Grand Tree's door has a loc on each side). Open or shut alike.
 */
function doorPassed(s: BotWorldState, door: { x: number; z: number }): Set<string> {
    return new Set([doorKey(door), ...s.nearbyLocs.filter(l => DOORISH(l) && chebyshev(l, door) <= 1).map(doorKey)]);
}

/**
 * The doors a run starting at `at` may have just come through: every door or gate loc within 2 tiles
 * that the run cannot need. A door's wall lies on an edge of its own tile, so a run crosses it only
 * by stepping into or out of that tile. `route` lists every tile after the start, so a door the run
 * needs is either on it (the run opens that one ahead) or under the player, where the first step may
 * cross its wall: the Dwarf Cannon shed door shuts with the player on its tile, inside.
 */
function doorsBehind(s: BotWorldState, at: { x: number; z: number }, route: ReadonlyArray<{ x: number; z: number }>): Set<string> {
    const crossable = (l: NearbyLoc) => (l.x === at.x && l.z === at.z) || route.some(t => t.x === l.x && t.z === l.z);
    return new Set(s.nearbyLocs.filter(l => DOORISH(l) && chebyshev(l, at) <= 2 && !crossable(l)).map(doorKey));
}

/**
 * Open a door as part of the run: the server walks to it, then opens it. Ok once a built scene lists
 * no closed door on its tile (a mid-rebuild frame lists none at all).
 */
async function openDoorOnRoute(sdk: TravelSdk, trip: Trip, door: NearbyLoc): Promise<boolean> {
    trip.door(door, 'closed', currentTick(sdk));
    trip.clicks++;
    await sdk.sendInteractLoc(door.x, door.z, door.id, opIndex(door, /^open$/i)!);
    const r = await waitUntil(sdk, s => sceneBuilt(s) && !s.nearbyLocs.some(l => l.x === door.x && l.z === door.z && CLOSED_DOOR(l)), { maxTicks: Math.ceil(chebyshev(pos(sdk), door) / 2) + 6 });
    return r.ok;
}

/**
 * Ticks of silence a run rides out. Through wait.ts's wall-clock backstop of (maxTicks + 10) x
 * tickMs that is 9 s at 300 ms: the demo has gone silent ~2 s with nothing wrong (rs/102), and a
 * 4 s stall then recovered on the demo (rs/198), where the runner counts a session lost at 17 ticks.
 */
export const STALL_TICKS = 20;

/** The first published state after tick `after`, or null once the client has been silent past STALL_TICKS. */
async function tickAfter(sdk: StateSource, after: number): Promise<BotWorldState | null> {
    const r = await waitUntil(sdk, s => s.tick > after, { maxTicks: STALL_TICKS, after });
    return r.ok ? r.state : null;
}

async function hopRun(sdk: TravelSdk, trip: Trip, to: Area, opts: TravelOptions, viaIn: readonly XZ[], wildAtMost?: number): Promise<HopOutcome> {
    const goal: Required<Area> = { x: to.x, z: to.z, level: to.level ?? 0, tol: to.tol ?? 0 };
    const reachMax = opts.reach ?? 20;
    const lead = opts.lead ?? 3;
    const maxTicks = opts.maxTicks ?? 900;
    const maxStalls = opts.maxStalls ?? 8;
    const done = (s: BotWorldState | null) => !!s && (inArea(s, goal) || (wildAtMost !== undefined && pos(s).level === 0 && wildernessLevel(pos(s)) <= wildAtMost));
    const fallback = async (why: string): Promise<HopOutcome> => {
        if (!opts.bot || opts.stopIf) return { ok: false, reason: why };
        trip.fellBack = `bot.walkTo after: ${why}`;
        const r = await walkTo(opts.bot, sdk, goal.x, goal.z, goal.tol);
        return done(sdk.getState()) ? { ok: true, note: trip.fellBack } : { ok: false, reason: `${why}; bot.walkTo: ${r.message}` };
    };

    const start = currentTick(sdk);
    const via = [...viaIn];
    let route = buildRoute(sdk, goal, via);
    // A stall never opens the door the run last went through. The Grand Tree's door forcemoves the
    // player through it (gnome_gate.rs2 open_tree_door), so opening it again from the far side sends
    // them straight back (rs/185: ~50 ticks on each exit). At the start that is any door nearby the
    // run cannot cross (doorsBehind); afterwards it is the last one the run opened.
    let passed = doorsBehind(sdk.getState()!, pos(sdk), route);
    let idx = 0;
    let target: XZ | null = null;
    /** The route index of `target`: the outstanding click walks route[idx..targetIdx]. */
    let targetIdx = -1;
    let final = false;
    let lastPos = pos(sdk);
    let lastMove = start;
    let clickTick = -99;
    let stalls = 0;
    /** The `lastMove` of the idle spell the outstanding click was last re-sent in. */
    let resentFor = -1;
    let reach = reachMax;
    let reachFrom = pos(sdk);
    let dismissed = '';
    const doorTries = new Map<string, number>();
    /** A closed door on route[from..to] the run may still try (twice each), or null; none on a mid-rebuild frame. */
    const doorAhead = (st: BotWorldState, from: number, to: number): NearbyLoc | null => {
        if (!sceneBuilt(st)) return null;
        const door = onRoute(st, route, from, to, CLOSED_DOOR);
        return door && (doorTries.get(doorKey(door)) ?? 0) < 2 ? door : null;
    };
    /** Open `door` as part of the run, then start the run afresh from wherever that leaves the player. Null to go on; an outcome to end the hop. */
    const openAhead = async (door: NearbyLoc): Promise<HopOutcome | null> => {
        doorTries.set(doorKey(door), (doorTries.get(doorKey(door)) ?? 0) + 1);
        await openDoorOnRoute(sdk, trip, door);
        passed = doorPassed(sdk.getState()!, door);
        if (!(await tickAfter(sdk, currentTick(sdk)))) return { ok: false, reason: 'no tick' };
        t = currentTick(sdk);
        lastMove = t;
        clickTick = t;
        target = null;
        route = buildRoute(sdk, goal, via);
        idx = 0;
        return null;
    };
    const eat = eater(sdk, trip, opts.eat);
    let t = start;
    for (;;) {
        const s = sdk.getState();
        if (!s) return { ok: false, reason: 'no state' };
        const halt = opts.stopIf?.(s);
        if (halt) {
            const here = pos(s);
            trip.clicks++;
            await sdk.sendWalk(here.x, here.z, true);
            return { ok: false, stopped: halt, reason: halt };
        }
        if (done(s)) return { ok: true };
        if (t - start > maxTicks) return fallback(`run to ${fmtTile(goal)} exceeded ${maxTicks} ticks at ${fmtTile(pos(s))}`);
        const p = pos(s);
        if (p.level !== goal.level) return { ok: false, reason: `on level ${p.level}, the run is on level ${goal.level}` };
        if (p.x !== lastPos.x || p.z !== lastPos.z) {
            lastPos = p;
            lastMove = t;
        }
        while (via.length && chebyshev(p, via[0]!) <= Math.max(2, lead)) via.shift();
        if (t !== clickTick) await eat(s);
        // A continue page (a level-up) holds the client's walk clicks: dismiss each once.
        const d = s.dialog;
        if (d.isOpen && !d.isWaiting && d.options.length <= 1 && d.pageId && d.pageId !== dismissed) {
            dismissed = d.pageId;
            void sdk.sendClickDialog(0);
        }
        let needClick = target === null || (!final && chebyshev(p, target) <= lead);
        if (!needClick && t - lastMove >= 3 && t - clickTick >= 3) {
            stalls++;
            if (stalls > maxStalls) return fallback(`run to ${fmtTile(goal)} stalled ${maxStalls} times at ${fmtTile(p)}`);
            const opened = await openNearbyDoor(sdk, trip, passed);
            if (opened) passed = doorPassed(sdk.getState()!, opened);
            const slashed = !opened && (await slashNearbyWeb(sdk, trip, goal, opts));
            if (!opened && !slashed) reach = Math.max(4, Math.floor(reach / 2));
            route = buildRoute(sdk, goal, via);
            idx = 0;
            t = currentTick(sdk);
            lastMove = t;
            needClick = true;
        }
        // A closed door on the route within the run's reach is opened on the first built tick it is
        // listed, between clicks too, not only when a click falls due: the loc scan lists 15 tiles to
        // a click's 20, and a browser frame published mid-rebuild lists no door at all, so a door
        // checked only at click time can be missed for a whole click (S12 B: +9 ticks, rs/484). The
        // op click's server-side approach runs at the walk's 2 tiles a tick (rs/280), so opening a
        // door early costs nothing.
        if (!needClick && target) {
            const from = routeAhead(route, p, idx, targetIdx);
            const door = doorAhead(s, from, reachEnd(route, from, p, reach));
            if (door) {
                const end = await openAhead(door);
                if (end) return end;
                continue;
            }
        }
        // A walk click sent while the server still holds the player is dropped without a trace: the
        // player just stays put. A forced move (agility_walk) holds them through its last tile, so a
        // run that starts as one ends loses its first click. Re-send the click at the first idle
        // tick, once per idle spell: a second walk to the same tile costs nothing when the first
        // landed, and the stall above still counts from the first click.
        if (!needClick && target && t > clickTick && t - lastMove >= 1 && resentFor !== lastMove) {
            resentFor = lastMove;
            trip.clicks++;
            await sdk.sendWalk(target.x, target.z, true);
        }
        if (needClick) {
            const cur = sdk.getState()!;
            const here = pos(cur);
            let best = idx;
            let bd = Infinity;
            for (let i = idx; i < Math.min(route.length, idx + 80); i++) {
                const dd = chebyshev(route[i]!, here);
                if (dd < bd) {
                    bd = dd;
                    best = i;
                }
            }
            if (bd > 4) {
                route = buildRoute(sdk, goal, via);
                best = 0;
            }
            idx = best;
            if (chebyshev(here, reachFrom) >= 8) {
                reach = reachMax;
                reachFrom = here;
            }
            let ti = reachEnd(route, idx, here, reach);
            // A via point is a click target: the client's own routing past it is what via avoids.
            const v = via[0];
            if (v) for (let j = idx; j <= ti; j++) if (route[j]!.x === v.x && route[j]!.z === v.z) { ti = j; break; }
            const door = doorAhead(cur, idx, ti);
            if (door) {
                const end = await openAhead(door);
                if (end) return end;
                continue;
            }
            for (let j = idx; j <= ti; j++) {
                const o = cur.nearbyLocs.find(l => l.x === route[j]!.x && l.z === route[j]!.z && OPEN_DOOR(l));
                if (o) trip.door(o, 'open', t);
            }
            target = route[ti] ?? goal;
            targetIdx = ti;
            final = ti >= route.length - 1;
            trip.clicks++;
            await sdk.sendWalk(target.x, target.z, true);
            clickTick = t;
        }
        const next = await tickAfter(sdk, t);
        if (!next) return { ok: false, reason: 'no tick' };
        t = next.tick;
    }
}

// ------------------------------------------------------------------ webs

const SLASHED = /slash the web apart/i;
const WEB_RESULT = /slash the web apart|fail to cut through/i; // web.rs2

/** Knife on `web` until it is slashed (50% per try, web.rs2), then step to `through` with a server-side walk. */
async function slashWeb(sdk: TravelSdk, trip: Trip, web: NearbyLoc, through: XZ, tries = 12): Promise<boolean> {
    for (let i = 0; i < tries; i++) {
        if (!invItem(sdk, /^knife$/i)) return false;
        const c = messageCursor(sdk); // the last failed try's reply must not count
        trip.webTries++;
        trip.clicks++;
        await act(sdk, () => sdk.sendUseItemOnLoc(slotOf(sdk, /^knife$/i), web.x, web.z, web.id), s => messagesAfter(s, c, WEB_RESULT).length > 0, { maxTicks: 30 });
        if (!messagesAfter(sdk, c, SLASHED).length) continue;
        // A success runs p_delay(1) and a move click sent while delayed is refused
        // (MoveClickHandler), so re-send the step until the player moves.
        const p0 = pos(sdk);
        for (let k = 0; k < 5; k++) {
            trip.clicks++;
            await sdk.sendWalk(through.x, through.z, true);
            const moved = await waitUntil(sdk, s => chebyshev(pos(s), through) <= 1 || chebyshev(pos(s), p0) >= 2, { maxTicks: 3 });
            if (moved.ok) break;
        }
        return true;
    }
    return false;
}

/** A stalled run next to a web: slash the nearest one and step 2 tiles past it toward the goal. */
async function slashNearbyWeb(sdk: TravelSdk, trip: Trip, goal: XZ, opts: TravelOptions): Promise<boolean> {
    if (!invItem(sdk, /^knife$/i)) return false;
    const p = pos(sdk);
    const web = (await sdk.scanNearbyLocs(3)).filter(l => WEB(l) && chebyshev(l, p) <= 2).sort((a, b) => a.distance - b.distance)[0];
    if (!web) return false;
    void opts;
    const through = { x: web.x + Math.sign(goal.x - web.x), z: web.z + Math.sign(goal.z - web.z) };
    return slashWeb(sdk, trip, web, through);
}

/**
 * Walk through each goal in turn. The lite client's static collision keeps a slashed web closed,
 * so a goal behind a web is reached by slashing the nearest web and a server-side step through it.
 */
async function hopWebs(sdk: TravelSdk, trip: Trip, goals: ReadonlyArray<readonly [number, number]>, opts: TravelOptions): Promise<HopOutcome> {
    for (const [gx, gz] of goals) {
        const goal = { x: gx, z: gz, level: pos(sdk).level, tol: 1 };
        let reached = false;
        for (let attempt = 0; attempt < 16 && !reached; attempt++) {
            if (inArea(sdk, goal)) {
                reached = true;
                break;
            }
            const path = sdk.findPath(gx, gz, 60);
            if (path.success && path.reachedDestination && path.waypoints.length < 40) {
                const r = await hopRun(sdk, trip, goal, { ...opts, maxStalls: 2, bot: undefined }, []);
                if (r.ok) reached = true;
                continue;
            }
            const web = (await sdk.scanNearbyLocs(12)).filter(WEB).sort((a, b) => a.distance - b.distance)[0];
            if (!web) {
                trip.clicks++;
                await sdk.sendWalk(gx, gz, true);
                reached = (await waitUntil(sdk, s => inArea(s, goal), { maxTicks: 60 })).ok;
                break;
            }
            if (!invItem(sdk, /^knife$/i)) return { ok: false, reason: `a web at ${web.x},${web.z} and no knife` };
            if (await slashWeb(sdk, trip, web, { x: gx, z: gz }, 1)) {
                reached = (await waitUntil(sdk, s => inArea(s, goal), { maxTicks: Math.max(6, chebyshev(pos(sdk), goal) + 4) })).ok;
            }
        }
        if (!reached) return { ok: false, reason: `webs: did not reach ${gx},${gz} (at ${fmtTile(pos(sdk))})` };
    }
    return { ok: true, note: `${trip.webTries} web tries` };
}

// ------------------------------------------------------------------ gates

/**
 * A gate a route passes through: the closed gate loc, its open option, and the two sides it
 * joins. A gate's script can open a dialogue instead of the gate: `answers` are that dialogue's
 * choices, by text (continue pages are continued, and a choice page none of them matches takes
 * its first option).
 */
export interface Gate {
    label: string;
    loc: { id: number; x: number; z: number };
    /** The open option (default Open). */
    op?: OpPattern;
    /** Each side as a region covering its approach; `passGate` ends in the one it is given. */
    sides: { readonly [side: string]: Region };
    answers?: readonly OptionPattern[];
}

/**
 * The Gnome Stronghold's south gate (gnome_areagate, loc 190; gnome_gate.rs2). Its script places
 * the player on its south (2461,3382) or north (2461,3385) entrance and steps them 3 tiles
 * through by p_teleport (agility_walk), so it never shows a Close option. From the south on a
 * first visit, with Femi beside it, it starts her boxes scene instead (femi.rs2
 * grandtree_femi_boxes): 3 pages and a choice, declined by "Sorry, I'm a bit busy.", which sets
 * %femi_help and leaves the gate shut, so the gate is clicked again. The Grand Tree stages that
 * close the gate to the player are not handled: the run does the Grand Tree by then.
 */
export const GNOME_STRONGHOLD_GATE = {
    label: 'Gnome Stronghold south gate',
    loc: { id: 190, x: 2459, z: 3383 },
    // Bands around the passage, checked tile by tile on the SDK collision map: every walkable tile
    // in each is reached from its own entrance and not from the other's (the wall bends away
    // west of x 2458 and east of 2465). A tile in neither answers no side (gateSide null).
    sides: {
        north: { x: [2458, 2465], z: [3385, 3440] },
        south: { x: [2456, 2466], z: [3360, 3382] },
    },
    answers: [/^Sorry, I'm a bit busy\.$/],
} as const satisfies Gate;

/** The side of `gate` whose region holds `t` (on level 0), or null when neither does. */
export function gateSide(gate: Gate, t: { x: number; z: number; level?: number }): string | null {
    for (const [side, r] of Object.entries(gate.sides)) {
        if ((t.level ?? 0) === (r.level ?? 0) && t.x >= r.x[0] && t.x <= r.x[1] && t.z >= r.z[0] && t.z <= r.z[1]) return side;
    }
    return null;
}

export interface GateResult extends JumpCounts {
    ok: boolean;
    startTick: number;
    ticks: number;
    /** Gate clicks sent (re-sends of a dropped click included). */
    clicks: number;
    /** Dialogues the gate's script opened, and their pages and choices. */
    dialogues: number;
    pages: number;
    options: number;
    at: Tile;
    reason?: string;
}

/**
 * Go through `gate` to its side `to`, and return only once the published position is inside
 * `to`: never on a click sent. A dialogue already open when it starts (a gate click sent by
 * someone else, as bot.walkTo's door opener does) or opened by the gate is answered with the
 * gate's `answers`, and the gate clicked again. Each click goes through `act`, so it waits for
 * the region to load and the position to settle after a jump, and is re-sent when dropped.
 * Already in `to`: ok with no click.
 */
export async function passGate(sdk: TravelSdk, gate: Gate, to: Region, opts: { maxClicks?: number; maxTicks?: number; log?: boolean } = {}): Promise<GateResult> {
    const startTick = currentTick(sdk);
    const maxClicks = opts.maxClicks ?? 4;
    const maxTicks = opts.maxTicks ?? 150;
    const res: GateResult = { ok: false, startTick, ticks: 0, clicks: 0, dialogues: 0, pages: 0, options: 0, at: pos(sdk) };
    const jump: Required<JumpCounts> = { settleTicks: 0, refusedResends: 0, unansweredResends: 0 };
    const end = (ok: boolean, reason?: string): GateResult => {
        const out: GateResult = { ...res, ok, ticks: currentTick(sdk) - startTick, at: pos(sdk), ...(reason ? { reason } : {}) };
        for (const k of ['settleTicks', 'refusedResends', 'unansweredResends'] as const) if (jump[k]) out[k] = jump[k];
        if (opts.log) console.log(`  [gate] ${gate.label}: ${ok ? 'through' : `FAILED (${reason})`} in ${out.ticks} ticks, ${res.clicks} clicks, ${res.dialogues} dialogues`);
        return out;
    };
    const answer = async () => {
        const c = await converse(sdk, [...(gate.answers ?? [])], { idle: 1, openTicks: 1, maxTicks: 80, keep: true, unmatched: 'first', log: opts.log });
        if (c.opened) res.dialogues++;
        res.pages += c.pages;
        res.options += c.options;
        return c;
    };
    const out = () => currentTick(sdk) - startTick > maxTicks;
    for (let attempt = 0; ; attempt++) {
        if (within(sdk, to)) return end(true);
        if (out()) return end(false, `not through after ${maxTicks} ticks (at ${fmtTile(pos(sdk))})`);
        if (sdk.getState()?.dialog.isOpen) {
            const c = await answer();
            if (!c.ok) return end(false, `the gate's dialogue: ${c.reason}`);
            continue;
        }
        if (attempt >= maxClicks * 2 || res.clicks >= maxClicks) return end(false, `not through after ${res.clicks} clicks (at ${fmtTile(pos(sdk))})`);
        // The loc can be missing while the region loads, or for the 5 ticks the script swaps it out.
        const found = await waitUntil(sdk, s => within(s, to) || s.dialog.isOpen || s.nearbyLocs.some(l => l.id === gate.loc.id && l.x === gate.loc.x && l.z === gate.loc.z), { maxTicks: 30 });
        if (!found.ok) return end(false, `no ${gate.label} at ${gate.loc.x},${gate.loc.z} in view (at ${fmtTile(pos(sdk))})`);
        const l = found.state.nearbyLocs.find(x => x.id === gate.loc.id && x.x === gate.loc.x && x.z === gate.loc.z);
        if (!l) continue;
        const op = opIndex(l, gate.op ?? /^open$/i);
        if (op === undefined) return end(false, `${l.name} at ${l.x},${l.z} has no option ${String(gate.op ?? 'Open')}: ${l.options.join('/')}`);
        const r = await act(sdk, () => {
            res.clicks++;
            return sdk.sendInteractLoc(l.x, l.z, l.id, op);
        }, s => within(s, to) || s.dialog.isOpen, { resendEvery: 6, maxResends: 2, maxTicks: 30 });
        jump.settleTicks += r.settleTicks ?? 0;
        jump.refusedResends += r.refusedResends ?? 0;
        jump.unansweredResends += r.unansweredResends ?? 0;
    }
}

// ------------------------------------------------------------------ locs, trees, levers, ships, gliders, boats

async function hopLoc(sdk: TravelSdk, trip: Trip, h: Extract<Hop, { kind: 'loc' }>): Promise<HopOutcome> {
    const l = await findLoc(sdk, { ...h.loc, ...(h.op ? { op: h.op } : {}) });
    if (!l) return { ok: false, reason: `no loc ${String(h.loc.name ?? h.loc.id)} near ${fmtTile(pos(sdk))}` };
    const op = h.op ? opIndex(l, h.op) : l.optionsWithIndex[0]?.opIndex;
    if (op === undefined) return { ok: false, reason: `${l.name} has no option ${String(h.op)}` };
    const level0 = pos(sdk).level;
    const arrived = (s: BotWorldState) => (h.arrive ? within(s, h.arrive) : h.level !== undefined ? pos(s).level === h.level : pos(s).level !== level0);
    trip.clicks++;
    const r = await actConverse(sdk, () => sdk.sendInteractLoc(l.x, l.z, l.id, op), h.answers ?? [], { done: arrived, idle: 0, maxTicks: 40 });
    return r.ok ? { ok: true } : { ok: false, reason: `${l.name} at ${l.x},${l.z}: ${r.reason ?? 'no arrival'} (at ${fmtTile(pos(sdk))})` };
}

async function hopItemOnLoc(sdk: TravelSdk, trip: Trip, h: Extract<Hop, { kind: 'item-on-loc' }>): Promise<HopOutcome> {
    if (!invItem(sdk, h.item)) return { ok: false, reason: `no ${String(h.item)} in the inventory` };
    const l = await findLoc(sdk, h.loc);
    if (!l) return { ok: false, reason: `no loc ${String(h.loc.name ?? h.loc.id)} near ${fmtTile(pos(sdk))}` };
    trip.clicks++;
    const r = await act(sdk, () => sdk.sendUseItemOnLoc(slotOf(sdk, h.item), l.x, l.z, l.id), s => inArea(s, h.arrive), { resendEvery: 4, maxTicks: 30 });
    return r.ok ? { ok: true } : { ok: false, reason: `${String(h.item)} on ${l.name}: no arrival at ${fmtTile(h.arrive)} (at ${fmtTile(pos(sdk))})` };
}

async function hopTree(sdk: TravelSdk, trip: Trip, to: SpiritTree): Promise<HopOutcome> {
    const ids = Object.keys(TREE_LOCS).map(Number);
    const near = (s: BotWorldState | null) => (s?.nearbyLocs ?? []).filter(l => ids.includes(l.id)).sort((a, b) => a.distance - b.distance)[0];
    const l = near(sdk.getState()) ?? (await sdk.scanNearbyLocs(25)).filter(x => ids.includes(x.id)).sort((a, b) => a.distance - b.distance)[0];
    if (!l) return { ok: false, reason: `no spirit tree near ${fmtTile(pos(sdk))}` };
    const kind = TREE_LOCS[l.id]!;
    if (kind === to) return { ok: false, reason: `already at the ${to} tree` };
    if (kind === 'young' && to !== 'village') return { ok: false, reason: `a young spirit tree only goes to the village, not ${to}` };
    const answers = kind === 'young' ? [/^yes please/i] : [/^where can i go/i, SPIRIT_TREES[to].choice];
    const op = l.optionsWithIndex[0]?.opIndex ?? 1;
    trip.clicks++;
    const r = await actConverse(sdk, () => sdk.sendInteractLoc(l.x, l.z, l.id, op), answers, { done: s => inArea(s, SPIRIT_TREES[to].landing), idle: 0, maxTicks: 60 });
    if (r.ok) return { ok: true, note: `${r.dialogue?.pages ?? 0} pages, ${r.dialogue?.options ?? 0} choices` };
    const refused = messagesSince(sdk, r.startTick, /doesn't feel like talking/i).length > 0;
    return { ok: false, reason: refused ? 'the tree does not talk: its quest is not complete' : `no arrival at ${fmtTile(SPIRIT_TREES[to].landing)}: ${r.reason}` };
}

async function hopLever(sdk: TravelSdk, trip: Trip, lever: Lever): Promise<HopOutcome> {
    const { loc, landing } = LEVERS[lever];
    const l = await findLoc(sdk, { id: loc });
    if (!l) return { ok: false, reason: `no ${lever} lever near ${fmtTile(pos(sdk))}` };
    trip.clicks++;
    // The first pull's warning: "don't show this message again" sets %warning_wilderness_teleport_lever,
    // so every later pull skips the dialogue.
    const r = await actConverse(sdk, () => sdk.sendInteractLoc(l.x, l.z, l.id, l.optionsWithIndex[0]?.opIndex ?? 1), [/don't show this message again/i, /^yes i'm brave/i], { done: s => inArea(s, landing), idle: 0, maxTicks: 40 });
    return r.ok ? { ok: true } : { ok: false, reason: `${lever} lever: no arrival at ${fmtTile(landing)} (${r.reason})` };
}

async function talkClick(sdk: TravelSdk, npc: RegExp): Promise<(() => Promise<unknown>) | string> {
    const n = await waitForNpc(sdk, npc, 5);
    if (!n) return `no ${npc} near ${fmtTile(pos(sdk))}`;
    const op = opIndex(n, /^talk-to$/i) ?? 1;
    return () => sdk.sendInteractNpc(n.index, op);
}

async function hopShip(sdk: TravelSdk, trip: Trip, route: Ship): Promise<HopOutcome> {
    const { npc, deck, fare } = SHIPS[route];
    if (invCount(sdk, /^coins$/i) < fare) return { ok: false, reason: `the ship costs ${fare} coins` };
    const click = await talkClick(sdk, npc);
    if (typeof click === 'string') return { ok: false, reason: click };
    trip.clicks++;
    const onDeck = (s: BotWorldState) => inArea(s, { ...deck, tol: 10 });
    const r = await actConverse(sdk, click, [/^yes please/i], { done: onDeck, idle: 1, maxTicks: 60 });
    if (!r.ok) return { ok: false, reason: `ship to ${route}: not on the deck (${r.reason})` };
    const plank = await findLoc(sdk, { name: /gangplank/i, op: /^cross$/i, radius: 10 });
    if (!plank) return { ok: false, reason: 'no gangplank on the deck' };
    trip.clicks++;
    const off = await act(sdk, () => sdk.sendInteractLoc(plank.x, plank.z, plank.id, opIndex(plank, /^cross$/i)!), s => pos(s).level === 0 && chebyshev(pos(s), deck) <= 10, { resendEvery: 4, maxTicks: 20 });
    return off.ok ? { ok: true, note: `deck ${r.ticks}, gangplank ${off.ticks}` } : { ok: false, reason: 'gangplank not crossed' };
}

/** The glider stop the player is at, as calc_gliderstart decides it: within 8 tiles of the stop, else Ta Quir Priw. */
export function gliderStopAt(src: StateLike): GliderStop {
    const p = pos(src);
    for (const [stop, g] of Object.entries(GLIDERS) as [GliderStop, (typeof GLIDERS)[GliderStop]][]) {
        if (stop !== 'ta_quir_priw' && p.level === (g.landing.level ?? 0) && chebyshev(p, g.landing) <= 8) return stop;
    }
    return 'ta_quir_priw';
}

async function hopGlider(sdk: TravelSdk, trip: Trip, to: GliderStop): Promise<HopOutcome> {
    const from = gliderStopAt(sdk);
    if (from === to) return { ok: false, reason: `already at ${to}` };
    if (from !== 'ta_quir_priw' && to !== 'ta_quir_priw') return { ok: false, reason: `gliders fly only to or from Ta Quir Priw (${from} to ${to})` };
    const click = await talkClick(sdk, PILOT);
    if (typeof click === 'string') return { ok: false, reason: click };
    trip.clicks++;
    const map = await actConverse(sdk, click, [/take me on the glider/i], { done: s => s.modalOpen && s.modalInterface === GLIDER_MAP, idle: 0, maxTicks: 30 });
    if (!map.ok) return { ok: false, reason: `the glider map did not open (${map.reason}); The Grand Tree must be complete` };
    const landing = GLIDERS[to].landing;
    trip.clicks++;
    const fly = await act(sdk, () => sdk.sendClickComponent(GLIDERS[to].component), s => inArea(s, landing), { resendEvery: 8, maxResends: 1, maxTicks: 20 });
    return fly.ok ? { ok: true, note: `map ${map.ticks}, flight ${fly.ticks}` } : { ok: false, reason: `no arrival at ${fmtTile(landing)} (at ${fmtTile(pos(sdk))})` };
}

async function hopLumdo(sdk: TravelSdk, trip: Trip, to: LumdoStop): Promise<HopOutcome> {
    const click = await talkClick(sdk, /^lumdo$/i);
    if (typeof click === 'string') return { ok: false, reason: click };
    trip.clicks++;
    const r = await actConverse(sdk, click, [], { done: s => inArea(s, LUMDO[to]), idle: 0, maxTicks: 40 });
    return r.ok ? { ok: true } : { ok: false, reason: `Lumdo: no arrival at ${fmtTile(LUMDO[to])} (${r.reason}); the atoll leg needs Monkey Madness past the first crossing` };
}

// ------------------------------------------------------------------ routes

/**
 * Ape Atoll, the western rope's top (2749,2768) to the bridge ladder (2803,2735) over the roofs:
 * the warehouse door at (2744,2767) is locked and the SDK pathfinder treats it as open. Proven by
 * rs/201 (`ROOFS` in speedrun/lab/measure-mm-routes.ts on its branch): 112 ticks over 174 tiles at
 * 300 ms with bot.walkTo for the runs.
 */
export const APE_ATOLL_ROOFS: readonly Hop[] = [
    { kind: 'loc', loc: { x: 2752, z: 2767, name: /ladder/i }, level: 1, label: 'warehouse ladder up' },
    { kind: 'loc', loc: { x: 2748, z: 2768, name: /ladder/i }, level: 2, label: 'ladder up to the bamboo bridges' },
    { kind: 'run', to: { x: 2786, z: 2793, level: 2, tol: 1 } },
    { kind: 'loc', loc: { x: 2787, z: 2795, name: /ladder/i }, level: 1, label: 'reverse ladder down' },
    { kind: 'run', to: { x: 2794, z: 2774, level: 1, tol: 1 } },
    { kind: 'loc', loc: { x: 2794, z: 2773, name: /ladder/i }, level: 0, label: 'temple ladder down' },
    { kind: 'run', to: { x: 2803, z: 2735, tol: 1 } },
];

/** The trip's arrival tile for `hops`: the last hop that names one. */
export function hopsDestination(hops: readonly Hop[]): Area | null {
    for (let i = hops.length - 1; i >= 0; i--) {
        const h = hops[i]!;
        switch (h.kind) {
            case 'teleport': return SPELLS[h.spell].landing;
            case 'run': case 'click': return h.to;
            case 'item-on-loc': return h.arrive;
            case 'loc': if (h.arrive && 'tol' in h.arrive) return h.arrive; break;
            case 'tree': return SPIRIT_TREES[h.to].landing;
            case 'lever': return LEVERS[h.lever].landing;
            case 'glider': return GLIDERS[h.to].landing;
            case 'lumdo': return LUMDO[h.to];
            case 'webs': { const g = h.goals[h.goals.length - 1]; if (g) return { x: g[0], z: g[1], tol: 1 }; break; }
            case 'ship': break;
        }
    }
    return null;
}
