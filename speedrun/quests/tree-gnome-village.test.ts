import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BotWorldState, InventoryItem, PlayerState } from '../../sdk/types';
import { PRAYER_INDICES } from '../../sdk/types';
import { QUESTS } from '../data/quest-stages';
import { drive, FakeSdk, baseState, runeNeedProblems } from '../lib/fake-sdk';
import { journalProbeName } from '../lib/quests';
import { TickLog } from '../lib/ticks';
import { configId } from '../lib/world';
import { Observation, resolveResume } from '../runner/resume';
import type { Observed, RunnerSession, StepContext } from '../runner/step';
import { parseLedger } from '../tools/slot-ledger';
import { DEFAULT_DIALOGUE, slotNeed } from './segments';
import {
    ARRIVAL, BOLREN, exitCheck, H7, h7Want, inVillage, JUMP_IN, kitCheck, LETTERS, MONTAI, observed, QUEST_ITEMS, quest, REWARD_ATTACK_XP, resolveOptions, RUNE_NEED, RUNE_STAFF, RUNE_USE,
    stepId, steps, VILLAGE_TREE, WARLORD, WARLORD_CASTS, WARLORD_MAX_CASTS,
} from './tree-gnome-village';

const ORB = configId('obj', 'orb_of_protection');
const ORBS = configId('obj', 'orbs_of_protection');

let nextSlot = 0;
const wearable = [{ text: 'Wield', opIndex: 2 }];
const item = (name: string, count = 1, id = 5000 + nextSlot): InventoryItem =>
    ({ slot: nextSlot++, id, name, count, optionsWithIndex: /staff|amulet/i.test(name) ? wearable : [] }) as unknown as InventoryItem;
const skill = (name: string, level: number, experience = 0) => ({ name, level, baseLevel: level, experience });
const player = (x: number, z: number, level = 0, hp = 10): PlayerState => ({ name: 'lab', x, z, worldX: x, worldZ: z, level, hp, maxHp: 10 }) as PlayerState;

/** SCORED's own pack after S09's exit (the inventory ledger): rune axe, knife, spade, 4 buckets, law / air / water. */
const pack = () => [item('Rune axe'), item('Knife'), item('Spade'), ...Array.from({ length: 4 }, () => item('Bucket')), item('Law rune', 1), item('Air rune', 5), item('Water rune', 2)];
/** H7's pack items; `logs` false once Montai has them. */
const h7 = (logs = true) => [
    ...(logs ? Array.from({ length: 6 }, () => item('Logs')) : []),
    item('Shark'), item('Shark'), item('Antipoison(4)'), item('Death rune', 110), item('Chaos rune', 40),
];
const KIT_WORN = () => [item('Staff of fire'), item('Amulet of magic'), item('Gas mask')];
const ARRIVAL_WORN = () => [item('Staff of water'), item('Gas mask')];

function scored(over: Partial<BotWorldState> = {}): BotWorldState {
    nextSlot = 0;
    const prayers = { activePrayers: [] as boolean[], prayerPoints: 94, prayerLevel: 94 };
    return baseState({
        tick: 100,
        quests: { elena: 'complete' } as BotWorldState['quests'],
        skills: [skill('Attack', 1), skill('Strength', 1), skill('Defence', 1), skill('Hitpoints', 10), skill('Magic', 59), skill('Prayer', 94)],
        prayers,
        player: player(ARRIVAL.x, ARRIVAL.z),
        inventory: pack(),
        equipment: ARRIVAL_WORN(),
        ...over,
    } as Partial<BotWorldState>);
}

/** The pack and worn items after segment A: H7 held, the staff of fire and amulet worn. */
function kitted(over: Partial<BotWorldState> = {}, logs = true): BotWorldState {
    const s = scored(over);
    s.inventory = [...pack(), ...h7(logs)];
    s.inventory.find(i => i.name === 'Air rune')!.count = 555;
    s.equipment = KIT_WORN();
    return s;
}

