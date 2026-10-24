// Markets' driver for the coin earner, speedrun/helpers/coins.ts (docs/markets/phase2.md 'Deaths').
//
// coins.ts is the scored run's code and stays as it is; this role runs it on one explicit target at a
// time and steps in where coins.ts lets a phase-2 account die:
//
// - coins.ts 'auto' picks its target only between sessions, and on the men a session has no exit but
//   death (no food, no bank, no level check), so a fresh account pickpockets them until ~40 failures
//   kill it (Thieving 46-51 on the demo, 2026-10-24). The driver picks the target itself and stops
//   coins.ts when the choice changes: the men below Thieving 25, the Al-Kharid warriors below
//   `guardLevel`, the Varrock guards from it.
// - At the food targets coins.ts eats only on the third success in a row after a stun, and at the
//   guards below ~Thieving 51 the failures' 2 damage outpaces that (`riskTable`), so hp sinks to
//   coins.ts's forced-eat floor of 3, where a kebab that heals nothing (3 rolls in 32, kebab.rs2) and
//   one more failure kill. The driver stops coins.ts at `floor` and eats up itself, one kebab a
//   3 ticks; with nothing to eat it rests where it stands (1 Hitpoint a 100 ticks).
// - coins.ts walks to the kebabs (Varrock to Al-Kharid, past the aggressive level-20 dark wizards
//   south of Varrock, all.npc bearded_dark_wizard huntrange 5) with whatever hp the food left. The
//   driver eats the last kebab before that walk, rests first if hp is under `walkHpPct` of the
//   maximum, and tops up before the walk north to the guards.
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { role as coinsRole } from '../../speedrun/helpers/coins';
import type { Role, RoleContext } from '../../speedrun/helpers/role';
import { inAlKharid, TOLL_GP, type Tile } from '../../speedrun/lib/toll-gate';
import { waitTicks } from '../../speedrun/lib/wait';
import { runRoleUntil } from '../lib/role-until.ts';

export type Target = 'man' | 'warrior' | 'guard';

/** pickpocket.dbrow: level, success_chance (low, high), fixed stun damage, coins a success. */
export const TARGETS: Readonly<Record<Target, { level: number; low: number; high: number; damage: number; gp: number }>> = {
    man: { level: 1, low: 180, high: 240, damage: 1, gp: 3 },
    warrior: { level: 25, low: 100, high: 240, damage: 2, gp: 18 },
    guard: { level: 40, low: 50, high: 240, damage: 2, gp: 30 }
};

/**
 * Phase 2's level for the guards: by `riskTable`, the lowest level at which coins.ts's own eating heals the guards'
 * damage faster than it comes (the warriors pass that at ~35). The guards earn more at every level above 30, but
 * between 40 and 50 an account loses 400-650 Hitpoints an hour to them.
 */
export const GUARD_LEVEL = 55;
/** Below this many Hitpoints on the men the driver stops and heals, to `MAN_REST_TO`. */
const MAN_FLOOR = 3;
const MAN_REST_TO = 10;
/** The Varrock guards' stand (coins.ts SPOTS.guard) and how far from it counts as there. */
const GUARD_STAND: Tile = { x: 3210, z: 3462 };
const AT_GUARDS = 30;
const FOOD = /^(kebab|shark|lobster|swordfish|tuna|salmon|trout|cake|2\/3 cake|slice of cake|bread|meat pie|half a meat pie|cooked meat|cooked chicken|shrimps)$/i;
/** Longest a rest waits before the driver lets coins.ts try again (1 Hitpoint a 100 ticks). */
const REST_MAX_TICKS = 3_000;

export interface DriverOptions {
    target: 'auto' | Target;
    guardLevel: number;
    /** Food targets: at or below this many Hitpoints (and a third of the maximum) the driver eats up itself. */
    floor: number;
    /** No walk to or from the kebabs starts below this percentage of maximum Hitpoints. */
    walkHpPct: number;
    /** Kebabs bought a trip, as coins.ts's own option (the toll and these are the coins a trip east needs). */
    kebabs: number;
    /** Everything else is passed to coins.ts unchanged (bankAt, keepCoins, reportTicks). */
    passthrough: Record<string, unknown>;
}

const DRIVER_KEYS = ['target', 'guardLevel', 'floor', 'walkHpPct'];

export function readOptions(raw: Record<string, unknown>): DriverOptions {
    const num = (k: string, d: number) => (typeof raw[k] === 'number' ? (raw[k] as number) : d);
    const target = typeof raw.target === 'string' ? (raw.target as DriverOptions['target']) : 'auto';
    if (target !== 'auto' && !(target in TARGETS)) throw new Error(`coins-driver: unknown target ${target}`);
    return {
        target,
        guardLevel: num('guardLevel', GUARD_LEVEL),
        floor: num('floor', 10),
        walkHpPct: num('walkHpPct', 60),
        kebabs: num('kebabs', 24),
        passthrough: Object.fromEntries(Object.entries(raw).filter(([k]) => !DRIVER_KEYS.includes(k)))
    };
}

