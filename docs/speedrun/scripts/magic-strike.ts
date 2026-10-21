// Magic 1 -> 7 (the first enchant) with Wind Strike on chickens.
//
//   NODE_TICKRATE=300 docs/speedrun/scripts/magic-lab.sh <bot> docs/speedrun/scripts/magic-strike.ts:7
//
// Wind Strike gives 5.5 base on the cast (magic_combat_spells.dbrow) plus 2 base per damage point
// (combat.rs2, style_magic_normal), at the 5-tick spell attack rate. The bot re-clicks a chicken
// every tick it is not in combat (a click while the attack delay is pending re-queues itself), and
// moves to a fresh chicken after a kill. Reports ticks from the first click to the goal level.
import { runScript } from '../../../sdk/runner';
import { cheat, freshKit, log, nextTick, prepare, tele, tick, waitTicks, xpRecorder } from './magic-lib';

const GOAL = Number(process.argv[3] ?? 7);
const WIND_STRIKE = 1152;
const COOP = { x: 3233, z: 3295 }; // Lumbridge east chicken coop

await runScript(async ({ bot, sdk }) => {
    await prepare(sdk, bot);
    await freshKit(sdk, bot, 'staff_of_air');
    await cheat(sdk, 'setstat magic 1');
    await cheat(sdk, 'give mindrune 200');
    await tele(sdk, COOP.x, COOP.z);
    await waitTicks(sdk, 3);
    const rec = xpRecorder(sdk, 'Magic');
    const t0 = tick(sdk);
    let t = t0;
    let target: number | undefined;
    let clicks = 0;
    while (sdk.getSkill('Magic')!.baseLevel < GOAL && tick(sdk) - t0 < 300) {
        const npcs = sdk.getNearbyNpcs().filter((n) => /^chicken$/i.test(n.name));
        let cur = npcs.find((n) => n.index === target);
        if (!cur) {
            cur = npcs.sort((a, b) => a.distance - b.distance)[0];
            target = cur?.index;
        }
        if (cur) {
            await sdk.sendSpellOnNpc(cur.index, WIND_STRIKE);
            clicks++;
        }
        const d = sdk.getDialog();
        if (d?.isOpen) await sdk.sendClickDialog(0);
        t = await nextTick(sdk, t);
    }
    await waitTicks(sdk, 2);
    const gains = rec.gains(t0, tick(sdk));
    log(sdk, `STRIKE 1->${GOAL} NODE_TICKRATE=${process.env.NODE_TICKRATE ?? '?'}: ${gains.length} xp events (${gains.map((g) => `${g.tick - t0}:${g.base}`).join(' ')}), level ${sdk.getSkill('Magic')!.baseLevel} at +${gains.at(-1)!.tick - t0} ticks from the first click; ${clicks} clicks`);
    rec.off();
}, { timeout: 10 * 60_000, printState: false });
