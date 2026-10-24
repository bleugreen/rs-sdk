import { describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, PlayerState, QuestJournalState } from '../../sdk/types';
import { QUESTS } from '../data/quest-stages';
import { baseState, drive, FakeSdk, simulateWalking } from '../lib/fake-sdk';
import { journalProbeName } from '../lib/quests';
import { TickLog } from '../lib/ticks';
import { Observation, resolveResume } from '../runner/resume';
import type { Observed, RunnerSession, StepContext } from '../runner/step';
import { loadHandOff } from '../runner/handoff';
import { DEFAULT_DIALOGUE, kitWant, slotNeed } from './segments';
import {
    ARRIVAL, bravekInReach, CLERK_STAND, DEAD_AT_EXIT, doorsBetween, inBasement, inBravekRoom, inCell, inEast, inPlagueHouse, inRehnison, inSewer, inWest, inWestStreets,
    ITEM, judgeScrollRead, KIT, LETTERS, observed, QUEST_ITEMS, quest, stepId, steps,
} from './plague-city';

// ------------------------------------------------------------------ scripted state

const NAMES: Record<number, string> = {
    [ITEM.dwellberries]: 'Dwellberries', [ITEM.water]: 'Bucket of water', [ITEM.bucket]: 'Bucket', [ITEM.spade]: 'Spade', [ITEM.rope]: 'Rope',
    [ITEM.dust]: 'Chocolate dust', [ITEM.milk]: 'Bucket of milk', [ITEM.chocMilk]: 'Chocolaty milk', [ITEM.snape]: 'Snape grass',
    [ITEM.cure]: 'Hangover cure', [ITEM.gasmask]: 'Gas mask', [ITEM.picture]: 'Picture', [ITEM.book]: 'Book', [ITEM.note]: 'A scruffy note',
    [ITEM.warrant]: 'Warrant', [ITEM.key]: 'A small key', [ITEM.scroll]: 'A magic scroll',
};
let nextSlot = 0;
const item = (id: number, count = 1, name = NAMES[id] ?? `obj ${id}`): InventoryItem =>
    ({ slot: nextSlot++, id, name, count, optionsWithIndex: id === ITEM.scroll ? [{ text: 'Read', opIndex: 1 }] : [] }) as unknown as InventoryItem;
const own = () => [item(946, 1, 'Knife'), item(1511, 1, 'Logs'), item(563, 2, 'Law rune')];
const H6 = () => [ITEM.dwellberries, ITEM.water, ITEM.water, ITEM.water, ITEM.water, ITEM.spade, ITEM.rope, ITEM.dust, ITEM.milk, ITEM.snape].map(id => item(id));
const skill = (name: string, level: number) => ({ name, level, baseLevel: level, experience: 0 });
const player = (x: number, z: number, level = 0): PlayerState => ({ name: 'lab', x, z, worldX: x, worldZ: z, level, hp: 10, maxHp: 10 }) as PlayerState;
const staff = () => item(1383, 1, 'Staff of water');
const mask = () => item(ITEM.gasmask, 1, 'Gas mask');

/** SCORED on Edmond's tile at S08's levels with its pack and H6. */
function arrival(over: Partial<BotWorldState> = {}): BotWorldState {
    nextSlot = 0;
    return baseState({
        tick: 100,
        quests: {} as BotWorldState['quests'],
        skills: [skill('Magic', 59), skill('Mining', 49)],
        player: player(ARRIVAL.x, ARRIVAL.z),
        inventory: [...own(), ...H6()],
        equipment: [staff()],
        ...over,
    });
}

/** The journal at `stage` (elena_journal.rs2), from the markers quest-stages.ts reads. 20-21 have none. */
function journal(stage: number): Pick<QuestJournalState, 'title' | 'lines'> {
    const marker = QUESTS.elena.stages.find(s => s.value === stage && 'journal' in s && s.journal) as { journal?: string } | undefined;
    return { title: 'Plague City', lines: ["@str@I've spoken to Jethick.", `@dbl@${marker?.journal ?? "I've returned a book to the Rehnisons."}`] };
}

