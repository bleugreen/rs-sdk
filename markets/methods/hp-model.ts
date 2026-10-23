// The pure logic of the Hitpoints trainer (hp-train.ts, docs/markets/hp-training.md): the engine's
// melee hit and max-hit formulas, the expected damage per tick on a target, the style choice, the
// weapon path and the stopping rule. No SDK here, so all of it is unit-tested.
//
// Formulas (read, server/content/scripts/skill_combat):
//   effective attack   = floor(Attack x prayer%) + 8 + 3 on accurate        (player_combat_stat.rs2)
//   effective strength = floor(Strength x prayer%) + 8 + 3 on aggressive
//   attack roll  = effective attack x (weapon attack bonus + 64)            (combat.rs2 combat_stat)
//   defence roll = (npc defence + 9) x (npc defence bonus + 64)             (npc_combat.rs2)
//   hit when randominc(attack roll) > randominc(defence roll)               (player_combat.rs2)
//   max hit = floor((effective strength x (strength bonus + 64) + 320) / 640) (combat.rs2)
//   damage  = randominc(max hit), capped at the npc's remaining hitpoints before xp (player_melee.rs2)
//   xp      = 4 base per damage to the style's skill, 1.33 to Hitpoints in every style (combat.rs2)
// So Hitpoints xp per tick is 1.33 x damage per tick, and the trainer maximises damage per tick.
import { levelForXp, xpForLevel } from '../../speedrun/lib/xp';

/** Base Hitpoints xp per point of damage dealt, in every melee style. */
export const HP_XP_PER_DAMAGE = 4 / 3;
/** Base xp per point of damage to the trained skill on accurate or aggressive. */
export const STYLE_XP_PER_DAMAGE = 4;

export interface Weapon {
    /** Inventory name. */
    name: string;
    /** Debug name (::give, shop stock). */
    debug: string;
    attackLevel: number;
    /** Attack bonus of the damage type the trainer swings (slash for scimitars). */
    attackBonus: number;
    strengthBonus: number;
    /** Ticks between swings (attackrate; 4 when the obj has none). */
    rate: number;
    /** Obj cost, the shop's base price. */
    cost: number;
}

/**
 * Scimitars from Zeke's Superior Scimitars, Al Kharid (alkharid.inv scimitarshop: bronze, iron, steel and
 * mithril; no shop sells adamant or rune), with their bonuses (scimitars.obj) and wield levels
 * (levelrequire tier*.rs2).
 */
export const SCIMITARS: readonly Weapon[] = [
    { name: 'Bronze scimitar', debug: 'bronze_scimitar', attackLevel: 1, attackBonus: 7, strengthBonus: 6, rate: 4, cost: 32 },
    { name: 'Iron scimitar', debug: 'iron_scimitar', attackLevel: 1, attackBonus: 10, strengthBonus: 9, rate: 4, cost: 112 },
    { name: 'Steel scimitar', debug: 'steel_scimitar', attackLevel: 5, attackBonus: 15, strengthBonus: 14, rate: 4, cost: 400 },
    { name: 'Mithril scimitar', debug: 'mithril_scimitar', attackLevel: 20, attackBonus: 21, strengthBonus: 20, rate: 4, cost: 1040 }
];
/** The tutorial's bronze sword (stab 4, strength 5), what a fresh account holds before the shop. */
export const BRONZE_SWORD: Weapon = { name: 'Bronze sword', debug: 'bronze_sword', attackLevel: 1, attackBonus: 4, strengthBonus: 5, rate: 4, cost: 26 };

export interface Target {
    name: string;
    hitpoints: number;
    defence: number;
    /** The npc's defence bonus against the trainer's damage type. */
    defenceBonus: number;
    /** Ticks a kill costs beyond its swings: the death, the retarget and the walk to the next one. */
    overheadTicks: number;
}

