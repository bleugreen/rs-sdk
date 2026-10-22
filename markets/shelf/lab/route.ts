// Lab only: run the shelf reader on a lab account after staff-command fixtures.
// Needs the speedrun lab (speedrun/lab/lab.sh, LOCAL_STAFF_LEVEL=4); never on the demo.
//
//   NODE_TICKRATE=400 WEB_PORT=9940 WEB_MANAGEMENT_PORT=9941 HISCORES_WEB_PORT=9942 NODE_PORT=44940 AGENT_PORT=7708 \
//     speedrun/lab/lab.sh shlab1 'markets/shelf/lab/route.ts:--coins=80:--ranged=40:--out=/tmp/shelf.jsonl'
//
// --as=<bot> runs on another lab bot (one in LAB_HELPERS, which has its own lite
// runner); --coins gives that many coins, --ranged sets the Ranged level;
// --stops, --repeat and --every pass through to the reader.
import { memoryRoleState } from '../../../speedrun/helpers/role';
import { arg, botArg } from '../../../speedrun/lab/common';
import { cheat, give, leaveTutorial, setstat } from '../../../speedrun/lab/setup';
import { openSession } from '../../../speedrun/lib/session';
import { waitTicks } from '../../../speedrun/lib/wait';
import { role } from '../shelf-reader';

const name = arg('as', botArg());
const s = await openSession(name);
const sdk = s.sdk;
const log = (message: string, data?: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), tick: sdk.getState()?.tick, message, ...data }));
await leaveTutorial(s);
await waitTicks(sdk, 2);
const coins = Number(arg('coins', '0'));
if (coins > 0) await give(sdk, 'coins', coins);
const ranged = Number(arg('ranged', '0'));
if (ranged > 0) await setstat(sdk, 'ranged', ranged);
for (const c of arg('cheats', '').split(';').map(x => x.trim()).filter(Boolean)) await cheat(sdk, c, 1);
await waitTicks(sdk, 3);
const p = sdk.getState()?.player;
log('fixture', { bot: name, at: { x: p?.worldX, z: p?.worldZ }, coins: sdk.getInventory().filter(i => i.name === 'Coins').reduce((a, i) => a + i.count, 0), ranged: sdk.getSkill('Ranged')?.level, hitpoints: sdk.getSkill('Hitpoints')?.level, tickrate: process.env.NODE_TICKRATE });

const options: Record<string, unknown> = { out: arg('out', '') || undefined };
for (const k of ['stops', 'repeat', 'every']) {
    const v = arg(k, '');
    if (v) options[k] = k === 'stops' ? v : Number(v);
}
const controller = new AbortController();
const secs = Number(arg('secs', '3000'));
const timer = setTimeout(() => controller.abort(), secs * 1000);
const t0 = Date.now();
try {
    await role.run({ bot: s.bot, sdk, account: name, options, log, reportBank: () => {}, signal: controller.signal, state: memoryRoleState() });
} catch (e) {
    log('reader threw', { error: String(e) });
}
clearTimeout(timer);
const q = sdk.getState()?.player;
log('final', { wallMs: Date.now() - t0, at: { x: q?.worldX, z: q?.worldZ, level: q?.level }, inv: sdk.getInventory().map(i => `${i.name} x${i.count}`), hitpoints: sdk.getSkill('Hitpoints')?.level });
process.exit(0);
