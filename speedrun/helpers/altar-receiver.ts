// altar-receiver (role): a stand-in for the scored account's side of the
// in-room Runecraft cycle, for measuring altar-giver.ts. It is a test double,
// not the run's step: the run's Runecraft step (rs/103's manifest, driven from
// the page by rs/97's program) owns cue.json the same way this does. Never run it
// on the scored account.
//
// It stands on the receiver tile, waits until its givers are ready, writes their
// turns into the cue (the first with a virtual T, each next one at the craft
// click), runs the scored half of the blind schedule on its own frames (request
// T+5, accept T+6, confirm and craft T+7; robust: accept and confirm T+7, craft
// T+8), and logs one RESULT line with the craft-to-craft gaps, misses, the
// givers' restock round trips and the login order.
//
// Role options:
//   altar        'air' (default), 'body' or 'nature'; in the local lab the stand-in raises
//                its Runecraft to the altar's level
//   cycles       turns to take (default 20)
//   givers       giver accounts to wait for (default: any ready giver in sight)
//   batch        most turns per batch (default: every ready giver)
//   schedule     'tuned' (default), 'robust', or 'stock': the scored side's reacting fallback,
//                one stock turn per giver (T three ticks ahead), a reacting receive
//                (lib/trade.ts receiveFrom, 30 ticks) and a craft, as the Runecraft step's stock rung does
//   autoRobust   use robust for a giver that logged in after us (default true)
//   open         K (default 5)
//   keepTalisman keep the entry talisman (default false: dropped, as the scored account does,
//                so 27-essence trades fit; keep it only with givers carrying 26 or fewer)
//   restock      how to get a talisman to enter with (altar-room.ts RestockOptions; essence 0)
//   gapMs        wait after a frame before sending (default 0)
//   cueDir       as altar-giver
//   scope        required: { step, family: 'altar' }, written on every cue; its givers must carry the same
import type { BotWorldState, NearbyLoc, NearbyPlayer } from '../../sdk/types';
import { DROPPED_TICKS, receiveFrom } from '../lib/trade';
import { feedTickPeriod, periodMs, tickClock, TickPeriod, tickMs } from '../lib/wait';
import {
    canonName,
    cycleTicks,
    CueWriter,
    MissBench,
    scopeOption,
    turnOrder,
    cueDir,
    DEFAULT_OPEN,
    FrameLog,
    readStatuses,
    scoredSteps,
    TRADE_ACCEPT,
    TRADE_CONFIRM,
    type GiverStatus,
    type Schedule,
    type ScoredAction,
    type Turn
} from './altar-cue';
import { altarData, cheat, count, ESSENCE, enterRoom, findAltar, findItem, inRoom, isLocalServer, pos, restock, roomTiles, standOn, until, type RestockOptions, type Tile } from './altar-room';
import { ensureOutOfTutorial } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

export interface Candidate {
    giver: string;
    schedule: Schedule;
    index: number;
}

/**
 * The next batch: ready, fresh (heartbeat within 5 s), loaded givers in the
 * room, not benched after a failed turn (altar-cue.ts MissBench, as the run's
 * step), in sight on a tile orthogonally next to ours, oldest ready first. A giver
 * that logged in after us is handled after us in each tick, so with autoRobust it
 * gets the robust schedule.
 */
export function chooseBatch(
    statuses: readonly GiverStatus[],
    nearby: readonly NearbyPlayer[],
    me: Tile,
    o: { names?: string[]; batch?: number; schedule: Schedule; autoRobust: boolean; myLoggedInAt: number | null; now: number; bench?: MissBench }
): Candidate[] {
    const wanted = o.names?.map(canonName);
    return turnOrder(statuses, o.now, {
        eligible: s => (s.phase === 'ready' || s.phase === 'armed') && s.inRoom && s.essence > 0 && (!wanted || wanted.includes(canonName(s.account))),
        ...(o.bench ? { bench: o.bench } : {})
    })
        .flatMap(s => {
            const p = nearby.find(n => canonName(n.name) === canonName(s.account));
            if (!p || Math.abs(p.x - me.x) + Math.abs(p.z - me.z) !== 1) return [];
            const late = o.autoRobust && o.myLoggedInAt !== null && (s.loggedInAt === null || s.loggedInAt > o.myLoggedInAt);
            return [{ giver: s.account, schedule: late ? ('robust' as const) : o.schedule, index: p.index }];
        })
        .slice(0, o.batch ?? Infinity);
}

