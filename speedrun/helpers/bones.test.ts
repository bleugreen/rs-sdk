import { describe, expect, test, spyOn } from 'bun:test';
import { FakeSdk, baseState } from '../lib/fake-sdk';
import type { BotSDK } from '../../sdk/index';
import type { BotActions } from '../../sdk/actions';
import type { BotWorldState, InventoryItem, NearbyNpc } from '../../sdk/types';
import { Run } from './bones';
import { memoryRoleState } from './role';
import { summarizeWindow } from '../../docs/speedrun/scripts/bones-dev/stats';
import { carryReached, fishingHaul, foodOverCap, lootWanted, gearRank, healOf, inBabyBlueRoom, inDesert, isClutter, keepOnBank, parseOptions, patrolTour, SPOTS, tollWithdraw, UGTHANKI_SPAWNS } from './bones';
import { ANTI_DRAGON_SHIELD, facesMe, inAdultReach, roomFull, SWING_GIVE_UP_TICKS, SWING_STALE_TICKS, swingCheck } from './bones';
import { ROOM, SAFE_ROUTE, SAFE_TILE, TAVERLEY_ADULTS, TAVERLEY_BABIES } from './dragons';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('ugthanki spot', () => {
    test('the desert is south of the Shantay Pass gate; the camp, chest and Al Kharid are not', () => {
        expect(inDesert({ x: 3303, z: 3115 })).toBe(true); // south of the gate
        expect(inDesert({ x: 3303, z: 3118 })).toBe(false); // north of the gate
        expect(inDesert({ x: 3309, z: 3121 })).toBe(false); // Shantay's chest
        expect(inDesert({ x: 3270, z: 3167 })).toBe(false); // Al Kharid bank
        for (const s of UGTHANKI_SPAWNS) expect(inDesert(s)).toBe(true);
    });
    test('patrolTour visits every spawn once, nearest first', () => {
        const tour = patrolTour({ x: 3303, z: 3115 }, UGTHANKI_SPAWNS);
        expect(tour).toHaveLength(25);
        expect(new Set(tour.map(t => `${t.x},${t.z}`)).size).toBe(25);
        expect(tour[0]).toEqual({ x: 3291, z: 3100 });
        expect(patrolTour({ x: 0, z: 0 }, [{ x: 5, z: 5 }, { x: 1, z: 1 }, { x: 9, z: 0 }])).toEqual([{ x: 1, z: 1 }, { x: 5, z: 5 }, { x: 9, z: 0 }]);
    });
    test('the spot keeps its passes over bank visits, patrols, and buys food at the exchange', () => {
        const o = parseOptions({ spot: 'ugthanki' });
        expect(o.spot).toBe(SPOTS.ugthanki!);
        expect(o.food).toBe('ge');
        expect(o.spot.keep?.test('Shantay pass')).toBe(true);
        expect(o.spot.bones.test('Raw ugthanki meat')).toBe(true);
        expect(o.spot.patrol).toHaveLength(25);
    });
    test('fishingHaul: coins are a haul only where the spot banks them', () => {
        const ugthanki = SPOTS.ugthanki!;
        const coins = [{ name: 'Coins' }, { name: 'Shantay pass' }];
        expect(fishingHaul(coins, ugthanki)).toBe(false);
        expect(fishingHaul([...coins, { name: 'Raw ugthanki meat' }], ugthanki)).toBe(true);
        expect(fishingHaul(coins, SPOTS.baby_blue!)).toBe(true);
        expect(fishingHaul([{ name: 'Shark' }], SPOTS.baby_blue!)).toBe(false);
    });
});

test('inBabyBlueRoom: west of the dusty-key gate only; the gate tile is outside', () => {
    expect(inBabyBlueRoom({ x: 2898, z: 9775 })).toBe(true);
    expect(inBabyBlueRoom({ x: 2901, z: 9800 })).toBe(true);
    expect(inBabyBlueRoom({ x: 2923, z: 9803 })).toBe(true);
    expect(inBabyBlueRoom({ x: 2924, z: 9803 })).toBe(false); // cairn_h51 stopped here, 09:26 UTC
    expect(inBabyBlueRoom({ x: 2925, z: 9803 })).toBe(false);
    expect(inBabyBlueRoom({ x: 2884, z: 9798 })).toBe(false); // the ladder bottom is walled off from the room
});

describe('skipIds', () => {
    // The druid gatherers' plan for attempts 2-3: leave grimy marrentill, tarromin, cadantine, dwarf weed and lantadyme.
    const skip = [201, 203, 215, 217, 2485];
    const want = /^herb$|^(vial of water|coins)$/i;
    test('default none: existing configs pick up as before', () => {
        expect(parseOptions({}).skipIds.size).toBe(0);
        expect(lootWanted({ id: 201, name: 'Herb' }, want, parseOptions({}).skipIds)).toBe(true);
    });
    test('a skipped id is left whatever its name; other herbs and the rest of the loot are taken', () => {
        const ids = parseOptions({ spot: 'chaos_druids', skipIds: skip }).skipIds;
        for (const id of skip) expect(lootWanted({ id, name: 'Herb' }, want, ids)).toBe(false);
        for (const id of [199, 205, 207, 209, 211, 213]) expect(lootWanted({ id, name: 'Herb' }, want, ids)).toBe(true);
        expect(lootWanted({ id: 227, name: 'Vial of water' }, want, ids)).toBe(true);
        expect(lootWanted({ id: 1, name: 'Bronze longsword' }, want, ids)).toBe(false);
    });
    test('refuses a malformed list', () => {
        expect(() => parseOptions({ skipIds: [201, 'x'] })).toThrow();
        expect(() => parseOptions({ skipIds: 201 })).toThrow();
    });
    test('maxCarry counts only what was picked up: skipped herbs left on the ground never reach the pack', () => {
        const carried = Array.from({ length: 9 }, () => ({ name: 'Herb', count: 1 }));
        expect(carryReached(carried, SPOTS.chaos_druids!.bones, 10)).toBe(false);
    });
});

