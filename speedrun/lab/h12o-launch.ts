// H12o's atoll helper (helpers/mule.ts carried mode, cairn_h45's role, SUPPLIES.md H12o) on the lab
// engine, for lab/dress-rehearsal.ts --h12o: the generated entry (mule-ledger.ts h45LauncherEntry:
// serveMode request, carried, packages H12oM sharks top-up 15 at (2763,2704) and H12oP superantipoison
// and sharks at (2803,2724)) gated as HELPERS.md "The cue gate" runs it on the day: its role folder is
// the run's h45-cue (Monkey Madness writes H12oM and H12oP there), loginOn {H12o, mule} in the login-only
// folder h45-login (run.ts's chain writes that one trigger at segment M's start, runner/chain.ts
// h12oLogin), stopOn {H12oP, mule}, no final. The run config's h12o block names the same account and
// folders, so the chain's trigger and Monkey Madness's top-ups reach it.
// The lab's stand-in for its run-eve staging (lab/atoll-mule.ts): its reported profile and adamant
// set, the carried sharks and potion by ::give, logged out on H12oM's tile. One launcher (AGENT_PORT+15,
// its own run dir); ready before SCORED logs in is h45 awaiting its trigger.

import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Subprocess } from 'bun';
import { ACCOUNT_NAME_RE, FORBIDDEN_ACCOUNTS } from '../helpers/fleet-config';
import { h45LauncherEntry } from '../helpers/mule-ledger';
import { H12O_LOGIN, type RunConfig } from '../runner/chain';
import { waitTicks, waitUntil } from '../lib/wait';
import { opIndex } from '../lib/world';
import { writeLabBotEnvs } from './altar-launch';
import { stageLabAccount } from './carrier-launch';
import { awaitingCue, spawnLauncher, stopLauncher, waitLauncherReady, type LauncherConfig } from './helper-launch';
import { cheat, clearInventory, mustTele, setStats } from './setup';

/** h45's launcher gateway: AGENT_PORT + this (carriers +12, S21 +13, courier +14). */
export const H12O_PORT_OFFSET = 15;
/** The chain step that fires h45's login trigger (runner/chain.ts h12oLogin). */
export const H12O_LOGIN_STEP = 'H12o login';
/** The staging lead before segment M when the lab run config gives none: h45 is parked on M's tile, so only its login (lab/atoll-mule.ts --lead). */
export const H12O_LAB_LEAD_TICKS = 70;
/** h45's own sharks beside the carried ones (lab/atoll-mule.ts OWN_SHARKS). */
const OWN_SHARKS = 3;

/** The run config's h12o block for `account`: the lab config's own folders and lead when it gives them, else h45-cue and h45-login beside the run's cue dir. */
export function labH12o(account: string, cfg: Pick<RunConfig, 'cueDir' | 'h12o'>): NonNullable<RunConfig['h12o']> {
    const root = dirname(cfg.cueDir);
    return {
        account,
        cueDir: cfg.h12o?.cueDir ?? join(root, 'h45-cue'),
        loginDir: cfg.h12o?.loginDir ?? join(root, 'h45-login'),
        leadTicks: cfg.h12o?.leadTicks ?? H12O_LAB_LEAD_TICKS,
    };
}

export interface H12oEntry {
    account: string;
    role: 'mule';
    cueDir: string;
    loginOn: { step: string; family: string; cueDir: string };
    stopOn: { step: string; family: string };
    options: Record<string, unknown> & { serve: string; serveMode: 'request'; carried: true; packages: unknown[] };
}

/** standalone.ts's config for h45: the generated entry under the lab name, serving SCORED, on the h12o block's folders. */
export function h12oLaunch(o: { h12o: NonNullable<RunConfig['h12o']>; serve: string; manifest?: string; botsDir: string; runDir: string; gatewayPort: number }): Omit<LauncherConfig, 'accounts'> & { accounts: H12oEntry[] } {
    const g = h45LauncherEntry(o.manifest);
    const entry: H12oEntry = {
        account: o.h12o.account!, role: 'mule', cueDir: o.h12o.cueDir,
        loginOn: { ...H12O_LOGIN, cueDir: o.h12o.loginDir },
        stopOn: { ...(g.stopOn as { step: string; family: string }) },
        options: { ...(g.options as H12oEntry['options']), serve: o.serve },
    };
    return { gatewayPort: o.gatewayPort, botsDir: o.botsDir, runDir: o.runDir, loginSpacingMs: 2000, accounts: [entry] };
}

/** Sharks and potions the carried packages offer at most (their top-up maxes). */
export function carriedLoad(entry: Pick<H12oEntry, 'options'>): { sharks: number; potions: number } {
    let sharks = 0;
    let potions = 0;
    for (const p of entry.options.packages as { items: { id?: number; topUp?: { max: number }; amount?: number }[] }[]) {
        for (const i of p.items) {
            const n = i.topUp?.max ?? i.amount ?? 0;
            if (i.id === 385) sharks += n;
            else potions += n;
        }
    }
    return { sharks, potions };
}

