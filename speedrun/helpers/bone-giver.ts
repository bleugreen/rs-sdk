// bone-giver (role): the S07 dragon-bone giver. While the scored account chops
// with the knife cycle and buries a bone every roll (docs/speedrun/skills/
// woodcutting.md section 9), this helper stands on the tile beside its chopping
// tile with exactly one trade's worth of bones and keeps a trade request standing
// with it. The scored step's own trade click (lib/trade.ts receiveFrom) then opens
// both screens at once, and the helper offers the whole load in one press
// (lib/trade.ts give). Then it restocks and comes back. Measurements and the
// contract: docs/speedrun/helpers/bone-giver.md.
//
// Why a standing request, re-sent on the next tick after a refusal. The engine
// refuses a request while the target is busy (delayed by a bury, or a level-up
// page open) with "<name> is busy at the moment"; otherwise it answers "Sending
// trade offer..." and the request stays standing (the target's %tradestatus is
// received) until a trade opens or closes (trade.rs2 [opplayer4]). So a refusal
// is answered on the very next frame, and a request that landed is never re-sent
// (re-sending is harmless but would spam the scored account's chat), except after
// `resendTicks` without a trade, in case the scored account relogged.
//
// The receiver is never named in config or logs: it is whoever in sight matches
// the receiver hash in the cue directory (altar-cue.ts), the same cue the altar
// givers read. Started by the run-machine launcher (standalone.ts) like them.
//
// Role options (ROLE_OPTIONS):
//   item         item to give (default 'Dragon bones')
//   n            per trade (default 23: the knife loop's free slots)
//   sites        [{ giver: {x,z}, receiver: {x,z} }] in run order (default: the oak tile, then the Taverley willow)
//   siteWaitTicks  how long to wait at a site for the receiver before trying the next (default 30)
//   trades       stop after this many trades (default: until the cue says stop)
//   restock      { kind: 'bank'|'cheat', bank?: {x,z} } (cheat: local lab only; bank default Falador west)
//   noReplyTicks re-send when neither answer came back (default 3)
//   resendTicks  re-send a standing request after this long without a trade (default 100)
//   cueDir       default RC_CUE_DIR, else run-machine/rc-cue in the checkout
import { join } from 'node:path';
import type { BotWorldState, NearbyPlayer } from '../../sdk/types';
import { withdrawMany } from '../lib/bank';
import { give, tradeOf } from '../lib/trade';
import { assertUntracked, canonName, CueWatcher, cueDir, nameHash, writeJsonAtomicSync, type Cue } from './altar-cue';
import { count, isLocalServer, pos, standOn, until, type Tile } from './altar-room';
import { closeBank, depositAllExcept, ensureOutOfTutorial, openBank, walkNear } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

export interface Site {
    giver: Tile;
    receiver: Tile;
}

/** S07's chopping tiles (woodcutting.md, bones-placement.md section 3): the giver stands on the tile beside. */
export const S07_SITES: Site[] = [
    { receiver: { x: 2914, z: 3494 }, giver: { x: 2913, z: 3494 } }, // Taverley oaks
    { receiver: { x: 2920, z: 3406 }, giver: { x: 2920, z: 3407 } } // Taverley willows
];

/** Falador west bank, the nearest to Taverley's trees. */
export const DEFAULT_BONE_BANK: Tile = { x: 2946, z: 3368 };

export interface BoneGiverOptions {
    item: string;
    n: number;
    sites: Site[];
    siteWaitTicks: number;
    trades: number;
    restock: { kind: 'bank' | 'cheat'; bank: Tile };
    noReplyTicks: number;
    resendTicks: number;
    cueDir: string;
}

const tile = (t: unknown, what: string): Tile => {
    const r = (t ?? {}) as Record<string, unknown>;
    const x = Number(r.x);
    const z = Number(r.z);
    if (!Number.isInteger(x) || !Number.isInteger(z)) throw new Error(`${what} needs integer x and z`);
    return { x, z };
};

