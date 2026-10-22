// The run toggle (player controls, varp `option_run`). The engine runs a move
// when the toggle is on or when the move click carries the client's ctrl-run
// flag (Player.ts, MoveClickHandler.ts). Our walker sends every walk with that
// flag, but an op-click on a loc, NPC, obstacle or ground item at a distance
// carries none, so its approach walks at one tile a tick unless the toggle is
// on. NODE_INFINITE_RUN only keeps the energy full; it does not turn running on.
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
}

/**
 * Make the run toggle read `on`, confirmed from published state: nothing is
 * sent when it already does; otherwise press the button, wait up to
 * RUN_CONFIRM_TICKS for `varps.option_run` to follow, press once more, and
 * throw a RunToggleError if it still disagrees. Also throws when the client
 * does not publish the varp, since the result could not be confirmed.
 */
export async function ensureRun(sdk: RunSdk, on: boolean): Promise<EnsureRunResult> {
    const s = sdk.getState();
    if (!s?.inGame) throw new RunToggleError(`cannot set run ${on ? 'on' : 'off'}: not in the world`);
    if (onTutorialIsland(s.player)) return { on: runIsOn(s), presses: 0, unavailable: 'tutorial-island' };
    const now = runIsOn(s);
    if (now === null) throw new RunToggleError('cannot confirm the run toggle: this client does not publish varps.option_run (update the client)');
    if (now === on) return { on, presses: 0 };
    let reason = '';
    for (let press = 1; press <= RUN_PRESSES; press++) {
        await sdk.sendClickComponent(on ? IF_RUN_ON : IF_RUN_OFF);
        const r = await waitUntil(sdk, st => runIsOn(st) === on, { maxTicks: RUN_CONFIRM_TICKS });
        if (r.ok) return { on, presses: press };
        reason = r.reason === 'idle' ? STALLED : `still ${on ? 'off' : 'on'} ${RUN_CONFIRM_TICKS} ticks later`;
    }
    const energy = sdk.getState()?.player?.runEnergy;
    throw new RunToggleError(
        `run did not turn ${on ? 'on' : 'off'} after ${RUN_PRESSES} presses (${reason}; run energy ${energy ?? '?'}): ` +
            'the server ignores the button while the player is busy (p_finduid) and turns run off below 1% energy'
    );
}

/** ensureRun(sdk, true): the state every login leaves the scored account in. */
export function ensureRunOn(sdk: RunSdk): Promise<EnsureRunResult> {
    return ensureRun(sdk, true);
}
