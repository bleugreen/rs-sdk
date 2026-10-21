// Demo hand-off measurement between two helper accounts (cairn://p/rs/47;
// docs/speedrun/helpers/wine.md). Never run it with the scored account.
//
//   bun docs/speedrun/scripts/wine-handoff.ts <maker> <receiver> [--mode=window|split] [--first=13] [--max=450]
//
// The maker (Cooking 35, grapes and jugs of water in its bank, at Varrock west bank)
// must have its lite client running with no role on it; the script attaches to it.
// The receiver's client is launched by the script: it is prepared (tutorial skipped,
// walked to Varrock west bank), logged out, and logged in again for the measured
// delivery, as the scored account would be. Both bot.env files should point
// GATEWAY_URL at the same gateway as the maker's client.
//
// window: receive the noted wines and deposit them all inside the login window;
//         the login timer ferments them at login+20.
// split:  splitDelivery: deposit `first`, ferment at login+20, then deposit the rest
//         and make one wine to re-arm the timer (needs Cooking 35 after the first firing).
// Every tick count is on the receiver's own clock unless it says giver.
import type { BotWorldState } from '../../../sdk/types';
import { giveWine, giveWineKit, makeNotedWine, prepareRearmKit, receiveWine, splitDelivery } from '../../../speedrun/helpers/wine';
import { ITEM, VARROCK_WEST_BANK, closeBank, invCount, openBank, prepare, tick, walkNear } from '../../../speedrun/helpers/wine-common';
import { login, logoutClean, openSession, type Session } from '../../../speedrun/lib/session';
import { waitUntil } from '../../../speedrun/lib/wait';

const args = process.argv.slice(2);
const [makerName, receiverName] = args.filter(a => !a.startsWith('--'));
const opt = (k: string, d: string) => args.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
if (!makerName || !receiverName) throw new Error('usage: wine-handoff.ts <maker> <receiver> [--mode=window|split] [--first=13] [--max=450]');
if (/dot_md/i.test(receiverName) || /dot_md/i.test(makerName)) throw new Error('never with the scored account');
const mode = opt('mode', 'window');
const first = Number(opt('first', '13'));
const max = Number(opt('max', '450'));

const ctxOf = (s: Session) => ({ sdk: s.sdk, bot: s.bot, log: (m: string, d?: Record<string, unknown>) => console.log(JSON.stringify({ bot: s.name, m, tick: tick(s.sdk), ...d })) });
const result = (name: string, data: unknown) => console.log(`RESULT ${name} ${JSON.stringify(data)}`);

const maker = await openSession(makerName);
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
if (mode === 'split') await prepareRearmKit(M);

const receiver = await openSession(receiverName, { launch: true });
const R = ctxOf(receiver);
await prepare(R);
await walkNear(R, VARROCK_WEST_BANK.x - 2, VARROCK_WEST_BANK.z, 2);
const cooking0 = receiver.sdk.getSkill('Cooking');
const out = await logoutClean(receiver);
if (!out.ok) throw new Error(`receiver logout: ${out.reason}`);
await Bun.sleep(5_000);

const giving = mode === 'split' ? giveWineKit(M, receiver.name, 300_000) : giveWine(M, receiver.name, -1, 300_000);
let loginTick = -1;
const unsub = receiver.sdk.onStateUpdate((st: BotWorldState) => {
    if (loginTick < 0 && st.inGame && (st.player?.worldX ?? 0) > 0) loginTick = st.tick;
});
await login(receiver);
unsub();

if (mode === 'split') {
    const s = await splitDelivery(R, maker.name, { first });
    result('demo-split', {
        ...s,
        loginTick,
        firstFermentAfterLogin: s.firstFermentTick - loginTick,
        secondFermentAfterLogin: s.secondFermentTick - loginTick,
        receiverActionTicks: s.tradeTicks + s.firstBankTicks + s.levelUpTicks + s.rearmTicks + s.finalLevelUpTicks,
        cookingBefore: cooking0?.baseLevel,
        giver: await giving
    });
} else {
    const xp0 = receiver.sdk.getSkill('Cooking')?.experience ?? 0;
    const r = await receiveWine(R, maker.name);
    const fired = await waitUntil(receiver.sdk, () => (receiver.sdk.getSkill('Cooking')?.experience ?? 0) > xp0, { maxTicks: 40 });
    result('demo-window', {
        ...r,
        loginTick,
        tradeStartAfterLogin: r.firstClickTick - loginTick,
        depositDoneAfterLogin: r.doneTick - loginTick,
        fermentAfterLogin: fired.ok ? fired.tick - loginTick : null,
        cookingBefore: cooking0?.baseLevel,
        cookingAfter: receiver.sdk.getSkill('Cooking')?.baseLevel,
        giver: await giving
    });
}
await receiver.bot.dismissBlockingUI();
await openBank(R);
result('receiver-bank', receiver.sdk.getBankItems().filter(i => /wine/i.test(i.name)).map(i => `${i.name} x${i.count}`));
await closeBank(receiver.bot, receiver.sdk);
result('maker-left', { notes: invCount(maker.sdk, ITEM.wineNote) });
await logoutClean(receiver);
process.exit(0);
