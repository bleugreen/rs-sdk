// Demo hand-off measurement between two helper accounts (cairn://p/rs/47, rs/88;
// docs/speedrun/helpers/wine.md). Never run it with the scored account.
//
//   bun docs/speedrun/scripts/wine-handoff.ts <maker> <receiver> [--mode=window|split] [--first=29]
//       [--max=450] [--arming=make|relog] [--launch-maker] [--trace]
//
// The maker (Cooking 35, grapes and jugs of water in its bank) is attached to
// its running lite client, or launched with --launch-maker. The receiver's
// client is launched by the script: it is prepared (tutorial skipped, walked to
// Varrock west bank), logged out, and logged in again for the measured delivery,
// as the scored account would be. Both bot.env files should point GATEWAY_URL at
// the same loopback gateway.
//
// window: receiveWine: receive the noted wines and deposit them all inside the
//         login window; the login timer ferments them at login+20.
// split:  splitDelivery: deposit `first`, ferment at login+20, then arm the rest
//         with one make (needs Cooking 35 after the first firing) or a relog.
// Both fall back to a clean relog if the bank opened too late for the login timer.
// Every tick count is on the receiver's own clock unless it says giver. --trace
// prints one TRACE line per receiver state change (chat, bank, Cooking xp).
import type { BotWorldState } from '../../../sdk/types';
import { giveWine, giveWineKit, makeNotedWine, prepareRearmKit } from '../../../speedrun/helpers/wine';
import { ITEM, VARROCK_WEST_BANK, invCount, prepare, tick, walkNear } from '../../../speedrun/helpers/wine-common';
import { awaitFiring, depositNotes, FERMENT_TIMER_TICKS, openBankThroughPages, receiveWine, splitDelivery, type SecondArming } from '../../../speedrun/helpers/wine-receive';
import { login, logoutClean, openSession, relog, type Session } from '../../../speedrun/lib/session';
import { waitUntil } from '../../../speedrun/lib/wait';

const args = process.argv.slice(2);
const [makerName, receiverName] = args.filter(a => !a.startsWith('--'));
const opt = (k: string, d: string) => args.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
if (!makerName || !receiverName) throw new Error('usage: wine-handoff.ts <maker> <receiver> [--mode=window|split] [--first=29] [--max=450] [--arming=make|relog] [--launch-maker] [--trace]');
for (const name of [makerName, receiverName]) if (!/^cairn_h\d+$/.test(name)) throw new Error('helper accounts (cairn_hNN) only, never the scored account');
const mode = opt('mode', 'window');
const first = Number(opt('first', '29'));
const max = Number(opt('max', '450'));
const arming = opt('arming', 'make') as SecondArming;

const ctxOf = (s: Session) => ({ sdk: s.sdk, bot: s.bot, log: (m: string, d?: Record<string, unknown>) => console.log(JSON.stringify({ bot: s.name, m, tick: tick(s.sdk), ...d })) });
const result = (name: string, data: unknown) => console.log(`RESULT ${name} ${JSON.stringify(data)}`);

const maker = await openSession(makerName, { launch: args.includes('--launch-maker') });
const M = ctxOf(maker);
await prepare(M);
// A grape camper may be upstairs in the Cooking Guild: climb down first.
for (let i = 0; i < 4 && (maker.sdk.getState()?.player?.level ?? 0) > 0; i++) {
    const level = maker.sdk.getState()!.player!.level;
    const down = (await maker.sdk.scanNearbyLocs(10)).filter(l => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some(o => /climb-down|climb down/i.test(o.text))).sort((a, b) => a.distance - b.distance)[0];
    if (!down) throw new Error('maker: no way down');
    await maker.bot.interactLoc(down, /climb-down|climb down/i);
    await waitUntil(maker.sdk, s => (s.player?.level ?? 0) < level, { maxTicks: 20 });
}
await walkNear(M, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z, 2);
const made = await makeNotedWine(M, max);
result('maker-made', { ...made, cooking: maker.sdk.getSkill('Cooking')?.baseLevel });
if (made.noted === 0) throw new Error('maker holds no noted wine (bank grapes and jugs of water first)');
if (mode === 'split' && arming === 'make') await prepareRearmKit(M);

