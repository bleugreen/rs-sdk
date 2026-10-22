import { describe, expect, test, spyOn } from 'bun:test';
import { FakeSdk, baseState } from '../lib/fake-sdk';
import type { BotSDK } from '../../sdk/index';
import type { BotActions } from '../../sdk/actions';
import type { BotWorldState, InventoryItem, NearbyNpc } from '../../sdk/types';
import { Run } from './bones';
import { memoryRoleState } from './role';
import { summarizeWindow } from '../../docs/speedrun/scripts/bones-dev/stats';
import { fishingHaul, gearRank, healOf, inBabyBlueRoom, inDesert, isClutter, keepOnBank, parseOptions, patrolTour, SPOTS, UGTHANKI_SPAWNS } from './bones';
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