export function boneGiverOptions(raw: Record<string, unknown>, env: Record<string, string | undefined> = process.env): BoneGiverOptions {
    const n = raw.n === undefined ? 23 : Number(raw.n);
    if (!Number.isInteger(n) || n < 1 || n > 28) throw new Error(`n must be 1-28 (got ${raw.n})`);
    const sites = raw.sites === undefined ? S07_SITES : (raw.sites as unknown[]).map((s, i) => ({ giver: tile((s as Site).giver, `sites[${i}].giver`), receiver: tile((s as Site).receiver, `sites[${i}].receiver`) }));
    if (sites.length === 0) throw new Error('sites must not be empty');
    const r = (raw.restock ?? {}) as Record<string, unknown>;
    const kind = r.kind ?? 'bank';
    if (kind !== 'bank' && kind !== 'cheat') throw new Error(`restock.kind must be bank or cheat (got ${kind})`);
    const trades = raw.trades === undefined ? Number.POSITIVE_INFINITY : Number(raw.trades);
    if (!(trades >= 1)) throw new Error(`trades must be at least 1 (got ${raw.trades})`);
    return {
        item: String(raw.item ?? 'Dragon bones'),
        n,
        sites,
        siteWaitTicks: Number(raw.siteWaitTicks ?? 30),
        trades,
        restock: { kind, bank: r.bank ? tile(r.bank, 'restock.bank') : DEFAULT_BONE_BANK },
        noReplyTicks: Number(raw.noReplyTicks ?? 3),
        resendTicks: Number(raw.resendTicks ?? 100),
        cueDir: typeof raw.cueDir === 'string' ? raw.cueDir : cueDir(env)
    };
}

// ------------------------------------------------------------------ the standing request

/** trade.rs2 [opplayer4]: the refusal while the target is busy, and the line every accepted request prints. */
export const BUSY_RE = /is busy at the moment/i;
export const SENT_RE = /^sending trade offer/i;

export interface RequestCtx {
    /** Frame our latest request went out on; its answer arrives on a later frame. */
    sentTick: number | null;
    /** The latest request was answered "Sending trade offer...": it stands until a trade opens. */
    landed: boolean;
    sends: number;
    bounces: number;
}

export const newRequestCtx = (): RequestCtx => ({ sentTick: null, landed: false, sends: 0, bounces: 0 });

export type RequestWhy = 'first' | 'bounce' | 'no-reply' | 'stale';
export type RequestDecision = { next: RequestCtx } & ({ action: 'open' | 'wait' } | { action: 'send'; why: RequestWhy });

/**
 * What to do on this frame: send (or re-send) the request, wait, or go on to the
 * trade because the screens are open. Call once per new tick; a republication
 * within the frame a request went out on is a wait.
 */
export function decideRequest(s: BotWorldState, ctx: RequestCtx, o: Pick<BoneGiverOptions, 'noReplyTicks' | 'resendTicks'>): RequestDecision {
    if (tradeOf(s).isOpen) return { action: 'open', next: ctx };
    const send = (why: RequestWhy): RequestDecision => ({
        action: 'send',
        why,
        next: { sentTick: s.tick, landed: false, sends: ctx.sends + 1, bounces: ctx.bounces + (why === 'bounce' ? 1 : 0) }
    });
    if (ctx.sentTick === null) return send('first');
    if (s.tick <= ctx.sentTick) return { action: 'wait', next: ctx };
    if (!ctx.landed) {
        const answers = s.gameMessages.filter(m => m.tick > ctx.sentTick! && m.type === 0);
        if (answers.some(m => BUSY_RE.test(m.text))) return send('bounce');
        if (answers.some(m => SENT_RE.test(m.text))) return { action: 'wait', next: { ...ctx, landed: true } };
        if (s.tick - ctx.sentTick >= o.noReplyTicks) return send('no-reply');
        return { action: 'wait', next: ctx };
    }
    if (s.tick - ctx.sentTick >= o.resendTicks) return send('stale');
    return { action: 'wait', next: ctx };
}

// ------------------------------------------------------------------ role

const exact = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

export type BonePhase = 'start' | 'restock' | 'travel' | 'waiting' | 'requested' | 'trading' | 'fault' | 'off';

