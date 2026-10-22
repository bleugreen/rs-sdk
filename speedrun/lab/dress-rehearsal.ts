#!/usr/bin/env bun
// The lab dress rehearsal of the scored run (cairn://p/rs/393, acceptance (b)/(c)): run.ts's chain on
// a fresh lab account, on the lab engine only, with:
// - each missing step group (a module not on main, with the legs inside the group) swapped for its
//   lab stand-in (lab/stand-ins.ts), a `STAND-IN` row the report counts apart: the run is partial;
// - the placed hand-offs traded with lab/stub-giver.ts (a lab account on the real protocol), when
//   --stub names one; otherwise, and for the cannon rows until the one cannon receiver lands,
//   supplied at the boundary by staff commands and logged `supply: staff` (also partial);
// - the modules' own helpers (ring givers, fm-row droppers, bone giver, courier, anvil, wine giver,
//   altar givers) started by the operator in their lab modes, named in the lab run config.
//
//   LOCAL_STAFF_LEVEL=4 bun speedrun/lab/dress-rehearsal.ts --bot=<fresh lab account env> --config=<lab run config>
//       [--until=<id>] [--from=<id>] [--stub=<stub giver env>] [--client=browser|lite] [--log=<file>]
//
// Hosts (main's ruling): bgsrv-mac only while bgsrv-ub is down, never local or fedora, from a
// scratch tree pinned to one commit, under `timeout --kill-after=30s <bound>`. The account is a fresh
// lab name (S00's tutorial skip runs first), never SCORED nor a fleet account. Nothing here checks
// the run-commit floor or the host reservation's ownership: those gates are the scored run's
// (speedrun/run.ts), and this driver never runs off a lab (stand-ins.ts labRefusal, checked first).
//
// Exit: 0 the slice ran (partial or not, the report says which), 1 a step failed, 3 refused.

import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { canonName, cueDir as defaultCueDir, RUN_DIR } from '../helpers/altar-cue';
import { FORBIDDEN_ACCOUNTS } from '../helpers/fleet-config';
import { annotation } from '../lib/attempt';
import { ReservationWatch, reservationPath } from '../lib/host-reservation';
import { closeSession, loadBotEnv, openSession, ROOT } from '../lib/session';
import { newRunId, TickLog } from '../lib/ticks';
import { loadRunConfig, runChainOnSession } from '../run';
import { buildChain, CANNON_ROWS, KIT_PARTNER_ROWS, noteRow, PLACEMENT, sliceUntil, resolveFrom, type ChainStep, type RunConfig } from '../runner/chain';
import { CueKeeper, prepareCueDir } from '../runner/cue-keeper';
import { applyEquip, handOffFrom, type HandOffSdk } from '../runner/handoff';
import type { LegStep } from '../runner/legs';
import { TILES } from '../runner/legs';
import { formatRunReport, runReport, STAFF_SUPPLY_STEP } from '../runner/run-report';
import type { StepContext } from '../runner/step';
import { MANIFEST } from '../tools/slot-ledger';
import { launchLabBrowser } from './browser';
import { dropMatching, give } from './setup';
import { labRefusal, standInFor, standInStep, type LabWorld } from './stand-ins';
import { stageRows, type StubPlanFile, type StubRow } from './stub-giver';

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

/** A placed row the lab supplies with staff commands: the row's `in` given, its `out` dropped, its equip applied. */
export function staffSupplyStep(step: ChainStep, manifest: string): ChainStep {
    const row = step.name.replace(/ hand-off.*$/, '');
    const plan = handOffFrom(manifest, row);
    const { rows, unresolved } = stageRows(manifest, { rows: [{ row, tile: { x: 0, z: 0 } }] });
    if (unresolved.length) throw new Error(`staff supply ${row}: no ::give name for ${unresolved.join(', ')}`);
    const run = async (ctx: StepContext<unknown>) => {
        const sdk = ctx.sdk as unknown as HandOffSdk & Parameters<typeof dropMatching>[0];
        if (plan.give.length) await dropMatching(sdk, plan.give.map(g => (g.ids ? g.ids[0]! : g.pattern)));
        for (const st of rows[0]!.stage) await give(sdk, st.obj, st.n);
        await applyEquip(sdk, plan);
        noteRow(ctx, `${STAFF_SUPPLY_STEP} ${row}`, { row, gave: rows[0]!.stage, dropped: plan.give.map(g => g.name) });
    };
    return { id: step.id, kind: 'handoff', name: `${row} hand-off (${STAFF_SUPPLY_STEP})`, logoutSafe: true, preconditions: () => true, postconditions: () => true, run, resume: run };
}

export interface LabChain {
    chain: ChainStep[];
    /** Rows the stub giver serves, with their meeting tiles, in run order. */
    stubRows: StubRow[];
    standIns: string[];
    staffed: string[];
}

