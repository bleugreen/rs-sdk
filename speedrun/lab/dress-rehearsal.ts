#!/usr/bin/env bun
// The lab dress rehearsal of the scored run (cairn://p/rs/393, acceptance (b)/(c)): run.ts's chain on
// a fresh lab account, on the lab engine only, with:
// - each missing step group (a module not on main, with the legs inside the group) swapped for its
//   lab stand-in (lab/stand-ins.ts), a `STAND-IN` row the report counts apart: the run is partial;
// - the placed hand-offs traded with lab/stub-giver.ts (a lab account on the real protocol), when
//   --stub names one; otherwise supplied at the boundary by staff commands and logged
//   `supply: staff` (also partial);
// - the cannon rows (H11, H23) run as SCORED's own cue-served hand-off (runner/handoff.ts) when the
//   lab run config names their holder, a lab account in cannon.ts serve mode with labStock; with no
//   holder named they are staff-supplied like any unserved row;
// - S04's ring givers and S06's altar givers, the real ones and never a stand-in, run by this driver
//   when the slice runs their step (--ringers, --altar-givers below); a slice that runs S04 or S06
//   without its givers refuses (giverGaps) before SCORED logs in;
// - S03's log-row droppers, the real ones, run by this driver the same way (--droppers below);
// - S07's bone givers, the real four, run by this driver the same way (--bone-givers below);
// - the modules' other helpers (courier, anvil, wine giver) started by
//   the operator in their lab modes, named in the lab run config.
//
//   LOCAL_STAFF_LEVEL=4 bun speedrun/lab/dress-rehearsal.ts --bot=<fresh lab account env> --config=<lab run config>
//       [--until=<id>] [--from=<id>] [--stage=0] [--stub=<stub giver env>] [--client=browser|lite] [--log=<file>]
//       [--ringers=<g1>,<g2>,<g3>] [--altar-givers=<a1>,...,<a7>] [--droppers=<d1>,...,<d6>] [--bone-givers=<b1>,...,<b4>] [--staff-steps=<id>,...]
//       [--anvil=<cairn_ name>] [--cannon-holder=<cairn_ name>] [--wine-giver=<lab.sh helper>]
//       [--plan-out=<file>] [--plan-only=1] [--vitals=<file>]
//
// --plan-out: the lab chain this invocation runs (each step's id, name and kind), the index it starts
// at, the helper families the steps from there need and its giver gaps, as JSON (RehearsalPlan),
// written before any session opens; --plan-only=1 writes it and exits (3 when there are gaps). A
// driver (lab/bench-step.ts) resolves a step and its families from the chain itself this way, not
// from a second copy of the planning above.
// --vitals: SCORED's hitpoints and food held (lib/travel.ts FOOD), one JSONL line each time either
// changes, keyed by the session and tick the tick log's rows use: what a step cost in HP and food,
// which the tick log does not carry.
//
// --anvil: S25a's anvil helper (SUPPLIES.md H21a), a cairn_ name NOT on LAB_HELPERS: lab/anvil-launch.ts
// starts helpers/anvil.ts through the run machine's launcher (relay, bank restock with lab stock,
// {S25a, anvil}, its gateway on AGENT_PORT+10), serving before SCORED logs in; the run config's
// anvil.giver becomes it. It logs out once S25a's last inventory returns or the chain ends.
// --cannon-holder: H23's cannon holder (S27's set, balls and kit; cairn_h92 on the day), a cairn_ name
// NOT on LAB_HELPERS: lab/cannon-launch.ts starts cannon.ts serve mode through the run machine's
// launcher (the ledger row's load by staff commands, the landing helper tile, {S27, cannon}, its
// gateway on AGENT_PORT+11), loaded on its tile before SCORED logs in; it becomes H23's partner, so
// H23 runs as SCORED's real cue-served hand-off. It logs out once H23 returns or the chain ends.
// --wine-giver: S25c's wine giver (SUPPLIES.md H21c), a lab.sh LAB_HELPERS account (its lite runner up):
// lab/wine-giver.ts stages it by staff beside SCORED's booth stand with H21c's 520 noted wines before
// SCORED logs in; when S25c starts it runs the real hand-off (wine.ts giveWine afterRelog: SCORED
// seen, gone at relog 1, back, then the trade). The run config's wineGiver becomes it.
//
// --staff-steps: steps (S25a, S25c, ...) whose helpers no lab launch serves yet: each is replaced by a
// STAND-IN staff jump to the boundary just past it (lab/boundary.ts staffJumps), so the rest of the
// chunk measures; the run is reported partial.
//
// --ringers: S04's ring givers (SUPPLIES.md H3, magic.ts RING_CONTRACT), one per load, lab.sh
// LAB_HELPERS accounts (their lite runners up). lab/ring-givers.ts stages each with its load by ::give
// beside S04's tile (ringerTile: the start of the leg after S04, off the Firemaking row's tiles)
// before SCORED logs in; the run config's `rings` names load i's giver as the i-th (withRingers).
// They keep a request standing once S04 runs, and stop once it returns or the chain ends.
// --altar-givers: S06's air-altar givers (SUPPLIES.md H5: 7 on the day, one load each), cairn_ names
// NOT on LAB_HELPERS: lab/altar-launch.ts starts them through the run machine's launcher
// (helpers/standalone.ts: path direct, restock by ::give, S06's band load and cue scope, its gateway
// on AGENT_PORT+5), launcher.json in run-machine/ (where runecraft.ts reads it) and their status files
// in the cue dir, every one in the room and ready before SCORED logs in. runecraft.ts writes the
// {S06, altar} cue itself. They log out once S06 returns or the chain ends.
// --droppers: S03's log-row droppers (SUPPLIES.md H2: 6 on the day, one inventory each), cairn_ names NOT
// on LAB_HELPERS: lab/fm-row-launch.ts starts them through the run machine's launcher on the run
// config's firemakingTiles (`start: 'cue'`, restock by ::give, its gateway on AGENT_PORT+6, its own run
// dir), every one armed on its first tile before SCORED logs in; the go file the chain writes at S01
// starts them. They log out once S03 returns or the chain ends. A slice that runs S03 without its S01
// go cue refuses.
// --bone-givers: S07's bone givers (SUPPLIES.md H4.1-H4.n: four taking turns), cairn_ names NOT on
// LAB_HELPERS: lab/bone-launch.ts starts them through the run machine's launcher (relay path, restock
// by ::give, one group with S07's lab load count, the last named carrying T07-08's Camelot runes, its
// gateway on AGENT_PORT+7, its own run dir), every one loaded before SCORED logs in; the run config's
// `bones` names the same group and last load (withBoneGivers), and woodcutting.ts writes their
// {S07, bone} cue. They log out once S07's last step returns or the chain ends.
//
// --from=Sxx (a chunk: S05, S10, S15, S22) starts a fresh account at that chunk's boundary: S00's
// tutorial skip, then lab/boundary.ts stages by staff commands what the run holds there (RUN-ORDER's
// levels, the ledger's pack and worn items, the quests before it, the first leg's start tile) and
// the chain runs from the leg into the chunk. A boundary value the docs cannot give is printed and
// left unstaged; a staged state that comes out different refuses (exit 3). --stage=0, or any other
// --from (a step id or name, an index), resumes an account already there.
//
// Hosts (main's ruling): bgsrv-mac only while bgsrv-ub is down, never local or fedora, from a
// scratch tree pinned to one commit, under `timeout --kill-after=30s <bound>`. The account is a fresh
// lab name (S00's tutorial skip runs first), never SCORED nor a fleet account. Nothing here checks
// the run-commit floor or the host reservation's ownership: those gates are the scored run's
// (speedrun/run.ts), and this driver never runs off a lab (stand-ins.ts labRefusal, checked first).
//
// Exit: 0 the slice ran (partial or not, the report says which), 1 a step failed, 3 refused.

