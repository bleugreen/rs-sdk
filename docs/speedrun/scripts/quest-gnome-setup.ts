// Take a fresh lab account off the tutorial and give it the stats and kit the
// gnome-chain measurements assume. Combat stats are the conventions' 70/70/70
// melee case unless overridden: `bun docs/speedrun/scripts/quest-gnome-setup.ts <bot> [att str def hp]`.

import { runScript } from '../../../sdk/runner';
import { wield } from '../../../speedrun/lib/act';
import { currentTick, waitTicks } from '../../../speedrun/lib/wait';
import { pos } from '../../../speedrun/lib/world';
import { clearInventory, give, setStats } from '../../../speedrun/lab/setup';

const [att, str, def, hp] = [3, 4, 5, 6].map((i, k) => Number(process.argv[i] ?? [70, 70, 70, 70][k]));

await runScript(async ({ bot, sdk }) => {
    const s0 = sdk.getState()!;
    if (s0.modalOpen || (pos(s0).x < 3150 && pos(s0).z < 3130)) {
        const r = await bot.skipTutorial();
        console.log('skipTutorial:', r.message);
        await waitTicks(sdk, 3);
    }
    await setStats(sdk, { attack: att!, strength: str!, defence: def!, hitpoints: hp!, prayer: 43, agility: 25, magic: 59, ranged: 70, thieving: 20, crafting: 20 });
    await clearInventory(sdk);
    await give(sdk, 'rune_scimitar', 1);
    await give(sdk, 'shark', 8);
    await wield(sdk, /rune scimitar/i);
    console.log('tick', currentTick(sdk), 'pos', pos(sdk), 'skills', sdk.getState()!.skills.filter(s => s.level > 1).map(s => `${s.name}=${s.level}`).join(' '));
    console.log('inv', sdk.getState()!.inventory.map(i => `${i.name}x${i.count}`).join(', '));
    console.log('equip', sdk.getState()!.equipment.map(i => i.name).join(', '));
}, { timeout: 120_000 });
