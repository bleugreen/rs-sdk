// Combat: one fight loop for every quest fight, and the prayer / potion / food
// upkeep it shares with loops that are not fights (a cannon session).
//
// The loop reads one state per tick and fires its sends without awaiting each
// other (speedrun/README.md, "fire, then confirm once"). Two things it must get
// right, both found in the quest-route lab:
//
// - At 25x xp a level-up box opens every few kills and interrupts combat. It
//   is told apart from quest dialogue by the page's own words (rs/12), and is
//   dismissed on the tick it shows with the attack on the same target re-sent
//   behind it, so the fight neither stalls nor drifts to another NPC.
// - Under a protect prayer the NPC's blocked swings need not trigger
//   auto-retaliate, so "in combat" can mean only that we are being attacked.
//   The loop re-attacks when it has dealt no damage for `stallTicks` (rs/56).
// - A target the client cannot route to (behind a closed gate or door) draws sends that land
//   nowhere: the browser dispatches the op alone ('unrouted - ap-range attempt', `routed: false`
//   on the send's result), lite refuses it (cant_reach), and the server acts only when the player
//   already stands in range with line of sight. The live S12:H of 10-24 re-sent Fire Blast at a
//   caged Khazard Scorpion for ~150 ticks until the prayer ran out (rs/693). Such a send, or
//   `stuckSends` re-sends with no engine effect at all, sends the player to a tile in range of the
//   target's live tile (approach.ts approachInRange); when there is none, the fight waits
//   `unreachableTicks` for one and ends 'unreachable', naming the target's tile.

import type { BotSDK } from '../../sdk/index';
import { PRAYER_INDICES, type BotWorldState, type InventoryItem, type NearbyNpc, type PrayerName } from '../../sdk/types';
import { approachInRange, npcTile, unroutedReply, type InRangeOptions } from './approach';
import { clickContinue } from './dialogue';
import { matchesItem, type ItemPattern } from './items';
import { levelUpChain } from './levelup';
import { scaleUse, type RuneName, type RuneUse, type TravelSdk } from './travel';
import { waitUntil, type Pred, type StateSource } from './wait';
import { npcByIndex, opIndex, pos, waitForNpc, type NamePattern } from './world';

export type UpkeepSdk = StateSource & Pick<BotSDK, 'sendUseItem' | 'sendTogglePrayer'>;
export type CombatSdk = UpkeepSdk & Pick<BotSDK, 'sendInteractNpc' | 'sendSpellOnNpc' | 'sendClickDialog' | 'clickDialogByText'>;

/**
 * Standard-spellbook combat spells the route casts: interface component, Magic level, the rune
 * each cast uses up, and air and fire runes per cast (a worn staff of fire supplies the fire).
 */
export const COMBAT_SPELLS = {
    fire_bolt: { component: 1169, magic: 35, rune: /^Chaos rune$/i, runeName: 'chaos', air: 3, fire: 4 },
    fire_blast: { component: 1181, magic: 59, rune: /^Death rune$/i, runeName: 'death', air: 4, fire: 5 },
} as const;
export type CombatSpell = keyof typeof COMBAT_SPELLS;

/** `spell`'s runes for `casts` casts as a rune use (lib/travel.ts RuneUse), less the element `staff` supplies. */
export function combatSpellUse(spell: CombatSpell, casts: number, staff?: string): RuneUse {
    const sp = COMBAT_SPELLS[spell];
    const one: Partial<Record<RuneName, number>> = { [`${sp.runeName}rune` as RuneName]: 1, airrune: sp.air, firerune: sp.fire };
    return scaleUse(one, casts, staff);
}

export function prayerActive(s: BotWorldState, prayer: PrayerName): boolean {
    return s.prayers?.activePrayers?.[PRAYER_INDICES[prayer]] === true;
}

/** Prayer level each prayer needs (the 2004 prayer book, in PRAYER_INDICES order: 1, 4, 7, ... 43). */
export const PRAYER_LEVELS: Readonly<Record<PrayerName, number>> = Object.fromEntries(
    (Object.entries(PRAYER_INDICES) as Array<[PrayerName, number]>).map(([name, i]) => [name, 1 + 3 * i])
) as Record<PrayerName, number>;

