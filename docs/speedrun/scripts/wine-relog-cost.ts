// What a clean relog costs the scored account in scored (in-world) ticks, on the
// demo (cairn://p/rs/88; docs/speedrun/helpers/wine.md). Never run it with the
// scored account.
//
//   bun docs/speedrun/scripts/wine-relog-cost.ts <account> [--n=6] [--offline-ms=2000]
//
// Launches <account>'s lite client (its bot.env should point GATEWAY_URL at a
// loopback gateway), skips the tutorial on a fresh account and walks to Varrock
// west bank (the first-login cost, reported as `first-login`), then n times:
// clean logout (the lib's logoutClean), offline wait, login, and a bank-booth
// click sent from the first state of the new session in which the booth is in
// sight. Per sample, on the account's own clock:
//
//   out     ticks from the logout click's tick to the last in-world tick (the
//           old session's ticks after the click)
//   in      tick of the probe click in the new session; the client's counter
//           restarts at launch and counts in-world ticks, so this is the ticks
//           the new session spent before its first action could be sent
//   cost    out + in: the scored ticks the relog adds
//   effect  ticks from the probe click to the bank opening (the round trip any
//           action has; not part of the cost)
import type { BotWorldState } from '../../../sdk/types';
import { VARROCK_WEST_BANK, prepare, tick, walkNear } from '../../../speedrun/helpers/wine-common';
import { findBooth } from '../../../speedrun/helpers/wine-receive';
import { logoutClean, openSession, relog } from '../../../speedrun/lib/session';
import { waitTicks, waitUntil } from '../../../speedrun/lib/wait';

const args = process.argv.slice(2);
const account = args.find(a => !a.startsWith('--'));
const opt = (k: string, d: string) => args.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
if (!account) throw new Error('usage: wine-relog-cost.ts <account> [--n=6] [--offline-ms=2000]');
if (!/^(cairn_h\d+|wfx\d+)$/.test(account)) throw new Error('helper accounts (cairn_hNN) or lab accounts (wfxN) only');
const n = Number(opt('n', '6'));
const offlineMs = Number(opt('offline-ms', '2000'));
const result = (name: string, data: unknown) => console.log(`RESULT ${name} ${JSON.stringify(data)}`);

let firstTick = -1;
const s = await openSession(account, { launch: true });
s.sdk.onStateUpdate((st: BotWorldState) => {
    if (firstTick < 0 && st.inGame) firstTick = st.tick;
});
const ctx = { sdk: s.sdk, bot: s.bot, log: (m: string, d?: Record<string, unknown>) => console.log(JSON.stringify({ m, tick: tick(s.sdk), ...d })) };
const t0 = tick(s.sdk);
const p0 = s.sdk.getState()?.player;
await prepare(ctx);
const tTut = tick(s.sdk);
const p1 = s.sdk.getState()?.player;
await walkNear(ctx, VARROCK_WEST_BANK.x - 2, VARROCK_WEST_BANK.z, 2);
const tBank = tick(s.sdk);
result('first-login', {
    firstStateTick: firstTick, connectedTick: t0, spawn: p0 && [p0.worldX, p0.worldZ], afterTutorialTick: tTut, afterTutorial: p1 && [p1.worldX, p1.worldZ], atBankTick: tBank,
    walkTicks: tBank - tTut, cooking: s.sdk.getSkill('Cooking')?.baseLevel
});

const costs: number[] = [];
for (let i = 0; i < n; i++) {
    await waitTicks(s.sdk, 3);
    const tLaunchAfter = Date.now();
    let probeTick = -1;
    let newFirst = -1;
    let openTick = -1;
    const unsub = s.sdk.onStateUpdate(st => {
        if (s.launchedAt < tLaunchAfter || !st.inGame || (st.player?.worldX ?? 0) <= 0) return;
        if (newFirst < 0) newFirst = st.tick;
        if (probeTick < 0) {
            const booth = findBooth(st);
            if (booth) {
                probeTick = st.tick;
                void s.sdk.sendInteractLoc(booth.x, booth.z, booth.id, booth.op);
            }
        } else if (openTick < 0 && st.bank.isOpen) openTick = st.tick;
    });
    const r = await relog(s, { offlineMs });
    await waitUntil(s.sdk, st => st.bank.isOpen, { maxTicks: 15 });
    unsub();
    if (s.sdk.getState()?.bank.isOpen) await s.bot.closeBank();
    const out = r.logout.lastInWorldTick - r.logout.clickTick;
    const cost = out + probeTick;
    costs.push(cost);
    // out counts in-world ticks after the click (scored); logoutWallMs and
    // loginWallMs are wall time, of which only the logout's overlaps in-world ticks.
    result('relog', { i, clickTick: r.logout.clickTick, lastInWorldTick: r.logout.lastInWorldTick, out, logoutWallMs: r.logout.wallMs, firstStateTick: newFirst, loginTick: r.loginTick, in: probeTick, cost, effect: openTick - probeTick, bankOpenTick: openTick, loginWallMs: r.loginWallMs, attempts: r.attempts, at: new Date().toISOString() });
}
const sorted = [...costs].sort((a, b) => a - b);
result('relog-cost', { n: costs.length, costs, min: sorted[0], median: sorted[Math.floor((sorted.length - 1) / 2)], max: sorted[sorted.length - 1], mean: Number((costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(2)) });

const lo = await logoutClean(s);
result('logout', { ok: lo.ok, reason: lo.reason });
process.exit(lo.ok ? 0 : 1);