describe('maxCarry', () => {
    const herbs = (n: number) => Array.from({ length: n }, () => ({ name: 'Herb', count: 1 }));
    const druids = SPOTS.chaos_druids!;
    test('defaults to banking only when full', () => {
        expect(parseOptions({}).maxCarry).toBe(Infinity);
        expect(carryReached(herbs(27), druids.bones, Infinity)).toBe(false);
    });
    test('Edgeville druids with maxCarry 10: the tenth herb carried sends it to the bank; vials, coins and runes do not count', () => {
        expect(parseOptions({ spot: 'chaos_druids', maxCarry: 10 }).maxCarry).toBe(10);
        const other = [{ name: 'Vial of water', count: 1 }, { name: 'Coins', count: 300 }, { name: 'Law rune', count: 4 }];
        expect(carryReached([...herbs(9), ...other], druids.bones, 10)).toBe(false);
        expect(carryReached([...herbs(10), ...other], druids.bones, 10)).toBe(true);
    });
    test('a stack of the product counts by its size', () => {
        expect(carryReached([{ name: 'Big bones', count: 12 }], /^big bones$/i, 10)).toBe(true);
    });
});

describe('keepFood', () => {
    let slot = 0;
    const item = (id: number, name: string, count = 1, eat = true) =>
        ({ slot: slot++, id, name, count, optionsWithIndex: eat ? [{ text: 'Eat', opIndex: 1 }] : [] }) as unknown as InventoryItem;
    const kebabs = (n: number) => Array.from({ length: n }, () => item(1971, 'Kebab'));

    test('defaults to keeping all food (the old behaviour)', () => {
        expect(parseOptions({}).keepFood).toBe(Infinity);
        expect(foodOverCap(kebabs(24), Infinity)).toEqual([]);
    });
    test('cairn_h51 with 24 kebabs and keepFood 4: 20 go in the bank, the coins stay out of it', () => {
        expect(parseOptions({ keepFood: 4 }).keepFood).toBe(4);
        const inv = [item(995, 'Coins', 200, false), ...kebabs(24), item(199, 'Herb', 1, false)];
        expect(foodOverCap(inv, 4)).toEqual([{ id: 1971, n: 20 }]);
        expect(foodOverCap(inv, 0)).toEqual([{ id: 1971, n: 24 }]);
    });
    test('the cap counts across food kinds in inventory order; noted (uneatable) food is not counted', () => {
        const inv = [item(385, 'Shark'), item(385, 'Shark'), ...kebabs(3), item(386, 'Shark', 50, false)];
        expect(foodOverCap(inv, 3)).toEqual([{ id: 1971, n: 2 }]);
    });
});

describe('tollWithdraw', () => {
    test('a bank east of the toll gate keeps the 10 gp toll (Al Kharid bank, where the coins role banks)', () => {
        const t = tollWithdraw({ x: 3270, z: 3167 });
        expect(t).toHaveLength(1);
        expect(t[0]!.re.test('Coins')).toBe(true);
        expect(t[0]!.n).toBe(10);
    });
    test('banks west of the gate take nothing out', () => {
        expect(tollWithdraw({ x: 2946, z: 3368 })).toEqual([]); // Falador west
        expect(tollWithdraw({ x: 3185, z: 3436 })).toEqual([]); // Varrock west
    });
});

describe('keepOnBank', () => {
    const done = { fishing: 50, cooking: 50 };
    test('keeps food, the fly fishing kit and the brass key', () => {
        for (const n of ['Trout', 'Salmon', 'Shrimps', 'Raw trout', 'Fly fishing rod', 'Feather', 'Brass key']) expect(keepOnBank(n, done)).toBe(true);
    });
    test('banks bones, coins and loot', () => {
        for (const n of ['Big bones', 'Coins', 'Nature rune', 'Limpwurt root', 'Iron kiteshield']) expect(keepOnBank(n, done)).toBe(false);
    });
    test('keeps the net and raw net fish only while cooking practice needs them', () => {
        expect(keepOnBank('Small fishing net', { fishing: 10, cooking: 1 })).toBe(true);
        expect(keepOnBank('Raw shrimps', { fishing: 25, cooking: 10 })).toBe(true);
        expect(keepOnBank('Small fishing net', done)).toBe(false);
        expect(keepOnBank('Raw shrimps', done)).toBe(false);
    });
    test('keeps the spot requirement', () => {
        expect(keepOnBank('Dusty key', done, /^dusty key$/i)).toBe(true);
        expect(keepOnBank('Dusty key', done)).toBe(false);
    });
});

