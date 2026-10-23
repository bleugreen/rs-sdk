/**
 * The phase-2 runner (docs/markets/phase2.md 'Running'): brings every account of a plan to its method and runs it,
 * from one process on one address, until stopped.
 *
 *   bun markets/phase2/run.ts <plan.json> [--out DIR] [--minutes N] [--run-ended] [--placeholder-data]
 *
 * Each account logs in with its own in-process lite client (speedrun/lib/direct.ts), credentials from
 * bots/<account>/bot.env, every account on the same SERVER. Then it works through its setup sequence (plan.ts
 * `sequenceFor`, stages.ts) and runs its method's Role until the run stops.
 *
 * - Logins go through the gate (gate.ts): never a second login for an account whose first has not answered, never
 *   more sessions than the plan's `maxSessions`, starts spaced, refusals held off by code.
 * - The knights come online in the ramp's steps (ramp.ts); a step whose median rate per login falls more than
 *   `dropPct` below the first's stops the ramp and sends the knights not yet admitted to `ramp.fallbackMix`.
 * - An account with no sharks to eat (none left in its bank, or a purchase that came up short) goes to
 *   `foodFallbackMix`: plan B's low-food methods, guards and iron.
 * - The ledger (ledger.ts) gets a line per account every `ledger.everyTicks` of its ticks and a totals line on the
 *   same cadence, plus the ramp's decisions, redirects, purchases and sales. Accounts appear as aliases
 *   (names.ts); the names file guard (lib/accounts.ts) refuses to start without it, and a run on real accounts
 *   needs every account on it. `--placeholder-data` is for lab accounts only.
 * - `--run-ended` confirms main has announced the scored run's end: without it a plan that buys sharks refuses to
 *   start (sharks are a fleet input, docs/speedrun/SUPPLIES.md).
 * - SIGINT or SIGTERM stops every account at its next safe point and logs it out; a second signal exits at once.
 *   `--minutes N` stops the same way after N minutes.
 *
 * Output, in --out (default $TMPDIR/phase2-<time>): ledger.jsonl, events.jsonl (every account's stage changes and
 * role log lines), role-state/<alias>.json. Exit 0 when every account logged out, 1 otherwise, 2 on a bad start.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BotActions } from '../../sdk/actions';
import { executionContext } from '../../sdk/execution-context';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import { pointMarketAtServer } from '../../speedrun/helpers/mule';
import { openRoleState, type RoleState } from '../../speedrun/helpers/role';
import { directLogoutText, logoutOutcome, openDirectSession, type DirectSession, type DirectSessionEnd } from '../../speedrun/lib/direct';
import { waitForFreshState } from '../../speedrun/lib/fresh-state';
import { loadBotEnv, type BotEnv } from '../../speedrun/lib/session';
import { tickMs } from '../../speedrun/lib/wait';
import { writerExclusion } from '../lib/accounts.ts';
import { Gentle } from '../lib/demo.ts';
import { DemoMarket, type MarketQuote } from '../lib/market.ts';
import { numberFlag, parseArgs } from '../methods/probe-sampler.ts';
import { debugNameOf } from '../methods/trips.ts';
import { costOf } from '../methods/value.ts';
import { buySharks, sellAtExchange, type BookReader } from './errands.ts';
import { DEFAULT_POLICY, LoginGate } from './gate.ts';
import { accountLine, COINS_ID, totalsLine, type AccountSnapshot, type Stack, type Valuer } from './ledger.ts';
import { aliasOf, nameScrubber, scrubRecord, unlistedAccounts } from './names.ts';
import { NEEDS, nextFallback, parsePlan, PlanError, roleOptions, SALE_ROUTE, sequenceFor, type AccountPlan, type MethodId, type Plan } from './plan.ts';
import { KnightsRamp, rateBetween } from './ramp.ts';
import { runStage, stageDone, type StageCtx, type StageHooks } from './stages.ts';

const USAGE = 'usage: bun markets/phase2/run.ts <plan.json> [--out DIR] [--minutes N] [--run-ended] [--placeholder-data]';
const BOOLEAN_FLAGS = ['--run-ended', '--placeholder-data'];

/** Wall-clock bound on one account's logout (direct.ts logoutDirect re-clicks through the post-combat window). */
const LOGOUT_MS = 35_000;
/** How long a stop waits for every account to leave before exiting anyway. */
const STOP_WAIT_MS = 90_000;
/** A stage that fails this many times in a row gives the account up. */
const STAGE_TRIES = 3;
/** Sessions that end in an error within this long of their login count towards giving the account up. */
const SHORT_SESSION_MS = 120_000;
const READINGS_KEEP_MS = 3 * 3_600_000;

