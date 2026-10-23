// The altar givers (speedrun/helpers/altar-giver.ts) on the lab engine, launched the way the run
// machine launches them: the run-machine launcher (helpers/standalone.ts) from a checkout, one
// altar-giver entry per giver with lab restock (staff ::give), the band's essence load and its cue
// scope, and every giver logged in, in the room and ready before SCORED logs in (RUN-HOST.md: login
// order decides the 7- or 8-tick cycle). lab/runecraft-accept.ts and lab/dress-rehearsal.ts
// (--altar-givers) both launch through here, so the rehearsal runs the givers the module was
// accepted against.
//
// standalone.ts starts its own loopback gateway and a client per giver, so a giver is never a
// lab.sh LAB_HELPERS account (that one is already logged in, and its bot.env names lab.sh's gateway,
// which the launcher refuses). Its bot.env is written here, into a botsDir of its own.

import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { readJson, statusPath, STATUS_FRESH_MS, type CueScope, type GiverStatus, type HandBackItem } from '../helpers/altar-cue';
import { LOAD, type Band } from '../skills/runecraft';
import { spawnLauncher, stopLauncher, waitLauncherReady, type LauncherConfig } from './helper-launch';

export type GiverPath = 'relay' | 'direct';

export interface AltarLaunchOptions {
    /** Essence givers, in login order; slot i % 3 (east, west, south of SCORED's tile). */
    givers: readonly string[];
    /** The band they serve: its id is the cue's step, its `load` the essence each trade carries. */
    band: Pick<Band, 'id' | 'altar' | 'load'>;
    botsDir: string;
    /** launcher.json, logs/ and role-state/ (the scored side reads launcher.json here). */
    runDir: string;
    /** The launcher's loopback gateway. */
    gatewayPort: number;
    /** standalone.ts's per-account path (absent: its default, relay). */
    path?: GiverPath;
    /** One more giver after the essence givers, for the band's hand-back (S21): bank restock, no essence load. */
    handBack?: { account: string; items: readonly HandBackItem[] };
}

export interface AltarLaunchEntry {
    account: string;
    role: 'altar-giver';
    path?: GiverPath;
    options: { altar: string; slot: number; essence: number; restock: { kind: 'cheat' | 'bank' }; scope: CueScope; handBack?: HandBackItem[] };
}

/** standalone.ts's config file (its parseLaunchConfig input) for `band`'s givers. */
export function altarGiverLaunch(o: AltarLaunchOptions): { gatewayPort: number; botsDir: string; runDir: string; loginSpacingMs: number; accounts: AltarLaunchEntry[] } {
    const scope: CueScope = { step: o.band.id, family: 'altar' };
    const essence = o.band.load ?? LOAD;
    const path = o.path ? { path: o.path } : {};
    const accounts: AltarLaunchEntry[] = o.givers.map((account, i) => ({ account, role: 'altar-giver', ...path, options: { altar: o.band.altar, slot: i % 3, essence, restock: { kind: 'cheat' }, scope } }));
    if (o.handBack) {
        const { account, items } = o.handBack;
        accounts.push({ account, role: 'altar-giver', ...path, options: { altar: o.band.altar, slot: o.givers.length % 3, essence, restock: { kind: 'bank' }, scope, handBack: items.map(i => ({ ...i })) } });
    }
    return { gatewayPort: o.gatewayPort, botsDir: o.botsDir, runDir: o.runDir, loginSpacingMs: 2000, accounts };
}

/** A lab bot.env per account (a fresh password; the lab engine creates the account on its first login), mode 600. */
export function writeLabBotEnvs(botsDir: string, accounts: readonly string[], server: string): void {
    for (const account of accounts) {
        mkdirSync(join(botsDir, account), { recursive: true, mode: 0o700 });
        writeFileSync(join(botsDir, account, 'bot.env'), `BOT_USERNAME=${account}\nPASSWORD=${randomBytes(6).toString('hex')}\nSERVER=${server}\nSHOW_CHAT=false\nTELEMETRY=false\nPROFANITY_FILTER=false\n`, { mode: 0o600 });
    }
}

/**
 * Start standalone.ts from `root` on `config` (written to <base>/launch.json), its output in
 * <base>/launcher.{log,err}. HELPER_LAB_TELE lets a fresh lab giver skip the walk from its spawn;
 * RC_CUE_DIR is the cue directory the scored side writes and reads the status files in.
 */
export function spawnAltarGivers(o: { root: string; base: string; config: LauncherConfig; cueDir: string }): Subprocess {
    return spawnLauncher(o);
}

/**
 * Wait until every giver is logged in (this launcher's launcher.json says helpersReady) and stands
 * loaded in the room (its status file: ready, in the room, fresh). Returns the seconds it took;
 * throws when the launcher exits first or `timeoutMs` passes.
 */
export async function waitAltarGiversReady(launcher: Subprocess, o: { runDir: string; cueDir: string; accounts: readonly string[]; timeoutMs?: number }): Promise<number> {
    const ready = (g: string, now: number) => {
        const s = readJson<GiverStatus>(statusPath(o.cueDir, g));
        return s?.phase === 'ready' && s.inRoom && now - s.ms < STATUS_FRESH_MS;
    };
    return waitLauncherReady(launcher, { runDir: o.runDir, accounts: o.accounts, ready, what: 'altar givers', ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}) });
}

/** SIGINT the launcher (each giver clicks logout, standalone.ts's stop) and wait up to `graceMs` for it to exit. */
export async function stopAltarGivers(launcher: Subprocess, graceMs = 30_000): Promise<void> {
    await stopLauncher(launcher, graceMs);
}
