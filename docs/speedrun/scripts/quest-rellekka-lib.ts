// Shared helpers for the Fremennik Trials measurement scripts
// (docs/speedrun/quests/fremennik_trials.md). Builds on quest-arthur-lab.ts.

import type { BotSDK } from '../../../sdk/index';
import type { BotActions } from '../../../sdk/actions';
import * as L from './quest-arthur-lab';

export * from './quest-arthur-lab';

// %viking_bits fields (quest_viking.constant).
export const BITS = {
    swensenStarted: 1 << 10,
    revellerStarted: 1 << 12,
    sigliStarted: 1 << 14,
    thorvaldStarted: 1 << 16,
    peerStarted: 1 << 18,
    olaf: (stage: number) => stage << 20,
    sigmund: (stage: number) => stage << 23
};

export interface Talk {
    ticks: number; // talk-to click to dialogue closed
    pages: number;
    options: number;
    /** Page/option sequence, e.g. "4c, opt, 6c" (CONVENTIONS.md, three columns). */
    runs: string;
    transcript: string[];
}

export function runsOf(transcript: string[]): string {
    const out: string[] = [];
    let c = 0;
    for (const line of transcript) {
        if (/\] option: /.test(line)) {
            if (c) out.push(`${c}c`);
            c = 0;
            out.push('opt');
        } else c++;
    }
    if (c) out.push(`${c}c`);
    return out.join(', ');
}

/** Talk to an NPC (the bot walks to it) and answer the dialogue. */
export async function talk(sdk: BotSDK, bot: BotActions, npc: RegExp, choices: RegExp[] = [], maxTicks = 400): Promise<Talk> {
    await L.waitUntil(sdk, () => sdk.findNearbyNpc(npc) !== null, 20);
    const t0 = L.tick(sdk);
    const r = await bot.talkTo(npc);
    if (!r.success && !sdk.getState()?.dialog.isOpen) throw new Error(`talk ${npc}: ${r.message}`);
    const d = await L.talkThrough(sdk, choices, { maxTicks, settleTicks: 2 });
    return { ticks: L.tick(sdk) - t0 - 2, pages: d.pages, options: d.options, runs: runsOf(d.transcript), transcript: d.transcript };
}

/** Answer whatever dialogue is open (or opens within a few ticks). */
export async function finishDialogue(sdk: BotSDK, choices: RegExp[] = []): Promise<{ pages: number; options: number; runs: string; transcript: string[] }> {
    const d = await L.talkThrough(sdk, choices, { settleTicks: 2, maxTicks: 300 });
    return { pages: d.pages, options: d.options, runs: runsOf(d.transcript), transcript: d.transcript };
}

/** A loc at (x,z); several can share a tile (a wall and its decoration), so filter by op or name. */
export async function findLoc(sdk: BotSDK, x: number, z: number, op?: string, radius = 15, name?: RegExp) {
    const locs = await sdk.scanNearbyLocs(radius);
    const loc = locs.find(l => l.x === x && l.z === z && (!op || l.options.includes(op)) && (!name || name.test(l.name)));
    if (!loc) throw new Error(`no loc${op ? ` with ${op}` : ''} at ${x},${z} (near ${JSON.stringify(L.pos(sdk))})`);
    return loc;
}

/**
 * Click a loc option with the raw interaction packet. The SDK's interactLoc
 * waits for its own completion heuristics (up to about 20 ticks on a search
 * with no visible effect), which would inflate the timings.
 */
export async function opLoc(sdk: BotSDK, x: number, z: number, opt: string, name?: RegExp) {
    const loc = await findLoc(sdk, x, z, opt, 15, name);
    const o = loc.optionsWithIndex.find(q => q.text === opt)!;
    await sdk.sendInteractLoc(loc.x, loc.z, loc.id, o.opIndex);
}

export function invCount(sdk: BotSDK, re: RegExp): number {
    return sdk.getInventory().filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
}

/** Click `fn`, then wait for `done`; returns ticks from the click. */
export async function timed(sdk: BotSDK, fn: () => Promise<unknown>, done: () => boolean, maxTicks = 60): Promise<number | null> {
    const t0 = L.tick(sdk);
    await fn();
    const t = await L.waitUntil(sdk, done, maxTicks);
    return t === null ? null : t - t0;
}

export async function clearInv(sdk: BotSDK, bot: BotActions) {
    await bot.dismissBlockingUI();
    for (const e of sdk.getEquipment()) await bot.unequipItem(e.name);
    await sdk.waitForTicks(1);
    for (const item of sdk.getInventory()) await sdk.sendDropItem(item.slot);
    await sdk.waitForTicks(2);
}

export async function give(sdk: BotSDK, obj: string, n = 1) {
    await L.cheat(sdk, `give ${obj} ${n}`, 2);
}