interface Reading {
    at: number;
    session: number;
    tick: number;
    coins: number;
}

class GiveUp extends Error {}

class Worker {
    method: MethodId;
    stage = 'waiting';
    sessionNo = 0;
    ctl: AbortController | null = null;
    stageCtl: AbortController | null = null;
    active: Promise<void> | null = null;
    done = false;
    bank: Stack[] | null = null;
    bankTick: number | null = null;
    latest: AccountSnapshot | null = null;
    nextLedgerTick = -1;
    readings: Reading[] = [];
    arrivedAdmission: number | null = null;
    admittedAt: number | null = null;
    redirect: { method: MethodId; reason: string } | null = null;
    saleDue: { item: { id: number; name: string }; floor: number } | null = null;
    lastSaleAt = Date.now();
    shortSessions = 0;
    logout: Record<string, unknown> | null = null;
    /** First tick of this session and when it was seen: the session's observed ms a tick. */
    private tick0: { tick: number; at: number } | null = null;

    constructor(
        readonly index: number,
        readonly alias: string,
        readonly plan: AccountPlan,
        readonly env: BotEnv,
        readonly roleState: RoleState
    ) {
        this.method = plan.method;
    }

    newSession(): void {
        this.sessionNo++;
        this.nextLedgerTick = -1;
        this.tick0 = null;
    }

    msPerTick(s: BotWorldState): number | null {
        if (!this.tick0) {
            this.tick0 = { tick: s.tick, at: Date.now() };
            return null;
        }
        const ticks = s.tick - this.tick0.tick;
        return ticks > 0 ? Math.round(((Date.now() - this.tick0.at) / ticks) * 10) / 10 : null;
    }
}

const stacks = (items: readonly { id: number; name: string; count: number }[]): Stack[] => items.map(i => ({ id: i.id, name: i.name, count: i.count }));

export interface RunOptions {
    host: string;
    out: string;
    minutes: number;
    runEnded: boolean;
    placeholder: boolean;
}

export class Runner {
    readonly gate: LoginGate;
    readonly ramp: KnightsRamp | null;
    stopping = false;
    private stopped: Promise<number> | null = null;
    private readonly rampFallback = new Map<MethodId, number>();
    private readonly foodFallback = new Map<MethodId, number>();
    private readonly quotes = new Map<number, MarketQuote>();
    private quoting = false;
    private lastQuotesAt = 0;
    private lastTotalsAt = Date.now();
    private timer: ReturnType<typeof setInterval> | null = null;
    private readonly startedAt = Date.now();
    private readonly market: DemoMarket;
    private readonly book: BookReader;
    private readonly valuer: Valuer;
    private readonly scrub: (text: string) => string;
    private readonly tickMs = tickMs();

    constructor(
        readonly plan: Plan,
        readonly workers: Worker[],
        readonly o: RunOptions
    ) {
        this.gate = new LoginGate({ ...DEFAULT_POLICY, maxSessions: plan.maxSessions, spacingMs: plan.loginSpacingMs });
        const knights = workers.filter(w => w.method === 'knights').length;
        this.ramp = plan.ramp && knights > 0 ? new KnightsRamp(plan.ramp, Date.now()) : null;
        this.market = new DemoMarket(new Gentle({ server: o.host, minIntervalMs: 3_000 }));
        this.book = { item: id => this.market.item(id).then(q => (this.quotes.set(id, q), q)) };
        this.valuer = { cost: s => costOf(debugNameOf(s.id)), quote: id => this.quotes.get(id) };
        this.scrub = nameScrubber(workers.map(w => w.plan.account));
        mkdirSync(o.out, { recursive: true });
    }

    // ------------------------------------------------------------ output

    private write(file: string, record: Record<string, unknown>): void {
        appendFileSync(join(this.o.out, file), JSON.stringify(scrubRecord(record, this.scrub)) + '\n');
    }