type Start = { stage: number; ids: number[]; at: [number, number, number?]; worn?: boolean };
/** Each segment's start state, where the segment before it ends (the lab fixtures' table). */
const AFTER_ALRENA = [ITEM.water, ITEM.water, ITEM.water, ITEM.water, ITEM.spade, ITEM.rope, ITEM.dust, ITEM.milk, ITEM.snape];
const AFTER_CURE = [ITEM.water, ITEM.water, ITEM.water, ITEM.water, ITEM.spade, ITEM.rope, ITEM.cure];
const AFTER_MUD = [ITEM.bucket, ITEM.bucket, ITEM.bucket, ITEM.bucket, ITEM.spade, ITEM.rope, ITEM.cure];
const AFTER_ROPE = [ITEM.bucket, ITEM.bucket, ITEM.bucket, ITEM.bucket, ITEM.spade, ITEM.cure];
const AFTER_BRAVEK = [ITEM.bucket, ITEM.bucket, ITEM.bucket, ITEM.bucket, ITEM.spade];
const P = ITEM.picture;
const M = ITEM.gasmask;
const STARTS: Record<string, Start> = {
    C: { stage: 1, ids: [ITEM.dwellberries, ...AFTER_ALRENA], at: [2568, 3334] },
    D: { stage: 1, ids: [P, ITEM.dwellberries, ...AFTER_ALRENA], at: [2576, 3334] },
    E: { stage: 2, ids: [P, M, ...AFTER_ALRENA], at: [2573, 3334] },
    F: { stage: 3, ids: [P, M, ...AFTER_ALRENA], at: [2568, 3334] },
    G: { stage: 3, ids: [P, M, ...AFTER_CURE], at: [2568, 3334] },
    H: { stage: 7, ids: [P, M, ...AFTER_MUD], at: [2567, 3332] },
    I: { stage: 8, ids: [P, M, ...AFTER_MUD], at: [2562, 9737] },
    J: { stage: 9, ids: [P, M, ...AFTER_ROPE], at: [2530, 9703] },
    K: { stage: 10, ids: [P, M, ...AFTER_ROPE], at: [2535, 9718] },
    L: { stage: 10, ids: [P, ...AFTER_ROPE], at: [2529, 3304], worn: true },
    M: { stage: 20, ids: [P, ITEM.book, ...AFTER_ROPE], at: [2539, 3305], worn: true },
    N: { stage: 21, ids: [P, ...AFTER_ROPE], at: [2531, 3329], worn: true },
    O: { stage: 22, ids: [P, ...AFTER_ROPE], at: [2531, 3330], worn: true },
    P: { stage: 23, ids: [P, ...AFTER_ROPE], at: [2531, 3330], worn: true },
    Q: { stage: 24, ids: [P, ...AFTER_ROPE], at: [2533, 3273], worn: true },
    S: { stage: 26, ids: [P, ITEM.note, ...AFTER_ROPE], at: [2535, 3314], worn: true },
    T: { stage: 27, ids: [P, ITEM.note, ITEM.warrant, ...AFTER_BRAVEK], at: [2535, 3314], worn: true },
    U: { stage: 27, ids: [P, ITEM.note, ITEM.warrant, ...AFTER_BRAVEK], at: [2533, 3271], worn: true },
    V: { stage: 27, ids: [P, ITEM.note, ITEM.warrant, ITEM.key, ...AFTER_BRAVEK], at: [2533, 3269], worn: true },
    W: { stage: 27, ids: [P, ITEM.note, ITEM.warrant, ITEM.key, ...AFTER_BRAVEK], at: [2537, 9670], worn: true },
    X: { stage: 28, ids: [P, ITEM.note, ITEM.warrant, ITEM.key, ...AFTER_BRAVEK], at: [2540, 9672], worn: true },
    Y: { stage: 28, ids: [P, ITEM.note, ITEM.warrant, ITEM.key, ...AFTER_BRAVEK], at: [2567, 3333], worn: true },
    Z: { stage: 29, ids: [ITEM.scroll, ...AFTER_BRAVEK], at: [2567, 3333], worn: true },
};