const list = steps();
const letterOf = (name: string) => name.split(':')[1]!.split('-')[0]!;
const byLetter = (l: string) => list.find(s => letterOf(s.name) === l)!;

// ------------------------------------------------------------------ journal (tree_journal.rs2, through quest-stages.ts's markers)

type Stage = (typeof QUESTS.tree.stages)[number]['name'];
const journal = (stage: Stage) => ({ title: 'Tree Gnome Village', lines: [QUESTS.tree.stages.find(s => s.name === stage)!.journal!] });

interface Start { stage: Stage | null; at: [number, number, number?]; kit: boolean; logs?: boolean; extra?: InventoryItem[] }
/** Each segment's start: the %treequest stage (null: not started), where the segment before it ends, and the pack. */
const STARTS: Record<string, () => Start> = {
    A: () => ({ stage: null, at: [ARRIVAL.x, ARRIVAL.z], kit: false }),
    B: () => ({ stage: null, at: [ARRIVAL.x, ARRIVAL.z], kit: true }),
    C: () => ({ stage: null, at: [2515, 3161], kit: true }),
    D: () => ({ stage: 'started', at: [ARRIVAL.x, ARRIVAL.z], kit: true }),
    E: () => ({ stage: 'spoken_montai', at: [MONTAI.x - 1, MONTAI.z - 2], kit: true }),
    F: () => ({ stage: 'given_logs_montai', at: [MONTAI.x - 1, MONTAI.z - 2], kit: true, logs: false }),
    G: () => ({ stage: 'finding_trackers', at: [MONTAI.x - 1, MONTAI.z - 2], kit: true, logs: false }),
    H: () => ({ stage: 'ballista_fired', at: [2511, 3210], kit: true, logs: false }),
    I: () => ({ stage: 'retrieved_orb', at: [2503, 3253], kit: true, logs: false, extra: [item('Orb of protection', 1, ORB)] }),
    J: () => ({ stage: 'retrieved_orb', at: [JUMP_IN.x, JUMP_IN.z], kit: true, logs: false, extra: [item('Orb of protection', 1, ORB)] }),
    K: () => ({ stage: 'returned_first_orb', at: [ARRIVAL.x, ARRIVAL.z], kit: true, logs: false }),
    L: () => ({ stage: 'defeated_warlord', at: [WARLORD.x, WARLORD.z], kit: true, logs: false, extra: [item('Orb of protection', 1, ORBS)] }),
    M: () => ({ stage: 'defeated_warlord', at: [JUMP_IN.x, JUMP_IN.z], kit: true, logs: false, extra: [item('Orb of protection', 1, ORBS)] }),
    N: () => ({ stage: 'defeated_warlord', at: [BOLREN.x + 1, BOLREN.z - 1], kit: true, logs: false }),
};

function startState(letter: string): { state: BotWorldState; stage: Stage | null } {
    const st = STARTS[letter]!();
    const p = player(st.at[0], st.at[1], st.at[2] ?? 0);
    const s = st.kit ? kitted({ player: p }, st.logs ?? true) : scored({ player: p });
    s.inventory.push(...(st.extra ?? []));
    if (st.stage) s.quests = { ...s.quests, [quest]: 'started' } as BotWorldState['quests'];
    return { state: s, stage: st.stage };
}

function startOf(letter: string): Observed {
    const { state, stage } = startState(letter);
    return observed(state, stage ? journal(stage) : undefined);
}

function complete(): Observed {
    const s = kitted({ player: player(VILLAGE_TREE.x - 1, VILLAGE_TREE.z + 1) }, false);
    s.quests = { ...s.quests, [quest]: 'complete' } as BotWorldState['quests'];
    s.questPoints = 2;
    s.skills = s.skills.map(k => (k.name === 'Attack' ? skill('Attack', 50, REWARD_ATTACK_XP + 3_000) : k));
    return observed(s);
}

// ------------------------------------------------------------------ tests

