// Lab check of the brew role's receiveFrom against the real handover role: the brewer holds
// everything but the limpwurt root, brews what it can, waits at the Falador west bank, takes the
// donor's trade and finishes the super strength.
//
//   LAB_HELPERS=cairn_ld1 WEB_PORT=9560 WEB_MANAGEMENT_PORT=9561 HISCORES_WEB_PORT=9562 NODE_PORT=44560 AGENT_PORT=8560 \
//     speedrun/lab/lab.sh cairn_lb1 speedrun/lab/brew-donor.ts:--donor=cairn_ld1
//
// Pass: the brewer logs `received` with the limpwurt and `done` holding super attack (3) and super
// strength (3), and the donor logs `handover` delivered.
import { role as brew } from '../helpers/brew';
import { FALADOR_WEST_BANK } from '../helpers/herbs';
import { role as handover } from '../helpers/handover';
import { memoryRoleState, type Role } from '../helpers/role';
import { prepare } from '../helpers/wine-common';
import { openSession, type Session } from '../lib/session';
import { waitTicks } from '../lib/wait';
import { arg, botArg } from './common';
import { cheat } from './setup';

const brewer = botArg();
const donor = arg('donor', 'cairn_ld1');
const bank = FALADOR_WEST_BANK;
const tele = `tele 0,${bank.x >> 6},${bank.z >> 6},${bank.x & 63},${bank.z & 63}`;

async function stage(s: Session, cheats: string[]): Promise<void> {
    await prepare({ bot: s.bot, sdk: s.sdk, log: () => {} });
    for (const c of ['~clearinv inv', tele, ...cheats]) {
        await cheat(s.sdk, c);
        await waitTicks(s.sdk, 1);
    }
    await waitTicks(s.sdk, 3);
}

function start(s: Session, account: string, r: Role, options: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const log = (message: string, data?: Record<string, unknown>) => console.log(JSON.stringify({ who: account, t: s.sdk.getState()?.tick, message, ...data }));
    return r.run({ bot: s.bot, sdk: s.sdk, account, options, log, reportBank: () => {}, signal, state: memoryRoleState() })
        .then(f => log('role returned', { finish: f ?? null }))
        .catch(e => log('role threw', { error: String(e) }));
}

const b = await openSession(brewer);
const d = await openSession(donor);
await stage(b, ['setstat herblore 63', 'give iritvial 1', 'give eye_of_newt 1', 'give kwuarmvial 1']);
await stage(d, ['give limpwurt_root 1']);

const controller = new AbortController();
setTimeout(() => controller.abort(), 15 * 60_000);
const brewing = start(b, brewer, brew, {
    targets: [{ potion: 'superattack', doses: 3, n: 1 }, { potion: 'superstrength', doses: 3, n: 1 }],
    receiveFrom: donor,
    receiveMinutes: 10
}, controller.signal);
// The donor sets out once the brewer is waiting, as on the fleet.
await Bun.sleep(30_000);
const giving = start(d, donor, handover, { id: 'lab-limpwurt-1', bank, handovers: [{ to: brewer, items: [{ item: 'Limpwurt root', n: 1 }] }] }, controller.signal);
await Promise.all([brewing, giving]);
console.log(JSON.stringify({ final: { brewer: b.sdk.getInventory().map(i => `${i.name} x${i.count}`), donor: d.sdk.getInventory().map(i => `${i.name} x${i.count}`) } }));
process.exit(0);
