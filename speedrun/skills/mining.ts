// Mining step module (STEP-MANIFEST.md entry 4, S09; docs/speedrun/skills/mining.md): iron on
// the six-rock cluster south of the Ardougne zoo with the in-page `knife-mine` program under the
// host gate (lib/gated-program.ts), plus the bands a fresh account needs first. Works from any
// level: each band reads the level from state and is a no-op once passed, so the scored run
// (Mining 64 after Plague City and Doric's Quest, already in Ardougne) runs only the zoo walk
// and the last band.
//
//   mining.prep            drop starter junk (tutorial.rs2's list only) to free slots
//   mining.copper          1-15: copper at Rimmington, two rocks from one tile, SDK loop
//   mining.travel: ...     Port Sarim, the ship to Karamja, Brimhaven, the customs ship to
//                          Ardougne, the zoo; each leg a no-op once past (`travel: 'none'`
//                          keeps only the zoo walk)
//   mining.kit: H4p        with `kitGiver`: the rune pickaxe and 2 normal logs by trade at the
//                          zoo (STEP-MANIFEST.md's ledger, H4p); rehearsals bring their kit
//   mining.iron-15         15-63: iron, knife-mine with `success: 'iron'` (failed rolls) and
//                          the held pickaxes' rates
//   mining.iron-63         63-to: iron, knife-mine as measured (every roll succeeds)
//   mining.exit            with `dropAtExit`: drops the pickaxes, the logs and the band's
//                          leftovers at their last use, without waiting (the leg after keeps
//                          its queue); the knife stays
//
// Slots: each iron band refuses to start without FREE_SLOTS free (ores count as free: the band
// drops them first), and the kit trade without FREE_SLOTS plus the slots H4p adds.
//
// Respawn. Iron respawns in floor(20 x (4000 - min(players, 2000)) / 4000) ticks
// (player_count.rs2). `respawn: 'auto'` reads /playercount at each band start and every 100
// ticks and schedules for 150 fewer players (a respawn scheduled too long costs a little
// efficiency, one too short clicks empty rocks); a watcher on the rotation's rock tiles logs
// every observed respawn, and one longer than the schedule restarts the band on it. On the
// lab, whose player count is pinned in content, pass the number.
//
// Rotation. A knife transition rolls the next rock 3 ticks after the last roll provided its
// click lands no earlier than the rock's respawn, so a lap of n rocks holds 3 ticks per ore
// while 3n >= D (`lapModel`, the program's own planning rule); the lap with the lowest ticks
// per ore at D is chosen (`rotationFor`).

import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { demoOrigin, samplePlayerCount } from '../lib/demo-status';
import { type GatedSegment, inPageGate, runGatedProgram } from '../lib/gated-program';
import type { HostGate } from '../lib/hostgate';
import { withLevelUpDismissal } from '../lib/levelup';
import { ProgramError } from '../lib/programs';
import { loadBotEnv } from '../lib/session';
import type { TickRow } from '../lib/ticks';
import { receiveFrom, type WantSpec } from '../lib/trade';
import { currentTick, nextTick, tickMs, waitUntil } from '../lib/wait';
import type { Step, StepContext } from '../runner/step';

export const skill = 'mining';

/** The in-page loop the iron bands drive and the kit trade; a test replaces them (the page is not there). */
export const deps = { runGatedProgram, inPageGate, receiveFrom };

export type Technique = 'auto' | 'knife' | 'plain';

export interface MiningOpts {
    to?: number | string;
    technique?: Technique;
    /** Iron respawn in ticks, or 'auto' (from /playercount; default). */
    respawn?: number | string;
    /** A name in ROTATIONS, instead of the choice by respawn. */
    rotation?: string;
    /** A name in COPPER_SITES (default rimmington). */
    copperSite?: string;
    /** 'auto' (default) takes the ship route from the mainland; 'none' only walks to the zoo. */
    travel?: 'auto' | 'none';
    /** The world's HTTP origin for /playercount (default: the bot's bot.env SERVER). */
    origin?: string;
    /** rs/111's S07 fallback (bones on the stay2 lap): a seam, not built. */
    bury?: unknown;
    /** The trade giver at the zoo that hands over H4p (H4P_KIT) before the iron bands; none by default. */
    kitGiver?: string;
    /** Drop EXIT_DROPS at `to` (default false: a rehearsal keeps its kit). */
    dropAtExit?: boolean | string;
    [k: string]: unknown;
}

// ------------------------------------------------------------------ data

type P = [number, number];

/** player_count.rs2 scale_by_playercount: iron's base is 20, copper and tin 10 (mine.dbrow). */
export function respawnFor(players: number, base = 20): number {
    const pc = Math.min(Math.max(Math.floor(players), 0), 2000);
    return Math.floor((base * (4000 - pc)) / 4000);
}

/** The respawn to schedule for a /playercount reading: 150 players fewer, so never too short. */
export function scheduledRespawn(players: number): number {
    return respawnFor(players - 150);
}

export interface Rotation {
    /** knife-mine `steps`: one lap of stand>rock pairs, starting on the first stand. */
    steps: string;
    /** Where its figures come from. */
    basis: string;
}

