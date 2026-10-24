// Lab only, and deliberately NOT the reader: buys from a lab shop to check what
// the server charges against the SDK's ShopItem.buyPrice and the shop's Value
// reply, which the reader records as buyPrice and valuePrice. Never run it on
// the demo.
//
//   speedrun/lab/lab.sh shlab3 'markets/shelf/lab/buy-check.ts'
//
// At Aubury's: Value the dearest stocked rune, buy one, Value again, buy ten,
// Value again. Prints one RESULT line per purchase.
import type { ShopItem } from '../../../sdk/types';
import { arg, botArg } from '../../../speedrun/lab/common';
import { give, leaveTutorial, mustTele } from '../../../speedrun/lab/setup';
import { openSession } from '../../../speedrun/lib/session';
import { waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { SHOP_STOCK_COMPONENT, VALUE_OPTION } from '../read-only';
import { parseValueMessage } from '../stops';

const name = arg('as', botArg());
const s = await openSession(name);
const { sdk, bot } = s;
await leaveTutorial(s);
await mustTele(sdk, 3253, 3403);
await give(sdk, 'coins', 20_000);
const coins = () => sdk.getInventory().filter(i => i.name === 'Coins').reduce((a, i) => a + i.count, 0);
const opened = await bot.openShop(/^aubury$/i);
if (!opened.success) throw new Error(opened.message);
await waitUntil(sdk, st => st.shop.shopItems.length > 0, { maxTicks: 5 });

const item = (id: number): ShopItem => sdk.getState()!.shop.shopItems.find(i => i.id === id)!;
async function value(it: ShopItem): Promise<number | null> {
    const t0 = sdk.getState()!.tick;
    await sdk.sendClickComponentWithOption(SHOP_STOCK_COMPONENT, VALUE_OPTION, it.slot);
    const r = await waitUntil(sdk, st => st.gameMessages.some(m => m.tick >= t0 && parseValueMessage(m.text)?.name === it.name), { maxTicks: 6 });
    if (!r.ok) return null;
    const m = [...r.state.gameMessages].reverse().find(x => x.tick >= t0 && parseValueMessage(x.text)?.name === it.name);
    return m ? parseValueMessage(m.text)!.price : null;
}

const target = sdk
    .getState()!
    .shop.shopItems.filter(i => i.count > 20)
    .sort((a, b) => b.baseCost - a.baseCost)[0]!;
console.log(`shelf: ${sdk.getState()!.shop.title} ${JSON.stringify(sdk.getState()!.shop.shopConfig)}`);
for (const n of [1, 10, 10]) {
    const it = item(target.id);
    const valued = await value(it);
    const c0 = coins();
    const r = await bot.buyFromShop(it, n);
    await waitTicks(sdk, 2);
    const spent = c0 - coins();
    console.log(
        `RESULT buy ${JSON.stringify({ item: it.name, countBefore: it.count, sdkBuyPrice: it.buyPrice, valuePrice: valued, bought: r.amountBought ?? 0, spent, perUnit: (r.amountBought ?? 0) > 0 ? spent / r.amountBought! : null, firstUnitMatchesValue: valued !== null && (r.amountBought ?? 0) === 1 ? spent === valued : undefined })}`
    );
}
const after = item(target.id);
console.log(`RESULT after ${JSON.stringify({ item: after.name, count: after.count, sdkBuyPrice: after.buyPrice, valuePrice: await value(after) })}`);
await bot.closeShop();

// Sell some into the Lumbridge general store, which does not stock them: the
// shelf reader's next visit there sees stock outside the base config.
await mustTele(sdk, 3211, 3245);
const general = await bot.openShop(/^shop (keeper|assistant)$/i);
if (!general.success) throw new Error(general.message);
await waitUntil(sdk, st => st.shop.shopItems.length > 0, { maxTicks: 5 });
const c1 = coins();
const sold = await bot.sellToShop(new RegExp(`^${target.name}$`, 'i'), 10);
await waitTicks(sdk, 2);
const shelved = sdk.getState()!.shop.shopItems.find(i => i.id === target.id);
console.log(`RESULT sold-in ${JSON.stringify({ shop: sdk.getState()!.shop.title, item: target.name, sold: sold.success, received: coins() - c1, count: shelved?.count ?? null, sdkBuyPrice: shelved?.buyPrice ?? null, valuePrice: shelved ? await value(shelved) : null })}`);
await bot.closeShop();
process.exit(0);