function stateAt(st: Start): BotWorldState {
    const s = arrival({ player: player(st.at[0], st.at[1], st.at[2] ?? 0) });
    s.inventory = [...own(), ...st.ids.map(id => item(id))];
    if (st.worn) s.equipment = [staff(), mask()];
    s.quests = { [quest]: st.stage >= 29 ? 'complete' : st.stage > 0 ? 'started' : 'not_started' } as BotWorldState['quests'];
    return s;
}
function startOf(letter: string, withJournal = true): Observed {
    const st = STARTS[letter]!;
    return observed(stateAt(st), withJournal && st.stage > 0 && st.stage < 29 ? journal(st.stage) : undefined);
}
async function resumeAt(o: Observed): Promise<{ step: string | null; mode: string }> {
    const obs = new Observation(o.state);
    Object.assign(obs.probed, o.probed);
    if (!(journalProbeName(quest) in obs.probed)) obs.probed[journalProbeName(quest)] = null;
    const r = await resolveResume(list, obs, {});
    return { step: r.step, mode: r.mode };
}

/** The exit state: complete beside Edmond, the scroll read and the leftovers dropped (`extra`: still held). */
const exitState = (extra: number[] = [], masked = false): BotWorldState => {
    const s = arrival({ quests: { [quest]: 'complete' } as BotWorldState['quests'], player: player(2567, 3333) });
    s.inventory = [...own(), ...extra.map(id => item(id))];
    if (masked) s.equipment = [staff(), mask()];
    return s;
};

const list = steps();
const letterOf = (name: string) => name.split(':')[1]!.split('-')[0]!;
const byLetter = (l: string) => list.find(s => letterOf(s.name) === l)!;

// ------------------------------------------------------------------ tests

describe('segment table', () => {
    test('names are unique, start with S08: and run A..Z in order', () => {
        expect(stepId).toBe('S08');
        expect(quest).toBe('elena');
        expect(list.map(s => letterOf(s.name))).toEqual([...LETTERS]);
        expect(new Set(list.map(s => s.name)).size).toBe(26);
        expect(list[0]!.name).toBe('S08:A-kit');
        expect(list.at(-1)!.name).toBe('S08:Z-scroll');
    });
    test('logout-safe throughout (every var is perm; the pipe cooldown is 6 ticks)', () => {
        expect(list.every(s => s.logoutSafe)).toBe(true);
    });
    test('durable marks on every stage, item and the exit; travel (K, T, V, X) and the kit have none', () => {
        expect(list.filter(s => !s.done).map(s => letterOf(s.name))).toEqual(['A', 'K', 'T', 'V', 'X']);
        for (const l of ['C', 'D', 'E', 'G', 'M', 'Q', 'W']) expect(byLetter(l).probes).toEqual([journalProbeName(quest)]);
    });
    test('option defaults: the shared burst dialogue; both modes build the same table', () => {
        expect(DEFAULT_DIALOGUE).toBe('burst');
        expect(steps({ dialogue: 'fixed' }).map(s => s.name)).toEqual(list.map(s => s.name));
    });
});

describe('places, judged by coordinates', () => {
    const at = (x: number, z: number, level = 0) => arrival({ player: player(x, z, level) });
    test('the garden, the sewer, the basement and the cell', () => {
        expect(inEast(at(2568, 3334))).toBe(true);
        expect(inEast(at(2566, 3331))).toBe(true); // the mud pile's landing
        expect(inSewer(at(2562, 9737))).toBe(true);
        expect(inSewer(at(2537, 9670))).toBe(false);
        expect(inBasement(at(2537, 9670))).toBe(true);
        expect(inCell(at(2540, 9672))).toBe(true);
        expect(inCell(at(2539, 9672))).toBe(false); // the door's own tile is outside
    });
    test('West Ardougne: the streets, the Rehnisons (both floors), Bravek, the plague house', () => {
        expect(inWestStreets(at(2529, 3304))).toBe(true);
        expect(inRehnison(at(2531, 3329))).toBe(true);
        expect(inRehnison(at(2531, 3327))).toBe(false);
        expect(inWest(at(2530, 3331, 1))).toBe(true);
        expect(inBravekRoom(at(2535, 3314))).toBe(true);
        expect(inBravekRoom(at(CLERK_STAND.x, CLERK_STAND.z))).toBe(false);
        expect(inPlagueHouse(at(2533, 3271))).toBe(true);
        expect(inPlagueHouse(at(2533, 3272))).toBe(false);
    });
    test("the clerk's reach: Bravek within 7 tiles of SCORED", () => {
        const s = at(CLERK_STAND.x, CLERK_STAND.z);
        const bravek = (x: number) => ({ ...s, nearbyNpcs: [{ index: 1, name: 'Bravek', x, z: 3314, optionsWithIndex: [] }] as unknown as BotWorldState['nearbyNpcs'] });
        expect(bravekInReach(bravek(2536))).toBe(true); // his spawn, from east of the desk
        expect(bravekInReach(bravek(2537))).toBe(false);
        expect(bravekInReach(s)).toBe(false); // not in sight: not in reach
    });
});

