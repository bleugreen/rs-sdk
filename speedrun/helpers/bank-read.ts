// bank-read (role): a read-only census of one account. It logs what the account carries and
// wears, by item id, before touching anything; then opens the bank it stands at (or walks to
// `bank` first), logs the whole bank by id, closes it and ends. It never deposits, withdraws,
// trades, drops or eats, so an account staged for the run comes out exactly as it went in.
// Run it as a `final` entry, one account per launcher, and the launcher logs the account
// out when the read is done.
//
// Options:
//   bank   { x, z }: walk within 3 tiles of this bank before opening it (default: open
//          the bank where the account stands)
//
// Log lines: `carried` { tick, at, inventory, equipment }, `bank` { tick, items, slotsUsed },
// each item { id, name, count } (inventory and equipment also carry `slot`).
import { pos, until } from './altar-room';
import { closeBank, openBank, walkNear } from './mule';
import { runStandalone, type Role } from './role';

export interface CensusItem {
    id: number;
    name: string;
    count: number;
    slot?: number;
}

/** Items as logged: id, name, count (and slot when the source has one), empties dropped. */
export function censusItems(items: readonly { id: number; name: string; count: number; slot?: number }[] | undefined, withSlot: boolean): CensusItem[] {
    return (items ?? [])
        .filter(i => i && i.id >= 0 && i.count > 0)
        .map(i => ({ id: i.id, name: i.name, count: i.count, ...(withSlot && typeof i.slot === 'number' ? { slot: i.slot } : {}) }));
}

function bankOption(raw: unknown): { x: number; z: number } | null {
    if (raw === undefined) return null;
    const b = raw as { x?: unknown; z?: unknown };
    if (!b || !Number.isInteger(b.x) || !Number.isInteger(b.z)) throw new Error('bank-read: options.bank must be { x, z } in whole tiles');
    return { x: b.x as number, z: b.z as number };
}

export const role: Role = {
    name: 'bank-read',
    produces: [],
    async run(ctx) {
        const bank = bankOption(ctx.options.bank);
        if (!(await until(ctx, st => !!st.player && st.player.worldX > 0, 30))) throw new Error('bank-read: no player state');
        const s = () => ctx.sdk.getState()!;
        // Carried first, before the bank interface or a walk could change anything.
        ctx.log('carried', { tick: s().tick, at: pos(s()), inventory: censusItems(s().inventory, true), equipment: censusItems(s().equipment, true) });
        if (bank && !(await walkNear(ctx, bank.x, bank.z, 3))) throw new Error(`bank-read: could not reach the bank at ${bank.x},${bank.z}`);
        if (!(await openBank(ctx))) throw new Error('bank-read: could not open a bank here');
        const items = censusItems(ctx.sdk.getBankItems(), false);
        ctx.log('bank', { tick: s().tick, at: pos(s()), items, slotsUsed: items.length });
        await closeBank(ctx);
        // Carried again after: proof the read moved nothing.
        ctx.log('carried after', { tick: s().tick, inventory: censusItems(s().inventory, true) });
    }
};

if (import.meta.main) await runStandalone(role);
