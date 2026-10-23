#!/usr/bin/env bun
// The seam check of the lab dress rehearsal's chunks (cairn://p/rs/393, main's ruling): a chunk starts a
// fresh lab account at its boundary (lab/boundary.ts boundaryAt, staged by applyBoundary), so the
// chunks join only if the previous chunk's MEASURED end equals what boundaryAt stages for the next.
// For each seam this reads the previous chunk's `(chunk end)` row (written here, by watchChunkEnd,
// when the dress rehearsal's chain stops) and diffs it against boundaryAt(next): skill levels and xp,
// pack and worn stacks by obj id and count, the quest tab's statuses and quest points, the bank
// where the row saw it, and the tile. Every difference matches an ALLOWANCES entry or fails with the
// field, both values and the source of the staged one. A log without a chunk-end row fails: a seam
// never passes for want of evidence.
//
//   bun speedrun/lab/seam-check.ts [--config=<lab run config>] [--staff-steps=<id>,...] <prev chunk log.jsonl> <next Sxx> [<log> <Sxx> ...]
//
// One `RESULT seam <prev>-><next> {json}` line per seam, ok or not. Exit 0 every seam joins, 1 one
// does not, 2 usage. --config and --staff-steps build the chain as the dress rehearsal did (its
// labChain and staffJumps); without --config every placed row is staff-supplied, which moves no
// boundary.

import { readFileSync } from 'fs';
import { join } from 'path';
import type { BotWorldState, QuestStatus } from '../../sdk/types';
import { QUESTS, type QuestKey } from '../data/quest-stages';
import { annotation } from '../lib/attempt';
import { matchesItem } from '../lib/items';
import { objPack } from '../lib/obj-pack';
import { isComplete, questPoints, questStatus } from '../lib/quests';
import { parseLog, type TickLog, type TickRow } from '../lib/ticks';
import { levelForXp, xpForLevel } from '../lib/xp';
import type { ChainStep } from '../runner/chain';
import { STAND_IN_STEP } from '../runner/run-report';
import { SKILLS, type Boundary, type StagedItem } from './boundary';
import { standInFor } from './stand-ins';

export const CHUNK_END_STEP = '(chunk end)';

export interface Stack {
    id: number;
    name: string;
    count: number;
}

/** The `(chunk end)` row's meta: the account as the chain left it, every field read from published state. */
export interface ChunkEnd {
    /** The last chain step a step row was written for (its chain index, id, name, and whether it returned). */
    lastStep: { index: number; id: string; name: string; ok: boolean } | null;
    /** The dress rehearsal's exit code once the chain stopped (0: the slice ran). */
    code: number;
    tick: number;
    /** Base level and game xp per skill, as the stats tab publishes them. */
    skills: { name: string; level: number; xp: number }[];
    inventory: Stack[];
    equipment: Stack[];
    /** False when the client published no quest tab (an older client): no status below is evidence. */
    questTab: boolean;
    /** Every quest's tab status (lib/quests questStatus); null for one off the tab (Mage Arena). */
    quests: { key: QuestKey; status: QuestStatus | null }[];
    questPoints: number | null;
    /** The last listing seen while the bank was open (it changes only while open), or null: never opened. */
    bank: { tick: number; items: Stack[] } | null;
    tile: { x: number; z: number; level: number } | null;
}

const stacks = (list: readonly { id: number; name: string; count: number }[]): Stack[] => list.map(i => ({ id: i.id, name: i.name, count: i.count }));

/** The last chain step the log has a step row for, walking the rows in order so a repeated name resolves forward. */
export function lastStepReached(rows: readonly TickRow[], chain: readonly ChainStep[]): ChunkEnd['lastStep'] {
    let at = -1;
    let ok = false;
    for (const r of rows) {
        if (r.kind) continue;
        let i = chain.findIndex((s, j) => j >= Math.max(at, 0) && s.name === r.step);
        if (i < 0) i = chain.findIndex(s => s.name === r.step);
        if (i < 0) continue;
        at = i;
        ok = r.ok;
    }
    return at < 0 ? null : { index: at, id: chain[at]!.id, name: chain[at]!.name, ok };
}

