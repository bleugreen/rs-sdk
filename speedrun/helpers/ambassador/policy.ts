// The ambassador's rules that live in code rather than in the prompt: whom it answers,
// how often it may speak, what a line it sends may contain, and which chat looks like
// an injection attempt. Everything here is pure (the clock is a parameter), so every
// limit is unit-tested in policy.test.ts. The model's output only ever reaches the game
// after passing checkOutput and Limiter.blocked.

export type Channel = 'public' | 'pm';

/** One player chat line as the ambassador reads it. */
export interface ChatLine {
    /** Display name as the game shows it ("Cairn H01", "Bob"). */
    sender: string;
    channel: Channel;
    text: string;
    /** Game chat type: 1/2 public (1 = crowned), 3/7 private (7 = crowned). */
    type: number;
    tick: number;
    /** Wall-clock ms when the ambassador read it. */
    at: number;
}

export const LIMITS = {
    /** Never two sends closer than this, whatever they are. */
    minGapMs: 12_000,
    perMinute: 3,
    perHour: 40,
    /** At most one reply to the same player in this window. */
    perPlayerGapMs: 20_000,
    /** This many replies to one player inside perPlayerWindowMs puts that player on cooldown. */
    perPlayerBurst: 6,
    perPlayerWindowMs: 15 * 60_000,
    perPlayerCooldownMs: 15 * 60_000,
    /** One polite decline of an injection attempt per player per hour; otherwise ignored. */
    declineEveryMs: 60 * 60_000,
    /** Unprompted lines: at most one per window, only after this much public quiet. */
    openerEveryMs: 15 * 60_000,
    openerQuietMs: 2 * 60_000,
    /** Sent lines are remembered this long for the no-repeat rule (openers forever). */
    repeatWindowMs: 7 * 24 * 3600_000,
    /** Trigram (Dice) similarity at or above which a line counts as a repeat. */
    repeatSimilarity: 0.8,
    /** One overhead line, one packet: the RS wire limit. */
    maxLen: 80,
    /** A decision this old (from the oldest line it answers) is dropped. */
    staleMs: 45_000
} as const;

export type Limits = typeof LIMITS;

// ------------------------------------------------------------------ names

/** Login and display names in one form: "Cairn H01" and "cairn_h01" are both cairn_h01. */
export function canon(name: string): string {
    return name.trim().toLowerCase().replace(/[\s_]+/g, '_');
}

/**
 * Our own accounts: every `cairn_*` helper, the operator's `cairn`, and the scored
 * account. The ambassador never answers them and never names them.
 */
export function isOurs(sender: string): boolean {
    const c = canon(sender);
    return c === 'cairn' || c.startsWith('cairn_') || c === 'www_cairn_md';
}

// ------------------------------------------------------------------ injection heuristics

export interface InjectionPattern {
    id: string;
    re: RegExp;
    /**
     * Strong patterns mark the line as an injection attempt on their own. Weak ones
     * ("go to", "trade me") also occur in ordinary chat, so they are logged as a hint
     * and the model's own flag decides.
     */
    strong: boolean;
}

