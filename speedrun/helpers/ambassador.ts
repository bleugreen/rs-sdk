// Ambassador (role `ambassador`): one account standing at the Grand Exchange in
// Varrock west bank that listens to public chat and private messages and talks with
// the other bots, through a model. Persona, rules, logs and operation:
// docs/speedrun/AMBASSADOR.md.
//
// The safety property is structural. After setup (leave the tutorial, walk to the
// post) the conversation loop holds only an AmbassadorIO (ambassador/io.ts): read chat,
// say one line, PM one line, look around, walk back to its own post. Chat reaches the
// model as quoted data; the model's reply is parsed into a decision whose only effect
// can be one line of chat, and that line must pass the output filter and the limits in
// ambassador/policy.ts. No code path turns chat into a trade, drop, follow, movement,
// file write outside the log directory, or a message to the fleet.
//
// The Bounty Board (ambassador/bounty.ts) adds one read: the bidder's own offers file.
// Bounties come from the operator's config, are live only while that file shows a
// matching open bid, and are paid by the Grand Exchange; every line about them is held
// to the config and the file in code. Chat cannot change the board.
//
// Run standalone (lite client already running for the account):
//   bun speedrun/helpers/ambassador.ts cairn_md
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runStandalone, type Role, type RoleContext } from './role';
import { createIO, type AmbassadorIO, type Post } from './ambassador/io';
import { ChatLog, DEFAULT_LOG_DIR, ROOT, readRecords } from './ambassador/log';
import { BOUNTY_KEY, BountyBoard, boardFromOptions, parseBountyState, type BountyState } from './ambassador/bounty';
import { PlayerMemory, PLAYERS_KEY } from './ambassador/memory';
import {
    materialFrom,
    ModelClient,
    openerPrompt,
    pick,
    parseDecision,
    parseOpener,
    replyPrompt,
    systemPrompt,
    type ChatModel,
    type ContextLine,
    type Decision,
    type ModelOptions,
    type VarietyHints
} from './ambassador/model';
import {
    buildDenyList,
    canon,
    checkOutput,
    injectionHits,
    isOurs,
    Limiter,
    LIMITS,
    parseLimiterState,
    similarity,
    type Channel,
    type ChatLine,
    type DenyList,
    type SendKind
} from './ambassador/policy';
import { GUARD, isQuestion, isSelfId, nearRepeat, overused, sentLines } from './ambassador/variety';

/** The ground tile beside the Grand Exchange table (sdk/ge-actions.ts GE_STAND). */
export const GE_POST: Post = { x: 3181, z: 3443, tolerance: 3 };

/** Names that are never said even if bots/ on this host does not hold them. */
const ALWAYS_DENIED = ['cairn_md', 'cairn_amb', 'cairn_cam', 'cairn_dot_md', 'cairn_mule1', 'cairn_mule2'];

export interface AmbassadorOptions {
    post: Post;
    model: ModelOptions;
    logDir: string;
    /** Start conversations when chat is quiet (default true). */
    initiate: boolean;
    /** More strings the output filter refuses (lab canaries). */
    denyExtra: string[];
    /** Where account directories live; every name there is refused in output. */
    botsDir: string;
}

export function ambassadorOptions(o: Record<string, unknown>): AmbassadorOptions {
    const post = o.post as Partial<Post> | undefined;
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    return {
        post: { x: num(post?.x, GE_POST.x), z: num(post?.z, GE_POST.z), tolerance: num(post?.tolerance, GE_POST.tolerance) },
        model: o.model && typeof o.model === 'object' ? (o.model as ModelOptions) : {},
        logDir: typeof o.logDir === 'string' && o.logDir ? o.logDir : DEFAULT_LOG_DIR,
        initiate: o.initiate !== false,
        denyExtra: Array.isArray(o.denyExtra) ? o.denyExtra.filter((s): s is string => typeof s === 'string') : [],
        botsDir: typeof o.botsDir === 'string' && o.botsDir ? o.botsDir : join(ROOT, 'bots')
    };
}