/** Turns for a batch starting at T0: each next T is the previous turn's craft. */
export function planTurns(batch: readonly Candidate[], T0: number, open: number): Turn[] {
    let T = T0;
    return batch.map(c => {
        const turn = { giver: c.giver, T, schedule: c.schedule };
        T += cycleTicks(open, c.schedule);
        return turn;
    });
}

function rcLevel(st: BotWorldState | null | undefined): number {
    return st?.skills.find(k => /runecraft/i.test(k.name))?.baseLevel ?? 1;
}

/** The blind schedule a batch is chosen for; stock turns pick their givers the same way. */
function blindSchedule(s: Schedule | 'stock'): Schedule {
    return s === 'stock' ? 'robust' : s;
}

export function histogram(xs: readonly (number | string)[]): Record<string, number> {
    const h: Record<string, number> = {};
    for (const x of xs) h[String(x)] = (h[String(x)] ?? 0) + 1;
    return h;
}

interface TurnLog {
    giver: string;
    T: number;
    schedule: Schedule | 'stock';
    ok: boolean;
    craftTick: number | null;
}

class Receiver {
    private readonly altar;
    private readonly frames = new FrameLog();
    private readonly crafts: number[] = [];
    private readonly turns: TurnLog[] = [];
    private readonly gaps: number[] = [];
    private readonly restockMs: number[] = [];
    private readonly waits: number[] = [];
    private readonly tradedAt = new Map<string, number>();
    private readonly bench = new MissBench();
    /** giver:T -> Date.now() of the cue write that named it. */
    private readonly namedAt = new Map<string, number>();
    /** The observed tick period, for reporting wall waits in ticks. */
    private readonly period = new TickPeriod();
    private altarLoc!: NearbyLoc;
    private me!: Tile;
    private writer!: CueWriter;
    private loggedInAt: number | null = Number(process.env.LOGGED_IN_AT) || null;
    private xp = -1;

    constructor(private readonly ctx: RoleContext) {
        this.altar = altarData(String(ctx.options.altar ?? 'air'));
        feedTickPeriod(ctx.sdk, this.period);
    }

    private get o() {
        const r = this.ctx.options;
        return {
            cycles: Number(r.cycles ?? 20),
            names: Array.isArray(r.givers) ? (r.givers as string[]) : undefined,
            batch: r.batch === undefined ? undefined : Number(r.batch),
            schedule: (r.schedule === 'robust' || r.schedule === 'stock' ? r.schedule : 'tuned') as Schedule | 'stock',
            autoRobust: r.autoRobust !== false,
            open: Number(r.open ?? DEFAULT_OPEN),
            keepTalisman: r.keepTalisman === true,
            gapMs: Number(r.gapMs ?? 0),
            dir: typeof r.cueDir === 'string' ? r.cueDir : cueDir(),
            scope: scopeOption(r.scope, ['altar'])
        };
    }

    private get s(): BotWorldState | null {
        return this.ctx.sdk.getState();
    }

    private rcXp(s: BotWorldState | null): number {
        return s?.skills.find(k => /runecraft/i.test(k.name))?.experience ?? -1;
    }

    async run(): Promise<void> {
        const { ctx } = this;
        const o = this.o;
        this.writer = new CueWriter(o.dir, ctx.account, o.scope);
        const unsub = ctx.sdk.onStateUpdate(st => {
            if (this.frames.add(st.tick) === 'reset') this.loggedInAt = Date.now();
            const xp = this.rcXp(st);
            if (this.xp >= 0 && xp > this.xp) this.crafts.push(st.tick);
            if (xp >= 0) this.xp = xp;
        });
        try {
            await this.setup();
            while (!ctx.signal.aborted && this.turns.length < o.cycles) await this.batch();
        } finally {
            unsub();
            const last = this.frames.recent(1);
            if (last.length) this.writer.stop(last);
        }
        const ok = this.turns.filter(t => t.ok).length;
        const stats = (xs: number[]) => (xs.length ? { n: xs.length, min: Math.min(...xs), max: Math.max(...xs), mean: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 } : { n: 0 });
        const result = {
            altar: this.altar.name,
            schedule: o.schedule,
            autoRobust: o.autoRobust,
            turns: this.turns.length,
            ok,
            missed: this.turns.length - ok,
            gapHist: histogram(this.gaps),
            schedules: histogram(this.turns.map(t => t.schedule)),
            restockTicks: stats(this.restockMs.map(ms => Math.round(ms / periodMs(this.period)))),
            batchWaitTicks: stats(this.waits.map(ms => Math.round(ms / periodMs(this.period)))),
            loginOrder: this.loginOrder(),
            perTurn: this.turns.map(t => `${t.giver}:${t.schedule[0]}:${t.ok ? 'ok' : 'miss'}`)
        };
        ctx.log('RESULT', result);
        console.log(`RESULT altar-receiver ${JSON.stringify(result)}`);
    }

