// anvil (role): H5, the S25a anvil helper (docs/speedrun/helpers/anvil.md). The scored
// account smiths on the Varrock west anvil (3188,3426) from (3187,3426); this helper
// stands on the next tile (3187,3427) holding exactly the next inventory's bars and
// keeps a trade request standing with it. The scored account's own trade click
// (after the inventory's last item) then opens both screens at once; the helper
// offers the bars in one press per id with the accept behind them (lib/trade.ts
// give) and takes back the products the scored account offers in the same trade.
// Then it restocks for the next inventory while the scored account smiths it
// (about 25 ticks), and is back on its tile, requesting, before the inventory ends.
//
// The scored side owns the plan. It writes anvil-plan.json in the cue directory
// (writeAnvilPlan): {session, seq, give: {debug name: count}}, the inventory it
// wants next, and bumps seq as soon as the previous inventory's bars arrive. After the
// last inventory it writes {give: {}, collect: true}: the helper empties its own
// inventory, offers nothing and takes the last products back. Then {stop: true}. The
// receiver is never named: it is whoever in sight matches the receiver hash in the
// cue directory's cue.json (altar-cue.ts), as for the bone and altar givers.
//
// Runs on the run machine through the launcher (standalone.ts), beside the scored
// account's client, on the relay path (loopback gateway): every helper reaction
// sits on the scored account's clock, and a relay from bbs lands each one 2-3 ticks
// late. It uses only the sdk surface, so `path: 'direct'` works unchanged once the
// launcher has it.
//
// Role options (ROLE_OPTIONS):
//   restock      { kind: 'bank' | 'cheat', labStock?: boolean } (default bank). bank: the
//                Varrock west booth, re-clicked every tick until it opens, products
//                deposited and the exact bars withdrawn in the tick it opens (an empty
//                bank opens too, and then fails short unless labStock fills it). cheat:
//                ~clearinv and ::give on the tile (local lab only). labStock (lab only):
//                top the bank up with staff-made notes when it runs short.
//   tile         {x,z} where to stand (default 3187,3427)
//   trades       stop after this many trades (default: until the plan or the cue says stop)
//   noReplyTicks, resendTicks   the standing request (bone-giver.ts requestUntilOpen, lib/trade.ts's click rule): 2, 100
//   cueDir       default RC_CUE_DIR, else run-machine/rc-cue in the checkout
//   scope        required: { step, family: 'anvil' }, the cue this helper serves (altar-cue.ts CueScope; S25a)
import { join } from 'node:path';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, InventoryItem, NearbyLoc } from '../../sdk/types';
import { depositMatching, withdrawMany, type BankSdk } from '../lib/bank';
import { tickClock, waitUntil, type StateSource } from '../lib/wait';
import { ANY_OFFER, give, DROPPED_TICKS, receiveFrom, tradeOf, type GiveSpec, type WantSpec } from '../lib/trade';
import { assertUntracked, canonName, CueWatcher, cueDir, nameHash, readJson, scopeOption, writeJsonAtomicSync, type Cue, type CueScope } from './altar-cue';
import { chebyshev, cheat, isLocalServer, labTele, pos, until, type Tile } from './altar-room';
import { requestUntilOpen } from './bone-giver';
import { ensureOutOfTutorial } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

/** Varrock west anvil (loc 2783) and the two tiles beside it (docs/speedrun/skills/smithing.md section 1). */
export const ANVIL: Tile = { x: 3188, z: 3426 };
export const SCORED_TILE: Tile = { x: 3187, z: 3426 };
export const HELPER_TILE: Tile = { x: 3187, z: 3427 };
/** loc.pack: 2213 = bankbooth (Varrock west's booths are about 10 tiles north of the anvil). */
export const BOOTH_ID = 2213;

// ------------------------------------------------------------------ the plan (scored side -> helper)

export const PLAN_FILE = 'anvil-plan.json';

export interface AnvilPlan {
    v: 1;
    /** The scored side's session; a new session starts the delivered count over. */
    session: string;
    /** Index of the inventory the scored side wants next. */
    seq: number;
    /** Items for that inventory by debug name (bronze_bar, adamantite_bar, hammer), unnoted. */
    give: Record<string, number>;
    /** The final hand-back: give nothing, take the products (give must be empty). */
    collect?: boolean;
    stop?: boolean;
    ms: number;
}

