// STEP-MANIFEST.md entry 33's demo acceptance (H1 at S01) on a throwaway. rs/41's second trade giver
// (kits.ts, the S01 kit giver) hands a stand-in package of H1's shape (speedrun/lab/fixtures/
// handoff-h1-demo.md) to a fresh account straight after S00's tutorialSkip; the receiving side is
// runner/handoff.ts's H1 step (helpers/handoff-demo.ts). Every client drives through a run-machine
// launcher's loopback gateway (standalone.ts), never the demo relay, and ticks are observed ticks on the
// receiver's clock. Three phases, each bounded by --phase-min (default 10):
//
//   1. buy      the giver's buyer run tops its holdings up to the package's rune counts at Aubury (final).
//   2. serve    the giver's kits run stages the package at Draynor and stands at 3222,3222; left running.
//   3. receive  once the giver logs `kit staged`: the throwaway's first login (receiver, final), S00, then
//               H1 at once; it then hands the package back (untimed) and the giver banks it. The serve
//               launcher is stopped after that, which logs the giver out.
//
//   timeout --kill-after=60s 40m bun speedrun/lab/h1-demo.ts --giver=cairn_mule2 --receiver=cairn_x01 \
//     --giver-bots=DIR --receiver-bots=DIR [--create] [--gateway-port=7821] [--run-dir=DIR] [--skip-buy]
//
// The two accounts' credentials may live apart (the giver's in the fleet host's bots/, read in place;
// the throwaway's in its own folder), so each runs under its own launcher and gateway (--gateway-port
// for the giver's, the next port for the receiver's). --create writes the receiver's missing bot.env with
// accounts.ts createAccountEnv (dir 700, file 600); the account is created by its first login.
// Prints one RESULT line.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Subprocess } from 'bun';
import { createAccountEnv } from '../helpers/accounts';
import { loadHandOff } from '../runner/handoff';
import { arg, result } from './common';

const ROOT = resolve(import.meta.dir, '..', '..');
const LEDGER = 'speedrun/lab/fixtures/handoff-h1-demo.md';

const giver = arg('giver', '');
const receiver = arg('receiver', '');
if (!giver || !receiver || giver === receiver) throw new Error('--giver and --receiver: two different accounts');
const giverBots = resolve(arg('giver-bots', join(ROOT, 'bots')));
const receiverBots = resolve(arg('receiver-bots', join(ROOT, 'bots')));
const runDir = resolve(arg('run-dir', join(ROOT, 'run-machine', `h1-demo-${Date.now()}`)));
const gatewayPort = Number(arg('gateway-port', '7821'));
const phaseMs = Number(arg('phase-min', '10')) * 60_000;
const has = (f: string) => process.argv.includes(`--${f}`);
const say = (m: string, d?: unknown) => console.log(`h1-demo: ${new Date().toISOString()} ${m}${d === undefined ? '' : ` ${JSON.stringify(d)}`}`);

const plan = loadHandOff('H1', join(ROOT, LEDGER));
/** The package as kits.ts spells a kit, from the stand-in row (the row is the one source of names and counts). */
const kit = plan.receive.map(r => ({ item: r.name.charAt(0).toUpperCase() + r.name.slice(1), amount: r.count }));
/** The buyer's targets are what the giver must HOLD (bank and pack), so a rerun buys only the shortfall. */
const buy = kit.filter(k => / rune$/i.test(k.item)).map(k => ({ item: k.item, quantity: k.amount, source: 'shop', shop: 'aubury', maxWaitTicks: 200 }));

if (has('create') && !existsSync(join(receiverBots, receiver, 'bot.env'))) {
    mkdirSync(receiverBots, { recursive: true, mode: 0o700 });
    await createAccountEnv(receiverBots, receiver);
    say('bot.env written', { account: receiver, botsDir: receiverBots });
}

interface Launch {
    dir: string;
    proc: Subprocess;
    /** Wait for the launcher to exit, SIGINT at `ms` (roles stop, accounts log out), SIGKILL 90 s after that. */
    finish(ms: number): Promise<number | null>;
}

function launch(phase: string, botsDir: string, port: number, accounts: unknown[]): Launch {
    const dir = join(runDir, phase);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'launch.json'), JSON.stringify({ gatewayPort: port, botsDir, runDir: dir, loginSpacingMs: 5000, accounts }, null, 2));
    say(`${phase}: launching`, { dir, port, accounts: (accounts as Array<{ account: string; role: string }>).map(a => `${a.account}:${a.role}`) });
    const proc = Bun.spawn([process.execPath, 'speedrun/helpers/standalone.ts', join(dir, 'launch.json')], {
        cwd: ROOT,
        stdout: Bun.file(join(dir, 'launcher.out')),
        stderr: Bun.file(join(dir, 'launcher.err')),
    });
    let stopping: Promise<number | null> | null = null;
    const stop = (why: string) =>
        (stopping ??= (async () => {
            say(`${phase}: stopping the launcher (${why})`);
            proc.kill('SIGINT');
            const e = await Promise.race([proc.exited, Bun.sleep(90_000).then(() => null)]);
            if (e === null) proc.kill('SIGKILL');
            return proc.exited;
        })());
    return {
        dir,
        proc,
        finish: ms => Promise.race([proc.exited, Bun.sleep(ms).then(() => stop(`${ms / 60_000} min bound`))]),
    };
}

