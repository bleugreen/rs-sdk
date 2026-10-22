import { describe, expect, test } from 'bun:test';
import type { InventoryItem, TradeItem, TradeState } from '../../sdk/types';
import { baseState, FakeSdk, flush } from '../lib/fake-sdk';
import { offerSatisfies, planOffers } from '../lib/trade';
import { nameHash } from './altar-cue';
import { extraSpecs, holdsExtras, holdsLoad, interfaceText, ironOreToBuy, isWest, loadSpecs, loadStacks, loadWant, nextWork, parseOptions, railingDamage, serveOptions, serveResume, serveTrade, stageFromJournal, takeBackDelivered, takeBackFits, takeBackTrade, type Holdings } from './cannon';

// Journal pages as the lite client published them in the lab (interface 8134, `::setvar mcannon N`).
const JOURNAL: Record<number, string[]> = {
    0: ['I can start this quest by speaking to the Commander of', 'the Black Watch. He is defending an area north-west of', 'the Fishing Guild against goblin attack.'],
    1: ['I have spoken to the Commander, he recruited me', 'into the Black Guard and asked me to help the dwarves.', 'My first task is to fix the broken railings in the dwarves', 'defensive perimeter.'],
    2: ['I have spoken to the Commander, he recruited me', 'into the Black Guard and asked me to help the dwarves.', 'I have repaired all the broken railings,', 'The Commander has asked me to check up on his guards', 'at the watchtower to the South of his camp.'],
    5: ['I have spoken to the Commander, he recruited me', 'into the Black Guard and asked me to help the dwarves.', 'I have rescued the dwarf child and sent him back to the', 'Commander.', 'I need to speak to the Commander again.'],
    9: ['I have spoken to the Commander, he recruited me', 'into the Black Guard and asked me to help the dwarves.', 'The Commander asked me to find Nulodion the Cannon', 'Engineer, he needs to know what ammunition the', 'multicannon fires.'],
    10: ['I have spoken to the Commander, he recruited me', 'into the Black Guard and asked me to help the dwarves.', "I've spoken to Nulodion,", 'He gave me an ammo mould and notes,', 'I need to speak to the Commander again.'],
    11: ['I have spoken to the Commander, he recruited me', 'into the Black Guard and asked me to help the dwarves.', "I've helped the dwarves keep out the Goblins, and found", 'the remains of their friend.', 'I fixed the cannon and got a mould for the Commander.', 'I can now buy a multicannon from Nulodion as a reward.', 'QUEST COMPLETE!']
};

// The remaining stages' text, from mcannon_journal.rs2 with the colour tags stripped.
const FROM_SCRIPT: Record<string, string> = {
    1.5: 'I have repaired all the broken railings, I should report back to the Commander.',
    2.5: 'I went to the watchtower where I found some dwarf remains. I should take them back to the Commander.',
    3: 'I gave the remains to the Commander. He sent me to find the Goblin base.',
    4: "I found the Goblin's base. Next I need to find the Dwarf child.",
    6: 'The Commander has asked me to fix the multicannon.',
    8: "I've fixed the broken multicannon, I need to speak to the Commander again."
};

const debugLines = (lines: string[]) => ['#8134 type=0 btn=0 text=""', '  #8136 type=4 btn=3 text="Close Window"', ...lines.map((t, i) => `    #${8145 + i} type=4 btn=0 text="${t}"`)];

const SERVE_SCOPE = { step: 'S14', family: 'cannon' } as const;
const so = (raw: Record<string, unknown>, env?: Record<string, string | undefined>) => serveOptions(raw.receiver === undefined ? { scope: SERVE_SCOPE, ...raw } : raw, env);

