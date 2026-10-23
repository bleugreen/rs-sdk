// One run-machine launcher (helpers/standalone.ts) on the lab engine, as the dress rehearsal and the
// lab acceptances start their helpers: the config written to <base>/launch.json, standalone.ts run
// from the checkout with its output in <base>/launcher.{log,err}, a wait until launcher.json says
// every account is in and each passes its family's own ready check, and a SIGINT stop. Each family
// (lab/altar-launch.ts, lab/anvil-launch.ts, lab/cannon-launch.ts, ...) builds its config and its
// ready check; this file only launches, waits and stops.
//
// A launcher starts its own loopback gateway (config.gatewayPort) and logs its accounts in itself,
// so a launched helper is never a lab.sh LAB_HELPERS account. Each family's launcher takes its own
// gateway port and run dir (launcher.json, logs/, role-state/); only S06's altar givers use
// run-machine/, where runecraft.ts reads their launcher.json.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { readLauncherFile } from '../skills/runecraft';

/** standalone.ts's config (its parseLaunchConfig input), as far as launching needs it. */
export interface LauncherConfig {
    gatewayPort: number;
    botsDir: string;
    runDir: string;
    loginSpacingMs?: number;
    accounts: readonly { account: string; role: string }[];
}

/**
 * Start standalone.ts from `root` on `config` (written to <base>/launch.json), its output in
 * <base>/launcher.{log,err}. HELPER_LAB_TELE lets a fresh lab helper skip the walk from its spawn;
 * RC_CUE_DIR is the cue directory the scored side writes and the helpers read (and write status in).
 */
export function spawnLauncher(o: { root: string; base: string; config: LauncherConfig; cueDir: string }): Subprocess {
    const file = join(o.base, 'launch.json');
    writeFileSync(file, JSON.stringify(o.config, null, 2));
    return Bun.spawn([process.execPath, 'speedrun/helpers/standalone.ts', file], {
        cwd: o.root,
        env: { ...process.env, HELPER_LAB_TELE: '1', RC_CUE_DIR: o.cueDir },
        stdout: Bun.file(join(o.base, 'launcher.log')),
        stderr: Bun.file(join(o.base, 'launcher.err'))
    });
}

export interface WaitReady {
    /** The launcher's run dir (its launcher.json and logs/). */
    runDir: string;
    /** The accounts that must pass `ready`. */
    accounts: readonly string[];
    /** The family's ready check for one account at wall time `now` (its status file, its role log). */
    ready: (account: string, now: number) => boolean;
    /** What the accounts are, for the error text (default 'helpers'). */
    what?: string;
    /** Default 240 s. */
    timeoutMs?: number;
    /** Poll interval (default 500 ms). */
    pollMs?: number;
}

/**
 * Wait until this launch's launcher.json says helpersReady and every account passes `ready`.
 * Returns the seconds it took; throws when the launcher exits first or `timeoutMs` passes.
 */
export async function waitLauncherReady(launcher: Pick<Subprocess, 'exitCode'>, o: WaitReady): Promise<number> {
    const t0 = Date.now();
    const timeoutMs = o.timeoutMs ?? 240_000;
    const what = o.what ?? 'helpers';
    for (;;) {
        const l = readLauncherFile(o.runDir);
        const now = Date.now();
        const ready = o.accounts.filter(a => o.ready(a, now));
        // A launcher.json older than this launch is an earlier run's (a shared run dir).
        if (l?.helpersReady && l.ms >= t0 && ready.length === o.accounts.length) return Math.round((now - t0) / 1000);
        if (launcher.exitCode !== null) throw new Error(`the ${what}' launcher exited (${launcher.exitCode}) before they were ready (ready: ${ready.join(', ') || 'none'}; see ${o.runDir}/logs)`);
        if (now - t0 > timeoutMs) throw new Error(`${what} not ready after ${Math.round(timeoutMs / 1000)} s (ready: ${ready.join(', ') || 'none'}; see ${o.runDir}/logs)`);
        await Bun.sleep(o.pollMs ?? 500);
    }
}

/** SIGINT the launcher (each helper clicks logout, standalone.ts's stop) and wait up to `graceMs` for it to exit. */
export async function stopLauncher(launcher: Pick<Subprocess, 'kill' | 'exited'>, graceMs = 30_000): Promise<void> {
    launcher.kill('SIGINT');
    await Promise.race([launcher.exited, Bun.sleep(graceMs)]);
}

/** The JSON lines of <runDir>/logs/<account>.role.log (role.ts runStandalone's `line`), oldest first; [] when absent. */
export function roleLogEvents(runDir: string, account: string): Record<string, unknown>[] {
    let text: string;
    try {
        text = readFileSync(join(runDir, 'logs', `${account}.role.log`), 'utf8');
    } catch {
        return [];
    }
    const out: Record<string, unknown>[] = [];
    for (const line of text.split('\n')) {
        const at = line.indexOf('{');
        if (at < 0) continue;
        try {
            const v = JSON.parse(line.slice(at)) as unknown;
            if (v && typeof v === 'object' && !Array.isArray(v)) out.push(v as Record<string, unknown>);
        } catch {
            // a launcher line or a partial write
        }
    }
    return out;
}

/** The `to` of the last `phase` event a role logged (cannon.ts's and the droppers' setPhase), or null. */
export function lastRolePhase(runDir: string, account: string): string | null {
    const e = roleLogEvents(runDir, account).filter(x => x.message === 'phase' && typeof x.to === 'string').at(-1);
    return e ? (e.to as string) : null;
}
