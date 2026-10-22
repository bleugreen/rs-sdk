// mule-ledger: a trade giver's packages (mule.ts `packages`) built from STEP-MANIFEST.md's inventory
// ledger, the rows SCORED's hand-off steps read (runner/handoff.ts loadHandOff), and the drift check
// between a mule's configured packages and those rows.
//
// The row is the data. Each `in` entry the scored account receives is a line the mule offers: by id
// for `NAME @ID`, else by the game's name; noted for [n]. A top-up (`NAME to N`) is either
// `topUp: { max: N }` with the package scoped to the hand-off's step (the `ask` form, served from the
// scored side's top-up ask) or a fixed N (the `fixed` form, the fallback while no ask writer is
// deployed: SCORED must then hold none of it, or it declines). The row's `out` entries are what the
// mule takes back in the same trade; the mule accepts any offer from the scored account, so they
// are reported (`takesBack`), not configured. Every row goes through planHandOff first, so a row the
// scored side refuses is refused here too.
//
// A package's scope step is the first S row after the hand-off row (the step that consumes it:
// H12 before S15), and the packages come in ledger order, which is the order the run pulls them
// (mule.ts serveMode 'order').
//
//   bun speedrun/helpers/mule-ledger.ts [--form ask|fixed] [--rows H12,H13] [--manifest PATH]
//       prints { packages } for the mule's options
//   ... --check FILE [--account cairn_mule1]   drift of FILE's packages (mule options, a packages
//       list, or fleet.json) against the ledger; exit 1 on any
//   ... --bank FILE [--account cairn_mule1]    each package staged against the account's bank in
//       stockpile.json (mule.ts planPackage): missing, ambiguous, top-ups short
import { readFileSync } from 'node:fs';

import type { BankItem } from '../../sdk/types';
import { namesNote, refLabel, type ItemRef } from '../lib/items';
import { noteLink, type ObjPack } from '../lib/obj-pack';
import { gameName, planHandOff } from '../runner/handoff';
import { itemLabel, MANIFEST, parseLedger, type InEntry, type LedgerRow } from '../tools/slot-ledger';
import { isTopUp, packageOf, planPackage, type Package, type PackageItem } from './mule';

/** cairn_mule1's hand-offs (rs/443): H21e's list rides H21d's row, one trade. */
export const MULE1_ROWS = ['H1', 'H4', 'H4k', 'H4p', 'H6', 'H10', 'H12', 'H13', 'H21d', 'H22'] as const;

export const INVENTORY_SLOTS = 28;

/** How a top-up line is served: from the scored side's ask, or as a fixed `to N`. */
export type TopUpForm = 'ask' | 'fixed';

