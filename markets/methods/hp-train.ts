// Fresh-account Hitpoints trainer for markets' phase 2 (docs/markets/hp-training.md).
//
//   bun markets/methods/hp-train.ts <account> --to <HP level> [--out FILE] [--site crabs|cows]
//       [--coins N] [--switch-hp 30] [--food NAME] [--food-per-trip N]
//
// Melee gives 1.33 base Hitpoints xp per damage in every style (combat.rs2), so the trainer
// maximises damage per tick: it buys every scimitar Zeke sells that the coins cover in one visit
// (iron, steel, mithril), wields each as Attack reaches it, trains Attack or Strength by
// hp-model.ts chooseStyle (never Defence), and fights the softest high-hitpoint target it can
// reach. Default: the Lumbridge cows to Hitpoints 30 (the White Wolf Mountain crossing's
// threshold, speedrun/lib/kandarin.ts), over the mountain to Seers' Village, then the rock crabs
// north-east of Rellekka. At the target level it walks to the bank and logs out with the totals
// line (probe-sampler.ts runProbe).
//
// Start: an account off Tutorial Island on the Lumbridge side, its coins in the bank (or carried).
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, InventoryItem, NearbyNpc } from '../../sdk/types';
import { crossingSettings, crossToKandarin, westOfTaverley, type Traveller } from '../../speedrun/lib/kandarin';
import { startLevelUpWatcher } from '../../speedrun/lib/levelup';
import { isEastOfTollGate, travelTo, type Tile } from '../../speedrun/lib/toll-gate';
import { waitTicks, waitUntil } from '../../speedrun/lib/wait';
import { BRONZE_SWORD, chooseSite, chooseStyle, kebabsFor, shopPays, type SiteChoice, marksFor, MELEE_PRAYERS, prayersFor, reached, SCIMITARS, TARGETS, weaponPlan, type MeleePrayer, type Target, type Train, type Weapon } from './hp-model';
import { cheb, commonOptions, here, numberFlag, runProbe, type Args, type CommonOptions, type ProbeContext, type ProbeSpec } from './probe-sampler';

interface Box {
    x1: number;
    z1: number;
    x2: number;
    z2: number;
}
const inBox = (b: Box, p: Tile) => p.x >= b.x1 && p.x <= b.x2 && p.z >= b.z1 && p.z <= b.z2;

export interface Site {
    id: string;
    /** The attackable npc. */
    npc: RegExp;
    /** The npc's dormant form, woken by standing next to it (the crabs' "Rocks"); null when none. */
    dormant: RegExp | null;
    area: Box;
    centre: Tile;
    /** The bank the trainer uses from this site. */
    bank: Tile | null;
    target: Target;
    /** True when the site is in Kandarin, past White Wolf Mountain. */
    kandarin: boolean;
}

export const SEERS_BANK: Tile = { x: 2725, z: 3491 };
/** The nearest ground-floor altars to the two sites (map locs 409): Seers' church and Lumbridge church. */
export const SEERS_ALTAR: Tile = { x: 2694, z: 3462 };
export const LUMBRIDGE_ALTAR: Tile = { x: 3243, z: 3205 };
export const AL_KHARID_BANK: Tile = { x: 3270, z: 3167 };
export const DRAYNOR_BANK: Tile = { x: 3092, z: 3245 };
/** Zeke's Superior Scimitars, Al Kharid (a tile beside Zeke). */
export const ZEKE: Tile = { x: 3287, z: 3188 };

export const SITES = {
    /** 34 spawns (15 horror_rockcrab, 19 small) north-east of Rellekka, maps m41_58 and m42_58. */
    crabs: {
        id: 'crabs',
        npc: /^rock crab$/i,
        dormant: /^rocks$/i,
        // The middle and east of the field (20 of the 34 spawns). The north-west corner's rocks stand
        // 2-4 tiles apart, so a walk through it wakes several crabs at once (the whole field is
        // multi-combat, multiway.csv): bots that drifted there ate six kebabs in 50 ticks.
        area: { x1: 2682, z1: 3708, x2: 2724, z2: 3738 },
        centre: { x: 2700, z: 3722 },
        bank: SEERS_BANK,
        target: TARGETS.crab,
        kandarin: true
    },
    /** The Lumbridge cow pen (speedrun/lib/kandarin.ts COW_PEN). */
    cows: {
        id: 'cows',
        npc: /^cow$/i,
        dormant: null,
        area: { x1: 3242, z1: 3255, x2: 3265, z2: 3298 },
        centre: { x: 3253, z: 3285 },
        bank: DRAYNOR_BANK,
        target: TARGETS.cow,
        kandarin: false
    }
} satisfies Record<string, Site>;
export type SiteId = keyof typeof SITES;

const COINS = /^coins$/i;
const TOLL_RESERVE = 20;

// ------------------------------------------------------------------ the fight loop

export interface FightStats {
    ticks: number;
    kills: number;
    swings: number;
    damageDealt: number;
    damageTaken: number;
    eats: number;
    /** Retargets that found nothing to attack (no live npc and no dormant one in reach). */
    idleTicks: number;
    end: 'until' | 'maxTicks' | 'food' | 'dead' | 'aborted' | 'left' | 'prayer';
    bonesBuried: number;
    prayerPointsUsed: number;
    /** Most npcs hitting us at once, and the sum over ticks (mean = attackerTicks / ticks). */
    maxAttackers: number;
    attackerTicks: number;
}