describe('A: the entry preconditions', () => {
    const pre = (s: BotWorldState) => byLetter('A').preconditions(s, {});
    test("pass on Edmond's tile with SCORED's pack and H6", () => {
        expect(pre(arrival())).toBe(true);
    });
    test('refuse away from the arrival tile', () => {
        expect(pre(arrival({ player: player(2757, 3478) }))).toMatch(/arrival tile/);
    });
    test('refuse once the quest has started', () => {
        expect(pre(arrival({ quests: { [quest]: 'started' } as BotWorldState['quests'] }))).toMatch(/Plague City/);
    });
    test('refuse below Magic 45', () => {
        expect(pre(arrival({ skills: [skill('Magic', 40)] }))).toMatch(/magic 40\/45/i);
    });
    test("the kit is the segment's postcondition (H6, its runes included)", () => {
        expect(byLetter('A').postconditions(arrival(), {})).toBe(true);
        const s = arrival();
        s.inventory = s.inventory.filter(i => i.id !== ITEM.rope);
        expect(byLetter('A').postconditions(s, {})).toMatch(/rope/i);
    });
});

describe("A: H6 as the ledger's row delivers it", () => {
    const h6 = loadHandOff('H6');
    /** SCORED after T07-08 (the knife and S07's log, the staff of water worn) with the row's `in` lines added. */
    const delivered = (): BotWorldState => {
        const s = arrival({ inventory: own().slice(0, 2) });
        for (const r of h6.receive) {
            const name = r.name.charAt(0).toUpperCase() + r.name.slice(1);
            const id = r.ids?.[0] ?? -1;
            if (r.kind === 'u') for (let n = 0; n < r.count; n++) s.inventory.push(item(id, 1, name));
            else s.inventory.push(item(id, r.count, name));
        }
        return s;
    };
    test('the row brings 2 law runes and no water runes (T08-09 casts on the staff of water)', () => {
        const runes = h6.receive.filter(r => / rune$/.test(r.name)).map(r => [r.name, r.count]);
        expect(runes).toEqual([['law rune', 2]]);
    });
    test("A's kit check passes on it with the staff of water worn, so A needs no trade and no kitFrom", async () => {
        const s = delivered();
        expect(s.equipment.map(i => i.name)).toEqual(['Staff of water']);
        expect(s.inventory.some(i => /^water rune$/i.test(i.name))).toBe(false);
        expect(kitWant(s, KIT)).toEqual([]);
        expect(byLetter('A').preconditions(s, {})).toBe(true);
        expect(byLetter('A').postconditions(s, {})).toBe(true);
        const sdk = new FakeSdk(s);
        const session = { sdk, bot: {}, name: 'lab', sessionId: 0 } as unknown as RunnerSession;
        const ctx = { session, sdk, bot: session.bot, c: {}, log: TickLog.memory('t') } as unknown as StepContext<unknown>;
        // Before the fix: 'kit: missing 2 x /^water rune$/i and no kitFrom to receive it from'.
        await byLetter('A').run(ctx);
        expect(sdk.sent).toEqual([]);
    });
});

