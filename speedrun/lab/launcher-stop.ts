// The run-machine launcher's bounded stop against the local lab engine, with N idle accounts
// (cairn_ls01..; --accounts=N, default 22; the first --relay=K, default 1, on the relay path, the
// rest direct), three launches:
//   A. start, stop: every account must report a logout outcome inside the deadline;
//   B. start, SIGKILL the first direct account's client by the PID the launcher logged (the player
//      lingers, as rs/214's killed accounts did), stop at once;
//   C. start again at once: that account's first login must wait until /playerpositions drops the
//      earlier copy, then everything logs in and stops cleanly.
// Prints a RESULT line per phase with every account's outcome (out, queued, unconfirmed, killed,
// not-in-world) and the launcher's stop line. Through lab.sh, which starts the engine (its own lite
// runner and gateway are not used):
//
//   LAB_RUNNERS=0 WEB_PORT=9496 WEB_MANAGEMENT_PORT=9497 HISCORES_WEB_PORT=9498 NODE_PORT=44196 AGENT_PORT=8496 \
//     speedrun/lab/lab.sh stoplab speedrun/lab/launcher-stop.ts:--accounts=22
// The names exist on the lab engine alone; credentials are throwaway, written to a temp directory.
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Subprocess } from 'bun';
import { listedInWorld } from '../lib/demo-status';

const ROOT = resolve(import.meta.dir, '..', '..');
const flag = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const n = Number(flag('accounts', '22'));
const relay = Number(flag('relay', '1'));
const stopDeadlineMs = Number(flag('deadline-ms', '25000'));
if (!Number.isInteger(n) || n < 1 || n > 60) throw new Error(`--accounts must be 1-60 (got ${n})`);
const webPort = process.env.WEB_PORT ?? '9300';
const origin = `http://localhost:${webPort}`;
const base = mkdtempSync(join(tmpdir(), 'launcher-stop-'));
const botsDir = join(base, 'bots');
const runDir = join(base, 'run');
const accounts: [string, 'direct' | 'relay'][] = Array.from({ length: n }, (_, i) => [`cairn_ls${String(i + 1).padStart(2, '0')}`, i < relay ? 'relay' : 'direct']);
const victim = accounts.find(([, p]) => p === 'direct')?.[0];
if (!victim) throw new Error('phase B needs a direct account: --relay must be below --accounts');
for (const [account] of accounts) {
    mkdirSync(join(botsDir, account), { recursive: true, mode: 0o700 });
    writeFileSync(join(botsDir, account, 'bot.env'), `BOT_USERNAME=${account}\nPASSWORD=${randomBytes(6).toString('hex')}\nSERVER=localhost:${webPort}\nSHOW_CHAT=false\nTELEMETRY=false\nPROFANITY_FILTER=false\n`, {
        mode: 0o600
    });
}
const configPath = join(base, 'launch.json');
writeFileSync(
    configPath,
    JSON.stringify({ gatewayPort: Number(process.env.STOP_LAB_GW_PORT ?? 8476), botsDir, runDir, loginSpacingMs: 1000, stopDeadlineMs, accounts: accounts.map(([account, path]) => ({ account, role: 'idle', path })) }, null, 2)
);
console.log(`launcher-stop: ${n} accounts (${relay} relay, ${n - relay} direct), stopDeadlineMs ${stopDeadlineMs}; files in ${base}`);

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const t0 = Date.now();
const results: string[] = [];

/** The launcher of the phase in progress: stopped on any failure, so a failed check never leaves it (or its gateway) running. */
let current: { child: Subprocess } | null = null;
/** Read through a call: TypeScript would narrow `current` to null where only called functions assign it. */
const running = (): { child: Subprocess } | null => current;

function launch(phase: string) {
    const lines: string[] = [];
    const child = Bun.spawn([process.execPath, 'speedrun/helpers/standalone.ts', configPath], { cwd: ROOT, env: process.env, stdout: 'pipe', stderr: 'inherit' });
    void (async () => {
        const decoder = new TextDecoder();
        let buf = '';
        const reader = child.stdout.getReader();
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, nl);
                buf = buf.slice(nl + 1);
                lines.push(line);
                console.log(`[${phase} +${((Date.now() - t0) / 1000).toFixed(1)}s] ${line}`);
            }
        }
    })();
    current = { child };
    return { child, lines };
}

