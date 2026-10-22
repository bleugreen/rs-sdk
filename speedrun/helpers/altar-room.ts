// Where the in-room Runecraft hand-off happens and how a helper gets there:
// room geometry, the ruins and the portal, standing on a tile, and restocking
// essence and a talisman. Shared by altar-giver.ts and its stand-in receiver
// (altar-receiver.ts). Mechanics: docs/speedrun/skills/runecraft.md section 4.
import type { BotWorldState, InventoryItem, NearbyLoc } from '../../sdk/types';
import { ALTARS } from '../lib/runecraft';
import { withdrawMany } from '../lib/bank';
import { waitUntil } from '../lib/wait';
import { closeBank, depositAllExcept, openBank, walkNear } from './mule';
import type { RoleContext } from './role';
import { acceptSupplies } from './wine';

export type AltarName = 'air' | 'body' | 'nature';
export interface Tile {
    x: number;
    z: number;
}

/** The altars on the route: air 1-44, then nature 44-99 or body 20-99 (every talisman is tradeable). */
export const ROUTE_ALTARS: Record<AltarName, { talisman: RegExp; talismanObj: string; bank: Tile | null }> = {
    // Falador east bank: the nearest bank to the air ruins (2984,3291), ~70 tiles.
    air: { talisman: /^air talisman$/i, talismanObj: 'air_talisman', bank: { x: 3013, z: 3357 } },
    // Edgeville bank: the nearest bank to the body ruins (3053,3445), ~50 tiles.
    body: { talisman: /^body talisman$/i, talismanObj: 'body_talisman', bank: { x: 3094, z: 3491 } },
    // No usable bank near the Karamja ruins without Shilo Village: restock by trade.
    nature: { talisman: /^nature talisman$/i, talismanObj: 'nature_talisman', bank: null }
};

export const ESSENCE = /^rune essence$/i;

export function altarData(name: string) {
    const a = ALTARS[name];
    const r = ROUTE_ALTARS[name as AltarName];
    if (!a || !r) throw new Error(`altar must be one of ${Object.keys(ROUTE_ALTARS).join(', ')} (got ${name})`);
    return { name: name as AltarName, ...a, ...r };
}
export type Altar = ReturnType<typeof altarData>;

/**
 * Tiles around a 3x3 altar whose south-west corner is (ax, az). The scored
 * account stands south of its middle (runecraft.md section 2). Givers stand
 * on the three free tiles orthogonally next to it: east (the measured one),
 * west and south. A player interaction from the same tile, or from a diagonal
 * one, makes the requester step first, which the blind schedule cannot afford.
 */
export function roomTiles(altar: Tile): { receiver: Tile; givers: Tile[] } {
    const receiver = { x: altar.x + 1, z: altar.z - 1 };
    return {
        receiver,
        givers: [
            { x: receiver.x + 1, z: receiver.z },
            { x: receiver.x - 1, z: receiver.z },
            { x: receiver.x, z: receiver.z - 1 }
        ]
    };
}

export function pos(s: BotWorldState | null | undefined) {
    const p = s?.player;
    return { x: p?.worldX ?? -1, z: p?.worldZ ?? -1, level: p?.level ?? -1 };
}

export function inRoom(s: BotWorldState | null | undefined, altar: Altar): boolean {
    const p = pos(s);
    return p.level === altar.enter.level && Math.max(Math.abs(p.x - altar.enter.x), Math.abs(p.z - altar.enter.z)) <= 24;
}

export function isLocalServer(server = process.env.SERVER ?? ''): boolean {
    return /^(localhost|127\.)/.test(server);
}

/**
 * Notes of rune essence and the route's talismans (server/content/pack/obj.pack: each
 * cert id is the item's id + 1). A note has the item's name, so a name match alone
 * takes a stack of 200 noted essence from a supply trade for a full load, and the
 * giver walks into the room with nothing it can hand over.
 */
export const NOTE_IDS: ReadonlySet<number> = new Set([1437 /* cert_blankrune */, 1439 /* cert_air_talisman */, 1447 /* cert_body_talisman */, 1463 /* cert_nature_talisman */]);

const real = (i: InventoryItem, re: RegExp) => re.test(i.name) && !NOTE_IDS.has(i.id);

/** How many of the item are carried as the item itself (notes don't count). */
export function count(s: BotWorldState | null | undefined, re: RegExp): number {
    return (s?.inventory ?? []).filter(i => real(i, re)).reduce((n, i) => n + i.count, 0);
}

/** The first carried slot holding the item itself (never a note). */
export function findItem(s: BotWorldState | null | undefined, re: RegExp): InventoryItem | undefined {
    return s?.inventory.find(i => real(i, re));
}

