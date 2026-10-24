// The delivery carriers (helpers/mule.ts, the run's mule1, h55 and h03) on the lab engine, launched the
// way the run machine launches them, for lab/dress-rehearsal.ts --carriers:
// - the carriers file is the run-day generator's (docs/speedrun/scripts/carriers-gen.ts): the binding
//   read off docs/speedrun/research/mule-delivery-production.json (each mule-scoped package's row to
//   its production account), the ledger's rows through muleFromLedger (H4m.1-H4m.N ride H4p's carrier
//   while the ledger has the row), muleRunOptionsByAccount with serve = the lab SCORED login, the lab
//   run's mule cue dir and a lab deliveryRun token; only the production account names are replaced,
//   one lab cairn_ name each (CARRIER_ROLES order);
// - each carrier's bank is seeded by ::give with exactly its packages' stock (h4m-carrier.ts's seed,
//   the top-ups at their max), from a session of its own that leaves it logged out at its first
//   package's bank; h55's lab name gets h55's observed profile (h4m-carrier.ts);
// - one standalone.ts launcher runs the three (AGENT_PORT+12, its own run dir, the carriers file as its
//   launch.json, which the run config's delivery.launcherConfig names for run.ts's delivery preflight);
//   with no control file a carrier stages its first package on its own and stands on the row's tile,
//   and it is ready when its status passes readyFor (mule.ts publishes `ready` only through
//   muleCanReady: staged exactly, not travelling, healthy, on the tile), before SCORED logs in.
// The chain's own DeliveryOwner then prepares each row, waits for that readiness and opens the cue.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Subprocess } from 'bun';
import { canonName } from '../helpers/altar-cue';
import { ACCOUNT_NAME_RE, FORBIDDEN_ACCOUNTS } from '../helpers/fleet-config';
import { isTopUp } from '../helpers/mule';
import { muleFromLedger, muleRunOptionsByAccount, type MuleRunOptions } from '../helpers/mule-ledger';
import { readMuleReady, readyFor, type WorldTile } from '../helpers/mule-readiness';
import { depositAll } from '../lib/bank';
import { noteLink, objPack, type ObjPack } from '../lib/obj-pack';
import { closeSession, loadBotEnv, logoutClean, openSession, ROOT, type Session } from '../lib/session';
import { waitUntil } from '../lib/wait';
import { opIndex } from '../lib/world';
import { writeLabBotEnvs } from './altar-launch';
import { spawnLauncher, stopLauncher, waitLauncherReady, type LauncherConfig } from './helper-launch';
import { cheat, clearInventory, leaveTutorial, mustTele, setStats } from './setup';

/** The production carriers whose roles the lab names take, in --carriers order (the binding's accounts). */
export const CARRIER_ROLES = ['cairn_mule1', 'cairn_h55', 'cairn_h03'] as const;
export type CarrierRole = (typeof CARRIER_ROLES)[number];

/** The carriers' launcher gateway: AGENT_PORT + this (altar +5, droppers +6, bones +7, anvil +10, cannon +11). */
export const CARRIER_PORT_OFFSET = 12;

/** The production binding the generator reads. */
export const PRODUCTION_BINDING = join(ROOT, 'docs/speedrun/research/mule-delivery-production.json');

/** h55's observed public profile (h4m-carrier.ts): the role whose lab name gets it. */
export const PROFILES: Readonly<Partial<Record<CarrierRole, Record<string, number>>>> = {
    cairn_h55: { hitpoints: 90, attack: 29, defence: 27, strength: 27, magic: 99 },
};

export interface ProductionBinding {
    /** The ordered rows the production file selects. */
    rows: string[];
    onRequest: string[];
    /** Row to production account (carriers-gen.ts: every mule-scoped package). */
    accounts: Record<string, string>;
}

/** carriers-gen.ts's reading of the production json. */
export function productionBinding(json: unknown): ProductionBinding {
    const p = json as { rows?: unknown; onRequest?: unknown; accounts?: { account?: unknown; options?: { packages?: { scope?: { step?: unknown; family?: unknown } }[] } }[] };
    if (!Array.isArray(p?.rows) || !Array.isArray(p.accounts)) throw new Error('the production binding has no rows or accounts');
    const accounts: Record<string, string> = {};
    for (const a of p.accounts) for (const k of a.options?.packages ?? []) if (k.scope?.family === 'mule' && typeof k.scope.step === 'string' && typeof a.account === 'string') accounts[k.scope.step] = a.account;
    return { rows: (p.rows as string[]).filter(r => accounts[r]), onRequest: Array.isArray(p.onRequest) ? (p.onRequest as string[]) : [], accounts };
}

