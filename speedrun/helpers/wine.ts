// Wine maker and hand-off (cairn://p/rs/47; design and measurements in
// docs/speedrun/helpers/wine.md).
//
// The scored account levels Cooking by holding unfermented wine in its bank when
// its fermenting_wine timer fires (armed for 20 ticks by every login and by every
// wine made; wine.rs2). The timer counts obj jug_unfermented_wine (1995) in the
// bank and the inventory, and nothing else, so:
//
//  - Noted unfermented wine (cert 1996) held in an INVENTORY never ferments. The
//    maker turns grapes + jugs of water into wine, deposits each batch and
//    withdraws it straight back as notes in the same bank session, and keeps the
//    growing noted stack in its inventory across timers and logins. It must never
//    bank the notes: the bank stores them unnoted.
//  - A normal timer cannot fire while a modal (bank, trade) is open
//    (Player.processTimers needs canAccess), and settimer replaces the running
//    timer, so each make pushes the deadline 20 ticks out.
//  - The receiver takes one noted stack in one trade slot and deposits it; the
//    bank stores it unnoted, and the next fermenting_wine firing (its next login,
//    or the current login's timer if it is still pending) ferments every wine.
//
// Role options (ROLE_OPTIONS / fleet config):
//   target      noted wines to hold before it stops making (default: no limit)
//   receiver    account to trade the noted wines to (optional)
//   giveAmount  wines per hand-off (default: all held)
//   acceptFrom  RegExp source of account names whose trades it accepts, e.g. couriers
//               or the mule delivering noted grapes and jugs of water (optional)
import type { BotSDK } from '../../sdk/index';
import type { InventoryItem } from '../../sdk/types';
import { depositMatching, withdrawMany } from '../lib/bank';
import { give, receiveFrom, sameName } from '../lib/trade';
import { advance, classifyPage } from '../lib/dialogue';
import { waitUntil } from '../lib/wait';
import type { Role, RoleContext } from './role';
import { runStandalone } from './role';
import {
    ITEM,
    VARROCK_WEST_BANK,
    bankCount,
    checkAbort,
    closeBank,
    depositAllExcept,
    freeSlots,
    invCount,
    openBank,
    prepare,
    reportBank,
    skillLevel,
    tick,
    walkNear
} from './wine-common';

export const WINE_COOKING_LEVEL = 35;

type Ctx = Pick<RoleContext, 'bot' | 'sdk' | 'log'>;

/**
 * Pair grapes slots with jug-of-water slots for `limit` makes. wine.rs2 deletes the
 * first grapes and the first jug and puts the wine in the first free slot, so
 * pairing the k-th grapes with the k-th jug keeps every planned pair valid while
 * the earlier makes land.
 */
export function planMakes(inventory: readonly InventoryItem[], limit = 28): Array<[grapesSlot: number, jugSlot: number]> {
    const bySlot = [...inventory].sort((a, b) => a.slot - b.slot);
    const grapes = bySlot.filter(i => i.id === ITEM.grapes);
    const jugs = bySlot.filter(i => i.id === ITEM.jugWater);
    const n = Math.max(0, Math.min(grapes.length, jugs.length, limit));
    return grapes.slice(0, n).map((g, k) => [g.slot, jugs[k]!.slot]);
}

/**
 * Pairs to withdraw for one making round: two inventory slots per wine, after the
 * noted-wine stack (and anything else kept) has taken its slots.
 */
export function pairsForRound(freeSlotsNow: number, grapesInBank: number, jugsInBank: number, wanted: number): number {
    return Math.max(0, Math.min(Math.floor(freeSlotsNow / 2), grapesInBank, jugsInBank, wanted));
}

/**
 * The largest amount up to `n` that the bank's 1/5/10/All buttons move in at most
 * three clicks (or the whole `stack` with All), so a round never needs the X count
 * dialog: two X withdrawals in one burst lost the second one on the lab (0 grapes,
 * 13 jugs). 13 becomes 12 (10+1+1).
 */