/** Every carried slot holding the item itself (never a note), in slot order. */
export function carriedSlots(s: BotWorldState | null | undefined, re: RegExp): InventoryItem[] {
    return (s?.inventory ?? []).filter(i => real(i, re)).sort((a, b) => a.slot - b.slot);
}

/**
 * Resolve true on the first state for which `pred` holds, or false once
 * 2 x (`ticks` + 5) ticks pass (the budget this wait had at a 300 ms tick when
 * it was wall-clock bounded) or the client stops publishing.
 */
export async function until(ctx: Pick<RoleContext, 'sdk'>, pred: (s: BotWorldState) => boolean, ticks: number): Promise<boolean> {
    return (await waitUntil(ctx.sdk, pred, { maxTicks: 2 * (ticks + 5) })).ok;
}

function nearestLoc(ctx: Pick<RoleContext, 'sdk'>, re: RegExp): NearbyLoc | undefined {
    return ctx.sdk
        .getNearbyLocs()
        .filter(l => re.test(l.name))
        .sort((a, b) => a.distance - b.distance)[0];
}

/** The altar loc, visible from anywhere in its room. */
export function findAltar(ctx: Pick<RoleContext, 'sdk'>): NearbyLoc | undefined {
    return nearestLoc(ctx, /^altar$/i);
}

/** Walk to the ruins and use the talisman on them (runecraft.rs2: p_delay(1), then the teleport). */
export async function enterRoom(ctx: RoleContext, altar: Altar): Promise<void> {
    if (inRoom(ctx.sdk.getState(), altar)) return;
    // Lab: skip a fresh account's walk from its spawn, not the bank-to-ruins one.
    if (process.env.HELPER_LAB_TELE === '1' && chebyshev(pos(ctx.sdk.getState()), altar.ruins) > 150) await labTele(ctx, altar.exit);
    if (!(await walkNear(ctx, altar.ruins.x, altar.ruins.z, 5))) throw new Error('could not reach the ruins');
    for (let attempt = 0; attempt < 4 && !ctx.signal.aborted; attempt++) {
        const ruins = nearestLoc(ctx, /mysterious ruins/i);
        const talisman = findItem(ctx.sdk.getState(), altar.talisman);
        if (!ruins) throw new Error('no ruins in sight');
        if (!talisman) throw new Error('no talisman to enter with');
        await ctx.sdk.sendUseItemOnLoc(talisman.slot, ruins.x, ruins.z, ruins.id);
        if (await until(ctx, s => inRoom(s, altar), 20)) return;
        ctx.log('ruins did not take us in; retrying', { attempt });
    }
    throw new Error('could not enter the altar room');
}

/** Leave by the exit portal (a teleport with no delay). */
export async function leaveRoom(ctx: RoleContext, altar: Altar): Promise<void> {
    for (let attempt = 0; attempt < 4 && inRoom(ctx.sdk.getState(), altar) && !ctx.signal.aborted; attempt++) {
        const portal = nearestLoc(ctx, /^portal$/i);
        if (!portal) throw new Error('no exit portal in sight');
        await ctx.sdk.sendInteractLoc(portal.x, portal.z, portal.id, 1);
        await until(ctx, s => !inRoom(s, altar), 20);
    }
    if (inRoom(ctx.sdk.getState(), altar)) throw new Error('could not leave the altar room');
}

/** Step onto an exact tile in the room. */
export async function standOn(ctx: RoleContext, tile: Tile): Promise<void> {
    const at = (s: BotWorldState | null | undefined) => pos(s).x === tile.x && pos(s).z === tile.z;
    for (let attempt = 0; attempt < 5 && !at(ctx.sdk.getState()) && !ctx.signal.aborted; attempt++) {
        await ctx.sdk.sendWalk(tile.x, tile.z);
        await until(ctx, at, 12);
    }
    if (!at(ctx.sdk.getState())) throw new Error(`could not stand on ${tile.x},${tile.z}`);
}

export type RestockKind = 'bank' | 'trade' | 'cheat';

export interface RestockOptions {
    kind: RestockKind;
    /** Essence to carry (27 beside the talisman). */
    essence: number;
    /** bank: where to bank (default: the altar's nearest bank). */
    bank?: Tile | null;
    /** Account-name RegExp source of supply traders (a courier or the mule); accepted at the bank when it runs short, or at `restockAt` for kind trade. */
    acceptFrom?: string;
    /** trade: where to wait for the supply trade (default: just outside the ruins). */
    restockAt?: Tile;
    /** Local lab only: create missing essence and talismans with staff commands instead of waiting for supplies. */
    labStock?: boolean;
}

/** A staff command; refused anywhere but the local lab. */
export async function cheat(ctx: Pick<RoleContext, 'sdk'>, cmd: string): Promise<void> {
    if (!isLocalServer()) throw new Error('staff commands are for the local lab only');
    await ctx.sdk.sendSay(`::${cmd}`);
}

