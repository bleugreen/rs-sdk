// Lab acceptance for runner/legs.ts (STEP-MANIFEST.md entry 11): every leg run through the same
// path the scored run uses (runLeg over lib/travel.ts), from the earlier step's end tile with the
// step's route stats and items, against run-transitions.md's measured mean.
//
//   WEB_PORT=9780 WEB_MANAGEMENT_PORT=9781 HISCORES_WEB_PORT=9782 NODE_PORT=44780 AGENT_PORT=8780 \
//     NODE_TICKRATE=300 bash speedrun/lab/lab.sh <bot> 'speedrun/lab/measure-legs.ts:<ids|all|transports>[:runs[:nature|body]][:--client=browser]'
//
// --client=browser (lab.sh with LAB_RUNNERS=0): the bot plays in a headless Chrome tab on the lab's
// /bot page, the run's client (main's standard for clicks right after a landing); the default is
// the lite runner lab.sh starts. Chrome's DevTools port is WEB_PORT+5. The page is this checkout's
// bundle: `bun run build` in server/webclient first (a fresh checkout has none, and the tab then
// never reaches the game).
//
// --landing-wait=N (diagnostic, not the run's path): the leg's first hop, N ticks, then the rest.
//
// --drops=without|with|pair (the leg-row drops, runner/legs.ts `drops`): `without` carries exactly the
// runes the hops spend and nothing the leg drops; `with` adds the ledger's drop outs (LEDGER_DROPS);
// `pair` runs both on each run, without first. The leg's clock (travel's) includes the burst, so
// with minus without is the burst's cost; each `RESULT leg` also carries the burst rows (LegDrops).
//
// Setup is untimed (::setstat, ::setvar, ::give, ::tele; lab/setup.ts; a fresh account leaves
// Tutorial Island through setup.ts leaveTutorial first). The clock is TravelResult.ticks: from the
// first hop's send to the first published state inside the destination. One `RESULT leg {...}`
// line per run (segments, doors and their state, clicks, tiles, web tries, lowest hp), one
// `RESULT hops {...}` line with the per-hop timeline (lab/leg-trace.ts: clicks, the first click
// after the hop before, click to first step, idle ticks, first dialogue page, repeated clicks), then
// `RESULT table` with each leg's mean against its expected figure.

import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import type { BotActions } from '../../sdk/actions';
import { dropsDue, legById, legsFor, runLeg, TILES, type LegDrops, type LegStep, type S21Altar } from '../runner/legs';
import { APE_ATOLL_ROOFS, glide, hopNeeds, lumdoBoat, pullLever, sail, travel, type TravelResult, type TravelSdk } from '../lib/travel';
import { closeSession, logoutClean, openSession, type ClientKind } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { waitTicks, waitUntil } from '../lib/wait';
import { launchLabBrowser, type LabBrowser } from './browser';
import { hopLine, hopRows, startTrace } from './leg-trace';
import { cheat, clearInventory, give, leaveTutorial, mustTele, setStats, setvar } from './setup';

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
    // The browser client lists no locs until the ::tele's region has loaded; the leg starts from a
    // loaded start tile, as it does after the step before it.
    await waitUntil(sdk, st => st.nearbyLocs.length > 0, { maxTicks: 20 });
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

/**
 * Each drop leg's STEP-MANIFEST ledger drop outs (the `drop` reason on its row) as debug names, at
 * run-day counts where the ledger says `all`. A stack is one drop action whatever its count, so the
 * slots, not the counts, are what the burst costs. T20-21 and T21-22 are the body altar's legs.
 */
export const LEDGER_DROPS: Readonly<Record<string, readonly [string, number][]>> = {
    'T01-02': [['bronze_axe', 1], ['net', 1], ['shrimp', 1], ['bucket_empty', 1], ['pot_empty', 1], ['bread', 1], ['bronze_pickaxe', 1], ['bronze_dagger', 1], ['bronze_sword', 1], ['wooden_shield', 1], ['shortbow', 1], ['bronze_arrow', 25], ['bodyrune', 2], ['waterrune', 6]],
    'T04-05': [['tinderbox', 1], ['earthrune', 4]],
    'T06-07': [['airrune', 594]],
    'T11-12': [['4dose1agility', 1], ['grandtree_translationbook', 1], ['grandtree_scroll', 1], ['grandtree_journal', 1], ['grandtree_order', 1], ['grandtree_gloughskey', 1]],
    'T20-21': [['lawrune', 2], ['airrune', 40], ['waterrune', 3], ['fishing_rod', 1]],
    'T21-22': [['bodyrune', 300]],
    'T22-23': [['fly_fishing_rod', 1], ['logs', 1], ['feather', 300], ['knife', 1]],
    'T26-27': [['hammer', 1]],
};

