// The cue between the scored account's Runecraft step and its essence givers
// (role altar-giver), all on one machine. The scored side owns cue.json and says
// which giver trades on which tick; each giver owns giver-<account>.json and says
// whether it is loaded and how its last turn went. Contract and rationale:
// docs/speedrun/helpers/altar-giver.md; the cycle it implements:
// docs/speedrun/skills/runecraft.md section 4 ("The tuned cycle").
//
// Files, not sockets: every write replaces the whole file (tmp + rename), readers
// watch the directory and poll, and either side can restart and re-read. The
// directory must not be tracked by git: nothing in it names the receiver (it is
// identified by a hash of its name), but status files describe a live run.
//
// Clock. `state.tick` counts the frames one client received, so the scored
// account's tick T means nothing to a giver directly. Every cue carries beacons:
// recent scored frames with the wall-clock time each was seen. A giver matches
// them against its own frames' arrival times (both clients get each server frame
// within a few ms on one machine) and so learns a constant offset between the
// two numberings. Each side then fires on its own frame arrivals; the cue only has
// to arrive ahead of time, and no relay hop sits on the reaction path.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { BotWorldState } from '../../sdk/types';
import { isTradeRequest, tradeOf } from '../lib/trade';

export const CUE_VERSION = 1;
export const CUE_FILE = 'cue.json';
/** Trade screen buttons (trademain:accept, tradeconfirm:accept). */
export const TRADE_ACCEPT = 3420;
export const TRADE_CONFIRM = 3546;
/** Ticks from the craft to the first tick the scored account is not delayed (runecraft.md section 4). */
export const DEFAULT_OPEN = 5;

export type Schedule = 'tuned' | 'robust';
/**
 * What a single turn asks of its giver: one of the blind schedules, or 'stock', the scored
 * side's last fallback (the reacting cycle): the giver requests as soon as it is armed and
 * then reacts to what it sees (offer everything, accept, confirm) until the judge tick.
 */
export type TurnSchedule = Schedule | 'stock';

/** One frame of a client: its tick count and Date.now() when the frame was seen decoded. */
export interface Beacon {
    tick: number;
    ms: number;
}

export interface Turn {
    /** Giver account (login name). */
    giver: string;
    /** Tick the scored account's craft lands on, in the scored account's numbering. The trade opens on T + open. */
    T: number;
    /** The hand-back (S21's end): trade exactly these items instead of essence, as a reacting stock turn. */
    items?: HandBackItem[];
    /** Overrides the cue's schedule for this turn, e.g. robust for a giver that logged in after the scored account, or a reacting stock turn. */
    schedule?: TurnSchedule;
}

/**
 * The helper families a cue addresses. bone-giver is two: 'bone' in S07's standing mode, 'courier' in
 * S18's on-request mode. 'mule' is the trade giver's packages (mule.ts), asked for by a cue scoped to
 * the hand-off, and its top-up asks. 'fmrow' (S03's log droppers) and 'ring' (S04's ring givers) have
 * no reader in their roles: only the run-machine launcher reads them, for the stop that logs the family
 * out (standalone.ts stopOn). The list is a shared contract (run.ts's cue writes, the cue snapshot):
 * only ever append.
 */
export const CUE_FAMILIES = ['altar', 'bone', 'courier', 'anvil', 'cannon', 'mule', 'fmrow', 'ring'] as const;
export type CueFamily = (typeof CUE_FAMILIES)[number];

/**
 * Whom a cue is for: one run step (run.ts's id: 'S06', 'S07', 'S18', 'S21', ...) and one helper
 * family. A reader acts only on a cue that addresses it (cueAddresses), its `stop` included, so a
 * cue is never a global stop: Runecraft's S06 stop can't stand down S07's bone givers or the S18
 * courier reading the same directory. A cue without a scope addresses nobody.
 */
export interface CueScope {
    step: string;
    family: CueFamily;
}

export function scopeError(scope: unknown): string | null {
    const s = scope as Partial<CueScope> | null | undefined;
    if (!s || typeof s !== 'object') return 'a cue scope { step, family } is required';
    if (typeof s.step !== 'string' || !s.step.trim()) return `a cue scope needs a step (got ${JSON.stringify(s.step)})`;
    if (!CUE_FAMILIES.includes(s.family as CueFamily)) return `a cue scope's family must be one of ${CUE_FAMILIES.join(', ')} (got ${JSON.stringify(s.family)})`;
    return null;
}

