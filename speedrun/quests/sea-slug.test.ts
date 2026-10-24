import { describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, NearbyLoc, PlayerState, QuestJournalState } from '../../sdk/types';
import { QUESTS } from '../data/quest-stages';
import { baseState, drive, FakeSdk } from '../lib/fake-sdk';
import { journalProbeName } from '../lib/quests';
import { TickLog } from '../lib/ticks';
import { replyAfter } from '../lib/world';
import { Observation, resolveResume } from '../runner/resume';
import type { Observed, RunnerSession, StepContext } from '../runner/step';
import { DEFAULT_DIALOGUE, slotNeed } from './segments';
import {
    afterMessage, ARRIVAL, CAROLINE_AT, LANDED, LEVEL_UP_TICKS, DEAD_AT_EXIT, DOOR_SCENE_TICKS, DOORS, doorState, GLASS_AT, GLASS_AT_2, GLASS_SPAWNS, GROUND_RESPAWN_TICKS, inWitchaven, ITEM, LETTERS, LOST_PICKUPS, observed, offshore, onIsland, onPlatformGround, onPlatformUp,
    openBridgedDoor, QUEST_ITEMS, quest, RESPAWN_WAIT_TICKS, stageCeiling, stageFloor, stepId, steps, STICKS_AT, type BridgedDoor, type DoorOutcome,
} from './sea-slug';

// ------------------------------------------------------------------ scripted state

const NAMES: Record<number, string> = {
    [ITEM.paste]: 'Swamp paste', [ITEM.torchUnlit]: 'Torch', [ITEM.torchLit]: 'Torch', [ITEM.damp]: 'Damp sticks', [ITEM.dry]: 'Dry sticks',
    [ITEM.glass]: 'Broken glass', [ITEM.pearls]: 'Oyster pearls', [ITEM.slug]: 'Sea slug',
};
let nextSlot = 0;
const item = (id: number, count = 1, name = NAMES[id] ?? `obj ${id}`): InventoryItem =>
    ({ slot: nextSlot++, id, name, count, optionsWithIndex: id === ITEM.dry ? [{ text: 'Rub-together', opIndex: 1 }] : [] }) as unknown as InventoryItem;
/** SCORED's own pack at S19 after H15's swap: the runes. */
const own = () => [item(555, 8, 'Water rune'), item(556, 20, 'Air rune'), item(563, 7, 'Law rune')];
const H15 = () => [item(ITEM.paste), item(ITEM.torchUnlit)];
const skill = (name: string, level: number) => ({ name, level, baseLevel: level, experience: 0 });
const player = (x: number, z: number, level = 0): PlayerState => ({ name: 'lab', x, z, worldX: x, worldZ: z, level, hp: 70, maxHp: 70 }) as PlayerState;

/** SCORED on Caroline's tile at S19's levels with its pack and H15. */
function arrival(over: Partial<BotWorldState> = {}): BotWorldState {
    nextSlot = 0;
    return baseState({
        tick: 100,
        quests: {} as BotWorldState['quests'],
        skills: [skill('Firemaking', 99), skill('Fishing', 1)],
        player: player(ARRIVAL.x, ARRIVAL.z),
        inventory: [...own(), ...H15()],
        ...over,
    });
}

/** The journal at `stage` from quest-stages.ts's markers; 2 and 6 have none (seaslug_journal.rs2), 5 shows 4's, 9 shows 8's. */
function journal(stage: number): Pick<QuestJournalState, 'title' | 'lines'> {
    const shown = stage === 5 ? 4 : stage === 9 ? 8 : stage;
    const marker = QUESTS.seaslug.stages.find(s => s.value === shown && 'journal' in s && s.journal) as { journal?: string } | undefined;
    return { title: 'Sea Slug', lines: ['@str@I have spoken to Caroline and agreed to help.', `@dbl@${marker?.journal ?? 'I should find a way of lighting this damp torch.'}`] };
}

type Start = { stage: number; ids: number[]; at: [number, number, number?] };
const T = ITEM.torchUnlit;
const L = ITEM.torchLit;
const G = ITEM.glass;
const D = ITEM.dry;
/** Each segment's start state, where the segment before it ends (the lab fixtures' table). */
const STARTS: Record<string, Start> = {
    B: { stage: 0, ids: [ITEM.paste, T], at: [2716, 3302] },
    C: { stage: 1, ids: [ITEM.paste, T], at: [2716, 3302] },
    D: { stage: 2, ids: [ITEM.paste, T], at: [2721, 3305] },
    E: { stage: 3, ids: [T], at: [2782, 3273] },
    F: { stage: 3, ids: [T, G], at: [2765, 3278] },
    G: { stage: 3, ids: [T, G, D], at: [2784, 3289] },
    H: { stage: 4, ids: [T, G, D], at: [2764, 3286, 1] },
    I: { stage: 5, ids: [T, G, D], at: [2800, 3320] },
    J: { stage: 6, ids: [T, G, D], at: [2794, 3321] },
    K: { stage: 6, ids: [T, G, D], at: [2782, 3273] },
    L: { stage: 7, ids: [L, G, D], at: [2782, 3273] },
    M: { stage: 8, ids: [L, G, D], at: [2764, 3286, 1] },
    N: { stage: 9, ids: [L, G, D], at: [2766, 3288, 1] },
    O: { stage: 10, ids: [L, G, D], at: [2764, 3286, 1] },
    P: { stage: 11, ids: [L, G, D], at: [2768, 3290, 1] },
    Q: { stage: 11, ids: [L, G, D], at: [2722, 3305] },
};

