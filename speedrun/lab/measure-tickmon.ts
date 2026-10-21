// The in-run tick monitor (lib/tick-monitor.ts) in the lab: a runSteps chain of walks for
// --minutes, whose run log gets the monitor's TICKMON rows, printed at the end.
//
//   LAB_BLOCK=tickmanip NODE_TICKRATE=300 bash docs/speedrun/scripts/lab.sh <bot> \
//       speedrun/lab/measure-tickmon.ts:--minutes=5 \
//       speedrun/lab/measure-tickmon.ts:--minutes=5:--hold-p=0.08:--hold=150-350:--bot2=<second bot>
//
// Without --hold-p it attaches to <bot>'s runner (lab.sh's). With it, it puts a TCP proxy between
// a second bot's lite client and the engine (its bot.env SERVER is pointed at the proxy) and
// launches that client itself. The proxy holds a server-to-client chunk with probability --hold-p
// for a time drawn from --hold (ms), queueing everything behind it, so a held tick arrives late,
// and glued to the next one when the hold runs past the next tick.

import { existsSync, readFileSync, writeFileSync } from 'fs';
import net from 'node:net';
import { join } from 'path';
import { abandonClient, closeSession, loadBotEnv, openSession, ROOT } from '../lib/session';
import { waitTicks, waitUntil } from '../lib/wait';
import { runSteps, type Step } from '../runner/step';
import { arg, botArg, labLog, result } from './common';
import { cheat, near, tele } from './setup';

const minutes = Number(arg('minutes', '5'));
const holdP = Number(arg('hold-p', '0'));
const [holdMin, holdMax] = arg('hold', '150-350').split('-').map(Number) as [number, number];
const A = { x: 3222, z: 3218 };
const B = { x: 3223, z: 3218 };

/** Proxy `listenPort` to `target`, holding server-to-client chunks as the header says. */
function holdProxy(listenPort: number, target: { host: string; port: number }): { held: () => number; close: () => void } {
    let held = 0;
    const server = net.createServer(client => {
        const up = net.connect(target.port, target.host);
        const queue: Buffer[] = [];
        let holding = false;
        client.on('data', d => up.write(d));
        up.on('data', d => {
            if (holding) return void queue.push(d);
            if (Math.random() >= holdP) return void client.write(d);
            held++;
            holding = true;
            queue.push(d);
            setTimeout(() => {
                holding = false;
                for (const b of queue.splice(0)) client.write(b);
            }, holdMin + Math.random() * (holdMax - holdMin));
        });
        const end = () => {
            client.destroy();
            up.destroy();
        };
        client.on('close', end).on('error', end);
        up.on('close', end).on('error', end);
    });
    server.listen(listenPort, '127.0.0.1');
    return { held: () => held, close: () => server.close() };
}

const bot = botArg();
let proxy: ReturnType<typeof holdProxy> | null = null;
let name = bot;
if (holdP > 0) {
    name = arg('bot2', '');
    if (!name) throw new Error('--hold-p needs --bot2=<second bot> (the proxied client)');
    const env = loadBotEnv(bot);
    const [host, port] = (env.SERVER ?? 'localhost:8888').split(':') as [string, string];
    const proxyPort = Number(arg('proxy-port', String(Number(port) + 7)));
    const envPath = join(ROOT, 'bots', name, 'bot.env');
    if (!existsSync(envPath)) {
        const made = Bun.spawnSync(['bun', 'bots/create-bot.ts', name, '--local', '--no-chat'], { cwd: ROOT });
        if (made.exitCode !== 0) throw new Error(`create-bot ${name}: ${made.stderr.toString()}`);
    }
    const text = readFileSync(envPath, 'utf-8')
        .replace(/^SERVER=.*$/m, `SERVER=localhost:${proxyPort}`)
        .replace(/^GATEWAY_URL=.*$/m, `GATEWAY_URL=${env.GATEWAY_URL}`)
        .replace(/^TELEMETRY=.*$/m, 'TELEMETRY=false');
    writeFileSync(envPath, text);
    proxy = holdProxy(proxyPort, { host, port: Number(port) });
    console.log(`proxy 127.0.0.1:${proxyPort} -> ${host}:${port}, hold p=${holdP} for ${holdMin}-${holdMax} ms`);
}

const session = await openSession(name, { launch: holdP > 0, readyTimeoutMs: 180_000 });
const { sdk } = session;
await cheat(sdk, 'setvar tutorial 1000');
await waitTicks(sdk, 2);
if (!(await tele(sdk, A.x, A.z))) throw new Error('tele to Lumbridge courtyard failed');

// Walk between two tiles every 10 ticks until the deadline: the account stays active, and the
// monitor's windows (60 s from its first tick) close before runSteps stops it.
const walk: Step = {
    name: 'walk loop',
    preconditions: () => true,
    run: async ({ sdk }) => {
        const end = Date.now() + minutes * 60_000 + 5_000;
        let to = B;
        while (Date.now() < end) {
            await sdk.sendWalk(to.x, to.z, false);
            const target = to;
            await waitUntil(sdk, s => near(s, target.x, target.z), { maxTicks: 10 });
            await waitTicks(sdk, 8);
            to = to === B ? A : B;
        }
    },
    postconditions: () => true,
    logoutSafe: true,
};

const log = labLog(holdP > 0 ? 'tickmon-hold' : 'tickmon');
await runSteps(session, [walk], { log, c: {}, shouldStop: () => false });
const mon = log.rows.filter(r => r.kind === 'tickmon');
for (const r of mon) console.log(r.meta!.line);
const sum = (k: 'glued' | 'late') => mon.reduce((a, r) => a + Number(r.meta![k]), 0);
result('tickmon', { minutes: mon.length, ticks: mon.reduce((a, r) => a + r.ticks, 0), glued: sum('glued'), late: sum('late'), ...(proxy ? { heldChunks: proxy.held(), holdP, hold: [holdMin, holdMax] } : {}) });
console.log(`log: ${log.path}`);
if (holdP > 0) await abandonClient(session);
await closeSession(session);
proxy?.close();
process.exit(0);