/** A reader role's `scope` option, checked against the families the role serves. */
export function scopeOption(raw: unknown, families: readonly CueFamily[], name = 'scope'): CueScope {
    const err = scopeError(raw);
    if (err) throw new Error(`${name}: ${err}`);
    const s = raw as CueScope;
    if (!families.includes(s.family)) throw new Error(`${name}.family must be ${families.join(' or ')} for this role (got ${s.family})`);
    return { step: s.step, family: s.family };
}

/** The cue (or top-up ask) is for the reader of `step` and `family`. */
export function cueAddresses(cue: { scope?: CueScope | null } | null | undefined, step: string, family: CueFamily): boolean {
    return !!cue?.scope && cue.scope.step === step && cue.scope.family === family;
}

export interface Cue {
    v: typeof CUE_VERSION;
    /** Whom the cue is for (CueScope); required, and fixed for a writer's life. */
    scope: CueScope;
    /** Changes on every scored login; a giver's bookkeeping (offset, turns done) is per session. */
    session: string;
    /** Increases on every write. */
    seq: number;
    /** The account the givers trade: sha256 of its canonical name (canonName). Never the name itself. */
    receiver: { sha256: string };
    /** Recent scored frames, oldest first (at least one). */
    beacons: Beacon[];
    schedule: Schedule;
    /** K: the trade request lands on T + K. */
    open: number;
    /** Every turn of this session so far; a giver acts on the newest one naming it. */
    turns: Turn[];
    /**
     * SCORED's stand tile at the step's current site (S07: the burying band's chopping stand). A helper
     * that waits at one of several sites goes to the one whose receiver tile this is (bone-giver.ts
     * namedSite). Absent: no site is named, and such a helper keeps its own rotation.
     */
    site?: { x: number; z: number };
    /** The batch is over: armed givers stand down. */
    stop?: boolean;
    /**
     * Only with `stop`: the scope is done, no further session for it follows. A stop without it ends
     * one session (a program segment, a resumed step's reopen), and the step may open another; the
     * run-machine launcher keeps a stopOn account in the world until this, or the next scope's cue.
     */
    final?: boolean;
    /** Date.now() of the write. */
    ms: number;
}

export type GiverPhase = 'start' | 'restock' | 'travel' | 'ready' | 'armed' | 'fault' | 'off';
/**
 * gave: the essence left. missed: the schedule ran and the essence is still held.
 * late: the turn arrived after its first packet's frame. clock: no tick offset
 * could be resolved. not-ready: named while restocking. no-receiver: nobody in
 * sight matches the receiver hash. cancelled: stop or a new session before the first packet.
 */
export type Outcome = 'gave' | 'missed' | 'late' | 'clock' | 'not-ready' | 'no-receiver' | 'cancelled';

export interface TurnResult {
    session: string;
    T: number;
    outcome: Outcome;
    /** The giver's own tick numbering for T, when known. */
    myT?: number;
    detail?: string;
    ms: number;
}

/**
 * One item of a hand-back: the item's exact name and how many. After a band's last craft a
 * hand-back giver trades SCORED these instead of essence (S21: T21-22's Lumbridge runes, SUPPLIES.md
 * H17e); the scored side's half is runecraft.ts HandBack, whose item type has this shape.
 */
export interface HandBackItem {
    item: string;
    n: number;
}

export interface GiverStatus {
    v: typeof CUE_VERSION;
    account: string;
    phase: GiverPhase;
    /** Date.now() of this client's login, so the scored side can tell whether the giver is handled before it (tuned needs that). */
    loggedInAt: number | null;
    essence: number;
    tile: { x: number; z: number; level: number } | null;
    inRoom: boolean;
    /**
     * Ready since (Date.now()); the scored side can queue givers in this order. Renewed with every
     * turn result short of a trade, so a giver that missed reports ready again (MissBench).
     */
    readyAt: number | null;
    armed?: { session: string; seq: number; T: number; myT: number; schedule: TurnSchedule };
    last?: TurnResult;
    /** Trades given since the role started. */
    gave: number;
    /** A hand-back giver carrying its hand-back, and no essence: what it holds for SCORED. */
    handBack?: HandBackItem[];
    detail?: string;
    /** Heartbeat: rewritten at least every 2 s. */
    ms: number;
}

// ------------------------------------------------------------------ names

/** Login names and display names compare equal in this form (Cairn H05 == cairn_h05). */
export function canonName(name: string): string {
    return name.trim().toLowerCase().replace(/[\s_]+/g, '_');
}

export function nameHash(name: string): string {
    return createHash('sha256').update(canonName(name)).digest('hex');
}

