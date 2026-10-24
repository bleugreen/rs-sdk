/**
 * What each stage of an account's setup sequence (plan.ts `sequenceFor`) does on a live session, and when its goal
 * already holds. Every stage reuses the code that owns the skill: Tutorial Island through S00's `tutorialSkip`,
 * Hitpoints through hp-train.ts, Thieving and coins through speedrun/helpers/coins.ts (the lite-client earner; the
 * thieving.ts bands need the browser's page programs) under markets' coins-driver.ts, which owns its target switch
 * and keeps a phase-2 account's Hitpoints off coins.ts's death paths, Mining through speedrun/skills/mining.ts's lite-client steps,
 * the ship to Ardougne through thieving.ts's `thieving:to-ardougne` leg, and each method through its Role.
 *
 * A stage whose goal holds is skipped, so the runner recomputes the first unmet stage after anything that can undo
 * one (a death in the market loses the ship coins and the place; a redirect changes the method).
 */
import type { BotActions } from '../../sdk/actions';
import { executionContext } from '../../sdk/execution-context';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import type { Role, RoleState } from '../../speedrun/helpers/role';
import type { RunnerSession } from '../../speedrun/runner/step';
import { steps as miningSteps } from '../../speedrun/skills/mining';
import { tutorialSkip } from '../../speedrun/skills/start';
import { steps as thievingSteps } from '../../speedrun/skills/thieving';
import { crossTollGate, inAlKharid } from '../../speedrun/lib/toll-gate';
import { waitUntil } from '../../speedrun/lib/wait';
import { onTutorialIsland } from '../../speedrun/lib/world';
import { runRoleUntil as runRole } from '../lib/role-until.ts';
import { role as coinsRole } from '../methods/coins-driver.ts';
import { driveSteps, pickSteps } from '../methods/drive-steps.ts';
import { parseOptions as hpOptions, spec as hpTrain } from '../methods/hp-train.ts';
import { role as mineRole } from '../methods/mine.ts';
import { role as pickpocketRole } from '../methods/pickpocket.ts';
import { parseArgs, Sampler } from '../methods/probe-sampler.ts';
import type { Stack } from './ledger.ts';
import { NEEDS, type MethodId, type Stage } from './plan.ts';

export interface StageHooks {
    /** The knights ramp has admitted this login (always true off the ramp). */
    admitted(): boolean;
    /** The account has no sharks to eat: the runner sends it to the low-food fallback. */
    foodOut(reason: string): void;
    /** The shark purchase errand (errands.ts) with the plan's settings. */
    buySharks(): Promise<void>;
}

export interface StageCtx {
    /** The real name: given to the code that logs in and to RoleContext, never written to output. */
    account: string;
    sessionId: number;
    sdk: BotSDK;
    bot: BotActions;
    env: { SERVER?: string; [k: string]: string | undefined };
    /** Aborted by a stop, a session end, or a redirect of this account. */
    signal: AbortSignal;
    roleState: RoleState;
    /** Role options for the account's method (plan.ts roleOptions). */
    options: Record<string, unknown>;
    event(message: string, data?: Record<string, unknown>): void;
    reportBank(items: Stack[]): void;
    hooks: StageHooks;
}

export const level = (s: BotWorldState, skill: string): number => s.skills.find(k => k.name.toLowerCase() === skill)?.baseLevel ?? 1;
export const carriedCoins = (s: BotWorldState): number => s.inventory.filter(i => /^coins$/i.test(i.name)).reduce((n, i) => n + i.count, 0);
const PICKAXE = /pickaxe$/i;

/**
 * West of the Ardougne docks and south of the Kandarin towns, on the ground: East Ardougne's market and bank, the zoo
 * iron cluster south of it, and the ship's landing. Where the knights, heroes and iron methods work.
 */
export function onArdougneSide(s: Pick<BotWorldState, 'player'>): boolean {
    const p = s.player;
    return !!p && p.level === 0 && p.worldX >= 2560 && p.worldX <= 2720 && p.worldZ >= 3200 && p.worldZ <= 3340;
}

/** Whether the stage's goal already holds. 'method' never does: it runs until the account is stopped or redirected. */
export function stageDone(st: Stage, s: BotWorldState, hooks: Pick<StageHooks, 'admitted'>, roleState: Pick<RoleState, 'get'>): boolean {
    switch (st.do) {
        case 'tutorial':
            return !onTutorialIsland(s.player);
        case 'hp':
            return level(s, 'hitpoints') >= st.to;
        case 'thieving':
            return level(s, 'thieving') >= st.to;
        // on the Ardougne side the ship's coins are spent and not needed again
        case 'coins':
            return carriedCoins(s) >= st.n || onArdougneSide(s);
        case 'mining':
            return level(s, 'mining') >= st.to;
        case 'wield':
            return s.equipment.some(e => PICKAXE.test(e.name));
        case 'admission':
            return hooks.admitted();
        case 'buy-sharks':
            return roleState.get(SHARKS_KEY) !== undefined;
        case 'to-ardougne':
            return onArdougneSide(s);
        case 'method':
            return false;
    }
}

/** RoleState key the shark errand records its outcome under (once per account). */
export const SHARKS_KEY = 'phase2.sharks';

export const ROLES: Readonly<Record<MethodId, Role>> = {
    knights: pickpocketRole,
    heroes: pickpocketRole,
    guards: coinsRole,
    iron: mineRole,
    shilo: mineRole
};

/**
 * thieving.ts's ship leg to East Ardougne. The leg counts itself done once Thieving reaches the steps' `to`, so it is
 * asked for a level no account reaches: a knight at Thieving 99 that died in the market (it respawns in Lumbridge)
 * must still sail back, and with `to: 99` the leg returned at once and the account was given up.
 */