export interface SetPrayerOptions {
    /** Give up after this many ticks (default 10). */
    maxTicks?: number;
    /** Re-toggle when the published state has not changed this many ticks after a toggle (default 3; a toggle shows in 1-2). */
    retryAfter?: number;
    /** At most this many re-toggles (default 2). */
    maxRetries?: number;
}

export interface SetPrayerResult {
    ok: boolean;
    /** Call to the first state showing the prayer as asked (0 when it already was). */
    ticks: number;
    toggles: number;
    reason?: 'level' | 'no points' | 'timeout';
}

/**
 * Turn a prayer on or off outside a fight, confirmed from the published prayer
 * state. Already as asked: no click. On needs the prayer level and some points,
 * checked before anything is sent. A toggle that has not shown after
 * `retryAfter` ticks is sent again; never sooner, since a second toggle that
 * lands behind a late first one turns the prayer back.
 */
export async function setPrayer(sdk: UpkeepSdk, prayer: PrayerName, on: boolean, opts: SetPrayerOptions = {}): Promise<SetPrayerResult> {
    const s0 = sdk.getState();
    if (!s0) throw new Error('setPrayer: no state');
    const t0 = s0.tick;
    if (prayerActive(s0, prayer) === on) return { ok: true, ticks: 0, toggles: 0 };
    if (on && (s0.prayers?.prayerLevel ?? 0) < PRAYER_LEVELS[prayer]) return { ok: false, ticks: 0, toggles: 0, reason: 'level' };
    if (on && (s0.prayers?.prayerPoints ?? 0) <= 0) return { ok: false, ticks: 0, toggles: 0, reason: 'no points' };
    const retryAfter = opts.retryAfter ?? 3;
    const maxRetries = opts.maxRetries ?? 2;
    let toggles = 1;
    let sent = t0;
    void sdk.sendTogglePrayer(prayer);
    const r = await waitUntil(
        sdk,
        s => {
            if (prayerActive(s, prayer) === on) return true;
            if (on && (s.prayers?.prayerPoints ?? 0) <= 0) return false;
            if (s.tick - sent >= retryAfter && toggles <= maxRetries) {
                sent = s.tick;
                toggles++;
                void sdk.sendTogglePrayer(prayer);
            }
            return false;
        },
        { maxTicks: opts.maxTicks ?? 10 }
    );
    return { ok: r.ok, ticks: r.tick - t0, toggles, ...(r.ok ? {} : { reason: on && (r.state?.prayers?.prayerPoints ?? 0) <= 0 ? ('no points' as const) : ('timeout' as const) }) };
}

/** Prayer potion doses held: a "Prayer potion(3)" counts 3. */
export function prayerDoses(s: BotWorldState): number {
    return s.inventory.reduce((a, i) => {
        const m = /^Prayer potion\((\d)\)$/i.exec(i.name);
        return m ? a + i.count * Number(m[1]) : a;
    }, 0);
}

export interface UpkeepOptions {
    /** Keep this prayer on while there are points. */
    prayer?: PrayerName;
    /** Drink a Prayer potion when points fall below this (default 8; only with `prayer`). */
    drinkBelow?: number;
    /** Eat when hitpoints fall below this. No eating unless set. */
    eatBelow?: number;
    /** What to eat (default: any inventory item that offers Eat). */
    food?: ItemPattern;
}

const firstOp = (i: InventoryItem, re: RegExp) => i.optionsWithIndex.find(o => re.test(o.text))?.opIndex;

/**
 * Prayer, potion and food upkeep, one `step` per tick. Clicks are spaced 3
 * ticks apart per kind (an eat or a drink takes that long to land), and a
 * prayer toggle 2, so an unconfirmed click is not repeated in between.
 */
export class Upkeep {
    prayerUsed = 0;
    eats = 0;
    drinks = 0;
    private lastPts: number | null = null;
    private lastToggle = -Infinity;
    private lastDrink = -Infinity;
    private lastEat = -Infinity;

    constructor(private sdk: UpkeepSdk, private o: UpkeepOptions) {}