test('isClutter: raw net fish once Cooking is 15, and burnt food', () => {
    expect(isClutter('Raw shrimps', 14)).toBe(false);
    expect(isClutter('Raw shrimps', 15)).toBe(true);
    expect(isClutter('Raw anchovies', 40)).toBe(true);
    expect(isClutter('Burnt fish', 1)).toBe(true);
    expect(isClutter('Raw trout', 40)).toBe(false);
    expect(isClutter('Shrimps', 40)).toBe(false);
});

test('gearRank orders metals and prefers kiteshields and full helms', () => {
    const tier = (n: string) => gearRank(n)?.tier ?? -1;
    expect(tier('Iron kiteshield')).toBeGreaterThan(tier('Iron sq shield'));
    expect(tier('Steel sq shield')).toBeGreaterThan(tier('Iron kiteshield'));
    expect(tier('Iron sq shield')).toBeGreaterThan(tier('Wooden shield'));
    expect(gearRank('Mithril scimitar')).toMatchObject({ slot: 'weapon', metal: 'mithril', skill: 'Attack' });
    expect(gearRank('Dragon scimitar')).toBeNull();
    expect(gearRank('Big bones')).toBeNull();
});

test('parseOptions defaults and rejects unknown spots', () => {
    const o = parseOptions({});
    expect(o.spot.id).toBe('hill_giants');
    expect(o.train).toBe(50);
    expect(o.food).toBe('fish');
    expect(o.coinsFrom).toBeNull();
    expect(parseOptions({ spot: 'baby_blue', train: 60, food: 'none' })).toMatchObject({ train: 60, food: 'none' });
    expect(() => parseOptions({ spot: 'green_dragons' })).toThrow(/unknown spot/);
    expect(() => parseOptions({ food: 'trout' })).toThrow(/unknown food/);
});test('baby blues buy sharks at the exchange by default', () => {
    const o = parseOptions({ spot: 'baby_blue', coinsFrom: '^cairn_h6\\d$' });
    expect(o).toMatchObject({ food: 'ge', foodItem: 'Shark', foodPerTrip: 10, buyFood: 150, maxFoodPrice: 900, coinWaitMin: 20 });
    expect(o.coinsFrom?.test('cairn_h63')).toBe(true);
    expect(o.coinsFrom?.test('cairn_h50')).toBe(false);
});

describe('nature talisman spot', () => {
    const CONTENT = join(import.meta.dir, '..', '..', 'server', 'content');
    /** Overground spawns of the named NPCs in one map square, read from the game's own map file. */
    function spawns(square: string, names: string[]): { x: number; z: number }[] {
        const ids = new Set(readFileSync(join(CONTENT, 'pack', 'npc.pack'), 'utf8').split('\n')
            .map(l => /^(\d+)=(\w+)$/.exec(l.trim())).filter(m => m && names.includes(m[2]!)).map(m => Number(m![1])));
        const [mx, mz] = /m(\d+)_(\d+)/.exec(square)!.slice(1).map(Number) as [number, number];
        const map = readFileSync(join(CONTENT, 'maps', `${square}.jm2`), 'utf8');
        const npcs = map.slice(map.indexOf('==== NPC ===='));
        return [...npcs.matchAll(/^0 (\d+) (\d+): (\d+)$/gm)].filter(m => ids.has(Number(m[3]))).map(m => ({ x: mx * 64 + Number(m[1]), z: mz * 64 + Number(m[2]) }));
    }

    test('hobgoblins: the product is the nature talisman, no food carried by default', () => {
        const o = parseOptions({ spot: 'nature_hobgoblins' });
        expect(o.spot.id).toBe('nature_hobgoblins');
        expect(o.spot.bones.test('Nature talisman')).toBe(true);
        expect(o.spot.bones.test('Chaos talisman')).toBe(false);
        expect(o.spot.npc.test('Hobgoblin')).toBe(true);
        expect(o.food).toBe('none');
        expect(parseOptions({ spot: 'nature_hobgoblins', food: 'ge' }).food).toBe('ge');
        expect(o.loot.test('Nature talisman')).toBe(true);
    });

    test('every talisman spot is overground, where the gem table gives nature rather than chaos', () => {
        const talismanSpots = Object.values(SPOTS).filter(s => s.bones.test('Nature talisman'));
        expect(talismanSpots.length).toBeGreaterThan(0);
        for (const s of talismanSpots) {
            expect(s.area.z2).toBeLessThanOrEqual(6400);
            expect(s.centre.z).toBeLessThanOrEqual(6400);
        }
    });

    test("the hobgoblins' area holds every peninsula spawn in the map file", () => {
        const { area, centre } = SPOTS.nature_hobgoblins!;
        const inside = (p: { x: number; z: number }) => p.x >= area.x1 && p.x <= area.x2 && p.z >= area.z1 && p.z <= area.z2;
        const peninsula = spawns('m45_51', ['hobgoblin_unarmed', 'hobgoblin_armed']);
        expect(peninsula.length).toBe(10);
        for (const p of peninsula) expect(inside(p)).toBe(true);
        expect(inside(centre)).toBe(true);
    });

    test('baby blues still buy their food at the exchange', () => {
        expect(parseOptions({ spot: 'baby_blue' }).food).toBe('ge');
        expect(parseOptions({ spot: 'hill_giants' }).food).toBe('fish');
    });
});

