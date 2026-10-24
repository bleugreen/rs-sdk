// Ranged: the scored run's two cannon steps at the Wilderness poison spiders
// (3288,3810, level-37 Wilderness, multi-combat).
//
//   S14 cannonSession  STEP-MANIFEST.md entry 26: Ranged 1 to 50 base with the
//                      cannon alone, the mithril scimitar wielded at Attack 99
//                      (the cannon rolls the wielded style's accuracy,
//                      cannon_fire.rs2), auto-retaliate off.
//   S27 combatFinish   entry 7: cannon + defensive melee until Defence 99, the
//                      cannon with the scimitar to `bowFrom` (50 by default, so
//                      none: the bow goes on when Defence closes), cannon + a rapid
//                      magic shortbow with rune arrows to Ranged 99, then any
//                      Hitpoints still short by melee (the bow's own hits give
//                      less Hitpoints than knives' did; see `hitpointsPhase`).
//
// One loop runs both: a session clocked by the zero-drain flick (lib/flick.ts),
// with the cannon kept topped up (lib/cannon.ts), and each phase's attacks, sips
// and gear placed on the ticks the flick leaves them:
// - the attack goes after a burst's prayer toggles (each toggle clears it),
//   never beside a cannon click (two interactions in a tick: one is lost), and
//   not while a top-up is still walking to the cannon;
// - a sip goes on the flick's consume tick, so its p_delay never drops a burst;
// - level-up pages are clicked on the tick they show, with the attack re-sent
//   behind them (rs/12), and a target that has taken no damage from us for
//   `stallTicks` is re-attacked: under a protect prayer "in combat" can mean
//   only that the spiders are attacking us (rs/56's re-engage fix, as in
//   combat.ts `fight`);
// - auto-retaliate, which every login turns off, is set as the phase wants it
//   through lib/session.ts `setAutoRetaliate` on a free tick once the gear is
//   right (the button stops the attack and, beside a Fire or a top-up walk,
//   cancels it), and put back off when the session ends, by a throw or a stop
//   too, before the cannon is picked up: with it on, a hit during a click
//   turns the player to fight back and the click is lost.
// combat.ts's `fight` follows one NPC to its end and owns the tick its attack
// goes on; a cannon session fights whatever comes, retargets on every kill, and
// shares its ticks with the flick and the cannon, so it is its own loop.
//
// Every decision is a pure function of the published state and the session's
// memory (`phaseFor`, `chooseConsume`, `gearClick`, `pickTarget`), unit-tested on
// scripted state; `runSession` only sequences them.

import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, InventoryItem, NearbyNpc, PrayerName } from '../../sdk/types';
import {
    assembledCannon, ballsHeld, besideCannon, CANNON_PART_OBJS, CANNON_PARTS, CANNONBALL, CANNONBALL_OBJ, CannonKeeper, cannonCentre, freeSlots, hasCannonSet, MessageCursor,
    PICKUP_FREE_SLOTS, pickUpCannon, placedCannon, setUpCannon, setupTiles,
} from '../lib/cannon';
import { prayerActive } from '../lib/combat';
import { classifyPage, clickContinue } from '../lib/dialogue';
import { FlickScheduler, MAX_PERIOD } from '../lib/flick';
import { levelUpChain } from '../lib/levelup';
import { questDone } from '../lib/quests';
import { setAutoRetaliate } from '../lib/session';
import { tickMs, waitUntil } from '../lib/wait';
import { chebyshev, invCount, invItem, opIndex, pos, worn } from '../lib/world';
import { XP_RATE } from '../lib/xp';
import type { Step, StepContext } from '../runner/step';

export const skill = 'ranged';

/** The cannon spot at the poison spiders (ranged-cannon.ts `spiders`). */
export const SPIDERS = { x: 3288, z: 3810, level: 0 } as const;
/** The steps start within this many tiles of the spot (the legs child brings the player). */
export const SITE_RADIUS = 12;
export const SPIDER = /^poison spider$/i;

export const SCIMITAR = /^mithril scimitar$/i;
export const BOW = /^magic shortbow$/i;
export const ARROWS = /^rune arrows?$/i;
export const SHARK = /^shark$/i;
export const POTION = {
    ranging: /^ranging potion\(\d\)$/i,
    superAttack: /^super attack\(\d\)$/i,
    superStrength: /^super strength\(\d\)$/i,
    superAntipoison: /^superantipoison\(\d\)$/i,
    antipoison: /^antipoison\(\d\)$/i,
    prayer: /^prayer potion\(\d\)$/i,
} as const;

const PFM: PrayerName = 'protect_from_melee';
const US: PrayerName = 'ultimate_strength';
const IR: PrayerName = 'incredible_reflexes';
/** Prayer level each prayer needs (PRAYER_LEVELS). */
const PRAYER_LEVEL: Partial<Record<PrayerName, number>> = { protect_from_melee: 43, ultimate_strength: 31, incredible_reflexes: 34 };

/**
 * Immunity a dose leaves, less a timer step of margin: %poison is set to -20
 * (super) or -5 and counts up once per 30-tick poison timer (anti_poison.rs2,
 * poison.rs2), so 600 and 150 ticks.
 */
export const IMMUNITY = { superAntipoison: 570, antipoison: 120 } as const;

