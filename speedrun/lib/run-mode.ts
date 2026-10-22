// The run toggle (player controls, varp `option_run`). The engine runs a move
// when the toggle is on or when the move click carries the client's ctrl-run
// flag (Player.ts, MoveClickHandler.ts). Both clients send walks and op-click
// routes with that flag, so the toggle decides the pace only where the engine
// moves the player without a fresh client route: its own re-path to an NPC or
// player target, and content p_walk (lab/measure-run-approach.ts). That is why
// a toggle that will not take is recorded and warned on the scored path, never
// fatal: ensureRunOn. ensureRun throws, for callers whose result depends on it.
// NODE_INFINITE_RUN only keeps the energy full; it does not turn running on.
// `option_run` is not `scope=perm` (player_controls.varp), so every login starts
// with it off: whoever brings the account into the world turns it on again.
//
// The buttons (player_controls.rs2) are not free to press blind:
// - both run `if_close` (an open bank, shop or dialogue closes) and
//   `p_clearpendingaction` (a queued interaction is dropped), so ensureRun sends
//   only when the published varp disagrees;
// - while the player is busy (`p_finduid` fails) or below 1% energy the button
//   only resyncs the varp, so the effect is confirmed from state and re-sent once;
// - on Tutorial Island the controls tab is unset until a late tutorial stage
//   (tutorial.rs2) and the server drops a click on a hidden component
//   (IfButtonHandler `isComponentVisible`), so there it is reported unavailable
//   instead of tried; S00 turns run on once it lands in Lumbridge.

import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import { STALLED, waitUntil, type StateSource } from './wait';
import { onTutorialIsland } from './world';

/** Player controls tab buttons (server/content/pack/interface.pack: 152=controls:com_4, 153=controls:com_5). */
export const IF_RUN_OFF = 152;
export const IF_RUN_ON = 153;

/** Ticks to wait for the varp after each press (the reply lands the next tick at 300 ms, ~2 ticks at 100 ms). */
export const RUN_CONFIRM_TICKS = 4;
/** Presses before giving up: the first, and one re-send. */
export const RUN_PRESSES = 2;

export type RunSdk = StateSource & Pick<BotSDK, 'sendClickComponent'>;

/** The published run toggle: true on, false off, null when the client does not publish `varps.option_run`. */
export function runIsOn(s: BotWorldState | null | undefined): boolean | null {
    const v = s?.varps?.option_run;
    return v === undefined ? null : v !== 0;
}

export class RunToggleError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RunToggleError';
    }
}

export interface EnsureRunResult {
    /** The toggle as published when ensureRun returned (null: unavailable and unpublished). */
    on: boolean | null;
    /** Button presses sent (0 when it already read as asked, or was unavailable). */
    presses: number;
    /** Set when nothing was tried because the button cannot work here. */
    unavailable?: 'tutorial-island';
    /** Set when the toggle is not confirmed as asked: it would not take, or the client does not publish it. */
    reason?: string;
}

/**
 * Press the toggle toward `on` and confirm it from published state: nothing is
 * sent when it already reads so; otherwise press, wait up to RUN_CONFIRM_TICKS
 * for `varps.option_run` to follow, and press once more. A toggle still
 * unconfirmed comes back with `reason`; only a player out of the world throws.
 */
async function setRun(sdk: RunSdk, on: boolean): Promise<EnsureRunResult> {
    const s = sdk.getState();
    if (!s?.inGame) throw new RunToggleError(`cannot set run ${on ? 'on' : 'off'}: not in the world`);
    if (onTutorialIsland(s.player)) return { on: runIsOn(s), presses: 0, unavailable: 'tutorial-island' };
    const now = runIsOn(s);
    if (now === null) return { on: null, presses: 0, reason: 'cannot confirm the run toggle: this client does not publish varps.option_run (update the client)' };
    if (now === on) return { on, presses: 0 };
    let why = '';
    for (let press = 1; press <= RUN_PRESSES; press++) {
        await sdk.sendClickComponent(on ? IF_RUN_ON : IF_RUN_OFF);
        const r = await waitUntil(sdk, st => runIsOn(st) === on, { maxTicks: RUN_CONFIRM_TICKS });
        if (r.ok) return { on, presses: press };
        why = r.reason === 'idle' ? STALLED : `still ${on ? 'off' : 'on'} ${RUN_CONFIRM_TICKS} ticks later`;
    }
    const st = sdk.getState();
    return {
        on: runIsOn(st),
        presses: RUN_PRESSES,
        reason:
            `run did not turn ${on ? 'on' : 'off'} after ${RUN_PRESSES} presses (${why}; run energy ${st?.player?.runEnergy ?? '?'}): ` +
            'the server ignores the button while the player is busy (p_finduid) and turns run off below 1% energy',
    };
}

/**
 * Make the run toggle read `on`, or throw a RunToggleError (with setRun's
 * reason) when it cannot be confirmed so. For callers whose result depends on
 * the toggle: the lab's `running: false` opt-out (runner/step.ts) and A/B scripts.
 */
export async function ensureRun(sdk: RunSdk, on: boolean): Promise<EnsureRunResult> {
    const r = await setRun(sdk, on);
    if (r.reason) throw new RunToggleError(r.reason);
    return r;
}

/**
 * Turn run on wherever the account comes back into the world. Best effort: a
 * toggle that will not take, or an unpublished varp, is returned in `reason`
 * and passed to `warn`, never thrown, because a client-routed approach runs
 * either way and stopping the scored run would cost far more than walking an
 * engine re-path. Throws only when the player is not in the world (a caller bug).
 */
export async function ensureRunOn(sdk: RunSdk, warn: (msg: string) => void = m => console.warn(m)): Promise<EnsureRunResult> {
    const r = await setRun(sdk, true);
    if (r.reason) warn(`[speedrun] run toggle not confirmed on, continuing: ${r.reason}`);
    return r;
}
