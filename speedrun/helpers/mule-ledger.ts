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
//   ... --bank FILE [--account cairn_mule1]    the packages staged back to back against the account's
//       bank in stockpile.json (stockWalk): missing, ambiguous, top-ups short
import { readFileSync } from 'node:fs';

import type { BankItem } from '../../sdk/types';
import { namesNote, refLabel, refMatches, type ItemRef } from '../lib/items';
import { noteLink, type ObjPack } from '../lib/obj-pack';
import { gameName, planHandOff } from '../runner/handoff';
import { ENCHANTS, ringTotal, ROUTE_LOADS, TIER_ORDER } from '../skills/magic';
import { itemLabel, MANIFEST, parseLedger, type InEntry, type LedgerRow } from '../tools/slot-ledger';
import { isStackableName, isTopUp, packageOf, planPackage, type Package, type PackageItem } from './mule';

/**
 * cairn_mule1's trades in run order (rs/158's list, 2026-10-22: SUPPLIES.md's trade-giver rows
 * expanded to trades). `H3#n` is H3's ring load n, whose rings are magic.ts ROUTE_LOADS[n-1]: the
 * row names them only as the module's `<gem ring> x20`. H14 is S18's load 0 (the swap); H21e's
 * list rides H21d's row, one trade.
 */
export const MULE1_ORDER = ['H1', 'H3#1', 'H3#2', 'H3#3', 'H4', 'H4k', 'H6', 'H4p', 'H7', 'H8', 'H9', 'H10', 'H12', 'H13', 'H14', 'H15', 'H16', 'H18', 'H19', 'H20', 'H21d', 'H22'] as const;

/** cairn_mule1's packages served only when asked for by name (mule.ts onRequest): H4e, the bone runes' fallback. */
export const MULE1_ON_REQUEST = ['H4e'] as const;

/** SUPPLIES.md rows whose giver is the trade giver that have no package of their own on cairn_mule1, and why. */
export const MULE1_NO_PACKAGE: Readonly<Record<string, string>> = {
    H21e: "one trade with H21d: its list is on H21d's ledger row",
    'H14.1-H14.13': "the S18 courier's top-ups, not mule1's (rs/158)",
    H21a: 'the anvil giver, cairn_a01 (rs/158)',
    'H4m.1-H4m.4': 'bone loads on an overflowing stock only, not in rs/158\'s list (asked)',
};

export const INVENTORY_SLOTS = 28;

/** How a top-up line is served: from the scored side's ask, or as a fixed `to N`. */
export type TopUpForm = 'ask' | 'fixed';