/** Melee targets, from their .npc configs. overheadTicks is a model figure until measured. */
export const TARGETS = {
    /** Rock crabs north-east of Rellekka (quest_viking horror_rockcrab.npc): 34 spawns, respawn 100. */
    crab: { name: 'Rock Crab', hitpoints: 50, defence: 1, defenceBonus: 0, overheadTicks: 6 },
    /** Lumbridge cows (all.npc cow): respawn 90. */
    cow: { name: 'Cow', hitpoints: 8, defence: 1, defenceBonus: -21, overheadTicks: 6 },
    /** Hill giants (all.npc giant). */
    giant: { name: 'Giant', hitpoints: 35, defence: 26, defenceBonus: 0, overheadTicks: 6 },
    /** Ogres west of Yanille (ogre.npc). */
    ogre: { name: 'Ogre', hitpoints: 60, defence: 43, defenceBonus: 0, overheadTicks: 6 }
} satisfies Record<string, Target>;

export type Train = 'attack' | 'strength';

export interface Prayers {
    /** Attack prayer multiplier in percent (100 none, 115 Incredible Reflexes). */
    attack: number;
    /** Strength prayer multiplier in percent (100 none, 115 Ultimate Strength). */
    strength: number;
}
export const NO_PRAYER: Prayers = { attack: 100, strength: 100 };

export interface Fighter {
    attack: number;
    strength: number;
    weapon: Weapon;
    train: Train;
    prayers?: Prayers;
}

const eff = (level: number, pct: number) => Math.floor((level * Math.max(100, pct)) / 100);

export function attackRoll(f: Fighter): number {
    return (eff(f.attack, f.prayers?.attack ?? 100) + 8 + (f.train === 'attack' ? 3 : 0)) * (f.weapon.attackBonus + 64);
}

export function defenceRoll(t: Target): number {
    return (t.defence + 9) * (t.defenceBonus + 64);
}

/** The un-floored max hit; `maxHit` is its floor. */
export function maxHitExact(f: Fighter): number {
    const es = eff(f.strength, f.prayers?.strength ?? 100) + 8 + (f.train === 'strength' ? 3 : 0);
    return (es * (f.weapon.strengthBonus + 64) + 320) / 640;
}

export function maxHit(f: Fighter): number {
    return Math.floor(maxHitExact(f));
}

/** P(randominc(a) > randominc(d)). */
export function hitChance(a: number, d: number): number {
    if (a > d) return 1 - (d + 2) / (2 * (a + 1));
    return a / (2 * (d + 1));
}

const swingCache = new Map<string, number>();

/** Expected swings to take `hp` hitpoints off an npc that is hit with chance `p` for uniform 0..`max`. */
export function expectedSwings(hp: number, p: number, max: number): number {
    if (hp <= 0) return 0;
    if (p <= 0 || max <= 0) return Infinity;
    const key = `${hp}:${p}:${max}`;
    const hit = swingCache.get(key);
    if (hit !== undefined) return hit;
    const e = new Array<number>(hp + 1).fill(0);
    const q = p / (max + 1);
    for (let h = 1; h <= hp; h++) {
        let s = 0;
        for (let d = 1; d <= max; d++) s += e[Math.max(0, h - d)]!;
        // e[h] = 1 + (1 - p) e[h] + q e[h] + q s  (a miss or a 0 leaves h)
        e[h] = (1 + q * s) / (p - q);
    }
    swingCache.set(key, e[hp]!);
    return e[hp]!;
}

/**
 * Expected damage per tick on `t`: a whole kill's hitpoints over its swings and overhead. With
 * `smooth` the max hit is interpolated between the two integers either side of the exact value, so
 * one level of Strength always shows its share of the next max-hit step (the style choice needs that).
 */
export function damagePerTick(f: Fighter, t: Target, smooth = false): number {
    const p = hitChance(attackRoll(f), defenceRoll(t));
    let swings: number;
    if (smooth) {
        const m = maxHitExact(f) - 0.5;
        const lo = Math.floor(m);
        const fr = m - lo;
        swings = expectedSwings(t.hitpoints, p, lo) * (1 - fr) + expectedSwings(t.hitpoints, p, lo + 1) * fr;
    } else swings = expectedSwings(t.hitpoints, p, maxHit(f));
    return t.hitpoints / (swings * f.weapon.rate + t.overheadTicks);
}

/** The best weapon among `owned` that `attack` can wield, by damage per tick on `t` (null when none). */
export function bestWeapon(attack: number, strength: number, owned: readonly Weapon[], t: Target): Weapon | null {
    let best: Weapon | null = null;
    let bestRate = -1;
    for (const w of owned) {
        if (w.attackLevel > attack) continue;
        const r = damagePerTick({ attack, strength, weapon: w, train: 'strength' }, t);
        if (r > bestRate) {
            best = w;
            bestRate = r;
        }
    }
    return best;
}

