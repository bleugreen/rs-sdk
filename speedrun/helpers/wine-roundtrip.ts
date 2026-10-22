// wine-roundtrip (role): the H21c wine trade proven on the demo and undone in one session, with the
// wine giver's own trade code, never a bank. The giver (default) holds the run's noted unfermented
// wine in its INVENTORY and must never bank it (the bank stores notes as obj 1995, which the
// fermentation timer counts) or be a handover donor (that role deposits the donor's inventory).
//
//   giver (cairn_h40):     wine.ts giveWine to `receiver` (the run's trade: every note, one slot),
//                          then takes the stack back from the receiver (lib/trade.ts receiveFrom,
//                          exactly what it gave, by id) and checks its inventory by id is as before.
//   standin (cairn_h94):   receives the noted stack from `giver` (receiveFrom, by id and count),
//                          checks the notes stayed notes (obj 1996, none 1995), and hands them
//                          straight back (give, by id). It never banks, eats or equips.
//
// Neither side opens a bank, makes wine or relogs. Each prints `RESULT wine-roundtrip {...}`.
//   bun speedrun/helpers/wine-roundtrip.ts <account> [giver|standin]
// Options: giver: receiver, backWaitMs (default 300000); standin: giver, count (the notes expected).
import type { InventoryItem } from '../../sdk/types';
import { give, receiveFrom } from '../lib/trade';
import { nextTick, waitTicks } from '../lib/wait';
import { countById } from './mule';
import { countsDiffer } from './mule-standin';
import { runStandalone, type Role, type RoleContext } from './role';
import { giveWine, waitForPlayer } from './wine';
import { ITEM } from './wine-common';

const label = (items: readonly { name: string; count: number }[]) => items.map(i => `${i.name} x${i.count}`);
const notes = (inv: readonly InventoryItem[]) => inv.filter(i => i.id === ITEM.wineNote).reduce((n, i) => n + i.count, 0);
const loose = (inv: readonly InventoryItem[]) => inv.filter(i => i.id === ITEM.wine).reduce((n, i) => n + i.count, 0);

function finish(ctx: RoleContext, side: string, out: Record<string, unknown>): void {
    ctx.log('result', out);
    console.log(`RESULT wine-roundtrip ${JSON.stringify({ side, account: ctx.account, ...out })}`);
}

async function giver(ctx: RoleContext): Promise<void> {
    const { sdk } = ctx;
    const receiver = String(ctx.options.receiver ?? '');
    if (!receiver) throw new Error('wine-roundtrip giver: options.receiver is required');
    const before = countById(sdk.getInventory());
    const held = notes(sdk.getInventory());
    const start = { inventory: label(sdk.getInventory()), notes: held, loose: loose(sdk.getInventory()) };
    if (held === 0 || start.loose > 0) return finish(ctx, 'giver', { ok: false, reason: held === 0 ? 'no noted wine held' : 'loose unfermented wine held', start });
    const g = await giveWine(ctx, receiver, -1, 180_000);
    ctx.log('given', { ...g });
    if (!g.success && g.given === 0) return finish(ctx, 'giver', { ok: false, give: g, start });
    // The stand-in hands the stack straight back: take exactly what was given, by id.
    const deadline = Date.now() + Number(ctx.options.backWaitMs ?? 300_000);
    let back: Awaited<ReturnType<typeof receiveFrom>> | null = null;
    while (Date.now() < deadline && !ctx.signal.aborted && notes(sdk.getInventory()) < held) {
        back = await receiveFrom(sdk, receiver, { want: [{ item: ITEM.wineNote, amount: g.given }], openTimeoutMs: Math.max(1, deadline - Date.now()), maxTicks: 40 });
        ctx.log('taken back', { ok: back.ok, ticks: back.ticks, received: label(back.received), reason: back.reason ?? null });
        if (!back.ok) await waitTicks(sdk, 3);
    }
    const diff = countsDiffer(before, countById(sdk.getInventory()));
    finish(ctx, 'giver', {
        ok: diff.length === 0,
        start,
        give: { success: g.success, given: g.given, ticks: g.ticks, message: g.message },
        back: back ? { ok: back.ok, ticks: back.ticks, received: label(back.received), reason: back.reason ?? null } : null,
        end: { inventory: label(sdk.getInventory()), notes: notes(sdk.getInventory()), loose: loose(sdk.getInventory()) },
        sameAsStart: diff.length === 0,
        diff,
    });
}

async function standin(ctx: RoleContext): Promise<void> {
    const { sdk } = ctx;
    const from = String(ctx.options.giver ?? '');
    const count = Number(ctx.options.count ?? 0);
    if (!from || !(count > 0)) throw new Error('wine-roundtrip standin: options.giver and options.count are required');
    const before = countById(sdk.getInventory());
    // The launcher logs the stand-in in first, and openTrade gives up on a partner out of sight
    // (player_not_found): wait for the giver to arrive before asking for the trade.
    if (!(await waitForPlayer(sdk, from, 240_000))) return finish(ctx, 'standin', { ok: false, reason: `${from} never came into view`, sameAsStart: true, diff: [] });
    const r = await receiveFrom(sdk, from, { want: [{ item: ITEM.wineNote, amount: count }], openTimeoutMs: 240_000, maxTicks: 40 });
    const got = { ok: r.ok, ticks: r.ticks, received: label(r.received), reason: r.reason ?? null, notes: notes(sdk.getInventory()), loose: loose(sdk.getInventory()), free: 28 - sdk.getInventory().length };
    ctx.log('received', got);
    let back = null;
    const mine = notes(sdk.getInventory()) - (before.get(ITEM.wineNote) ?? 0);
    if (mine > 0) {
        for (let tries = 0; tries < 4 && !ctx.signal.aborted; tries++) {
            const g = await give(sdk, from, [{ item: ITEM.wineNote, n: mine }], { openTimeoutMs: 60_000 });
            back = { ok: g.ok, ticks: g.ticks, gave: label(g.gave), reason: g.reason ?? null, tries: tries + 1 };
            ctx.log('given back', back);
            if (g.ok || g.gave.length) break;
            await waitTicks(sdk, 5);
        }
    }
    const diff = countsDiffer(before, countById(sdk.getInventory()));
    finish(ctx, 'standin', { ok: r.ok && diff.length === 0, received: got, back, sameAsStart: diff.length === 0, diff });
    // Leave the giver time to log its take-back before a launcher stops everything.
    const until = Date.now() + 20_000;
    while (Date.now() < until && !ctx.signal.aborted) await nextTick(sdk);
}

/** Never throws: a launcher restarts a role that throws, and a restart could trade the wine again. */
const once = (side: string, f: (ctx: RoleContext) => Promise<void>) => async (ctx: RoleContext) => {
    try {
        await f(ctx);
    } catch (e) {
        finish(ctx, side, { ok: false, error: e instanceof Error ? e.message : String(e), inventory: label(ctx.sdk.getInventory()) });
    }
};

export const role: Role = { name: 'wine-roundtrip', produces: [], run: once('giver', giver) };
export const standinRole: Role = { name: 'wine-roundtrip-standin', produces: [], run: once('standin', standin) };

if (import.meta.main) await runStandalone(process.argv[3] === 'standin' ? standinRole : role);