/** The cannon holder's hand-off, as data (H11 / H11r / H23; agreed with rs/189 through rs/41). */
export const CANNON_HANDOFF = {
    S14: { in: { parts: CANNON_PART_OBJS, cannonballs: 100 }, out: 'the set and the unfired balls, back to the holder after the step (H11r); the same trade brings Monkey Madness\'s magic shortbow and 200 rune arrows the other way, so runner/handoff.ts runs H11r as swap() from its ledger row' },
    // Measured use: S14 65-72 balls; S27 ~1,110 (0.6 a tick meleeing, 0.5-0.6 with the bow), +~90 margin.
    S27: { in: { parts: CANNON_PART_OBJS, cannonballs: 1200 }, out: 'the set and the unfired balls, picked up at the end' },
    obj: CANNONBALL_OBJ,
} as const;

// ------------------------------------------------------------------ levels

export function baseLevel(s: BotWorldState, skillName: string): number {
    return s.skills.find(k => k.name.toLowerCase() === skillName.toLowerCase())?.baseLevel ?? 1;
}

function boostOf(s: BotWorldState, skillName: string): number {
    const k = s.skills.find(x => x.name.toLowerCase() === skillName.toLowerCase());
    return k ? k.level - k.baseLevel : 0;
}

// ------------------------------------------------------------------ phases

export type Phase = 'cannon' | 'melee' | 'scimitar' | 'bow' | 'hitpoints';
export type Boost = 'ranging' | 'superAttack' | 'superStrength';

export interface PhaseSpec {
    phase: Phase;
    weapon: RegExp;
    ammo?: RegExp;
    /** CombatStyleOption.type to keep selected; undefined leaves the style alone. */
    style?: string;
    /** Auto-retaliate through the phase (runSession sets it with setAutoRetaliate). */
    retaliate: boolean;
    /** Send attacks of our own (melee or the bow). */
    attack: boolean;
    /** The cannon fires through the phase (false: picked up first). */
    cannon: boolean;
    prayers: PrayerName[];
    boosts: Boost[];
}

export interface FinishThresholds {
    defence: number;
    bowFrom: number;
    ranged: number;
    hitpoints: number;
}
/**
 * bowFrom 50 (the magic shortbow's requirement) puts the bow on as soon as Defence closes, at about
 * Ranged 67: Ranged 67 to 70 took 55 ticks with the bow against 85 with the scimitar, measured from
 * one start (n=3 each, gear switch included), about 25 off S27. 70 restores the scimitar phase.
 */
export const FINISH: FinishThresholds = { defence: 99, bowFrom: 50, ranged: 99, hitpoints: 99 };
/** Ranged no step before S27 reaches (S14's 50 and Monkey Madness's Jungle Demon leave ~54): S27's own evidence. */
const S27_STARTED_RANGED = 70;

/** S27's phase for this state: by threshold, so a passed phase is a no-op and a restart lands in the right one. */
export function phaseFor(s: BotWorldState, t: FinishThresholds = FINISH): Phase | null {
    if (baseLevel(s, 'Defence') < t.defence) return 'melee';
    if (baseLevel(s, 'Ranged') < t.bowFrom) return 'scimitar';
    if (baseLevel(s, 'Ranged') < t.ranged) return 'bow';
    if (baseLevel(s, 'Hitpoints') < t.hitpoints) return 'hitpoints';
    return null;
}

export interface SpecOptions {
    /** S14's flicked prayers (default Protect from Melee alone, the measured basis). */
    cannonPrayers?: PrayerName[];
    /** S27: keep meleeing beside the cannon in the scimitar phase, for its Hitpoints (default true). */
    scimitarMelee?: boolean;
    /** The melee weapon (default the mithril scimitar; the lab's rs/91 control wields the rune one). */
    scimitar?: RegExp;
}

export function specFor(phase: Phase, o: SpecOptions = {}): PhaseSpec {
    const scim = o.scimitar ?? SCIMITAR;
    const melee: PhaseSpec = { phase, weapon: scim, style: 'Defensive', retaliate: true, attack: true, cannon: true, prayers: [PFM, US, IR], boosts: ['superAttack', 'superStrength'] };
    switch (phase) {
        case 'cannon':
            return { phase, weapon: scim, retaliate: false, attack: false, cannon: true, prayers: o.cannonPrayers ?? [PFM], boosts: [] };
        case 'melee':
            return melee;
        case 'scimitar':
            // The cannon's accuracy is the scimitar's slash roll, which Incredible Reflexes and super attack lift.
            return (o.scimitarMelee ?? true) ? melee : { phase, weapon: scim, retaliate: false, attack: false, cannon: true, prayers: [PFM, IR], boosts: ['superAttack'] };
        case 'bow':
            return { phase, weapon: BOW, ammo: ARROWS, style: 'Rapid', retaliate: true, attack: true, cannon: true, prayers: [PFM], boosts: ['ranging'] };
        case 'hitpoints':
            // Ranged is 99: the cannon's xp is wasted and it would take our targets' hitpoints.
            return { ...melee, cannon: false };
    }
}

// ------------------------------------------------------------------ sips and food

export interface ConsumeMemory {
    /** Tick the last antipoison dose's immunity runs out (estimate). */
    immuneUntil: number;
    /** "You have been poisoned!" seen since the last antipoison dose. */
    poisoned: boolean;
}

export interface ConsumeOptions {
    eatBelow: number;
    /** 'first-poison': a dose at the first poisoning (S14). 'proactive': keep immunity up from the start (S27, rs/91's kit). */
    antipoison: 'first-poison' | 'proactive';
    /** Drink a prayer potion below this (default 10; only if one is carried). */
    prayerBelow?: number;
}

export type ConsumeKind = 'eat' | 'superAntipoison' | 'antipoison' | Boost | 'prayer';

