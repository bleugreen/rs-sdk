// Log an account's browser tab in through the page server, with the password
// in no URL and no process argument (server/webclient/login-token.ts).
//
//   bun speedrun/tools/tab-login.ts <account> [--bots-dir=DIR] [--cdp=http://127.0.0.1:9222]
//                                    [--client-url=URL] [--wait-ms=120000]
//
// Reads <bots-dir>/<account>/bot.env (default bots/), mints a one-time token
// from the proxy.ts page named by CLIENT_URL (or --client-url), and navigates
// the account's tab to it over CDP (CDP_URL, SPEEDRUN_CDP_URL or --cdp),
// opening a tab if Chrome has none showing ?bot=<account>. Then it waits for
// the page to report in game and exits 0, or exits 1 at --wait-ms.
//
// Chrome must already run with --remote-debugging-port; start it on the bare
// page (http://127.0.0.1:8899/bot?bot=<account>), which carries no secret and
// sits on the title screen until this navigates it.

import { loadBotEnv, openBrowserClient } from '../lib/session';
import { tabInGame } from '../lib/tab';
import { sleep } from '../lib/wait';

const argv = process.argv.slice(2);
const flag = (k: string) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const account = argv.find(a => !a.startsWith('--'));
if (!account) {
    console.error('usage: bun speedrun/tools/tab-login.ts <account> [--bots-dir=DIR] [--cdp=URL] [--client-url=URL] [--wait-ms=N]');
    process.exit(2);
}

const env = loadBotEnv(account, flag('bots-dir'));
const clientUrl = flag('client-url');
if (clientUrl) env.CLIENT_URL = clientUrl;
const cdp = flag('cdp') ?? env.CDP_URL ?? process.env.SPEEDRUN_CDP_URL ?? 'http://127.0.0.1:9222';
const waitMs = Number(flag('wait-ms') ?? 120_000);

const t0 = Date.now();
const how = await openBrowserClient(env, { cdp });
console.log(`[tab-login] ${env.BOT_USERNAME}: tab ${how} with a one-time token`);
while (Date.now() - t0 < waitMs) {
    if (await tabInGame(cdp, env.BOT_USERNAME).catch(() => false)) {
        console.log(`[tab-login] ${env.BOT_USERNAME}: in game after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
        process.exit(0);
    }
    await sleep(500);
}
console.error(`[tab-login] ${env.BOT_USERNAME}: not in game after ${waitMs} ms`);
process.exit(1);
