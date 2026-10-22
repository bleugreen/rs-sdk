// Lab probe: can a staff account's ::give output reach an ordinary, board-eligible bank? (rs/499)
//
// A staff account can only ::give to itself on a non-production world (::giveother and ::teleother
// are production-only, ClientCheatHandler.ts), so the hand-off is give-to-self, then trade. Nothing
// in trade.rs2, bank.rs2 or InvOps checks staff level, and an inventory slot is only {id, count},
// with no record of where the item came from.
//
// Needs the login server (LOGIN_SERVER=true EASY_STARTUP=true), so that staff level is per account
// (the `account` row) rather than LOCAL_STAFF_LEVEL for everyone. Three phases, with sqlite edits
// between them (see docs/markets/generator-content-shops.md, section 3):
//   --phase=login    both accounts log in once, which registers their rows at staff 0
//   --phase=stage    (both rows set to 4) leave Tutorial Island and teleport to Varrock west bank
//   --phase=handoff  (receiver row set back to 0) the receiver shows its cheats are refused; the giver
//                    ::gives itself 100M air runes and trades them; the receiver banks them and logs
//                    out, which runs updateHiscores; the giver logs out too
//
//   speedrun/lab/lab.sh <receiver> markets/research/trade-staff-handoff.ts:--giver=<name>:--phase=handoff
//
// Lab-only. Never run against the demo server.

import type { BotWorldState } from '../../sdk/types';
import { depositAll } from '../../speedrun/lib/bank';
import { closeSession, logoutClean, openSession } from '../../speedrun/lib/session';
import { giveAll, receiveFrom } from '../../speedrun/lib/trade';
import { waitTicks, waitUntil } from '../../speedrun/lib/wait';
import { arg, botArg, result } from '../../speedrun/lab/common';
import { cheat, leaveTutorial, mustTele, VARROCK_WEST_BANK } from '../../speedrun/lab/setup';
import { loadCosts, snap as snapWith } from './content-board-value';

const AIR = 100_000_000;
const phase = arg('phase', 'handoff');
const recv = await openSession(botArg());
const giver = await openSession(arg('giver', 'mkt499g'), { pathfinding: false });
const count = (s: BotWorldState | null, name: string) => (s?.inventory ?? []).filter(i => i.name === name).reduce((a, i) => a + i.count, 0);

async function done(code = 0): Promise<never> {
    await closeSession(recv);
    await closeSession(giver);
    process.exit(code);
}

if (phase === 'login') {
    result('login', { receiver: recv.name, giver: giver.name, receiverInGame: !!recv.sdk.getState()?.inGame, giverInGame: !!giver.sdk.getState()?.inGame });
    await done();
}

if (phase === 'stage') {
    for (const s of [recv, giver]) await leaveTutorial(s);
    await mustTele(recv.sdk, VARROCK_WEST_BANK.x - 2, VARROCK_WEST_BANK.z);
    await mustTele(giver.sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);
    // Log both out so the positions are saved through the login server.
    const r = await logoutClean(recv), g = await logoutClean(giver);
    result('stage', { receiverLoggedOut: r.ok, giverLoggedOut: g.ok });
    await done();
}

// ---- handoff
const costs = loadCosts();
const snap = (s: BotWorldState | null) => snapWith(costs, s);
const failures: string[] = [];
function expect(probe: string, ok: boolean, detail: object) {
    result(probe, { ok, ...detail });
    if (!ok) failures.push(probe);
}

// 1. The receiver is an ordinary account: its ::give is ignored (needs staff level 3, ClientCheatHandler.ts).
{
    const c0 = count(recv.sdk.getState(), 'Coins');
    await cheat(recv.sdk, 'give coins 1000', 4);
    const c1 = count(recv.sdk.getState(), 'Coins');
    expect('H1 receiver cheats refused (staff 0)', c1 === c0, { coinsBefore: c0, coinsAfter: c1 });
}

// 2. The giver (staff 4) makes 100M air runes for itself.
{
    await cheat(giver.sdk, `give airrune ${AIR}`, 3);
    const a = count(giver.sdk.getState(), 'Air rune');
    expect('H2 giver ::give airrune to itself (staff 4)', a >= AIR, { giverAirRunes: a });
}

// 3. Trade everything the giver holds to the receiver.
{
    const before = count(recv.sdk.getState(), 'Air rune');
    const req = recv.sdk.waitForTradeRequest({ from: giver.name, timeout: 20_000 });
    const g = giveAll(giver.sdk, recv.name);
    if (!(await req)) throw new Error('no trade request reached the receiver');
    const r = await receiveFrom(recv.sdk, giver.name);
    const gr = await g;
    await waitTicks(recv.sdk, 2);
    const after = count(recv.sdk.getState(), 'Air rune');
    expect('H3 trade staff-made stack to staff-0 account', r.ok && gr.ok && after - before >= AIR, {
        receiverAirBefore: before, receiverAirAfter: after, giverAirAfter: count(giver.sdk.getState(), 'Air rune'), reason: r.reason ?? gr.reason,
    });
}

// 4. The receiver banks it; board value by the updateHiscores formula.
{
    const opened = await recv.bot.openBank();
    if (!opened.success) throw new Error(`openBank: ${opened.message}`);
    const before = snap(recv.sdk.getState());
    await depositAll(recv.sdk);
    await waitUntil(recv.sdk, s => count(s, 'Air rune') === 0, { maxTicks: 10 });
    const after = snap(recv.sdk.getState());
    const airCost = costs.get(recv.sdk.getState()!.bank.items.find(i => i.name === 'Air rune')?.id ?? -1) ?? 0;
    expect('H4 receiver banks the stack', (after.bank['Air rune'] ?? 0) >= AIR, {
        bankAirRunes: after.bank['Air rune'] ?? 0, airRuneCost: airCost, boardBefore: before.boardValue, boardAfter: after.boardValue,
    });
    await recv.bot.closeBank();
}

// 5. Log both out: the login server runs updateHiscores on logout (LoginServer.ts), which writes a
// hiscore_bank row only for an account that hiscoreEligible accepts. The batch reads the rows from sqlite.
{
    const r = await logoutClean(recv);
    const g = await logoutClean(giver);
    await new Promise(res => setTimeout(res, 3000));
    let listed: boolean | null = null;
    try {
        const html = await (await fetch(`http://localhost:${process.env.WEB_PORT ?? 9910}/hiscores/bank?profile=main`)).text();
        listed = html.includes(`/hiscores/player/${recv.name}?`);
        result('H5 lab bank board', { receiverListed: listed, giverListed: html.includes(`/hiscores/player/${giver.name}?`) });
    } catch (err) {
        result('H5 lab bank board', { error: String(err) });
    }
    expect('H5 logged out', r.ok && g.ok, { receiverLoggedOut: r.ok, giverLoggedOut: g.ok });
}

result('trade-staff-handoff summary', { failures });
await done(failures.length ? 1 : 0);
