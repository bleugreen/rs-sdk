// The stockpile ledger: what every helper account last saw in its bank, plus
// fleet-wide totals per item name. One JSON file, rewritten atomically on every
// bank report so a reader never sees half a file. Format documented in
// docs/speedrun/HELPERS.md.
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface LedgerItem {
    id: number;
    name: string;
    count: number;
}

export interface LedgerAccount {
    role: string;
    /** ISO time of the bank visit this snapshot came from. */
    asOf: string;
    bank: LedgerItem[];
}

export interface Ledger {
    /** ISO time of the newest snapshot in the file. */
    asOf: string | null;
    /** Sum over every account's bank, keyed by item name, sorted by name. */
    totals: Record<string, number>;
    accounts: Record<string, LedgerAccount>;
}

export interface BankReport {
    account: string;
    role: string;
    asOf: string;
    items: { id: number; name: string; count: number }[];
}

export function emptyLedger(): Ledger {
    return { asOf: null, totals: {}, accounts: {} };
}

/** Merge duplicate (id, name) rows, drop empty ones, sort by name then id. */
export function normaliseBank(items: BankReport['items']): LedgerItem[] {
    const merged = new Map<string, LedgerItem>();
    for (const item of items) {
        if (!item || typeof item.name !== 'string' || !Number.isFinite(item.count) || item.count <= 0) continue;
        const key = `${item.id}:${item.name}`;
        const row = merged.get(key);
        if (row) row.count += item.count;
        else merged.set(key, { id: item.id, name: item.name, count: item.count });
    }
    return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}

export function computeTotals(accounts: Record<string, LedgerAccount>): Record<string, number> {
    const totals = new Map<string, number>();
    for (const entry of Object.values(accounts)) {
        for (const item of entry.bank) totals.set(item.name, (totals.get(item.name) ?? 0) + item.count);
    }
    return Object.fromEntries([...totals.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Replace one account's snapshot and recompute totals. A report older than the
 * snapshot already held is ignored: reports can arrive out of order across a
 * relogin, and the bank only ever has one true current state.
 */
export function applyBankReport(ledger: Ledger, report: BankReport): Ledger {
    const existing = ledger.accounts[report.account];
    if (existing && Date.parse(existing.asOf) > Date.parse(report.asOf)) return ledger;
    const accounts = {
        ...ledger.accounts,
        [report.account]: { role: report.role, asOf: report.asOf, bank: normaliseBank(report.items) }
    };
    const sortedAccounts = Object.fromEntries(Object.entries(accounts).sort(([a], [b]) => a.localeCompare(b)));
    const asOf = Object.values(sortedAccounts)
        .map(a => a.asOf)
        .reduce<string | null>((max, t) => (max === null || Date.parse(t) > Date.parse(max) ? t : max), null);
    return { asOf, totals: computeTotals(sortedAccounts), accounts: sortedAccounts };
}

/** Parse a ledger file's text. Anything unreadable yields null so the caller can decide. */
export function parseLedger(text: string): Ledger | null {
    try {
        const raw = JSON.parse(text) as Partial<Ledger>;
        if (typeof raw !== 'object' || raw === null || typeof raw.accounts !== 'object' || raw.accounts === null) return null;
        const accounts: Record<string, LedgerAccount> = {};
        for (const [name, entry] of Object.entries(raw.accounts)) {
            if (!entry || typeof entry.asOf !== 'string' || !Array.isArray(entry.bank)) continue;
            accounts[name] = { role: String(entry.role ?? ''), asOf: entry.asOf, bank: normaliseBank(entry.bank) };
        }
        const asOf = typeof raw.asOf === 'string' ? raw.asOf : null;
        return { asOf, totals: computeTotals(accounts), accounts };
    } catch {
        return null;
    }
}

export async function readLedger(path: string): Promise<Ledger> {
    let text: string;
    try {
        text = await readFile(path, 'utf8');
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyLedger();
        throw e;
    }
    const ledger = parseLedger(text);
    if (!ledger) {
        // Keep the evidence rather than overwriting it with an empty ledger.
        const aside = `${path}.corrupt-${Date.now()}`;
        await rename(path, aside);
        console.error(`[ledger] ${path} was unreadable; moved it to ${aside} and started a new ledger`);
        return emptyLedger();
    }
    return ledger;
}

/** Write via a temp file and rename, so readers see the old file or the new one, never a torn one. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify(value, null, 2) + '\n');
    await rename(tmp, path);
}

/**
 * Owns the ledger file for one process. Reports are applied in arrival order
 * through a promise chain, so two accounts banking in the same tick cannot
 * interleave read-modify-write cycles. Every report is also appended to a JSONL
 * history, which is what shows stock growing over time.
 */
export class LedgerWriter {
    private ledger: Ledger | null = null;
    private chain: Promise<void> = Promise.resolve();

    constructor(
        readonly path: string,
        readonly historyPath: string | null
    ) {}

    record(report: BankReport): Promise<void> {
        this.chain = this.chain
            .then(async () => {
                this.ledger ??= await readLedger(this.path);
                this.ledger = applyBankReport(this.ledger, report);
                await writeJsonAtomic(this.path, this.ledger);
                if (this.historyPath) {
                    const line = { asOf: report.asOf, account: report.account, role: report.role, bank: normaliseBank(report.items) };
                    await appendFile(this.historyPath, JSON.stringify(line) + '\n');
                }
            })
            .catch(e => console.error(`[ledger] failed to record ${report.account}'s bank:`, e));
        return this.chain;
    }
}
