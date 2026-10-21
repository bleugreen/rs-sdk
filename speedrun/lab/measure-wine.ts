// Wine: fermentation timer, noted wine, and the hand-off on the receiver's clock
// (cairn://p/rs/47; results in docs/speedrun/helpers/wine.md).
//
//   LAB_PORTS="9540 9541 9542 44540 8540" LAB_RUNNERS=0 LAB_BOTS=winercv1 \
//     speedrun/lab/lab.sh winemkr1 speedrun/lab/measure-wine.ts:--receiver=winercv1[:--big=450]
//
// Launches and relogs both clients itself (LAB_RUNNERS=0). Prints one RESULT line
// per test; every tick count is on the named bot's own clock, and a relaunched
// client restarts its tick counter, so login-relative ticks are counted from the
// first in-world state of the new session.
import type { BotWorldState } from '../../sdk/types';
import { giveWine, makeNotedWine, makeWines, receiveWine } from '../helpers/wine';
import { ITEM, bankCount, closeBank, depositAllExcept, invCount, openBank, prepare, tick } from '../helpers/wine-common';
import { depositAll } from '../lib/bank';
import { login, logoutClean, openSession, type Session } from '../lib/session';
import { waitTicks } from '../lib/wait';
import { arg, botArg, result } from './common';
import { cheat, give, setstat, tele, VARROCK_WEST_BANK } from './setup';

const big = Number(arg('big', '450'));
const maker = await openSession(botArg(), { launch: true });
const receiver = await openSession(arg('receiver', 'winercv1'), { launch: true });

const ctx = (s: Session) => ({ sdk: s.sdk, bot: s.bot, log: (m: string, d?: Record<string, unknown>) => console.log(JSON.stringify({ bot: s.name, m, tick: tick(s.sdk), ...d })) });
const M = ctx(maker);
const R = ctx(receiver);

const fermented = (s: Session) => invCount(s.sdk, ITEM.jugWine) + invCount(s.sdk, ITEM.badWine);

/** Wait (up to `max` ticks) until the fermented count exceeds `baseline`; returns that tick or -1. */
async function waitFerment(s: Session, max: number, baseline: number): Promise<number> {
    const start = tick(s.sdk);
    while (tick(s.sdk) - start <= max) {
        if (fermented(s) > baseline) return tick(s.sdk);
        await s.sdk.waitForStateUpdate();
    }
    return -1;
}

/** Wait until Cooking xp rises above `xp0`, up to `max` ticks past `from`; returns that tick or -1. */
async function waitXp(s: Session, xp0: number, from: number, max: number): Promise<number> {
    while (tick(s.sdk) - from <= max) {
        if ((s.sdk.getSkill('Cooking')?.experience ?? 0) > xp0) return tick(s.sdk);
        await s.sdk.waitForStateUpdate();
    }
    return -1;
}

/**
 * Clean logout, a short wall-clock wait (free: no ticks pass for the account), and
 * a fresh login. Returns the tick of the new session's first in-world state.
 */
async function relog(s: Session): Promise<number> {
    const out = await logoutClean(s);
    if (!out.ok) throw new Error(`${s.name}: logout failed: ${out.reason}`);
    await Bun.sleep(3_000);
    let first: number | null = null;
    const unsub = s.sdk.onStateUpdate((st: BotWorldState) => {
        if (first === null && st.inGame && (st.player?.worldX ?? 0) > 0) first = st.tick;
    });
    await login(s);
    unsub();
    return first ?? tick(s.sdk);
}

/** Bank `n` grapes and `n` jugs of water, given as notes (the bank unnotes them). */
async function stockIngredients(s: Session, n: number): Promise<void> {
    await give(s.sdk, ['cert_grapes', 'cert_jug_water'], n);
    await openBank(ctx(s));
    await depositAll(s.sdk);
    await closeBank(s.bot, s.sdk);
}

for (const s of [maker, receiver]) await prepare(ctx(s));
await tele(maker.sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);
await tele(receiver.sdk, VARROCK_WEST_BANK.x - 2, VARROCK_WEST_BANK.z);
await setstat(maker.sdk, 'cooking', 35);
await waitTicks(maker.sdk, 25); // let the login timer pass

// T1: does a second make within 20 ticks replace the timer?
await give(maker.sdk, ['grapes', 'jug_water'], 2);
await makeWines(M, 1);
const tA = tick(maker.sdk);
await waitTicks(maker.sdk, 15);
await makeWines(M, 1);
const tB = tick(maker.sdk);
const tF = await waitFerment(maker, 40, fermented(maker));
result('T1-timer-reset', { firstMakeTick: tA, secondMakeTick: tB, fermentTick: tF, sinceFirst: tF - tA, sinceSecond: tF - tB });

// T2: an open bank (a modal) holds the timer
await give(maker.sdk, ['grapes', 'jug_water'], 1);
await makeWines(M, 1);
const tC = tick(maker.sdk);
await openBank(M);
while (tick(maker.sdk) < tC + 35) await maker.sdk.waitForStateUpdate();
const heldInBank = invCount(maker.sdk, ITEM.wine);
const base2 = fermented(maker);
const tX = tick(maker.sdk);
await closeBank(maker.bot, maker.sdk);
const tF2 = await waitFerment(maker, 30, base2);
result('T2-modal-hold', { makeTick: tC, closeTick: tX, unfermentedAtClose: heldInBank, fermentTick: tF2, afterClose: tF2 - tX });

await openBank(M);
await depositAll(maker.sdk);
await closeBank(maker.bot, maker.sdk);