export interface FightOptions {
    maxTicks?: number;
    /** Stop when this is true (checked every tick). */
    until?: (s: BotWorldState) => boolean;
    /** Called after each kill and once at the start: set the style and wield upgrades. */
    onKill?: (s: BotWorldState) => Promise<void> | void;
    /** Eat at or below this many current Hitpoints (the crabs hit 1 at most, so a low line wastes no heal). */
    eatAt?: number;
    /** Eat at or below half of maximum Hitpoints too: a kebab heals less than half (kebab.rs2), so nothing is wasted. */
    eatHalf?: boolean;
    food?: RegExp;
    /** With no food left, stop the fight at or below this many current Hitpoints (0: never). */
    leaveAt?: number;
    /** While true, pick up the kill's bones and bury them (the Prayer-first variant). */
    bones?: (s: BotWorldState) => boolean;
    /** Prayers to keep on while points last; with `restore`, the fight ends ('prayer') when they run out. */
    prayers?: (s: BotWorldState) => readonly MeleePrayer[];
    restore?: boolean;
    signal?: AbortSignal;
    log?: (message: string, data?: Record<string, unknown>) => void;
}

const attackOp = (n: NearbyNpc) => n.optionsWithIndex.find(o => /^attack$/i.test(o.text))?.opIndex;

/**
 * Fight npcs of `site` until `until`, `maxTicks`, no food at `leaveAt`, or death. One target at a
 * time: an npc already on us first (an aggressive crab), else the nearest idle one in the area, else
 * (crabs) a step next to the nearest dormant one, which wakes it. A target that takes no hit for 12
 * ticks is dropped for 50. Damage is read from the published combat events, de-duplicated.
 */
