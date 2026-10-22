// Catherby fishing to the bank: a markets method loop (docs/markets/methods.md), run as a fleet Role.
//
//   ROLE_OPTIONS='{"catch":"shark"}' bun markets/methods/fish.ts <account>
//
// One trip: fish until the pack is full, walk to the Catherby bank, deposit everything but the
// tool, report the bank, walk back. A fishing op loops on the server until the pack is full
// (memberfish.rs2 / rarefish.rs2 re-queue p_opnpc every roll), so the loop clicks once and
// clicks again only when the player has stopped (the spot moved: fishing_movement.rs2).
//
// Catches (skill_fishing; one roll every 5 ticks, success from fishing.struct success_low/high):
//   shark      net/harpoon spot, op 3 Harpoon   Fishing 76  (3, 40): 16% a roll at 99
//   swordfish  cage/harpoon spot, op 3 Harpoon  tuna from 35, swordfish from 50
//   lobster    cage/harpoon spot, op 1 Cage     Fishing 40
//   bass       net/harpoon spot, op 1 Net (big net): mackerel, cod, bass and junk
// Spots (server/content/maps m44_53): net/harpoon (2846,3429), (2855,3423), (2859,3426);
// cage/harpoon (2844,3429), (2853,3423).

import type { BotWorldState, NearbyNpc } from '../../sdk/types';
import { depositMatching } from '../../speedrun/lib/bank';
import { walkTo } from '../../speedrun/lib/act';
import { nextTick, waitTicks } from '../../speedrun/lib/wait';
import { runStandalone, type Role, type RoleContext } from '../../speedrun/helpers/role';

export const CATHERBY_BANK = { x: 2809, z: 3440 };
export const CATHERBY_SPOTS = { x: 2851, z: 3427 };

export interface Catch {
    op: RegExp;
    tool: RegExp;
    /** The spot type: the net/harpoon spot offers Net, the cage/harpoon spot Cage. */
    spotOps: RegExp;
}

export const CATCHES: Record<'shark' | 'swordfish' | 'lobster' | 'bass', Catch> = {
    shark: { op: /^harpoon$/i, tool: /^harpoon$/i, spotOps: /^net$/i },
    swordfish: { op: /^harpoon$/i, tool: /^harpoon$/i, spotOps: /^cage$/i },
    lobster: { op: /^cage$/i, tool: /^lobster pot$/i, spotOps: /^cage$/i },
    bass: { op: /^net$/i, tool: /^big fishing net$/i, spotOps: /^net$/i }
};

/**
 * Whether to click the spot again: nothing clicked yet, the player idle for `idleTicks` (the
 * spot moved or the op ended), or no catch for `staleTicks` while the spot is still listed.
 */
export function shouldReclick(i: { clicked: boolean; idleFor: number; sinceCatch: number; idleTicks?: number; staleTicks?: number }): boolean {
    if (!i.clicked) return true;
    if (i.idleFor >= (i.idleTicks ?? 3)) return true;
    return i.sinceCatch >= (i.staleTicks ?? 120);
}

const free = (s: BotWorldState) => 28 - s.inventory.length;
const xpOf = (s: BotWorldState) => s.skills.find(k => k.name === 'Fishing')?.experience ?? 0;

class Fisher {
    private readonly c: Catch;
    catches = 0;
    banks = 0;
    clicks = 0;
    private startTick = 0;

    constructor(private readonly ctx: RoleContext) {
        const name = String(ctx.options.catch ?? 'shark') as keyof typeof CATCHES;
        if (!(name in CATCHES)) throw new Error(`fish: unknown catch ${name}`);
        this.c = CATCHES[name];
    }

    private get s(): BotWorldState {
        const s = this.ctx.sdk.getState();
        if (!s?.player) throw new Error('no game state');
        return s;
    }

    async run(): Promise<void> {
        this.startTick = this.s.tick;
        this.ctx.log('start', { options: this.ctx.options, fishing: this.s.skills.find(k => k.name === 'Fishing')?.baseLevel });
        while (!this.ctx.signal.aborted) {
            try {
                if (!this.s.inventory.some(i => this.c.tool.test(i.name))) throw new Error('no tool');
                if (free(this.s) === 0) await this.bank();
                else if (Math.max(Math.abs(this.s.player!.worldX - CATHERBY_SPOTS.x), Math.abs(this.s.player!.worldZ - CATHERBY_SPOTS.z)) > 14) await walkTo(this.ctx.bot, this.ctx.sdk, CATHERBY_SPOTS.x, CATHERBY_SPOTS.z, 3);
                else await this.fish();
            } catch (e) {
                this.ctx.log('errand error', { error: String(e) });
                if (String(e).includes('no tool')) return;
                await waitTicks(this.ctx.sdk, 5);
            }
        }
        this.report('stop');
    }

    private spot(s: BotWorldState): NearbyNpc | undefined {
        return s.nearbyNpcs
            .filter(n => /^fishing spot$/i.test(n.name) && n.optionsWithIndex.some(o => this.c.spotOps.test(o.text)) && n.optionsWithIndex.some(o => this.c.op.test(o.text)))
            .sort((a, b) => a.distance - b.distance)[0];
    }

    private async fish(): Promise<void> {
        const sdk = this.ctx.sdk;
        let s = this.s, lastXp = xpOf(s), clicked = false, idleFor = 0, lastCatch = s.tick;
        while (!this.ctx.signal.aborted && free(s) > 0) {
            if (xpOf(s) > lastXp) {
                this.catches++;
                lastCatch = s.tick;
            }
            lastXp = xpOf(s);
            idleFor = s.player!.animId === -1 ? idleFor + 1 : 0;
            if (s.dialog.isOpen) await sdk.sendClickDialog(0); // level-up pages stop the op
            if (shouldReclick({ clicked, idleFor, sinceCatch: s.tick - lastCatch })) {
                const spot = this.spot(s);
                const op = spot?.optionsWithIndex.find(o => this.c.op.test(o.text));
                if (spot && op) {
                    await sdk.sendInteractNpc(spot.index, op.opIndex);
                    this.clicks++;
                    clicked = true;
                    idleFor = -3; // the walk to the spot shows no animation
                    lastCatch = s.tick;
                }
            }
            s = await nextTick(sdk, s.tick);
        }
    }

    private async bank(): Promise<void> {
        const r = await walkTo(this.ctx.bot, this.ctx.sdk, CATHERBY_BANK.x, CATHERBY_BANK.z, 2);
        if (!r.ok) this.ctx.log('walk failed', { message: r.message });
        const opened = await this.ctx.bot.openBank();
        if (!opened.success) throw new Error(`openBank: ${opened.message}`);
        const catchIds = [...new Set(this.ctx.sdk.getState()!.inventory.filter(i => !this.c.tool.test(i.name)).map(i => i.id))];
        const d = await depositMatching(this.ctx.sdk, catchIds);
        if (!d.ok) this.ctx.log('deposit incomplete', { reason: d.reason });
        this.banks++;
        this.ctx.reportBank({ items: this.ctx.sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count })) });
        await this.ctx.bot.closeBank();
        this.report('banked');
    }

    private report(message: string): void {
        this.ctx.log(message, { ticks: this.s.tick - this.startTick, catches: this.catches, banks: this.banks, clicks: this.clicks });
    }
}

export const role: Role = {
    name: 'fish',
    produces: [/^Raw /],
    run: ctx => new Fisher(ctx).run()
};

if (import.meta.main) await runStandalone(role);
