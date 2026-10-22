// The dwarf multicannon: set-up, per-tick top-ups and pick-up, for any account
// that has completed Dwarf Cannon (the scored account's S14 and S27, the cannon
// holder helper, the Dwarf Cannon quest module's own check).
//
// Content rules this file relies on (server/content/scripts/quests/quest_mcannon/scripts/):
// - Set-up (cannon_setup.rs2): the base's Set-up op walks the player one tile
//   aside and places the 3x3 base with its south-west tile at the loc's origin.
//   The stand, barrels and furnace then go on one at a time by use-on-loc. A
//   refusal (no space, a bank, a second cannon) is a message and places nothing.
// - Firing (cannon_fire.rs2): Fire starts a 1-tick rotation timer, one shot per
//   tick at most, 30 balls per load and one per shot. At 0 the timer stops on
//   the next north step ("Your cannon is out of ammo!") and needs a load *and*
//   a new Fire.
// - Every cannon click is an interaction. One sent in the same tick as an
//   attack (or another loc click) replaces it or is replaced, so callers send at
//   most one interaction per tick, and a reload from away from the cannon is a
//   walk that the next attack cancels.
// - Decay: 2,500 ticks after the last part went on (cannon.constant); the
//   cannon_decay timer then says "Your cannon has decayed!" and only Nulodion
//   can replace it for its owner.
// - Pick-up needs 4 free slots and returns the unfired balls.

import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { INVENTORY_SIZE } from './items';
import { waitUntil, type StateSource } from './wait';
import { chebyshev, invCount, invItem, opIndex, pos } from './world';

export type CannonSdk = StateSource & Pick<BotSDK, 'sendUseItem' | 'sendUseItemOnLoc' | 'sendInteractLoc' | 'sendWalk'>;

/** The four parts in assembly order (quest_mcannon.obj twpart1-4). */
export const CANNON_PARTS = ['Cannon base', 'Cannon stand', 'Cannon barrels', 'Cannon furnace'] as const;
/** Debug names of the parts, for `::give` and hand-off packages. */
export const CANNON_PART_OBJS = ['twpart1', 'twpart2', 'twpart3', 'twpart4'] as const;
export const CANNONBALL = /^cannonballs?$/i;
export const CANNONBALL_OBJ = 'mcannonball';
/** The assembled cannon (dwarf_multicannon1: Fire, Pick-up). */
export const CANNON_LOC = /^dwarf multicannon$/i;
/** A placed cannon at any stage of assembly. */
export const PLACED_LOC = /^(cannon base|cannon stand|dwarf multicannon)$/i;

export const BALLS_PER_LOAD = 30;
/** Top-up interval the measurements used (no dry tick in any 300 ms run, ranged.md section 4). */
export const RELOAD_EVERY = 20;
export const DECAY_TICKS = 2500;
export const PICKUP_FREE_SLOTS = 4;

export const CANNON_MSG = {
    outOfAmmo: /cannon is out of ammo/i,
    loaded: /you load the cannon with (\d+)/i,
    full: /already full of ammo/i,
    firing: /already firing/i,
    decayed: /cannon has decayed/i,
    destroyed: /cannon has been destroyed/i,
    placed: /place the cannon base/i,
    refused: /isn't enough space|can't set up|won't be happy|not permitted|too dank|more than one cannon|complete the dwarf cannon/i,
    pickupSlots: /free inventory spaces? to pick/i,
} as const;

const partRe = (name: string) => new RegExp(`^${name}$`, 'i');

/** How many of the four parts the inventory holds. */
export function partsHeld(s: BotWorldState | null | undefined): number {
    return CANNON_PARTS.filter(p => invCount(s, partRe(p)) > 0).length;
}

export function hasCannonSet(s: BotWorldState | null | undefined): boolean {
    return partsHeld(s) === CANNON_PARTS.length;
}

export function ballsHeld(s: BotWorldState | null | undefined): number {
    return invCount(s, CANNONBALL);
}

export function freeSlots(s: BotWorldState | null | undefined): number {
    return INVENTORY_SIZE - (s?.inventory.length ?? 0);
}

const nearestLoc = (s: BotWorldState | null | undefined, re: RegExp) =>
    (s?.nearbyLocs ?? []).filter(l => re.test(l.name) && opIndex(l, /^pick-up$/i) !== undefined).sort((a, b) => a.distance - b.distance)[0] ?? null;

/** The nearest assembled cannon in view (only the owner's has the ops that matter, but the name is all a state shows). */
export function assembledCannon(s: BotWorldState | null | undefined): NearbyLoc | null {
    return nearestLoc(s, CANNON_LOC);
}

