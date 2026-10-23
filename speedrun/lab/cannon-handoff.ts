// Lab rehearsal of the cannon holder's serve mode (speedrun/helpers/cannon.ts) against
// the stand-in receiver (cannon-receiver.ts), both launched by the run-machine launcher
// (standalone.ts) against the local lab engine. Through lab.sh, which starts the engine
// (its own runners and gateway are not used):
//
//   NODE_TICKRATE=300 LAB_RUNNERS=0 WEB_PORT=9480 WEB_MANAGEMENT_PORT=9481 HISCORES_WEB_PORT=9482 NODE_PORT=44180 AGENT_PORT=8480 \
//     speedrun/lab/lab.sh cannonlab speedrun/lab/cannon-handoff.ts:--quest=11 speedrun/lab/cannon-handoff.ts:--quest=0
//
// The holder makes the set and the balls with staff commands (serve.labStock), stands on
// the giver tile and keeps a request standing; the receiver, its %mcannon set to --quest
// (11 is complete, as SCORED after S13; 0 is a fresh account), takes them in one trade,
// tries Set-up on the base, and gives everything back, which the holder takes at
// serve.returnTile (the H11r direction).
//
// With --mm=1 the give-back is H11r as rs/158 moved it: the holder also carries Monkey Madness's
// magic shortbow and 200 rune arrows (serve.returnExtras) and gives them in the same trade as
// the set comes back; the receiver expects them (expectBack), so it is one two-way trade.
//
// The holder serves the whole H11 row of the inventory ledger (helpers/cannon-receiver.ts
// serveFromLedger: the set, the balls, the scimitar, the runes, the sharks), because the receiver
// takes the row as SCORED's step does; the receiver starts with an empty pack, so each top-up is
// served at its full `to` count.
//
// Options: --quest=N (default 11), --setup=0 to skip Set-up, --mm=1
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { returnExtrasFromLedger } from '../helpers/cannon-receiver';
import { labServeLoad } from './cannon-launch';

const ROOT = resolve(import.meta.dir, '..', '..');
const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const quest = Number(arg('quest', '11'));
const { balls, extras } = labServeLoad('H11');
const setUp = arg('setup', '1') !== '0';
const mm = arg('mm', '0') === '1';
// H11r's two-way form (Monkey Madness's bow and arrows back with the set) from the ledger row itself,
// so the lab cannot drift from it: while the row is give-only there is nothing to return.
const MM = returnExtrasFromLedger();
if (mm && MM.length === 0) {
    console.error('cannon-handoff: --mm=1 needs the H11r ledger row two-way (in: magic shortbow, rune arrows); the row in force is give-only');
    process.exit(2);
}
const webPort = process.env.WEB_PORT ?? '9300';

// Inside the Lumbridge cow pen (lib/kandarin.ts COW_PEN): open grass, outside every
// no-cannon zone in cannon.dbrow, so Set-up answers with the quest check alone.
const GIVER_TILE = { x: 3253, z: 3285 };
const RECEIVER_TILE = { x: 3254, z: 3285 };

const base = mkdtempSync(join(tmpdir(), 'cannon-lab-'));
const botsDir = join(base, 'bots');
const runDir = join(base, 'run');
const giver = 'cairn_h71';
const receiver = 'cairn_h76';
for (const account of [giver, receiver]) {
    mkdirSync(join(botsDir, account), { recursive: true, mode: 0o700 });
    writeFileSync(
        join(botsDir, account, 'bot.env'),
        `BOT_USERNAME=${account}\nPASSWORD=${randomBytes(6).toString('hex')}\nSERVER=localhost:${webPort}\nSHOW_CHAT=false\nTELEMETRY=false\nPROFANITY_FILTER=false\n`,
        { mode: 0o600 }
    );
}

const config = {
    gatewayPort: Number(process.env.CANNON_GW_PORT ?? 8486),
    botsDir,
    runDir,
    loginSpacingMs: 2000,
    accounts: [
        { account: giver, role: 'cannon', options: { serve: { tile: GIVER_TILE, balls, extras, labStock: true, returnTile: GIVER_TILE, ...(mm ? { returnExtras: MM } : {}), scope: { step: 'S14', family: 'cannon' } } } },
        { account: receiver, role: 'cannon-receiver', receiver: true, final: true, options: { giver, tile: RECEIVER_TILE, questVarp: quest, setUp, giveBack: true, ...(mm ? { expectBack: MM.map(({ item, count }) => ({ item, count })) } : {}), waitTicks: 1500, scope: { step: 'S14', family: 'cannon' } } }
    ]
};
const configPath = join(base, 'launch.json');
writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log(`cannon hand-off lab: receiver %mcannon=${quest}, ${balls} balls, set-up ${setUp}, Monkey Madness extras ${mm}, run files in ${base}`);

const child = Bun.spawn([process.execPath, 'speedrun/helpers/standalone.ts', configPath], {
    cwd: ROOT,
    // Its own role state: a hand-off recorded by an earlier run would otherwise be resumed as done.
    env: { ...process.env, HELPER_LAB_TELE: '1', RC_CUE_DIR: join(runDir, 'rc-cue'), ROLE_STATE_DIR: join(base, 'role-state') },
    stdout: 'inherit',
    stderr: 'inherit'
});
const killer = setTimeout(() => child.kill('SIGINT'), Number(process.env.CANNON_LAB_TIMEOUT_MS ?? 10 * 60_000));
const code = await child.exited;
clearTimeout(killer);

for (const [who, account, re] of [
    ['receiver', receiver, /"message":"(received|set-up|gave back|holder in sight|cue written)"|RESULT/],
    ['holder', giver, /"message":"(hand-off|returned|request|bounce|phase|serve error|load|return load|serve: (finished|resuming))"/]
] as const) {
    let text = '';
    try {
        text = readFileSync(join(runDir, 'logs', `${account}.role.log`), 'utf8');
    } catch {
        console.log(`${who}: no role log`);
    }
    for (const line of text.split('\n')) if (re.test(line)) console.log(`${who} ${line.slice(line.search(/\{|RESULT/))}`);
}
process.exit(code);