export function chunkEndMeta(s: BotWorldState, o: { lastStep: ChunkEnd['lastStep']; code: number; bank: ChunkEnd['bank'] }): ChunkEnd {
    const p = s.player;
    return {
        lastStep: o.lastStep,
        code: o.code,
        tick: s.tick,
        skills: s.skills.map(k => ({ name: k.name.toLowerCase(), level: k.baseLevel, xp: k.experience })),
        inventory: stacks(s.inventory),
        equipment: stacks(s.equipment),
        questTab: !!s.quests,
        quests: (Object.keys(QUESTS) as QuestKey[]).map(key => ({ key, status: questStatus(s, key) })),
        questPoints: questPoints(s),
        bank: o.bank,
        tile: p ? { x: p.worldX, z: p.worldZ, level: p.level } : null,
    };
}

export interface ChunkEndWatch {
    /** Stop watching and append the `(chunk end)` row (once). */
    close(code: number): void;
}

type Watched = { sdk: { onStateUpdate(f: (s: BotWorldState) => void): () => void }; name: string; sessionId: number };

/**
 * Watch `session` from before the chain runs; `close` writes the `(chunk end)` row from the last
 * in-game frame (the one before the logout), whether the chain finished, failed or threw. With no
 * in-game frame the row is written not ok and without state, so the seam check fails on it.
 */
export function watchChunkEnd(session: Watched, chain: readonly ChainStep[], log: TickLog): ChunkEndWatch {
    let last: BotWorldState | null = null;
    let bank: ChunkEnd['bank'] = null;
    const un = session.sdk.onStateUpdate(s => {
        if (!s.inGame) return;
        last = s;
        if (s.bank?.isOpen) bank = { tick: s.tick, items: stacks(s.bank.items) };
    });
    let closed = false;
    return {
        close(code) {
            if (closed) return;
            closed = true;
            un();
            const lastStep = lastStepReached(log.rows, chain);
            const s = last as BotWorldState | null;
            if (!s) {
                log.append(annotation(log, session.name, 'note', CHUNK_END_STEP, { sessionId: session.sessionId, ok: false, error: 'no in-game frame observed', meta: { lastStep, code } }));
                return;
            }
            log.append(annotation(log, session.name, 'note', CHUNK_END_STEP, { sessionId: session.sessionId, startTick: s.tick, meta: { ...chunkEndMeta(s, { lastStep, code, bank }) } }));
        },
    };
}

// ------------------------------------------------------------------ the seam

/** A level RUN-ORDER gives as `~N`, `N+`, `a/b` or a range (boundary.ts endOf `approx`) may come out this many levels either side. */
export const APPROX_LEVEL_SLACK = 3;
/** Tiles (Chebyshev, same plane) the measured end may stand from the next chunk's first leg start. */
export const TILE_SLACK = 10;

/**
 * The differences a seam may carry, each with why it does not break the join. Anything else fails.
 * Not here, on purpose: a staff-supplied hand-off's items (`supply: staff` gives the ledger's own
 * counts, so a stack that differs after one differs by what the chain did with it, which is the
 * H8-style gap this check exists to catch) and a staff jump's state (staffJumps verifies the jump
 * staged boundaryAt exactly, so a later difference is the chain's).
 */
export const ALLOWANCES = {
    'xp-in-band': "the boundary stages a level (::setstat puts the xp at the level's start) and the run ends mid-level: the measured xp sits inside the staged level's band",
    'approx-level': `RUN-ORDER gives the level as ~N, N+, a/b or a range, staged at its figure (boundary.ts endOf): the measured level within ${APPROX_LEVEL_SLACK} of it`,
    'stand-in': "a field a lab STAND-IN step in the previous chunk set by staff commands (its levels from the account's xp, its gave/take items, its quest and points): the value is the stand-in table's, not the chain's",
    unresolved: 'a stack or the tile boundaryAt lists as unresolved: the docs give no value to stage, so the next chunk starts without it (printed NOT STAGED)',
    'tile-near-start': `the measured tile within ${TILE_SLACK} tiles, same plane, of the next chunk's first leg start: the step before ends anywhere in its area and the leg paths from where the player stands`,
} as const;
export type Allowance = keyof typeof ALLOWANCES;

