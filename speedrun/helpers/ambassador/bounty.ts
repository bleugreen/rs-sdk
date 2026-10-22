// Pebble's Bounty Board: small item errands paid by the Grand Exchange, never by trade.
// A player completes a bounty by listing the item for sale on the GE, where our bidder
// account holds a matching buy offer. The ambassador never trades, pays or acts; it only
// talks about the board, and every line that touches it is held to the operator's config
// and the bidder's own offers file here, in code. Rules: docs/speedrun/AMBASSADOR.md.
//
// - The board is operator config (role option `bounties`, or a gitignored JSON file).
//   Nothing said in chat reaches it: no method below takes chat text as a board change.
// - A bounty is live only while the bidder's offers file (ge-offers.ts) is fresh, is
//   the configured bidder's, and holds an open buy offer for the item at or below the
//   configured price. Otherwise the board is empty and Pebble stays quiet about it.
// - checkLine refuses a line that quotes a price that is not a live bounty's, more than
//   the live quantity, a bounty for an item not on the live board, or a promise to pay,
//   give or trade; and holds unprompted pitches to one per 10 minutes and one per
//   player per hour.
//
// Pure apart from the snapshot reader passed in; the clock is a parameter.
import { readFileSync } from 'node:fs';
import { DEFAULT_OFFERS_FILE, readOffersFile, type OffersSnapshot } from '../ge-offers';
import { canon } from './policy';
import { nearRepeat, words, type Guard, GUARD } from './variety';

export const BOUNTY = {
    /** The whole board's quantity times price may not exceed this (rs/41's ruling). */
    maxTotalGp: 500_000,
    /** Modest prices and small quantities: the server operator watches for manipulation. */
    maxPrice: 50_000,
    maxQuantity: 50,
    /** An offers file older than this means no live bounties. */
    offersMaxAgeMs: 30 * 60_000,
    /** How often the offers file is read again. */
    rereadMs: 30_000,
    /** At most one unprompted pitch in this window, and never to the same player twice in pitchPlayerMs. */
    pitchEveryMs: 10 * 60_000,
    pitchPlayerMs: 60 * 60_000,
    /** Wanted posters remembered per item, so the same bounty is never pitched the same way twice. */
    postersKept: 12,
    /** A player who said they are going for a bounty is remembered this long. */
    hunterMs: 2 * 3600_000,
    /** A fill older than this when first seen is not cheered. */
    cheerWithinMs: 2 * 3600_000
} as const;

export type Tier = 'common' | 'rare' | 'legendary';
const TIERS: readonly Tier[] = ['common', 'rare', 'legendary'];

export interface BountyConfig {
    /** Item name as the game spells it (and as the bidder's offers file shows it). */
    item: string;
    /** Most the board asks for. */
    quantity: number;
    /** Most it pays each; a live bid above this is not announced. */
    maxPrice: number;
    tier: Tier;
    /** A seed for Pebble's wanted posters (the model writes the words). */
    flavour: string;
    /** Other ways chat names the item (lower case), for spotting mentions. */
    aliases: string[];
}