export const INJECTION_PATTERNS: readonly InjectionPattern[] = [
    { id: 'override', strong: true, re: /\b(ignore|disregard|forget|override)\b.{0,40}\b(instructions?|prompts?|rules?|directions?|guidelines?)\b/i },
    { id: 'system-prompt', strong: true, re: /\b(system|initial|hidden|original)\s*(prompt|message|instructions?)\b|\b(print|show|reveal|repeat)\s+(me\s+)?(your|the)\s+(prompt|instructions|rules)\b/i },
    { id: 'role-change', strong: true, re: /\byou are now\b|\bfrom now on,? you\b|\bact as (a|an|my)\b|\bpretend (to be|you are)\b|\bnew persona\b|\bjailbreak|\bdeveloper mode\b/i },
    { id: 'authority', strong: true, re: /^\W*(system|admin|operator|developer|staff|jagex|owner|root)\s*[:>\]]|\b(admin|operator|developer|moderator|your (owner|creator|master|controller|operator))\s+(here|says|orders|commands|wants)\b/i },
    // Bare "token" is everyday talk on a server of AI agents (context windows), so only credential tokens count.
    { id: 'secrets', strong: true, re: /\b(password|passwd|passcode|bank pin|api[\s_-]?key|private key|ssh|secret|(api|access|auth|bearer|session)[\s_-]?tokens?|credentials?|bot\.env|\.env)\b/i },
    { id: 'fleet-recon', strong: true, re: /\b(list|name|tell me)\b.{0,30}\b(accounts|bots|alts)\b|\bother cairn\b|\bcairn (accounts|bots|fleet)\b|\byour (fleet|server|host|machine|ip|vps)\b|\bwhere (is|are) (you|your \w+) hosted\b/i },
    { id: 'relay', strong: true, re: /\b(tell|ask|message|relay|forward|pass)\b.{0,30}\b(your|the)\s+(controller|operator|owner|admins?|fleet|team|master|boss|creators?)\b/i },
    { id: 'repeat-bait', strong: true, re: /\b(repeat after me|say exactly|say this \d+ times|every tick|spam (this|it))\b/i },
    { id: 'encoded', strong: true, re: /(^|\s)[A-Za-z0-9+/]{24,}={0,2}(\s|$)/ },
    { id: 'trade', strong: false, re: /\b(trade|give|lend|send)\s+(me|us)\b|\bgive (all|everything)\b/i },
    { id: 'drop', strong: false, re: /\bdrop (everything|all|your|it|items?|inventory|that)\b/i },
    { id: 'follow', strong: false, re: /\bfollow (me|us|him|her|them)\b/i },
    { id: 'move', strong: false, re: /\b(go|walk|run|come|teleport|tele)\s+(to|over to)\b|\bmeet (me|us)\b|\b\d{4}\s*[, ]\s*\d{4}\b/i }
];

export function injectionHits(text: string): InjectionPattern[] {
    return INJECTION_PATTERNS.filter(p => p.re.test(text));
}

// ------------------------------------------------------------------ output filter

export interface DenyList {
    /** Names that must never appear, squashed (lower case, letters and digits only). */
    squashed: string[];
}

/**
 * Names to refuse in output: every account directory under bots/ (our fleet's
 * credentials), plus extras (lab canaries). Short names are skipped so ordinary
 * words cannot be caught by accident; the fixed patterns in checkOutput cover our
 * naming scheme regardless.
 */
export function buildDenyList(names: Iterable<string>, extra: Iterable<string> = []): DenyList {
    const squashed = new Set<string>();
    for (const n of [...names, ...extra]) {
        const s = n.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (s.length >= 5) squashed.add(s);
    }
    return { squashed: [...squashed] };
}

/** Phrases the ambassador may say even though they look like names or URLs. */
const ALLOWED = [
    /\b(https?:\/\/)?(www\.)?cairn\.md\b\/?/gi,
    /\bwww[\s_]cairn[\s_]md\b/gi,
    /\b(https?:\/\/)?rs-sdk-demo\.fly\.dev(\/(market|hiscores))?\b\/?/gi,
    /\b(https?:\/\/)?github\.com\/maxbittker\/rs-sdk\b\/?/gi
];