/** The zoo cluster's laps (2602-2606,3233-3237: six iron rocks, members, no requirement). */
export const ROTATIONS: Record<string, Rotation> = {
    // mining.md section 4 "Rock rotation" (the demo period); knife 3.00 at D=13 (rs/53, 2 x 200
    // ores; in page, tick-programs.md), adjacent-rock 3.61 at D=13 (60 and 200 ores)
    five: {
        steps: '2604,3235>2605,3235 2602,3235>2602,3236 2603,3234>2602,3234 2603,3233>2602,3233 2605,3234>2605,3233',
        basis: 'measured: knife 3.00 and adjacent-rock 3.61 ticks/ore at D=13 (mining.md section 4, tick-programs.md)',
    },
    // mining.md section 4 (the quiet-server period); knife 3.50 and adjacent-rock 3.84 at D=19 (60 ores each)
    six: {
        steps: '2602,3235>2602,3234 2603,3236>2602,3236 2605,3236>2605,3237 2606,3235>2605,3235 2605,3234>2605,3233 2603,3233>2602,3233',
        basis: 'measured: knife 3.50 and adjacent-rock 3.84 ticks/ore at D=19 (mining.md section 4)',
    },
};

/** The zoo cluster's centre, for "already there". */
export const ZOO: P = [2604, 3235];

/**
 * Plain (adjacent-rock) ticks per ore at respawn D, the gate's switch-off reference: measured at
 * D=13 (3.61) and D=19 (3.84), linear between them (inferred), clamped outside.
 */
export function plainTicksPerOre(D: number): number {
    const t = Math.min(1, Math.max(0, (D - 13) / 6));
    return Math.round((3.61 + t * (3.84 - 3.61)) * 100) / 100;
}

/**
 * Drops in one knife stretch before the gate's measured switch-off may fire. Below 63 an iron
 * roll can fail, and over the 15-63 band's ~92 ores roll luck alone trips a 30-drop check about
 * 2.6% of the time (0.1% at 60, never at 90+); from 63 every roll succeeds. A false fire holds
 * plain for 3,000 ticks (~+550 on the 63-99 band), while 120 instead of 60 costs only ~60 more
 * ores of a genuinely slow knife, so the window is long (docs/speedrun/rehearsals/mining.md).
 */
export const GATE_MEASURE_DROPS = 120;

export function parseSteps(steps: string): Array<{ stand: P; rock: P }> {
    return steps.trim().split(/\s+/).map(st => {
        const [a, b] = st.split('>');
        const p = (v: string | undefined): P => {
            const n = (v ?? '').split(',').map(Number);
            if (n.length !== 2 || !n.every(Number.isInteger)) throw new Error(`bad step '${st}'`);
            return [n[0]!, n[1]!];
        };
        return { stand: p(a), rock: p(b) };
    });
}

const cheb = (a: P, b: P) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const key = (p: P) => `${p[0]},${p[1]}`;

export interface LapModel {
    /** Steady ticks per ore with the knife and a rune pickaxe at respawn D. */
    ticksPerOre: number;
    /** Transitions per lap that wait for a respawn. */
    waits: number;
    /** Longest move between stands (a knife move must land its click by R+2: at most 4 tiles at run). */
    maxTiles: number;
    problems: string[];
}

/**
 * The knife rotation's steady state at respawn D, by knife-mine's planning rule: after a roll on
 * R the next rock's click lands on max(R+2 after a move, R+1 in place, its roll + D); landing by
 * R+3 rolls on R+3 (the starter's clock), later it rolls 2 ticks after landing (a wait).
 */
export function lapModel(steps: string, D: number): LapModel {
    const st = parseSteps(steps);
    const problems: string[] = [];
    let maxTiles = 0;
    for (let i = 0; i < st.length; i++) {
        const prev = st[(i + st.length - 1) % st.length]!.stand;
        const d = cheb(prev, st[i]!.stand);
        maxTiles = Math.max(maxTiles, d);
        if (d > 4) problems.push(`step ${i + 1} moves ${d} tiles (at most 4 at run)`);
        if (cheb(st[i]!.stand, st[i]!.rock) !== 1 || (st[i]!.stand[0] !== st[i]!.rock[0] && st[i]!.stand[1] !== st[i]!.rock[1])) problems.push(`step ${i + 1}: the stand is not beside its rock`);
    }
    const last = new Map<string, number>();
    let R = 0;
    let pos = st[st.length - 1]!.stand;
    const laps = 20;
    let mark = 0;
    let waits = 0;
    for (let i = 0; i < st.length * laps; i++) {
        const { stand, rock } = st[i % st.length]!;
        const move = key(pos) !== key(stand);
        const land = Math.max(move ? R + 2 : R + 1, (last.get(key(rock)) ?? -1e9) + D);
        let roll: number;
        if (land <= R + 3) roll = R + 3;
        else {
            roll = land + 2;
            if (i >= st.length * (laps - 10)) waits++;
        }
        last.set(key(rock), roll);
        R = roll;
        pos = stand;
        if (i === st.length * (laps - 10) - 1) mark = R;
    }
    return { ticksPerOre: Math.round(((R - mark) / (st.length * 10)) * 1000) / 1000, waits: waits / 10, maxTiles, problems };
}

/** The rotation with the fewest ticks per ore at D (the first listed on a tie). */
export function rotationFor(D: number): string {
    let best = '';
    let bestT = Infinity;
    for (const [name, r] of Object.entries(ROTATIONS)) {
        const t = lapModel(r.steps, D).ticksPerOre;
        if (t < bestT) {
            best = name;
            bestT = t;
        }
    }
    return best;
}