import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Subprocess } from 'bun';
import { canonName, cueDir as defaultCueDir, RUN_DIR } from '../helpers/altar-cue';
import { ACCOUNT_NAME_RE, FORBIDDEN_ACCOUNTS } from '../helpers/fleet-config';
import { annotation } from '../lib/attempt';
import { ReservationWatch, reservationPath } from '../lib/host-reservation';
import { closeSession, loadBotEnv, openSession, relog, ROOT, type Session } from '../lib/session';
import { FOOD } from '../lib/travel';
import { waitUntil } from '../lib/wait';
import { parseTiles } from '../skills/firemaking';
import { resolveOptions as magicOptions, ROUTE_LOADS, type RingCounts } from '../skills/magic';
import { bands as runecraftBands } from '../skills/runecraft';
import { newRunId, parseLog, TickLog } from '../lib/ticks';
import { attemptOf, loadRunConfig, runChainOnSession, Terminated } from '../run';
import type { BotWorldState } from '../../sdk/types';
import { h4PlanOf } from '../quests/dorics-quest';
import { buildChain, CANNON_ROWS, KIT_PARTNER_ROWS, KIT_SEGMENTS, muleCueDir, noteRow, PLACEMENT, sliceUntil, resolveFrom, STAND_IN_ROWS, type ChainStep, type RunConfig } from '../runner/chain';
import { prepareCueDir, RunCues } from '../runner/cue-keeper';
import { AttemptRecord } from '../runner/attempt-record';
import { applyEquip, handOffFrom, unequipGives, type HandOffPlan, type HandOffSdk } from '../runner/handoff';
import type { LegStep } from '../runner/legs';
import { TILES } from '../runner/legs';
import { formatRunReport, runReport, STAFF_SUPPLY_STEP, STAND_IN_STEP } from '../runner/run-report';
import type { StepContext } from '../runner/step';
import { MANIFEST, parseLedger } from '../tools/slot-ledger';
import { altarGiverLaunch, spawnAltarGivers, stopAltarGivers, waitAltarGiversReady, writeLabBotEnvs } from './altar-launch';
import { anvilGaps, launchAnvil, runsS25a } from './anvil-launch';
import { cannonHolderGaps, launchCannonHolder, runsH23 } from './cannon-launch';
import { runsS25c, serveWine, stageWineGiver, wineGiverGaps } from './wine-giver';
import { boneGiverGaps, lastS07Step, launchBoneGivers, runsS07, S07_LAB_LOADS, stopBoneGivers, withBoneGivers } from './bone-launch';
import { applyBoundary, boundaryAt, chunkStart, staffJumps, type Boundary } from './boundary';
import { stopLauncher } from './helper-launch';
import { openSecureLabSession, type SecureLabSession } from './browser';
import { dropperGaps, launchDroppers, runsS03, stopDroppers } from './fm-row-launch';
import { giverTiles, serveLoads, stageLoad } from './ring-givers';
import { dropMatching, give, leaveTutorial, mustTele } from './setup';
import { labRefusal, standInFor, standInStep, type LabWorld } from './stand-ins';
import { stageRows, stubPlanOf, type StubPlanFile, type StubRow } from './stub-giver';
import { watchChunkEnd, type ChunkEndWatch } from './seam-check';

/** Observed ticks after login within which auto-retaliate must read off (openSession and login turn it off), or the rehearsal refuses. */
export const RETALIATE_OFF_TICKS = 30;

/** The partner name that marks a row as staff-supplied in the lab run config. */
export const STAFF = 'STAFF';

/** The helper's tile at the Ardougne landing (SUPPLIES.md H9-H11, H23: one tile west of the spread). */
export const LANDING_HELPER_TILE = { x: 2658, z: 3301 };
/** Rows with no leg before them on the chain (S01 is after S00; H21d after S25a at the booth). */
const ROW_TILES: Readonly<Record<string, { x: number; z: number; level?: number }>> = { H1: TILES.lumbridgeSpawn, H21d: TILES.westBooth };

/** Where a placed hand-off meets: the landing helper tile on a split leg, else the leg before it ends. */
export function meetingTile(chain: readonly ChainStep[], index: number): StubRow['tile'] {
    const s = chain[index]!;
    const row = s.name.replace(/ hand-off.*$/, '');
    if (ROW_TILES[row]) return ROW_TILES[row]!;
    for (let i = index - 1; i >= 0; i--) {
        const p = chain[i]!;
        if (p.kind !== 'leg') continue;
        if (/a$/.test(p.id) && 'leg' in (PLACEMENT[row] ?? {})) return LANDING_HELPER_TILE;
        const d = (p as unknown as LegStep).def.dest;
        return { x: d.x, z: d.z, ...(d.level ? { level: d.level } : {}) };
    }
    throw new Error(`${row}: no leg before it on the chain and no fixed tile`);
}

/**
 * A row the lab supplies with staff commands: the row's `in` given, its `out` dropped (every item id
 * an entry names), its equip applied. `planOf` reads the plan from the state at run time, for a row
 * whose `out` is a placeholder its module fills (H4's enchanted rings, KIT_PLANS).
 */
