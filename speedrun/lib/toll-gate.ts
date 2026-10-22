// The Al-Kharid toll gate: the only way across the fence between Lumbridge and
// Al-Kharid short of the Prince Ali Rescue quest.
//
// bot.walkTo treats the gate as a door it can open, so a walk whose path runs
// through it ends in `cant_reach` retries at (3268,3227-3228) forever: the gate
// opens only through the border guard's dialogue. Any role that travels
// between the two sides should check `isEastOfTollGate` for its destination
// and cross with `crossTollGate` first.
//
// The dialogue (server/content/scripts/areas/area_alkharid/scripts/border_gate.rs2):
// "Can I come through this gate?" / "You must pay a toll of 10 gold coins to
// pass." / choice ("No thank you, I'll walk around.", "Who does my money go
// to?", "Yes, ok."), then either "Oh dear, I don't actually seem to have
// enough money." or "You pay the guard." and a forced walk through the gate.
// Clicking the gate starts that dialogue only when a border guard on the
// player's side stands within 1 tile of the player, and the guards wander, so
// the crossing talks to the guard itself and uses the gate only when no guard
// is in view. Talking to either guard works from anywhere on its side.
//
// `travelTo` is the walk for roles that may start on either side: it crosses
// first when the destination is across the fence, and reports failure instead
// of stalling, so a caller can refuse to open whatever bank happens to be near.
// Started underground with a surface destination, it climbs out first
// (underground.ts: the Dwarven Mine and the Mining Guild cellar).

import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, NearbyNpc } from '../../sdk/types';
import { dialogText } from './dialogue';
import { climbToSurface, isUnderground } from './underground';
import { waitTicks, type StateSource } from './wait';

export interface Tile {
    x: number;
    z: number;
}

export const TOLL_GP = 10;
/** The gate stands on the edge between these two tiles. */
export const TOLL_WEST: Tile = { x: 3267, z: 3227 };
export const TOLL_EAST: Tile = { x: 3268, z: 3227 };

/** East of the toll gate fence and south of the Lumbridge-Varrock road. */
export const isEastOfTollGate = (t: Tile): boolean => t.x >= TOLL_EAST.x && t.z < 3240 && t.z > 3100;

export const inAlKharid = (s: BotWorldState): boolean => isEastOfTollGate({ x: s.player!.worldX, z: s.player!.worldZ });

const chebyshev = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/**
 * A step west, clear of the toll gate. From the gate's west side the SDK
 * pathfinder (which takes the gate for a door) routes some west-side
 * destinations, the Varrock east bank among them, back through Al Kharid and
 * sticks at the gate; from here none of the fleet's banks or shops do
 * (sdk/pathfinding.ts findLongPath).
 */
export const WEST_OF_GATE: Tile = { x: 3255, z: 3228 };
export const besideGateWest = (t: Tile): boolean => !isEastOfTollGate(t) && chebyshev(t, TOLL_WEST) <= 6;

const coinsIn = (s: BotWorldState) => s.inventory.filter(i => i.name === 'Coins').reduce((a, i) => a + i.count, 0);
const NOT_ENOUGH = /enough money/i;

export type TollGateSdk = StateSource & Pick<BotSDK, 'sendInteractNpc' | 'sendInteractLoc' | 'sendClickDialog'>;
export type TollGateBot = Pick<BotActions, 'walkTo'>;

export interface TollGateResult {
    /** The player ended on the requested side. */
    ok: boolean;
    /** Coins it cost (0 when already there or refused). */
    paid: number;
    /** Why it failed: 'no toll' (fewer than 10 gp), 'no guard or gate', 'not across'. */
    reason?: string;
}

/** The border guard to talk to: the nearest one on the player's side of the fence. */
export function pickBorderGuard(npcs: NearbyNpc[], fromEast: boolean): NearbyNpc | undefined {
    return npcs
        .filter(n => /^border guard$/i.test(n.name) && (n.tileX ?? n.x) >= TOLL_EAST.x === fromEast)
        .filter(n => n.optionsWithIndex.some(o => /^talk/i.test(o.text)))
        .sort((a, b) => a.distance - b.distance)[0];
}

/**
 * Cross the toll gate toward `toEast`, paying 10 gp. Refuses up front when the
 * player carries fewer than 10 coins (the guard would only say so). Answers
 * the dialogue with "Yes, ok." and confirms on the player's side, not on the
 * click. Up to 3 attempts.
 */