/** pickaxes.obj: levelrequire and mining_rate; pickaxe_checker.rs2 takes the best one usable. */
export const PICKAXES = [
    { name: /^rune pickaxe$/i, level: 41, rate: 2 },
    { name: /^adamant pickaxe$/i, level: 31, rate: 3 },
    { name: /^mithril pickaxe$/i, level: 21, rate: 4 },
    { name: /^steel pickaxe$/i, level: 6, rate: 5 },
    { name: /^iron pickaxe$/i, level: 0, rate: 6 },
    { name: /^bronze pickaxe$/i, level: 0, rate: 7 },
] as const;

/** knife-mine `rate`: [minLevel, mining_rate] for each pickaxe held, best first at each level. */
export function rateTable(inventory: ReadonlyArray<{ name: string }>): Array<[number, number]> {
    const held = PICKAXES.filter(p => inventory.some(i => p.name.test(i.name)));
    const out: Array<[number, number]> = [];
    for (const p of held) if (!out.some(([lvl, rate]) => lvl <= p.level && rate <= p.rate)) out.push([p.level, p.rate]);
    return out;
}

/** The mining_rate the engine uses at `level` with these items, or null without a usable pickaxe. */
export function pickaxeRate(inventory: ReadonlyArray<{ name: string }>, level: number): number | null {
    return PICKAXES.find(p => level >= p.level && inventory.some(i => p.name.test(i.name)))?.rate ?? null;
}

/** stat_random for iron (mine.dbrow 96/350): its success chance at `level`. */
export function ironChance(level: number): number {
    const l = Math.min(level, 99);
    return Math.min(1, (Math.floor((96 * (99 - l)) / 98) + Math.floor((350 * (l - 1)) / 98) + 1) / 256);
}

export interface CopperSite {
    stand: P;
    rocks: P[];
}

/** Copper or tin rocks two to a tile (server/content/maps; loc ids 2090/2091 copper, 2094/2095 tin). */
export const COPPER_SITES: Record<string, CopperSite> = {
    // Rimmington, 52 tiles from the Port Sarim sailors: copper north and south of the stand
    rimmington: { stand: [2977, 3246], rocks: [[2977, 3245], [2977, 3247]] },
};

/** tutorial.rs2's starter kit, less the bronze pickaxe: all `mining.prep` ever drops. */
export const STARTER_JUNK = [
    /^bronze axe$/i, /^tinderbox$/i, /^small fishing net$/i, /^shrimps$/i, /^bucket$/i, /^pot$/i, /^bread$/i, /^bronze dagger$/i,
    /^bronze sword$/i, /^wooden shield$/i, /^shortbow$/i, /^bronze arrow$/i, /^air rune$/i, /^mind rune$/i, /^water rune$/i,
    /^earth rune$/i, /^body rune$/i,
];
/** Free slots the bands want: ore, a gem, a stray fletch. */
export const FREE_SLOTS = 4;
/** H4p (STEP-MANIFEST.md's ledger): the iron kit by trade at the zoo; knife-mine loses none of the logs (rs/226, 1,050 ores). */
export const H4P_KIT: readonly WantSpec[] = [{ item: /^rune pickaxe$/i, amount: 1 }, { item: /^logs$/i, amount: 2 }];
/** Slots H4p adds: the pickaxe and two unstackable logs. */
export const KIT_SLOTS = 3;
/** Dead at S09's end: the pickaxes and the logs (the knife stays), and what an interrupted lap leaves. */
export const EXIT_DROPS: readonly RegExp[] = [...PICKAXES.map(p => p.name), /^logs$/i, /ore$|^uncut /i, /^arrow shaft$/i];

// ------------------------------------------------------------------ state readers

export function miningLevel(s: BotWorldState | null | undefined): number {
    return s?.skills.find(k => k.name.toLowerCase() === 'mining')?.baseLevel ?? 1;
}

function miningXp(s: BotWorldState): number {
    return s.skills.find(k => k.name.toLowerCase() === 'mining')?.experience ?? 0;
}

const MINE = /^mine$/i;
/** Depleted rocks keep op1=Mine: rocks.loc's mining_rock_empty locs (loc.pack 450-453), as knife-mine's EMPTY_ROCKS. */
export const EMPTY_ROCKS: ReadonlySet<number> = new Set([450, 451, 452, 453]);
const liveRock = (s: BotWorldState, p: P): NearbyLoc | undefined =>
    s.nearbyLocs.find(l => l.x === p[0] && l.z === p[1] && !EMPTY_ROCKS.has(l.id) && l.optionsWithIndex.some(o => MINE.test(o.text)));
const here = (s: BotWorldState): P => [s.player?.worldX ?? 0, s.player?.worldZ ?? 0];
const ORE = /^(iron|copper|tin) ore$/i;

/**
 * Drops every ore in the pack, 5 a tick, and returns how many. knife-mine drops each ore the tick
 * after it lands, so an interrupted run (an abort, a slip, a fault, a logout) can leave its last ore
 * behind; prep keeps only 4 slots free, and a full pack gives no xp, which knife-mine reads as a
 * stall (cairn_rocks on the demo: 5 such ores filled the pack at Mining 92).
 */
