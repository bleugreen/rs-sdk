// Lab only (LOCAL_STAFF_LEVEL=4, docs/speedrun/LAB.md): teleport to Varrock west bank and,
// with --stock, give this account 1,000 noted of each of the 23 item types in
// mule-lab-packages.json and bank them; --empty only banks the inventory.
//   bun docs/speedrun/scripts/mule-lab-stock.ts <bot> [--stock|--empty]
import { runScript } from '../../../sdk/runner';
import { depositAllExcept, MULE_STAND } from '../../../speedrun/helpers/mule';

export const LAB_ITEMS = [
    'logs', 'oak_logs', 'willow_logs', 'maple_logs', 'yew_logs', 'magic_logs', 'copper_ore', 'tin_ore',
    'iron_ore', 'coal', 'mithril_ore', 'adamantite_ore', 'bronze_bar', 'iron_bar', 'steel_bar', 'mithril_bar',
    'adamantite_bar', 'raw_lobster', 'shark', 'lobster', 'bones', 'big_bones', 'dragon_bones'
];

const tele = (x: number, z: number) => `::tele 0,${x >> 6},${z >> 6},${x & 63},${z & 63}`;

if (import.meta.main) {
    await runScript(
        async ({ bot, sdk }) => {
            const p = sdk.getState()?.player;
            if (p && p.worldX >= 3050 && p.worldX <= 3156 && p.worldZ >= 3056 && p.worldZ <= 3136) await bot.skipTutorial();
            await sdk.sendSay(tele(MULE_STAND.x, MULE_STAND.z));
            await sdk.waitForTicks(3);
            const stock = process.argv.includes('--stock');
            if (stock || process.argv.includes('--empty')) {
                // Bank the pack first (a fresh account carries 18 starter items), so the gives fit.
                if (sdk.getInventory().length) {
                    const opened = await bot.openBank();
                    if (!opened.success) throw new Error(opened.message);
                    await depositAllExcept(sdk);
                    await bot.closeBank();
                }
                for (const name of stock ? LAB_ITEMS : []) {
                    await sdk.sendSay(`::give cert_${name} 1000`);
                    await sdk.waitForTicks(1);
                }
                await sdk.waitForTicks(2);
                const opened = await bot.openBank();
                if (!opened.success) throw new Error(opened.message);
                await depositAllExcept(sdk);
                console.log(JSON.stringify({ bank: sdk.getBankItems().map(b => `${b.name} x${b.count}`) }));
                await bot.closeBank();
            }
            console.log(JSON.stringify({ at: sdk.getState()?.player, inventory: sdk.getInventory().length }));
        },
        { printState: false }
    );
}