/** The tick of the newest trade request (chat type 4, "wishes to trade with you.") from the receiver, by name hash, after `after`; or null. */
export function newRequestFrom(s: BotWorldState, receiverHash: string, after: number): number | null {
    let tick: number | null = null;
    for (const m of s.gameMessages) {
        if (m.tick > after && isTradeRequest(m) && nameHash(m.sender) === receiverHash) tick = Math.max(tick ?? m.tick, m.tick);
    }
    return tick;
}

// ------------------------------------------------------------------ schedule

export type GiverAction = 'request' | 'offer-accept' | 'confirm';
export type ScoredAction = 'request' | 'accept' | 'confirm' | 'craft';

/** A packet group landing on server tick `land`; it is sent on arrival of the frame for land - 1. */
export interface Step<A> {
    land: number;
    actions: A[];
}

/**
 * The giver's half of one cycle, with the craft landing on T:
 * request on T+K, offer everything and accept on T+K+1, confirm on T+K+2, and
 * on the robust schedule a second confirm on T+K+3 (runecraft-cycle.ts runScheduled).
 */
export function giverSteps(T: number, open: number, schedule: Schedule): Step<GiverAction>[] {
    const o = T + open;
    const steps: Step<GiverAction>[] = [
        { land: o, actions: ['request'] },
        { land: o + 1, actions: ['offer-accept'] },
        { land: o + 2, actions: ['confirm'] }
    ];
    if (schedule === 'robust') steps.push({ land: o + 3, actions: ['confirm'] });
    return steps;
}

/**
 * The scored account's half. Tuned: request T+K, accept T+K+1 (after the
 * giver's offer, which needs the giver handled first in the tick), confirm and
 * craft T+K+2. Robust: request T+K, accept and confirm T+K+2, craft T+K+3.
 */
export function scoredSteps(T: number, open: number, schedule: Schedule): Step<ScoredAction>[] {
    const o = T + open;
    if (schedule === 'tuned') {
        return [
            { land: o, actions: ['request'] },
            { land: o + 1, actions: ['accept'] },
            { land: o + 2, actions: ['confirm', 'craft'] }
        ];
    }
    return [
        { land: o, actions: ['request'] },
        { land: o + 2, actions: ['accept', 'confirm'] },
        { land: o + 3, actions: ['craft'] }
    ];
}

/** Ticks from one craft to the next: 7 tuned, 8 robust at K = 5. */
export function cycleTicks(open: number, schedule: Schedule): number {
    return open + (schedule === 'tuned' ? 2 : 3);
}

/**
 * How long a stock turn reacts after its request tick (T+K). The scored side's stock rung
 * (speedrun/skills/runecraft.ts) writes the turn with T three ticks ahead and gives its
 * reacting receive 30 ticks from its own first click, which is about T-3. At K = 5 the giver
 * gives up on T+27, with it.
 */
export const STOCK_WINDOW = 22;

/** Fewest ticks a reacting trade needs (a plain trade is 9, measured): a stock turn seen later than this is late. */
export const STOCK_MIN_TICKS = 10;

/**
 * The giver's last scheduled landing tick plus one: by this frame a completed trade has left
 * its inventory. A stock turn ends after STOCK_WINDOW ticks of reacting instead.
 */
export function judgeTick(T: number, open: number, schedule: TurnSchedule): number {
    if (schedule === 'stock') return T + open + STOCK_WINDOW;
    return T + open + (schedule === 'tuned' ? 4 : 5);
}

// ------------------------------------------------------------------ clock

export type OffsetResult = { offset: number; errorMs: number } | { error: string };

/**
 * The offset (mine - theirs) between two clients' tick numberings, from their
 * frames' arrival times. For each candidate offset (any own frame within
 * `toleranceMs` of a beacon), the mean |arrival difference| over every beacon whose shifted tick
 * this client has; the best must be within `toleranceMs` and clearly better
 * than the runner-up, so a pair of back-to-back frames (a server catch-up
 * after an overrun) cannot be mismatched silently.
 */