/** The nearest placed cannon at any stage. */
export function placedCannon(s: BotWorldState | null | undefined): NearbyLoc | null {
    return nearestLoc(s, PLACED_LOC);
}

/** The cannon's centre tile: the loc is addressed by its south-west tile (cannon_fire.rs2 movecoord(loc_coord, 1, 0, 1)). */
export function cannonCentre(loc: { x: number; z: number }): { x: number; z: number } {
    return { x: loc.x + 1, z: loc.z + 1 };
}

/** On the ring around the 3x3, where a use-on-loc lands without a walk. */
export function besideCannon(s: BotWorldState | null | undefined, loc: { x: number; z: number }): boolean {
    const p = pos(s);
    return p.x >= 0 && chebyshev(p, cannonCentre(loc)) <= 2;
}

/** Candidate set-up tiles: `at` first, then rings out to `radius` (the lab scripts' order). */
export function setupTiles(at: { x: number; z: number }, radius = 2): { x: number; z: number }[] {
    const out = [{ x: at.x, z: at.z }];
    for (let r = 1; r <= radius; r++) {
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r) out.push({ x: at.x + dx, z: at.z + dz });
    }
    return out;
}

/**
 * Game messages not yet returned by this cursor. A state carries a rolling window
 * of recent messages and is republished within a tick, so messages are keyed on
 * their tick, text and observation id rather than read by tick alone.
 */
export class MessageCursor {
    private seen = new Map<string, number>();

    constructor(s?: BotWorldState | null) {
        if (s) this.next(s);
    }

    next(s: BotWorldState): string[] {
        const out: string[] = [];
        for (const m of s.gameMessages ?? []) {
            if (m.type !== 0) continue;
            const k = `${m.observationId ?? ''}|${m.tick}|${m.text}`;
            if (this.seen.has(k)) continue;
            this.seen.set(k, m.tick);
            out.push(m.text);
        }
        if (this.seen.size > 400) for (const [k, t] of this.seen) if (t < s.tick - 100) this.seen.delete(k);
        return out;
    }
}

export interface SetUpOptions {
    /** Tiles to try the base on, in order (default: the player's tile and the rings around it). */
    tiles?: ReadonlyArray<{ x: number; z: number }>;
    /** Load and Fire once assembled (default true). */
    fire?: boolean;
    /** Give up after this many ticks in all (default 60). */
    maxTicks?: number;
}

export interface SetUpResult {
    ok: boolean;
    /** Call to the Fire click (or to the load / the last part when `fire` is false). */
    ticks: number;
    cannon: NearbyLoc | null;
    /** Tick the last part went on: the decay clock's start. */
    assembledTick: number;
    /** Base placements refused before one fitted. */
    refused: number;
    reason?: string;
}

/**
 * Place, assemble, load and fire the cannon from the inventory, or finish one
 * already part-built here (a restart mid set-up). Each part is one
 * use-on-loc, sent the tick the previous part shows as gone (rs/31: raw packets
 * on consecutive ticks take 9-10 ticks from the base click to Fire, against 23
 * through the stock helper).
 */
