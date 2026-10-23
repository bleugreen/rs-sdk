// The run-machine launcher's cue gate (stopOn, loginOn) against the local lab engine, six idle accounts
// (cairn_lc01..06) sharing one cue directory, and the cues written here as run.ts would:
//   lc01 relay   no gate                         stays in until the launcher's stop (no regression)
//   lc02 relay   stopOn  S06/altar                stays in across a segment stop and the next session (as
//                                                runecraft.ts writes S21's), logs out on the final stop
//   lc03 direct  stopOn  S06/altar                the same on the direct path
//   lc04 relay   loginOn H12o/mule                ignores other cues; logs in on H12o's open; stays in on its
//                                                plain stop, out when the next scope's cue opens
//   lc05 relay   loginOn S21/altar                S21's final stop comes first: it never logs in
//   lc06 direct  loginOn S99/ring, 0.25 min      no cue: its wait expires, it never logs in
//   lc07 relay   loginOn H12o/mule in its login   h45's shape, two folders, one writer each: H12o's open in the
//                folder, stopOn H12oP/mule in    shared folder or in its role folder does nothing; its login
//                its role folder                 folder's open logs it in, that folder's stop and final leave it
//                                                in; the role folder's H12oP plain stop leaves it in, its final
//                                                logs it out
//   lc08 relay   as lc07, own folders            its role folder's H12oP final before its trigger: it never logs in
// helpersReady holds while lc04-lc08 wait logged out (ready-or-waiting). Before the launch an S06/altar
// final stop is left in cue.json, as an earlier attempt would: it must not keep lc02/lc03 out.
// Prints RESULT lines (and FAIL lines for any check that does not hold). Through lab.sh, which starts the engine (its own lite runner and gateway are not used):
//
//   LAB_RUNNERS=0 WEB_PORT=9496 WEB_MANAGEMENT_PORT=9497 HISCORES_WEB_PORT=9498 NODE_PORT=44196 AGENT_PORT=8496 \
//     speedrun/lab/lab.sh cuelab speedrun/lab/launcher-cue.ts
// The names exist on the lab engine alone; credentials are throwaway, written to a temp directory.
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Subprocess } from 'bun';
import { listedInWorld } from '../lib/demo-status';
import { CueWriter, type CueScope } from '../helpers/altar-cue';
import type { LauncherStatus } from '../helpers/standalone';

const ROOT = resolve(import.meta.dir, '..', '..');
const webPort = process.env.WEB_PORT ?? '9300';
const origin = `http://localhost:${webPort}`;
const base = mkdtempSync(join(tmpdir(), 'launcher-cue-'));
const botsDir = join(base, 'bots');
const runDir = join(base, 'run');
const cueDir = join(base, 'cue');
const S06: CueScope = { step: 'S06', family: 'altar' };
const S21: CueScope = { step: 'S21', family: 'altar' };
const H12O: CueScope = { step: 'H12o', family: 'mule' };
const M: CueScope = { step: 'H12oM', family: 'mule' };
const P: CueScope = { step: 'H12oP', family: 'mule' };
const lc07Role = join(base, 'lc07-cue');
const lc07Login = join(base, 'lc07-login');
const lc08Role = join(base, 'lc08-cue');
const lc08Login = join(base, 'lc08-login');

