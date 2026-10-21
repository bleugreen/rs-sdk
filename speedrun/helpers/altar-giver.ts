// altar-giver (role): one essence giver for the scored account's in-room
// Runecraft cycle (docs/speedrun/skills/runecraft.md sections 4 and 7). It
// restocks a talisman and 27 rune essence, enters the altar room, stands on its
// tile next to the receiver's, and when the scored side cues its turn through
// the cue directory (altar-cue.ts) it sends its half of the blind schedule on
// its own frames: trade request on T+5, offer all and accept on T+6, confirm on
// T+7 (robust: a second confirm on T+8). Then it restocks and comes back.
// Contract, batch mode and measurements: docs/speedrun/helpers/altar-giver.md.
//
// Runs beside the scored account on the run machine (standalone.ts), never from
// the bbs fleet: the blind schedule has no slack for a relayed client.
//
// Role options (ROLE_OPTIONS):
//   altar      'air' (default), 'body' or 'nature'
//   slot       0 east (default), 1 west, 2 south of the receiver's tile
//   essence    essence per trade (default 27; the talisman takes the 28th slot)
//   schedule   'robust' forces the 8-tick schedule for every turn; default follows the cue
//   restock    { kind: 'bank'|'trade'|'cheat', bank?, acceptFrom?, restockAt?, labStock? } (altar-room.ts)
//   gapMs      wait after a frame before sending its packets (default 0: send on arrival)
//   cueDir     default RC_CUE_DIR, else run-machine/rc-cue in the checkout
import type { BotWorldState, NearbyPlayer } from '../../sdk/types';
import {
    assertUntracked,
    chooseTurn,
    CueWatcher,
    cueDir,
    FrameLog,
    giverSteps,
    judgeTick,
    nameHash,
    resolveOffset,
    TRADE_ACCEPT,
    TRADE_CONFIRM,
    writeStatus,
    type Cue,
    type GiverAction,
    type GiverPhase,
    type Outcome,
    type Schedule,
    type TurnResult
} from './altar-cue';
import { altarData, count, ESSENCE, enterRoom, findAltar, findItem, inRoom, pos, restock, roomTiles, standOn, until, type Altar, type RestockOptions, type Tile } from './altar-room';
import { ensureOutOfTutorial } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

export interface GiverOptions {
    altar: string;
    slot: number;
    essence: number;
    schedule?: Schedule;
    restock: RestockOptions;
    gapMs: number;
    cueDir: string;
}

export function giverOptions(raw: Record<string, unknown>, env: Record<string, string | undefined> = process.env): GiverOptions {
    const essence = raw.essence === undefined ? 27 : Number(raw.essence);
    if (!Number.isInteger(essence) || essence < 1 || essence > 27) throw new Error(`essence must be 1-27 (got ${raw.essence})`);
    const slot = raw.slot === undefined ? 0 : Number(raw.slot);
    if (![0, 1, 2].includes(slot)) throw new Error(`slot must be 0, 1 or 2 (got ${raw.slot})`);
    if (raw.schedule !== undefined && raw.schedule !== 'tuned' && raw.schedule !== 'robust') throw new Error(`schedule must be tuned or robust (got ${raw.schedule})`);
    const r = (raw.restock ?? {}) as Partial<RestockOptions>;
    const kind = r.kind ?? 'bank';
    if (!['bank', 'trade', 'cheat'].includes(kind)) throw new Error(`restock.kind must be bank, trade or cheat (got ${kind})`);
    return {
        altar: String(raw.altar ?? 'air'),
        slot,
        essence,
        ...(raw.schedule ? { schedule: raw.schedule as Schedule } : {}),
        restock: { ...r, kind, essence },
        gapMs: Number(raw.gapMs ?? 0),
        cueDir: typeof raw.cueDir === 'string' ? raw.cueDir : cueDir(env)
    };
}

interface Armed {
    key: string;
    session: string;
    seq: number;
    T: number;
    myT: number;
    open: number;
    schedule: Schedule;
    receiverHash: string;
}

class Stop extends Error {}