export interface SeamDiff {
    field: string;
    measured: unknown;
    staged: unknown;
    /** Where the staged value comes from (a doc row, the ledger row, a module). */
    source: string;
    allowance?: Allowance;
    /** The allowance's evidence: the unresolved entry, the stand-in row. */
    why?: string;
}

export interface SeamResult {
    prev: string;
    next: string;
    ok: boolean;
    /** Why the seam could not be compared at all (no chunk-end row, the chunk stopped short). */
    reason?: string;
    failures: SeamDiff[];
    allowed: SeamDiff[];
    /** Fields the row does not carry and nothing stages, so there is nothing to diff. */
    unchecked: string[];
    /** boundaryAt's unresolved list for the next chunk, as printed when it is staged. */
    boundaryUnresolved: string[];
}

/** The chunk a log ran: its `(stage) Sxx` gate, else the dress gate's --from, else S00 (a fresh account from the start). */
export function chunkOf(rows: readonly TickRow[]): string {
    const stage = rows.find(r => r.kind === 'gate' && r.step.startsWith('(stage) '));
    if (stage) return stage.step.slice('(stage) '.length);
    const from = rows.find(r => r.kind === 'gate' && r.step === '(gate) dress rehearsal')?.meta?.from;
    return typeof from === 'string' ? from : 'S00';
}

/** What the previous chunk's STAND-IN steps set, by field. */
interface StandInSet {
    skills: Map<string, string>;
    items: { match: (s: { id: number; name: string }) => boolean; row: string }[];
    quests: Map<QuestKey, string>;
    qp: string | null;
}

function standInSet(rows: readonly TickRow[]): StandInSet {
    const out: StandInSet = { skills: new Map(), items: [], quests: new Map(), qp: null };
    const pack = objPack();
    for (const r of rows) {
        if (r.kind !== 'note' || !r.step.startsWith(STAND_IN_STEP)) continue;
        const si = typeof r.meta?.stepId === 'string' ? standInFor(r.meta.stepId) : undefined;
        // A staff jump (meta.to) verified its staging against boundaryAt: no allowance.
        if (!si) continue;
        const row = r.step;
        for (const skill of Object.keys((r.meta?.levels as Record<string, number> | undefined) ?? {})) out.skills.set(skill, row);
        for (const g of si.give) {
            const id = pack.ids.get(g.obj);
            out.items.push({ row, match: s => s.id === id || pack.names.get(s.id) === g.obj });
        }
        for (const t of [...si.take, ...(si.wear ?? []), ...(si.unwear ?? [])]) out.items.push({ row, match: s => matchesItem(s, t.item) });
        out.quests.set(si.quest, row);
        out.qp = row;
    }
    return out;
}

/** An unresolved entry's item: `name`, `<placeholder>`, with an optional ` @id`, ` xN` or ` (noted)` before the colon. */
export function unresolvedItem(entry: string): { name: string; id?: number } | null {
    const m = /^<?([^<>@:]+?)>?(?: @(\d+))?(?: x\d+)?(?: \(noted\))?:/.exec(entry);
    return m ? { name: m[1]!.trim().toLowerCase(), ...(m[2] ? { id: Number(m[2]) } : {}) } : null;
}