export interface LedgerPackage {
    /** The ledger row, or `H3#n` for one of a row's loads. */
    row: string;
    /** Served only when asked for by name. */
    onRequest: boolean;
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
    /** What the scored account gives back in the same trade; `label` as the ledger writes it, `ref` null for a family. */
    takesBack: { label: string; ref: ItemRef | null; count: number | 'all' }[];
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

/** A ledger ITEM as a package line names it: by id for `NAME @ID`, else by the game's name. */
const refOf = (e: { name: string; id?: number }): ItemRef => (e.id !== undefined ? { id: e.id } : { item: capitalise(gameName(e.name)) });

function lineOf(e: InEntry, at: string, form: TopUpForm): PackageItem {
    if (e.family) throw new Error(`${at}: in ${itemLabel(e)} names any dose; a package line offers one obj, so the row must name it`);
    if (e.count === null) throw new Error(`${at}: in ${itemLabel(e)} x? has no count`);
    const ref = refOf(e);
    // The mule sizes a package by isStackableName; a line it misjudges would make it refuse the
    // package (too many slots) or overfill its inventory.
    if (ref.item !== undefined && e.kind !== 'n' && isStackableName(ref.item) !== (e.kind === 's')) {
        throw new Error(`${at}: in ${itemLabel(e)} is [${e.kind}], but mule.ts isStackableName reads ${ref.item} as ${e.kind === 's' ? 'unstackable' : 'stackable'}`);
    }
    const noted = e.kind === 'n' ? { noted: true } : {};
    if (e.topUp && form === 'ask') return { ...ref, topUp: { max: e.count }, ...noted };
    return { ...ref, amount: e.count, ...noted };
}

/**
 * Load `load` of a ring row (H3): the module's `<gem ring> xN` placeholder made concrete from
 * magic.ts ROUTE_LOADS, whose total must be the row's count. Loads 2 and 3 take the previous load's
 * enchanted rings back in the same trade (the module's swap).
 */
export function ringLoadPackage(rows: readonly LedgerRow[], index: number, load: number, pack?: ObjPack): LedgerPackage {
    const row = rows[index]!;
    const at = `${row.row} load ${load} (line ${row.line})`;
    const ring = row.in.find(e => e.placeholder && /ring/i.test(e.name));
    const rings = ROUTE_LOADS[load - 1];
    if (!ring || ring.count === null || row.in.length !== 1) throw new Error(`${at}: expected the row's only entry to be a <… ring> xN placeholder`);
    if (!rings) throw new Error(`${at}: magic.ts ROUTE_LOADS has ${ROUTE_LOADS.length} loads`);
    if (ringTotal(rings) !== ring.count) throw new Error(`${at}: ROUTE_LOADS[${load - 1}] holds ${ringTotal(rings)} rings, the row ${ring.count}`);
    const items = TIER_ORDER.filter(t => (rings[t] ?? 0) > 0).map(t => ({ item: ENCHANTS[t].ring, amount: rings[t]! }));
    return {
        row: `${row.row}#${load}`,
        onRequest: false,
        line: row.line,
        step: stepAfter(rows, index),
        package: packageOf({ name: `${row.row.toLowerCase()}-${load}`, items }, pack),
        topUps: [],
        slots: ring.count,
        takesBack: [],
        moduleLines: load > 1 ? [`<enchanted ring> x${ringTotal(ROUTE_LOADS[load - 2]!)}`] : [],
    };
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
    const takesBack = row.out
        .filter(o => !o.placeholder)
        .map(o => ({ label: `${itemLabel(o)} ${o.count === 'all' ? 'all' : `x${o.count}`}`, ref: o.family ? null : refOf(o), count: o.count ?? 'all' }));
    return { row: row.row, onRequest: false, line: row.line, step, package: pkg, topUps, slots, takesBack, moduleLines: plan.placeholders };
}

export interface FromLedgerOptions {
    /** The mule's trades (default MULE1_ORDER): row ids, `ROW#n` for a ring load. They must be in ledger order. */
    rows?: readonly string[];
    /** Packages served only by name (default MULE1_ON_REQUEST, or none when `rows` is given). */
    onRequest?: readonly string[];
    form?: TopUpForm;
    pack?: ObjPack;
}

const loadKey = (p: LedgerPackage) => p.line * 100 + Number(p.row.split('#')[1] ?? 0);

/**
 * A mule's packages from the ledger in `manifest` (STEP-MANIFEST.md by default): the ordered ones in
 * ledger order (refused when `rows` lists them otherwise, since order mode serves them as listed),
 * then the on-request ones.
 */
export function muleFromLedger(manifest: string = readFileSync(MANIFEST, 'utf8'), o: FromLedgerOptions = {}): LedgerPackage[] {
    const { rows, errors } = parseLedger(manifest);
    if (errors.length) throw new Error(`the inventory ledger does not parse: ${errors.join('; ')}`);
    const build = (id: string, onRequest: boolean): LedgerPackage => {
        const [rowId, load] = id.split('#') as [string, string | undefined];
        const at = rows.map((r, i) => (r.row === rowId ? i : -1)).filter(i => i >= 0);
        if (at.length !== 1) throw new Error(at.length ? `${at.length} ledger rows named ${rowId}` : `no ledger row ${rowId}`);
        const p = load === undefined ? packageFromRow(rows, at[0]!, o.form ?? 'ask', o.pack) : ringLoadPackage(rows, at[0]!, Number(load), o.pack);
        if (!onRequest) return p;
        return { ...p, onRequest: true, package: { ...p.package, onRequest: true } };
    };
    const ordered = (o.rows ?? MULE1_ORDER).map(id => build(id, false));
    const keys = ordered.map(loadKey);
    const late = ordered.findIndex((p, i) => i > 0 && keys[i]! < keys[i - 1]!);
    if (late >= 0) throw new Error(`${ordered[late]!.row} is listed after ${ordered[late - 1]!.row}, but comes before it in the ledger`);
    const onRequest = (o.onRequest ?? (o.rows ? [] : MULE1_ON_REQUEST)).map(id => build(id, true));
    return [...ordered, ...onRequest];
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

/**
 * The packages served back to back from one bank, in ledger order (mule.ts planPackage per package):
 * what the bank cannot serve when each comes up. Each package's withdrawals leave the bank (a top-up
 * at its max), and what the scored account gives back with a count returns to it, so a later row's
 * `back from H12` line is served from H12's give-back. An `all` give-back has no count and is not
 * credited.
 */
export function stockWalk(ledger: readonly LedgerPackage[], bank: readonly BankItem[], pack?: ObjPack): string[] {
    const out: string[] = [];
    const held: BankItem[] = bank.map(b => ({ ...b }));
    for (const l of ledger) {
        const plan = planPackage(l.package, held.filter(b => b.count > 0), undefined, pack);
        for (const m of plan.missing) out.push(`${l.row}: ${m.item} wanted ${m.wanted}, the bank holds ${m.have}`);
        for (const a of plan.ambiguous) out.push(`${l.row}: ${a.item} matches ids ${a.ids.join(', ')}`);
        for (const t of plan.topUpShort) out.push(`${l.row}: top-up ${t.item} stages ${t.staged} of ${t.max}`);
        if (plan.slots > INVENTORY_SLOTS) out.push(`${l.row}: ${plan.slots} slots, more than ${INVENTORY_SLOTS}`);
        for (const w of plan.withdrawals) w.bankItem.count -= w.amount;
        for (const b of l.takesBack) {
            if (!b.ref || b.count === 'all') continue;
            const ref = b.ref;
            const into = held.find(h => refMatches(ref, h, pack));
            if (into) into.count += b.count;
            else held.push({ slot: held.length, id: ref.id !== undefined ? noteLink(ref.id, pack).item : -1 - held.length, name: ref.item ?? refLabel(ref), count: b.count });
        }
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
        const short = stockWalk(ledger, entry.bank.map((b, slot) => ({ ...b, slot })));
        console.log(`${account}'s bank as of ${entry.asOf}, the packages served back to back: ${short.length ? `\n${short.join('\n')}` : 'every package stages in full'}`);
        return short.length ? 1 : 0;
    }
    console.log(JSON.stringify({ packages: packagesOf(ledger) }, null, 2));
    for (const l of ledger) {
        const notes = [`${l.slots} slots`, l.takesBack.length ? `takes back ${l.takesBack.map(b => b.label).join('; ')}` : 'takes nothing back', ...(l.moduleLines.length ? [`the module's: ${l.moduleLines.join(', ')}`] : [])];
        console.error(`${l.row} (line ${l.line}, before ${l.step}): ${notes.join('; ')}`);
    }
    return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