export interface RequestOutcome {
    ok: boolean;
    /** Frames from our first request to the screens opening. */
    waited: number;
    sends: number;
    bounces: number;
    /** Frames from each refusal's answer to the re-send that followed it (1 means the very next tick). */
    resendGaps: number[];
    reason?: string;
}

export class BoneGiver {
    readonly o: BoneGiverOptions;
    private readonly re: RegExp;
    private cue: Cue | null = null;
    private phase: BonePhase = 'start';
    private detail = '';
    private site = 0;
    private trades = 0;
    private bounces = 0;

    constructor(private readonly ctx: RoleContext) {
        this.o = boneGiverOptions(ctx.options);
        this.re = exact(this.o.item);
    }

    private get s(): BotWorldState | null {
        return this.ctx.sdk.getState();
    }

    private held(): number {
        return count(this.s, this.re);
    }

    private setPhase(phase: BonePhase, detail = ''): void {
        if (phase !== this.phase || detail !== this.detail) this.ctx.log('phase', { from: this.phase, to: phase, ...(detail ? { detail } : {}) });
        this.phase = phase;
        this.detail = detail;
        this.publish();
    }

    /** bones-<account>.json beside the altar givers' status files, so the scored side can see a load is standing. */
    private publish(): void {
        writeJsonAtomicSync(join(this.o.cueDir, `bones-${canonName(this.ctx.account)}.json`), {
            v: 1,
            account: this.ctx.account,
            phase: this.phase,
            held: this.held(),
            n: this.o.n,
            trades: this.trades,
            bounces: this.bounces,
            tile: this.s?.player ? pos(this.s) : null,
            ...(this.detail ? { detail: this.detail } : {}),
            ms: Date.now()
        });
    }

    private receiverInSight(): NearbyPlayer | undefined {
        const hash = this.cue?.receiver.sha256;
        return hash ? this.s?.nearbyPlayers.find(p => nameHash(p.name) === hash) : undefined;
    }

    async run(): Promise<void> {
        const { ctx } = this;
        assertUntracked(this.o.cueDir);
        const watcher = new CueWatcher(this.o.cueDir, cue => (this.cue = cue));
        const heartbeat = setInterval(() => this.publish(), 2000);
        try {
            await ensureOutOfTutorial(ctx);
            await ctx.bot.dismissBlockingUI();
            if (ctx.sdk.getTradeState().isOpen) await ctx.sdk.sendDeclineTrade();
            while (!ctx.signal.aborted && this.trades < this.o.trades && !this.cue?.stop) {
                try {
                    await this.cycle();
                } catch (e) {
                    if (ctx.signal.aborted) break;
                    this.setPhase('fault', String(e).slice(0, 200));
                    await ctx.sdk.waitForTicks(10).catch(() => {});
                }
            }
        } finally {
            watcher.close();
            clearInterval(heartbeat);
            this.setPhase('off');
        }
        ctx.log('bone-giver: finished', { trades: this.trades, bounces: this.bounces });
    }

    /** One load: restock, get beside the receiver, keep a request standing, give. Restartable from any position. */
    private async cycle(): Promise<void> {
        const { ctx, o } = this;
        if (this.held() !== o.n) {
            this.setPhase('restock');
            await this.restock();
        }
        const site = o.sites[this.site]!;
        this.setPhase('travel', `site ${this.site}`);
        await walkNear(ctx, site.giver.x, site.giver.z, 2);
        await standOn(ctx, site.giver);
        this.setPhase('waiting', `site ${this.site}`);
        if (!(await until(ctx, () => !!this.receiverInSight() || !!this.cue?.stop, o.siteWaitTicks))) {
            this.site = (this.site + 1) % o.sites.length;
            return;
        }
        if (this.cue?.stop) return;
        this.setPhase('requested');
        const req = await this.requestUntilOpen();
        this.bounces += req.bounces;
        if (!req.ok) {
            ctx.log('request', { ...req });
            return;
        }
        const t = tradeOf(this.s!);
        const hash = this.cue?.receiver.sha256;
        if (!t.partner || !hash || nameHash(t.partner) !== hash) {
            ctx.log('request: someone else opened a trade; declining');
            await ctx.sdk.sendDeclineTrade();
            return;
        }
        this.setPhase('trading');
        const r = await give(ctx.sdk, t.partner, [{ item: this.re, n: o.n }], { openTimeoutMs: 5_000 });
        if (r.ok) this.trades++;
        ctx.log('trade', { ok: r.ok, ticks: r.ticks, gave: r.gave.reduce((a, i) => a + i.count, 0), ...req, ...(r.reason ? { reason: r.reason } : {}) });
    }

