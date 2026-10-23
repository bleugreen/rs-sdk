// The state the scored run holds where a lab chunk starts (lab/dress-rehearsal.ts --from=Sxx), and the
// staff-command staging that puts a fresh lab account there, so the route's chunks run in parallel
// on separate labs. Every value is read from a doc or a module, none is written here:
// - levels: RUN-ORDER.md section 2's Levels column, walked in run order, each row leaving a skill
//   at the end of its range. An end given as `~N`, `N+`, `a/b` or a range is staged at its figure
//   (a range's middle) and flagged `approx`. Hitpoints, which the column never states before S27,
//   come from DOC_LEVELS (cited phrases a test finds in RUN-ORDER); S15's reward is its xp.
// - pack and worn: the inventory ledger walked (tools/slot-ledger.ts walk) through the last row
//   owned by a step before the chunk. A placeholder resolves only through the module its row names.
// - quests: each route quest whose step comes before the chunk, at the stage its module leaves.
// - tile: the start of the chunk's first leg (runner/legs.ts def.start).
// What none of those give is listed in `unresolved`, never guessed.

import { QUESTS, type QuestKey } from '../data/quest-stages';
import { wield } from '../lib/act';
import { debugNameFor } from '../lib/ledger-objs';
import { isComplete, questPoints, questStatus } from '../lib/quests';
import { objPack } from '../lib/obj-pack';
import { waitUntil } from '../lib/wait';
import { baseToXp, levelForXp, xpForLevel } from '../lib/xp';
import * as cooksAssistant from '../quests/cooks-assistant';
import * as doricsQuest from '../quests/dorics-quest';
import * as dragonSlayer from '../quests/dragon-slayer';
import * as druidicRitual from '../quests/druidic-ritual';
import * as dwarfCannon from '../quests/dwarf-cannon';
import * as fightArena from '../quests/fight-arena';
import * as fishingContest from '../quests/fishing-contest';
import * as goblinDiplomacy from '../quests/goblin-diplomacy';
import * as grandTree from '../quests/grand-tree';
import * as mageArena from '../quests/mage-arena';
import * as plagueCity from '../quests/plague-city';
import * as romeoJuliet from '../quests/romeo-juliet';
import * as seaSlug from '../quests/sea-slug';
import * as treeGnomeVillage from '../quests/tree-gnome-village';
import { INTERNAL, isCueStop, noteRow, type ChainStep } from '../runner/chain';
import { STAND_IN_STEP } from '../runner/run-report';
import type { StepContext } from '../runner/step';
import { relog, type Session } from '../lib/session';
import type { LegStep } from '../runner/legs';
import { ENCHANTS, ROUTE_LOADS, TIER_ORDER } from '../skills/magic';
import { cells, parseLedger, walk, type Held, type LedgerEntry, type LedgerRow } from '../tools/slot-ledger';
import { bands, craftXp, LOAD, type AltarName, type Band } from '../skills/runecraft';
import type { BotWorldState } from '../../sdk/types';
import { cheat, give, mustTele, setStats, setvar } from './setup';
import { labRefusal, STAND_INS, type LabWorld } from './stand-ins';

const RO = 'RUN-ORDER.md section 2';

export const SKILLS = ['attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic', 'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting', 'smithing', 'mining', 'herblore', 'agility', 'thieving', 'runecraft'] as const;
export type Skill = (typeof SKILLS)[number];
const SKILL_WORDS: Readonly<Record<string, Skill>> = { hp: 'hitpoints', ...Object.fromEntries(SKILLS.map(s => [s, s])) };
const SKILL_RE = new RegExp(`\\b(${[...SKILLS, 'HP'].join('|')})\\s+`, 'gi');

export interface LevelValue {
    level: number;
    /** The doc gives the end as `~N`, `N+`, `a/b` or a range: staged at that figure. */
    approx: boolean;
    source: string;
}

/** A level the Levels column does not state: `skill` stands at `level` once `by` is done, as `row`'s text says. */
export interface DocLevel {
    by: string;
    skill: Skill;
    level: number;
    row: string;
    phrase: string;
}

export const DOC_LEVELS: readonly DocLevel[] = [
    { by: 'S09', skill: 'hitpoints', level: 10, row: 'S10b', phrase: 'Attack, Strength and Defence 1, 10 HP, Magic 59' },
    { by: 'S14', skill: 'hitpoints', level: 42, row: 'S15', phrase: 'HP 42 to 97' },
];

