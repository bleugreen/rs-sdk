// S25a's anvil helper (helpers/anvil.ts, SUPPLIES.md H21a) on the lab engine, launched the way the
// run machine launches it (HELPERS.md's `anvil` entry: the run-machine launcher, the relay path, bank
// restock, the {S25a, anvil} cue scope), with lab stock: the helper tops its bank up with staff-made
// bar notes when it runs short (anvil.ts labStock), so a fresh lab account restocks at the Varrock
// west booth on the run's own clock. lab/dress-rehearsal.ts (--anvil) launches it before SCORED logs
// in and stops it once S25a returns. SCORED's side is the chain's own: smithing.ts announces each
// inventory to anvil-plan.json (runner/chain.ts anvilAnnounce) and the chain opens the {S25a, anvil}
// cue naming SCORED.
//
// The helper is a cairn_ name standalone.ts logs in itself (never a lab.sh LAB_HELPERS account), its
// launcher on AGENT_PORT+10 with launcher.json, logs/ and role-state/ in a run dir of its own.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { readJson, STATUS_FRESH_MS, type CueScope } from '../helpers/altar-cue';
import { statusFile, type AnvilPhase, type AnvilStatus } from '../helpers/anvil';
import { ACCOUNT_NAME_RE, FORBIDDEN_ACCOUNTS } from '../helpers/fleet-config';
import { STAND_IN_STEP } from '../runner/run-report';
import { writeLabBotEnvs } from './altar-launch';
import { spawnLauncher, waitLauncherReady, type LauncherConfig } from './helper-launch';

/** The step the anvil helper serves, and its cue (altar-cue.ts CueScope). */
export const ANVIL_STEP = 'S25a';
export const ANVIL_SCOPE: CueScope = { step: ANVIL_STEP, family: 'anvil' };
/** Its launcher's loopback gateway: AGENT_PORT + this (altar +5, droppers +6, bone givers +7). */
export const ANVIL_PORT_OFFSET = 10;

export interface AnvilLaunchEntry {
    account: string;
    role: 'anvil';
    options: { restock: { kind: 'bank'; labStock: true }; scope: CueScope };
}

/** standalone.ts's config for the one anvil helper: the run day's entry with lab stock. */
export function anvilLaunch(o: { account: string; botsDir: string; runDir: string; gatewayPort: number }): Omit<LauncherConfig, 'accounts'> & { accounts: AnvilLaunchEntry[] } {
    return {
        gatewayPort: o.gatewayPort,
        botsDir: o.botsDir,
        runDir: o.runDir,
        loginSpacingMs: 2000,
        accounts: [{ account: o.account, role: 'anvil', options: { restock: { kind: 'bank', labStock: true }, scope: { ...ANVIL_SCOPE } } }]
    };
}

/** Phases that say the helper is up and serving (waiting for a plan or SCORED, or already staging one). */
const SERVING: readonly AnvilPhase[] = ['waiting', 'restock', 'travel', 'requested', 'trading'];

/** anvil.ts's status file in `cueDir` shows it serving, written within STATUS_FRESH_MS (its heartbeat is 2 s). */
export function anvilReady(cueDir: string): (account: string, now: number) => boolean {
    return (account, now) => {
        const s = readJson<AnvilStatus>(statusFile(cueDir, account));
        return !!s && SERVING.includes(s.phase) && now - s.ms < STATUS_FRESH_MS;
    };
}

/** The slice runs S25a itself (not --staff-steps' STAND-IN jump past it). */
export function runsS25a(steps: readonly { id: string; name?: string }[]): boolean {
    return steps.some(s => s.id === ANVIL_STEP && !(s.name ?? '').startsWith(STAND_IN_STEP));
}

/**
 * Why S25a cannot meet its anvil helper in `steps` ([] when it can, or when the slice does not run
 * S25a): --anvil names one cairn_ helper standalone.ts logs in itself (not on LAB_HELPERS, and none
 * of the other givers).
 */
export function anvilGaps(steps: readonly { id: string; name?: string }[], g: { anvil?: string; labHelpers?: readonly string[]; others?: readonly string[] }): string[] {
    if (!runsS25a(steps)) return [];
    if (!g.anvil) return ['S25a (smithing) has no anvil helper: name one with --anvil=<cairn_ name>, not on LAB_HELPERS (standalone.ts logs it in), or jump the step with --staff-steps=S25a'];
    const out: string[] = [];
    if (!ACCOUNT_NAME_RE.test(g.anvil) || FORBIDDEN_ACCOUNTS.has(g.anvil)) out.push(`S25a: --anvil ${g.anvil} is not a cairn_ helper name standalone.ts launches`);
    if (g.labHelpers?.includes(g.anvil)) out.push(`S25a: --anvil ${g.anvil} is on LAB_HELPERS, so lab.sh has it logged in already; standalone.ts logs the anvil helper in itself`);
    if (g.others?.includes(g.anvil)) out.push(`S25a: ${g.anvil} is named by --anvil and by another giver flag`);
    return out;
}

/**
 * Start the anvil helper and wait until it is logged in and serving. `onLauncher` gets the launcher
 * as soon as it is spawned, so the caller can stop it even when the wait throws.
 */
export async function launchAnvil(o: { root: string; account: string; cueDir: string; server: string; agentPort: number; timeoutMs?: number }, onLauncher: (l: Subprocess) => void): Promise<{ secs: number; base: string }> {
    const base = mkdtempSync(join(tmpdir(), 'dress-anvil-'));
    const botsDir = join(base, 'bots');
    const runDir = join(base, 'run');
    writeLabBotEnvs(botsDir, [o.account], o.server);
    const config = anvilLaunch({ account: o.account, botsDir, runDir, gatewayPort: o.agentPort + ANVIL_PORT_OFFSET });
    const l = spawnLauncher({ root: o.root, base, config, cueDir: o.cueDir });
    onLauncher(l);
    const secs = await waitLauncherReady(l, { runDir, accounts: [o.account], ready: anvilReady(o.cueDir), what: 'anvil helper', timeoutMs: o.timeoutMs ?? 240_000 });
    return { secs, base };
}