export type DropsMode = 'without' | 'with';

/** The step's real inventory for this leg: what its hops consume, food where it is asked for, nothing else; `drops`: see --drops. */
export function legSetup(l: LegStep, drops?: DropsMode): Setup {
    const d = l.def;
    const need = hopNeeds(d.hops);
    const items: [string, number][] = [];
    // TELE_RUNES' surplus would itself be dropped on a leg whose drops name that rune.
    if (drops) items.push(...Object.entries(need.runes).filter(([, n]) => (n ?? 0) > 0).map(([r, n]) => [`${r}rune`, n!] as [string, number]));
    else if (need.magic) items.push(...TELE_RUNES);
    if (d.food) items.push(['shark', 6]);
    if (need.knife) items.push(['knife', 1]);
    if (need.coins) items.push(['coins', 100]);
    const t = d.id === 'T20-21' ? S21_TALISMAN[d.dest === TILES.bodyAltar ? 'body' : 'nature'] : TALISMANS[d.id];
    if (t) items.push([t, 1]);
    if (drops === 'with') {
        const ledger = LEDGER_DROPS[d.id];
        if (!ledger) throw new Error(`--drops=with: ${d.id} has no ledger drops (the drop legs: ${Object.keys(LEDGER_DROPS).join(', ')})`);
        items.push(...ledger);
    }
    return { at: [d.start.x, d.start.z, d.start.level ?? 0], stats: STATS[d.id] ?? LATE, vars: VARS, items };
}