/**
 * Levels no doc states that a chunk measured, staged approx with the log cited. Each one is a doc gap
 * sent to rs/158; it goes once RUN-ORDER states the value (then DOC_LEVELS carries it).
 * - Hitpoints after S12: Fight Arena's kills take 10 HP to 31 (reach rows; RUN-ORDER states 10 at
 *   S10b and 42 at S15 only). Staged at 10, S14 died at the spiders (rs393t131339).
 */
export const MEASURED_LEVELS: readonly { by: string; skill: Skill; level: number; source: string }[] = [
    { by: 'S12', skill: 'hitpoints', level: 31, source: 'lab chunk S12-S14 rs393t123236 (ce357982, 300 ms ticks): the last hitpoints reach row in S12, tick 556' },
];

/** The stage a quest's module leaves it at, where that is past its completion value. */
export const STAGED: Readonly<Partial<Record<QuestKey, { stage: string; source: string }>>> = {
    elena: { stage: 'complete_read_scroll', source: `${RO} S08: "Ardougne scroll read at the end"` },
    magearena: { stage: 'staff_given', source: 'quests/mage-arena.ts: the step ends holding the god staff or cape' },
};

/** The route quests' steps, from the modules (and the lab stand-ins for the steps not on main). */
export const QUEST_STEPS: readonly { quest: QuestKey; stepId: string }[] = [
    ...[doricsQuest, plagueCity, treeGnomeVillage, grandTree, fightArena, dwarfCannon, mageArena, seaSlug, fishingContest, cooksAssistant, goblinDiplomacy, druidicRitual, romeoJuliet, dragonSlayer].map(m => ({ quest: m.quest as QuestKey, stepId: m.stepId })),
    ...STAND_INS.map(s => ({ quest: s.quest, stepId: s.stepId })),
];

// ------------------------------------------------------------------ RUN-ORDER levels

/** RUN-ORDER.md section 2's rows in order: the ID cell and the Levels cell. */
export function stepRows(runOrder: string): { id: string; levels: string }[] {
    const start = runOrder.indexOf('## 2. Step table');
    const end = runOrder.indexOf('\n## 3.', start);
    if (start < 0 || end < 0) throw new Error('RUN-ORDER.md: no section 2 step table');
    return runOrder
        .slice(start, end)
        .split('\n')
        .filter(l => /^\| *[STL]\d/.test(l))
        .map(l => {
            const c = cells(l);
            return { id: c[0]!, levels: c[4] ?? '' };
        });
}

const VALUE = /^(?:to\s+)?~?\d+\+?(?:\/\d+)?(?:\s*(?:-|to)\s*~?\d+\+?(?:\/\d+)?)*/;

/** Where a Levels value leaves the skill: the end of its range. */
export function endOf(value: string): { level: number; approx: boolean } {
    const parts = value.split(/\s+to\s+/);
    const last = parts.at(-1)!.replace(/^to\s+/, '');
    if (parts.length > 1 && last.includes('-')) {
        const [a, b] = last.replace(/~/g, '').split('-').map(Number) as [number, number];
        return { level: Math.round((a + b) / 2), approx: true };
    }
    const end = last.split('-').at(-1)!;
    return { level: Number(/\d+/.exec(end)![0]), approx: /[~+/]/.test(end) };
}