/** Half the potion's boost at this base level: re-sip at or below it (cannon-kit.ts). */
export function resipAt(boost: Boost, base: number): number {
    const max = boost === 'ranging' ? 4 + Math.floor(base * 0.1) : 5 + Math.floor(base * 0.15);
    return max / 2;
}

const BOOST_SKILL: Record<Boost, string> = { ranging: 'Ranged', superAttack: 'Attack', superStrength: 'Strength' };

/** The one sip or bite this tick calls for, in priority order, or null. */
export function chooseConsume(s: BotWorldState, spec: PhaseSpec, mem: ConsumeMemory, o: ConsumeOptions): { kind: ConsumeKind; item: InventoryItem } | null {
    const find = (re: RegExp) => s.inventory.find(i => re.test(i.name)) ?? null;
    const hp = s.player?.hp ?? 99;
    const shark = find(SHARK);
    if (shark && hp < o.eatBelow) return { kind: 'eat', item: shark };
    const wantAnti = s.tick >= mem.immuneUntil && (mem.poisoned || o.antipoison === 'proactive');
    if (wantAnti) {
        const sup = find(POTION.superAntipoison);
        if (sup) return { kind: 'superAntipoison', item: sup };
        const anti = find(POTION.antipoison);
        if (anti) return { kind: 'antipoison', item: anti };
    }
    for (const b of spec.boosts) {
        const item = find(POTION[b]);
        const skillName = BOOST_SKILL[b];
        if (item && boostOf(s, skillName) <= resipAt(b, baseLevel(s, skillName))) return { kind: b, item };
    }
    const pot = find(POTION.prayer);
    if (pot && (s.prayers?.prayerPoints ?? 99) < (o.prayerBelow ?? 10)) return { kind: 'prayer', item: pot };
    return null;
}

/** Record a dose in the memory. */
export function noteConsume(mem: ConsumeMemory, kind: ConsumeKind, tick: number): void {
    if (kind === 'superAntipoison' || kind === 'antipoison') {
        mem.immuneUntil = tick + IMMUNITY[kind];
        mem.poisoned = false;
    }
}

// ------------------------------------------------------------------ gear

export type GearClick = { kind: 'wield'; item: InventoryItem; op: number } | { kind: 'style'; index: number };

/** The one click that brings the weapon, ammo and style toward the phase's, or null when they match. */
export function gearClick(s: BotWorldState, spec: PhaseSpec): GearClick | null {
    for (const re of [spec.weapon, spec.ammo]) {
        if (!re || worn(s, re)) continue;
        const item = invItem(s, re);
        if (!item) continue; // preconditions name what is missing
        return { kind: 'wield', item, op: opIndex(item, /^(wield|wear)$/i) ?? 2 };
    }
    const cs = s.combatStyle;
    if (spec.style && cs?.known && worn(s, spec.weapon)) {
        const want = cs.styles.find(x => x.type.toLowerCase() === spec.style!.toLowerCase());
        if (want && cs.currentStyle !== want.index) return { kind: 'style', index: want.index };
    }
    return null;
}

// ------------------------------------------------------------------ targets

export function attackable(n: NearbyNpc): boolean {
    return SPIDER.test(n.name) && n.hp !== 0 && n.reachable !== false && opIndex(n, /^attack$/i) !== undefined;
}

/**
 * Keep the current target while it lives; otherwise a spider already in combat
 * (the cannon's hits send them at us), then the one nearest the cannon, so melee
 * does not drag the player out of reach of the top-ups.
 */
export function pickTarget(s: BotWorldState, anchor: { x: number; z: number }, current: number | null): NearbyNpc | null {
    const live = s.nearbyNpcs.filter(attackable);
    const cur = current === null ? undefined : live.find(n => n.index === current);
    if (cur) return cur;
    live.sort((a, b) => Number(b.inCombat) - Number(a.inCombat) || chebyshev(a, anchor) - chebyshev(b, anchor) || a.distance - b.distance);
    return live[0] ?? null;
}

// ------------------------------------------------------------------ the session

export type RangedSdk = Pick<
    BotSDK,
    'getState' | 'onStateUpdate' | 'sendTogglePrayer' | 'sendUseItem' | 'sendUseItemOnLoc' | 'sendInteractLoc' | 'sendInteractNpc' | 'sendSetCombatStyle' | 'sendClickComponent' | 'sendClickDialog' | 'clickDialogByText' | 'sendWalk'
>;

export interface SessionOptions extends SpecOptions {
    /** The phase for a state, or null when the session is done. */
    phaseOf: (s: BotWorldState) => Phase | null;
    /** Also end when this holds; `fireTick` is the tick the loop began (the lab's measurement windows). */
    stop?: (s: BotWorldState, fireTick: number) => boolean;
    site?: { x: number; z: number; level: number };
    flickEvery?: number;
    consume: ConsumeOptions;
    reloadEvery?: number;
    /** Re-attack a target we have dealt no damage to for this long (default 8, combat.ts). */
    stallTicks?: number;
    /** Pick the cannon up at the end (default true). */
    pickUp?: boolean;
    maxTicks: number;
    log?: (line: string, data?: Record<string, unknown>) => void;
}

export interface PhaseRow {
    phase: Phase;
    startTick: number;
    endTick: number;
    ticks: number;
    /** Base xp gained (game xp / 25). */
    xp: Record<'Ranged' | 'Defence' | 'Hitpoints' | 'Attack' | 'Strength', number>;
}