export function buttonAmount(n: number, stack: number): number {
    if (n >= stack) return stack;
    for (let k = n; k > 0; k--) {
        if (k === 1 || k === 5 || k === 10) return k;
        if (Math.floor(k / 10) + Math.floor((k % 10) / 5) + (k % 5) <= 3) return k;
    }
    return 0;
}

export interface MakeResult {
    made: number;
    ticks: number;
}

/**
 * Use every grapes/jug-of-water pair in the inventory (up to `limit`), firing all
 * the item-on-item packets at once. The engine runs at most 5 user packets per
 * tick and carries the rest to the next, so 13 makes take 3 ticks. The bank must
 * be closed: OPHELDU on an inventory hidden by the bank modal is dropped without
 * a message.
 */
export async function makeWines(ctx: Ctx, limit = 28): Promise<MakeResult> {
    const { sdk } = ctx;
    if (skillLevel(sdk, 'Cooking') < WINE_COOKING_LEVEL) throw new Error(`Cooking ${skillLevel(sdk, 'Cooking')} < ${WINE_COOKING_LEVEL}`);
    const pairs = planMakes(sdk.getInventory(), limit);
    const n = pairs.length;
    if (n === 0) return { made: 0, ticks: 0 };
    const before = invCount(sdk, ITEM.wine);
    const start = tick(sdk);
    await Promise.all(pairs.map(([g, j]) => sdk.sendUseItemOnItem(g, j)));
    let last = before;
    let stall = start;
    for (;;) {
        const now = invCount(sdk, ITEM.wine);
        if (now >= before + n) break;
        if (now !== last) {
            last = now;
            stall = tick(sdk);
        }
        if (tick(sdk) - stall > 8) break;
        await sdk.waitForStateUpdate();
    }
    const made = invCount(sdk, ITEM.wine) - before;
    if (made < n) {
        // A dropped packet (lag, a stray dialog) leaves pairs unused: retry them one by one.
        await ctx.bot.dismissBlockingUI();
        const rest = await makeWinesSlow(ctx, n - made);
        return { made: made + rest, ticks: tick(sdk) - start };
    }
    return { made, ticks: tick(sdk) - start };
}

async function makeWinesSlow(ctx: Ctx, n: number): Promise<number> {
    const { sdk } = ctx;
    let made = 0;
    for (let k = 0; k < n; k++) {
        const [pair] = planMakes(sdk.getInventory(), 1);
        if (!pair) break;
        const before = invCount(sdk, ITEM.wine);
        await sdk.sendUseItemOnItem(pair[0], pair[1]);
        const ok = await sdk.waitForCondition(() => invCount(sdk, ITEM.wine) > before, 4_000).then(() => true, () => false);
        if (!ok) {
            const msg = sdk.getState()?.dialog.text ?? '';
            throw new Error(`wine make not accepted (${msg || 'no message'})`);
        }
        made++;
    }
    return made;
}

/**
 * With the bank open: deposit any unnoted wine and withdraw all of it back as notes,
 * so the bank never holds unfermented wine when it closes. Returns the noted count.
 */
export async function noteWinesInBank(ctx: Ctx): Promise<number> {
    const { sdk } = ctx;
    if (invCount(sdk, ITEM.wine) > 0) {
        const d = await depositMatching(sdk, [ITEM.wine]);
        if (!d.ok) throw new Error(`depositing unnoted wine failed: ${d.reason}`);
    }
    if (bankCount(sdk, ITEM.wine) > 0) {
        const w = await withdrawMany(sdk, [{ item: ITEM.wine, n: 'all', asNote: true }]);
        if (!w.ok) throw new Error(`noted withdrawal of unfermented wine failed: ${w.reason}`);
    }
    if (bankCount(sdk, ITEM.wine) > 0) throw new Error('unfermented wine left in the bank');
    return invCount(sdk, ITEM.wineNote);
}

export interface MakeNotedResult {
    noted: number;
    made: number;
    rounds: number;
    ticks: number;
}