export async function crossTollGate(
    bot: TollGateBot,
    sdk: TollGateSdk,
    toEast: boolean,
    log: (m: string, d?: Record<string, unknown>) => void = () => {}
): Promise<TollGateResult> {
    const onTargetSide = () => inAlKharid(sdk.getState()!) === toEast;
    const before = coinsIn(sdk.getState()!);
    const finish = (r: TollGateResult): TollGateResult => {
        const s = sdk.getState()!;
        log('toll gate', { toEast, ...r, coins: coinsIn(s), x: s.player!.worldX, z: s.player!.worldZ });
        return r;
    };
    if (onTargetSide()) return { ok: true, paid: 0 };
    if (before < TOLL_GP) return finish({ ok: false, paid: 0, reason: 'no toll' });

    const approach = toEast ? TOLL_WEST : TOLL_EAST;
    let reason = 'not across';
    for (let attempt = 0; attempt < 3 && !onTargetSide(); attempt++) {
        const p = sdk.getState()!.player!;
        if (Math.max(Math.abs(p.worldX - approach.x), Math.abs(p.worldZ - approach.z)) > 3) await bot.walkTo(approach.x, approach.z, 2);
        const s = sdk.getState()!;
        const guard = pickBorderGuard(s.nearbyNpcs, !toEast);
        const talk = guard?.optionsWithIndex.find(o => /^talk/i.test(o.text));
        if (guard && talk) {
            await sdk.sendInteractNpc(guard.index, talk.opIndex);
        } else {
            const gate = s.nearbyLocs
                .filter(l => /gate/i.test(l.name) && l.x >= TOLL_WEST.x && l.x <= TOLL_EAST.x && l.z >= 3226 && l.z <= 3228)
                .sort((a, b) => a.distance - b.distance)[0];
            const op = gate?.optionsWithIndex.find(o => /pay|open/i.test(o.text)) ?? gate?.optionsWithIndex[0];
            if (!gate || !op) {
                reason = 'no guard or gate';
                log('toll gate: no border guard or gate in view', { attempt });
                await waitTicks(sdk, 3);
                continue;
            }
            await sdk.sendInteractLoc(gate.x, gate.z, gate.id, op.opIndex);
        }
        const outcome = await answerGuard(sdk, onTargetSide);
        if (outcome === 'broke') return finish({ ok: false, paid: 0, reason: 'no toll' });
    }
    await closeDialog(sdk);
    const paid = Math.max(0, before - coinsIn(sdk.getState()!));
    return finish(onTargetSide() ? { ok: true, paid } : { ok: false, paid, reason });
}

/** Click through the guard's pages until the player is across, refused, or 40 ticks pass. */
async function answerGuard(sdk: TollGateSdk, across: () => boolean): Promise<'across' | 'broke' | 'timeout'> {
    for (let i = 0; i < 40; i++) {
        if (across()) return 'across';
        const s = await waitTicks(sdk, 1);
        if (!s.dialog.isOpen || s.dialog.isWaiting) continue;
        if (NOT_ENOUGH.test(dialogText(s)) || NOT_ENOUGH.test(s.dialog.text ?? '')) {
            await closeDialog(sdk);
            return 'broke';
        }
        const yes = s.dialog.options.find(o => /^yes/i.test(o.text));
        await sdk.sendClickDialog(yes ? yes.index : 0);
    }
    return across() ? 'across' : 'timeout';
}

async function closeDialog(sdk: TollGateSdk): Promise<void> {
    for (let i = 0; i < 10 && sdk.getState()!.dialog.isOpen; i++) {
        await sdk.sendClickDialog(0);
        await waitTicks(sdk, 1);
    }
}

export interface TravelResult {
    /** The player stands within the tolerance of the destination. */
    ok: boolean;
    /** Toll paid on the way. */
    paid: number;
    /** Why it failed: 'toll gate: <crossTollGate reason>', 'underground: <climbToSurface reason>', 'cant reach', 'aborted', 'no player state'. */
    reason?: string;
}

export interface TravelOptions {
    tolerance?: number;
    /** walkTo calls toward the destination before giving up. */
    attempts?: number;
    log?: (m: string, d?: Record<string, unknown>) => void;
    signal?: AbortSignal;
}

/**
 * Walk to within `tolerance` of `to` (Chebyshev): first out of the underground
 * when the player is below ground and `to` is not, then across the toll gate
 * when `to` is on the other side of the fence, then clear of the gate on the
 * west side. Never asks walkTo for a destination across the fence or on another
 * map. Success is read from where the player stands, not from walkTo's answer.
 */
export async function travelTo(bot: TollGateBot, sdk: TollGateSdk, to: Tile, opts: TravelOptions = {}): Promise<TravelResult> {
    const tolerance = opts.tolerance ?? 3;
    const log = opts.log ?? (() => {});
    const here = (): Tile | null => {
        const p = sdk.getState()?.player;
        return p ? { x: p.worldX, z: p.worldZ } : null;
    };
    let start = here();
    if (!start) return { ok: false, paid: 0, reason: 'no player state' };
    if (chebyshev(start, to) <= tolerance) return { ok: true, paid: 0 };

    if (isUnderground(start) && !isUnderground(to)) {
        if (opts.signal?.aborted) return { ok: false, paid: 0, reason: 'aborted' };
        const r = await climbToSurface(bot, sdk, { log, signal: opts.signal });
        if (!r.ok) return { ok: false, paid: 0, reason: r.reason };
        start = here()!;
    }

    let paid = 0;
    const toEast = isEastOfTollGate(to);
    if (isEastOfTollGate(start) !== toEast) {
        if (opts.signal?.aborted) return { ok: false, paid, reason: 'aborted' };
        const r = await crossTollGate(bot, sdk, toEast, log);
        paid = r.paid;
        if (!r.ok) return { ok: false, paid, reason: `toll gate: ${r.reason}` };
    }

    const walk = async (t: Tile, tol: number): Promise<boolean> => {
        for (let attempt = 0; attempt < (opts.attempts ?? 5); attempt++) {
            const p = here();
            if (!p || chebyshev(p, t) <= tol) break;
            if (opts.signal?.aborted) return false;
            log('walking', { from: [p.x, p.z], to: [t.x, t.z] });
            const r = await bot.walkTo(t.x, t.z, tol);
            if (!r.success) log('walk failed', { x: t.x, z: t.z, result: r.message });
        }
        const p = here();
        return p !== null && chebyshev(p, t) <= tol;
    };

    const p = here()!;
    if (besideGateWest(p) && !toEast && !besideGateWest(to)) await walk(WEST_OF_GATE, 2);
    if (await walk(to, tolerance)) return { ok: true, paid };
    return { ok: false, paid, reason: opts.signal?.aborted ? 'aborted' : 'cant reach' };
}