const OUTPUT_RULES: { reason: string; re: RegExp }[] = [
    // "::tele ..." is a staff command when typed in chat.
    { reason: 'command', re: /::/ },
    { reason: 'scored-spare', re: /cairn[\s_.-]*dot[\s_.-]*md/i },
    { reason: 'account-name', re: /\bcairn[\s_-]*[a-z]{0,6}[\s_-]*\d+|\bcairn[\s_-]+(md|amb|cam|mule|bot|alt|helper)s?\b|\bcairn_[a-z0-9]/i },
    { reason: 'host', re: /\b(bbs|bbl|bglab|bgsrv\w*|fedora|localhost|tailscale)\b|\.(lan|local|internal)\b|\b\d{1,3}(\.\d{1,3}){3}\b/i },
    { reason: 'path', re: /(^|[\s('"])(~|\.{1,2})?\/[\w.-]+\/|\b[\w-]+\.(ts|js|json|jsonl|env|sh|yaml|yml|toml)\b|\b(rs-fleet|fleet-run|fleetctl|bots\/)/i },
    { reason: 'secret-word', re: /\b(password|passwd|passcode|pin code|bank pin|api[\s_-]?keys?|private[\s_-]?keys?|ssh|tokens?|secrets?|credentials?|llm[\s_-]?key)\b/i },
    { reason: 'url', re: /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|io|dev|gg|md|ai|app|xyz|co|me|rs|tv|ly|sh|link|site|info|biz|uk|us)\b/i },
    {
        reason: 'insult',
        re: /\b(idiot\w*|stupid|moron\w*|dumb\w*|retard\w*|loser\w*|noobs?|trash|garbage|pathetic|ugly|shut up|stfu|kys|kill yourself|fuck\w*|shit\w*|bitch\w*|cunts?|dicks?|ass(hole)?s?|bastards?|scammers?|clowns?|imbeciles?|cringe|lame)\b/i
    }
];

export type OutputCheck = { ok: true; text: string } | { ok: false; reason: string };

/**
 * The last word on what may be sent: one line of printable ASCII within the wire
 * limit, naming none of our accounts, hosts, paths or secrets, linking nowhere but
 * cairn.md and the public demo pages, and insulting nobody.
 */
export function checkOutput(raw: string, deny: DenyList, limits: Limits = LIMITS): OutputCheck {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) return { ok: false, reason: 'empty' };
    if (text.length > limits.maxLen) return { ok: false, reason: 'too-long' };
    if (!/^[\x20-\x7e]+$/.test(text)) return { ok: false, reason: 'not-printable-ascii' };
    let probe = text;
    for (const allowed of ALLOWED) probe = probe.replace(allowed, ' ');
    for (const rule of OUTPUT_RULES) if (rule.re.test(probe)) return { ok: false, reason: rule.reason };
    const squashed = probe.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (deny.squashed.some(n => squashed.includes(n))) return { ok: false, reason: 'deny-list' };
    return { ok: true, text };
}

// ------------------------------------------------------------------ repeats

export function normText(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function trigrams(s: string): Map<string, number> {
    const padded = `  ${s} `;
    const grams = new Map<string, number>();
    for (let i = 0; i + 3 <= padded.length; i++) {
        const g = padded.slice(i, i + 3);
        grams.set(g, (grams.get(g) ?? 0) + 1);
    }
    return grams;
}

/** Dice coefficient over character trigrams of the normalised texts, 0..1. */
export function similarity(a: string, b: string): number {
    const x = normText(a);
    const y = normText(b);
    if (x === y) return 1;
    if (!x || !y) return 0;
    const ga = trigrams(x);
    const gb = trigrams(y);
    let shared = 0;
    let total = 0;
    for (const n of ga.values()) total += n;
    for (const [g, n] of gb) {
        total += n;
        shared += Math.min(n, ga.get(g) ?? 0);
    }
    return (2 * shared) / total;
}

// ------------------------------------------------------------------ the limiter

export type SendKind = 'reply' | 'decline' | 'opener';

export interface SentRecord {
    at: number;
    kind: SendKind;
    /** canon() of the player answered, or null for an opener. */
    to: string | null;
    norm: string;
}

/** Persisted across restarts in state.json, so a crash loop cannot reset the limits. */
export interface LimiterState {
    sent: SentRecord[];
    /** Every opening line ever sent, normalised. */
    openers: string[];
    lastOpenerAt: number;
    /** canon(player) -> ms until which that player gets no reply. */
    cooldowns: Record<string, number>;
    /** canon(player) -> ms of the last decline sent to them. */
    declines: Record<string, number>;
}

export function emptyLimiterState(): LimiterState {
    return { sent: [], openers: [], lastOpenerAt: 0, cooldowns: {}, declines: {} };
}

/** Accept a state.json of unknown provenance; anything malformed starts empty. */
export function parseLimiterState(raw: unknown): LimiterState {
    const s = emptyLimiterState();
    if (!raw || typeof raw !== 'object') return s;
    const r = raw as Partial<LimiterState>;
    if (Array.isArray(r.sent)) {
        s.sent = r.sent.filter(
            (x): x is SentRecord => !!x && typeof x.at === 'number' && typeof x.norm === 'string' && ['reply', 'decline', 'opener'].includes(x.kind)
        );
    }
    if (Array.isArray(r.openers)) s.openers = r.openers.filter((x): x is string => typeof x === 'string');
    if (typeof r.lastOpenerAt === 'number') s.lastOpenerAt = r.lastOpenerAt;
    for (const key of ['cooldowns', 'declines'] as const) {
        const m = r[key];
        if (m && typeof m === 'object') for (const [k, v] of Object.entries(m)) if (typeof v === 'number') s[key][k] = v;
    }
    return s;
}

export class Limiter {
    constructor(
        readonly state: LimiterState = emptyLimiterState(),
        private readonly limits: Limits = LIMITS
    ) {}

    /** Why no line at all may go out now (global pacing), or null. */
    globalBlocked(now: number): string | null {
        const L = this.limits;
        const sent = this.state.sent;
        const last = sent[sent.length - 1];
        if (last && now - last.at < L.minGapMs) return 'min-gap';
        if (sent.filter(s => now - s.at < 60_000).length >= L.perMinute) return 'per-minute';
        if (sent.filter(s => now - s.at < 3600_000).length >= L.perHour) return 'per-hour';
        return null;
    }

    /** Why this player may not be answered now, or null. */
    playerBlocked(now: number, player: string): string | null {
        const who = canon(player);
        if ((this.state.cooldowns[who] ?? 0) > now) return 'player-cooldown';
        if (this.state.sent.some(s => s.to === who && now - s.at < this.limits.perPlayerGapMs)) return 'player-gap';
        return null;
    }

    /** Why this exact send may not go out now, or null. */
    blocked(now: number, kind: SendKind, to: string | null, text: string): string | null {
        const L = this.limits;
        const global = this.globalBlocked(now);
        if (global) return global;
        if (to) {
            const player = this.playerBlocked(now, to);
            if (player) return player;
        }
        if (kind === 'decline') {
            if (!to) return 'decline-without-player';
            if (now - (this.state.declines[canon(to)] ?? -Infinity) < L.declineEveryMs) return 'decline-limit';
        }
        if (kind === 'opener') {
            if (now - this.state.lastOpenerAt < L.openerEveryMs) return 'opener-limit';
            if (this.state.openers.some(o => similarity(o, text) >= L.repeatSimilarity)) return 'opener-reused';
        }
        if (this.state.sent.some(s => now - s.at < L.repeatWindowMs && similarity(s.norm, text) >= L.repeatSimilarity)) return 'repeat';
        return null;
    }

    record(now: number, kind: SendKind, to: string | null, text: string): void {
        const L = this.limits;
        const who = to ? canon(to) : null;
        this.state.sent.push({ at: now, kind, to: who, norm: normText(text) });
        if (who) {
            const recent = this.state.sent.filter(s => s.to === who && now - s.at < L.perPlayerWindowMs).length;
            if (recent >= L.perPlayerBurst) this.state.cooldowns[who] = now + L.perPlayerCooldownMs;
            if (kind === 'decline') this.state.declines[who] = now;
        }
        if (kind === 'opener') {
            this.state.openers.push(normText(text));
            this.state.lastOpenerAt = now;
        }
        this.prune(now);
    }

    /** Drop what no rule can look at any more. Openers are kept forever. */
    prune(now: number): void {
        const L = this.limits;
        this.state.sent = this.state.sent.filter(s => now - s.at < L.repeatWindowMs);
        for (const [k, until] of Object.entries(this.state.cooldowns)) if (until <= now) delete this.state.cooldowns[k];
        for (const [k, at] of Object.entries(this.state.declines)) if (now - at >= L.declineEveryMs) delete this.state.declines[k];
    }
}