export function staffSupplyStep(step: ChainStep, manifest: string, planOf?: (s: BotWorldState) => HandOffPlan): ChainStep {
    const row = step.name.replace(/ hand-off.*$/, '');
    // H4m's loads share one fallback row (stub-giver.ts stubPlanOf), so each is looked up through it.
    const fixed = planOf ? null : stubPlanOf(manifest, row);
    const { rows, unresolved } = stageRows(manifest, { rows: [{ row, tile: { x: 0, z: 0 } }] });
    if (unresolved.length) throw new Error(`staff supply ${row}: no ::give name for ${unresolved.join(', ')}`);
    const run = async (ctx: StepContext<unknown>) => {
        const sdk = ctx.sdk as unknown as HandOffSdk & Parameters<typeof dropMatching>[0];
        const plan = fixed ?? planOf!(sdk.getState()! as BotWorldState);
        // A worn give or drop (H13's arrows, "swap: unworn first"; its helmet and armour, "drop: unworn first") comes off first, as the real hand-off takes it.
        await unequipGives(sdk, plan);
        const outs = [...plan.give, ...plan.drop];
        if (outs.length) await dropMatching(sdk, outs.flatMap((g): Parameters<typeof dropMatching>[1][number][] => (g.ids ? [...g.ids] : [g.pattern])));
        for (const st of rows[0]!.stage) await give(sdk, st.obj, st.n);
        await applyEquip(sdk, plan);
        noteRow(ctx, `${STAFF_SUPPLY_STEP} ${row}`, { row, gave: rows[0]!.stage, dropped: outs.map(g => g.name) });
    };
    return { id: step.id, kind: 'handoff', name: `${row} hand-off (${STAFF_SUPPLY_STEP})`, logoutSafe: true, preconditions: () => true, postconditions: () => true, run, resume: run };
}

export interface LabChain {
    chain: ChainStep[];
    /** Rows the stub giver serves, with their meeting tiles, in run order. */
    stubRows: StubRow[];
    standIns: string[];
    staffed: string[];
    /** Cannon rows run as SCORED's real cue-served hand-off against the lab holder. */
    cueServed: string[];
}

/**
 * run.ts's chain as the lab runs it: stand-ins for the missing groups, the stub giver's rows, the
 * cannon rows whose holder the config names (`cannonServed`) left as the real step, staff supply for
 * every other row.
 */
/** The plan each module-traded kit row (runner/chain.ts KIT_SEGMENTS) runs, from the state and the ledger's text. */
export const KIT_PLANS: Readonly<Record<string, (s: BotWorldState, manifest: string) => HandOffPlan>> = { H4: (s, manifest) => h4PlanOf(s, handOffFrom(manifest, 'H4')) };

export function labChain(chain: readonly ChainStep[], o: { manifest: string; stub: string | null; world: () => LabWorld; cannonServed?: readonly string[]; kitServed?: readonly string[] }): LabChain {
    const out: ChainStep[] = [];
    const stubRows: StubRow[] = [];
    const standIns: string[] = [];
    const staffed: string[] = [];
    const cueServed: string[] = [];
    for (let i = 0; i < chain.length; i++) {
        const s = chain[i]!;
        if (s.kind === 'missing') {
            const si = standInFor(s.id);
            if (!si) throw new Error(`${s.id} (${s.name}) is missing and has no lab stand-in`);
            let last = i;
            for (let j = i + 1; j < chain.length; j++) if (chain[j]!.id === s.id) last = j;
            // The rows the missing module trades itself (H12 inside Monkey Madness): staff-supplied first.
            const inLedger = new Set(parseLedger(o.manifest).rows.map(r => r.row));
            for (const row of (STAND_IN_ROWS[s.id] ?? []).filter(r => inLedger.has(r))) {
                out.push(staffSupplyStep({ ...s, id: row, kind: 'handoff', name: `${row} hand-off` }, o.manifest));
                staffed.push(row);
            }
            out.push(standInStep(si, o.world));
            standIns.push(s.id);
            i = last;
            continue;
        }
        // A kit row its module trades (H4 in Doric's segment A): staff-supplied just before the segment,
        // which then finds it landed, unless the lab config names a real giver for it.
        const kit = Object.keys(KIT_SEGMENTS).find(r => KIT_SEGMENTS[r] === s.name);
        if (kit && !o.kitServed?.includes(kit)) {
            // A row with no KIT_PLANS entry (H12) is staff-supplied as its ledger row stands.
            const plan = KIT_PLANS[kit];
            out.push(staffSupplyStep({ ...s, id: kit, kind: 'handoff', name: `${kit} hand-off` }, o.manifest, plan ? st => plan(st, o.manifest) : undefined));
            staffed.push(kit);
        }
        if (s.kind === 'handoff') {
            const row = s.name.replace(/ hand-off.*$/, '');
            if (CANNON_ROWS[row] && o.cannonServed?.includes(row)) {
                cueServed.push(row);
                out.push(s);
            } else if (CANNON_ROWS[row] || !o.stub) {
                out.push(staffSupplyStep(s, o.manifest));
                staffed.push(row);
            } else {
                stubRows.push({ row, tile: meetingTile(chain, i) });
                out.push(s);
            }
            continue;
        }
        out.push(s);
    }
    return { chain: out, stubRows, standIns, staffed, cueServed };
}

/** S06's band as the chain runs it (runner/chain.ts: runecraft.steps({ untilLevel: 44 })); its givers carry its `load`. */
export const S06_BAND = runecraftBands({ untilLevel: 44 }).find(b => b.id === 'S06')!;

/** The ring counts of the run config's S04 loads (default magic.ts ROUTE_LOADS). */
export function ringLoads(rings: RunConfig['rings']): RingCounts[] {
    return magicOptions(rings.loads ? { loads: rings.loads } : {}).loads.map(l => l.rings);
}

/** The run config's `rings` with load i given by `ringers[i]` (magic.ts RingLoad) and the first named as `giver`. */
export function withRingers(rings: RunConfig['rings'], ringers: readonly string[]): RunConfig['rings'] {
    return { giver: ringers[0]!, loads: ringLoads(rings).map((r, i) => ({ rings: r, ...(ringers[i] ? { giver: ringers[i] } : {}) })) };
}

/** The tile S04's ring givers stand beside: S04's own, where S03 leaves SCORED, the start of the first leg after it (legs.ts TILES.s03End). */
export function ringerTile(chain: readonly ChainStep[]): { x: number; z: number } {
    const i = chain.findIndex(s => s.id === 'S04');
    const leg = i < 0 ? undefined : chain.slice(i + 1).find(s => s.kind === 'leg');
    if (!leg) throw new Error('S04: no leg after it on the chain, so no tile for its ring givers');
    const d = (leg as unknown as LegStep).def.start;
    return { x: d.x, z: d.z };
}

