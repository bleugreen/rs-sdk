// Hand items from FROM's bank to TO by trade at Varrock West bank, through the bones dev gateway:
// coins as they are, anything else as banknotes. FROM's role must be paused (touch run/pause-FROM,
// then SIGINT its role PID); TO's bones role must be waiting at Varrock West (phase food:coins)
// with a coinsFrom pattern matching FROM. It accepts coins and its food item only.
//   bun docs/speedrun/scripts/bones-dev/give.ts FROM TO Coins=20000 Shark=40   (from the dev copy's root)
import { readFileSync } from 'node:fs';
import { BotActions } from '../../../../sdk/actions';
import { BotSDK } from '../../../../sdk/index';
import { give } from '../../../../speedrun/lib/trade';

const [from, to, ...specArgs] = process.argv.slice(2) as [string, string, ...string[]];
const specs = specArgs.map(a => {
    const [name, n] = a.split('=') as [string, string];
    return { name, n: Number(n) };
});
const env = Object.fromEntries(readFileSync(`bots/${from}/bot.env`, 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const port = process.env.BONES_PORT ?? '7782';
const sdk = new BotSDK({ botUsername: from, password: env.PASSWORD!, gatewayUrl: `ws://127.0.0.1:${port}`, connectionMode: 'control', autoReconnect: true, autoLaunchBrowser: false, showChat: false });
const bot = new BotActions(sdk);
await sdk.connect();
await sdk.waitForCondition(s => !!s.player && s.inGame, 30_000);
const exact = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const carried = (name: string) => sdk.getInventory().filter(i => exact(name).test(i.name)).reduce((a, i) => a + i.count, 0);
const p = sdk.getState()!.player!;
if (Math.max(Math.abs(p.worldX - 3185), Math.abs(p.worldZ - 3436)) > 8) await bot.walkTo(3185, 3436, 2, { timeout: 600_000 });
const o = await bot.openBank();
if (!o.success) throw new Error(`bank: ${o.message}`);
for (const s of specs) {
    const want = s.n - carried(s.name);
    if (want > 0) await bot.withdrawItem(exact(s.name), want, { asNote: !/^coins$/i.test(s.name) });
}
await bot.closeBank();
console.log(`${from} carries ${specs.map(s => `${s.name} ${carried(s.name)}`).join(', ')}; giving to ${to}`);
// The giver offers one slot per item id, so give every id carried under each name (a withdrawal
// can leave both ordinary items and their banknotes in the pack), all of each.
const ids = [...new Set(sdk.getInventory().filter(i => specs.some(s => exact(s.name).test(i.name))).map(i => i.id))];
const r = await give(sdk, to.replace(/_/g, ' '), ids.map(id => ({ item: id, n: 'all' as const })), { openTimeoutMs: 60_000, maxTicks: 200 });
console.log(JSON.stringify({ ok: r.ok, ticks: r.ticks, gave: r.gave, reason: r.reason }));
const back = await bot.openBank();
if (back.success) {
    for (const s of specs) if (carried(s.name) > 0) await bot.depositItem(exact(s.name), -1);
    await bot.closeBank();
}
process.exit(0);
