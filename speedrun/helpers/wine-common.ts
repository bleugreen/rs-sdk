// Shared pieces for the wine-supply roles (grapes.ts, jugs.ts, wine.ts): item ids,
// tick reads, tutorial skip, banking with a ledger report, and a clean logout.
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { InventoryItem } from '../../sdk/types';
import { depositMatching } from '../lib/bank';
import type { RoleContext } from './role';

/** Object ids from server/content/pack/obj.pack. A cert (note) id is its item id + 1. */
export const ITEM = {
    coins: 995,
    jugEmpty: 1935,
    jugWater: 1937,
    chefsHat: 1949,
    grapes: 1987,
    badWine: 1991,
    jugWine: 1993,
    wine: 1995, // jug_unfermented_wine: what the fermenting_wine timer counts
    wineNote: 1996 // cert_jug_unfermented_wine: invisible to the timer (wine.rs2 counts obj 1995 only)
} as const;

/** Varrock west bank booths face this tile; the Grand Exchange is in the same building. */
export const VARROCK_WEST_BANK = { x: 3185, z: 3436 };
/** Logout button (interface.pack: 2458 = logout:try_logout). */
export const LOGOUT_COMPONENT = 2458;

export class Aborted extends Error {
    constructor() {
        super('aborted');
    }
}

export function checkAbort(ctx: Pick<RoleContext, 'signal'>): void {
    if (ctx.signal.aborted) throw new Aborted();
}

export function tick(sdk: BotSDK): number {
    return sdk.getState()?.tick ?? 0;
}

export function invCount(sdk: BotSDK, id: number): number {
    return sdk.getInventory().reduce((n, i) => (i.id === id ? n + i.count : n), 0);
}

export function invSlots(sdk: BotSDK, id: number): InventoryItem[] {
    return sdk.getInventory().filter(i => i.id === id);
}

export function freeSlots(sdk: BotSDK): number {
    return 28 - sdk.getInventory().length;
}

/** Bank count of an item id; the bank must be open. */
export function bankCount(sdk: BotSDK, id: number): number {
    return sdk.getBankItems().reduce((n, i) => (i.id === id ? n + i.count : n), 0);
}

export function skillLevel(sdk: BotSDK, name: string): number {
    return sdk.getSkill(name)?.baseLevel ?? 1;
}

export function position(sdk: BotSDK): { x: number; z: number; level: number } {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
}

/** Tutorial Island's bounding box; a fresh account spawns inside it. */
export function inTutorial(sdk: BotSDK): boolean {
    const { x, z } = position(sdk);
    return x >= 3050 && x <= 3160 && z >= 3050 && z <= 3140;
}

/** Wait for a live state, skip the tutorial on a fresh account, dismiss leftover dialogs. */
export async function prepare(ctx: Pick<RoleContext, 'bot' | 'sdk' | 'log'>): Promise<void> {
    const { bot, sdk } = ctx;
    await sdk.waitForReady(30_000);
    for (let attempt = 0; attempt < 5 && inTutorial(sdk); attempt++) {
        const r = await bot.skipTutorial();
        ctx.log('skipTutorial', { success: r.success, detail: r.message });
        await sdk.waitForCondition(() => !inTutorial(sdk), 20_000).catch(() => {});
    }
    if (inTutorial(sdk)) throw new Error('still on Tutorial Island after 5 skip attempts');
    await bot.dismissBlockingUI();
}

/** Dismiss level-up and other chat dialogs that freeze gathering loops. */
export async function dismissDialogs(bot: BotActions, sdk: BotSDK): Promise<void> {
    if (sdk.getState()?.dialog.isOpen) await bot.dismissBlockingUI();
}

export async function walkNear(ctx: Pick<RoleContext, 'bot' | 'sdk' | 'log'>, x: number, z: number, tolerance = 3): Promise<void> {
    const here = position(ctx.sdk);
    if (Math.abs(here.x - x) <= tolerance && Math.abs(here.z - z) <= tolerance && here.level === 0) return;
    for (let attempt = 0; attempt < 4; attempt++) {
        const r = await ctx.bot.walkTo(x, z, tolerance, { timeout: 180_000 });
        if (r.success) return;
        ctx.log('walk retry', { x, z, attempt, detail: r.message });
        await ctx.sdk.waitForTicks(3);
    }
    throw new Error(`could not walk to ${x},${z}`);
}

/** Open the nearest bank (walking to `at` first if no booth or banker is near). */
export async function openBank(ctx: Pick<RoleContext, 'bot' | 'sdk' | 'log'>, at = VARROCK_WEST_BANK): Promise<void> {
    const { bot, sdk } = ctx;
    if (sdk.isBankOpen()) return;
    await dismissDialogs(bot, sdk);
    for (let attempt = 0; attempt < 4; attempt++) {
        if (!sdk.findNearbyLoc(/bank booth/i) && !sdk.findNearbyNpc(/banker/i)) await walkNear(ctx, at.x, at.z);
        const r = await bot.openBank();
        if (r.success && (await sdk.waitForCondition(s => s.bank.isOpen, 3_000).then(() => true, () => false))) return;
        ctx.log('openBank retry', { attempt, detail: r.message });
        await sdk.waitForTicks(2);
    }
    throw new Error('could not open a bank');
}

export async function closeBank(bot: BotActions, sdk: BotSDK): Promise<void> {
    if (!sdk.isBankOpen() && !sdk.getState()?.interface.isOpen) return;
    const r = await bot.closeBank();
    if (!r.success) throw new Error(`closeBank: ${r.message}`);
}

export function reportBank(ctx: Pick<RoleContext, 'sdk' | 'reportBank'>): void {
    ctx.reportBank({ items: ctx.sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count })) });
}

/** Deposit every inventory stack whose item is not kept (one Deposit-All per id, fired together). The bank must be open. */
export async function depositAllExcept(sdk: BotSDK, keep: (item: InventoryItem) => boolean): Promise<void> {
    for (let pass = 0; pass < 3; pass++) {
        const ids = [...new Set(sdk.getInventory().filter(i => !keep(i)).map(i => i.id))];
        if (ids.length === 0) return;
        await depositMatching(sdk, ids);
    }
    const left = sdk.getInventory().filter(i => !keep(i));
    if (left.length > 0) throw new Error(`could not deposit ${left.map(i => i.name).join(', ')}`);
}

/** Withdraw exactly `n` of an item (unnoted unless asNote); returns the amount that arrived. */
export async function withdraw(bot: BotActions, sdk: BotSDK, id: number, n: number, asNote = false): Promise<number> {
    const item = sdk.getBankItems().find(i => i.id === id);
    if (!item || n <= 0) return 0;
    const r = await bot.withdrawItem(item, Math.min(n, item.count), { asNote });
    return r.amountWithdrawn ?? 0;
}

/**
 * Log out through the logout button (a real logout: the next login runs the login
 * script, which re-arms fermentation). Closing the socket instead leaves the
 * account in-world for up to 500 ticks, and a quick reconnect resumes that session
 * without running the login script (World.ts processLogouts / reconnect path).
 * Scripts that own a speedrun/lib Session use its verified logoutClean instead.
 */
export async function logout(bot: BotActions, sdk: BotSDK): Promise<void> {
    await bot.dismissBlockingUI();
    if (sdk.getState()?.interface.isOpen) await bot.closeInterface();
    await sdk.sendClickComponent(LOGOUT_COMPONENT);
}

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