export interface GiverSets {
    ringers: readonly string[];
    altarGivers: readonly string[];
    /** S03's log-row droppers (--droppers), one per inventory; absent is none. */
    droppers?: readonly string[];
    /** S07's bone givers (--bone-givers), four; absent is none. */
    boneGivers?: readonly string[];
    /** S04's ring loads, one giver each (default magic.ts ROUTE_LOADS). */
    loads?: number;
    /** lab.sh's LAB_HELPERS when it is set: the accounts whose lite runners are up. */
    labHelpers?: readonly string[];
    /** S25a's anvil helper (--anvil), a cairn_ name standalone.ts launches. */
    anvil?: string;
    /** H23's cannon holder (--cannon-holder), a cairn_ name standalone.ts launches. */
    cannonHolder?: string;
    /** S25c's wine giver (--wine-giver), a LAB_HELPERS account. */
    wineGiver?: string;
}

/**
 * Why the steps the rehearsal will run cannot meet their givers ([] when they can): S04 needs a
 * ring giver per load (--ringers, lite runners up), S06 its altar givers (--altar-givers, names
 * standalone.ts launches itself). A slice that runs neither needs neither.
 */
export function giverGaps(all: readonly (Pick<ChainStep, 'id'> & { name?: string })[], g: GiverSets): string[] {
    // A step --staff-steps jumped (a STAND-IN) meets no helper, so it needs none.
    const steps = all.filter(s => !(s.name ?? '').startsWith(STAND_IN_STEP));
    const out: string[] = [];
    out.push(...anvilGaps(steps, { anvil: g.anvil, ...(g.labHelpers ? { labHelpers: g.labHelpers } : {}), others: [...g.ringers, ...g.altarGivers, ...(g.droppers ?? []), ...(g.boneGivers ?? [])] }));
    out.push(...cannonHolderGaps(steps, { cannonHolder: g.cannonHolder, ...(g.labHelpers ? { labHelpers: g.labHelpers } : {}), others: [...g.ringers, ...g.altarGivers, ...(g.droppers ?? []), ...(g.boneGivers ?? []), ...(g.anvil ? [g.anvil] : [])] }));
    out.push(...wineGiverGaps(steps, { wineGiver: g.wineGiver, ...(g.labHelpers ? { labHelpers: g.labHelpers } : {}), others: [...g.ringers, ...g.altarGivers, ...(g.droppers ?? []), ...(g.boneGivers ?? []), ...(g.anvil ? [g.anvil] : []), ...(g.cannonHolder ? [g.cannonHolder] : [])] }));
    out.push(...dropperGaps(steps, { droppers: g.droppers ?? [], ...(g.labHelpers ? { labHelpers: g.labHelpers } : {}), others: [...g.ringers, ...g.altarGivers] }));
    const loads = g.loads ?? ROUTE_LOADS.length;
    if (steps.some(s => s.id === 'S04')) {
        if (!g.ringers.length) out.push(`S04 (ring enchanting) has no ring givers: name one per load (${loads}) with --ringers=<g1>,<g2>,<g3>, lab.sh LAB_HELPERS accounts`);
        else if (g.ringers.length < loads) out.push(`S04: --ringers names ${g.ringers.length} ring giver(s) for ${loads} loads (one per load)`);
        for (const r of g.ringers) if (g.labHelpers && !g.labHelpers.includes(r)) out.push(`S04: --ringers ${r} is not on LAB_HELPERS, so no lite runner is up for it`);
    }
    if (steps.some(s => s.id === 'S06')) {
        if (!g.altarGivers.length) out.push('S06 (the air altar) has no altar givers: name them with --altar-givers=<a1>,...,<a7>, cairn_ names not on LAB_HELPERS (standalone.ts logs them in)');
        for (const a of g.altarGivers) {
            if (!ACCOUNT_NAME_RE.test(a) || FORBIDDEN_ACCOUNTS.has(a)) out.push(`S06: --altar-givers ${a} is not a cairn_ helper name standalone.ts launches`);
            if (g.labHelpers?.includes(a)) out.push(`S06: --altar-givers ${a} is on LAB_HELPERS, so lab.sh has it logged in already; standalone.ts logs the altar givers in itself`);
            if (g.ringers.includes(a)) out.push(`S06: ${a} is named by both --ringers and --altar-givers`);
        }
    }
    out.push(...boneGiverGaps(steps, { boneGivers: g.boneGivers ?? [], ...(g.labHelpers ? { labHelpers: g.labHelpers } : {}), others: { '--ringers': g.ringers, '--altar-givers': g.altarGivers, '--droppers': g.droppers ?? [], '--anvil': g.anvil ? [g.anvil] : [] } }));
    return out;
}

/** The helper families the steps a rehearsal runs meet (giverGaps names what each one needs). */
export interface FamilyNeeds {
    droppers: boolean;
    rings: boolean;
    altar: boolean;
    bones: boolean;
    anvil: boolean;
    holder: boolean;
    wine: boolean;
}

export function familyNeeds(toRun: readonly ChainStep[]): FamilyNeeds {
    return { droppers: runsS03(toRun), rings: toRun.some(s => s.id === 'S04'), altar: toRun.some(s => s.id === 'S06'), bones: runsS07(toRun), anvil: runsS25a(toRun), holder: runsH23(toRun), wine: runsS25c(toRun) };
}

/** --plan-out's JSON: what this invocation will run, from where, with which families, and why it would refuse. */
export interface RehearsalPlan {
    /** The chain index the run starts at (0: the start). */
    from: number;
    chain: { id: string; name: string; kind: ChainStep['kind'] }[];
    needs: FamilyNeeds;
    gaps: string[];
    /** The chunk boundary --from=Sxx stages, or null. */
    boundary: Boundary | null;
}

export function rehearsalPlan(chain: readonly ChainStep[], from: number, needs: FamilyNeeds, gaps: readonly string[], boundary: Boundary | null): RehearsalPlan {
    return { from, chain: chain.map(s => ({ id: s.id, name: s.name, kind: s.kind })), needs, gaps: [...gaps], boundary };
}

/** One --vitals line: SCORED's hitpoints and the food it holds, at a session's tick (the tick log's sessionId and ticks). */
export interface VitalsLine {
    sid: number;
    tick: number;
    hp: number;
    food: number;
}

