// The scored side of the helpers' cues (helpers/altar-cue.ts): one cue open at a time in the run's
// cue directory, addressed to the step and family the chain's withCue names, with beacons from the
// frames SCORED observed. Runecraft drives its turns through this owner's writer factory, so
// segment stops retain ownership until the band (including hand-back) or run ends.
//
// The directory belongs to the run: prepareCueDir creates it (0700, never inside a tracked tree)
// and, at a fresh start only, removes the run's own stale files (cue.json, anvil-plan.json,
// topup-ask.json, fm-row-go.json); a resumed run keeps them, since a helper may be mid-hand-off on them.

import { chmodSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { PLAN_FILE } from '../helpers/anvil';
import { GO_FILE } from '../helpers/fm-row';
import { ASK_FILE, assertUntracked, CUE_FILE, CueWriter, FrameLog, nameHash, readJson, type Cue, type CueScope } from '../helpers/altar-cue';
import type { CueSink as RunecraftCueSink } from '../skills/runecraft';
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

    isOpen(scope: CueScope): boolean {
        return !!this.current && sameScope(this.current.scope, scope);
    }

    async open(scope: CueScope, ctx: Pick<StepContext<unknown>, 'sdk'>, o: { fresh: boolean }): Promise<void> {
        if (!o.fresh && this.current && sameScope(this.current.scope, scope)) return;
        this.endCurrent(!this.current || !sameScope(this.current.scope, scope));
        await waitUntil(ctx.sdk, () => this.frames.recent().length >= CUE_BEACONS, { maxTicks: 10 });
        const writer = new CueWriter(this.dir, this.receiver, scope);
        writer.write({ beacons: this.frames.recent(), turns: [] });
        this.current = { scope, writer };
    }

    /** Give a module the canonical writer, retaining ownership when it emits a segment stop. */
    writer(scope: CueScope): RunecraftCueSink {
        this.endCurrent(!this.current || !sameScope(this.current.scope, scope));
        const writer = new CueWriter(this.dir, this.receiver, scope);
        this.current = { scope, writer };
        return {
            session: writer.session,
            write: fields => {
                if (this.current?.writer !== writer) throw new Error('cue writer is no longer owned by this scope');
                this.assertCurrent(writer);
                return writer.write(fields);
            },
        };
    }

    private assertCurrent(writer: CueWriter): void {
        // Before its first write this writer has not replaced the preceding scope's file.
        if (!writer.current) return;
        const disk = readJson<Cue>(join(this.dir, CUE_FILE));
        if (!disk || disk.session !== writer.session || disk.seq !== writer.current.seq || (!disk.scope || !sameScope(disk.scope, writer.scope)) || disk.receiver?.sha256 !== nameHash(this.receiver)) {
            throw new Error('cue ownership changed outside the run');
        }
    }

    stop(scope: CueScope, _ctx?: StepContext<unknown>, o: { final?: boolean } = {}): void {
        if (this.current && sameScope(this.current.scope, scope)) this.endCurrent(o.final ?? true);
    }

    private endCurrent(final: boolean): void {
        if (!this.current) return;
        this.assertCurrent(this.current.writer);
        const last = this.frames.recent(1);
        this.current.writer.stop(last.length ? last : this.current.writer.current?.beacons ?? [{ tick: 0, ms: Date.now() }], { final });
        this.current = null;
    }

    /** Terminal stop on completion or abort, even after a module's nonfinal segment stop. */
    close(): void {
        this.endCurrent(true);
    }
}

/**
 * The run's cue writers (STEP-MANIFEST.md "Cue layout"): mule1 reads its own directory, so a
 * {Hx, mule} hand-off opens and stops its cue there and never closes the one open in the main
 * directory (S07's bone givers and S18's courier log out on their own scope's stop, and a keeper
 * writes a stop for whatever it had open before opening another). Every other family shares the main one.
 */
export class RunCues implements CueSink {
    readonly main: CueKeeper;
    readonly mule: CueKeeper;

    constructor(dirs: { main: string; mule: string }, receiver: string) {
        this.main = new CueKeeper(dirs.main, receiver);
        this.mule = new CueKeeper(dirs.mule, receiver);
    }

    attach(sdk: Pick<StateSource, 'onStateUpdate'>): () => void {
        const offs = [this.main.attach(sdk), this.mule.attach(sdk)];
        return () => offs.forEach(off => off());
    }

    private keeper(scope: CueScope): CueKeeper {
        return scope.family === 'mule' ? this.mule : this.main;
    }

    open(scope: CueScope, ctx: Pick<StepContext<unknown>, 'sdk'>, o: { fresh: boolean }): Promise<void> {
        return this.keeper(scope).open(scope, ctx, o);
    }

    isOpen(scope: CueScope): boolean {
        return this.keeper(scope).isOpen(scope);
    }

    writer(scope: CueScope): RunecraftCueSink {
        return this.keeper(scope).writer(scope);
    }

    stop(scope: CueScope, _ctx?: StepContext<unknown>, o: { final?: boolean } = {}): void {
        this.keeper(scope).stop(scope, _ctx, o);
    }

    close(): void {
        try {
            this.mule.close();
        } finally {
            this.main.close();
        }
    }
}