/**
 * Turn banked grapes + jugs of water into noted unfermented wine held in the
 * inventory, until `target` notes are held or the ingredients run out. Restartable:
 * any loose wine left by an interrupted round is noted on the next bank visit.
 */
export async function makeNotedWine(ctx: Ctx & Partial<Pick<RoleContext, 'reportBank' | 'signal'>>, target = Infinity): Promise<MakeNotedResult> {
    const { bot, sdk } = ctx;
    const start = tick(sdk);
    let made = 0;
    let rounds = 0;
    for (;;) {
        if (ctx.signal) checkAbort({ signal: ctx.signal });
        await openBank(ctx);
        const noted = await noteWinesInBank(ctx);
        await depositAllExcept(sdk, i => i.id === ITEM.wineNote || i.id === ITEM.chefsHat);
        if (ctx.reportBank) reportBank({ sdk, reportBank: ctx.reportBank });
        const pairs = pairsForRound(freeSlots(sdk), bankCount(sdk, ITEM.grapes), bankCount(sdk, ITEM.jugWater), target - noted);
        const want = Math.min(buttonAmount(pairs, bankCount(sdk, ITEM.grapes)), buttonAmount(pairs, bankCount(sdk, ITEM.jugWater)));
        if (want <= 0) {
            await closeBank(bot, sdk);
            return { noted, made, rounds, ticks: tick(sdk) - start };
        }
        const w = await withdrawMany(sdk, [
            { item: ITEM.grapes, n: want },
            { item: ITEM.jugWater, n: want }
        ]);
        if (!w.ok) ctx.log('wine withdraw short', { want, gained: Object.fromEntries(w.gained), reason: w.reason });
        await closeBank(bot, sdk);
        const r = await makeWines(ctx, want);
        made += r.made;
        rounds++;
        ctx.log('wine round', { made: r.made, makeTicks: r.ticks, noted });
        if (r.made === 0) throw new Error('a making round made no wine');
    }
}

export interface GiveResult {
    success: boolean;
    given: number;
    /** Giver clock, from its first trade click to the notes leaving. */
    ticks: number;
    message: string;
}

/** Trade `amount` (default all) noted unfermented wine to `receiver` with the burst giver. */
export async function giveWine(ctx: Ctx, receiver: string, amount = -1, openTimeoutMs = 120_000): Promise<GiveResult> {
    const { sdk } = ctx;
    if (invCount(sdk, ITEM.wine) > 0) throw new Error('loose unfermented wine in the inventory: note it before trading');
    const before = invCount(sdk, ITEM.wineNote);
    if (before === 0) return { success: false, given: 0, ticks: 0, message: 'no noted wine held' };
    const r = await give(sdk, receiver, [{ item: ITEM.wineNote, n: amount > 0 ? Math.min(amount, before) : 'all' }], { openTimeoutMs });
    return { success: r.ok, given: before - invCount(sdk, ITEM.wineNote), ticks: r.ticks, message: r.reason ?? 'ok' };
}

export interface ReceiveResult {
    received: number;
    deposited: number;
    /** Receiver clock: trade (first click to notes arriving), then bank (open, deposit, close). */
    tradeTicks: number;
    bankTicks: number;
    firstClickTick: number;
    doneTick: number;
}

/**
 * Receiver side, for the scored account: accept one trade of noted wine from
 * `giver`, then deposit it (the bank stores it unnoted, ready for the next
 * fermenting_wine firing). `depositAmount` banks only part of the stack, e.g. a
 * small first batch to lift Cooking off level 1 before the big one (wine.md).
 * The receiver should stand next to a bank booth.
 */