    /** One tick of upkeep. True when it ate or drank (melee wants the attack re-sent after that). */
    step(s: BotWorldState): boolean {
        const o = this.o;
        let consumed = false;
        const pts = s.prayers?.prayerPoints ?? 0;
        if (this.lastPts !== null && pts < this.lastPts) this.prayerUsed += this.lastPts - pts;
        this.lastPts = pts;
        if (o.prayer) {
            if (pts > 0 && !prayerActive(s, o.prayer) && s.tick - this.lastToggle >= 2) {
                this.lastToggle = s.tick;
                void this.sdk.sendTogglePrayer(o.prayer);
            }
            const pot = s.inventory.find(i => /^Prayer potion/i.test(i.name));
            if (pot && pts < (o.drinkBelow ?? 8) && s.tick - this.lastDrink >= 3) {
                this.lastDrink = s.tick;
                this.drinks++;
                consumed = true;
                void this.sdk.sendUseItem(pot.slot, firstOp(pot, /^drink$/i) ?? 1);
            }
        }
        const hp = s.player?.hp;
        if (o.eatBelow !== undefined && hp !== undefined && hp < o.eatBelow && s.tick - this.lastEat >= 3) {
            const f = s.inventory.find(i => (o.food !== undefined ? matchesItem(i, o.food) : firstOp(i, /^eat$/i) !== undefined));
            if (f) {
                this.lastEat = s.tick;
                this.eats++;
                consumed = true;
                void this.sdk.sendUseItem(f.slot, firstOp(f, /^eat$/i) ?? 1);
            }
        }
        return consumed;
    }
}

export interface FightOptions extends UpkeepOptions {
    /** Send the attack (default true). False waits out a fight the NPC started, leaving it to auto-retaliate. */
    attack?: boolean;
    /** Cast this spell component on the target instead of meleeing, every `castEvery` ticks (default 2; the cast delay keeps the real rate). */
    spell?: number;
    castEvery?: number;
    /** Give up after this many ticks (default 600). */
    maxTicks?: number;
    /** Ticks to wait for the target to come into view (default 10). */
    findTicks?: number;
    /** Ends the fight when it holds, checked every tick (a death teleport, a cutscene). */
    done?: Pred;
    /** False for scripted bosses: ignore kill/hp/disappearance and wait for done, quest dialogue, death or timeout. */
    endOnTargetDeath?: boolean;
    /** A dialogue other than a level-up: end the fight (default; the quest's death hook) or click it through. */
    onDialog?: 'stop' | 'continue';
    /** Melee: re-send the attack after this many ticks out of combat (default 4). */
    reattackAfter?: number;
    /** With `prayer` on: re-attack after this many ticks without dealing damage (default 8). */
    stallTicks?: number;
    /** Fight-specific moves, once per tick before the attack decision (a weapon swap at low target hp). Return true if it acted, to re-send the attack. */
    onTick?: (s: BotWorldState, target: NearbyNpc | null) => boolean | void | Promise<boolean | void>;
    /**
     * Re-sends with no engine effect (no hitsplat between the player and the target, no rune or xp
     * spent, no step taken) that send the player to the target (default 4). An unrouted or
     * cant_reach send result does so once the target has been untouched 6 ticks.
     */
    stuckSends?: number;
    /** Approaches to the target's live tile before the wait (default 3: the first and 2 re-finds). */
    approaches?: number;
    /** Ticks waited, still sending, for the target to become reachable after the approaches, before 'unreachable' (default 15). */
    unreachableTicks?: number;
    /** The range the approach puts the player in (default 10 for a spell, 1 for melee). */
    range?: number;
    /** For the approach (approach.ts InRangeOptions: the run's bot, interrupts, the sight check). */
    approach?: InRangeOptions;
}

export type FightEnd = 'killed' | 'gone' | 'done' | 'dialog' | 'died' | 'timeout' | 'no target' | 'unreachable';

const xpTotal = (s: BotWorldState) => (s.skills ?? []).reduce((a, k) => a + (k.experience ?? 0), 0);
const runesHeld = (s: BotWorldState) => s.inventory.reduce((a, i) => (/ rune$/i.test(i.name) ? a + i.count : a), 0);

export interface FightResult {
    /** killed, gone, done and dialog are ok; died, timeout, no target and unreachable are not. */
    ok: boolean;
    end: FightEnd;
    /** Why an 'unreachable' fight ended: the target and its tile. */
    reason?: string;
    /** Approaches to the target's live tile (approachInRange calls). */
    approaches: number;
    /** Call to end. */
    ticks: number;
    /** Call to the first hitsplat between the player and the target, either way; -1 if none. */
    engaged: number;
    dealt: number;
    taken: number;
    hits: number;
    attacks: number;
    levelUps: number;
    eats: number;
    drinks: number;
    prayerUsed: number;
    prayerDoses: number;
    minHp: number;
    died: boolean;
    targetIndex: number;
}