describe('segment table', () => {
    test('names are unique, start with S10b: and run A..N in order', () => {
        expect(stepId).toBe('S10b');
        expect(quest).toBe('tree');
        expect(list.map(s => letterOf(s.name))).toEqual([...LETTERS]);
        expect(new Set(list.map(s => s.name)).size).toBe(list.length);
        expect(list.map(s => s.name)).toEqual([
            'S10b:A-kit', 'S10b:B-maze', 'S10b:C-bolren-start', 'S10b:D-montai-wood', 'S10b:E-montai-logs', 'S10b:F-montai-coords', 'S10b:G-ballista',
            'S10b:H-stronghold', 'S10b:I-elkoy-orb', 'S10b:J-bolren-orb', 'S10b:K-warlord', 'S10b:L-elkoy-orbs', 'S10b:M-bolren-orbs', 'S10b:N-ceremony',
        ]);
    });

    test('logout-unsafe only from the orbs leaving to the quest scroll (M); safe at the end', () => {
        expect(list.filter(s => !s.logoutSafe).map(s => s.name)).toEqual(['S10b:M-bolren-orbs']);
        expect(list[list.length - 1]!.logoutSafe).toBe(true);
    });

    test('every stage-setting segment has a done; the travel and hand-over segments are transient', () => {
        expect(list.filter(s => !s.done).map(s => letterOf(s.name))).toEqual(['A', 'B', 'I', 'L', 'M']);
    });

    test('option defaults: burst dialogue, Fire Blast; both dialogue modes build the same table', () => {
        expect(DEFAULT_DIALOGUE).toBe('burst');
        expect(resolveOptions().warlordSpell).toBe('fire_blast');
        expect(steps({ dialogue: 'fixed' }).map(s => s.name)).toEqual(list.map(s => s.name));
    });

    test('the journal probe is asked for wherever a stage between started and complete is the mark', () => {
        for (const l of ['D', 'E', 'F', 'G', 'H', 'J', 'K']) expect(byLetter(l).probes).toEqual([journalProbeName(quest)]);
    });
});

describe('A: the entry preconditions', () => {
    const pre = (s: BotWorldState, opts = {}) => steps(opts)[0]!.preconditions(s, {});

    test('pass on the arrival tile with SCORED\'s pack, before H7', () => {
        expect(pre(scored())).toBe(true);
    });
    test('off the arrival tile fails, by coordinates', () => {
        expect(pre(scored({ player: player(ARRIVAL.x + 4, ARRIVAL.z) }))).toMatch(/maze entrance/);
    });
    test('the quest already started fails', () => {
        expect(pre(scored({ quests: { elena: 'complete', tree: 'started' } as BotWorldState['quests'] }))).toMatch(/Tree Gnome Village/);
    });
    test('Plague City not done fails', () => {
        expect(pre(scored({ quests: {} as BotWorldState['quests'] }))).not.toBe(true);
    });
    test('Magic 58 fails for Fire Blast; the Fire Bolt fallback needs 35', () => {
        const s = scored();
        s.skills = s.skills.map(k => (k.name === 'Magic' ? skill('Magic', 58) : k));
        expect(pre(s)).toMatch(/magic 58\/59/i);
        expect(pre(s, { warlordSpell: 'fire_bolt' })).toBe(true);
    });
    test('Prayer below 43 fails (Protect from Melee)', () => {
        const s = scored();
        s.skills = s.skills.map(k => (k.name === 'Prayer' ? skill('Prayer', 42) : k));
        expect(pre(s)).toMatch(/prayer 42\/43/i);
    });
    test('free slots must cover H7, computed from its list: 13 free passes, 12 names the shortfall', () => {
        // H7 adds 6 logs, the staff, the amulet, the antipoison and 2 sharks (11) and the death and
        // chaos stacks (2); the air stack is already held.
        const fill = (free: number) => {
            const s = scored();
            s.inventory.push(...Array.from({ length: 28 - s.inventory.length - free }, () => item('Bucket')));
            return s;
        };
        expect(pre(fill(13))).toBe(true);
        expect(pre(fill(12))).toMatch(/^inventory: segment A needs 13 free slots \(.*\), 12 free: 1 short$/);
    });
});

