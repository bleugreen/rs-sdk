// S03's log-row droppers (speedrun/helpers/fm-row.ts, SUPPLIES.md H2, STEP-MANIFEST.md HS6) on the lab
// engine, launched the way the run machine launches them: the run-machine launcher (helpers/standalone.ts)
// from a checkout, one `fm-row` entry per dropper (HELPERS.md), each owning one of the route's 157 logs'
// six inventories (`parts`), on the run config's firemakingTiles (the tiles S03 lights, firemaking.ts
// resolveOptions), started by the go file the chain writes at S01 (runner/chain.ts dropperGoCue) and
// counting from the tick each sees it (`cueAt: 'seen'`, HS6's run-day rule). Every dropper is logged in,
// loaded and armed on its first tile before SCORED logs in, so the go file starts them all.
// lab/dress-rehearsal.ts (--droppers) launches through here; spawn, wait and stop are lab/helper-launch.ts's.
//
// The one lab difference from run day: restock by ::give (`cheat`), not `held`. standalone.ts starts the
// role at login, and a held dropper must log in already carrying its inventory. With one inventory per
// dropper, the only ::give is the one before it arms, so the row goes down as held droppers lay it.
//
// Its gateway is AGENT_PORT+6 (the altar givers' is +5), and its launcher.json lives in a run dir of its
// own, never run-machine/, where runecraft.ts reads the altar givers'.

import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { ACCOUNT_NAME_RE, FORBIDDEN_ACCOUNTS } from '../helpers/fleet-config';
import { INVENTORY, S03_TOTAL, type Row } from '../helpers/fm-row';
import type { ChainStep } from '../runner/chain';
import { STAND_IN_STEP } from '../runner/run-report';
import { parseTiles, type FiremakingOptions } from '../skills/firemaking';
import { writeLabBotEnvs } from './altar-launch';
import { roleLogEvents, spawnLauncher, stopLauncher, waitLauncherReady } from './helper-launch';

/** One dropper per inventory of the route's logs, as on run day (SUPPLIES.md H2: six droppers). */
export const DROPPERS = Math.ceil(S03_TOTAL / INVENTORY);

/** The droppers' loopback gateway, above lab.sh's AGENT_PORT (the altar givers' launcher takes +5). */
export const DROPPER_GATEWAY_OFFSET = 6;

/** The chain's go-cue step (runner/chain.ts dropperGoCue), at S01. */
export const GO_CUE_ID = 'S03 go cue';

type Steps = readonly (Pick<ChainStep, 'id'> & Partial<Pick<ChainStep, 'name'>>)[];

/** Whether `steps` runs S03 itself: a STAND-IN (a staff jump past it) needs no droppers. */
export function runsS03(steps: Steps): boolean {
    return steps.some(s => s.id === 'S03' && !(s.name ?? '').startsWith(STAND_IN_STEP));
}

/**
 * Why S03 cannot meet its droppers in `steps` ([] when it can, or when the slice does not run S03):
 * --droppers names one per inventory, cairn_ names standalone.ts logs in itself (not lab.sh's
 * LAB_HELPERS, and none of the other givers), and the slice also runs the S01 go cue that starts them.
 */
export function dropperGaps(steps: Steps, g: { droppers: readonly string[]; labHelpers?: readonly string[]; others?: readonly string[] }): string[] {
    if (!runsS03(steps)) return [];
    const out: string[] = [];
    if (!g.droppers.length) out.push(`S03 (Firemaking) has no log-row droppers: name ${DROPPERS}, one per inventory, with --droppers=<d1>,...,<d${DROPPERS}>, cairn_ names not on LAB_HELPERS (standalone.ts logs them in)`);
    else if (g.droppers.length !== DROPPERS) out.push(`S03: --droppers names ${g.droppers.length} dropper(s) for the route's ${DROPPERS} inventories (one each, as on run day)`);
    for (const [i, d] of g.droppers.entries()) {
        if (!ACCOUNT_NAME_RE.test(d) || FORBIDDEN_ACCOUNTS.has(d)) out.push(`S03: --droppers ${d} is not a cairn_ helper name standalone.ts launches`);
        if (g.labHelpers?.includes(d)) out.push(`S03: --droppers ${d} is on LAB_HELPERS, so lab.sh has it logged in already; standalone.ts logs the droppers in itself`);
        if (g.droppers.indexOf(d) !== i) out.push(`S03: --droppers names ${d} twice`);
        if (g.others?.includes(d)) out.push(`S03: ${d} is named by --droppers and by another giver flag`);
    }
    if (!steps.some(s => s.id === GO_CUE_ID)) out.push(`S03 runs but its droppers' go cue (written at S01) is not in this slice, so they would never start: run from S00`);
    return out;
}

