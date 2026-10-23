// The role-phase gate: before SCORED logs in (and in --dry-run), every helper the next helper step
// depends on must be ready by its role's own published phase in the cue directory, not merely online.
// The launcher's helpersReady counts a logged-in account as ready whatever its role is doing; in attempt 2
// S07's bone givers were logged in and 'travel' (looping on an unstandable tile), and SCORED went on.
//
// Status files, one per account, each written by its role every 1-2 s (the heartbeat):
//   giver-<acct>.json  altar givers (altar-giver.ts, S06 / S21): ready = phase 'ready' or 'armed', readyAt set
//   bones-<acct>.json  bone givers (bone-giver.ts, S07 standing): ready = phase 'waiting', readyAt set, bones
//                      held, standing on one of its sites' giver tiles. The group rotates oak<->willow, so
//                      at most moments one is walking: a 'travel' giver also passes when it is loaded,
//                      has no bounces and no fault detail, and another of the group is waiting on a site.
//                      Attempt 2's group (all travelling, looping on an unstandable tile) still refuses.
//                      courier (bone-giver.ts on-request, S18): ready = loaded and within 2 tiles of sites[0],
//                      the tile it waits on for the scored account (its idle loop publishes 'travel' there)
//   anvil-<acct>.json  anvil helper (anvil.ts, S25a): ready = phase 'waiting'
// A status older than STALE_MS is stale: its writer is gone or wedged. Only the next helper step on the
// path refuses; every other family on the path is printed as a report line. h45 (H12o) and h92 (the
// cannon) keep no status file on the run machine, and the mule carriers' readiness is the delivery
// owner's: reported, never refused here.
import { join } from 'node:path';
import { canonName, readJson, type CueFamily, type CueScope } from '../helpers/altar-cue';
import { S07_SITES, type Site } from '../helpers/bone-giver';

/** A status older than this (ms since its last write) is stale: the heartbeats are 1-2 s. */
export const STALE_MS = 30_000;

export type StatusKind = 'giver' | 'bones' | 'anvil';

/** The families that publish a role status file, and its file prefix. */
export const STATUS_KIND: Partial<Record<CueFamily, StatusKind>> = { altar: 'giver', bone: 'bones', courier: 'bones', anvil: 'anvil' };

export const statusFileName = (kind: StatusKind, account: string): string => `${kind}-${canonName(account)}.json`;

/** One helper a step depends on: its account, the cue scope it serves, and (bone, courier) its sites. */
export interface PhaseMember {
    account: string;
    scope: CueScope;
    sites?: readonly Site[];
}

/** launcher.json's view of an account: online, or logged out waiting for its login cue. */
export interface LauncherView {
    account: string;
    state: string;
    cue?: { state: string } | null;
}

export interface PhaseLine {
    gate: string;
    ok: boolean;
    detail: string;
}

type Tile = { x: number; z: number };
const at = (t: Tile | null | undefined) => (t ? `(${t.x},${t.z})` : '(no tile)');
const ago = (now: number, ms: number) => `${Math.round((now - ms) / 1000)} s`;

/** The only detail a standing bone giver publishes with 'travel' (bone-giver.ts cycle); any other is a fault's. */
const ROTATING_DETAIL = /^site \d+$/;

/**
 * Whether one status file shows its helper ready for `family`'s step. `raw` is the parsed file
 * (null: none). `someWaiting` (bone only): another member of the group is ready waiting on a site in
 * the same read, which lets a clean 'travel' giver pass. Never throws: a malformed file is not ready.
 */
