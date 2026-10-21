// Interactions: one click (an NPC, a loc, an item, a ground item, a walk, a
// spell) and the wait for its effect, with the re-click a player makes when
// the first one is dropped.
//
// The server drops a click that arrives while a script holds the player (a
// p_delay, a forced move), and the lite client drops an interaction it
// believes has no route. Neither says so, so `act` re-sends while the player
// stands still with no dialogue open. It also re-sends on "I can't reach
// that!", which a door animation or an NPC in the way can cause.

import type { BotSDK } from '../../sdk/index';
import type { BotActions } from '../../sdk/actions';
import type { BotWorldState, GroundItem, NearbyLoc, NearbyNpc } from '../../sdk/types';
import { converse, type ConverseOptions, type ConverseResult, type ConverseSdk } from './converse';
import type { OptionPattern } from './dialogue';
import { matchesItem, type ItemPattern } from './items';
import { waitUntil, type Pred, type StateSource } from './wait';
import { chebyshev, findLoc, invCount, invItem, messagesSince, opIndex, pos, tileCounter, waitForNpc, worn, type LocQuery, type NamePattern, type OpPattern, type Tile } from './world';

export type ActSdk = StateSource &
    Pick<BotSDK, 'sendInteractNpc' | 'sendInteractLoc' | 'sendUseItem' | 'sendUseItemOnItem' | 'sendUseItemOnLoc' | 'sendUseItemOnNpc' | 'sendPickup' | 'sendWalk' | 'sendClickComponent' | 'sendDropItem' | 'scanNearbyLocs' | 'scanGroundItems'>;

export interface ActOptions {
    /** Give up after this many ticks (default 60). */
    maxTicks?: number;
    /** Re-send after the player has stood still this many ticks with no dialogue open (default 6; 0 never re-sends). */
    resendEvery?: number;
    /** At most this many re-sends (default 5). */
    maxResends?: number;
}

export interface ActResult {
    ok: boolean;
    /** Click to the first state where `done` held (or to the timeout). */
    ticks: number;
    resends: number;
    reason?: string;
}

const CANT_REACH = /can't reach that/i;

/** Send `click`, then wait for `done`, re-sending a click that was evidently dropped. */
export async function act(sdk: StateSource, click: () => Promise<unknown>, done: Pred, opts: ActOptions = {}): Promise<ActResult> {
    const t0 = sdk.getState()?.tick ?? 0;
    const every = opts.resendEvery ?? 6;
    const maxResends = opts.maxResends ?? 5;
    let resends = 0;
    let sent = t0;
    let still = t0;
    let last: Tile = pos(sdk);
    await click();
    const r = await waitUntil(
        sdk,
        s => {
            if (done(s)) return true;
            const p = pos(s);
            if (p.x !== last.x || p.z !== last.z || p.level !== last.level) still = s.tick;
            last = p;
            if (every <= 0 || resends >= maxResends || s.dialog.isOpen) return false;
            const refused = messagesSince(s, sent + 1, CANT_REACH).length > 0;
            if (refused || (s.tick - Math.max(sent, still) >= every)) {
                sent = s.tick;
                still = s.tick;
                resends++;
                void click();
            }
            return false;
        },
        { maxTicks: opts.maxTicks ?? 60 }
    );
    return { ok: r.ok, ticks: r.tick - t0, resends, ...(r.ok ? {} : { reason: 'timeout' }) };
}

export interface ActConverseOptions extends ActOptions, Omit<ConverseOptions, 'until' | 'openTicks'> {
    /** Required effect, latched the first time it holds, even while dialogue is open. */
    done?: Pred;
    /** Without a required effect, give up if no dialogue opens within this many ticks (default 30). */
    openTicks?: number;
}

export interface ActConverseResult extends ActResult {
    startTick: number;
    /** Later of the first effect and the final dialogue closing; on failure, the tick we stopped. */
    endTick: number;
    /** First tick done held, or -1 when absent or never observed. */
    effectTick: number;
    dialogue?: ConverseResult;
}

/**
 * Click and retry with act, then answer with converse. With done, both its
 * first observed effect and any dialogue must finish; without it, a dialogue
 * must open. Once either is seen the action is never re-sent.
 *
 * After an effect, allow idle ticks (default 3) for a delayed first page.
 * An already-true done still sends the click and waits this grace window.
 * Successful ticks exclude settling time. maxTicks (default 300) is shared
 * by the action and conversation, not restarted between them.
 */