/** A plan the helper may act on, or null. At most 28 items, each a positive count; empty only to collect or stop. */
export function validPlan(raw: unknown): AnvilPlan | null {
    const p = raw as Partial<AnvilPlan> | null;
    if (!p || typeof p !== 'object' || p.v !== 1 || typeof p.session !== 'string' || !Number.isInteger(p.seq) || p.seq! < 0) return null;
    if (!p.give || typeof p.give !== 'object') return null;
    let total = 0;
    for (const [name, n] of Object.entries(p.give)) {
        if (!/^[a-z0-9_]+$/.test(name) || !Number.isInteger(n) || n < 1) return null;
        total += n;
    }
    if (total > 28 || (total === 0 && !p.stop && !p.collect) || (p.collect && total > 0)) return null;
    return p as AnvilPlan;
}

export function writeAnvilPlan(dir: string, fields: { session: string; seq: number; give: Record<string, number>; collect?: boolean; stop?: boolean }): AnvilPlan {
    const plan: AnvilPlan = { v: 1, session: fields.session, seq: fields.seq, give: fields.give, ...(fields.collect ? { collect: true } : {}), ...(fields.stop ? { stop: true } : {}), ms: Date.now() };
    if (!validPlan(plan)) throw new Error(`not a valid anvil plan: ${JSON.stringify(fields)}`);
    writeJsonAtomicSync(join(dir, PLAN_FILE), plan);
    return plan;
}

export function readAnvilPlan(dir: string): AnvilPlan | null {
    return validPlan(readJson(join(dir, PLAN_FILE)));
}

// ------------------------------------------------------------------ staging

/** In-game name of a debug name: adamantite_bar is "Adamantite bar". */
export function itemRe(debugName: string): RegExp {
    return new RegExp(`^${debugName.replace(/_/g, ' ')}$`, 'i');
}

export interface Staging {
    /** The inventory holds exactly the plan's items, unnoted, and nothing else. */
    exact: boolean;
    /** One slot per item id to deposit-all (anything outside the plan, notes, or a planned item held over count). */
    deposit: InventoryItem[];
    /** What to take out of the bank (or make, in the lab) after the deposits. */
    withdraw: { name: string; n: number }[];
}

/**
 * What it takes to carry exactly `want`. Bars and the hammer are unstackable, so a
 * slot holding more than one of a planned name is a note stack and goes back.
 */
export function staging(inventory: readonly InventoryItem[], want: Record<string, number>): Staging {
    const names = Object.keys(want);
    const nameOf = (i: InventoryItem) => names.find(n => itemRe(n).test(i.name));
    const deposit = new Map<number, InventoryItem>();
    const held = new Map<string, number>();
    const sorted = [...inventory].sort((a, b) => a.slot - b.slot);
    for (const i of sorted) {
        const n = nameOf(i);
        if (!n || i.count !== 1) {
            if (!deposit.has(i.id)) deposit.set(i.id, i);
        } else held.set(n, (held.get(n) ?? 0) + 1);
    }
    const withdraw: { name: string; n: number }[] = [];
    for (const n of names) {
        const have = held.get(n) ?? 0;
        if (have > want[n]!) {
            for (const i of sorted) if (nameOf(i) === n && i.count === 1 && !deposit.has(i.id)) deposit.set(i.id, i);
            withdraw.push({ name: n, n: want[n]! });
        } else if (have < want[n]!) withdraw.push({ name: n, n: want[n]! - have });
    }
    return { exact: deposit.size === 0 && withdraw.length === 0, deposit: [...deposit.values()], withdraw };
}

/** The trade's offers: one spec per planned item, exact counts (lib/trade.ts presses an unstackable once). */
export function giveSpecs(want: Record<string, number>): GiveSpec[] {
    return Object.entries(want).map(([name, n]) => ({ item: itemRe(name), n }));
}

/** The final hand-back: accept as soon as anything is offered (re-accepting after any reset). */
export const COLLECT_WANT: WantSpec[] = [{ item: /./, amount: 1 }];

/** The planned items are no longer carried: only a completed trade takes them (the helper never drops). */
export function plannedGone(inventory: readonly InventoryItem[], want: Record<string, number>): boolean {
    return Object.keys(want).every(n => !inventory.some(i => itemRe(n).test(i.name) && i.count === 1));
}

