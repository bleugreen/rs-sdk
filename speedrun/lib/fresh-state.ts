// Game state from the client session that is live now, not one cached from before it.
//
// An SDK can hold, and be handed, state that no live client published. The
// gateway keeps each bot's last state across client sessions and replays it to
// every SDK that connects; an SDK that stays connected across a client re-login
// (a fleet relaunch, a demo outage) keeps the old session's last state, inGame
// and all, until the new client publishes. Read at the wrong moment, such a
// state reports an inventory, position or bank the account no longer has.
//
// Shape checks pass those states, and so does "the tick changed", because every
// client session starts its tick count again. What a cache or a replay cannot
// produce is two in-game states, both arriving after the wait began, with the
// tick advancing between them: that takes a client publishing tick after tick.
// The rule needs no clocks, so it holds through a remote gateway as well as the
// fleet's loopback one.

import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';

export interface FreshState {
    /** The second state of the first advancing pair: what a role may start on. */
    state: BotWorldState;
    /** Ticks of the in-game states set aside before that pair, the one the SDK held when the wait began first. */
    passedOver: number[];
}

export interface FreshStateOptions {
    timeoutMs: number;
    /** Rejects the wait with the signal's reason. */
    signal?: AbortSignal;
}

/**
 * Resolve with the first state published by a live client after this call:
 * the later of two in-game states that arrive after it with an advancing tick.
 * Call it after every (re)login before a role starts, and after a mid-session
 * reconnect (`reconnectAfterOutage` or `login` resolving, or the SDK's
 * connection state returning to 'connected') before deciding anything from
 * inventory, bank or position.
 */
export function waitForFreshState(
    sdk: Pick<BotSDK, 'getState' | 'onStateUpdate'>,
    opts: FreshStateOptions
): Promise<FreshState> {
    const held = sdk.getState();
    const passedOver: number[] = held && inWorld(held) ? [held.tick] : [];
    return new Promise((resolve, reject) => {
        let prev: BotWorldState | null = null;
        const setAside = () => {
            if (prev && passedOver[passedOver.length - 1] !== prev.tick) passedOver.push(prev.tick);
        };
        const finish = (settle: () => void) => {
            clearTimeout(timer);
            unsubscribe();
            opts.signal?.removeEventListener('abort', onAbort);
            settle();
        };
        const onAbort = () => finish(() => reject(opts.signal!.reason ?? new Error('aborted')));
        const timer = setTimeout(() => {
            setAside();
            const seen = passedOver.length ? `; in-game ticks seen: ${passedOver.join(', ')}` : '; no in-game state seen';
            finish(() => reject(new Error(`no fresh game state within ${opts.timeoutMs / 1000}s${seen}`)));
        }, opts.timeoutMs);
        const unsubscribe = sdk.onStateUpdate(s => {
            if (!inWorld(s)) {
                setAside();
                prev = null;
                return;
            }
            if (prev && s.tick > prev.tick) {
                finish(() => resolve({ state: s, passedOver }));
                return;
            }
            // A repeat of the same tick (a replay, or a second publication in one tick) keeps waiting for the advance.
            if (prev && s.tick !== prev.tick) setAside();
            prev = s;
        });
        if (opts.signal?.aborted) onAbort();
        else opts.signal?.addEventListener('abort', onAbort, { once: true });
    });
}

/** One log line's worth: `tick 2 (passed over 9000): inventory 1 stacks; Bronze arrow x1`. */
export function describeFreshState({ state, passedOver }: FreshState): string {
    const top = [...state.inventory].sort((a, b) => b.count - a.count).slice(0, 4);
    const skipped = passedOver.length ? ` (passed over ${passedOver.join(', ')})` : '';
    return `tick ${state.tick}${skipped}: inventory ${state.inventory.length} stacks; ${top.map(i => `${i.name} x${i.count}`).join(', ')}`;
}

function inWorld(s: BotWorldState): boolean {
    return s.inGame && !!s.player;
}