    private loginOrder(): Record<string, string> {
        const out: Record<string, string> = {};
        for (const s of readStatuses(this.o.dir)) {
            if (s.loggedInAt === null || this.loggedInAt === null) out[s.account] = 'unknown';
            else out[s.account] = s.loggedInAt < this.loggedInAt ? `before us by ${Math.round((this.loggedInAt - s.loggedInAt) / 1000)}s` : `after us by ${Math.round((s.loggedInAt - this.loggedInAt) / 1000)}s`;
        }
        return out;
    }

    private async setup(): Promise<void> {
        const { ctx } = this;
        await ensureOutOfTutorial(ctx);
        await ctx.bot.dismissBlockingUI();
        if (ctx.sdk.getTradeState().isOpen) await ctx.sdk.sendDeclineTrade();
        // A fresh lab account is Runecraft 1; the scored account brings the altar's level.
        if (isLocalServer() && rcLevel(this.s) < this.altar.level) {
            await cheat(ctx, `setstat runecraft ${this.altar.level}`);
            await until(ctx, st => rcLevel(st) >= this.altar.level, 10);
        }
        if (!inRoom(this.s, this.altar)) {
            const r = (ctx.options.restock ?? {}) as Partial<RestockOptions>;
            await restock(ctx, this.altar, { kind: 'bank', ...r, essence: 0 }, d => ctx.log('restock', { detail: d }));
            await enterRoom(ctx, this.altar);
        }
        const loc = findAltar(ctx);
        if (!loc) throw new Error('no altar in sight');
        this.altarLoc = loc;
        this.me = roomTiles(loc).receiver;
        await standOn(ctx, this.me);
        // Whatever is held from an interrupted run goes into the altar first.
        if (count(this.s, ESSENCE) > 0) {
            await ctx.sdk.sendInteractLoc(loc.x, loc.z, loc.id, 1);
            await until(ctx, st => count(st, ESSENCE) === 0, 10);
            await ctx.sdk.waitForTicks(4).catch(() => {});
        }
        const talisman = findItem(this.s, this.altar.talisman);
        if (talisman && !this.o.keepTalisman) {
            await ctx.sdk.sendDropItem(talisman.slot);
            await until(ctx, st => !findItem(st, this.altar.talisman), 5);
        }
        ctx.log('receiver ready', { tile: this.me, free: 28 - (this.s?.inventory.length ?? 0) });
    }