export async function setUpCannon(sdk: CannonSdk, opts: SetUpOptions = {}): Promise<SetUpResult> {
    const s0 = sdk.getState();
    if (!s0?.player) throw new Error('setUpCannon: no state');
    const t0 = s0.tick;
    const deadline = t0 + (opts.maxTicks ?? 60);
    const chat = new MessageCursor(s0);
    let refused = 0;
    let assembledTick = -1;
    const fail = (reason: string, s: BotWorldState | null = sdk.getState()): SetUpResult => ({
        ok: false, ticks: (s?.tick ?? t0) - t0, cannon: assembledCannon(s), assembledTick, refused, reason,
    });
    const left = () => Math.max(1, deadline - (sdk.getState()?.tick ?? t0));

    // 1. The base.
    if (!placedCannon(sdk.getState())) {
        if (invCount(sdk, partRe(CANNON_PARTS[0])) === 0) return fail('no cannon base in the inventory and none placed here');
        const tiles = opts.tiles ?? setupTiles(pos(sdk));
        let placed = false;
        for (const tile of tiles) {
            const here = pos(sdk);
            if (here.x !== tile.x || here.z !== tile.z) {
                void sdk.sendWalk(tile.x, tile.z, true);
                const w = await waitUntil(sdk, s => pos(s).x === tile.x && pos(s).z === tile.z, { maxTicks: Math.min(left(), 12) });
                if (!w.ok) continue;
            }
            const base = invItem(sdk, partRe(CANNON_PARTS[0]))!;
            void sdk.sendUseItem(base.slot, opIndex(base, /^set-up$/i) ?? 1);
            let refusedHere = false;
            const r = await waitUntil(
                sdk,
                s => {
                    if (chat.next(s).some(m => CANNON_MSG.refused.test(m))) refusedHere = true;
                    return refusedHere || invCount(s, partRe(CANNON_PARTS[0])) === 0;
                },
                { maxTicks: Math.min(left(), 8) },
            );
            if (r.ok && !refusedHere) {
                placed = true;
                break;
            }
            refused++;
            if (r.state && /more than one cannon|complete the dwarf cannon/i.test((r.state.gameMessages ?? []).map(m => m.text).join('\n'))) {
                return fail('the game refuses a cannon for this account (a cannon already owned, or Dwarf Cannon not complete)', r.state);
            }
        }
        if (!placed) return fail(`no tile fitted the cannon (${refused} refused)`);
    }

    // 2. Stand, barrels, furnace: whichever the inventory still holds, in order.
    for (const part of CANNON_PARTS.slice(1)) {
        if (invCount(sdk, partRe(part)) === 0) continue;
        const w = await waitUntil(sdk, s => placedCannon(s) !== null, { maxTicks: Math.min(left(), 6) });
        if (!w.ok) return fail(`no placed cannon in view to add the ${part.toLowerCase()} to`);
        for (let attempt = 0; attempt < 3 && invCount(sdk, partRe(part)) > 0; attempt++) {
            const loc = placedCannon(sdk.getState())!;
            void sdk.sendUseItemOnLoc(invItem(sdk, partRe(part))!.slot, loc.x, loc.z, loc.id);
            await waitUntil(sdk, s => invCount(s, partRe(part)) === 0, { maxTicks: Math.min(left(), 5) });
        }
        if (invCount(sdk, partRe(part)) > 0) return fail(`the ${part.toLowerCase()} did not go on`);
    }
    const built = await waitUntil(sdk, s => assembledCannon(s) !== null, { maxTicks: Math.min(left(), 6) });
    if (!built.ok) return fail('assembled cannon not in view');
    assembledTick = built.tick;
    if (opts.fire === false) return { ok: true, ticks: built.tick - t0, cannon: assembledCannon(built.state), assembledTick, refused };

    // 3. Load, then Fire on the tick the load shows: two interactions, so two ticks.
    const cannon = assembledCannon(built.state)!;
    const balls = ballsHeld(built.state);
    if (balls === 0) return fail('no cannonballs to load', built.state);
    void sdk.sendUseItemOnLoc(invItem(sdk, CANNONBALL)!.slot, cannon.x, cannon.z, cannon.id);
    const loaded = await waitUntil(sdk, s => ballsHeld(s) < balls || chat.next(s).some(m => CANNON_MSG.full.test(m)), { maxTicks: Math.min(left(), 6) });
    if (!loaded.ok) return fail('the load did not land', loaded.state);
    void sdk.sendInteractLoc(cannon.x, cannon.z, cannon.id, opIndex(cannon, /^fire$/i) ?? 1);
    return { ok: true, ticks: loaded.tick - t0, cannon, assembledTick, refused };
}

export type CannonClick = 'reload' | 'fire';

export interface KeeperOptions {
    /** Top up after this many ticks from beside the cannon (default RELOAD_EVERY). */
    reloadEvery?: number;
    /** Top up from away (a walk that holds the caller's attacks) only this many ticks past due (default 10). */
    awayGrace?: number;
    /** Hold the caller's attacks this long at most while a top-up is unconfirmed (default 6). */
    holdTicks?: number;
    /** The tick the cannon was assembled, for `age` (default: unknown). */
    assembledTick?: number;
}

/**
 * Cannon upkeep fed one published state per tick. `want` names the one cannon
 * click this tick calls for (a top-up every ~20 ticks, a reload and a fresh Fire
 * after "out of ammo"); the caller sends it with `send` on a tick it has no other
 * interaction on, and holds its attacks while `holding` (the top-up may be a walk).
 */
export class CannonKeeper {
    reloads = 0;
    refires = 0;
    dryEvents = 0;
    loadedBalls = 0;
    decayed = false;
    private lastReload: number;
    private dry = false;
    private needFire = false;
    private pendingSince: number | null = null;
    private readonly chat: MessageCursor;
    private readonly o: Required<Omit<KeeperOptions, 'assembledTick'>>;
    readonly assembledTick: number | null;

    constructor(s: BotWorldState, o: KeeperOptions = {}) {
        this.o = { reloadEvery: o.reloadEvery ?? RELOAD_EVERY, awayGrace: o.awayGrace ?? 10, holdTicks: o.holdTicks ?? 6 };
        this.assembledTick = o.assembledTick ?? null;
        this.lastReload = s.tick;
        this.chat = new MessageCursor(s);
    }

