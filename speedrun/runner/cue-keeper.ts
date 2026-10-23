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
import { ASK_FILE, assertUntracked, CUE_FILE, CueWriter, FrameLog, nameHash, readJson, type Beacon, type Cue, type CueScope } from '../helpers/altar-cue';
import type { CueSink as RunecraftCueSink } from '../skills/runecraft';
import { waitUntil, type StateSource } from '../lib/wait';
import type { CueSink } from './chain';
import type { DeliveryOwner } from './delivery-owner';
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

/**
 * Observed ticks between rewrites of an open delivery cue (same session, seq+1). A `deliveryRun`
 * carrier refuses a cue older than STALE_CUE_MS (60 s, helpers/mule.ts) at its trade, and a row's
 * step can run for minutes before it; 25 ticks keep the cue at most 15 s old even at 600 ms.
 */
export const CUE_REFRESH_TICKS = 25;

/**
 * Whether the run's end closes the cues it still holds with a final stop. A final stop retires the
 * scope for good: the launcher closes it and never re-arms its accounts (helpers/standalone.ts
 * ScopeSessions). So only an end that nothing resumes is final: the whole chain done, or the operator
 * ending the attempt (SIGTERM, or a second Ctrl-C, whose Terminated carries SIGINT). Every other end
 * is recoverable and only stands the scope down, so the re-run's new session on it is served: a
 * failed step (1), a refused resume, the first Ctrl-C's stop at a boundary (4), a host reservation
 * (5), SIGHUP (usually a closed terminal), a crash.
 */
export function exitStopIsFinal(end: { completed: boolean; signal: string | null }): boolean {
    return end.completed || end.signal === 'SIGTERM' || end.signal === 'SIGINT';
}

interface Held {
    scope: CueScope;
    writer: CueWriter;
    /** A delivery row's cue: rewritten every CUE_REFRESH_TICKS while open. */
    delivery: boolean;
    /** The observed tick of its last write. */
    wrote: number;
}

export class CueKeeper implements CueSink {
    private readonly frames = new FrameLog();
    private current: Held | null = null;
    /**
     * The session last ended by a plain stop, until another session starts. A final close still
     * finalizes it: on SIGTERM the orphaned step's own non-final stop can land before the close.
     */
    private stood: Held | null = null;
    private delivery: DeliveryOwner | null = null;

    /**
     * `receiver`: the account the givers trade (its name is hashed into the cue, never logged).
     * `delivery`: the run owner of the `deliveryRun` carriers (delivery-owner.ts); with it every mule
     * cue is its row's delivery session, never a random one.
     */
    constructor(readonly dir: string, private readonly receiver: string, delivery: DeliveryOwner | null = null) {
        if (delivery) this.bindDelivery(delivery);
    }

    /** Make `owner` the run owner of this keeper's mule cues (before any is open). */
    bindDelivery(owner: DeliveryOwner): void {
        if (owner.dir !== this.dir) throw new Error(`delivery owner writes ${owner.dir}, the keeper ${this.dir}`);
        if (this.current || this.stood) throw new Error('bind the delivery owner before any cue is open');
        this.delivery = owner;
    }

    get deliveryOwner(): DeliveryOwner | null {
        return this.delivery;
    }

    /** Record SCORED's frames from `sdk`; returns the unsubscribe. */
    attach(sdk: Pick<StateSource, 'onStateUpdate'>): () => void {
        return sdk.onStateUpdate(s => {
            this.frames.add(s.tick);
            this.keepFresh(s.tick);
        });
    }

    /** The run owner for a mule scope, or null: a row the owner does not know is refused, never given a random session. */
    private ownerOf(scope: CueScope): DeliveryOwner | null {
        if (scope.family !== 'mule' || !this.delivery) return null;
        if (!this.delivery.has(scope.step)) throw new Error(`${scope.step}/mule: not a delivery row of run ${this.delivery.runId}`);
        return this.delivery;
    }

    private newWriter(scope: CueScope, owner: DeliveryOwner | null): CueWriter {
        return owner ? new CueWriter(this.dir, this.receiver, scope, owner.session(scope.step)) : new CueWriter(this.dir, this.receiver, scope);
    }

    private tickNow(): number {
        return this.frames.recent(1)[0]?.tick ?? 0;
    }

