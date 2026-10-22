// Lab acceptance for runner/legs.ts (STEP-MANIFEST.md entry 11): every leg run through the same
// path the scored run uses (runLeg over lib/travel.ts), from the earlier step's end tile with the
// step's route stats and items, against run-transitions.md's measured mean.
//
//   WEB_PORT=9780 WEB_MANAGEMENT_PORT=9781 HISCORES_WEB_PORT=9782 NODE_PORT=44780 AGENT_PORT=8780 \
//     NODE_TICKRATE=300 bash speedrun/lab/lab.sh <bot> 'speedrun/lab/measure-legs.ts:<ids|all|transports>[:runs[:nature|body]]'
//
// Setup is untimed (::setstat, ::setvar, ::give, ::tele; lab/setup.ts). The clock
// is TravelResult.ticks: from the first hop's send to the first published state inside the
// destination. One `RESULT leg {...}` line per run (segments, doors and their state, clicks, tiles,
// web tries, lowest hp), then `RESULT table` with each leg's mean against its expected figure.

import { runScript } from '../../sdk/runner';
import type { BotSDK } from '../../sdk/index';
import type { BotActions } from '../../sdk/actions';
import { legById, legsFor, runLeg, TILES, type LegStep, type S21Altar } from '../runner/legs';
import { APE_ATOLL_ROOFS, glide, hopNeeds, lumdoBoat, pullLever, sail, travel, type TravelResult, type TravelSdk } from '../lib/travel';
import { waitTicks, waitUntil } from '../lib/wait';
import { cheat, clearInventory, give, mustTele, setStats, setvar } from './setup';

const TELE_RUNES: [string, number][] = [['airrune', 100], ['waterrune', 100], ['earthrune', 100], ['firerune', 100], ['lawrune', 50]];
const result = (name: string, v: unknown) => console.log(`RESULT ${name} ${JSON.stringify(v)}`);

interface Setup {
    at: [number, number, number];
    stats: Record<string, number>;
    vars: Record<string, number>;
    items: [string, number][];
}

const ALL_STATS = ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'prayer', 'magic', 'agility'];

/** Untimed: empty inventory and worn slots, route stats (unlisted ones 1, hitpoints 10), varps, items, then the start tile. */
async function setup(sdk: BotSDK, s: Setup): Promise<void> {
    await clearInventory(sdk);
    await setStats(sdk, Object.fromEntries(ALL_STATS.map(k => [k, s.stats[k] ?? (k === 'hitpoints' ? 10 : 1)])));
    for (const [k, v] of Object.entries(s.vars)) await setvar(sdk, k, v);
    for (const [name, n] of s.items) await give(sdk, name, n);
    await mustTele(sdk, s.at[0], s.at[1], s.at[2]);
    if (sdk.getState()?.dialog.isOpen) await sdk.sendClickDialog(0);
    await waitTicks(sdk, 2);
}

const ISLAND = (s: ReturnType<BotSDK['getState']>) => !!s?.player && s.player.worldX > 3040 && s.player.worldX < 3160 && s.player.worldZ > 3040 && s.player.worldZ < 3140;

/** A bot fresh from create-bot.ts is on Tutorial Island without side tabs; the SDK's skip fixes both. */
async function ensureOffIsland(sdk: BotSDK, bot: BotActions): Promise<void> {
    if (!ISLAND(sdk.getState())) return;
    await bot.skipTutorial();
    await waitUntil(sdk, s => !ISLAND(s), { maxTicks: 40 });
}

// Route stats and quest varps at each point of the order (run-transitions-legs.ts, quests/README.md section 4).
const EARLY7 = { magic: 7 };
const EARLY59 = { magic: 59 };
const MID = { magic: 64, hitpoints: 20, prayer: 43, agility: 25 };
const WILD1 = { attack: 99, hitpoints: 42, magic: 73, prayer: 43, agility: 25 };
const MA = { attack: 99, hitpoints: 45, magic: 81, prayer: 43, ranged: 57, agility: 75 };
const LATE = { attack: 99, hitpoints: 60, magic: 99, prayer: 43, ranged: 57, agility: 99 };
const FINAL = { attack: 99, strength: 99, defence: 99, hitpoints: 99, ranged: 99, magic: 99, prayer: 43, agility: 75 };
const VARS = { elenaquest: 30, treequest: 9, grandtree: 160, magearena: 8 };

