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
export function roster(count = BODY_ROSTER_SIZE, refused: Iterable<string> = [], primary = PRIMARY, spares = SPARES): Roster {
    if (!Number.isInteger(count) || count < 1 || count > primary.length) throw new Error(`count must be 1-${primary.length}`);
    const out = new Set(refused);
    const free = spares.filter(s => !out.has(s));
    const substituted: Record<string, string> = {};
    const accounts = primary.slice(0, count).map(name => {
        if (!out.has(name)) return name;
        const spare = free.shift();
        if (!spare) throw new Error(`no spare left for ${name}; ask rs/41 before creating new names`);
        substituted[name] = spare;
        return spare;
    });
    for (const a of accounts) {
        if (!ACCOUNT_NAME_RE.test(a) || FORBIDDEN_ACCOUNTS.has(a)) throw new Error(`refusing ${a}`);
    }
    return { accounts, substituted };
}

export interface EntryOptions {
    role: 'altar-giver' | 'idle';
    /** altar-giver only: a courier that may top up a giver whose bank runs short. */
    acceptFrom?: string;
}

/** One launcher entry per giver, in login order, slots round-robin, every one on the direct path. */
export function giverEntries(accounts: string[], o: EntryOptions): Record<string, unknown>[] {
    return accounts.map((account, i) => {
        if (o.role === 'idle') return { account, role: 'idle', path: 'direct', options: { heartbeatMinutes: 1 } };
        const restock: Record<string, unknown> = { kind: 'bank' };
        if (o.acceptFrom) restock.acceptFrom = o.acceptFrom;
        return { account, role: 'altar-giver', path: 'direct', options: { altar: 'body', slot: i % GIVER_SLOTS, essence: ESSENCE_PER_TRIP, restock } };
    });
}

export function launchConfig(accounts: string[], o: EntryOptions & { gatewayPort?: number }): Record<string, unknown> {
    return { gatewayPort: o.gatewayPort ?? 7795, accounts: giverEntries(accounts, o) };
}

export function batches<T>(xs: readonly T[], size = PROVISION_BATCH): T[][] {
    if (!Number.isInteger(size) || size < 1) throw new Error('batch size must be a positive integer');
    const out: T[][] = [];
    for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
    return out;
}

/** Essence each giver's bank holds before the run: the fair share, rounded up to whole trips. */
export function essencePerGiver(total = S21_ESSENCE, givers = BODY_ROSTER_SIZE): { perGiver: number; trips: number } {
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
    const skip = new Set(givers);
    const holders = Object.entries(stock.accounts)
        .filter(([name]) => !skip.has(name) && ACCOUNT_NAME_RE.test(name) && !FORBIDDEN_ACCOUNTS.has(name))
        .map(([name, a]) => ({ name, left: (a.bank ?? []).filter(i => i.name === item).reduce((n, i) => n + i.count, 0) }))
        .filter(h => h.left > 0)
        .sort((a, b) => b.left - a.left || a.name.localeCompare(b.name));
    const have = holders.reduce((n, h) => n + h.left, 0);
    if (have < each * givers.length) throw new Error(`${item}: need ${each * givers.length}, the stockpile holds ${have}`);
    const out: Transfer[] = [];
    let h = 0;
    for (const to of givers) {
        let need = each;
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
    essence: { perGiver: number; trips: number };
    talismans: Transfer[];
    essenceTransfers: Transfer[];
}

export function provisionPlan(stock: Stockpile, r: Roster, total = S21_ESSENCE): ProvisionPlan {
    const essence = essencePerGiver(total, r.accounts.length);
    return {
        roster: r,
        batches: batches(r.accounts),
        essence,
        talismans: allocate(stock, 'Body talisman', r.accounts, 1),
        essenceTransfers: allocate(stock, 'Rune essence', r.accounts, essence.perGiver)
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