function stateAt(st: Start): BotWorldState {
    const s = arrival({ player: player(st.at[0], st.at[1], st.at[2] ?? 0) });
    s.inventory = [...own(), ...st.ids.map(id => item(id))];
    s.quests = { [quest]: st.stage >= 12 ? 'complete' : st.stage > 0 ? 'started' : 'not_started' } as BotWorldState['quests'];
    return s;
}
function startOf(letter: string, withJournal = true): Observed {
    const st = STARTS[letter]!;
    return observed(stateAt(st), withJournal && st.stage > 0 && st.stage < 12 ? journal(st.stage) : undefined);
}
async function resumeAt(o: Observed): Promise<{ step: string | null; mode: string }> {
    const obs = new Observation(o.state);
    Object.assign(obs.probed, o.probed);
    if (!(journalProbeName(quest) in obs.probed)) obs.probed[journalProbeName(quest)] = null;
    const r = await resolveResume(list, obs, {});
    return { step: r.step, mode: r.mode };
}

/** The exit state: complete beside Caroline with the leftovers dropped (`extra`: still held). */
const exitState = (extra: number[] = []): BotWorldState => {
    const s = arrival({ quests: { [quest]: 'complete' } as BotWorldState['quests'], player: player(2717, 3301) });
    s.inventory = [...own(), ...extra.map(id => item(id))];
    return s;
};

const list = steps();
const letterOf = (name: string) => name.split(':')[1]!.split('-')[0]!;
const byLetter = (l: string) => list.find(s => letterOf(s.name) === l)!;

const ctxFor = (sdk: FakeSdk, log = TickLog.memory('t')) => {
    const session = { sdk, bot: {}, name: 'lab', sessionId: 0 } as unknown as RunnerSession;
    return { ctx: { session, sdk, bot: session.bot, c: {}, log } as unknown as StepContext<unknown>, log };
};

// ------------------------------------------------------------------ tests

describe('segment table', () => {
    test('names are unique, start with S19: and run A..Q in order', () => {
        expect(stepId).toBe('S19');
        expect(quest).toBe('seaslug');
        expect(list.map(s => letterOf(s.name))).toEqual([...LETTERS]);
        expect(new Set(list.map(s => s.name)).size).toBe(LETTERS.length);
        expect(list[0]!.name).toBe('S19:A-kit');
        expect(list.at(-1)!.name).toBe('S19:Q-caroline-reward');
    });
    test('logout-safe throughout (the entry: every var is perm)', () => {
        expect(list.every(s => s.logoutSafe)).toBe(true);
    });
    test('durable marks on every stage, item and the exit; the kit and the two crossings (J, P) have none', () => {
        expect(list.filter(s => !s.done).map(s => letterOf(s.name))).toEqual(['A', 'J', 'P']);
        for (const l of ['B', 'C', 'D', 'G', 'H', 'I', 'K', 'L', 'M', 'N', 'O']) expect(byLetter(l).probes).toEqual([journalProbeName(quest)]);
    });
    test('option defaults: the shared burst dialogue; both modes build the same table', () => {
        expect(DEFAULT_DIALOGUE).toBe('burst');
        expect(steps({ dialogue: 'fixed' }).map(s => s.name)).toEqual(list.map(s => s.name));
    });
});

describe('places, judged by coordinates', () => {
    const at = (x: number, z: number, level = 0) => arrival({ player: player(x, z, level) });
    test('Witchaven, the platform (both floors) and the island', () => {
        expect(inWitchaven(at(2716, 3302))).toBe(true);
        expect(inWitchaven(at(2722, 3305))).toBe(true); // the shore landing
        expect(onPlatformGround(at(2782, 3273))).toBe(true);
        expect(onPlatformUp(at(2764, 3286, 1))).toBe(true);
        expect(onPlatformGround(at(2764, 3286, 1))).toBe(false);
        expect(onIsland(at(2800, 3320))).toBe(true);
        expect(offshore(at(2716, 3302))).toBe(false);
    });
});

describe('A: the entry preconditions', () => {
    const pre = (s: BotWorldState) => byLetter('A').preconditions(s, {});
    test("pass on Caroline's tile with SCORED's pack and H15", () => {
        expect(pre(arrival())).toBe(true);
    });
    test('refuse away from the arrival tile', () => {
        expect(pre(arrival({ player: player(2655, 3305) }))).toMatch(/arrival tile/);
    });
    test('refuse once the quest has started', () => {
        expect(pre(arrival({ quests: { [quest]: 'started' } as BotWorldState['quests'] }))).toMatch(/Sea Slug/);
    });
    test('refuse below Firemaking 30 (quest_seaslug.rs2:43)', () => {
        expect(pre(arrival({ skills: [skill('Firemaking', 29), skill('Fishing', 1)] }))).toMatch(/firemaking 29\/30/i);
    });
    test("the kit is the segment's postcondition: the swamp paste and the torch", () => {
        expect(byLetter('A').postconditions(arrival(), {})).toBe(true);
        const s = arrival();
        s.inventory = s.inventory.filter(i => i.id !== ITEM.paste);
        expect(byLetter('A').postconditions(s, {})).toMatch(/swamp paste/i);
    });
});