/** One row's levels (the first mention of each skill, before any `;`), and a reward given as xp. */
export function rowLevels(id: string, text: string): { levels: Partial<Record<Skill, LevelValue>>; rewards: { skill: Skill; base: number; source: string }[] } {
    let t = text.replace(/\*\*|`/g, '');
    const rewards: { skill: Skill; base: number; source: string }[] = [];
    const rw = /^(.+?) from the reward \(Q§3: ([^)]*?) xp/.exec(t);
    if (rw) {
        const names = rw[1]!.split(/,\s*|\s+and\s+/).map(n => SKILL_WORDS[n.trim().toLowerCase()]);
        const nums = (rw[2]!.match(/\d[\d,]*/g) ?? []).map(n => Number(n.replace(/,/g, '')));
        if (names.length === nums.length && names.every(Boolean)) names.forEach((s, i) => rewards.push({ skill: s!, base: nums[i]!, source: `${RO} ${id}: "${rw[0]}"` }));
    }
    for (let prev = ''; prev !== t; ) {
        prev = t;
        t = t.replace(/\([^()]*\)/g, '');
    }
    t = t.split(';')[0]!;
    const levels: Partial<Record<Skill, LevelValue>> = {};
    for (const m of t.matchAll(SKILL_RE)) {
        const skill = SKILL_WORDS[m[1]!.toLowerCase()]!;
        if (levels[skill]) continue;
        const v = VALUE.exec(t.slice(m.index! + m[0].length));
        if (!v) continue;
        levels[skill] = { ...endOf(v[0]), source: `${RO} ${id}: "${m[1]} ${v[0]}"` };
    }
    return { levels, rewards };
}

// ------------------------------------------------------------------ the chunk

/** A chain id as the docs name it: a split leg's halves are the leg. */
const docId = (id: string) => id.replace(/^(T\d\d-\d\d)[ab]$/, '$1');

/** The step a ledger row belongs to: a module-internal row its module's step, any other its own id. */
const ledgerOwner = (row: string) => {
    const token = row.split(' ')[0]!;
    return INTERNAL[token] ? INTERNAL[token]!.split(' ')[0]! : token;
};

/**
 * Where chunk `chunk` (S10: S10a, S10b, ...) starts: its first step, after the legs, hand-offs and cue
 * steps leading into it. A cue stop ahead of the leg ends the previous step's band, so it stays with that
 * chunk; one on the leg itself (T14-15's S14 stop) is the leg's.
 */
export function chunkStart(chain: readonly ChainStep[], chunk: string): number {
    const re = new RegExp(`^${chunk}[a-z]?$`);
    const first = chain.findIndex(s => re.test(s.id));
    if (first < 0) throw new Error(`--from=${chunk}: no step of that id on the chain`);
    let i = first;
    while (i > 0 && ['leg', 'handoff', 'cue'].includes(chain[i - 1]!.kind)) i--;
    while (i < first && isCueStop(chain[i]!)) i++;
    return i;
}

export interface StagedItem {
    name: string;
    obj: string;
    n: number;
    source: string;
}

export interface Boundary {
    /** The chain index the chunk starts at, and its id there. */
    start: number;
    firstId: string;
    levels: Record<Skill, LevelValue>;
    quests: { key: QuestKey; varp: string; value: number; stage: string; source: string }[];
    qp: number;
    /** The ledger row the pack is walked through (null: none, a fresh account's empty pack). */
    ledgerAfter: string | null;
    inv: StagedItem[];
    worn: StagedItem[];
    tile: { x: number; z: number; level?: number } | null;
    unresolved: string[];
}

/** A placeholder's items, from the module its ledger row names (or why not). */
const PLACEHOLDERS: Readonly<Record<string, (n: number) => StagedItem[] | string>> = {
    'enchanted ring': n => {
        const load = ROUTE_LOADS.at(-1)!;
        const items = TIER_ORDER.filter(t => (load[t] ?? 0) > 0).map(t => ({ name: ENCHANTS[t].product.toLowerCase(), n: load[t]!, obj: debugNameFor(ENCHANTS[t].product.toLowerCase(), undefined) ?? '' }));
        const total = items.reduce((a, i) => a + i.n, 0);
        if (total !== n || items.some(i => !i.obj)) return `<enchanted ring> x${n}: magic.ts ROUTE_LOADS' last load holds ${total}`;
        return items.map(i => ({ ...i, source: "magic.ts ROUTE_LOADS' last load, enchanted (the ledger's S04 row: kept for H4)" }));
    },
};

/** runecraft.dbrow's `multiplier` per altar: a craft at level L makes floor(L / m) + 1 runes per essence (runecraft.rs2). */
export const RUNE_MULTIPLE: Readonly<Partial<Record<AltarName, number>>> = { air: 11 };

/** The runes `band` crafts from its `from` level to its target, one load per craft, as runecraft.rs2 counts them. */
export function craftedRunes(band: Band): number {
    const m = RUNE_MULTIPLE[band.altar];
    if (!m) throw new Error(`${band.id}: no rune multiple for the ${band.altar} altar`);
    const load = band.load ?? LOAD;
    let xp = xpForLevel(band.from);
    let runes = 0;
    for (let level = levelForXp(xp); level < band.untilLevel; level = levelForXp(xp)) {
        runes += load * (Math.floor(level / m) + 1);
        xp += craftXp(band.altar, load);
    }
    return runes;
}

