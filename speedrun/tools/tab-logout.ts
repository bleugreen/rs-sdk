// Log an account's browser tab out cleanly before its Chrome is stopped.
//
//   bun speedrun/tools/tab-logout.ts <account>
//
// Attaches to the tab through the gateway named in bots/<account>/bot.env (it never launches a
// client) and runs speedrun/lib/session.ts `logoutClean`: wait out the post-combat window, click
// logout, retry once if refused, and confirm the account has left the world. Killing Chrome
// instead drops the client, which the server keeps in the world for up to 500 ticks; on a
// rehearsal or scored account that is playtime. The companion of tab-login.ts.
//
// Exit 0 when the logout is confirmed or the tab is already out of game; 1 when it is not
// confirmed or the tab cannot be reached, in which case do not kill Chrome yet: look at the tab.

import { closeSession, logoutClean, openSession } from '../lib/session';

const account = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!account) {
    console.error('usage: bun speedrun/tools/tab-logout.ts <account>');
    process.exit(2);
}

let session: Awaited<ReturnType<typeof openSession>>;
try {
    session = await openSession(account, { client: 'browser', pathfinding: false, readyTimeoutMs: 20_000 });
} catch (err) {
    console.log(`[tab-logout] ${account}: could not attach through the gateway (${(err as Error).message}); not confirmed`);
    process.exit(1);
}
const out = await logoutClean(session);
await closeSession(session);
if (out.ok) {
    console.log(`[tab-logout] ${account}: logged out (click tick ${out.clickTick}, last tick in world ${out.lastInWorldTick}, ${out.wallMs} ms)`);
    process.exit(0);
}
if (out.reason === 'not in game') {
    console.log(`[tab-logout] ${account}: already out of game`);
    process.exit(0);
}
console.log(`[tab-logout] ${account}: NOT confirmed (${out.reason}); do not kill Chrome yet`);
process.exit(1);