describe('free slots (brief addendum 8)', () => {
    test("with H15 held the need peaks at 2, at Q: the glass, the sticks and the pearls, less the paste's slot", () => {
        expect(slotNeed(arrival(), QUEST_ITEMS, LETTERS, 'A')).toEqual({ slots: 2, peak: 'Q', items: ['1 Broken glass', '1 Damp sticks (then dry)', '1 Oyster pearls'] });
    });
    test('without H15 the kit counts too', () => {
        expect(slotNeed(arrival({ inventory: own() }), QUEST_ITEMS, LETTERS, 'A').slots).toBe(4);
    });
    test('a resume into F needs only the sticks and, at Q, the pearls', () => {
        expect(slotNeed(startOf('F').state, QUEST_ITEMS, LETTERS, 'F')).toEqual({ slots: 2, peak: 'Q', items: ['1 Damp sticks (then dry)', '1 Oyster pearls'] });
    });
    test('a full pack is refused with the shortfall named', () => {
        const s = arrival();
        while (s.inventory.length < 27) s.inventory.push(item(1925 + 1000, 1, 'Junk'));
        expect(byLetter('A').preconditions(s, {})).toBe('inventory: segment Q needs 2 free slots (1 Broken glass, 1 Damp sticks (then dry), 1 Oyster pearls), 1 free: 1 short');
    });
    test('a resumed E is checked too: the paste is gone, so the glass, the sticks and the pearls need 3', () => {
        const e = startOf('E').state;
        while (e.inventory.length < 27) e.inventory.push(item(1925 + 1000, 1, 'Junk'));
        expect(byLetter('E').preconditions(e, {})).toBe('inventory: segment Q needs 3 free slots (1 Broken glass, 1 Damp sticks (then dry), 1 Oyster pearls), 1 free: 2 short');
    });
});

describe('the stage, from the journal and the position', () => {
    test('one marker, one stage: 1, 3, 7 and 10', () => {
        for (const l of ['C', 'E', 'L', 'O']) expect(stageFloor(startOf(l))).toBe(STARTS[l]!.stage);
    });
    test('2 and 6 read the same (no marker): ashore the floor is 2, off the mainland 6', () => {
        expect(stageFloor(startOf('D'))).toBe(2);
        expect(stageFloor(startOf('J'))).toBe(6);
        expect(stageFloor(startOf('K'))).toBe(6);
    });
    test("4 and 5 share their text: on the platform 4, on Kent's island 5", () => {
        expect(stageFloor(startOf('H'))).toBe(4);
        expect(stageFloor(startOf('I'))).toBe(5);
    });
    test('8 and 9 share their text and nothing tells them apart: 8', () => {
        expect(stageFloor(startOf('N'))).toBe(8);
    });
    test('without the journal the tab says only started: the floor is the lowest started stage the position allows, the ceiling the highest', () => {
        expect(stageFloor(startOf('K', false))).toBe(3);
        expect(stageCeiling(startOf('K', false).state)).toBe(11);
        expect(stageFloor(startOf('I', false))).toBe(5);
    });
});

describe('resume from each segment start', () => {
    test('a fresh arrival with the kit resumes B (A is a no-op then); without the kit, A', async () => {
        expect((await resumeAt(observed(arrival()))).step).toBe('S19:B-caroline-start');
        expect((await resumeAt(observed(arrival({ inventory: own() })))).step).toBe('S19:A-kit');
    });
    for (const l of Object.keys(STARTS).filter(k => k !== 'N')) {
        test(`the resume walk starts ${l} from its start state`, async () => {
            const r = await resumeAt(startOf(l));
            expect(r.step).toBe(byLetter(l).name);
            expect(r.mode).toBe('run');
        });
    }
    test("N's start (9) reads as 8 and resumes M: the second kick at 9 only says 'nothing interesting happens'", async () => {
        expect((await resumeAt(startOf('N'))).step).toBe('S19:M-panel');
    });
    test('complete with the leftovers dropped: finished', async () => {
        expect((await resumeAt(observed(exitState()))).mode).toBe('finished');
    });
    test('complete with a leftover held resumes Q, to drop it', async () => {
        expect((await resumeAt(observed(exitState([ITEM.glass])))).step).toBe('S19:Q-caroline-reward');
    });
});

// ------------------------------------------------------------------ the bridged-door step

const locOf = (l: { x: number; z: number; id: number }, name: string, op: string): NearbyLoc =>
    ({ x: l.x, z: l.z, id: l.id, name, distance: 1, options: [op], optionsWithIndex: [{ text: op, opIndex: 1 }] }) as unknown as NearbyLoc;
const closedLoc = (d: BridgedDoor) => locOf(d.closed, 'Door', 'Open');
const openLoc = (d: BridgedDoor) => locOf(d.open, 'Door', 'Close');

/** SCORED in front of the glass room door on the platform's ground floor, the door as `locs` shows it. */
function atGlassDoor(locs: NearbyLoc[]): FakeSdk {
    const s = stateAt(STARTS.E!);
    s.player = player(2766, 3277);
    s.nearbyLocs = locs;
    return new FakeSdk(s);
}
/** The server's side: an op on the closed loc at its tile opens the door the next tick; any other loc op is dropped. */
function serveDoor(sdk: FakeSdk, d: BridgedDoor): void {
    sdk.onSend = (a, f) => {
        if (a.method !== 'sendInteractLoc') return;
        const [x, z, id] = a.args as [number, number, number];
        if (x !== d.closed.x || z !== d.closed.z || id !== d.closed.id) return;
        if (!f.state!.nearbyLocs.some(l => l.id === d.closed.id)) return; // no such loc: OpLocHandler drops it
        setTimeout(() => f.tick(st => ({ nearbyLocs: [...st.nearbyLocs.filter(l => l.id !== d.closed.id), openLoc(d)] })), 1);
    };
}
const outcome = (log: TickLog) => (log.rows.find(r => r.kind === 'note' && (r.meta as { bridgedDoor?: unknown }).bridgedDoor)!.meta as { bridgedDoor: DoorOutcome }).bridgedDoor;