/**
 * Rows whose `x?` stack the module's own numbers fix: the count the row adds to the stack held
 * before it. Applied only when no later row before the chunk touches the stack.
 */
export const CRAFTED: Readonly<Record<string, Readonly<Record<string, { n: () => number; source: string }>>>> = {
    S06: { 'air rune': { n: () => craftedRunes(bands({ untilLevel: 44 })[0]!), source: "runecraft.ts's S06 band (26-essence loads, level 1 to 44) at runecraft.dbrow's air multiple 11" } },
};

/** `h`'s count after `rows` when a CRAFTED row fixes it, else `h` unchanged. */
function crafted(h: Held, rows: readonly LedgerRow[], entries: readonly LedgerEntry[]): { h: Held; source?: string } {
    if (h.count !== null) return { h };
    const at = rows.map(r => r.row).findLastIndex(r => CRAFTED[r]?.[h.name]);
    if (at < 0) return { h };
    const touches = (r: LedgerRow) => [...r.in, ...r.out].some(e => e.name === h.name);
    if (rows.slice(at + 1).some(touches)) return { h };
    const prev = at > 0 ? entries[at - 1]!.stacks.inv.filter(x => x.name === h.name) : [];
    if (prev.some(x => x.count === null)) return { h };
    const c = CRAFTED[rows[at]!.row]![h.name]!;
    const before = prev.reduce((a, x) => a + x.count!, 0);
    return { h: { ...h, count: before + c.n() }, source: `${before} held before ${rows[at]!.row}, plus ${c.source}` };
}

function stage(h: Held, after: string, unresolved: string[], source?: string): StagedItem[] {
    const label = `${h.placeholder ? `<${h.name}>` : h.name}${h.id !== undefined ? ` @${h.id}` : ''}`;
    if (h.count === null) {
        unresolved.push(`${label}: the ledger carries it at an unknown count (after ${after})`);
        return [];
    }
    if (h.placeholder) {
        const r = PLACEHOLDERS[h.name]?.(h.count) ?? `<${h.name}> x${h.count}: a placeholder no module resolves here`;
        if (typeof r === 'string') {
            unresolved.push(r);
            return [];
        }
        return r;
    }
    let obj = debugNameFor(h.family ? `${h.name}(4)` : h.name, h.id);
    if (obj && h.kind === 'n') obj = objPack().ids.has(`cert_${obj}`) ? `cert_${obj}` : null;
    if (!obj) {
        unresolved.push(`${label}${h.kind === 'n' ? ' (noted)' : ''}: no ::give name`);
        return [];
    }
    return [{ name: h.name, obj, n: h.count, source: source ?? `ledger, after ${after}${h.family ? ' (any dose: staged as 4-dose)' : ''}` }];
}