export function judgeStatus(family: CueFamily, raw: unknown, o: { now: number; sites?: readonly Site[]; someWaiting?: boolean }): { ok: boolean; detail: string } {
    const s = raw as Record<string, unknown> | null;
    if (!s || typeof s !== 'object') return { ok: false, detail: 'no status file' };
    const phase = String(s.phase ?? '?');
    const detail = typeof s.detail === 'string' && s.detail ? ` (${s.detail})` : '';
    const ms = Number(s.ms);
    if (!Number.isFinite(ms)) return { ok: false, detail: `no heartbeat time; phase ${phase}${detail}` };
    if (o.now - ms > STALE_MS) return { ok: false, detail: `stale: last written ${ago(o.now, ms)} ago, phase ${phase}${detail}` };
    const tile = (s.tile ?? null) as Tile | null;
    const readyAt = typeof s.readyAt === 'number' ? s.readyAt : null;
    const held = Number(s.held ?? 0);
    const sites = o.sites ?? S07_SITES;
    switch (family) {
        case 'bone': {
            if (phase === 'travel') {
                const bounces = s.bounces === undefined ? 0 : Number(s.bounces);
                const faulted = typeof s.detail === 'string' && !!s.detail && !ROTATING_DETAIL.test(s.detail);
                const why = !(held > 0) ? 'travel with no bones held' : bounces !== 0 ? `travel with ${String(s.bounces)} bounces, not a clean rotation` : faulted ? 'travel with a fault detail' : !o.someWaiting ? 'phase travel, not waiting, and no other group member waiting on a site' : null;
                return why ? { ok: false, detail: `${why}${detail}` } : { ok: true, detail: `travel at ${at(tile)}, ${held} held, rotating while another group member waits on a site${detail}` };
            }
            const site = tile ? sites.findIndex(x => x.giver.x === tile.x && x.giver.z === tile.z) : -1;
            const why = phase !== 'waiting' ? `phase ${phase}, not waiting` : readyAt === null ? 'waiting but readyAt is null' : !(held > 0) ? 'waiting with no bones held' : site < 0 ? `waiting at ${at(tile)}, not on a site's giver tile (${sites.map(x => at(x.giver)).join(', ')})` : null;
            return why ? { ok: false, detail: `${why}${detail}` } : { ok: true, detail: `waiting on site ${site} ${at(tile)}, ${held} held, ready ${ago(o.now, readyAt!)}` };
        }
        case 'courier': {
            const wait = sites[0]?.giver;
            const near = !!tile && !!wait && Math.max(Math.abs(tile.x - wait.x), Math.abs(tile.z - wait.z)) <= 2;
            const why = phase === 'fault' || phase === 'off' || phase === 'start' || phase === 'restock' ? `phase ${phase}` : !(held > 0) ? 'no bones held' : !near ? `at ${at(tile)}, not within 2 of its waiting tile ${at(wait)}` : null;
            return why ? { ok: false, detail: `${why}${detail}` } : { ok: true, detail: `phase ${phase} at ${at(tile)} by its waiting tile, ${held} held` };
        }
        case 'altar': {
            const why = phase !== 'ready' && phase !== 'armed' ? `phase ${phase}, not ready` : readyAt === null ? `${phase} but readyAt is null` : null;
            return why ? { ok: false, detail: `${why}${detail}` } : { ok: true, detail: `${phase} at ${at(tile)}, ready ${ago(o.now, readyAt!)}` };
        }
        case 'anvil':
            return phase === 'waiting' ? { ok: true, detail: `waiting at ${at(tile)}${detail}` } : { ok: false, detail: `phase ${phase}, not waiting${detail}` };
        default:
            return { ok: false, detail: `family ${family} keeps no role status file` };
    }
}

/** The chain step ids whose helpers publish a status file, and the family each step's helpers serve. */
export const PHASE_STEPS: Readonly<Record<string, CueFamily>> = { S06: 'altar', S07: 'bone', S18: 'courier', S21: 'altar', S25a: 'anvil' };

/**
 * The helpers each step depends on, from the launcher config's entries (each role's `options.scope`,
 * and a bone giver's `options.sites`). Entries whose family keeps no status file are left out.
 */