/** The held items the leg drops somewhere along it (before any hop, or on arrival). */
function droppable(l: LegStep, s: BotWorldState): string[] {
    const seen = new Map<number, string>();
    for (let at = 0; at <= l.def.hops.length; at++) for (const i of dropsDue(l.def, s, at)) seen.set(i.slot, i.name);
    return [...seen.values()];
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
// Flags (`--client=lite|browser`) may sit anywhere after the bot.
const botName = process.argv[2];
if (!botName) throw new Error('usage: measure-legs.ts <bot> <ids|all|transports>[:runs[:nature|body]][:--client=browser]');
const rest = process.argv.slice(3);
const [which = 'all', runsArg, altarArg] = rest.filter(a => !a.startsWith('--'));
const client = (rest.find(a => a.startsWith('--client='))?.slice('--client='.length) ?? 'lite') as ClientKind;
if (client !== 'lite' && client !== 'browser') throw new Error('--client must be lite or browser');
const catalogue = legsFor({ s21Altar: altarArg === 'body' ? 'body' : 'nature' });
const legs = which === 'all' ? catalogue : which === 'transports' ? [] : which.split(',').map(id => legById(id, catalogue));
const runs = Number(runsArg ?? 2);
// Diagnostic, not the run's path: --landing-wait=N runs a leg's first hop, waits N ticks, then the
// rest, to show whether a click right after the landing is what costs a client ticks.
const landingWaitArg = rest.find(a => a.startsWith('--landing-wait='))?.slice('--landing-wait='.length);
const landingWait = landingWaitArg === undefined ? null : Number(landingWaitArg);
const dropsArg = rest.find(a => a.startsWith('--drops='))?.slice('--drops='.length);
if (dropsArg !== undefined && dropsArg !== 'with' && dropsArg !== 'without' && dropsArg !== 'pair') throw new Error('--drops must be with, without or pair');
if (dropsArg !== undefined && landingWait !== null) throw new Error('--drops and --landing-wait do not combine');
/** The setups each run measures, in order. */
const modes: (DropsMode | undefined)[] = dropsArg === 'pair' ? ['without', 'with'] : [dropsArg as DropsMode | undefined];

/** The leg as runLeg runs it, but with `wait` ticks between its first hop and the rest; the clock includes the wait. */
async function runLegSplit(l: LegStep, sdk: BotSDK, bot: BotActions, wait: number): Promise<TravelResult> {
    const tsdk = sdk as unknown as TravelSdk;
    const eat = l.def.food ? { eat: {} } : {};
    const first = await travel(tsdk, l.def.hops.slice(0, 1), { bot, ...eat });
    if (!first.ok) throw new Error(`${l.def.id}: ${first.reason ?? 'first hop failed'}`);
    await waitTicks(sdk, wait);
    const restR = await travel(tsdk, l.def.hops, { bot, from: 1, ...eat });
    if (!restR.ok) throw new Error(`${l.def.id}: ${restR.reason ?? 'travel failed'}`);
    return {
        ...restR,
        startTick: first.startTick,
        ticks: restR.endTick - first.startTick,
        segments: [...first.segments, { hop: `wait ${wait}`, ok: true, startTick: first.endTick, ticks: restR.startTick - first.endTick }, ...restR.segments],
        clicks: first.clicks + restR.clicks,
        tiles: first.tiles + restR.tiles,
        doors: [...first.doors, ...restR.doors],
    };
}

// The lab's one browser launcher (lab/browser.ts): headless Chrome on WEB_PORT+5, the bot's page
// pointed at the lab's gateway, refusing a port an earlier Chrome still holds.
const browser: LabBrowser | null = client === 'browser' ? await launchLabBrowser(botName) : null;
const session = await openSession(botName, client === 'browser' ? { client: 'browser', launch: true, insecureQueryLogin: true } : {});
console.log(`measure-legs: ${which} x${runs} on the ${client} client${landingWait === null ? '' : `, ${landingWait} ticks' wait after the first hop (diagnostic)`}${dropsArg ? `, drops ${dropsArg}` : ''}`);

async function main(sdk: BotSDK, bot: BotActions): Promise<void> {
    await leaveTutorial(session, TickLog.memory());
    await setup(sdk, { at: [3222, 3218, 0], stats: {}, vars: {}, items: [] }); // warm-up: the first counted leg does not start on a just-loaded login
    await waitTicks(sdk, 5);
    if (which === 'transports') return transports(sdk, bot);
    type Row = { id: string; drops: DropsMode | null; label: string; expected: number; runs: number[]; bursts: number[]; mean: number | null; deltaPct: number | null; failures: string[] };
    const table: Row[] = [];
    for (const l of legs) {
        const d = l.def;
        const rows = modes.map(m => ({ id: d.id, drops: m ?? null, label: d.expected.label, expected: d.expected.ticks, runs: [] as number[], bursts: [] as number[], mean: null as number | null, deltaPct: null as number | null, failures: [] as string[] }));
        for (let r = 0; r < runs; r++) for (const [mi, mode] of modes.entries()) {
            const row = rows[mi]!;
            let trace: ReturnType<typeof startTrace> | null = null;
            try {
                await setup(sdk, legSetup(l, mode));
                const pre = l.preconditions(sdk.getState()!, undefined);
                if (pre !== true) throw new Error(`precondition: ${pre}`);
                if (mode) {
                    // The setup must hold exactly what the mode says the leg drops, or the difference prices something else.
                    const held = droppable(l, sdk.getState()!);
                    const want = mode === 'with' ? LEDGER_DROPS[d.id]!.length : 0;
                    if (held.length !== want) throw new Error(`--drops=${mode}: the leg would drop ${held.length} slot(s) (${held.join(', ') || 'none'}), not ${want}`);
                }
                trace = startTrace(sdk);
                const legLog = TickLog.memory('measure-legs');
                const out = landingWait === null ? await runLeg(d, { sdk, bot, log: legLog, session: { name: botName, sessionId: 0 } as never }) : await runLegSplit(l, sdk, bot, landingWait);
                trace.stop();
                if (!out) throw new Error('already arrived at the start');
                const bursts = ((legLog.rows.find(x => x.kind === 'travel')?.meta as { drops?: LegDrops[] } | undefined)?.drops ?? []);
                row.bursts.push(bursts.reduce((a, b) => a + b.ticks, 0));
                const hops = hopRows(out.segments, trace.sends, trace.frames, out.endTick);
                result('hops', { id: d.id, run: r, client, hops, sends: trace.sends.map(s => ({ ...s, tick: s.tick - out.startTick })) });
                console.log(`HOPS ${d.id} run ${r} ${client}: ${hopLine(hops)}`);
                const post = l.postconditions(sdk.getState()!, undefined);
                if (post !== true) throw new Error(`postcondition: ${post}`);
                row.runs.push(out.ticks);
                result('leg', { id: d.id, run: r, client, ok: true, ticks: out.ticks, ...(mode ? { drops: mode, bursts } : {}), expected: d.expected.ticks, segments: out.segments, doors: out.doors, clicks: out.clicks, tiles: out.tiles, webTries: out.webTries, ate: out.ate, hpMin: out.hpMin, ...(out.fellBack ? { fellBack: out.fellBack } : {}), at: out.at });
            } catch (e) {
                trace?.stop();
                if (trace?.frames.length) {
                    // A failed run's raw timeline: every click, and each tick the inventory size or the level changed.
                    const t0 = trace.frames[0]!.tick;
                    const changes = trace.frames.filter((f, i, a) => i === 0 || f.inv !== a[i - 1]!.inv || f.level !== a[i - 1]!.level).map(f => ({ ...f, tick: f.tick - t0 }));
                    result('trace', { id: d.id, run: r, client, sends: trace.sends.map(s => ({ ...s, tick: s.tick - t0 })), changes, last: trace.frames.slice(-12).map(f => ({ ...f, tick: f.tick - t0 })), inventory: sdk.getState()?.inventory.map(i => `${i.slot}:${i.name}`) });
                }
                const msg = e instanceof Error ? e.message : String(e);
                row.failures.push(msg);
                result('leg', { id: d.id, run: r, client, ok: false, ...(mode ? { drops: mode } : {}), error: msg, at: sdk.getState()?.player ? { x: sdk.getState()!.player!.worldX, z: sdk.getState()!.player!.worldZ, level: sdk.getState()!.player!.level } : null });
                if (sdk.getState()?.player?.hp === 0) await waitTicks(sdk, 10);
            }
            await cheat(sdk, 'setstat hitpoints 99');
        }
        for (const row of rows) {
            if (row.runs.length) {
                row.mean = Math.round((row.runs.reduce((a, b) => a + b, 0) / row.runs.length) * 10) / 10;
                row.deltaPct = Math.round(((row.mean - row.expected) / row.expected) * 1000) / 10;
            }
            table.push(row);
            console.log(`LEG ${d.id.padEnd(7)} ${client.padEnd(7)}${row.drops ? ` ${row.drops.padEnd(7)}` : ''} ${String(row.mean ?? '-').padStart(6)} vs ${String(row.expected).padStart(6)} (${d.expected.label}) ${row.deltaPct === null ? 'FAILED' : `${row.deltaPct > 0 ? '+' : ''}${row.deltaPct}%`} runs ${row.runs.join(',')}${row.drops ? ` bursts ${row.bursts.join(',')}` : ''}${row.failures.length ? ` failures: ${row.failures.join(' | ')}` : ''}`);
        }
        const [without, withDrops] = rows;
        if (dropsArg === 'pair' && without?.mean != null && withDrops?.mean != null) {
            console.log(`DROPS ${d.id.padEnd(7)} ${client.padEnd(7)} without ${without.mean} with ${withDrops.mean}: +${Math.round((withDrops.mean - without.mean) * 10) / 10} ticks (bursts ${withDrops.bursts.join(',')})`);
            result('drops', { id: d.id, client, without: without.runs, with: withDrops.runs, bursts: withDrops.bursts, delta: Math.round((withDrops.mean - without.mean) * 10) / 10 });
        }
    }
    result('table', { client, legs: table });
}

let exit = 0;
try {
    await main(session.sdk, session.bot);
} catch (e) {
    exit = 1;
    console.error(`measure-legs failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
} finally {
    if (client === 'browser') await logoutClean(session).catch(() => {});
    await closeSession(session).catch(() => {});
    await browser?.kill().catch(() => {});
}
process.exit(exit);
