// The S21 body-altar giver roster: which accounts, in what order, on which
// slot tile, and what each needs before the run (docs/speedrun/helpers/altar-giver.md,
// "Roster"). It writes run-machine launcher configs (standalone.ts) and the
// provisioning plan; it logs nothing in and touches no account.
//
//   bun speedrun/helpers/roster.ts config [--role=altar-giver|idle] [--count=22] [--refused=cairn_t05,...]
//                                         [--gateway-port=7795] [--accept-from=REGEX] > launch.json
//   bun speedrun/helpers/roster.ts plan [--count=22] [--refused=...] [--stockpile=stockpile.json]
//
// `plan` reads the fleet's stockpile.json (bbs ~/rs-fleet/stockpile.json, copied
// off read-only) for where the body talismans and the essence sit.
import { readFileSync } from 'node:fs';
import { ACCOUNT_NAME_RE, FORBIDDEN_ACCOUNTS } from './fleet-config';

/** Stand tiles beside the scored account: 0 east, 1 west, 2 south (altar-giver.md, "Tiles"). */
export const GIVER_SLOTS = 3;
/** rs/163's lab figure: N = ceil(142 / 7) + 1. */
export const BODY_ROSTER_SIZE = 22;
/** Essence one giver hands over per trade (the talisman holds the 28th slot). */
export const ESSENCE_PER_TRIP = 27;
/** S21's whole essence need (rs/163, 2026-10-21). */
export const S21_ESSENCE = 5238;
/** Demo logins from bbs during provisioning: at most this many at once (rs/214, rs/41's fleet headroom). */
export const PROVISION_BATCH = 5;
/** T21-22's Lumbridge teleport, handed back after S21's last craft (SUPPLIES.md H17e; runecraft.ts S21_HAND_BACK). */
export const S21_HAND_BACK = [
    { item: 'Law rune', n: 1 },
    { item: 'Air rune', n: 3 },
    { item: 'Earth rune', n: 1 }
] as const;

/**
 * The hand-back giver: the one whose turn follows the last essence turn. The roster serves in
 * strict rotation (oldest ready first, and a round trip of ~140 ticks is under the 22 x 7 a giver
 * waits), so delivery k (from 0) is roster slot k mod N. With D deliveries the turn after the last
 * falls to slot D mod N, which by then has made floor(D / N) essence trades: S21's 194 on 22 givers
 * give slot 18, cairn_t19, after 8 trades. Staged with exactly those trades' essence and the hand-back
 * items, its bank runs out of essence after its last trade and its next trip is runes-only
 * (altar-room.ts bankWithdrawals), arriving in the room about as the last craft lands.
 */
export function handBackSlot(total = S21_ESSENCE, givers = BODY_ROSTER_SIZE): { index: number; trades: number; essence: number } {
    positiveInteger(total, 'total essence');
    positiveInteger(givers, 'giver count');
    const deliveries = Math.ceil(total / ESSENCE_PER_TRIP);
    const trades = Math.floor(deliveries / givers);
    return { index: deliveries % givers, trades, essence: trades * ESSENCE_PER_TRIP };
}

const PRIMARY = Array.from({ length: 22 }, (_, i) => `cairn_t${String(i + 1).padStart(2, '0')}`);
/** Spares, used in this order when a primary name is refused. New names need rs/41's approval. */
const SPARES = Array.from({ length: 5 }, (_, i) => `cairn_t${String(i + 23).padStart(2, '0')}`);

export interface Roster {
    accounts: string[];
    /** primary -> spare that replaced it. */
    substituted: Record<string, string>;
}

/**
 * The roster in login order. A refused name (taken by someone else, or locked)
 * keeps its position and is replaced by the next unused spare, so slot
 * assignment and login order stay stable for everyone else.
 */
export function roster(count = BODY_ROSTER_SIZE, refused: Iterable<string> = []): Roster {
    if (!Number.isInteger(count) || count < 1 || count > PRIMARY.length) throw new Error(`count must be 1-${PRIMARY.length}`);
    const out = new Set(refused);
    for (const name of out) if (![...PRIMARY, ...SPARES].includes(name)) throw new Error(`unknown refused account: ${name}`);
    const free = SPARES.filter(s => !out.has(s));
    const substituted: Record<string, string> = {};
    const accounts = PRIMARY.slice(0, count).map(name => {
        if (!out.has(name)) return name;
        const spare = free.shift();
        if (!spare) throw new Error(`no spare left for ${name}; ask rs/41 before creating new names`);
        substituted[name] = spare;
        return spare;
    });
    validateAccounts(accounts);
    return { accounts, substituted };
}