    ledger(record: Record<string, unknown>): void {
        this.write('ledger.jsonl', { t: new Date().toISOString(), ...record });
    }

    event(w: Worker | null, message: string, data: Record<string, unknown> = {}, loud = false): void {
        const rec = { t: new Date().toISOString(), ...(w ? { account: w.alias, method: w.method, stage: w.stage } : {}), message, ...data };
        this.write('events.jsonl', rec);
        if (loud) process.stderr.write(this.scrub(`${rec.t} ${w ? `${w.alias} ` : ''}${message}${Object.keys(data).length ? ' ' + JSON.stringify(data) : ''}`) + '\n');
    }

    // ------------------------------------------------------------ the loop

    start(): void {
        this.ledger({
            kind: 'start',
            placeholder: this.o.placeholder,
            accounts: Object.fromEntries(this.workers.map(w => [w.alias, w.method])),
            maxSessions: this.plan.maxSessions,
            ramp: this.plan.ramp,
            sharks: this.plan.sharks,
            sell: { ...this.plan.sell, enabled: this.plan.sell.enabled },
            ledgerEveryTicks: this.plan.ledger.everyTicks,
            tickMs: this.tickMs,
            runEnded: this.o.runEnded,
            minutes: this.o.minutes
        });
        this.timer = setInterval(() => this.pump(), 500);
    }

    private pump(): void {
        const now = Date.now();
        if (!this.stopping) {
            for (const w of this.workers) {
                if (w.active || w.done) continue;
                const acct = w.plan.account;
                if (this.gate.state(acct) === 'failed') {
                    w.done = true;
                    this.event(w, 'given up: no more logins', {}, true);
                    continue;
                }
                if (!this.gate.tryStart(acct, now).ok) continue;
                w.active = this.connect(w).finally(() => (w.active = null));
            }
            this.pumpRamp(now);
            this.pumpSales(now);
            if (this.o.minutes > 0 && now - this.startedAt >= this.o.minutes * 60_000) void this.stop(`${this.o.minutes} minutes`);
        }
        if (now - this.lastTotalsAt >= this.plan.ledger.everyTicks * this.tickMs) {
            this.lastTotalsAt = now;
            this.totals(false);
        }
        if (!this.quoting && now - this.lastQuotesAt >= this.plan.ledger.bookMinutes * 60_000) void this.refreshQuotes();
    }

    private totals(final: boolean): void {
        const latest = this.workers.flatMap(w => (w.latest ? [w.latest] : []));
        this.ledger({ ...totalsLine(latest, this.valuer, this.gate.sessions(), new Date(), final), ramp: this.ramp ? { phase: this.ramp.phase, step: this.ramp.stepNumber, admitted: this.ramp.admitted() } : null });
    }

    /** The book for every item an account banks (and every item with a sale floor), one read every 3 s. */
    private async refreshQuotes(): Promise<void> {
        this.quoting = true;
        this.lastQuotesAt = Date.now();
        const ids = new Set<number>();
        for (const w of this.workers) for (const s of w.bank ?? []) if (s.id !== COINS_ID) ids.add(s.id);
        try {
            for (const id of ids) {
                if (this.stopping) break;
                await this.book.item(id).catch(e => this.event(null, 'book read failed', { id, error: String(e) }));
            }
        } finally {
            this.quoting = false;
        }
    }

    // ------------------------------------------------------------ logins