/** run.ts's chain as the lab runs it: stand-ins for the missing groups, staff supply for unserved rows. */
export function labChain(chain: readonly ChainStep[], o: { manifest: string; stub: string | null; world: () => LabWorld }): LabChain {
    const out: ChainStep[] = [];
    const stubRows: StubRow[] = [];
    const standIns: string[] = [];
    const staffed: string[] = [];
    for (let i = 0; i < chain.length; i++) {
        const s = chain[i]!;
        if (s.kind === 'missing') {
            const si = standInFor(s.id);
            if (!si) throw new Error(`${s.id} (${s.name}) is missing and has no lab stand-in`);
            let last = i;
            for (let j = i + 1; j < chain.length; j++) if (chain[j]!.id === s.id) last = j;
            out.push(standInStep(si, o.world));
            standIns.push(s.id);
            i = last;
            continue;
        }
        if (s.kind === 'handoff') {
            const row = s.name.replace(/ hand-off.*$/, '');
            if (CANNON_ROWS[row] || !o.stub) {
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
    return { chain: out, stubRows, standIns, staffed };
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

async function main(argv: string[]): Promise<number> {
    const a = args(argv);
    if (!a.bot || !a.config) {
        console.error('usage: LOCAL_STAFF_LEVEL=4 bun speedrun/lab/dress-rehearsal.ts --bot=<fresh lab account env> --config=<lab run config> [--until=<id>] [--from=<id>] [--stub=<stub giver env>] [--client=browser|lite] [--log=<file>]');
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
    const manifest = readFileSync(MANIFEST, 'utf8');
    // Every placed row's partner: the stub giver when there is one, else STAFF.
    const partners: Record<string, string> = { ...raw.partners };
    for (const row of Object.keys(PLACEMENT)) partners[row] ??= stubEnv?.BOT_USERNAME ?? STAFF;
    // The quest kit rows are the modules' own trades: a slice that reaches one needs its giver named.
    for (const row of KIT_PARTNER_ROWS) partners[row] ??= STAFF;
    const cfg: RunConfig = { ...raw, partners };
    if (cfg.cueDir !== defaultCueDir()) throw new Error(`cue dir ${cfg.cueDir} is not the writers' (${defaultCueDir()})`);
    const keeper = new CueKeeper(cfg.cueDir, env.BOT_USERNAME);
    const sliced = sliceUntil(buildChain(cfg, { cues: keeper, manifest }), a.until);
    const lab = labChain(sliced, { manifest, stub: stubEnv?.BOT_USERNAME ?? null, world });
    const from = resolveFrom(lab.chain, a.from);
    console.log(`[dress] ${env.BOT_USERNAME}: ${lab.chain.length} steps${a.until ? ` to ${a.until}` : ''}; stand-ins ${lab.standIns.join(', ') || 'none'}; staff supply ${lab.staffed.join(', ') || 'none'}; stub rows ${lab.stubRows.map(r => r.row).join(', ') || 'none'}`);

    const log = TickLog.open(`dress-${newRunId()}`, a.log);
    prepareCueDir(cfg.cueDir, { fresh: from === undefined });
    let stub: ReturnType<typeof Bun.spawn> | null = null;
    if (stubEnv && lab.stubRows.length) {
        const dir = mkdtempSync(join(tmpdir(), 'dress-stub-'));
        const planFile = join(dir, 'plan.json');
        writeFileSync(planFile, JSON.stringify({ rows: lab.stubRows } satisfies StubPlanFile));
        stub = Bun.spawn(['bun', join(ROOT, 'speedrun/lab/stub-giver.ts'), `--bot=${a.stub}`, `--scored=${env.BOT_USERNAME}`, `--plan=${planFile}`], { stdout: 'inherit', stderr: 'inherit', env: process.env });
    }
    const client = (a.client ?? 'browser') as 'browser' | 'lite';
    // Lab browsers only through launchLabBrowser (LAB.md, 'Lab and demo browsers').
    const chrome = client === 'browser' ? await launchLabBrowser(a.bot) : null;
    const session = await openSession(a.bot, { client, launch: true, ...(client === 'browser' ? { insecureQueryLogin: true } : {}) });
    gateway = (session.sdk as unknown as { config?: { gatewayUrl?: string } }).config?.gatewayUrl ?? gateway;
    const post = labRefusal(world());
    let code = 3;
    try {
        if (post) {
            console.error(`[dress] REFUSED: ${post}`);
            return 3;
        }
        log.append(annotation(log, session.name, 'gate', '(gate) dress rehearsal', { meta: { until: a.until ?? null, standIns: lab.standIns, staffed: lab.staffed, stubRows: lab.stubRows, host: process.env.HOSTNAME ?? null } }));
        const { result } = await runChainOnSession(session, { log, chain: lab.chain, reservation: new ReservationWatch(reservationPath(a['host-reservation']), { label: 'dress' }), cues: keeper, label: 'dress', ...(from !== undefined ? { from } : {}) });
        code = result.code;
        console.log(`[dress] ${result.outcome}`);
    } finally {
        stub?.kill();
        await closeSession(session);
        await chrome?.kill();
    }
    const report = runReport(log.rows, lab.chain, readFileSync(join(ROOT, 'docs/speedrun/RUN-ORDER.md'), 'utf8'));
    console.log('\n' + formatRunReport(report));
    console.log(`RESULT dress-rehearsal ${JSON.stringify({ code, ...report })}`);
    return code;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));

export { RUN_DIR };