export async function dropOres(sdk: StepContext<any>['sdk']): Promise<number> {
    let n = 0;
    for (let guard = 0; guard < 8; guard++) {
        const ores = sdk.getState()!.inventory.filter(i => ORE.test(i.name)).slice(0, 5);
        if (!ores.length) break;
        await Promise.all(ores.map(i => sdk.sendDropItem(i.slot)));
        n += ores.length;
        await nextTick(sdk);
    }
    return n;
}
const freeSlots = (s: BotWorldState) => 28 - s.inventory.length;
/** Free slots once the band's ore drop has run. */
const freeOfOre = (s: BotWorldState) => freeSlots(s) + s.inventory.filter(i => ORE.test(i.name)).length;

function toNumber(v: unknown, name: string): number {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`mining: ${name} must be a number, not ${String(v)}`);
    return n;
}

/** Mainland, Karamja or the Ardougne side, for the travel legs (level 0 only; a deck is level 1). */
export function region(p: P): 'mainland' | 'karamja' | 'ardougne' {
    if (p[0] < 2740) return 'ardougne';
    if (p[0] < 2965 && p[1] < 3240) return 'karamja';
    return 'mainland';
}

function row(ctx: StepContext<any>, step: string, meta: Record<string, unknown>, startTick = currentTick(ctx.sdk), endTick = startTick): TickRow {
    return {
        v: 1, kind: 'program', runId: ctx.log.runId, account: ctx.session.name, sessionId: ctx.session.sessionId, step,
        startTick, endTick, ticks: Math.max(0, endTick - startTick), wallMs: 0, ok: true, meta, tickMs: tickMs(), at: new Date().toISOString(),
    };
}

// ------------------------------------------------------------------ steps

interface Shared {
    gate: HostGate | null;
}

export function steps(raw: MiningOpts = {}): Step<any>[] {
    if (raw.bury !== undefined) throw new Error("mining: the stay2 bones seam (rs/111's S07 fallback) is not built");
    const to = Math.min(99, toNumber(raw.to ?? 99, 'to'));
    const technique = (raw.technique ?? 'auto') as Technique;
    if (!['auto', 'knife', 'plain'].includes(technique)) throw new Error(`mining: technique must be auto, knife or plain, not ${technique}`);
    const respawn: number | 'auto' = raw.respawn === undefined || raw.respawn === 'auto' ? 'auto' : toNumber(raw.respawn, 'respawn');
    if (raw.rotation !== undefined && !ROTATIONS[raw.rotation]) throw new Error(`mining: no rotation '${raw.rotation}' (${Object.keys(ROTATIONS).join(', ')})`);
    const site = COPPER_SITES[raw.copperSite ?? 'rimmington'];
    if (!site) throw new Error(`mining: no copper site '${raw.copperSite}' (${Object.keys(COPPER_SITES).join(', ')})`);
    const travel = raw.travel ?? 'auto';
    if (travel !== 'auto' && travel !== 'none') throw new Error(`mining: travel must be auto or none, not ${travel}`);
    if (raw.kitGiver !== undefined && (typeof raw.kitGiver !== 'string' || !raw.kitGiver.trim())) throw new Error(`mining: kitGiver must be a name, not ${JSON.stringify(raw.kitGiver)}`);
    const d = raw.dropAtExit;
    if (d !== undefined && d !== true && d !== false && d !== 'true' && d !== 'false') throw new Error(`mining: dropAtExit must be true or false, not ${JSON.stringify(d)}`);
    const dropAtExit = d === true || d === 'true';
    const shared: Shared = { gate: null };
    const o = { to, technique, respawn, rotation: raw.rotation, origin: raw.origin, site };

    const out: Step<any>[] = [prepStep(to)];
    if (to > 1) out.push(copperStep(Math.min(15, to), site));
    if (travel === 'auto') out.push(...travelSteps(to));
    out.push(zooStep(to, o));
    if (raw.kitGiver !== undefined && to > 15) out.push(kitStep(to, raw.kitGiver));
    if (to > 15) out.push(ironStep('mining.iron-15', 15, Math.min(63, to), true, o, shared));
    if (to > 63) out.push(ironStep('mining.iron-63', 63, to, false, o, shared));
    if (dropAtExit) out.push(exitStep(to));
    return out;
}

const kitHeld = (s: BotWorldState) => H4P_KIT.every(w => s.inventory.filter(i => (w.item as RegExp).test(i.name)).reduce((n, i) => n + i.count, 0) >= (w.amount ?? 1));

/** H4p at the zoo: one receive from the trade giver, with the slots for it and the band. */
function kitStep(to: number, giver: string): Step<any> {
    const skip = (s: BotWorldState) => miningLevel(s) >= to || kitHeld(s);
    return {
        name: 'mining.kit: H4p',
        preconditions: s => {
            if (skip(s)) return true;
            const need = KIT_SLOTS + FREE_SLOTS;
            return freeOfOre(s) >= need ? true : `${28 - freeOfOre(s)} other items: H4p's rune pickaxe and 2 logs and the band need ${need} free slots`;
        },
        run: async ctx => {
            const { sdk } = ctx;
            if (skip(sdk.getState()!)) return;
            await dropOres(sdk);
            const t0 = currentTick(sdk);
            const r = await deps.receiveFrom(sdk, giver, { want: [...H4P_KIT], maxTicks: 60, openTimeoutMs: 20_000 });
            ctx.log.append({ ...row(ctx, 'mining.kit: H4p', { kind: 'mining-kit', ok: r.ok, ticks: r.ticks, received: r.received.map(i => `${i.name} x${i.count}`), ...(r.reason ? { reason: r.reason } : {}) }, t0), ticks: 0, ok: r.ok });
            if (!r.ok) throw new Error(`H4p from the trade giver failed: ${r.reason}`);
        },
        postconditions: s => (skip(s) ? true : 'H4p did not arrive: no rune pickaxe or fewer than 2 logs'),
        logoutSafe: true,
        done: ob => skip(ob.state),
    };
}