export interface SessionResult {
    startTick: number;
    /** The tick the loop began (after any cannon set-up). */
    fireTick: number;
    endTick: number;
    ticks: number;
    setUpTicks: number;
    pickUpTicks: number;
    phases: PhaseRow[];
    prayer: { start: number; min: number; end: number };
    damageTaken: number;
    minHp: number;
    consumes: Partial<Record<ConsumeKind, number>>;
    attacks: number;
    levelUps: number;
    bursts: number;
    restores: number;
    reloads: number;
    refires: number;
    dryEvents: number;
    ballsUsed: number;
    /** Rune arrows gone from the inventory and the quiver (fired; those that drop are not picked up). */
    arrowsUsed: number;
    /** Ticks with more than 5 packets sent (the server decodes the excess a tick late). */
    overBudget: number;
    end: 'done' | 'stopped';
}

const XP_SKILLS = ['Ranged', 'Defence', 'Hitpoints', 'Attack', 'Strength'] as const;
const xpOf = (s: BotWorldState, n: string) => s.skills.find(k => k.name === n)?.experience ?? 0;

function xpRow(a: BotWorldState, b: BotWorldState): PhaseRow['xp'] {
    return Object.fromEntries(XP_SKILLS.map(n => [n, +((xpOf(b, n) - xpOf(a, n)) / XP_RATE).toFixed(1)])) as PhaseRow['xp'];
}

/** Ticks that may still carry the attack re-send after a consume (OPHELD clears it; one sent with it does not land). */
const REATTACK_AFTER_CONSUME = 2;
const POISONED = /you have been poisoned/i;

/**
 * Run a cannon session at the spiders until `phaseOf` returns null (or `stop`).
 * Sets the cannon up first when none is placed (with the first protect prayer
 * held through the set-up), runs each phase on the flick clock, and at the end
 * switches the prayers off and picks the cannon up. Auto-retaliate follows the
 * phase's spec and is off again when this returns or throws.
 */
