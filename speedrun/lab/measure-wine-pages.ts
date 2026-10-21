// Wine, the scored account's second bank visit (cairn://p/rs/88; results in
// docs/speedrun/helpers/wine.md): the level-up pages a fermentation firing queues,
// what they block, and the old and new ways through them. Lab only (::give,
// ::setstat).
//
//   bun speedrun/lab/measure-wine-pages.ts <bot> [--only=A,B,C,D] [--n=1]
//
// Needs a lab engine (LOCAL_STAFF_LEVEL=4) and gateway, and <bot>'s bot.env
// pointed at them; the script launches the bot's lite client itself. Each
// experiment banks 29 unfermented wines, arms the timer with one make at
// Cooking 35, and drops Cooking to 1, so the firing rolls 29 wines at level 1
// as the scored account's first firing does. TRACE lines show every state
// change (dialog: - closed, O open, W waiting for the server after a continue).
import { clearDialogs } from '../helpers/wine';
import { ITEM, closeBank, invCount, openBank, prepare, tick } from '../helpers/wine-common';
import { awaitFiring, depositNotes, drainChat, FERMENT_TIMER_TICKS, makeOneWine, openBankThroughPages } from '../helpers/wine-receive';
import { depositMatching, withdrawMany } from '../lib/bank';
import { isLoggedOut, LOGOUT_BUTTON, login, logoutClean, openSession, relog } from '../lib/session';
import { sleep, waitTicks, waitUntil } from '../lib/wait';
import { arg, botArg, result } from './common';
import { give, setstat, tele, VARROCK_WEST_BANK } from './setup';

const s = await openSession(botArg(), { launch: true });
const { sdk, bot } = s;
const ctx = { sdk, bot, log: (m: string, d?: Record<string, unknown>) => console.log(JSON.stringify({ m, tick: tick(sdk), ...d })) };
const only = arg('only', 'A,B,C,D').split(',');
const n = Number(arg('n', '1'));
const cooking = () => sdk.getSkill('Cooking');

let tracing = '';
let lastRow = '';
sdk.onStateUpdate(st => {
    if (!tracing) return;
    const d = st.dialog;
    const c = st.skills.find(k => k.name === 'Cooking');
    const row = `dlg=${d.isOpen ? (d.isWaiting ? 'W' : 'O') : '-'} bank=${st.bank.isOpen ? 1 : 0} if=${st.interface.isOpen ? st.interface.interfaceId : -1} cook=${c?.baseLevel}/${c?.experience} wine=${invCount(sdk, ITEM.wine)} notes=${invCount(sdk, ITEM.wineNote)}`;
    if (row !== lastRow) console.log(`TRACE ${tracing} t=${st.tick} ${row}`);
    lastRow = row;
});

/** No unfermented wine left in the bank (a previous experiment's rest), no pages open. */
async function reset(): Promise<void> {
    await drainChat(sdk, { maxTicks: 80 });
    const open = await openBankThroughPages(sdk);
    if (!open.ok) throw new Error(`reset: ${open.reason}`);
    if (sdk.getBankItems().some(i => i.id === ITEM.wine)) await withdrawMany(sdk, [{ item: ITEM.wine, n: 'all', asNote: true }]);
    await depositMatching(sdk, [ITEM.jugWine, ITEM.badWine, ITEM.jugEmpty, ITEM.wine]);
    await closeBank(bot, sdk);
}

/** Bank `bankWines` unfermented wines, hold `restNotes` noted ones, arm with one make at 35, drop to Cooking 1. Returns the due tick. */
async function arm(bankWines: number, restNotes: number): Promise<number> {
    await reset();
    const notes = invCount(sdk, ITEM.wineNote);
    if (notes < bankWines + restNotes) await give(sdk, ['cert_jug_unfermented_wine'], bankWines + restNotes - notes);
    const open = await openBankThroughPages(sdk);
    if (!open.ok) throw new Error(`arm: ${open.reason}`);
    await depositNotes(sdk, bankWines, { close: true });
    await give(sdk, ['grapes', 'jug_water'], 2);
    await setstat(sdk, 'cooking', 35);
    const mk = await makeOneWine(sdk);
    if (!mk.ok) throw new Error(`arm: ${mk.reason}`);
    await setstat(sdk, 'cooking', 1);
    return mk.tick + FERMENT_TIMER_TICKS;
}