describe('the bridged-door step (act on the loc by tile and id)', () => {
    const d = DOORS.glass;
    test('the doors: the closed loc and the open loc one tile east (m, lab)', () => {
        expect(DOORS.glass.open).toEqual({ x: 2766, z: 3277, id: DOORS.glass.closed.id + 1 });
        expect(DOORS.kennith.open).toEqual({ x: 2765, z: 3285, id: DOORS.kennith.closed.id + 1 });
    });
    test('closed: clicks the closed loc by tile and id, op 1, until the open loc is published', async () => {
        const sdk = atGlassDoor([closedLoc(d)]);
        serveDoor(sdk, d);
        const { ctx, log } = ctxFor(sdk);
        await drive(sdk, openBridgedDoor(ctx, 'E', d) as Promise<unknown>, 40);
        expect(sdk.sent.filter(a => a.method === 'sendInteractLoc').map(a => a.args)).toEqual([[d.closed.x, d.closed.z, d.closed.id, 1]]);
        expect(doorState(sdk.getState()!, d)).toBe('open');
        expect(outcome(log)).toMatchObject({ before: 'closed', after: 'open', waited: 0 });
    });
    test('already open: no click (a click on the open loc would shut it)', async () => {
        const sdk = atGlassDoor([openLoc(d)]);
        serveDoor(sdk, d);
        const { ctx, log } = ctxFor(sdk);
        await drive(sdk, openBridgedDoor(ctx, 'E', d) as Promise<unknown>, 10);
        expect(sdk.sent.filter(a => a.method === 'sendInteractLoc')).toHaveLength(0);
        expect(outcome(log)).toMatchObject({ before: 'open', after: 'open', clickToOpen: 0 });
    });
    test('out of nearbyLocs reach (the landing is 17 tiles off): the scan shows it closed', async () => {
        const sdk = atGlassDoor([]);
        sdk.scanLocs = [closedLoc(d)];
        sdk.onSend = (a, f) => {
            if (a.method === 'sendInteractLoc') setTimeout(() => { f.scanLocs = [openLoc(d)]; f.tick({ nearbyLocs: [openLoc(d)] }); }, 1);
        };
        const { ctx, log } = ctxFor(sdk);
        await drive(sdk, openBridgedDoor(ctx, 'E', d) as Promise<unknown>, 40);
        expect(outcome(log)).toMatchObject({ before: 'closed', after: 'open', waited: 0 });
    });
    test('the scene not yet built after a jump (R10): waits for the door loc, deciding nothing from the empty scene', async () => {
        const sdk = atGlassDoor([]);
        serveDoor(sdk, d);
        let n = 0;
        const { ctx, log } = ctxFor(sdk);
        await drive(sdk, openBridgedDoor(ctx, 'E', d) as Promise<unknown>, 60, st => (++n === 8 && !st.nearbyLocs.length ? { nearbyLocs: [closedLoc(d)] } : {}));
        const o = outcome(log);
        expect(o.before).toBe('closed');
        expect(o.waited).toBeGreaterThanOrEqual(7);
        expect(o.after).toBe('open');
    });
    test(`never published within ${DOOR_SCENE_TICKS} ticks: clicks the closed id anyway (it cannot shut an open door) and leaves the verdict to the next step`, async () => {
        const sdk = atGlassDoor([]);
        const { ctx, log } = ctxFor(sdk);
        await drive(sdk, openBridgedDoor(ctx, 'E', d) as Promise<unknown>, 120);
        expect(sdk.sent.filter(a => a.method === 'sendInteractLoc')[0]!.args).toEqual([d.closed.x, d.closed.z, d.closed.id, 1]);
        expect(outcome(log)).toMatchObject({ before: 'unseen', after: 'unseen' });
    });
    test('a closed door that does not open fails the segment', async () => {
        const sdk = atGlassDoor([closedLoc(d)]);
        const { ctx } = ctxFor(sdk);
        await expect(drive(sdk, openBridgedDoor(ctx, 'E', d) as Promise<unknown>, 80)).rejects.toThrow(/glass room door did not open/);
    });
    test('on another floor the door is unseen', () => {
        const s = stateAt(STARTS.E!);
        s.nearbyLocs = [closedLoc(DOORS.kennith)];
        expect(doorState(s, DOORS.kennith)).toBe('unseen');
    });
});

// ------------------------------------------------------------------ ground pickups another player can take (E, F)

type Ground = BotWorldState['groundItems'][number];
type At = { x: number; z: number };
const ground = (id: number, at: At): Ground => ({ id, name: NAMES[id] ?? `obj ${id}`, count: 1, x: at.x, z: at.z, distance: 1 }) as unknown as Ground;
const onTile = (g: Ground, id: number, at: At) => g.id === id && g.x === at.x && g.z === at.z;