function diffStacks(field: 'pack' | 'worn', measured: readonly Stack[], staged: readonly StagedItem[], b: Boundary, si: StandInSet, out: SeamDiff[]): void {
    const pack = objPack();
    const want = new Map<number, { n: number; item: StagedItem }>();
    for (const i of staged) {
        const id = pack.ids.get(i.obj);
        if (id === undefined) {
            out.push({ field: `${field} ${i.name} (${i.obj})`, measured: null, staged: i.n, source: `${i.source}: ${i.obj} is not in obj.pack` });
            continue;
        }
        const w = want.get(id);
        want.set(id, { n: (w?.n ?? 0) + i.n, item: w?.item ?? i });
    }
    const got = new Map<number, { count: number; name: string }>();
    for (const s of measured) got.set(s.id, { count: (got.get(s.id)?.count ?? 0) + s.count, name: s.name });
    const unresolved = b.unresolved.map(e => ({ e, item: unresolvedItem(e) })).filter(u => u.item);
    for (const id of new Set([...want.keys(), ...got.keys()])) {
        const m = got.get(id)?.count ?? 0;
        const w = want.get(id);
        const n = w?.n ?? 0;
        if (m === n) continue;
        const name = (got.get(id)?.name ?? w!.item.name).toLowerCase();
        const d: SeamDiff = { field: `${field} ${name} (${pack.names.get(id) ?? '?'} @${id})`, measured: m, staged: n, source: w ? w.item.source : `not staged (boundaryAt ${field}, ledger after ${b.ledgerAfter ?? 'no row'})` };
        const u = unresolved.find(x => x.item!.name === name || x.item!.id === id || x.item!.name === w?.item.name.toLowerCase());
        const s = si.items.find(x => x.match({ id, name }));
        if (u) out.push({ ...d, allowance: 'unresolved', why: u.e });
        else if (s) out.push({ ...d, allowance: 'stand-in', why: s.row });
        else out.push(d);
    }
}

const cheb = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/**
 * The seam from the previous chunk's log (`rows`) into the chunk boundaryAt staged as `b`, on `chain`
 * (the chain boundaryAt read `b` from).
 */