describe('H7: the kit', () => {
    test('the module\'s H7 is the inventory ledger\'s row H7 (STEP-MANIFEST.md), item for item', () => {
        const md = readFileSync(join(import.meta.dir, '../../docs/speedrun/STEP-MANIFEST.md'), 'utf8');
        const row = parseLedger(md).rows.find(r => r.row === 'H7')!;
        expect(row).toBeDefined();
        // A potion's dose count is not the kit's business: any Antipoison(n) serves.
        const bare = (name: string) => name.replace(/[\^$\\]/g, '').replace(/\((\d|d)\)$/, '').replace(/^normal logs$/, 'logs').toLowerCase();
        const ledger = row.in.map(e => ({ name: bare(e.name), n: e.count, stackable: e.kind === 's' }));
        const module: unknown = H7.map(l => ({ name: bare(l.name), n: l.n, stackable: !!l.stackable }));
        expect(module).toEqual(ledger);
        expect(row.equip.filter(e => e.on).map(e => e.name).sort()).toEqual(H7.filter(l => l.wear).map(l => l.name.toLowerCase()).sort());
        expect(row.equip.filter(e => !e.on).map(e => e.name)).toEqual(['staff of water']);
    });

    test('what is missing is asked for; the worn staff and amulet count as held', () => {
        expect(h7Want(scored()).map(w => [String(w.item), w.amount])).toEqual([
            ['/^Logs$/i', 6], ['/^Staff of fire$/i', 1], ['/^Amulet of magic$/i', 1], ['/^Antipoison\\(\\d\\)$/i', 1], ['/^Shark$/i', 2],
            ['/^Death rune$/i', 110], ['/^Chaos rune$/i', 40], ['/^Air rune$/i', 545],
        ]);
        expect(h7Want(kitted())).toEqual([]);
    });

    test('A with a kitFrom and the full H7 kit already held sends nothing and passes its postconditions', async () => {
        const sdk = new FakeSdk(kitted());
        const a = steps({ kitFrom: 'Ashburn' }).find(s => s.name === `${stepId}:A-kit`)!;
        await drive(sdk, a.run(ctxFor(sdk)), 10);
        expect(sdk.sent).toEqual([]);
        expect(a.postconditions(sdk.state!, {})).toBe(true);
    });

    test('A without a giver and without the kit stops before any click', async () => {
        const sdk = new FakeSdk(scored());
        await expect(byLetter('A').run(ctxFor(sdk))).rejects.toThrow(/no kitFrom to receive H7/);
        expect(sdk.sent).toEqual([]);
    });
});

function ctxFor(sdk: FakeSdk): StepContext<unknown> {
    const session = { sdk, bot: {}, name: 'lab', sessionId: 0 } as unknown as RunnerSession;
    return { session, sdk, bot: session.bot, c: {}, log: TickLog.memory('t') } as unknown as StepContext<unknown>;
}