/**
 * The platform's server for E and F, as drive's per-tick `each`: a click on a door's closed loc opens
 * it the next tick; a pickup lands the next tick if the item is still on its tile, and the spawn
 * returns GROUND_RESPAWN_TICKS later (ObjOps.ts); the first `steal` pickups are lost to another
 * player instead (the item goes, nothing is held). `respawns` are spawns taken before the segment.
 */
function platform(sdk: FakeSdk, o: { steal?: number; respawns?: Array<{ tick: number; id: number; at: At }> } = {}) {
    let steal = o.steal ?? 0;
    const respawns = [...(o.respawns ?? [])];
    const due: Array<(st: BotWorldState) => Partial<BotWorldState>> = [];
    sdk.onSend = a => {
        const [x, z, id] = a.args as [number, number, number];
        if (a.method === 'sendInteractLoc') {
            const d = [DOORS.glass, DOORS.store].find(d => d.closed.x === x && d.closed.z === z && d.closed.id === id);
            if (d) due.push(st => (st.nearbyLocs.some(l => l.id === id && l.x === x && l.z === z) ? { nearbyLocs: [...st.nearbyLocs.filter(l => l.id !== id || l.x !== x || l.z !== z), openLoc(d)] } : {}));
        }
        if (a.method === 'sendPickup') {
            due.push(st => {
                if (!st.groundItems.some(g => onTile(g, id, { x, z }))) return {};
                respawns.push({ tick: st.tick + GROUND_RESPAWN_TICKS, id, at: { x, z } });
                const groundItems = st.groundItems.filter(g => !onTile(g, id, { x, z }));
                if (steal > 0) {
                    steal--;
                    return { groundItems };
                }
                return { groundItems, inventory: [...st.inventory, item(id)] };
            });
        }
        if (a.method === 'sendUseItemOnItem') due.push(st => ({ inventory: st.inventory.map(i => (i.id === ITEM.damp ? { ...i, id: ITEM.dry, name: 'Dry sticks' } : i)) }));
    };
    return (st: BotWorldState): Partial<BotWorldState> => {
        let cur = st;
        let out: Partial<BotWorldState> = {};
        for (const fx of due.splice(0)) {
            const d = fx(cur);
            out = { ...out, ...d };
            cur = { ...cur, ...d };
        }
        const back = respawns.filter(r => r.tick <= st.tick);
        if (back.length) {
            for (const r of back) respawns.splice(respawns.indexOf(r), 1);
            out.groundItems = [...cur.groundItems, ...back.map(r => ground(r.id, r.at))];
        }
        return out;
    };
}

interface PickupNote { pickup: string; path: string; at: number[]; waited: number; ticks: number; lost?: number }
const pickupNote = (log: TickLog) => log.rows.find(r => r.kind === 'note' && (r.meta as { pickup?: unknown }).pickup)?.meta as PickupNote;
const tiles = (sdk: FakeSdk, method: string) => sdk.sent.filter(a => a.method === method).map(a => `${a.args[0]},${a.args[1]}`);

/** SCORED on the platform landing at E's start, both doors shut, the glass on the tiles `onGround`. */
function eStart(onGround: At[]): FakeSdk {
    const s = stateAt(STARTS.E!);
    s.nearbyLocs = [closedLoc(DOORS.glass), closedLoc(DOORS.store)];
    s.groundItems = onGround.map(at => ground(ITEM.glass, at));
    return new FakeSdk(s);
}