describe('stageFromJournal', () => {
    for (const [stage, lines] of Object.entries(JOURNAL)) {
        test(`lab page for stage ${stage}`, () => {
            expect(stageFromJournal(interfaceText(debugLines(lines)))?.stage).toBe(Number(stage));
        });
    }
    test('stage 1 with every railing fixed', () => {
        expect(stageFromJournal(FROM_SCRIPT['1.5']!)).toEqual({ stage: 1, railingsDone: true });
        expect(stageFromJournal(JOURNAL[1]!.join(' '))).toEqual({ stage: 1, railingsDone: false });
    });
    test('stage 2 carrying the remains', () => expect(stageFromJournal(FROM_SCRIPT['2.5']!)?.stage).toBe(2));
    test('stages 3, 4, 6 and 8 from the script text', () => {
        for (const s of [3, 4, 6, 8]) expect(stageFromJournal(FROM_SCRIPT[String(s)]!)?.stage).toBe(s);
    });
    test('another quest or nothing is null', () => {
        expect(stageFromJournal('')).toBeNull();
        expect(stageFromJournal('Close Window')).toBeNull();
    });
});

test('interfaceText keeps only non-empty text components', () => {
    expect(interfaceText(debugLines(['a', '', 'b']))).toBe('Close Window a b');
});

test('railing damage is base Hitpoints / 10, at most 3', () => {
    expect(railingDamage(10)).toBe(1);
    expect(railingDamage(19)).toBe(1);
    expect(railingDamage(29)).toBe(2);
    expect(railingDamage(30)).toBe(3);
    expect(railingDamage(99)).toBe(3);
});

test('the mountain splits west from east', () => {
    expect(isWest({ x: 2571, z: 3461 })).toBe(true); // Lawgof
    expect(isWest({ x: 2571, z: 9850 })).toBe(true); // the goblin cave
    expect(isWest({ x: 2880, z: 3410 })).toBe(false); // Taverley
    expect(isWest({ x: 3011, z: 3453 })).toBe(false); // Nulodion
});

describe('nextWork', () => {
    const o = { balls: 1160, sets: 2, steelMaxPrice: 0 };
    const fresh: Holdings = { smithing: 1, mould: false, copper: 0, tin: 0, ironOre: 0, steelBars: 0, balls: 0, sets: 0, coins: 46_000 };
    const at = (h: Partial<Holdings>) => nextWork({ ...fresh, ...h }, o);
    test('Smithing 1-14: mine copper and tin, smelt them once both are held', () => {
        expect(at({})).toBe('mine-bronze');
        expect(at({ copper: 13 })).toBe('mine-bronze');
        expect(at({ copper: 2, tin: 2 })).toBe('mine-bronze');
        expect(at({ copper: 13, tin: 13 })).toBe('smelt-bronze');
    });
    test('Smithing 15-34: buy iron ore, smelt it; leftover copper is ignored', () => {
        expect(at({ smithing: 15, copper: 3 })).toBe('buy-iron-ore');
        expect(at({ smithing: 34, ironOre: 1 })).toBe('smelt-iron');
    });
    test('Smithing 35: the mould, then balls while steel lasts, else wait for steel', () => {
        expect(at({ smithing: 35 })).toBe('mould');
        expect(at({ smithing: 35, mould: true, steelBars: 27 })).toBe('cannonballs');
        expect(at({ smithing: 35, mould: true })).toBe('await-supplies');
    });
    test('with steelMaxPrice, steel is bought at the exchange while the coins last', () => {
        const buying = { ...o, steelMaxPrice: 1_600 };
        const h = { ...fresh, smithing: 35, mould: true };
        expect(nextWork({ ...h, coins: 37_000 }, buying)).toBe('buy-steel');
        expect(nextWork({ ...h, coins: 1_000 }, buying)).toBe('await-supplies');
        expect(nextWork({ ...h, coins: 37_000, steelBars: 5 }, buying)).toBe('cannonballs');
    });
    test('a set is bought as soon as its coins are in hand, otherwise after the balls', () => {
        expect(at({ coins: 750_000 })).toBe('sets');
        expect(at({ smithing: 40, mould: true, balls: 1160 })).toBe('sets');
        expect(at({ smithing: 40, mould: true, balls: 1160, sets: 2, coins: 2_000_000 })).toBe('done');
    });
});

