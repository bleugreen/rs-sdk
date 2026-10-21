// The page side of the program runtime: what BotOverlay holds.
//
// - `onTick` is called from the decoded-tick hook (BotOverlay.onGameTick), with
//   the state the overlay is about to publish; the running program reacts there.
// - `command` answers the `program` overlay action (start / stop / status / list).
// - `?program=<name>&programArgs=<json>` starts a program once the page has been
//   in game for `programDelay` ticks (default 5): a headless harness can drive
//   the in-page probe without an SDK connection.
// - `window.rsPrograms` exposes the same controls to page scripts
//   (`await rsPrograms.run('probe', {trials: 60})` resolves with the final status;
//   `rsPrograms.history` holds every ended run). That is the readback channel for a
//   harness: the production bundle strips console calls, so the `[program] ...` log
//   lines below appear only in a dev build.

import type { ActionResult } from '../ActionExecutor.js';
import type { BotAction, BotWorldState } from '../types.js';
import { registerPrograms } from './index.js';
import { parseProgramCommand, ProgramRuntime } from './runtime.js';
import type { ProgramParams, ProgramStatus } from './types.js';

export interface PageControls {
    start(name: string, params?: ProgramParams): ProgramStatus;
    stop(): ProgramStatus | null;
    status(): ProgramStatus | null;
    list(): string[];
    /** Start and resolve with the final status of that run. */
    run(name: string, params?: ProgramParams): Promise<ProgramStatus>;
    /** Every ended run since the page loaded, oldest first. */
    readonly history: ProgramStatus[];
}

export interface HostOptions {
    /** location.search (or a test string) for the autostart parameters. */
    search?: string;
    log?: (line: string) => void;
    now?: () => number;
    /** The client's game-loop pass counter (Client.getClientCycle). */
    loopCount?: () => number;
}

export class ProgramHost {
    readonly runtime: ProgramRuntime;
    readonly history: ProgramStatus[] = [];
    private readonly waiters = new Map<number, Array<(s: ProgramStatus) => void>>();
    private autostart: { name: string; params: ProgramParams; afterTicks: number } | null = null;
    private inGameTicks = 0;
    private readonly log: (line: string) => void;

    constructor(dispatch: (action: BotAction) => ActionResult | Promise<ActionResult>, opts: HostOptions = {}) {
        this.log = opts.log ?? (line => console.log(line));
        this.runtime = registerPrograms(new ProgramRuntime({
            dispatch,
            log: this.log,
            now: opts.now,
            loopCount: opts.loopCount,
            onEnd: status => this.ended(status)
        }));
        this.autostart = parseAutostart(opts.search ?? '', this.log);
    }

    get active(): boolean {
        return this.runtime.active || this.autostart !== null;
    }

    status(): ProgramStatus | null {
        return this.runtime.status();
    }

    /** The decoded-tick hook: run the program on the state about to be published. */
    onTick(state: BotWorldState, ticks: number, arrivals: readonly number[] = []): void {
        if (state.inGame) this.inGameTicks += ticks;
        if (this.autostart && this.inGameTicks >= this.autostart.afterTicks) {
            const { name, params } = this.autostart;
            this.autostart = null;
            this.runtime.onTick(state, 0); // let a new run see the current state as its start
            this.runtime.start(name, params);
        }
        this.runtime.onTick(state, ticks, arrivals);
    }

    /** The `program` overlay action, validated here because it came off the wire. */
    command(action: unknown): ActionResult {
        const cmd = parseProgramCommand(action);
        if (typeof cmd === 'string') return { success: false, message: cmd, phase: 'validation', reason: 'invalid_argument' };
        return this.runtime.command(cmd);
    }

    controls(): PageControls {
        return {
            start: (name, params = {}) => this.runtime.start(name, params),
            stop: () => this.runtime.stop(),
            status: () => this.runtime.status(),
            list: () => this.runtime.names(),
            run: (name, params = {}) => {
                const s = this.runtime.start(name, params);
                if (s.phase !== 'running') return Promise.resolve(s);
                return new Promise(resolve => {
                    if (!this.waiters.has(s.runId)) this.waiters.set(s.runId, []);
                    this.waiters.get(s.runId)!.push(resolve);
                });
            },
            history: this.history
        };
    }

    /** Install `window.rsPrograms`. */
    expose(target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): void {
        target.rsPrograms = this.controls();
    }

    private ended(status: ProgramStatus): void {
        this.history.push(status);
        if (this.history.length > 50) this.history.shift();
        this.log(`[program] end ${JSON.stringify(status)}`);
        for (const resolve of this.waiters.get(status.runId) ?? []) resolve(status);
        this.waiters.delete(status.runId);
    }
}

function parseAutostart(search: string, log: (line: string) => void): { name: string; params: ProgramParams; afterTicks: number } | null {
    const q = new URLSearchParams(search);
    const name = q.get('program');
    if (!name) return null;
    let params: ProgramParams = {};
    const raw = q.get('programArgs');
    if (raw) {
        try {
            const parsed: unknown = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
            params = parsed as ProgramParams;
        } catch (e) {
            log(`[program] ignoring ?programArgs (${e instanceof Error ? e.message : String(e)}); starting ${name} with no parameters`);
        }
    }
    const delay = Number(q.get('programDelay') ?? 5);
    return { name, params, afterTicks: Number.isFinite(delay) && delay >= 0 ? delay : 5 };
}