/** Account directories under bots/ (credentials of our own fleet). */
export function listBotNames(dir: string): string[] {
    try {
        return readdirSync(dir, { withFileTypes: true })
            .filter(e => e.isDirectory() && /^[a-z0-9][a-z0-9_]{0,11}$/.test(e.name))
            .map(e => e.name);
    } catch {
        return [];
    }
}

// ------------------------------------------------------------------ the conversation loop

export const LOOP = {
    pollMs: 1000,
    /** Lines are gathered this long after the first one, then answered with one model call. */
    batchMs: 3000,
    maxBatch: 20,
    contextLines: 30,
    heartbeatMs: 5 * 60_000,
    postCheckMs: 5 * 60_000,
    /** Walk back to the post only when this far from it (and never because of chat). */
    postRadius: 10,
    openerRetryMs: 5 * 60_000,
    /** A sender's line this similar to their previous one (within repeatWindowMs) is not answered. */
    senderRepeatSimilarity: 0.8,
    senderRepeatWindowMs: 10 * 60_000,
    modelTimeoutMs: 30_000,
    /** After this many model failures in a row, wait modelPauseMs before calling again. */
    modelDownAfter: 3,
    modelPauseMs: 2 * 60_000,
    /** Directions from the persona's Material suggested with each prompt. */
    materialPicks: 3,
    /** After this many of our lines without a question, a question is welcome if Pebble is curious. */
    curiousAfter: 4,
    /** Pebble's Collection had this many exhibits before it was counted in the log. */
    exhibitsBefore: 40
} as const;

export interface Clock {
    now(): number;
    sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export const realClock: Clock = {
    now: () => Date.now(),
    sleep: (ms, signal) =>
        new Promise(resolve => {
            if (signal.aborted) return resolve();
            const done = () => (clearTimeout(t), resolve());
            const t = setTimeout(done, ms);
            signal.addEventListener('abort', done, { once: true });
        })
};

export type ConversationLog = Pick<ChatLog, 'write' | 'muted' | 'saveState'>;

export interface ConversationDeps {
    io: AmbassadorIO;
    model: ChatModel;
    log: ConversationLog;
    limiter: Limiter;
    deny: DenyList;
    system: string;
    /** Our display name, so our own echoes are never answered. */
    selfName: string;
    post: Post;
    initiate: boolean;
    clock: Clock;
    /** The fleet's ctx.log: phase lines and heartbeats (the fleet restarts a silent role). */
    report(message: string, data?: Record<string, unknown>): void;
    /** Recent conversation to start from (rebuilt from today's log after a restart). */
    context?: ContextLine[];
    /** Who we have talked to (from the role's state); updated on every send. */
    memory?: PlayerMemory;
    /** Persist the memory after a send (ctx.state). */
    saveMemory?(memory: PlayerMemory): Promise<void> | void;
    /** The persona's Material (materialFrom); a few directions are suggested with each prompt. */
    material?: readonly string[];
    /** For the Material picks (default Math.random). */
    random?: () => number;
    /** The Bounty Board, when one is configured. */
    bounty?: BountyBoard;
    /** Persist the board's pitch limits and posters after a change (ctx.state). */
    saveBounty?(state: BountyState): Promise<void> | void;
}

/** Why a drafted line would sound like one already said; the draft is retried once, then dropped. */
interface Echo {
    reason: 'repeat' | 'opener-reused' | 'near-repeat' | 'too-long' | 'bounty';
    /** For near-repeats: which check ('opener', 'phrase', 'probe', 'questions', 'self-id', 'bounty-poster'); for bounty, the board's refusal. */
    guard?: string;
    detail: string;
}

interface Pending extends ChatLine {
    patterns: string[];
    strong: boolean;
}

export class Conversation {
    readonly counts = { seen: 0, answered: 0, sent: 0, blocked: 0, ratelimited: 0, injections: 0, modelErrors: 0, retries: 0 };
    private pending: Pending[] = [];
    private context: ContextLine[];
    private lastHeardAt: number;
    private lastOpenerTryAt = 0;
    private lastHeartbeatAt: number;
    private lastPostCheckAt: number;
    private failuresInRow = 0;
    private modelPausedUntil = 0;
    private phase = '';
    /** Each sender's previous line, so broadcast loops ("36090 counted ... 36120 counted ...") cost no model calls. */
    private lastLine = new Map<string, { text: string; at: number }>();

