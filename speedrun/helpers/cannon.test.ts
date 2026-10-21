import { describe, expect, test } from 'bun:test';
import { interfaceText, ironOreToBuy, isWest, nextWork, parseOptions, railingDamage, stageFromJournal, type Holdings } from './cannon';

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