    /** Wait for ready givers, take one batch of turns, judge each. */
    private async batch(): Promise<void> {
        const { ctx } = this;
        const o = this.o;
        const wantN = Math.min(o.batch ?? o.names?.length ?? 1, o.names?.length ?? Infinity, o.cycles - this.turns.length);
        const waitStart = Date.now();
        let batch: Candidate[] = [];
        for (;;) {
            if (ctx.signal.aborted) return;
            const statuses = readStatuses(o.dir);
            for (const s of statuses) {
                const at = this.tradedAt.get(s.account);
                if (at !== undefined && s.phase === 'ready' && s.readyAt && s.readyAt > at) {
                    this.restockMs.push(s.readyAt - at);
                    this.tradedAt.delete(s.account);
                }
            }
            batch = chooseBatch(statuses, this.s?.nearbyPlayers ?? [], this.me, { ...o, schedule: blindSchedule(o.schedule), myLoggedInAt: this.loggedInAt, now: Date.now(), bench: this.bench });
            // Everyone we wait for, or after 400 ticks of nominal time (two minutes at 300 ms) whoever is there.
            if (batch.length >= wantN || (batch.length > 0 && Date.now() - waitStart > 400 * tickMs())) break;
            await Bun.sleep(250);
        }
        this.waits.push(Date.now() - waitStart);
        if (this.s?.dialog.isOpen) await ctx.bot.dismissBlockingUI();
        // Beacons are our recent frames: a receiver that starts in place may not have seen any yet.
        await until(ctx, () => this.frames.recent().length >= 4, 10);
        if (o.schedule === 'stock') return this.stockTurns(batch);

        const now = this.s!.tick;
        // A virtual T for the first turn: its first packets go on frame T+K-1, at least three frames out.
        let c: Candidate | undefined = batch[0]!;
        let turn: Turn = planTurns([c], now + 4 - o.open, o.open)[0]!;
        ctx.log('batch', { ready: batch.map(b => `${b.giver}:${b.schedule}`), T0: turn.T, now });
        const written: Turn[] = [...(this.writer.current?.stop ? [] : (this.writer.current?.turns ?? []))];
        this.writer.write({ beacons: this.frames.recent(), turns: [...written, turn], schedule: o.schedule, open: o.open });
        this.named(turn);

        // One turn per craft: at each craft click the next ready giver (oldest ready first, not the one
        // trading now) gets the next T. The batch ends when nobody is ready or the batch size is reached.
        for (let i = 0; c && this.turns.length < o.cycles; i++) {
            const nCrafts = this.crafts.length;
            const nextT = turn.T + cycleTicks(o.open, c.schedule);
            let next: { c: Candidate; turn: Turn } | null = null;
            const current: Candidate = c;
            await this.runTurn(turn, current, () => {
                if (i + 1 >= (o.batch ?? Infinity) || this.turns.length + 1 >= o.cycles) return;
                const ready = chooseBatch(readStatuses(o.dir), this.s?.nearbyPlayers ?? [], this.me, { ...o, schedule: blindSchedule(o.schedule), myLoggedInAt: this.loggedInAt, now: Date.now(), bench: this.bench });
                const pick = ready.find(r => r.giver !== current.giver);
                if (!pick) return;
                next = { c: pick, turn: { giver: pick.giver, T: nextT, schedule: pick.schedule } };
                this.writer.addTurn(next.turn, this.frames.recent());
                this.named(next.turn);
            });
            // The craft landing on nextT shows in the frames after it; give it four.
            await until(ctx, st => st.tick >= nextT + 4 || this.crafts.length > nCrafts, 12);
            const ok = this.crafts.length > nCrafts;
            const craftTick = ok ? this.crafts[this.crafts.length - 1]! : null;
            this.turns.push({ giver: current.giver, T: turn.T, schedule: current.schedule, ok, craftTick });
            this.tradedAt.set(current.giver, Date.now());
            if (!ok) this.missed(turn);
            const prev = this.turns[this.turns.length - 2];
            const gap = ok && i > 0 && prev?.ok && prev.craftTick !== null ? craftTick! - prev.craftTick : null;
            if (gap !== null) this.gaps.push(gap);
            ctx.log('turn', { giver: current.giver, schedule: current.schedule, ok, gap });
            if (!ok) {
                // A broken chain: stand everyone down, clear the screen, burn what is held, start a new batch.
                this.writer.stop(this.frames.recent());
                if (ctx.sdk.getTradeState().isOpen) await ctx.sdk.sendDeclineTrade();
                if (count(this.s, ESSENCE) > 0) {
                    await ctx.sdk.sendInteractLoc(this.altarLoc.x, this.altarLoc.z, this.altarLoc.id, 1);
                    await until(ctx, st => count(st, ESSENCE) === 0, 10);
                }
                await ctx.sdk.waitForTicks(5).catch(() => {});
                return;
            }
            const n = next as { c: Candidate; turn: Turn } | null;
            c = n?.c;
            if (n) turn = n.turn;
        }
        this.writer.stop(this.frames.recent());
        await ctx.sdk.waitForTicks(4).catch(() => {});
    }