describe('E: a broken glass another player may have taken', () => {
    const E = () => byLetter('E');
    const glassDoor = `${DOORS.glass.closed.x},${DOORS.glass.closed.z}`;
    const storeDoor = `${DOORS.store.closed.x},${DOORS.store.closed.z}`;
    const first = `${GLASS_AT.x},${GLASS_AT.z}`;
    const second = `${GLASS_AT_2.x},${GLASS_AT_2.z}`;

    test('the spawns: the glass room, then the store room behind the twin of its door (maps/m43_51.jm2: loc_1533 shape 0 angle 2 at both)', () => {
        expect(GLASS_SPAWNS.map(s => [s.at, s.door?.label])).toEqual([[GLASS_AT, DOORS.glass.label], [GLASS_AT_2, DOORS.store.label]]);
        expect(DOORS.store.closed.id).toBe(DOORS.glass.closed.id);
        expect(DOORS.store.open).toEqual({ x: 2766, z: 3287, id: DOORS.glass.open.id });
        expect(RESPAWN_WAIT_TICKS).toBeGreaterThan(GROUND_RESPAWN_TICKS);
    });
    test('on its spawn: through the glass room door and taken at once, as before', async () => {
        const sdk = eStart([GLASS_AT, GLASS_AT_2]);
        const each = platform(sdk);
        const { ctx, log } = ctxFor(sdk);
        await drive(sdk, E().run(ctx) as Promise<unknown>, 40, each);
        expect(tiles(sdk, 'sendInteractLoc')).toEqual([glassDoor]);
        expect(tiles(sdk, 'sendPickup')).toEqual([first]);
        expect(pickupNote(log)).toMatchObject({ pickup: 'the broken glass', path: 'spawn', at: [GLASS_AT.x, GLASS_AT.z], waited: 0 });
        expect(E().postconditions(sdk.getState()!, {})).toBe(true);
    });
    test('taken, with the second spawn holding one: through the store room door for it, the glass room door never clicked', async () => {
        const sdk = eStart([GLASS_AT_2]);
        const each = platform(sdk);
        const { ctx, log } = ctxFor(sdk);
        await drive(sdk, E().run(ctx) as Promise<unknown>, 40, each);
        expect(tiles(sdk, 'sendInteractLoc')).toEqual([storeDoor]);
        expect(tiles(sdk, 'sendPickup')).toEqual([second]);
        expect(pickupNote(log)).toMatchObject({ path: 'second spawn', at: [GLASS_AT_2.x, GLASS_AT_2.z], waited: 0 });
        expect(E().postconditions(sdk.getState()!, {})).toBe(true);
    });
    test('both taken: waits at the glass room door past the old 60 ticks for the respawn, and takes it', async () => {
        const sdk = eStart([]);
        const t = sdk.getState()!.tick;
        const each = platform(sdk, { respawns: [{ tick: t + 95, id: ITEM.glass, at: GLASS_AT }, { tick: t + 150, id: ITEM.glass, at: GLASS_AT_2 }] });
        const { ctx, log } = ctxFor(sdk);
        await drive(sdk, E().run(ctx) as Promise<unknown>, 200, each);
        expect(tiles(sdk, 'sendInteractLoc')).toEqual([glassDoor]);
        expect(tiles(sdk, 'sendPickup')).toEqual([first]);
        const n = pickupNote(log);
        expect(n).toMatchObject({ path: 'respawn wait', at: [GLASS_AT.x, GLASS_AT.z] });
        expect(n.waited).toBeGreaterThan(60);
        expect(n.waited).toBeLessThanOrEqual(95);
        expect(E().postconditions(sdk.getState()!, {})).toBe(true);
    });
    test('both taken, the second back first: takes it through the store room door', async () => {
        const sdk = eStart([]);
        const t = sdk.getState()!.tick;
        const each = platform(sdk, { respawns: [{ tick: t + 40, id: ITEM.glass, at: GLASS_AT_2 }, { tick: t + 90, id: ITEM.glass, at: GLASS_AT }] });
        const { ctx, log } = ctxFor(sdk);
        await drive(sdk, E().run(ctx) as Promise<unknown>, 200, each);
        expect(tiles(sdk, 'sendInteractLoc')).toEqual([glassDoor, storeDoor]);
        expect(tiles(sdk, 'sendPickup')).toEqual([second]);
        expect(pickupNote(log)).toMatchObject({ path: 'respawn wait', at: [GLASS_AT_2.x, GLASS_AT_2.z] });
    });
    test(`neither back within ${RESPAWN_WAIT_TICKS} ticks: fails, naming the spawns`, async () => {
        const sdk = eStart([]);
        const each = platform(sdk);
        const { ctx } = ctxFor(sdk);
        await expect(drive(sdk, E().run(ctx) as Promise<unknown>, 200, each)).rejects.toThrow(`S19:E: no the broken glass on its spawn (2765,3278) or (2765,3289) within ${RESPAWN_WAIT_TICKS} ticks`);
        expect(tiles(sdk, 'sendPickup')).toEqual([]);
    });
    test('lost under the click (seen, then taken before the pickup landed): back to the wait, and the respawn taken', async () => {
        const sdk = eStart([GLASS_AT]);
        const each = platform(sdk, { steal: 1 });
        const { ctx, log } = ctxFor(sdk);
        await drive(sdk, E().run(ctx) as Promise<unknown>, 300, each);
        expect(pickupNote(log)).toMatchObject({ path: 'respawn wait', at: [GLASS_AT.x, GLASS_AT.z], lost: 1 });
        expect(E().postconditions(sdk.getState()!, {})).toBe(true);
    });
    test(`lost under the click ${LOST_PICKUPS + 1} times: fails as a pickup that did not land`, async () => {
        const sdk = eStart([GLASS_AT]);
        const each = platform(sdk, { steal: LOST_PICKUPS + 1 });
        const { ctx } = ctxFor(sdk);
        await expect(drive(sdk, E().run(ctx) as Promise<unknown>, 600, each)).rejects.toThrow(/the broken glass was not picked up/);
    });
});

describe('F: the damp sticks another player may have taken (one spawn, the same wait)', () => {
    test('waits for the respawn by the ladder, then takes and dries them', async () => {
        const s = stateAt(STARTS.F!);
        s.nearbyLocs = [openLoc(DOORS.glass)];
        s.groundItems = [];
        const sdk = new FakeSdk(s);
        const each = platform(sdk, { respawns: [{ tick: s.tick + 80, id: ITEM.damp, at: STICKS_AT }] });
        const { ctx, log } = ctxFor(sdk);
        await drive(sdk, byLetter('F').run(ctx) as Promise<unknown>, 200, each);
        expect(tiles(sdk, 'sendInteractLoc')).toEqual([]);
        const n = pickupNote(log);
        expect(n).toMatchObject({ pickup: 'the damp sticks', path: 'respawn wait', at: [STICKS_AT.x, STICKS_AT.z] });
        expect(n.waited).toBeGreaterThan(60);
        expect(byLetter('F').postconditions(sdk.getState()!, {})).toBe(true);
    });
    test('on its spawn: taken at once', async () => {
        const s = stateAt(STARTS.F!);
        s.nearbyLocs = [openLoc(DOORS.glass)];
        s.groundItems = [ground(ITEM.damp, STICKS_AT)];
        const sdk = new FakeSdk(s);
        const each = platform(sdk);
        const { ctx, log } = ctxFor(sdk);
        await drive(sdk, byLetter('F').run(ctx) as Promise<unknown>, 40, each);
        expect(pickupNote(log)).toMatchObject({ path: 'spawn', waited: 0 });
        expect(byLetter('F').postconditions(sdk.getState()!, {})).toBe(true);
    });
});