    private async connect(w: Worker): Promise<void> {
        const acct = w.plan.account;
        w.newSession();
        const t0 = Date.now();
        this.event(w, 'login', { session: w.sessionNo }, true);
        let session: DirectSession;
        try {
            session = await openDirectSession({ host: this.o.host, username: w.env.BOT_USERNAME, password: w.env.PASSWORD, profanityFilter: false });
        } catch (e) {
            const err = e as { name?: string; code?: number; message?: string };
            const now = Date.now();
            if (err.name === 'LoginError' && typeof err.code === 'number') {
                this.gate.answered(acct, { ok: false, code: err.code }, now);
                this.event(w, 'login refused', { code: err.code, message: err.message, waitedMs: now - t0 }, true);
            } else if (err.name === 'OutdatedClientError') {
                this.gate.answered(acct, { ok: false, code: -1 }, now);
                this.gate.giveUp(acct);
                this.event(w, 'the server runs another client revision', { message: err.message }, true);
                void this.stop('outdated client');
            } else {
                this.gate.unanswered(acct, now);
                this.event(w, 'login ended without an answer', { error: String(e), waitedMs: now - t0 }, true);
            }
            return;
        }
        this.gate.answered(acct, { ok: true }, Date.now());
        this.event(w, 'in the world', { session: w.sessionNo, loginMs: Date.now() - t0 }, true);
        let gaveUp = false;
        try {
            await this.work(w, session);
        } catch (e) {
            gaveUp = e instanceof GiveUp;
            this.event(w, gaveUp ? 'giving up' : 'session error', { error: String(e) }, true);
            if (!gaveUp && !this.stopping && Date.now() - t0 < SHORT_SESSION_MS && ++w.shortSessions >= STAGE_TRIES) gaveUp = true;
        }
        this.gate.ended(acct, Date.now());
        if (gaveUp) {
            this.gate.giveUp(acct);
            w.done = true;
        }
    }

    /** One session: the stages until stopped, then the logout. Throws GiveUp when the account cannot go on. */
    private async work(w: Worker, session: DirectSession): Promise<void> {
        const ctl = new AbortController();
        w.ctl = ctl;
        if (this.stopping) ctl.abort(new Error('stopping'));
        let end: DirectSessionEnd | null = null;
        void session.ended.then(e => {
            end = e;
            ctl.abort(new Error(`session ended (${e.reason})`));
        });
        const { sdk, bot } = await session.connectSdk({ showChat: false });
        pointMarketAtServer(sdk, this.o.host);
        const off = sdk.onStateUpdate(s => this.observe(w, s));
        let failure: unknown = null;
        try {
            await executionContext.run({ signal: ctl.signal }, async () => {
                await waitForFreshState(sdk, { timeoutMs: 60_000, signal: ctl.signal });
                await this.stages(w, sdk, bot, ctl.signal);
            });
        } catch (e) {
            if (!ctl.signal.aborted || e instanceof GiveUp) failure = e;
        }
        if (end) {
            session.close();
            this.event(w, 'session ended', { reason: (end as DirectSessionEnd).reason }, true);
        } else {
            w.stage = 'logout';
            const r = await session.logout({ timeoutMs: LOGOUT_MS });
            w.logout = { outcome: logoutOutcome(r), text: directLogoutText(r) };
            this.event(w, 'logout', w.logout, true);
        }
        off();
        w.ctl = null;
        w.stage = 'out';
        if (failure) throw failure;
    }

    private hooks(w: Worker, x: () => StageCtx): StageHooks {
        return {
            admitted: () => !this.ramp || w.method !== 'knights' || w.admittedAt !== null,
            foodOut: reason => this.foodOut(w, reason),
            buySharks: async () => {
                const s = this.plan.sharks;
                const r = await buySharks(x(), { perAccount: s.perAccount, ceiling: s.ceiling, runEnded: this.o.runEnded, fillMinutes: s.fillMinutes }, this.book);
                this.ledger({ account: w.alias, ...r.record });
                if (r.record.result === 'refused' && !this.o.runEnded) throw new Error(String(r.record.reason));
                if (r.banked < s.minimum) this.foodOut(w, `${r.banked} sharks banked after the purchase, below the minimum of ${s.minimum}`);
            }
        };
    }

