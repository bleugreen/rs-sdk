// altar-giver (role): one essence giver for the scored account's in-room
// Runecraft cycle (docs/speedrun/skills/runecraft.md sections 4 and 7). It
// restocks a talisman and 27 rune essence, enters the altar room, stands on its
// tile next to the receiver's, and when the scored side cues its turn through
// the cue directory (altar-cue.ts) it sends its half of the blind schedule on
// its own frames: trade request on T+5, offer all and accept on T+6, confirm on
// T+7 (robust: a second confirm on T+8). A 'stock' turn (the scored side's
// reacting fallback) is traded instead: request as soon as it is armed, then
// offer, accept and confirm on what each frame shows (lib/trade.ts give) until
// the judge tick.
// Then it restocks and comes back.
// The hand-back giver (option handBack, S21's end) makes one more trip once its essence runs
// out: its talisman and the hand-back items, no essence. Its status lists them under
// `handBack`, the scored side names it in a stock turn carrying `items`, it trades exactly
// those, and it is done.
// Contract, batch mode and measurements: docs/speedrun/helpers/altar-giver.md.
//
// Runs beside the scored account on the run machine (standalone.ts), never from
// the bbs fleet: the blind schedule has no slack for a relayed client.
//
// Role options (ROLE_OPTIONS):
//   altar      'air' (default), 'body' or 'nature'
//   slot       0 east (default), 1 west, 2 south of the receiver's tile
//   essence    essence per trade, offered exactly by count (default 27; the talisman takes the 28th slot).
//              A giver holding more counts itself loaded and offers `essence` of them (essencePresses)
//   schedule   'robust' forces the 8-tick schedule for every blind turn; default follows the cue
//   restock    { kind: 'bank'|'trade'|'cheat', bank?, acceptFrom?, restockAt?, labStock? } (altar-room.ts)
//   gapMs      wait after a frame before sending its packets (default 0: send on arrival)
//   handBack   [{ item, n }]: this giver is the hand-back giver (bank restock only). Once its bank
//              can't make an essence load it takes exactly these (and its talisman) instead
//              (altar-room.ts bankWithdrawals), and hands them over on a turn carrying `items`
//   cueDir     default RC_CUE_DIR, else run-machine/rc-cue in the checkout
//   scope      required: { step, family: 'altar' }, the cue this giver serves (altar-cue.ts CueScope; S06 or S21)
import type { BotWorldState, NearbyPlayer } from '../../sdk/types';
import { DROPPED_TICKS, give } from '../lib/trade';
import { tickClock, tickMs } from '../lib/wait';
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
    scopeOption,
    TRADE_ACCEPT,
    TRADE_CONFIRM,
    writeStatus,
    type Cue,
    type CueScope,
    type GiverAction,
    type GiverPhase,
    type Outcome,
    type Schedule,
    type TurnResult,
    type TurnSchedule
} from './altar-cue';
import { isXAmount } from '../lib/items';
import { altarData, carriedSlots, count, ESSENCE, enterRoom, exactItem, findAltar, findItem, holdsItems, inRoom, pos, restock, roomTiles, standOn, until, type Altar, type RestockOptions, type Tile } from './altar-room';
import type { HandBackItem } from './altar-cue';
import { ensureOutOfTutorial } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

export interface GiverOptions {
    altar: string;
    slot: number;
    essence: number;
    /** The hand-back giver's items (S21: 1 law, 3 air, 1 earth); absent for every other giver. */
    handBack?: HandBackItem[];
    schedule?: Schedule;
    restock: RestockOptions;
    gapMs: number;
    cueDir: string;
    scope: CueScope;
}

