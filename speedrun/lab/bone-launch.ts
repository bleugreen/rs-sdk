// S07's bone givers (helpers/bone-giver.ts) on the lab engine, as the run machine runs them (RUN-HOST.md
// "The S07 bone givers", SUPPLIES.md H4.1-H4.n): four cairn_ accounts taking turns as one group,
// started by the run-machine launcher (helpers/standalone.ts) on its default relay path, scoped to the
// {S07, bone} cue woodcutting.ts writes, every one logged in and loaded before SCORED logs in. Restock
// is by ::give, the lab's stand-in for their Falador west banks, so every load is dragon bones. The
// last named carries T07-08's Camelot runes on every trip and serves the group's last load beside
// 21 bones (bone-giver.ts finalExtras, finalN). The run config's `bones` names the same group with
// that last load (withBoneGivers), so woodcutting.ts takes each load from the group's server and
// both sides agree on the count and the runes. lab/dress-rehearsal.ts (--bone-givers) launches them.
//
// standalone.ts starts its own loopback gateway and a client per giver, so a giver is never a lab.sh
// LAB_HELPERS account (that one is already logged in, and its bot.env names lab.sh's gateway).

import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { canonName, STATUS_FRESH_MS } from '../helpers/altar-cue';
import { readBoneStatuses, type Extra } from '../helpers/bone-giver';
import { ACCOUNT_NAME_RE, FORBIDDEN_ACCOUNTS } from '../helpers/fleet-config';
import type { ChainStep } from '../runner/chain';
import { STAND_IN_STEP } from '../runner/run-report';
import { BONE_LOAD, S07_BONE_CUE, type BonesOptions } from '../skills/woodcutting';
import { writeLabBotEnvs } from './altar-launch';
import { spawnLauncher, stopLauncher, waitLauncherReady } from './helper-launch';

/** The bone givers' loopback gateway above lab.sh's AGENT_PORT (the altar givers' launcher takes +5, S03's droppers' +6). */
export const BONE_GATEWAY_OFFSET = 7;

/** S07's rotation (SUPPLIES.md H4.1-H4.n, cairn_b01-b04): four keep up with one load per ~70 ticks, three would not. */
export const S07_BONE_GIVERS = 4;

/**
 * The group's loads (every giver's `trades`): SUPPLIES.md's n with every line held, all 555 dragon
 * bones to Prayer 99 in 25 loads (24 of 23 and the last of 21). The lab's ::give restock makes every
 * load dragon bones, so that is the lab's case. Fewer than S07 would take is safe (once the runes
 * load is in, the module asks for no other); more would leave the runes undelivered at S07's end.
 */
export const S07_LAB_LOADS = 25;

/** T07-08's Camelot runes, on the last load (woodcutting.ts CAMELOT_RUNES); `obj` is the staff give. */
export const S07_FINAL_EXTRAS: readonly Extra[] = [
    { item: 'Law rune', count: 1, obj: 'lawrune' },
    { item: 'Air rune', count: 5, obj: 'airrune' },
];

/** The last load's bones: the same free slots as every load, two of them the rune stacks (bone-giver.ts finalN's default). */
export const S07_LAST_LOAD = BONE_LOAD - S07_FINAL_EXTRAS.length;

export interface BoneLaunchOptions {
    /** The group, in login order; the last carries the runes and serves the last load. */
    givers: readonly string[];
    /** The group's loads (default S07_LAB_LOADS). */
    loads?: number;
    botsDir: string;
    /** launcher.json, logs/ and role-state/: a directory of this launch's own, never run-machine/ (the altar givers' launcher.json). */
    runDir: string;
    /** The launcher's loopback gateway. */
    gatewayPort: number;
}

export interface BoneLaunchEntry {
    account: string;
    role: 'bone-giver';
    options: { restock: { kind: 'cheat' }; scope: typeof S07_BONE_CUE; group: string[]; trades: number; finalExtras?: Extra[] };
}

/** standalone.ts's config file (its parseLaunchConfig input) for S07's givers. The sites are bone-giver.ts's own (S07_SITES, the Taverley stands). */
export function boneGiverLaunch(o: BoneLaunchOptions): { gatewayPort: number; botsDir: string; runDir: string; loginSpacingMs: number; accounts: BoneLaunchEntry[] } {
    if (o.givers.length < 2) throw new Error(`S07's bone givers are a group of at least two (woodcutting.ts bones.group), got ${o.givers.length}`);
    const loads = o.loads ?? S07_LAB_LOADS;
    const last = o.givers.length - 1;
    const accounts: BoneLaunchEntry[] = o.givers.map((account, i) => ({
        account,
        role: 'bone-giver',
        options: { restock: { kind: 'cheat' }, scope: S07_BONE_CUE, group: [...o.givers], trades: loads, ...(i === last ? { finalExtras: S07_FINAL_EXTRAS.map(e => ({ ...e })) } : {}) },
    }));
    return { gatewayPort: o.gatewayPort, botsDir: o.botsDir, runDir: o.runDir, loginSpacingMs: 2000, accounts };
}

