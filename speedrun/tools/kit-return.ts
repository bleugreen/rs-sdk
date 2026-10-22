// Return kit items to their giver after a rehearsal row is stamped (a later login no longer moves
// the row: a hiscore stamp moves only when a level is gained).
//
//   bun speedrun/tools/kit-return.ts <account> --to=<giver> --items=rune_axe:1[,item:n...] [--at=3222,3222]
//
// The account's tab must already be in game (tab-login.ts); this attaches through the gateway in
// bots/<account>/bot.env, runs to `--at` (the giver's tile, Lumbridge by default), opens the trade
// itself and offers exactly the listed items (debug names, as rehearse.ts --kit), retrying once if
// the first trade closes (a giver serves one request at a time), then logoutClean, confirmed by the
// page over CDP as tab-logout.ts does. Exit 0 only when the items left the pack and the page is out
// of game.

import { parseKit } from '../rehearse';
import { closeSession, loadBotEnv, logoutClean, openSession } from '../lib/session';
import { tabInGame } from '../lib/tab';
import { give } from '../lib/trade';
import { sleep } from '../lib/wait';

const args = process.argv.slice(2);
const account = args.find(a => !a.startsWith('--'));
const opt = (k: string) => args.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const giver = opt('to');
const itemsSpec = opt('items');
const at = (opt('at') ?? '3222,3222').split(',').map(Number) as [number, number];
if (!account || !giver || !itemsSpec || at.length !== 2 || at.some(n => !Number.isInteger(n))) {
    console.error('usage: bun speedrun/tools/kit-return.ts <account> --to=<giver> --items=item:n[,...] [--at=x,z]');
    process.exit(2);
}
const items = parseKit(itemsSpec);
const env = loadBotEnv(account);
const name = env.BOT_USERNAME;
const cdp = env.CDP_URL ?? process.env.SPEEDRUN_CDP_URL ?? 'http://127.0.0.1:9222';
const re = (n: string) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const held = (inv: ReadonlyArray<{ name: string; count: number }>, n: string) => inv.filter(i => re(n).test(i.name)).reduce((s, i) => s + Math.max(1, i.count), 0);

const session = await openSession(account, { client: 'browser', pathfinding: true, readyTimeoutMs: 30_000 });
const { sdk, bot } = session;
const tick = () => sdk.getState()?.tick ?? -1;
const before = Object.fromEntries(items.map(k => [k.name, held(sdk.getState()!.inventory, k.name)]));
console.log(`[kit-return] ${name}: in game at ${sdk.getState()?.player?.worldX},${sdk.getState()?.player?.worldZ} (T${tick()}); holds ${JSON.stringify(before)}`);
let ok = false;
try {
    const missing = items.filter(k => before[k.name]! < k.amount);
    if (missing.length) throw new Error(`not holding ${missing.map(k => `${k.amount} ${k.name}`).join(', ')}`);
    const w = await bot.walkTo(at[0], at[1], 2, { timeout: 180_000 });
    if (!w.success) throw new Error(`walk to ${at.join(',')}: ${w.message}`);
    console.log(`[kit-return] at ${sdk.getState()?.player?.worldX},${sdk.getState()?.player?.worldZ} (T${tick()})`);
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
        const r = await give(sdk, giver, items.map(k => ({ item: re(k.name), n: k.amount })), { maxTicks: 60, openTimeoutMs: 45_000 });
        console.log(`[kit-return] trade ${attempt}: ${r.ok ? 'ok' : `failed (${r.reason})`}, ${r.ticks} ticks, gave ${JSON.stringify(r.gave)}`);
        ok = r.ok;
        if (!ok) await sdk.waitForTicks(3);
    }
    const after = Object.fromEntries(items.map(k => [k.name, held(sdk.getState()!.inventory, k.name)]));
    console.log(`[kit-return] holds after: ${JSON.stringify(after)}`);
    ok = ok && items.every(k => after[k.name] === before[k.name]! - k.amount);
} catch (err) {
    console.log(`[kit-return] ${(err as Error).message}`);
}
const out = await logoutClean(session);
await closeSession(session);
let outOfGame = false;
for (const t0 = Date.now(); Date.now() - t0 < 15_000; await sleep(300)) {
    if ((await tabInGame(cdp, name).catch(() => null)) === false) {
        outOfGame = true;
        break;
    }
}
console.log(`[kit-return] ${name}: ${outOfGame ? 'logged out; the page is out of game' : 'logout NOT confirmed by the page: look at the tab before stopping Chrome'} (click on tick ${out.clickTick})`);
process.exit(ok && outOfGame ? 0 : 1);