/** The state the run holds at `chain[start]`, from RUN-ORDER and the ledger. */
export function boundaryAt(chain: readonly ChainStep[], start: number, docs: { runOrder: string; manifest: string }): Boundary {
    const before = new Set(chain.slice(0, start).map(s => docId(s.id)));
    const inChunk = new Set(chain.slice(start).map(s => docId(s.id)).filter(id => !before.has(id)));
    const unresolved: string[] = [];

    const levels = Object.fromEntries(SKILLS.map(s => [s, { level: s === 'hitpoints' ? 10 : 1, approx: false, source: 'a new account' }])) as Record<Skill, LevelValue>;
    for (const r of stepRows(docs.runOrder)) {
        if (inChunk.has(docId(r.id))) break;
        const { levels: set, rewards } = rowLevels(r.id, r.levels);
        for (const rw of rewards) {
            const level = levelForXp(xpForLevel(levels[rw.skill].level) + baseToXp(rw.base));
            levels[rw.skill] = { level, approx: levels[rw.skill].approx, source: `${rw.source}: +${rw.base} base from ${levels[rw.skill].level}` };
        }
        for (const [s, v] of Object.entries(set) as [Skill, LevelValue][]) levels[s] = v;
        for (const d of MEASURED_LEVELS.filter(d => d.by === r.id)) levels[d.skill] = { level: d.level, approx: true, source: d.source };
        for (const d of DOC_LEVELS.filter(d => d.by === r.id)) levels[d.skill] = { level: d.level, approx: false, source: `${RO} ${d.row}: "${d.phrase}"` };
    }

    const quests = QUEST_STEPS.filter(q => before.has(q.stepId)).map(q => {
        const t = QUESTS[q.quest];
        const si = STAND_INS.find(s => s.quest === q.quest && s.stepId === q.stepId);
        const named = si?.varps.find(v => v.name === t.varp.name);
        const staged = STAGED[q.quest];
        const st = named ? { name: 'stand-in', value: named.value } : staged ? t.stages.find(x => x.name === staged.stage)! : { name: 'complete', value: t.complete.value };
        return { key: q.quest, varp: t.varp.name, value: st.value, stage: st.name, source: named?.source ?? staged?.source ?? t.complete.source };
    });
    const qp = quests.reduce((a, q) => a + QUESTS[q.key].questPoints, 0);

    const rows = parseLedger(docs.manifest).rows;
    const stop = rows.findIndex(r => inChunk.has(ledgerOwner(r.row)));
    const upTo = stop < 0 ? rows.length : stop;
    let ledgerAfter: string | null = null;
    const inv: StagedItem[] = [];
    const worn: StagedItem[] = [];
    if (upTo > 0) {
        const walked = rows.slice(0, upTo);
        const entries = walk(walked);
        const e = entries.at(-1)!;
        ledgerAfter = e.row.row;
        if (e.verdict !== 'pass') unresolved.push(`ledger after ${e.row.row}: ${e.verdict} (${e.notes.join('; ')})`);
        for (const h0 of e.stacks.inv) {
            const { h, source } = crafted(h0, walked, entries);
            inv.push(...stage(h, e.row.row, unresolved, source));
        }
        for (const h of e.stacks.worn) worn.push(...stage(h, e.row.row, unresolved));
    }

    const first = chain[start]!;
    let tile: Boundary['tile'] = null;
    if (first.kind === 'leg') {
        const a = (first as unknown as LegStep).def.start;
        tile = { x: a.x, z: a.z, ...(a.level ? { level: a.level } : {}) };
    } else if (start > 0) unresolved.push(`${first.id}: the chunk does not start on a leg, so no start tile`);

    return { start, firstId: first.id, levels, quests, qp, ledgerAfter, inv, worn, tile, unresolved };
}

// ------------------------------------------------------------------ staff jumps

/**
 * A lab chain with each step in `ids` (every chain step of that id, a contiguous block) replaced by
 * one labelled staff jump: at run time it stages the account to the boundary just past the block
 * (boundaryAt on the chain as given: RUN-ORDER's levels, the ledger's pack and worn set, the quests,
 * the next leg's start tile) through applyBoundary, so a chunk with a helper-fed step no lab launch
 * serves yet still measures the rest. The jump's name starts with STAND-IN, so the run report marks
 * the run partial. A staged state that comes out different fails the jump with the list.
 */
export function staffJumps(
    chain: readonly ChainStep[],
    ids: readonly string[],
    docs: { runOrder: string; manifest: string },
    world: () => LabWorld,
): { chain: ChainStep[]; jumped: string[] } {
    const unknown = ids.filter(id => !chain.some(s => s.id === id));
    if (unknown.length) throw new Error(`--staff-steps: ${unknown.join(', ')} not in the slice`);
    const out: ChainStep[] = [];
    const jumped: string[] = [];
    for (let i = 0; i < chain.length; i++) {
        const s = chain[i]!;
        if (!ids.includes(s.id)) {
            out.push(s);
            continue;
        }
        let end = i;
        while (end + 1 < chain.length && chain[end + 1]!.id === s.id) end++;
        if (chain.slice(end + 1).some(x => x.id === s.id)) throw new Error(`--staff-steps ${s.id}: its steps are not one contiguous block`);
        // The block's own band-ending cue stop stays on the chain (it stops nothing once the block is
        // jumped) but takes no ticks, so the jump stages to, and is named for, the step past it.
        let after = end + 1;
        while (after < chain.length && isCueStop(chain[after]!, s.id)) after++;
        const nextId = chain[after]?.id ?? '(the end)';
        const run = async (ctx: StepContext<unknown>) => {
            const b = boundaryAt(chain, after, docs);
            const off = await applyBoundary(ctx.sdk as never, b, world(), async () => {
                await relog(ctx.session as unknown as Session);
            });
            noteRow(ctx, `${STAND_IN_STEP} ${s.id} (staff jump)`, { to: nextId, levels: b.levels, quests: b.quests, inv: b.inv, worn: b.worn, tile: b.tile, unresolved: b.unresolved, off });
            if (off.length) throw new Error(`staff jump past ${s.id} came out different: ${off.join('; ')}`);
        };
        out.push({ id: s.id, kind: 'step', name: `${STAND_IN_STEP} ${s.id} (staff jump to ${nextId})`, logoutSafe: true, preconditions: () => true, postconditions: () => true, run, resume: run });
        jumped.push(s.id);
        i = end;
    }
    return { chain: out, jumped };
}

