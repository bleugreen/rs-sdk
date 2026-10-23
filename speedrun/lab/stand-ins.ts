// Lab stand-ins for the run's steps whose modules are not on main yet (runner/chain.ts missingStep):
// one table of the state each step leaves behind, and one applier that puts a lab account there with
// staff commands (lab/setup.ts: ::setvar, ::setstat, ::give, a drop of what the step takes, ::tele).
// lab/dress-rehearsal.ts swaps each missing step for its stand-in by id; its rows are `STAND-IN`
// rows, which the report counts apart and which mark the run partial (never the 1,881 acceptance).
//
// Lab only, by construction: the applier refuses unless the engine is staff-enabled
// (LOCAL_STAFF_LEVEL >= 4), the world and the gateway are loopback with the gateway in a lab port
// block, and nothing names a demo or run host. Every value cites its source.
//
// Units: xp is base xp, as the quest scripts award it (stat_advance(skill, 10 x base); lib/xp.ts
// baseToXp is game xp). The applier adds it to what the account holds and sets the level it reaches.
//
// When a quest's module lands on main, the change that wires it into chain.ts deletes its row here
// (stand-ins.test.ts: no stand-in may share an id with a real step in the chain).

import type { BotWorldState } from '../../sdk/types';
import { matchesItem, type ItemPattern } from '../lib/items';
import { questDone, type QuestKey } from '../lib/quests';
import { noteRow, type ChainStep } from '../runner/chain';
import { STAND_IN_STEP } from '../runner/run-report';
import { isLoopbackHost } from '../lib/session';
import { waitUntil } from '../lib/wait';
import { opIndex } from '../lib/world';
import { baseToXp, levelForXp } from '../lib/xp';
import type { StepContext } from '../runner/step';
import { cheat, dropMatching, give, mustTele, setstat, setvar } from './setup';

export interface Consumed {
    item: ItemPattern;
    n: number;
    /** The entry's name in the ledger row. */
    ledger: string;
    obj?: string;
    source: string;
}

export interface StandIn {
    /** The chain id it replaces (every step of that id, and the legs inside the group). */
    stepId: string;
    name: string;
    /** Whose module it stands in for. */
    owner: string;
    /** The quest whose completion marks the step done (the last one of the group). */
    quest: QuestKey;
    varps: readonly { name: string; value: number; source: string }[];
    /** Base xp the step awards, added to what the account holds. */
    xp: readonly { skill: string; base: number; source: string }[];
    /** Quest points the step adds (the `qp` varp). */
    qp: { add: number; source: string };
    give: readonly { obj: string; n: number; source: string }[];
    /** What the step consumes or hands in: dropped. */
    take: readonly { item: ItemPattern; source: string }[];
    /**
     * What the step uses up by count (eaten, drunk, cast), the rest kept: the ledger row's counted
     * `consume` entries under their ledger names. `obj` (the ::give name) returns a stack's remainder.
     */
    consume?: readonly Consumed[];
    /** Worn at the step's end (wielded from the pack) and taken off. */
    wear?: readonly { item: ItemPattern; source: string }[];
    unwear?: readonly { item: ItemPattern; source: string }[];
    /** Where the next leg starts. */
    end: { x: number; z: number; level?: number; source: string };
    notes?: string;
}

const QS = 'speedrun/data/quest-stages.ts';
const MAN = 'docs/speedrun/STEP-MANIFEST.md';
const RO = 'docs/speedrun/RUN-ORDER.md';
const LEGS = 'speedrun/runner/legs.ts TILES';