/** At `to`: drop EXIT_DROPS, 5 a tick, the last batch sent without waiting (as magic.ts's S02 exit). */
function exitStep(to: number): Step<any> {
    const dead = (s: BotWorldState) => s.inventory.filter(i => EXIT_DROPS.some(re => re.test(i.name)));
    const sent = new Set<number>();
    return {
        name: 'mining.exit',
        preconditions: s => (miningLevel(s) >= to ? true : `Mining ${miningLevel(s)} < ${to}: the exit drops wait for the band`),
        run: async ({ sdk }) => {
            sent.clear();
            for (let guard = 0; guard < 6; guard++) {
                const left = dead(sdk.getState()!).filter(i => !sent.has(i.slot));
                for (const i of left.slice(0, 5)) {
                    sent.add(i.slot);
                    void sdk.sendDropItem(i.slot);
                }
                if (left.length <= 5) return;
                await nextTick(sdk);
            }
        },
        // a drop sent and not yet published passes: waiting on it would cost the leg a tick
        postconditions: s => {
            const left = dead(s).filter(i => !sent.has(i.slot));
            return left.length ? `still held at the exit: ${left.map(i => i.name).join(', ')}` : true;
        },
        logoutSafe: true,
        done: ob => miningLevel(ob.state) >= to && dead(ob.state).length === 0,
    };
}

/** Only a fresh account (below 15) is prepared: the scored run's inventory is never touched. */
function prepStep(to: number): Step<any> {
    const fresh = (s: BotWorldState) => miningLevel(s) < Math.min(15, to);
    return {
        name: 'mining.prep',
        preconditions: s => (s.inGame ? true : 'not in game'),
        run: async ({ sdk }) => {
            for (let guard = 0; guard < 10; guard++) {
                const s = sdk.getState()!;
                if (!fresh(s) || freeSlots(s) >= FREE_SLOTS) return;
                const junk = s.inventory.filter(i => STARTER_JUNK.some(re => re.test(i.name))).slice(0, Math.min(5, FREE_SLOTS - freeSlots(s)));
                if (!junk.length) return;
                await Promise.all(junk.map(i => sdk.sendDropItem(i.slot)));
                await nextTick(sdk);
            }
        },
        postconditions: s => (!fresh(s) || freeSlots(s) >= 1 ? true : 'inventory full: nothing of the starter kit left to drop'),
        logoutSafe: true,
    };
}

function copperStep(end: number, site: CopperSite): Step<any> {
    return {
        name: 'mining.copper',
        preconditions: s => (miningLevel(s) >= end || pickaxeRate(s.inventory, miningLevel(s)) !== null ? true : 'no usable pickaxe'),
        run: async ctx => {
            const { sdk, bot } = ctx;
            if (miningLevel(sdk.getState()) >= end) return;
            const s0 = sdk.getState()!;
            if (key(here(s0)) !== key(site.stand)) {
                const w = await bot.walkTo(site.stand[0], site.stand[1], 0);
                if (!w.success) throw new Error(`walk to the copper at ${key(site.stand)}: ${w.message}`);
            }
            const t0 = currentTick(sdk);
            let ores = 0;
            let clicks = 0;
            await withLevelUpDismissal(sdk, async () => {
                let last = -1;
                while (miningLevel(sdk.getState()) < end) {
                    let s = sdk.getState()!;
                    // the rock not mined last, else whichever is live, else wait for one
                    let i = [0, 1].map(k => (last + 1 + k) % site.rocks.length).find(k => liveRock(s, site.rocks[k]!));
                    if (i === undefined) {
                        const r = await waitUntil(sdk, st => site.rocks.some(p => liveRock(st, p)), { maxTicks: 30 });
                        if (!r.ok) throw new Error(`no copper rock came back at ${key(site.stand)}`);
                        continue;
                    }
                    const rock = site.rocks[i]!;
                    const loc = liveRock(s, rock)!;
                    const xp0 = miningXp(s);
                    await sdk.sendInteractLoc(rock[0], rock[1], loc.id, loc.optionsWithIndex.find(o => MINE.test(o.text))!.opIndex);
                    clicks++;
                    // a normal rock's success runs p_delay(0) and depletes it; a failure keeps swinging
                    const r = await waitUntil(sdk, st => miningXp(st) > xp0 || !liveRock(st, rock), { maxTicks: 40 });
                    s = r.state ?? sdk.getState()!;
                    if (miningXp(s) > xp0) {
                        ores++;
                        last = i;
                        const ore = s.inventory.find(it => /ore$|^uncut/i.test(it.name));
                        if (ore) void sdk.sendDropItem(ore.slot);
                        // the click on the tick after p_delay(0) is refused (OpLocHandler)
                        await nextTick(sdk, s.tick);
                    } else if (!r.ok) {
                        last = i; // stuck: try the other rock
                    }
                }
            });
            ctx.log.append(row(ctx, '(band) mining.copper', { ores, clicks, site: key(site.stand) }, t0, currentTick(sdk)));
        },
        postconditions: s => (miningLevel(s) >= end ? true : `Mining ${miningLevel(s)} < ${end}`),
        logoutSafe: true,
        done: o => miningLevel(o.state) >= end,
    };
}