// ------------------------------------------------------------------ the cycle

export interface Delivered {
    session: string;
    seq: number;
}

/** ctx.state key of the last inventory handed over. */
export const DELIVERED_KEY = 'anvil.delivered';

export function asDelivered(v: unknown): Delivered | null {
    const d = v as Partial<Delivered> | null | undefined;
    return d && typeof d.session === 'string' && Number.isInteger(d.seq) ? { session: d.session, seq: d.seq! } : null;
}

export type AnvilStep = 'stop' | 'wait-plan' | 'stage' | 'go-to-tile' | 'wait-receiver' | 'request';

/** The next thing to do, from what is known now. */
export function nextStep(o: { plan: AnvilPlan | null; delivered: Delivered | null; exact: boolean; onTile: boolean; receiverInSight: boolean; cueStop: boolean; tradeOpen: boolean }): AnvilStep {
    if (o.cueStop || o.plan?.stop) return 'stop';
    if (!o.plan) return 'wait-plan';
    if (o.delivered && o.delivered.session === o.plan.session && o.delivered.seq >= o.plan.seq) return 'wait-plan';
    if (!o.exact) return 'stage';
    // Staged with a trade already open (the scored account's click took our standing request while we
    // were off the tile): trade now. A walk or a new request click would close it.
    if (o.tradeOpen) return 'request';
    if (!o.onTile) return 'go-to-tile';
    if (!o.receiverInSight) return 'wait-receiver';
    return 'request';
}

/** The bank booth nearest the anvil, and the op that opens it at once. */
export function boothOf(s: BotWorldState): { loc: NearbyLoc; op: number } | null {
    const loc = s.nearbyLocs.filter(l => l.id === BOOTH_ID).sort((a, b) => chebyshev(a, ANVIL) - chebyshev(b, ANVIL))[0];
    if (!loc) return null;
    const op = (loc.optionsWithIndex.find(o => /^use-quickly$/i.test(o.text)) ?? loc.optionsWithIndex.find(o => /^(bank|use)$/i.test(o.text)))?.opIndex ?? 1;
    return { loc, op };
}

export type BoothSdk = StateSource & Pick<BotSDK, 'sendInteractLoc'>;

export interface BoothOpen {
    ok: boolean;
    clicks: number;
    /** Ticks from the first frame seen to the frame it ended on. */
    ticks: number;
    /** The bank opened with nothing in it. */
    empty: boolean;
    reason?: 'clicks' | 'ticks' | 'stalled' | 'aborted';
}

/**
 * Re-click the booth nearest the anvil every tick until the bank opens. Resolves on the
 * frame the bank shows its items, or, for an empty bank, once it has stayed open into a
 * later tick with none: what to do about an empty bank is the caller's call. Bounded by
 * clicks and by ticks; `stalled` is a client that stops publishing (wait.ts tickClock).
 */
export function openBooth(sdk: BoothSdk, opts: { maxClicks?: number; maxTicks?: number; signal?: AbortSignal } = {}): Promise<BoothOpen> {
    const maxClicks = opts.maxClicks ?? 40;
    const maxTicks = opts.maxTicks ?? maxClicks + 10;
    return new Promise(resolve => {
        let firstTick: number | null = null;
        let clickTick = -1;
        let clicks = 0;
        let openTick: number | null = null;
        let done = false;
        const finish = (ok: boolean, st: BotWorldState | null, reason?: BoothOpen['reason']) => {
            if (done) return;
            done = true;
            unsub();
            clearInterval(guard);
            clock.stop();
            const ticks = st && firstTick !== null ? st.tick - firstTick : 0;
            resolve({ ok, clicks, ticks, empty: ok && !!st && st.bank.items.length === 0, ...(reason ? { reason } : {}) });
        };
        const onFrame = (st: BotWorldState) => {
            if (done) return;
            clock.see(st);
            firstTick ??= st.tick;
            if (st.bank.isOpen) {
                // The item list can arrive a frame after the modal, within the same tick.
                if (st.bank.items.length || (openTick !== null && st.tick > openTick)) return finish(true, st);
                openTick ??= st.tick;
                return;
            }
            openTick = null;
            if (clock.elapsed >= maxTicks) return finish(false, st, 'ticks');
            if (st.tick === clickTick) return;
            if (clicks >= maxClicks) return finish(false, st, 'clicks');
            clickTick = st.tick;
            clicks++;
            const b = boothOf(st);
            if (b) void sdk.sendInteractLoc(b.loc.x, b.loc.z, b.loc.id, b.op);
        };
        const cur = sdk.getState();
        const clock = tickClock(cur?.tick, () => finish(false, sdk.getState(), 'stalled'), cur?.tick);
        const unsub = sdk.onStateUpdate(onFrame);
        const guard = setInterval(() => opts.signal?.aborted && finish(false, sdk.getState(), 'aborted'), 500);
        if (cur) onFrame(cur);
    });
}

