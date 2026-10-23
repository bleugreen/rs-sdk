import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../../sdk/types';
import { baseState, FakeSdk } from '../../lib/fake-sdk';
import { hopNeeds, hopsDestination } from '../../lib/travel';
import * as mageArena from '../../quests/mage-arena';
import {
    attackSeen, BLOOD_RUNES, deliveryRequested, meetAt, CHARGE_COMPONENT, chargeProbe, DEATH_RUNES, inDragonRoom, inGuild, inTaverleyDungeon, MAX_CASTS, parseDeliveries, probeRows, probeTicks, routeOut, TAVERLEY_LADDER_UP, TO_CELLAR, type ProbeSample,
} from './mage-arena-charge';

const prevTick = process.env.SPEEDRUN_TICK_MS;
beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });
afterAll(() => { if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS; else process.env.SPEEDRUN_TICK_MS = prevTick; });

describe('probeTicks', () => {
    test('one cast, one tick of five, then singles: ten in all', () => {
        expect(probeTicks()).toEqual([1, 5, 1, 1, 1, 1]);
        expect(probeTicks(10, 5).reduce((a, n) => a + n, 0)).toBe(MAX_CASTS);
        expect(probeTicks(6, 5)).toEqual([1, 5]);
        expect(probeTicks(3, 5)).toEqual([1, 2]);
        expect(probeTicks(1)).toEqual([1]);
    });

    test('never more than ten casts or five clicks a tick', () => {
        expect(() => probeTicks(11)).toThrow(/casts/);
        expect(() => probeTicks(10, 6)).toThrow(/burst/);
        expect(() => probeTicks(0)).toThrow(/casts/);
    });
});

describe('probeRows', () => {
    test('casts per tick come from the blood spent since the tick before; clicks are those sent on the tick before', () => {
        const s = (tick: number, blood: number, xp: number, messages: string[] = []): ProbeSample => ({ tick, blood, air: blood, magicXp: xp, messages });
        const rows = probeRows([s(10, 30, 0), s(11, 27, 4500, ['You feel charged with magic power.']), s(12, 12, 27000), s(13, 12, 27000)], new Map([[10, 1], [11, 5]]));
        expect(rows.map(r => [r.tick, r.clicks, r.casts, r.xp])).toEqual([[11, 1, 1, 4500], [12, 5, 5, 22500], [13, 0, 0, 0]]);
        expect(rows[0]!.messages).toEqual(['You feel charged with magic power.']);
    });
});

describe('parseDeliveries', () => {
    test('takes [{from, item, n}] from cairn_ accounts only', () => {
        expect(parseDeliveries('[{"from":"cairn_h02","item":"Coins","n":100000}]')).toEqual([{ from: 'cairn_h02', item: 'Coins', n: 100000 }]);
        expect(parseDeliveries('[]')).toEqual([]);
        expect(() => parseDeliveries('[{"from":"zezima","item":"Coins","n":1}]')).toThrow(/cairn_/);
        expect(() => parseDeliveries('[{"from":"cairn_h02","item":"Coins","n":0}]')).toThrow(/positive/);
        expect(() => parseDeliveries('{}')).toThrow(/array/);
    });
});

describe('meetAt', () => {
    test('Varrock west (the couriers\' tile) or Yanille bank', () => {
        expect(meetAt('varrock').tile).toEqual({ x: 3185, z: 3436 });
        expect(meetAt('yanille').bank).toMatchObject({ x: 2613, z: 3092 });
        expect(() => meetAt('lumbridge')).toThrow(/--meet/);
    });
});

describe('deliveryRequested', () => {
    const owed = [{ from: 'cairn_h02', item: 'Coins', n: 100000 }, { from: 'cairn_h84', item: 'Prayer potion(3)', n: 2 }];
    test('answers only a giver that asked to trade, by its display name', () => {
        expect(deliveryRequested(owed, [{ sender: 'Cairn H84' }])?.from).toBe('cairn_h84');
        expect(deliveryRequested(owed, [{ sender: 'cairn_h02' }])?.from).toBe('cairn_h02');
        expect(deliveryRequested(owed, [{ sender: 'Cairn H85' }])).toBeUndefined();
        expect(deliveryRequested(owed, [])).toBeUndefined();
    });
});

describe('attackSeen', () => {
    const at = (x: number, z: number, hp: number, players: string[] = []): BotWorldState =>
        baseState({ tick: 5, player: { worldX: x, worldZ: z, level: 0, hp } as never, nearbyPlayers: players.map((name, i) => ({ name, index: i, distance: 3 })) as never });

    test('damage in the Wilderness with a player in view', () => {
        expect(attackSeen(at(3100, 3950, 90, ['pker']), at(3100, 3950, 70, ['pker']))).toMatchObject({ lost: 20, players: ['pker'] });
    });

    test('not outside the Wilderness, not without a player, not without damage', () => {
        expect(attackSeen(at(2543, 4713, 90, ['x']), at(2543, 4713, 70, ['x']))).toBeNull();
        expect(attackSeen(at(3100, 3950, 90), at(3100, 3950, 70))).toBeNull();
        expect(attackSeen(at(3100, 3950, 70, ['x']), at(3100, 3950, 80, ['x']))).toBeNull();
    });
});