export async function fightFor(sdk: BotSDK, bot: BotActions, site: Site, o: FightOptions = {}): Promise<FightStats> {
    const st: FightStats = { ticks: 0, kills: 0, swings: 0, damageDealt: 0, damageTaken: 0, eats: 0, idleTicks: 0, end: 'maxTicks', bonesBuried: 0, prayerPointsUsed: 0, maxAttackers: 0, attackerTicks: 0 };
    let lastPoints = sdk.getState()?.prayers?.prayerPoints ?? 0;
    let lastToggle = -100;
    let lastTargetTile: Tile | null = null;
    const hitMe = new Map<number, number>();
    const wakeBans = new Map<number, number>();
    let waking: { index: number; at: number; tries: number } | null = null;
    const watcher = startLevelUpWatcher(sdk);
    const seen = new Set<string>();
    const banned = new Map<number, number>();
    const lastHitOn = new Map<number, number>();
    const t0 = sdk.getState()?.tick ?? 0;
    let target: number | null = null;
    let targetSince = 0;
    let lastClick = -100;
    let lastEat = -100;
    let lastWake = -100;
    let reattack = 0;
    let lastTick = -1;
    if (o.onKill) await o.onKill(sdk.getState()!);
    try {
        for (;;) {
            await waitTicks(sdk, 1);
            const s = sdk.getState();
            if (!s?.player) continue;
            const t = s.tick;
            if (t === lastTick) continue;
            lastTick = t;
            st.ticks = t - t0;
            for (const e of s.combatEvents ?? []) {
                const key = `${e.tick}:${e.type}:${e.sourceIndex}:${e.targetIndex}:${e.damage}`;
                if (seen.has(key)) continue;
                seen.add(key);
                if (e.type === 'damage_dealt' && e.sourceType === 'player') {
                    st.swings++;
                    st.damageDealt += e.damage;
                    lastHitOn.set(e.targetIndex, e.tick);
                } else if (e.type === 'damage_taken' && e.sourceIndex >= 0) {
                    // A hitsplat with no source (index -1) is our own hit on the target, published as
                    // damage_taken by the lite client (lab/hp-site.ts diagnostics): not counted.
                    st.damageTaken += e.damage;
                    if (e.sourceType === 'npc') hitMe.set(e.sourceIndex, e.tick);
                }
            }
            if (seen.size > 2000) seen.clear();
            if (o.signal?.aborted) { st.end = 'aborted'; break; }
            if (s.player.isDead) { st.end = 'dead'; break; }
            if (o.until?.(s)) { st.end = 'until'; break; }
            if (o.maxTicks && st.ticks >= o.maxTicks) { st.end = 'maxTicks'; break; }
            const me = { x: s.player.worldX, z: s.player.worldZ };
            if (!inBox(site.area, me) && cheb(me, site.centre) > 40) { st.end = 'left'; break; }

            // Food: eating clears the attack (OpHeldHandler), so re-attack on each of the next 2 ticks.
            const hp = s.player.hp;
            const food = o.food ? s.inventory.find(i => o.food!.test(i.name)) : undefined;
            const eatLine = Math.max(o.eatAt ?? 0, o.eatHalf ? Math.floor(s.player.maxHp / 2) : 0);
            if (hp <= eatLine && hp < s.player.maxHp && food && t - lastEat >= 3) {
                const op = food.optionsWithIndex.find(x => /^eat$/i.test(x.text))?.opIndex ?? 1;
                void sdk.sendUseItem(food.slot, op);
                o.log?.('eat', { hp, maxHp: s.player.maxHp, food: food.name, left: s.inventory.filter(i => o.food!.test(i.name)).length - 1, near: s.nearbyNpcs.filter(n => site.npc.test(n.name) && n.hp !== 0 && n.distance <= 1).length });
                lastEat = t;
                st.eats++;
                reattack = 2;
                continue;
            }
            if (!food && o.leaveAt && hp <= o.leaveAt) { st.end = 'food'; break; }

            // Prayers: toggled standing or fighting (an interface button, not an inventory op).
            const points = s.prayers?.prayerPoints ?? 0;
            if (points < lastPoints) st.prayerPointsUsed += lastPoints - points;
            lastPoints = points;
            if (o.prayers) {
                const want = o.prayers(s);
                if (want.length && points <= 0 && o.restore) { st.end = 'prayer'; break; }
                const off = want.find(p => !sdk.isPrayerActive(p));
                if (off && points > 0 && t - lastToggle >= 2) {
                    void sdk.sendTogglePrayer(off);
                    lastToggle = t;
                }
            }

            const live = (i: number | null) => (i === null ? undefined : s.nearbyNpcs.find(n => n.index === i && n.hp !== 0 && site.npc.test(n.name)));
            // Npcs that hit us (any hitsplat, 0 included) in the last 8 ticks: in the crabs' multi-combat
            // field every crab woken stays on us until it dies, so these are always killed first.
            const attackers = [...hitMe].filter(([i, at]) => t - at <= 8 && live(i)).map(([i]) => live(i)!).sort((a, b) => a.distance - b.distance);
            st.attackerTicks += attackers.length;
            st.maxAttackers = Math.max(st.maxAttackers, attackers.length);
            let cur = live(target);
            if (cur && attackers.length && !attackers.some(a => a.index === cur!.index)) {
                target = null; // switch to a crab that is hitting us
                cur = undefined;
            }
            if (target !== null && !cur) {
                st.kills++;
                target = null;
                if (o.bones?.(s) && lastTargetTile) st.bonesBuried += await lootAndBury(sdk, bot, lastTargetTile);
                if (o.onKill) await o.onKill(s);
            } else if (cur && !attackers.some(a => a.index === cur!.index) && t - Math.max(lastHitOn.get(cur.index) ?? -1, targetSince) > 12) {
                banned.set(cur.index, t + 50);
                o.log?.('dropped target', { index: cur.index, at: [cur.x, cur.z] });
                target = null;
                cur = undefined;
            }
            if (cur) {
                lastTargetTile = { x: cur.tileX ?? cur.x, z: cur.tileZ ?? cur.z };
                if (reattack > 0 || (!s.player.combat.inCombat && t - lastClick >= 5)) {
                    reattack = Math.max(0, reattack - 1);
                    const op = attackOp(cur);
                    if (op !== undefined) { void sdk.sendInteractNpc(cur.index, op); lastClick = t; }
                }
                continue;
            }
            const free = (n: NearbyNpc) => site.npc.test(n.name) && n.hp !== 0 && attackOp(n) !== undefined && n.reachable !== false && (banned.get(n.index) ?? -1) < t && inBox(site.area, { x: n.tileX ?? n.x, z: n.tileZ ?? n.z });
            const onMe = attackers.find(n => attackOp(n) !== undefined) ?? s.nearbyNpcs.filter(n => free(n) && n.inCombat && n.distance <= 2).sort((a, b) => a.distance - b.distance)[0];
            const next = onMe ?? s.nearbyNpcs.filter(n => free(n) && !n.inCombat).sort((a, b) => a.distance - b.distance)[0];
            if (next && t - lastClick >= 1) {
                target = next.index;
                targetSince = t;
                void sdk.sendInteractNpc(next.index, attackOp(next)!);
                lastClick = t;
                continue;
            }
            st.idleTicks++;
            if (site.dormant && t - lastWake >= 4 && !attackers.length) {
                const players = s.nearbyPlayers ?? [];
                const rocks = s.nearbyNpcs.filter(n => site.dormant!.test(n.name) && n.reachable !== false && inBox(site.area, { x: n.tileX ?? n.x, z: n.tileZ ?? n.z }) && !players.some(p => cheb(p, n) <= 1));
                // A rock with another within 2 tiles wakes both (huntrange 1): take a lone one when there is one.
                const lone = (n: NearbyNpc) => !rocks.some(r => r.index !== n.index && cheb(r, n) <= 2);
                // A rock that did not wake within 10 ticks of a walk to it is out of reach from here: skip it for 200.
                if (waking && t - waking.at >= 10) {
                    const r = s.nearbyNpcs.find(n => n.index === waking!.index);
                    if (r && site.dormant.test(r.name)) wakeBans.set(waking.index, t + 200);
                    waking = null;
                }
                const rock = rocks.filter(n => (wakeBans.get(n.index) ?? -1) < t).sort((a, b) => Number(lone(b)) - Number(lone(a)) || a.distance - b.distance)[0];
                if (rock) {
                    const rx = rock.tileX ?? rock.x;
                    const rz = rock.tileZ ?? rock.z;
                    // A tile beside it (huntrange 1 wakes it, horror_rockcrab.npc): our side first, then round it.
                    const tries = waking?.index === rock.index ? waking.tries + 1 : 0;
                    const ring: Array<[number, number]> = [[Math.sign(me.x - rx), Math.sign(me.z - rz)], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
                    const [dx, dz] = ring[tries % ring.length]!;
                    void sdk.sendWalk(rx + (dx || 1), rz + dz, true);
                    if (!waking || waking.index !== rock.index) waking = { index: rock.index, at: t, tries: 0 };
                    else waking.tries = tries;
                    lastWake = t;
                } else if (cheb(me, site.centre) > 6 && t - lastWake >= 10) {
                    void sdk.sendWalk(site.centre.x, site.centre.z, true);
                    lastWake = t;
                }
            } else if (!site.dormant && cheb(me, site.centre) > 6 && t - lastWake >= 10) {
                void sdk.sendWalk(site.centre.x, site.centre.z, true);
                lastWake = t;
            }
        }
    } finally {
        watcher.stop();
    }
    return st;
}

const BONES = /^bones$/i;

/** Pick up the bones a kill left within 2 tiles of `at` and bury every carried bone (bury_bone.rs2). */
async function lootAndBury(sdk: BotSDK, bot: BotActions, at: Tile): Promise<number> {
    // The drop lands after the death animation: look for up to 6 ticks.
    let g: Awaited<ReturnType<BotSDK['scanGroundItems']>>[number] | undefined;
    for (let i = 0; i < 6 && !g; i++) {
        await waitTicks(sdk, 1);
        g = (await sdk.scanGroundItems(6)).filter(it => BONES.test(it.name) && cheb(it, at) <= 3).sort((a, b) => cheb(a, at) - cheb(b, at))[0];
    }
    if (g && sdk.getState()!.inventory.length < 28) await bot.pickupItem(g);
    let buried = 0;
    for (let i = 0; i < 5; i++) {
        const b = sdk.getState()!.inventory.find(it => BONES.test(it.name));
        if (!b) break;
        const op = b.optionsWithIndex.find(o => /^bury$/i.test(o.text))?.opIndex ?? 1;
        await sdk.sendUseItem(b.slot, op);
        const r = await waitUntil(sdk, s => !s.inventory.some(it => it.slot === b.slot && BONES.test(it.name)), { maxTicks: 4 });
        if (r.ok) buried++;
        await waitTicks(sdk, 1);
    }
    return buried;
}

/** Pray at the altar at `at` (walking there) to restore every point; the prayers come back on in the fight. */
async function restorePrayer(ctx: ProbeContext<HpOptions>, at: Tile, what: string): Promise<boolean> {
    const { sdk, bot } = ctx;
    for (const p of MELEE_PRAYERS) if (sdk.isPrayerActive(p.name)) await sdk.sendTogglePrayer(p.name);
    const r = await travelTo(bot, sdk, at, { tolerance: 3, signal: ctx.signal });
    if (!r.ok) return false;
    const res = await bot.interactLoc(/^altar$/i, /pray/i);
    const ok = (await waitUntil(sdk, s => (s.prayers?.prayerPoints ?? 0) >= skill(s, 'prayer'), { maxTicks: 15 })).ok;
    ctx.event('altar', { at: what, ok, message: res.message, points: sdk.getState()?.prayers?.prayerPoints });
    ctx.totals.altarVisits = Number(ctx.totals.altarVisits ?? 0) + 1;
    return ok;
}

// ------------------------------------------------------------------ kit: style and weapons

const skill = (s: BotWorldState, name: string) => s.skills.find(k => k.name.toLowerCase() === name)?.baseLevel ?? 1;

/** Weapons from hp-model's tables that the account carries or wears. */
export function ownedWeapons(s: BotWorldState): Weapon[] {
    const names = new Set([...s.inventory, ...s.equipment].map(i => i.name.toLowerCase()));
    return [BRONZE_SWORD, ...SCIMITARS].filter(w => names.has(w.name.toLowerCase()));
}

/** Wield the best owned weapon Attack allows, and set the style chooseStyle picks. */
export async function applyKit(sdk: BotSDK, bot: BotActions, target: Target, log?: (m: string, d?: Record<string, unknown>) => void): Promise<Train> {
    const s = sdk.getState()!;
    const attack = skill(s, 'attack');
    const strength = skill(s, 'strength');
    const owned = ownedWeapons(s);
    const wielded = s.equipment.find(e => [BRONZE_SWORD, ...SCIMITARS].some(w => w.name.toLowerCase() === e.name.toLowerCase()));
    const best = owned.filter(w => w.attackLevel <= attack).sort((a, b) => b.strengthBonus - a.strengthBonus || b.attackBonus - a.attackBonus)[0];
    if (best && wielded?.name.toLowerCase() !== best.name.toLowerCase()) {
        const item = s.inventory.find(i => i.name.toLowerCase() === best.name.toLowerCase());
        if (item) {
            const r = await bot.equipItem(item);
            log?.('wield', { weapon: best.name, attack, ok: r.success });
        }
    }
    const train = chooseStyle({ attack, strength, owned, target });
    const cs = sdk.getState()?.combatStyle;
    const want = cs?.styles.find(x => x.trainsSkills.length === 1 && x.trainsSkills[0]!.toLowerCase() === train);
    if (want && cs!.currentStyle !== want.index) {
        await sdk.sendSetCombatStyle(want.index);
        log?.('style', { train, attack, strength });
    }
    return train;
}

// ------------------------------------------------------------------ the probe

export interface HpOptions extends CommonOptions {
    to: number;
    /** 'auto': hp-model's chooseSite (the cows to ~52 HP, the crabs route above). */
    site: SiteId | 'auto';
    /** Coins to take from the bank: the scimitars that fit, the toll and the kebabs. */
    coins: number;
    /** Hitpoints trained on the cows before the crossing to a Kandarin site. */
    switchHp: number;
    /** Kebabs bought in Al Kharid for a Kandarin site (the spare ones banked there); -1: hp-model's kebabsFor estimate. */
    kebabs: number;
    /** Kebabs carried per crab trip. */
    foodPerTrip: number;
    /** Prayer-first variant: bury the cows' bones to this Prayer level before the crossing (0: off). */
    prayer: number;
    /** Keep the best melee prayers on (Protect from Melee too at the crabs), restoring at the Lumbridge altar during the cows and at Seers' on each crab trip. */
    pray: boolean;
}

const USAGE =
    'usage: bun markets/methods/hp-train.ts <account> [--to 40] [--site auto|cows|crabs] [--coins 1700] [--switch-hp 30] [--kebabs -1] [--food-per-trip 20] [--prayer 0|31|34|43] [--pray] [--out FILE]';

export function parseOptions(a: Args): HpOptions {
    const c = commonOptions({ ...a, flags: { ...a.flags, minutes: a.flags.minutes ?? '0' } }, ['to', 'site', 'coins', 'switch-hp', 'kebabs', 'food-per-trip', 'prayer', 'pray']);
    if (a.flags.pray !== undefined && a.flags.pray !== 'true' && a.flags.pray !== 'false') throw new Error('--pray takes no value');
    const site = (a.flags.site ?? 'auto') as SiteId | 'auto';
    if (site !== 'auto' && !(site in SITES)) throw new Error(`--site must be auto, ${Object.keys(SITES).join(' or ')}`);
    return {
        ...c,
        // 40 by default: phase 2's knights stop wasting heals from ~30-40 HP (docs/markets/phase2.md 'Setup').
        to: numberFlag(a, 'to', DEFAULT_TO, { min: 11, max: 99, integer: true }),
        site,
        coins: numberFlag(a, 'coins', 1700, { min: 0, integer: true }),
        switchHp: numberFlag(a, 'switch-hp', CROSSING_HP, { min: 10, max: 99, integer: true }),
        kebabs: numberFlag(a, 'kebabs', -1, { min: -1, max: 2000, integer: true }),
        foodPerTrip: numberFlag(a, 'food-per-trip', 20, { min: 1, max: 26, integer: true }),
        prayer: numberFlag(a, 'prayer', 0, { min: 0, max: 99, integer: true }),
        pray: a.flags.pray === 'true'
    };
}

/** speedrun/lib/kandarin.ts CROSSING_HITPOINTS: 12 of 14 crossings arrived at 30, 0 of 4 at 10. */
const CROSSING_HP = 30;
export const DEFAULT_TO = 40;
/** Deaths the trainer recovers from before it gives up (a lab bot near the cows was killed by a random-event npc). */
const MAX_DEATHS = 3;
const KEBAB = /^kebab$/i;
const COW_FOOD = /^(shrimps|bread|kebab|cooked meat|cooked chicken)$/i;
const KARIM: Tile = { x: 3273, z: 3180 };
/** What the trainer keeps in the pack at a bank: coins, its scimitars and the food. */
const KEEP = /^(coins|kebab|shrimps|bread|bronze sword|wooden shield|(bronze|iron|steel|mithril) scimitar)$/i;

const coinsHeld = (s: BotWorldState | null) => (s?.inventory ?? []).filter(i => COINS.test(i.name)).reduce((n, i) => n + i.count, 0);
const countIn = (items: readonly { name: string; count: number }[], re: RegExp) => items.filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);

