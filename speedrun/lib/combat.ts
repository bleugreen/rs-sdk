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

import type { BotSDK } from '../../sdk/index';
import { PRAYER_INDICES, type BotWorldState, type InventoryItem, type NearbyNpc, type PrayerName } from '../../sdk/types';
import { clickContinue } from './dialogue';
import { matchesItem, type ItemPattern } from './items';
import { levelUpChain } from './levelup';
import { scaleUse, type RuneName, type RuneUse } from './travel';
import { waitUntil, type Pred, type StateSource } from './wait';
import { npcByIndex, opIndex, replyAfter, waitForNpc, type NamePattern } from './world';

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
    /** While true the prayer is neither switched on nor topped up (a contested fight's wait). */
    holdPrayer = false;
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
        if (o.prayer && !this.holdPrayer) {
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
     * Among the NPCs matching `target`, fight the one fighting the player (npcClaim): the nearest
     * until one shows, then switch to it. An "I'm already under attack!" reply marks the target as
     * not the attacker and re-picks. Off: the nearest, kept to the end. An NPC passed as `target`
     * is its own only candidate.
     */
    adoptHitter?: boolean;
    /**
     * Read the attack's refusal (ATTACK_REFUSALS) instead of re-sending through it: the refused
     * NPC is excluded and another picked. With none left, wait up to `waitTicks` for one to come
     * free, then end 'contested'. Off: the attack is re-sent on its cadence whatever the reply.
     */
    contested?: ContestedOptions;
}

export interface ContestedOptions {
    /**
     * Ticks to wait with every candidate refused. A protect prayer is switched off for the wait
     * while nothing attacks the player, and back on before the next attack.
     */
    waitTicks: number;
}

/** A player target as an NPC publishes it: StateCollector passes faceEntity raw, a player slot + 32768. */
const PLAYER_TARGET = 32768;
/** player_in_combat_check's window: an NPC hit in the last 8 ticks by another player refuses the rest. */
const LOCK_TICKS = 8;
/** The longest NPC attack range among the route's fights (quest_mm.npc mm_demon attackrange=10). */
const NPC_REACH = 10;

/**
 * The replies the content gives an attack it refuses, the same for melee, ranged and spells: melee
 * and ranged reach player_in_combat_check through player_combat_start (player_combat.rs2), a
 * combat spell through pvm_combat_spell_checks (player_magic.rs2), and the two quest demons'
 * opnpc2/apnpc2 refuse before either. The check applies in single-way areas only.
 */