/** --carriers' names as role to lab name; throws unless one per CARRIER_ROLES entry. */
export function carrierNames(names: readonly string[]): Record<CarrierRole, string> {
    if (names.length !== CARRIER_ROLES.length) throw new Error(`--carriers names ${names.length} carrier(s); it takes ${CARRIER_ROLES.length}, in the order ${CARRIER_ROLES.join(', ')}`);
    return Object.fromEntries(CARRIER_ROLES.map((r, i) => [r, names[i]!])) as Record<CarrierRole, string>;
}

/** The binding with each production account replaced by its lab name; a bound account with no lab name throws. */
export function labBinding(prod: ProductionBinding, names: Readonly<Record<string, string>>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [row, account] of Object.entries(prod.accounts)) {
        const lab = names[account];
        if (!lab) throw new Error(`${row}: the production binding names ${account}, which has no lab carrier`);
        out[row] = lab;
    }
    return out;
}

export interface CarrierEntry {
    account: string;
    role: 'mule';
    cueDir: string;
    options: MuleRunOptions;
}

export interface CarriersFileOptions {
    manifest: string;
    prod: ProductionBinding;
    /** Production account to lab name. */
    names: Readonly<Record<string, string>>;
    /** The cue root whose `mule` folder the carriers read (mule-ledger.ts muleCueDir). */
    cueRoot: string;
    serve: string;
    deliveryRun: string;
    /** The rows the slice trades (default all): the file holds the production rows among them, and their H4m loads. */
    rows?: readonly string[];
    pack?: ObjPack;
}

/** The lab carriers file's entries: carriers-gen.ts's generation under lab names, serve, cue root and token. */
export function labCarriersFile(o: CarriersFileOptions): { accounts: CarrierEntry[] } {
    const within = (r: string) => !o.rows || o.rows.includes(r);
    const rows = o.prod.rows.filter(within);
    const onRequest = o.prod.onRequest.filter(r => o.prod.accounts[r] && within(r));
    if (!rows.length && !onRequest.length) return { accounts: [] };
    const ledger = muleFromLedger(o.manifest, { form: 'ask', rows, onRequest, ...(o.pack ? { pack: o.pack } : {}) });
    const all = labBinding(o.prod, o.names);
    // muleRunOptionsByAccount refuses a binding for an unselected row; H4m's loads ride their anchor's.
    const accounts = Object.fromEntries(ledger.filter(l => l.anchor === undefined).map(l => [l.row, all[l.row]!]));
    const byAccount = muleRunOptionsByAccount(ledger, o.cueRoot, { deliveryRun: o.deliveryRun, serve: o.serve, accounts });
    return { accounts: byAccount.map(p => ({ account: p.account, role: 'mule', cueDir: p.options.cueDir, options: p.options })) };
}

/** Row to lab carrier for every row the binding holds, H4m's loads on H4p's carrier (the run config's partners). */
export function carrierPartners(manifest: string, prod: ProductionBinding, names: Readonly<Record<string, string>>): Record<string, string> {
    const bound = labBinding(prod, names);
    const ledger = muleFromLedger(manifest, { form: 'ask', rows: prod.rows, onRequest: prod.onRequest.filter(r => prod.accounts[r]) });
    return Object.fromEntries(ledger.map(l => [l.row, bound[l.anchor ?? l.row]!]));
}

/** The cue root whose `mule` folder is `muleDir`; throws when the run's mule cue dir is not so named (mule-ledger.ts muleCueDir). */
export function cueRootOf(muleDir: string): string {
    if (basename(muleDir) !== 'mule') throw new Error(`the run's mule cue dir ${muleDir} is not <cue root>/mule, the only folder a generated carrier reads`);
    return dirname(muleDir);
}

/**
 * Every item a carrier's packages offer, by the item's own id (a note's id reads as its item: the bank
 * holds the item), with the count its bank must hold: fixed lines summed, a top-up at its max.
 */
export function carrierStock(options: Pick<MuleRunOptions, 'packages'>, pack: ObjPack = objPack()): Map<number, number> {
    const out = new Map<number, number>();
    for (const p of options.packages) for (const line of p.items) {
        if (line.id === undefined) throw new Error(`${p.name}: the lab seeds lines by id only`);
        const n = isTopUp(line) ? line.topUp.max : line.amount;
        if (!Number.isInteger(n) || n < 1) throw new Error(`${p.name}: obj ${line.id} has no whole count to seed (${n})`);
        const item = noteLink(line.id, pack).item;
        out.set(item, (out.get(item) ?? 0) + n);
    }
    return out;
}

/** Inventory slots a seed give may fill before its deposit. */
const SEED_CHUNK = 24;

