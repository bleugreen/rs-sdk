// The scored side of the helpers' cues (helpers/altar-cue.ts): one cue open at a time in the run's
// cue directory, addressed to the step and family the chain's withCue names, with beacons from the
// frames SCORED observed. runecraft.ts writes its own altar cues into the same directory; a new
// scope here is a new session, so a helper watching another scope never reads a stale stop as
// its own.
//
// The directory belongs to the run: prepareCueDir creates it (0700, never inside a tracked tree)
// and, at a fresh start only, removes the run's own stale files (cue.json, anvil-plan.json,
// topup-ask.json, fm-row-go.json); a resumed run keeps them, since a helper may be mid-hand-off on them.

import { chmodSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { PLAN_FILE } from '../helpers/anvil';
import { GO_FILE } from '../helpers/fm-row';
import { ASK_FILE, assertUntracked, CUE_FILE, CueWriter, FrameLog, type CueScope } from '../helpers/altar-cue';
import { waitUntil, type StateSource } from '../lib/wait';
import type { CueSink } from './chain';
import type { StepContext } from './step';

/** The run's own files in the cue dir; a stale go file would start S03's droppers at once. */
export const RUN_CUE_FILES = [CUE_FILE, PLAN_FILE, ASK_FILE, GO_FILE] as const;

/** Create the run's cue directory (0700, untracked); at a fresh start remove the run's own stale files. Returns those removed. */
export function prepareCueDir(dir: string, o: { fresh: boolean }): string[] {
    assertUntracked(dir);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    if (!o.fresh) return [];
    const removed: string[] = [];
    for (const f of RUN_CUE_FILES) {
        const p = join(dir, f);
        if (existsSync(p)) {
            rmSync(p);
            removed.push(f);
        }
    }
    return removed;
}

const sameScope = (a: CueScope, b: CueScope) => a.step === b.step && a.family === b.family;

/** Frames a cue needs before it is written (as the stand-in receivers wait for). */
export const CUE_BEACONS = 4;

export class CueKeeper implements CueSink {
    private readonly frames = new FrameLog();
    private current: { scope: CueScope; writer: CueWriter } | null = null;

    /** `receiver`: the account the givers trade (its name is hashed into the cue, never logged). */
    constructor(readonly dir: string, private readonly receiver: string) {}

    /** Record SCORED's frames from `sdk`; returns the unsubscribe. */
    attach(sdk: Pick<StateSource, 'onStateUpdate'>): () => void {
        return sdk.onStateUpdate(s => {
            this.frames.add(s.tick);
        });
    }

    get open_(): CueScope | null {
        return this.current?.scope ?? null;
    }

    async open(scope: CueScope, ctx: Pick<StepContext<unknown>, 'sdk'>, o: { fresh: boolean }): Promise<void> {
        if (!o.fresh && this.current && sameScope(this.current.scope, scope)) return;
        this.close();
        await waitUntil(ctx.sdk, () => this.frames.recent().length >= CUE_BEACONS, { maxTicks: 10 });
        const writer = new CueWriter(this.dir, this.receiver, scope);
        writer.write({ beacons: this.frames.recent(), turns: [] });
        this.current = { scope, writer };
    }

    stop(scope: CueScope): void {
        if (this.current && sameScope(this.current.scope, scope)) this.close();
    }

    /** Write the open cue's stop (the final logout, or another scope opening). */
    close(): void {
        if (!this.current) return;
        const last = this.frames.recent(1);
        this.current.writer.stop(last.length ? last : [{ tick: 0, ms: Date.now() }]);
        this.current = null;
    }
}
