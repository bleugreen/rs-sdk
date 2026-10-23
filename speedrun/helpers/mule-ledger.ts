// mule-ledger: a trade giver's packages (mule.ts `packages`) built from STEP-MANIFEST.md's inventory
// ledger, the rows SCORED's hand-off steps read (runner/handoff.ts loadHandOff), and the drift check
// between a mule's configured packages and those rows.
//
// The row is the data. Each `in` entry the scored account receives is a line the mule offers: by id
// for `NAME @ID`, else by the game's name; noted for [n]. A top-up (`NAME to N`) is either
// `topUp: { max: N }` (the `ask` form, served from the scored side's top-up ask) or a fixed N (the
// `fixed` form, the fallback while no ask writer is deployed: SCORED drops what it holds of it at
// the tile first, or it declines). Every package is scoped `{ step: <hand-off id>, family: 'mule' }`:
// the key a cue asks for it by (mule.ts packageForCue) and the scope of its top-up ask. The row's `out` entries are what the
// mule takes back in the same trade; the mule accepts any offer from the scored account, so they
// are reported (`takesBack`), not configured. Every row goes through planHandOff first, so a row the
// scored side refuses is refused here too.
//
// The packages come in ledger order, which is the order the run pulls them (mule.ts serveMode
// 'order', the fallback to asking by cue); each also records the step it feeds, the first S row
// after it (H12 before S15).
//
//   bun speedrun/helpers/mule-ledger.ts [--form ask|fixed] [--rows H1,H12] [--on-request H4e] [--manifest PATH] [--cue-root DIR]
//       prints the mule's run-day options { serveMode: 'request', cueDir, packages } (default
//       MULE1_ORDER, then MULE1_ON_REQUEST); cueDir is muleCueDir, <cue root>/mule, the mule's own
//   ... --check FILE [--account cairn_mule1] [--cue-root DIR]   drift of FILE's packages and cue
//       directory (mule options, a packages list, fleet.json or a launcher config) against the
//       ledger; exit 1 on any
//   ... --bank FILE [--account cairn_mule1]    the packages staged back to back against the account's
//       bank in stockpile.json (stockWalk): missing, ambiguous, top-ups short
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type { BankItem } from '../../sdk/types';
import { namesNote, objIdsNamed, refLabel, refMatches, untradeable, type ItemRef } from '../lib/items';
import { noteLink, type ObjPack } from '../lib/obj-pack';
import { gameName, planHandOff } from '../runner/handoff';
import { cueDir } from './altar-cue';
import { itemLabel, MANIFEST, parseLedger, type InEntry, type LedgerRow } from '../tools/slot-ledger';
import { isStackableName, isTopUp, packageOf, planPackage, type Package, type PackageItem } from './mule';

/**
 * cairn_mule1's trades in run order (rs/158's list, 2026-10-22: SUPPLIES.md's trade-giver rows
 * expanded to trades). H14 is S18's load 0 (the swap); H21e's list rides H21d's row, one trade.
 */
export const MULE1_ORDER = ['H1', 'H4', 'H4k', 'H6', 'H4p', 'H7', 'H8', 'H9', 'H10', 'H12', 'H13', 'H14', 'H15', 'H16', 'H18', 'H19', 'H20', 'H21d', 'H22'] as const;

/**
 * cairn_mule1's packages served only when asked for by name (mule.ts onRequest), never in the order:
 * H4e (the bone runes' fallback) and H4m (the bones past S07's capacity, on an overflowing stock).
 * Their rows are in the ledger's fallback table, which is not walked (FALLBACK_TABLE).
 */
export const MULE1_ON_REQUEST = ['H4e', 'H4m'] as const;