export function resolveOffset(mine: readonly Beacon[], theirs: readonly Beacon[], toleranceMs = 100): OffsetResult {
    if (theirs.length === 0) return { error: 'no beacons' };
    if (mine.length === 0) return { error: 'no frames of our own yet' };
    const byTick = new Map(mine.map(f => [f.tick, f.ms]));
    const candidates = new Set<number>();
    for (const b of theirs) for (const f of mine) if (Math.abs(f.ms - b.ms) <= toleranceMs) candidates.add(f.tick - b.tick);
    const scored: { offset: number; errorMs: number; n: number }[] = [];
    for (const offset of candidates) {
        const errs = theirs.flatMap(b => {
            const ms = byTick.get(b.tick + offset);
            return ms === undefined ? [] : [Math.abs(ms - b.ms)];
        });
        if (errs.length) scored.push({ offset, errorMs: errs.reduce((a, e) => a + e, 0) / errs.length, n: errs.length });
    }
    scored.sort((a, b) => a.errorMs - b.errorMs);
    const [best, second] = scored;
    if (!best || best.errorMs > toleranceMs) return { error: `no frame of ours within ${toleranceMs} ms of the beacons` };
    if (second && second.errorMs - best.errorMs < 50 && second.n >= best.n) {
        return { error: `ambiguous: offsets ${best.offset} and ${second.offset} both fit (${Math.round(best.errorMs)} / ${Math.round(second.errorMs)} ms)` };
    }
    return { offset: best.offset, errorMs: Math.round(best.errorMs) };
}

/** A client's recent frames, for resolveOffset (and for the scored side's beacons). */
export class FrameLog {
    private readonly frames: Beacon[] = [];
    constructor(private readonly keep = 200) {}

    /**
     * Record a publication. The client republishes after every executed action
     * within a tick, so only the first arrival of each tick counts ('new'); a
     * lower tick means the client restarted its count ('reset': a relog).
     */
    add(tick: number, ms = Date.now()): 'new' | 'dup' | 'reset' {
        const last = this.frames[this.frames.length - 1];
        let kind: 'new' | 'reset' = 'new';
        if (last && tick <= last.tick) {
            if (tick === last.tick) return 'dup';
            this.frames.length = 0;
            kind = 'reset';
        }
        this.frames.push({ tick, ms });
        if (this.frames.length > this.keep) this.frames.splice(0, this.frames.length - this.keep);
        return kind;
    }

    recent(n = 8): Beacon[] {
        return this.frames.slice(-n);
    }

    all(): readonly Beacon[] {
        return this.frames;
    }

    clear(): void {
        this.frames.length = 0;
    }
}

// ------------------------------------------------------------------ turns

export type TurnChoice =
    | { kind: 'arm'; turn: Turn; myT: number; schedule: TurnSchedule; key: string }
    | { kind: 'late'; turn: Turn; myT: number; key: string }
    | { kind: 'none' };

export function turnKey(session: string, T: number): string {
    return `${session}:${T}`;
}

/**
 * What a giver should do with the cue now. The newest turn naming it that is
 * not done: armed if its first packet (the request, sent on the frame for
 * T+K-1 in the giver's numbering) is still at least one frame ahead, late if
 * that frame has already arrived (a late turn is reported, never half-fired),
 * and ignored once it is long past. A stock turn reacts rather than fires blind,
 * so it is still armed after its request frame while STOCK_MIN_TICKS remain.
 */
export function chooseTurn(cue: Cue, account: string, offset: number, myNow: number, done: ReadonlySet<string>): TurnChoice {
    if (cue.stop) return { kind: 'none' };
    const me = canonName(account);
    for (let i = cue.turns.length - 1; i >= 0; i--) {
        const turn = cue.turns[i]!;
        if (canonName(turn.giver) !== me) continue;
        const key = turnKey(cue.session, turn.T);
        if (done.has(key)) return { kind: 'none' };
        const myT = turn.T + offset;
        const schedule = turn.schedule ?? cue.schedule;
        const firstSend = myT + cue.open - 1;
        if (myNow < firstSend) return { kind: 'arm', turn, myT, schedule, key };
        const judge = judgeTick(myT, cue.open, schedule);
        if (schedule === 'stock' && myNow + STOCK_MIN_TICKS <= judge) return { kind: 'arm', turn, myT, schedule, key };
        if (myNow < judge) return { kind: 'late', turn, myT, key };
        return { kind: 'none' };
    }
    return { kind: 'none' };
}

// ------------------------------------------------------------------ the skip rule after a failed turn

/**
 * The scored side's rule for a giver whose turn did not give: skip it until it reports ready
 * after that turn was named, i.e. until its status's `readyAt` is later than the first cue write
 * that carried the turn. A live giver reports a fresh `readyAt` with every turn result it gives
 * short of a trade (altar-giver.ts `result`), so it is back within one status write. A giver whose
 * client died can't report anything, whatever its heartbeat says meanwhile (on the relay path the
 * role outlives its client until the relogin), and a relaunched one reports ready from its new
 * process. So a relaunch costs the one turn the giver was named for when it died. A turn no cue
 * write carried benches nobody: the giver never saw it, so it would never report on it.
 * Both clocks are Date.now() on one machine (the givers run beside the scored client).
 */