/** Answer a conversation the tick each page shows; resolves when `until` holds. */
async function converse(ctx: StepContext<any>, npc: RegExp, answers: RegExp[], until: (s: BotWorldState) => boolean, maxTicks = 120): Promise<void> {
    const { sdk } = ctx;
    const n = sdk.findNearbyNpc(npc);
    if (!n) throw new Error(`no ${npc} near ${key(here(sdk.getState()!))}`);
    let lastPage = '';
    let stuck: string | null = null;
    const unsub = sdk.onStateUpdate(s => {
        const d = s.dialog;
        if (!d.isOpen || d.isWaiting || !d.pageId || d.pageId === lastPage) return;
        lastPage = d.pageId;
        if (d.options.length > 1) {
            const opt = d.options.find(o => answers.some(a => a.test(o.text)));
            if (!opt) stuck = d.options.map(o => o.text).join(' | ');
            else void sdk.sendClickDialog(opt.index);
        } else void sdk.sendClickDialog(0);
    });
    try {
        await sdk.sendInteractNpc(n.index, n.optionsWithIndex.find(o => /talk/i.test(o.text))?.opIndex ?? 1);
        const r = await waitUntil(sdk, s => stuck !== null || until(s), { maxTicks });
        if (stuck) throw new Error(`no answer among: ${stuck}`);
        if (!r.ok) throw new Error(`talking to ${npc} did not get us aboard in ${maxTicks} ticks`);
    } finally {
        unsub();
    }
}

/** Off a ship's deck (level 1) by its gangplank. */
async function disembark(ctx: StepContext<any>): Promise<void> {
    const { sdk } = ctx;
    if (sdk.getState()!.dialog.isOpen) {
        await waitUntil(sdk, s => !s.dialog.isWaiting, { maxTicks: 5 });
        await sdk.sendClickDialog(0);
        await waitUntil(sdk, s => !s.dialog.isOpen, { maxTicks: 10 });
    }
    const planks = (s: BotWorldState) => s.nearbyLocs.filter(l => /gangplank/i.test(l.name) && l.optionsWithIndex.some(o => /cross/i.test(o.text))).sort((a, b) => a.distance - b.distance);
    // the ship moves the player to another region: its locs reach the state some ticks later
    const seen = await waitUntil(sdk, s => planks(s).length > 0, { maxTicks: 15 });
    const plank = planks(seen.state ?? sdk.getState()!)[0];
    if (!plank) {
        const s = sdk.getState()!;
        throw new Error(`no gangplank beside the deck at ${key(here(s))} level ${s.player?.level} (locs: ${s.nearbyLocs.slice(0, 8).map(l => `${l.name}@${l.x},${l.z}`).join(' ')})`);
    }
    await sdk.sendInteractLoc(plank.x, plank.z, plank.id, plank.optionsWithIndex.find(o => /cross/i.test(o.text))!.opIndex);
    const r = await waitUntil(sdk, s => (s.player?.level ?? 1) === 0, { maxTicks: 20 });
    if (!r.ok) throw new Error('did not get off the deck');
}

const onLevel0 = (s: BotWorldState) => (s.player?.level ?? 0) === 0;

async function walk(ctx: StepContext<any>, x: number, z: number, tolerance = 2): Promise<void> {
    const r = await ctx.bot.walkTo(x, z, tolerance);
    if (!r.success) throw new Error(`walk to ${x},${z}: ${r.message}`);
}

function travelSteps(to: number): Step<any>[] {
    const leg = (name: string, from: ReturnType<typeof region>, run: (ctx: StepContext<any>) => Promise<void>): Step<any> => ({
        name: `mining.travel: ${name}`,
        preconditions: s => (s.inGame ? true : 'not in game'),
        run: async ctx => {
            const s = ctx.sdk.getState()!;
            if (miningLevel(s) >= to || !onLevel0(s) || region(here(s)) !== from) return;
            await run(ctx);
        },
        postconditions: () => true,
        logoutSafe: false,
    });
    const aboard = (s: BotWorldState) => !onLevel0(s);
    return [
        leg('Port Sarim', 'mainland', ctx => walk(ctx, 3027, 3218)),
        leg('ship to Karamja', 'mainland', async ctx => {
            // any of the three sailors; 30 coins (quests/primitives.md: 21-22 ticks to the deck)
            await converse(ctx, /^(seaman lorris|seaman thresnor|captain tobias)$/i, [/^Yes please/i], s => aboard(s) && region(here(s)) === 'karamja');
            await disembark(ctx);
        }),
        leg('Brimhaven', 'karamja', ctx => walk(ctx, 2775, 3228)),
        leg('ship to Ardougne', 'karamja', async ctx => {
            // customs_officer.rs2: searched, 30 coins, to the Ardougne deck at 2683,3268 level 1
            await converse(ctx, /^customs officer$/i, [/journey on this ship/i, /Search away/i, /^Ok\.?$/i], s => aboard(s) && region(here(s)) === 'ardougne');
            await disembark(ctx);
        }),
    ];
}