export function checkSeam(rows: readonly TickRow[], chain: readonly ChainStep[], b: Boundary, next: string): SeamResult {
    const res: SeamResult = { prev: chunkOf(rows), next, ok: false, failures: [], allowed: [], unchecked: [], boundaryUnresolved: [...b.unresolved] };
    const done = (reason?: string): SeamResult => {
        if (reason) res.reason = reason;
        res.ok = !reason && res.failures.length === 0;
        return res;
    };
    if (b.start <= 0) return done(`${next} starts the chain: there is no seam into it`);
    const row = rows.findLast(r => r.step === CHUNK_END_STEP);
    if (!row) return done(`no ${CHUNK_END_STEP} row in the previous chunk's log: its end state is not measured`);
    const end = row.meta as Partial<ChunkEnd> | undefined;
    if (!row.ok || !end?.skills) return done(`the ${CHUNK_END_STEP} row carries no end state${row.error ? ` (${row.error})` : ''}`);
    const before = chain[b.start - 1]!;
    const ls = end.lastStep ?? null;
    if (!ls || ls.name !== before.name || !ls.ok || end.code !== 0) {
        const at = ls ? `${ls.id} "${ls.name}" (${ls.ok ? 'returned' : 'failed'})` : 'no step';
        return done(`the previous chunk stopped at ${at}, exit ${end.code}; the seam needs ${before.id} "${before.name}" returned and exit 0`);
    }

    const all: SeamDiff[] = [];
    const si = standInSet(rows);

    for (const sk of SKILLS) {
        const st = b.levels[sk];
        const m = end.skills.find(k => k.name === sk);
        if (!m) {
            all.push({ field: `level ${sk}`, measured: null, staged: st.level, source: `${st.source} (the row has no ${sk})` });
            continue;
        }
        if (m.level !== st.level) {
            const d: SeamDiff = { field: `level ${sk}`, measured: m.level, staged: st.level, source: st.source };
            if (si.skills.has(sk)) all.push({ ...d, allowance: 'stand-in', why: si.skills.get(sk)! });
            else if (st.approx && Math.abs(m.level - st.level) <= APPROX_LEVEL_SLACK) all.push({ ...d, allowance: 'approx-level' });
            else all.push(d);
            continue;
        }
        const xp = xpForLevel(st.level);
        if (m.xp === xp) continue;
        const d: SeamDiff = { field: `xp ${sk}`, measured: m.xp, staged: xp, source: `${st.source} (level ${st.level}'s first xp)` };
        all.push(levelForXp(m.xp) === st.level ? { ...d, allowance: 'xp-in-band' } : d);
    }

    if (!end.questTab) all.push({ field: 'quests', measured: 'no quest tab published', staged: b.quests.map(q => `${q.key}=${q.value}`), source: 'boundaryAt quests' });
    else {
        const staged = new Map(b.quests.map(q => [q.key, q]));
        for (const key of Object.keys(QUESTS) as QuestKey[]) {
            const q = staged.get(key);
            const want: QuestStatus = q ? (isComplete(key, q.value) ? 'complete' : 'started') : 'not_started';
            if (!QUESTS[key].questList) {
                if (q) res.unchecked.push(`quest ${key}: off the quest tab, no status published (staged ${q.varp}=${q.value}); its items are compared as stacks`);
                continue;
            }
            const got = end.quests?.find(x => x.key === key)?.status ?? null;
            if (got === want) continue;
            const d: SeamDiff = { field: `quest ${key}`, measured: got, staged: q ? `${want} (${q.varp}=${q.value})` : want, source: q?.source ?? 'boundaryAt: no route step before the seam starts it' };
            all.push(si.quests.has(key) ? { ...d, allowance: 'stand-in', why: si.quests.get(key)! } : d);
        }
    }
    if (end.questPoints !== b.qp) {
        const d: SeamDiff = { field: 'quest points', measured: end.questPoints ?? null, staged: b.qp, source: "boundaryAt: the staged quests' points (data/quest-stages.ts)" };
        all.push(si.qp && end.questPoints !== null ? { ...d, allowance: 'stand-in', why: si.qp } : d);
    }

    diffStacks('pack', end.inventory ?? [], b.inv, b, si, all);
    diffStacks('worn', end.equipment ?? [], b.worn, b, si, all);

    // applyBoundary never touches the bank, and a chunk's account is fresh: the next chunk's bank is empty.
    if (!end.bank) res.unchecked.push('bank: never seen open in the chunk');
    else if (end.bank.items.length) all.push({ field: 'bank', measured: end.bank.items.map(i => `${i.name} @${i.id} x${i.count}`), staged: [], source: `lab/boundary.ts applyBoundary stages no bank (a fresh lab account's is empty); listing from tick ${end.bank.tick}` });

    const tileSource = `runner/legs.ts: ${b.firstId}'s def.start`;
    if (!end.tile) all.push({ field: 'tile', measured: null, staged: b.tile, source: tileSource });
    else if (!b.tile) {
        const u = b.unresolved.find(e => /no start tile/.test(e));
        all.push({ field: 'tile', measured: end.tile, staged: null, source: 'boundaryAt', ...(u ? { allowance: 'unresolved' as const, why: u } : {}) });
    } else {
        const level = b.tile.level ?? 0;
        const dist = cheb(end.tile, b.tile);
        if (end.tile.level !== level || dist > 0) {
            const d: SeamDiff = { field: 'tile', measured: end.tile, staged: { ...b.tile, level }, source: tileSource };
            all.push(end.tile.level === level && dist <= TILE_SLACK ? { ...d, allowance: 'tile-near-start', why: `${dist} tiles off` } : d);
        }
    }

    for (const d of all) (d.allowance ? res.allowed : res.failures).push(d);
    return done();
}

/** `chain` through the last step of chunk `next` (S10: S10a, S10b, ...). */
export function throughChunk(chain: readonly ChainStep[], next: string): ChainStep[] {
    const re = new RegExp(`^${next}[a-z]?$`);
    const last = chain.findLastIndex(s => re.test(s.id));
    if (last < 0) throw new Error(`${next}: no step of that id on the chain`);
    return chain.slice(0, last + 1);
}

