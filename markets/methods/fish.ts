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
//   bass       net/harpoon spot, op 1 Net (big net): every roll checks boots, seaweed, gloves,
//              mackerel (twice), oyster, casket, cod (23+) and bass (46+) independently
//              (memberfish.rs2 fish_roll_big_net), so one roll can land several items.
// Option `keep` (inventory names, e.g. ["Raw bass","Oyster"]) drops everything else when the
// pack fills and banks only once the pack is full of kept items.
// Spots (server/content/maps m44_53): net/harpoon (2846,3429), (2855,3423), (2859,3426);
// cage/harpoon (2844,3429), (2853,3423).

import type { BotWorldState, NearbyNpc } from '../../sdk/types';
import { depositMatching } from '../../speedrun/lib/bank';
import { walkTo } from '../../speedrun/lib/act';
import { nextTick, waitTicks } from '../../speedrun/lib/wait';
import { runStandalone, type Role, type RoleContext } from '../../speedrun/helpers/role';
// stat_random is one formula for every skill; value.ts names it for pickpocketing
import { pickpocketChance } from './value';

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
 * Whether to click the spot again: nothing clicked yet, the clicked spot gone from its tile (it
 * moved), or no catch for `staleTicks`. Never on animation: the harpoon and net animations end
 * between rolls, and a click while the op is still looping restarts its 5-tick clock (a first lab
 * run that re-clicked on 3 idle ticks caught half the sharks).
 */
export function shouldReclick(i: { clicked: boolean; spotThere: boolean; sinceCatch: number; staleTicks?: number }): boolean {
    if (!i.clicked || !i.spotThere) return true;
    return i.sinceCatch >= (i.staleTicks ?? 150);
}

/**
 * memberfish.rs2 fish_roll_big_net: each entry's stat_random(fishing, lo, hi) success chance, all
 * rolled on every cast; cod from Fishing 23, bass from 46. Debug names (raw_bass is "Raw bass",
 * oystershell "Oyster").
 */
export const BIG_NET: ReadonlyArray<{ obj: string; lo: number; hi: number; from: number }> = [
    { obj: 'leather_boots', lo: 10, hi: 10, from: 1 },
    { obj: 'seaweed', lo: 10, hi: 10, from: 1 },
    { obj: 'leather_gloves', lo: 5, hi: 5, from: 1 },
    { obj: 'raw_mackerel', lo: 5, hi: 65, from: 1 },
    { obj: 'raw_mackerel', lo: 10, hi: 10, from: 1 },
    { obj: 'oystershell', lo: 3, hi: 7, from: 1 },
    { obj: 'casket', lo: 1, hi: 2, from: 1 },
    { obj: 'raw_cod', lo: 4, hi: 55, from: 23 },
    { obj: 'raw_bass', lo: 3, hi: 40, from: 46 }
];

/** Expected units of each obj per big-net roll at a Fishing level. */
export function bigNetPerRoll(level: number): Map<string, number> {
    const out = new Map<string, number>();
    for (const e of BIG_NET) {
        if (level < e.from) continue;
        out.set(e.obj, (out.get(e.obj) ?? 0) + pickpocketChance(level, e.lo, e.hi));
    }
    return out;
}

/** What to drop when the pack is full: every item that is neither the tool nor on the keep list. */
export function junk(inventory: readonly { slot: number; name: string }[], tool: RegExp, keep: readonly string[] | null): number[] {
    if (!keep) return [];
    const k = new Set(keep.map(n => n.toLowerCase()));
    return inventory.filter(i => !tool.test(i.name) && !k.has(i.name.toLowerCase())).map(i => i.slot);
}

const free = (s: BotWorldState) => 28 - s.inventory.length;
const xpOf = (s: BotWorldState) => s.skills.find(k => k.name === 'Fishing')?.experience ?? 0;

class Fisher {
    private readonly c: Catch;
    /** Inventory names kept when the pack fills; the rest is dropped. Null banks everything. */
    private readonly keep: string[] | null;
    catches = 0;
    banks = 0;
    clicks = 0;
    drops = 0;
    fishTicks = 0;
    private startTick = 0;

    constructor(private readonly ctx: RoleContext) {
        const name = String(ctx.options.catch ?? 'shark') as keyof typeof CATCHES;
        if (!(name in CATCHES)) throw new Error(`fish: unknown catch ${name}`);
        this.c = CATCHES[name];
        this.keep = Array.isArray(ctx.options.keep) ? (ctx.options.keep as unknown[]).map(String) : null;
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
                if (free(this.s) === 0 && !(await this.dropJunk())) await this.bank();
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

    /** Drop the junk when the pack is full and a keep list is set; false when nothing could be dropped. */
    private async dropJunk(): Promise<boolean> {
        const slots = junk(this.s.inventory, this.c.tool, this.keep);
        if (!slots.length) return false;
        await Promise.all(slots.map(slot => this.ctx.sdk.sendDropItem(slot)));
        await waitTicks(this.ctx.sdk, 2);
        this.drops += slots.length;
        return true;
    }

    private async fish(): Promise<void> {
        const sdk = this.ctx.sdk;
        let s = this.s, lastXp = xpOf(s), lastCatch = s.tick;
        let clicked: { index: number; x: number; z: number } | null = null;
        while (!this.ctx.signal.aborted && free(s) > 0) {
            this.fishTicks++;
            if (xpOf(s) > lastXp) {
                this.catches++;
                lastCatch = s.tick;
            }
            lastXp = xpOf(s);
            if (s.dialog.isOpen) {
                // a level-up page stops the op: dismiss it and click again
                await sdk.sendClickDialog(0);
                clicked = null;
            }
            const there = !!clicked && s.nearbyNpcs.some(n => n.index === clicked!.index && n.x === clicked!.x && n.z === clicked!.z);
            if (shouldReclick({ clicked: !!clicked, spotThere: there, sinceCatch: s.tick - lastCatch })) {
                const spot = this.spot(s);
                const op = spot?.optionsWithIndex.find(o => this.c.op.test(o.text));
                if (spot && op) {
                    await sdk.sendInteractNpc(spot.index, op.opIndex);
                    this.clicks++;
                    clicked = { index: spot.index, x: spot.x, z: spot.z };
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
        this.ctx.log(message, { ticks: this.s.tick - this.startTick, fishTicks: this.fishTicks, catches: this.catches, banks: this.banks, clicks: this.clicks, drops: this.drops });
    }
}

export const role: Role = {
    name: 'fish',
    produces: [/^Raw /],
    run: ctx => new Fisher(ctx).run()
};

if (import.meta.main) await runStandalone(role);