    private async stages(w: Worker, sdk: BotSDK, bot: BotActions, signal: AbortSignal): Promise<void> {
        let failed: { stage: string; n: number } = { stage: '', n: 0 };
        const fail = async (stage: string, error: string) => {
            failed = { stage, n: failed.stage === stage ? failed.n + 1 : 1 };
            this.event(w, 'stage failed', { stage, error, tries: failed.n }, true);
            if (failed.n >= STAGE_TRIES) throw new GiveUp(`${stage} failed ${failed.n} times: ${error}`);
            await sdk.waitForTicks(10).catch(() => undefined);
        };
        while (!signal.aborted) {
            if (w.redirect) this.applyRedirect(w);
            const stageCtl = new AbortController();
            const onAbort = () => stageCtl.abort(signal.reason);
            signal.addEventListener('abort', onAbort, { once: true });
            const x: StageCtx = {
                account: w.plan.account,
                sessionId: w.sessionNo,
                sdk,
                bot,
                env: { SERVER: this.o.host },
                signal: stageCtl.signal,
                roleState: w.roleState,
                options: roleOptions({ ...w.plan, method: w.method }, this.plan),
                event: (m, d) => this.event(w, m, d),
                reportBank: items => {
                    w.bank = items;
                    w.bankTick = sdk.getState()?.tick ?? w.bankTick;
                },
                hooks: this.hooks(w, () => x)
            };
            const st = sequenceFor({ method: w.method, hp: w.plan.hp }, this.plan).find(s => !stageDone(s, sdk.getState()!, x.hooks, w.roleState))!;
            if (st.do !== w.stage) this.event(w, 'stage', { to: st.do, ...('to' in st ? { level: st.to } : {}) }, true);
            w.stage = st.do;
            if (st.do === 'admission') w.arrivedAdmission ??= Date.now();
            w.stageCtl = stageCtl;
            try {
                if (st.do === 'method' && w.saleDue) await this.sale(w, x);
                else {
                    await runStage(st, x, w.method);
                    if (st.do === 'method') await sdk.waitForTicks(5).catch(() => undefined);
                    else if (!stageDone(st, sdk.getState()!, x.hooks, w.roleState)) await fail(st.do, 'ended without reaching its goal');
                    else failed = { stage: '', n: 0 };
                }
            } catch (e) {
                if (e instanceof GiveUp) throw e;
                if (signal.aborted) break;
                // a redirect or a sale aborted the stage: go round again
                if (!stageCtl.signal.aborted) await fail(st.do, e instanceof Error ? e.message : String(e));
            } finally {
                signal.removeEventListener('abort', onAbort);
                w.stageCtl = null;
            }
        }
    }

    // ------------------------------------------------------------ redirects

    private redirectTo(w: Worker, method: MethodId, reason: string, kind: string): void {
        this.ledger({ kind: 'redirect', account: w.alias, from: w.method, to: method, why: kind, reason });
        this.event(w, `redirect to ${method}`, { reason }, true);
        w.redirect = { method, reason };
        if (w.stageCtl) w.stageCtl.abort(new Error(`redirect to ${method}`));
        else this.applyRedirect(w);
    }

    private applyRedirect(w: Worker): void {
        if (!w.redirect) return;
        w.method = w.redirect.method;
        w.redirect = null;
        w.readings = [];
    }

    private foodOut(w: Worker, reason: string): void {
        if (w.redirect || !NEEDS[w.method].sharks) return;
        const m = nextFallback(this.foodFallback, this.plan.foodFallbackMix);
        if (!m) return;
        this.foodFallback.set(m, (this.foodFallback.get(m) ?? 0) + 1);
        this.redirectTo(w, m, reason, 'food');
    }

    // ------------------------------------------------------------ the knights ramp

    private pumpRamp(now: number): void {
        const r = this.ramp;
        if (!r || r.phase === 'done' || r.phase === 'stopped') return;
        const knights = this.workers.filter(w => w.method === 'knights' && !w.done && !w.redirect);
        const admitted = knights.filter(w => w.admittedAt !== null);
        let room = r.admitted() - admitted.length;
        const waiting = knights.filter(w => w.admittedAt === null && w.arrivedAdmission !== null).sort((a, b) => a.arrivedAdmission! - b.arrivedAdmission!);
        for (const w of waiting) {
            if (room-- <= 0) break;
            w.admittedAt = now;
            admitted.push(w);
            this.ledger({ kind: 'admit', account: w.alias, step: r.stepNumber, admitted: admitted.length });
            this.event(w, 'admitted to the knights', { step: r.stepNumber }, true);
        }
        if (r.phase === 'admitting') {
            const working = admitted.filter(w => w.stage === 'method' && w.readings.length > 0).length;
            if (r.update(now, admitted.length >= r.admitted() && working === admitted.length)) {
                this.ledger({ kind: 'ramp-hold', step: r.stepNumber, logins: admitted.length, working, holdMinutes: this.plan.ramp!.holdMinutes });
                this.event(null, 'ramp hold', { step: r.stepNumber, logins: admitted.length, working }, true);
            }
        }
        if (!r.holdDue(now)) return;
        const start = r.holdStart!;
        const measured = admitted.filter(w => w.admittedAt! <= start);
        const rates = measured.flatMap(w => {
            const v = rateBetween(w.readings.find(x => x.at >= start), w.readings.at(-1));
            return v === null ? [] : [v];
        });
        const d = r.evaluate(rates, now);
        this.ledger({ ...d, holdStart: new Date(d.holdStart).toISOString(), holdEnd: new Date(d.holdEnd).toISOString(), perHour: Math.round(d.median * (3_600_000 / this.tickMs)), loginsMeasured: rates.length });
        this.event(null, `ramp step ${d.step}: ${d.action}`, { reason: d.reason, median: d.median, logins: d.logins, measured: rates.length }, true);
        if (d.action !== 'stop') return;
        for (const w of knights.filter(k => k.admittedAt === null)) {
            const m = nextFallback(this.rampFallback, this.plan.ramp!.fallbackMix);
            if (!m) break;
            this.rampFallback.set(m, (this.rampFallback.get(m) ?? 0) + 1);
            this.redirectTo(w, m, d.reason, 'ramp');
        }
    }

