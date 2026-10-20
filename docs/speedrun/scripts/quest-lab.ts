// Shared helpers for the quest-route measurement scripts (docs/speedrun/quests/).
//
// Every helper reports server ticks as observed by the lite client
// (BotWorldState.tick), never wall-clock time, so results are valid at any
// NODE_TICKRATE. Staff commands (::tele, ::setvar, ::give, ::setstat) need the
// engine started with LOCAL_STAFF_LEVEL=4; see docs/speedrun/LAB.md.

import type { BotSDK } from '../../../sdk/index';
import type { BotActions } from '../../../sdk/actions';

export function tick(sdk: BotSDK): number {
    return sdk.getState()?.tick ?? 0;
}

export function pos(sdk: BotSDK): { x: number; z: number; level: number } {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
}

/** Run a staff command and wait for it to take effect. */
export async function cheat(sdk: BotSDK, command: string, settleTicks = 2): Promise<void> {
    await sdk.sendSay(`::${command}`);
    await sdk.waitForTicks(settleTicks);
}

/** Teleport to an absolute tile with ::tele (level,mx,mz,lx,lz). */
export async function tele(sdk: BotSDK, x: number, z: number, level = 0): Promise<void> {
    await cheat(sdk, `tele ${level},${x >> 6},${z >> 6},${x & 63},${z & 63}`, 3);
}

/** Read a varp with ::getvar; returns null if the reply never arrives. */
export async function getVar(sdk: BotSDK, name: string): Promise<number | null> {
    const before = sdk.getState()?.gameMessages.length ?? 0;
    await sdk.sendSay(`::getvar ${name}`);
    for (let i = 0; i < 10; i++) {
        await sdk.waitForTicks(1);
        const msgs = sdk.getState()?.gameMessages ?? [];
        for (const m of msgs.slice(Math.max(0, before - 5)).reverse()) {
            const match = m.text.match(new RegExp(`^get ${name}: (-?\\d+)`, 'i'));
            if (match) return Number(match[1]);
        }
    }
    return null;
}

export async function setStats(sdk: BotSDK, stats: Record<string, number>): Promise<void> {
    for (const [stat, level] of Object.entries(stats)) {
        await cheat(sdk, `setstat ${stat} ${level}`, 1);
    }
}

/** Empty the inventory by dropping everything, then ::give each item. */
export async function giveItems(sdk: BotSDK, items: Array<[string, number]>): Promise<void> {
    for (const [name, count] of items) {
        await cheat(sdk, `give ${name} ${count}`, 1);
    }
}

export async function clearInventory(sdk: BotSDK, bot: BotActions): Promise<void> {
    for (const item of sdk.getInventory()) {
        await bot.dropItem(item, 'all');
    }
}

export interface DialogueResult {
    /** Ticks from the first observed dialogue page to the dialogue closing. */
    ticks: number;
    /** Pages advanced with "click here to continue". */
    pages: number;
    /** Multi-choice option clicks. */
    options: number;
    transcript: string[];
}

/**
 * Answer an open (or about-to-open) dialogue as fast as the client allows.
 *
 * On every option page the first `choices` pattern that matches a visible
 * option is clicked (patterns are not consumed, so list them in priority
 * order); on every other page "continue" is clicked. The dialogue is over once
 * it has stayed closed for `settleTicks` ticks. Throws if an option page has
 * no matching pattern, so a script never silently takes a wrong branch.
 */
export async function talkThrough(
    sdk: BotSDK,
    choices: RegExp[] = [],
    opts: { settleTicks?: number; maxTicks?: number; startTick?: number } = {}
): Promise<DialogueResult> {
    const settle = opts.settleTicks ?? 3;
    const maxTicks = opts.maxTicks ?? 400;
    const begin = tick(sdk);
    let firstOpen: number | null = opts.startTick ?? null;
    let lastClose: number | null = null;
    let lastPage: string | undefined;
    let lastClickTick = -1;
    let pages = 0;
    let options = 0;
    const transcript: string[] = [];

    while (tick(sdk) - begin < maxTicks) {
        const s = sdk.getState()!;
        const d = s.dialog;
        if (d.isOpen) {
            if (firstOpen === null) firstOpen = s.tick;
            lastClose = null;
            // A page that repeats its text keeps its id; re-click if it lingers.
            const stale = d.pageId === lastPage && s.tick - lastClickTick >= 3;
            if (!d.isWaiting && (d.pageId !== lastPage || stale)) {
                lastPage = d.pageId;
                lastClickTick = s.tick;
                const isContinue = d.options.length > 0 && d.options.every(o => /click here to continue|^continue/i.test(o.text));
                if (isContinue) {
                    transcript.push(`[${s.tick}] page: ${(d.text ?? '').replace(/\s+/g, ' ').slice(0, 90)}`);
                    const r = await sdk.clickDialogByText(/continue/i);
                    if (!r.success) lastPage = undefined;
                    else pages++;
                } else if (d.options.length > 0) {
                    const texts = d.options.map(o => o.text);
                    const pick = choices.find(re => texts.some(t => re.test(t)));
                    if (!pick) {
                        throw new Error(`talkThrough: no choice matches options ${JSON.stringify(texts)}`);
                    }
                    transcript.push(`[${s.tick}] option: ${texts.find(t => pick.test(t))}`);
                    const r = await sdk.clickDialogByText(pick);
                    if (!r.success) {
                        lastPage = undefined;
                    } else {
                        options++;
                    }
                } else {
                    transcript.push(`[${s.tick}] page: ${(d.text ?? '').replace(/\s+/g, ' ').slice(0, 90)}`);
                    await sdk.sendClickDialog(0);
                    pages++;
                }
            }
        } else if (firstOpen !== null) {
            if (lastClose === null) lastClose = s.tick;
            if (s.tick - lastClose >= settle) break;
        } else if (s.tick - begin > 20) {
            break; // nothing ever opened
        }
        await sdk.waitForStateUpdate();
    }
    const end = lastClose ?? tick(sdk);
    return { ticks: firstOpen === null ? 0 : end - firstOpen, pages, options, transcript };
}

/** Wait until `pred` holds, polling each state update; returns the tick it held at. */
export async function waitUntil(sdk: BotSDK, pred: () => boolean, maxTicks = 200): Promise<number | null> {
    const begin = tick(sdk);
    while (tick(sdk) - begin < maxTicks) {
        if (pred()) return tick(sdk);
        await sdk.waitForStateUpdate();
    }
    return null;
}

/** Walk with the SDK pathfinder and report ticks and Chebyshev tiles moved. */
export async function timedWalk(
    sdk: BotSDK,
    bot: BotActions,
    x: number,
    z: number,
    tolerance = 0
): Promise<{ ticks: number; tiles: number; success: boolean; message: string }> {
    const start = tick(sdk);
    let tiles = 0;
    let last = pos(sdk);
    const off = sdk.onStateUpdate(st => {
        const p = st.player;
        if (!p) return;
        tiles += Math.max(Math.abs(p.worldX - last.x), Math.abs(p.worldZ - last.z));
        last = { x: p.worldX, z: p.worldZ, level: p.level };
    });
    const r = await bot.walkTo(x, z, tolerance);
    off();
    return { ticks: tick(sdk) - start, tiles, success: r.success, message: r.message ?? '' };
}

export function report(title: string, rows: Record<string, unknown>): void {
    console.log(`\n== ${title} ==`);
    for (const [k, v] of Object.entries(rows)) console.log(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
}
