// Main's invariant for the run chain (rs/562 B, rs/577): a milestone's `done` stays true for the rest of
// the attempt once it holds. resolveResume (resume.ts) walks to the first milestone that reads undone, so
// one that turns false later sends a resume back into a step whose preconditions refuse, or that runs again.
//
// The first cut covers the non-quest milestones: skill bands, placed hand-offs, S21's relog halves, cue stops
// and the fallbacks. For each one, the test builds the state at the completion of every later non-quest
// milestone from the run's own sources, and the earlier milestone's `done` must hold there:
// - pack and worn set: STEP-MANIFEST.md's inventory ledger, walked by tools/slot-ledger.ts `walk` to the
//   milestone's own row (ROW);
// - position: where the next leg starts (S21's relog halves: where T20-21 ends);
// - skills: every band's target so far (BANDS), S25a's xp mark per inventory;
// - quests: each quest finished before the milestone shows complete on the quest tab;
// - what the run keeps beside the game: the attempt's hand-off record with every hand-off so far, the relog
//   budget with S21's entry opened then closed, a cue sink whose open scope follows the chain's opens and
//   stops, the S03 go cue, and the bone givers' status files with the attempt's S07 session and the last
//   load given.
// The quest segments' own `done`s (about 200 bespoke journal and position reads) belong to rs/185's audit.
// In the walk they read done exactly when they come before the state.
//
// A failing milestone is a finding for rs/186, not something this file fixes. It goes in FLOOR, naming the
// state that breaks it and the predicate's line, and its case becomes a test.todo (`bun test --todo` shows it).

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { BotWorldState, PlayerState } from '../../sdk/types';
import { canonName, type CueScope } from '../helpers/altar-cue';
import { GO_FILE } from '../helpers/fm-row';
import { baseState } from '../lib/fake-sdk';
import { levelForXp, xpForLevel } from '../lib/xp';
import * as smithing from '../skills/smithing';
import { MANIFEST, parseLedger, walk, type Held } from '../tools/slot-ledger';
import { boneSession, buildChain, isCueStop, KIT_PARTNER_ROWS, PLACEMENT, type ChainStep, type CueSink, type RunConfig } from './chain';
import { AttemptRecord } from './attempt-record';
import type { LegStep } from './legs';
import { RelogBudget } from './relog-budget';
import { Observation, resolveResume, ResumeError } from './resume';
import { SCORED_LOGIN, SCORED_LOGOUT, SCORED_RELOG } from './scored-relog';

const ATTEMPT = 'attempt-1';
const MANIFEST_TEXT = readFileSync(MANIFEST, 'utf8');
const BASE = mkdtempSync(join(tmpdir(), 'chain-monotonic-'));
const PARTNERS: Record<string, string> = { ...Object.fromEntries([...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS].map(id => [id, `p_${id.toLowerCase()}`])), H12a: 'p_h12', H12b: 'p_h12' };
/** S07's run shape: the b01-b04 group with the runes' last load (rs/663). */
const BONE_GROUP = ['cairn_b01', 'cairn_b02', 'cairn_b03', 'cairn_b04'] as const;
const config = (dir: string): RunConfig => ({
    partners: PARTNERS,
    firemakingTiles: '3222,3219;3221,3219;3220,3219',
    rings: { giver: 'ring_giver' },
    bones: { group: BONE_GROUP, lastLoad: 21 },
    courier: { giver: 'courier', below: 3 },
    anvil: { giver: 'anvil_helper' },
    cueDir: join(dir, 'cue'),
    h12o: { account: 'cairn_h45', cueDir: join(dir, 'h45-cue'), loginDir: join(dir, 'h45-login'), leadTicks: 300 },
});

// ------------------------------------------------------------------ which steps

const QUEST_OF: Readonly<Record<string, string>> = {
    S05: 'doric', S08: 'elena', S10b: 'tree', S11b: 'grandtree', S12: 'arena', S13: 'mcannon', S15: 'mm', S16: 'magearena', S19: 'seaslug', S20: 'fishingcompo', S23: 'cook', S26: 'dragon',
};
/** A quest segment's quest (S24's three by their segment letter), or null. */
const questOf = (s: ChainStep): string | null => (s.id === 'S24' ? ({ G: 'gobdip', D: 'druid', R: 'romeojuliet' } as Record<string, string>)[s.name.slice(4, 5)] ?? null : QUEST_OF[s.id] ?? null);
/** h45's login trigger is done at Monkey Madness's segment M (a journal read): a quest milestone here. */
const isQuest = (s: ChainStep) => questOf(s) !== null || s.id === 'H12o login';

