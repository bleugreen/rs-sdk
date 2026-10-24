// Alchemy on a carried stack: a markets method loop (docs/markets/methods.md), run as a fleet Role.
//
//   ROLE_OPTIONS='{"item":"Iron bar","spell":"high"}' bun markets/methods/alch.ts <account>
//
// Casts the spell on the item every server tick and lets the server drop the casts that land in
// the spell's delay (alchemy.rs2: High Alchemy ends in p_delay(3), Low Alchemy in p_delay(1)).
// Noted items and runes stack, so a full load lasts thousands of casts and the loop never banks;
// staff of fire pays the fire runes. Coins land in the inventory: bank them before they count on
// the board.

import type { BotWorldState } from '../../sdk/types';
import { nextTick } from '../../speedrun/lib/wait';
import { runStandalone, type Role, type RoleContext } from '../../speedrun/helpers/role';

/** interface.pack magic:highlvl_alchemy and magic:lowlvl_alchemy. */
export const ALCH_SPELLS = { high: 1178, low: 1162 } as const;

/** Nature runes per cast, and the share of cost paid (alchemy.rs2 scale(6,10) and scale(4,10)). */
export const ALCH_PAYS = { high: 0.6, low: 0.4 } as const;

/**
 * Coins an hour from alching an item bought at `buy` with natures at `nature`, at `castsPerHour`.
 * The alch pays floor(share x cost), at least 1.
 */
export function alchCoinsPerHour(i: { cost: number; buy: number; nature: number; spell: keyof typeof ALCH_PAYS; castsPerHour: number }): number {
    const pays = Math.max(Math.floor(i.cost * ALCH_PAYS[i.spell]), 1);
    return (pays - i.buy - i.nature) * i.castsPerHour;
}

const xpOf = (s: BotWorldState) => s.skills.find(k => k.name === 'Magic')?.experience ?? 0;
const coinsIn = (s: BotWorldState) => s.inventory.filter(i => i.name === 'Coins').reduce((a, i) => a + i.count, 0);

class Alcher {
    casts = 0;
    sent = 0;
    constructor(private readonly ctx: RoleContext) {}

    async run(): Promise<void> {
        const sdk = this.ctx.sdk;
        const spell = String(this.ctx.options.spell ?? 'high') as keyof typeof ALCH_SPELLS;
        const item = new RegExp(`^${String(this.ctx.options.item ?? 'Iron bar').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const reportTicks = Number(this.ctx.options.reportTicks ?? 500);
        let s = sdk.getState()!;
        const t0 = s.tick, c0 = coinsIn(s);
        let lastXp = xpOf(s), lastReport = t0;
        const gaps: Record<number, number> = {};
        let lastCast = -1;
        this.ctx.log('start', { spell, item: String(item), magic: s.skills.find(k => k.name === 'Magic')?.baseLevel });
        while (!this.ctx.signal.aborted) {
            if (xpOf(s) > lastXp) {
                this.casts++;
                if (lastCast >= 0) gaps[s.tick - lastCast] = (gaps[s.tick - lastCast] ?? 0) + 1;
                lastCast = s.tick;
            }
            lastXp = xpOf(s);
            if (s.dialog.isOpen) await sdk.sendClickDialog(0);
            const stack = s.inventory.find(i => item.test(i.name));
            const natures = s.inventory.find(i => i.name === 'Nature rune')?.count ?? 0;
            if (!stack || natures < 1) {
                this.ctx.log('out of supplies', { item: !!stack, natures });
                break;
            }
            await sdk.sendSpellOnItem(stack.slot, ALCH_SPELLS[spell]);
            this.sent++;
            if (s.tick - lastReport >= reportTicks) {
                lastReport = s.tick;
                this.ctx.log('progress', { ticks: s.tick - t0, casts: this.casts, coins: coinsIn(s) - c0, gaps });
            }
            s = await nextTick(sdk, s.tick);
        }
        this.ctx.log('stop', { ticks: s.tick - t0, casts: this.casts, sent: this.sent, coins: coinsIn(s) - c0, gaps });
    }
}

export const role: Role = {
    name: 'alch',
    produces: [/^Coins$/],
    run: ctx => new Alcher(ctx).run()
};

if (import.meta.main) await runStandalone(role);
