// Monkey Madness hangar puzzle on the lab engine: solve fresh 255-step
// scrambles with lib/puzzle.ts at 1, 2 and 5 clicks a tick, and time the
// hangar cutscene from the solve to the powered hangar. Also prints the raw
// journal lines once, to show whether colour tags are published.
//
//   speedrun/lab/lab.sh <bot> speedrun/lab/measure-mm-puzzle.ts:--runs=3:--rates=1,2,5

import { solveOnPanel } from '../lib/puzzle';
import { readQuestStage } from '../lib/quests';
import { openSession } from '../lib/session';
import { waitTicks, waitUntil } from '../lib/wait';
import { PUZZLE_COMPONENT, PUZZLE_TILE_IDS } from '../quests/monkey-madness';
import { arg, botArg, result } from './common';
import { cheat, near, tele } from './setup';

const runs = Number(arg('runs', '3'));
const rates = arg('rates', '1,2,5').split(',').map(Number);
const session = await openSession(botArg());
const { sdk } = session;

const HANGAR = { x: 2393, z: 9892 };
const POWERED = { x: 2649, z: 4507 };

async function setvar(name: string, value: number) {
    await cheat(sdk, `setvar ${name} ${value}`);
    await waitTicks(sdk, 1);
}

async function fixture() {
    if (sdk.getState()?.modalOpen) await sdk.sendCloseModal();
    for (const [k, v] of [['treequest', 9], ['grandtree', 160], ['mm_main', 2], ['mm_narnode', 7], ['mm_caranock', 3], ['mm_daero', 5], ['mm_hangar_puzzle_complete', 0], ['mm_hangar_cutscene_flag', 0]] as const) await setvar(k, v);
    // The board persists until it has more than one empty slot (mm_puzzle.rs2 mm_open_puzzle): clear it for a fresh scramble.
    await cheat(sdk, '~clearinv reinitialisation_inv');
    await waitTicks(sdk, 1);
    if (!(await tele(sdk, HANGAR.x, HANGAR.z))) throw new Error('tele to the hangar failed');
}

async function openPanel(): Promise<number> {
    const s = sdk.getState()!;
    const panel = [...s.nearbyLocs, ...(await sdk.scanNearbyLocs(20))].find(l => /reinitialisation panel/i.test(l.name));
    if (!panel) throw new Error(`no Reinitialisation Panel near ${s.player?.worldX},${s.player?.worldZ}`);
    const op = panel.optionsWithIndex.find(o => /operate/i.test(o.text))?.opIndex ?? 1;
    const t0 = s.tick;
    for (let attempt = 0; attempt < 3; attempt++) {
        await sdk.sendInteractLoc(panel.x, panel.z, panel.id, op);
        const r = await waitUntil(sdk, st => st.interface.inventories?.some(i => i.componentId === PUZZLE_COMPONENT), { maxTicks: 20 });
        if (r.ok) return r.tick - t0;
    }
    throw new Error('the panel did not open');
}

// Journal tags, once.
await fixture();
await waitTicks(sdk, 3);
try {
    const j = await readQuestStage(sdk, 'mm', { force: true });
    result('mm_journal_raw', { lines: j.journal?.lines ?? null });
} catch (e) {
    const s = sdk.getState()!;
    result('mm_journal_raw', { error: String(e), mmStatus: s.quests?.mm ?? null, questCount: Object.keys(s.quests ?? {}).length, modalOpen: s.modalOpen, at: [s.player?.worldX, s.player?.worldZ] });
}

for (const perTick of rates) {
    for (let run = 0; run < runs; run++) {
        await fixture();
        const openTicks = await openPanel();
        const r = await solveOnPanel(sdk, { componentId: PUZZLE_COMPONENT, tileIds: PUZZLE_TILE_IDS, perTick });
        const solvedAt = sdk.getState()!.tick;
        const arrived = await waitUntil(sdk, s => near(s, POWERED.x, POWERED.z, 4), { maxTicks: 60 });
        result('mm_puzzle', { perTick, run, openTicks, ...r, cutsceneTicks: arrived.ok ? arrived.tick - solvedAt : null });
    }
}
process.exit(0);