export interface BoardConfig {
    /** The bidder account whose offers back the board (never said in chat). */
    bidder: string;
    offersFile: string;
    /** A board-of-the-week theme ("wilderness week"), or null. */
    theme: string | null;
    /** ms the theme started, for its tally; null counts the offers file's whole week of fills. */
    since: number | null;
    bounties: BountyConfig[];
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const posInt = (v: unknown, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max ? v : null);

/**
 * The board from role options: `{bidder, offersFile?, theme?, since?, list: [{item,
 * quantity, maxPrice, tier?, flavour?, aliases?}]}`. Any invalid entry, or a total over
 * BOUNTY.maxTotalGp, rejects the whole board, so a typo cannot announce half of one.
 */
export function boardConfig(raw: unknown): Result<BoardConfig> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'bounties must be an object' };
    const r = raw as Record<string, unknown>;
    if (typeof r.bidder !== 'string' || !/^[a-z0-9_ ]{1,12}$/i.test(r.bidder)) return { ok: false, error: 'bounties.bidder must be an account name' };
    if (!Array.isArray(r.list) || !r.list.length) return { ok: false, error: 'bounties.list must be a non-empty list' };
    const bounties: BountyConfig[] = [];
    for (const [i, e] of (r.list as unknown[]).entries()) {
        const b = (e ?? {}) as Record<string, unknown>;
        const where = `bounties.list[${i}]`;
        if (typeof b.item !== 'string' || !/^[A-Za-z][A-Za-z0-9 '()-]{1,39}$/.test(b.item)) return { ok: false, error: `${where}.item must be an item name` };
        const quantity = posInt(b.quantity, BOUNTY.maxQuantity);
        if (quantity === null) return { ok: false, error: `${where}.quantity must be a whole number 1..${BOUNTY.maxQuantity}` };
        const maxPrice = posInt(b.maxPrice, BOUNTY.maxPrice);
        if (maxPrice === null) return { ok: false, error: `${where}.maxPrice must be a whole number 1..${BOUNTY.maxPrice}` };
        const tier = b.tier === undefined ? 'common' : b.tier;
        if (!TIERS.includes(tier as Tier)) return { ok: false, error: `${where}.tier must be one of ${TIERS.join(', ')}` };
        if (bounties.some(x => x.item.toLowerCase() === (b.item as string).toLowerCase())) return { ok: false, error: `${where}.item appears twice` };
        const aliases = Array.isArray(b.aliases) ? b.aliases.filter((a): a is string => typeof a === 'string' && a.trim().length >= 3).map(a => a.trim().toLowerCase()) : [];
        bounties.push({
            item: b.item,
            quantity,
            maxPrice,
            tier: tier as Tier,
            flavour: typeof b.flavour === 'string' ? b.flavour.slice(0, 200) : '',
            aliases: [...new Set([b.item.toLowerCase(), ...aliases])]
        });
    }
    const total = bounties.reduce((s, b) => s + b.quantity * b.maxPrice, 0);
    if (total > BOUNTY.maxTotalGp) return { ok: false, error: `the board totals ${total} gp; the limit is ${BOUNTY.maxTotalGp}` };
    const since = typeof r.since === 'string' && Number.isFinite(Date.parse(r.since)) ? Date.parse(r.since) : null;
    return {
        ok: true,
        value: {
            bidder: r.bidder,
            offersFile: typeof r.offersFile === 'string' && r.offersFile ? r.offersFile : DEFAULT_OFFERS_FILE,
            theme: typeof r.theme === 'string' && r.theme.trim() ? r.theme.trim().slice(0, 40) : null,
            since,
            bounties
        }
    };
}

/** The role options' board: inline `bounties`, or `bountiesFile` (a gitignored JSON file on the host). Null when neither is set. */
export function boardFromOptions(o: Record<string, unknown>, read: (path: string) => string = p => readFileSync(p, 'utf8')): Result<BoardConfig> | null {
    if (o.bounties !== undefined) return boardConfig(o.bounties);
    if (typeof o.bountiesFile !== 'string' || !o.bountiesFile) return null;
    try {
        return boardConfig(JSON.parse(read(o.bountiesFile)));
    } catch (e) {
        return { ok: false, error: `bountiesFile: ${e instanceof Error ? e.message : String(e)}` };
    }
}

// ------------------------------------------------------------------ liveness

export interface LiveBounty {
    item: string;
    /** What the live bid pays each: a GE sell at this or less fills. Never above the config's maxPrice. */
    price: number;
    /** How many the board still asks for: the config's quantity, or what the bid has left if less. */
    quantity: number;
    tier: Tier;
    flavour: string;
    aliases: string[];
}

/** Bounties with a fresh, matching open buy offer from the configured bidder. Anything else is silence. */
export function liveBounties(cfg: BoardConfig, snap: OffersSnapshot | null, now: number): LiveBounty[] {
    if (!snap || canon(snap.account) !== canon(cfg.bidder)) return [];
    const age = now - Date.parse(snap.writtenAt);
    if (!(age >= -60_000 && age <= BOUNTY.offersMaxAgeMs)) return [];
    const out: LiveBounty[] = [];
    for (const b of cfg.bounties) {
        const bids = snap.offers.filter(
            o => o.item.toLowerCase() === b.item.toLowerCase() && o.side === 'buy' && o.state === 'open' && o.remaining > 0 && o.price > 0 && o.price <= b.maxPrice
        );
        if (!bids.length) continue;
        const remaining = bids.reduce((s, o) => s + o.remaining, 0);
        out.push({ item: b.item, price: Math.max(...bids.map(o => o.price)), quantity: Math.min(b.quantity, remaining), tier: b.tier, flavour: b.flavour, aliases: b.aliases });
    }
    return out;
}

// ------------------------------------------------------------------ reading lines

/** "30k" for 30000, "1.5k" for 1500, "750gp" below a thousand: how Pebble says a price. */
export function gp(n: number): string {
    if (n >= 1_000_000 && n % 100_000 === 0) return `${n / 1_000_000}m`;
    if (n >= 1000 && n % 100 === 0) return `${n / 1000}k`;
    return `${n}gp`;
}

const PRICE = /(\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+)\s*(k|m|gp|coins?|ea|each|apiece)\b|\b(\d{1,3}(?:,\d{3})+)\b/gi;

/** Prices a line quotes, in gp: "30k", "1.5k gp", "30,000", "750 coins", "200 ea". */
export function pricesIn(text: string): number[] {
    const out: number[] = [];
    for (const m of text.matchAll(PRICE)) {
        const num = Number((m[1] ?? m[3] ?? '').replace(/,/g, ''));
        if (!Number.isFinite(num)) continue;
        const unit = (m[2] ?? '').toLowerCase();
        out.push(Math.round(unit === 'k' ? num * 1000 : unit === 'm' ? num * 1_000_000 : num));
    }
    return out;
}

/** Counts a line promises ("up to 12", "x12", "12 more", "need 12"), apart from its prices. */
export function quantitiesIn(text: string): number[] {
    const bare = text.replace(PRICE, ' ');
    const out: number[] = [];
    for (const re of [/\bup to (\d+)\b/gi, /\bx ?(\d+)\b/gi, /\b(\d+) (?:more|of (?:them|those|these)|wanted|needed)\b/gi, /\b(?:need|want|buying|taking|seeking) (\d+)\b/gi]) {
        for (const m of bare.matchAll(re)) out.push(Number(m[1]));
    }
    return out;
}

/** Words that make a line about bounties. */
const BOUNTY_WORDS = /\b(bount(y|ies)|wanted|reward\w*|errands?|buying|paying|board)\b/i;
/** A line naming a bounty item after one of these is claiming that bounty exists. */
const CLAIM = /\b(?:new|added?|another|extra|surprise|secret)\s+bount(?:y|ies)\b|\bbount(?:y|ies)\s+(?:on|for)\s+(?:an?\s+|some\s+)?([a-z][a-z' ]{2,30})|\b(?:buying|paying for|wanted:?)\s+(?:an?\s+|some\s+)?([a-z][a-z' ]{2,30})/gi;
/** Promises the ambassador cannot keep: it never pays, gives or trades. */
const PROMISE =
    /\b(i|we|ill|well|i will|we will|i can|we can|i'll|we'll)\s+(pay|give|send|trade|tip|hand|drop)\b|\bpay(ing)? you\b|\bdirect(ly)? (pay|trade|to you)|\btrade (me|you)\b|\b(pay|paid)\s+(you\s+)?directly\b|\bguarantee\w*\b|\bdouble(d)?\b|\bbonus\b/i;
/** A player saying they are going for it. */
const INTENT = /\b(going for|on it|i'?ll (get|grab|find|hunt|bring)|hunting|heading (out|to)|i'?m (on|after)|challenge accepted|got one|have one|selling (one|it|mine))\b/i;
/** A player asking about the board, so an answer is not an unprompted pitch. */
const ASKS = /\b(bount(y|ies)|board|wanted|errands?|rewards?|what (are|r|do) (you|u|ya) (buying|after|want|need|looking for)|anything (you|u) (need|want|buying))\b/i;

/** Words with a plural s dropped, so "nature talismans" names the "Nature talisman" bounty. */
const singular = (text: string) => words(text).map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
const has = (text: string, alias: string) => ` ${singular(text).join(' ')} `.includes(` ${singular(alias).join(' ')} `);

export interface Mention {
    /** Configured bounties the line names (live or not). */
    items: BountyConfig[];
    /** It uses bounty words or quotes a price. */
    bountyish: boolean;
}

export function mentionsIn(text: string, cfg: BoardConfig): Mention {
    return { items: cfg.bounties.filter(b => b.aliases.some(a => has(text, a))), bountyish: BOUNTY_WORDS.test(text) || pricesIn(text).length > 0 };
}

// ------------------------------------------------------------------ the board

/** Persisted in the role state (key BOUNTY_KEY), so restarts keep the pitch limits and posters. */
export interface BountyState {
    lastPitchAt: number;
    /** canon(player) -> ms of the last pitch to them. */
    pitchedTo: Record<string, number>;
    /** item -> our latest lines about it, oldest first. */
    posters: Record<string, string[]>;
    /** item -> ms of the last line about it. */
    lastPitched: Record<string, number>;
    /** Fills at or before this ms have been cheered (or were too old to cheer). */
    fillCursor: number;
    /** Whether the last opener was about the board (a poster or a cheer), so the next one is not. */
    lastOpenerBounty: boolean;
}

export const BOUNTY_KEY = 'bounty';

export function emptyBountyState(): BountyState {
    return { lastPitchAt: 0, pitchedTo: {}, posters: {}, lastPitched: {}, fillCursor: 0, lastOpenerBounty: false };
}

export function parseBountyState(raw: unknown): BountyState {
    const s = emptyBountyState();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return s;
    const r = raw as Partial<BountyState>;
    if (typeof r.lastPitchAt === 'number') s.lastPitchAt = r.lastPitchAt;
    if (typeof r.fillCursor === 'number') s.fillCursor = r.fillCursor;
    if (typeof r.lastOpenerBounty === 'boolean') s.lastOpenerBounty = r.lastOpenerBounty;
    for (const key of ['pitchedTo', 'lastPitched'] as const) {
        const m = r[key];
        if (m && typeof m === 'object') for (const [k, v] of Object.entries(m)) if (typeof v === 'number') s[key][k] = v;
    }
    if (r.posters && typeof r.posters === 'object') {
        for (const [k, v] of Object.entries(r.posters)) {
            if (Array.isArray(v)) s.posters[k] = v.filter((x): x is string => typeof x === 'string').map(x => x.slice(0, 120)).slice(-BOUNTY.postersKept);
        }
    }
    return s;
}

export interface BountyRefusal {
    reason: 'bounty-price' | 'bounty-quantity' | 'bounty-not-live' | 'bounty-unknown' | 'bounty-promise' | 'bounty-pitch-limit' | 'bounty-player-limit';
    detail: string;
}

/** What a prompt is shown about the board. */
export interface BoardView {
    theme: string | null;
    /** The live bounties; empty means the board is empty and nothing may be offered. */
    items: { item: string; pays_each: string; up_to: number; tier: Tier; flavour: string }[];
    /** Errands done since the theme started (or this week), from the bidder's own fills. */
    tally: { filled: number; asked: number } | null;
    /** Whether this line may bring a bounty up unasked. */
    may_pitch: boolean;
}

export type OpenerPlan =
    | { kind: 'cheer'; item: string; n: number; hunters: string[]; upTo: number }
    | { kind: 'poster'; bounty: LiveBounty; postersUsed: string[]; tally: BoardView['tally']; theme: string | null };

export class BountyBoard {
    private snap: OffersSnapshot | null = null;
    private readAt = -Infinity;
    /** canon(player) -> { name, item, at } for players who said they are going for a bounty. */
    private readonly hunters = new Map<string, { name: string; item: string; at: number }>();

    constructor(
        readonly cfg: BoardConfig,
        readonly state: BountyState = emptyBountyState(),
        private readonly read: (path: string) => OffersSnapshot | null = readOffersFile,
        /** Fills from before this (the role's start) are never cheered. */
        startedAt = 0
    ) {
        this.state.fillCursor = Math.max(this.state.fillCursor, startedAt - BOUNTY.cheerWithinMs);
    }

    private snapshot(now: number): OffersSnapshot | null {
        if (now - this.readAt >= BOUNTY.rereadMs || now < this.readAt) {
            this.readAt = now;
            this.snap = this.read(this.cfg.offersFile);
        }
        return this.snap;
    }

    live(now: number): LiveBounty[] {
        return liveBounties(this.cfg, this.snapshot(now), now);
    }

    /** Errands done for the board's items since the theme started (or over the file's week). */
    tally(now: number): BoardView['tally'] {
        const snap = this.snapshot(now);
        if (!snap || !liveBounties(this.cfg, snap, now).length) return null;
        const items = new Set(this.cfg.bounties.map(b => b.item.toLowerCase()));
        const filled = snap.fills.filter(f => items.has(f.item.toLowerCase()) && Date.parse(f.at) >= (this.cfg.since ?? 0)).reduce((s, f) => s + f.n, 0);
        return { filled, asked: this.cfg.bounties.reduce((s, b) => s + b.quantity, 0) };
    }

    /** A chat line was heard: remember a player who says they are going for a live bounty. Changes nothing else. */
    noteHeard(now: number, sender: string, text: string): void {
        if (!INTENT.test(text)) return;
        const item = this.live(now).find(b => b.aliases.some(a => has(text, a)));
        if (item) this.hunters.set(canon(sender), { name: sender, item: item.item, at: now });
        for (const [k, h] of this.hunters) if (now - h.at > BOUNTY.hunterMs) this.hunters.delete(k);
    }

    /** Players who said they were going for `item`, latest first. */
    huntersFor(item: string, now: number): string[] {
        return [...this.hunters.values()].filter(h => h.item === item && now - h.at <= BOUNTY.hunterMs).sort((a, b) => b.at - a.at).map(h => h.name).slice(0, 3);
    }

    /** Whether the lines being answered ask about the board (answering them is not an unprompted pitch). */
    asked(heard: readonly string[]): boolean {
        return heard.some(h => ASKS.test(h) || this.cfg.bounties.some(b => b.aliases.some(a => has(h, a))));
    }

    private pitchBlocked(now: number, to: string | null): BountyRefusal | null {
        if (now - this.state.lastPitchAt < BOUNTY.pitchEveryMs) return { reason: 'bounty-pitch-limit', detail: 'one unprompted bounty line per 10 minutes' };
        if (to && now - (this.state.pitchedTo[canon(to)] ?? -Infinity) < BOUNTY.pitchPlayerMs) return { reason: 'bounty-player-limit', detail: 'already pitched to them this hour' };
        return null;
    }

    /** Whether this line may bring a bounty up unasked now. */
    mayPitch(now: number, to: string | null): boolean {
        return this.live(now).length > 0 && this.pitchBlocked(now, to) === null;
    }

    /**
     * Why this line may not go out, or null. Every price must be a live bounty's price,
     * every count within its live quantity, every bounty it claims on the live board, and
     * it may promise nothing; a line about the board that nobody asked for is a pitch,
     * held to the pitch limits.
     */
    checkLine(now: number, kind: 'reply' | 'decline' | 'opener', to: string | null, text: string, heard: readonly string[] = []): BountyRefusal | null {
        const live = this.live(now);
        const m = mentionsIn(text, this.cfg);
        const liveNamed = live.filter(b => m.items.some(i => i.item === b.item));
        const about = liveNamed.length > 0 || m.bountyish || m.items.length > 0;
        if (!about) return null;
        if (PROMISE.test(text) && (m.bountyish || m.items.length)) return { reason: 'bounty-promise', detail: 'you never pay, give or trade; the GE pays' };
        const prices = pricesIn(text);
        for (const p of prices) {
            const pool = liveNamed.length ? liveNamed : live;
            if (!pool.some(b => b.price === p)) return { reason: 'bounty-price', detail: `${gp(p)} is not a live bounty price` };
        }
        const counts = quantitiesIn(text);
        const most = Math.max(0, ...(liveNamed.length ? liveNamed : live).map(b => b.quantity));
        for (const n of counts) if (n > most) return { reason: 'bounty-quantity', detail: `${n} is more than the board asks for` };
        const dead = m.items.filter(i => !live.some(b => b.item === i.item));
        if (dead.length && (m.bountyish || prices.length)) return { reason: 'bounty-not-live', detail: `${dead[0]!.item} is not on the board now` };
        for (const c of text.matchAll(CLAIM)) {
            const named = (c[1] ?? c[2] ?? '').trim();
            const onBoard = (s: string) => live.some(b => b.aliases.some(a => has(s, a) || has(a, s.split(' ')[0] ?? '')));
            if (!named ? !liveNamed.length : !onBoard(named)) return { reason: 'bounty-unknown', detail: `"${c[0]}" is not a bounty on the board` };
        }
        const pitch = liveNamed.length > 0 || (m.bountyish && live.length > 0 && prices.length > 0);
        if (pitch && (kind === 'opener' || !this.asked(heard))) {
            const limit = this.pitchBlocked(now, kind === 'opener' ? null : to);
            if (limit) return limit;
        }
        return null;
    }

    /** Our earlier lines about the bounties `text` names, for the near-repeat guard. */
    postersFor(text: string): string[] {
        return mentionsIn(text, this.cfg).items.flatMap(b => this.state.posters[b.item] ?? []);
    }

    /** A near-repeat of an earlier line about the same bounty (the guard's opener and phrase checks), or null. */
    posterEcho(text: string, g: Guard = GUARD): string | null {
        const earlier = this.postersFor(text);
        if (!earlier.length) return null;
        const hit = nearRepeat(text, earlier, { ...g, wordMax: Infinity, bitMax: Infinity, questionMax: Infinity });
        return hit ? `this bounty was already pitched that way (${hit.reason}: ${hit.detail})` : null;
    }

    /** A line went out: remember the pitch and the poster. Returns whether the state changed. */
    recordSent(now: number, kind: 'reply' | 'decline' | 'opener', to: string | null, text: string, heard: readonly string[] = []): boolean {
        const live = this.live(now);
        const named = mentionsIn(text, this.cfg).items.filter(i => live.some(b => b.item === i.item));
        if (!named.length) return false;
        for (const b of named) {
            this.state.posters[b.item] = [...(this.state.posters[b.item] ?? []), text].slice(-BOUNTY.postersKept);
            this.state.lastPitched[b.item] = now;
        }
        if (kind === 'opener' || !this.asked(heard)) {
            this.state.lastPitchAt = now;
            if (to) this.state.pitchedTo[canon(to)] = now;
        }
        for (const [k, at] of Object.entries(this.state.pitchedTo)) if (now - at >= BOUNTY.pitchPlayerMs) delete this.state.pitchedTo[k];
        return true;
    }

    /** The board as a prompt shows it. */
    view(now: number, to: string | null): BoardView {
        const live = this.live(now);
        return {
            theme: this.cfg.theme,
            items: live.map(b => ({ item: b.item, pays_each: gp(b.price), up_to: b.quantity, tier: b.tier, flavour: b.flavour })),
            tally: this.cfg.theme ? this.tally(now) : null,
            may_pitch: this.mayPitch(now, to)
        };
    }

    /** New fills of board items since the last cheer, summed per item. */
    newFills(now: number): { item: string; n: number; upTo: number }[] {
        const snap = this.snapshot(now);
        if (!snap || canon(snap.account) !== canon(this.cfg.bidder)) return [];
        const items = new Map(this.cfg.bounties.map(b => [b.item.toLowerCase(), b.item] as const));
        const by = new Map<string, { item: string; n: number; upTo: number }>();
        for (const f of snap.fills) {
            const at = Date.parse(f.at);
            const item = items.get(f.item.toLowerCase());
            // A fill "from the future" is a clock skew or a bad file: not cheered until its time comes.
            if (!item || at <= this.state.fillCursor || at > now || now - at > BOUNTY.cheerWithinMs) continue;
            const e = by.get(item) ?? { item, n: 0, upTo: 0 };
            e.n += f.n;
            e.upTo = Math.max(e.upTo, at);
            by.set(item, e);
        }
        return [...by.values()];
    }

    /**
     * What a quiet-time opener should be. After an opener about the board, an ordinary
     * one (null, which must not bring bounties up); otherwise a cheer for a new fill, else
     * a wanted poster for the bounty pitched least recently when a pitch is allowed.
     */
    planOpener(now: number): OpenerPlan | null {
        if (this.state.lastOpenerBounty || this.pitchBlocked(now, null) !== null) return null;
        const fill = this.newFills(now)[0];
        if (fill) return { kind: 'cheer', item: fill.item, n: fill.n, hunters: this.huntersFor(fill.item, now), upTo: fill.upTo };
        if (!this.mayPitch(now, null)) return null;
        const live = this.live(now).sort((a, b) => (this.state.lastPitched[a.item] ?? 0) - (this.state.lastPitched[b.item] ?? 0));
        const bounty = live[0];
        if (!bounty) return null;
        return { kind: 'poster', bounty, postersUsed: (this.state.posters[bounty.item] ?? []).slice(-6), tally: this.cfg.theme ? this.tally(now) : null, theme: this.cfg.theme };
    }

    /** An opener went out under `plan` (or an ordinary one under null). */
    openerSent(plan: OpenerPlan | null): void {
        if (plan?.kind === 'cheer') this.state.fillCursor = Math.max(this.state.fillCursor, plan.upTo);
        this.state.lastOpenerBounty = plan !== null;
    }
}