type Ctx = ProbeContext<HpOptions>;

/**
 * West of White Wolf Mountain, above ground: Seers', the crabs and everything between. Not kandarin.ts's
 * inKandarin, a box round the towns that ends at z 3530: a bot standing north of it at the crabs read as
 * 'on the Lumbridge side', walked back over the mountain to cross again, and died there.
 */
export const pastTheMountain = (s: BotWorldState | null): boolean => !!s?.player && s.player.level === 0 && westOfTaverley(here(s));

/** Eat kebabs, one each 3 ticks (consume.rs2's eat delay), until current Hitpoints reach `to`. Returns the kebabs eaten. */
async function eatUpTo(sdk: BotSDK, to: number): Promise<number> {
    let eaten = 0;
    for (let i = 0; i < 28; i++) {
        const s = sdk.getState()!;
        if (s.player!.hp >= to) break;
        const k = s.inventory.find(it => KEBAB.test(it.name));
        if (!k) break;
        await sdk.sendUseItem(k.slot, k.optionsWithIndex.find(o => /^eat$/i.test(o.text))?.opIndex ?? 1);
        eaten++;
        await waitTicks(sdk, 3);
    }
    return eaten;
}

/** travelTo with retries: a walk can stop short ('cant reach') on a door or another player in the way. */
async function walkTo(ctx: Ctx, to: Tile, what: string, tolerance = 3): Promise<void> {
    let reason = '';
    for (let attempt = 1; attempt <= 5; attempt++) {
        ctx.signal.throwIfAborted();
        const r = await travelTo(ctx.bot, ctx.sdk, to, { tolerance, signal: ctx.signal, log: (m, d) => ctx.event(m, d) });
        if (r.paid) ctx.totals.tollPaid = Number(ctx.totals.tollPaid ?? 0) + r.paid;
        if (r.ok) return;
        reason = r.reason ?? '';
        ctx.event('walk retry', { to: what, attempt, reason, at: here(ctx.sdk.getState()) });
        await waitTicks(ctx.sdk, 2 * attempt);
    }
    throw new Error(`walk to ${what}: ${reason}`);
}