/** A row path in fm-row's option form: the snake, or the tile list as [[x, z], ...]. */
export type DropperPath = { row: Row } | { tiles: ReadonlyArray<readonly [number, number]> };

/** ROLE_OPTIONS for a lab dropper started by the go file in `cueDir`, restocked by ::give (fm-row.md "Starting", "Options"). */
export function labCueDropperOptions(path: DropperPath, o: { cueDir: string; part?: number; parts?: number; lead?: number }): Record<string, unknown> {
    const where = 'row' in path ? { row: path.row } : { tiles: path.tiles.map(([x, z]) => [x, z]) };
    return {
        ...where,
        ...(o.parts !== undefined ? { part: o.part ?? 0, parts: o.parts } : {}),
        start: 'cue',
        cueDir: o.cueDir,
        restock: { kind: 'cheat' },
        ...(o.lead !== undefined ? { lead: o.lead } : {})
    };
}

export interface DropperLaunchEntry {
    account: string;
    role: 'fm-row';
    options: Record<string, unknown>;
}

/** standalone.ts's config file (its parseLaunchConfig input) for S03's droppers on `tiles` (the run config's firemakingTiles). */
export function dropperLaunch(o: { droppers: readonly string[]; tiles: FiremakingOptions['tiles']; cueDir: string; botsDir: string; runDir: string; gatewayPort: number }): { gatewayPort: number; botsDir: string; runDir: string; loginSpacingMs: number; accounts: DropperLaunchEntry[] } {
    const tiles = parseTiles(o.tiles);
    if (!tiles.length) throw new Error('the run config names no firemakingTiles for the droppers');
    const accounts = o.droppers.map((account, part): DropperLaunchEntry => ({ account, role: 'fm-row', options: labCueDropperOptions({ tiles }, { cueDir: o.cueDir, part, parts: o.droppers.length }) }));
    return { gatewayPort: o.gatewayPort, botsDir: o.botsDir, runDir: o.runDir, loginSpacingMs: 2000, accounts };
}

/** Whether the dropper's role log shows it armed (on its first tile, loaded, waiting on the go file): fm-row logs `phase` with `phase`, not `to`. */
export function dropperArmed(runDir: string, account: string): boolean {
    return roleLogEvents(runDir, account).some(e => e.message === 'phase' && e.phase === 'armed');
}

/**
 * Write fresh lab bot.envs, start standalone.ts on the droppers' config (`onSpawn` gets the launcher at
 * once, so the caller stops it whatever happens next) and wait until every dropper is logged in and armed.
 * Throws when the launcher exits first or the wait runs out.
 */
export async function launchDroppers(
    o: { root: string; droppers: readonly string[]; tiles: FiremakingOptions['tiles']; cueDir: string; server: string; agentPort: number; timeoutMs?: number },
    onSpawn: (launcher: Subprocess) => void
): Promise<{ secs: number; base: string }> {
    const base = mkdtempSync(join(tmpdir(), 'dress-droppers-'));
    const botsDir = join(base, 'bots');
    const runDir = join(base, 'run');
    mkdirSync(runDir, { recursive: true, mode: 0o700 });
    writeLabBotEnvs(botsDir, o.droppers, o.server);
    const config = dropperLaunch({ droppers: o.droppers, tiles: o.tiles, cueDir: o.cueDir, botsDir, runDir, gatewayPort: o.agentPort + DROPPER_GATEWAY_OFFSET });
    const launcher = spawnLauncher({ root: o.root, base, config, cueDir: o.cueDir });
    onSpawn(launcher);
    const timeoutMs = o.timeoutMs ?? Math.max(240, 40 * o.droppers.length) * 1000;
    const secs = await waitLauncherReady(launcher, { runDir, accounts: o.droppers, ready: a => dropperArmed(runDir, a), what: 'S03 droppers', timeoutMs });
    return { secs, base };
}

/** Stop the droppers' launcher (SIGINT: each role stops and its account logs out). */
export const stopDroppers = (launcher: Subprocess): Promise<void> => stopLauncher(launcher);