const accounts: Record<string, unknown>[] = [
    { account: 'cairn_lc01', path: 'relay' },
    { account: 'cairn_lc02', path: 'relay', stopOn: S06 },
    { account: 'cairn_lc03', path: 'direct', stopOn: S06 },
    { account: 'cairn_lc04', path: 'relay', loginOn: H12O },
    { account: 'cairn_lc05', path: 'relay', loginOn: S21 },
    { account: 'cairn_lc06', path: 'direct', loginOn: { step: 'S99', family: 'ring', waitMinutes: 0.25 } },
    { account: 'cairn_lc07', path: 'relay', cueDir: lc07Role, loginOn: { ...H12O, cueDir: lc07Login }, stopOn: P },
    { account: 'cairn_lc08', path: 'relay', cueDir: lc08Role, loginOn: { ...H12O, cueDir: lc08Login }, stopOn: P }
];
for (const a of accounts) {
    const name = String(a.account);
    mkdirSync(join(botsDir, name), { recursive: true, mode: 0o700 });
    writeFileSync(join(botsDir, name, 'bot.env'), `BOT_USERNAME=${name}\nPASSWORD=${randomBytes(6).toString('hex')}\nSERVER=localhost:${webPort}\nSHOW_CHAT=false\nTELEMETRY=false\nPROFANITY_FILTER=false\n`, { mode: 0o600 });
}
const configPath = join(base, 'launch.json');
writeFileSync(
    configPath,
    JSON.stringify({ gatewayPort: Number(process.env.CUE_LAB_GW_PORT ?? 8477), botsDir, runDir, loginSpacingMs: 1000, accounts: accounts.map(a => ({ cueDir, ...a, role: 'idle' })) }, null, 2)
);
console.log(`launcher-cue: files in ${base}`);

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const t0 = Date.now();
const results: string[] = [];
const lines: string[] = [];
const beacon = () => [{ tick: 1, ms: Date.now() }];
const check = (ok: boolean, what: string) => results.push(`${ok ? 'RESULT' : 'FAIL'} ${what}`);
const status = (): LauncherStatus | null => {
    try {
        return JSON.parse(readFileSync(join(runDir, 'launcher.json'), 'utf8')) as LauncherStatus;
    } catch {
        return null;
    }
};
const acct = (name: string) => status()?.accounts.find(a => a.account === name);
const listed = (name: string) => listedInWorld(origin, name);
const lineAt = (re: RegExp) => lines.find(l => re.test(l));

async function until(what: string, ok: () => boolean | Promise<boolean>, ms: number): Promise<number> {
    const start = Date.now();
    while (!(await ok())) {
        if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
        await sleep(100);
    }
    return Date.now() - start;
}

// An earlier attempt's final stop, left in cue.json before this launch.
new CueWriter(cueDir, 'scored', S06).stop(beacon(), { final: true });
await sleep(50);

