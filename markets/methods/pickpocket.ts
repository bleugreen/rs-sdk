// Pickpocketing the East Ardougne market (knights, paladins, heroes) with food from the bank:
// a markets method loop (docs/markets/methods.md), run as a fleet Role.
//
//   ROLE_OPTIONS='{"target":"knight"}' bun markets/methods/pickpocket.ts <account>
//
// One trip: pickpocket until the food runs out (or `bankAt` coins are carried), walk to the
// East Ardougne south bank, deposit everything, withdraw `food` (fill, or `foodPerTrip` of them),
// report the bank, walk back. The demo's board counts the bank only, so every trip ends there.
//
// The click policy is speedrun/helpers/coins.ts's: click the target once every server tick and let
// the server drop the clicks that land in a delay or a stun (a success takes 2 ticks, a failure
// stun + 3; docs/speedrun/skills/thieving.md). It needs state every tick: a lite client on a
// local gateway, or the direct path.
//
// Targets (pickpocket.dbrow; map spawns from server/content/maps m41_51 and m41_52):
//   knight   Knight of Ardougne  50 gp                     3 dmg  level 55  four in the market
//   paladin  Paladin             80 gp + 2 chaos runes     3 dmg  level 70  two in the market
//   hero     Hero                200-300 gp + rare loot    4 dmg  level 80  three in the market
// The castle's paladins (17 spawns, 2571-2588, 3285-3308) are behind walls and not used.

import type { BotWorldState, InventoryItem, NearbyNpc } from '../../sdk/types';
import { depositAll, withdrawMany } from '../../speedrun/lib/bank';
import { walkTo } from '../../speedrun/lib/act';
import { nextTick, waitTicks } from '../../speedrun/lib/wait';
import { runStandalone, type Role, type RoleContext } from '../../speedrun/helpers/role';

export interface Tile {
    x: number;
    z: number;
}

export interface PickSpot {
    npc: RegExp;
    /** Targets further than `radius` from `anchor` are ignored. */
    anchor: Tile;
    radius: number;
    bank: Tile;
    /** pickpocket.dbrow stun_damage: fixed hitpoints lost per failure. */
    damage: number;
    level: number;
    /** Map spawn tiles: walked in turn when no target is in view (a target can wander out of view range). */
    spawns: readonly Tile[];
}

/** East Ardougne south bank, booths at (2656,3283) and (2656,3286) (speedrun/skills/thieving.ts). */
export const ARDOUGNE_SOUTH_BANK: Tile = { x: 2654, z: 3285 };

export const SPOTS: Record<'knight' | 'paladin' | 'hero', PickSpot> = {
    // the eastern two spawns wander least
    knight: {
        npc: /^knight of ardougne$/i, anchor: { x: 2667, z: 3306 }, radius: 16, bank: ARDOUGNE_SOUTH_BANK, damage: 3, level: 55,
        spawns: [{ x: 2669, z: 3298 }, { x: 2671, z: 3313 }, { x: 2653, z: 3300 }, { x: 2652, z: 3318 }]
    },
    paladin: { npc: /^paladin$/i, anchor: { x: 2655, z: 3311 }, radius: 12, bank: ARDOUGNE_SOUTH_BANK, damage: 3, level: 70, spawns: [{ x: 2653, z: 3315 }, { x: 2657, z: 3307 }] },
    // spread across the market: none is in view from the bank, where a trip starts
    hero: { npc: /^hero$/i, anchor: { x: 2650, z: 3304 }, radius: 24, bank: ARDOUGNE_SOUTH_BANK, damage: 4, level: 80, spawns: [{ x: 2647, z: 3306 }, { x: 2667, z: 3316 }, { x: 2630, z: 3288 }] }
};

/** Hitpoints per eat (consume_normal.dbrow), by inventory name. */
export const FOOD_HEAL: Record<string, number> = { Shark: 20, Swordfish: 14, Lobster: 12, Tuna: 10, Salmon: 9, Trout: 7, Cake: 4, '2/3 cake': 4, 'Slice of cake': 4, Kebab: 3 };

/**
 * Whether to eat now. In a success window (the tick after a success, 3+ ticks clear of a stun
 * and the last eat) eating is free (thieving.md section 6), so eat there once the food's heal
 * would not be wasted, or once hp is two failures from the floor. Out of the window eat only
 * when the next failure could kill.
 */