describe("Kent's end: the sea slug message, then a page", () => {
    const page = (open: boolean) => ({ dialog: { isOpen: open, isWaiting: false, options: [], allComponents: open ? [{ text: 'A few more minutes...' }] : [] } as unknown as BotWorldState['dialog'] });
    const msg = (tick: number, text: string) => ({ tick, type: 0, text }) as unknown as BotWorldState['gameMessages'][number];
    test('not before the message (the chat closing after "Traveller wait!" is not the end)', () => {
        const sdk = new FakeSdk(stateAt(STARTS.I!));
        const w = afterMessage(sdk, LANDED.kentSlug);
        sdk.tick(page(true));
        sdk.tick(page(false));
        expect(w.until(sdk.getState()!)).toBe(false);
        w.stop();
    });
    test('holds once a page follows the message, though a burst never publishes the last page', () => {
        const sdk = new FakeSdk(stateAt(STARTS.I!));
        const w = afterMessage(sdk, LANDED.kentSlug);
        const t = sdk.getState()!.tick;
        sdk.tick(st => ({ ...page(false), gameMessages: [...st.gameMessages, msg(t + 1, 'He pulls a sea slug from under your top.')] }));
        expect(w.until(sdk.getState()!)).toBe(false); // the p_delay(1) after the message, chat closed
        sdk.tick(page(true));
        sdk.tick(page(false));
        expect(w.until(sdk.getState()!)).toBe(true);
        w.stop();
    });
});

// ------------------------------------------------------------------ the exit

describe('Q: the exit drops (the slot ledger T19-20 drops, moved into the step)', () => {
    test("dead at the exit: the torch (lit or not), the sticks, the glass, the pearls and Kent's slug; not H15's runes", () => {
        for (const id of [ITEM.torchLit, ITEM.torchUnlit, ITEM.dry, ITEM.damp, ITEM.glass, ITEM.pearls, ITEM.slug, ITEM.paste]) expect(DEAD_AT_EXIT).toContain(id);
        for (const i of own()) expect(DEAD_AT_EXIT).not.toContain(i.id);
    });
    test('the postcondition: complete, nothing dead held', () => {
        const post = (s: BotWorldState) => byLetter('Q').postconditions(s, {});
        expect(post(exitState())).toBe(true);
        expect(post(exitState([ITEM.pearls]))).toBe('exit: still holding Oyster pearls');
    });
    test('a resumed Q with the reward given drops only the dead items, all at once', async () => {
        const s = exitState([ITEM.torchLit, ITEM.glass, ITEM.dry, ITEM.pearls]);
        const keep = s.inventory.filter(i => !DEAD_AT_EXIT.includes(i.id)).map(i => i.slot);
        const sdk = new FakeSdk(s);
        sdk.onSend = (a, f) => {
            if (a.method === 'sendDropItem') {
                const slot = a.args[0] as number;
                setTimeout(() => f.tick(st => ({ inventory: st.inventory.filter(i => i.slot !== slot) })), 1);
            }
        };
        const { ctx } = ctxFor(sdk);
        await drive(sdk, byLetter('Q').run(ctx) as Promise<unknown>, 40);
        const drops = sdk.sent.filter(a => a.method === 'sendDropItem').map(a => a.args[0] as number);
        expect(drops).toHaveLength(4);
        expect(drops.some(slot => keep.includes(slot))).toBe(false);
        expect(sdk.sent.map(a => a.method)).not.toContain('sendInteractNpc');
        expect(byLetter('Q').postconditions(sdk.getState()!, {})).toBe(true);
        expect(sdk.getState()!.inventory.map(i => i.name).sort()).toEqual(['Air rune', 'Law rune', 'Water rune']);
    });
});

describe("a click's message reply on the browser's tick (the click's own) and lite's (the next)", () => {
    const msg = (text: string, tick: number, observationId: number) => ({ type: 0, text, sender: '', tick, observationId, fromSelf: false }) as unknown as BotWorldState['gameMessages'][number];
    const fail = 'You rub together the dry sticks and the sticks smoke momentarily then die out.'; // quest_seaslug.rs2:49

    test('replyAfter sees a reply stamped on the click tick, and not an older copy of it', () => {
        const sdk = new FakeSdk(arrival({ tick: 50, gameMessages: [msg(fail, 44, 61)] }));
        const r = replyAfter(sdk, LANDED.rubFailed);
        expect(r.seen(sdk.getState()!)).toBe(false);
        sdk.push(st => ({ gameMessages: [...st.gameMessages, msg(fail, 50, 70)] })); // browser: the click's tick 50
        expect(r.seen(sdk.getState()!)).toBe(true);
        expect(r.first()).toBe(fail);
    });

    test('K: a failed rub answered on the click tick is seen at once, and the next rub lights the torch', async () => {
        const s = stateAt(STARTS.K!);
        const sdk = new FakeSdk(s);
        let rubs = 0;
        let obs = 100;
        sdk.onSend = (a, f) => {
            if (a.method !== 'sendUseItem') return;
            rubs++;
            const t = f.state!.tick;
            if (rubs === 1) queueMicrotask(() => f.push(st => ({ gameMessages: [...st.gameMessages, msg(fail, t, ++obs)] })));
            else setTimeout(() => f.tick(st => ({ inventory: st.inventory.map(i => (i.id === ITEM.torchUnlit ? { ...i, id: ITEM.torchLit } : i)) })), 1);
        };
        const { ctx } = ctxFor(sdk);
        const t0 = sdk.getState()!.tick;
        await drive(sdk, byLetter('K').run(ctx) as Promise<unknown>, 30);
        expect(rubs).toBe(2);
        expect(sdk.getState()!.tick - t0).toBeLessThan(5); // not the 10-tick wait a missed reply costs
        expect(byLetter('K').postconditions(sdk.getState()!, {})).toBe(true);
    });
});