describe("Edmond's live tile: the house doors between him and SCORED, then within 1 (B, E, Y)", () => {
    test('doorsBetween: a door only when the walk crosses its east-edge wall', () => {
        expect(doorsBetween(2568, 2572)).toEqual([{ x: 2570, z: 3333 }]); // the garden to Alrena's room
        expect(doorsBetween(2570, 2572)).toEqual([{ x: 2570, z: 3333 }]); // from the door tile, inward
        expect(doorsBetween(2570, 2566)).toEqual([]); // the door tile is the garden side
        expect(doorsBetween(2568, 2566)).toEqual([]);
        expect(doorsBetween(2576, 2566)).toEqual([{ x: 2574, z: 3333 }, { x: 2570, z: 3333 }]); // the picture room out, inner door first
    });

    const edmond = (x: number, z: number) => ({ index: 7, name: 'Edmond', x, z, distance: 0, options: ['Talk-to'], optionsWithIndex: [{ text: 'Talk-to', opIndex: 1 }] });
    const WEST_DOOR = { x: 2570, z: 3333, id: 1530, name: 'Door', distance: 0, options: ['Open'], optionsWithIndex: [{ text: 'Open', opIndex: 1 }] };
    const doorShut = (s: BotWorldState) => s.nearbyLocs.some(l => l.x === WEST_DOOR.x && l.z === WEST_DOOR.z);
    /**
     * B up to its Talk-to clicks. The west door opens a tick after a click on it; the house's west wall
     * (the east edge of x 2570) stops a walk except through the open door; nothing answers the talk, so
     * B ends 'no dialogue opened'. Returns what B sent, in order.
     */
    async function bSends(at: [number, number], ed: [number, number]): Promise<{ sent: string[]; error: string | null }> {
        const s = arrival({
            player: player(at[0], at[1]),
            nearbyNpcs: [edmond(...ed)] as unknown as BotWorldState['nearbyNpcs'],
            nearbyLocs: [WEST_DOOR] as unknown as BotWorldState['nearbyLocs'],
        });
        const sdk = new FakeSdk(s);
        sdk.onSend = (a, f) => {
            if (a.method === 'sendInteractLoc') setTimeout(() => f.tick(st => ({ nearbyLocs: st.nearbyLocs.filter(l => !(l.x === WEST_DOOR.x && l.z === WEST_DOOR.z)) })), 1);
        };
        simulateWalking(sdk, {
            speed: 1,
            blocked: (nx, nz) => {
                const p = sdk.state!.player!;
                const crosses = (p.worldX <= 2570) !== (nx <= 2570);
                return crosses && (doorShut(sdk.state!) || p.worldZ !== 3333 || nz !== 3333);
            },
        });
        const session = { sdk, bot: {}, name: 'lab', sessionId: 0 } as unknown as RunnerSession;
        const ctx = { session, sdk, bot: session.bot, c: {}, log: TickLog.memory('t') } as unknown as StepContext<unknown>;
        const error = await drive(sdk, (byLetter('B').run(ctx) as Promise<unknown>).then(() => null, e => String(e)), 400);
        const sent = sdk.sent.map(a => (a.method === 'sendInteractLoc' ? `door ${a.args[0]},${a.args[1]}` : /npc/i.test(a.method) ? 'talk' : a.method === 'sendWalk' ? 'walk' : a.method));
        return { sent, error };
    }
    const first = (sent: string[], what: string) => sent.indexOf(what);

    test('Edmond shut in Alrena\'s room, SCORED on the door tile: the door opens before the first Talk-to click', async () => {
        const { sent, error } = await bSends([2570, 3333], [2571, 3333]);
        expect(first(sent, 'door 2570,3333')).toBeGreaterThanOrEqual(0);
        expect(first(sent, 'door 2570,3333')).toBeLessThan(first(sent, 'talk'));
        expect(error).toMatch(/no dialogue opened/); // nothing in the fake answers the talk
    });

    test("Edmond shut in Alrena's room, SCORED on its live start tile (2568,3335): the door, the walk in beside him, then the talk", async () => {
        const { sent } = await bSends([2568, 3335], [2572, 3333]);
        expect(first(sent, 'door 2570,3333')).toBeGreaterThanOrEqual(0);
        expect(first(sent, 'door 2570,3333')).toBeLessThan(first(sent, 'walk'));
        expect(first(sent, 'walk')).toBeLessThan(first(sent, 'talk'));
    });

    test('Edmond at a far garden point (2566,3337): no door, a walk to within 1 of him, then the talk', async () => {
        const { sent } = await bSends([2568, 3334], [2566, 3337]);
        expect(sent.some(x => x.startsWith('door'))).toBe(false);
        expect(first(sent, 'walk')).toBeGreaterThanOrEqual(0);
        expect(first(sent, 'walk')).toBeLessThan(first(sent, 'talk'));
    });

    test('the normal arrival, Edmond beside SCORED: no door and no walk, the talk is the first thing sent', async () => {
        const { sent } = await bSends([ARRIVAL.x, ARRIVAL.z], [2568, 3335]);
        expect(sent.some(x => x.startsWith('door') || x === 'walk')).toBe(false);
        expect(sent[0]).toBe('talk');
    });
});