    constructor(private readonly d: ConversationDeps) {
        const now = d.clock.now();
        this.context = [...(d.context ?? [])].slice(-LOOP.contextLines);
        this.lastHeardAt = now;
        this.lastHeartbeatAt = now;
        this.lastPostCheckAt = now;
    }

    async run(signal: AbortSignal): Promise<void> {
        this.heartbeat(this.d.clock.now(), true);
        while (!signal.aborted) {
            await this.step();
            await this.d.clock.sleep(LOOP.pollMs, signal);
        }
    }

    /** One pass: read, answer a ripe batch or maybe open, keep the post, report. */
    async step(): Promise<void> {
        const now = this.d.clock.now();
        this.read(now);
        const first = this.pending[0];
        if (first && now - first.at >= LOOP.batchMs) await this.answer(this.pending.splice(0));
        else if (!first) await this.maybeOpen(now);
        await this.keepPost(this.d.clock.now());
        this.heartbeat(this.d.clock.now());
    }

    private remember(line: ContextLine): void {
        this.context.push(line);
        if (this.context.length > LOOP.contextLines) this.context.splice(0, this.context.length - LOOP.contextLines);
    }

    private read(now: number): void {
        const { io, log } = this.d;
        for (const line of io.readNewChat()) {
            const ours = isOurs(line.sender);
            const me = canon(line.sender) === canon(this.d.selfName);
            const hits = injectionHits(line.text);
            this.counts.seen++;
            log.write('seen', {
                tick: line.tick,
                sender: line.sender,
                channel: line.channel,
                type: line.type,
                text: line.text,
                ...(ours ? { ours: true } : {}),
                ...(line.type === 1 || line.type === 7 ? { crowned: true } : {})
            });
            if (me || ours) continue;
            this.d.bounty?.noteHeard(now, line.sender, line.text);
            const who = canon(line.sender);
            const prev = this.lastLine.get(who);
            this.lastLine.set(who, { text: line.text, at: now });
            if (this.lastLine.size > 500) this.lastLine.delete(this.lastLine.keys().next().value!);
            const strong = hits.some(h => h.strong);
            if (hits.length) {
                this.counts.injections++;
                log.write('injection', { source: 'heuristic', sender: line.sender, channel: line.channel, text: line.text, patterns: hits.map(h => h.id), strong });
            }
            this.lastHeardAt = now;
            if (prev && now - prev.at < LOOP.senderRepeatWindowMs && similarity(prev.text, line.text) >= LOOP.senderRepeatSimilarity) continue;
            this.pending.push({ ...line, patterns: hits.map(h => h.id), strong });
            this.remember({ sender: line.sender, channel: line.channel, text: line.text });
        }
        if (this.pending.length > LOOP.maxBatch) {
            const dropped = this.pending.splice(0, this.pending.length - LOOP.maxBatch);
            this.counts.ratelimited += dropped.length;
            log.write('ratelimited', { reason: 'batch-overflow', dropped: dropped.length });
        }
    }

    private modelAvailable(now: number): boolean {
        return now >= this.modelPausedUntil;
    }

    private modelFailed(e: unknown, where: string): void {
        this.counts.modelErrors++;
        this.failuresInRow++;
        this.d.log.write('error', { where, message: e instanceof Error ? e.message : String(e) });
        if (this.failuresInRow >= LOOP.modelDownAfter) this.modelPausedUntil = this.d.clock.now() + LOOP.modelPauseMs;
    }