test('healOf knows sharks and defaults small', () => {
    expect(healOf('Shark')).toBe(20);
    expect(healOf('Trout')).toBe(7);
    expect(healOf('Cake')).toBe(5);
});


describe('preferred spot recovery', () => {
    function harness() {
        const sdk = new FakeSdk(baseState({
            player: { worldX: 2946, worldZ: 3368, level: 0, hp: 99, maxHp: 99, respawnCount: 0 } as BotWorldState['player'],
            bank: { isOpen: false, items: [], noteMode: false }
        }));
        const logs: Record<string, unknown>[] = [];
        const item = (name: string, id = 1590) => ({ name, id, count: 1, slot: 0, optionsWithIndex: [] } as InventoryItem);
        const subscribe = sdk.onStateUpdate.bind(sdk);
        sdk.onStateUpdate = listener => {
            const unsubscribe = subscribe(listener);
            queueMicrotask(() => { sdk.tick(); sdk.tick(); });
            return unsubscribe;
        };
        const extended = Object.assign(sdk, {
            waitForTicks: async () => { sdk.tick(); },
            getBankItems: () => sdk.state!.bank.items,
        });
        const bot = {
            openBank: async () => { sdk.push({ bank: { ...sdk.state!.bank, isOpen: true } }); return { success: true }; },
            closeBank: async () => { sdk.push({ bank: { ...sdk.state!.bank, isOpen: false } }); },
            depositItem: async (i: InventoryItem) => {
                sdk.push({ inventory: sdk.state!.inventory.filter(v => v.id !== i.id),
                    bank: { ...sdk.state!.bank, items: [...sdk.state!.bank.items, i] } });
            },
            withdrawItem: async (i: InventoryItem) => {
                sdk.push({ inventory: [...sdk.state!.inventory, i],
                    bank: { ...sdk.state!.bank, items: sdk.state!.bank.items.filter(v => v.id !== i.id) } });
            }
        };
        const opt = parseOptions({ spot: 'baby_blue' });
        opt.spot = { ...opt.spot, acquire: async () => false };
        const run = new Run({
            sdk: extended as unknown as BotSDK, bot: bot as unknown as BotActions,
            account: 'test', options: {}, signal: new AbortController().signal, state: memoryRoleState(),
            log: (message, data) => logs.push({ message, ...data }), reportBank: () => {}
        }, opt);
        return { run, sdk: extended, bot, item, logs };
    }

    test('failed temporary fishing preserves GE buying and the funding receiver', async () => {
        const { run } = harness();
        const now = spyOn(Date, 'now').mockReturnValue(Date.now());
        const ask = spyOn(run, 'foodAsk').mockResolvedValue(676);
        const receiver = spyOn(run, 'waitForCoins').mockResolvedValue();
        const buy = spyOn(run, 'buyFood').mockResolvedValue();
        try {
            await run.bank('first look', null);
            await run.geFood(run.opt.spot);
            expect(run.foodSource()).toBe('fish');
            await run.netFish(); // Neither inventory nor confirmed bank holds a net.
            expect(run.opt.food).toBe('ge');
            expect(run.foodSource()).toBe('ge');
            run.opt.coinsFrom = /^cairn_e04$/;
            await run.geFood(run.opt.spot);
            expect(receiver).toHaveBeenCalledTimes(1);
            const stock = spyOn(run, 'banked').mockImplementation(re => re.test('Coins') ? 50000 : 0);
            await run.geFood(run.opt.spot);
            expect(buy).toHaveBeenCalledTimes(1);
            stock.mockRestore();
            run.opt.coinsFrom = null;
            await run.geFood(run.opt.spot);
            expect(run.foodSource()).toBe('ge'); // No tight retry loop on missing equipment.
            now.mockReturnValue(Date.now() + 30 * 60_000 + 1);
            await run.geFood(run.opt.spot);
            expect(run.foodSource()).toBe('fish');
        } finally {
            now.mockRestore(); ask.mockRestore(); receiver.mockRestore(); buy.mockRestore();
        }
    });

    test('an ugthanki bank visit keeps its coins, and the fishing fallback then fishes instead of banking again', async () => {
        // cairn_h51, GE food unaffordable: fishing fallback, bank for the coins, coins kept, bank again (979 visits).
        const { run, sdk, item } = harness();
        run.opt.spot = SPOTS.ugthanki!;
        run.activeSpot = run.opt.spot;
        sdk.push({ inventory: [item('Coins', 995), item('Shantay pass', 1854), item('Raw ugthanki meat', 1859)] });
        expect(fishingHaul(run.state().inventory, run.opt.spot)).toBe(true);
        expect(await run.bank('out of food', run.opt.spot)).toBe(true);
        expect(run.carrying(/^coins$/i)).toBe(true);
        expect(run.carrying(/^shantay pass$/i)).toBe(true);
        expect(run.carrying(/^raw ugthanki meat$/i)).toBe(false);
        expect(fishingHaul(run.state().inventory, run.opt.spot)).toBe(false);
    });

    test('a stale empty inventory is re-read before any recovery or downgrade', async () => {
        const { run, sdk, item, logs } = harness();
        const subscribe = sdk.onStateUpdate.bind(sdk);
        sdk.onStateUpdate = listener => {
            const unsubscribe = subscribe(listener);
            sdk.tick({ inventory: [item('Dusty key')] });
            return unsubscribe;
        };
        expect(await run.ensureRequirement(run.opt.spot)).toBe(true);
        expect(logs).toEqual([]);
    });

    test('no fresh state cannot cause a downgrade', async () => {
        const { run, sdk, logs } = harness();
        sdk.onStateUpdate = () => () => {};
        run.ctx.signal = AbortSignal.abort(new Error('no live state'));
        await expect(run.ensureRequirement(run.opt.spot)).rejects.toThrow('no live state');
        expect(run.activeSpot).toBe(run.opt.spot);
        expect(logs).toEqual([]);
    });

    test('withdraws a banked key before attempting acquisition', async () => {
        const { run, sdk, item } = harness();
        sdk.push({ bank: { ...sdk.state!.bank, items: [item('Dusty key')] } });
        expect(await run.ensureRequirement(run.opt.spot)).toBe(false);
        expect(run.carrying(/^dusty key$/i)).toBe(true);
        expect(await run.ensureRequirement(run.opt.spot)).toBe(true);
    });

    test('fallback logs evidence, preserves the preferred key, and retries after banking', async () => {
        const { run, sdk, item, logs } = harness();
        // No acquisition path: after a confirmed bank visit the fallback is immediate.
        run.opt.spot.acquire = undefined;
        await run.ensureRequirement(run.opt.spot);
        await run.ensureRequirement(run.opt.spot);
        expect(run.activeSpot.id).toBe('hill_giants');
        expect(logs.find(l => l.to === 'downgrade')).toMatchObject({
            from: 'baby_blue', fallback: 'hill_giants', inventory: [], bank: {}
        });
        sdk.push({ inventory: [item('Dusty key')] });
        await run.bank('full', run.activeSpot);
        expect(run.carrying(/^dusty key$/i)).toBe(true);
        expect(run.activeSpot).toBe(run.opt.spot);
        expect(logs.filter(l => l.to === 'downgrade')).toHaveLength(2);
        expect(await run.ensureRequirement(run.activeSpot)).toBe(true);
    });

    test('a missing key starts recovery even after the role has run for hours', async () => {
        const { run } = harness();
        const now = spyOn(Date, 'now').mockReturnValue(Date.now() + 4 * 3_600_000);
        try {
            await run.ensureRequirement(run.opt.spot);
            await run.ensureRequirement(run.opt.spot);
            expect(run.activeSpot).toBe(run.opt.spot);
        } finally { now.mockRestore(); }
    });

    test('routes out of Edgeville before entering Taverley', async () => {
        const { run, sdk } = harness();
        sdk.push({ player: { ...sdk.state!.player!, worldX: 3108, worldZ: 9836 } });
        const walked: number[][] = [];
        run.walk = async (x, z) => { walked.push([x, z]); sdk.push({ player: { ...sdk.state!.player!, worldX: x, worldZ: z } }); return true; };
        run.climb = async () => { sdk.push({ player: { ...sdk.state!.player!, worldX: 3097, worldZ: 3468 } }); return true; };
        expect(await run.routeToSpot(run.opt.spot)).toBe(true);
        expect(walked[0]).toEqual([3096, 9868]);
        expect(run.underground()).toBe(false);
    });

    test('combat nearby is not evidence that another player’s target belongs to us', () => {
        const { run, sdk } = harness();
        const npc = (index: number, inCombat: boolean, distance: number) => ({
            index, inCombat, distance, x: 2898, z: 9775, name: 'Baby blue dragon',
            hp: 50, optionsWithIndex: [{ text: 'Attack', opIndex: 2 }]
        } as NearbyNpc);
        const target = { npc: /^baby blue dragon$/i, area: run.opt.spot.area, centre: run.opt.spot.centre, loot: null };
        sdk.push({ player: { ...sdk.state!.player!, combat: { inCombat: true, targetType: 'npc', targetIndex: 9, lastDamageTick: 0 } },
            nearbyNpcs: [npc(1, true, 1), npc(2, false, 3)] });
        expect(run.pickTarget(target)?.index).toBe(2);
        sdk.push({ nearbyNpcs: [npc(1, true, 1), npc(9, true, 2)] });
        expect(run.pickTarget(target)?.index).toBe(9);
    });

    test('surface walks first leave the brass-key house, including its door tile', async () => {
        const { run, sdk, bot } = harness();
        sdk.push({ player: { ...sdk.state!.player!, worldX: 3115, worldZ: 3450 } });
        const exited: boolean[] = [];
        run.throughBrassDoor = async entering => {
            exited.push(entering);
            sdk.push({ player: { ...sdk.state!.player!, worldZ: 3449 } });
            return true;
        };
        Object.assign(bot, { walkTo: async (x: number, z: number) => {
            sdk.push({ player: { ...sdk.state!.player!, worldX: x, worldZ: z } }); return { success: true };
        } });
        expect(await run.walk(2946, 3368, 3, 1000)).toBe(true);
        expect(exited).toEqual([false]);
    });
});


