// Log an account's browser tab out cleanly before its Chrome is stopped.
//
//   bun speedrun/tools/tab-logout.ts <account>
//
// Attaches to the tab through the gateway named in bots/<account>/bot.env (it never launches a
// client) and runs speedrun/lib/session.ts `logoutClean`: wait out the post-combat window, click
// logout, retry once if refused. Killing Chrome instead drops the client, which the server keeps in
// the world for up to 500 ticks; on a rehearsal or scored account that is playtime. The companion
// of tab-login.ts.
//
// The logout is confirmed by the page itself over Chrome's DevTools port (CDP_URL), not by the
// gateway: once a browser tab logs out the page stops publishing, and the gateway keeps its last
// state, `inGame: true` with status `stale`, so `logoutClean`'s own check times out on a tab that
// has left the world.
//
// Exit 0 when the page reports it is out of game (or there is no tab in game to log out); 1 when
// that is not confirmed, in which case do not kill Chrome yet: look at the tab.

import { closeSession, loadBotEnv, logoutClean, openSession } from '../lib/session';
import { tabInGame } from '../lib/tab';
import { sleep } from '../lib/wait';

const account = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!account) {
    console.error('usage: bun speedrun/tools/tab-logout.ts <account>');
    process.exit(2);
}
const env = loadBotEnv(account);
const name = env.BOT_USERNAME;
const cdp = env.CDP_URL ?? process.env.SPEEDRUN_CDP_URL ?? 'http://127.0.0.1:9222';
/** The page's own in-game flag; null when Chrome's DevTools port does not answer. */
const pageInGame = () => tabInGame(cdp, name).catch(() => null);

const before = await pageInGame();
if (before === null) {
    console.log(`[tab-logout] ${name}: Chrome's DevTools port ${cdp} does not answer; not confirmed`);
    process.exit(1);
}
if (!before) {
    console.log(`[tab-logout] ${name}: no tab in game; nothing to log out`);
    process.exit(0);
}

let session: Awaited<ReturnType<typeof openSession>>;
try {
    session = await openSession(account, { client: 'browser', pathfinding: false, readyTimeoutMs: 20_000 });
} catch (err) {
    console.log(`[tab-logout] ${name}: could not attach through the gateway (${(err as Error).message}); not confirmed`);
    process.exit(1);
}
const out = await logoutClean(session);
await closeSession(session);
const t0 = Date.now();
while (Date.now() - t0 < 15_000) {
    if ((await pageInGame()) === false) {
        console.log(`[tab-logout] ${name}: logged out; the page is out of game (logout click at tick ${out.clickTick}, ${out.wallMs} ms)`);
        process.exit(0);
    }
    await sleep(300);
}
console.log(`[tab-logout] ${name}: NOT confirmed, the page is still in game (${out.reason ?? 'logoutClean reported ok'}); do not kill Chrome yet`);
process.exit(1);
