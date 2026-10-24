// S18's stun-pack courier (helpers/bone-giver.ts on-request, cairn_e15's role, SUPPLIES.md H14.x) on
// the lab engine, for lab/dress-rehearsal.ts --courier: the run's entry (HELPERS.md "The cue gate";
// staging.md H14.x) with iron ore as its item, hold 14 and refillBelow 14, the carry list (sharks back
// to 2, the adamant and rune tip stacks and the first top-up's copper and tin once each), its side tile
// among the Ardougne knights, bank restock at Ardougne south (2654,3285), loginOn and stopOn
// {S18, courier}. The lab's stand-in for its run-eve kit: the bank seeded on its first visit by staff
// gives (restock.labSeed, noted), so every top-up after that is a real withdrawal; and a staging session
// that leaves the fresh account logged out at that bank. One launcher (AGENT_PORT+14, its own run dir);
// ready before SCORED logs in is the courier awaiting its cue. run.ts's chain opens and stops the cue.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { ACCOUNT_NAME_RE, FORBIDDEN_ACCOUNTS } from '../helpers/fleet-config';
import { STAND_IN_STEP } from '../runner/run-report';
import { writeLabBotEnvs } from './altar-launch';
import { stageLabAccount } from './carrier-launch';
import { awaitingCue, spawnLauncher, stopLauncher, waitLauncherReady, type LauncherConfig } from './helper-launch';
import { clearInventory, mustTele } from './setup';

export const COURIER_STEP = 'S18';
export const COURIER_SCOPE = { step: COURIER_STEP, family: 'courier' } as const;
/** The courier's launcher gateway: AGENT_PORT + this (carriers +12, S21 +13). */
export const COURIER_PORT_OFFSET = 14;
/** Its restock bank, Ardougne south (the run's entry). */
export const COURIER_BANK = { x: 2654, z: 3285 } as const;
/** Its S18 side tile among the knights (lab/measure-thieving.ts COURIER_SITE); it re-steps beside SCORED from there. */
export const COURIER_SITE = { giver: { x: 2671, z: 3305 }, receiver: { x: 2670, z: 3305 } } as const;
/** Iron ore a top-up holds at most (14 beside the nature stack) and refills below. */
export const COURIER_HOLD = 14;
/** S18's top-ups (SUPPLIES.md H14.1-H14.13). */
export const COURIER_TOP_UPS = 13;

/** The carry list (bone-giver.ts `carry`): `obj` is the lab's staff give. */
export const COURIER_CARRY: readonly { item: string; count: number; obj: string; once?: true }[] = [
    { item: 'Shark', count: 2, obj: 'shark' },
    { item: 'Adamant arrowtips', count: 2220, obj: 'adamant_arrowheads', once: true },
    { item: 'Rune arrowtips', count: 570, obj: 'rune_arrowheads', once: true },
    { item: 'Copper ore', count: 5, obj: 'copper_ore', once: true },
    { item: 'Tin ore', count: 5, obj: 'tin_ore', once: true },
];

/** The bank's lab seed: every top-up's ore and sharks plus one more load, the once stacks once; noted where a stack would not fit. */
export function courierSeed(): { obj: string; n: number }[] {
    const loads = COURIER_TOP_UPS + 1;
    return [
        { obj: 'cert_iron_ore', n: COURIER_HOLD * loads },
        ...COURIER_CARRY.map(c => (c.once ? { obj: c.count > 1 && /_ore$|^shark$/.test(c.obj) ? `cert_${c.obj}` : c.obj, n: c.count } : { obj: `cert_${c.obj}`, n: c.count * loads })),
    ];
}

export interface CourierEntry {
    account: string;
    role: 'bone-giver';
    loginOn: typeof COURIER_SCOPE;
    stopOn: typeof COURIER_SCOPE;
    options: Record<string, unknown>;
}