    /** Rewrite the open delivery cue (same session, seq+1, fresh beacons) once CUE_REFRESH_TICKS have passed. */
    private keepFresh(tick: number): void {
        const c = this.current;
        if (!c?.delivery || tick - c.wrote < CUE_REFRESH_TICKS) return;
        const cue = c.writer.current;
        if (!cue || cue.stop) return;
        try {
            this.assertCurrent(c.writer);
            c.writer.write({ beacons: this.frames.recent(), turns: cue.turns });
            c.wrote = tick;
        } catch (e) {
            // A state callback must not throw; the step's own stop meets the same ownership check.
            console.error(`[cue] ${c.scope.step}/${c.scope.family} refresh refused: ${e instanceof Error ? e.message : e}`);
            c.wrote = tick;
        }
    }

    /** Rewrite `scope`'s open delivery cue now (a trade about to be clicked); false when it is not the open one. */
    refresh(scope: CueScope): boolean {
        const c = this.current;
        if (!c?.delivery || !sameScope(c.scope, scope)) return false;
        c.wrote = -Infinity;
        this.keepFresh(this.tickNow());
        return true;
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
        const owner = this.ownerOf(scope);
        // The previous cue is stopped first: a carrier defers a prepare while its last row owns the cue.
        if (owner) await owner.awaitReady(scope.step, ctx.sdk);
        await waitUntil(ctx.sdk, () => this.frames.recent().length >= CUE_BEACONS, { maxTicks: 10 });
        const writer = this.newWriter(scope, owner);
        writer.write({ beacons: this.frames.recent(), turns: [] });
        this.current = { scope, writer, delivery: !!owner, wrote: this.tickNow() };
        this.stood = null;
    }

    /** Give a module the canonical writer, retaining ownership when it emits a segment stop. */
    writer(scope: CueScope): RunecraftCueSink {
        this.endCurrent(!this.current || !sameScope(this.current.scope, scope));
        const owner = this.ownerOf(scope);
        const writer = this.newWriter(scope, owner);
        this.current = { scope, writer, delivery: !!owner, wrote: this.tickNow() };
        this.stood = null;
        return {
            session: writer.session,
            write: fields => {
                if (this.current?.writer !== writer) throw new Error('cue writer is no longer owned by this scope');
                this.assertCurrent(writer);
                const cue = writer.write(fields);
                if (this.current) this.current.wrote = this.tickNow();
                return cue;
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

    /** A delivery row's stop after its step succeeded (not `failed`) prepares its carrier's next row. */
    stop(scope: CueScope, _ctx?: StepContext<unknown>, o: { final?: boolean; failed?: boolean } = {}): void {
        if (!this.current || !sameScope(this.current.scope, scope)) return;
        const delivery = this.current.delivery;
        this.endCurrent(o.final ?? true);
        if (delivery && !o.failed) this.delivery!.served(scope.step);
    }

    private endCurrent(final: boolean): void {
        if (!this.current) return;
        this.assertCurrent(this.current.writer);
        this.current.writer.stop(this.lastBeacons(this.current.writer), { final });
        this.stood = final ? null : this.current;
        this.current = null;
    }

    private lastBeacons(writer: CueWriter): Beacon[] {
        const last = this.frames.recent(1);
        return last.length ? last : writer.current?.beacons ?? [{ tick: 0, ms: Date.now() }];
    }

    /**
     * The run's end (exitStopIsFinal decides `final`): the open session's stop, and a final close also
     * finalizes a session already stood down (a module's segment stop, a failed step's stop).
     */
    close(o: { final: boolean }): void {
        if (this.current) this.endCurrent(o.final);
        else if (o.final && this.stood) {
            this.assertCurrent(this.stood.writer);
            this.stood.writer.stop(this.lastBeacons(this.stood.writer), { final: true });
        }
        this.stood = null;
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

    /** The run owner of the carriers in the mule directory (delivery-owner.ts). */
    bindDelivery(owner: DeliveryOwner): void {
        this.mule.bindDelivery(owner);
    }

    refresh(scope: CueScope): boolean {
        return this.keeper(scope).refresh(scope);
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

    stop(scope: CueScope, _ctx?: StepContext<unknown>, o: { final?: boolean; failed?: boolean } = {}): void {
        this.keeper(scope).stop(scope, _ctx, o);
    }

    close(o: { final: boolean }): void {
        try {
            this.mule.close(o);
        } finally {
            this.main.close(o);
        }
    }
}