    /** How we have been sounding, for the prompt: our latest lines, what we overuse, what we remember about `players`. */
    private hints(players: readonly string[] | null): VarietyHints {
        const { limiter, clock, bounty } = this.d;
        const recent = limiter.recentTexts(GUARD.window);
        const now = clock.now();
        const exhibits = limiter.state.sent.filter(s => /\bexhibit\b/i.test(s.text ?? s.norm)).length;
        const single = players && new Set(players.map(canon)).size === 1 ? players[0]! : null;
        return {
            yourLastLines: recent,
            avoid: overused(recent),
            noQuestion: recent.slice(-GUARD.questionWindow).filter(isQuestion).length >= GUARD.questionMax,
            curious: recent.length >= LOOP.curiousAfter && !recent.slice(-LOOP.curiousAfter).some(isQuestion),
            nextExhibit: LOOP.exhibitsBefore + exhibits + 1,
            ...(players && this.d.memory ? { players: this.d.memory.recall(players, now) } : {}),
            ...(bounty ? { bounty: bounty.view(now, single) } : {}),
            ...(this.d.material?.length ? { material: pick(this.d.material, LOOP.materialPicks, this.d.random) } : {})
        };
    }

    private saveBounty(): void {
        const { bounty, log } = this.d;
        if (!bounty || !this.d.saveBounty) return;
        const failed = (e: unknown) => log.write('error', { where: 'bounty-state', message: e instanceof Error ? e.message : String(e) });
        try {
            void Promise.resolve(this.d.saveBounty(bounty.state)).catch(failed);
        } catch (e) {
            failed(e);
        }
    }

    /**
     * Whether a drafted line would sound like one already said: an exact repeat (the
     * limiter's 7-day rule), a near-repeat of our latest lines (variety.ts), or a second
     * "I'm a bot" to a player we have already told.
     */
    private echo(kind: SendKind, to: string | null, text: string, heard: readonly string[] = []): Echo | null {
        const { limiter, memory, clock } = this.d;
        // Over-long is the one output-filter failure worth a second try; checkOutput still decides.
        const length = text.replace(/\s+/g, ' ').trim().length;
        if (length > LIMITS.maxLen) return { reason: 'too-long', detail: `${length} characters; the limit is ${LIMITS.maxLen}` };
        const exact = limiter.repeatOf(clock.now(), kind, text);
        if (exact) return { reason: exact, detail: 'you said nearly this before' };
        const near = nearRepeat(text, limiter.recentTexts(GUARD.window), GUARD, heard);
        if (near) return { reason: 'near-repeat', guard: near.reason, detail: `${near.reason}: ${near.detail}` };
        if (to && memory?.introduced(to) && isSelfId(text)) return { reason: 'near-repeat', guard: 'self-id', detail: 'you already told them you are a bot' };
        const board = this.d.bounty;
        if (board) {
            const refusal = board.checkLine(clock.now(), kind, to, text, heard);
            if (refusal) return { reason: 'bounty', guard: refusal.reason, detail: `${refusal.detail}; say only what bounty_board shows` };
            const poster = board.posterEcho(text);
            if (poster) return { reason: 'near-repeat', guard: 'bounty-poster', detail: poster };
        }
        return null;
    }

    /** One model call for a reply; logs the decision and a model-flagged injection (unless already flagged). */
    private async decide(user: string, open: Pending[], retry: boolean, flagged: boolean): Promise<Decision | null> {
        const { log, clock, model } = this.d;
        const start = clock.now();
        let raw: string;
        try {
            raw = await model.complete(this.d.system, user, { timeoutMs: LOOP.modelTimeoutMs });
        } catch (e) {
            this.modelFailed(e, retry ? 'retry' : 'reply');
            return null;
        }
        this.failuresInRow = 0;
        const ms = clock.now() - start;
        const parsed = parseDecision(raw, open);
        if (!parsed.ok) {
            log.write('decision', { valid: false, error: parsed.error, raw: raw.slice(0, 300), ms, ...(retry ? { retry } : {}) });
            return null;
        }
        const d = parsed.value;
        log.write('decision', {
            valid: true,
            respond: d.respond,
            channel: d.channel,
            to: d.to,
            text: d.text,
            injection: d.injection,
            ...(d.injection ? { injectionFrom: d.injectionFrom, injectionReason: d.injectionReason } : {}),
            topics: d.topics,
            ...(d.intel ? { intel: d.intel } : {}),
            ...(d.surprising ? { surprising: d.surprising } : {}),
            ms,
            ...(retry ? { retry } : {})
        });
        if (d.injection && !flagged) {
            this.counts.injections++;
            const from = d.injectionFrom ?? d.to;
            const line = open.find(l => l.sender === from);
            log.write('injection', { source: 'model', sender: from, channel: line?.channel, reason: d.injectionReason, text: line?.text ?? '' });
        }
        return d;
    }