describe('free slots (brief addendum 8)', () => {
    test('with H6 held the need peaks at 2, at D: the picture and the gas mask', () => {
        expect(slotNeed(arrival(), QUEST_ITEMS, LETTERS, 'A')).toEqual({ slots: 2, peak: 'D', items: ['1 Picture', '1 Gas mask'] });
    });
    test("without H6 (SCORED's pack after T07-08: the knife and one log), A also needs the trade's 11 slots: 13 at D", () => {
        expect(slotNeed(arrival({ inventory: own().slice(0, 2) }), QUEST_ITEMS, LETTERS, 'A').slots).toBe(13);
    });
    test("a resume into S peaks at Y, counted conservatively: Edmond's reward takes the papers and adds the scroll in one segment", () => {
        expect(slotNeed(startOf('S').state, QUEST_ITEMS, LETTERS, 'S')).toEqual({ slots: 2, peak: 'Y', items: ['1 Warrant', '1 A small key', '1 A magic scroll'] });
    });
    test('a full pack is refused with the shortfall named', () => {
        const s = arrival();
        while (s.inventory.length < 27) s.inventory.push(item(1925 + 1000, 1, 'Junk'));
        expect(byLetter('A').preconditions(s, {})).toBe('inventory: segment D needs 2 free slots (1 Picture, 1 Gas mask), 1 free: 1 short');
    });
});

describe('done, from the tab, the journal, the inventory and the position', () => {
    test('C: the picture held, or the quest past Jethick', () => {
        expect(byLetter('C').done!(startOf('C'), {})).toBe(false);
        expect(byLetter('C').done!(startOf('D'), {})).toBe(true);
        expect(byLetter('C').done!(startOf('N'), {})).toBe(true);
    });
    test('stages that only the journal tells: without it the tab says only started', () => {
        expect(byLetter('E').done!(startOf('F'), {})).toBe(true);
        expect(byLetter('E').done!(startOf('F', false), {})).toBe(false);
    });
    test('M: 20 and 21 share the journal, so the book tells them apart', () => {
        expect(byLetter('M').done!(startOf('M'), {})).toBe(false);
        expect(byLetter('M').done!(startOf('N'), {})).toBe(true);
    });
    test("Q: 24 and 25 share the journal; Bravek's room (open only at 25) or the note says done", () => {
        const atClerk = startOf('Q');
        atClerk.state.player = player(CLERK_STAND.x, CLERK_STAND.z);
        (atClerk.probed as Record<string, unknown>)[journalProbeName(quest)] = { open: false, tick: 100, ...journal(25) };
        expect(byLetter('Q').done!(atClerk, {})).toBe(false);
        const inRoom = observed(stateAt({ ...STARTS.Q!, stage: 25, at: [2535, 3314] }), journal(25));
        expect(byLetter('Q').done!(inRoom, {})).toBe(true);
        expect(byLetter('Q').done!(startOf('S'), {})).toBe(true);
    });
    test('Y: complete; Z: complete with the scroll read and nothing dead held', () => {
        expect(byLetter('Y').done!(startOf('Z'), {})).toBe(true);
        expect(byLetter('Z').done!(startOf('Z'), {})).toBe(false);
        expect(byLetter('Z').done!(observed(exitState()), {})).toBe(true);
        expect(byLetter('Z').done!(observed(exitState([ITEM.spade])), {})).toBe(false);
        expect(byLetter('Z').done!(observed(exitState([], true)), {})).toBe(false);
    });
});

