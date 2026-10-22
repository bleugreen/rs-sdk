// STEP-MANIFEST.md entry 16's demo acceptance (S03 Firemaking) on two throwaways: the H6 log-row
// dropper (speedrun/helpers/fm-row.ts, with its `logs` option) and a lighter running the S03 step
// (speedrun/helpers/fm-demo.ts, mode light), both under the run-machine launcher (standalone.ts), so
// both drive through its loopback SDK gateway and never the demo relay. Timed on observed ticks. No
// staff commands: the dropper chops its own logs. Two launcher runs:
//
//   1. stage: the dropper alone (fm-demo mode stage): out of the tutorial, the starter kit dropped but
//      the axe, `logs` normal logs chopped at the nearest normal trees, standing on the row's first
//      tile; then logged out by the launcher.
//   2. row: the dropper (fm-row: these logs as `logs`, restock held, start sighted on the lighter's
//      name hash) and the lighter (fm-demo mode light, receiver, final). The lighter's RESULT line
//      judges every gap; the launcher logs both out.
//
//   timeout --kill-after=60s 40m bun speedrun/lab/firemaking-demo.ts --dropper=cairn_f02 --lighter=cairn_f01 \
//     --bots-dir=DIR [--create] [--server=HOST:PORT] [--gateway-port=7811] [--run-dir=DIR] [--logs=20] [--skip-stage]
//
// --create writes a missing bot.env with accounts.ts createAccountEnv (dir 700, file 600) for
// --server (default the demo server); the account itself is created on its first login. The row is
// the first `logs` tiles of rs/228's Lumbridge lap (west along z=3219 from 3222, then east along
// z=3218), lab-confirmed at 4-tick chains throughout. Prints one RESULT line.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createAccountEnv } from '../helpers/accounts';
import { nameHash } from '../helpers/altar-cue';
import { parseTiles } from '../skills/firemaking';
import { arg, result } from './common';

const ROOT = resolve(import.meta.dir, '..', '..');
/** rs/228's Lumbridge lap, its first two legs (5 + 26 tiles). */
const LUMBRIDGE_ROW = '3222-3218@3219;3218-3243@3218';

const dropper = arg('dropper', '');
const lighter = arg('lighter', '');
if (!dropper || !lighter || dropper === lighter) throw new Error('--dropper and --lighter: two different throwaway accounts');
const botsDir = resolve(arg('bots-dir', join(ROOT, 'bots')));
const runDir = resolve(arg('run-dir', join(ROOT, 'run-machine', `fm-demo-${Date.now()}`)));
const gatewayPort = Number(arg('gateway-port', '7811'));
const logs = Number(arg('logs', '20'));
// 'lab' is the local lab engine lab.sh started (its WEB_PORT): lab.sh splits script arguments on ':'.
const serverArg = arg('server', '');
const server = serverArg === 'lab' ? `localhost:${process.env.WEB_PORT ?? 9300}` : serverArg;
/** A launcher phase's hard bound: past it the launcher is stopped (SIGINT: roles stop, accounts log out). */
const phaseMs = Number(arg('phase-min', '15')) * 60_000;
const has = (f: string) => process.argv.includes(`--${f}`);
const tiles = parseTiles(LUMBRIDGE_ROW).slice(0, logs).map(t => [t[0], t[1]] as [number, number]);
if (tiles.length < logs) throw new Error(`the row has ${tiles.length} tiles, fewer than ${logs} logs`);
const say = (m: string, d?: unknown) => console.log(`fm-demo-run: ${m}${d === undefined ? '' : ` ${JSON.stringify(d)}`}`);

if (has('create')) {
    for (const a of [dropper, lighter]) {
        if (existsSync(join(botsDir, a, 'bot.env'))) continue;
        await (server ? createAccountEnv(botsDir, a, server) : createAccountEnv(botsDir, a));
        say('bot.env written', { account: a, botsDir });
    }
}

interface LauncherRun {
    exit: number | null;
    logouts: Record<string, unknown>;
    roleLines: Record<string, string[]>;
}

