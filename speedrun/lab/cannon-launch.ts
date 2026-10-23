// The cannon holder (helpers/cannon.ts serve mode, SUPPLIES.md H23: cairn_h92 on the day) on the lab
// engine for S27's hand-off, launched the way the run machine launches it (the run-machine launcher,
// role `cannon`, `serve` with the {S27, cannon} cue scope), with lab stock: the holder makes the set,
// the balls and the row's extras with staff commands (serve.labStock) and stands on the Ardougne
// landing's helper tile. lab/dress-rehearsal.ts (--cannon-holder) launches it before SCORED logs in,
// names it as H23's partner (so H23 stays SCORED's real cue-served hand-off, runner/handoff.ts
// runHandOffOnCue) and stops it once H23 returns.
//
// The serve is the ledger row SCORED's step wants (helpers/cannon-receiver.ts serveFromLedger), so the
// trade matches it exactly; run.ts checks h92's run-day serve against the same row (serveDrift).
// The holder is a cairn_ name standalone.ts logs in itself (never LAB_HELPERS), its launcher on
// AGENT_PORT+11 with launcher.json, logs/ and role-state/ in a run dir of its own.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import type { CueScope } from '../helpers/altar-cue';
import { serveFromLedger } from '../helpers/cannon-receiver';
import { ACCOUNT_NAME_RE, FORBIDDEN_ACCOUNTS } from '../helpers/fleet-config';
import { CANNON_ROWS } from '../runner/chain';
import { STAND_IN_STEP } from '../runner/run-report';
import { MANIFEST } from '../tools/slot-ledger';
import { writeLabBotEnvs } from './altar-launch';
import { lastRolePhase, spawnLauncher, waitLauncherReady, type LauncherConfig } from './helper-launch';

/** S27's cannon row (runner/chain.ts PLACEMENT: on T26-27 right after the teleport). */
export const HOLDER_ROW = 'H23';
/** Its launcher's loopback gateway: AGENT_PORT + this (anvil +10). */
export const HOLDER_PORT_OFFSET = 11;

type Tile = { x: number; z: number };

/**
 * cannon.ts serve's load for ledger row `row` with lab stock: the balls, and every other `in` of the
 * row as an extra with its staff-give name, a top-up at its full `to` count (a receiver that starts
 * with none of it, as the lab's cannon-receiver does).
 */
export function labServeLoad(row: string, manifest: string = readFileSync(MANIFEST, 'utf8')): { balls: number; extras: { item: string; count: number; obj: string }[]; topUps: string[] } {
    const l = serveFromLedger(row, manifest);
    return { balls: l.balls, extras: [...l.extras, ...l.topUps.map(t => ({ item: t.item, count: t.to, obj: t.obj }))], topUps: l.topUps.map(t => t.item) };
}

export interface HolderLaunchEntry {
    account: string;
    role: 'cannon';
    options: { serve: { tile: Tile; balls: number; extras: { item: string; count: number; obj: string }[]; labStock: true; scope: CueScope } };
}

/**
 * standalone.ts's config for H23's holder on `tile` (the landing helper tile). Throws when the row
 * has a top-up: SCORED wants only what it lacks there, so a fixed lab serve could not match it.
 */
export function cannonHolderLaunch(o: { account: string; tile: Tile; botsDir: string; runDir: string; gatewayPort: number; manifest?: string }): Omit<LauncherConfig, 'accounts'> & { accounts: HolderLaunchEntry[] } {
    const load = labServeLoad(HOLDER_ROW, o.manifest);
    if (load.topUps.length) throw new Error(`${HOLDER_ROW} tops up ${load.topUps.join(', ')}: a fixed lab serve cannot match what SCORED lacks there`);
    return {
        gatewayPort: o.gatewayPort,
        botsDir: o.botsDir,
        runDir: o.runDir,
        loginSpacingMs: 2000,
        accounts: [{ account: o.account, role: 'cannon', options: { serve: { tile: { ...o.tile }, balls: load.balls, extras: load.extras, labStock: true, scope: { ...CANNON_ROWS[HOLDER_ROW]! } } } }]
    };
}

/** The holder carries the load on its tile, waiting for the receiver its cue names (cannon.ts's serve-waiting phase, or later). */
export function holderReady(runDir: string): (account: string) => boolean {
    return account => ['serve-waiting', 'serve-requested', 'serve-trading'].includes(lastRolePhase(runDir, account) ?? '');
}

/** The slice runs H23's hand-off itself (not --staff-steps' STAND-IN jump past it). */
export function runsH23(steps: readonly { id: string; name?: string }[]): boolean {
    return steps.some(s => s.id === HOLDER_ROW && !(s.name ?? '').startsWith(STAND_IN_STEP));
}

/**
 * Why H23 cannot meet its holder in `steps` ([] when it can, or when the slice does not run H23):
 * --cannon-holder names one cairn_ helper standalone.ts logs in itself (not on LAB_HELPERS, and none
 * of the other givers).
 */
export function cannonHolderGaps(steps: readonly { id: string; name?: string }[], g: { cannonHolder?: string; labHelpers?: readonly string[]; others?: readonly string[] }): string[] {
    if (!runsH23(steps)) return [];
    const h = g.cannonHolder;
    if (!h) return ['H23 (S27\'s cannon hand-off) has no cannon holder: name one with --cannon-holder=<cairn_ name>, not on LAB_HELPERS (standalone.ts logs it in), or jump the hand-off with --staff-steps=H23'];
    const out: string[] = [];
    if (!ACCOUNT_NAME_RE.test(h) || FORBIDDEN_ACCOUNTS.has(h)) out.push(`H23: --cannon-holder ${h} is not a cairn_ helper name standalone.ts launches`);
    if (g.labHelpers?.includes(h)) out.push(`H23: --cannon-holder ${h} is on LAB_HELPERS, so lab.sh has it logged in already; standalone.ts logs the holder in itself`);
    if (g.others?.includes(h)) out.push(`H23: ${h} is named by --cannon-holder and by another giver flag`);
    return out;
}

/**
 * Start H23's holder and wait until it stands loaded on `tile`. `onLauncher` gets the launcher as
 * soon as it is spawned, so the caller can stop it even when the wait throws.
 */
export async function launchCannonHolder(o: { root: string; account: string; tile: Tile; cueDir: string; server: string; agentPort: number; timeoutMs?: number }, onLauncher: (l: Subprocess) => void): Promise<{ secs: number; base: string }> {
    const base = mkdtempSync(join(tmpdir(), 'dress-cannon-'));
    const botsDir = join(base, 'bots');
    const runDir = join(base, 'run');
    const config = cannonHolderLaunch({ account: o.account, tile: o.tile, botsDir, runDir, gatewayPort: o.agentPort + HOLDER_PORT_OFFSET });
    writeLabBotEnvs(botsDir, [o.account], o.server);
    const l = spawnLauncher({ root: o.root, base, config, cueDir: o.cueDir });
    onLauncher(l);
    const ready = holderReady(runDir);
    const secs = await waitLauncherReady(l, { runDir, accounts: [o.account], ready: a => ready(a), what: 'cannon holder', timeoutMs: o.timeoutMs ?? 300_000 });
    return { secs, base };
}