/**
 * The staff gives that put `stock` in a bank (each followed by a deposit): an item with a note, more
 * than one, as one noted stack; anything else as itself, an unnoted item over SEED_CHUNK in chunks
 * (an unstackable with no note never fits one inventory).
 */
export function seedGives(stock: ReadonlyMap<number, number>, pack: ObjPack = objPack()): { id: number; obj: string; n: number }[] {
    const out: { id: number; obj: string; n: number }[] = [];
    for (const [id, total] of stock) {
        const link = noteLink(id, pack);
        const item = pack.names.get(link.item)!;
        if (total > 1 && link.note !== null) {
            out.push({ id: link.item, obj: pack.names.get(link.note)!, n: total });
            continue;
        }
        for (let left = total; left > 0; left -= SEED_CHUNK) out.push({ id: link.item, obj: item, n: link.note === null ? left : Math.min(left, SEED_CHUNK) });
    }
    return out;
}

const carried = (s: Session) => s.sdk.getInventory().reduce((n, i) => n + i.count, 0);

/** A lab account's own client, logged in for staging and out again where it was left (a launcher logs it in after). */
export async function stageLabAccount(o: { account: string; botsDir: string; agentPort: number }, stage: (s: Session) => Promise<void>): Promise<void> {
    const env = { ...loadBotEnv(o.account, o.botsDir), GATEWAY_URL: `ws://localhost:${o.agentPort}` };
    const s = await openSession(o.account, { env, launch: true });
    try {
        await leaveTutorial(s);
        await stage(s);
        const out = await logoutClean(s);
        if (!out.ok) throw new Error(`${o.account}: staging logout: ${out.reason}`);
    } finally {
        await closeSession(s);
    }
}

/** Seed a carrier: its profile, its bank at its first package's bank with exactly `carrierStock`, left standing there. */
export async function seedCarrier(s: Session, options: Pick<MuleRunOptions, 'packages'>, o: { profile?: Record<string, number>; pack?: ObjPack } = {}): Promise<{ bank: { id: number; count: number }[] }> {
    const pack = o.pack ?? objPack();
    await clearInventory(s.sdk);
    if (o.profile) {
        // h55's public profile only: its stats and a staff of air (h4m-carrier.ts).
        await setStats(s.sdk, o.profile);
        await cheat(s.sdk, 'give staff_of_air 1');
        if (!(await waitUntil(s.sdk, st => st.inventory.some(i => i.id === 1381), { maxTicks: 15 })).ok) throw new Error('staff fixture missing');
        const staff = s.sdk.getInventory().find(i => i.id === 1381)!;
        await s.sdk.sendUseItem(staff.slot, opIndex(staff, /^wield$/i) ?? 2);
        if (!(await waitUntil(s.sdk, st => st.equipment.some(i => i.id === 1381), { maxTicks: 8 })).ok) throw new Error('staff fixture equip failed');
    }
    const first = options.packages[0]!;
    await mustTele(s.sdk, first.bank.x, first.bank.z, first.bank.level);
    if (!(await s.bot.openBank()).success) throw new Error('carrier bank unavailable');
    const stock = carrierStock(options, pack);
    for (const g of seedGives(stock, pack)) {
        const before = carried(s);
        await cheat(s.sdk, `give ${g.obj} ${g.n}`);
        if (!(await waitUntil(s.sdk, st => st.inventory.reduce((n, i) => n + i.count, 0) === before + g.n, { maxTicks: 15 })).ok) throw new Error(`seed give failed: ${g.obj} x${g.n}`);
        if (!(await depositAll(s.sdk)).ok) throw new Error(`seed deposit failed: ${g.obj}`);
    }
    const bank = s.sdk.getBankItems().map(i => ({ id: i.id, count: i.count }));
    const short = [...stock].filter(([id, n]) => (bank.find(b => b.id === id)?.count ?? 0) < n).map(([id, n]) => `${id} x${n}`);
    await s.bot.closeBank();
    if (short.length) throw new Error(`the seeded bank is short of ${short.join(', ')}`);
    return { bank };
}

/** Each carrier's first package: the row it stages on its own and the tile it stands on. */
export function firstRows(entries: readonly CarrierEntry[]): Record<string, { row: string; at: WorldTile }> {
    return Object.fromEntries(entries.map(e => {
        const p = e.options.packages.find(k => !k.onRequest) ?? e.options.packages[0]!;
        return [e.account, { row: p.scope!.step, at: p.at }];
    }));
}

/** A carrier is ready once its status in the mule cue dir passes readyFor for its first row, SCORED and this run's token. */
export function carrierReady(dir: string, o: { serve: string; deliveryRun: string; first: Readonly<Record<string, { row: string; at: WorldTile }>> }): (account: string, now: number) => boolean {
    return (account, now) => {
        const f = o.first[account];
        return !!f && readyFor(readMuleReady(dir, account), { runId: o.deliveryRun, account, row: f.row, receiver: o.serve, at: f.at }, now);
    };
}

