// Shared helpers for the Regicide measurement scripts. Not a script itself.
// Ticks are server ticks as the lite client observes them (state.tick); staff
// commands need LOCAL_STAFF_LEVEL=4 (docs/speedrun/LAB.md).

import type { BotSDK } from '../../../sdk/index';
import type { NearbyLoc, NearbyNpc } from '../../../sdk/types';
import { cheat, now, pos, tele, waitTicks, waitUntil } from './quest-primitives-lib';
import { talkThrough, type DialogueResult } from './quest-arthur-lab';

export { cheat, now, pos, tele, waitTicks, waitUntil, talkThrough };

export async function getVar(sdk: BotSDK, name: string): Promise<number | null> {
    const before = sdk.getState()?.gameMessages.length ?? 0;
    await sdk.sendSay(`::getvar ${name}`);
    for (let i = 0; i < 12; i++) {
        await waitTicks(sdk, 1);
        const msgs = sdk.getState()?.gameMessages ?? [];
        for (const m of msgs.slice(Math.max(0, before - 5)).reverse()) {
            const match = m.text.match(new RegExp(`${name}\\D*?(-?\\d+)\\s*$`, 'i'));
            if (match) return Number(match[1]);
        }
    }
    return null;
}

export async function setVar(sdk: BotSDK, name: string, value: number): Promise<void> {
    await cheat(sdk, `setvar ${name} ${value}`);
    await waitTicks(sdk, 1);
}

export async function setStats(sdk: BotSDK, stats: Record<string, number>): Promise<void> {
    for (const [stat, level] of Object.entries(stats)) {
        await cheat(sdk, `setstat ${stat} ${level}`);
        await waitTicks(sdk, 1);
    }
}

export function invCount(sdk: BotSDK, re: RegExp): number {
    return sdk.getInventory().filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
}

/** Give `n` of an obj if the inventory holds fewer (matched by display name). */
export async function ensure(sdk: BotSDK, obj: string, display: RegExp, n = 1): Promise<void> {
    const have = invCount(sdk, display);
    if (have < n) {
        await cheat(sdk, `give ${obj} ${n - have}`);
        await waitUntil(sdk, () => invCount(sdk, display) >= n, 10);
    }
}

export async function dropAll(sdk: BotSDK, keep: RegExp[] = []): Promise<void> {
    for (const it of sdk.getInventory()) {
        if (keep.some(k => k.test(it.name))) continue;
        await sdk.sendDropItem(it.slot);
        await waitTicks(sdk, 1);
    }
}

export async function findLoc(sdk: BotSDK, x: number, z: number, name?: RegExp): Promise<NearbyLoc | null> {
    for (let i = 0; i < 4; i++) {
        const locs = await sdk.scanNearbyLocs(20);
        const hit = locs.find(l => l.x === x && l.z === z && (!name || name.test(l.name)));
        if (hit) return hit;
        await waitTicks(sdk, 1);
    }
    return null;
}

export function findNpc(sdk: BotSDK, name: RegExp): NearbyNpc | null {
    return sdk.getNearbyNpcs().filter(n => name.test(n.name)).sort((a, b) => a.distance - b.distance)[0] ?? null;
}

export function dlg(d: DialogueResult) {
    return { ticks: d.ticks, pages: d.pages, options: d.options, clicks: d.pages + d.options };
}

/** Talk to the nearest NPC by name; returns click-to-close ticks and the dialogue counts. */
export async function talk(sdk: BotSDK, npc: RegExp, choices: RegExp[] = []) {
    await waitUntil(sdk, () => findNpc(sdk, npc) !== null, 20);
    const n = findNpc(sdk, npc);
    if (!n) throw new Error(`npc ${npc} not found`);
    const t0 = now(sdk);
    await sdk.sendTalkToNpc(n.index);
    const d = await talkThrough(sdk, choices);
    return { ...dlg(d), clickToClose: now(sdk) - t0 - 3, transcript: d.transcript };
}

/** Use an inventory item on an NPC and run the dialogue that follows. */
export async function useOnNpc(sdk: BotSDK, item: RegExp, npc: RegExp, choices: RegExp[] = []) {
    await waitUntil(sdk, () => findNpc(sdk, npc) !== null, 20);
    const n = findNpc(sdk, npc)!;
    const it = sdk.getInventory().find(i => item.test(i.name));
    if (!it) throw new Error(`no ${item} in inventory`);
    const t0 = now(sdk);
    await sdk.sendUseItemOnNpc(it.slot, n.index);
    const d = await talkThrough(sdk, choices);
    return { ...dlg(d), clickToClose: now(sdk) - t0 - 3, transcript: d.transcript };
}

/** Record the player's position every tick until stopped. */
export function track(sdk: BotSDK) {
    const rows: Array<{ t: number; x: number; z: number; level: number; hp: number }> = [];
    let last = -1;
    const stop = sdk.onStateUpdate(s => {
        if (s.tick === last) return;
        last = s.tick;
        const p = pos(s);
        rows.push({ t: s.tick, ...p, hp: s.player?.hp ?? -1 } as never);
    });
    return { rows, stop };
}

export function result(name: string, data: unknown): void {
    console.log(`RESULT ${name} ${JSON.stringify(data)}`);
}