    /** Ticks since assembly, or null when unknown. */
    age(s: BotWorldState): number | null {
        return this.assembledTick === null ? null : s.tick - this.assembledTick;
    }

    /** Read this tick's messages. Call once per tick before `want`. */
    observe(s: BotWorldState): void {
        for (const m of this.chat.next(s)) {
            if (CANNON_MSG.outOfAmmo.test(m)) {
                if (!this.dry) this.dryEvents++;
                this.dry = true;
                this.needFire = false;
            }
            const load = CANNON_MSG.loaded.exec(m);
            if (load || CANNON_MSG.full.test(m)) {
                if (load) this.loadedBalls += Number(load[1]);
                if (this.pendingSince !== null && this.dry) this.needFire = true;
                if (this.pendingSince !== null) this.dry = false;
                this.pendingSince = null;
            }
            if (CANNON_MSG.decayed.test(m) || CANNON_MSG.destroyed.test(m)) this.decayed = true;
        }
        if (this.pendingSince !== null && s.tick - this.pendingSince >= this.o.holdTicks) {
            // Unconfirmed (dropped in a p_delay, or cancelled): try again on the next chance.
            this.pendingSince = null;
            this.lastReload = -Infinity;
        }
    }

    /** A top-up is in flight: an attack now would cancel its walk. */
    holding(s: BotWorldState): boolean {
        return this.pendingSince !== null && s.tick - this.pendingSince < this.o.holdTicks;
    }

    /** The cannon click this tick calls for, or null. */
    want(s: BotWorldState, cannon: NearbyLoc | null = assembledCannon(s)): CannonClick | null {
        if (this.decayed || !cannon || this.pendingSince !== null) return null;
        if (this.needFire) return 'fire';
        if (ballsHeld(s) === 0) return null;
        const since = s.tick - this.lastReload;
        if (this.dry) return 'reload';
        if (since >= this.o.reloadEvery && besideCannon(s, cannon)) return 'reload';
        if (since >= this.o.reloadEvery + this.o.awayGrace) return 'reload';
        return null;
    }

    /** Fire `click` at the cannon and record it. */
    send(sdk: Pick<BotSDK, 'sendUseItemOnLoc' | 'sendInteractLoc'>, click: CannonClick, s: BotWorldState, cannon: NearbyLoc | null = assembledCannon(s)): void {
        if (!cannon) return;
        if (click === 'reload') {
            const ball = invItem(s, CANNONBALL);
            if (!ball) return;
            this.reloads++;
            this.lastReload = s.tick;
            this.pendingSince = s.tick;
            void sdk.sendUseItemOnLoc(ball.slot, cannon.x, cannon.z, cannon.id);
        } else {
            this.refires++;
            this.needFire = false;
            void sdk.sendInteractLoc(cannon.x, cannon.z, cannon.id, opIndex(cannon, /^fire$/i) ?? 1);
        }
    }
}

export interface PickUpResult {
    ok: boolean;
    ticks: number;
    /** Balls back in the inventory from the cannon (up to 30). */
    returned: number;
    reason?: string;
}

/** Pick the cannon up (any stage): every part back in the inventory, with the unfired balls. */
export async function pickUpCannon(sdk: CannonSdk, maxTicks = 12): Promise<PickUpResult> {
    const s0 = sdk.getState();
    if (!s0) throw new Error('pickUpCannon: no state');
    const t0 = s0.tick;
    const before = ballsHeld(s0);
    const loc = placedCannon(s0);
    if (!loc) return { ok: hasCannonSet(s0), ticks: 0, returned: 0, ...(hasCannonSet(s0) ? {} : { reason: 'no placed cannon in view' }) };
    if (freeSlots(s0) < PICKUP_FREE_SLOTS) return { ok: false, ticks: 0, returned: 0, reason: `pick-up needs ${PICKUP_FREE_SLOTS} free slots, ${freeSlots(s0)} free` };
    const op = opIndex(loc, /^pick-up$/i) ?? 2;
    let r = await (async () => {
        void sdk.sendInteractLoc(loc.x, loc.z, loc.id, op);
        return waitUntil(sdk, s => hasCannonSet(s), { maxTicks: Math.ceil(maxTicks / 2) });
    })();
    if (!r.ok) {
        const again = placedCannon(sdk.getState());
        if (again) void sdk.sendInteractLoc(again.x, again.z, again.id, opIndex(again, /^pick-up$/i) ?? op);
        r = await waitUntil(sdk, s => hasCannonSet(s), { maxTicks: Math.ceil(maxTicks / 2) });
    }
    return { ok: r.ok, ticks: r.tick - t0, returned: Math.max(0, ballsHeld(r.state) - before), ...(r.ok ? {} : { reason: 'the parts did not come back' }) };
}