export async function actConverse(sdk: ConverseSdk, click: () => Promise<unknown>, choices: OptionPattern[] = [], opts: ActConverseOptions = {}): Promise<ActConverseResult> {
    const startTick = sdk.getState()?.tick ?? 0;
    const maxTicks = opts.maxTicks ?? 300;
    const idle = opts.idle ?? 3;
    let effectTick = -1;
    const observe = (s: BotWorldState) => {
        if (effectTick < 0 && opts.done?.(s)) effectTick = s.tick;
    };
    const stop = sdk.onStateUpdate(observe);
    try {
        const cur = sdk.getState();
        if (cur) observe(cur);
        const a = await act(sdk, click, s => s.dialog.isOpen || effectTick >= 0, {
            ...opts,
            maxTicks: opts.done ? maxTicks : Math.min(opts.openTicks ?? 30, maxTicks),
        });
        if (!a.ok) {
            return { ...a, startTick, endTick: startTick + a.ticks, effectTick, reason: opts.done ? 'done never held' : 'no dialogue opened' };
        }
        const dialogue = await converse(sdk, choices, {
            ...opts,
            idle,
            openTicks: idle,
            until: opts.done ? () => effectTick >= 0 : undefined,
            maxTicks: Math.max(0, maxTicks - ((sdk.getState()?.tick ?? startTick) - startTick)),
        });
        // converse intentionally permits no dialogue, but a required effect
        // must not be mistaken for that successful no-op.
        const ok = dialogue.ok && (opts.done ? effectTick >= 0 : dialogue.opened);
        const endTick = ok
            ? Math.max(effectTick, dialogue.endTick)
            : (sdk.getState()?.tick ?? startTick);
        return {
            ok, ticks: endTick - startTick, resends: a.resends,
            startTick, endTick, effectTick, dialogue,
            ...(ok ? {} : { reason: !dialogue.ok ? dialogue.reason : opts.done ? 'done never held' : 'no dialogue opened' }),
        };
    } finally {
        stop();
    }
}

/** The inventory slot of the first item matching `item`; throws when there is none. */
export function slotOf(sdk: StateSource, item: ItemPattern): number {
    const it = invItem(sdk, item);
    if (!it) throw new Error(`no ${String(item)} in the inventory`);
    return it.slot;
}

/**
 * Interact with a loc: one found by `q` (or that loc itself), with the option
 * matching `op` (or that opIndex). Without `done` it only sends.
 */
export async function opLoc(sdk: ActSdk, q: LocQuery | NearbyLoc, op: OpPattern | number, done?: Pred, opts: ActOptions = {}): Promise<ActResult & { loc: NearbyLoc }> {
    const loc = 'optionsWithIndex' in q ? q : await findLoc(sdk, { ...q, ...(typeof op === 'number' ? {} : { op }) });
    if (!loc) throw new Error(`no loc ${JSON.stringify({ ...q, op: String(op) })} near ${JSON.stringify(pos(sdk))}`);
    const o = typeof op === 'number' ? op : opIndex(loc, op);
    if (o === undefined) throw new Error(`${loc.name} at ${loc.x},${loc.z} has no option ${op}: ${loc.options.join('/')}`);
    const click = () => sdk.sendInteractLoc(loc.x, loc.z, loc.id, o);
    if (!done) {
        await click();
        return { ok: true, ticks: 0, resends: 0, loc };
    }
    return { ...(await act(sdk, click, done, opts)), loc };
}

/** Open the closed door or gate at (x, z) and wait until no closed one is left there. A door that is already open is ok at 0 ticks. */
export async function openDoor(sdk: ActSdk, x: number, z: number, opts: ActOptions = {}): Promise<ActResult> {
    const closedHere = (l: NearbyLoc) => l.x === x && l.z === z && /door|gate/i.test(l.name) && opIndex(l, /^open$/i) !== undefined;
    const door = await findLoc(sdk, { x, z, op: /^open$/i, name: /door|gate/i });
    if (!door) return { ok: true, ticks: 0, resends: 0 };
    return act(sdk, () => sdk.sendInteractLoc(door.x, door.z, door.id, opIndex(door, /^open$/i)!), s => !s.nearbyLocs.some(closedHere), { resendEvery: 5, maxTicks: 30, ...opts });
}