function validateAccounts(accounts: string[]): void {
    if (!accounts.length || new Set(accounts).size !== accounts.length) throw new Error('accounts must be non-empty and unique');
    for (const a of accounts) {
        if (!ACCOUNT_NAME_RE.test(a) || FORBIDDEN_ACCOUNTS.has(a)) throw new Error(`refusing ${a}`);
    }
}

function positiveInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`);
}

export interface EntryOptions {
    role: 'altar-giver' | 'idle';
    /** altar-giver only: a courier that may top up a giver whose bank runs short. */
    acceptFrom?: string;
}

/** One launcher entry per giver, in login order, slots round-robin, every one on the direct path. */
export function giverEntries(accounts: string[], o: EntryOptions): Record<string, unknown>[] {
    validateAccounts(accounts);
    if (o.role !== 'idle' && o.role !== 'altar-giver') throw new Error('role must be idle or altar-giver');
    if (o.acceptFrom) new RegExp(o.acceptFrom);
    const handBack = handBackSlot(S21_ESSENCE, accounts.length).index;
    return accounts.map((account, i) => {
        if (o.role === 'idle') return { account, role: 'idle', path: 'direct', options: { heartbeatMinutes: 1 } };
        const restock: Record<string, unknown> = { kind: 'bank' };
        if (o.acceptFrom) restock.acceptFrom = o.acceptFrom;
        const options: Record<string, unknown> = { altar: 'body', slot: i % GIVER_SLOTS, essence: ESSENCE_PER_TRIP, restock, scope: { step: 'S21', family: 'altar' } };
        if (i === handBack) options.handBack = S21_HAND_BACK.map(h => ({ ...h }));
        return { account, role: 'altar-giver', path: 'direct', options };
    });
}

export function launchConfig(accounts: string[], o: EntryOptions & { gatewayPort?: number }): Record<string, unknown> {
    const gatewayPort = o.gatewayPort ?? 7795;
    if (!Number.isInteger(gatewayPort) || gatewayPort < 1024 || gatewayPort > 65535) throw new Error('invalid gateway port');
    return { gatewayPort, accounts: giverEntries(accounts, o) };
}

export function batches<T>(xs: readonly T[], size = PROVISION_BATCH): T[][] {
    if (!Number.isInteger(size) || size < 1 || size > PROVISION_BATCH) throw new Error(`batch size must be 1-${PROVISION_BATCH}`);
    const out: T[][] = [];
    for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
    return out;
}

/** Essence each giver's bank holds before the run: the fair share, rounded up to whole trips. */
export function essencePerGiver(total = S21_ESSENCE, givers = BODY_ROSTER_SIZE): { perGiver: number; trips: number } {
    positiveInteger(total, 'total essence');
    positiveInteger(givers, 'giver count');
    const trips = Math.ceil(Math.ceil(total / givers) / ESSENCE_PER_TRIP);
    return { perGiver: trips * ESSENCE_PER_TRIP, trips };
}

interface StockItem {
    name: string;
    count: number;
}
export interface Stockpile {
    accounts: Record<string, { role?: string; bank?: StockItem[] }>;
}

export interface Transfer {
    from: string;
    to: string;
    item: string;
    count: number;
}

/**
 * Who hands what to whom: `each` of `item` to every giver, taken from the
 * holders with the most first (fewest holders logged in). Holders that are
 * givers themselves, forbidden or not cairn_ helpers are never used.
 */
export function allocate(stock: Stockpile, item: string, givers: string[], each: number): Transfer[] {
    positiveInteger(each, 'allocation');
    return allocateEach(stock, item, givers, () => each);
}

/** As allocate, with each giver's own count (0: nothing for it). */
export function allocateEach(stock: Stockpile, item: string, givers: string[], countFor: (giver: string) => number): Transfer[] {
    validateAccounts(givers);
    const wants = givers.map(g => {
        const n = countFor(g);
        if (!Number.isSafeInteger(n) || n < 0) throw new Error('allocation must be a non-negative safe integer');
        return n;
    });
    if (!stock || typeof stock.accounts !== 'object' || stock.accounts === null || Array.isArray(stock.accounts)) throw new Error('stockpile needs accounts');
    for (const a of Object.values(stock.accounts)) {
        if (!a || (a.bank !== undefined && !Array.isArray(a.bank))) throw new Error('invalid stockpile account');
        for (const entry of a.bank ?? []) {
            if (!entry || typeof entry.name !== 'string' || !Number.isSafeInteger(entry.count) || entry.count < 0) throw new Error('invalid stockpile item');
        }
    }
    const skip = new Set(givers);
    const holders = Object.entries(stock.accounts)
        .filter(([name]) => !skip.has(name) && ACCOUNT_NAME_RE.test(name) && !FORBIDDEN_ACCOUNTS.has(name))
        .map(([name, a]) => ({ name, left: (a.bank ?? []).filter(i => i.name === item).reduce((n, i) => n + i.count, 0) }))
        .filter(h => h.left > 0)
        .sort((a, b) => b.left - a.left || a.name.localeCompare(b.name));
    const have = holders.reduce((n, h) => n + h.left, 0);
    const total = wants.reduce((a, n) => a + n, 0);
    if (have < total) throw new Error(`${item}: need ${total}, the stockpile holds ${have}`);
    const out: Transfer[] = [];
    let h = 0;
    for (const [g, to] of givers.entries()) {
        let need = wants[g]!;
        while (need > 0) {
            const holder = holders[h]!;
            const n = Math.min(need, holder.left);
            const last = out[out.length - 1];
            if (last && last.from === holder.name && last.to === to) last.count += n;
            else out.push({ from: holder.name, to, item, count: n });
            holder.left -= n;
            need -= n;
            if (holder.left === 0) h++;
        }
    }
    return out;
}

export interface ProvisionPlan {
    roster: Roster;
    batches: string[][];
    /** Every giver's essence but the hand-back giver's. */
    essence: { perGiver: number; trips: number };
    /** The hand-back giver: its essence trades' worth of essence and the hand-back items, for its bank (staging names the donor of the items). */
    handBack: { account: string; essence: number; trades: number; items: { item: string; n: number }[] };
    talismans: Transfer[];
    essenceTransfers: Transfer[];
}

export function provisionPlan(stock: Stockpile, r: Roster, total = S21_ESSENCE): ProvisionPlan {
    const essence = essencePerGiver(total, r.accounts.length);
    const hb = handBackSlot(total, r.accounts.length);
    const handBackAccount = r.accounts[hb.index]!;
    const talismans = allocate(stock, 'Body talisman', r.accounts, 1);
    // One donor pass in roster order: the hand-back giver takes only its trades' essence, so its bank runs out after its last trade.
    const essenceTransfers = allocateEach(stock, 'Rune essence', r.accounts, a => (a === handBackAccount ? hb.essence : essence.perGiver));
    const donors = new Set([...talismans, ...essenceTransfers].map(t => t.from));
    // The five-client provisioning budget includes donors, not only recipients.
    if (donors.size >= PROVISION_BATCH) throw new Error('too many donors for one provisioning window; ask rs/41 to consolidate stock first');
    return {
        roster: r,
        batches: batches(r.accounts, PROVISION_BATCH - donors.size),
        essence,
        handBack: { account: handBackAccount, essence: hb.essence, trades: hb.trades, items: S21_HAND_BACK.map(i => ({ ...i })) },
        talismans,
        essenceTransfers
    };
}

function flag(args: string[], name: string): string | undefined {
    return args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

if (import.meta.main) {
    const [cmd, ...args] = process.argv.slice(2);
    const refused = (flag(args, 'refused') ?? '').split(',').filter(Boolean);
    const r = roster(Number(flag(args, 'count') ?? BODY_ROSTER_SIZE), refused);
    if (cmd === 'config') {
        const role = (flag(args, 'role') ?? 'altar-giver') as EntryOptions['role'];
        if (role !== 'altar-giver' && role !== 'idle') throw new Error('--role must be altar-giver or idle');
        const port = flag(args, 'gateway-port');
        console.log(JSON.stringify(launchConfig(r.accounts, { role, acceptFrom: flag(args, 'accept-from'), gatewayPort: port ? Number(port) : undefined }), null, 2));
    } else if (cmd === 'plan') {
        const stock = JSON.parse(readFileSync(flag(args, 'stockpile') ?? 'stockpile.json', 'utf8')) as Stockpile;
        console.log(JSON.stringify(provisionPlan(stock, r), null, 2));
    } else {
        console.error('usage: bun speedrun/helpers/roster.ts config|plan [--count=22] [--refused=a,b] [--role=altar-giver|idle] [--gateway-port=N] [--accept-from=RE] [--stockpile=FILE]');
        process.exit(2);
    }
}