    private refuse(echo: Echo, kind: SendKind, channel: Channel, to: string | null, text: string): void {
        this.counts.blocked++;
        this.d.log.write('blocked', { reason: echo.reason, ...(echo.guard ? { guard: echo.guard } : {}), purpose: kind, channel, to, text });
    }

    private async answer(batch: Pending[]): Promise<void> {
        const { io, log, limiter, clock } = this.d;
        const now = clock.now();
        const earlier = this.context.slice(0, Math.max(0, this.context.length - batch.length));
        const global = limiter.globalBlocked(now);
        if (global) {
            this.counts.ratelimited += batch.length;
            log.write('ratelimited', { reason: global, lines: batch.length });
            return;
        }
        const open = batch.filter(l => !limiter.playerBlocked(now, l.sender));
        if (!open.length) {
            this.counts.ratelimited += batch.length;
            log.write('ratelimited', { reason: 'players', lines: batch.length });
            return;
        }
        if (!this.modelAvailable(now)) {
            log.write('ratelimited', { reason: 'model-down', lines: batch.length });
            return;
        }
        const nearby = io.nearbyPlayers();
        const hints = this.hints(open.map(l => l.sender));
        const first = await this.decide(replyPrompt(earlier, open, nearby, hints), open, false, false);
        if (!first?.respond || !first.to) return;
        let d: Decision = first;
        const kindOf = (x: Decision) =>
            (x.injection && (x.injectionFrom === null || x.injectionFrom === x.to)) || open.some(l => l.sender === x.to && l.strong) ? 'decline' : 'reply';
        const heard = (x: Decision) => open.filter(l => l.sender === x.to).map(l => l.text);
        const echo = this.echo(kindOf(d), d.to, d.text, heard(d));
        if (echo) {
            // One more try with the refused draft in front of the model, then silence.
            this.counts.retries++;
            log.write('retry', { reason: echo.reason, ...(echo.guard ? { guard: echo.guard } : {}), detail: echo.detail, to: d.to, text: d.text });
            if (!this.modelAvailable(clock.now())) return;
            const again = await this.decide(replyPrompt(earlier, open, nearby, { ...hints, rejected: { text: d.text, why: echo.detail } }), open, true, first.injection);
            if (!again?.respond || !again.to) return;
            // An injection flag on either draft stands.
            d = first.injection && !again.injection ? { ...again, injection: true, injectionFrom: first.injectionFrom } : again;
            const still = this.echo(kindOf(d), d.to, d.text, heard(d));
            if (still) return this.refuse(still, kindOf(d), d.channel, d.to, d.text);
        }
        const to = d.to!;
        const theirs = open.filter(l => l.sender === to);
        const age = clock.now() - Math.min(...theirs.map(l => l.at));
        if (age > LIMITS.staleMs) {
            log.write('stale', { reason: 'slow', ageMs: age, to, text: d.text });
            return;
        }
        // Answering someone who tried an injection is a decline, whatever the text says:
        // one per player per hour, then they are ignored.
        this.counts.answered++;
        await this.send(kindOf(d), d.channel, to, d.text, d.topics, heard(d), d.remember);
    }

    private async opener(user: string, start: number, retry: boolean): Promise<string | null> {
        const { log, clock, model } = this.d;
        let raw: string;
        try {
            raw = await model.complete(this.d.system, user, { timeoutMs: LOOP.modelTimeoutMs });
        } catch (e) {
            this.modelFailed(e, 'opener');
            return null;
        }
        this.failuresInRow = 0;
        const parsed = parseOpener(raw);
        const r = retry ? { retry } : {};
        log.write(
            'decision',
            parsed.ok
                ? { valid: true, opener: true, respond: parsed.value.respond, text: parsed.value.text, ms: clock.now() - start, ...r }
                : { valid: false, opener: true, error: parsed.error, raw: raw.slice(0, 300), ...r }
        );
        return parsed.ok && parsed.value.respond ? parsed.value.text : null;
    }