export class AltarGiver {
    private readonly o: GiverOptions;
    private readonly altar: Altar;
    private readonly frames = new FrameLog();
    private readonly done = new Set<string>();
    private phase: GiverPhase = 'start';
    private detail = '';
    private readyAt: number | null = null;
    private loggedInAt: number | null;
    private offset: { session: string; value: number } | null = null;
    private cue: Cue | null = null;
    private armed: Armed | null = null;
    private wakeServe: (() => void) | null = null;
    private last: TurnResult | undefined;
    private gave = 0;
    private tile: Tile | null = null;

    constructor(private readonly ctx: RoleContext) {
        this.o = giverOptions(ctx.options);
        this.altar = altarData(this.o.altar);
        this.loggedInAt = Number(process.env.LOGGED_IN_AT) || null;
    }

    private get s(): BotWorldState | null {
        return this.ctx.sdk.getState();
    }

    private setPhase(phase: GiverPhase, detail = ''): void {
        if (phase !== this.phase || detail !== this.detail) this.ctx.log('phase', { from: this.phase, to: phase, ...(detail ? { detail } : {}) });
        this.phase = phase;
        this.detail = detail;
        this.readyAt = phase === 'ready' || phase === 'armed' ? (this.readyAt ?? Date.now()) : null;
        this.publish();
    }

    private publish(): void {
        const p = pos(this.s);
        writeStatus(this.o.cueDir, {
            v: 1,
            account: this.ctx.account,
            phase: this.phase,
            loggedInAt: this.loggedInAt,
            essence: count(this.s, ESSENCE),
            tile: this.s?.player ? p : null,
            inRoom: inRoom(this.s, this.altar),
            readyAt: this.readyAt,
            ...(this.armed ? { armed: { session: this.armed.session, seq: this.armed.seq, T: this.armed.T, myT: this.armed.myT, schedule: this.armed.schedule } } : {}),
            ...(this.last ? { last: this.last } : {}),
            gave: this.gave,
            ...(this.detail ? { detail: this.detail } : {}),
            ms: Date.now()
        });
    }

    private result(outcome: Outcome, session: string, T: number, extra: { myT?: number; detail?: string } = {}): void {
        this.last = { session, T, outcome, ...extra, ms: Date.now() };
        this.ctx.log('turn', { outcome, T, ...extra });
        this.publish();
    }

    async run(): Promise<void> {
        const { ctx } = this;
        assertUntracked(this.o.cueDir);
        const unsub = ctx.sdk.onStateUpdate(st => {
            if (this.frames.add(st.tick) === 'reset') {
                // Our client relogged: its tick count restarted and it is now behind the scored account in processing order.
                this.loggedInAt = Date.now();
                this.offset = null;
            }
        });
        const watcher = new CueWatcher(this.o.cueDir, cue => this.onCue(cue));
        const heartbeat = setInterval(() => this.publish(), 1000);
        try {
            await ensureOutOfTutorial(ctx);
            await ctx.bot.dismissBlockingUI();
            if (ctx.sdk.getTradeState().isOpen) await ctx.sdk.sendDeclineTrade();
            while (!ctx.signal.aborted) {
                try {
                    await this.cycle();
                } catch (e) {
                    if (ctx.signal.aborted || e instanceof Stop) break;
                    this.setPhase('fault', String(e).slice(0, 200));
                    await ctx.sdk.waitForTicks(10).catch(() => {});
                }
            }
        } finally {
            unsub();
            watcher.close();
            clearInterval(heartbeat);
            this.armed = null;
            this.setPhase('off');
        }
    }

    /** One loop: get loaded, get onto the tile, serve until a trade is given. Restartable from any position. */
    private async cycle(): Promise<void> {
        const { ctx } = this;
        if (count(this.s, ESSENCE) < this.o.essence || count(this.s, this.altar.talisman) < 1) {
            this.setPhase('restock');
            await restock(ctx, this.altar, this.o.restock, d => this.setPhase('restock', d));
        }
        if (ctx.signal.aborted) return;
        if (!inRoom(this.s, this.altar)) {
            this.setPhase('travel', 'to the ruins');
            await enterRoom(ctx, this.altar);
        }
        const altarLoc = findAltar(ctx);
        if (!altarLoc) throw new Error('no altar in sight from the room');
        this.tile = roomTiles(altarLoc).givers[this.o.slot]!;
        this.setPhase('travel', `to tile ${this.tile.x},${this.tile.z}`);
        await standOn(ctx, this.tile);
        await this.serve();
    }