function zooStep(to: number, o: { rotation?: string | undefined }): Step<any> {
    return {
        name: 'mining.travel: zoo',
        preconditions: s => (s.inGame ? true : 'not in game'),
        run: async ctx => {
            const s = ctx.sdk.getState()!;
            if (miningLevel(s) >= to || miningLevel(s) < 15) return;
            if (region(here(s)) !== 'ardougne' || !onLevel0(s)) throw new Error(`not on the Ardougne side at ${key(here(s))} level ${s.player?.level}: travel first`);
            const first = parseSteps(ROTATIONS[o.rotation ?? 'five']!.steps)[0]!.stand;
            if (cheb(here(s), first) > 3) await walk(ctx, first[0], first[1], 0);
        },
        postconditions: s => (miningLevel(s) >= to || miningLevel(s) < 15 || cheb(here(s), ZOO) <= 10 ? true : `not at the zoo cluster (${key(here(s))})`),
        logoutSafe: false,
    };
}

interface IronOpts {
    technique: Technique;
    respawn: number | 'auto';
    rotation?: string | undefined;
    origin?: string | undefined;
}

/** Watches the rotation's rock tiles: each depletion's observed respawn (dead label to live label, plus one). */
class RespawnWatch {
    readonly histogram: Record<number, number> = {};
    max = 0;
    private readonly dead = new Map<string, number>();
    private readonly unsub: () => void;
    constructor(sdk: StepContext<any>['sdk'], rocks: P[], onLonger: (d: number) => void, private scheduled: () => number) {
        this.unsub = sdk.onStateUpdate(s => {
            for (const r of rocks) {
                const k = key(r);
                const live = !!liveRock(s, r);
                if (!live && !this.dead.has(k)) this.dead.set(k, s.tick);
                else if (live && this.dead.has(k)) {
                    const d = s.tick - this.dead.get(k)! + 1;
                    this.dead.delete(k);
                    this.histogram[d] = (this.histogram[d] ?? 0) + 1;
                    this.max = Math.max(this.max, d);
                    if (d > this.scheduled()) onLonger(d);
                }
            }
        });
    }
    stop(): void {
        this.unsub();
    }
}

function ironStep(name: string, start: number, end: number, failures: boolean, o: IronOpts, shared: Shared): Step<any> {
    const inBand = (s: BotWorldState) => miningLevel(s) >= start && miningLevel(s) < end;
    return {
        name,
        preconditions: s => {
            if (miningLevel(s) >= end) return true;
            if (miningLevel(s) < start) return `Mining ${miningLevel(s)} < ${start}`;
            if (pickaxeRate(s.inventory, miningLevel(s)) === null) return 'no usable pickaxe';
            if (freeOfOre(s) < FREE_SLOTS) return `${28 - freeOfOre(s)} other items: need ${FREE_SLOTS} free slots (ore, a gem, a stray fletch)`;
            return cheb(here(s), ZOO) <= 10 ? true : `not at the zoo cluster (${key(here(s))})`;
        },
        run: async ctx => {
            if (!inBand(ctx.sdk.getState()!)) return;
            await ironBand(ctx, name, end, failures, o, shared);
        },
        postconditions: s => (miningLevel(s) >= end ? true : `Mining ${miningLevel(s)} < ${end}`),
        logoutSafe: true,
        done: ob => miningLevel(ob.state) >= end,
        inProgress: ob => inBand(ob.state),
    };
}

async function playersNow(ctx: StepContext<any>, origin: string | undefined): Promise<number | null> {
    const from = origin ?? demoOrigin(loadBotEnv(ctx.session.name).SERVER);
    return (await samplePlayerCount(from)).players;
}