export function membersFromLauncher(raw: unknown): PhaseMember[] {
    const accounts = (raw as { accounts?: unknown })?.accounts;
    if (!Array.isArray(accounts)) return [];
    const out: PhaseMember[] = [];
    for (const a of accounts as Array<Record<string, unknown>>) {
        const opts = (a?.options ?? {}) as Record<string, unknown>;
        const scope = opts.scope as CueScope | undefined;
        if (typeof a?.account !== 'string' || !scope || typeof scope.step !== 'string' || !STATUS_KIND[scope.family]) continue;
        const sites = Array.isArray(opts.sites) ? (opts.sites as Site[]) : undefined;
        out.push({ account: a.account, scope: { step: scope.step, family: scope.family }, ...(sites ? { sites } : {}) });
    }
    return out;
}

export interface PhaseGateInput {
    /** The chain's step ids from the step the run starts at (its --from, else the first). */
    path: readonly string[];
    members: readonly PhaseMember[];
    /** Parsed status file by file name in the cue dir, null when absent or unreadable. */
    read(file: string): unknown;
    /** launcher.json's accounts (null: no launcher status). */
    launcher: readonly LauncherView[] | null;
    now: number;
    /** Where `members` came from, for the operator. */
    source: string;
}

/**
 * One gate line per status file of every phase family on the path, and the report-only lines. Only the
 * next helper step's lines can refuse.
 */
export function phaseGates(i: PhaseGateInput): PhaseLine[] {
    const out: PhaseLine[] = [];
    const steps = [...new Set(i.path.filter(id => PHASE_STEPS[id]))];
    const next = steps[0];
    for (const step of steps) {
        const family = PHASE_STEPS[step]!;
        const kind = STATUS_KIND[family]!;
        const gated = step === next;
        const members = i.members.filter(m => m.scope.step === step && m.scope.family === family);
        const name = `role phase ${step}/${family}`;
        if (!members.length) {
            out.push({ gate: name, ok: !gated, detail: `no helper serves ${step}/${family} in ${i.source}${gated ? '' : ' (reported: not the next helper step)'}` });
            continue;
        }
        // Each member's file read once; a bone group is judged together, since a travelling giver passes
        // only when another member (one judged alone, so waiting on a site) is ready in this same read.
        const read = members.map(m => {
            const file = statusFileName(kind, m.account);
            const l = i.launcher?.find(a => canonName(a.account) === canonName(m.account));
            const awaiting = !!l && l.state !== 'online' && l.cue?.state === 'waiting';
            const opts = { now: i.now, ...(m.sites ? { sites: m.sites } : {}) };
            return { m, file, awaiting, raw: awaiting ? null : i.read(file), opts };
        });
        const waiting = read.map(r => family === 'bone' && !r.awaiting && judgeStatus('bone', r.raw, r.opts).ok);
        read.forEach(({ m, file, awaiting, raw, opts }, k) => {
            const someWaiting = family === 'bone' ? { someWaiting: waiting.some((w, other) => w && other !== k) } : {};
            const j = awaiting ? { ok: true, detail: 'logged out until its login cue opens (launcher.json): its phase is read at its login' } : judgeStatus(family, raw, { ...opts, ...someWaiting });
            out.push({ gate: `${name} ${m.account}`, ok: gated ? j.ok : true, detail: `${file}: ${j.detail}${gated ? '' : j.ok ? ' (reported)' : ' (reported: not the next helper step, not refused)'}` });
        });
    }
    if (i.path.includes('S15')) out.push({ gate: 'role phase H12o h45', ok: true, detail: 'no status file on the run machine: reported, not gated (RUN-HOST step 0 parks it)' });
    if (i.path.some(id => id === 'H11' || id === 'H23')) out.push({ gate: 'role phase cannon h92', ok: true, detail: 'no status file on the run machine: reported, not gated (the cannon serve gate checks its options)' });
    return out;
}

/** The host side: status files read from `cueDir`. */
export const readStatusFile = (cueDir: string) => (file: string): unknown => readJson<unknown>(join(cueDir, file));