export interface StyleInput {
    attack: number;
    strength: number;
    /** Weapons carried or worn: an Attack level that unlocks one counts in the choice. */
    owned: readonly Weapon[];
    target: Target;
    prayers?: Prayers;
    /** Never train past this (99). */
    cap?: number;
}

/**
 * Which skill to train next, accurate (Attack) or aggressive (Strength), never Defence: the one
 * whose next level adds more damage per tick for each xp it costs. Both levels are judged with the
 * best weapon they can wield, so the level that unlocks the next scimitar carries its jump. The
 * style bonus itself (+3) is the same either way and is left out (both rates are taken on
 * aggressive). A capped skill is never chosen while the other is below the cap.
 */
export function chooseStyle(i: StyleInput): Train {
    const cap = i.cap ?? 99;
    if (i.strength >= cap && i.attack < cap) return 'attack';
    if (i.attack >= cap || i.strength >= cap) return 'strength';
    const rate = (a: number, s: number) => {
        const w = bestWeapon(a, s, i.owned, i.target) ?? BRONZE_SWORD;
        return damagePerTick({ attack: a, strength: s, weapon: w, train: 'strength', prayers: i.prayers }, i.target, true);
    };
    const r0 = rate(i.attack, i.strength);
    const cost = (l: number) => xpForLevel(l + 1) - xpForLevel(l);
    const gainA = (rate(i.attack + 1, i.strength) - r0) / cost(i.attack);
    const gainS = (rate(i.attack, i.strength + 1) - r0) / cost(i.strength);
    return gainA > gainS ? 'attack' : 'strength';
}

/**
 * The scimitars to buy in the one shop visit, cheapest first, within `coins` (after `reserve`): each
 * tier is bought only if its predecessor is, and the trainer wields each as Attack reaches it. One
 * visit is the cheapest path in time, since Zeke is the only scimitar shop and a second visit is a
 * walk back from the training site.
 */
export function weaponPlan(coins: number, reserve = 0, shop: readonly Weapon[] = SCIMITARS): Weapon[] {
    const tiers = shop.filter(w => w.debug !== 'bronze_scimitar');
    const out: Weapon[] = [];
    let left = coins - reserve;
    for (const w of tiers) {
        if (w.cost > left) break;
        out.push(w);
        left -= w.cost;
    }
    return out;
}

/** The melee prayers the trainer uses, with their Prayer levels (prayers.dbrow) and boosts (player_combat_stat.rs2). */
export const MELEE_PRAYERS = [
    { name: 'burst_of_strength', level: 4, kind: 'strength', pct: 105 },
    { name: 'clarity_of_thought', level: 7, kind: 'attack', pct: 105 },
    { name: 'superhuman_strength', level: 13, kind: 'strength', pct: 110 },
    { name: 'improved_reflexes', level: 16, kind: 'attack', pct: 110 },
    { name: 'ultimate_strength', level: 31, kind: 'strength', pct: 115 },
    { name: 'incredible_reflexes', level: 34, kind: 'attack', pct: 115 },
    { name: 'protect_from_melee', level: 43, kind: 'protect', pct: 100 }
] as const;
export type MeleePrayer = (typeof MELEE_PRAYERS)[number]['name'];

/**
 * The prayers to keep on at Prayer `level`: the best Strength and the best Attack prayer it has, and
 * Protect from Melee too when `protect` (it zeroes npc melee damage, npc_combat_melee.rs2, so it saves
 * food, not time).
 */
export function prayersFor(level: number, protect: boolean): MeleePrayer[] {
    const best = (kind: 'strength' | 'attack') => [...MELEE_PRAYERS].reverse().find(p => p.kind === kind && p.level <= level)?.name;
    return [best('strength'), best('attack'), protect && level >= 43 ? ('protect_from_melee' as const) : undefined].filter((p): p is MeleePrayer => !!p);
}

