// Receiver-side hand-off measurement (docs/speedrun/helpers/mule.md).
//
//   MULE_PACKAGES='[{"name":"s23","items":[...]}]' \
//     bun docs/speedrun/scripts/mule-handoff.ts <receiver> <mule> <package> <rounds> <fast|stock>
//
// The mule runs speedrun/helpers/mule.ts with the same packages and serve:<receiver>
// (giver 'burst' or 'stock', preRequest on or off). Each round: with BENCH_CUE_DIR=<the mule's
// cueDir>, ask for the package by a cue scoped to its `scope.step` (serveMode 'request'; without
// it nothing is asked, for serveMode 'order'), wait until the mule
// is ready (its pre-request, or READY_WAIT_MS without one), then time the receive on
// THIS account's clock: from the trade request to the items in the inventory. With
// BENCH_RETURN=1 the items are traded back to the mule (unmeasured) after each round;
// otherwise they stay (noted stacks of the same ids merge, so the pack does not fill).
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
            const key = (m: { observationId?: number; tick: number }) => m.observationId ?? m.tick;
            const muleRequests = () =>
                sdk.getChat({ types: [TRADE_REQUEST_CHAT_TYPE], limit: 100 }).filter(m => canonName(m.sender) === canonName(mule));
            const seen = Math.max(-1, ...muleRequests().map(key));
            if (process.env.BENCH_CUE_DIR) {
                if (!pkg.scope) throw new Error(`package ${pkg.name} has no scope to ask for it by`);
                requestPackage(process.env.BENCH_CUE_DIR, receiver, pkg.scope.step, { tick: sdk.getState()!.tick, ms: Date.now() });
            }
            const waitUntil = Date.now() + (process.env.READY_WAIT_MS ? Number(process.env.READY_WAIT_MS) : 60_000);
            let preRequested = false;
            while (Date.now() < waitUntil) {
                if (muleRequests().some(m => key(m) > seen)) {
                    preRequested = true;
                    break;
                }
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
            if (process.env.BENCH_RETURN !== '1') {
                await sdk.waitForTicks(10); // the mule banks and withdraws the next package
                continue;
            }

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