/** standalone.ts's config for the one courier. */
export function courierLaunch(o: { account: string; botsDir: string; runDir: string; gatewayPort: number }): Omit<LauncherConfig, 'accounts'> & { accounts: CourierEntry[] } {
    const options = {
        mode: 'on-request', item: 'Iron ore', obj: 'iron_ore', hold: COURIER_HOLD, refillBelow: COURIER_HOLD,
        scope: { ...COURIER_SCOPE }, sites: [{ giver: { ...COURIER_SITE.giver }, receiver: { ...COURIER_SITE.receiver } }],
        carry: COURIER_CARRY.map(c => ({ ...c })),
        restock: { kind: 'bank', bank: { ...COURIER_BANK }, labSeed: courierSeed() },
    };
    return { gatewayPort: o.gatewayPort, botsDir: o.botsDir, runDir: o.runDir, loginSpacingMs: 2000, accounts: [{ account: o.account, role: 'bone-giver', loginOn: { ...COURIER_SCOPE }, stopOn: { ...COURIER_SCOPE }, options }] };
}

/** The slice runs S18 itself (not a --staff-steps jump past it). */
export function runsS18(steps: readonly { id: string; name?: string }[]): boolean {
    return steps.some(s => s.id === COURIER_STEP && !(s.name ?? '').startsWith(STAND_IN_STEP));
}

/** Why S18 cannot meet its courier ([] when it can, or when the slice does not run S18). */
export function courierGaps(steps: readonly { id: string; name?: string }[], g: { courier?: string; labHelpers?: readonly string[]; others?: Readonly<Record<string, readonly string[]>> }): string[] {
    if (!runsS18(steps)) return [];
    if (!g.courier) return ['S18 (thieving) has no courier: name one with --courier=<cairn_ name>, not on LAB_HELPERS (standalone.ts logs it in), or jump the step with --staff-steps=S18'];
    const out: string[] = [];
    if (!ACCOUNT_NAME_RE.test(g.courier) || FORBIDDEN_ACCOUNTS.has(g.courier)) out.push(`S18: --courier ${g.courier} is not a cairn_ helper name standalone.ts launches`);
    if (g.labHelpers?.includes(g.courier)) out.push(`S18: --courier ${g.courier} is on LAB_HELPERS, so lab.sh has it logged in already; standalone.ts logs the courier in itself`);
    for (const [flag, names] of Object.entries(g.others ?? {})) if (names.includes(g.courier)) out.push(`S18: ${g.courier} is named by both ${flag} and --courier`);
    return out;
}

/**
 * Stage the courier (logged out at its bank), start its launcher and wait until it awaits
 * {S18, courier}. `onSpawn` gets the launcher at once.
 */
export async function launchCourier(o: { root: string; account: string; cueDir: string; server: string; agentPort: number; timeoutMs?: number }, onSpawn: (launcher: Subprocess) => void): Promise<{ secs: number; base: string }> {
    const base = mkdtempSync(join(tmpdir(), 'dress-courier-'));
    const botsDir = join(base, 'bots');
    const runDir = join(base, 'run');
    writeLabBotEnvs(botsDir, [o.account], o.server);
    await stageLabAccount({ account: o.account, botsDir, agentPort: o.agentPort }, async s => {
        await clearInventory(s.sdk);
        await mustTele(s.sdk, COURIER_BANK.x, COURIER_BANK.z);
    });
    const config = courierLaunch({ account: o.account, botsDir, runDir, gatewayPort: o.agentPort + COURIER_PORT_OFFSET });
    const launcher = spawnLauncher({ root: o.root, base, config, cueDir: o.cueDir });
    onSpawn(launcher);
    const waiting = awaitingCue(runDir);
    const secs = await waitLauncherReady(launcher, { runDir, accounts: [o.account], ready: a => waiting(a), what: 'S18 courier', timeoutMs: o.timeoutMs ?? 120_000 });
    return { secs, base };
}

export const stopCourier = (launcher: Subprocess): Promise<void> => stopLauncher(launcher);
