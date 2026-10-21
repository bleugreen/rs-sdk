// Move supplies between two helper accounts at Varrock west bank (cairn://p/rs/88):
// the giver withdraws `n` of an item as notes from its bank, both meet at the
// bank, one trade, the receiver banks it (the bank un-notes it), both log out
// cleanly. Never with the scored account.
//
//   bun docs/speedrun/scripts/supply-transfer.ts <from> <to> <itemId> <n>
//
// Launches both lite clients (their bot.env should point GATEWAY_URL at a
// loopback gateway). Either account may start anywhere on the surface or
// upstairs in the Cooking Guild.
import { ITEM, VARROCK_WEST_BANK, closeBank, invCount, openBank, prepare, tick, walkNear } from '../../../speedrun/helpers/wine-common';
import { waitForPlayer } from '../../../speedrun/helpers/wine';
import { depositMatching, withdrawMany } from '../../../speedrun/lib/bank';
import { logoutClean, openSession, type Session } from '../../../speedrun/lib/session';
import { give, receiveFrom } from '../../../speedrun/lib/trade';
import { waitUntil } from '../../../speedrun/lib/wait';

const [from, to, idArg, nArg] = process.argv.slice(2);
if (!from || !to || !idArg || !nArg) throw new Error('usage: supply-transfer.ts <from> <to> <itemId> <n>');
for (const a of [from, to]) if (!/^cairn_h\d+$/.test(a)) throw new Error('helper accounts (cairn_hNN) only');
const id = Number(idArg);
const n = Number(nArg);
const result = (name: string, data: unknown) => console.log(`RESULT ${name} ${JSON.stringify(data)}`);
const ctxOf = (s: Session) => ({ sdk: s.sdk, bot: s.bot, log: (m: string, d?: Record<string, unknown>) => console.log(JSON.stringify({ bot: s.name, m, tick: tick(s.sdk), ...d })) });

async function downstairs(s: Session): Promise<void> {
    for (let i = 0; i < 4 && (s.sdk.getState()?.player?.level ?? 0) > 0; i++) {
        const level = s.sdk.getState()!.player!.level;
        const down = (await s.sdk.scanNearbyLocs(10)).filter(l => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some(o => /climb-down|climb down/i.test(o.text))).sort((a, b) => a.distance - b.distance)[0];
        if (!down) throw new Error(`${s.name}: no way down`);
        await s.bot.interactLoc(down, /climb-down|climb down/i);
        await waitUntil(s.sdk, st => (st.player?.level ?? 0) < level, { maxTicks: 20 });
    }
}

const giver = await openSession(from, { launch: true });
const taker = await openSession(to, { launch: true });
const G = ctxOf(giver);
const T = ctxOf(taker);
await Promise.all([prepare(G), prepare(T)]);
await Promise.all([downstairs(giver), downstairs(taker)]);

// The giver takes the notes from whichever bank it is nearest, then walks over.
await openBank(G);
const inBank = giver.sdk.getBankItems().find(i => i.id === id)?.count ?? 0;
if (inBank < n) throw new Error(`${from} has only ${inBank} of item ${id} in its bank`);
const w = await withdrawMany(giver.sdk, [{ item: id, n, asNote: true }]);
await closeBank(giver.bot, giver.sdk);
const noted = invCount(giver.sdk, id + 1);
result('withdrawn', { ok: w.ok, noted });
if (noted < n) throw new Error(`withdrew only ${noted} noted`);

await Promise.all([walkNear(G, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z, 2), walkNear(T, VARROCK_WEST_BANK.x - 1, VARROCK_WEST_BANK.z, 2)]);
if (!(await waitForPlayer(giver.sdk, to, 60_000))) throw new Error(`${to} never came into sight`);
const [g, r] = await Promise.all([
    give(giver.sdk, to, [{ item: id + 1, n }], { openTimeoutMs: 60_000 }),
    receiveFrom(taker.sdk, from, { openTimeoutMs: 60_000 })
]);
result('trade', { gave: g.ok, received: r.received.map(i => `${i.name} x${i.count}`), reason: g.reason ?? r.reason });

await openBank(T);
await depositMatching(taker.sdk, [id + 1]);
result('taker-bank', { item: id, count: taker.sdk.getBankItems().find(i => i.id === id)?.count ?? 0, grapes: taker.sdk.getBankItems().find(i => i.id === ITEM.grapes)?.count ?? 0 });
await closeBank(taker.bot, taker.sdk);

for (const s of [giver, taker]) {
    const lo = await logoutClean(s);
    result('logout', { account: s.name, ok: lo.ok, reason: lo.reason });
}
process.exit(0);