/** The model's prayer multipliers for a set of active prayers. */
export function prayerBoost(active: readonly MeleePrayer[]): Prayers {
    const pct = (kind: string) => Math.max(100, ...MELEE_PRAYERS.filter(p => p.kind === kind && active.includes(p.name)).map(p => p.pct));
    return { attack: pct('attack'), strength: pct('strength') };
}

/** Hitpoints levels the trainer stamps on the way (the docs' table), up to and including `to`. */
export function marksFor(to: number): number[] {
    return [...new Set([30, 40, 50, 60, 70, 80, 90, 99, to])].filter(l => l <= to).sort((a, b) => a - b);
}

/**
 * Kebabs to buy for the crab phase to Hitpoints `to` from `from` (the crossing level): the damage
 * the crabs deal (0.068 per tick, measured at Defence 1, lab/hp-site.ts) over the ticks the model
 * expects, less regeneration (1 per 100 ticks) and the level-ups (each Hitpoints level adds one),
 * over a kebab's mean heal (3 hp 20 in 32, 7 hp 8 in 32, kebab.rs2: ~3.6 counting the rest as 0),
 * with a quarter spare. An estimate (i); the trainer reports what it ate.
 */
export function kebabsFor(from: number, to: number, t: Target = TARGETS.crab): number {
    if (to <= from) return 0;
    const rows = modelTicks(t, to);
    const start = from <= 10 ? 0 : (rows.find(r => r.hp >= from)?.ticks ?? modelTicks(t, from).at(-1)!.ticks);
    const ticks = rows.at(-1)!.ticks - start;
    const net = ticks * CRAB_DAMAGE_PER_TICK - ticks / 100 - (to - from);
    return Math.max(0, Math.ceil((net / kebabHeal(Math.round((from + to) / 2))) * 1.25));
}

/** Damage a Defence-1 account takes per tick at the rock crabs (m, lab/hp-site.ts: 34 in 500 ticks). */
export const CRAB_DAMAGE_PER_TICK = 0.068;

/**
 * A kebab's mean heal at base Hitpoints `base` (kebab.rs2, stat_heal(hitpoints, constant, percent of
 * base)): 20 in 32 heal 3 + 7%, 8 in 32 heal 6 + 14%, 1 in 32 heals 7 + 24%, 1 in 32 hurts up to 4,
 * and the last 2 in 32 do not heal.
 */
export function kebabHeal(base: number): number {
    const h = (c: number, pct: number) => c + Math.floor((base * pct) / 100);
    return (20 * h(3, 7) + 8 * h(6, 14) + h(7, 24) - 4) / 32;
}

/** The stopping rule: training is done once the Hitpoints base level reaches the target. */
export function reached(hitpointsBaseLevel: number, to: number): boolean {
    return hitpointsBaseLevel >= to;
}

export interface ModelRow {
    hp: number;
    ticks: number;
    attack: number;
    strength: number;
}

/**
 * Integrate the model from a fresh account (Attack and Strength 1, Hitpoints 10) to Hitpoints `to` on
 * `t`, choosing the style each step: the expected ticks at each mark. A model figure (i), for the
 * docs' comparison with the lab.
 */
export function modelTicks(t: Target, to: number, owned: readonly Weapon[] = SCIMITARS, prayers?: Prayers): ModelRow[] {
    let xa = 0;
    let xs = 0;
    let xh = xpForLevel(10);
    let ticks = 0;
    const marks = marksFor(to);
    const rows: ModelRow[] = [];
    const step = 4; // damage per integration step
    while (rows.length < marks.length) {
        const a = levelForXp(xa);
        const s = levelForXp(xs);
        const train = chooseStyle({ attack: a, strength: s, owned, target: t, prayers });
        const w = bestWeapon(a, s, owned, t) ?? BRONZE_SWORD;
        ticks += step / damagePerTick({ attack: a, strength: s, weapon: w, train, prayers }, t);
        if (train === 'attack') xa += step * STYLE_XP_PER_DAMAGE * 25;
        else xs += step * STYLE_XP_PER_DAMAGE * 25;
        xh += step * HP_XP_PER_DAMAGE * 25;
        const h = levelForXp(xh);
        while (rows.length < marks.length && h >= marks[rows.length]!) rows.push({ hp: marks[rows.length]!, ticks: Math.round(ticks), attack: levelForXp(xa), strength: levelForXp(xs) });
    }
    return rows;
}