export interface TalkOptions extends ConverseOptions {
    /** The NPC option that opens the conversation (default Talk-to). */
    op?: OpPattern;
    /** Ticks to wait for the NPC to come into view (default 10). */
    findTicks?: number;
    /** Sort candidates by distance to this tile. */
    near?: { x: number; z: number };
    /** Clicks to try when no dialogue opens (default 3). */
    attempts?: number;
}

/**
 * Talk to the nearest matching NPC and answer the conversation. A click that
 * opens nothing within `openTicks` is sent again, as a player would. The
 * result's ticks run from the first click.
 */
export async function talkTo(sdk: ActSdk & ConverseSdk, npc: NamePattern | NearbyNpc, choices: OptionPattern[] = [], opts: TalkOptions = {}): Promise<ConverseResult & { npc: NearbyNpc; clicks: number }> {
    const n = typeof npc === 'object' && 'index' in npc ? npc : await waitForNpc(sdk, npc, opts.findTicks ?? 10, opts.near);
    if (!n) throw new Error(`no npc ${String(npc)} near ${JSON.stringify(pos(sdk))}`);
    const op = opIndex(n, opts.op ?? /^talk-to$/i) ?? 1;
    const t0 = sdk.getState()?.tick ?? 0;
    const attempts = opts.attempts ?? 3;
    let remaining = choices;
    for (let clicks = 1; ; clicks++) {
        const conv = converse(sdk, remaining, opts);
        await sdk.sendInteractNpc(n.index, op);
        const r = await conv;
        if (r.opened || clicks >= attempts) {
            return { ...r, startTick: t0, ticks: r.opened ? r.endTick - t0 : 0, npc: n, clicks };
        }
        remaining = r.remaining;
    }
}

/** Use an inventory item's option (Wear, Rub, Read, Bury...), then wait for `done` if given. */
export async function invOp(sdk: ActSdk, item: ItemPattern, op: OpPattern, done?: Pred, opts: ActOptions = {}): Promise<ActResult> {
    const it = invItem(sdk, item);
    if (!it) throw new Error(`no ${String(item)} in the inventory`);
    const o = opIndex(it, op);
    if (o === undefined) throw new Error(`${it.name} has no option ${op}: ${it.optionsWithIndex.map(x => x.text).join('/')}`);
    const click = () => sdk.sendUseItem(invItem(sdk, item)?.slot ?? it.slot, o);
    if (!done) {
        await click();
        return { ok: true, ticks: 0, resends: 0 };
    }
    return act(sdk, click, done, { resendEvery: 3, maxTicks: 10, ...opts });
}

/** Wear or wield the first matching item, confirmed by the equipment list. */
export async function wield(sdk: ActSdk, item: ItemPattern, opts: ActOptions = {}): Promise<ActResult> {
    if (worn(sdk, item)) return { ok: true, ticks: 0, resends: 0 };
    return invOp(sdk, item, /^(wear|wield)$/i, s => worn(s, item) !== null, opts);
}

/** Pick up the nearest ground item matching `item` and wait until the inventory holds more of it. */
export async function pickup(sdk: ActSdk, item: ItemPattern, opts: ActOptions = {}): Promise<ActResult & { item: GroundItem }> {
    const near = (list: GroundItem[]) => list.filter(g => matchesItem(g, item)).sort((a, b) => a.distance - b.distance)[0];
    const g = near(sdk.getState()?.groundItems ?? []) ?? near(await sdk.scanGroundItems(25));
    if (!g) throw new Error(`no ground ${String(item)} near ${JSON.stringify(pos(sdk))}`);
    const before = invCount(sdk, item);
    const r = await act(sdk, () => sdk.sendPickup(g.x, g.z, g.id), s => invCount(s, item) > before, { resendEvery: 3, maxTicks: 40, ...opts });
    return { ...r, item: g };
}