/** The --vitals lines: one per in-game state where the hitpoints or the food count changed. */
export class VitalsRecorder {
    private last = '';

    see(s: BotWorldState | null | undefined, sid: number): VitalsLine | null {
        if (!s?.inGame || !s.player) return null;
        const food = s.inventory.filter(i => FOOD.test(i.name)).reduce((a, i) => a + i.count, 0);
        const key = `${sid} ${s.player.hp} ${food}`;
        if (key === this.last) return null;
        this.last = key;
        return { sid, tick: s.tick, hp: s.player.hp, food };
    }
}

/** `step` with `start` called each time it runs or resumes, and `done` once it returns (not when it throws). */
export function hooked(step: ChainStep, h: { start?: (ctx: StepContext<unknown>) => void; done?: () => void }): ChainStep {
    const wrap = (f: (ctx: StepContext<unknown>) => Promise<void>) => async (ctx: StepContext<unknown>) => {
        h.start?.(ctx);
        await f(ctx);
        h.done?.();
    };
    return { ...step, run: wrap(ctx => step.run(ctx)), ...(step.resume ? { resume: wrap(ctx => step.resume!(ctx)) } : {}) };
}

/** One line of a boundary: the levels above 1, the quests, the pack, the worn set and the tile. */
export function formatBoundary(b: Boundary): string {
    const levels = Object.entries(b.levels).filter(([s, v]) => v.level > (s === 'hitpoints' ? 10 : 1)).map(([s, v]) => `${s} ${v.approx ? '~' : ''}${v.level}`);
    return [
        `levels ${levels.join(', ') || 'none'}`,
        `quests ${b.quests.map(q => `${q.key}=${q.value}`).join(' ') || 'none'} (qp ${b.qp})`,
        `pack ${b.inv.map(i => `${i.obj} x${i.n}`).join(', ') || 'empty'}`,
        `worn ${b.worn.map(i => `${i.obj} x${i.n}`).join(', ') || 'none'}`,
        `tile ${b.tile ? `${b.tile.x},${b.tile.z}${b.tile.level ? `,${b.tile.level}` : ''}` : 'none'}`,
    ].join('; ');
}

/** `--key=value` flags; a bare first argument is the bot (lab/lab.sh runs `bun <script> <bot> <args...>`). */
export function args(argv: readonly string[]): Record<string, string> {
    const out: Record<string, string> = {};
    argv.forEach((a, i) => {
        const m = /^--([a-z-]+)=(.*)$/.exec(a);
        if (m) out[m[1]!] = m[2]!;
        else if (i === 0 && !a.startsWith('-')) out.bot = a;
        else throw new Error(`unexpected argument ${a}`);
    });
    return out;
}