/** The `handBack` option: distinct items by name, each a whole count, beside the talisman. */
export function handBackOption(raw: unknown, restockKind: string): HandBackItem[] | undefined {
    if (raw === undefined) return undefined;
    if (!Array.isArray(raw) || raw.length === 0) throw new Error('handBack must be a non-empty list of { item, n }');
    if (restockKind !== 'bank') throw new Error('handBack needs restock kind bank: the runes-only trip is decided at the bank');
    const items = raw.map((r, i) => {
        const e = (r ?? {}) as Record<string, unknown>;
        const n = Number(e.n);
        if (typeof e.item !== 'string' || !e.item.trim() || !Number.isInteger(n) || n < 1) throw new Error(`handBack[${i}] needs an item name and a whole n of at least 1`);
        return { item: e.item, n };
    });
    if (new Set(items.map(i => i.item.toLowerCase())).size !== items.length) throw new Error('handBack names an item twice');
    if (items.length > 27) throw new Error('handBack does not fit beside the talisman');
    return items;
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
    const handBack = handBackOption(raw.handBack, kind);
    return {
        altar: String(raw.altar ?? 'air'),
        slot,
        ...(handBack ? { handBack } : {}),
        essence,
        ...(raw.schedule ? { schedule: raw.schedule as Schedule } : {}),
        restock: { ...r, kind, essence },
        gapMs: Number(raw.gapMs ?? 0),
        cueDir: typeof raw.cueDir === 'string' ? raw.cueDir : cueDir(env),
        scope: scopeOption(raw.scope, ['altar'])
    };
}

/** Client packets of the user-event kind (trade buttons included) the engine decodes per player per tick (ClientGameProtCategory.USER_EVENT); the rest wait a tick. */
export const USER_EVENTS_PER_TICK = 5;

/**
 * The trade-offer presses that put exactly `n` essence in the offer on the frame they are
 * sent, with the accept behind them on the same tick, or null when fewer than `n` are carried.
 *
 * - Holding exactly `n`: one All press, which moves inv_total, that is exactly `n`.
 * - Holding more: 10/5/1 presses, all on the highest essence slot. trade.rs2 movetotrade moves
 *   that many of the slot's object, and the engine takes them from the lowest slots first
 *   (Inventory.remove), so that slot keeps its essence until the last press.
 * - When those presses and the accept would not fit one tick's USER_EVENTS_PER_TICK, one
 *   Offer-X press of `n`. It costs the count dialog's round trip, a tick or more, so a blind turn
 *   misses; the stock turn absorbs it.
 *
 * Never an Offer-All with more than `n` held: the server would move every essence, and the
 * scored account refuses an offer bigger than its free slots (S06 runs 26 a load, rs/158).
 */
export function essencePresses(s: BotWorldState | null | undefined, n: number): Array<{ slot: number; amount: number }> | null {
    const slots = carriedSlots(s, ESSENCE);
    const held = slots.reduce((a, i) => a + i.count, 0);
    if (held < n || slots.length === 0) return null;
    const top = slots[slots.length - 1]!.slot;
    if (held === n) return [{ slot: top, amount: -1 }];
    const amounts = [...Array(Math.floor(n / 10)).fill(10), ...Array(Math.floor((n % 10) / 5)).fill(5), ...Array(n % 5).fill(1)];
    return amounts.length < USER_EVENTS_PER_TICK ? amounts.map(amount => ({ slot: top, amount })) : [{ slot: top, amount: n }];
}

interface Armed {
    key: string;
    session: string;
    seq: number;
    T: number;
    myT: number;
    open: number;
    schedule: TurnSchedule;
    receiverHash: string;
    /** Our frame when the turn was armed. */
    armedTick: number;
    /** A hand-back turn: these items instead of essence. */
    items?: HandBackItem[];
}

class Stop extends Error {}