/**
 * At `bank`: deposit everything but KEEP, then bring the carried coins to `coins` (withdrawing or
 * depositing the difference) and the carried kebabs up to `kebabs`.
 */
async function visitBank(ctx: Ctx, bank: Tile, what: string, want: { coins?: number; kebabs?: number } = {}): Promise<void> {
    const { sdk, bot } = ctx;
    await walkTo(ctx, bank, what);
    const opened = await bot.openBank();
    if (!opened.success) throw new Error(`openBank at ${what}: ${opened.message}`);
    await waitTicks(sdk, 1);
    for (const it of [...sdk.getState()!.inventory].filter(i => !KEEP.test(i.name))) {
        await bot.depositItem(it, -1);
    }
    if (want.coins !== undefined) {
        const have = coinsHeld(sdk.getState());
        const b = sdk.getBankItems().find(i => COINS.test(i.name));
        if (b && want.coins > have) await bot.withdrawItem(b, Math.min(want.coins - have, b.count));
        else if (want.coins < have) await bot.depositItem(sdk.getState()!.inventory.find(i => COINS.test(i.name))!, have - want.coins);
        await waitTicks(sdk, 1);
    }
    if (want.kebabs !== undefined) {
        // Kebabs do not stack: one slot each.
        const have = countIn(sdk.getState()!.inventory, KEBAB);
        const b = sdk.getBankItems().find(i => KEBAB.test(i.name));
        const room = 28 - sdk.getState()!.inventory.length;
        if (b && want.kebabs > have && room > 0) await bot.withdrawItem(b, Math.min(want.kebabs - have, b.count, room));
        await waitTicks(sdk, 1);
    }
    const s = sdk.getState()!;
    ctx.event('bank', { at: what, carried: { coins: coinsHeld(s), kebabs: countIn(s.inventory, KEBAB) }, banked: { coins: countIn(sdk.getBankItems(), COINS), kebabs: countIn(sdk.getBankItems(), KEBAB) } });
    await bot.closeBank();
}