const child: Subprocess<'ignore', 'pipe', 'inherit'> = Bun.spawn([process.execPath, 'speedrun/helpers/standalone.ts', configPath], { cwd: ROOT, env: process.env, stdin: 'ignore', stdout: 'pipe', stderr: 'inherit' });
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
            console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${line}`);
        }
    }
})();

const bound = setTimeout(() => {
    console.log('launcher-cue: 20 min bound reached');
    child.kill('SIGTERM');
    console.log(results.join('\n'));
    process.exit(1);
}, 20 * 60_000);

try {
    await until('helpersReady', () => status()?.helpersReady === true, 240_000);
    const atReady = status()!.accounts;
    check(
        ['cairn_lc04', 'cairn_lc05', 'cairn_lc07', 'cairn_lc08'].every(n => atReady.find(a => a.account === n)?.cue?.state === 'waiting'),
        `helpersReady with lc01-lc03 online and lc04-lc08 logged out waiting for their cues: ${atReady.map(a => `${a.account}=${a.state}/${a.cue?.state ?? '-'}`).join(' ')}`
    );
    check(acct('cairn_lc02')?.state === 'online' && acct('cairn_lc03')?.state === 'online', 'the stop left from before the launch kept nobody out (lc02, lc03 online)');

    // lc06: no cue for S99/ring within 15 s.
    await until('lc06 expiry', () => !!lineAt(/cairn_lc06: no cue for S99\/ring within/), 60_000);
    check(acct('cairn_lc06')?.cue?.state === 'expired' && acct('cairn_lc06')?.logins === 0 && !(await listed('cairn_lc06')), `lc06's wait expired and it never logged in (${acct('cairn_lc06')?.state}, logins ${acct('cairn_lc06')?.logins})`);

    // Other steps' and families' cues open nothing for lc04.
    new CueWriter(cueDir, 'scored', { step: 'S07', family: 'bone' }).write({ beacons: beacon(), turns: [] });
    await sleep(1500);
    new CueWriter(cueDir, 'scored', { step: 'H12', family: 'mule' }).write({ beacons: beacon(), turns: [] });
    await sleep(1500);
    new CueWriter(cueDir, 'scored', { step: 'H12o', family: 'ring' }).write({ beacons: beacon(), turns: [] });
    await sleep(3000);
    check(acct('cairn_lc04')?.state === 'awaiting-cue' && acct('cairn_lc04')?.logins === 0 && !(await listed('cairn_lc04')), `S07/bone, H12/mule and H12o/ring opened nothing for lc04 (${acct('cairn_lc04')?.state})`);

    // S21's final stop before its open: lc05 never logs in, even when S21 opens afterwards.
    const s21 = new CueWriter(cueDir, 'scored', S21);
    s21.stop(beacon(), { final: true });
    await until('lc05 never logs in', () => !!lineAt(/cairn_lc05: final stop for S21\/altar .* before its login: it never logs in/), 5000);
    new CueWriter(cueDir, 'scored', S21).write({ beacons: beacon(), turns: [] });
    await sleep(4000);
    check(acct('cairn_lc05')?.logins === 0 && acct('cairn_lc05')?.cue?.state === 'stopped' && !(await listed('cairn_lc05')), `lc05: S21's stop before its open kept it out, and a later open did not log it in (${acct('cairn_lc05')?.state})`);

    // H12o opens: lc04 logs in.
    const h12o = new CueWriter(cueDir, 'scored', H12O);
    const openAt = Date.now();
    h12o.write({ beacons: beacon(), turns: [] });
    const inMs = await until('lc04 in the world', () => acct('cairn_lc04')?.state === 'online', 120_000);
    const roleMs = await until('lc04 role started', () => !!lineAt(/cairn_lc04: role idle started/), 60_000).then(() => Date.now() - openAt);
    // /playerpositions trails the launcher's in-world line by a moment: poll it, as for the logouts below.
    const listedMs = await until('lc04 listed', async () => (await listed('cairn_lc04')) === true, 10_000).then(() => Date.now() - openAt);
    check(acct('cairn_lc04')?.logins === 1, `lc04 logged in on H12o/mule's open: in the world ${inMs} ms after the write, role started ${roleMs} ms, listed ${listedMs} ms after it (logins ${acct('cairn_lc04')?.logins})`);

    // S06 as runecraft.ts writes S21: a segment's stop, a new session (the robust restart, the stock rung,
    // the hand-back), then the step's final stop. lc02 (relay) and lc03 (direct) stay in until the final stop.
    const seg1 = new CueWriter(cueDir, 'scored', S06);
    seg1.write({ beacons: beacon(), turns: [] });
    await sleep(500);
    const segStopAt = Date.now();
    seg1.stop(beacon());
    for (const name of ['cairn_lc02', 'cairn_lc03']) await until(`${name} stood down`, () => acct(name)?.cue?.state === 'stood-down', 10_000);
    await sleep(5000);
    for (const name of ['cairn_lc02', 'cairn_lc03']) {
        const a = acct(name);
        const inWorld = (await listed(name)) === true;
        check(
            a?.state === 'online' && a.cue?.state === 'stood-down' && a.logout == null && inWorld && !lineAt(new RegExp(`${name}: out of the run`)),
            `${name} (${a?.path}) stayed in the world ${Date.now() - segStopAt} ms after S06's segment stop (state ${a?.state}, gate ${a?.cue?.state}, listed ${inWorld})`
        );
    }
    check(status()?.helpersReady === true, 'helpersReady true while lc02 and lc03 stand down between segments');
    const seg2 = new CueWriter(cueDir, 'scored', S06);
    seg2.write({ beacons: beacon(), turns: [] });
    for (const name of ['cairn_lc02', 'cairn_lc03']) await until(`${name} watching`, () => acct(name)?.cue?.state === 'watching', 10_000);
    await sleep(2000);
    seg2.stop(beacon());
    await sleep(3000);
    const both = ['cairn_lc02', 'cairn_lc03'];
    check(
        both.every(n => acct(n)?.state === 'online' && acct(n)?.cue?.state === 'stood-down'),
        `after the new session and its plain stop, lc02 and lc03 are still in (${both.map(n => `${n}=${acct(n)?.state}/${acct(n)?.cue?.state}`).join(' ')})`
    );
    const stopAt = Date.now();
    seg2.stop(beacon(), { final: true });
    for (const name of both) {
        const ms = await until(`${name} out`, () => !!lineAt(new RegExp(`${name}: out of the run on its stop cue`)), 60_000);
        const goneMs = await until(`${name} unlisted`, async () => (await listed(name)) === false, 30_000).then(() => Date.now() - stopAt);
        check(acct(name)?.logout === 'out' && acct(name)?.cue?.state === 'stopped', `${name} (${acct(name)?.path}) logged out on S06's final stop: reported ${ms} ms after the write, unlisted ${goneMs} ms after it (logout: ${acct(name)?.logout})`);
    }
    await sleep(2000);
    check(acct('cairn_lc01')?.state === 'online' && (await listed('cairn_lc01')) === true, "lc01 (no gate) is still in after S06's final stop");
    check(status()?.helpersReady === true, 'helpersReady still true after lc02 and lc03 left on their final stop');

    // H12o's plain stop after its trade: lc04 stays in; the next scope's open (S07/bone) logs it out.
    h12o.stop(beacon());
    await until('lc04 stood down', () => acct('cairn_lc04')?.cue?.state === 'stood-down', 10_000);
    await sleep(3000);
    check(acct('cairn_lc04')?.state === 'online' && (await listed('cairn_lc04')) === true, `lc04 stayed in on H12o's plain stop (gate ${acct('cairn_lc04')?.cue?.state})`);
    const nextAt = Date.now();
    new CueWriter(cueDir, 'scored', { step: 'S07', family: 'bone' }).write({ beacons: beacon(), turns: [] });
    const outMs = await until('lc04 out', () => !!lineAt(/cairn_lc04: out of the run on its stop cue/), 60_000);
    const goneMs = await until('lc04 unlisted', async () => (await listed('cairn_lc04')) === false, 30_000).then(() => Date.now() - nextAt);
    check(
        acct('cairn_lc04')?.logout === 'out' && acct('cairn_lc04')?.cue?.state === 'stopped' && !!lineAt(/cairn_lc04: cue for S07\/bone .* after H12o\/mule's stop/),
        `lc04 logged out when S07/bone opened after H12o's stop: reported ${outMs} ms after the write, unlisted ${goneMs} ms after it (logout: ${acct('cairn_lc04')?.logout})`
    );

    // lc07, lc08: a login-only folder (loginOn.cueDir) beside the role folder, one writer each.
    const out = async (name: string) => acct(name)?.state === 'awaiting-cue' && acct(name)?.logins === 0 && !(await listed(name));
    check(await out('cairn_lc07'), `H12o/mule's open in the shared folder (lc04's trigger) did not log lc07 in (${acct('cairn_lc07')?.state})`);
    new CueWriter(lc07Role, 'scored', H12O).write({ beacons: beacon(), turns: [] }); // the trigger's scope, in the role folder
    await sleep(1500);
    new CueWriter(lc07Role, 'scored', M).write({ beacons: beacon(), turns: [] }); // MM's M open before the trigger
    await sleep(3000);
    check(await out('cairn_lc07'), `H12o/mule and H12oM/mule in lc07's role folder did not log it in (${acct('cairn_lc07')?.state})`);

    new CueWriter(lc08Role, 'scored', P).stop(beacon(), { final: true });
    await until('lc08 never logs in', () => !!lineAt(/cairn_lc08: final stop for H12oP\/mule .* before its login: it never logs in/), 5000);
    new CueWriter(lc08Login, 'scored', H12O).write({ beacons: beacon(), turns: [] });
    await sleep(4000);
    check(
        acct('cairn_lc08')?.logins === 0 && acct('cairn_lc08')?.cue?.state === 'stopped' && !(await listed('cairn_lc08')),
        `lc08: its role folder's H12oP final before the trigger kept it out, and the trigger after it did not log it in (${acct('cairn_lc08')?.state})`
    );

    const trigger = new CueWriter(lc07Login, 'scored', H12O);
    const triggerAt = Date.now();
    trigger.write({ beacons: beacon(), turns: [] });
    const in07 = await until('lc07 in the world', () => acct('cairn_lc07')?.state === 'online', 120_000);
    await until('lc07 listed', async () => (await listed('cairn_lc07')) === true, 10_000);
    check(acct('cairn_lc07')?.logins === 1, `lc07 logged in on its login folder's H12o open: in the world ${in07} ms after the write (logins ${acct('cairn_lc07')?.logins})`);
    check(lc08Role !== lc07Role && acct('cairn_lc07')?.cue?.state === 'opened', `lc08's H12oP final in its own role folder did not touch lc07 (gate ${acct('cairn_lc07')?.cue?.state})`);
    trigger.stop(beacon());
    await sleep(1000);
    trigger.stop(beacon(), { final: true });
    await sleep(5000);
    check(
        acct('cairn_lc07')?.state === 'online' && (await listed('cairn_lc07')) === true && !lineAt(/cairn_lc07: out of the run/),
        `lc07 stayed in after its login folder's stop and final (${Date.now() - triggerAt} ms after the trigger; state ${acct('cairn_lc07')?.state})`
    );
    const mm = new CueWriter(lc07Role, 'scored', P);
    mm.write({ beacons: beacon(), turns: [] });
    await sleep(1500);
    mm.stop(beacon());
    await until('lc07 stood down', () => acct('cairn_lc07')?.cue?.state === 'stood-down', 10_000);
    await sleep(3000);
    check(acct('cairn_lc07')?.state === 'online' && (await listed('cairn_lc07')) === true, `lc07 stayed in on its role folder's H12oP plain stop (gate ${acct('cairn_lc07')?.cue?.state})`);
    const finalAt = Date.now();
    mm.stop(beacon(), { final: true });
    const out07 = await until('lc07 out', () => !!lineAt(/cairn_lc07: out of the run on its stop cue/), 60_000);
    const gone07 = await until('lc07 unlisted', async () => (await listed('cairn_lc07')) === false, 30_000).then(() => Date.now() - finalAt);
    check(
        acct('cairn_lc07')?.logout === 'out' && acct('cairn_lc07')?.cue?.state === 'stopped',
        `lc07 logged out on its role folder's H12oP final: reported ${out07} ms after the write, unlisted ${gone07} ms after it (logout: ${acct('cairn_lc07')?.logout})`
    );

    // No account restarts or logs back in after leaving.
    await sleep(5000);
    const logins = Object.fromEntries((status()?.accounts ?? []).map(a => [a.account, a.logins]));
    check(
        logins.cairn_lc02 === 1 && logins.cairn_lc03 === 1 && logins.cairn_lc04 === 1 && logins.cairn_lc07 === 1 && logins.cairn_lc08 === 0,
        `no relogin after leaving: ${JSON.stringify(logins)}`
    );
} catch (e) {
    results.push(`FAIL launcher-cue: ${e instanceof Error ? e.message : String(e)}`);
} finally {
    clearTimeout(bound);
    if (child.exitCode === null) {
        child.kill('SIGTERM');
        await Promise.race([child.exited, sleep(40_000)]);
    }
    const summary = lines.find(l => l.includes('[launcher] stop: ')) ?? '(no stop line)';
    const still = (await Promise.all(accounts.map(async a => ((await listed(String(a.account))) ? a.account : null)))).filter(Boolean);
    results.push(`RESULT launcher stop: ${summary.slice(summary.indexOf('stop: '))}; still listed: ${still.length ? still.join(', ') : 'none'}`);
    console.log(results.join('\n'));
    if (results.some(r => r.startsWith('FAIL'))) process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