export async function runSession(sdk: RangedSdk, o: SessionOptions): Promise<SessionResult> {
    const s0 = sdk.getState();
    if (!s0?.player) throw new Error('runSession: no state');
    const site = o.site ?? SPIDERS;
    const log = o.log ?? (() => {});
    const t0 = s0.tick;
    let phase = o.phaseOf(s0);
    const consumes: SessionResult['consumes'] = {};
    const empty = (): SessionResult => ({
        startTick: t0, fireTick: t0, endTick: t0, ticks: 0, setUpTicks: 0, pickUpTicks: 0, phases: [], prayer: { start: s0.prayers?.prayerPoints ?? 0, min: s0.prayers?.prayerPoints ?? 0, end: s0.prayers?.prayerPoints ?? 0 },
        damageTaken: 0, minHp: s0.player!.hp, consumes, attacks: 0, levelUps: 0, bursts: 0, restores: 0, reloads: 0, refires: 0, dryEvents: 0, ballsUsed: 0, arrowsUsed: 0, overBudget: 0, end: 'done',
    });
    if (phase === null) {
        // Nothing left to train, but the wrap-up is still owed: a session cut after its last phase
        // (a pick-up that failed, a drop) is re-entered here with its cannon still on the ground.
        const r = (o.pickUp ?? true) && placedCannon(s0) ? await pickUpCannon(sdk) : null;
        if (r && !r.ok) throw new Error(`cannon pick-up: ${r.reason}`);
        return { ...empty(), pickUpTicks: r?.ticks ?? 0, endTick: sdk.getState()!.tick, ticks: sdk.getState()!.tick - t0 };
    }
    let spec = specFor(phase, o);

    // ---- set-up: protect prayer held and the weapon in hand while the cannon goes up
    let setUpTicks = 0;
    let assembledTick: number | undefined;
    const ballsAtStart = ballsHeld(s0);
    const arrowsAtStart = arrows(s0);
    if (spec.cannon && !assembledCannon(s0)) {
        if (spec.prayers[0] && !prayerActive(s0, spec.prayers[0])) void sdk.sendTogglePrayer(spec.prayers[0]);
        const g = gearClick(s0, spec);
        if (g?.kind === 'wield') void sdk.sendUseItem(g.item.slot, g.op);
        const r = await setUpCannon(sdk, { tiles: setupTiles(site) });
        if (!r.ok) throw new Error(`cannon set-up: ${r.reason}`);
        setUpTicks = r.ticks;
        assembledTick = r.assembledTick;
        log('cannon set up', { ticks: r.ticks, refused: r.refused, at: r.cannon ? cannonCentre(r.cannon) : null });
    } else if (spec.cannon) {
        // A cannon already here (a restart): Fire it; "already firing" is harmless and "out of ammo" the keeper answers.
        const c = assembledCannon(s0)!;
        void sdk.sendInteractLoc(c.x, c.z, c.id, opIndex(c, /^fire$/i) ?? 1);
    }

    let s = sdk.getState()!;
    const fireTick = s.tick;
    const keeper = new CannonKeeper(s, { ...(o.reloadEvery !== undefined ? { reloadEvery: o.reloadEvery } : {}), ...(assembledTick !== undefined ? { assembledTick } : {}) });
    const flick = new FlickScheduler({ prayers: spec.prayers, period: o.flickEvery ?? MAX_PERIOD });
    const chat = new MessageCursor(s);
    const levelUp = levelUpChain();
    const mem: ConsumeMemory = { immuneUntil: -Infinity, poisoned: false };
    const anchor = () => {
        const c = placedCannon(s);
        return c ? cannonCentre(c) : { x: site.x, z: site.z };
    };
    const res = empty();
    res.fireTick = fireTick;
    res.setUpTicks = setUpTicks;
    res.prayer.start = res.prayer.min = s.prayers?.prayerPoints ?? 0;
    let rowStart = s;
    const closeRow = (st: BotWorldState) => {
        if (phase) res.phases.push({ phase, startTick: rowStart.tick, endTick: st.tick, ticks: st.tick - rowStart.tick, xp: xpRow(rowStart, st) });
        rowStart = st;
    };

    let lastConsume = -Infinity;
    let lastAttack = -Infinity;
    let lastDealt = s.tick;
    let lastGear = -Infinity;
    let lastContinue: { key: string; tick: number } | null = null;
    let reattackAt = -Infinity;
    let target: number | null = null;
    let lastHp = s.player!.hp;
    let pickUpSent = -Infinity;
    const seenHits = new Set<string>();
    /** The auto-retaliate setting last asked of setAutoRetaliate (null: none yet; login left it off). */
    let retaliate: boolean | null = null;
    const setRetaliate = async (on: boolean) => {
        retaliate = on;
        const r = await setAutoRetaliate(sdk, on);
        if (r.presses > 0 || r.reason) log('auto-retaliate', { want: on, ...r });
        return r;
    };

    try {
        for (;;) {
            const prev = s.tick;
            const w = await waitUntil(sdk, st => st.tick > prev, { maxTicks: 50 });
            if (!w.ok) throw new Error(`cannon session: the client stopped publishing at tick ${prev}`);
            s = w.state;
            const t = s.tick;
            const p = s.player!;
            if (p.isDead) throw new Error(`died at the spiders at tick ${t} (phase ${phase})`);
            if (t - t0 > o.maxTicks) throw new Error(`cannon session: over ${o.maxTicks} ticks in phase ${phase}`);

            const next = o.phaseOf(s);
            if (next === null || o.stop?.(s, fireTick)) {
                closeRow(s);
                res.end = next === null ? 'done' : 'stopped';
                break;
            }
            if (next !== phase) {
                closeRow(s);
                log('phase', { from: phase, to: next, tick: t, ranged: baseLevel(s, 'Ranged'), defence: baseLevel(s, 'Defence'), hitpoints: baseLevel(s, 'Hitpoints') });
                phase = next;
                spec = specFor(phase, o);
                flick.setPrayers(spec.prayers);
                target = null;
            }

            // ---- observe
            keeper.observe(s);
            if (keeper.decayed) throw new Error('the cannon decayed or was destroyed: Nulodion replaces it for its owner');
            if (chat.next(s).some(m => POISONED.test(m))) mem.poisoned = true;
            for (const e of s.combatEvents ?? []) {
                const k = `${e.tick}:${e.observationId ?? ''}:${e.type}:${e.damage}:${e.sourceIndex}:${e.targetIndex}`;
                if (seenHits.has(k)) continue;
                seenHits.add(k);
                if (e.type === 'damage_dealt' && e.targetType === 'npc' && e.targetIndex === target) lastDealt = Math.max(lastDealt, e.tick);
            }
            if (seenHits.size > 2000) seenHits.clear();
            if (p.hp < lastHp) res.damageTaken += lastHp - p.hp;
            lastHp = p.hp;
            res.minHp = Math.min(res.minHp, p.hp);
            const pts = s.prayers?.prayerPoints ?? 0;
            res.prayer.min = Math.min(res.prayer.min, pts);

            let packets = 0;
            const cannon = assembledCannon(s);
            // A top-up walking back to the cannon: every button and attack would cancel it, the flick included.
            const walking = keeper.holding(s) && !!cannon && !besideCannon(s, cannon);
            const plan = walking ? null : flick.plan(s);
            for (const pr of plan?.toggles ?? []) {
                packets++;
                void sdk.sendTogglePrayer(pr);
            }

            // ---- a level-up (or any continue page), dismissed on the tick it shows
            let continued = false;
            const d = s.dialog;
            if (d.isOpen && !d.isWaiting && classifyPage(d) === 'continue' && packets < 5) {
                const key = d.pageId ?? `t${t}`;
                if (!lastContinue || lastContinue.key !== key || t - lastContinue.tick >= 3) {
                    if (levelUp(s)) res.levelUps++;
                    lastContinue = { key, tick: t };
                    packets++;
                    continued = true;
                    void clickContinue(sdk);
                }
            }

            // ---- a sip or a bite, on the flick's consume tick
            let consumedNow = false;
            if (plan?.consume && t - lastConsume >= 3 && packets < 5) {
                const c = chooseConsume(s, spec, mem, o.consume);
                if (c) {
                    packets++;
                    void sdk.sendUseItem(c.item.slot, opIndex(c.item, /^(eat|drink)$/i) ?? 1);
                    flick.consumed(t);
                    noteConsume(mem, c.kind, t);
                    lastConsume = t;
                    consumedNow = true;
                    consumes[c.kind] = (consumes[c.kind] ?? 0) + 1;
                }
            }

            // ---- the tick's one interaction: pick-up, gear, a cannon click, or the attack
            let interaction = false;
            const free = !!plan?.free && t > lastConsume + 2 && packets < 5;
            if (free && !spec.cannon && placedCannon(s) && t - pickUpSent >= 4) {
                const pl = placedCannon(s)!;
                void sdk.sendInteractLoc(pl.x, pl.z, pl.id, opIndex(pl, /^pick-up$/i) ?? 2);
                pickUpSent = t;
                packets++;
                interaction = true;
            }
            if (free && !interaction && t - lastGear >= 2) {
                const g = gearClick(s, spec);
                if (g) {
                    lastGear = t;
                    packets++;
                    if (g.kind === 'wield') void sdk.sendUseItem(g.item.slot, g.op);
                    else void sdk.sendSetCombatStyle(g.index);
                    reattackAt = t + 1; // each of these clears the attack
                } else if (retaliate !== spec.retaliate && (await setRetaliate(spec.retaliate)).presses > 0) {
                    // Awaited to its confirmation (a tick or two), so the button never shares a tick with a
                    // cannon click; it stopped the attack, which the next tick sends again.
                    lastGear = t;
                    target = null;
                    continue;
                }
            }
            if (free && !interaction && spec.cannon && packets < 5) {
                const click = keeper.want(s, cannon);
                if (click) {
                    keeper.send(sdk, click, s, cannon);
                    packets++;
                    interaction = true;
                }
            }
            if (spec.attack && !interaction && !keeper.holding(s) && packets < 5) {
                const prevTarget: number | null = target;
                const n = pickTarget(s, anchor(), target);
                target = n?.index ?? null;
                const inCombat = p.combat?.inCombat === true;
                const want =
                    (plan?.attack === true && !consumedNow) ||
                    continued ||
                    (t > lastConsume && t <= lastConsume + REATTACK_AFTER_CONSUME) ||
                    t === reattackAt ||
                    target !== prevTarget ||
                    (!inCombat && t - lastAttack >= 2) ||
                    (t - lastDealt > (o.stallTicks ?? 8) && t - lastAttack > 4);
                if (n && want) {
                    if (target !== prevTarget) lastDealt = t;
                    packets++;
                    lastAttack = t;
                    res.attacks++;
                    void sdk.sendInteractNpc(n.index, opIndex(n, /^attack$/i) ?? 2);
                }
            }
            if (packets > 5) res.overBudget++;
        }
    } finally {
        // Off before the pick-up and before the next step, however the session ended.
        if (retaliate === true) await setRetaliate(false);
    }

    // ---- wrap-up: prayers off, the cannon picked up
    for (const pr of flick.allOff(s)) void sdk.sendTogglePrayer(pr);
    let pickUpTicks = 0;
    if ((o.pickUp ?? true) && placedCannon(sdk.getState())) {
        const r = await pickUpCannon(sdk);
        if (!r.ok) throw new Error(`cannon pick-up: ${r.reason}`);
        pickUpTicks = r.ticks;
    }
    const sEnd = sdk.getState()!;
    Object.assign(res, {
        endTick: s.tick, ticks: s.tick - t0, pickUpTicks, bursts: flick.bursts, restores: flick.restores, reloads: keeper.reloads, refires: keeper.refires,
        dryEvents: keeper.dryEvents,
        // Fired balls: what left the inventory, less what a pick-up returned (a left-placed cannon keeps up to 30).
        ballsUsed: ballsAtStart - ballsHeld(sEnd),
        arrowsUsed: arrowsAtStart - arrows(sEnd),
    });
    res.prayer.end = sEnd.prayers?.prayerPoints ?? 0;
    log('session end', { ...res, phases: res.phases.map(r => `${r.phase} ${r.ticks}`) });
    return res;
}