describe('swingCheck', () => {
    // Lab, 2026-10-24, adult blues: after eats the attack never resumed, the dragon kept hitting, and
    // fights ran to the 120 s deadline (kill ticks p50 300 against p10 63), 4 sharks a kill.
    test('splats every swing: keep fighting', () => {
        expect(swingCheck({ now: 120, start: 100, lastAttack: 100, lastSplat: 117 })).toBe('ok');
        expect(swingCheck({ now: 105, start: 100, lastAttack: 100, lastSplat: null })).toBe('ok'); // still walking in
    });
    test('no splat for two swings since the last hit or click: attack again', () => {
        expect(swingCheck({ now: 100 + SWING_STALE_TICKS + 1, start: 100, lastAttack: 100, lastSplat: null })).toBe('reattack');
        expect(swingCheck({ now: 140, start: 100, lastAttack: 100, lastSplat: 130 })).toBe('reattack');
        expect(swingCheck({ now: 140, start: 100, lastAttack: 136, lastSplat: 130 })).toBe('ok');
    });
    test('a splat from before the fight is not progress; no splat at all for long: give up', () => {
        expect(swingCheck({ now: 100 + SWING_GIVE_UP_TICKS + 1, start: 100, lastAttack: 150, lastSplat: 40 })).toBe('give_up');
        expect(swingCheck({ now: 200, start: 100, lastAttack: 195, lastSplat: 150 })).toBe('ok');
    });
});