    private onTile(): boolean {
        const p = pos(this.s);
        return !!this.tile && p.x === this.tile.x && p.z === this.tile.z;
    }

    /** Wait loaded on the tile; run each armed turn; return after a trade is given (or when no longer loaded). */
    private async serve(): Promise<void> {
        const { ctx } = this;
        this.setPhase('ready');
        if (this.cue) this.onCue(this.cue);
        while (!ctx.signal.aborted) {
            if (count(this.s, ESSENCE) < this.o.essence) return;
            if (!this.armed) {
                if (!this.onTile()) return; // pushed off or teleported: cycle() puts us back
                await new Promise<void>(resolve => {
                    this.wakeServe = resolve;
                    setTimeout(resolve, 1000);
                });
                this.wakeServe = null;
                continue;
            }
            const a = this.armed;
            const outcome = await this.execute(a);
            if (this.armed === a) this.armed = null; // else a newer turn superseded it before its first packet
            if (outcome === 'gave') {
                this.gave++;
                return;
            }
            this.setPhase('ready');
        }
    }

    /** A new cue: resolve the tick offset if needed, then arm, re-arm, report late, or stand down. */
    private onCue(cue: Cue): void {
        this.cue = cue;
        if (this.armed && (cue.stop || cue.session !== this.armed.session)) {
            if (!this.started) {
                this.result('cancelled', this.armed.session, this.armed.T, { detail: cue.stop ? 'stop' : 'new session' });
                this.done.add(this.armed.key);
                this.armed = null;
                this.setPhase('ready');
            }
            return;
        }
        const mine = cue.turns.some(t => nameHash(t.giver) === nameHash(this.ctx.account));
        if (!mine) return;
        if (!this.offset || this.offset.session !== cue.session) {
            const r = resolveOffset(this.frames.all(), cue.beacons);
            if ('error' in r) {
                if (Date.now() - cue.ms > 5_000) return; // a stale cue re-read on becoming ready: nothing to report
                const newest = [...cue.turns].reverse().find(t => nameHash(t.giver) === nameHash(this.ctx.account))!;
                const key = `${cue.session}:${newest.T}`;
                if (!this.done.has(key)) {
                    this.done.add(key);
                    this.result('clock', cue.session, newest.T, { detail: r.error });
                }
                return;
            }
            this.offset = { session: cue.session, value: r.offset };
            this.ctx.log('clock', { session: cue.session, offset: r.offset, errorMs: r.errorMs });
        }
        const now = this.s?.tick ?? -1;
        const choice = chooseTurn(cue, this.ctx.account, this.offset.value, now, this.done);
        if (choice.kind === 'none') return;
        if (this.armed?.key === choice.key) return; // the turn in flight, seen again in a newer cue
        if (choice.kind === 'late') {
            this.done.add(choice.key);
            this.result('late', cue.session, choice.turn.T, { myT: choice.myT, detail: `cue seen on frame ${now}, first packet due on ${choice.myT + cue.open - 1}` });
            return;
        }
        if (this.armed && this.started) return; // mid-trade: finish it; the newer turn is re-read after
        if (this.phase !== 'ready' && this.phase !== 'armed') {
            this.done.add(choice.key);
            this.result('not-ready', cue.session, choice.turn.T, { detail: this.phase });
            return;
        }
        if (this.armed) this.done.add(this.armed.key); // superseded by a newer turn for us
        const schedule: Schedule = this.o.schedule === 'robust' ? 'robust' : choice.schedule;
        this.armed = { key: choice.key, session: cue.session, seq: cue.seq, T: choice.turn.T, myT: choice.myT, open: cue.open, schedule, receiverHash: cue.receiver.sha256 };
        this.setPhase('armed');
        this.wakeServe?.();
    }

