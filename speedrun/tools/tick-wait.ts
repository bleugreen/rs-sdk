// Wait for a number of observed game ticks after a cue, for launches placed against the droppers'
// clock (the Firemaking row: the account's harness starts so that its login lands just after log 0
// turns public at T0 + 101 ticks). The demo's tick is not 300 ms: it ran 0.34-0.37 s in rs/269's
// attempt (161-177 ticks a minute), so a wall-clock T0 + N x 300 ms launch came about 20 ticks early.
// This reads the tick an armed dropper's client publishes, through its loopback gateway in observe
// mode (no actions, no takeover of the role's control session).
//
//   bun speedrun/tools/tick-wait.ts <account>@<gateway port> --bots-dir=<dir> --cue=<go file> --after=<ticks>
//       [--timeout-s=600]
//
// It takes the tick at which the go file appears as T0 (start it before the cue is written), prints
// `[tick-wait] cue at tick X`, then exits 0 the first tick at or past X + after, printing
// `[tick-wait] T0+N at tick Y`. 3 on a timeout or a stalled tick, 2 on usage or connection error.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK } from '../../sdk/index';
import { parseBotEnv } from '../helpers/accounts';

/** A tick source read by polling: `read` returns the latest observed tick, or null before the first. */
export class TickClock {
    constructor(
        private readonly read: () => number | null,
        private readonly sleep: (ms: number) => Promise<unknown> = ms => Bun.sleep(ms)
    ) {}

    now(): number | null {
        return this.read();
    }

    /**
     * Resolve with the first observed tick at or past `target`. Rejects when the tick stops advancing
     * for `stallMs` (the observer lost its client) or after `timeoutMs`.
     */
    async at(target: number, o: { pollMs?: number; stallMs?: number; timeoutMs?: number; clock?: () => number } = {}): Promise<number> {
        const pollMs = o.pollMs ?? 25;
        const stallMs = o.stallMs ?? 10_000;
        const clock = o.clock ?? Date.now;
        const until = clock() + (o.timeoutMs ?? 600_000);
        let last = this.read();
        let lastChange = clock();
        for (;;) {
            const t = this.read();
            if (t !== null && t >= target) return t;
            const ms = clock();
            if (t !== last) {
                last = t;
                lastChange = ms;
            } else if (ms - lastChange > stallMs) throw new Error(`the tick stalled at ${t} for ${ms - lastChange} ms before ${target}`);
            if (ms > until) throw new Error(`timed out at tick ${t} before ${target}`);
            await this.sleep(pollMs);
        }
    }
}

/** An observe-mode connection to a client's loopback gateway, as a TickClock. */
export async function observeTicks(account: string, gatewayUrl: string, password: string): Promise<{ clock: TickClock; close: () => Promise<void> }> {
    const sdk = new BotSDK({ botUsername: account, password, gatewayUrl, connectionMode: 'observe', autoLaunchBrowser: false, autoReconnect: false, readyTimeout: 15_000, showChat: false });
    await sdk.connect();
    return { clock: new TickClock(() => sdk.getState()?.tick ?? null), close: () => sdk.disconnect().catch(() => {}) };
}

if (import.meta.main) {
    const argv = process.argv.slice(2);
    const flag = (k: string) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
    const target = argv.find(a => !a.startsWith('--'));
    const [account, port] = (target ?? '').split('@');
    const botsDir = flag('bots-dir');
    const cue = flag('cue');
    const after = Number(flag('after'));
    const timeoutMs = Number(flag('timeout-s') ?? '600') * 1000;
    if (!account || !Number.isInteger(Number(port)) || !botsDir || !cue || !Number.isInteger(after) || after < 0) {
        console.error('usage: bun speedrun/tools/tick-wait.ts <account>@<gateway port> --bots-dir=<dir> --cue=<go file> --after=<ticks> [--timeout-s=600]');
        process.exit(2);
    }
    let obs: Awaited<ReturnType<typeof observeTicks>>;
    try {
        const env = parseBotEnv(readFileSync(join(botsDir, account, 'bot.env'), 'utf8'));
        obs = await observeTicks(account, `ws://127.0.0.1:${port}`, env.PASSWORD ?? '');
    } catch (e) {
        console.error(`[tick-wait] ${account}@${port}: ${(e as Error).message}`);
        process.exit(2);
    }
    try {
        const until = Date.now() + timeoutMs;
        while (!existsSync(cue)) {
            if (Date.now() > until) throw new Error(`no cue at ${cue}`);
            await Bun.sleep(10);
        }
        const t0 = obs.clock.now();
        if (t0 === null) throw new Error('no published tick');
        const ms0 = Date.now();
        console.log(`[tick-wait] cue at tick ${t0}`);
        const t = await obs.clock.at(t0 + after, { timeoutMs });
        console.log(`[tick-wait] T0+${after} at tick ${t} (${Date.now() - ms0} ms after the cue was seen, ${((Date.now() - ms0) / Math.max(1, t - t0)).toFixed(0)} ms a tick)`);
        await obs.close();
        process.exit(0);
    } catch (e) {
        console.error(`[tick-wait] ${(e as Error).message}`);
        await obs.close();
        process.exit(3);
    }
}