async function ironBand(ctx: StepContext<any>, name: string, end: number, failures: boolean, o: IronOpts, shared: Shared): Promise<void> {
    const { sdk } = ctx;
    const t0 = currentTick(sdk);
    const log = (line: string) => console.log(`[${name}] ${line}`);
    let players: number | null = null;
    let D: number;
    if (o.respawn === 'auto') {
        players = await playersNow(ctx, o.origin);
        if (players === null) throw new Error('respawn auto: /playercount did not answer (pass respawn=<ticks>)');
        D = scheduledRespawn(players);
    } else D = o.respawn;
    const segments: GatedSegment[] = [];
    const restarts: Array<{ tick: number; why: string; D: number; rotation: string }> = [];
    const restartWaits: Array<{ tick: number; ticks: number; after: string; next: string; ok: boolean }> = [];
    const oreDrops: Array<{ tick: number; ores: number }> = [];
    const clearOres = async () => {
        const t = currentTick(sdk);
        const n = await dropOres(sdk);
        if (n) {
            oreDrops.push({ tick: t, ores: n });
            log(`T${currentTick(sdk)} dropped ${n} ore${n > 1 ? 's' : ''} left by an interrupted run`);
        }
    };
    let faults = 0;
    let rotation = o.rotation ?? rotationFor(D);
    let abort = new AbortController();
    let abortWhy = '';
    const rocks = (r: string) => [...new Map(parseSteps(ROTATIONS[r]!.steps).map(st => [key(st.rock), st.rock])).values()];
    const allRocks = [...new Map(Object.values(ROTATIONS).flatMap(r => parseSteps(r.steps)).map(st => [key(st.rock), st.rock])).values()];
    const watch = new RespawnWatch(sdk, allRocks, d => {
        if (d > D && !abort.signal.aborted) {
            abortWhy = `observed respawn ${d} > scheduled ${D}`;
            D = d;
            abort.abort();
        }
    }, () => D);
    let poll: ReturnType<typeof setInterval> | undefined;
    if (o.respawn === 'auto') {
        poll = setInterval(() => {
            void playersNow(ctx, o.origin).then(p => {
                if (p === null) return;
                players = p;
                const d = scheduledRespawn(p);
                const r = o.rotation ?? rotationFor(d);
                if ((d > D || r !== rotation) && !abort.signal.aborted) {
                    abortWhy = `${p} players: respawn ${D} -> ${d}, rotation ${rotation} -> ${r}`;
                    D = d;
                    abort.abort();
                }
            }).catch(() => {});
        }, 100 * tickMs());
    }
    try {
        for (;;) {
            const s = sdk.getState()!;
            if (miningLevel(s) >= end) break;
            rotation = o.rotation ?? rotationFor(D);
            await clearOres();
            const live = (st: BotWorldState) => rocks(rotation).every(p => liveRock(st, p));
            if (!live(s)) {
                const r = await waitUntil(sdk, live, { maxTicks: D + 10 });
                if (!r.ok) throw new Error(`the ${rotation} rotation's rocks are not all live after ${D + 10} ticks: someone else mining here?`);
            }
            const inv = sdk.getState()!.inventory;
            const canKnife = inv.some(i => /^knife$/i.test(i.name)) && inv.some(i => /^logs$/i.test(i.name));
            const technique: Technique = canKnife ? o.technique : 'plain';
            if (!canKnife && o.technique !== 'plain') log('no knife or no logs left: plain');
            if (technique === 'auto' && !shared.gate) shared.gate = deps.inPageGate(sdk as never, { plainTicksPerRoll: plainTicksPerOre(D), measureDrops: GATE_MEASURE_DROPS, log });
            const params: Record<string, unknown> = {
                steps: ROTATIONS[rotation]!.steps,
                respawn: D,
                untilLevel: end,
                rate: rateTable(inv),
                ...(failures ? { success: 'iron' } : {}),
                // plain's timer trick on the next rock itself (inert under the knife)
                selfStarter: true,
            };
            log(`T${currentTick(sdk)} level ${miningLevel(sdk.getState())}: respawn ${D}${players !== null ? ` (${players} players)` : ''}, rotation ${rotation}, ${technique}`);
            try {
                const r = await deps.runGatedProgram(sdk, 'knife-mine', params, {
                    ...(shared.gate && technique === 'auto' ? { gate: shared.gate } : {}),
                    technique,
                    ...(failures ? { rollsPerDrop: (st: BotWorldState | null) => 1 / ironChance(miningLevel(st)) } : {}),
                    signal: abort.signal,
                    // knife-mine faults at start unless the whole lap is live: a technique switch
                    // or a re-probe's return waits for it (up to D), never retrying into faults.
                    // An empty nearbyLocs (the scene not loaded after a relog) reads as not live.
                    beforeRestart: async (next, prev) => {
                        await clearOres();
                        const w0 = currentTick(sdk);
                        const r = await waitUntil(sdk, live, { maxTicks: D + 10 });
                        restartWaits.push({ tick: w0, ticks: currentTick(sdk) - w0, after: `${prev.technique}:${prev.reason}`, next, ok: r.ok });
                        log(`T${currentTick(sdk)} restart ${next} after ${prev.technique}:${prev.reason}: waited ${currentTick(sdk) - w0} ticks for the lap`);
                    },
                    onSegment: seg => {
                        segments.push(seg);
                        ctx.log.append(row(ctx, `(segment) ${name}`, { technique: seg.technique, reason: seg.reason, respawn: D, rotation, counters: seg.status.counters, result: seg.status.result, frames: seg.status.frames, logTail: seg.status.logTail }, seg.status.startedTick, seg.status.endedTick ?? seg.status.tick));
                    },
                    log,
                });
                if (r.ended === 'aborted') {
                    restarts.push({ tick: currentTick(sdk), why: abortWhy, D, rotation });
                    log(`restart: ${abortWhy}`);
                    abort = new AbortController();
                    continue;
                }
                if (r.ended === 'stopped') throw new Error('knife-mine was stopped from outside');
            } catch (e) {
                // a technique switch restarts the program at once, before every rock is back
                if (e instanceof ProgramError && /no live rock/.test(e.message) && ++faults <= 10) {
                    log(`restart after: ${e.message}`);
                    continue;
                }
                throw e;
            }
        }
    } finally {
        watch.stop();
        if (poll) clearInterval(poll);
        ctx.log.append(row(ctx, `(band) ${name}`, {
            players, respawn: D, rotation, restarts, restartWaits, oreDrops, faults, observedRespawn: watch.histogram, gate: shared.gate?.summary() ?? null,
            segments: segments.map(sg => ({ technique: sg.technique, reason: sg.reason, ticks: (sg.status.endedTick ?? sg.status.tick) - sg.status.startedTick, ores: sg.status.counters.ores ?? 0, slips: sg.status.counters.slips ?? 0, failed: sg.status.counters.failed ?? 0, result: sg.status.result })),
        }, t0, currentTick(sdk)));
    }
}