const list = (v: string | undefined) => (v ?? '').split(/[,\s]+/).filter(Boolean);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function main(argv: string[]): Promise<number> {
    const a = args(argv);
    if (!a.bot || !a.config) {
        console.error('usage: LOCAL_STAFF_LEVEL=4 bun speedrun/lab/dress-rehearsal.ts --bot=<fresh lab account env> --config=<lab run config> [--until=<id>] [--from=<id>] [--stub=<stub giver env>] [--client=browser|lite] [--log=<file>] [--ringers=<g1>,<g2>,<g3>] [--altar-givers=<a1>,...]');
        return 2;
    }
    const env = loadBotEnv(a.bot);
    if (FORBIDDEN_ACCOUNTS.has(canonName(env.BOT_USERNAME))) {
        console.error(`[dress] REFUSED: ${env.BOT_USERNAME} is a fleet or scored account; a dress rehearsal runs on a fresh lab name`);
        return 3;
    }
    let gateway = 'ws://localhost:8300';
    const world = (): LabWorld => ({ staffLevel: process.env.LOCAL_STAFF_LEVEL, server: env.SERVER || 'localhost', gateway });
    const pre = labRefusal(world());
    if (pre) {
        console.error(`[dress] REFUSED: ${pre}`);
        return 3;
    }
    const stubEnv = a.stub ? loadBotEnv(a.stub) : null;
    const raw = loadRunConfig(a.config, join(ROOT, 'run-machine'));
    const cannonHolder = a['cannon-holder'];
    // H23's partner is the holder --cannon-holder launches, so H23 stays SCORED's real cue-served hand-off.
    if (cannonHolder) raw.partners = { ...raw.partners, H23: cannonHolder };
    const manifest = readFileSync(MANIFEST, 'utf8');
    // Every placed row's partner: the stub giver when there is one, else STAFF.
    const partners: Record<string, string> = { ...raw.partners };
    for (const row of Object.keys(PLACEMENT)) partners[row] ??= stubEnv?.BOT_USERNAME ?? STAFF;
    // The quest kit rows are the modules' own trades: a slice that reaches one needs its giver named.
    for (const row of KIT_PARTNER_ROWS) partners[row] ??= STAFF;
    const ringers = list(a.ringers);
    const altarGivers = list(a['altar-givers']);
    const droppers = list(a.droppers);
    const anvil = a.anvil;
    const wineGiver = a['wine-giver'];
    const boneGivers = list(a['bone-givers']);
    const cfg: RunConfig = { ...raw, partners, ...(ringers.length ? { rings: withRingers(raw.rings, ringers) } : {}), ...(boneGivers.length ? { bones: withBoneGivers(boneGivers) } : {}) };
    // S25a trades the helper --anvil launches.
    if (anvil) cfg.anvil = { giver: anvil };
    if (wineGiver) cfg.wineGiver = wineGiver;
    if (cfg.cueDir !== defaultCueDir()) {
        console.error(`[dress] REFUSED: cue dir ${cfg.cueDir} is not the one the helpers' writers use (${defaultCueDir()})`);
        return 3;
    }
    // A cannon row the lab config names a holder for (cannon.ts serve, labStock) runs SCORED's real step.
    const cannonServed = Object.keys(CANNON_ROWS).filter(r => raw.partners[r] && raw.partners[r] !== STAFF);
    const keeper = new RunCues({ main: cfg.cueDir, mule: muleCueDir(cfg) }, env.BOT_USERNAME);
    // As run.ts: a re-run into the same --log is the same attempt, so S07's bone cue keeps its session.
    const runId = `dress-${newRunId()}`;
    const attempt = attemptOf(a.log && existsSync(a.log) ? parseLog(readFileSync(a.log, 'utf8')) : [], runId);
    const full = buildChain(cfg, { cues: keeper, manifest, attempt, record: new AttemptRecord(RUN_DIR, attempt) });
    const sliced = sliceUntil(full, a.until);
    const kitServed = Object.keys(KIT_SEGMENTS).filter(r => raw.partners[r] && raw.partners[r] !== STAFF);
    const lab = labChain(sliced, { manifest, stub: stubEnv?.BOT_USERNAME ?? null, world, cannonServed, kitServed });
    const runOrder = readFileSync(join(ROOT, 'docs/speedrun/RUN-ORDER.md'), 'utf8');
    // A helper-fed step no lab launch serves yet: staged past by staff and labelled (lab/boundary.ts staffJumps).
    const jumps = staffJumps(lab.chain, list(a['staff-steps']), { runOrder, manifest }, world);
    lab.chain = jumps.chain;
    lab.standIns.push(...jumps.jumped);
    const chunk = a.from && /^S\d\d$/.test(a.from) && a.stage !== '0' ? a.from : null;
    let boundary: Boundary | null = null;
    let from: number | undefined;
    if (chunk) {
        from = chunkStart(lab.chain, chunk);
        if (from > 0) {
            boundary = boundaryAt(lab.chain, from, { runOrder, manifest });
            console.log(`[dress] stage ${chunk} from ${boundary.firstId}: ${formatBoundary(boundary)}`);
            for (const u of boundary.unresolved) console.log(`[dress] stage ${chunk}: NOT STAGED ${u}`);
        }
    } else from = resolveFrom(lab.chain, a.from);

    // The givers of the steps this run reaches: the real ones, or a refusal before SCORED logs in.
    const toRun = lab.chain.slice(from ?? 0);
    const loads = ringLoads(cfg.rings);
    const labHelpers = process.env.LAB_HELPERS !== undefined ? list(process.env.LAB_HELPERS) : undefined;
    const gaps = giverGaps(toRun, { ringers, altarGivers, droppers, boneGivers, anvil, cannonHolder, wineGiver, loads: loads.length, ...(labHelpers ? { labHelpers } : {}) });
    const needs = familyNeeds(toRun);
    if (a['plan-out']) writeFileSync(a['plan-out'], JSON.stringify(rehearsalPlan(lab.chain, from ?? 0, needs, gaps, boundary)));
    if (a['plan-only']) {
        for (const g of gaps) console.log(`[dress] plan: gap ${g}`);
        console.log(`[dress] plan only: ${toRun.length} of ${lab.chain.length} steps from index ${from ?? 0}${a['plan-out'] ? `, written to ${a['plan-out']}` : ''}`);
        return gaps.length ? 3 : 0;
    }
    if (gaps.length) {
        for (const g of gaps) console.error(`[dress] REFUSED: ${g}`);
        return 3;
    }
    const { rings: needRings, altar: needAltar, droppers: needDroppers, bones: needBones, anvil: needAnvil, holder: needHolder, wine: needWine } = needs;
    const lastBones = lastS07Step(lab.chain);
    if (boneGivers.length && !needBones) console.log('[dress] --bone-givers unused: this slice does not run S07');
    if (wineGiver && !needWine) console.log('[dress] --wine-giver unused: this slice does not run S25c');
    if (cannonHolder && !needHolder) console.log('[dress] --cannon-holder unused: this slice does not run H23');
    if (anvil && !needAnvil) console.log('[dress] --anvil unused: this slice does not run S25a');
    if (droppers.length && !needDroppers) console.log('[dress] --droppers unused: this slice does not run S03');
    const ringNames = needRings ? ringers.slice(0, loads.length) : [];
    const altarNames = needAltar ? altarGivers : [];
    if (ringers.length && !needRings) console.log('[dress] --ringers unused: this slice does not run S04');
    if (altarGivers.length && !needAltar) console.log('[dress] --altar-givers unused: this slice does not run S06');
    console.log(`[dress] ${env.BOT_USERNAME}: ${lab.chain.length} steps${a.until ? ` to ${a.until}` : ''}; stand-ins ${lab.standIns.join(', ') || 'none'}; staff supply ${lab.staffed.join(', ') || 'none'}; stub rows ${lab.stubRows.map(r => r.row).join(', ') || 'none'}; cue-served ${lab.cueServed.join(', ') || 'none'}; ring givers ${ringNames.join(', ') || 'none'}; altar givers ${altarNames.join(', ') || 'none'}`);

    const log = TickLog.open(runId, a.log);
    prepareCueDir(cfg.cueDir, { fresh: from === undefined || boundary !== null });
    prepareCueDir(muleCueDir(cfg), { fresh: from === undefined || boundary !== null });
    let stub: ReturnType<typeof Bun.spawn> | null = null;
    const ringSessions: Session[] = [];
    let ringStop = false;
    let serving: Promise<unknown> | null = null;
    let altar: Subprocess | null = null;
    let altarStop: Promise<void> | null = null;
    let dropLauncher: Subprocess | null = null;
    let dropStop: Promise<void> | null = null;
    let anvilLauncher: Subprocess | null = null;
    let anvilStop: Promise<void> | null = null;
    let wineSession: Session | null = null;
    let wineServing: Promise<unknown> | null = null;
    let holderLauncher: Subprocess | null = null;
    let holderStop: Promise<void> | null = null;
    const stopHolder = (): Promise<void> => (holderStop ??= holderLauncher ? stopLauncher(holderLauncher).then(() => console.log('[dress] cannon holder stopped')) : Promise.resolve());
    const stopAnvil = (): Promise<void> => (anvilStop ??= anvilLauncher ? stopLauncher(anvilLauncher).then(() => console.log('[dress] anvil helper stopped')) : Promise.resolve());
    const stopDrop = (): Promise<void> => (dropStop ??= dropLauncher ? stopDroppers(dropLauncher).then(() => console.log('[dress] S03 droppers stopped')) : Promise.resolve());
    let boneLauncher: Subprocess | null = null;
    let boneStop: Promise<void> | null = null;
    const stopBones = (): Promise<void> => (boneStop ??= boneLauncher ? stopBoneGivers(boneLauncher).then(() => console.log('[dress] S07 bone givers stopped')) : Promise.resolve());
    const stopAltar = (): Promise<void> => (altarStop ??= altar ? stopAltarGivers(altar).then(() => console.log('[dress] altar givers stopped')) : Promise.resolve());
    const client = (a.client ?? 'browser') as 'browser' | 'lite';
    let secureBrowser: SecureLabSession | null = null;
    let session: Session | null = null;
    // The `(chunk end)` row the seam check reads (lab/seam-check.ts), written once the chain stops.
    let chunkEnd: ChunkEndWatch | null = null;
    let stopVitals: (() => void) | null = null;
    let code = 3;
    let term: Terminated | null = null;
    try {
        if (stubEnv && lab.stubRows.length) {
            const dir = mkdtempSync(join(tmpdir(), 'dress-stub-'));
            const planFile = join(dir, 'plan.json');
            writeFileSync(planFile, JSON.stringify({ rows: lab.stubRows } satisfies StubPlanFile));
            stub = Bun.spawn(['bun', join(ROOT, 'speedrun/lab/stub-giver.ts'), `--bot=${a.stub}`, `--scored=${env.BOT_USERNAME}`, `--plan=${planFile}`], { stdout: 'inherit', stderr: 'inherit', env: process.env });
        }
        if (needDroppers) {
            // Armed on their first tiles before SCORED logs in, so the go file the chain writes at S01 starts them.
            try {
                const r = await launchDroppers({ root: ROOT, droppers, tiles: cfg.firemakingTiles, cueDir: cfg.cueDir, server: env.SERVER || `localhost:${process.env.WEB_PORT ?? '9300'}`, agentPort: Number(process.env.AGENT_PORT ?? 8300) }, l => (dropLauncher = l));
                console.log(`[dress] S03 droppers armed after ${r.secs} s: ${droppers.join(', ')} (launcher files in ${r.base})`);
            } catch (e) {
                console.error(`[dress] REFUSED: S03's droppers: ${message(e)}`);
                return 3;
            }
        }
        if (needWine) {
            // Beside SCORED's booth stand with the notes before SCORED logs in; armed only when S25c starts.
            try {
                const w = await openSession(wineGiver!, { pathfinding: false });
                wineSession = w;
                await leaveTutorial(w);
                await stageWineGiver(w);
                console.log(`[dress] S25c wine giver ${w.name} staged beside the booth stand`);
            } catch (e) {
                console.error(`[dress] REFUSED: S25c's wine giver could not be staged: ${message(e)}`);
                return 3;
            }
        }
        if (needHolder) {
            // Loaded on the landing helper tile before SCORED logs in; it serves once the chain's {S27, cannon} cue names SCORED.
            try {
                const r = await launchCannonHolder({ root: ROOT, account: cannonHolder!, tile: LANDING_HELPER_TILE, cueDir: cfg.cueDir, server: env.SERVER || `localhost:${process.env.WEB_PORT ?? '9300'}`, agentPort: Number(process.env.AGENT_PORT ?? 8300) }, l => (holderLauncher = l));
                console.log(`[dress] H23 cannon holder ${cannonHolder} loaded on its tile after ${r.secs} s (launcher files in ${r.base})`);
            } catch (e) {
                console.error(`[dress] REFUSED: H23's cannon holder: ${message(e)}`);
                return 3;
            }
        }
        if (needAnvil) {
            // Serving (waiting for S25a's first plan) before SCORED logs in.
            try {
                const r = await launchAnvil({ root: ROOT, account: anvil!, cueDir: cfg.cueDir, server: env.SERVER || `localhost:${process.env.WEB_PORT ?? '9300'}`, agentPort: Number(process.env.AGENT_PORT ?? 8300) }, l => (anvilLauncher = l));
                console.log(`[dress] S25a anvil helper ${anvil} serving after ${r.secs} s (launcher files in ${r.base})`);
            } catch (e) {
                console.error(`[dress] REFUSED: S25a's anvil helper: ${message(e)}`);
                return 3;
            }
        }
        if (needRings) {
            // RING_CONTRACT's "staged during S03": each with its load, beside S04's tile, off the row's tiles.
            try {
                const tiles = giverTiles(ringNames.length, ringerTile(full), new Set(parseTiles(cfg.firemakingTiles).map(([x, z]) => `${x},${z}`)));
                for (const n of ringNames) ringSessions.push(await openSession(n, { pathfinding: false }));
                for (const [i, g] of ringSessions.entries()) {
                    await leaveTutorial(g);
                    await stageLoad(g, loads[i]!);
                    await mustTele(g.sdk, tiles[i]!.x, tiles[i]!.z);
                }
                console.log(`[dress] ring givers staged: ${ringSessions.map((g, i) => `${g.name}@${tiles[i]!.x},${tiles[i]!.z}`).join(' ')}`);
            } catch (e) {
                console.error(`[dress] REFUSED: S04's ring givers could not be staged: ${message(e)}`);
                return 3;
            }
        }
        if (needAltar) {
            // Logged in, loaded and in the room before SCORED (login order decides the 7-tick cycle).
            try {
                const base = mkdtempSync(join(tmpdir(), 'dress-altar-'));
                const botsDir = join(base, 'bots');
                writeLabBotEnvs(botsDir, altarNames, env.SERVER || `localhost:${process.env.WEB_PORT ?? '9300'}`);
                const config = altarGiverLaunch({ givers: altarNames, band: S06_BAND, botsDir, runDir: RUN_DIR, gatewayPort: Number(process.env.AGENT_PORT ?? 8300) + 5, path: 'direct' });
                const l = spawnAltarGivers({ root: ROOT, base, config, cueDir: cfg.cueDir });
                altar = l;
                const secs = await waitAltarGiversReady(l, { runDir: RUN_DIR, cueDir: cfg.cueDir, accounts: altarNames, timeoutMs: Math.max(240, 40 * altarNames.length) * 1000 });
                console.log(`[dress] altar givers ready in the room after ${secs} s (${S06_BAND.load} essence each; launcher files in ${base})`);
            } catch (e) {
                console.error(`[dress] REFUSED: S06's altar givers: ${message(e)}`);
                return 3;
            }
        }
        if (needBones) {
            // Logged in and loaded before SCORED (RUN-HOST.md "The S07 bone givers").
            try {
                const r = await launchBoneGivers({ root: ROOT, givers: boneGivers, cueDir: cfg.cueDir, server: env.SERVER || `localhost:${process.env.WEB_PORT ?? '9300'}`, agentPort: Number(process.env.AGENT_PORT ?? 8300) }, l => (boneLauncher = l));
                console.log(`[dress] S07 bone givers loaded after ${r.secs} s: ${boneGivers.join(', ')}, ${S07_LAB_LOADS} loads, the runes on ${boneGivers.at(-1)} (launcher files in ${r.base})`);
            } catch (e) {
                console.error(`[dress] REFUSED: S07's bone givers: ${message(e)}`);
                return 3;
            }
        }
        const anvilLast = lab.chain.findLast(s => s.id === 'S25a');
        const chain = lab.chain.map(s => {
            if (s.id === 'S04' && needRings) {
                return hooked(s, {
                    start: ctx => {
                        const scored = (ctx.sdk.getState() as BotWorldState | null)?.player?.name ?? env.BOT_USERNAME;
                        serving ??= serveLoads(ringSessions, scored, loads, () => ringStop, r => console.log(`[dress] ring load ${r.load} from ${r.giver}: ${r.ok ? `given in ${r.ticks} ticks` : `not given (${r.reason})`}`)).catch(e => console.error(`[dress] ring givers: ${message(e)}`));
                    },
                    done: () => (ringStop = true),
                });
            }
            if (s.id === 'S03' && needDroppers) return hooked(s, { done: () => void stopDrop() });
            if (s.id === 'S06' && needAltar) return hooked(s, { done: () => void stopAltar() });
            if (needBones && s === lastBones) return hooked(s, { done: () => void stopBones() });
            if (s === anvilLast && needAnvil) return hooked(s, { done: () => void stopAnvil() });
            if (s.id === 'H23' && needHolder) return hooked(s, { done: () => void stopHolder() });
            if (s.id === 'S25c' && needWine) {
                return hooked(s, {
                    start: ctx => {
                        const scored = (ctx.sdk.getState() as BotWorldState | null)?.player?.name ?? env.BOT_USERNAME;
                        wineServing ??= serveWine(wineSession!, scored, { log: (m, d) => console.log(`[dress] wine giver: ${m} ${JSON.stringify(d ?? {})}`), cueTimeoutMs: 30 * 60_000 })
                            .then(r => console.log(`[dress] wine giver: ${r.success ? `gave ${r.given} in ${r.ticks} ticks` : `not given (${r.message})`}`))
                            .catch(e => console.error(`[dress] wine giver: ${message(e)}`));
                    },
                });
            }
            return s;
        });
        // The same token proxy and in-page relog path as the run, never query-password login.
        if (client === 'browser') secureBrowser = await openSecureLabSession(a.bot);
        const s = secureBrowser?.session ?? await openSession(a.bot, { client, launch: true });
        session = s;
        gateway = (s.sdk as unknown as { config?: { gatewayUrl?: string } }).config?.gatewayUrl ?? gateway;
        const post = labRefusal(world());
        if (post) {
            console.error(`[dress] REFUSED: ${post}`);
            return 3;
        }
        if (boundary) {
            // S00's tutorial skip runs before any lab teleport (rs/196, rs/284).
            await leaveTutorial(s);
            const off = await applyBoundary(s.sdk as never, boundary, world(), async () => {
                const r = await relog(s);
                console.log(`[dress] stage ${chunk}: relogged for the quest tab (in at tick ${r.loginTick})`);
            });
            log.append(annotation(log, s.name, 'gate', `(stage) ${chunk}`, { meta: { from: boundary.firstId, levels: boundary.levels, quests: boundary.quests, qp: boundary.qp, ledgerAfter: boundary.ledgerAfter, inv: boundary.inv, worn: boundary.worn, tile: boundary.tile, unresolved: boundary.unresolved, off } }));
            if (off.length) {
                console.error(`[dress] REFUSED: staging ${chunk} came out different: ${off.join('; ')}`);
                return 3;
            }
        }
        const off = await waitUntil(s.sdk, st => st.inGame && st.autoRetaliateEnabled === false, { maxTicks: RETALIATE_OFF_TICKS });
        if (!off.ok) {
            console.error(`[dress] REFUSED: auto-retaliate still on ${RETALIATE_OFF_TICKS} ticks after login (autoRetaliateEnabled ${s.sdk.getState()?.autoRetaliateEnabled})`);
            return 3;
        }
        log.append(annotation(log, s.name, 'gate', '(gate) dress rehearsal', { meta: { until: a.until ?? null, from: a.from ?? null, standIns: lab.standIns, staffed: lab.staffed, stubRows: lab.stubRows, cueServed: lab.cueServed, ringGivers: ringNames, altarGivers: altarNames, droppers: needDroppers ? droppers : [], boneGivers: needBones ? boneGivers : [], host: process.env.HOSTNAME ?? null } }));
        if (a.vitals) {
            const path = a.vitals;
            const vitals = new VitalsRecorder();
            stopVitals = s.sdk.onStateUpdate(st => {
                const v = vitals.see(st as BotWorldState, s.sessionId);
                if (v) appendFileSync(path, JSON.stringify(v) + '\n');
            });
        }
        chunkEnd = watchChunkEnd(s, lab.chain, log);
        const ran = await runChainOnSession(s, { log, chain, reservation: new ReservationWatch(reservationPath(a['host-reservation']), { label: 'dress' }), cues: keeper, wholeRun: a.until === undefined, label: 'dress', tabMemory: { chunk: `${a.from ?? 'start'}..${a.until ?? 'end'}`, ...(secureBrowser?.chrome.browser.process()?.pid ? { chromePid: secureBrowser.chrome.browser.process()!.pid! } : {}) }, ...(from !== undefined ? { from } : {}) }).catch(e => {
            // A signal: SCORED is out; the helpers, Chrome and the proxy stop below, then the exit.
            if (!(e instanceof Terminated)) throw e;
            term = e;
            return null;
        });
        if (ran) {
            code = ran.result.code;
            console.log(`[dress] ${ran.result.outcome}`);
        } else {
            code = (term as unknown as Terminated).exitCode;
            console.log(`[dress] ${(term as unknown as Terminated).message}`);
        }
    } finally {
        try {
        stopVitals?.();
        chunkEnd?.close(code);
        stub?.kill();
        ringStop = true;
        if (serving) await Promise.race([serving, Bun.sleep(5_000)]);
        for (const g of ringSessions) await closeSession(g).catch(() => {});
        if (wineServing) await Promise.race([wineServing, Bun.sleep(5_000)]);
        if (wineSession) await closeSession(wineSession).catch(() => {});
        await stopAltar();
        await stopDrop();
        await stopBones();
        await stopAnvil();
        await stopHolder();
        } finally {
            if (secureBrowser) await secureBrowser.close();
            else if (session) await closeSession(session);
        }
    }
    const report = runReport(log.rows, lab.chain, runOrder);
    console.log('\n' + formatRunReport(report));
    console.log(`RESULT dress-rehearsal ${JSON.stringify({ code, ...report })}`);
    (term as Terminated | null)?.disarm();
    return code;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));

export { RUN_DIR };