/** A client whose newest tick arrived within this many ticks is alive (a catch-up burst stays inside it). */
const LIVE_FRAME_TICKS = 5;

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
    /** The hand-back went over: nothing more to give. */
    private handedBack = false;

    constructor(private readonly ctx: RoleContext) {
        this.o = giverOptions(ctx.options);
        this.altar = altarData(this.o.altar);
        this.loggedInAt = Number(process.env.LOGGED_IN_AT) || null;
    }

    /** Loaded for the hand-back: its items carried and short of an essence load. */
    private holdsHandBack(): boolean {
        return !!this.o.handBack && count(this.s, ESSENCE) < this.o.essence && holdsItems(this.s, this.o.handBack);
    }

    private loaded(): boolean {
        return count(this.s, ESSENCE) >= this.o.essence || this.holdsHandBack();
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
            ...(this.holdsHandBack() ? { handBack: this.o.handBack!.map(i => ({ ...i })) } : {}),
            ...(this.detail ? { detail: this.detail } : {}),
            ms: Date.now()
        });
    }

    private result(outcome: Outcome, session: string, T: number, extra: { myT?: number; detail?: string } = {}): void {
        this.last = { session, T, outcome, ...extra, ms: Date.now() };
        // Still loaded after the turn: ready again from now, which is what lifts the scored side's
        // skip after a failed turn (altar-cue.ts MissBench), and puts us behind the givers that
        // have waited longer. Only while our client delivers ticks: on the relay a role outlives
        // its dead client, arms the turns it is named for and fails them on the wall-clock
        // fallback, and renewing then lifted the skip turn after turn (lab: 3, 4 and 8 misses a
        // kill, against 1 on the direct path).
        const lastFrame = this.frames.recent(1)[0]?.ms;
        const live = lastFrame !== undefined && Date.now() - lastFrame <= LIVE_FRAME_TICKS * tickMs();
        if (outcome !== 'gave' && live && (this.phase === 'ready' || this.phase === 'armed')) this.readyAt = Date.now();
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
        const watcher = new CueWatcher(this.o.cueDir, this.o.scope, cue => this.onCue(cue), { log: (m, d) => ctx.log(m, d) });
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
        if (this.handedBack) {
            // S21 is over for us: stay logged in and quiet until the launcher stops us.
            this.setPhase('off', 'hand-back given');
            await new Promise<void>(resolve => (ctx.signal.aborted ? resolve() : ctx.signal.addEventListener('abort', () => resolve(), { once: true })));
            return;
        }
        if (!this.loaded() || count(this.s, this.altar.talisman) < 1) {
            this.setPhase('restock');
            await restock(ctx, this.altar, { ...this.o.restock, ...(this.o.handBack ? { handBack: this.o.handBack } : {}) }, d => this.setPhase('restock', d));
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
            if (!this.loaded()) return;
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
                if (a.items) this.handedBack = true;
                else this.gave++;
                return;
            }
            this.setPhase('ready');
            // A turn for us may have come while this one was in flight.
            if (this.cue) this.onCue(this.cue);
        }
    }

    /** A new cue: resolve the tick offset if needed, then arm, re-arm, report late, or stand down. */
    private onCue(cue: Cue): void {
        this.cue = cue;
        if (this.armed && (cue.stop || cue.session !== this.armed.session)) {
            if (this.started) return; // mid-trade: finish it; serve() re-reads the cue after
            this.result('cancelled', this.armed.session, this.armed.T, { detail: cue.stop ? 'stop' : 'new session' });
            this.done.add(this.armed.key);
            this.armed = null;
            this.setPhase('ready');
            // A new session's first cue may already name us (a program restart, the stock rung): read on.
            if (cue.stop) return;
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
        // A hand-back turn needs its items carried; an essence turn needs the essence (a hand-back giver has none).
        const items = choice.turn.items?.length ? choice.turn.items : undefined;
        const short = items ? (holdsItems(this.s, items) ? null : 'named for a hand-back without its items') : count(this.s, ESSENCE) < this.o.essence ? 'named for essence while holding the hand-back' : null;
        if (short) {
            this.done.add(choice.key);
            this.result('not-ready', cue.session, choice.turn.T, { detail: short });
            return;
        }
        if (this.armed) this.done.add(this.armed.key); // superseded by a newer turn for us
        // The robust option slows the blind schedules; a stock turn reacts and has no schedule to slow.
        const schedule: TurnSchedule = this.o.schedule === 'robust' && choice.schedule === 'tuned' ? 'robust' : choice.schedule;
        this.armed = { key: choice.key, session: cue.session, seq: cue.seq, T: choice.turn.T, myT: choice.myT, open: cue.open, schedule, receiverHash: cue.receiver.sha256, armedTick: now, ...(items ? { items: items.map(i => ({ ...i })) } : {}) };
        this.setPhase('armed');
        this.wakeServe?.();
    }

    private started = false;

    /**
     * Send this turn's packets, each on the first arrival of its frame (land - 1 in
     * our numbering), and judge it once the last landing has had a frame to show.
     */
    private async execute(a: Armed): Promise<Outcome> {
        if (a.schedule === 'stock' || a.items) return this.executeStock(a);
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
                    const presses = essencePresses(this.s, this.o.essence) ?? [];
                    const x = presses.find(p => isXAmount(p.amount));
                    // An Offer-X resolves after its count dialog: the accept goes behind the count.
                    if (x) void sdk.sendOfferItem(x.slot, x.amount).then(() => sdk.sendClickComponent(TRADE_ACCEPT));
                    else {
                        for (const p of presses) void sdk.sendOfferItem(p.slot, p.amount);
                        void sdk.sendClickComponent(TRADE_ACCEPT);
                    }
                } else void sdk.sendClickComponent(TRADE_CONFIRM);
            }
        };

        const outcome = await new Promise<Outcome | { late: number } | 'no-receiver' | 'cancelled'>(resolve => {
            let i = 0;
            let lastTick = -1;
            const finish = (v: Outcome | { late: number }) => {
                unsub();
                clock.stop();
                resolve(v);
            };
            // Reaching `judge` ends the turn; the tick limit only matters if the tick clock restarts.
            const limit = judge - (this.s?.tick ?? a.myT) + 20;
            const onFrame = (st: BotWorldState) => {
                clock.see(st);
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
                else if (clock.elapsed > limit) finish('missed');
            };
            const clock = tickClock(this.s?.tick, () => finish('missed'), this.s?.tick);
            const unsub = sdk.onStateUpdate(onFrame);
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

    /**
     * A stock turn: trade the receiver at once through lib/trade.ts's reacting give: request or
     * answer, offer every essence, accept, confirm, each on what the frames show, until the judge
     * tick. The scored side writes the turn when it wants essence, usually on the frame its craft
     * lands, and its own request from that frame is dropped by the engine (a click from a delayed
     * player). Ours is refused as busy until the craft's delay ends and re-sent on each refusal,
     * so it lands on the receiver's first free tick; the receiver answers it there
     * (openTrade). Waiting for T+K instead idled about three ticks a cycle.
     */
    private async executeStock(a: Armed): Promise<Outcome> {
        const { sdk } = this.ctx;
        const judge = judgeTick(a.myT, a.open, 'stock');
        this.started = false;
        let outcome: Outcome;
        let detail: string | undefined;
        const receiver = this.s?.nearbyPlayers.find(p => nameHash(p.name) === a.receiverHash);
        if (this.armed !== a) outcome = 'cancelled';
        else if (!receiver) outcome = 'no-receiver';
        else {
            this.started = true;
            const left = Math.max(1, judge - (this.s?.tick ?? judge));
            // By id: a noted stack shares the essence's name (NOTE_IDS) and must not be the offer.
            const essence = findItem(this.s, ESSENCE)?.id ?? ESSENCE;
            // Exactly `essence` by count: one All press when that is all we hold, else one Offer-X (items.ts amountButtons),
            // with give()'s accept behind the count. A hand-back turn offers exactly its items, by exact name, and no essence.
            const specs = a.items ? a.items.map(i => ({ item: exactItem(i.item), n: i.n })) : [{ item: essence, n: this.o.essence }];
            // Beside the receiver in the altar room: a silent click was dropped (lib/trade.ts DROPPED_TICKS).
            const r = await give(sdk, receiver.name, specs, { maxTicks: left, openMaxTicks: left, noReplyTicks: DROPPED_TICKS });
            outcome = r.ok ? 'gave' : 'missed';
            if (r.reason) detail = r.reason;
        }
        this.started = false;
        this.done.add(a.key);
        if (outcome === 'missed' && sdk.getTradeState().isOpen) {
            await sdk.sendDeclineTrade();
            await until(this.ctx, st => !st.trade?.isOpen, 5);
        }
        if (a.items && outcome === 'gave') detail = `hand-back: ${a.items.map(i => `${i.n} ${i.item}`).join(', ')}`;
        if (outcome !== 'cancelled') this.result(outcome, a.session, a.T, { myT: a.myT, ...(detail ? { detail } : {}) });
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