/** The slice fires h45's login trigger (it runs Monkey Madness's segment M). */
export function runsH12o(steps: readonly { id: string }[]): boolean {
    return steps.some(s => s.id === H12O_LOGIN_STEP);
}

/** Why the slice's H12o legs cannot meet h45 ([] when they can, or when the slice does not reach them). */
export function h12oGaps(steps: readonly { id: string }[], g: { h12o?: string; labHelpers?: readonly string[]; others?: Readonly<Record<string, readonly string[]>> }): string[] {
    if (!runsH12o(steps)) return [];
    if (!g.h12o) return ['H12o (Monkey Madness\'s atoll top-ups) has no helper: name h45\'s lab stand-in with --h12o=<cairn_ name>, not on LAB_HELPERS (standalone.ts logs it in)'];
    const out: string[] = [];
    if (!ACCOUNT_NAME_RE.test(g.h12o) || FORBIDDEN_ACCOUNTS.has(g.h12o) || g.h12o === 'cairn_h45') out.push(`H12o: --h12o ${g.h12o} is not a lab cairn_ helper name standalone.ts launches (never cairn_h45 itself)`);
    if (g.labHelpers?.includes(g.h12o)) out.push(`H12o: --h12o ${g.h12o} is on LAB_HELPERS, so lab.sh has it logged in already; standalone.ts logs it in itself`);
    for (const [flag, names] of Object.entries(g.others ?? {})) if (names.includes(g.h12o)) out.push(`H12o: ${g.h12o} is named by both ${flag} and --h12o`);
    return out;
}

/**
 * Stage h45's stand-in (profile, adamant set, the carried load, logged out on H12oM's tile), start its
 * launcher and wait until it awaits its trigger. `onSpawn` gets the launcher at once.
 */
export async function launchH12o(o: { root: string; h12o: NonNullable<RunConfig['h12o']>; serve: string; cueDir: string; server: string; agentPort: number; timeoutMs?: number }, onSpawn: (launcher: Subprocess) => void): Promise<{ secs: number; base: string }> {
    const account = o.h12o.account!;
    const base = mkdtempSync(join(tmpdir(), 'dress-h12o-'));
    const botsDir = join(base, 'bots');
    const runDir = join(base, 'run');
    for (const d of [o.h12o.cueDir, o.h12o.loginDir]) mkdirSync(d, { recursive: true });
    writeLabBotEnvs(botsDir, [account], o.server);
    const config = h12oLaunch({ h12o: o.h12o, serve: o.serve, botsDir, runDir, gatewayPort: o.agentPort + H12O_PORT_OFFSET });
    const entry = config.accounts[0]!;
    const load = carriedLoad(entry);
    const m = (entry.options.packages[0] as { at: { x: number; z: number } }).at;
    await stageLabAccount({ account, botsDir, agentPort: o.agentPort }, async s => {
        await clearInventory(s.sdk);
        await setStats(s.sdk, { attack: 99, strength: 99, defence: 99, hitpoints: 99, prayer: 1, magic: 57, agility: 76 });
        for (const obj of ['adamant_full_helm', 'adamant_longsword', 'adamant_chainbody', 'adamant_platelegs']) await cheat(s.sdk, `give ${obj} 1`);
        await waitUntil(s.sdk, st => st.inventory.length >= 4, { maxTicks: 15 });
        for (let pass = 0; pass < 3 && s.sdk.getState()!.inventory.length; pass++) {
            for (const i of s.sdk.getState()!.inventory) {
                void s.sdk.sendUseItem(i.slot, opIndex(i, /^(wear|wield)$/i) ?? 2);
                await waitTicks(s.sdk, 1);
            }
            await waitTicks(s.sdk, 2);
        }
        await cheat(s.sdk, `give shark ${load.sharks + OWN_SHARKS}`);
        if (load.potions) await cheat(s.sdk, `give 4dose2antipoison ${load.potions}`);
        const want = load.sharks + OWN_SHARKS + load.potions;
        if (!(await waitUntil(s.sdk, st => st.inventory.reduce((n, i) => n + i.count, 0) >= want, { maxTicks: 15 })).ok) throw new Error('h45 load did not land');
        await mustTele(s.sdk, m.x, m.z);
    });
    const launcher = spawnLauncher({ root: o.root, base, config, cueDir: o.cueDir });
    onSpawn(launcher);
    const waiting = awaitingCue(runDir);
    const secs = await waitLauncherReady(launcher, { runDir, accounts: [account], ready: a => waiting(a), what: 'H12o helper', timeoutMs: o.timeoutMs ?? 120_000 });
    return { secs, base };
}

export const stopH12o = (launcher: Subprocess): Promise<void> => stopLauncher(launcher);
