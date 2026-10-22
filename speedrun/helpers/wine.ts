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
//    The receiver's side is wine-receive.ts.
//
// Role options (ROLE_OPTIONS / fleet config):
//   target      noted wines to hold before it stops making (default: no limit)
//   receiver    account to trade the noted wines to (optional)
//   giveAmount  wines per hand-off (default: all held)
//   acceptFrom  RegExp source of account names whose trades it accepts, e.g. couriers
//               or the mule delivering noted grapes and jugs of water (optional)
//   afterRelog  true: the run-day wine giver (S25c). Make nothing; give the notes to
//               `receiver` right after it relogs in sight (giveWine's afterRelog)
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { depositMatching, withdrawMany } from '../lib/bank';
import { DROPPED_TICKS, give, receiveFrom, sameName } from '../lib/trade';
import { tickMs } from '../lib/wait';
import type { Role, RoleContext } from './role';
import { runStandalone } from './role';
import {
    ITEM,
    VARROCK_WEST_BANK,
    WINE_COOKING_LEVEL,
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

/**
 * Wait (wall clock, free for a helper) until `name` is in sight. The lib's openTrade
 * gives up with player_not_found when the partner is not visible within 5 ticks, and
 * a receiver that is still logging in takes longer than that on the demo.
 */
export async function waitForPlayer(sdk: BotSDK, name: string, ms: number): Promise<boolean> {
    const seen = () => sdk.getState()?.nearbyPlayers.some(p => sameName(p.name, name)) ?? false;
    if (seen()) return true;
    return sdk.waitForCondition(() => seen(), ms).then(() => true, () => false);
}

/** Give-up for each wait of the after-relog cue (seen, gone, back): the giver is staged well before the relog. */
export const RELOG_CUE_TIMEOUT_MS = 4 * 3_600_000;

/**
 * The receiver's relog as the giver sees it: in sight, then out of sight (the logout),
 * then back. Resolves with the tick of the first state that shows it back, or null at a
 * give-up. Seen-before-gone matters: the giver is staged before the receiver reaches the
 * booth, so an absence at the start is not the logout.
 */
export async function awaitRelogReturn(sdk: Pick<BotSDK, 'getState' | 'waitForCondition'>, name: string, timeoutMs = RELOG_CUE_TIMEOUT_MS): Promise<number | null> {
    const inSight = (s: BotWorldState) => s.nearbyPlayers.some(p => sameName(p.name, name));
    const wait = (pred: (s: BotWorldState) => boolean) => sdk.waitForCondition(pred, timeoutMs).then(
        s => s,
        () => null
    );
    if (!(await wait(inSight))) return null;
    if (!(await wait(s => !inSight(s)))) return null;
    const back = await wait(inSight);
    return back ? back.tick : null;
}

export interface GiveWineOptions {
    /**
     * Give right after the receiver's relog (S25c's planned relog 1): wait for it to be seen,
     * gone and back (awaitRelogReturn), request on the first state it is back, and re-send only
     * a click the engine dropped (decideTradeClick's DROPPED_TICKS rule), never the standing
     * re-send, whose 27 ticks would miss the receiver's login + 19. Observed ticks only.
     */
    afterRelog?: boolean;
    /** Give-up for each wait of the after-relog cue (default RELOG_CUE_TIMEOUT_MS). */
    cueTimeoutMs?: number;
}

/** Trade `amount` (default all) noted unfermented wine to `receiver` with the burst giver. */
export async function giveWine(ctx: Ctx, receiver: string, amount = -1, openTimeoutMs = 400 * tickMs(), opts: GiveWineOptions = {}): Promise<GiveResult> {
    const { sdk } = ctx;
    if (invCount(sdk, ITEM.wine) > 0) throw new Error('loose unfermented wine in the inventory: note it before trading');
    const before = invCount(sdk, ITEM.wineNote);
    if (before === 0) return { success: false, given: 0, ticks: 0, message: 'no noted wine held' };
    if (opts.afterRelog) {
        const back = await awaitRelogReturn(sdk, receiver, opts.cueTimeoutMs);
        if (back === null) return { success: false, given: 0, ticks: 0, message: `${receiver} was not seen to relog in sight` };
        ctx.log('wine giver: receiver back after its relog', { receiver, tick: back });
    } else if (!(await waitForPlayer(sdk, receiver, openTimeoutMs))) return { success: false, given: 0, ticks: 0, message: `${receiver} never came into sight` };
    const r = await give(sdk, receiver, [{ item: ITEM.wineNote, n: amount > 0 ? Math.min(amount, before) : 'all' }], {
        openTimeoutMs,
        ...(opts.afterRelog ? { noReplyTicks: DROPPED_TICKS, resendTicks: Infinity } : {})
    });
    return { success: r.ok, given: before - invCount(sdk, ITEM.wineNote), ticks: r.ticks, message: r.reason ?? 'ok' };
}

/**
 * Make sure the maker carries one grapes and one jug of water (unnoted) beside its
 * notes: the receiver needs them to re-arm its own timer after the first firing
 * (wine-receive.ts splitDelivery). Opens and closes the bank if they are missing.
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
export async function giveWineKit(ctx: Ctx, receiver: string, openTimeoutMs = 400 * tickMs()): Promise<GiveResult> {
    const { sdk } = ctx;
    if (invCount(sdk, ITEM.wine) > 0) throw new Error('loose unfermented wine in the inventory: note it before trading');
    const before = invCount(sdk, ITEM.wineNote);
    if (!(await waitForPlayer(sdk, receiver, openTimeoutMs))) return { success: false, given: 0, ticks: 0, message: `${receiver} never came into sight` };
    const r = await give(sdk, receiver, [{ item: ITEM.wineNote, n: 'all' }, { item: ITEM.grapes, n: 1 }, { item: ITEM.jugWater, n: 1 }], { openTimeoutMs });
    return { success: r.ok, given: before - invCount(sdk, ITEM.wineNote), ticks: r.ticks, message: r.reason ?? 'ok' };
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
    const r = await receiveFrom(sdk, sender, { openMaxTicks: 67 });
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
        if (ctx.options.afterRelog === true) {
            if (!receiver) throw new Error('afterRelog needs a receiver');
            // the run-day giver: no making, no bank visit; only the hand-off on the receiver's relog
            for (let attempt = 1; !ctx.signal.aborted && invCount(sdk, ITEM.wineNote) > 0; attempt++) {
                // the next chance is the receiver's next relog: a stuck giver shows here, once a wait
                ctx.log('wine giver: waiting for the receiver to relog in sight', { receiver, attempt, notes: invCount(sdk, ITEM.wineNote) });
                const g = await giveWine(ctx, receiver, amount, 400 * tickMs(), { afterRelog: true });
                ctx.log('hand-off', { ...g, receiver, afterRelog: true });
            }
            return;
        }
        while (!ctx.signal.aborted) {
            try {
                const r = await makeNotedWine(ctx, target);
                ctx.log('noted wine held', { ...r });
                if (receiver && r.noted > 0 && sdk.getState()?.nearbyPlayers.some(p => sameName(p.name, receiver))) {
                    const g = await giveWine(ctx, receiver, amount, 100 * tickMs());
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