export class MissBench {
    private readonly since = new Map<string, number>();

    /** A turn naming `giver` failed; `namedAt` is Date.now() of the first cue write carrying it (undefined: none did). */
    miss(giver: string, namedAt: number | undefined): void {
        if (namedAt === undefined) return;
        const k = canonName(giver);
        this.since.set(k, Math.max(this.since.get(k) ?? 0, namedAt));
    }

    /** True while the giver has not reported ready since its failed turn was named; a report lifts the bench. */
    skips(s: Pick<GiverStatus, 'account' | 'readyAt'>): boolean {
        const k = canonName(s.account);
        const since = this.since.get(k);
        if (since === undefined) return false;
        if (s.readyAt !== null && s.readyAt > since) {
            this.since.delete(k);
            return false;
        }
        return true;
    }

    /** The benched givers, by canonical name. */
    get benched(): string[] {
        return [...this.since.keys()];
    }
}

// ------------------------------------------------------------------ turn order (both giver families)

/** A helper's status is current while its heartbeat is this recent (every status writer rewrites at least every 2 s). */
export const STATUS_FRESH_MS = 5_000;

/** What the turn order reads from a helper's status file. */
export interface TurnCandidate {
    account: string;
    /** Ready (loaded and in place) since, Date.now(); null when not ready. */
    readyAt: number | null;
    /** The status's heartbeat. */
    ms: number;
}

/**
 * The giver families' one turn-taking rule. Of the candidates whose status is current, that
 * qualify (`eligible`) and are not benched after a failed turn (MissBench): those already holding
 * the turn (`holding`: a bone giver's request standing or its trade open) first, then oldest ready
 * first, ties by name. The altar side's batch picks from it (altar-receiver.ts chooseBatch), and the
 * bone givers take turns by its first entry (bone-giver.ts boneServer).
 */
export function turnOrder<T extends TurnCandidate>(
    candidates: readonly T[],
    now: number,
    o: { eligible: (c: T) => boolean; holding?: (c: T) => boolean; bench?: Pick<MissBench, 'skips'> }
): T[] {
    const rank = (c: T) => (o.holding?.(c) ? 0 : 1);
    return candidates
        .filter(c => now - c.ms <= STATUS_FRESH_MS && o.eligible(c) && !o.bench?.skips(c))
        .sort((a, b) => rank(a) - rank(b) || (a.readyAt ?? Infinity) - (b.readyAt ?? Infinity) || canonName(a.account).localeCompare(canonName(b.account)));
}

// ------------------------------------------------------------------ the top-up ask (S18)

/**
 * S18's top-up courier (bone-giver.ts, mode on-request) can't see the scored account's
 * inventory, and the trade screen doesn't show its free slots, so the scored side sizes each
 * load (SUPPLIES.md H14.x) and writes it here. It writes on the frame that shows the trade
 * open: from then until the trade ends it sends nothing else, so its free slots can't change
 * under the ask. The courier offers what the ask names, each item with one press, and takes
 * only an ask written after it saw the trade open (less `ASK_SLACK_MS` for the two clients'
 * frame arrivals) and newer than the last one it served, so an ask left over from an earlier
 * trade is never sized onto this one.
 *
 * The trade giver's top-up packages (mule.ts, H12's `shark to 15`) read the same ask, written the
 * same way, with a `scope` naming the package's step and family 'mule'. An ask's scope addresses
 * it as a cue's does (usableAsk): the S18 courier's asks carry none, so neither reader can take
 * the other's.
 */
export const ASK_FILE = 'topup-ask.json';

/** The two clients see a frame within a few ms of each other on one machine; this covers a slow one. */
export const ASK_SLACK_MS = 300;

/** One item the scored side wants: a case-insensitive name pattern, and a count or every one the courier holds. */
export interface AskItem {
    item: string;
    count: number | 'all';
}

export interface TopUpAsk {
    v: 2;
    items: AskItem[];
    /** Date.now() at the write. */
    ms: number;
    /** Whom the ask is for; absent on the S18 courier's asks (thieving.ts). */
    scope?: CueScope;
}

function askError(items: unknown): string | null {
    if (!Array.isArray(items) || items.length === 0) return 'an ask needs at least one item';
    for (const a of items as AskItem[]) {
        if (typeof a?.item !== 'string' || !a.item) return 'an ask item needs a name pattern';
        try {
            new RegExp(a.item, 'i');
        } catch {
            return `an ask item's pattern does not compile: ${a.item}`;
        }
        if (a.count !== 'all' && !(Number.isInteger(a.count) && a.count >= 1)) return `an ask item's count must be a whole number of at least 1 or 'all' (got ${JSON.stringify(a.count)})`;
    }
    return null;
}