export function formatSeam(r: SeamResult): string {
    return `RESULT seam ${r.prev}->${r.next} ${JSON.stringify(r)}`;
}

// ------------------------------------------------------------------ CLI

async function main(argv: string[]): Promise<number> {
    const flags: Record<string, string> = {};
    const pos: string[] = [];
    for (const a of argv) {
        const m = /^--([a-z-]+)=(.*)$/.exec(a);
        if (m) flags[m[1]!] = m[2]!;
        else pos.push(a);
    }
    if (!pos.length || pos.length % 2 || pos.some((p, i) => i % 2 === 1 && !/^S\d\d$/.test(p))) {
        console.error('usage: bun speedrun/lab/seam-check.ts [--config=<lab run config>] [--staff-steps=<id>,...] <prev chunk log.jsonl> <next Sxx> [<log> <Sxx> ...]');
        return 2;
    }
    // Imported here: dress-rehearsal.ts imports this module for its chunk-end hook.
    const { labChain, STAFF } = await import('./dress-rehearsal');
    const { loadRunConfig } = await import('../run');
    const { buildChain, CANNON_ROWS, KIT_PARTNER_ROWS, KIT_SEGMENTS, PLACEMENT } = await import('../runner/chain');
    const { MANIFEST } = await import('../tools/slot-ledger');
    const { ROOT } = await import('../lib/session');
    const { boundaryAt, chunkStart, staffJumps } = await import('./boundary');
    const manifest = readFileSync(MANIFEST, 'utf8');
    const runOrder = readFileSync(join(ROOT, 'docs/speedrun/RUN-ORDER.md'), 'utf8');
    const docs = { runOrder, manifest };
    const raw = flags.config
        ? loadRunConfig(flags.config, join(ROOT, 'run-machine'), process.env, false)
        : { partners: {}, firemakingTiles: '3240,3296', rings: { giver: STAFF }, bones: { giver: STAFF }, courier: { giver: STAFF, below: 3 }, anvil: { giver: STAFF }, cueDir: '/tmp/seam-check' };
    const partners: Record<string, string> = { ...raw.partners };
    for (const row of [...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS]) partners[row] ??= STAFF;
    const served = (rows: readonly string[]) => rows.filter(r => raw.partners[r] && raw.partners[r] !== STAFF);
    const never = () => {
        throw new Error('the seam check never stages');
    };
    const full = buildChain({ ...raw, partners } as never, { cues: { open: async () => {}, stop: () => {} } as never, manifest });
    const staffSteps = (flags['staff-steps'] ?? '').split(/[,\s]+/).filter(Boolean);
    let ok = true;
    for (let i = 0; i < pos.length; i += 2) {
        const [file, next] = [pos[i]!, pos[i + 1]!];
        const rows = parseLog(readFileSync(file, 'utf8'));
        let r: SeamResult;
        try {
            // The chain through the next chunk is all boundaryAt reads, as the dress rehearsal builds it.
            const lab = labChain(throughChunk(full, next), { manifest, stub: null, world: never, cannonServed: served(Object.keys(CANNON_ROWS)), kitServed: served(Object.keys(KIT_SEGMENTS)) });
            const chain = staffJumps(lab.chain, staffSteps.filter(id => lab.chain.some(s => s.id === id)), docs, never).chain;
            r = checkSeam(rows, chain, boundaryAt(chain, chunkStart(chain, next), docs), next);
        } catch (e) {
            r = { prev: chunkOf(rows), next, ok: false, reason: `the lab chain into ${next} does not build: ${e instanceof Error ? e.message : String(e)}`, failures: [], allowed: [], unchecked: [], boundaryUnresolved: [] };
        }
        ok &&= r.ok;
        console.log(formatSeam(r));
    }
    return ok ? 0 : 1;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