    /**
     * The stock fallback over one batch: per giver, a stock turn in the cue with T three ticks
     * ahead, a reacting receive, then the craft. Gaps are craft to craft within the batch.
     */
    private async stockTurns(batch: readonly Candidate[]): Promise<void> {
        const { ctx } = this;
        const o = this.o;
        let prevCraft: number | null = null;
        for (const c of batch) {
            if (ctx.signal.aborted || this.turns.length >= o.cycles) break;
            if (this.s?.dialog.isOpen) await ctx.bot.dismissBlockingUI();
            const nCrafts = this.crafts.length;
            const turn: Turn = { giver: c.giver, T: this.s!.tick + 3, schedule: 'stock' };
            const written = this.writer.current?.stop ? [] : (this.writer.current?.turns ?? []);
            this.writer.write({ beacons: this.frames.recent(), turns: [...written, turn], schedule: 'robust', open: o.open });
            this.named(turn);
            const r = await receiveFrom(ctx.sdk, c.giver, { want: [{ item: ESSENCE }], maxTicks: 30, openMaxTicks: 30, noReplyTicks: DROPPED_TICKS });
            if (r.ok) {
                const level = rcLevel(this.s);
                await ctx.sdk.sendInteractLoc(this.altarLoc.x, this.altarLoc.z, this.altarLoc.id, 1);
                await until(ctx, () => this.crafts.length > nCrafts, 8);
                // A level-up page opens when the craft's delay ends, about 4 ticks on, and makes us
                // "busy" to the next giver's request: wait for it and answer it, as the run's step does.
                if (rcLevel(this.s) > level && (await until(ctx, st => st.dialog.isOpen, 6))) await ctx.bot.dismissBlockingUI();
            }
            const ok = this.crafts.length > nCrafts;
            const craftTick = ok ? this.crafts[this.crafts.length - 1]! : null;
            this.turns.push({ giver: c.giver, T: turn.T, schedule: 'stock', ok, craftTick });
            this.tradedAt.set(c.giver, Date.now());
            if (!ok) this.missed(turn);
            const gap = craftTick !== null && prevCraft !== null ? craftTick - prevCraft : null;
            if (gap !== null) this.gaps.push(gap);
            prevCraft = craftTick;
            ctx.log('turn', { giver: c.giver, schedule: 'stock', ok, gap, ...(r.ok ? { tradeTicks: r.ticks } : { reason: r.reason }) });
            if (!ok) break;
        }
        this.writer.stop(this.frames.recent());
        if (ctx.sdk.getTradeState().isOpen) await ctx.sdk.sendDeclineTrade();
        await ctx.sdk.waitForTicks(4).catch(() => {});
    }

    private named(turn: Turn): void {
        this.namedAt.set(`${canonName(turn.giver)}:${turn.T}`, Date.now());
    }

    /** A failed turn benches its giver until it reports ready again. */
    private missed(turn: Turn): void {
        this.bench.miss(turn.giver, this.namedAt.get(`${canonName(turn.giver)}:${turn.T}`));
        this.ctx.log('bench', { giver: turn.giver, T: turn.T, benched: this.bench.benched });
    }

    /** Send the scored half of one turn on our own frames. `atCraft` runs as the craft click goes out. */
    private runTurn(turn: Turn, c: Candidate, atCraft: () => void): Promise<void> {
        const { sdk } = this.ctx;
        const steps = scoredSteps(turn.T, this.o.open, c.schedule).map(s => ({ send: s.land - 1, actions: s.actions }));
        const loc = this.altarLoc;
        const fire = (actions: ScoredAction[]) => {
            for (const a of actions) {
                if (a === 'request') void sdk.sendTradeRequest(c.index);
                else if (a === 'accept') void sdk.sendClickComponent(TRADE_ACCEPT);
                else if (a === 'confirm') void sdk.sendClickComponent(TRADE_CONFIRM);
                else {
                    void sdk.sendInteractLoc(loc.x, loc.z, loc.id, 1);
                    atCraft();
                }
            }
        };
        return new Promise(resolve => {
            let i = 0;
            let lastTick = -1;
            const end = () => {
                unsub();
                clock.stop();
                resolve();
            };
            // Sending the last step ends the turn; the tick limit only matters if the tick clock restarts.
            const limit = (steps.at(-1)?.send ?? 0) - (this.s?.tick ?? 0) + 20;
            const onFrame = (st: BotWorldState) => {
                clock.see(st);
                if (st.tick === lastTick) return;
                lastTick = st.tick;
                while (i < steps.length && st.tick >= steps[i]!.send) {
                    const actions = steps[i]!.actions;
                    if (this.o.gapMs > 0) setTimeout(() => fire(actions), this.o.gapMs);
                    else fire(actions);
                    i++;
                }
                if (i >= steps.length || clock.elapsed > limit) end();
            };
            const clock = tickClock(this.s?.tick, end, this.s?.tick);
            const unsub = sdk.onStateUpdate(onFrame);
            if (this.s) onFrame(this.s);
        });
    }
}

export const role: Role = {
    name: 'altar-receiver',
    produces: [],
    async run(ctx) {
        if (pos(ctx.sdk.getState()).x < 0) await ctx.sdk.waitForReady(100 * tickMs());
        await new Receiver(ctx).run();
    }
};

if (import.meta.main) await runStandalone(role);