// T3: 28 wines from banked ingredients, held as notes
await stockIngredients(maker, 28);
const m28 = await makeNotedWine(M, 28);
result('T3-make-28-noted', { ...m28 });
const tN = tick(maker.sdk);
await waitTicks(maker.sdk, 30);
result('T3b-notes-after-30-ticks', { notes: invCount(maker.sdk, ITEM.wineNote), loose: invCount(maker.sdk, ITEM.wine), fermented: fermented(maker), since: tick(maker.sdk) - tN });

// T4: the notes survive the maker's own logout and login
const tL = await relog(maker);
await waitTicks(maker.sdk, 30);
result('T4-notes-after-relog', { loginTick: tL, notes: invCount(maker.sdk, ITEM.wineNote), fermented: fermented(maker) });

// T5: hand-off to a Cooking-1 receiver; deposit; ferment at its next login
const xp0 = receiver.sdk.getSkill('Cooking')?.experience ?? 0;
const [g5, r5] = await Promise.all([giveWine(M, receiver.name), receiveWine(R, maker.name)]);
result('T5-trade-and-deposit', { giverTicks: g5.ticks, given: g5.given, receiverTradeTicks: r5.tradeTicks, receiverBankTicks: r5.bankTicks, deposited: r5.deposited });
const tR = await relog(receiver);
const tXp = await waitXp(receiver, xp0, tR, 60);
await openBank(R);
const bank5 = receiver.sdk.getBankItems().filter(i => /wine/i.test(i.name)).map(i => `${i.name} x${i.count}`);
await closeBank(receiver.bot, receiver.sdk);
result('T5b-ferment-after-relog', { loginTick: tR, xpTick: tXp, afterLogin: tXp - tR, cooking: receiver.sdk.getSkill('Cooking')?.baseLevel, bank: bank5 });

// T6: deliver inside the receiver's login window, no extra relog. The giver is
// waiting with the notes before the receiver logs in, as a helper would be.
await stockIngredients(maker, 14);
await makeNotedWine(M, 14);
const xp1 = receiver.sdk.getSkill('Cooking')?.experience ?? 0;
await logoutClean(receiver);
await Bun.sleep(3_000);
const g6 = giveWine(M, receiver.name, -1, 120_000);
let tR2 = -1;
const unsub = receiver.sdk.onStateUpdate(st => {
    if (tR2 < 0 && st.inGame && (st.player?.worldX ?? 0) > 0) tR2 = st.tick;
});
await login(receiver);
unsub();
const r6 = await receiveWine(R, maker.name);
const tXp2 = await waitXp(receiver, xp1, tR2, 80);
result('T6-login-window', {
    loginTick: tR2,
    tradeStartAfterLogin: r6.firstClickTick - tR2,
    receiverTradeTicks: r6.tradeTicks,
    receiverBankTicks: r6.bankTicks,
    depositDoneAfterLogin: r6.doneTick - tR2,
    xpAfterLogin: tXp2 - tR2,
    giverTicks: (await g6).ticks,
    cooking: receiver.sdk.getSkill('Cooking')?.baseLevel
});

// T7: grapes + jug of water on a receiver below Cooking 35
await setstat(receiver.sdk, 'cooking', 20);
await give(receiver.sdk, ['grapes', 'jug_water'], 1);
const g = receiver.sdk.getInventory().find(i => i.id === ITEM.grapes)!;
const j = receiver.sdk.getInventory().find(i => i.id === ITEM.jugWater)!;
await receiver.sdk.sendUseItemOnItem(g.slot, j.slot);
await waitTicks(receiver.sdk, 3);
result('T7-low-level-make', { wine: invCount(receiver.sdk, ITEM.wine), grapesLeft: invCount(receiver.sdk, ITEM.grapes), messages: receiver.sdk.getState()?.gameMessages.slice(-2).map(x => x.text) });
await openBank(R);
await depositAll(receiver.sdk);
await closeBank(receiver.bot, receiver.sdk);

// T8: the full batch. Make `big` noted wines, hand them over in one trade, deposit,
// and ferment them at Cooking 1 on the receiver's next login.
await stockIngredients(maker, big);
const t8 = tick(maker.sdk);
const mBig = await makeNotedWine(M, big);
result('T8-make-big-noted', { ...mBig, wallTicks: tick(maker.sdk) - t8, perWine: Number((mBig.ticks / Math.max(1, mBig.made)).toFixed(2)) });
await setstat(receiver.sdk, 'cooking', 1);
const [g8, r8] = await Promise.all([giveWine(M, receiver.name), receiveWine(R, maker.name)]);
result('T8b-trade-and-deposit', { given: g8.given, giverTicks: g8.ticks, receiverTradeTicks: r8.tradeTicks, receiverBankTicks: r8.bankTicks, deposited: r8.deposited });
const xp8 = receiver.sdk.getSkill('Cooking')?.experience ?? 0;
const tR8 = await relog(receiver);
const tXp8 = await waitXp(receiver, xp8, tR8, 60);
await waitTicks(receiver.sdk, 3);
await openBank(R);
const bank8 = receiver.sdk.getBankItems().filter(i => /wine/i.test(i.name)).map(i => `${i.name} x${i.count}`);
await closeBank(receiver.bot, receiver.sdk);
result('T8c-ferment-big', { afterLogin: tXp8 - tR8, cooking: receiver.sdk.getSkill('Cooking'), bank: bank8 });

for (const s of [maker, receiver]) {
    await s.bot.dismissBlockingUI();
    await logoutClean(s).catch(() => {});
}
process.exit(0);

// Keep the unused-import checker honest about helpers this script may grow into.
void cheat;
void bankCount;
void depositAllExcept;