const STATS: Record<string, Record<string, number>> = {
    'T01-02': EARLY7, 'T02-03': EARLY7,
    'T04-05': EARLY59, 'T05-06': EARLY59, 'T06-07': EARLY59, 'T07a': EARLY59, 'T07-08': EARLY59,
    'T08-09': MID, 'T09-10': MID, 'T10-11': MID, 'T11a': MID, 'T11-12': MID, 'T12-13': MID,
    'T13-14': WILD1, 'T14-15': WILD1, 'T15-16': MA, 'T16-18': MA,
    'T26-27': FINAL, 'T27-17': FINAL,
};
const TALISMANS: Record<string, string> = { 'T05-06': 'air_talisman' };
const S21_TALISMAN: Record<S21Altar, string> = { nature: 'nature_talisman', body: 'body_talisman' };

/** The step's real inventory for this leg: what its hops consume, food where it is asked for, nothing else. */
export function legSetup(l: LegStep): Setup {
    const d = l.def;
    const need = hopNeeds(d.hops);
    const items: [string, number][] = [];
    if (need.magic) items.push(...TELE_RUNES);
    if (d.food) items.push(['shark', 6]);
    if (need.knife) items.push(['knife', 1]);
    if (need.coins) items.push(['coins', 100]);
    const t = d.id === 'T20-21' ? S21_TALISMAN[d.dest === TILES.bodyAltar ? 'body' : 'nature'] : TALISMANS[d.id];
    if (t) items.push([t, 1]);
    return { at: [d.start.x, d.start.z, d.start.level ?? 0], stats: STATS[d.id] ?? LATE, vars: VARS, items };
}

/**
 * The transports no leg rides but rs/185's quests do (`transports`): each from a staff teleport
 * to its stop with the quest state it needs. `chain` cases start where the case before ended.
 */
const TRANSPORTS: Array<{ id: string; setup?: Setup; go: (sdk: TravelSdk, bot: BotActions) => Promise<TravelResult>; reference?: string }> = [
    { id: 'glide ta_quir_priw -> gandius', setup: { at: [2465, 3501, 3], stats: LATE, vars: { grandtree: 160 }, items: [] }, go: s => glide(s, 'gandius') },
    { id: 'glide gandius -> ta_quir_priw', go: s => glide(s, 'ta_quir_priw') },
    { id: 'glide ta_quir_priw -> kar_hewo', go: s => glide(s, 'kar_hewo') },
    { id: 'lumdo crash_island -> ape_atoll', setup: { at: [2894, 2726, 0], stats: FINAL, vars: { mm_main: 4, mm_lumdo: 3 }, items: [] }, go: s => lumdoBoat(s, 'ape_atoll') },
    { id: 'lumdo ape_atoll -> crash_island', go: s => lumdoBoat(s, 'crash_island') },
    { id: 'APE_ATOLL_ROOFS', setup: { at: [2749, 2768, 0], stats: FINAL, vars: { mm_main: 4 }, items: [] }, go: (s, bot) => travel(s, APE_ATOLL_ROOFS, { bot }), reference: 'rs/201 ROOFS: 112 ticks with bot.walkTo' },
    { id: 'keep lever out', setup: { at: [3154, 3926, 0], stats: FINAL, vars: {}, items: [] }, go: s => pullLever(s, 'keep') },
    { id: 'ship to karamja', setup: { at: [3028, 3217, 0], stats: LATE, vars: {}, items: [['coins', 100]] }, go: s => sail(s, 'karamja') },
];

