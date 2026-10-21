// Run a helper role on the lab for a while, after staff-command fixtures.
//
//   WEB_PORT=9540 WEB_MANAGEMENT_PORT=9541 HISCORES_WEB_PORT=9542 NODE_PORT=44540 AGENT_PORT=8540 speedrun/lab/lab.sh <bot> \
//     'speedrun/lab/role-smoke.ts:--role=grapes:--secs=600:--cheats=setstat cooking 35;tele 0,49,53,15,58'
// with ROLE_OPTIONS='{"source":"guild"}' in the environment (or --options=... when it has no ':').
//
// --cheats is a ';'-separated list of staff commands without '::'. Prints the
// role's log lines and bank snapshots, then the final inventory and position.
import type { Role } from '../helpers/role';
import { prepare } from '../helpers/wine-common';
import { openSession } from '../lib/session';
import { waitTicks } from '../lib/wait';
import { arg, botArg } from './common';
import { cheat } from './setup';

const name = botArg();
const roleName = arg('role', '');
const secs = Number(arg('secs', '300'));
// lab.sh splits script arguments on ':', so JSON options can also come from ROLE_OPTIONS.
const options = JSON.parse(arg('options', process.env.ROLE_OPTIONS ?? '{}')) as Record<string, unknown>;
const s = await openSession(name);
const log = (message: string, data?: Record<string, unknown>) => console.log(JSON.stringify({ t: s.sdk.getState()?.tick, message, ...data }));
await prepare({ bot: s.bot, sdk: s.sdk, log });
for (const c of arg('cheats', '').split(';').map(x => x.trim()).filter(Boolean)) {
    await cheat(s.sdk, c);
    await waitTicks(s.sdk, 1);
}
await waitTicks(s.sdk, 3);
const mod = (await import(`../helpers/${roleName}.ts`)) as { role: Role };
const controller = new AbortController();
setTimeout(() => controller.abort(), secs * 1000);
await Promise.race([
    mod.role
        .run({ bot: s.bot, sdk: s.sdk, account: name, options, log, reportBank: b => log('bank', { bank: b.items }), signal: controller.signal })
        .catch(e => log('role threw', { error: String(e) })),
    Bun.sleep(secs * 1000 + 30_000)
]);
log('final', { inv: s.sdk.getInventory().map(i => `${i.name} x${i.count}`), equip: s.sdk.getEquipment().map(i => i.name), skills: s.sdk.getState()?.skills.filter(k => k.baseLevel > 1).map(k => `${k.name} ${k.baseLevel}`), pos: { x: s.sdk.getState()?.player?.worldX, z: s.sdk.getState()?.player?.worldZ, level: s.sdk.getState()?.player?.level } });
process.exit(0);