    // ------------------------------------------------------------ sales

    private pumpSales(now: number): void {
        const sell = this.plan.sell;
        if (!sell.enabled) return;
        for (const w of this.workers) {
            if (w.stage !== 'method' || w.saleDue || !SALE_ROUTE.includes(w.method) || now - w.lastSaleAt < sell.everyMinutes * 60_000) continue;
            const item = (w.bank ?? []).find(i => sell.floors[i.name] !== undefined && i.count > 0);
            if (!item) continue;
            w.saleDue = { item: { id: item.id, name: item.name }, floor: sell.floors[item.name]! };
            w.stageCtl?.abort(new Error('sale due'));
        }
    }

    private async sale(w: Worker, x: StageCtx): Promise<void> {
        const due = w.saleDue!;
        w.saleDue = null;
        w.lastSaleAt = Date.now();
        w.stage = 'sale';
        const rec = await sellAtExchange(x, { item: due.item, floor: due.floor, cap: this.plan.sell.cap, fillMinutes: this.plan.sell.fillMinutes }, this.book);
        this.ledger({ account: w.alias, ...rec });
    }

    // ------------------------------------------------------------ the ledger

    private observe(w: Worker, s: BotWorldState): void {
        if (!s.inGame || !s.player) return;
        // the bank's first published state can be empty while it loads; only a fresh account's really is
        if (s.bank?.isOpen && (s.bank.items.length > 0 || w.bank === null)) {
            w.bank = stacks(s.bank.items);
            w.bankTick = s.tick;
        }
        const msPerTick = w.msPerTick(s);
        if (w.nextLedgerTick >= 0 && s.tick < w.nextLedgerTick) return;
        w.nextLedgerTick = s.tick + this.plan.ledger.everyTicks;
        const snap: AccountSnapshot = { account: w.alias, method: w.method, stage: w.stage, session: w.sessionNo, tick: s.tick, carried: stacks(s.inventory), bank: w.bank, bankTick: w.bankTick, msPerTick };
        w.latest = snap;
        const line = accountLine(snap, this.valuer, new Date());
        this.ledger(line as unknown as Record<string, unknown>);
        if (w.stage === 'method') {
            const now = Date.now();
            w.readings.push({ at: now, session: w.sessionNo, tick: s.tick, coins: line.coins.total });
            while (w.readings.length && w.readings[0]!.at < now - READINGS_KEEP_MS) w.readings.shift();
        }
    }

    // ------------------------------------------------------------ stopping

    /** Stop every account at its next safe point and log it out. Resolves to the exit code. */
    stop(reason: string): Promise<number> {
        this.stopped ??= (async () => {
            this.stopping = true;
            this.ledger({ kind: 'stop', reason });
            this.event(null, 'stopping', { reason }, true);
            for (const w of this.workers) w.ctl?.abort(new Error(`stopping: ${reason}`));
            const active = this.workers.flatMap(w => (w.active ? [w.active] : []));
            const all = await Promise.race([Promise.allSettled(active).then(() => true), Bun.sleep(STOP_WAIT_MS).then(() => false)]);
            if (this.timer) clearInterval(this.timer);
            this.totals(true);
            const logouts = Object.fromEntries(this.workers.map(w => [w.alias, w.active ? 'still logging in or out at exit' : (w.logout?.outcome ?? (w.sessionNo ? 'session ended' : 'never logged in'))]));
            const clean = all && Object.values(logouts).every(v => v === 'out' || v === 'queued' || v === 'never logged in' || v === 'session ended');
            this.ledger({ kind: 'end', reason, logouts, clean });
            return clean ? 0 : 1;
        })();
        return this.stopped;
    }
}