// ------------------------------------------------------------------ steps

export interface RangedOptions extends SpecOptions {
    /** S14's target (default 50: the magic shortbow in S15). */
    s14To?: number;
    /**
     * S14's Attack floor (default 99: the cannon rolls the wielded scimitar's accuracy, and the run
     * reaches S14 at Attack 99). Only the twin rehearsal's S14 substitution lowers it.
     */
    s14MinAttack?: number;
    /** S27's thresholds (default Defence 99, the bow from Ranged 70, Ranged 99, Hitpoints 99). */
    finish?: Partial<FinishThresholds>;
    site?: { x: number; z: number; level: number };
    /** Bursts every this many ticks (default 4; 3 when the relay drives the tab). */
    flickEvery?: number;
    /** Cannonballs a step must start with (default S14 100, S27 1,200: CANNON_HANDOFF). */
    minBalls?: { s14?: number; s27?: number };
    /** Rune arrows S27 must start with below Ranged 99 (default 550: 0.32 a tick measured over the ~1,700-tick bow phase). */
    minArrows?: number;
    /** Eat below this (default S14 12, rs/56's sessions; S27 30, an emergency only: the 12 sharks are S17's). */
    eatBelow?: { s14?: number; s27?: number };
    /** Pick the cannon up at the end of each step (default true). */
    pickUp?: { s14?: boolean; s27?: boolean };
    log?: (line: string, data?: Record<string, unknown>) => void;
    [k: string]: unknown;
}

const nearSite = (s: BotWorldState, site: { x: number; z: number; level: number }) => {
    const p = pos(s);
    return p.level === site.level && chebyshev(p, site) <= SITE_RADIUS;
};

function cannonReason(s: BotWorldState, minBalls: number): string | null {
    if (!hasCannonSet(s) && !placedCannon(s)) return 'no cannon set in the inventory and none placed here (the cannon holder hands it over, H11/H23)';
    if (ballsHeld(s) < minBalls) return `${ballsHeld(s)} cannonballs, the step needs ${minBalls}`;
    return null;
}

function prayerReason(s: BotWorldState, prayers: PrayerName[]): string | null {
    const lvl = baseLevel(s, 'Prayer');
    const low = prayers.filter(p => lvl < (PRAYER_LEVEL[p] ?? 1));
    return low.length ? `Prayer ${lvl} is too low for ${low.join(', ')}` : null;
}

