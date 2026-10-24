// Monkey Madness: the escapes from a temple-rope pin. Climbs the rope under
// the trapdoor until a landing pins the player (the module's own escape,
// templeEscape, still in the guards' box after 15 ticks), then applies
// --method to the pin:
//   wait      templeEscape again, up to --bound ticks
//   relog     the shared session relog (combat-locked logout included), then
//             templeEscape for 30 ticks; needs --launch (lab.sh with LAB_RUNNERS=0)
//   teleport  the Varrock teleport (lib/travel.ts), timed to the landing
// Protect from Melee on, HP 99, prayer refilled before each climb.
//
//   speedrun/lab/lab.sh <bot> speedrun/lab/measure-mm-pin.ts:--method=wait:--pins=3:--bound=400
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> speedrun/lab/measure-mm-pin.ts:--method=relog:--pins=3:--launch

import { opLoc } from '../lib/act';
import { setPrayer } from '../lib/combat';
import { openSession, relog } from '../lib/session';
import { teleport } from '../lib/travel';
import { currentTick, waitTicks } from '../lib/wait';
import { pos } from '../lib/world';
import { templeEscape } from '../quests/monkey-madness';
import { arg, botArg } from './common';
import { cheat, give, setStats, tele } from './setup';

const method = arg('method', 'wait');
const pinsWanted = Number(arg('pins', '3'));
const climbs = Number(arg('climbs', '30'));
const bound = Number(arg('bound', '400'));
const launch = process.argv.includes('--launch');
const session = await openSession(botArg(), launch ? { launch: true } : {});
const { sdk } = session;
const at = () => JSON.stringify(pos(sdk));

await setStats(sdk, { hitpoints: 99, prayer: 94, defence: 1, magic: 76 });
await cheat(sdk, 'setvar mm_main 3');
let pins = 0;
for (let i = 0; i < climbs && pins < pinsWanted; i++) {
    for (let k = 0; k < 6 && !(await tele(sdk, 2808, 9200)); k++) await waitTicks(sdk, 5);
    await setStats(sdk, { prayer: 94 });
    await setPrayer(sdk, 'protect_from_melee', true);
    const up = await opLoc(sdk, { x: 2808, z: 9201, op: /climb/i, radius: 5 }, /climb/i, s => pos(s).z < 9000, { maxTicks: 20, resendEvery: 5 });
    if (!up.ok) { console.log(`CLIMB ${i} failed at ${at()}`); continue; }
    await waitTicks(sdk, 1);
    const land = at();
    const first = await templeEscape(sdk, 15);
    if (first.ok) { console.log(`FREE ${i} ${land} by ${first.via} in ${first.ticks}`); continue; }
    pins++;
    const pp0 = sdk.getState()!.prayers?.prayerPoints;
    if (method === 'wait') {
        const r = await templeEscape(sdk, bound);
        console.log(`PIN ${i} ${land} wait: ${r.ok ? `freed by ${r.via} after ${15 + r.ticks}` : `still pinned after ${15 + r.ticks}`}, prayer ${pp0} -> ${sdk.getState()!.prayers?.prayerPoints}`);
    } else if (method === 'relog') {
        const t0 = Date.now(), tick0 = currentTick(sdk);
        try {
            const r = await relog(session);
            const back = at();
            await setPrayer(sdk, 'protect_from_melee', true);
            const e = await templeEscape(sdk, 30);
            console.log(`PIN ${i} ${land} relog: logout ${r.logout.ok ? 'ok' : r.logout.reason} after ${r.logout.clickTick - tick0} ticks waiting, ${((Date.now() - t0) / 300).toFixed(0)} tick-equivalents to back in at ${back}; then ${e.ok ? `free by ${e.via} in ${e.ticks}` : `pinned again after ${e.ticks}`}`);
        } catch (err) {
            console.log(`PIN ${i} ${land} relog: FAILED after ${((Date.now() - t0) / 300).toFixed(0)} tick-equivalents: ${err instanceof Error ? err.message : String(err)}`);
        }
    } else {
        await give(sdk, ['lawrune', 'airrune', 'airrune', 'airrune', 'firerune']);
        const t0 = currentTick(sdk);
        const r = await teleport(sdk, 'varrock');
        console.log(`PIN ${i} ${land} teleport: ${r.ok ? 'landed' : `failed (${JSON.stringify(r).slice(0, 160)})`} in ${currentTick(sdk) - t0} ticks at ${at()}`);
    }
    await setPrayer(sdk, 'protect_from_melee', false);
    await waitTicks(sdk, 6);
}
console.log(`PINS ${pins} of ${pinsWanted} wanted (method ${method})`);
process.exit(0);
