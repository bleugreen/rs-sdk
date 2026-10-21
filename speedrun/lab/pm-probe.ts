// Private-message delivery probe: does a PM from one account reach another,
// for a given pair of SDK gateways? Both accounts' clients must already be
// logged in (a lite runner or the browser). The verdict comes from the
// recipient's own chat, never from the send result: the friend server and the
// world drop undeliverable PMs without telling the sender
// (FriendServer.sendPrivateMessage, World's PRIVATE_MESSAGE handler).
//
//   bun speedrun/lab/pm-probe.ts --from=cairn_t27 --from-gw=wss://rs-sdk-demo.fly.dev/gateway \
//       --to=cairn_md --to-gw=ws://127.0.0.1:8581 [--wait=20]
//
// Credentials come from bots/<name>/bot.env. A gateway started with
// LOGIN_SERVER=false accepts any password, so the same command works against
// a loopback dev gateway and the public one.
import { BotSDK } from '../../sdk/index';
import { loadBotEnv } from '../lib/session';
import { arg, result } from './common';

async function connect(name: string, gatewayUrl: string, showChat = true): Promise<BotSDK> {
    const env = loadBotEnv(name);
    const sdk = new BotSDK({
        botUsername: env.BOT_USERNAME,
        password: env.PASSWORD,
        gatewayUrl,
        connectionMode: 'control',
        autoReconnect: false,
        autoLaunchBrowser: false,
        showChat,
    });
    await sdk.connect();
    await sdk.waitForCondition(s => s.inGame && !!s.player, 60_000);
    return sdk;
}

const from = arg('from', '');
const to = arg('to', '');
if (!from || !to) throw new Error('usage: bun speedrun/lab/pm-probe.ts --from=A --from-gw=URL --to=B --to-gw=URL');
const waitMs = Number(arg('wait', '20')) * 1000;

const sender = await connect(from, arg('from-gw', ''));
// --to-show-chat=false reproduces the fleet's SDK (showChat: false) and a helper bot.env's
// SHOW_CHAT=false: the SDK then drops every player chat line, PMs included, before getNewChat.
const receiver = await connect(to, arg('to-gw', ''), arg('to-show-chat', 'true') !== 'false');
const token = `pm probe ${Math.random().toString(36).slice(2, 7)}`;
// The server re-cases chat ("Pm probe ..."), so match case-insensitively.
const hasToken = (text: string) => text.toLowerCase().includes(token);
receiver.getNewChat({ types: [0, 1, 2, 3, 4, 5, 6, 7], includeSelf: true });
sender.getNewChat({ types: [0, 1, 2, 3, 4, 5, 6, 7], includeSelf: true });

const sentAt = Date.now();
const send = await sender.sendPrivateMessage(to, token);
let arrived: { type: number; sender: string; ms: number } | null = null;
while (Date.now() - sentAt < waitMs && !arrived) {
    const hit = receiver.getNewChat({ types: [0, 1, 2, 3, 4, 5, 6, 7], includeSelf: true }).find(m => hasToken(m.text));
    if (hit) arrived = { type: hit.type, sender: hit.sender, ms: Date.now() - sentAt };
    else await new Promise(r => setTimeout(r, 200));
}
const senderLines = sender.getNewChat({ types: [0, 1, 2, 3, 4, 5, 6, 7], includeSelf: true }).map(m => ({ type: m.type, text: m.text.slice(0, 80) }));
result('pm-probe', {
    from, fromGw: arg('from-gw', ''), to, toGw: arg('to-gw', ''), toShowChat: receiver.config.showChat,
    delivered: arrived !== null,
    arrived,
    send: { success: send.success, message: send.message, data: (send as { data?: unknown }).data },
    senderEcho: senderLines.some(l => l.type === 6 && hasToken(l.text)),
    senderSystem: senderLines.filter(l => l.type === 0),
});
await sender.disconnect();
await receiver.disconnect();
process.exit(0);