async function transports(sdk: BotSDK, bot: BotActions): Promise<void> {
    for (const t of TRANSPORTS) {
        try {
            if (t.setup) await setup(sdk, t.setup);
            const r = await t.go(sdk as unknown as TravelSdk, bot);
            result('transport', { id: t.id, ok: r.ok, ticks: r.ticks, segments: r.segments, doors: r.doors, clicks: r.clicks, at: r.at, ...(r.reason ? { reason: r.reason } : {}), ...(t.reference ? { reference: t.reference } : {}) });
            console.log(`TRANSPORT ${t.id.padEnd(34)} ${r.ok ? 'ok' : 'FAILED'} ${r.ticks} ticks${r.reason ? ` (${r.reason})` : ''} ${r.segments.map(s => `${s.hop} ${s.ticks}`).join(', ')}`);
        } catch (e) {
            console.log(`TRANSPORT ${t.id.padEnd(34)} ERROR ${e instanceof Error ? e.message : String(e)}`);
        }
        await cheat(sdk, 'setstat hitpoints 99');
    }
}

// `<ids|all|transports>[:runs[:nature|body]]`: the S21 altar picks T20-21 and T21-22 (default nature, section 2).
const [, , , which = 'all', runsArg, altarArg] = process.argv;
const catalogue = legsFor({ s21Altar: altarArg === 'body' ? 'body' : 'nature' });
const legs = which === 'all' ? catalogue : which === 'transports' ? [] : which.split(',').map(id => legById(id, catalogue));
const runs = Number(runsArg ?? 2);

await runScript(async ({ bot, sdk }) => {
    await ensureOffIsland(sdk, bot);
    await setup(sdk, { at: [3222, 3218, 0], stats: {}, vars: {}, items: [] }); // warm-up: the first counted leg does not start on a just-loaded login
    await waitTicks(sdk, 5);
    if (which === 'transports') return transports(sdk, bot);
    const table: Array<{ id: string; label: string; expected: number; runs: number[]; mean: number | null; deltaPct: number | null; failures: string[] }> = [];
    for (const l of legs) {
        const d = l.def;
        const row = { id: d.id, label: d.expected.label, expected: d.expected.ticks, runs: [] as number[], mean: null as number | null, deltaPct: null as number | null, failures: [] as string[] };
        for (let r = 0; r < runs; r++) {
            try {
                await setup(sdk, legSetup(l));
                const pre = l.preconditions(sdk.getState()!, undefined);
                if (pre !== true) throw new Error(`precondition: ${pre}`);
                const out = await runLeg(d, { sdk, bot });
                if (!out) throw new Error('already arrived at the start');
                const post = l.postconditions(sdk.getState()!, undefined);
                if (post !== true) throw new Error(`postcondition: ${post}`);
                row.runs.push(out.ticks);
                result('leg', { id: d.id, run: r, ok: true, ticks: out.ticks, expected: d.expected.ticks, segments: out.segments, doors: out.doors, clicks: out.clicks, tiles: out.tiles, webTries: out.webTries, ate: out.ate, hpMin: out.hpMin, ...(out.fellBack ? { fellBack: out.fellBack } : {}), at: out.at });
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                row.failures.push(msg);
                result('leg', { id: d.id, run: r, ok: false, error: msg, at: sdk.getState()?.player ? { x: sdk.getState()!.player!.worldX, z: sdk.getState()!.player!.worldZ, level: sdk.getState()!.player!.level } : null });
                if (sdk.getState()?.player?.hp === 0) await waitTicks(sdk, 10);
            }
            await cheat(sdk, 'setstat hitpoints 99');
        }
        if (row.runs.length) {
            row.mean = Math.round((row.runs.reduce((a, b) => a + b, 0) / row.runs.length) * 10) / 10;
            row.deltaPct = Math.round(((row.mean - row.expected) / row.expected) * 1000) / 10;
        }
        table.push(row);
        console.log(`LEG ${d.id.padEnd(7)} ${String(row.mean ?? '-').padStart(6)} vs ${String(row.expected).padStart(6)} (${d.expected.label}) ${row.deltaPct === null ? 'FAILED' : `${row.deltaPct > 0 ? '+' : ''}${row.deltaPct}%`} runs ${row.runs.join(',')}${row.failures.length ? ` failures: ${row.failures.join(' | ')}` : ''}`);
    }
    result('table', table);
}, { timeout: 4 * 3600_000, printState: false });