export function writeTopUpAsk(dir: string, items: AskItem[], ms = Date.now(), scope?: CueScope): TopUpAsk {
    const err = askError(items) ?? (scope ? scopeError(scope) : null);
    if (err) throw new Error(err);
    const ask: TopUpAsk = { v: 2, items: items.map(a => ({ item: a.item, count: a.count })), ms, ...(scope ? { scope: { step: scope.step, family: scope.family } } : {}) };
    writeJsonAtomicSync(join(dir, ASK_FILE), ask);
    return ask;
}

export function readTopUpAsk(dir: string): TopUpAsk | null {
    const a = readJson<TopUpAsk>(join(dir, ASK_FILE));
    return a && a.v === 2 && Number.isFinite(a.ms) && askError(a.items) === null && (a.scope === undefined || scopeError(a.scope) === null) ? a : null;
}

/**
 * The ask for the trade the reader saw open at `openMs`: written since then (less the slack), after
 * the last one served, and addressed to the reader. A reader with a `scope` takes only an ask carrying
 * that scope; a reader without one (the S18 courier) only an ask carrying none.
 */
export function usableAsk(ask: TopUpAsk | null, openMs: number, lastServedMs: number, scope?: CueScope): TopUpAsk | null {
    if (!ask || ask.ms < openMs - ASK_SLACK_MS || ask.ms <= lastServedMs) return null;
    const addressed = scope ? cueAddresses(ask, scope.step, scope.family) : ask.scope === undefined;
    return addressed ? ask : null;
}

export interface AwaitAskOptions {
    /** The cue directory holding ASK_FILE. */
    dir: string;
    /** Date.now() at the first frame that showed the trade open. */
    openMs: number;
    /** Date.now() of the ask last served (0: none yet). */
    lastServedMs: number;
    /** Observed ticks to wait for the ask after the call. */
    maxTicks: number;
    /** The reader's scope (usableAsk). */
    scope?: CueScope;
    signal?: AbortSignal;
}

/**
 * The ask for the trade open now (usableAsk), polled every 15 ms for up to `maxTicks` observed ticks;
 * null when none came, the trade closed, or `signal` aborted. Every ask reader waits through this.
 */
export async function awaitAsk(sdk: { getState(): BotWorldState | null }, o: AwaitAskOptions): Promise<TopUpAsk | null> {
    const t0 = sdk.getState()?.tick ?? 0;
    for (;;) {
        const ask = usableAsk(readTopUpAsk(o.dir), o.openMs, o.lastServedMs, o.scope);
        if (ask) return ask;
        const s = sdk.getState();
        if (!s || !tradeOf(s).isOpen || s.tick - t0 > o.maxTicks || o.signal?.aborted) return null;
        await Bun.sleep(15);
    }
}

// ------------------------------------------------------------------ files

export function writeJsonAtomicSync(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(value) + '\n', { mode: 0o600 });
    renameSync(tmp, path);
}

export function readJson<T>(path: string): T | null {
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as T;
    } catch {
        return null;
    }
}

const ROOT = resolve(import.meta.dir, '..', '..');

/** Default home of the run machine's runtime files (gitignored). */
export const RUN_DIR = join(ROOT, 'run-machine');

export function cueDir(env: Record<string, string | undefined> = process.env): string {
    return resolve(env.RC_CUE_DIR || join(RUN_DIR, 'rc-cue'));
}

/**
 * Throw if `dir` would be tracked by git: inside a work tree and not ignored.
 * The cue and status files describe a live run and must never be committed.
 */