/**
 * At an open bank, make the inventory exactly `give`: everything outside it goes in, and only once
 * it has left the inventory do the withdrawals go out (lib/bank.ts depositMatching, bounded by
 * observed ticks). Fired in the same tick as the withdrawals, a Deposit-All of 4 handed-back
 * daggers left one behind on the demo server, and the next trade offered the wrong slot. A deposit
 * that did not land is sent once more before giving up.
 */
export async function restockAtBank(sdk: BankSdk, give: Record<string, number>): Promise<{ ok: boolean; reason?: string }> {
    const inv = () => sdk.getState()?.inventory ?? [];
    const deposit = staging(inv(), give).deposit.map(d => d.id);
    if (deposit.length) {
        let d = await depositMatching(sdk, deposit);
        if (!d.ok) d = await depositMatching(sdk, deposit);
        if (!d.ok) return { ok: false, reason: `the deposit did not land (${d.reason}): ${d.remaining.map(i => i.name).join(', ')}` };
    }
    const withdraw = () => withdrawMany(sdk, staging(inv(), give).withdraw.map(x => ({ item: itemRe(x.name), n: x.n })));
    let w = await withdraw();
    let exact = await waitUntil(sdk, s => staging(s.inventory, give).exact, { maxTicks: 5 });
    // A withdrawal that did not land (the live server dropped one) goes again for what is still short;
    // an over-count (a late landing after all) is not topped up but fails below.
    if (!exact.ok && staging(inv(), give).deposit.length === 0) {
        w = await withdraw();
        exact = await waitUntil(sdk, s => staging(s.inventory, give).exact, { maxTicks: 5 });
    }
    if (!exact.ok) return { ok: false, reason: `bank left the inventory off the plan (${w.reason ?? 'no reason'}): ${JSON.stringify(staging(inv(), give))}` };
    return { ok: true };
}

/**
 * Walk onto `tile`, giving way to a trade: one the scored account opens while we walk is ours to
 * take, and a further walk would close it, so the walk stops the moment a trade opens.
 */
export async function walkToTile(ctx: Pick<RoleContext, 'sdk' | 'signal'>, tile: Tile): Promise<'on-tile' | 'trade'> {
    const at = (s: BotWorldState | null | undefined) => pos(s).x === tile.x && pos(s).z === tile.z;
    const trading = (s: BotWorldState | null | undefined) => !!s && tradeOf(s).isOpen;
    for (let attempt = 0; attempt < 5 && !ctx.signal.aborted; attempt++) {
        const s = ctx.sdk.getState();
        if (trading(s)) return 'trade';
        if (at(s)) return 'on-tile';
        await ctx.sdk.sendWalk(tile.x, tile.z);
        await waitUntil(ctx.sdk, st => at(st) || trading(st), { maxTicks: 34 });
    }
    const s = ctx.sdk.getState();
    if (trading(s)) return 'trade';
    if (!at(s)) throw new Error(`could not stand on ${tile.x},${tile.z}`);
    return 'on-tile';
}

// ------------------------------------------------------------------ options

export interface AnvilOptions {
    restock: { kind: 'bank' | 'cheat'; labStock: boolean };
    tile: Tile;
    trades: number;
    noReplyTicks: number;
    resendTicks: number;
    cueDir: string;
    scope: CueScope;
}