for (let rep = 0; rep < n; rep++) {
    await prepare(ctx);
    await tele(sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);

    if (only.includes('A')) {
        // The old second visit, call for call as the old splitDelivery made it (lab T9).
        const due = await arm(29, 30);
        const f = await awaitFiring(sdk, due);
        tracing = 'A';
        const t0 = tick(sdk);
        const pages = await clearDialogs(sdk);
        const t1 = tick(sdk);
        await openBank(ctx);
        const t2 = tick(sdk);
        await depositMatching(sdk, [ITEM.wineNote]);
        await closeBank(bot, sdk);
        const t3 = tick(sdk);
        tracing = '';
        result('A-old-second-visit', { firedAt: f.tick, due, level: f.level, clearDialogsPages: pages, clearDialogsTicks: t1 - t0, openBankTicks: t2 - t1, depositCloseTicks: t3 - t2, visitTicks: t3 - t0 });
    }

    if (only.includes('B')) {
        // The new path: booth op pending + one blind continue per tick, then deposit and close in one burst, then the make.
        const due = await arm(29, 30);
        const f = await awaitFiring(sdk, due);
        tracing = 'B';
        const t0 = tick(sdk);
        const open = await openBankThroughPages(sdk);
        const d = await depositNotes(sdk, 'all', { close: true });
        const mk = await makeOneWine(sdk);
        const f2 = await awaitFiring(sdk, mk.tick + FERMENT_TIMER_TICKS);
        const dr = await drainChat(sdk);
        tracing = '';
        result('B-new-second-visit', {
            firedAt: f.tick, due, level: f.level, pages: open.pages, resumes: open.resumes,
            pagesTicks: open.openTick - t0, depositCloseTicks: d.doneTick - open.openTick, visitTicks: d.doneTick - t0, makeAfterClose: mk.tick - d.doneTick,
            secondFiredAt: f2.tick, secondDue: mk.tick + FERMENT_TIMER_TICKS, level2: f2.level, finalPages: dr.pages, finalTicks: dr.endTick - dr.startTick
        });
    }

    if (only.includes('C')) {
        // A logout click alone with a level-up page open, then the burst, then what a relog leaves.
        const due = await arm(29, 0);
        const f = await awaitFiring(sdk, due);
        await waitUntil(sdk, st => st.dialog.isOpen, { maxTicks: 4 });
        tracing = 'C';
        const clickTick = tick(sdk);
        void sdk.sendClickComponent(LOGOUT_BUTTON);
        await sleep(8 * 300);
        const outAlone = await isLoggedOut(s);
        result('C1-logout-click-with-page-open', { firedAt: f.tick, level: f.level, clickTick, loggedOutWithin8Ticks: outAlone });
        if (!outAlone) {
            const lo = await logoutClean(s);
            result('C2-logout-burst', { ok: lo.ok, latencyTicks: lo.latencyTicks, reason: lo.reason });
        }
        tracing = '';
        await sleep(3_000);
        let pagesAfter = 0;
        let first = -1;
        const unsub = sdk.onStateUpdate(st => {
            if (first < 0 && st.inGame && (st.player?.worldX ?? 0) > 0) first = st.tick;
            if (st.inGame && st.dialog.isOpen) pagesAfter++;
        });
        await login(s);
        await waitTicks(sdk, 25);
        unsub();
        result('C3-pages-after-relog', { loginTick: first, statesWithDialogOpen: pagesAfter, level: cooking()?.baseLevel });
    }

    if (only.includes('D')) {
        for (let i = 0; i < 3; i++) {
            await waitTicks(sdk, 3);
            const r = await relog(s);
            result('D-lab-relog', { clickTick: r.logout.clickTick, lastInWorld: r.logout.lastInWorldTick, outTicks: r.logout.latencyTicks, loginTick: r.loginTick, loginWallMs: r.loginWallMs, attempts: r.attempts });
        }
    }
}

await logoutClean(s);
process.exit(0);