const prevCue = process.env.RC_CUE_DIR;
afterAll(() => {
    if (prevCue === undefined) delete process.env.RC_CUE_DIR;
    else process.env.RC_CUE_DIR = prevCue;
});
const noCues: CueSink = { open: async () => {}, stop: () => {}, isOpen: () => false };
process.env.RC_CUE_DIR = join(BASE, 'ref', 'cue');
const REF = buildChain(config(join(BASE, 'ref')), { cues: noCues, attempt: ATTEMPT });
const MILESTONES = REF.flatMap((s, i) => (s.done && !isQuest(s) ? [i] : []));
const QUEST_END: Record<string, number> = {};
REF.forEach((s, i) => {
    const q = questOf(s);
    if (q) QUEST_END[q] = i;
});
const at = (name: string) => {
    const i = REF.findIndex(s => s.name === name);
    if (i < 0) throw new Error(`the chain has no step "${name}"`);
    return i;
};

// ------------------------------------------------------------------ the state at a milestone's completion

const STACKS = new Map(walk(parseLedger(MANIFEST_TEXT).rows).map(e => [e.row.row, e.stacks]));

/** The ledger row whose walked pack is the milestone's end. Hand-offs end at their own row (H1 at S01, which wields its staff). */
const ROW: readonly [RegExp, string][] = [
    [/^S00 /, 'S00'], [/^S03 dropper go cue$/, 'S00'], [/^S02 /, 'S02'], [/^S03 firemaking$/, 'S03'], [/^S04 /, 'S04'], [/^S06 /, 'S06'],
    [/^woodcutting:normal-1-15$/, 'H4k'], [/^woodcutting:oak-15-73$/, 'S07'], [/^woodcutting:(willow-73-99|drop-axe)$/, 'S07 last load'],
    [/^mining\.iron-63$/, 'H4p'], [/^mining\.exit$/, 'S09'], [/^agility:gnome$/, 'S11a'], [/^S14 cannon session$/, 'S14'], [/^S14 cannon cue stop$/, 'H11r'],
    [/^(thieving:knights|S18 courier cue stop|S18d-fallback fletching)/, 'S18'], [/^S21 relog:/, 'T20-21'], [/^S21 (runecraft|altar cue stop)$/, 'H17e'], [/^fishing:/, 'S22'],
    [/^S25a smithing 31\//, 'S25a finish'], [/^S25a smithing /, 'S25a'], [/^S25a anvil cue stop$/, 'S25a finish'], [/^S25d /, 'S25d'], [/^(S25e |S25b )/, 'S25e'], [/^S25c /, 'S25c'],
    [/^S27 /, 'S27'], [/^agility:wilderness$/, 'S17'],
];
const rowOf = (s: ChainStep): string => {
    if (s.kind === 'handoff') return s.id === 'S01' ? 'S01' : s.name.replace(/ hand-off$/, '');
    const r = ROW.find(([re]) => re.test(s.name));
    if (!r) throw new Error(`no ledger row for ${s.name}`);
    return r[1];
};

const SMITHING_MARKS = smithing.stepPlan({}).marks;
/** Each band's levels at its end (S09's iron band mines 63 to 99; S18d's Fletching 99 is inside S18). */
const BANDS: readonly [RegExp, Record<string, number>][] = [
    [/^S02 /, { Magic: 7 }], [/^S03 firemaking$/, { Firemaking: 99 }], [/^S04 /, { Magic: 59 }], [/^S06 runecraft$/, { Runecraft: 44 }],
    [/normal-1-15/, { Woodcutting: 15 }], [/oak-15-73/, { Woodcutting: 73, Prayer: 70 }], [/willow-73-99/, { Woodcutting: 99, Prayer: 99 }],
    [/^mining\.iron-63$/, { Mining: 99 }], [/^agility:gnome$/, { Agility: 25 }], [/^S14 cannon session$/, { Ranged: 75 }],
    [/^thieving:knights$/, { Thieving: 99, Fletching: 99, Magic: 80 }], [/^S21 runecraft$/, { Runecraft: 99 }], [/^fishing:/, { Fishing: 99 }],
    [/^S25d /, { Crafting: 99 }], [/^S25e /, { Herblore: 99 }], [/^S25c /, { Cooking: 99 }],
    [/^S27 combat finish$/, { Attack: 99, Strength: 99, Defence: 99, Ranged: 99, Hitpoints: 99 }], [/^agility:wilderness$/, { Agility: 99 }],
];
const SKILLS = ['Attack', 'Defence', 'Strength', 'Hitpoints', 'Ranged', 'Prayer', 'Magic', 'Cooking', 'Woodcutting', 'Fletching', 'Fishing', 'Firemaking', 'Crafting', 'Smithing', 'Mining', 'Herblore', 'Agility', 'Thieving', 'Runecraft'];
function skillsAt(k: number): BotWorldState['skills'] {
    const xp: Record<string, number> = Object.fromEntries(SKILLS.map(n => [n, n === 'Hitpoints' ? xpForLevel(10) : 0]));
    for (let i = 0; i <= k; i++) {
        const name = REF[i]!.name;
        for (const [skill, level] of Object.entries(BANDS.find(([re]) => re.test(name))?.[1] ?? {})) xp[skill] = Math.max(xp[skill]!, xpForLevel(level));
        const inv = /^S25a smithing (\d+)\//.exec(name);
        if (inv) xp.Smithing = Math.max(xp.Smithing!, SMITHING_MARKS[Number(inv[1]) - 1]!);
    }
    return SKILLS.map(name => ({ name, level: levelForXp(xp[name]!), baseLevel: levelForXp(xp[name]!), experience: xp[name]! }));
}

/** The game's item names are capitalised; a stack at an unknown count (S21's body runes) shows 100. */
function items(list: readonly Held[]): BotWorldState['inventory'] {
    const out: BotWorldState['inventory'] = [];
    const put = (h: Held, count: number) => out.push({ slot: out.length, id: h.id ?? 20_000 + out.length, name: h.name[0]!.toUpperCase() + h.name.slice(1), count, optionsWithIndex: [] });
    for (const h of list) {
        if (h.kind === 'u') for (let n = 0; n < (h.count ?? 1); n++) put(h, 1);
        else put(h, h.count ?? 100);
    }
    return out;
}

const legNear = (k: number, dir: 1 | -1) => {
    for (let i = k + dir; i >= 0 && i < REF.length; i += dir) if (REF[i]!.kind === 'leg') return (REF[i] as ChainStep & LegStep).def;
    return undefined;
};
/** Where the milestone leaves SCORED: the next leg's start; S21's relog halves (and the run's last step) where the leg before ends. */
const placeOf = (k: number) => {
    const next = legNear(k, 1);
    return /^S21 relog:/.test(REF[k]!.name) || !next ? legNear(k, -1)!.dest : next.start;
};

const WILLOW_END = at('woodcutting:willow-73-99');

function stateAt(k: number): BotWorldState {
    const s = REF[k]!;
    const stacks = STACKS.get(rowOf(s))!;
    const inventory = items(stacks.inv);
    // The ledger's "S07 last load" row is after the axe drop; the willow band ends still holding the axe.
    if (k === WILLOW_END) inventory.push({ slot: inventory.length, id: 1359, name: 'Rune axe', count: 1, optionsWithIndex: [] });
    const p = placeOf(k);
    const quests = Object.fromEntries(Object.entries(QUEST_END).map(([q, end]) => [q, end < k ? 'complete' : 'not_started']));
    return baseState({
        inGame: s.name !== SCORED_LOGOUT,
        player: { name: 'Scored', x: p.x, z: p.z, worldX: p.x, worldZ: p.z, level: p.level ?? 0 } as PlayerState,
        inventory,
        equipment: items(stacks.worn),
        skills: skillsAt(k),
        quests,
    } as Partial<BotWorldState>);
}

// ------------------------------------------------------------------ what the run keeps beside the game

const sameScope = (a: CueScope, b: CueScope) => a.step === b.step && a.family === b.family;
const keeperOf = (sc: CueScope) => (sc.family === 'mule' ? 'mule' : 'main');
/**
 * The scopes open at k's completion, one per keeper (cue-keeper.ts RunCues: mule and main): a cueAround
 * step opens and stops its own, withCue and the cannon hand-offs leave theirs open until their cue stop, and
 * Runecraft's band opens its altar scope through the sink's writer.
 */
function openAt(k: number): Map<string, CueScope> {
    const open = new Map<string, CueScope>();
    for (let i = 0; i <= k; i++) {
        const s = REF[i]!;
        if (isCueStop(s)) {
            const [step, family] = s.name.split(' ') as [string, string];
            const o = open.get(keeperOf({ step, family } as CueScope));
            if (o && sameScope(o, { step, family } as CueScope)) open.delete(keeperOf(o));
        } else if (/^S(06|21) runecraft$/.test(s.name)) open.set('main', { step: s.id, family: 'altar' } as CueScope);
        else if (s.cue) {
            if (s.finalStop !== undefined) open.delete(keeperOf(s.cue));
            else open.set(keeperOf(s.cue), s.cue);
        }
    }
    return open;
}

interface World {
    chain: ChainStep[];
    /** `chain` with each quest milestone done exactly when it comes before the state. */
    walked: ChainStep[];
    obs: Observation;
}

function worldAt(k: number): World {
    const dir = join(BASE, `at-${k}`);
    const cueDir = join(dir, 'cue');
    mkdirSync(cueDir, { recursive: true });
    process.env.RC_CUE_DIR = cueDir;
    writeFileSync(join(cueDir, GO_FILE), JSON.stringify({ v: 1, ms: 1 }));
    // From the willow band's end on, b04 has served the runes' last load in this attempt's S07 session.
    if (k >= WILLOW_END) {
        for (const account of BONE_GROUP) {
            const last = account === 'cairn_b04';
            writeFileSync(join(cueDir, `bones-${canonName(account)}.json`), JSON.stringify({
                v: 1, account, phase: 'done', held: 0, n: 0, trades: 6, bounces: 0, tile: null, readyAt: null, session: boneSession(ATTEMPT), final: last, loads: 24, ...(last ? { lastGiven: true } : {}), ms: 1,
            }));
        }
    }
    const open = openAt(k);
    const cues: CueSink = { open: async () => {}, stop: () => {}, isOpen: sc => { const o = open.get(keeperOf(sc)); return !!o && sameScope(o, sc); } };
    const record = new AttemptRecord(join(dir, 'handoffs'), ATTEMPT);
    REF.forEach((s, i) => { if (s.kind === 'handoff' && i <= k) record.handOffs.mark(s.id === 'S01' ? 'H1' : s.name.replace(/ hand-off$/, ''), 1000 + i); });
    const relogs = new RelogBudget(join(dir, 'relog'));
    if (k >= at(SCORED_LOGOUT)) relogs.beginPlanned(SCORED_RELOG, 100);
    if (k >= at(SCORED_LOGIN)) relogs.endPlanned(SCORED_RELOG, 'page');
    const chain = buildChain(config(dir), { cues, record, relogs, attempt: ATTEMPT });
    if (chain.length !== REF.length) throw new Error(`the chain at #${k} has ${chain.length} steps, the reference ${REF.length}`);
    const walked = chain.map((s, i): ChainStep => (isQuest(s) && s.done ? { ...s, done: () => i <= k, inProgress: undefined, preconditions: () => true } : s));
    const obs = new Observation(stateAt(k));
    // No probe runs: every declared one reads as unanswered (S25b and S25c are done on their levels).
    for (const s of chain) for (const p of s.probes ?? []) obs.probed[p] = null;
    return { chain, walked, obs };
}

const WORLD = new Map(MILESTONES.map(k => [k, worldAt(k)]));
const later = (i: number) => MILESTONES.filter(k => k > i);

// ------------------------------------------------------------------ the floor list

/**
 * Milestones whose `done` turns false at a later state: step name to the state that breaks it and the
 * predicate's line. Empty at e7a1d807 plus the H13 fix (handoff.ts rollbackWitnesses): H13 read undone
 * from S18 on, since S18 brings back rune arrows and coins it gave and its next milestone, S16's pool,
 * reads only the chamber.
 */
const FLOOR: Readonly<Record<string, string>> = {};

describe('monotonic done: each non-quest milestone holds at the completion of every later one (rs/577)', () => {
    test('the fixtures: each milestone reads done at its own completion', () => {
        expect(MILESTONES.length).toBeGreaterThan(80);
        for (const name of Object.keys(FLOOR)) at(name);
        const own = MILESTONES.filter(k => !WORLD.get(k)!.chain[k]!.done!(WORLD.get(k)!.obs, {})).map(k => REF[k]!.name);
        expect(own).toEqual([]);
    });

    for (const i of MILESTONES) {
        const s = REF[i]!;
        const check = () => {
            const broken = later(i).filter(k => !WORLD.get(k)!.chain[i]!.done!(WORLD.get(k)!.obs, {})).map(k => REF[k]!.name);
            expect(broken).toEqual([]);
        };
        const title = `${s.id}: ${s.name} stays done`;
        if (FLOOR[s.name]) test.todo(`${title} (floor, ${FLOOR[s.name]})`, check);
        else test(title, check);
    }

    test('resolveResume at each later state lands after that state, unless a floor step reads undone first', async () => {
        const rewinds: [string, string, string][] = [];
        for (const k of MILESTONES) {
            const w = WORLD.get(k)!;
            let landing: string;
            let first: number;
            try {
                const p = await resolveResume(w.walked, w.obs, {});
                landing = p.step ?? 'finished';
                first = p.firstUndone;
            } catch (e) {
                if (!(e instanceof ResumeError)) throw e;
                landing = 'refused';
                first = e.firstUndone;
            }
            // Landing past the state is right, a refusal there included (no fixture has H1's partner in view).
            if (first > k) continue;
            if (!FLOOR[REF[first]!.name]) rewinds.push([REF[k]!.name, landing, REF[first]!.name]);
        }
        expect(rewinds).toEqual([]);
    });
});