describe('blue_dragon spot', () => {
    const spot = SPOTS.blue_dragon!;
    const SHIELD = { id: 1540, name: 'Dragonfire shield' };

    function harness(spotId = 'blue_dragon') {
        const sdk = new FakeSdk(baseState({
            player: { worldX: 2946, worldZ: 3368, level: 0, hp: 99, maxHp: 99, respawnCount: 0 } as BotWorldState['player'],
            skills: ['Attack', 'Strength', 'Defence', 'Hitpoints'].map(name => ({ name, level: 99, baseLevel: 99, experience: 0 })),
            bank: { isOpen: false, items: [], noteMode: false }
        }));
        const logs: Record<string, unknown>[] = [];
        const equipped: string[] = [];
        const extended = Object.assign(sdk, {
            waitForTicks: async () => { sdk.tick(); },
            getBankItems: () => sdk.state!.bank.items
        });
        const bot = {
            openBank: async () => { sdk.push({ bank: { ...sdk.state!.bank, isOpen: true } }); return { success: true }; },
            closeBank: async () => { sdk.push({ bank: { ...sdk.state!.bank, isOpen: false } }); },
            depositItem: async (i: InventoryItem) => {
                sdk.push({ inventory: sdk.state!.inventory.filter(v => v.id !== i.id),
                    bank: { ...sdk.state!.bank, items: [...sdk.state!.bank.items, i] } });
            },
            withdrawItem: async (i: InventoryItem) => {
                sdk.push({ inventory: [...sdk.state!.inventory, i],
                    bank: { ...sdk.state!.bank, items: sdk.state!.bank.items.filter(v => v.id !== i.id) } });
            },
            equipItem: async (i: InventoryItem) => {
                equipped.push(i.name);
                sdk.push({ inventory: sdk.state!.inventory.filter(v => v !== i), equipment: [...sdk.state!.equipment, i] });
                return { success: true };
            }
        };
        const run = new Run({
            sdk: extended as unknown as BotSDK, bot: bot as unknown as BotActions,
            account: 'test', options: {}, signal: new AbortController().signal, state: memoryRoleState(),
            log: (message, data) => logs.push({ message, ...data }), reportBank: () => {}
        }, parseOptions({ spot: spotId }));
        const item = (name: string, id: number, count = 1) => ({ name, id, count, slot: 0, optionsWithIndex: [] } as InventoryItem);
        return { run, sdk, item, logs, equipped };
    }

    test('selected by id: sharks from the exchange, the dusty key carried, the anti-dragon shield worn, trained to 70', () => {
        const o = parseOptions({ spot: 'blue_dragon' });
        expect(o.spot).toBe(spot);
        expect(o).toMatchObject({ food: 'ge', foodItem: 'Shark', train: 70 });
        expect(parseOptions({ spot: 'blue_dragon', train: 99 }).train).toBe(99);
        expect(parseOptions({ spot: 'baby_blue' }).train).toBe(50);
        expect(spot.requires?.test('Dusty key')).toBe(true);
        expect(spot.worn).toBe(ANTI_DRAGON_SHIELD);
        // Item 1540 is "Dragonfire shield" in this revision (shields.obj antidragonbreathshield).
        expect(ANTI_DRAGON_SHIELD).toMatchObject({ id: 1540, slot: 'shield' });
        expect(ANTI_DRAGON_SHIELD.name.test('Dragonfire shield')).toBe(true);
    });

    test('targets adult blue dragons only, and its product is dragon bones by exact name', () => {
        expect(spot.npc.test('Blue dragon')).toBe(true);
        expect(spot.npc.test('Baby blue dragon')).toBe(false);
        expect(spot.bones.test('Dragon bones')).toBe(true);
        for (const n of ['Babydragon bones', 'Bones', 'Big bones', 'Dragon bones (noted)', 'Blue dragonhide']) expect(spot.bones.test(n)).toBe(false);
    });

    test('works the room from taverley-dragons: every adult spawn inside, the centre in the room west of the gate', () => {
        expect(spot.area).toBe(ROOM);
        const inArea = (p: { x: number; z: number }) => p.x >= ROOM.x1 && p.x <= ROOM.x2 && p.z >= ROOM.z1 && p.z <= ROOM.z2;
        for (const a of TAVERLEY_ADULTS) expect(inArea(a)).toBe(true);
        expect(inArea(spot.centre)).toBe(true);
        expect(inBabyBlueRoom(spot.centre)).toBe(true);
        expect(inAdultReach(spot.centre)).toBe(true);
        expect(inAdultReach(spot.room!.wait)).toBe(false);
    });

    test('the room gate holds two players in the adults\' reach; the magic pair on its safe tile and route never count', () => {
        const gate = spot.room!;
        expect(gate.maxPlayers).toBe(2);
        const melee = { x: 2901, z: 9806 };
        expect(inAdultReach(melee)).toBe(true);
        for (const t of [SAFE_TILE, ...SAFE_ROUTE]) expect(inAdultReach(t)).toBe(false);
        expect(roomFull(gate, [])).toBe(false);
        expect(roomFull(gate, [melee])).toBe(false); // h51 with h52
        expect(roomFull(gate, [melee, { x: 2896, z: 9800 }])).toBe(true); // a third melee player
        expect(roomFull(gate, [melee, SAFE_TILE, SAFE_ROUTE[3]!])).toBe(false); // h55/h56 casting
        expect(roomFull(gate, [{ x: 0, z: 0, worldX: 2896, worldZ: 9800 }, melee])).toBe(true); // worldX/worldZ preferred
    });

    test('refuses to enter without 1540 worn: no walk to the ladder, no door', async () => {
        const { run, sdk, logs } = harness();
        const walked: number[][] = [];
        run.walk = async (x, z) => { walked.push([x, z]); return false; };
        expect(await spot.enter(run)).toBe(false);
        expect(walked).toEqual([]);
        expect(logs.some(l => /not entering without item 1540 worn/.test(String(l.message)))).toBe(true);
        sdk.push({ equipment: [{ ...SHIELD, count: 1, slot: 5, optionsWithIndex: [] }] });
        expect(await spot.enter(run)).toBe(false);
        expect(walked[0]).toEqual([2884, 3398]); // the Taverley dungeon ladder
    });

    test('ensureWorn: equips a carried shield; takes a banked one out first; with none owned, stays out of the spot', async () => {
        {
            const { run, sdk, item, equipped } = harness();
            sdk.push({ inventory: [item(SHIELD.name, SHIELD.id)] });
            expect(await run.ensureWorn(spot)).toBe(true);
            expect(equipped).toEqual(['Dragonfire shield']);
            expect(run.wearing(ANTI_DRAGON_SHIELD)).toBe(true);
        }
        {
            const { run, sdk, item } = harness();
            sdk.push({ bank: { ...sdk.state!.bank, items: [item(SHIELD.name, SHIELD.id), item('Dusty key', 1590), item('Shark', 385, 50)] } });
            expect(await run.ensureWorn(spot)).toBe(false);
            expect(run.carrying(/^dragonfire shield$/i)).toBe(true);
            expect(await run.ensureWorn(spot)).toBe(true);
        }
        {
            const { run, logs } = harness();
            expect(await run.ensureWorn(spot)).toBe(false);
            expect(await run.ensureWorn(spot)).toBe(false);
            expect(run.wearing(ANTI_DRAGON_SHIELD)).toBe(false);
            expect(logs.filter(l => /not worn, carried or banked/.test(String(l.message)))).toHaveLength(1);
        }
    });

    test('never targets a baby blue dragon, even the nearest one or one attacking the player', () => {
        const { run, sdk } = harness();
        const npc = (index: number, name: string, x: number, z: number, distance: number, inCombat = false) => ({
            index, name, x, z, distance, inCombat, hp: 50, optionsWithIndex: [{ text: 'Attack', opIndex: 2 }]
        } as NearbyNpc);
        const t = { npc: spot.npc, area: spot.area, centre: spot.centre, loot: null };
        const baby = TAVERLEY_BABIES[1]!;
        const adult = TAVERLEY_ADULTS[1]!;
        sdk.push({
            player: { ...sdk.state!.player!, worldX: 2903, worldZ: 9800, combat: { inCombat: true, targetType: 'npc', targetIndex: 7, lastDamageTick: 0 } },
            nearbyNpcs: [npc(7, 'Baby blue dragon', baby.x, baby.z, 1, true), npc(8, 'Blue dragon', adult.x, adult.z, 3)]
        });
        expect(run.pickTarget(t)?.index).toBe(8);
        sdk.push({ nearbyNpcs: [npc(7, 'Baby blue dragon', baby.x, baby.z, 1, true), npc(9, 'Baby blue dragon', 2892, 9799, 2)] });
        expect(run.pickTarget(t)).toBeNull();
    });

    test('an adult already hitting the player is fought first, even when the player faces another', () => {
        // Lab, 2026-10-24: the adult on the player was skipped as in combat, the player clicked another
        // (refused in single combat) and ate 4 sharks a kill.
        const { run, sdk } = harness();
        const adult = (index: number, x: number, z: number, distance: number, targetIndex: number) => ({
            index, name: 'Blue dragon', x, z, distance, inCombat: targetIndex !== -1, targetIndex, hp: 105, optionsWithIndex: [{ text: 'Attack', opIndex: 2 }]
        } as NearbyNpc);
        const t = { npc: spot.npc, area: spot.area, centre: spot.centre, loot: null };
        sdk.push({
            player: { ...sdk.state!.player!, worldX: 2901, worldZ: 9806, combat: { inCombat: true, targetType: 'npc', targetIndex: 3, lastDamageTick: 0 } },
            nearbyPlayers: [{ index: 12, name: 'cairn_h55', x: 2901, z: 9810 } as never],
            nearbyNpcs: [adult(3, 2897, 9797, 2, -1), adult(4, 2899, 9802, 3, 32768 + 40), adult(5, 2904, 9802, 1, 32768 + 12)]
        });
        expect(run.pickTarget(t)?.index).toBe(4); // faces slot 40, which no other visible player holds
    });

    test('facesMe: a player slot no other visible player holds', () => {
        const others = [{ index: 12 }, { index: 30 }];
        expect(facesMe({ targetIndex: 32768 + 40 }, others)).toBe(true);
        expect(facesMe({ targetIndex: 32768 + 12 }, others)).toBe(false);
        expect(facesMe({ targetIndex: 40 }, others)).toBe(false); // an npc slot
        expect(facesMe({ targetIndex: -1 }, others)).toBe(false);
    });

    test('gear upgrades never take the shield slot from the anti-dragon shield', async () => {
        const { run, sdk, item, equipped } = harness();
        sdk.push({
            equipment: [{ ...SHIELD, count: 1, slot: 5, optionsWithIndex: [] }],
            inventory: [item('Rune kiteshield', 1201), item('Adamant scimitar', 1331)]
        });
        await run.equipUpgrades();
        expect(equipped).toEqual(['Adamant scimitar']);
        expect(run.upgrade('Mithril kiteshield')).toBe(false); // a blue dragon drop
        expect(run.upgrade('Adamant full helm')).toBe(true);
    });

    test('a bank visit takes banked melee upgrades out for this spot to wield, and only for this spot', async () => {
        const banked = (h: ReturnType<typeof harness>) => h.sdk.push({
            equipment: [{ ...SHIELD, count: 1, slot: 5, optionsWithIndex: [] }, { name: 'Iron scimitar', id: 1323, count: 1, slot: 3, optionsWithIndex: [] }],
            bank: { ...h.sdk.state!.bank, items: [h.item('Adamant scimitar', 1331), h.item('Rune kiteshield', 1201), h.item('Dragon bones', 536, 40)] }
        });
        const h = harness();
        banked(h);
        expect(await h.run.bank('test', spot)).toBe(true);
        expect(h.sdk.state!.inventory.map(i => i.name)).toEqual(['Adamant scimitar']);
        await h.run.equipUpgrades();
        expect(h.equipped).toEqual(['Adamant scimitar']);

        const babies = harness('baby_blue');
        banked(babies);
        expect(await babies.run.bank('test', SPOTS.baby_blue!)).toBe(true);
        expect(babies.sdk.state!.inventory).toEqual([]);
    });

    test('a bank visit keeps a carried shield and takes one out when it is not worn', async () => {
        const { run, sdk, item } = harness();
        sdk.push({ inventory: [item(SHIELD.name, SHIELD.id), item('Dragon bones', 536)] });
        await run.bank('full', spot, run.tripKit());
        expect(run.carrying(/^dragonfire shield$/i)).toBe(true);
        expect(run.carrying(/^dragon bones$/i)).toBe(false);
        expect(run.tripKit().some(k => k.re.test('Dragonfire shield'))).toBe(true);
        sdk.push({ inventory: [], equipment: [{ ...SHIELD, count: 1, slot: 5, optionsWithIndex: [] }] });
        expect(run.tripKit().some(k => k.re.test('Dragonfire shield'))).toBe(false);
    });
});