describe('slot ledger (rs/158): the staff of water and the gnome amulet leave at their last use', () => {
    test('A wears the staff of fire and the amulet in one tick, then drops the staff of water they free', async () => {
        const s = scored();
        s.inventory.push(...h7(), item('Staff of fire'), item('Amulet of magic'));
        s.inventory.find(i => i.name === 'Air rune')!.count = 555;
        const sdk = new FakeSdk(s);
        sdk.onSend = (a, f) => {
            if (a.method === 'sendUseItem') {
                f.push(st => {
                    const it = st.inventory.find(i => i.slot === a.args[0])!;
                    const swapped = /staff/i.test(it.name) ? st.equipment.find(e => /staff/i.test(e.name)) : undefined;
                    return {
                        inventory: [...st.inventory.filter(i => i !== it), ...(swapped ? [{ ...swapped, slot: it.slot }] : [])],
                        equipment: [...st.equipment.filter(e => e !== swapped), it],
                    };
                });
            }
            if (a.method === 'sendDropItem') f.push(st => ({ inventory: st.inventory.filter(i => i.slot !== a.args[0]) }));
        };
        await drive(sdk, byLetter('A').run(ctxFor(sdk)), 40);
        const uses = sdk.sent.filter(a => a.method === 'sendUseItem');
        expect(uses.length).toBe(2);
        expect(sdk.sent.filter(a => a.method === 'sendDropItem').length).toBe(1);
        expect(sdk.state!.inventory.some(i => /staff of water/i.test(i.name))).toBe(false);
        expect(kitCheck(sdk.state!)).toBe(true);
        expect(byLetter('A').postconditions(sdk.state!, {})).toBe(true);
    });

    test('the kit check fails while the staff of water is still held', () => {
        const s = kitted();
        s.inventory.push(item('Staff of water'));
        expect(kitCheck(s)).toMatch(/staff of water is still held/);
    });

    test('the exit state fails while the gnome amulet is held, and passes once it is dropped', () => {
        const s = complete().state;
        expect(exitCheck(s)).toBe(true);
        s.inventory.push(item('Gnome amulet'));
        expect(exitCheck(s)).toMatch(/gnome amulet/);
        expect(byLetter('N').postconditions(s, {})).toMatch(/gnome amulet/);
    });

    test('the step keeps nothing it received: every quest item has an `until` except what S14 and the run keep (antipoison, sharks, runes)', () => {
        const kept = QUEST_ITEMS.filter(q => q.until === undefined).map(q => q.name);
        expect(kept).toEqual(['Antipoison', 'Shark', 'Death rune', 'Chaos rune', 'Air rune']);
        expect(QUEST_ITEMS.find(q => q.name === 'Gnome amulet')).toMatchObject({ from: 'N', until: 'N' });
        expect(QUEST_ITEMS.some(q => /staff of water/i.test(String(q.name)))).toBe(false);
    });

    test('the orb (H-J) and the orbs (K-M) are told apart by object id, not name', () => {
        const s = kitted({}, false);
        s.inventory.push(item('Orb of protection', 1, ORBS));
        expect(slotNeed(s, QUEST_ITEMS, LETTERS, 'H')).toMatchObject({ slots: 1, peak: 'H' });
        // From K on the orbs are already held, and the slot Bolren frees by taking them at M is the
        // gnome amulet's at N: nothing more is needed.
        expect(slotNeed(s, QUEST_ITEMS, LETTERS, 'K')).toMatchObject({ slots: 0 });
    });
});

describe('done at each stage', () => {
    const milestones = LETTERS.filter(l => byLetter(l).done);
    for (const l of milestones) {
        test(`${l}: not done at its own start, done at the next milestone's start`, () => {
            const step = byLetter(l);
            expect(step.done!(startOf(l), {})).toBe(false);
            // K's mark is the orbs in hand, which M hands to Bolren: check it at L's start.
            const next = l === 'K' ? 'L' : milestones[milestones.indexOf(l) + 1];
            expect(step.done!(next ? startOf(next) : complete(), {})).toBe(true);
        });
    }

    test('the quest tab alone cannot tell the stages apart: D-K need the journal', () => {
        for (const l of ['E', 'F', 'G', 'H']) expect(byLetter(String.fromCharCode(l.charCodeAt(0) - 1)).done!(observed(startOf(l).state), {})).toBe(false);
    });

    test('H is not done while SCORED is still upstairs with the orb', () => {
        const o = startOf('I');
        o.state.player = player(2506, 3258, 1);
        expect(byLetter('H').done!(o, {})).toBe(false);
    });

    test('K is not done at stage 8 with the orbs gone and the quest not complete (a ceremony lost to a logout)', () => {
        expect(byLetter('K').done!(startOf('N'), {})).toBe(false);
    });
});