export const ATTACK_REFUSALS = {
    /** Another player hit the NPC in the last 8 ticks. Lifts when their fight stops. */
    lock: /^Someone else is fighting that\.?$/i,
    /** A quest NPC spawned for another player (grandtree_black_demon.rs2, mm_demon.rs2). Never lifts. */
    notYours: /^(It's not after you|That is not your enemy)/i,
    /** An NPC other than this one attacked the player in the last 8 ticks. */
    underAttack: /^I'm already under attack/i,
} as const;

export type NpcClaim = 'ours' | 'others' | 'none';

/**
 * Whose fight an NPC is, from what the state publishes. The state carries no own player slot (both
 * clients hold it as selfSlot; StateCollector does not publish it), so facing the player is read as
 * facing a player slot that no visible other player holds, from within NPC_REACH (farther, it is a
 * player out of view). Another player's fight shows as that player's published combat target, or as
 * the NPC facing that player's slot. `hitBy` holds NPC
 * indices our damage_taken events name; the client fills that sourceIndex from the player's own
 * facing, so it confirms the NPC the player faces rather than naming an unseen attacker.
 */
export function npcClaim(s: BotWorldState, n: NearbyNpc, hitBy?: ReadonlySet<number>): NpcClaim {
    const others = s.nearbyPlayers ?? [];
    const slot = n.targetIndex >= PLAYER_TARGET ? n.targetIndex - PLAYER_TARGET : -1;
    if (slot >= 0 && !others.some(p => p.index === slot) && n.distance <= NPC_REACH) return 'ours';
    if (slot >= 0 || others.some(p => p.combatTargetType === 'npc' && p.combatTargetIndex === n.index)) return 'others';
    return hitBy?.has(n.index) ? 'ours' : 'none';
}

export type FightEnd = 'killed' | 'gone' | 'done' | 'dialog' | 'died' | 'timeout' | 'no target' | 'contested';

export interface FightResult {
    /** killed, gone, done and dialog are ok; died, timeout, no target and contested are not. */
    ok: boolean;
    end: FightEnd;
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
    /** The NPC fought last (after any switch). */
    targetIndex: number;
    /** NPC indices whose attack was refused, in order (contested). */
    refused: number[];
    /** Changes of target after the first (adoptHitter, contested). */
    switches: number;
    /** Ticks spent waiting with every candidate refused (contested). */
    waited: number;
}

interface Refusal {
    tick: number;
    lasting: boolean;
}

/**
 * Fight one NPC to the end: the nearest match for `target` (or that NPC
 * itself), tracked by world index so a second spawn is never counted.
 * `adoptHitter` and `contested` change which NPC that is on a shared world.
 */
export async function fight(sdk: CombatSdk, target: NamePattern | NearbyNpc, o: FightOptions = {}): Promise<FightResult> {
    const s0 = sdk.getState();
    if (!s0) throw new Error('fight: no state');
    const t0 = s0.tick;
    const contest = o.adoptHitter === true || o.contested !== undefined;
    const explicit = typeof target === 'object' && 'index' in target ? target : null;

    // Contention: who has hit us, which NPCs refused us, which one is not our attacker.
    const hitBy = new Set<number>();
    const refused = new Map<number, Refusal>();
    const notOurs = new Set<number>();
    const claimOf = (s: BotWorldState, n: NearbyNpc): NpcClaim => {
        const c = npcClaim(s, n, hitBy);
        return c === 'ours' && notOurs.has(n.index) ? 'none' : c;
    };
    const eligible = (s: BotWorldState, n: NearbyNpc): boolean => {
        if (n.hp === 0) return false;
        const no = refused.get(n.index);
        if (!no) return true;
        // A lock lifts once the other fight has stopped for the server's 8 ticks.
        return !no.lasting && s.tick - no.tick >= LOCK_TICKS && claimOf(s, n) !== 'others' && (n.lastCombatTick === null || s.tick - n.lastCombatTick >= LOCK_TICKS);
    };
    const rank = (s: BotWorldState, n: NearbyNpc): number => {
        if (!o.adoptHitter) return 0;
        const c = claimOf(s, n);
        return c === 'ours' ? 0 : c === 'none' ? 1 : 2;
    };
    const pick = (s: BotWorldState): NearbyNpc | null => {
        const all = s.nearbyNpcs.filter(n => (explicit ? n.index === explicit.index : matchesItem(n, target as NamePattern)) && eligible(s, n));
        return all.sort((a, b) => rank(s, a) - rank(s, b) || a.distance - b.distance)[0] ?? null;
    };

    let npc0: NearbyNpc | null;
    if (explicit) npc0 = explicit;
    else if (!contest) npc0 = await waitForNpc(sdk, target as NamePattern, o.findTicks ?? 10);
    else {
        const w = await waitUntil(sdk, s => pick(s) !== null, { maxTicks: o.findTicks ?? 10 });
        npc0 = w.ok ? pick(w.state) : null;
    }
    const upkeep = new Upkeep(sdk, o);
    const doses0 = prayerDoses(s0);
    const r: FightResult = {
        ok: false, end: 'no target', ticks: 0, engaged: -1, dealt: 0, taken: 0, hits: 0, attacks: 0, levelUps: 0,
        eats: 0, drinks: 0, prayerUsed: 0, prayerDoses: 0, minHp: s0.player?.hp ?? 0, died: false, targetIndex: npc0?.index ?? -1,
        refused: [], switches: 0, waited: 0,
    };
    let waitingSince: number | null = null;
    const end = (s: BotWorldState, e: FightEnd): FightResult => {
        r.end = e;
        r.ok = e === 'killed' || e === 'gone' || e === 'done' || e === 'dialog';
        r.died = e === 'died';
        r.ticks = s.tick - t0;
        r.eats = upkeep.eats;
        r.drinks = upkeep.drinks;
        r.prayerUsed = upkeep.prayerUsed;
        r.prayerDoses = doses0 - prayerDoses(s);
        if (waitingSince !== null) r.waited += s.tick - waitingSince;
        return r;
    };
    if (!npc0) return end(sdk.getState() ?? s0, 'no target');
    let idx = npc0.index;
    let npc: NearbyNpc | null = npc0;
    let meleeOp = opIndex(npc0, /^attack$/i) ?? 2;
    let lastAttack = -Infinity;
    let lastDealt = t0;
    const attack = (tick: number) => {
        lastAttack = tick;
        r.attacks++;
        void (o.spell !== undefined ? sdk.sendSpellOnNpc(idx, o.spell) : sdk.sendInteractNpc(idx, meleeOp));
    };
    const attacking = o.attack !== false;
    // The refusal replies to this target's attacks: taken just before its first attack (replyAfter).
    type Replies = Record<keyof typeof ATTACK_REFUSALS, ReturnType<typeof replyAfter>>;
    const listen = (): Replies => ({
        lock: replyAfter(sdk, ATTACK_REFUSALS.lock),
        notYours: replyAfter(sdk, ATTACK_REFUSALS.notYours),
        underAttack: replyAfter(sdk, ATTACK_REFUSALS.underAttack),
    });
    let replies: Replies | null = contest ? listen() : null;
    if (attacking) attack(t0);

    let engagedAt = t0;
    let dealtHere = 0;
    let lastSwitch = t0;
    let missing = 0;
    const engage = (n: NearbyNpc, tick: number) => {
        if (n.index !== idx) {
            r.switches++;
            lastSwitch = tick;
        }
        idx = n.index;
        r.targetIndex = idx;
        npc = n;
        meleeOp = opIndex(n, /^attack$/i) ?? 2;
        engagedAt = tick;
        dealtHere = 0;
        lastDealt = tick;
        missing = 0;
        replies = listen();
        if (attacking) attack(tick);
    };
    let lastHitOnUs = -Infinity;
    let prayerHeld = false;
    let lastPrayerOff = -Infinity;

    const levelUp = levelUpChain();
    let answered: { key: string; tick: number } | null = null;
    const seen = new Set<string>();
    let s = s0;
    for (;;) {
        const prev = s.tick;
        const w = await waitUntil(sdk, st => st.tick > prev, { maxTicks: 50 });
        if (!w.ok) throw new Error(`fight: the client stopped publishing at tick ${prev}`);
        s = w.state;
        if (s.tick - t0 > (o.maxTicks ?? 600)) return end(s, 'timeout');
        for (const e of s.combatEvents ?? []) {
            const k = `${e.tick}:${e.observationId ?? ''}:${e.type}:${e.damage}:${e.sourceIndex}:${e.targetIndex}`;
            if (e.tick < t0 || seen.has(k)) continue;
            seen.add(k);
            // Damage dealt counts only on the tracked target: a hit on another NPC
            // (multi-combat, a cannon) must not reset the protect-prayer stall timer.
            const onTarget = e.type === 'damage_dealt' && e.targetType === 'npc' && e.targetIndex === idx;
            const fromTarget = e.type === 'damage_taken' && e.sourceType === 'npc' && e.sourceIndex === idx;
            if (onTarget) {
                r.dealt += e.damage;
                r.hits++;
                dealtHere += e.damage;
                lastDealt = e.tick;
            } else if (e.type === 'damage_taken') r.taken += e.damage;
            if ((onTarget || fromTarget) && r.engaged < 0) r.engaged = e.tick - t0;
            if (e.type === 'damage_taken' && e.targetType === 'player') {
                lastHitOnUs = Math.max(lastHitOnUs, e.tick);
                if (e.sourceType === 'npc' && e.sourceIndex >= 0) hitBy.add(e.sourceIndex);
            }
        }
        if (s.player) r.minHp = Math.min(r.minHp, s.player.hp);
        if (s.player?.isDead) return end(s, 'died');
        if (o.done?.(s)) return end(s, 'done');
        npc = waitingSince === null ? npcByIndex(s, idx) : null;

        if (contest && attacking) {
            if (waitingSince === null && replies) {
                let repick = false;
                if (o.contested && (replies.lock.seen(s) || replies.notYours.seen(s))) {
                    refused.set(idx, { tick: s.tick, lasting: replies.notYours.seen(s) });
                    r.refused.push(idx);
                    repick = true;
                } else if (o.adoptHitter && replies.underAttack.seen(s)) {
                    notOurs.add(idx);
                    repick = true;
                } else if (o.adoptHitter && npc && s.tick - lastSwitch >= 3) {
                    const mine = claimOf(s, npc);
                    const best = mine === 'ours' || (dealtHere > 0 && mine !== 'others') ? null : pick(s);
                    if (best && best.index !== idx && claimOf(s, best) === 'ours') engage(best, s.tick);
                }
                if (repick) {
                    const next = pick(s);
                    if (next) engage(next, s.tick);
                    else {
                        waitingSince = s.tick;
                        npc = null;
                        if (o.contested && o.contested.waitTicks <= 0) return end(s, 'contested');
                    }
                }
            } else if (waitingSince !== null) {
                // Not the tick the wait began: one may have come free since.
                let next = pick(s);
                if (next && prayerHeld && o.prayer) {
                    // Back under the prayer before the attack that re-engages.
                    upkeep.holdPrayer = false;
                    prayerHeld = false;
                    await setPrayer(sdk, o.prayer, true, { maxTicks: 6 });
                    s = sdk.getState() ?? s;
                    next = pick(s);
                }
                if (next) {
                    r.waited += s.tick - waitingSince;
                    waitingSince = null;
                    upkeep.holdPrayer = false;
                    engage(next, s.tick);
                } else if (s.tick - waitingSince >= o.contested!.waitTicks) return end(s, 'contested');
            }
            if (waitingSince !== null && o.prayer) {
                // Nothing is attacking the player: the protect prayer only drains while it waits.
                const threatened = s.tick - lastHitOnUs <= 4 || s.nearbyNpcs.some(n => n.options.some(op => /^attack$/i.test(op)) && npcClaim(s, n) === 'ours');
                upkeep.holdPrayer = !threatened;
                if (!threatened && prayerActive(s, o.prayer) && s.tick - lastPrayerOff >= 3) {
                    lastPrayerOff = s.tick;
                    prayerHeld = true;
                    void sdk.sendTogglePrayer(o.prayer);
                }
            }
        }

        if (o.endOnTargetDeath !== false && waitingSince === null) {
            if ((s.combatEvents ?? []).some(e => e.type === 'kill' && e.tick >= engagedAt && e.targetIndex === idx)) return end(s, 'killed');
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
        if (o.spell !== undefined) {
            if (resend || s.tick - lastAttack >= (o.castEvery ?? 2)) attack(s.tick);
            continue;
        }
        const inCombat = s.player?.combat?.inCombat === true;
        const stalled = o.prayer !== undefined && s.tick - lastDealt > (o.stallTicks ?? 8);
        if (resend || ((!inCombat || stalled) && s.tick - lastAttack > (o.reattackAfter ?? 4))) attack(s.tick);
    }
}