/** One kebab from Karim (1 coin): talk, "Yes please.". True when the pack gained one. */
async function buyKebab(sdk: BotSDK): Promise<boolean> {
    const seller = sdk.getState()!.nearbyNpcs.find(n => /^karim$|kebab/i.test(n.name));
    const talk = seller?.optionsWithIndex.find(o => /talk/i.test(o.text));
    if (!seller || !talk) return false;
    const before = countIn(sdk.getState()!.inventory, KEBAB);
    await sdk.sendInteractNpc(seller.index, talk.opIndex);
    for (let k = 0; k < 30; k++) {
        await waitTicks(sdk, 1);
        const s = sdk.getState()!;
        if (countIn(s.inventory, KEBAB) > before) break;
        if (!s.dialog.isOpen) continue;
        const yes = s.dialog.options.find(o => /yes please/i.test(o.text));
        await sdk.sendClickDialog(yes ? yes.index : 0);
    }
    for (let k = 0; k < 6 && sdk.getState()!.dialog.isOpen; k++) {
        await sdk.sendClickDialog(0);
        await waitTicks(sdk, 1);
    }
    return countIn(sdk.getState()!.inventory, KEBAB) > before;
}

/**
 * Buy `n` kebabs at Karim's: fill the pack, bank the kebabs at Al Kharid, repeat, and leave with
 * up to `carry` in the pack (the rest banked, for the Kandarin bank trips: the bank is one bank).
 */
async function stockKebabs(ctx: Ctx, n: number, carry: number): Promise<number> {
    const { sdk } = ctx;
    let bought = 0;
    let fails = 0;
    while (bought < n && fails < 10 && coinsHeld(sdk.getState()) > 0) {
        ctx.signal.throwIfAborted();
        const s = sdk.getState()!;
        if (s.inventory.length >= 28) {
            await visitBank(ctx, AL_KHARID_BANK, 'Al Kharid bank (kebabs)');
            const opened = await ctx.bot.openBank();
            if (opened.success) {
                const k = sdk.getState()!.inventory.find(i => KEBAB.test(i.name));
                if (k) await ctx.bot.depositItem(k, -1);
                await ctx.bot.closeBank();
            }
            continue;
        }
        if (cheb(here(s), KARIM) > 4) await walkTo(ctx, KARIM, 'Karim');
        if (await buyKebab(sdk)) {
            bought++;
            fails = 0;
        } else fails++;
    }
    // Leave with the toll and a little over: a death on White Wolf Mountain drops carried coins.
    await visitBank(ctx, AL_KHARID_BANK, 'Al Kharid bank', { kebabs: carry, coins: TOLL_RESERVE });
    return bought;
}