describe('resume from each segment', () => {
    for (const l of LETTERS.filter(x => x !== 'N')) {
        test(`the resume walk starts ${l} from its start state`, async () => {
            const o = startOf(l);
            const obs = new Observation(o.state);
            Object.assign(obs.probed, o.probed);
            obs.probed[journalProbeName(quest)] ??= null;
            const point = await resolveResume(list, obs, {});
            expect(point.step).toBe(byLetter(l).name);
            expect(point.mode).toBe('run');
        });
    }

    test('a logout inside the ceremony (stage 8, the orbs with Bolren) resumes at K: the warlord gives the orbs again', async () => {
        const o = startOf('N');
        const obs = new Observation(o.state);
        Object.assign(obs.probed, o.probed);
        const point = await resolveResume(list, obs, {});
        expect(point.step).toBe('S10b:K-warlord');
    });

    test('the quest complete is finished', async () => {
        const obs = new Observation(complete().state);
        obs.probed[journalProbeName(quest)] = null;
        expect((await resolveResume(list, obs, {})).mode).toBe('finished');
    });
});

describe('places, by coordinates', () => {
    test('the village is the fence\'s outline: Bolren, the spirit tree and the railing\'s inside tile in; the maze round it out', () => {
        const at = (x: number, z: number) => inVillage(scored({ player: player(x, z) }));
        for (const [x, z] of [[BOLREN.x, BOLREN.z], [VILLAGE_TREE.x, VILLAGE_TREE.z], [2515, 3161], [2529, 3162]]) expect(at(x!, z!)).toBe(true);
        // Tiles the lab's maze walk crossed (2026-10-22 traces).
        for (const [x, z] of [[2543, 3177], [2546, 3165], [2550, 3157], [2532, 3156], [2515, 3160], [2529, 3179]]) expect(at(x!, z!)).toBe(false);
    });

    test('K refuses with Protect from Melee unavailable, and without the runes for the warlord', () => {
        const s = startState('K').state;
        expect(byLetter('K').preconditions(s, {})).toBe(true);
        s.inventory = s.inventory.filter(i => i.name !== 'Death rune');
        expect(byLetter('K').preconditions(s, {})).toMatch(/death runes/);
    });
});

describe('N: the exit state', () => {
    test('complete, the reward, beside the spirit tree, nothing open passes', () => {
        expect(byLetter('N').postconditions(complete().state, {})).toBe(true);
    });
    test('the quest scroll still open fails', () => {
        const s = complete().state;
        s.modalOpen = true;
        expect(exitCheck(s)).toMatch(/still open/);
    });
    test('Attack short of the reward fails', () => {
        const s = complete().state;
        s.skills = s.skills.map(k => (k.name === 'Attack' ? skill('Attack', 1, 0) : k));
        expect(exitCheck(s)).toMatch(/Attack xp 0/);
    });
    test('away from the spirit tree fails', () => {
        const s = complete().state;
        s.player = player(ARRIVAL.x, ARRIVAL.z);
        expect(exitCheck(s)).toMatch(/village spirit tree/);
    });
});

void PRAYER_INDICES;

describe('rune pins: RUNE_USE and RUNE_NEED agree with K (tools/rune-pins.ts)', () => {
    test("RUNE_NEED.K is exactly what K's precondition wants held", () => {
        expect(runeNeedProblems(s => byLetter('K').preconditions(s, {}), startState('K').state, RUNE_NEED.K!)).toEqual([]);
    });
    test("K's Fire Blasts are the measured maximum, inside WARLORD_CASTS, their fire the staff's", () => {
        expect(RUNE_USE.K!.deathrune).toBe(WARLORD_MAX_CASTS);
        expect(WARLORD_MAX_CASTS).toBeLessThanOrEqual(WARLORD_CASTS);
        expect(RUNE_USE.K!.firerune).toBeUndefined();
        const s = startState('K').state;
        const staff = new RegExp(RUNE_STAFF, 'i');
        expect(byLetter('K').preconditions({ ...s, equipment: s.equipment.filter(i => !staff.test(i.name)) }, {})).toMatch(staff);
    });
});