const lines = (dir: string, account: string): string[] => {
    const f = join(dir, 'logs', `${account}.role.log`);
    return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
};
const message = (l: string, m: string) => l.includes(`"message":"${m}"`);

/** Poll an account's role log until a line matches `ok` (resolves it) or `bad` (resolves null), or `ms` passes. */
async function waitForLine(l: Launch, account: string, ok: (line: string) => boolean, bad: (line: string) => boolean, ms: number, from = 0): Promise<string | null> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline && l.proc.exitCode === null) {
        const ls = lines(l.dir, account).slice(from);
        const hit = ls.find(x => ok(x) || bad(x));
        if (hit) return ok(hit) ? hit : null;
        await Bun.sleep(1000);
    }
    return null;
}

function state(l: Launch): Record<string, unknown> {
    const f = join(l.dir, 'launcher.json');
    if (!existsSync(f)) return {};
    const s = JSON.parse(readFileSync(f, 'utf8')) as { accounts?: Array<{ account: string; logout?: unknown; logins?: number }> };
    return Object.fromEntries((s.accounts ?? []).map(a => [a.account, { logout: a.logout ?? null, logins: a.logins ?? null }]));
}

const lastBank = (dir: string) => lines(dir, giver).filter(l => l.includes('"bank":[')).at(-1)?.replace(/^\S+ /, '') ?? null;

const out: Record<string, unknown> = { giver, receiver, runDir, kit, ledger: LEDGER };
let code = 1;

if (!has('skip-buy')) {
    const b = launch('buy', giverBots, gatewayPort, [{ account: giver, role: 'buyer', final: true, options: { list: buy } }]);
    const exit = await b.finish(phaseMs);
    const done = lines(b.dir, giver).find(l => message(l, 'done'));
    out.buy = { exit, logouts: state(b), done: done?.replace(/^\S+ /, '') ?? null };
    say('buy: launcher exited', out.buy);
    if (!done) {
        result('h1-demo', { ...out, ended: 'the buyer did not finish' });
        process.exit(1);
    }
}

const serve = launch('serve', giverBots, gatewayPort, [{ account: giver, role: 'kits', options: { kits: { [receiver]: kit }, serve: receiver } }]);
try {
    const staged = await waitForLine(serve, giver, l => message(l, 'kit staged'), l => message(l, 'kit short'), phaseMs);
    out.staged = staged?.replace(/^\S+ /, '') ?? null;
    say('serve: staged', { staged: !!staged });
    if (staged) {
        const recv = launch('receive', receiverBots, gatewayPort + 1, [
            { account: receiver, role: 'handoff-demo', receiver: true, final: true, options: { ledger: LEDGER, row: 'H1', partner: giver } },
        ]);
        const exit = await recv.finish(phaseMs);
        const rl = lines(recv.dir, receiver);
        const pick = (tag: string) => {
            const l = rl.find(x => x.includes(`RESULT ${tag} `));
            return l ? JSON.parse(l.slice(l.indexOf(`RESULT ${tag} `) + `RESULT ${tag} `.length)) : null;
        };
        out.receive = { exit, logouts: state(recv) };
        out.verdict = pick('handoff-demo');
        out.giveBack = pick('handoff-demo-giveback');
        say('receive: launcher exited', out.receive);
        // The giver banks what came back before it is stopped.
        const back = lines(serve.dir, giver).findIndex(l => message(l, 'returned'));
        if (back >= 0) out.banked = !!(await waitForLine(serve, giver, l => message(l, 'banked'), () => false, 180_000, back));
        code = (out.verdict as { pass?: boolean } | null)?.pass ? 0 : 1;
    }
} finally {
    serve.proc.kill('SIGINT');
    const exit = await serve.finish(120_000);
    out.serve = { exit, logouts: state(serve), handOff: lines(serve.dir, giver).find(l => message(l, 'hand-off'))?.replace(/^\S+ /, '') ?? null, returned: lines(serve.dir, giver).find(l => message(l, 'returned'))?.replace(/^\S+ /, '') ?? null };
    out.giverBank = lastBank(serve.dir);
    result('h1-demo', out);
}
process.exit(code);