describe("Q: the reward's level-up page ends the wait (converse expect 'interrupt')", () => {
    const caroline = { kind: 'npc', id: 4877, index: 12, name: 'Caroline', combatLevel: 0, x: CAROLINE_AT.x, z: CAROLINE_AT.z, distance: 1, hp: null, optionsWithIndex: [{ text: 'Talk-to', opIndex: 1 }] } as unknown as NonNullable<BotWorldState['nearbyNpcs']>[number];
    const page = (id: string, text: string, isWaiting = false): BotWorldState['dialog'] => ({
        isOpen: true, isWaiting, pageId: id, options: [{ index: 1, text: 'Click here to continue', buttonType: 6, componentId: 10 }],
        allComponents: [{ id: 0, type: 4, buttonType: 0, option: '', text }],
    }) as unknown as BotWorldState['dialog'];
    const closed = { isOpen: false, isWaiting: false, options: [] } as unknown as BotWorldState['dialog'];
    const levelUp = page('lu', 'Congratulations, you just advanced a Fishing level.');

    /**
     * caroline.rs2's caroline_savedkennith: nine pages one per click, the reward granted on the
     * seventh (complete, the pearls), then the level-up page `after` ticks past her chat closing;
     * drops land a tick after they are sent. Returns the ticks the level-up page closed and the
     * first drop went out.
     */
    async function rewardRun(after: number) {
        const s = stateAt(STARTS.Q!);
        s.nearbyNpcs = [caroline];
        const sdk = new FakeSdk(s);
        let shown = -1;
        let advance = false;
        let closedAt = -1;
        let lvl: 'due' | 'shown' | 'clicked' | 'done' = 'due';
        let lvlClosedAt = -1;
        let dropAt = -1;
        const drops: number[] = [];
        sdk.onSend = (a, f) => {
            if (a.method === 'sendInteractNpc' && shown < 0) advance = true;
            if (/ClickDialog|clickDialogByText/.test(a.method)) {
                const cur = f.state!.dialog;
                queueMicrotask(() => f.push({ dialog: { ...cur, isWaiting: true } }));
                if (lvl === 'shown') lvl = 'clicked';
                else advance = true;
            }
            if (a.method === 'sendDropItem') {
                drops.push(a.args[0] as number);
                if (dropAt < 0) dropAt = f.state!.tick;
            }
        };
        const each = (st: BotWorldState): Partial<BotWorldState> => {
            const tick = st.tick + 1;
            const out: Partial<BotWorldState> = {};
            if (drops.length) {
                out.inventory = st.inventory.filter(i => !drops.includes(i.slot));
                drops.length = 0;
            }
            if (advance) {
                advance = false;
                shown++;
                if (shown === 7) {
                    out.quests = { [quest]: 'complete' } as BotWorldState['quests'];
                    out.inventory = [...(out.inventory ?? st.inventory), item(ITEM.pearls)];
                }
                if (shown < 9) out.dialog = page(`p${shown}`, `Caroline page ${shown + 1}`);
                else { out.dialog = closed; closedAt = tick; }
            } else if (lvl === 'due' && closedAt >= 0 && tick === closedAt + after) {
                out.dialog = levelUp;
                lvl = 'shown';
            } else if (lvl === 'clicked') {
                out.dialog = closed;
                lvl = 'done';
                lvlClosedAt = tick;
            }
            return out;
        };
        const { ctx, log } = ctxFor(sdk);
        const Q = steps({ dialogue: 'fixed' }).find(st => letterOf(st.name) === 'Q')!;
        await drive(sdk, Q.run(ctx) as Promise<unknown>, 120, each);
        return { sdk, log, closedAt, lvlClosedAt, dropAt };
    }

    test('the page 3 ticks after her chat closes (the lab trace): the drops go out the tick it is seen closed, no openTicks wait', async () => {
        const { sdk, closedAt, lvlClosedAt, dropAt } = await rewardRun(3);
        expect(closedAt).toBeGreaterThan(0);
        expect(lvlClosedAt).toBe(closedAt + 4);
        expect(dropAt).toBe(lvlClosedAt);
        expect(byLetter('Q').postconditions(sdk.getState()!, {})).toBe(true);
    });

    test("the page inside her talk's idle wait: answered there, and no second wait", async () => {
        const { sdk, log, closedAt, lvlClosedAt, dropAt } = await rewardRun(1);
        expect(lvlClosedAt).toBe(closedAt + 2);
        expect(dropAt).toBeLessThan(lvlClosedAt + LEVEL_UP_TICKS);
        expect(JSON.stringify(log.rows)).toContain('"levelUpInTalk":1');
        expect(byLetter('Q').postconditions(sdk.getState()!, {})).toBe(true);
    });
});