describe('resume from each segment start', () => {
    test('a fresh arrival with the kit resumes B (A is a no-op then); without the kit, A', async () => {
        expect((await resumeAt(observed(arrival()))).step).toBe('S08:B-edmond-start');
        expect((await resumeAt(observed(arrival({ inventory: own() })))).step).toBe('S08:A-kit');
    });
    for (const l of Object.keys(STARTS)) {
        test(`the resume walk starts ${l} from its start state`, async () => {
            const r = await resumeAt(startOf(l));
            expect(r.step).toBe(byLetter(l).name);
            expect(r.mode).toBe('run');
        });
    }
    test("R's start beside the clerk at 25 resumes Q (24 and 25 share the journal); the clerk then says Bravek will see SCORED", async () => {
        const o = observed(stateAt({ ...STARTS.Q!, stage: 25, at: [CLERK_STAND.x, CLERK_STAND.z] }), journal(25));
        expect((await resumeAt(o)).step).toBe('S08:Q-clerk');
    });
    test("in Bravek's room at 25, R", async () => {
        const o = observed(stateAt({ ...STARTS.Q!, stage: 25, at: [2535, 3314] }), journal(25));
        expect((await resumeAt(o)).step).toBe('S08:R-bravek-note');
    });
    test('upstairs at the Rehnisons after Milli resumes P, which comes down first', async () => {
        const o = observed(stateAt({ ...STARTS.P!, at: [2530, 3331, 1] }), journal(23));
        expect((await resumeAt(o)).step).toBe('S08:P-plague-door');
    });
    test('in the sewer on the way back resumes X', async () => {
        const o = observed(stateAt({ ...STARTS.X!, at: [2530, 9703] }), journal(28));
        expect((await resumeAt(o)).step).toBe('S08:X-back-to-edmond');
    });
    test('complete, the scroll read, the leftovers dropped: finished', async () => {
        expect((await resumeAt(observed(exitState()))).mode).toBe('finished');
    });
    test('complete with the mask still worn resumes Z, to take it off and drop it', async () => {
        expect((await resumeAt(observed(exitState([ITEM.spade], true)))).step).toBe('S08:Z-scroll');
    });
});