export function anvilOptions(raw: Record<string, unknown>, env: Record<string, string | undefined> = process.env): AnvilOptions {
    const r = (raw.restock ?? {}) as Record<string, unknown>;
    const kind = r.kind ?? 'bank';
    if (kind !== 'bank' && kind !== 'cheat') throw new Error(`restock.kind must be bank or cheat (got ${kind})`);
    const t = (raw.tile ?? HELPER_TILE) as Record<string, unknown>;
    const tile = { x: Number(t.x), z: Number(t.z) };
    if (!Number.isInteger(tile.x) || !Number.isInteger(tile.z)) throw new Error('tile needs integer x and z');
    const trades = raw.trades === undefined ? Number.POSITIVE_INFINITY : Number(raw.trades);
    if (!(trades >= 1)) throw new Error(`trades must be at least 1 (got ${raw.trades})`);
    return {
        restock: { kind, labStock: r.labStock === true },
        tile,
        trades,
        noReplyTicks: Number(raw.noReplyTicks ?? DROPPED_TICKS),
        resendTicks: Number(raw.resendTicks ?? 100),
        cueDir: typeof raw.cueDir === 'string' ? raw.cueDir : cueDir(env),
        scope: scopeOption(raw.scope, ['anvil'])
    };
}

// ------------------------------------------------------------------ role

export type AnvilPhase = 'start' | 'waiting' | 'restock' | 'travel' | 'requested' | 'trading' | 'fault' | 'off';

export interface AnvilStatus {
    v: 1;
    account: string;
    phase: AnvilPhase;
    delivered: Delivered | null;
    trades: number;
    tile: { x: number; z: number } | null;
    detail?: string;
    ms: number;
}

export const statusFile = (dir: string, account: string) => join(dir, `anvil-${canonName(account)}.json`);

interface Opened {
    ok: boolean;
    /** Tick our request was first answered "Sending trade offer..." (it then stands), or null. */
    landedTick: number | null;
    sends: number;
    bounces: number;
    reason?: string;
}

export class AnvilHelper {
    readonly o: AnvilOptions;
    private cue: Cue | null = null;
    private plan: AnvilPlan | null = null;
    private delivered: Delivered | null = null;
    private phase: AnvilPhase = 'start';
    private detail = '';
    private trades = 0;
    /** Tick the last trade completed: the restock clock for the next one. */
    private freedTick: number | null = null;
    private stagedTick: number | null = null;

    constructor(private readonly ctx: RoleContext) {
        this.o = anvilOptions(ctx.options);
        // Restartable: a restart inside a session must not stage an inventory it already handed over.
        this.delivered = asDelivered(ctx.state.get(DELIVERED_KEY));
    }

    private get s(): BotWorldState | null {
        return this.ctx.sdk.getState();
    }

    private setPhase(phase: AnvilPhase, detail = ''): void {
        if (phase !== this.phase || detail !== this.detail) this.ctx.log('phase', { from: this.phase, to: phase, ...(detail ? { detail } : {}) });
        this.phase = phase;
        this.detail = detail;
        this.publish();
    }

    private publish(): void {
        const status: AnvilStatus = {
            v: 1,
            account: this.ctx.account,
            phase: this.phase,
            delivered: this.delivered,
            trades: this.trades,
            tile: this.s?.player ? { x: pos(this.s).x, z: pos(this.s).z } : null,
            ...(this.detail ? { detail: this.detail } : {}),
            ms: Date.now()
        };
        writeJsonAtomicSync(statusFile(this.o.cueDir, this.ctx.account), status);
    }

    private receiverInSight() {
        const hash = this.cue?.receiver.sha256;
        return hash ? this.s?.nearbyPlayers.find(p => nameHash(p.name) === hash) : undefined;
    }

    private step(): AnvilStep {
        this.plan = readAnvilPlan(this.o.cueDir);
        const s = this.s;
        return nextStep({
            plan: this.plan,
            delivered: this.delivered,
            exact: !!this.plan && !!s && staging(s.inventory, this.plan.give).exact,
            onTile: !!s && pos(s).x === this.o.tile.x && pos(s).z === this.o.tile.z,
            receiverInSight: !!this.receiverInSight(),
            cueStop: !!this.cue?.stop,
            tradeOpen: !!s && tradeOf(s).isOpen
        });
    }

