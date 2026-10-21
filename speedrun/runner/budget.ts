// The per-tick packet budget a step boundary hands off against.
//
// The engine decodes at most 5 accepted user-event packets per player per tick
// and leaves the rest buffered, in order, for the next tick
// (server/engine/src/engine/entity/NetworkPlayer.ts decodeIn; the limits are in
// ClientGameProtCategory.ts). The client puts an SDK action's packets on the wire
// before it acknowledges the action, so the SDK side can keep the books from its
// own dispatch and acknowledge traffic:
//
// - the window is the tick label of the latest published state; a packet sent
//   while tick N is the latest lands on the server's next tick;
// - `sent` counts actions acknowledged in this window;
// - `pending` counts actions dispatched and not yet acknowledged, which are on
//   their way out and spend this window's budget;
// - `carry` is what earlier windows sent beyond what the server has decoded since,
//   at 5 per elapsed tick.
//
// The count errs high: a packet the server refuses spends no user slot, and an
// action that is acknowledged a window late is booked to the later one. Erring
// high costs at most the one-tick wait the runner would otherwise have taken.

export const USER_EVENTS_PER_TICK = 5;

/** SDK action types that put no game packet on the wire. */
const NO_PACKET = new Set(['none', 'wait', 'scanNearbyLocs', 'scanGroundItems']);

export interface WindowSnapshot {
    tick: number;
    sent: number;
    pending: number;
    carry: number;
    free: number;
}

export class TickWindow {
    private label: number;
    private openedAt: number;
    private sent = 0;
    private pending = 0;
    private carry = 0;

    constructor(tick: number, openedAt: number) {
        this.label = tick;
        this.openedAt = openedAt;
    }

    /** Feed every published state's tick; a new label opens a new window. */
    observe(tick: number, now: number): void {
        if (tick === this.label) return;
        // A label that goes backwards is a client relaunch: the old socket's buffer is gone.
        this.carry = tick > this.label && this.label >= 0
            ? Math.max(0, this.carry + this.sent - USER_EVENTS_PER_TICK * (tick - this.label))
            : 0;
        this.sent = 0;
        this.label = tick;
        this.openedAt = now;
    }

    dispatched(): void {
        this.pending++;
    }

    acknowledged(): void {
        this.pending = Math.max(0, this.pending - 1);
        this.sent++;
    }

    /** User events this window can still send that the server decodes on its next tick. */
    free(): number {
        return Math.max(0, USER_EVENTS_PER_TICK - this.carry - this.sent - this.pending);
    }

    /** Wall time since the current label was first published. */
    ageMs(now: number): number {
        return now - this.openedAt;
    }

    snapshot(): WindowSnapshot {
        return { tick: this.label, sent: this.sent, pending: this.pending, carry: this.carry, free: this.free() };
    }
}

type Dispatch = (action: unknown) => Promise<unknown>;

/**
 * Book every action `sdk` dispatches into `window` until the returned function
 * is called. Every SDK send, raw or through `BotActions`, goes through the one
 * dispatch method BotSDK keeps private as `sendAction` (sdk/index.ts), so this
 * wraps it on the instance; it throws if that method is missing rather than
 * silently counting nothing.
 */
export function meterDispatch(sdk: object, window: TickWindow): () => void {
    const target = sdk as { sendAction?: Dispatch };
    const original = target.sendAction;
    if (typeof original !== 'function') {
        throw new Error('meterDispatch: the SDK has no sendAction to meter (was it renamed in sdk/index.ts?)');
    }
    const own = Object.prototype.hasOwnProperty.call(target, 'sendAction');
    target.sendAction = (action: unknown) => {
        const type = (action as { type?: unknown } | null)?.type;
        if (typeof type === 'string' && NO_PACKET.has(type)) return original.call(sdk, action);
        window.dispatched();
        const p = original.call(sdk, action);
        const settle = () => window.acknowledged();
        p.then(settle, settle);
        return p;
    };
    return () => {
        if (own) target.sendAction = original;
        else delete target.sendAction;
    };
}