    private async maybeOpen(now: number): Promise<void> {
        const { io, log, limiter } = this.d;
        if (!this.d.initiate) return;
        if (now - this.lastHeardAt < LIMITS.openerQuietMs) return;
        if (now - this.lastOpenerTryAt < LOOP.openerRetryMs) return;
        if (now - limiter.state.lastOpenerAt < LIMITS.openerEveryMs) return;
        if (limiter.globalBlocked(now) || !this.modelAvailable(now)) return;
        const nearby = io.nearbyPlayers().filter(n => !isOurs(n) && canon(n) !== canon(this.d.selfName));
        if (!nearby.length) return;
        this.lastOpenerTryAt = now;
        const hints = this.hints(null);
        // A cheer for a filled bounty, or (every other opener) a wanted poster; else an ordinary line.
        const plan = this.d.bounty?.planOpener(now) ?? null;
        if (plan) log.write('heartbeat', { opener: plan.kind, item: plan.kind === 'cheer' ? plan.item : plan.bounty.item });
        let text = await this.opener(openerPrompt(this.context, nearby, limiter.state.openers, hints, plan), now, false);
        if (text === null) return;
        const echo = this.echo('opener', null, text);
        if (echo) {
            this.counts.retries++;
            log.write('retry', { reason: echo.reason, ...(echo.guard ? { guard: echo.guard } : {}), detail: echo.detail, purpose: 'opener', text });
            if (!this.modelAvailable(this.d.clock.now())) return;
            text = await this.opener(openerPrompt(this.context, nearby, limiter.state.openers, { ...hints, rejected: { text, why: echo.detail } }, plan), now, true);
            if (text === null) return;
            const still = this.echo('opener', null, text);
            if (still) return this.refuse(still, 'opener', 'public', null, text);
        }
        if (await this.send('opener', 'public', null, text)) {
            this.d.bounty?.openerSent(plan);
            this.saveBounty();
        }
    }

    private async send(kind: SendKind, channel: Channel, to: string | null, text: string, topics: readonly string[] = [], heard: readonly string[] = [], remember = ''): Promise<boolean> {
        const { io, log, limiter, clock } = this.d;
        const check = checkOutput(text, this.d.deny);
        if (!check.ok) {
            this.counts.blocked++;
            log.write('blocked', { reason: check.reason, purpose: kind, channel, to, text });
            return false;
        }
        const now = clock.now();
        // The board has the last word on any line about it, whatever the echo check let through.
        const refusal = this.d.bounty?.checkLine(now, kind, to, check.text, heard);
        if (refusal) {
            this.counts.blocked++;
            log.write('blocked', { reason: refusal.reason, detail: refusal.detail, purpose: kind, channel, to, text: check.text });
            return false;
        }
        const why = limiter.blocked(now, kind, to, check.text);
        if (why) {
            const repeat = why === 'repeat' || why === 'opener-reused';
            if (repeat) this.counts.blocked++;
            else this.counts.ratelimited++;
            log.write(repeat ? 'blocked' : 'ratelimited', { reason: why, purpose: kind, channel, to, text: check.text });
            return false;
        }
        if (log.muted()) {
            log.write('muted', { purpose: kind, channel, to, text: check.text });
            return false;
        }
        const out = channel === 'pm' && to ? await io.pm(to, check.text) : await io.say(check.text);
        log.write('sent', {
            purpose: kind,
            channel,
            to,
            text: check.text,
            finalText: out.finalText,
            ok: out.ok,
            ...(out.filtered ? { filtered: true } : {}),
            ...(out.truncated ? { truncated: true } : {}),
            ...(out.ok ? {} : { message: out.message })
        });
        if (!out.ok) return false;
        limiter.record(now, kind, to, check.text);
        this.counts.sent++;
        try {
            log.saveState(limiter.state);
        } catch (e) {
            log.write('error', { where: 'state', message: e instanceof Error ? e.message : String(e) });
        }
        if (this.d.bounty?.recordSent(now, kind, to, check.text, heard)) this.saveBounty();
        if (to && this.d.memory) {
            this.d.memory.recordSent(now, to, check.text, topics, heard, remember);
            const failed = (e: unknown) => log.write('error', { where: 'memory', message: e instanceof Error ? e.message : String(e) });
            try {
                void Promise.resolve(this.d.saveMemory?.(this.d.memory)).catch(failed);
            } catch (e) {
                failed(e);
            }
        }
        this.remember({ sender: this.d.selfName, channel, text: out.finalText || check.text, self: true });
        return true;
    }