const receiver = await openSession(receiverName, { launch: true });
const R = ctxOf(receiver);
await prepare(R);
await walkNear(R, VARROCK_WEST_BANK.x - 2, VARROCK_WEST_BANK.z, 2);
const cooking0 = receiver.sdk.getSkill('Cooking');
const out = await logoutClean(receiver);
if (!out.ok) throw new Error(`receiver logout: ${out.reason}`);
await Bun.sleep(5_000);

if (args.includes('--trace')) {
    let last = '';
    receiver.sdk.onStateUpdate((st: BotWorldState) => {
        if (!st.inGame) return;
        const d = st.dialog;
        const c = st.skills.find(k => k.name === 'Cooking');
        const row = `dlg=${d.isOpen ? (d.isWaiting ? 'W' : 'O') : '-'} bank=${st.bank.isOpen ? 1 : 0} trade=${st.interface.isOpen && !st.bank.isOpen ? st.interface.interfaceId : -1} cook=${c?.baseLevel}/${c?.experience} notes=${st.inventory.filter(i => i.id === ITEM.wineNote).reduce((n, i) => n + i.count, 0)}`;
        if (row !== last) console.log(`TRACE t=${st.tick} ${row}`);
        last = row;
    });
}

const relogReceiver = async () => {
    const r = await relog(receiver, { offlineMs: 3_000 });
    result('receiver-relog', { clickTick: r.logout.clickTick, lastInWorldTick: r.logout.lastInWorldTick, loginTick: r.loginTick });
    return r.loginTick;
};
const giving = mode === 'split' && arming === 'make' ? giveWineKit(M, receiver.name, 300_000) : giveWine(M, receiver.name, -1, 300_000);
let loginTick = -1;
const unsub = receiver.sdk.onStateUpdate((st: BotWorldState) => {
    if (loginTick < 0 && st.inGame && (st.player?.worldX ?? 0) > 0) loginTick = st.tick;
});
await login(receiver);
unsub();

if (mode === 'split') {
    const s = await splitDelivery(R, maker.name, { loginTick, first, arming, relog: relogReceiver });
    const L = s.loginTick;
    result('demo-split', {
        ...s,
        firstLoginTick: loginTick,
        firstBankOpenAfterLogin: s.firstBankOpenTick - loginTick,
        firstFermentAfterLogin: s.firstFermentTick - L,
        rearmMakeAfterLogin: s.rearmMakeTick >= 0 ? s.rearmMakeTick - L : null,
        secondFermentAfterLogin: s.arming === 'make' ? s.secondFermentTick - L : s.secondFermentTick - s.secondLoginTick,
        cookingBefore: cooking0?.baseLevel,
        giver: await giving
    });
} else {
    const r = await receiveWine(R, maker.name, { loginTick, relog: relogReceiver });
    const fired = await awaitFiring(receiver.sdk, r.loginTick + FERMENT_TIMER_TICKS);
    result('demo-window', {
        ...r,
        firstLoginTick: loginTick,
        tradeStartAfterLogin: r.firstClickTick - loginTick,
        bankOpenAfterLogin: r.bankOpenTick - loginTick,
        depositDoneAfterLogin: r.doneTick - loginTick,
        fermentAfterLogin: fired.fired ? fired.tick - r.loginTick : null,
        cookingBefore: cooking0?.baseLevel,
        cookingAfter: fired.level,
        giver: await giving
    });
}
const open = await openBankThroughPages(receiver.sdk);
if (open.ok) {
    result('receiver-bank', receiver.sdk.getBankItems().filter(i => /wine/i.test(i.name)).map(i => `${i.name} x${i.count}`));
    await depositNotes(receiver.sdk, 'all', { close: true }).catch(() => undefined);
    await receiver.bot.closeBank();
}
result('maker-left', { notes: invCount(maker.sdk, ITEM.wineNote) });
const lo = await logoutClean(receiver);
result('receiver-logout', { ok: lo.ok, reason: lo.reason });
if (args.includes('--launch-maker')) {
    const lm = await logoutClean(maker);
    result('maker-logout', { ok: lm.ok, reason: lm.reason });
}
process.exit(0);