export async function receiveWine(ctx: Ctx, giver: string, opts: { depositAmount?: number; minWines?: number; openTimeoutMs?: number } = {}): Promise<ReceiveResult> {
    const { bot, sdk } = ctx;
    const before = invCount(sdk, ITEM.wineNote);
    const t0 = tick(sdk);
    const r = await receiveFrom(sdk, giver, { want: [{ item: /^unfermented wine$/i, amount: opts.minWines ?? 1 }], openTimeoutMs: opts.openTimeoutMs ?? 120_000 });
    const received = invCount(sdk, ITEM.wineNote) - before;
    const t1 = tick(sdk);
    if (!r.ok || received <= 0) throw new Error(`no wine received: ${r.reason ?? 'unknown'}`);
    await openBank(ctx);
    const banked0 = bankCount(sdk, ITEM.wine);
    const amount = opts.depositAmount ?? -1;
    if (amount < 0 || amount >= invCount(sdk, ITEM.wineNote)) {
        const d = await depositMatching(sdk, [ITEM.wineNote]);
        if (!d.ok) throw new Error(`deposit failed: ${d.reason}`);
    } else {
        const note = sdk.getInventory().find(i => i.id === ITEM.wineNote)!;
        await bot.depositItem(note, amount);
    }
    const deposited = bankCount(sdk, ITEM.wine) - banked0;
    await closeBank(bot, sdk);
    return { received, deposited, tradeTicks: r.ticks, bankTicks: tick(sdk) - t1, firstClickTick: t0, doneTick: tick(sdk) };
}

/**
 * Make sure the maker carries one grapes and one jug of water (unnoted) beside its
 * notes: the receiver needs them to re-arm its own timer after the first firing
 * (see splitDelivery). Opens and closes the bank if they are missing.
 */
export async function prepareRearmKit(ctx: Ctx): Promise<void> {
    const { bot, sdk } = ctx;
    if (invCount(sdk, ITEM.grapes) >= 1 && invCount(sdk, ITEM.jugWater) >= 1) return;
    await openBank(ctx);
    const specs = [];
    if (invCount(sdk, ITEM.grapes) < 1) specs.push({ item: ITEM.grapes, n: 1 });
    if (invCount(sdk, ITEM.jugWater) < 1) specs.push({ item: ITEM.jugWater, n: 1 });
    const w = await withdrawMany(sdk, specs);
    await closeBank(bot, sdk);
    if (!w.ok) throw new Error(`re-arm kit: ${w.reason}`);
}

/** Trade every noted wine plus one grapes and one jug of water to `receiver` (the split-delivery kit). */
export async function giveWineKit(ctx: Ctx, receiver: string, openTimeoutMs = 120_000): Promise<GiveResult> {
    const { sdk } = ctx;
    if (invCount(sdk, ITEM.wine) > 0) throw new Error('loose unfermented wine in the inventory: note it before trading');
    const before = invCount(sdk, ITEM.wineNote);
    const r = await give(sdk, receiver, [{ item: ITEM.wineNote, n: 'all' }, { item: ITEM.grapes, n: 1 }, { item: ITEM.jugWater, n: 1 }], { openTimeoutMs });
    return { success: r.ok, given: before - invCount(sdk, ITEM.wineNote), ticks: r.ticks, message: r.reason ?? 'ok' };
}

export interface SplitResult {
    received: number;
    first: number;
    rest: number;
    /** Ticks are on the receiver's clock. */
    tradeTicks: number;
    firstBankTicks: number;
    /** Dismissing the level-up dialog after the first firing (and its page count), and after the second. */
    levelUpTicks: number;
    levelUpPages: number;
    finalLevelUpTicks: number;
    /** Bank (deposit the rest) plus the one re-arming make, and the two parts. */
    rearmTicks: number;
    rearmBankTicks: number;
    rearmMakeTicks: number;
    firstFermentTick: number;
    secondFermentTick: number;
    levelAfterFirst: number;
    levelAfterSecond: number;
    rearmed: boolean;
}