/** The carriers' launcher config (standalone.ts parseLaunchConfig input): the carriers file's entries, no `final`. */
export function carrierLaunch(o: { entries: readonly CarrierEntry[]; botsDir: string; runDir: string; gatewayPort: number }): Omit<LauncherConfig, 'accounts'> & { accounts: CarrierEntry[] } {
    return { gatewayPort: o.gatewayPort, botsDir: o.botsDir, runDir: o.runDir, loginSpacingMs: 2000, accounts: o.entries.map(e => ({ ...e })) };
}

/**
 * Why the slice's carrier rows cannot meet real carriers ([] when they can, or when --carriers names
 * none: those rows are then the stub giver's or staff-supplied, as before): one lab cairn_ name per
 * CARRIER_ROLES entry, distinct, none on LAB_HELPERS or named by another family's flag.
 */
export function carrierGaps(g: { carriers?: readonly string[]; labHelpers?: readonly string[]; others?: Readonly<Record<string, readonly string[]>> }): string[] {
    const c = g.carriers ?? [];
    if (!c.length) return [];
    const out: string[] = [];
    if (c.length !== CARRIER_ROLES.length) out.push(`--carriers names ${c.length} carrier(s); name ${CARRIER_ROLES.length}, the lab ${CARRIER_ROLES.join(', ')} in that order`);
    if (new Set(c.map(canonName)).size !== c.length) out.push(`--carriers names a carrier twice (${c.join(', ')})`);
    for (const n of c) {
        if (!ACCOUNT_NAME_RE.test(n) || FORBIDDEN_ACCOUNTS.has(n) || (CARRIER_ROLES as readonly string[]).includes(canonName(n))) out.push(`--carriers ${n} is not a lab cairn_ helper name standalone.ts launches (never the production carrier's own)`);
        if (g.labHelpers?.includes(n)) out.push(`--carriers ${n} is on LAB_HELPERS, so lab.sh has it logged in already; standalone.ts logs the carriers in itself`);
        for (const [flag, names] of Object.entries(g.others ?? {})) if (names.includes(n)) out.push(`--carriers ${n} is also named by ${flag}`);
    }
    return out;
}

/**
 * Stage each carrier (bank seeded, left at its first bank), start the launcher on `config` (written
 * to <base>/launch.json, the run config's delivery.launcherConfig) and wait until each carrier stands
 * ready on its first row. `onSpawn` gets the launcher at once, so the caller stops it whatever happens.
 */
export async function launchCarriers(
    o: { root: string; base: string; config: ReturnType<typeof carrierLaunch>; roles: Readonly<Record<string, CarrierRole>>; muleDir: string; serve: string; deliveryRun: string; agentPort: number; timeoutMs?: number; log?: (line: string) => void },
    onSpawn: (launcher: Subprocess) => void,
): Promise<{ secs: number }> {
    const pack = objPack();
    for (const e of o.config.accounts) {
        const profile = PROFILES[o.roles[e.account]!];
        await stageLabAccount({ account: e.account, botsDir: o.config.botsDir, agentPort: o.agentPort }, async s => {
            const r = await seedCarrier(s, e.options, { pack, ...(profile ? { profile } : {}) });
            o.log?.(`${e.account} (${o.roles[e.account]}): bank seeded with ${r.bank.length} stacks for ${e.options.packages.map(p => p.scope!.step).join(', ')}`);
        });
    }
    const launcher = spawnLauncher({ root: o.root, base: o.base, config: o.config, cueDir: dirname(o.muleDir) });
    onSpawn(launcher);
    const first = firstRows(o.config.accounts);
    const secs = await waitLauncherReady(launcher, { runDir: o.config.runDir, accounts: o.config.accounts.map(e => e.account), ready: carrierReady(o.muleDir, { serve: o.serve, deliveryRun: o.deliveryRun, first }), what: 'carriers', timeoutMs: o.timeoutMs ?? 600_000 });
    return { secs };
}

/** A fresh base for the carriers' launch: bots/ (each a fresh lab bot.env) and run/. */
export function carrierBase(accounts: readonly string[], server: string): { base: string; botsDir: string; runDir: string } {
    const base = mkdtempSync(join(tmpdir(), 'dress-carriers-'));
    const botsDir = join(base, 'bots');
    writeLabBotEnvs(botsDir, accounts, server);
    return { base, botsDir, runDir: join(base, 'run') };
}

/** Stop the carriers' launcher (SIGINT: each role stops and its account logs out). */
export const stopCarriers = (launcher: Subprocess): Promise<void> => stopLauncher(launcher);