/** The worn shield's equipment slot (`^wearpos_lhand`, equip.constant), which the magic shortbow also takes (bows.obj `wearpos2=lefthand`). */
export const LEFT_HAND_SLOT = 5;
const VIAL = /^vial$/i;

/** Inventory items outside the module's own list: the cannon and its balls, the weapons and arrows, sharks and potions. */
export function otherItems(s: BotWorldState, scimitar: RegExp = SCIMITAR): string[] {
    const own = [CANNONBALL, scimitar, BOW, ARROWS, SHARK, VIAL, ...Object.values(POTION)];
    const part = (name: string) => CANNON_PARTS.some(p => p.toLowerCase() === name.toLowerCase());
    return s.inventory.filter(i => !part(i.name) && !own.some(re => re.test(i.name))).map(i => i.name);
}

/**
 * Free slots the step takes into the pack beyond what it holds. A cannon set held is set up, which
 * frees the 4 slots its pick-up retakes; a cannon already placed needs PICKUP_FREE_SLOTS for the
 * pick-up (cannon_setup.rs2). Wielding the two-handed bow puts a worn shield into the pack, less
 * the slot the held rune arrows free going to the quiver.
 */
export function slotNeed(s: BotWorldState, o: { pickUp: boolean; bowAhead: boolean }): { need: number; why: string[] } {
    const why: string[] = [];
    let need = 0;
    if (o.pickUp && !hasCannonSet(s) && placedCannon(s)) {
        need += PICKUP_FREE_SLOTS;
        why.push(`${PICKUP_FREE_SLOTS} to pick up the placed cannon`);
    }
    const shield = s.equipment.find(i => i.slot === LEFT_HAND_SLOT);
    if (o.bowAhead && shield && !worn(s, BOW) && invCount(s, ARROWS) === 0) {
        need += 1;
        why.push(`1 for the ${shield.name} the magic shortbow takes off`);
    }
    return { need, why };
}

function slotReason(s: BotWorldState, o: { pickUp: boolean; bowAhead: boolean; scimitar?: RegExp }): string | null {
    const { need, why } = slotNeed(s, o);
    if (freeSlots(s) >= need) return null;
    const other = otherItems(s, o.scimitar);
    return `${other.length} other items (${[...new Set(other)].join(', ')}): need ${need} free slots (${why.join('; ')}), ${freeSlots(s)} free`;
}

function held(s: BotWorldState, re: RegExp): boolean {
    return invCount(s, re) > 0 || worn(s, re) !== null;
}

function arrows(s: BotWorldState): number {
    return invCount(s, ARROWS) + (worn(s, ARROWS)?.count ?? 0);
}

/** S14's session: the cannon alone until Ranged `s14To` base. The step runs exactly this; the lab measures it. */
export function cannonSessionOptions(opts: RangedOptions = {}): SessionOptions {
    const to = opts.s14To ?? 50;
    return {
        ...opts,
        phaseOf: s => (baseLevel(s, 'Ranged') >= to ? null : 'cannon'),
        site: opts.site ?? SPIDERS,
        consume: { eatBelow: opts.eatBelow?.s14 ?? 12, antipoison: 'first-poison' },
        pickUp: opts.pickUp?.s14 ?? true,
        maxTicks: 600,
    };
}

/** S27's session: phases by `finish` thresholds. The step runs exactly this; the lab narrows `phaseOf` and adds `stop`. */
export function combatFinishOptions(opts: RangedOptions = {}): SessionOptions {
    const t: FinishThresholds = { ...FINISH, ...(opts.finish ?? {}) };
    return {
        ...opts,
        phaseOf: s => phaseFor(s, t),
        site: opts.site ?? SPIDERS,
        consume: { eatBelow: opts.eatBelow?.s27 ?? 30, antipoison: 'proactive' },
        pickUp: opts.pickUp?.s27 ?? true,
        maxTicks: 4000,
    };
}

/**
 * The session's result as a 0-tick note row named `${step} (session)`, so a chain run's tick log
 * splits the step into set-up, firing and pick-up with its reloads and balls used. A caller without
 * a tick log (a lab script driving the step by its sdk alone) gets none.
 */
export function noteSession(ctx: Partial<Pick<StepContext<unknown>, 'log' | 'session'>>, step: string, r: SessionResult): void {
    if (!ctx.log || !ctx.session) return;
    const fired = r.endTick - r.pickUpTicks - r.fireTick;
    ctx.log.append({
        v: 1, kind: 'note', runId: ctx.log.runId, account: ctx.session.name, sessionId: ctx.session.sessionId, step: `${step} (session)`,
        startTick: r.startTick, endTick: r.endTick, ticks: 0, wallMs: 0, ok: r.end === 'done', meta: { ...r, firingTicks: fired }, tickMs: tickMs(), at: new Date().toISOString(),
    });
}