async function until(what: string, ok: () => boolean, ms: number): Promise<void> {
    const end = Date.now() + ms;
    while (!ok()) {
        if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
        await sleep(250);
    }
}

const ready = () => {
    try {
        return (JSON.parse(readFileSync(join(runDir, 'launcher.json'), 'utf8')) as { helpersReady: boolean }).helpersReady;
    } catch {
        return false;
    }
};
const outcomes = () => {
    const list = (JSON.parse(readFileSync(join(runDir, 'launcher.json'), 'utf8')) as { accounts: { account: string; logout?: string | null }[] }).accounts;
    const counts: Record<string, number> = {};
    for (const a of list) counts[String(a.logout)] = (counts[String(a.logout)] ?? 0) + 1;
    return `${JSON.stringify(counts)} ${list.map(a => `${a.account}=${a.logout}`).join(' ')}`;
};

async function stop(phase: string, run: ReturnType<typeof launch>): Promise<void> {
    const at = Date.now();
    run.child.kill('SIGTERM');
    const code = await run.child.exited;
    current = null;
    await sleep(200);
    const summary = run.lines.find(l => l.includes('[launcher] stop: ')) ?? '(no stop line)';
    const still = (await Promise.all(accounts.map(async ([a]) => ((await listedInWorld(origin, a)) ? a : null)))).filter(Boolean);
    results.push(`RESULT ${phase}: stop took ${Date.now() - at} ms, exit ${code}; ${outcomes()}; ${summary.slice(summary.indexOf('stop: '))}; still listed after the stop: ${still.length ? still.join(', ') : 'none'}`);
}

const bound = setTimeout(() => {
    console.log('launcher-stop: 45 min bound reached');
    current?.child.kill('SIGTERM');
    console.log(results.join('\n'));
    process.exit(1);
}, 45 * 60_000);

const loginMs = Math.max(180_000, n * 30_000);
try {
    // A
    const a = launch('A');
    await until('A ready', ready, loginMs);
    await sleep(3000);
    await stop('A', a);

    // B
    writeFileSync(join(runDir, 'launcher.json'), '{}');
    const b = launch('B');
    await until('B ready', ready, loginMs);
    await sleep(2000);
    const pidLine = b.lines.find(l => new RegExp(`${victim}: role idle started \\(pid \\d+\\)`).test(l));
    const pid = Number(/\(pid (\d+)\)/.exec(pidLine ?? '')?.[1]);
    if (!pid) throw new Error(`no PID logged for ${victim}'s role`);
    process.kill(pid, 'SIGKILL');
    const killedAt = Date.now();
    await sleep(1500);
    results.push(`RESULT B: SIGKILLed ${victim}'s direct client (pid ${pid}); listed 1.5 s later: ${await listedInWorld(origin, victim)}`);
    await stop('B', b);

    // C
    writeFileSync(join(runDir, 'launcher.json'), '{}');
    const c = launch('C');
    await until('C ready', ready, loginMs + 6 * 60_000);
    const waited = c.lines.find(l => l.includes(`${victim}: still in the world from an earlier session`));
    const left = c.lines.find(l => new RegExp(`${victim}: left the world after`).test(l));
    const leftOthers = c.lines.filter(l => /: left the world after/.test(l) && !l.includes(victim)).length;
    const inWorld = c.lines.find(l => new RegExp(`${victim}: in the world`).test(l));
    results.push(`RESULT C: ${victim} waited for the earlier copy: ${waited ? 'yes' : 'no'}; ${left ? left.slice(left.indexOf(victim)) : 'no left line'}; in the world ${inWorld ? 'yes' : 'no'} (${Math.round((Date.now() - killedAt) / 1000)} s after the kill); 'left the world' lines for other accounts: ${leftOthers}`);
    await sleep(2000);
    await stop('C', c);
} catch (e) {
    console.log(`launcher-stop failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
} finally {
    clearTimeout(bound);
    // the launcher's own bounded stop (25 s by default) closes its clients and gateway
    const left = running();
    if (left && left.child.exitCode === null) {
        left.child.kill('SIGTERM');
        await Promise.race([left.child.exited, sleep(40_000)]);
    }
    console.log(results.join('\n'));
}
process.exit(process.exitCode ?? 0);
