// Lab measurement of the S07 bone giver (speedrun/helpers/bone-giver.ts) against
// the stand-in receiver cairn_h75 (bone-receiver.ts), both launched by the
// run-machine launcher (standalone.ts) against the local lab engine. Through
// lab.sh, which starts the engine (its own runners and gateway are not used):
//
//   NODE_TICKRATE=300 LAB_RUNNERS=0 WEB_PORT=9480 WEB_MANAGEMENT_PORT=9481 HISCORES_WEB_PORT=9482 NODE_PORT=44180 AGENT_PORT=8480 \
//     speedrun/lab/lab.sh bonelab speedrun/lab/bone-giver.ts:--loads=10
//
// Options: --asks=15,21,... (S18 on-request top-ups of those sizes), --loads=N (default 10), --pages=2,5 (loads followed by a held level-up page), --hold=6,
//   --order=giver-first (default, the run's order) | receiver-first
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..', '..');
const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const loads = Number(arg('loads', '10'));
const pages = arg('pages', '2,5').split(',').filter(Boolean).map(Number);
const hold = Number(arg('hold', '6'));
// --asks=15,21,17: S18's top-ups (the giver in mode on-request) instead of S07's standing loads.
const asks = arg('asks', '').split(',').filter(Boolean).map(Number);
const webPort = process.env.WEB_PORT ?? '9300';

const base = mkdtempSync(join(tmpdir(), 'bone-lab-'));
const botsDir = join(base, 'bots');
const runDir = join(base, 'run');
const giver = 'cairn_h70';
const receiver = 'cairn_h75';
for (const account of [giver, receiver]) {
    mkdirSync(join(botsDir, account), { recursive: true, mode: 0o700 });
    writeFileSync(
        join(botsDir, account, 'bot.env'),
        `BOT_USERNAME=${account}\nPASSWORD=${randomBytes(6).toString('hex')}\nSERVER=localhost:${webPort}\nSHOW_CHAT=false\nTELEMETRY=false\nPROFANITY_FILTER=false\n`,
        { mode: 0o600 }
    );
}

const config = {
    gatewayPort: Number(process.env.BONE_GW_PORT ?? 8485),
    botsDir,
    runDir,
    loginSpacingMs: 2000,
    // Login order decides who the engine handles first each tick. On the run every helper is in
    // before the scored account (SUPPLIES.md section 5); --order=receiver-first measures the reverse.
    accounts: (() => {
        const sites = [{ giver: { x: 2913, z: 3494 }, receiver: { x: 2914, z: 3494 } }];
        const scope = asks.length ? { step: 'S18', family: 'courier' } : { step: 'S07', family: 'bone' };
        const g = { account: giver, role: 'bone-giver', options: asks.length ? { mode: 'on-request', restock: { kind: 'cheat' }, sites, scope } : { restock: { kind: 'cheat' }, sites, trades: loads, scope } };
        const r = { account: receiver, role: 'bone-receiver', receiver: true, final: true, options: asks.length ? { giver, asks, pageLoads: [], scope } : { giver, loads, pageLoads: pages, holdTicks: hold, scope } };
        return arg('order', 'giver-first') === 'receiver-first' ? [r, g] : [g, r];
    })()
};
const configPath = join(base, 'launch.json');
writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log(`bone giver lab: ${loads} loads, pages after loads ${pages.join(',') || 'none'} held ${hold} ticks, run files in ${base}`);

const child = Bun.spawn([process.execPath, 'speedrun/helpers/standalone.ts', configPath], {
    cwd: ROOT,
    env: { ...process.env, HELPER_LAB_TELE: '1', RC_CUE_DIR: join(runDir, 'rc-cue') },
    stdout: 'inherit',
    stderr: 'inherit'
});
const killer = setTimeout(() => child.kill('SIGINT'), Number(process.env.BONE_LAB_TIMEOUT_MS ?? 15 * 60_000));
const code = await child.exited;
clearTimeout(killer);

// Both sides, line by line: the receiver's loads and pages, the giver's trades, requests and refusals.
for (const [who, account, re] of [['receiver', receiver, /"message":"(load|page)"/], ['giver', giver, /"message":"(trade|request|bounce|phase)"/]] as const) {
    let text = '';
    try {
        text = readFileSync(join(runDir, 'logs', `${account}.role.log`), 'utf8');
    } catch {
        console.log(`${who}: no role log`);
    }
    for (const line of text.split('\n')) if (re.test(line)) console.log(`${who} ${line.slice(line.indexOf('{'))}`);
}
process.exit(code);