export const STAND_INS: readonly StandIn[] = [
    {
        stepId: 'S15', name: 'Monkey Madness', owner: 'rs/185', quest: 'mm',
        varps: [{ name: 'mm_main', value: 9, source: `${QS} mm: varp 365, complete >= 9 (10, Daero's training, inferred at Z)` }],
        xp: [
            { skill: 'strength', base: 35_000, source: `${RO} S15: measured reward +35,000 Strength` },
            { skill: 'hitpoints', base: 35_000, source: `${RO} S15: +35,000 Hitpoints (HP 42 to 97)` },
            { skill: 'attack', base: 20_000, source: `${RO} S15: +20,000 Attack` },
            { skill: 'defence', base: 20_000, source: `${RO} S15: +20,000 Defence` },
        ],
        qp: { add: 3, source: `${QS} mm` },
        give: [
            { obj: 'mm_amulet_of_monkey_speak', n: 1, source: `${MAN} ledger S15 in` },
            { obj: 'mm_monkey_greegree_for_normal_monkey', n: 1, source: `${MAN} ledger S15 in` },
            { obj: 'coins', n: 10_000, source: `${MAN} ledger S15 Y in: Narnode's reward` },
            { obj: 'diamond', n: 3, source: `${MAN} ledger S15 Y in: Narnode's reward` },
        ],
        take: [
            { item: /^gold bar$/i, source: `${MAN} ledger S15 out (hand-in)` },
            { item: /^ball of wool$/i, source: `${MAN} ledger S15 out` },
            { item: 3183, source: `${MAN} ledger S15 out: monkey bones @3183` },
            { item: /^banana$/i, source: `${MAN} ledger S15 out (hand-in)` },
        ],
        consume: [
            { item: /^superantipoison\(1\)$/i, n: 1, ledger: 'superantipoison(1)', source: `${MAN} ledger S15 out: drunk at A's start, the vial dropped` },
            { item: /^shark$/i, n: 14, ledger: 'shark', source: `${MAN} ledger S15 out: eaten (1 held at the exit)` },
            { item: /^prayer potion\(4\)$/i, n: 2, ledger: 'prayer potion(4)', source: `${MAN} ledger S15 out: drunk, the vials dropped` },
            { item: /^law rune$/i, n: 3, ledger: 'law rune', obj: 'lawrune', source: `${MAN} ledger S15 out: Ardougne at T, Varrock at Y` },
            { item: /^water rune$/i, n: 2, ledger: 'water rune', obj: 'waterrune', source: `${MAN} ledger S15 out` },
            { item: /^air rune$/i, n: 3, ledger: 'air rune', obj: 'airrune', source: `${MAN} ledger S15 out` },
            { item: /^fire rune$/i, n: 1, ledger: 'fire rune', obj: 'firerune', source: `${MAN} ledger S15 out` },
        ],
        wear: [
            { item: /^m'speak amulet$/i, source: `${MAN} ledger S15 equip +m'speak amulet` },
            { item: /^monkey greegree$/i, source: `${MAN} ledger S15 equip +monkey greegree` },
        ],
        unwear: [{ item: /^magic shortbow$/i, source: `${MAN} ledger S15 equip -magic shortbow` }],
        end: { x: 2484, z: 3486, level: 1, source: `${LEGS}.daero (T15-16's start)` },
    },
];

export function standInFor(stepId: string): StandIn | undefined {
    return STAND_INS.find(s => s.stepId === stepId);
}

// ------------------------------------------------------------------ the guard

/** The lab's gateway port block (lab/lab.sh: AGENT_PORT 8300 in the speedrun block; parallel blocks sit above it). */
export const LAB_GATEWAY_PORTS: readonly [number, number] = [8300, 8399];
/** Demo and run hosts: a stand-in never touches them (rs-sdk-demo; RUN-HOST.md's run host and twin). */
export const NOT_LAB_HOSTS: readonly RegExp[] = [/rs-sdk-demo\.fly\.dev/i, /rs-ashburn/i, /fly\.dev/i];

export interface LabWorld {
    /** The engine's staff level, as the lab started it (LOCAL_STAFF_LEVEL). */
    staffLevel: string | undefined;
    /** The world the account plays on (bot.env SERVER). */
    server: string;
    /** The SDK's gateway URL. */
    gateway: string;
}

/** Why a stand-in may not run here, or null on a lab. */
export function labRefusal(w: LabWorld): string | null {
    if (!(Number(w.staffLevel) >= 4)) return `stand-ins need a staff-enabled lab engine (LOCAL_STAFF_LEVEL >= 4, got ${w.staffLevel ?? 'unset'})`;
    const named = NOT_LAB_HOSTS.find(r => r.test(w.server) || r.test(w.gateway));
    if (named) return `stand-ins never run against a demo or run host (${w.server}, ${w.gateway})`;
    const host = w.server.replace(/^\w+:\/\//, '').split(/[:/]/)[0] ?? '';
    if (!isLoopbackHost(host)) return `stand-ins run on a local lab world only (SERVER ${w.server})`;
    let url: URL;
    try {
        url = new URL(w.gateway);
    } catch {
        return `the gateway ${w.gateway} is not a URL`;
    }
    if (!isLoopbackHost(url.hostname)) return `the gateway ${w.gateway} is not loopback`;
    const port = Number(url.port);
    if (!(port >= LAB_GATEWAY_PORTS[0] && port <= LAB_GATEWAY_PORTS[1])) return `the gateway port ${url.port || '(none)'} is outside the lab block ${LAB_GATEWAY_PORTS.join('-')}`;
    return null;
}

// ------------------------------------------------------------------ the applier

export type StandInSdk = Parameters<typeof setvar>[0] & Parameters<typeof dropMatching>[0] & { sendUseItem(slot: number, op: number): Promise<unknown>; sendUseEquipmentItem(slot: number, op: number): Promise<unknown> };

const xpOf = (s: BotWorldState, skill: string) => s.skills.find(k => k.name.toLowerCase() === skill)?.experience ?? 0;

/** The levels the stand-in's xp brings each skill to, from the account's current xp. */
export function standInLevels(s: BotWorldState, si: StandIn): Record<string, number> {
    return Object.fromEntries(si.xp.map(x => [x.skill, levelForXp(xpOf(s, x.skill) + baseToXp(x.base))]));
}

/** Put the account where `si`'s step leaves it. Refuses off a lab (labRefusal). */
export async function applyStandIn(ctx: Pick<StepContext<unknown>, 'sdk'>, si: StandIn, world: LabWorld): Promise<Record<string, unknown>> {
    const why = labRefusal(world);
    if (why) throw new Error(`STAND-IN ${si.stepId}: ${why}`);
    const sdk = ctx.sdk as unknown as StandInSdk;
    const s0 = sdk.getState()!;
    const levels = standInLevels(s0, si);
    for (const v of si.varps) await setvar(sdk, v.name, v.value);
    await setvar(sdk, 'qp', (s0.questPoints ?? 0) + si.qp.add);
    for (const [skill, level] of Object.entries(levels)) await setstat(sdk, skill, level);
    if (si.take.length) await dropMatching(sdk, si.take.map(t => t.item));
    const consumed: string[] = [];
    for (const c of si.consume ?? []) consumed.push(await consumeCount(sdk, c));
    for (const g of si.give) await give(sdk, g.obj, g.n);
    for (const w of si.wear ?? []) {
        const it = sdk.getState()!.inventory.find(i => matchesItem(i, w.item));
        if (it) void sdk.sendUseItem(it.slot, opIndex(it, /^(wield|wear)$/i) ?? 2);
    }
    for (const w of si.unwear ?? []) {
        const it = sdk.getState()!.equipment.find(i => matchesItem(i, w.item));
        if (it) void sdk.sendUseEquipmentItem(it.slot, opIndex(it, /^remove$/i) ?? 1);
    }
    if (si.wear?.length || si.unwear?.length) {
        await waitUntil(sdk, st => (si.wear ?? []).every(w => st.equipment.some(e => matchesItem(e, w.item))), { maxTicks: 10 });
    }
    await mustTele(sdk, si.end.x, si.end.z, si.end.level ?? 0);
    return { stepId: si.stepId, levels, qp: si.qp.add, varps: si.varps.map(v => `${v.name}=${v.value}`), gave: si.give.map(g => `${g.obj} x${g.n}`), consumed, end: si.end };
}

/**
 * Remove `c.n` of what matches `c.item`: unstacked copies dropped one each, a stack dropped whole and
 * its remainder given back. Never more than is held; a shortfall is reported, not thrown.
 */
async function consumeCount(sdk: StandInSdk, c: Consumed): Promise<string> {
    const held = sdk.getState()!.inventory.filter(i => matchesItem(i, c.item));
    const total = held.reduce((a, i) => a + i.count, 0);
    const n = Math.min(c.n, total);
    const stack = held.length === 1 && held[0]!.count > 1;
    if (stack && n < total && !c.obj) throw new Error(`STAND-IN consume ${c.ledger}: a stack, and no ::give name to return ${total - n}`);
    const drop = stack ? held : held.slice(0, n);
    await Promise.all(drop.map(i => sdk.sendDropItem(i.slot)));
    if (drop.length) await waitUntil(sdk, s => !drop.some(d => s.inventory.some(i => i.slot === d.slot && i.id === d.id)), { maxTicks: 10 });
    if (stack && n < total) await give(sdk, c.obj!, total - n);
    return `${c.ledger} ${n}${n < c.n ? ` of ${c.n} (held ${total})` : ''}`;
}

/** The chain step a dress rehearsal runs in place of `si`'s missing step group: a `STAND-IN <id>` row. */
export function standInStep(si: StandIn, world: () => LabWorld): ChainStep {
    const name = `${STAND_IN_STEP} ${si.stepId} ${si.name}`;
    const run = async (ctx: StepContext<unknown>) => {
        const applied = await applyStandIn(ctx, si, world());
        noteRow(ctx, `${STAND_IN_STEP} ${si.stepId}`, { ...applied, owner: si.owner });
    };
    return {
        id: si.stepId, kind: 'step', name, logoutSafe: true, owner: undefined,
        preconditions: s => (s.inGame ? true : 'not in game'), postconditions: () => true,
        run, resume: run, done: questDone(si.quest),
    };
}

export { cheat };