/** SUPPLIES.md rows whose giver is the trade giver that have no package of their own on cairn_mule1, and why. */
export const MULE1_NO_PACKAGE: Readonly<Record<string, string>> = {
    H3: 'three ring givers, cairn_h81-h83, one load each (magic.ts RING_CONTRACT; rs/158, fold-in 25)',
    H21e: "one trade with H21d: its list is on H21d's ledger row",
    'H14.1-H14.13': "the S18 courier's top-ups, not mule1's (rs/158)",
    H21a: 'the anvil giver, cairn_a01 (rs/158)',
    'H4m.1-H4m.4': 'the on-request package H4m',
};

/** The heading of the ledger's fallback hand-offs: rows in the ledger's columns that the walk leaves out. */
export const FALLBACK_TABLE = /^(#+\s*|\*\*)?(\d+\.\s*)?Fallback hand-offs\b/i;

export const INVENTORY_SLOTS = 28;

/** How a top-up line is served: from the scored side's ask, or as a fixed `to N`. */
export type TopUpForm = 'ask' | 'fixed';

export interface LedgerPackage {
    row: string;
    /** Served only when asked for by name: a row of the fallback table. */
    onRequest: boolean;
    /** The row's line in the manifest. */
    line: number;
    /** The step the hand-off feeds, the first S row after it; null for a fallback row, which has none. */
    step: string | null;
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
 * One ledger row as a mule package. A walked row's package feeds the step after it; a fallback row
 * (`fallback`) is served on request and has no step, so it cannot carry a top-up (no scope to ask in).
 */
export function packageFromRow(rows: readonly LedgerRow[], index: number, form: TopUpForm = 'ask', pack?: ObjPack, fallback = false): LedgerPackage {
    const row = rows[index]!;
    const at = `${row.row} (line ${row.line})`;
    const plan = planHandOff(row);
    const step = fallback ? null : stepAfter(rows, index);
    const entries = row.in.filter(e => !e.placeholder);
    if (!entries.length) throw new Error(`${at}: the scored account receives nothing from the mule`);
    const items = entries.map(e => lineOf(e, at, form));
    const topUps = entries.filter(e => e.topUp).map(e => ({ item: itemLabel(e), to: e.count! }));
    // The scope keys the package for the cue that asks for it and for its top-up ask: the hand-off id,
    // unique per mule trade where a step id is not (two hand-offs can feed one step).
    const raw = { name: row.row.toLowerCase(), items, scope: { step: row.row, family: 'mule' }, ...(fallback ? { onRequest: true } : {}) };
    const pkg = packageOf(raw, pack);
    const slots = entries.reduce((n, e) => n + (e.kind === 'u' ? e.count! : 1), 0);
    if (slots > INVENTORY_SLOTS) throw new Error(`${at}: the package fills ${slots} slots, more than the mule's ${INVENTORY_SLOTS}`);
    const takesBack = row.out
        .filter(o => !o.placeholder)
        .map(o => ({ label: `${itemLabel(o)} ${o.count === 'all' ? 'all' : `x${o.count}`}`, ref: o.family ? null : refOf(o), count: o.count ?? 'all' }));
    return { row: row.row, onRequest: fallback, line: row.line, step, package: pkg, topUps, slots, takesBack, moduleLines: plan.placeholders };
}

/**
 * The ledger's fallback hand-offs: the first table in the ledger's columns after the FALLBACK_TABLE
 * heading, its rows' lines as in `markdown`. None when the manifest has no such heading.
 */
export function parseFallbacks(markdown: string): LedgerRow[] {
    const lines = markdown.split('\n');
    const at = lines.findIndex(l => FALLBACK_TABLE.test(l.trim()));
    if (at < 0) return [];
    const { rows, errors } = parseLedger(lines.slice(at).join('\n'));
    if (errors.length) throw new Error(`the fallback hand-offs table does not parse: ${errors.join('; ')}`);
    return rows.map(r => ({ ...r, line: r.line + at }));
}

export interface FromLedgerOptions {
    /** The mule's trades in the order it serves them (default MULE1_ORDER); they must be in ledger order. */
    rows?: readonly string[];
    /** Fallback rows served only by name (default the MULE1_ON_REQUEST rows the fallback table has, or none when `rows` is given). */
    onRequest?: readonly string[];
    form?: TopUpForm;
    pack?: ObjPack;
}

function only(rows: readonly LedgerRow[], id: string, where: string): number {
    const at = rows.map((r, i) => (r.row === id ? i : -1)).filter(i => i >= 0);
    if (at.length !== 1) throw new Error(at.length ? `${at.length} ${where} rows named ${id}` : `no ${where} row ${id}`);
    return at[0]!;
}

/**
 * A mule's packages from the ledger in `manifest` (STEP-MANIFEST.md by default): the ordered ones in
 * ledger order (refused when `rows` lists them otherwise, since order mode serves them as listed),
 * then the on-request ones from the fallback table.
 */
export function muleFromLedger(manifest: string = readFileSync(MANIFEST, 'utf8'), o: FromLedgerOptions = {}): LedgerPackage[] {
    const { rows, errors } = parseLedger(manifest);
    if (errors.length) throw new Error(`the inventory ledger does not parse: ${errors.join('; ')}`);
    const form = o.form ?? 'ask';
    const ordered = (o.rows ?? MULE1_ORDER).map(id => packageFromRow(rows, only(rows, id, 'ledger'), form, o.pack));
    const late = ordered.findIndex((p, i) => i > 0 && p.line < ordered[i - 1]!.line);
    if (late >= 0) throw new Error(`${ordered[late]!.row} is listed after ${ordered[late - 1]!.row}, but comes before it in the ledger`);
    const fallbacks = parseFallbacks(manifest);
    const wanted = o.onRequest ?? (o.rows ? [] : MULE1_ON_REQUEST.filter(id => fallbacks.some(r => r.row === id)));
    const onRequest = wanted.map(id => packageFromRow(fallbacks, only(fallbacks, id, 'fallback hand-off'), form, o.pack, true));
    return [...ordered, ...onRequest];
}

/** MULE1_ON_REQUEST rows the fallback table in `manifest` lacks, so no package can be built for them. */
export function onRequestGaps(manifest: string = readFileSync(MANIFEST, 'utf8')): string[] {
    const fallbacks = parseFallbacks(manifest);
    return MULE1_ON_REQUEST.filter(id => !fallbacks.some(r => r.row === id));
}

/** The mule options' `packages` for these ledger packages. */
export const packagesOf = (lp: readonly LedgerPackage[]): Package[] => lp.map(p => p.package);

/** Carried atoll rows use the existing MM cue scopes, without the ledger's hyphen. */
const H45_STOPS = [
    { row: 'H12o-M', step: 'H12oM', at: { x: 2763, z: 2704 } },
    { row: 'H12o-P', step: 'H12oP', at: { x: 2803, z: 2724 } },
] as const;

/**
 * Both atoll legs are arrival-sized asks. P's ledger uses fixed syntax to record caps,
 * not a fixed offer: adapt only these rows, retaining their quantities and line order.
 */
export function h45FromLedger(manifest: string = readFileSync(MANIFEST, 'utf8')): LedgerPackage[] {
    const ledger = muleFromLedger(manifest, { rows: H45_STOPS.map(s => s.row), form: 'ask' });
    const slots = ledger.reduce((n, l) => n + l.slots, 0);
    if (slots > INVENTORY_SLOTS) throw new Error(`h45 packages alone need ${slots} slots; capacity refused`);
    return ledger.map((l, i) => {
        const stop = H45_STOPS[i]!;
        const items = l.package.items.map((spec): PackageItem => {
            if (isTopUp(spec)) return spec;
            const { amount, ...ref } = spec;
            if (amount < 1) throw new Error(`${l.row}: carried cap must be positive`);
            return { ...ref, topUp: { max: amount } };
        });
        return { ...l, package: materializeDeliveryPackage({
            ...l.package, name: stop.step, scope: { step: stop.step, family: 'mule' }, at: stop.at, items,
        }) };
    });
}

/** Sanitized review entry, not staging evidence or authorization to launch an account. */
export function h45LauncherEntry(manifest?: string) {
    const ledger = h45FromLedger(manifest);
    return {
        account: 'cairn_h45', role: 'mule', cueDir: 'run-machine/h45-cue',
        loginOn: ledger[0]!.package.scope!, stopOn: ledger[1]!.package.scope!,
        options: { serve: '<SCORED>', serveMode: 'request', carried: true, packages: packagesOf(ledger) },
    };
}

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
 * by its scope. With `o.cueDir`, the config's cue directory (configCueDir) must be that one.
 */
export function muleDrift(config: unknown, ledger: readonly LedgerPackage[], o: { account?: string; pack?: ObjPack; cueDir?: string } = {}): string[] {
    const out: string[] = [];
    if (o.cueDir !== undefined) {
        const have = configCueDir(config, o.account);
        const bare = (d: string) => d.replace(/\/+$/, '');
        if (have === null || bare(have) !== bare(o.cueDir)) out.push(`cueDir ${have ?? 'none (the shared cue directory)'}, the run's ${o.cueDir}`);
    }
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
    // Order mode serves the packages not marked onRequest, in the order configured.
    const orderedNames = new Set(ledger.filter(l => !l.onRequest).map(l => l.package.name));
    const common = configured.filter(p => !p.onRequest && orderedNames.has(p.name)).map(p => p.name);
    const ledgerOrder = expected.filter(n => orderedNames.has(n) && names.includes(n));
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
        if (!!have.onRequest !== l.onRequest) out.push(`${l.row}: ${l.onRequest ? 'served in order, but only on request in the ledger list' : 'served only on request, but in the order in the ledger list'}`);
    }
    return out;
}

/**
 * The mule's own cue directory: `mule` under the run's cue root (altar-cue.ts cueDir: RC_CUE_DIR, else
 * run-machine/rc-cue). cue.json is one file per directory, so a mule cue in the givers' shared
 * directory would replace theirs (H4e at S07's end, beside the bone givers'); the mule's package cues
 * and top-up asks live here instead (rs/186's ruling). It is set in the mule's config, never derived
 * inside mule.ts: the launcher's cue gate must read the directory the role reads (standalone.ts).
 */
export function muleCueDir(cueRoot: string = cueDir()): string {
    return join(cueRoot, 'mule');
}

/** Resolve against content, never whichever same-named variant happens to be in a bank. */
function deliveryRef(ref: ItemRef, where: string, pack?: ObjPack): ItemRef {
    if (ref.id !== undefined) {
        noteLink(ref.id, pack);
        if (untradeable(ref.id)) throw new Error(`${where}: obj ${ref.id} is untradeable`);
        return { id: ref.id };
    }
    const literal = normName(ref.item).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const candidates = [...new Set(objIdsNamed(new RegExp(`^${literal}$`, 'i'))
        .filter(id => !untradeable(id)).map(id => noteLink(id, pack).item))];
    if (candidates.length !== 1) throw new Error(`${where}: ${ref.item} resolves to ${candidates.length} tradeable object ids (${candidates.join(', ')}); require explicit ledger @ID`);
    return { id: candidates[0]! };
}

/** The one materialization boundary for runtime configuration and bank-stock validation. */
export function materializeDeliveryPackage(pkg: Package, pack?: ObjPack): Package {
    return packageOf({ ...pkg, items: pkg.items.map(({ item, id, ...count }) => ({
        ...deliveryRef(id === undefined ? { item: item! } : { id }, `Package ${pkg.name}`, pack), ...count,
    })) }, pack);
}

/** The mule's run-day options from the ledger, less `serve` (the scored account, from the run host's private config). */
export function muleRunOptions(ledger: readonly LedgerPackage[], cueRoot?: string): { serveMode: 'request'; cueDir: string; packages: Package[] } {
    return { serveMode: 'request', cueDir: muleCueDir(cueRoot), packages: packagesOf(ledger) };
}

/** The cue directory a config gives the account's mule: a launcher entry's own cueDir, else its options'; null for none (the shared default). */
export function configCueDir(config: unknown, account = 'cairn_mule1'): string | null {
    if (Array.isArray(config)) return null;
    const c = (config ?? {}) as Record<string, unknown>;
    if (Array.isArray(c.accounts)) {
        const entry = (c.accounts as Record<string, unknown>[]).find(a => a.account === account);
        if (!entry) throw new Error(`the fleet config has no entry for ${account}`);
        return typeof entry.cueDir === 'string' ? entry.cueDir : configCueDir(entry.options ?? {}, account);
    }
    return typeof c.cueDir === 'string' ? c.cueDir : null;
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
    if (argv.includes('--carried-h45')) {
        const allowed = new Set(['--carried-h45', '--manifest', '--check']);
        for (let i = 0; i < argv.length; i++) {
            const flag = argv[i]!;
            if (!allowed.has(flag)) throw new Error(`--carried-h45 does not accept ${flag}`);
            if (flag !== '--carried-h45' && (!argv[++i] || argv[i]!.startsWith('--'))) throw new Error(`${flag} needs a file`);
        }
        const file = arg(argv, '--manifest');
        const entry = h45LauncherEntry(file ? readFileSync(file, 'utf8') : undefined);
        const check = arg(argv, '--check');
        if (check) {
            const config = JSON.parse(readFileSync(check, 'utf8'));
            const matches = isDeepStrictEqual(config, entry);
            console.log(matches ? 'no drift: carried H12o-M/P' : 'carried H12o-M/P config differs from the generated entry');
            return matches ? 0 : 1;
        }
        console.log(JSON.stringify(entry, null, 2));
        return 0;
    }
    const form = (arg(argv, '--form') ?? 'ask') as TopUpForm;
    if (form !== 'ask' && form !== 'fixed') throw new Error(`--form must be ask or fixed (got ${form})`);
    const list = (name: string) => arg(argv, name)?.split(',').map(s => s.trim()).filter(Boolean);
    const rows = list('--rows');
    const onRequest = list('--on-request');
    const manifest = readFileSync(arg(argv, '--manifest') ?? MANIFEST, 'utf8');
    const account = arg(argv, '--account') ?? 'cairn_mule1';
    const ledger = muleFromLedger(manifest, { form, ...(rows ? { rows } : {}), ...(onRequest ? { onRequest } : {}) });
    const check = arg(argv, '--check');
    const bankFile = arg(argv, '--bank');
    const cueRoot = arg(argv, '--cue-root');
    if (check) {
        const config: unknown = JSON.parse(readFileSync(check === '-' ? 0 : check, 'utf8'));
        // A bare packages list carries no cue directory to compare.
        const drift = muleDrift(config, ledger, { account, ...(Array.isArray(config) ? {} : { cueDir: muleCueDir(cueRoot) }) });
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
    console.log(JSON.stringify(muleRunOptions(ledger, cueRoot), null, 2));
    if (!onRequest && !rows) for (const id of onRequestGaps(manifest)) console.error(`${id}: served on request, but the ledger has no ${id} row, so it has no package`);
    for (const l of ledger) {
        const notes = [`${l.slots} slots`, l.takesBack.length ? `takes back ${l.takesBack.map(b => b.label).join('; ')}` : 'takes nothing back', ...(l.moduleLines.length ? [`the module's: ${l.moduleLines.join(', ')}`] : [])];
        console.error(`${l.row} (line ${l.line}, before ${l.step}): ${notes.join('; ')}`);
    }
    return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