/**
 * Fight one NPC to the end: the nearest match for `target` (or that NPC
 * itself), tracked by world index so a second spawn is never counted.
 */
export async function fight(sdk: CombatSdk, target: NamePattern | NearbyNpc, o: FightOptions = {}): Promise<FightResult> {
    const s0 = sdk.getState();
    if (!s0) throw new Error('fight: no state');
    const t0 = s0.tick;
    const npc0 = typeof target === 'object' && 'index' in target ? target : await waitForNpc(sdk, target, o.findTicks ?? 10);
    const upkeep = new Upkeep(sdk, o);
    const doses0 = prayerDoses(s0);
    const r: FightResult = {
        ok: false, end: 'no target', approaches: 0, ticks: 0, engaged: -1, dealt: 0, taken: 0, hits: 0, attacks: 0, levelUps: 0,
        eats: 0, drinks: 0, prayerUsed: 0, prayerDoses: 0, minHp: s0.player?.hp ?? 0, died: false, targetIndex: npc0?.index ?? -1,
    };
    const end = (s: BotWorldState, e: FightEnd): FightResult => {
        r.end = e;
        r.ok = e === 'killed' || e === 'gone' || e === 'done' || e === 'dialog';
        r.died = e === 'died';
        r.ticks = s.tick - t0;
        r.eats = upkeep.eats;
        r.drinks = upkeep.drinks;
        r.prayerUsed = upkeep.prayerUsed;
        r.prayerDoses = doses0 - prayerDoses(s);
        return r;
    };
    if (!npc0) return end(sdk.getState() ?? s0, 'no target');
    const idx = npc0.index;
    let npc: NearbyNpc | null = npc0;
    const meleeOp = opIndex(npc0, /^attack$/i) ?? 2;
    let lastAttack = -Infinity;
    let lastDealt = t0;
    // The stuck-target watch: the last tick with any engine effect, the sends since, and whether a
    // send's result said it reached no tile.
    let lastEffect = t0;
    let idleSends = 0;
    let unrouted = false;
    let waitFrom = -1;
    let refusal: string | undefined;
    let lastPos = pos(s0);
    let lastXp = xpTotal(s0);
    let lastRunes = runesHeld(s0);
    const travel = typeof (sdk as Partial<TravelSdk>).findPath === 'function' && typeof (sdk as Partial<TravelSdk>).sendWalk === 'function' ? (sdk as unknown as TravelSdk) : null;
    const range = o.range ?? (o.spell !== undefined ? 10 : 1);
    const attack = (tick: number) => {
        lastAttack = tick;
        r.attacks++;
        idleSends++;
        const sent = o.spell !== undefined ? sdk.sendSpellOnNpc(idx, o.spell) : sdk.sendInteractNpc(idx, meleeOp);
        void Promise.resolve(sent).then(res => { if (unroutedReply(res)) unrouted = true; }, () => {});
    };
    const attacking = o.attack !== false;
    if (attacking) attack(t0);

    const levelUp = levelUpChain();
    let answered: { key: string; tick: number } | null = null;
    const seen = new Set<string>();
    let missing = 0;
    let s = s0;
    for (;;) {
        const prev = s.tick;
        const w = await waitUntil(sdk, st => st.tick > prev, { maxTicks: 50 });
        if (!w.ok) throw new Error(`fight: the client stopped publishing at tick ${prev}`);
        s = w.state;
        if (s.tick - t0 > (o.maxTicks ?? 600)) return end(s, 'timeout');
        let effect = false;
        for (const e of s.combatEvents ?? []) {
            const k = `${e.tick}:${e.observationId ?? ''}:${e.type}:${e.damage}:${e.sourceIndex}:${e.targetIndex}`;
            if (e.tick < t0 || seen.has(k)) continue;
            seen.add(k);
            if ((e.targetType === 'npc' && e.targetIndex === idx) || (e.sourceType === 'npc' && e.sourceIndex === idx)) effect = true;
            // Damage dealt counts only on the tracked target: a hit on another NPC
            // (multi-combat, a cannon) must not reset the protect-prayer stall timer.
            const onTarget = e.type === 'damage_dealt' && e.targetType === 'npc' && e.targetIndex === idx;
            const fromTarget = e.type === 'damage_taken' && e.sourceType === 'npc' && e.sourceIndex === idx;
            if (onTarget) {
                r.dealt += e.damage;
                r.hits++;
                lastDealt = e.tick;
            } else if (e.type === 'damage_taken') r.taken += e.damage;
            if ((onTarget || fromTarget) && r.engaged < 0) r.engaged = e.tick - t0;
        }
        const here = pos(s);
        const xp = xpTotal(s);
        const runes = runesHeld(s);
        if (here.x !== lastPos.x || here.z !== lastPos.z || xp > lastXp || runes < lastRunes) effect = true;
        lastPos = here;
        lastXp = xp;
        lastRunes = runes;
        if (effect) {
            lastEffect = s.tick;
            idleSends = 0;
            unrouted = false;
            waitFrom = -1;
        }
        if (s.player) r.minHp = Math.min(r.minHp, s.player.hp);
        if (s.player?.isDead) return end(s, 'died');
        if (o.done?.(s)) return end(s, 'done');
        npc = npcByIndex(s, idx);
        if (o.endOnTargetDeath !== false) {
            if ((s.combatEvents ?? []).some(e => e.type === 'kill' && e.tick >= t0 && e.targetIndex === idx)) return end(s, 'killed');
            if (npc?.hp === 0) return end(s, 'killed');
            // One tick of grace: the NPC list can drop an entry for a tick.
            if (!npc && ++missing >= 2) return end(s, r.dealt > 0 ? 'killed' : 'gone');
        }
        if (npc) missing = 0;

        const d = s.dialog;
        if (d.isOpen) {
            if (d.isWaiting) continue;
            const key = d.pageId ?? String(s.tick);
            const fresh = !answered || answered.key !== key || s.tick - answered.tick >= 3;
            if (levelUp(s)) {
                if (fresh) {
                    answered = { key, tick: s.tick };
                    r.levelUps++;
                    void clickContinue(sdk);
                    if (attacking && npc) attack(s.tick); // same tick, same target
                }
                continue;
            }
            if ((o.onDialog ?? 'stop') === 'stop') return end(s, 'dialog');
            if (fresh) {
                answered = { key, tick: s.tick };
                void clickContinue(sdk);
            }
            continue;
        }

        let resend = upkeep.step(s);
        if (o.onTick && (await o.onTick(s, npc))) resend = true;
        if (!attacking || !npc) continue;
        const idle = s.tick - lastEffect;
        if (waitFrom < 0 && ((unrouted && idle >= 6) || (idleSends >= (o.stuckSends ?? 4) && idle >= 8))) {
            if (travel && r.approaches < (o.approaches ?? 3)) {
                r.approaches++;
                const a = await approachInRange(travel, npc, range, { refinds: 0, ...o.approach });
                if (a.ok) {
                    s = sdk.getState() ?? s;
                    lastPos = pos(s);
                    lastEffect = s.tick;
                    idleSends = 0;
                    unrouted = false;
                    attack(s.tick);
                    continue;
                }
                refusal = a.reason;
                s = sdk.getState() ?? s;
            }
            waitFrom = s.tick;
        }
        if (waitFrom >= 0 && s.tick - waitFrom >= (o.unreachableTicks ?? 15)) {
            const t = npcTile(npc);
            r.reason = refusal ?? `${npc.name} untouched by ${r.approaches} approaches and ${s.tick - waitFrom} ticks' wait (at ${t.x},${t.z})`;
            return end(s, 'unreachable');
        }
        if (o.spell !== undefined) {
            if (resend || s.tick - lastAttack >= (o.castEvery ?? 2)) attack(s.tick);
            continue;
        }
        const inCombat = s.player?.combat?.inCombat === true;
        const stalled = o.prayer !== undefined && s.tick - lastDealt > (o.stallTicks ?? 8);
        if (resend || ((!inCombat || stalled) && s.tick - lastAttack > (o.reattackAfter ?? 4))) attack(s.tick);
    }
}