describe('routeOut', () => {
    test('from the dragons\' safe tile: SAFE_ROUTE reversed, ending inside the dusty-key door', () => {
        const r = routeOut({ x: 2901, z: 9810 });
        expect(r[0]).toEqual({ x: 2901, z: 9810 });
        expect(r.at(-1)).toEqual({ x: 2923, z: 9803 });
        expect(r.length).toBe(23);
        expect(inDragonRoom({ x: 2901, z: 9810 })).toBe(true);
        expect(inDragonRoom({ x: 2925, z: 9803 })).toBe(false);
        // the ladder's foot is west of the door but outside the room
        expect(inDragonRoom({ x: 2884, z: 9798 })).toBe(false);
        expect(inTaverleyDungeon({ x: 2884, z: 9798 })).toBe(true);
        expect(inTaverleyDungeon({ x: 2543, z: 4713 })).toBe(false);
    });

    test('the ladder up is found near its foot and waits for the surface tile (both ends are level 0)', () => {
        const up = TAVERLEY_LADDER_UP[1]!;
        expect(up.kind).toBe('loc');
        if (up.kind !== 'loc') return;
        expect(up.loc.x).toBeUndefined();
        expect(up.arrive).toMatchObject({ x: 2884, z: 3397 });
        expect(inTaverleyDungeon(hopsDestination(TAVERLEY_LADDER_UP)!)).toBe(false);
    });

    test('from part-way along it starts at the nearest route tile', () => {
        expect(routeOut({ x: 2912, z: 9808 })[0]).toEqual({ x: 2912, z: 9808 });
    });
});

describe('inGuild', () => {
    const at = (x: number, z: number, level: number) => baseState({ player: { worldX: x, worldZ: z, level } as never });
    test('the ground floor and the store upstairs, not the street outside the east door', () => {
        expect(inGuild(at(2596, 3088, 0))).toBe(true);
        expect(inGuild(at(2594, 3087, 1))).toBe(true);
        expect(inGuild(at(2598, 3088, 0))).toBe(false);
        expect(inGuild(null)).toBe(false);
    });
});

describe('TO_CELLAR', () => {
    test('on foot (no Plague City: no Ardougne Teleport), a knife for the webs, ending in Kolodion\'s cellar', () => {
        expect(TO_CELLAR.some(h => h.kind === 'teleport')).toBe(false);
        expect(hopNeeds(TO_CELLAR).knife).toBe(true);
        const dest = hopsDestination(TO_CELLAR)!;
        expect(mageArena.inCellar(baseState({ player: { worldX: dest.x, worldZ: dest.z, level: 0 } as never }))).toBe(true);
    });

    test('the kit covers the fight and the probe', () => {
        expect(DEATH_RUNES).toBe(mageArena.SPELL_RUNES.fire_blast);
        expect(BLOOD_RUNES).toBe(30);
    });
});

describe('chargeProbe', () => {
    test('one batch per fresh tick; each tick applies up to five queued casts', async () => {
        const runes = (blood: number) => [{ id: 565, name: 'Blood rune', count: blood, slot: 0, optionsWithIndex: [] }, { id: 556, name: 'Air rune', count: blood, slot: 1, optionsWithIndex: [] }];
        const sdk = new FakeSdk(baseState({ tick: 100, inventory: runes(30) as never, skills: [{ name: 'Magic', level: 99, baseLevel: 99, experience: 0 }] as never, gameMessages: [] }));
        let queued = 0;
        sdk.onSend = a => { if (a.method === 'sendClickComponent' && a.args[0] === CHARGE_COMPONENT) queued++; };
        const timer = setInterval(() => sdk.tick(s => {
            const n = Math.min(5, queued);
            queued -= n;
            const blood = s.inventory[0]!.count - 3 * n;
            const xp = s.skills[0]!.experience + 4500 * n;
            return {
                inventory: runes(blood) as never,
                skills: [{ ...s.skills[0]!, experience: xp }] as never,
                gameMessages: [...s.gameMessages, ...Array.from({ length: n }, () => ({ type: 0, text: 'You feel charged with magic power.', tick: s.tick + 1, sender: '', fromSelf: false }))] as never,
            };
        }), 2);
        const r = await chargeProbe(sdk as never, [1, 5, 1], 3);
        clearInterval(timer);
        expect(sdk.sent.filter(a => a.method === 'sendClickComponent').length).toBe(7);
        expect(r.landed).toBe(7);
        expect(r.before.blood - r.after.blood).toBe(21);
        expect(r.rows.filter(x => x.clicks > 0).map(x => [x.clicks, x.casts])).toEqual([[1, 1], [5, 5], [1, 1]]);
        expect(r.messages.filter(m => /charged/.test(m)).length).toBe(7);
    });
});