export interface Standing {
    thieving: number;
    coins: number;
    food: number;
    /** East of the toll gate. */
    east: boolean;
}

/**
 * The target to run coins.ts on. coins.ts's own 'auto' order (men, warriors from 25, guards from `guardLevel`), with
 * one change: a broke account west of the toll with nothing to eat earns its toll and kebab money on the men beside
 * the respawn, where coins.ts would walk to the Varrock bank (past the dark wizards) to withdraw it.
 */
export function targetFor(i: Standing, o: Pick<DriverOptions, 'target' | 'guardLevel' | 'kebabs'>): Target {
    if (o.target !== 'auto') return o.target;
    if (i.thieving < TARGETS.warrior.level) return 'man';
    if (!i.east && i.food === 0 && i.coins < TOLL_GP + o.kebabs) return 'man';
    return i.thieving >= Math.max(o.guardLevel, TARGETS.guard.level) ? 'guard' : 'warrior';
}

export interface Condition {
    target: Target;
    hp: number;
    maxHp: number;
    food: number;
    /** Within AT_GUARDS of the guards' stand. */
    atGuards: boolean;
}

export type Step = { do: 'go' } | { do: 'eat' | 'rest'; to: number; why: string };
const GO: Step = { do: 'go' };

/** Whether coins.ts may run on, or what the driver does first. */
export function safety(c: Condition, o: Pick<DriverOptions, 'floor' | 'walkHpPct'>): Step {
    if (c.target === 'man') {
        if (c.hp > MAN_FLOOR) return GO;
        const to = Math.min(c.maxHp, MAN_REST_TO);
        return { do: c.food > 0 ? 'eat' : 'rest', to, why: 'floor' };
    }
    const floor = Math.min(o.floor, Math.floor(c.maxHp / 3));
    // a kebab heals ~6 at 40 Hitpoints (kebab.rs2): above this most of a heal is wasted
    const full = c.maxHp - 5;
    const walk = Math.ceil((c.maxHp * o.walkHpPct) / 100);
    if (c.hp <= floor) return c.food > 0 ? { do: 'eat', to: full, why: 'floor' } : { do: 'rest', to: walk, why: 'floor' };
    if (c.food === 0 && c.hp < walk) return { do: 'rest', to: walk, why: 'before the walk to the kebabs' };
    if (c.food === 1 && c.hp <= c.maxHp - 6) return { do: 'eat', to: full, why: 'the last food before the walk to the kebabs' };
    if (c.target === 'guard' && !c.atGuards && c.food > 0 && c.hp < walk) return { do: 'eat', to: full, why: 'before the walk to the guards' };
    return GO;
}

// ---------------------------------------------------------------- the risk model

/** stat_random (PlayerOps.ts STAT_RANDOM): the chance a pickpocket succeeds at `level`. */
export function successChance(level: number, low: number, high: number): number {
    const l = Math.min(level, 99);
    return Math.min(256, Math.floor((low * (99 - l)) / 98) + Math.floor((high * (l - 1)) / 98) + 1) / 256;
}

/** A kebab's mean heal at 40 Hitpoints before the cap at the maximum: 16, 11 and 5 on 1, 8 and 20 rolls in 32, less 4 and 3 on the two dodgy ones. */
export const KEBAB_MEAN_HEAL = 197 / 32;

export interface RiskRow {
    level: number;
    failPct: number;
    damagePerHour: number;
    /** What coins.ts's own eating can heal an hour (it eats on the third success in a row after a stun, then on every other success). */
    healPerHour: number;
    gpPerHour: number;
}

/**
 * Damage, coins.ts's healing and coins an hour on a target by level, at `ticksPerHour`. A model (i): a success
 * takes 2 ticks and a failure 11 (coins.ts), bank and food trips are left out, and an eat the server drops in a
 * pickpocket's delay counts as eaten, so the healing is an upper bound.
 */
export function riskTable(target: Target, levels: readonly number[], ticksPerHour = 9_000): RiskRow[] {
    const t = TARGETS[target];
    return levels.map(level => {
        const p = successChance(level, t.low, t.high);
        const f = 1 - p;
        const attempts = ticksPerHour / (2 * p + 11 * f);
        const eatsPerFailure = f > 0 ? p ** 3 * (1 + p / f / 2) : 0;
        return {
            level,
            failPct: Math.round(f * 100),
            damagePerHour: Math.round(attempts * f * t.damage),
            healPerHour: target === 'man' ? 0 : Math.round(attempts * f * eatsPerFailure * KEBAB_MEAN_HEAL),
            gpPerHour: Math.round(attempts * p * t.gp)
        };
    });
}

// ---------------------------------------------------------------- the role

const foodIn = (s: BotWorldState): InventoryItem[] => s.inventory.filter(i => FOOD.test(i.name) && i.optionsWithIndex.some(o => /^eat$/i.test(o.text)));
const coinsIn = (s: BotWorldState) => s.inventory.filter(i => /^coins$/i.test(i.name)).reduce((n, i) => n + i.count, 0);
const thievingOf = (s: BotWorldState) => s.skills.find(k => k.name === 'Thieving')?.baseLevel ?? 1;
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