/** The run config's `bones` for `givers` (the scored config's shape: the group, and the last load beside the runes). */
export function withBoneGivers(givers: readonly string[]): BonesOptions {
    return { group: [...givers], lastLoad: S07_LAST_LOAD };
}

/** A bone giver is ready once its status (bones-<account>.json in the cue dir) is this launch's, fresh, and shows it loaded at or on its way to a site. */
export function boneGiverReady(cueDir: string, since: number): (account: string, now: number) => boolean {
    return (account, now) => {
        const s = readBoneStatuses(cueDir).find(x => canonName(x.account) === canonName(account));
        return !!s && s.ms >= since && now - s.ms < STATUS_FRESH_MS && s.held > 0 && (s.phase === 'waiting' || s.phase === 'travel');
    };
}

/** The slice runs S07 itself (not a --staff-steps jump past it). */
export function runsS07(steps: readonly (Pick<ChainStep, 'id'> & Partial<Pick<ChainStep, 'name'>>)[]): boolean {
    return steps.some(s => s.id === 'S07' && !s.name?.startsWith(STAND_IN_STEP));
}

/** The step S07's givers stand down after: the last of S07's steps on the chain (its last band, or the axe drop). */
export function lastS07Step<T extends Pick<ChainStep, 'id'>>(chain: readonly T[]): T | undefined {
    for (let i = chain.length - 1; i >= 0; i--) if (chain[i]!.id === 'S07') return chain[i];
    return undefined;
}

/**
 * Why S07 cannot meet its bone givers ([] when it can, or when the slice does not run S07): four
 * named with --bone-givers, distinct cairn_ names standalone.ts launches itself, none of them on
 * LAB_HELPERS or named by another family's flag (`others`: flag to names, e.g. '--ringers').
 */
export function boneGiverGaps(
    steps: readonly (Pick<ChainStep, 'id'> & Partial<Pick<ChainStep, 'name'>>)[],
    g: { boneGivers?: readonly string[]; labHelpers?: readonly string[]; others?: Readonly<Record<string, readonly string[]>> },
): string[] {
    if (!runsS07(steps)) return [];
    const givers = g.boneGivers ?? [];
    if (!givers.length) return [`S07 (woodcutting's bone loads) has no bone givers: name its ${S07_BONE_GIVERS} with --bone-givers=<b1>,<b2>,<b3>,<b4>, cairn_ names not on LAB_HELPERS (standalone.ts logs them in); the last named carries T07-08's Camelot runes`];
    const out: string[] = [];
    if (givers.length !== S07_BONE_GIVERS) out.push(`S07: --bone-givers names ${givers.length} bone giver(s); S07's rotation is ${S07_BONE_GIVERS} (SUPPLIES.md H4.1-H4.n)`);
    if (new Set(givers.map(canonName)).size !== givers.length) out.push(`S07: --bone-givers names a giver twice (${givers.join(', ')})`);
    for (const b of givers) {
        if (!ACCOUNT_NAME_RE.test(b) || FORBIDDEN_ACCOUNTS.has(b)) out.push(`S07: --bone-givers ${b} is not a cairn_ helper name standalone.ts launches`);
        if (g.labHelpers?.includes(b)) out.push(`S07: --bone-givers ${b} is on LAB_HELPERS, so lab.sh has it logged in already; standalone.ts logs the bone givers in itself`);
        for (const [flag, names] of Object.entries(g.others ?? {})) if (names.includes(b)) out.push(`S07: ${b} is named by both ${flag} and --bone-givers`);
    }
    return out;
}

/**
 * Write each giver a fresh lab bot.env, start S07's givers through the run-machine launcher (their
 * own run dir and gateway; `onSpawn` gets the launcher at once, so the caller stops it whatever
 * happens next) and wait until every one is logged in and loaded (boneGiverReady). Throws when the
 * launcher exits first or the wait runs out.
 */
export async function launchBoneGivers(
    o: { root: string; givers: readonly string[]; cueDir: string; server: string; agentPort: number; loads?: number; timeoutMs?: number },
    onSpawn: (launcher: Subprocess) => void,
): Promise<{ secs: number; base: string }> {
    const base = mkdtempSync(join(tmpdir(), 'dress-bones-'));
    const botsDir = join(base, 'bots');
    const runDir = join(base, 'run');
    mkdirSync(runDir, { recursive: true, mode: 0o700 });
    writeLabBotEnvs(botsDir, o.givers, o.server);
    const config = boneGiverLaunch({ givers: o.givers, ...(o.loads !== undefined ? { loads: o.loads } : {}), botsDir, runDir, gatewayPort: o.agentPort + BONE_GATEWAY_OFFSET });
    const since = Date.now();
    const launcher = spawnLauncher({ root: o.root, base, config, cueDir: o.cueDir });
    onSpawn(launcher);
    const secs = await waitLauncherReady(launcher, { runDir, accounts: o.givers, ready: boneGiverReady(o.cueDir, since), what: 'bone givers', ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}) });
    return { secs, base };
}

/** Stop the bone givers' launcher (SIGINT: each role stops and its account logs out). */
export const stopBoneGivers = (launcher: Subprocess): Promise<void> => stopLauncher(launcher);