describe('Z: the scroll read and its postcondition', () => {
    const post = (s: BotWorldState) => byLetter('Z').postconditions(s, {});
    const page = (t: number, text: string) => `[${t}] page: ${text} Click here to continue`;
    test('the read is judged by its pages and the scroll leaving the pack, never by the scroll leaving alone', () => {
        const read = [page(1, 'You memorise what is written on the scroll.'), page(2, 'You can now cast the Ardougne Teleport spell provided you have the required runes and magic level.')];
        expect(judgeScrollRead(read, true).read).toBe(true);
        expect(judgeScrollRead(read, false).read).toBe(false);
        const burnt = judgeScrollRead([page(1, 'The scroll bursts into flame.')], true);
        expect(burnt).toMatchObject({ read: false, burnt: true, consumed: true });
        expect(judgeScrollRead([], true).read).toBe(false);
    });
    test('the postcondition: complete, the scroll gone, nothing dead held, the mask off', () => {
        expect(post(exitState())).toBe(true);
        expect(post(exitState([ITEM.scroll]))).toMatch(/the magic scroll: still held/);
        expect(post(exitState([ITEM.bucket]))).toBe('exit: still holding Bucket');
        expect(post(exitState([], true))).toBe('exit: still holding Gas mask (worn)');
    });
    test('reading the scroll on scripted state: the objbox, the scroll deleted, the mesbox, then the drops', async () => {
        const s = stateAt(STARTS.Z!);
        const sdk = new FakeSdk(s);
        const pageAt = (text: string) => ({ dialog: { isOpen: true, isWaiting: false, options: [{ text: 'Click here to continue', index: 0 }], allComponents: [{ text }] } as unknown as BotWorldState['dialog'] });
        let pages = 0;
        sdk.onSend = (a, f) => {
            if (a.method === 'sendUseItem') setTimeout(() => f.tick(pageAt('You memorise what is written on the scroll.')), 1);
            if (a.method === 'sendClickDialog') {
                pages++;
                setTimeout(() => f.tick(st => (pages === 1
                    ? { ...pageAt('You can now cast the Ardougne Teleport spell provided you have the required runes and magic level.'), inventory: st.inventory.filter(i => i.id !== ITEM.scroll) }
                    : { dialog: { isOpen: false, isWaiting: false, options: [] } as unknown as BotWorldState['dialog'] })), 1);
            }
            if (a.method === 'sendUseEquipmentItem') setTimeout(() => f.tick(st => ({ equipment: st.equipment.filter(i => i.id !== ITEM.gasmask), inventory: [...st.inventory, mask()] })), 1);
            if (a.method === 'sendDropItem') {
                const slot = a.args[0] as number;
                setTimeout(() => f.tick(st => ({ inventory: st.inventory.filter(i => i.slot !== slot) })), 1);
            }
        };
        const session = { sdk, bot: {}, name: 'lab', sessionId: 0 } as unknown as RunnerSession;
        const log = TickLog.memory('t');
        const ctx = { session, sdk, bot: session.bot, c: {}, log } as unknown as StepContext<unknown>;
        await drive(sdk, byLetter('Z').run(ctx) as Promise<unknown>, 80);
        const note = log.rows.find(r => r.kind === 'note' && (r.meta as { scrollRead?: unknown }).scrollRead);
        expect((note!.meta as { scrollRead: { read: boolean } }).scrollRead.read).toBe(true);
        expect(post(sdk.getState()!)).toBe(true);
        const sent = sdk.sent.map(x => x.method);
        expect(sent[0]).toBe('sendUseItem');
        expect(sent).toContain('sendUseEquipmentItem');
        expect(sent.filter(m => m === 'sendDropItem')).toHaveLength(6); // the spade, the four buckets, the mask
    });
});

describe('Z: the exit drops (the slot ledger T08-09 drops, moved into the step; clears H7)', () => {
    test('dead at the exit: the spade, the buckets, the gas mask and every quest leftover; not the runes, the knife or the log', () => {
        for (const id of [ITEM.spade, ITEM.bucket, ITEM.gasmask, ITEM.water, ITEM.rope, ITEM.cure, ITEM.picture, ITEM.key]) expect(DEAD_AT_EXIT).toContain(id);
        for (const i of own()) expect(DEAD_AT_EXIT).not.toContain(i.id);
    });
    test('a resumed Z with the scroll already read takes the mask off and drops only the dead items', async () => {
        const s = exitState([ITEM.spade, ITEM.bucket, ITEM.bucket, ITEM.bucket, ITEM.bucket], true);
        const keep = s.inventory.filter(i => !DEAD_AT_EXIT.includes(i.id)).map(i => i.slot);
        const sdk = new FakeSdk(s);
        sdk.onSend = (a, f) => {
            if (a.method === 'sendUseEquipmentItem') setTimeout(() => f.tick(st => ({ equipment: st.equipment.filter(i => i.id !== ITEM.gasmask), inventory: [...st.inventory, mask()] })), 1);
            if (a.method === 'sendDropItem') {
                const slot = a.args[0] as number;
                setTimeout(() => f.tick(st => ({ inventory: st.inventory.filter(i => i.slot !== slot) })), 1);
            }
        };
        const session = { sdk, bot: {}, name: 'lab', sessionId: 0 } as unknown as RunnerSession;
        const ctx = { session, sdk, bot: session.bot, c: {}, log: TickLog.memory('t') } as unknown as StepContext<unknown>;
        await drive(sdk, byLetter('Z').run(ctx) as Promise<unknown>, 40);
        expect(sdk.sent.map(a => a.method)).not.toContain('sendUseItem');
        expect(sdk.sent.filter(a => a.method === 'sendDropItem').map(a => a.args[0] as number).some(slot => keep.includes(slot))).toBe(false);
        expect(byLetter('Z').postconditions(sdk.getState()!, {})).toBe(true);
        expect(sdk.getState()!.inventory.map(i => i.name).sort()).toEqual(['Knife', 'Law rune', 'Logs']);
    });
});
