import { describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, PlayerState, QuestJournalState } from '../../sdk/types';
import { baseState, drive, FakeSdk, runeNeedProblems } from '../lib/fake-sdk';
import { sumUse } from '../lib/travel';
import { journalProbeName } from '../lib/quests';
import { TickLog } from '../lib/ticks';
import { Observation, resolveResume } from '../runner/resume';
import type { Observed, RunnerSession, StepContext } from '../runner/step';
import { DEFAULT_DIALOGUE } from './segments';
import { ARRIVAL, DEAD_AT_EXIT, defaultEatAt, eatForCrossing, LETTERS, MIN_FOOD, newTally, observed, QUEST_ITEMS, quest, railingDamage, RUNE_NEED, RUNE_USE, stepId, steps } from './dwarf-cannon';

let nextSlot = 0;
const item = (name: string, count = 1): InventoryItem => ({ slot: nextSlot++, id: 1000 + nextSlot, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
const skill = (name: string, level: number) => ({ name, level, baseLevel: level, experience: 0 });
const player = (x: number, z: number, hp = 42, level = 0): PlayerState => ({ name: 'lab', x, z, worldX: x, worldZ: z, level, hp, maxHp: 42 }) as PlayerState;
const sharks = (n: number) => Array.from({ length: n }, () => item('Shark'));
const runes = () => [item('Water rune', 3), item('Air rune', 3), item('Law rune', 3)];
const filler = (n: number) => Array.from({ length: n }, () => item('Bucket'));

/** SCORED on the arrival tile beside Lawgof at the run's levels, Plague City done, H10 held. */
function arrival(over: Partial<BotWorldState> = {}): BotWorldState {
    nextSlot = 0;
    return baseState({
        tick: 100,
        quests: { elena: 'complete' } as BotWorldState['quests'],
        skills: [skill('Magic', 76), skill('Hitpoints', 42), skill('Crafting', 1), skill('Smithing', 1)],
        player: player(ARRIVAL.x, ARRIVAL.z),
        inventory: [...runes(), ...sharks(MIN_FOOD)],
        ...over,
    });
}

const list = steps();
const letterOf = (name: string) => name.split(':')[1]!.split('-')[0]!;
const byLetter = (l: string) => list.find(s => letterOf(s.name) === l)!;

// ------------------------------------------------------------------ journal (mcannon_journal.rs2)

const HEAD = '@str@I have spoken to the Commander, he recruited me|@str@into the Black Guard and asked me to help the dwarves.||';
const JOURNAL: Record<string, string> = {
    '1': '@dbl@My first task is to @dre@fix the broken railings@dbl@ in the dwarves defensive perimeter.',
    '1+': '@str@I have repaired all the broken railings,|@dbl@I should report back to the Commander.',
    '2': '@str@I have repaired all the broken railings,|@dbl@The Commander has asked me to check up on his guards at @dre@the watchtower@dbl@ to the South of his camp.',
    '2+': '@str@I went to the watchtower where I found some dwarf|@str@remains.|@dbl@I should take them back to @dre@the Commander@dbl@.',
    '3': '@str@I gave the remains to the Commander.|@dbl@He sent me to find the @dre@Goblin base@dbl@.',
    '4': "@str@I found the Goblin's base.|@dbl@Next I need to find the @dre@Dwarf child@dbl@.",
    '5': '@str@I have rescued the dwarf child and sent him back to the|@str@Commander.|@dbl@I need to @dre@speak to the Commander@dbl@ again.',
    '6': '@dbl@The Commander has asked me to @dre@fix the multicannon@dbl@.',
    '8': "@str@I've fixed the broken multicannon,|@dbl@I need to @dre@speak to the Commander@dbl@ again.",
    '9': '@dbl@The Commander asked me to find @dre@Nulodion the Cannon Engineer@dbl@, he needs to know what @dre@ammunition the multicannon@dbl@ fires.',
    '10': "@str@I've spoken to Nulodion,|@str@He gave me an ammo mould and notes,|@dbl@I need to @dre@speak to the Commander@dbl@ again.",
};
const journal = (key: string): Pick<QuestJournalState, 'title' | 'lines'> => ({ title: 'Dwarf Cannon', lines: (HEAD + JOURNAL[key]!).split('|') });

/**
 * The observation at the start of each segment: the quest tab, the journal probe, the items the
 * quest has handed over by then, and where the segment before it ends. `null` journal: none read.
 */
const STARTS: Record<string, { stage: 'not' | 'started' | 'complete'; journal: string | null; items: string[]; at: [number, number, number?] }> = {
    A: { stage: 'not', journal: null, items: [], at: [2571, 3463] },
    B: { stage: 'started', journal: '1', items: Array(6).fill('Railing'), at: [2571, 3461] },
    C: { stage: 'started', journal: '1+', items: [], at: [2572, 3459] },
    D: { stage: 'started', journal: '2', items: [], at: [2571, 3461] },
    E: { stage: 'started', journal: '2+', items: ['Dwarf remains'], at: [2570, 3441, 2] },
    F: { stage: 'started', journal: '3', items: [], at: [2571, 3461] },
    G: { stage: 'started', journal: '4', items: [], at: [2620, 9797] },
    H: { stage: 'started', journal: '5', items: [], at: [2571, 9849] },
    I: { stage: 'started', journal: '6', items: ['Tool kit'], at: [2571, 3461] },
    J: { stage: 'started', journal: '8', items: ['Tool kit'], at: [2574, 3462] },
    K: { stage: 'started', journal: '9', items: ['Tool kit'], at: [2571, 3461] },
    L: { stage: 'started', journal: '10', items: ['Tool kit', "Nulodion's notes", 'Ammo mould'], at: [3016, 3453] },
};

function startOf(letter: string): Observed {
    const st = STARTS[letter]!;
    const s = arrival({ player: player(st.at[0], st.at[1], 42, st.at[2] ?? 0) });
    s.inventory.push(...st.items.map(n => item(n)));
    if (st.stage !== 'not') s.quests = { ...s.quests, [quest]: st.stage } as BotWorldState['quests'];
    return observed(s, st.journal ? journal(st.journal) : undefined);
}

/** The exit state: quest complete, the tool kit dropped (DEAD_AT_EXIT), or still held with `toolkit`. */
const complete = (toolkit = false): Observed => {
    const s = arrival({ quests: { elena: 'complete', [quest]: 'complete' } as BotWorldState['quests'] });
    if (toolkit) s.inventory.push(item('Tool kit'));
    return observed(s);
};

// ------------------------------------------------------------------ tests

describe('segment table', () => {
    test('names are unique, start with S13: and run A..L in order', () => {
        expect(stepId).toBe('S13');
        expect(quest).toBe('mcannon');
        expect(list.map(s => letterOf(s.name))).toEqual([...LETTERS]);
        expect(new Set(list.map(s => s.name)).size).toBe(list.length);
        expect(list.map(s => s.name)).toEqual([
            'S13:A-lawgof-start', 'S13:B-railings', 'S13:C-lawgof-railings', 'S13:D-watchtower', 'S13:E-lawgof-remains', 'S13:F-goblin-cave',
            'S13:G-lollk', 'S13:H-lawgof-toolkit', 'S13:I-shed', 'S13:J-lawgof-repaired', 'S13:K-nulodion', 'S13:L-lawgof-complete',
        ]);
    });

    test('every segment is logout-safe (every varp is perm) and every one leaves a durable mark', () => {
        expect(list.every(s => s.logoutSafe)).toBe(true);
        expect(list.every(s => typeof s.done === 'function')).toBe(true);
    });

    test('option defaults: the shared burst dialogue; both modes build the same table', () => {
        expect(DEFAULT_DIALOGUE).toBe('burst');
        expect(steps({ dialogue: 'fixed' }).map(s => s.name)).toEqual(list.map(s => s.name));
    });

    test('the journal probe is asked for wherever stages 1 and 2 need telling apart', () => {
        for (const l of ['B', 'C', 'D', 'E']) expect(byLetter(l).probes).toEqual([journalProbeName(quest)]);
    });
});

describe('A: the entry preconditions', () => {
    const pre = (s: BotWorldState) => byLetter('A').preconditions(s, {});

    test('pass on the arrival tile with the run\'s kit', () => {
        expect(pre(arrival())).toBe(true);
    });
    test('off the arrival tile fails, by coordinates', () => {
        expect(pre(arrival({ player: player(ARRIVAL.x + 2, ARRIVAL.z) }))).toMatch(/arrival tile/);
    });
    test('the quest already started fails', () => {
        expect(pre(arrival({ quests: { elena: 'complete', mcannon: 'started' } as BotWorldState['quests'] }))).toMatch(/Dwarf Cannon/);
    });
    test('Plague City not complete fails (the Ardougne teleport back)', () => {
        expect(pre(arrival({ quests: {} as BotWorldState['quests'] }))).not.toBe(true);
    });
    test('Magic below 51 fails', () => {
        expect(pre(arrival({ skills: [skill('Magic', 50), skill('Hitpoints', 42)] }))).toMatch(/Magic 50/);
    });
    test('short of the Falador and Ardougne runes fails', () => {
        const s = arrival();
        s.inventory = s.inventory.filter(i => i.name !== 'Law rune');
        expect(pre(s)).toMatch(/runes short/);
    });
    test('fewer than MIN_FOOD sharks fails, naming the count', () => {
        const s = arrival();
        s.inventory = [...runes(), ...sharks(MIN_FOOD - 1)];
        expect(pre(s)).toBe(`food: ${MIN_FOOD - 1} held, the railings want ${MIN_FOOD}`);
    });
    test('free slots must cover the six railings: 6 free passes, 5 names the shortfall', () => {
        const base = 3 + MIN_FOOD;
        const s6 = arrival();
        s6.inventory.push(...filler(28 - base - 6));
        expect(pre(s6)).toBe(true);
        const s5 = arrival();
        s5.inventory.push(...filler(28 - base - 5));
        expect(pre(s5)).toBe('inventory: segment A needs 6 free slots (6 Railing), 5 free: 1 short');
    });
});

describe('A with teleports: false (the demo throwaway walks K and L)', () => {
    const pre = (s: BotWorldState) => steps({ teleports: false })[0]!.preconditions(s, {});
    const throwaway = (hp: number) => arrival({ quests: {} as BotWorldState['quests'], skills: [skill('Magic', 1), skill('Hitpoints', hp)], inventory: sharks(MIN_FOOD) });

    test('no Magic 51, runes or Plague City needed; 30 Hitpoints is', () => {
        expect(pre(throwaway(30))).toBe(true);
        expect(pre(throwaway(29))).toBe('Hitpoints 29 is below 30 for the White Wolf Mountain walk');
    });
    test('the teleport path still refuses the same account', () => {
        expect(byLetter('A').preconditions(throwaway(30), {})).not.toBe(true);
    });
});

describe('eatForCrossing: the walk back starts fed, not on what the walk out left', () => {
    const SHARK_HEAL = 20;
    /** A 30 HP throwaway at `hp` holding `n` sharks; the fake server eats a shark the tick after each Eat click. */
    function crossing(hp: number, n: number) {
        nextSlot = 0;
        const shark = () => ({ ...item('Shark'), optionsWithIndex: [{ text: 'Eat', opIndex: 1 }] }) as unknown as InventoryItem;
        const s = baseState({ tick: 100, skills: [skill('Hitpoints', 30)], player: { ...player(2571, 3461, hp), maxHp: 30 }, inventory: Array.from({ length: n }, shark) });
        const sdk = new FakeSdk(s);
        let eat = false;
        sdk.onSend = a => { if (a.method === 'sendUseItem') eat = true; };
        const each = (st: BotWorldState): Partial<BotWorldState> => {
            if (!eat) return {};
            eat = false;
            return { player: { ...st.player!, hp: Math.min(30, st.player!.hp + SHARK_HEAL) }, inventory: st.inventory.slice(1) };
        };
        return { sdk, each, eats: () => sdk.sent.filter(a => a.method === 'sendUseItem').length };
    }

    test('at 12 HP it eats to the crossing target (30) before walking', async () => {
        const c = crossing(12, 3);
        const tally = newTally();
        await drive(c.sdk, eatForCrossing(c.sdk as never, /^shark$/i, tally), 60, c.each);
        expect(c.sdk.getState()!.player!.hp).toBe(30);
        expect(tally.eats).toBe(1);
        expect(c.eats()).toBe(1);
    });
    test('at 5 HP one shark is not enough: it eats again', async () => {
        const c = crossing(5, 3);
        const tally = newTally();
        await drive(c.sdk, eatForCrossing(c.sdk as never, /^shark$/i, tally), 60, c.each);
        expect(c.sdk.getState()!.player!.hp).toBe(30);
        expect(tally.eats).toBe(2);
    });
    test('rested already: no click', async () => {
        const c = crossing(30, 3);
        await drive(c.sdk, eatForCrossing(c.sdk as never, /^shark$/i, newTally()), 10, c.each);
        expect(c.eats()).toBe(0);
    });
    test('no food: no click, the crossing\'s own rest takes over', async () => {
        const c = crossing(12, 0);
        await drive(c.sdk, eatForCrossing(c.sdk as never, /^shark$/i, newTally()), 10, c.each);
        expect(c.eats()).toBe(0);
    });
});

describe('the free-slot need from each segment on', () => {
    test('railings at A-B are the peak; from B on the kit, notes and mould; nothing at L', () => {
        const need = (l: string) => {
            const s = startOf(l).state;
            const free = 28 - s.inventory.length;
            s.inventory.push(...filler(free));
            return byLetter(l).preconditions(s, {});
        };
        expect(need('D')).toBe('inventory: segment K needs 3 free slots (1 Tool kit, 1 Nulodion\'s notes, 1 Ammo mould), 0 free: 3 short');
        expect(need('H')).toBe('inventory: segment K needs 3 free slots (1 Tool kit, 1 Nulodion\'s notes, 1 Ammo mould), 0 free: 3 short');
        expect(need('K')).toBe('inventory: segment K needs 2 free slots (1 Nulodion\'s notes, 1 Ammo mould), 0 free: 2 short');
        expect(QUEST_ITEMS.map(q => q.name)).toEqual(['Railing', 'Dwarf remains', 'Tool kit', "Nulodion's notes", 'Ammo mould']);
    });
});

describe('done at each stage', () => {
    const order = [...LETTERS];
    for (const [i, l] of order.entries()) {
        test(`${l}: not done at its own start, done at the next segment's start`, () => {
            const step = byLetter(l);
            expect(step.done!(startOf(l), {})).toBe(false);
            const next = order[i + 1];
            expect(step.done!(next ? startOf(next) : complete(), {})).toBe(true);
        });
    }

    test('B and C read stage 1 apart from 2 only through the journal', () => {
        const tabOnly = (l: string) => observed(startOf(l).state);
        expect(byLetter('B').done!(tabOnly('C'), {})).toBe(false);
        expect(byLetter('C').done!(tabOnly('D'), {})).toBe(false);
    });

    test('D is done once the remains are held, journal or not', () => {
        expect(byLetter('D').done!(observed(startOf('E').state), {})).toBe(true);
    });

    test('K is not done at stage 10 if the notes or the mould went missing', () => {
        const o = startOf('L');
        o.state.inventory = o.state.inventory.filter(i => i.name !== 'Ammo mould');
        expect(byLetter('K').done!(o, {})).toBe(false);
    });
});

describe('resume from each segment', () => {
    for (const l of LETTERS) {
        test(`the resume walk starts ${l} from its start state`, async () => {
            const o = startOf(l) as Observed;
            const obs = new Observation(o.state);
            Object.assign(obs.probed, o.probed);
            const point = await resolveResume(list, obs, {});
            expect(point.step).toBe(byLetter(l).name);
            expect(point.mode).toBe('run');
        });
    }

    test('the quest complete with the tool kit dropped is finished', async () => {
        const obs = new Observation(complete().state);
        obs.probed[journalProbeName(quest)] = null;
        const point = await resolveResume(list, obs, {});
        expect(point.mode).toBe('finished');
    });
    test('the quest complete still holding the tool kit resumes L, to drop it', async () => {
        const obs = new Observation(complete(true).state);
        obs.probed[journalProbeName(quest)] = null;
        const point = await resolveResume(list, obs, {});
        expect(point.step).toBe('S13:L-lawgof-complete');
        expect(point.mode).toBe('run');
    });
});

describe('B: the railings', () => {
    test('damage is a tenth of base HP, at most 3; the eat line is three failures', () => {
        expect(railingDamage(42)).toBe(3);
        expect(railingDamage(25)).toBe(2);
        expect(railingDamage(9)).toBe(0);
        expect(defaultEatAt(42)).toBe(9);
    });

    test('no food and HP that one failure could take: refuses before any click', async () => {
        const s = startOf('B').state;
        s.inventory = s.inventory.filter(i => i.name !== 'Shark');
        s.player = player(2571, 3461, 3);
        const sdk = new FakeSdk(s);
        const session = { sdk, bot: {}, name: 'lab', sessionId: 0 } as unknown as RunnerSession;
        const ctx = { session, sdk, bot: session.bot, c: {}, log: TickLog.memory('t') } as unknown as StepContext<unknown>;
        await expect(byLetter('B').run(ctx)).rejects.toThrow(/HP 3 and no food: one failure \(3\) could kill/);
        expect(sdk.sent.filter(a => a.method === 'sendInteractLoc')).toEqual([]);
    });
});

describe('B: an Inspect whose choice opens after act.ts\'s re-send line is clicked once (the demo trace)', () => {
    const CHOICE_DELAY = 7; // the demo: the click at t, the search message at t+1, the choice at t+7
    const railingLoc = (x: number, z: number, id: number) => ({ x, z, id, level: 0, name: 'Damaged railing', distance: 1, optionsWithIndex: [{ text: 'Inspect', opIndex: 1 }] });
    const RAILS = [[2556, 3475, 15], [2558, 3472, 16], [2557, 3464, 17], [2559, 3462, 18], [2564, 3460, 19], [2572, 3460, 20]] as const;
    const choiceDialog = { isOpen: true, isWaiting: false, pageId: 'railing', options: [{ index: 1, text: 'Try to replace the railing.', buttonType: 1, componentId: 20 }, { index: 2, text: 'Leave it be.', buttonType: 1, componentId: 21 }] };

    for (const dialogue of ['burst', 'fixed'] as const) {
        test(`${dialogue}: six railings, six Inspect clicks, each fixed first try`, async () => {
            const s = startOf('B').state;
            s.player = player(2556, 3476, 42);
            s.nearbyLocs = RAILS.map(([x, z, id]) => railingLoc(x, z, id)) as unknown as BotWorldState['nearbyLocs'];
            s.gameMessages = [];
            const sdk = new FakeSdk(s);
            // The railing script as the real server runs it: a second Inspect during the delays restarts the search and shuts the choice.
            const events = new Map<number, (st: BotWorldState) => Partial<BotWorldState>>();
            const msg = (st: BotWorldState, ...text: string[]) => ({ gameMessages: [...st.gameMessages, ...text.map(t => ({ type: 0, tick: st.tick + 1, text: t }))] }) as Partial<BotWorldState>;
            let restarts = 0;
            sdk.onSend = (a, f) => {
                const t = f.state!.tick;
                if (a.method === 'sendInteractLoc') {
                    if (events.size || f.state!.dialog.isOpen) restarts++;
                    events.clear();
                    f.push({ dialog: { isOpen: false, options: [], isWaiting: false } });
                    events.set(t + 1, st => msg(st, 'You search the railing...'));
                    events.set(t + CHOICE_DELAY, () => ({ dialog: choiceDialog }) as Partial<BotWorldState>);
                } else if (/ClickDialog|clickDialogByText/.test(a.method) && f.state!.dialog.isOpen) {
                    f.push({ dialog: { isOpen: false, options: [], isWaiting: false } });
                    events.set(t + 3, st => msg(st, 'You attempt to replace the missing railing...', 'You replace the railing with no problems.'));
                }
            };
            const each = (st: BotWorldState): Partial<BotWorldState> => {
                const e = events.get(st.tick + 1);
                if (!e) return {};
                events.delete(st.tick + 1);
                return e(st);
            };
            const session = { sdk, bot: {}, name: 'lab', sessionId: 0 } as unknown as RunnerSession;
            const ctx = { session, sdk, bot: session.bot, c: {}, log: TickLog.memory('t') } as unknown as StepContext<unknown>;
            const tally = newTally();
            await drive(sdk, steps({ dialogue, tally })[1]!.run(ctx) as Promise<unknown>, 400, each);
            expect(restarts).toBe(0);
            expect(sdk.sent.filter(a => a.method === 'sendInteractLoc').length).toBe(6);
            expect(tally.railingTries).toBe(6);
            expect(tally.railingFails).toBe(0);
        });
    }
});

describe('I: the shed reads its replies by publication, on either client\'s stamping', () => {
    // The browser stamps a click's reply on the click's own tick, lite on the next (lib/world.ts
    // messageCursor); both publish it under a new observation id. A roll that opens no dialogue
    // ("can't quite find") is known only by its message.
    const LOC = { x: 2577, z: 3462, id: 5, level: 0, name: 'Broken multicannon', distance: 1, optionsWithIndex: [{ text: 'Inspect', opIndex: 1 }] };
    const PARTS_MENU = { isOpen: true, isWaiting: false, pageId: 'parts', options: ['Pipe', 'Barrel', 'Axle', 'Shaft', 'Nothing'].map((text, i) => ({ index: i + 1, text, buttonType: 1, componentId: 20 + i })) };
    const WORKING = { isOpen: true, isWaiting: false, pageId: 'working', options: [{ index: 1, text: 'Click here to continue', buttonType: 6, componentId: 10 }], allComponents: [{ text: 'The Cannon seems to be in working order, The Commander will be pleased.' }] };
    const CLOSED = { isOpen: false, options: [], isWaiting: false };
    const ROLLS = ['find', 'menu', 'find', 'find', 'menu', 'menu', 'menu', 'working'] as const;

    for (const client of ['browser', 'lite'] as const) {
        test(`${client}: one Inspect click per roll, no door toggled, every miss seen at once`, async () => {
            const s = startOf('I').state;
            s.player = player(2576, 3461, 42);
            s.nearbyLocs = [LOC] as unknown as BotWorldState['nearbyLocs'];
            s.gameMessages = [{ type: 0, tick: 90, text: 'Welcome to RuneScape.', observationId: 1 }] as BotWorldState['gameMessages'];
            const sdk = new FakeSdk(s);
            let publication = 1;
            const events = new Map<number, (st: BotWorldState) => Partial<BotWorldState>>();
            /** Messages published at the next tick, stamped `clickTick` (browser) or the tick they show on (lite). */
            const msg = (clickTick: number, ...text: string[]) => (st: BotWorldState): Partial<BotWorldState> => {
                publication++;
                const tick = client === 'browser' ? clickTick : st.tick + 1;
                return { gameMessages: [...st.gameMessages, ...text.map(t => ({ type: 0, tick, text: t, observationId: publication }))] } as Partial<BotWorldState>;
            };
            const at = (tick: number, e: (st: BotWorldState) => Partial<BotWorldState>) => {
                if (events.has(tick)) throw new Error(`fake server: two events at tick ${tick}`);
                events.set(tick, e);
            };
            let roll = 0;
            sdk.onSend = (a, f) => {
                const t = f.state!.tick;
                if (a.method === 'sendInteractLoc') {
                    const r = ROLLS[roll++];
                    if (r === 'find') at(t + 1, msg(t, 'You inspect the multi cannon.', "You try, but can't quite find the problem.", 'Maybe you should inspect it again.'));
                    else if (r === 'menu') {
                        at(t + 1, msg(t, 'You inspect the multi cannon.', 'You see that there are some damaged components.'));
                        at(t + 4, () => ({ dialog: PARTS_MENU }) as Partial<BotWorldState>);
                    } else {
                        at(t + 1, msg(t, 'You inspect the multi cannon.'));
                        at(t + 4, () => ({ dialog: WORKING }) as Partial<BotWorldState>);
                    }
                } else if (/ClickDialog|clickDialogByText/.test(a.method) && f.state!.dialog.isOpen) {
                    const menu = f.state!.dialog.pageId === 'parts';
                    f.push({ dialog: CLOSED });
                    if (menu) {
                        at(t + 1, msg(t, 'You use your tool kit and attempt to fix the part...'));
                        at(t + 4, msg(t + 3, 'After some tinkering you manage to fix it.'));
                    }
                }
            };
            const each = (st: BotWorldState): Partial<BotWorldState> => {
                const e = events.get(st.tick + 1);
                if (!e) return {};
                events.delete(st.tick + 1);
                return e(st);
            };
            const session = { sdk, bot: {}, name: 'lab', sessionId: 0 } as unknown as RunnerSession;
            const ctx = { session, sdk, bot: session.bot, c: {}, log: TickLog.memory('t') } as unknown as StepContext<unknown>;
            const tally = newTally();
            const t0 = sdk.state!.tick;
            const shed = steps({ tally }).find(x => letterOf(x.name) === 'I')!;
            await drive(sdk, shed.run(ctx) as Promise<unknown>, 300, each);
            expect(sdk.sent.filter(a => a.method === 'sendInteractLoc').length).toBe(ROLLS.length);
            expect(tally).toMatchObject({ shedInspects: 8, shedFindFails: 3, shedFixTries: 4, shedFixFails: 0 });
            // Each roll is a click, a reply on the next tick and at most the menu's p_delay and a fix: well under one 40-tick wait per miss.
            expect(sdk.state!.tick - t0).toBeLessThan(90);
        });
    }
});

describe('L: the exit state', () => {
    const post = (s: BotWorldState) => byLetter('L').postconditions(s, {});
    const done = (over: Partial<BotWorldState> = {}) => arrival({ quests: { elena: 'complete', mcannon: 'complete' } as BotWorldState['quests'], player: player(2571, 3461), ...over });

    test('complete, in the camp, nothing open passes', () => {
        expect(post(done())).toBe(true);
    });
    test('a page or the quest scroll still open fails', () => {
        expect(post(done({ modalOpen: true }))).toMatch(/still open/);
    });
    test('outside the camp fails', () => {
        expect(post(done({ player: player(3016, 3453) }))).toMatch(/Black Guard camp/);
    });
    test('still holding the tool kit fails: it is the one dead item at the exit', () => {
        expect(DEAD_AT_EXIT.map(String)).toEqual([String(/^tool kit$/i)]);
        const s = done();
        s.inventory.push(item('Tool kit'));
        expect(post(s)).toBe('exit: still holding Tool kit');
    });
    test('a resumed L with the quest already complete only drops the tool kit (no talk, no teleport)', async () => {
        const s = done();
        s.inventory.push(item('Tool kit'));
        const kit = s.inventory.at(-1)!;
        const sdk = new FakeSdk(s);
        let drop = false;
        sdk.onSend = a => { if (a.method === 'sendDropItem') drop = true; };
        const session = { sdk, bot: {}, name: 'lab', sessionId: 0 } as unknown as RunnerSession;
        const ctx = { session, sdk, bot: session.bot, c: {}, log: TickLog.memory('t') } as unknown as StepContext<unknown>;
        await drive(sdk, byLetter('L').run(ctx) as Promise<unknown>, 20, st => (drop ? { inventory: st.inventory.filter(i => i.slot !== kit.slot) } : {}));
        expect(sdk.sent.map(a => a.method)).toEqual(['sendDropItem']);
        expect(sdk.sent[0]!.args).toEqual([kit.slot]);
        expect(post(sdk.getState()!)).toBe(true);
    });
});

describe('K and L re-run after their teleport landed: no second cast', () => {
    const FALADOR = [2965, 3378] as const;
    const ARDOUGNE = [2661, 3301] as const;
    const ctxOf = (sdk: FakeSdk) => {
        const session = { sdk, bot: {}, name: 'lab', sessionId: 0 } as unknown as RunnerSession;
        return { session, sdk, bot: session.bot, c: {}, log: TickLog.memory('t') } as unknown as StepContext<unknown>;
    };
    /**
     * The step's spell clicks over `ticks` ticks, and its error: the fake world never moves the
     * player, so the step ends in an error or is still pending; what matters is which.
     */
    async function casts(o: Observed, letter: string, ticks: number): Promise<{ clicks: number; error: string }> {
        const sdk = new FakeSdk(o.state);
        const error = await drive(sdk, byLetter(letter).run(ctxOf(sdk)) as Promise<unknown>, ticks).then(() => '', (e: unknown) => (e instanceof Error ? e.message : String(e)));
        return { clicks: sdk.sent.filter(a => a.method === 'sendClickComponent').length, error };
    }
    /** `letter`'s start state, at `at`, with only `left` of the three casts' runes. */
    function landed(letter: string, at: readonly [number, number], left: InventoryItem[]): Observed {
        const o = startOf(letter);
        o.state.player = player(at[0], at[1]);
        o.state.inventory = [...o.state.inventory.filter(i => !/ rune$/.test(i.name)), ...left];
        return o;
    }
    const resumeAt = async (o: Observed) => {
        const obs = new Observation(o.state);
        Object.assign(obs.probed, o.probed);
        return resolveResume(list, obs, {});
    };

    // On the route SCORED reaches S13 with Fight Arena's 217-257 air (STEP-MANIFEST entry 16's exit
    // census), so a second Falador cast is affordable and would leave L one law rune short.
    test('K, at the Falador landing on the route\'s runes: the walk resumes K and K casts nothing', async () => {
        const o = landed('K', FALADOR, [item('Water rune', 2), item('Law rune', 2), item('Air rune', 217)]);
        const point = await resumeAt(o);
        expect(point.step).toBe('S13:K-nulodion');
        expect(point.mode).toBe('run');
        const r = await casts(o, 'K', 40);
        expect(r.clicks).toBe(0);
        expect(r.error).not.toMatch(/teleport/);
    });
    test('K, partway from the Falador landing to the Black Guard base on the route\'s runes: K casts nothing', async () => {
        const o = landed('K', [2990, 3415], [item('Water rune', 2), item('Law rune', 2), item('Air rune', 217)]);
        const point = await resumeAt(o);
        expect(point.step).toBe('S13:K-nulodion');
        expect(point.mode).toBe('run');
        const r = await casts(o, 'K', 40);
        expect(r.clicks).toBe(0);
        expect(r.error).not.toMatch(/teleport/);
    });
    test('L, at the Ardougne landing with no runes left: the walk resumes L and L casts nothing', async () => {
        const o = landed('L', ARDOUGNE, []);
        const point = await resumeAt(o);
        expect(point.step).toBe('S13:L-lawgof-complete');
        expect(point.mode).toBe('run');
        const r = await casts(o, 'L', 40);
        expect(r.clicks).toBe(0);
        expect(r.error).not.toMatch(/teleport/);
    });
    test('the normal path is unchanged: K from the camp and L from the Black Guard base each cast', async () => {
        expect((await casts(startOf('K'), 'K', 80)).clicks).toBeGreaterThan(0);
        expect((await casts(startOf('L'), 'L', 80)).clicks).toBeGreaterThan(0);
    });
});

describe('A: the food precondition reads the total held (H10 tops up to 8)', () => {
    test('3 sharks carried in plus 5 from H10 pass; 7 in all fail', () => {
        const s = arrival();
        s.inventory = [...runes(), ...sharks(3), item('Bucket'), ...sharks(5)];
        expect(byLetter('A').preconditions(s, {})).toBe(true);
        s.inventory.pop();
        expect(byLetter('A').preconditions(s, {})).toBe(`food: 7 held, the railings want ${MIN_FOOD}`);
    });
});

describe('rune pins: RUNE_USE and RUNE_NEED agree with the entry check (tools/rune-pins.ts)', () => {
    test("RUNE_NEED.A is exactly what A's travelNeeds wants held", () => {
        expect(runeNeedProblems(s => byLetter('A').preconditions(s, {}), arrival(), RUNE_NEED.A!)).toEqual([]);
    });
    test('the casts at K and L are the whole of it', () => {
        expect(sumUse(RUNE_USE.K!, RUNE_USE.L!)).toEqual(RUNE_NEED.A!);
    });
});