describe('fixed-window bone measurements', () => {
    const from = '2026-10-21T10:00:00Z', until = '2026-10-21T11:00:00Z';
    const snapshot = (t: string, count: number) => ({ t, bank: [{ name: 'Babydragon bones', count }] });
    test('includes the first in-window deposit and uses the full wall-clock hour', () => {
        const r = summarizeWindow([
            snapshot('2026-10-21T09:50:00Z', 10),
            snapshot('2026-10-21T10:10:00Z', 30),
            snapshot('2026-10-21T10:50:00Z', 50),
            snapshot('2026-10-21T11:00:00Z', 70)
        ], from, until);
        expect(r.banked).toBe(40);
        expect(r.perHour).toBe(40);
    });
    test('missing baseline is unknown, not zero production', () => {
        expect(summarizeWindow([snapshot('2026-10-21T10:10:00Z', 30)], from, until).banked).toBeNull();
    });
    test('withdrawals invalidate a net-growth production estimate', () => {
        expect(summarizeWindow([
            snapshot('2026-10-21T09:50:00Z', 20),
            snapshot('2026-10-21T10:10:00Z', 10),
            snapshot('2026-10-21T10:50:00Z', 30)
        ], from, until).banked).toBeNull();
    });
    test('reports no deposit as zero when the baseline is known', () => {
        expect(summarizeWindow([snapshot('2026-10-21T09:50:00Z', 10)], from, until).banked).toBe(0);
    });
});