/** One launcher run to completion: the config, its exit, each account's logout outcome and role log. */
async function launch(phase: string, accounts: unknown[]): Promise<LauncherRun> {
    const dir = join(runDir, phase);
    mkdirSync(dir, { recursive: true });
    const cfg = { gatewayPort, botsDir, runDir: dir, loginSpacingMs: 5000, accounts };
    writeFileSync(join(dir, 'launch.json'), JSON.stringify(cfg, null, 2));
    say(`${phase}: launching`, { dir, accounts: (accounts as Array<{ account: string; role: string }>).map(a => `${a.account}:${a.role}`) });
    const p = Bun.spawn([process.execPath, 'speedrun/helpers/standalone.ts', join(dir, 'launch.json')], {
        cwd: ROOT,
        stdout: Bun.file(join(dir, 'launcher.out')),
        stderr: Bun.file(join(dir, 'launcher.err'))
    });
    let timedOut = false;
    const exit = await Promise.race([
        p.exited,
        Bun.sleep(phaseMs).then(async () => {
            timedOut = true;
            say(`${phase}: over ${phaseMs / 60_000} min, stopping the launcher`);
            p.kill('SIGINT');
            const e = await Promise.race([p.exited, Bun.sleep(90_000).then(() => null)]);
            if (e === null) p.kill('SIGKILL');
            return p.exited;
        })
    ]);
    if (timedOut) say(`${phase}: stopped at the phase bound`);
    const state = existsSync(join(dir, 'launcher.json'))
        ? (JSON.parse(readFileSync(join(dir, 'launcher.json'), 'utf8')) as { accounts?: Array<{ account: string; logout?: unknown; logins?: number }> })
        : {};
    const logouts: Record<string, unknown> = {};
    const roleLines: Record<string, string[]> = {};
    for (const a of state.accounts ?? []) {
        logouts[a.account] = { logout: a.logout ?? null, logins: a.logins ?? null };
        const f = join(dir, 'logs', `${a.account}.role.log`);
        roleLines[a.account] = existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
    }
    say(`${phase}: launcher exited ${exit}`, logouts);
    return { exit, logouts, roleLines };
}

const out: Record<string, unknown> = { dropper, lighter, logs, tiles: `${tiles[0]!.join(',')} .. ${tiles.at(-1)!.join(',')}`, runDir };

if (!has('skip-stage')) {
    const stage = await launch('stage', [{ account: dropper, role: 'fm-demo', final: true, options: { mode: 'stage', tiles, logs } }]);
    const staged = stage.roleLines[dropper]?.find(l => l.includes('"staged"') || l.includes('staged'));
    out.stage = { exit: stage.exit, logouts: stage.logouts, staged: staged ?? null };
    if (!staged) {
        result('fm-demo-run', { ...out, ended: 'staging did not finish' });
        process.exit(1);
    }
}

const row = await launch('row', [
    { account: dropper, role: 'fm-row', options: { tiles, logs: [{ obj: 'logs', n: logs }], restock: { kind: 'held' }, start: 'sighted', scoredSha256: nameHash(lighter) } },
    { account: lighter, role: 'fm-demo', receiver: true, final: true, options: { mode: 'light', tiles, fires: logs } }
]);
// The launcher's role log prefixes each line with a timestamp.
const verdictLine = row.roleLines[lighter]?.find(l => l.includes('RESULT fm-demo '));
const verdict = verdictLine?.slice(verdictLine.indexOf('RESULT fm-demo '));
const dropperEnd = row.roleLines[dropper]?.filter(l => /fm-row: finished|"lost"|warning|start"/.test(l));
out.row = { exit: row.exit, logouts: row.logouts, dropper: dropperEnd ?? [] };
out.verdict = verdict ? JSON.parse(verdict.slice('RESULT fm-demo '.length)) : null;
result('fm-demo-run', out);
process.exit(verdict && (out.verdict as { pass?: boolean }).pass ? 0 : 1);