// ------------------------------------------------------------------ the command

function fail(message: string): never {
    process.stderr.write(`phase2: ${message}\n${USAGE}\n`);
    process.exit(2);
}

async function main(argv: string[]): Promise<number> {
    // writerExclusion exits 2 without the names file, unless --placeholder-data
    const exclusion = writerExclusion(argv);
    const a = parseArgs(argv.filter(x => !BOOLEAN_FLAGS.includes(x)));
    const unknown = Object.keys(a.flags).filter(k => !['out', 'minutes'].includes(k));
    if (unknown.length) fail(`unknown option ${unknown.map(k => `--${k}`).join(' ')}`);
    if (a.positional.length !== 1) fail('one plan file is required');
    let plan: Plan;
    try {
        plan = parsePlan(JSON.parse(readFileSync(a.positional[0]!, 'utf8')));
    } catch (e) {
        fail(e instanceof PlanError ? e.message : `cannot read the plan: ${e instanceof Error ? e.message : e}`);
    }
    const names = plan.accounts.map(p => p.account);
    const unlisted = unlistedAccounts(names, exclusion);
    if (unlisted.length) fail(unlisted.join('\n'));
    const runEnded = argv.includes('--run-ended');
    if (plan.sharks.source === 'buy' && !runEnded) fail("the plan buys sharks, a fleet input (docs/speedrun/SUPPLIES.md): pass --run-ended only once main has announced the scored run's end");
    const envs: BotEnv[] = [];
    const missing: string[] = [];
    plan.accounts.forEach((p, i) => {
        try {
            envs.push(loadBotEnv(p.account));
        } catch {
            missing.push(aliasOf(i));
        }
    });
    if (missing.length) fail(`no bots/<account>/bot.env for ${missing.join(', ')}`);
    const hosts = new Set(envs.map(e => e.SERVER));
    if (hosts.size !== 1 || !envs[0]!.SERVER) fail('every account must have the same SERVER in its bot.env: the plan is for one address on one world');
    const minutes = (() => {
        try {
            return numberFlag(a, 'minutes', 0, { min: 0 });
        } catch (e) {
            fail(e instanceof Error ? e.message : String(e));
        }
    })();
    const out = a.flags.out ?? join(process.env.TMPDIR ?? '/tmp', `phase2-${new Date().toISOString().replace(/[:.]/g, '')}`);
    if (out === 'true') fail('--out needs a directory');

    (await import('../../sdk/pathfinding')).initPathfinding();
    const workers = await Promise.all(plan.accounts.map(async (p, i) => new Worker(i, aliasOf(i), p, envs[i]!, await openRoleState(join(out, 'role-state', `${aliasOf(i)}.json`)))));
    const runner = new Runner(plan, workers, { host: envs[0]!.SERVER!, out, minutes, runEnded, placeholder: exclusion.source === null });
    process.stderr.write(`phase2: ${workers.length} accounts, up to ${plan.maxSessions} sessions; ledger in ${join(out, 'ledger.jsonl')}\n`);

    let signals = 0;
    const onSignal = (name: string) => () => {
        if (++signals > 1) {
            process.stderr.write(`phase2: second ${name}, exiting without waiting for the logouts\n`);
            process.exit(130);
        }
        void runner.stop(name);
    };
    process.on('SIGINT', onSignal('SIGINT'));
    process.on('SIGTERM', onSignal('SIGTERM'));
    runner.start();
    // stop() is the only way out: a signal, --minutes, or an outdated client
    return new Promise<number>(resolve => {
        const wait = setInterval(() => {
            if (!runner.stopping) return;
            clearInterval(wait);
            void runner.stop('stopping').then(resolve);
        }, 250);
    });
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
