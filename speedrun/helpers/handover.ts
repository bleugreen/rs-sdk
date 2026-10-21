// handover (role): move exact amounts of stock from this account's bank to other
// accounts by trade, then stop. For ledger moves the fleet's courier cannot make
// (it always carries whole stacks), e.g. a few talismans and a few hundred essence
// from an essence miner to the run machine's altar givers. Restartable: what
// is already carried is offered first, and the bank is re-read every round.
//
// Role options:
//   bank       { x, z } bank to withdraw at (default: the nearest booth in reach of where it stands)
//   meet       { x, z } where to trade (default: stay at the bank)
//   handovers  [{ to: 'cairn_h70', items: [{ item: 'Air talisman', n: 1 }, { item: 'Rune essence', n: 300 }] }]
//              non-stackable items above one are withdrawn as notes
import { withdrawMany } from '../lib/bank';
import { give } from '../lib/trade';
import { closeBank, depositAllExcept, ensureOutOfTutorial, openBank, walkNear } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';
import { waitForPlayer } from './wine';

export interface Handover {
    to: string;
    items: { item: string; n: number }[];
}

export function handoverOptions(raw: Record<string, unknown>): { bank?: { x: number; z: number }; meet?: { x: number; z: number }; handovers: Handover[] } {
    const list = raw.handovers;
    if (!Array.isArray(list) || list.length === 0) throw new Error('handover: options.handovers is required');
    const handovers = list.map((h: Record<string, unknown>, i: number) => {
        const to = String(h.to ?? '');
        if (!/^cairn_[a-z0-9_]{1,6}$/.test(to)) throw new Error(`handovers[${i}].to must be a cairn_ account`);
        const items = (Array.isArray(h.items) ? h.items : []).map((it: Record<string, unknown>) => ({ item: String(it.item), n: Number(it.n) }));
        if (items.length === 0 || items.some(it => !it.item || !Number.isInteger(it.n) || it.n < 1)) throw new Error(`handovers[${i}].items need item and a positive n`);
        return { to, items };
    });
    return { ...(raw.bank ? { bank: raw.bank as { x: number; z: number } } : {}), ...(raw.meet ? { meet: raw.meet as { x: number; z: number } } : {}), handovers };
}

const exact = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

async function one(ctx: RoleContext, h: Handover, o: ReturnType<typeof handoverOptions>): Promise<boolean> {
    const { sdk } = ctx;
    if (o.bank) await walkNear(ctx, o.bank.x, o.bank.z, 3);
    if (!(await openBank(ctx))) throw new Error('could not open the bank');
    await depositAllExcept(sdk);
    const specs = h.items.map(it => ({ item: exact(it.item), n: it.n, asNote: it.n > 1 }));
    const w = await withdrawMany(sdk, specs);
    ctx.reportBank({ items: sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count })) });
    await closeBank(ctx);
    if (!w.ok) {
        ctx.log('handover: withdraw incomplete', { to: h.to, reason: w.reason, missing: w.missing });
        return false;
    }
    if (o.meet) await walkNear(ctx, o.meet.x, o.meet.z, 3);
    if (!(await waitForPlayer(sdk, h.to, 20 * 60_000))) {
        ctx.log('handover: partner never came into sight', { to: h.to });
        return false;
    }
    const r = await give(sdk, h.to, h.items.map(it => ({ item: exact(it.item), n: it.n })), { openTimeoutMs: 120_000 });
    ctx.log('handover', { to: h.to, ok: r.ok, gave: r.gave.map(i => `${i.name} x${i.count}`), reason: r.reason });
    return r.ok;
}

export const role: Role = {
    name: 'handover',
    produces: [],
    async run(ctx) {
        const o = handoverOptions(ctx.options);
        await ensureOutOfTutorial(ctx);
        await ctx.bot.dismissBlockingUI();
        const done: string[] = [];
        for (const h of o.handovers) {
            if (ctx.signal.aborted) break;
            for (let attempt = 0; attempt < 3 && !ctx.signal.aborted; attempt++) {
                if (await one(ctx, h, o)) {
                    done.push(h.to);
                    break;
                }
            }
        }
        // Whatever is still carried goes back to the bank.
        if (o.bank) await walkNear(ctx, o.bank.x, o.bank.z, 3);
        if (await openBank(ctx)) {
            await depositAllExcept(ctx.sdk);
            ctx.reportBank({ items: ctx.sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count })) });
            await closeBank(ctx);
        }
        ctx.log('handover: finished', { done, of: o.handovers.map(h => h.to) });
    }
};

if (import.meta.main) await runStandalone(role);