// ------------------------------------------------------------------ staging

type LabSdk = Parameters<typeof cheat>[0];

const exact = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

/**
 * Where the account's observed state differs from `b`: levels, pack and worn counts, and each staged
 * quest as the steps read it (lib/quests questStatus, the quest tab; questPoints), not the varp. An
 * empty list: staged exactly.
 */
export function stagedOff(s: BotWorldState, b: Boundary): string[] {
    const off: string[] = [];
    for (const sk of SKILLS) {
        const got = s.skills.find(k => k.name.toLowerCase() === sk)?.baseLevel;
        if (got !== b.levels[sk].level) off.push(`${sk} ${got} (staged ${b.levels[sk].level})`);
    }
    for (const q of b.quests) {
        const want = isComplete(q.key, q.value) ? 'complete' : 'started';
        const got = questStatus(s, q.key);
        // null: a quest off the quest tab (Mage Arena), whose evidence is its items.
        if (got !== null && got !== want) off.push(`quest ${q.key}: ${got} on the quest tab (staged ${q.varp}=${q.value}, ${want})`);
    }
    const qp = questPoints(s);
    if (qp !== b.qp) off.push(`quest points ${qp} (staged ${b.qp})`);
    const count = (list: readonly { name: string; count: number }[], name: string) => list.filter(i => i.name.toLowerCase() === name.toLowerCase()).reduce((a, i) => a + i.count, 0);
    for (const i of b.inv) if (count(s.inventory, i.name) !== i.n) off.push(`pack ${i.name} x${count(s.inventory, i.name)} (staged ${i.n})`);
    for (const w of b.worn) if (count(s.equipment, w.name) !== w.n) off.push(`worn ${w.name} x${count(s.equipment, w.name)} (staged ${w.n})`);
    return off;
}

/**
 * Put a lab account at `b` with staff commands: pack and worn cleared, every level set, the quest
 * varps set, then `relog` (the quest tab is drawn by the login script's update_questlist,
 * login_logout/login.rs2, so a varp set in game shows only after a login), the worn items given and
 * wielded, the pack given, and the tile. Refuses off a lab. Returns stagedOff once done.
 */
export async function applyBoundary(sdk: LabSdk, b: Boundary, world: LabWorld, relog: () => Promise<void>): Promise<string[]> {
    const why = labRefusal(world);
    if (why) throw new Error(`stage ${b.firstId}: ${why}`);
    await cheat(sdk, '~clearinv inv');
    await cheat(sdk, '~clearinv worn');
    await waitUntil(sdk, s => s.inventory.length === 0 && s.equipment.length === 0, { maxTicks: 10 });
    await setStats(sdk, Object.fromEntries(SKILLS.map(s => [s, b.levels[s].level])));
    for (const q of b.quests) await setvar(sdk, q.varp, q.value);
    await setvar(sdk, 'qp', b.qp);
    if (b.quests.length) await relog();
    for (const w of b.worn) {
        await give(sdk, w.obj, w.n);
        await wield(sdk as never, exact(w.name));
    }
    for (const i of b.inv) await give(sdk, i.obj, i.n);
    if (b.tile) await mustTele(sdk, b.tile.x, b.tile.z, b.tile.level ?? 0);
    // The quest tab and the levels land a tick or two after the commands.
    const r = await waitUntil(sdk, st => stagedOff(st as BotWorldState, b).length === 0, { maxTicks: 10 });
    return stagedOff((r.state ?? sdk.getState()) as BotWorldState, b);
}