export function assertUntracked(dir: string): void {
    let probe = resolve(dir);
    while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
    const top = spawnSync('git', ['-C', probe, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    if (top.status !== 0) return; // not in a work tree
    const root = top.stdout.trim();
    const rel = relative(root, resolve(dir)) || '.';
    const ignored = spawnSync('git', ['-C', root, 'check-ignore', '-q', '--no-index', `${rel}/`], { encoding: 'utf8' });
    if (ignored.status !== 0) {
        throw new Error(`${dir} is inside the git work tree ${root} and not ignored; the run machine's runtime files must not be committable (use run-machine/ or set RC_CUE_DIR outside the checkout)`);
    }
}

export function statusPath(dir: string, account: string): string {
    return join(dir, `giver-${canonName(account)}.json`);
}

export function readCue(dir: string): Cue | null {
    const cue = readJson<Cue>(join(dir, CUE_FILE));
    return cue && cue.v === CUE_VERSION && Array.isArray(cue.turns) && Array.isArray(cue.beacons) ? cue : null;
}

export function writeStatus(dir: string, status: GiverStatus): void {
    writeJsonAtomicSync(statusPath(dir, status.account), status);
}

export function readStatuses(dir: string): GiverStatus[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter(f => /^giver-.+\.json$/.test(f))
        .map(f => readJson<GiverStatus>(join(dir, f)))
        .filter((s): s is GiverStatus => !!s && s.v === CUE_VERSION);
}

/** Validate persisted data before it becomes authority for a resumed writer. */
function resumableCue(value: unknown): value is Cue {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const c = value as Cue;
    const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);
    const schedule = (s: unknown) => s === 'tuned' || s === 'robust';
    return c.v === CUE_VERSION && scopeError(c.scope) === null
        && typeof c.session === 'string' && c.session.length > 0
        && integer(c.seq) && c.seq >= 1
        && typeof c.receiver?.sha256 === 'string' && /^[a-f0-9]{64}$/.test(c.receiver.sha256)
        && integer(c.ms) && c.ms >= 0 && integer(c.open) && schedule(c.schedule)
        && (c.stop === undefined || typeof c.stop === 'boolean')
        && (c.final === undefined || typeof c.final === 'boolean') && (!c.final || c.stop === true)
        && (c.site === undefined || (!!c.site && integer(c.site.x) && integer(c.site.z)))
        && Array.isArray(c.beacons) && c.beacons.length > 0
        && c.beacons.every(b => b && integer(b.tick) && integer(b.ms) && b.ms >= 0)
        && Array.isArray(c.turns) && c.turns.every(t => t && typeof t.giver === 'string' && t.giver.length > 0
            && integer(t.T) && (t.schedule === undefined || schedule(t.schedule) || t.schedule === 'stock')
            && (t.items === undefined || (Array.isArray(t.items) && t.items.every(i =>
                i && typeof i.item === 'string' && i.item.length > 0 && integer(i.n) && i.n > 0))));
}

/**
 * One active writer per session/scope. Passing an explicit `session` that matches cue.json adopts its
 * seq and turns (a resumed step reopening its own session); that adoption is not a lock against a
 * second, concurrent writer.
 */
export class CueWriter {
    readonly session: string;
    readonly scope: CueScope;
    private seq = 0;
    private cue: Cue | null = null;

    constructor(
        readonly dir: string,
        private readonly receiverName: string,
        scope: CueScope,
        session?: string
    ) {
        const err = scopeError(scope);
        if (err) throw new Error(`CueWriter: ${err}`);
        assertUntracked(dir);
        this.scope = { step: scope.step, family: scope.family };
        this.session = session ?? `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
        if (!this.session.trim()) throw new Error('CueWriter: session must be nonempty');
        // Only an explicitly supplied identity may adopt persisted sequence/turns.
        if (session !== undefined && existsSync(join(dir, CUE_FILE))) {
            const previous = readJson<unknown>(join(dir, CUE_FILE));
            if (!previous || typeof previous !== 'object' || Array.isArray(previous))
                throw new Error('CueWriter: malformed persisted cue');
            if ((previous as { session?: unknown }).session === session) {
                if (!resumableCue(previous)) throw new Error('CueWriter: invalid persisted session');
                if (!cueAddresses(previous, scope.step, scope.family) || previous.receiver.sha256 !== nameHash(receiverName))
                    throw new Error('CueWriter: persisted session identity mismatch');
                if (previous.final) throw new Error('CueWriter: final session cannot reopen');
                this.seq = previous.seq;
                this.cue = previous;
            }
        }
    }

    /** Write the cue with `turns` replaced (pass the full list) and fresh beacons. A write without `site` keeps the session's last one. */
    write(fields: { beacons: Beacon[]; turns: Turn[]; schedule?: Schedule; open?: number; stop?: boolean; final?: boolean; site?: { x: number; z: number } }): Cue {
        if (fields.beacons.length === 0) throw new Error('a cue needs at least one beacon');
        if (fields.site && !(Number.isSafeInteger(fields.site.x) && Number.isSafeInteger(fields.site.z))) throw new Error('a cue site needs integer x and z');
        if (fields.final && !fields.stop) throw new Error('a final cue is a stop: final needs stop');
        if (this.cue?.final && (!fields.stop || fields.final === false)) throw new Error('CueWriter: final session cannot reopen');
        if (!Number.isSafeInteger(this.seq + 1)) throw new Error('CueWriter: sequence exhausted');
        const final = fields.final || this.cue?.final;
        const site = fields.site ?? this.cue?.site;
        this.cue = {
            v: CUE_VERSION,
            scope: this.scope,
            session: this.session,
            seq: ++this.seq,
            receiver: { sha256: nameHash(this.receiverName) },
            beacons: fields.beacons,
            schedule: fields.schedule ?? this.cue?.schedule ?? 'tuned',
            open: fields.open ?? this.cue?.open ?? DEFAULT_OPEN,
            turns: fields.turns,
            ...(site ? { site: { x: site.x, z: site.z } } : {}),
            ...(fields.stop ? { stop: true } : {}),
            ...(final ? { final: true } : {}),
            ms: Date.now()
        };
        writeJsonAtomicSync(join(this.dir, CUE_FILE), this.cue);
        return this.cue;
    }

    /** Append one turn to the session's list. */
    addTurn(turn: Turn, beacons: Beacon[]): Cue {
        return this.write({ beacons, turns: [...(this.cue?.turns ?? []), turn] });
    }

    /** End the session; `final`: the scope's last session (Cue.final). */
    stop(beacons: Beacon[], o: { final?: boolean } = {}): Cue {
        return this.write({ beacons, turns: this.cue?.turns ?? [], stop: true, ...(o.final ? { final: true } : {}) });
    }

    get current(): Cue | null {
        return this.cue;
    }
}

export interface CueWatcherOptions {
    /** Poll interval beside fs.watch (default 20 ms). */
    pollMs?: number;
    /** Where the once-per-scope notes on ignored cues go (a role's ctx.log); default stderr. */
    log?: (message: string, data?: Record<string, unknown>) => void;
    /** Every new cue addressed to another scope (new session or higher seq), for a reader that needs to see the next scope open. */
    onOther?: (cue: Cue) => void;
}

/**
 * Calls `onCue` with every new cue addressed to `scope` (new session or higher seq). A cue
 * for another step or family, or one without a scope, never reaches `onCue`, its stop included;
 * each such scope is logged once, and a scoped one goes to `onOther`. Watches the directory and polls as well: fs.watch can coalesce
 * or miss renames on some platforms, and a poll every `pollMs` bounds the delay either way.
 */
export class CueWatcher {
    private last: { session: string; seq: number } | null = null;
    private lastOther: { session: string; seq: number } | null = null;
    private readonly onOther: CueWatcherOptions['onOther'];
    private timer: ReturnType<typeof setInterval> | null = null;
    private watcher: FSWatcher | null = null;
    private readonly ignored = new Set<string>();
    private readonly scope: CueScope;
    private readonly log: NonNullable<CueWatcherOptions['log']>;

    constructor(
        private readonly dir: string,
        scope: CueScope,
        private readonly onCue: (cue: Cue) => void,
        opts: CueWatcherOptions = {}
    ) {
        const err = scopeError(scope);
        if (err) throw new Error(`CueWatcher: ${err}`);
        this.scope = { step: scope.step, family: scope.family };
        this.log = opts.log ?? ((message, data) => console.error(`[cue] ${message}`, JSON.stringify(data ?? {})));
        this.onOther = opts.onOther;
        const pollMs = opts.pollMs ?? 20;
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        try {
            this.watcher = watch(dir, () => this.check());
        } catch {
            this.watcher = null;
        }
        this.timer = setInterval(() => this.check(), pollMs);
        this.check();
    }

    check(): void {
        const cue = readCue(this.dir);
        if (!cue) return;
        if (!cueAddresses(cue, this.scope.step, this.scope.family)) {
            const theirs = scopeError(cue.scope) === null ? `${cue.scope.step}/${cue.scope.family}` : null;
            const key = theirs ?? '(none)';
            if (!this.ignored.has(key)) {
                this.ignored.add(key);
                if (theirs) this.log('cue ignored: addressed to another step or family', { cue: cue.scope, ours: this.scope });
                else this.log('cue refused: cue.json has no scope { step, family }', { ours: this.scope });
            }
            if (theirs && this.onOther && !(this.lastOther && this.lastOther.session === cue.session && this.lastOther.seq >= cue.seq)) {
                this.lastOther = { session: cue.session, seq: cue.seq };
                this.onOther(cue);
            }
            return;
        }
        if (this.last && this.last.session === cue.session && this.last.seq >= cue.seq) return;
        this.last = { session: cue.session, seq: cue.seq };
        this.onCue(cue);
    }

    close(): void {
        if (this.timer) clearInterval(this.timer);
        this.watcher?.close();
        this.timer = null;
        this.watcher = null;
    }
}
