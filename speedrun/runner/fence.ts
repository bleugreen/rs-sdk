// Fencing an abandoned step. When the connection drops mid-step the step's
// promise cannot be cancelled: it is somewhere inside a wait or a send. The
// resumable runner starts the step again after the reconnect, and the old one
// must not act on the new session. A Fence ties everything a step attempt does
// to that attempt (AsyncLocalStorage), and once the attempt is aborted:
// - its sends are refused: every SDK send, raw or through BotActions, goes
//   through the instance's one `sendAction` (sdk/index.ts), so that is wrapped;
// - its state listeners stop firing: listeners registered inside the attempt
//   are bound to it, so a zombie wait or a listener-driven decision (trade.ts
//   reacts in onStateUpdate) sees nothing more and ends on its own backstop.
// Code outside any attempt (the runner, the session's tick tracker) is never
// touched.

import { AsyncLocalStorage } from 'node:async_hooks';

export class FencedError extends Error {
    constructor(readonly attempt: number, readonly reason: string) {
        super(`send refused: step attempt ${attempt} was abandoned (${reason})`);
        this.name = 'FencedError';
    }
}

export class Attempt {
    private readonly ac = new AbortController();
    reason = '';
    constructor(readonly id: number) {}
    get aborted(): boolean {
        return this.ac.signal.aborted;
    }
    get signal(): AbortSignal {
        return this.ac.signal;
    }
    abort(reason: string): void {
        if (this.aborted) return;
        this.reason = reason;
        this.ac.abort(reason);
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...args: any[]) => any;

/**
 * Replace `target[key]` with `make(original)` until the returned unwind is
 * called. Wrappers may unwind out of order (an abandoned step's runner finishes
 * after the next one started): a wrapper that is still on top restores what it
 * replaced, one that is not becomes a pass-through, so nobody else's wrapper is
 * ever dropped.
 */
export function patchMethod(target: object, key: string, make: (original: Fn) => Fn): () => void {
    const t = target as Record<string, unknown>;
    const original = t[key];
    if (typeof original !== 'function') throw new Error(`patchMethod: ${key} is not a method on this object`);
    const own = Object.prototype.hasOwnProperty.call(t, key);
    const call: Fn = (...args) => (original as Fn).apply(target, args);
    const inner = make(call);
    let active = true;
    const wrapper: Fn = (...args) => (active ? inner(...args) : call(...args));
    t[key] = wrapper;
    return () => {
        if (!active) return;
        active = false;
        if (t[key] !== wrapper) return;
        if (own) t[key] = original;
        else delete t[key];
    };
}

export class Fence {
    private readonly als = new AsyncLocalStorage<Attempt>();
    private next = 1;

    /** Wrap `sdk`'s sendAction and onStateUpdate. Returns the unwind. */
    install(sdk: object): () => void {
        const als = this.als;
        const unSend = patchMethod(sdk, 'sendAction', send => (action: unknown) => {
            const a = als.getStore();
            if (a?.aborted) return Promise.reject(new FencedError(a.id, a.reason));
            return send(action);
        });
        const unListen = patchMethod(sdk, 'onStateUpdate', subscribe => (listener: Fn) => {
            const a = als.getStore();
            if (!a) return subscribe(listener);
            return subscribe((...args: unknown[]) => {
                if (!a.aborted) als.run(a, () => listener(...args));
            });
        });
        return () => {
            unListen();
            unSend();
        };
    }

    open(): Attempt {
        return new Attempt(this.next++);
    }

    run<T>(attempt: Attempt, fn: () => Promise<T>): Promise<T> {
        return this.als.run(attempt, fn);
    }

    /** The attempt the calling code belongs to, if any. */
    current(): Attempt | undefined {
        return this.als.getStore();
    }
}