    private started = false;

    /**
     * Send this turn's packets, each on the first arrival of its frame (land - 1 in
     * our numbering), and judge it once the last landing has had a frame to show.
     */
    private async execute(a: Armed): Promise<Outcome> {
        const { sdk } = this.ctx;
        const steps = giverSteps(a.myT, a.open, a.schedule).map(s => ({ send: s.land - 1, actions: s.actions }));
        const judge = judgeTick(a.myT, a.open, a.schedule);
        const before = count(this.s, ESSENCE);
        let receiver: NearbyPlayer | undefined;
        const slips: number[] = [];
        this.started = false;

        const fire = (actions: GiverAction[]) => {
            for (const action of actions) {
                if (action === 'request') void sdk.sendTradeRequest(receiver!.index);
                else if (action === 'offer-accept') {
                    const t = sdk.getTradeState();
                    if (t.isOpen && t.partner && nameHash(t.partner) !== a.receiverHash) {
                        void sdk.sendDeclineTrade();
                        continue;
                    }
                    const slot = findItem(this.s, ESSENCE)?.slot;
                    if (slot !== undefined) void sdk.sendOfferItem(slot, -1);
                    void sdk.sendClickComponent(TRADE_ACCEPT);
                } else void sdk.sendClickComponent(TRADE_CONFIRM);
            }
        };

        const outcome = await new Promise<Outcome | { late: number } | 'no-receiver' | 'cancelled'>(resolve => {
            let i = 0;
            let lastTick = -1;
            const finish = (v: Outcome | { late: number }) => {
                unsub();
                clearTimeout(wall);
                resolve(v);
            };
            const onFrame = (st: BotWorldState) => {
                if (st.tick === lastTick) return; // republication within the tick
                lastTick = st.tick;
                if (this.armed !== a && !this.started) return finish('cancelled');
                while (i < steps.length && st.tick >= steps[i]!.send) {
                    if (i === 0) {
                        if (st.tick > steps[0]!.send) return finish({ late: st.tick });
                        receiver = st.nearbyPlayers.find(p => nameHash(p.name) === a.receiverHash);
                        if (!receiver) return finish('no-receiver');
                        this.started = true;
                    } else if (st.tick > steps[i]!.send) slips.push(st.tick - steps[i]!.send);
                    const actions = steps[i]!.actions;
                    if (this.o.gapMs > 0) setTimeout(() => fire(actions), this.o.gapMs);
                    else fire(actions);
                    i++;
                }
                if (st.tick >= judge) finish(count(st, ESSENCE) < before && !st.trade?.isOpen ? 'gave' : 'missed');
            };
            const unsub = sdk.onStateUpdate(onFrame);
            const wall = setTimeout(() => finish('missed'), (judge - (this.s?.tick ?? a.myT) + 20) * 1200);
            const cur = this.s;
            if (cur) onFrame(cur);
        });
        this.started = false;
        this.done.add(a.key);

        if (typeof outcome === 'object') {
            this.result('late', a.session, a.T, { myT: a.myT, detail: `armed but first saw frame ${outcome.late}` });
            return 'late';
        }
        if (outcome === 'missed' && sdk.getTradeState().isOpen) {
            await sdk.sendDeclineTrade();
            await until(this.ctx, st => !st.trade?.isOpen, 5);
        }
        if (outcome === 'cancelled') return outcome; // reported by onCue (stop, new session) or superseded silently
        const busy = (this.s?.gameMessages ?? []).some(m => m.tick >= a.myT && /is busy/i.test(m.text));
        {
            this.result(outcome, a.session, a.T, { myT: a.myT, ...(slips.length || busy ? { detail: `${slips.length ? `slipped frames ${slips.join(',')}` : ''}${busy ? ' receiver busy' : ''}`.trim() } : {}) });
        }
        return outcome;
    }
}

export const role: Role = {
    name: 'altar-giver',
    produces: [],
    async run(ctx) {
        await new AltarGiver(ctx).run();
    }
};

if (import.meta.main) await runStandalone(role);
