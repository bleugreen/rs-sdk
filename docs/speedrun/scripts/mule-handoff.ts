// Receiver-side hand-off measurement (docs/speedrun/helpers/mule.md).
//
//   MULE_PACKAGES='[{"name":"s23","items":[...]}]' \
//     bun docs/speedrun/scripts/mule-handoff.ts <receiver> <mule> <package> <rounds> <fast|stock>
//
// The mule runs speedrun/helpers/mule.ts with the same packages and
// serveMode:'request', serve:<receiver> (giver 'burst' or 'stock', preRequest on or
// off). Each round: PM the package name, wait until the mule is ready (its
// pre-request, or 15 s without one), then time the receive on THIS account's
// clock: from the trade request to the items in the inventory. The items are then
// traded back to the mule (unmeasured) so the next round reuses them.
//
// fast  = speedrun/helpers/mule.ts receivePackage (accept the tick the offer is complete)
// stock = bot.trade(mule, { want })
import { runScript } from '../../../sdk/runner';
import type { TradeItemSpec } from '../../../sdk/types';
import { TRADE_REQUEST_CHAT_TYPE } from '../../../sdk/types';
import { canonName, countById, firstSlotPerId, playerPattern, receivePackage, requestPackage, type Package } from '../../../speedrun/helpers/mule';

const [, , receiver, mule, pkgName, roundsArg, mode = 'fast'] = process.argv;
if (!receiver || !mule || !pkgName) throw new Error('usage: mule-handoff.ts <receiver> <mule> <package> <rounds> <fast|stock>');
const rounds = Number(roundsArg ?? 3);
const packages = JSON.parse(process.env.MULE_PACKAGES ?? '[]') as Package[];
const pkg = packages.find(p => p.name === pkgName);
if (!pkg) throw new Error(`package ${pkgName} not in MULE_PACKAGES`);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const want: TradeItemSpec[] = pkg.items.map(i => ({ item: new RegExp(`^${esc(i.item)}$`, 'i'), amount: i.amount }));

await runScript(
    async ({ bot, sdk }) => {
        const results: Record<string, unknown>[] = [];
        for (let round = 1; round <= rounds; round++) {
            // Readiness: the mule's pre-request lands as a type-4 "wishes to trade" line.
            const seen = sdk.getChat({ types: [TRADE_REQUEST_CHAT_TYPE], limit: 100 }).length;
            await requestPackage(sdk, mule, pkg.name);
            const deadline = Date.now() + 60_000;
            let preRequested = false;
            while (Date.now() < deadline) {
                const reqs = sdk.getChat({ types: [TRADE_REQUEST_CHAT_TYPE], limit: 100 });
                if (reqs.slice(seen).some(m => canonName(m.sender) === canonName(mule)) || reqs.length > seen && reqs.slice(-1)[0] && canonName(reqs.slice(-1)[0]!.sender) === canonName(mule)) {
                    preRequested = true;
                    break;
                }
                if (mode === 'stock' && Date.now() > deadline - 45_000) break; // 15 s for a mule without pre-request
                await sdk.waitForTicks(1);
            }

            const before = countById(sdk.getInventory());
            const startTick = sdk.getState()!.tick;
            let itemsTick = -1;
            const off = sdk.onStateUpdate(s => {
                if (itemsTick >= 0) return;
                const now = countById(s.inventory);
                const gained = [...now].some(([id, n]) => n > (before.get(id) ?? 0));
                if (gained && !s.trade?.isOpen) itemsTick = s.tick;
            });
            let ok: boolean;
            let message: string;
            if (mode === 'fast') {
                const r = await receivePackage(sdk, bot, { mule, want, timeoutMs: 60_000 });
                ok = r.success;
                message = r.message;
            } else {
                const r = await bot.trade(playerPattern(mule), { want, timeout: 60_000, requestTimeout: 30_000 });
                ok = r.success;
                message = r.message;
            }
            const returnTick = sdk.getState()!.tick;
            off();
            const line = {
                round,
                package: pkg.name,
                stacks: pkg.items.length,
                mode,
                preRequested,
                ok,
                ticksToItems: itemsTick >= 0 ? itemsTick - startTick : null,
                ticksToReturn: returnTick - startTick,
                message
            };
            console.log(JSON.stringify(line));
            results.push(line);
            if (!ok) break;

            // Hand everything back (unmeasured) so the mule can serve the next round.
            await sdk.waitForTicks(2);
            const back = firstSlotPerId(sdk.getInventory().filter(i => (countById(sdk.getInventory()).get(i.id) ?? 0) > (before.get(i.id) ?? 0)));
            const r = await bot.trade(playerPattern(mule), {
                give: back.map(i => ({ item: new RegExp(`^${esc(i.name)}$`, 'i'), amount: -1 })),
                timeout: 60_000,
                requestTimeout: 30_000,
                retryOnBusy: true
            });
            if (!r.success) {
                console.log(JSON.stringify({ round, returnFailed: r.message }));
                break;
            }
            await sdk.waitForTicks(10); // the mule banks and re-arms
        }
        const done = results.filter(r => r.ok && typeof r.ticksToItems === 'number').map(r => r.ticksToItems as number);
        console.log(JSON.stringify({ summary: { package: pkg.name, mode, n: done.length, ticksToItems: done, mean: done.reduce((a, b) => a + b, 0) / Math.max(1, done.length) } }));
    },
    { printState: false }
);