export interface LedgerPackage {
    row: string;
    /** The row's line in the manifest. */
    line: number;
    /** The step the hand-off feeds: the first S row after it. */
    step: string;
    /** The mule's package, as mule.ts packageOf reads it. */
    package: Package;
    /** The row's top-ups, by ledger label, whichever form the package serves them in. */
    topUps: { item: string; to: number }[];
    /** The mule's inventory slots the package fills (a top-up at its `to`). */
    slots: number;
    /** What the scored account gives back in the same trade, as the ledger writes it. */
    takesBack: string[];
    /** The row's `<NAME>` entries: the module's own, not in this trade. */
    moduleLines: string[];
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The S row after `index` in ledger order (`S15 Y` reads as S15). */
export function stepAfter(rows: readonly LedgerRow[], index: number): string {
    for (let i = index + 1; i < rows.length; i++) {
        const m = rows[i]!.row.match(/^(S\d+[a-z]?)\b/);
        if (m) return m[1]!;
    }
    throw new Error(`${rows[index]!.row}: no step row after it in the ledger`);
}

function lineOf(e: InEntry, at: string, form: TopUpForm): PackageItem {
    if (e.family) throw new Error(`${at}: in ${itemLabel(e)} names any dose; a package line offers one obj, so the row must name it`);
    if (e.count === null) throw new Error(`${at}: in ${itemLabel(e)} x? has no count`);
    const ref: ItemRef = e.id !== undefined ? { id: e.id } : { item: capitalise(gameName(e.name)) };
    const noted = e.kind === 'n' ? { noted: true } : {};
    if (e.topUp && form === 'ask') return { ...ref, topUp: { max: e.count }, ...noted };
    return { ...ref, amount: e.count, ...noted };
}

/** One ledger row as a mule package. */
export function packageFromRow(rows: readonly LedgerRow[], index: number, form: TopUpForm = 'ask', pack?: ObjPack): LedgerPackage {
    const row = rows[index]!;
    const at = `${row.row} (line ${row.line})`;
    const plan = planHandOff(row);
    const step = stepAfter(rows, index);
    const entries = row.in.filter(e => !e.placeholder);
    if (!entries.length) throw new Error(`${at}: the scored account receives nothing from the mule`);
    const items = entries.map(e => lineOf(e, at, form));
    const topUps = entries.filter(e => e.topUp).map(e => ({ item: itemLabel(e), to: e.count! }));
    const raw = { name: row.row.toLowerCase(), items, ...(items.some(isTopUp) ? { scope: { step, family: 'mule' } } : {}) };
    const pkg = packageOf(raw, pack);
    const slots = entries.reduce((n, e) => n + (e.kind === 'u' ? e.count! : 1), 0);
    if (slots > INVENTORY_SLOTS) throw new Error(`${at}: the package fills ${slots} slots, more than the mule's ${INVENTORY_SLOTS}`);
    const takesBack = plan.give.map(g => `${row.out.find(o => o.name === g.name) ? itemLabel(row.out.find(o => o.name === g.name)!) : g.name} ${g.count === 'all' ? 'all' : `x${g.count}`}`);
    return { row: row.row, line: row.line, step, package: pkg, topUps, slots, takesBack, moduleLines: plan.placeholders };
}

export interface FromLedgerOptions {
    /** The mule's rows (default MULE1_ROWS); the packages come in ledger order whatever this order is. */
    rows?: readonly string[];
    form?: TopUpForm;
    pack?: ObjPack;
}

/** A mule's packages from the ledger in `manifest` (STEP-MANIFEST.md by default), in ledger order. */
export function muleFromLedger(manifest: string = readFileSync(MANIFEST, 'utf8'), o: FromLedgerOptions = {}): LedgerPackage[] {
    const { rows, errors } = parseLedger(manifest);
    if (errors.length) throw new Error(`the inventory ledger does not parse: ${errors.join('; ')}`);
    const wanted = o.rows ?? MULE1_ROWS;
    const out: LedgerPackage[] = [];
    for (const id of wanted) {
        const at = rows.map((r, i) => (r.row === id ? i : -1)).filter(i => i >= 0);
        if (at.length !== 1) throw new Error(at.length ? `${at.length} ledger rows named ${id}` : `no ledger row ${id}`);
        out.push(packageFromRow(rows, at[0]!, o.form ?? 'ask', o.pack));
    }
    return out.sort((a, b) => a.line - b.line);
}

/** The mule options' `packages` for these ledger packages. */
export const packagesOf = (lp: readonly LedgerPackage[]): Package[] => lp.map(p => p.package);

// ------------------------------------------------------------------ drift

const normName = (x: string) => x.toLowerCase().replace(/[\s_]+/g, ' ').trim();

/** One identity per item: an id ref by its item's id (a note's id reads as its item), a name by its name. */
function lineKey(ref: ItemRef, pack?: ObjPack): string {
    return ref.id !== undefined ? `obj ${noteLink(ref.id, pack).item}` : `name ${normName(ref.item)}`;
}

function describe(spec: PackageItem, pack?: ObjPack): string {
    const noted = spec.noted ?? namesNote(spec, pack);
    return `${isTopUp(spec) ? `top-up to ${spec.topUp.max}` : spec.amount === -1 ? 'all held' : `x${spec.amount}`}${noted ? ' noted' : ''}`;
}

/** The packages a config names: mule options ({ packages }), a packages list, or fleet.json's entry for `account`. */
export function configPackages(config: unknown, account = 'cairn_mule1'): unknown[] {
    if (Array.isArray(config)) return config;
    const c = (config ?? {}) as Record<string, unknown>;
    if (Array.isArray(c.accounts)) {
        const entry = (c.accounts as Record<string, unknown>[]).find(a => a.account === account);
        if (!entry) throw new Error(`the fleet config has no entry for ${account}`);
        return configPackages(entry.options ?? {}, account);
    }
    return Array.isArray(c.packages) ? c.packages : [];
}

/**
 * How a mule's configured packages differ from the ledger's; empty when they agree. In order mode
 * every trade takes the next package, so a missing, extra or reordered package is drift too. Each
 * line is compared by identity (obj id, or name), count or top-up max, and noted; a top-up package
 * by its scope.
 */
export function muleDrift(config: unknown, ledger: readonly LedgerPackage[], o: { account?: string; pack?: ObjPack } = {}): string[] {
    const out: string[] = [];
    const pack = o.pack;
    const configured: Package[] = [];
    configPackages(config, o.account).forEach((raw, i) => {
        try {
            configured.push(packageOf(raw, pack));
        } catch (e) {
            out.push(`package ${i}: ${(e as Error).message}`);
        }
    });
    const expected = ledger.map(l => l.package.name);
    const names = configured.map(p => p.name);
    for (const p of configured) if (!expected.includes(p.name)) out.push(`${p.name}: configured, but not one of this mule's ledger rows (${expected.join(', ')})`);
    const common = names.filter(n => expected.includes(n));
    const ledgerOrder = expected.filter(n => names.includes(n));
    if (common.join() !== ledgerOrder.join()) out.push(`order: the packages run ${common.join(', ')}; the ledger's order is ${ledgerOrder.join(', ')}`);
    for (const l of ledger) {
        const want = l.package;
        const got = configured.filter(p => p.name === want.name);
        if (!got.length) {
            out.push(`${l.row}: no package ${want.name}`);
            continue;
        }
        if (got.length > 1) out.push(`${l.row}: ${got.length} packages named ${want.name}`);
        const have = got[0]!;
        const lines = new Map<string, PackageItem[]>();
        for (const s of have.items) lines.set(lineKey(s, pack), [...(lines.get(lineKey(s, pack)) ?? []), s]);
        for (const s of want.items) {
            const k = lineKey(s, pack);
            const mine = lines.get(k);
            lines.delete(k);
            if (!mine) out.push(`${l.row}: ${refLabel(s)} not in the package (the ledger: ${describe(s, pack)})`);
            else if (mine.length > 1) out.push(`${l.row}: ${refLabel(s)} on ${mine.length} lines`);
            else if (describe(mine[0]!, pack) !== describe(s, pack)) out.push(`${l.row}: ${refLabel(s)}: the package ${describe(mine[0]!, pack)}, the ledger ${describe(s, pack)}`);
        }
        for (const extra of lines.values()) for (const s of extra) out.push(`${l.row}: ${refLabel(s)} ${describe(s, pack)} is not in the ledger row`);
        const scope = (p: Package) => (p.scope ? `${p.scope.step}/${p.scope.family}` : 'none');
        if (scope(have) !== scope(want)) out.push(`${l.row}: scope ${scope(have)}, the ledger's ${scope(want)}`);
    }
    return out;
}

// ------------------------------------------------------------------ stock

/** Each package staged against a bank on its own (mule.ts planPackage): what the bank cannot serve. */
export function stockCheck(ledger: readonly LedgerPackage[], bank: BankItem[], pack?: ObjPack): string[] {
    const out: string[] = [];
    for (const l of ledger) {
        const plan = planPackage(l.package, bank, undefined, pack);
        for (const m of plan.missing) out.push(`${l.row}: ${m.item} wanted ${m.wanted}, the bank holds ${m.have}`);
        for (const a of plan.ambiguous) out.push(`${l.row}: ${a.item} matches ids ${a.ids.join(', ')}`);
        for (const t of plan.topUpShort) out.push(`${l.row}: top-up ${t.item} stages ${t.staged} of ${t.max}`);
        if (plan.slots > INVENTORY_SLOTS) out.push(`${l.row}: ${plan.slots} slots`);
    }
    return out;
}

// ------------------------------------------------------------------ CLI

function arg(argv: readonly string[], name: string): string | undefined {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
}

export function main(argv: readonly string[]): number {
    const form = (arg(argv, '--form') ?? 'ask') as TopUpForm;
    if (form !== 'ask' && form !== 'fixed') throw new Error(`--form must be ask or fixed (got ${form})`);
    const rows = arg(argv, '--rows')?.split(',').map(s => s.trim()).filter(Boolean);
    const manifest = readFileSync(arg(argv, '--manifest') ?? MANIFEST, 'utf8');
    const account = arg(argv, '--account') ?? 'cairn_mule1';
    const ledger = muleFromLedger(manifest, { form, ...(rows ? { rows } : {}) });
    const check = arg(argv, '--check');
    const bankFile = arg(argv, '--bank');
    if (check) {
        const drift = muleDrift(JSON.parse(readFileSync(check === '-' ? 0 : check, 'utf8')), ledger, { account });
        console.log(drift.length ? drift.join('\n') : `no drift: ${ledger.map(l => l.row).join(', ')} (${form} form)`);
        return drift.length ? 1 : 0;
    }
    if (bankFile) {
        const stock = JSON.parse(readFileSync(bankFile, 'utf8')) as { accounts?: Record<string, { asOf: string; bank: BankItem[] }> };
        const entry = stock.accounts?.[account];
        if (!entry) throw new Error(`${bankFile} has no bank for ${account}`);
        const short = stockCheck(ledger, entry.bank.map((b, slot) => ({ ...b, slot })));
        console.log(`${account}'s bank as of ${entry.asOf}: ${short.length ? `\n${short.join('\n')}` : 'every package stages in full'}`);
        return short.length ? 1 : 0;
    }
    console.log(JSON.stringify({ packages: packagesOf(ledger) }, null, 2));
    for (const l of ledger) {
        const notes = [`${l.slots} slots`, l.takesBack.length ? `takes back ${l.takesBack.join('; ')}` : 'takes nothing back', ...(l.moduleLines.length ? [`the module's: ${l.moduleLines.join(', ')}`] : [])];
        console.error(`${l.row} (line ${l.line}, before ${l.step}): ${notes.join('; ')}`);
    }
    return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