const ARDOUGNE_LEG = pickSteps(thievingSteps({ to: Number.POSITIVE_INFINITY }), ['thieving:to-ardougne'])[0]!;

const stepSession = (x: StageCtx): RunnerSession => ({ sdk: x.sdk, bot: x.bot, name: x.account, sessionId: x.sessionId });

/** Run one stage on the account. Throws when it fails; returns early (aborted) when `x.signal` aborts. */
export async function runStage(st: Stage, x: StageCtx, method: MethodId): Promise<void> {
    switch (st.do) {
        case 'tutorial':
            await driveSteps(stepSession(x), [tutorialSkip], { c: {}, signal: x.signal });
            return;
        case 'hp':
            return trainHp(x, st.to);
        case 'thieving':
            await runRoleUntil(x, coinsRole, { target: 'auto' }, s => (level(s, 'thieving') >= st.to ? `Thieving ${st.to}` : null));
            return;
        case 'coins':
            // the Lumbridge men: 3 gp a success at any level, on the way to Port Sarim
            await runRoleUntil(x, coinsRole, { target: 'man' }, s => (carriedCoins(s) >= st.n ? `${st.n} coins` : null));
            return;
        case 'mining':
            await leaveAlKharid(x);
            await driveSteps(stepSession(x), miningSteps({ to: st.to, travel: 'none' }), { c: {}, signal: x.signal });
            return;
        case 'wield':
            return wield(x, PICKAXE);
        case 'admission':
            // earn on the Varrock guards until the ramp admits this login
            await runRoleUntil(x, coinsRole, { target: 'auto' }, () => (x.hooks.admitted() ? 'admitted' : null));
            return;
        case 'buy-sharks':
            await leaveAlKharid(x);
            return x.hooks.buySharks();
        case 'to-ardougne':
            await leaveAlKharid(x);
            await driveSteps(stepSession(x), [ARDOUGNE_LEG], { c: {} as never, signal: x.signal });
            return;
        case 'method':
            return runMethod(x, method);
    }
}

/** Ticks off the Ardougne side, alive, before a market method is stopped so the stages can bring it back. */
export const AWAY_TICKS = 10;

async function runMethod(x: StageCtx, method: MethodId): Promise<void> {
    const needs = NEEDS[method];
    let awaySince: number | null = null;
    const why = await runRoleUntil(
        x,
        ROLES[method],
        x.options,
        s => {
            if (!needs.ardougne || s.player!.isDead || s.player!.hp <= 0) return null;
            if (onArdougneSide(s)) {
                awaySince = null;
                return null;
            }
            awaySince ??= s.tick;
            return s.tick - awaySince >= AWAY_TICKS ? 'off the Ardougne side (a death respawns in Lumbridge)' : null;
        },
        message => {
            if (needs.sharks && message === 'out of food in the bank') x.hooks.foodOut('the bank has no sharks left');
        }
    );
    x.event('method stopped', { method, why });
}

/**
 * Run `role` until `stop` names a reason (checked on every published state), the role returns, or `x.signal` aborts
 * (rethrown). Returns the reason, or 'returned'.
 */
export async function runRoleUntil(
    x: StageCtx,
    role: Role,
    options: Record<string, unknown>,
    stop?: (s: BotWorldState) => string | null,
    onLog?: (message: string, data?: Record<string, unknown>) => void
): Promise<string> {
    return runRole(
        role,
        {
            bot: x.bot,
            sdk: x.sdk,
            account: x.account,
            options,
            log: (message, data) => {
                x.event(`${role.name}: ${message}`, data);
                onLog?.(message, data);
            },
            reportBank: b => x.reportBank(b.items),
            signal: x.signal,
            state: x.roleState
        },
        stop
    );
}

/** hp-train.ts's trainer to `to`, its events into the account's events; its 50-tick samples are the ledger's job. */
async function trainHp(x: StageCtx, to: number): Promise<void> {
    const options = hpOptions(parseArgs([x.account, '--to', String(to)]));
    const sampler = new Sampler(x.sdk, () => undefined, hpTrain.name, hpTrain.items);
    sampler.start();
    const totals: Record<string, unknown> = {};
    try {
        await executionContext.run({ signal: x.signal }, () =>
            hpTrain.run({
                session: { name: x.account, sessionId: x.sessionId, sdk: x.sdk, bot: x.bot, env: x.env },
                sdk: x.sdk,
                bot: x.bot,
                options,
                signal: x.signal,
                sampler,
                totals,
                event: (m, d) => x.event(`hp-train: ${m}`, d)
            })
        );
    } finally {
        sampler.stop();
        x.event('hp-train totals', { totals, phaseTicks: sampler.phaseTicks });
    }
}

async function wield(x: StageCtx, item: RegExp): Promise<void> {
    const s = x.sdk.getState()!;
    const it = s.inventory.find(i => item.test(i.name));
    const op = it?.optionsWithIndex.find(o => /^(wield|wear)$/i.test(o.text));
    if (!it || !op) throw new Error(`nothing matching ${item} to wield`);
    await x.sdk.sendUseItem(it.slot, op.opIndex);
    await waitUntil(x.sdk, st => st.equipment.some(e => item.test(e.name)), { maxTicks: 10 });
}

/** Back west through the toll gate (10 coins): the thieving stage can end among the Al-Kharid warriors. */
export async function leaveAlKharid(x: StageCtx): Promise<void> {
    const s = x.sdk.getState();
    if (!s?.player || !inAlKharid(s)) return;
    const r = await crossTollGate(x.bot, x.sdk, false, (m, d) => x.event(m, d));
    if (!r.ok) throw new Error(`could not leave Al-Kharid: ${r.reason ?? 'the toll gate'}`);
}