    private async keepPost(now: number): Promise<void> {
        if (now - this.lastPostCheckAt < LOOP.postCheckMs) return;
        this.lastPostCheckAt = now;
        const me = this.d.io.self();
        if (!me) return;
        const away = Math.max(Math.abs(me.x - this.d.post.x), Math.abs(me.z - this.d.post.z));
        if (away <= LOOP.postRadius && me.level === 0) return;
        this.d.report('returning to post', { from: [me.x, me.z, me.level], tiles: away });
        const ok = await this.d.io.returnToPost();
        if (!ok) this.d.report('return to post failed', { from: [me.x, me.z] });
    }

    private currentPhase(now: number): string {
        if (this.d.log.muted()) return 'muted';
        if (!this.modelAvailable(now) || this.failuresInRow >= LOOP.modelDownAfter) return 'model-down';
        return 'listening';
    }

    private heartbeat(now: number, force = false): void {
        const phase = this.currentPhase(now);
        const changed = phase !== this.phase;
        if (!force && !changed && now - this.lastHeartbeatAt < LOOP.heartbeatMs) return;
        this.phase = phase;
        this.lastHeartbeatAt = now;
        this.d.report('phase', { phase, ...this.counts });
        this.d.log.write('heartbeat', { phase, ...this.counts });
    }
}

// ------------------------------------------------------------------ the role

function onTutorialIsland(x: number, z: number): boolean {
    return x >= 3050 && x <= 3156 && z >= 3056 && z <= 3136;
}

async function ensureOutOfTutorial(ctx: RoleContext): Promise<void> {
    const { sdk, bot } = ctx;
    await sdk.waitForReady(30_000).catch(() => {});
    for (let i = 0; i < 30; i++) {
        const p = sdk.getState()?.player;
        if (p && !onTutorialIsland(p.worldX, p.worldZ)) return;
        if (i === 0) ctx.log('skipping tutorial', { x: p?.worldX, z: p?.worldZ });
        await bot.skipTutorial();
        await sdk.waitForTicks(2).catch(() => {});
    }
    throw new Error('Could not leave the tutorial');
}

async function walkToPost(ctx: RoleContext, post: Post): Promise<boolean> {
    const away = () => {
        const p = ctx.sdk.getState()?.player;
        return p ? Math.max(Math.abs(p.worldX - post.x), Math.abs(p.worldZ - post.z)) + (p.level === 0 ? 0 : 1000) : Infinity;
    };
    for (let attempt = 0; attempt < 5 && away() > post.tolerance; attempt++) {
        if (ctx.signal.aborted) return false;
        const p = ctx.sdk.getState()?.player;
        ctx.log('walking to post', { from: p ? [p.worldX, p.worldZ, p.level] : null, to: [post.x, post.z] });
        const r = await ctx.bot.walkTo(post.x, post.z, post.tolerance, { timeout: 240_000 });
        if (!r.success) ctx.log('walk failed', { result: r.message });
    }
    return away() <= post.tolerance;
}

/** The last half hour of conversation from the log, so a restart does not start cold. */
function recentContext(dir: string, now = Date.now()): ContextLine[] {
    const lines: ContextLine[] = [];
    for (const r of readRecords(dir, now - 30 * 60_000, now + 1)) {
        const channel: Channel = r.channel === 'pm' ? 'pm' : 'public';
        if (r.kind === 'seen' && !r.ours && typeof r.text === 'string') lines.push({ sender: String(r.sender), channel, text: r.text });
        if (r.kind === 'sent' && r.ok !== false && typeof r.text === 'string') lines.push({ sender: '(you)', channel, text: String(r.finalText || r.text), self: true });
    }
    return lines.slice(-LOOP.contextLines);
}

export const role: Role = {
    name: 'ambassador',
    produces: [],
    readsChat: true,
    async run(ctx) {
        const o = ambassadorOptions(ctx.options);
        const log = new ChatLog(o.logDir);
        const persona = readFileSync(join(import.meta.dir, 'ambassador', 'persona.md'), 'utf8');
        const deny = buildDenyList(listBotNames(o.botsDir), [...ALWAYS_DENIED, ...o.denyExtra]);
        const limiter = new Limiter(parseLimiterState(log.loadState()));
        const model = new ModelClient(o.model, { onSwitch: (from, to) => log.write('model_switch', { from, to }) });
        log.write('start', { account: ctx.account, model: model.label(), post: o.post, initiate: o.initiate, muted: log.muted(), denyNames: deny.squashed.length });
        ctx.log('phase', { phase: 'setup', model: model.label() });

        await ensureOutOfTutorial(ctx);
        if (!(await walkToPost(ctx, o.post))) ctx.log('not at post yet; listening anyway', {});

        const io = createIO(ctx.sdk, ctx.bot, o.post);
        // Chat from before this start (the SDK history since connect) is context, not something to answer.
        const context = recentContext(o.logDir);
        const backlog = io.readNewChat();
        for (const line of backlog) if (!isOurs(line.sender)) context.push({ sender: line.sender, channel: line.channel, text: line.text });
        if (backlog.length) log.write('heartbeat', { backlogLines: backlog.length });

        // Load the model before the first conversation needs it: a cold load on bbs took minutes.
        const warmStart = Date.now();
        await model
            .complete('Answer with the JSON object {"ok": true}.', 'ping', { timeoutMs: 300_000, maxTokens: 20 })
            .then(() => log.write('heartbeat', { warmupMs: Date.now() - warmStart, model: model.label() }))
            .catch(e => log.write('error', { where: 'warmup', message: e instanceof Error ? e.message : String(e) }));

        // Who we have talked to. The first start after this memory existed rebuilds it
        // from the log, so nobody we already introduced ourselves to hears it again.
        const memory = PlayerMemory.parse(ctx.state.get(PLAYERS_KEY));
        if (memory.size === 0) memory.seed(sentLines(readRecords(o.logDir, Date.now() - LIMITS.repeatWindowMs)));

        // The Bounty Board: operator config only, live only while the bidder's offers file backs it.
        const boardCfg = boardFromOptions(ctx.options);
        if (boardCfg && !boardCfg.ok) {
            log.write('error', { where: 'bounties', message: boardCfg.error });
            ctx.log('bounty board refused; running without one', { error: boardCfg.error });
        }
        const bounty = boardCfg?.ok ? new BountyBoard(boardCfg.value, parseBountyState(ctx.state.get(BOUNTY_KEY)), undefined, Date.now()) : undefined;
        if (bounty) log.write('heartbeat', { bounties: bounty.cfg.bounties.map(b => b.item), live: bounty.live(Date.now()).map(b => b.item), theme: bounty.cfg.theme });

        const conversation = new Conversation({
            io,
            model,
            log,
            limiter,
            deny,
            system: systemPrompt(persona),
            selfName: ctx.sdk.getState()?.player?.name ?? ctx.account,
            post: o.post,
            initiate: o.initiate,
            clock: realClock,
            report: (message, data) => ctx.log(message, data),
            context,
            memory,
            saveMemory: m => ctx.state.set(PLAYERS_KEY, m.toJSON()),
            material: materialFrom(persona),
            ...(bounty ? { bounty, saveBounty: (s: BountyState) => ctx.state.set(BOUNTY_KEY, s) } : {})
        });
        try {
            await conversation.run(ctx.signal);
        } finally {
            log.write('stop', { ...conversation.counts });
        }
    }
};

if (import.meta.main) await runStandalone(role);