export function cannonSessionStep(opts: RangedOptions = {}): Step<any> {
    const to = opts.s14To ?? 50;
    const site = opts.site ?? SPIDERS;
    const minBalls = opts.minBalls?.s14 ?? 100;
    const prayers = specFor('cannon', opts).prayers;
    const done = (s: BotWorldState) => baseLevel(s, 'Ranged') >= to;
    // The pick-up is owed where it runs: S14's own cannon still placed at the spiders, not yet held.
    // S27 places a cannon at the same site at about the same Ranged, after Monkey Madness (S15).
    const owesPickUp = (s: BotWorldState) => (opts.pickUp?.s14 ?? true) && !hasCannonSet(s) && placedCannon(s) !== null && nearSite(s, site) && !questDone('mm')(s);
    const run = async (ctx: StepContext<any>) => {
        noteSession(ctx, 'S14 cannon session', await runSession(ctx.sdk as RangedSdk, cannonSessionOptions(opts)));
    };
    return {
        name: 'S14 cannon session',
        preconditions: s => {
            if (!s.inGame || !s.player) return 'not in game';
            if (!questDone('mcannon')(s)) return 'Dwarf Cannon is not complete (the quest tab does not show it complete)';
            if (!nearSite(s, site)) return `not at the poison spiders (at ${pos(s).x},${pos(s).z}; the leg T13-14 ends at ${site.x},${site.z})`;
            const minAttack = opts.s14MinAttack ?? 99;
            if (baseLevel(s, 'Attack') < minAttack) return `Attack ${baseLevel(s, 'Attack')}: the cannon's accuracy is the scimitar's at Attack ${minAttack}`;
            if (!held(s, opts.scimitar ?? SCIMITAR)) return `no ${(opts.scimitar ?? SCIMITAR).source.replace(/[\^$]/g, '')}`;
            return cannonReason(s, minBalls) ?? prayerReason(s, prayers) ?? slotReason(s, { pickUp: opts.pickUp?.s14 ?? true, bowAhead: false, scimitar: opts.scimitar }) ?? true;
        },
        run,
        resume: run,
        postconditions: s => {
            if (!done(s)) return `Ranged ${baseLevel(s, 'Ranged')} base, the step ends at ${to}`;
            if ((opts.pickUp?.s14 ?? true) && !hasCannonSet(s)) return 'the cannon was not picked up';
            return true;
        },
        logoutSafe: false,
        done: o => done(o.state) && !owesPickUp(o.state),
        inProgress: o => owesPickUp(o.state) || (!done(o.state) && nearSite(o.state, site) && (assembledCannon(o.state) !== null || xpOf(o.state, 'Ranged') > 0)),
    };
}

export function combatFinishStep(opts: RangedOptions = {}): Step<any> {
    const t: FinishThresholds = { ...FINISH, ...(opts.finish ?? {}) };
    const site = opts.site ?? SPIDERS;
    const minBalls = opts.minBalls?.s27 ?? CANNON_HANDOFF.S27.in.cannonballs;
    const minArrows = opts.minArrows ?? 550;
    const done = (s: BotWorldState) => phaseFor(s, t) === null;
    const run = async (ctx: StepContext<any>) => {
        noteSession(ctx, 'S27 combat finish', await runSession(ctx.sdk as RangedSdk, combatFinishOptions(opts)));
    };
    return {
        name: 'S27 combat finish',
        preconditions: s => {
            if (!s.inGame || !s.player) return 'not in game';
            if (!questDone('mcannon')(s)) return 'Dwarf Cannon is not complete (the quest tab does not show it complete)';
            if (!nearSite(s, site)) return `not at the poison spiders (at ${pos(s).x},${pos(s).z}; the leg T26-27 ends at ${site.x},${site.z})`;
            if (!held(s, opts.scimitar ?? SCIMITAR)) return `no ${(opts.scimitar ?? SCIMITAR).source.replace(/[\^$]/g, '')}`;
            if (baseLevel(s, 'Ranged') < t.ranged) {
                if (!held(s, BOW)) return 'no magic shortbow (H12)';
                if (arrows(s) < minArrows) return `${arrows(s)} rune arrows, the bow phase needs ${minArrows}`;
                if (t.bowFrom < 50) return `finish.bowFrom ${t.bowFrom}: the magic shortbow needs Ranged 50`;
            }
            const bowAhead = baseLevel(s, 'Ranged') < t.ranged;
            return cannonReason(s, minBalls) ?? prayerReason(s, [PFM, US, IR]) ?? slotReason(s, { pickUp: opts.pickUp?.s27 ?? true, bowAhead, scimitar: opts.scimitar }) ?? true;
        },
        run,
        resume: run,
        postconditions: s => {
            if (!done(s)) return `Ranged ${baseLevel(s, 'Ranged')}, Defence ${baseLevel(s, 'Defence')}, Hitpoints ${baseLevel(s, 'Hitpoints')}: all three end at 99`;
            if ((opts.pickUp?.s27 ?? true) && !hasCannonSet(s) && !placedCannon(s)) return 'the cannon was neither picked up nor left placed';
            return true;
        },
        logoutSafe: false,
        done: o => done(o.state),
        inProgress: o => !done(o.state) && (baseLevel(o.state, 'Ranged') >= S27_STARTED_RANGED || baseLevel(o.state, 'Defence') >= t.defence || (nearSite(o.state, site) && assembledCannon(o.state) !== null)),
    };
}

/** The step-module convention: `which` picks one group (the run chains S14 and S27 at their own places). */
export function steps(opts: RangedOptions & { which?: 'cannonSession' | 'combatFinish' } = {}): Step<any>[] {
    if (opts.which === 'cannonSession') return [cannonSessionStep(opts)];
    if (opts.which === 'combatFinish') return [combatFinishStep(opts)];
    return [cannonSessionStep(opts), combatFinishStep(opts)];
}

export const cannonSession = (opts: RangedOptions = {}) => [cannonSessionStep(opts)];
export const combatFinish = (opts: RangedOptions = {}) => [combatFinishStep(opts)];