test('iron ore comes in whole inventories, more at low Smithing, none at 35', () => {
    expect(ironOreToBuy(15)).toBe(81);
    expect(ironOreToBuy(29)).toBe(54);
    expect(ironOreToBuy(33)).toBe(27);
    expect(ironOreToBuy(35)).toBe(0);
});

test('options default to two sets and 1,160 balls from any helper', () => {
    const o = parseOptions({});
    expect(o.sets).toBe(2);
    expect(o.balls).toBe(1160);
    expect(o.stopAfter).toBeNull();
    expect(o.funders.some(r => r.test('cairn_h60'))).toBe(true);
});

describe('serve mode', () => {
    const inv = (items: [string, number][]): InventoryItem[] =>
        items.map(([name, count], slot) => ({ slot, id: 100 + slot, name, count, optionsWithIndex: [] }) as unknown as InventoryItem);
    const LOAD: [string, number][] = [['Cannon base', 1], ['Cannon stand', 1], ['Cannon barrels', 1], ['Cannon furnace', 1], ['Cannonball', 100]];

    test('options: tile and balls are required; the receiver is a hash, never a name', () => {
        expect(() => so({ balls: 100 })).toThrow(/serve.tile/);
        expect(() => so({ tile: { x: 1, z: 2 } })).toThrow(/serve.balls/);
        expect(() => so({ tile: { x: 1, z: 2 }, balls: 100, receiver: 'Some Player' })).toThrow(/not a name/);
        const hash = nameHash('Some Player');
        const o = so({ tile: { x: 2570, z: 3463 }, balls: 100, receiver: hash.toUpperCase() }, {});
        expect(o).toMatchObject({ tile: { x: 2570, z: 3463 }, balls: 100, receiver: hash, returnTile: null, labStock: false, noReplyTicks: 2, resendTicks: 100 });
        expect(o.bank).toEqual({ x: 2946, z: 3369 }); // Falador west, where h92 banks
    });

    test('options: the cue scope is required without a receiver hash, and must be a cannon one', () => {
        expect(() => serveOptions({ tile: { x: 1, z: 2 }, balls: 1 }, {})).toThrow(/^serve.scope: a cue scope/);
        expect(() => serveOptions({ tile: { x: 1, z: 2 }, balls: 1, scope: { step: 'S14', family: 'bone' } }, {})).toThrow(/serve.scope.family must be cannon/);
        expect(serveOptions({ tile: { x: 1, z: 2 }, balls: 1, receiver: 'a'.repeat(64) }, {}).scope).toBeNull();
    });

    test('options: without a receiver hash it is read from the cue directory', () => {
        const o = so({ tile: { x: 1, z: 2 }, balls: 1, returnTile: { x: 2661, z: 3301 } }, { RC_CUE_DIR: '/tmp/cue-x' });
        expect(o.receiver).toBeNull();
        expect(o.cueDir).toBe('/tmp/cue-x');
        expect(o.returnTile).toEqual({ x: 2661, z: 3301 });
    });

    test('a hand-off is resumed from ctx.state, never given twice', () => {
        const at = '2026-10-21T00:00:00Z';
        expect(serveResume(undefined, false, false)).toBe('give');
        expect(serveResume({ phase: 'giving', at }, true, true)).toBe('give'); // the trade never completed
        expect(serveResume({ phase: 'giving', at }, false, true)).toBe('uncertain');
        expect(serveResume({ phase: 'gave', at }, false, true)).toBe('take-back');
        expect(serveResume({ phase: 'gave', at }, true, false)).toBe('done');
        expect(serveResume({ phase: 'returned', at }, true, true)).toBe('done');
        expect(so({ tile: { x: 1, z: 2 }, balls: 100 }, {}).id).toBe('1,2x100');
        expect(so({ id: 'H11', tile: { x: 1, z: 2 }, balls: 100 }, {}).id).toBe('H11');
    });

    test('parseOptions: serve is off unless given', () => {
        expect(parseOptions({}).serve).toBeNull();
        expect(parseOptions({ serve: { tile: { x: 1, z: 2 }, balls: 5, scope: SERVE_SCOPE } }).serve?.balls).toBe(5);
    });

    test('the exact load is five offers of one All press each: one trade, nothing left behind', () => {
        const plan = planOffers(inv(LOAD), loadSpecs(100));
        expect(plan.map(e => e.name)).toEqual(LOAD.map(([n]) => n));
        expect(plan.every(e => e.amounts.length === 1 && e.amounts[0] === -1)).toBe(true);
        expect(plan.map(e => e.expected)).toEqual([1, 1, 1, 1, 100]);
    });

    test('the take-back (ANY_OFFER): whatever the scored account offers comes back in the same trade, re-accepted after its offer resets both accepts', async () => {
        const load = inv(LOAD);
        const mine: TradeItem[] = load.map((i, slot) => ({ slot, id: i.id, name: i.name, count: i.count }));
        const bow: TradeItem[] = [{ slot: 0, id: 861, name: 'Magic shortbow', count: 1 }];
        const trade = (t: Partial<TradeState>): TradeState => ({ isOpen: true, screen: 'offer', partner: 'Scored Player', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false, ...t });
        const sdk = new FakeSdk(baseState({ tick: 1, inventory: load, trade: trade({}) }));
        const methods = () => sdk.sent.splice(0).map(a => a.method);
        const r = serveTrade(sdk, 'Scored Player', 100);
        await flush();
        // Five All presses and the accept behind them.
        expect(methods()).toEqual(['sendOfferItem', 'sendOfferItem', 'sendOfferItem', 'sendOfferItem', 'sendOfferItem', 'sendAcceptTrade']);
        // The bow lands after our accept: both accepts reset, and we accept again on the next frame.
        sdk.tick({ inventory: [], trade: trade({ myOffer: mine, theirOffer: bow }) });
        await flush();
        expect(methods()).toEqual(['sendAcceptTrade']);
        // Not twice on one frame's republication, and not while our accept stands.
        sdk.tick({ trade: trade({ myOffer: mine, theirOffer: bow, myAccepted: true }) });
        await flush();
        expect(methods()).toEqual([]);
        sdk.tick({ trade: trade({ screen: 'confirm', myOffer: mine, theirOffer: bow, partnerAccepted: true }) });
        await flush();
        expect(methods()).toEqual(['sendAcceptTrade']);
        sdk.tick({ inventory: [{ slot: 0, id: 861, name: 'Magic shortbow', count: 1, optionsWithIndex: [] } as unknown as InventoryItem], trade: undefined });
        await flush();
        const out = await r;
        expect(out.ok).toBe(true);
        expect(out.gave.map(i => i.name).sort()).toEqual(LOAD.map(([n]) => n).sort());
    });

    describe('serve extras (H11: mithril scimitar, law 4, water 4, shark 2; H23: the magic shortbow)', () => {
        const H11_EXTRAS = [{ item: 'Mithril scimitar', count: 1 }, { item: 'Law rune', count: 4 }, { item: 'Water rune', count: 4 }, { item: 'Shark', count: 2 }];
        /** The load as carried: parts and balls, then each extra (an unstackable one in one slot per item, all one id). */
        const carried = (extras: { item: string; count: number }[]): InventoryItem[] => {
            const out = inv(LOAD);
            for (const [k, e] of extras.entries()) {
                const slots = /shark|scimitar|shortbow|potion/i.test(e.item) ? e.count : 1;
                for (let s = 0; s < slots; s++) out.push({ slot: out.length, id: 500 + k, name: e.item, count: e.count / slots, optionsWithIndex: [] } as unknown as InventoryItem);
            }
            return out;
        };

        test('options: extras are distinct items outside the load, and the load fits 28 slots', () => {
            const o = so({ id: 'H11', tile: { x: 1, z: 2 }, balls: 100, extras: H11_EXTRAS }, {});
            expect(o.extras).toEqual(H11_EXTRAS);
            // 4 parts + balls + scimitar + law + water + 2 sharks.
            expect(loadStacks(o.extras)).toBe(10);
            expect(so({ tile: { x: 1, z: 2 }, balls: 1 }, {}).extras).toEqual([]);
            // 23 sharks fill the last slots exactly; one more is 29.
            expect(so({ tile: { x: 1, z: 2 }, balls: 1, extras: [{ item: 'Shark', count: 23 }] }, {}).extras).toHaveLength(1);
            expect(() => so({ tile: { x: 1, z: 2 }, balls: 1, extras: [{ item: 'Shark', count: 24 }] }, {})).toThrow(/29 slots/);
            expect(() => so({ tile: { x: 1, z: 2 }, balls: 1, extras: [{ item: 'Shark', count: 1 }, { item: 'shark', count: 1 }] }, {})).toThrow(/twice/);
            expect(() => so({ tile: { x: 1, z: 2 }, balls: 1, extras: [{ item: 'Cannonball', count: 10 }] }, {})).toThrow(/already in the load/);
            expect(() => so({ tile: { x: 1, z: 2 }, balls: 1, extras: [{ item: 'Shark', count: 0 }] }, {})).toThrow(/whole count/);
            expect(() => so({ tile: { x: 1, z: 2 }, balls: 1, labStock: true, extras: [{ item: 'Shark', count: 2 }] }, {})).toThrow(/needs obj/);
            expect(so({ tile: { x: 1, z: 2 }, balls: 1, labStock: true, extras: [{ item: 'Shark', count: 2, obj: 'shark' }] }, {}).extras[0]!.obj).toBe('shark');
        });

        test('the extras are one more All press each, in the same offer as the set and balls', () => {
            const plan = planOffers(carried(H11_EXTRAS), loadSpecs(100, H11_EXTRAS));
            expect(plan.map(e => [e.name, e.expected])).toEqual([...LOAD, ...H11_EXTRAS.map(e => [e.item, e.count])]);
            expect(plan.every(e => e.amounts.length === 1 && e.amounts[0] === -1)).toBe(true);
            // A potion's parentheses are matched literally.
            const potion = [{ item: 'Ranging potion(4)', count: 3 }];
            expect(planOffers(carried(potion), loadSpecs(100, potion)).map(e => e.name)).toContain('Ranging potion(4)');
            expect(holdsLoad(carried(potion), 100, potion)).toBe(true);
            expect(holdsLoad(carried([{ item: 'Ranging potion4', count: 3 }]), 100, potion)).toBe(false);
        });

        test('holdsLoad counts every extra', () => {
            expect(holdsLoad(carried(H11_EXTRAS), 100, H11_EXTRAS)).toBe(true);
            expect(holdsLoad(carried(H11_EXTRAS.slice(0, 3)), 100, H11_EXTRAS)).toBe(false);
            expect(holdsLoad(carried([...H11_EXTRAS.slice(0, 3), { item: 'Shark', count: 1 }]), 100, H11_EXTRAS)).toBe(false);
        });

        test('H11 serve: the set, balls and extras go out in one trade, nothing comes back, and the confirm screen is accepted', async () => {
            const load = carried(H11_EXTRAS);
            const mine: TradeItem[] = load.map(i => ({ slot: i.slot, id: i.id, name: i.name, count: i.count }));
            const trade = (t: Partial<TradeState>): TradeState => ({ isOpen: true, screen: 'offer', partner: 'Scored Player', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false, ...t });
            const sdk = new FakeSdk(baseState({ tick: 1, inventory: load, trade: trade({}) }));
            const methods = () => sdk.sent.splice(0).map(a => a.method);
            const r = serveTrade(sdk, 'Scored Player', 100, H11_EXTRAS);
            await flush();
            // Nine All presses (5 for the load, 4 extras) and the accept behind them.
            expect(methods()).toEqual([...Array(9).fill('sendOfferItem'), 'sendAcceptTrade']);
            sdk.tick({ trade: trade({ myOffer: mine, myAccepted: true, partnerAccepted: true }) });
            await flush();
            sdk.tick({ trade: trade({ screen: 'confirm', myOffer: mine, partnerAccepted: true }) });
            await flush();
            expect(methods()).toEqual(['sendAcceptTrade']);
            sdk.tick({ inventory: [], trade: undefined });
            await flush();
            const out = await r;
            expect(out.ok).toBe(true);
            expect(new Set(out.gave.map(i => i.name))).toEqual(new Set([...LOAD.map(([n]) => n), ...H11_EXTRAS.map(e => e.item)]));
        });
    });

    describe('return extras (H11r: Monkey Madness\'s magic shortbow and 200 rune arrows go out as the set comes back)', () => {
        const MM = [{ item: 'Magic shortbow', count: 1 }, { item: 'Rune arrow', count: 200 }];
        const H11_EXTRAS = [{ item: 'Mithril scimitar', count: 1 }, { item: 'Law rune', count: 4 }, { item: 'Water rune', count: 4 }, { item: 'Shark', count: 2 }];
        const base = { id: 'H11', tile: { x: 1, z: 2 }, balls: 100, returnTile: { x: 2661, z: 3301 } };
        const item = (slot: number, id: number, name: string, count: number) => ({ slot, id, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
        /** What the holder carries after the H11 give: the bow and the arrows, nothing else. */
        const held = (): InventoryItem[] => [item(0, 861, 'Magic shortbow', 1), item(1, 892, 'Rune arrow', 200)];
        const SET_BACK: [string, number][] = [['Cannon base', 1], ['Cannon stand', 1], ['Cannon barrels', 1], ['Cannon furnace', 1], ['Cannonball', 30]];
        const setBack = (from: number) => SET_BACK.map(([name, count], i) => item(from + i, 6 + i, name, count));
        const trade = (t: Partial<TradeState>): TradeState => ({ isOpen: true, screen: 'offer', partner: 'Scored Player', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false, ...t });
        const offered = (items: InventoryItem[]): TradeItem[] => items.map((i, slot) => ({ slot, id: i.id, name: i.name, count: i.count }));

        test('options: parsed like extras, need returnTile, and stay apart from the load and the extras', () => {
            const o = so({ ...base, extras: H11_EXTRAS, returnExtras: MM }, {});
            expect(o.returnExtras).toEqual(MM);
            expect(so(base, {}).returnExtras).toEqual([]);
            expect(() => so({ ...base, returnTile: undefined, returnExtras: MM }, {})).toThrow(/needs serve.returnTile/);
            expect(() => so({ ...base, returnExtras: { item: 'Rune arrow', count: 200 } }, {})).toThrow(/^serve.returnExtras must be a list/);
            expect(() => so({ ...base, returnExtras: [{ item: 'Rune arrow', count: 0 }] }, {})).toThrow(/^serve.returnExtras\[0\] needs an item name and a whole count/);
            expect(() => so({ ...base, returnExtras: [{ item: 'Rune arrow', count: 2.5 }] }, {})).toThrow(/whole count/);
            expect(() => so({ ...base, returnExtras: [...MM, { item: 'rune arrow', count: 1 }] }, {})).toThrow(/serve.returnExtras lists rune arrow twice/);
            expect(() => so({ ...base, returnExtras: [{ item: 'Cannon base', count: 1 }] }, {})).toThrow(/serve.returnExtras: Cannon base is already in the load/);
            expect(() => so({ ...base, returnExtras: [{ item: 'Cannonball', count: 1 }] }, {})).toThrow(/already in the load/);
            expect(() => so({ ...base, extras: [{ item: 'Magic shortbow', count: 1 }], returnExtras: MM }, {})).toThrow(/Magic shortbow is in serve.extras too/);
            expect(() => so({ ...base, labStock: true, returnExtras: MM }, {})).toThrow(/serve.returnExtras\[0\] needs obj/);
            expect(so({ ...base, labStock: true, returnExtras: [{ item: 'Rune arrow', count: 200, obj: 'rune_arrow' }] }, {}).returnExtras[0]!.obj).toBe('rune_arrow');
            // Carried from the start: the load (5), H11's extras (5) and these (2) share 28 slots.
            expect(() => so({ ...base, extras: [{ item: 'Shark', count: 22 }], returnExtras: MM }, {})).toThrow(/29 slots/);
            expect(so({ ...base, extras: [{ item: 'Shark', count: 21 }], returnExtras: MM }, {}).returnExtras).toHaveLength(2);
            expect(parseOptions({ serve: { ...base, scope: SERVE_SCOPE, returnExtras: MM } }).serve?.returnExtras).toEqual(MM);
        });

        test('carried exactly, the bow and the arrows are one All press each: no X offer', () => {
            const plan = planOffers(held(), extraSpecs(MM));
            expect(plan.map(e => [e.name, e.amounts, e.expected])).toEqual([['Magic shortbow', [-1], 1], ['Rune arrow', [-1], 200]]);
            expect(holdsExtras(held(), MM)).toBe(true);
            expect(holdsExtras(held().slice(0, 1), MM)).toBe(false);
            expect(holdsExtras([], [])).toBe(true);
        });

        test('room to take back: the offered extras free their slots (trade.rs2 enough_trade_space)', () => {
            expect(takeBackFits(held(), MM)).toBe(true);
            const junk = (n: number) => Array.from({ length: n }, (_, i) => item(2 + i, 1000 + i, `Junk ${i}`, 1));
            // 23 other slots and 5 coming in is 28; 24 is one too many.
            expect(takeBackFits([...held(), ...junk(23)], MM)).toBe(true);
            expect(takeBackFits([...held(), ...junk(24)], MM)).toBe(false);
            expect(takeBackFits(junk(24), [])).toBe(false);
        });

        test('H11r swap: the bow and 200 arrows out, the set and leftover balls in, one trade, delivered both ways', async () => {
            const mine = offered(held());
            const theirs = offered(setBack(0));
            const sdk = new FakeSdk(baseState({ tick: 1, inventory: held(), trade: trade({}) }));
            const sent = () => sdk.sent.splice(0).map(a => [a.method, ...a.args]);
            const r = takeBackTrade(sdk, 'Scored Player', MM);
            await flush();
            // Two All presses (slot, -1) and the accept behind them.
            expect(sent()).toEqual([['sendOfferItem', 0, -1], ['sendOfferItem', 1, -1], ['sendAcceptTrade']]);
            // The scored account's offer lands after our accept and resets both: we accept again.
            sdk.tick({ inventory: [], trade: trade({ myOffer: mine, theirOffer: theirs, partnerAccepted: true }) });
            await flush();
            expect(sent()).toEqual([['sendAcceptTrade']]);
            sdk.tick({ trade: trade({ screen: 'confirm', myOffer: mine, theirOffer: theirs, partnerAccepted: true }) });
            await flush();
            expect(sent()).toEqual([['sendAcceptTrade']]);
            sdk.tick({ inventory: setBack(0), trade: undefined });
            await flush();
            const out = await r;
            expect(out.ok).toBe(true);
            expect(out.gave.map(i => [i.name, i.count]).sort()).toEqual([['Magic shortbow', 1], ['Rune arrow', 200]]);
            expect(out.received.map(i => [i.name, i.count]).sort()).toEqual([...SET_BACK].sort());
            expect(takeBackDelivered(out, MM)).toBe(true);
        });

        test('H11r swap: no accept while the scored account\'s offer lacks a part, and a confirm offer without the set is declined', async () => {
            const mine = offered(held());
            const short = offered(setBack(0).filter(i => i.name !== 'Cannon furnace'));
            const sdk = new FakeSdk(baseState({ tick: 1, inventory: held(), trade: trade({}) }));
            const methods = () => sdk.sent.splice(0).map(a => a.method);
            const r = takeBackTrade(sdk, 'Scored Player', MM);
            await flush();
            methods();
            sdk.tick({ inventory: [], trade: trade({ myOffer: mine, theirOffer: short, partnerAccepted: true }) });
            await flush();
            expect(methods()).toEqual([]);
            sdk.tick({ trade: trade({ screen: 'confirm', myOffer: mine, theirOffer: short, partnerAccepted: true }) });
            await flush();
            expect(methods()).toEqual(['sendDeclineTrade']);
            const out = await r;
            expect(out.ok).toBe(false);
            expect(takeBackDelivered(out, MM)).toBe(false);
        });

        test('without return extras the take-back is receive-only, as before: nothing offered, the set in', async () => {
            const theirs = offered(setBack(0));
            const sdk = new FakeSdk(baseState({ tick: 1, inventory: [], trade: trade({ theirOffer: theirs, partnerAccepted: true }) }));
            const methods = () => sdk.sent.splice(0).map(a => a.method);
            const r = takeBackTrade(sdk, 'Scored Player', []);
            await flush();
            expect(methods()).toEqual(['sendAcceptTrade']);
            sdk.tick({ trade: trade({ screen: 'confirm', theirOffer: theirs, partnerAccepted: true }) });
            await flush();
            expect(methods()).toEqual(['sendAcceptTrade']);
            sdk.tick({ inventory: setBack(0), trade: undefined });
            await flush();
            const out = await r;
            expect(out.ok).toBe(true);
            expect(out.gave).toEqual([]);
            expect(takeBackDelivered(out, [])).toBe(true);
        });

        test('delivered both ways means the set in and every return extra out', () => {
            const traded = (items: InventoryItem[]) => offered(items);
            expect(takeBackDelivered({ ok: true, received: traded(setBack(0)), gave: traded(held()) }, MM)).toBe(true);
            expect(takeBackDelivered({ ok: true, received: traded(setBack(0)), gave: traded(held().slice(0, 1)) }, MM)).toBe(false);
            expect(takeBackDelivered({ ok: true, received: traded(setBack(0).slice(1)), gave: traded(held()) }, MM)).toBe(false);
            expect(takeBackDelivered({ ok: false, received: traded(setBack(0)), gave: traded(held()) }, MM)).toBe(false);
        });

        test('restart between the give and the take-back: the extras still held, the take-back is still to do', () => {
            const at = '2026-10-22T00:00:00Z';
            // After the give, before the take-back trade: the extras are held.
            expect(serveResume({ phase: 'gave', at }, false, true, true)).toBe('take-back');
            // Restarted mid-give with the load gone: taken as given, then the take-back.
            expect(serveResume({ phase: 'giving', at }, false, true, true)).toBe('uncertain');
            // Restarted mid-take-back: the extras back in the pack mean the trade never completed.
            expect(serveResume({ phase: 'returning', at }, false, true, true)).toBe('take-back');
            expect(serveResume({ phase: 'returning', at }, false, true, false)).toBe('uncertain-return');
            expect(serveResume({ phase: 'returned', at }, false, true, false)).toBe('done');
            // What serveRun reads after the H11 give: the H11 extras gone, the bow and arrows held.
            expect(holdsLoad(held(), 100, H11_EXTRAS)).toBe(false);
            expect(holdsExtras(held(), MM)).toBe(true);
        });
    });

    test('holdsLoad needs every part and enough balls', () => {
        expect(holdsLoad(inv(LOAD), 100)).toBe(true);
        expect(holdsLoad(inv(LOAD), 101)).toBe(false);
        expect(holdsLoad(inv(LOAD.filter(([n]) => n !== 'Cannon furnace')), 1)).toBe(false);
        expect(holdsLoad(inv([]), 1)).toBe(false);
    });

    test('the receiver wants the whole set and the balls; the take-back wants the set, balls optional', () => {
        const offer = (items: [string, number][]): TradeItem[] => items.map(([name, count], i) => ({ slot: i, id: 100 + i, name, count }));
        expect(offerSatisfies(loadWant(100), offer(LOAD))).toBe(true);
        expect(offerSatisfies(loadWant(100), offer(LOAD.slice(0, 4)))).toBe(false);
        expect(offerSatisfies(loadWant(100), offer([...LOAD.slice(0, 4), ['Cannonball', 99]]))).toBe(false);
        expect(offerSatisfies(loadWant(0), offer(LOAD.slice(0, 4)))).toBe(true);
        expect(offerSatisfies(loadWant(0), offer(LOAD.slice(1)))).toBe(false);
    });
});
