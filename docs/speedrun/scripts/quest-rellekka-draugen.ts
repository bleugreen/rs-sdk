// Fremennik Trials, Sigli's hunt: from the first use of the Hunters' talisman
// at Rellekka's south gate to the Draugen's essence absorbed.
//
//   bun docs/speedrun/scripts/quest-rellekka-draugen.ts <bot> [att str def hp]
//
// Read (viking_sigil.rs2): the first use spawns a hidden "butterfly" in one of
// four forests (random(4), line 242; map_findsquare radius 20) and tells you a
// compass direction; within 3 tiles of it the talisman spawns the Draugen (60
// hitpoints, 60 attack/strength/defence, +100 melee defence). The butterfly is
// an ordinary NPC (viking_draugen_safe, id 1280) that the client can see, so the
// bot walks straight to it once it is in view instead of re-reading directions.
// The butterfly id is a temporary varp (draugen_butterfly_uid): a fresh login
// gives a fresh spawn, so each sample uses a bot that has not hunted yet, and
// samples run one at a time (a bot can see other players' butterflies).
// quest-rellekka-draugen.sh runs fresh bots serially.
// Fights with a rune scimitar and rune armour at the given stats (default 70s).

import { runScript } from '../../../sdk/runner';
import { slotOf, walkTo, wield } from '../../../speedrun/lib/act';
import { fight, type FightResult } from '../../../speedrun/lib/combat';
import { currentTick, waitTicks } from '../../../speedrun/lib/wait';
import { findNpc, messagesSince, pos } from '../../../speedrun/lib/world';
import { result } from '../../../speedrun/lab/record';
import { clearInventory, getvar, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';
const SIGLI_STARTED = 1 << 14; // quest_viking.constant

const nums = process.argv.slice(3).filter(a => /^\d+$/.test(a)).map(Number);
const stat = (i: number) => nums[i] ?? 70;
const att = stat(0), str = stat(1), def = stat(2), hp = stat(3);
const BUTTERFLY = 1280;
const DRAUGEN = 1279;
const dirs: Record<string, readonly [number, number]> = {
    'north-west': [-1, 1], 'south-west': [-1, -1], 'north-east': [1, 1], 'south-east': [1, -1],
    east: [1, 0], west: [-1, 0], south: [0, -1], north: [0, 1],
};
/** The in-game name of a debug obj name: rune_full_helm is "Rune full helm". */
const display = (obj: string) => new RegExp(`^${obj.replace(/_/g, ' ')}$`, 'i');

await runScript(async ({ bot, sdk }) => {
    const out: Record<string, unknown> = { stats: `${att}/${str}/${def}` };
    process.on('exit', () => result('rellekka-draugen', out));
    await bot.dismissBlockingUI();
    await clearInventory(sdk);
    await setStats(sdk, { attack: att, strength: str, defence: def, hitpoints: hp });
    for (const g of ['rune_scimitar', 'rune_full_helm', 'rune_platebody', 'rune_platelegs', 'rune_kiteshield']) {
        await give(sdk, g);
        await wield(sdk, display(g));
    }
    await give(sdk, 'shark', 10);
    await give(sdk, 'viking_draugen_talisman_uncharged');
    await setvar(sdk, 'viking', 1);
    await setvar(sdk, 'viking_bits', SIGLI_STARTED);
    await mustTele(sdk, 2662, 3645, 0);

    const T0 = currentTick(sdk);
    const msgs = () => (sdk.getState()?.gameMessages ?? []).slice(-3).map(m => m.text).join(' | ');
    const useTalisman = async () => {
        await sdk.sendUseItem(slotOf(sdk, /Hunters' talisman/), 1);
        await waitTicks(sdk, 2);
        return msgs();
    };
    let uses = 0;
    const trail: string[] = [];
    let found: number | null = null;
    while (currentTick(sdk) - T0 < 1500) {
        if (findNpc(sdk, DRAUGEN)) break;
        const bf = findNpc(sdk, BUTTERFLY);
        if (bf) {
            if (found === null) found = currentTick(sdk) - T0;
            if (bf.distance > 2) {
                await walkTo(bot, sdk, bf.x, bf.z, 1, 0);
                continue;
            }
            uses++;
            trail.push(`at butterfly: ${await useTalisman()}`);
            continue;
        }
        uses++;
        const m = await useTalisman();
        trail.push(`${JSON.stringify(pos(sdk))} ${m}`);
        // The newest direction message of the hunt (older ones linger in the message list).
        const last = messagesSince(sdk, T0, /guides you/).at(-1) ?? '';
        const dir = Object.keys(dirs).find(d => last.endsWith(`guides you ${d}.`));
        const step = dir === undefined ? undefined : dirs[dir];
        if (!step) {
            await waitTicks(sdk, 1);
            continue;
        }
        const p = pos(sdk);
        await walkTo(bot, sdk, p.x + step[0] * 20, p.z + step[1] * 20, 3, 0);
    }
    const spawned = currentTick(sdk) - T0;
    const f0 = currentTick(sdk);
    const draugen = findNpc(sdk, DRAUGEN);
    // Eat below half hitpoints; any page that opens mid-fight is clicked through.
    const f: FightResult | null = draugen
        ? await fight(sdk, draugen, { maxTicks: 600, eatBelow: (sdk.getState()?.player?.maxHp ?? hp) / 2, food: /Shark/, onDialog: 'continue' })
        : null;
    await waitTicks(sdk, 2);
    const bits = await getvar(sdk, 'viking_bits');
    Object.assign(out, {
        uses, butterflySeenAt: found, draugenSpawnedAt: spawned, fight: currentTick(sdk) - f0, fightEnd: f?.end ?? 'no target',
        total: currentTick(sdk) - T0, eaten: f?.eats ?? 0, levelUps: f?.levelUps ?? 0,
        sigli: bits === null ? null : (bits >> 14) & 3, end: pos(sdk), trail,
    });
}, { timeout: 900_000, printState: false });