/**
 * The scored account's side of the single-login split delivery (wine.md). One
 * firing over a big bank is 15 all-or-nothing rolls at the current level, so
 * ferment a small first batch (default 29: 29 single-wine-sized rolls) to lift
 * Cooking off level 1, then the rest at the higher level:
 *
 *  1. receive the noted wines + 1 grapes + 1 jug of water in one trade;
 *  2. deposit `first` notes; the login-armed timer ferments them;
 *  3. after that firing, deposit the rest and make one wine (needs Cooking 35),
 *     which re-arms the timer; 20 ticks later it ferments the rest.
 *
 * Call it within the login window, before the login timer fires (login+20), and
 * keep the account out of modals when each timer is due. If the first firing
 * leaves Cooking below 35 (about 1% of the time for 29), the rest stays banked
 * and ferments at the next login instead (rearmed: false).
 * The account must stand next to a bank booth.
 */
export async function splitDelivery(ctx: Ctx, giver: string, opts: { first?: number; openTimeoutMs?: number; maxWaitTicks?: number } = {}): Promise<SplitResult> {
    const { bot, sdk } = ctx;
    const first = opts.first ?? 29;
    const maxWait = opts.maxWaitTicks ?? 40;
    const xp = () => sdk.getSkill('Cooking')?.experience ?? 0;
    const before = invCount(sdk, ITEM.wineNote);
    const r = await receiveFrom(sdk, giver, {
        want: [
            { item: /^unfermented wine$/i, amount: first + 1 },
            { item: /^grapes$/i, amount: 1 },
            { item: /^jug of water$/i, amount: 1 }
        ],
        openTimeoutMs: opts.openTimeoutMs ?? 120_000
    });
    const received = invCount(sdk, ITEM.wineNote) - before;
    if (!r.ok || received <= first) throw new Error(`split delivery: trade failed (${r.reason ?? 'too few wines'})`);

    const t1 = tick(sdk);
    await openBank(ctx);
    const note = sdk.getInventory().find(i => i.id === ITEM.wineNote)!;
    await bot.depositItem(note, first);
    await closeBank(bot, sdk);
    const firstBankTicks = tick(sdk) - t1;

    // An all-bad firing gives no xp and no message (wine.rs2): then the wait runs out
    // and the level stays below 35, so the rest is left for the next login.
    const xp0 = xp();
    const fired = await waitUntil(sdk, () => xp() > xp0, { maxTicks: maxWait });
    const firstFermentTick = fired.ok ? fired.tick : -1;
    const levelAfterFirst = skillLevel(sdk, 'Cooking');
    const rest = invCount(sdk, ITEM.wineNote);

    // The jump in Cooking opens level-up pages (and unlock pages); banking and the
    // make wait on them, so click through until the chat box stays closed.
    const tDlg = tick(sdk);
    const levelUpPages = await clearDialogs(sdk);
    const levelUpTicks = tick(sdk) - tDlg;

    const t2 = tick(sdk);
    await openBank(ctx);
    const d = await depositMatching(sdk, [ITEM.wineNote]);
    if (!d.ok) throw new Error(`split delivery: deposit of the rest failed (${d.reason})`);
    await closeBank(bot, sdk);
    const rearmBankTicks = tick(sdk) - t2;
    let rearmed = false;
    let rearmMakeTicks = 0;
    if (levelAfterFirst >= WINE_COOKING_LEVEL) {
        const mk = await makeWines(ctx, 1);
        rearmed = mk.made === 1;
        rearmMakeTicks = mk.ticks;
    }
    const rearmTicks = tick(sdk) - t2;

    let secondFermentTick = -1;
    let finalLevelUpTicks = 0;
    if (rearmed) {
        const xp1 = xp();
        const ok = await waitUntil(sdk, () => xp() > xp1, { maxTicks: maxWait });
        if (ok.ok) {
            secondFermentTick = ok.tick;
            await waitUntil(sdk, s => s.dialog.isOpen, { maxTicks: 2 });
            const t3 = tick(sdk);
            await clearDialogs(sdk);
            finalLevelUpTicks = tick(sdk) - t3;
        }
    }
    return {
        levelUpTicks,
        levelUpPages,
        finalLevelUpTicks,
        rearmBankTicks,
        rearmMakeTicks,
        received,
        first,
        rest,
        tradeTicks: r.ticks,
        firstBankTicks,
        rearmTicks,
        firstFermentTick,
        secondFermentTick,
        levelAfterFirst,
        levelAfterSecond: skillLevel(sdk, 'Cooking'),
        rearmed
    };
}