export function chebyshev(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

/**
 * Lab only: teleport onto `to`. Helpers do it (with HELPER_LAB_TELE=1) to skip a
 * fresh lab account's walk from its spawn, so a lab run measures their own legs.
 */
export async function labTele(ctx: Pick<RoleContext, 'sdk'>, to: Tile & { level?: number }): Promise<void> {
    const { x, z } = to;
    await cheat(ctx, `tele ${to.level ?? 0},${x >> 6},${z >> 6},${x & 63},${z & 63}`);
    await until(ctx, s => pos(s).x === x && pos(s).z === z, 10);
}

/** Make sure exactly the talisman and `essence` rune essence are carried, by the configured route. Leaves the room first if needed. */
export async function restock(ctx: RoleContext, altar: Altar, o: RestockOptions, phase: (detail: string) => void): Promise<void> {
    const s = () => ctx.sdk.getState();
    const loaded = () => count(s(), ESSENCE) >= o.essence && count(s(), altar.talisman) >= 1;
    if (loaded()) return;

    if (o.kind === 'cheat') {
        // Carry nothing else (a fresh account holds its starter kit): clear, then the talisman and the essence.
        const stray = (s()?.inventory ?? []).some(i => !ESSENCE.test(i.name) && !altar.talisman.test(i.name));
        if (stray) {
            await cheat(ctx, '~clearinv inv');
            await until(ctx, st => st.inventory.length === 0, 10);
        }
        if (count(s(), altar.talisman) < 1) await cheat(ctx, `give ${altar.talismanObj} 1`);
        const missing = o.essence - count(s(), ESSENCE);
        if (missing > 0) await cheat(ctx, `give blankrune ${missing}`);
        if (!(await until(ctx, loaded, 10))) throw new Error('staff give did not arrive');
        return;
    }

    await leaveRoom(ctx, altar);
    if (o.kind === 'trade') {
        if (!o.acceptFrom) throw new Error('restock kind trade needs acceptFrom');
        const at = o.restockAt ?? altar.exit;
        await walkNear(ctx, at.x, at.z, 3);
        while (!loaded() && !ctx.signal.aborted) {
            phase(`waiting at ${at.x},${at.z} for a supply trade`);
            await acceptSupplies(ctx, new RegExp(o.acceptFrom, 'i'), 60_000);
        }
        return;
    }

    const bank = o.bank ?? altar.bank;
    if (!bank) throw new Error(`no bank configured for the ${altar.name} altar; set restock.bank or use restock kind trade`);
    while (!loaded() && !ctx.signal.aborted) {
        phase(`banking at ${bank.x},${bank.z}`);
        if (!(await walkNear(ctx, bank.x, bank.z, 3))) throw new Error('could not reach the bank');
        if (!(await openBank(ctx))) throw new Error('could not open the bank');
        // Keep one talisman; everything else (runes, notes, spare talismans) goes in. Notes come back out unnoted.
        const talisman = findItem(s(), altar.talisman);
        await depositAllExcept(ctx.sdk, talisman ? new Map([[talisman.id, 1]]) : new Map());
        const bankHas = (re: RegExp) => ctx.sdk.getBankItems().filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
        const specs = [];
        if (count(s(), altar.talisman) < 1 && bankHas(altar.talisman) > 0) specs.push({ item: altar.talisman, n: 1 });
        const want = o.essence - count(s(), ESSENCE);
        if (want > 0 && bankHas(ESSENCE) >= want) specs.push({ item: ESSENCE, n: want });
        if (specs.length) {
            const w = await withdrawMany(ctx.sdk, specs);
            if (!w.ok) ctx.log('withdraw incomplete', { reason: w.reason });
        }
        ctx.reportBank({ items: ctx.sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count })) });
        await closeBank(ctx);
        if (loaded()) break;

        const short = { essence: o.essence - count(s(), ESSENCE), talisman: count(s(), altar.talisman) < 1 };
        if (o.labStock && isLocalServer()) {
            if (short.talisman) await cheat(ctx, `give ${altar.talismanObj} 1`);
            if (short.essence > 0) await cheat(ctx, `give blankrune ${short.essence}`);
            await until(ctx, loaded, 10);
        } else if (o.acceptFrom) {
            phase(`bank short (${JSON.stringify(short)}); waiting for a supply trade`);
            await acceptSupplies(ctx, new RegExp(o.acceptFrom, 'i'), 60_000);
        } else {
            phase(`bank short (${JSON.stringify(short)}); nothing to wait for, retrying in a minute`);
            await ctx.sdk.waitForTicks(200).catch(() => {});
        }
    }
}