function standing(s: BotWorldState): Standing {
    return { thieving: thievingOf(s), coins: coinsIn(s), food: foodIn(s).length, east: inAlKharid(s) };
}

function condition(s: BotWorldState, target: Target): Condition {
    const p = s.player!;
    return { target, hp: p.hp, maxHp: p.maxHp, food: foodIn(s).length, atGuards: cheb({ x: p.worldX, z: p.worldZ }, GUARD_STAND) <= AT_GUARDS };
}

const alive = (s: BotWorldState | null): s is BotWorldState => !!s?.player && !s.player.isDead && s.player.hp > 0;

async function dismiss(ctx: RoleContext): Promise<void> {
    const s = ctx.sdk.getState();
    if (s?.dialog.isOpen) await ctx.sdk.sendClickDialog(0);
    if (s?.shop.isOpen) await ctx.bot.closeShop();
    if (s?.interface?.isOpen) await ctx.sdk.sendCloseModal();
}

/** Eat one food a 3 ticks (a kebab's eat delay is 2, consume.rs2) until hp reaches `to`. Returns the food eaten. */
async function eatTo(ctx: RoleContext, to: number): Promise<number> {
    let eaten = 0;
    for (let tries = 0; tries < 40 && !ctx.signal.aborted; tries++) {
        const s = ctx.sdk.getState();
        if (!alive(s) || s.player!.hp >= to) break;
        const food = foodIn(s)[0];
        const op = food?.optionsWithIndex.find(o => /^eat$/i.test(o.text));
        if (!food || !op) break;
        if (s.dialog.isOpen) await ctx.sdk.sendClickDialog(0);
        const before = foodIn(s).length;
        await ctx.sdk.sendUseItem(food.slot, op.opIndex);
        const after = await waitTicks(ctx.sdk, 3);
        if (foodIn(after).length < before) eaten++;
    }
    return eaten;
}

/** Stand and regenerate until hp reaches `to`, at most REST_MAX_TICKS. */
async function restTo(ctx: RoleContext, to: number): Promise<void> {
    for (let waited = 0; waited < REST_MAX_TICKS && !ctx.signal.aborted; waited += 10) {
        const s = ctx.sdk.getState();
        if (!alive(s) || s.player!.hp >= to) return;
        if (s.dialog.isOpen) await ctx.sdk.sendClickDialog(0);
        await waitTicks(ctx.sdk, 10);
    }
}

async function waitAlive(sdk: BotSDK): Promise<void> {
    await sdk.waitForCondition(s => alive(s), 60_000).catch(() => undefined);
}

async function drive(ctx: RoleContext): Promise<void> {
    const o = readOptions(ctx.options);
    await ctx.sdk.waitForCondition(s => (s.player?.worldX ?? 0) > 0, 60_000);
    let phase: Target | null = null;
    const totals = { eats: 0, rests: 0, restTicks: 0, stops: {} as Record<string, number> };
    while (!ctx.signal.aborted) {
        let s = ctx.sdk.getState()!;
        if (!alive(s)) {
            await waitAlive(ctx.sdk);
            await waitTicks(ctx.sdk, 3);
            continue;
        }
        const target = targetFor(standing(s), o);
        if (target !== phase) {
            ctx.log('phase', { from: phase, to: target, levels: { thieving: thievingOf(s), hitpoints: s.player!.maxHp }, hp: s.player!.hp, coins: coinsIn(s), food: foodIn(s).length });
            phase = target;
        }
        const step = safety(condition(s, target), o);
        if (step.do !== 'go') {
            await dismiss(ctx);
            const hp0 = s.player!.hp;
            const t0 = s.tick;
            if (step.do === 'eat') {
                const n = await eatTo(ctx, step.to);
                totals.eats += n;
                s = ctx.sdk.getState()!;
                ctx.log('ate', { why: step.why, target, from: hp0, to: s.player!.hp, want: step.to, eaten: n, left: foodIn(s).length });
                // food that would not go down: rest instead of trying it again at once
                if (n === 0) await restTo(ctx, Math.min(step.to, hp0 + 2));
            } else {
                ctx.log('resting', { why: step.why, target, hp: hp0, until: step.to });
                await restTo(ctx, step.to);
                totals.rests++;
                totals.restTicks += (ctx.sdk.getState()?.tick ?? t0) - t0;
            }
            continue;
        }
        const why = await runRoleUntil(coinsRole, { ...ctx, options: { ...o.passthrough, kebabs: o.kebabs, target } }, st => {
            if (!alive(st)) return null; // coins.ts handles its own death
            if (targetFor(standing(st), o) !== target) return 'target';
            const next = safety(condition(st, target), o);
            return next.do === 'go' ? null : next.why;
        });
        totals.stops[why] = (totals.stops[why] ?? 0) + 1;
        // let the stopped coins.ts's last click resolve before acting on the account
        await waitTicks(ctx.sdk, 2);
    }
    ctx.log('driver totals', totals);
}

export const role: Role = {
    name: 'coins',
    produces: [/^Coins$/],
    run: drive
};