export function shouldEat(i: { hp: number; maxHp: number; heal: number; damage: number; window: boolean; ticksSinceEat: number }): boolean {
    if (i.hp <= i.damage + 1) return i.ticksSinceEat >= 2;
    if (!i.window) return false;
    return i.hp <= Math.max(2 * i.damage + 1, i.maxHp - i.heal);
}

/**
 * The spawn to walk to when no target is in view: the nearest one not yet tried since a target
 * was last seen; once all are tried, the round starts again from the nearest.
 */
export function roamTo(spawns: readonly Tile[], from: Tile, tried: ReadonlySet<number>): number {
    const d = (t: Tile) => Math.max(Math.abs(t.x - from.x), Math.abs(t.z - from.z));
    const order = spawns.map((t, i) => i).sort((a, b) => d(spawns[a]!) - d(spawns[b]!));
    return order.find(i => !tried.has(i)) ?? order[0]!;
}

/**
 * `bot.walkTo` failures a shut door can cause: the router found no way from where the player stands (sdk/actions.ts
 * `_walkToRoute`). Neither it nor speedrun/lib/act.ts `walkTo` gives these a structured reason, so this matches the
 * message; a death en route, a timeout or a blocked destination tile is not a door's doing.
 */
export const UNROUTABLE = /stops \d+ tiles short|: no waypoints$|^Stuck at \(|^Could not reach \(/;

export const unroutable = (message: string): boolean => UNROUTABLE.test(message);

export class WalkFailed extends Error {}

export interface DoorWalk {
    walk(t: Tile): Promise<{ ok: boolean; message: string }>;
    openDoor(): Promise<{ success: boolean; message: string; reason?: string }>;
    wait(ticks: number): Promise<void>;
    log(message: string, data?: Record<string, unknown>): void;
}

/**
 * Walk to `t`. A walk that fails as unroutable opens the nearest door and walks again, then once more after `waitTicks`
 * (another player may have shut the door again). Throws WalkFailed when the walk still fails, so nothing that needs
 * the destination (the bank booth) runs from the wrong place.
 */
export async function walkThroughDoors(d: DoorWalk, t: Tile, waitTicks = 5): Promise<void> {
    let r = await d.walk(t);
    if (r.ok) return;
    const first = r.message;
    if (unroutable(first)) {
        for (let attempt = 1; attempt <= 2 && !r.ok; attempt++) {
            if (attempt > 1) await d.wait(waitTicks);
            const door = await d.openDoor();
            d.log('opening a door: walk unroutable', { to: t, attempt, walk: r.message, door: door.reason ?? (door.success ? 'opened' : 'failed'), doorMessage: door.message });
            r = await d.walk(t);
        }
        if (r.ok) {
            d.log('through the door', { to: t, walk: first });
            return;
        }
    }
    throw new WalkFailed(`walk to (${t.x},${t.z}) failed: ${r.message}`);
}

/** Consecutive errand failures; `fail` says when they reach `max`, after which the role gives up. */
export class FailureRun {
    n = 0;
    constructor(readonly max: number) {}
    ok(): void {
        this.n = 0;
    }
    fail(): boolean {
        return ++this.n >= this.max;
    }
}

export type Errand = 'bank' | 'go' | 'thieve';

/** The next errand from a snapshot: bank when out of food or carrying `bankAt` coins, else thieve at the station. */
export function nextErrand(i: { food: number; coins: number; bankAt: number; atStation: boolean }): Errand {
    if (i.food === 0 || i.coins >= i.bankAt) return 'bank';
    return i.atStation ? 'thieve' : 'go';
}

interface Options {
    target: keyof typeof SPOTS;
    /** Food to withdraw (bank name). */
    food: string;
    /** Food withdrawn per trip; 0 fills the pack. */
    foodPerTrip: number;
    /** Carried coins that end a trip early (bounds what a death costs). */
    bankAt: number;
    reportTicks: number;
    /** Errands failing this many times in a row end the role with an error (the runner's stage retries take over). */
    maxErrandFailures: number;
}

function readOptions(raw: Record<string, unknown>): Options {
    const target = String(raw.target ?? 'knight') as Options['target'];
    if (!(target in SPOTS)) throw new Error(`pickpocket: unknown target ${target}`);
    const num = (k: string, d: number) => (typeof raw[k] === 'number' ? (raw[k] as number) : d);
    return { target, food: String(raw.food ?? 'Shark'), foodPerTrip: num('foodPerTrip', 0), bankAt: num('bankAt', 50_000), reportTicks: num('reportTicks', 1000), maxErrandFailures: num('maxErrandFailures', 10) };
}

const coinsIn = (s: BotWorldState) => s.inventory.filter(i => i.name === 'Coins').reduce((a, i) => a + i.count, 0);
const xpOf = (s: BotWorldState) => s.skills.find(k => k.name === 'Thieving')?.experience ?? 0;
const dist = (s: BotWorldState, t: Tile) => Math.max(Math.abs(s.player!.worldX - t.x), Math.abs(s.player!.worldZ - t.z));
const eatOp = (i: InventoryItem) => i.optionsWithIndex.find(o => /^eat$/i.test(o.text));

export class Pickpocketer {
    private readonly o: Options;
    private readonly spot: PickSpot;
    successes = 0;
    failures = 0;
    eats = 0;
    hpLost = 0;
    deaths = 0;
    banks = 0;
    roams = 0;
    private startTick = 0;
    private lastReport = 0;

    constructor(private readonly ctx: RoleContext) {
        this.o = readOptions(ctx.options);
        this.spot = SPOTS[this.o.target];
    }

    private get s(): BotWorldState {
        const s = this.ctx.sdk.getState();
        if (!s?.player) throw new Error('no game state');
        return s;
    }

    private food(s: BotWorldState): InventoryItem[] {
        return s.inventory.filter(i => FOOD_HEAL[i.name] !== undefined && eatOp(i));
    }

    async run(): Promise<void> {
        this.startTick = this.lastReport = this.s.tick;
        this.ctx.log('start', { options: this.o, thieving: this.s.skills.find(k => k.name === 'Thieving')?.baseLevel, hp: this.s.player!.maxHp });
        const failures = new FailureRun(this.o.maxErrandFailures);
        while (!this.ctx.signal.aborted) {
            const s = this.s;
            if (s.dialog.isOpen) await this.ctx.sdk.sendClickDialog(0);
            const e = nextErrand({ food: this.food(s).length, coins: coinsIn(s), bankAt: this.o.bankAt, atStation: dist(s, this.spot.anchor) <= this.spot.radius });
            try {
                if (e === 'bank') await this.bank();
                else if (e === 'go') await this.walk(this.spot.anchor);
                else await this.thieve();
                failures.ok();
            } catch (err) {
                if (this.ctx.signal.aborted) break;
                this.ctx.log('errand error', { errand: e, error: String(err), inARow: failures.n + 1 });
                if (failures.fail()) {
                    const p = this.s.player!;
                    this.ctx.log('errands keep failing: ending the role', { errand: e, inARow: failures.n, at: { x: p.worldX, z: p.worldZ }, error: String(err) });
                    this.report('stop');
                    throw new Error(`pickpocket: ${failures.n} errands failed in a row at (${p.worldX},${p.worldZ}), last: ${String(err)}`);
                }
                await waitTicks(this.ctx.sdk, 5);
            }
        }
        this.report('stop');
    }

    /** Throws WalkFailed when the walk fails, after a door retry if it was unroutable. */
    private walk(t: Tile): Promise<void> {
        const { bot, sdk, log } = this.ctx;
        // the nearest shut one: bot.openDoor() alone takes the nearest door by name, which may be an open one
        const shut = () => sdk.getNearbyLocs().filter(l => /door|gate/i.test(l.name) && l.optionsWithIndex.some(o => /^open$/i.test(o.text))).sort((a, b) => a.distance - b.distance)[0];
        return walkThroughDoors({ walk: to => walkTo(bot, sdk, to.x, to.z, 2), openDoor: () => bot.openDoor(shut()), wait: async n => void (await waitTicks(sdk, n)), log }, t);
    }

    private async bank(): Promise<void> {
        await this.walk(this.spot.bank);
        const opened = await this.ctx.bot.openBank();
        if (!opened.success) throw new Error(`openBank: ${opened.message}`);
        const d = await depositAll(this.ctx.sdk);
        if (!d.ok) this.ctx.log('deposit incomplete', { reason: d.reason, remaining: d.remaining.map(i => i.name) });
        const food = new RegExp(`^${this.o.food.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const w = await withdrawMany(this.ctx.sdk, [{ item: food, n: this.o.foodPerTrip > 0 ? this.o.foodPerTrip : 'fill' }]);
        this.banks++;
        this.ctx.reportBank({ items: this.ctx.sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count })) });
        await this.ctx.bot.closeBank();
        if (!w.ok) {
            this.ctx.log('out of food in the bank', { food: this.o.food, reason: w.reason });
            throw new Error('no food');
        }
        this.report('banked');
    }

    /** Click the target every tick until the trip ends (out of food, bankAt, death, left station). */
    private async thieve(): Promise<void> {
        const sdk = this.ctx.sdk;
        let s = this.s;
        let lastXp = xpOf(s), lastHp = s.player!.hp, lastStunEnd = -100, lastEat = -100, lastProgress = s.tick;
        let target: NearbyNpc | undefined;
        const skip = new Map<number, number>();
        const tried = new Set<number>();
        let unseenSince = s.tick;
        while (!this.ctx.signal.aborted) {
            s = await nextTick(sdk, s.tick);
            const t = s.tick, p = s.player!;
            let success = false;
            if (xpOf(s) > lastXp) {
                this.successes++;
                success = true;
                lastProgress = t;
            }
            lastXp = xpOf(s);
            if (p.hp < lastHp && p.hp > 0) {
                this.failures++;
                this.hpLost += lastHp - p.hp;
                lastStunEnd = t + 8;
                lastProgress = t;
            }
            if (p.isDead || p.hp <= 0) {
                this.deaths++;
                this.ctx.log('died', { coins: coinsIn(s) });
                await sdk.waitForCondition(st => !!st.player && st.player.hp > 0 && !st.player.isDead, 30_000).catch(() => undefined);
                return;
            }
            lastHp = p.hp;
            if (t - this.lastReport >= this.o.reportTicks) this.report('progress');
            if (s.dialog.isOpen) await sdk.sendClickDialog(0);
            if (coinsIn(s) >= this.o.bankAt) return;

            const food = this.food(s)[0];
            if (!food) return;
            const window = success && t - lastStunEnd >= 4 && t - lastEat >= 3;
            if (shouldEat({ hp: p.hp, maxHp: p.maxHp, heal: FOOD_HEAL[food.name]!, damage: this.spot.damage, window, ticksSinceEat: t - lastEat })) {
                await sdk.sendUseItem(food.slot, eatOp(food)!.opIndex);
                this.eats++;
                lastEat = t;
                // the eat cleared nothing it needs to: a pickpocket click this tick still lands
            }

            if (dist(s, this.spot.anchor) > this.spot.radius + 6) return;
            if (t - lastProgress > 40) {
                if (target) skip.set(target.index, t + 100);
                target = undefined;
                lastProgress = t;
            }
            if (!target || !s.nearbyNpcs.some(n => n.index === target!.index)) {
                target = s.nearbyNpcs
                    .filter(n => this.spot.npc.test(n.name) && n.reachable !== false && (skip.get(n.index) ?? 0) < t)
                    .filter(n => Math.max(Math.abs((n.tileX ?? n.x) - this.spot.anchor.x), Math.abs((n.tileZ ?? n.z) - this.spot.anchor.z)) <= this.spot.radius)
                    .sort((a, b) => a.distance - b.distance)[0];
            } else target = s.nearbyNpcs.find(n => n.index === target!.index);
            if (target) {
                unseenSince = t;
                tried.clear();
            } else if (t - unseenSince >= 8) {
                const i = roamTo(this.spot.spawns, { x: p.worldX, z: p.worldZ }, tried);
                tried.add(i);
                this.roams++;
                await this.walk(this.spot.spawns[i]!);
                s = this.s;
                unseenSince = lastProgress = s.tick;
                continue;
            }
            const op = target?.optionsWithIndex.find(o => /pickpocket/i.test(o.text));
            if (target && op) await sdk.sendInteractNpc(target.index, op.opIndex);
        }
    }

    report(message: string): void {
        const s = this.ctx.sdk.getState();
        this.lastReport = s?.tick ?? 0;
        this.ctx.log(message, { ticks: (s?.tick ?? 0) - this.startTick, successes: this.successes, failures: this.failures, eats: this.eats, hpLost: this.hpLost, deaths: this.deaths, banks: this.banks, roams: this.roams, carried: s ? coinsIn(s) : 0 });
    }
}

export const role: Role = {
    name: 'pickpocket',
    produces: [/^Coins$/, /rune$/i],
    run: ctx => new Pickpocketer(ctx).run()
};

if (import.meta.main) await runStandalone(role);