/** Drop every inventory item `which` selects, fired at once, and wait until they are gone. */
export async function dropItems(sdk: ActSdk, which: (i: { id: number; name: string }) => boolean, maxTicks = 10): Promise<ActResult> {
    const items = (sdk.getState()?.inventory ?? []).filter(which);
    if (!items.length) return { ok: true, ticks: 0, resends: 0 };
    const gone = (s: BotWorldState) => !items.some(d => s.inventory.some(i => i.slot === d.slot && i.id === d.id));
    return act(sdk, () => Promise.all(items.map(i => sdk.sendDropItem(i.slot))), gone, { resendEvery: 0, maxTicks });
}

export interface WalkResult extends ActResult {
    tiles: number;
    at: Tile;
}

/**
 * Walk by clicking the destination tile (the client's own router), clicking
 * again when the player stops short. For areas the SDK's long-path map does
 * not cover (bridged floors), where `bot.walkTo` finds no waypoints.
 */
export async function clickWalk(sdk: ActSdk, x: number, z: number, opts: ActOptions & { tol?: number } = {}): Promise<WalkResult> {
    const tiles = tileCounter(sdk);
    const level = pos(sdk).level;
    const r = await act(sdk, () => sdk.sendWalk(x, z, true), s => pos(s).level === level && chebyshev(pos(s), { x, z }) <= (opts.tol ?? 0), { resendEvery: 3, maxTicks: 60, maxResends: 20, ...opts });
    tiles.stop();
    return { ...r, tiles: tiles.tiles, at: pos(sdk) };
}

/** Walk a list of waypoints with chained run clicks, each sent once the player is within 2 tiles of the previous one. */
export async function walkPath(sdk: ActSdk, path: ReadonlyArray<{ x: number; z: number }>, maxTicksPerLeg = 300): Promise<WalkResult> {
    const t0 = sdk.getState()?.tick ?? 0;
    const tiles = tileCounter(sdk);
    try {
        for (const [i, wp] of path.entries()) {
            await sdk.sendWalk(wp.x, wp.z, true);
            const exact = i === path.length - 1;
            const r = await waitUntil(sdk, s => chebyshev(pos(s), wp) <= (exact ? 0 : 2), { maxTicks: exact ? 6 + maxTicksPerLeg : maxTicksPerLeg });
            if (!r.ok && !exact) return { ok: false, ticks: r.tick - t0, resends: 0, tiles: tiles.tiles, at: pos(sdk), reason: `stuck before ${wp.x},${wp.z}` };
        }
        return { ok: true, ticks: (sdk.getState()?.tick ?? t0) - t0, resends: 0, tiles: tiles.tiles, at: pos(sdk) };
    } finally {
        tiles.stop();
    }
}

/**
 * `bot.walkTo` (the SDK pathfinder, doors opened on the way), retried when it
 * reports failure (it occasionally reports Stuck on open ground), with the
 * tiles actually stepped. It costs about 0.57 ticks per route tile against
 * 0.5 for chained clicks (docs/speedrun/quests/primitives.md).
 */
export async function walkTo(bot: Pick<BotActions, 'walkTo'>, sdk: StateSource, x: number, z: number, tol = 0, retries = 3): Promise<WalkResult & { message: string }> {
    const t0 = sdk.getState()?.tick ?? 0;
    const tiles = tileCounter(sdk);
    let r = await bot.walkTo(x, z, tol);
    for (let i = 0; i < retries && !r.success; i++) r = await bot.walkTo(x, z, tol);
    tiles.stop();
    return { ok: r.success, ticks: (sdk.getState()?.tick ?? t0) - t0, resends: 0, tiles: tiles.tiles, at: pos(sdk), message: r.message ?? '' };
}

/** Standard-spellbook teleports: the spell's IF_BUTTON component (server/content/pack/interface.pack). */
export const TELEPORTS = { varrock: 1164, lumbridge: 1167, falador: 1170, camelot: 1174, ardougne: 1540 } as const;

/** Cast a teleport and wait until the player has jumped more than 30 tiles; one re-cast if the first is dropped. */
export async function castTeleport(sdk: ActSdk, spell: keyof typeof TELEPORTS | number, maxTicks = 25): Promise<ActResult & { at: Tile }> {
    const p0 = pos(sdk);
    const component = typeof spell === 'number' ? spell : TELEPORTS[spell];
    const r = await act(sdk, () => sdk.sendClickComponent(component), s => chebyshev(pos(s), p0) > 30 || pos(s).level !== p0.level, { resendEvery: 10, maxResends: 1, maxTicks });
    return { ...r, at: pos(sdk) };
}
