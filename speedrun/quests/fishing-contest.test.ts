import { describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, PlayerState, QuestJournalState } from '../../sdk/types';
import { baseState, drive, FakeSdk, runeNeedProblems } from '../lib/fake-sdk';
import { sumUse } from '../lib/travel';
import { journalProbeName } from '../lib/quests';
import { TickLog } from '../lib/ticks';
import { Observation, resolveResume } from '../runner/resume';
import type { Observed, RunnerSession, StepContext } from '../runner/step';
import { DEFAULT_DIALOGUE, slotNeed } from './segments';
import { ARRIVAL, DEAD_AT_EXIT, FENCE, inFence, inWood, LETTERS, observed, PIPE, QUEST_ITEMS, quest, RAILING, RUNE_NEED, RUNE_USE, stepId, steps } from './fishing-contest';

let nextSlot = 0;
const item = (name: string, count = 1): InventoryItem => ({ slot: nextSlot++, id: 1000 + nextSlot, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
const skill = (name: string, level: number) => ({ name, level, baseLevel: level, experience: 0 });
const player = (x: number, z: number, level = 0): PlayerState => ({ name: 'lab', x, z, worldX: x, worldZ: z, level, hp: 99, maxHp: 99 }) as PlayerState;
const filler = (n: number) => Array.from({ length: n }, () => item('Bucket'));

/** SCORED's pack after H16 on the self route: 8 slots (the slot ledger's walk, with the carp and bait swapped for a spade and garlic). */
const h16 = (kit = true) => [
    item('Water rune', 9), item('Air rune', 23), item('Law rune', 10), item('Body talisman'),
    ...(kit ? [item('Fishing rod'), item('Spade'), item('Garlic'), item('Coins', 5)] : []),
];

/** SCORED on the arrival tile at S20's levels with H16 held. */
function arrival(over: Partial<BotWorldState> = {}): BotWorldState {
    nextSlot = 0;
    return baseState({
        tick: 100,
        quests: {} as BotWorldState['quests'],
        skills: [skill('Fishing', 74), skill('Magic', 99), skill('Agility', 75)],
        player: player(ARRIVAL.x, ARRIVAL.z),
        inventory: h16(),
        ...over,
    });
}

const list = steps();
const letterOf = (name: string) => name.split(':')[1]!.split('-')[0]!;
const byLetter = (l: string) => list.find(s => letterOf(s.name) === l)!;

// ------------------------------------------------------------------ journal (fishingcompo_journal.rs2)

const HEAD = '@str@The Dwarves will let me use the tunnel through White Wolf|@str@Mountain if I can win the Hemenster Fishing Competition.|';
const JOURNAL: Record<string, string> = {
    started: '@dbl@They gave me a @dre@Fishing Contest Pass@dbl@ to enter the contest. I need to bring them back the @dre@Hemenster Fishing Trophy',
    in_comp: '@dbl@My @dre@fishing spot@dbl@ in the contest is @dre@next to the willow tree @dbl@I need to catch the @dre@biggest fish@dbl@ to win!',
    garlic_comp: '@dbl@My @dre@fishing spot@dbl@ in the contest is @dre@next to the pipes @dbl@I need to catch the @dre@biggest fish@dbl@ to win!',
    won_comp: '@str@I easily won the contest by catching some Giant Carp.|@dbl@I should take the @dre@Trophy@dbl@ back to the @dre@Dwarf@dbl@ at the side of @dre@White Wolf Mountain@dbl@ and claim my @dre@reward',
};
const journal = (stage: string): Pick<QuestJournalState, 'title' | 'lines'> => ({ title: 'Fishing Contest', lines: (HEAD + JOURNAL[stage]!).split('|') });

/**
 * Each segment's start state, where the segment before it ends: the quest tab, the journal, the
 * quest items handed over by then (kit lines spent so far removed) and the tile.
 */
type Start = { tab: 'not' | 'started' | 'complete'; journal: string | null; items: string[]; spent?: string[]; at: [number, number] };
const STARTS: Record<string, Start> = {
    A: { tab: 'not', journal: null, items: [], at: [2820, 3486] },
    C: { tab: 'started', journal: 'started', items: ['Fishing pass'], at: [2820, 3486] },
    D: { tab: 'started', journal: 'started', items: ['Fishing pass'], at: [2661, 3500] },
    E: { tab: 'started', journal: 'started', items: ['Fishing pass'], at: [2662, 3500] },
    F: { tab: 'started', journal: 'started', items: ['Fishing pass', 'Red vine worm'], at: [2631, 3500] },
    G: { tab: 'started', journal: 'started', items: ['Fishing pass', 'Red vine worm'], at: [2661, 3500] },
    H: { tab: 'started', journal: 'started', items: ['Fishing pass', 'Red vine worm'], at: [2643, 3441] },
    I: { tab: 'started', journal: 'started', items: ['Fishing pass', 'Red vine worm'], at: [2642, 3441] },
    J: { tab: 'started', journal: 'in_comp', items: ['Fishing pass', 'Red vine worm'], spent: ['Coins'], at: [2641, 3440] },
    K: { tab: 'started', journal: 'garlic_comp', items: ['Fishing pass', 'Red vine worm'], spent: ['Coins', 'Garlic'], at: [PIPE.x, PIPE.z] },
    L: { tab: 'started', journal: 'garlic_comp', items: ['Fishing pass', 'Raw giant carp'], spent: ['Coins', 'Garlic'], at: [2638, 3444] },
    M: { tab: 'started', journal: 'won_comp', items: ['Fishing pass', 'Fishing trophy'], spent: ['Coins', 'Garlic'], at: [2641, 3440] },
    N: { tab: 'started', journal: 'won_comp', items: ['Fishing pass', 'Fishing trophy'], spent: ['Coins', 'Garlic'], at: [2820, 3486] },
};

function startOf(letter: string, withJournal = true): Observed {
    const st = STARTS[letter]!;
    const s = arrival({ player: player(st.at[0], st.at[1]) });
    s.inventory = s.inventory.filter(i => !(st.spent ?? []).includes(i.name));
    s.inventory.push(...st.items.map(n => item(n)));
    if (st.tab !== 'not') s.quests = { [quest]: st.tab } as BotWorldState['quests'];
    return observed(s, withJournal && st.journal ? journal(st.journal) : undefined);
}

/** The exit state: quest complete beside the dwarf, the pass and spade dropped (`dead`: still held). */
const complete = (dead: string[] = []): BotWorldState => {
    const s = arrival({ quests: { [quest]: 'complete' } as BotWorldState['quests'] });
    s.inventory = s.inventory.filter(i => !['Coins', 'Garlic', 'Spade'].includes(i.name));
    s.inventory.push(...dead.map(n => item(n)));
    return s;
};

// ------------------------------------------------------------------ tests

describe('segment table', () => {
    test('names are unique, start with S20: and run A..N in order', () => {
        expect(stepId).toBe('S20');
        expect(quest).toBe('fishingcompo');
        expect(list.map(s => letterOf(s.name))).toEqual([...LETTERS]);
        expect(new Set(list.map(s => s.name)).size).toBe(list.length);
        expect(list.map(s => s.name)).toEqual([
            'S20:A-kit', 'S20:B-dwarf-pass', 'S20:C-to-railing', 'S20:D-railing-in', 'S20:E-vine-worm', 'S20:F-railing-out', 'S20:G-to-gate',
            'S20:H-gate', 'S20:I-bonzo-enter', 'S20:J-garlic-pipe', 'S20:K-carp', 'S20:L-bonzo-carp', 'S20:M-to-dwarf', 'S20:N-dwarf-trophy',
        ]);
    });

    test('inside the contest fence is logout-unsafe until the trophy: H (through the gate) to K', () => {
        expect(list.filter(s => !s.logoutSafe).map(s => letterOf(s.name))).toEqual(['H', 'I', 'J', 'K']);
    });

    test('durable marks: the pass, the worm, the entry, the garlic, the carp, the trophy, the completion; travel has none', () => {
        expect(list.filter(s => s.done).map(s => letterOf(s.name))).toEqual(['B', 'E', 'I', 'J', 'K', 'L', 'N']);
        for (const l of ['I', 'J', 'L']) expect(byLetter(l).probes).toEqual([journalProbeName(quest)]);
    });

    test('option defaults: the shared burst dialogue; both modes build the same table', () => {
        expect(DEFAULT_DIALOGUE).toBe('burst');
        expect(steps({ dialogue: 'fixed' }).map(s => s.name)).toEqual(list.map(s => s.name));
    });
});

describe('places, judged by coordinates', () => {
    const at = (x: number, z: number) => arrival({ player: player(x, z) });
    test("McGrubor's Wood is east of the railing; the outside tile and the fence lanes are not in it", () => {
        expect(inWood(at(RAILING.x, RAILING.z))).toBe(true);
        expect(inWood(at(RAILING.x - 1, RAILING.z))).toBe(false);
        expect(inWood(at(2631, 3500))).toBe(true); // beside the vine
        expect(inWood(at(2671, 3491))).toBe(true); // the inside trail
        expect(inWood(at(2670, 3509))).toBe(false); // the outside trail round the fence
        expect(inWood(at(2682, 3495))).toBe(false);
        expect(inWood(at(2651, 3469))).toBe(false); // the locked gate's outside
    });
    test('the fence: inside from the gate tile west, not the approach east of it', () => {
        expect(inFence(at(2642, 3441))).toBe(true);
        expect(inFence(at(2643, 3441))).toBe(false);
        expect(inFence(at(PIPE.x, PIPE.z))).toBe(true);
        expect(FENCE.x1).toBe(2642);
    });
});

describe('A: the entry preconditions', () => {
    const pre = (s: BotWorldState) => byLetter('A').preconditions(s, {});

    test("pass on the arrival tile with H16's kit and SCORED's pack", () => {
        expect(pre(arrival())).toBe(true);
    });
    test('refuse away from the arrival tile', () => {
        expect(pre(arrival({ player: player(2757, 3478) }))).toMatch(/arrival tile/);
    });
    test('refuse once the quest has started', () => {
        expect(pre(arrival({ quests: { [quest]: 'started' } as BotWorldState['quests'] }))).toMatch(/Fishing Contest/);
    });
    test('refuse without the two Camelot casts', () => {
        const s = arrival();
        s.inventory = s.inventory.map(i => (i.name === 'Air rune' ? { ...i, count: 9 } : i));
        expect(pre(s)).toMatch(/air/i);
    });
    test('refuse below Magic 45', () => {
        expect(pre(arrival({ skills: [skill('Fishing', 74), skill('Magic', 40)] }))).toBe('Magic: 40 is below 45 for the Camelot teleport');
    });
    test("the kit itself is the segment's postcondition (no bait: the worm is the bait)", () => {
        expect(byLetter('A').postconditions(arrival(), {})).toBe(true);
        const s = arrival();
        s.inventory = s.inventory.filter(i => i.name !== 'Spade');
        expect(byLetter('A').postconditions(s, {})).toMatch(/spade/i);
    });
});

describe('free slots (brief addendum 8)', () => {
    test('with the kit held the need peaks at 2, at E: the pass and the worm', () => {
        const need = slotNeed(arrival(), QUEST_ITEMS, LETTERS, 'A');
        expect(need.slots).toBe(2);
        expect(need.peak).toBe('E');
        expect(need.items).toEqual(['1 Fishing pass', '1 Red vine worm']);
    });
    test('the carp at K takes the garlic slot freed at J, not a third', () => {
        // Counted from A nothing is held yet, so the garlic credit is not taken and the carp counts
        // with the pass: the peak stays 2.
        expect(slotNeed(arrival(), QUEST_ITEMS, LETTERS, 'A').slots).toBe(2);
    });
    test('a resume into K asks 1 slot for the carp: conservative, since the catch swaps the worm for it in one script step', () => {
        expect(slotNeed(startOf('K').state as BotWorldState, QUEST_ITEMS, LETTERS, 'K')).toEqual({ slots: 1, peak: 'K', items: ['1 Raw giant carp'] });
    });
    test('without the kit, segment A also needs its four lines', () => {
        expect(slotNeed(arrival({ inventory: h16(false) }), QUEST_ITEMS, LETTERS, 'A').slots).toBe(6);
    });
    test('a full pack is refused with the shortfall named', () => {
        const s = arrival();
        s.inventory.push(...filler(27 - s.inventory.length));
        expect(byLetter('A').preconditions(s, {})).toBe('inventory: segment E needs 2 free slots (1 Fishing pass, 1 Red vine worm), 1 free: 1 short');
    });
});

describe('done, from the tab, the journal and the inventory', () => {
    test('B: the pass held at started; not without it (a lost pass is re-asked)', () => {
        expect(byLetter('B').done!(startOf('C'), {})).toBe(true);
        const o = startOf('C');
        o.state.inventory = o.state.inventory.filter(i => i.name !== 'Fishing pass');
        expect(byLetter('B').done!(o, {})).toBe(false);
    });
    test('E: the worm, then the carp, then the trophy each keep it done', () => {
        expect(byLetter('E').done!(startOf('E'), {})).toBe(false);
        for (const l of ['F', 'L', 'M']) expect(byLetter('E').done!(startOf(l), {})).toBe(true);
    });
    test('I and J read the sub-stages from the journal: the quest tab alone says only started', () => {
        expect(byLetter('I').done!(startOf('J'), {})).toBe(true);
        expect(byLetter('I').done!(startOf('J', false), {})).toBe(false);
        expect(byLetter('J').done!(startOf('J'), {})).toBe(false);
        expect(byLetter('J').done!(startOf('K'), {})).toBe(true);
    });
    test('L: the trophy held, or the journal at won_comp', () => {
        expect(byLetter('L').done!(startOf('L'), {})).toBe(false);
        expect(byLetter('L').done!(startOf('M', false), {})).toBe(true);
        const o = startOf('M');
        o.state.inventory = o.state.inventory.filter(i => i.name !== 'Fishing trophy');
        expect(byLetter('L').done!(o, {})).toBe(true);
    });
    test('N: complete with the dead items dropped', () => {
        expect(byLetter('N').done!(observed(complete()), {})).toBe(true);
        expect(byLetter('N').done!(observed(complete(['Fishing pass'])), {})).toBe(false);
    });
});

describe('resume from each segment start', () => {
    // A and B start on the same tile at the same stage; the walk takes B (the latest that can start)
    // only when the kit is held, and A otherwise.
    test('a fresh arrival with the kit resumes B (A is a no-op then); without the kit, A', async () => {
        const walk = async (s: BotWorldState) => (await resolveResume(list, new Observation(s), {})).step;
        expect(await walk(arrival())).toBe('S20:B-dwarf-pass');
        expect(await walk(arrival({ inventory: h16(false) }))).toBe('S20:A-kit');
    });
    for (const l of LETTERS.filter(x => x !== 'A' && x !== 'B')) {
        test(`the resume walk starts ${l} from its start state`, async () => {
            const o = startOf(l);
            const obs = new Observation(o.state);
            Object.assign(obs.probed, o.probed);
            if (!(journalProbeName(quest) in obs.probed)) obs.probed[journalProbeName(quest)] = null;
            const point = await resolveResume(list, obs, {});
            expect(point.step).toBe(byLetter(l).name);
            expect(point.mode).toBe('run');
        });
    }
    test('complete with the pass and spade dropped is finished', async () => {
        const obs = new Observation(complete());
        obs.probed[journalProbeName(quest)] = null;
        expect((await resolveResume(list, obs, {})).mode).toBe('finished');
    });
    test('complete still holding the pass resumes N, to drop it', async () => {
        const obs = new Observation(complete(['Fishing pass']));
        obs.probed[journalProbeName(quest)] = null;
        const point = await resolveResume(list, obs, {});
        expect(point.step).toBe('S20:N-dwarf-trophy');
    });
});

describe('M re-run at the Camelot landing with its last cast spent', () => {
    const CAMELOT = [2757, 3478] as const;
    /** M's start state at `at`, the trophy held, with no Camelot cast's runes left. */
    function spent(at: readonly [number, number]): Observed {
        const o = startOf('M');
        o.state.player = player(at[0], at[1]);
        o.state.inventory = o.state.inventory.filter(i => !/^(air|law) rune$/i.test(i.name));
        return o;
    }
    const walk = async (o: Observed) => {
        const obs = new Observation(o.state);
        Object.assign(obs.probed, o.probed);
        return resolveResume(list, obs, {});
    };

    /** M's run on the fake world (which goes nowhere): its spell clicks, and its error. */
    async function runM(o: Observed): Promise<{ clicks: number; error: string }> {
        const sdk = new FakeSdk(o.state);
        const session = { sdk, bot: {}, name: 'lab', sessionId: 0 } as unknown as RunnerSession;
        const ctx = { session, sdk, bot: session.bot, c: {}, log: TickLog.memory('t') } as unknown as StepContext<unknown>;
        const error = await drive(sdk, byLetter('M').run(ctx) as Promise<unknown>, 60).then(() => '', (e: unknown) => (e instanceof Error ? e.message : String(e)));
        return { clicks: sdk.sent.filter(a => a.method === 'sendClickComponent').length, error };
    }

    for (const [label, at] of [['on the landing', CAMELOT], ['partway to the tunnel', [2790, 3482]]] as const) {
        test(`${label}: the walk starts M through run, and M casts nothing and heads for the tunnel`, async () => {
            const o = spent(at);
            const point = await walk(o);
            expect(point.step).toBe('S20:M-to-dwarf');
            expect(point.mode).toBe('run');
            const r = await runM(o);
            expect(r.clicks).toBe(0);
            expect(r.error).not.toMatch(/teleport/i);
        });
    }
    test('the normal path is unchanged: M from the pipe casts; no cast left there still refuses', async () => {
        expect(byLetter('M').preconditions(startOf('M').state, {})).toBe(true);
        expect((await runM(startOf('M'))).clicks).toBeGreaterThan(0);
        await expect(walk(spent([2641, 3440]))).rejects.toThrow(/runes short|Law|Air/i);
    });
});

describe('N: the exit state and its drops (the slot ledger T20-21 drops, moved into the step)', () => {
    const post = (s: BotWorldState) => byLetter('N').postconditions(s, {});
    test('the pass and the raw shrimps are dead at the exit, and so is the spade; the rod, coins, runes and talisman are not', () => {
        const dead = (n: string) => DEAD_AT_EXIT.some(p => p.test(n));
        for (const n of ['Fishing pass', 'Raw shrimps', 'Spade', 'Raw sardine', 'Red vine worm']) expect(dead(n)).toBe(true);
        for (const n of ['Fishing rod', 'Coins', 'Law rune', 'Air rune', 'Water rune', 'Body talisman']) expect(dead(n)).toBe(false);
    });
    test('complete, beside the dwarf, nothing open, nothing dead passes', () => {
        expect(post(complete())).toBe(true);
    });
    test('still holding the pass or the raw shrimps fails', () => {
        expect(post(complete(['Fishing pass']))).toBe('exit: still holding Fishing pass');
        expect(post(complete(['Raw shrimps']))).toBe('exit: still holding Raw shrimps');
    });
    test('a resumed N with the quest already complete only drops the pass and the raw shrimps', async () => {
        const s = complete(['Fishing pass', 'Raw shrimps']);
        const deadSlots = s.inventory.filter(i => i.name === 'Fishing pass' || i.name === 'Raw shrimps').map(i => i.slot);
        const sdk = new FakeSdk(s);
        let dropped = false;
        sdk.onSend = a => { if (a.method === 'sendDropItem') dropped = true; };
        const session = { sdk, bot: {}, name: 'lab', sessionId: 0 } as unknown as RunnerSession;
        const ctx = { session, sdk, bot: session.bot, c: {}, log: TickLog.memory('t') } as unknown as StepContext<unknown>;
        await drive(sdk, byLetter('N').run(ctx) as Promise<unknown>, 20, st => (dropped ? { inventory: st.inventory.filter(i => !deadSlots.includes(i.slot)) } : {}));
        expect(sdk.sent.map(a => a.method)).toEqual(['sendDropItem', 'sendDropItem']);
        expect(sdk.sent.map(a => a.args[0]).sort()).toEqual([...deadSlots].sort());
        expect(post(sdk.getState()!)).toBe(true);
    });
});

describe('rune pins: RUNE_USE and RUNE_NEED agree with the entry check (tools/rune-pins.ts)', () => {
    test("RUNE_NEED.A is exactly what A's runesHeld wants held", () => {
        expect(runeNeedProblems(s => byLetter('A').preconditions(s, {}), arrival(), RUNE_NEED.A!)).toEqual([]);
    });
    test("C and M each want their own cast held (oneCast), and the two are the whole of it", () => {
        expect(runeNeedProblems(s => byLetter('C').preconditions(s, {}), startOf('C').state, RUNE_USE.C!)).toEqual([]);
        expect(sumUse(RUNE_USE.C!, RUNE_USE.M!)).toEqual(RUNE_NEED.A!);
    });
});