    /** Keep a request standing until the receiver's click opens the screens. Gives up if it leaves sight or the cue stops. */
    private requestUntilOpen(): Promise<RequestOutcome> {
        const { ctx, o } = this;
        return new Promise(resolve => {
            let rc = newRequestCtx();
            let first = -1;
            let lastTick = -1;
            let bounceSeen = -1;
            let unseen = 0;
            const resendGaps: number[] = [];
            const finish = (ok: boolean, reason?: string) => {
                unsub();
                clearInterval(guard);
                resolve({ ok, waited: first < 0 ? 0 : (this.s?.tick ?? first) - first, sends: rc.sends, bounces: rc.bounces, resendGaps, ...(reason ? { reason } : {}) });
            };
            const onFrame = (st: BotWorldState) => {
                if (st.tick === lastTick && !tradeOf(st).isOpen) return;
                const fresh = st.tick !== lastTick;
                lastTick = st.tick;
                if (this.cue?.stop) return finish(false, 'cue stop');
                const receiver = this.receiverInSight();
                if (!receiver && !tradeOf(st).isOpen) {
                    if (fresh && ++unseen > 10) return finish(false, 'receiver left sight');
                    return;
                }
                unseen = 0;
                const d = decideRequest(st, rc, o);
                rc = d.next;
                if (d.action === 'open') return finish(true);
                if (d.action !== 'send') return;
                if (d.why === 'bounce') {
                    // The refusal is on this frame: the re-send goes out on it too, so it lands on the next tick.
                    bounceSeen = st.tick;
                    resendGaps.push(0);
                    this.ctx.log('bounce', { tick: st.tick });
                } else if (bounceSeen >= 0 && resendGaps.length) {
                    resendGaps[resendGaps.length - 1] = st.tick - bounceSeen;
                }
                if (first < 0) first = st.tick;
                void ctx.sdk.sendTradeRequest(receiver!.index);
            };
            const unsub = ctx.sdk.onStateUpdate(onFrame);
            const guard = setInterval(() => ctx.signal.aborted && finish(false, 'aborted'), 500);
            const cur = this.s;
            if (cur) onFrame(cur);
        });
    }

    /** Carry exactly `n` of the item and nothing else of it. */
    private async restock(): Promise<void> {
        const { ctx, o } = this;
        if (o.restock.kind === 'cheat') {
            if (!isLocalServer()) throw new Error('restock kind cheat is for the local lab only');
            const missing = o.n - this.held();
            if (missing > 0) await ctx.sdk.sendSay(`::give dragon_bones ${missing}`);
            if (!(await until(ctx, () => this.held() >= o.n, 10))) throw new Error('staff give did not arrive');
            return;
        }
        const bank = o.restock.bank;
        this.setPhase('restock', `to the bank at ${bank.x},${bank.z}`);
        await walkNear(ctx, bank.x, bank.z, 3);
        if (!(await openBank(ctx))) throw new Error('could not open the bank');
        await depositAllExcept(ctx.sdk);
        const w = await withdrawMany(ctx.sdk, [{ item: this.re, n: o.n }]);
        await closeBank(ctx);
        if (!w.ok || this.held() !== o.n) throw new Error(`bank withdraw left ${this.held()} of ${o.n} (${w.reason ?? 'short'})`);
    }
}

export const role: Role = {
    name: 'bone-giver',
    produces: [],
    async run(ctx: RoleContext) {
        await new BoneGiver(ctx).run();
    }
};

if (import.meta.main) await runStandalone(role);
