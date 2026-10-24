// S21's body-altar givers (helpers/altar-giver.ts, SUPPLIES.md H17/H17e) on the lab engine, for
// lab/dress-rehearsal.ts --s21-givers: the production roster's entries (helpers/roster.ts giverEntries:
// slots round-robin 0-2, the direct path, 27 essence a trade, the {S21, altar} scope, loginOn that
// cue, the hand-back items on the roster's hand-back slot) with lab restock: every essence giver by
// ::give (restock `cheat`: the body talisman and 27 essence each trip); the hand-back giver from a bank
// seeded on its first visit with exactly its essence trades and the hand-back runes (labSeed), so its
// bank runs out of essence after its last trade and its next trip is runes-only, as on the day.
// One standalone.ts launcher (AGENT_PORT+13, its own run dir) holds all of them logged out until
// runecraft.ts's pre-login opens {S21, altar}; ready before SCORED logs in is every giver awaiting that
// cue. They log out on S21's final stop (stopOn defaults to the login scope) or at the chain's end.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { canonName } from '../helpers/altar-cue';
import { ACCOUNT_NAME_RE, FORBIDDEN_ACCOUNTS } from '../helpers/fleet-config';
import { BODY_ROSTER_SIZE, giverEntries, handBackSlot, S21_ESSENCE, S21_HAND_BACK, S21_SCOPE } from '../helpers/roster';
import { STAND_IN_STEP } from '../runner/run-report';
import { writeLabBotEnvs } from './altar-launch';
import { awaitingCue, spawnLauncher, stopLauncher, waitLauncherReady, type LauncherConfig } from './helper-launch';

/** The S21 givers' launcher gateway: AGENT_PORT + this (carriers +12). */
export const S21_PORT_OFFSET = 13;

/** Staff-give names of the hand-back runes (S21_HAND_BACK, in its order). */
const HAND_BACK_OBJ: Readonly<Record<string, string>> = { 'Law rune': 'lawrune', 'Air rune': 'airrune', 'Earth rune': 'earthrune' };

export interface S21Entry {
    account: string;
    role: 'altar-giver';
    path: 'direct';
    loginOn: { step: string; family: string };
    options: Record<string, unknown> & { altar: 'body'; slot: number; essence: number; restock: Record<string, unknown>; scope: { step: string; family: string } };
}

/** standalone.ts's config for S21's roster: the production entries with lab restock (above). */
export function s21GiverLaunch(o: { givers: readonly string[]; botsDir: string; runDir: string; gatewayPort: number }): Omit<LauncherConfig, 'accounts'> & { accounts: S21Entry[] } {
    const hb = handBackSlot(S21_ESSENCE, o.givers.length);
    const accounts = giverEntries([...o.givers], { role: 'altar-giver' }).map((raw, i): S21Entry => {
        const e = raw as unknown as S21Entry;
        const restock = i === hb.index
            ? { kind: 'bank', labSeed: { essence: hb.essence, items: S21_HAND_BACK.map(h => ({ obj: HAND_BACK_OBJ[h.item]!, n: h.n })) } }
            : { kind: 'cheat' };
        return { ...e, options: { ...e.options, restock } };
    });
    return { gatewayPort: o.gatewayPort, botsDir: o.botsDir, runDir: o.runDir, loginSpacingMs: 2000, accounts };
}

/** The slice runs S21 itself (not a --staff-steps jump past it). */
export function runsS21(steps: readonly { id: string; name?: string }[]): boolean {
    return steps.some(s => s.id === 'S21' && !(s.name ?? '').startsWith(STAND_IN_STEP));
}

/**
 * Why S21 cannot meet its givers ([] when it can, or when the slice does not run S21): the roster's
 * BODY_ROSTER_SIZE distinct cairn_ names standalone.ts logs in itself, none on LAB_HELPERS or another
 * family's flag.
 */
export function s21GiverGaps(steps: readonly { id: string; name?: string }[], g: { givers?: readonly string[]; labHelpers?: readonly string[]; others?: Readonly<Record<string, readonly string[]>> }): string[] {
    if (!runsS21(steps)) return [];
    const givers = g.givers ?? [];
    if (!givers.length) return [`S21 (the body altar) has no givers: name its ${BODY_ROSTER_SIZE} with --s21-givers=<t1>,...,<t${BODY_ROSTER_SIZE}>, cairn_ names not on LAB_HELPERS (standalone.ts logs them in), or jump the step with --staff-steps=S21`];
    const out: string[] = [];
    if (givers.length !== BODY_ROSTER_SIZE) out.push(`S21: --s21-givers names ${givers.length} giver(s); the production roster is ${BODY_ROSTER_SIZE} (helpers/roster.ts)`);
    if (new Set(givers.map(canonName)).size !== givers.length) out.push('S21: --s21-givers names a giver twice');
    for (const n of givers) {
        if (!ACCOUNT_NAME_RE.test(n) || FORBIDDEN_ACCOUNTS.has(n)) out.push(`S21: --s21-givers ${n} is not a cairn_ helper name standalone.ts launches`);
        if (g.labHelpers?.includes(n)) out.push(`S21: --s21-givers ${n} is on LAB_HELPERS, so lab.sh has it logged in already; standalone.ts logs the givers in itself`);
        for (const [flag, names] of Object.entries(g.others ?? {})) if (names.includes(n)) out.push(`S21: ${n} is named by both ${flag} and --s21-givers`);
    }
    return out;
}

/**
 * Write each giver a fresh lab bot.env, start S21's launcher (its own run dir and gateway; `onSpawn`
 * gets it at once) and wait until every giver is logged out awaiting {S21, altar}.
 */
export async function launchS21Givers(o: { root: string; givers: readonly string[]; cueDir: string; server: string; agentPort: number; timeoutMs?: number }, onSpawn: (launcher: Subprocess) => void): Promise<{ secs: number; base: string }> {
    const base = mkdtempSync(join(tmpdir(), 'dress-s21-'));
    const botsDir = join(base, 'bots');
    const runDir = join(base, 'run');
    writeLabBotEnvs(botsDir, o.givers, o.server);
    const config = s21GiverLaunch({ givers: o.givers, botsDir, runDir, gatewayPort: o.agentPort + S21_PORT_OFFSET });
    const launcher = spawnLauncher({ root: o.root, base, config, cueDir: o.cueDir });
    onSpawn(launcher);
    const waiting = awaitingCue(runDir);
    const secs = await waitLauncherReady(launcher, { runDir, accounts: o.givers, ready: a => waiting(a), what: 'S21 givers', timeoutMs: o.timeoutMs ?? 120_000 });
    return { secs, base };
}

export const stopS21Givers = (launcher: Subprocess): Promise<void> => stopLauncher(launcher);

export { S21_SCOPE };