    async run(): Promise<void> {
        const { ctx, o } = this;
        assertUntracked(o.cueDir);
        const watcher = new CueWatcher(o.cueDir, o.scope, cue => (this.cue = cue), { log: (m, d) => ctx.log(m, d) });
        const heartbeat = setInterval(() => this.publish(), 2000);
        try {
            await ensureOutOfTutorial(ctx);
            await ctx.bot.dismissBlockingUI();
            if (ctx.sdk.getTradeState().isOpen) await ctx.sdk.sendDeclineTrade();
            if (process.env.HELPER_LAB_TELE === '1' && chebyshev(pos(this.s), o.tile) > 150) await labTele(ctx, o.tile);
            while (!ctx.signal.aborted && this.trades < o.trades) {
                const step = this.step();
                if (step === 'stop') break;
                try {
                    await this.act(step);
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
        ctx.log('anvil: finished', { trades: this.trades, delivered: this.delivered });
    }

    private async act(step: Exclude<AnvilStep, 'stop'>): Promise<void> {
        const { ctx, o } = this;
        switch (step) {
            case 'wait-plan':
                this.setPhase('waiting', 'for the next plan');
                await until(ctx, () => this.step() !== 'wait-plan', 100);
                return;
            case 'stage':
                this.setPhase('restock', `seq ${this.plan!.seq} ${o.restock.kind}`);
                if (o.restock.kind === 'cheat') await this.cheatStage(this.plan!);
                else await this.bankStage(this.plan!);
                return;
            case 'go-to-tile':
                this.setPhase('travel', 'to the anvil');
                await walkToTile(ctx, o.tile);
                return;
            case 'wait-receiver':
                this.setPhase('waiting', 'for the scored account');
                await until(ctx, () => this.step() !== 'wait-receiver', 50);
                return;
            case 'request':
                return this.tradeOnce(this.plan!);
        }
    }

    /** Keep a request standing until the scored account's click opens the screens, then give. */
    private async tradeOnce(plan: AnvilPlan): Promise<void> {
        const { ctx } = this;
        this.stagedTick ??= this.s!.tick;
        this.setPhase('requested', `seq ${plan.seq}`);
        const req = await this.requestUntilOpen();
        if (!req.ok) {
            ctx.log('request', { seq: plan.seq, ...req });
            return;
        }
        const openTick = this.s!.tick;
        const t = tradeOf(this.s!);
        const hash = this.cue?.receiver.sha256;
        if (!t.partner || !hash || nameHash(t.partner) !== hash) {
            ctx.log('request: someone else opened a trade; declining', { partner: t.partner });
            await ctx.sdk.sendDeclineTrade();
            return;
        }
        this.setPhase('trading', `seq ${plan.seq}${plan.collect ? ' collect' : ''}`);
        const r = plan.collect
            ? await receiveFrom(ctx.sdk, t.partner, { want: COLLECT_WANT, openMaxTicks: 17 }).then(x => ({ ...x, gave: [] as { count: number }[] }))
            : // The scored account hands back whatever it made (a refused make click leaves 4), so any offer
              // of theirs is fine; our own offer is what the giver checks exactly, on both screens.
              await give(ctx.sdk, t.partner, giveSpecs(plan.give), { expectTheirs: ANY_OFFER, openMaxTicks: 17 });
        const st = this.s!;
        // A completed trade is the only way the bars leave: count it even when the outcome came back unsettled.
        const delivered = r.ok || (!plan.collect && plannedGone(st.inventory, plan.give));
        if (delivered) {
            this.delivered = { session: plan.session, seq: plan.seq };
            await ctx.state.set(DELIVERED_KEY, this.delivered);
            this.trades++;
        }
        ctx.log('trade', {
            seq: plan.seq,
            ok: r.ok,
            delivered,
            ticks: r.ticks,
            gave: r.gave.reduce((a, i) => a + i.count, 0),
            received: st.inventory.length,
            // Helper-side slack: from back on the tile staged, and from the request standing, to the screens opening.
            restock: this.freedTick !== null && this.stagedTick !== null ? this.stagedTick - this.freedTick : null,
            stagedToOpen: this.stagedTick !== null ? openTick - this.stagedTick : null,
            standingToOpen: req.landedTick !== null ? openTick - req.landedTick : null,
            sends: req.sends,
            bounces: req.bounces,
            ...(r.reason ? { reason: r.reason } : {})
        });
        if (delivered) {
            this.freedTick = st.tick;
            this.stagedTick = null;
        }
        this.publish();
    }

    private async requestUntilOpen(): Promise<Opened> {
        const r = await requestUntilOpen(this.ctx, this.o, { receiver: () => this.receiverInSight(), stopped: () => !!this.cue?.stop, log: () => {} });
        return { ok: r.ok, landedTick: r.landedTick >= 0 ? r.landedTick : null, sends: r.sends, bounces: r.bounces, ...(r.reason ? { reason: r.reason } : {}) };
    }

    /** Lab: make the inventory exact with staff commands, on the tile. */
    private async cheatStage(plan: AnvilPlan): Promise<void> {
        const { ctx } = this;
        if (!isLocalServer()) throw new Error('restock kind cheat is for the local lab only');
        if (staging(this.s!.inventory, plan.give).deposit.length) {
            await cheat(ctx, '~clearinv inv');
            await until(ctx, st => st.inventory.length === 0, 10);
        }
        for (const w of staging(this.s!.inventory, plan.give).withdraw) await cheat(ctx, `give ${w.name} ${w.n}`);
        if (!(await until(ctx, st => staging(st.inventory, plan.give).exact, 10))) throw new Error('staff give did not arrive');
    }

    /**
     * The Varrock west booth: re-click it every tick until the bank opens, then in that
     * tick deposit everything outside the plan and withdraw the plan's shortfall.
     */
    private async bankStage(plan: AnvilPlan): Promise<void> {
        const { ctx, o } = this;
        const open = await openBooth(ctx.sdk, { signal: ctx.signal });
        if (!open.ok) throw new Error(`the bank did not open (${open.reason}: ${open.clicks} clicks over ${open.ticks} ticks)`);
        if (open.empty) ctx.log('bank: opened empty', { labStock: o.restock.labStock });
        if (o.restock.labStock) await this.labStock(plan);
        const st = staging(this.s!.inventory, plan.give);
        const short = st.withdraw.filter(w => (this.s!.bank.items.filter(i => itemRe(w.name).test(i.name)).reduce((a, i) => a + i.count, 0)) < w.n);
        if (short.length) throw new Error(`the bank ${this.s!.bank.items.length ? 'is' : 'is empty, so'} short of ${short.map(w => `${w.n} ${w.name}`).join(', ')}`);
        const r = await restockAtBank(ctx.sdk, plan.give);
        ctx.reportBank({ items: this.s!.bank.items.map(i => ({ id: i.id, name: i.name, count: i.count })) });
        if (!r.ok) throw new Error(r.reason);
    }

    /** Lab only: top the bank up with staff-made notes (deposited, so the bank holds them unnoted). */
    private async labStock(plan: AnvilPlan): Promise<void> {
        const { ctx } = this;
        if (!isLocalServer()) throw new Error('labStock is for the local lab only');
        const banked = (name: string) => this.s!.bank.items.filter(i => itemRe(name).test(i.name)).reduce((a, i) => a + i.count, 0);
        const short = Object.entries(plan.give).filter(([name, n]) => banked(name) < n);
        if (!short.length) return;
        // Room for the notes: everything off the plan goes in first.
        for (const d of staging(this.s!.inventory, plan.give).deposit) void ctx.sdk.sendBankDeposit(d.slot, -1);
        await until(ctx, st => staging(st.inventory, plan.give).deposit.length === 0, 5);
        for (const [name] of short) await cheat(ctx, name.endsWith('_bar') ? `give cert_${name} 500` : `give ${name} 1`);
        await until(ctx, st => short.every(([name]) => st.inventory.some(i => itemRe(name).test(i.name))), 10);
        for (const i of this.s!.inventory.filter(i => short.some(([name]) => itemRe(name).test(i.name)))) void ctx.sdk.sendBankDeposit(i.slot, -1);
        await until(ctx, () => short.every(([name, n]) => banked(name) >= n), 10);
        ctx.log('labStock', { stocked: short.map(([name]) => name) });
    }
}

export const role: Role = {
    name: 'anvil',
    produces: [],
    async run(ctx: RoleContext) {
        await new AnvilHelper(ctx).run();
    }
};

if (import.meta.main) await runStandalone(role);