export const spec: ProbeSpec<HpOptions> = {
    name: 'hp-train',
    usage: USAGE,
    parse: parseOptions,
    items: { kebabs: KEBAB, scimitars: /scimitar$/i },
    async run(ctx) {
        const { sdk, bot, options: o, sampler } = ctx;
        const site: Site = SITES[o.site === 'auto' ? chooseSite(o.to) : o.site];
        ctx.totals.site = site.id;
        const t: Traveller = { bot, sdk, log: (m, d) => ctx.event(m, d), checkSignal: () => ctx.signal.throwIfAborted() };
        const tick = () => sdk.getState()?.tick ?? 0;
        const hpLevel = () => skill(sdk.getState()!, 'hitpoints');
        const t0 = tick();
        const w0 = Date.now();
        const marks: Record<string, { tick: number; wallMs: number; attack: number; strength: number }> = {};
        const wanted = marksFor(o.to);
        const stamp = () => {
            const s = sdk.getState();
            if (!s?.player) return;
            for (const m of wanted) {
                if (!marks[m] && skill(s, 'hitpoints') >= m) {
                    marks[m] = { tick: s.tick - t0, wallMs: Date.now() - w0, attack: skill(s, 'attack'), strength: skill(s, 'strength') };
                    ctx.event('mark', { hp: m, ...marks[m] });
                }
            }
        };
        const off = sdk.onStateUpdate(stamp);
        const fights: FightStats[] = [];
        const kitTo = (tg: Target) => () => applyKit(sdk, bot, tg, t.log).then(() => undefined);
        ctx.totals.marks = marks;
        /**
         * After a death: the respawn keeps the three most valuable items (death.rs2: the scimitars)
         * and loses the rest carried (kebabs, coins). Wait it out, wield again, and let the caller's
         * loop walk back. More than MAX_DEATHS ends the run.
         */
        const died = async (where: string) => {
            const n = Number(ctx.totals.deaths ?? 0) + 1;
            ctx.totals.deaths = n;
            ctx.event('died', { where, deaths: n, hp: hpLevel() });
            if (n > MAX_DEATHS) throw new Error(`died ${n} times (last at ${where})`);
            await waitUntil(sdk, s => !!s.player && !s.player.isDead, { maxTicks: 30 });
            await waitTicks(sdk, 5);
            await bot.dismissBlockingUI();
            await crossingSettings(sdk, t.log);
            await applyKit(sdk, bot, site.target, t.log);
        };
        try {
            const s0 = sdk.getState()!;
            ctx.totals.start = { hp: skill(s0, 'hitpoints'), attack: skill(s0, 'attack'), strength: skill(s0, 'strength'), defence: skill(s0, 'defence'), at: here(s0) };
            await crossingSettings(sdk, t.log); // auto-retaliate off, run on
            const coinsAt = (s: BotWorldState) => coinsHeld(s) + (s.bank?.isOpen ? countIn(s.bank.items, COINS) : 0);

            // 1. The scimitars (one visit to Zeke) and, for a Kandarin site, the kebabs.
            sampler.phase = 'kit';
            const kebabs = site.kandarin && !pastTheMountain(s0) ? (o.kebabs >= 0 ? o.kebabs : kebabsFor(Math.max(hpLevel(), o.switchHp), o.to)) : 0;
            ctx.totals.kebabsPlanned = kebabs;
            // The scimitars only where they repay the errand (hp-model shopPays), or when no weapon is carried.
            const shop = shopPays(o.to, site.id as SiteChoice) || ownedWeapons(s0).length === 0;
            const plan = shop ? weaponPlan(o.coins - kebabs, TOLL_RESERVE).filter(w => !ownedWeapons(sdk.getState()!).some(x => x.name === w.name)) : [];
            if (plan.length || kebabs) {
                const need = plan.reduce((n, w) => n + w.cost, 0) * 2 + TOLL_RESERVE + kebabs;
                // Withdraw at Al Kharid when the toll can be paid, else at Draynor first.
                const bankAt = coinsHeld(sdk.getState()) >= 10 || isEastOfTollGate(here(sdk.getState())) ? AL_KHARID_BANK : DRAYNOR_BANK;
                await visitBank(ctx, bankAt, bankAt === DRAYNOR_BANK ? 'Draynor bank' : 'Al Kharid bank', { coins: Math.min(o.coins, need) });
                ctx.totals.coinsAfterBank = coinsHeld(sdk.getState());
            }
            const c0 = coinsHeld(sdk.getState());
            if (plan.length) {
                await walkTo(ctx, ZEKE, 'Zeke', 2);
                const opened = await bot.openShop(/^zeke$/i);
                if (!opened.success) throw new Error(`Zeke's shop: ${opened.message}`);
                for (const w of plan) {
                    const before = coinsHeld(sdk.getState());
                    const b = await bot.buyFromShop(new RegExp(`^${w.name}$`, 'i'), 1);
                    ctx.event('buy', { item: w.name, ok: b.success, price: before - coinsHeld(sdk.getState()), message: b.message });
                }
                await bot.closeShop();
            }
            ctx.totals.coinsScimitars = c0 - coinsHeld(sdk.getState());
            await applyKit(sdk, bot, site.target, t.log);
            ctx.totals.weapons = ownedWeapons(sdk.getState()!).map(w => w.name);
            if (kebabs) {
                const k0 = tick();
                const bought = await stockKebabs(ctx, kebabs, o.foodPerTrip);
                ctx.totals.kebabsBought = bought;
                ctx.totals.kebabTicks = tick() - k0;
                ctx.totals.coinsKebabs = bought; // 1 coin each (kebab_seller.rs2)
            }
            void coinsAt;

            // 2. The cows, to the target or to the crossing's Hitpoints.
            const cowsTo = site.kandarin ? Math.min(o.switchHp, o.to) : o.to;
            const prayerLvl = (s: BotWorldState) => skill(s, 'prayer');
            const cowsDone = (s: BotWorldState) => reached(skill(s, 'hitpoints'), cowsTo) && prayerLvl(s) >= o.prayer;
            while (!cowsDone(sdk.getState()!) && !pastTheMountain(sdk.getState())) {
                ctx.signal.throwIfAborted();
                sampler.phase = prayerLvl(sdk.getState()!) < o.prayer ? 'cows+bones' : 'cows';
                await walkTo(ctx, SITES.cows.centre, 'the cows', 4);
                const f = await fightFor(sdk, bot, SITES.cows, {
                    until: cowsDone,
                    onKill: kitTo(SITES.cows.target),
                    // The cows chip ~0.05 hp a tick against 0.01 regenerated: eat the tutorial's shrimps and bread (and
                    // any kebabs) only near the end, since a level-up adds a point too.
                    food: COW_FOOD,
                    eatAt: 4,
                    bones: s => prayerLvl(s) < o.prayer,
                    // Bury first; the prayers go on once the target Prayer level is reached (the training phase).
                    prayers: o.pray ? s => (prayerLvl(s) >= o.prayer ? prayersFor(prayerLvl(s), false) : []) : undefined,
                    restore: o.pray,
                    signal: ctx.signal,
                    log: t.log
                });
                fights.push(f);
                ctx.event('cows trip', { ...f, prayer: prayerLvl(sdk.getState()!) });
                if (f.end === 'prayer') {
                    sampler.phase = 'altar';
                    await restorePrayer(ctx, LUMBRIDGE_ALTAR, 'Lumbridge church');
                } else if (f.end === 'dead') await died('the cows');
                else if (f.end !== 'until') throw new Error(`the cows ended: ${f.end}`);
            }
            if (o.prayer) ctx.totals.prayerPhase = { prayer: prayerLvl(sdk.getState()!), bonesBuried: fights.reduce((n, f) => n + f.bonesBuried, 0) };

            // 3. Over White Wolf Mountain to a Kandarin site, and train there.
            if (site.kandarin && !reached(hpLevel(), o.to)) {
                while (!reached(hpLevel(), o.to)) {
                    ctx.signal.throwIfAborted();
                    if (!pastTheMountain(sdk.getState())) {
                        // On the Lumbridge side: the start, or after a death (the respawn is Lumbridge's).
                        sampler.phase = 'cross';
                        if (hpLevel() >= CROSSING_HP && sdk.getState()!.player!.hp < CROSSING_HP && !sdk.getState()!.inventory.some(i => KEBAB.test(i.name))) {
                            await visitBank(ctx, DRAYNOR_BANK, 'Draynor bank (food for the crossing)', { kebabs: 8 });
                        }
                        // Eat up to the crossing's Hitpoints: restForCrossing would otherwise wait ~100 ticks a point.
                        ctx.totals.eatsBeforeCrossing = Number(ctx.totals.eatsBeforeCrossing ?? 0) + (await eatUpTo(sdk, Math.min(hpLevel(), CROSSING_HP)));
                        try {
                            await crossToKandarin(t, site.bank ?? SEERS_BANK, "Seers' bank");
                        } catch (e) {
                            if (!/died/i.test(String(e))) throw e;
                            await died('White Wolf Mountain');
                        }
                        continue;
                    }
                    if (!sdk.getState()!.inventory.some(i => KEBAB.test(i.name)) && site.bank) {
                        sampler.phase = 'bank';
                        await visitBank(ctx, site.bank, `${site.id} bank`, { kebabs: o.foodPerTrip });
                        ctx.totals.bankTrips = Number(ctx.totals.bankTrips ?? 0) + 1;
                        if (!sdk.getState()!.inventory.some(i => KEBAB.test(i.name))) ctx.event('no food in the bank: training on without');
                    }
                    if (o.pray && prayersFor(prayerLvl(sdk.getState()!), true).length && (sdk.getState()!.prayers?.prayerPoints ?? 0) < prayerLvl(sdk.getState()!)) {
                        sampler.phase = 'altar';
                        await restorePrayer(ctx, SEERS_ALTAR, "Seers' church");
                    }
                    sampler.phase = 'walk';
                    await walkTo(ctx, site.centre, site.id, 4);
                    sampler.phase = site.id;
                    const hasFood = sdk.getState()!.inventory.some(i => KEBAB.test(i.name));
                    const f = await fightFor(sdk, bot, site, {
                        until: s => reached(skill(s, 'hitpoints'), o.to),
                        onKill: kitTo(site.target),
                        prayers: o.pray ? s => prayersFor(prayerLvl(s), true) : undefined,
                        food: KEBAB,
                        eatAt: 8,
                        eatHalf: true,
                        leaveAt: hasFood ? 5 : 3,
                        signal: ctx.signal,
                        log: t.log
                    });
                    fights.push(f);
                    ctx.event(`${site.id} trip`, { ...f });
                    if (f.end === 'dead') {
                        await died(site.id);
                        continue;
                    }
                    if (f.end === 'aborted') return;
                    if (f.end === 'food' && !hasFood) throw new Error(`out of food at ${site.id}`);
                }
            }

            // 4. Bank and stop.
            sampler.phase = 'bank';
            await visitBank(ctx, site.bank ?? DRAYNOR_BANK, 'the final bank');
        } finally {
            off();
            stamp();
            const s = sdk.getState();
            Object.assign(ctx.totals, {
                kills: fights.reduce((n, f) => n + f.kills, 0),
                damageDealt: fights.reduce((n, f) => n + f.damageDealt, 0),
                damageTaken: fights.reduce((n, f) => n + f.damageTaken, 0),
                eats: fights.reduce((n, f) => n + f.eats, 0),
                bonesBuried: fights.reduce((n, f) => n + f.bonesBuried, 0),
                prayerPointsUsed: fights.reduce((n, f) => n + f.prayerPointsUsed, 0),
                fights: fights.length,
                trainTicks: tick() - t0,
                end: s?.player ? { hp: skill(s, 'hitpoints'), attack: skill(s, 'attack'), strength: skill(s, 'strength'), defence: skill(s, 'defence'), coins: coinsHeld(s), at: here(s) } : null
            });
        }
    }
};

if (import.meta.main) process.exit(await runProbe(spec, process.argv.slice(2)));