/**
 * Click through continue pages (level-up and unlock pages) until the chat box has
 * stayed closed for two ticks. Returns the pages clicked. A choice page is left alone.
 */
export async function clearDialogs(sdk: BotSDK, maxTicks = 40): Promise<number> {
    let pages = 0;
    let closedSince = -1;
    const start = tick(sdk);
    while (tick(sdk) - start < maxTicks) {
        const d = sdk.getState()?.dialog;
        if (d?.isOpen && classifyPage(d) === 'continue') {
            closedSince = -1;
            const r = await advance(sdk, { maxTicks: 3 });
            if (r.ok) pages++;
            continue;
        }
        if (d?.isOpen) return pages;
        if (closedSince < 0) closedSince = tick(sdk);
        else if (tick(sdk) - closedSince >= 2) return pages;
        await sdk.waitForTicks(1);
    }
    return pages;
}

/**
 * Accept one trade from an account matching `from` (a courier or the mule
 * bringing noted grapes and jugs of water), waiting up to `waitMs` for a request.
 * Returns the sender, or null when nobody asked.
 */
export async function acceptSupplies(ctx: Ctx, from: RegExp, waitMs: number): Promise<string | null> {
    const { sdk } = ctx;
    const sender = await sdk.waitForTradeRequest({ timeout: waitMs });
    if (!sender) return null;
    const norm = sender.toLowerCase().replace(/\s+/g, '_');
    if (!from.test(norm) && !from.test(sender)) {
        ctx.log('trade request ignored', { from: sender });
        return null;
    }
    const r = await receiveFrom(sdk, sender, { openTimeoutMs: 20_000 });
    ctx.log('supplies received', { from: sender, ok: r.ok, received: r.received.map(i => `${i.name} x${i.count}`), reason: r.reason });
    return r.ok ? sender : null;
}

export const role: Role = {
    name: 'wine',
    produces: [/^unfermented wine$/i],
    async run(ctx) {
        await prepare(ctx);
        const { sdk } = ctx;
        const cooking = skillLevel(sdk, 'Cooking');
        if (cooking < WINE_COOKING_LEVEL) {
            throw new Error(`wine maker needs Cooking ${WINE_COOKING_LEVEL} (has ${cooking}); train it with the grapes role's guild source first`);
        }
        const target = typeof ctx.options.target === 'number' ? ctx.options.target : Infinity;
        const receiver = typeof ctx.options.receiver === 'string' ? ctx.options.receiver : null;
        const amount = typeof ctx.options.giveAmount === 'number' ? ctx.options.giveAmount : -1;
        const acceptFrom = typeof ctx.options.acceptFrom === 'string' ? new RegExp(ctx.options.acceptFrom, 'i') : null;
        await walkNear(ctx, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z, 3);
        while (!ctx.signal.aborted) {
            try {
                const r = await makeNotedWine(ctx, target);
                ctx.log('noted wine held', { ...r });
                if (receiver && r.noted > 0 && sdk.getState()?.nearbyPlayers.some(p => sameName(p.name, receiver))) {
                    const g = await giveWine(ctx, receiver, amount, 30_000);
                    ctx.log('hand-off', { ...g, receiver });
                    continue;
                }
                if (acceptFrom) await acceptSupplies(ctx, acceptFrom, 60_000);
                else await sdk.waitForTicks(100);
            } catch (e) {
                if (ctx.signal.aborted) break;
                ctx.log('cycle error', { error: String(e) });
                await sdk.waitForTicks(10).catch(() => {});
            }
        }
    }
};

if (import.meta.main) await runStandalone(role);
