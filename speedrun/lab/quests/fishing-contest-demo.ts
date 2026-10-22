// Demo check of the Fishing Contest module (speedrun/quests/fishing-contest.ts, S20, the self route)
// on a cleared account, no staff commands, on the browser client unless --client=lite:
//
//   bun speedrun/lab/quests/fishing-contest-demo.ts <account> [--dialogue=burst|fixed] [--client=browser|lite] [--trace=N] [--train-fishing]
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <fresh bot> 'speedrun/lab/quests/fishing-contest-demo.ts:--lab:--client=browser'
//
// The demo run opens its session as rs/287's Aereck driver does (bot.env's loopback GATEWAY_URL and,
// for the browser, its CLIENT_URL page and CDP_URL tab); it starts no gateway of its own. --lab is the
// dry run on the local engine: staff commands put a fresh lab account in the state the demo account
// is expected in (levels set, the kit in the bank at Varrock West, the runes in the bank too), then
// the same staging and run follow with no staff command.
//
// Staging, untimed, only what a player can do, from wherever the account stands:
// 1. The quest must not be started, and the account must have Fishing 10 (the quest's requirement)
//    and Magic 45 (Camelot); either refusal stops the run before anything moves.
// 2. Without the runes for a Camelot cast in the inventory, bank where it stands and withdraw the
//    whole kit's shortfall there (three casts: this one and the module's two).
// 3. Camelot teleport (skipped already in Catherby), then at Catherby bank withdraw what is still
//    short for the module's two casts, the spade, the garlic and the coins (the fee, and the rod's
//    price when no rod is held); deposit what is not the kit only when the free slots are too few.
// 4. Without a rod, buy one from Harry's Fishing Shop (catherby.inv: fishingshop2).
// 4a. --train-fishing, for an account below the quest's Fishing 10: buy a small net from Harry, net on
//    Catherby beach until Fishing 10 (each early catch is a level-up page, cleared before the next
//    cast), and drop the catch, since segment N refuses raw shrimps at the exit. Unproven on the demo:
//    its one real-server use (cairn_h55, 22:12-22:17Z on 22 Oct) caught nothing in 600 ticks with no
//    per-click trace, and a demo-wide disconnect at 22:15:50Z falls inside that window; 1 to 10 in
//    124 ticks on the lab.
// 5. Run to the arrival tile (2820,3486) and require segment A's own preconditions.
// Then the module's fourteen segments in one dialogue mode, each timed by its TickLog row and set
// beside the lite lab mean from docs/speedrun/quests/fishing_contest.md. The first output line after
// the run is the BURST line: per-talk ticks, bursts, failed bursts and shape matches, beside rs/287's
// demo pass. Then a confirmed logout.

import type { BotWorldState, NearbyNpc } from '../../../sdk/types';
import { act, dropItems } from '../../lib/act';
import { converse } from '../../lib/converse';
import type { WithdrawSpec } from '../../lib/bank';
import { depositAll, depositMatching, withdrawMany } from '../../lib/bank';
import { INVENTORY_SIZE, matchesItem, type ItemPattern } from '../../lib/items';
import { questStatus } from '../../lib/quests';
import { closeSession, loadBotEnv, logoutClean, openSession, type ClientKind, type LogoutResult } from '../../lib/session';
import { TickLog, type TickRow } from '../../lib/ticks';
import { inArea, runesHeld, runTo, SPELLS, teleport, teleportRefusal, type Area } from '../../lib/travel';
import { invCount, opIndex } from '../../lib/world';
import { FORBIDDEN_ACCOUNTS } from '../../helpers/fleet-config';
import { ARRIVAL, FEE, quest, stepId, steps } from '../../quests/fishing-contest';
import { baseLevels, type DialogueMode } from '../../quests/segments';
import { runSteps, type Check } from '../../runner/step';
import { launchLabBrowser, type LabBrowser } from '../browser';
import { arg, botArg, result } from '../common';
import { clearInventory, give, leaveTutorial, mustTele, setStats, VARROCK_WEST_BANK } from '../setup';
import { trace } from './run';

/** The lite lab means per segment (m, lab, bgsrv-mac, 3 runs each; rs/388, fishing_contest.md's table). */
export const LAB_LITE: Readonly<Record<DialogueMode, Record<string, number>>> = {
    burst: { A: 0, B: 16, C: 62.3, D: 2, E: 39, F: 36, G: 63, H: 7, I: 12, J: 11, K: 6, L: 9, M: 38.7, N: 12 },
    fixed: { A: 0, B: 24, C: 62.3, D: 2, E: 39, F: 36, G: 63, H: 7, I: 14, J: 11.7, K: 6, L: 10, M: 38.3, N: 14 },
};

/** rs/287's demo pass on Father Aereck (twin, browser): the reference the burst line is read against. */
export const AERECK_PASS = '0 failed in 24, 16/16 matches, 8.13 ticks per talk';

const ITEM = {
    law: /^law rune$/i,
    air: /^air rune$/i,
    spade: /^spade$/i,
    garlic: /^garlic$/i,
    coins: /^coins$/i,
    rod: /^fishing rod$/i,
} as const;
/** What staging may hold: never deposited. */
const KEEP: readonly ItemPattern[] = Object.values(ITEM);

/** Coins for the rod on top of the fee (its shop price is 5; the margin covers a depleted stock's markup). */
export const ROD_COINS = 20;
/** Fewer free slots than this at Catherby bank and staging deposits what is not the kit (the module's peak need is 2). */
export const MIN_FREE = 6;
export const CATHERBY_BANK: Area = { x: 2809, z: 3439, tol: 2 };
/** Harry (npc 576) stands at 2834,3445 (m44_53.jm2); openShop walks the rest. */
export const HARRY: Area = { x: 2833, z: 3444, tol: 3 };
/** Catherby: inside this box no Camelot teleport is needed to reach the bank. */
const CATHERBY = { x0: 2780, z0: 3420, x1: 2860, z1: 3500 };
const inCatherby = (s: BotWorldState) => s.player!.worldX >= CATHERBY.x0 && s.player!.worldX <= CATHERBY.x1 && s.player!.worldZ >= CATHERBY.z0 && s.player!.worldZ <= CATHERBY.z1 && s.player!.level === 0;

/** Refuse a target the run must not log in, before any login. */
export function checkDemoTarget(env: { BOT_USERNAME: string; SERVER?: string }, lab: boolean): void {
    const local = /^(localhost|127\.)/.test(env.SERVER ?? '');
    if (lab && !local) throw new Error('--lab drives the local lab engine only');
    if (!lab && local) throw new Error('without --lab this is the demo run: the account must point at the demo world');
    const name = env.BOT_USERNAME.trim().toLowerCase().replace(/\s+/g, '_');
    if (FORBIDDEN_ACCOUNTS.has(name)) throw new Error(`${env.BOT_USERNAME} is on the forbidden list (the scored account or a reserved name)`);
}

/**
 * The levels the run needs, checked before staging moves anything: the quest's Fishing 10 (segment A's
 * own check) and Magic for the Camelot casts. True, or what is short.
 */
export const FISHING_NEED = 10;
export const levelRefusal: Check<unknown> = baseLevels({ fishing: FISHING_NEED, magic: SPELLS.camelot.magic });
/** With --train-fishing, only Magic must be there before staging; staging nets Fishing up to FISHING_NEED. */
export const magicRefusal: Check<unknown> = baseLevels({ magic: SPELLS.camelot.magic });

/** Catherby beach's net spots, below Harry's (2834,3445). */
export const NET_BEACH: Area = { x: 2838, z: 3432, tol: 4 };
const NET = /^small fishing net$/i;
export const NET_CATCH = /^raw (shrimps|anchovies)$/i;
/** Fishing 1 to 10 is 1,154 xp, five shrimps at the server's rate 25 (10 base each); the bound allows for misses and level-up pages. */
export const TRAIN_MAX_TICKS = 600;

/** The nearest fishing spot that offers Net. */
export function netSpot(s: BotWorldState): NearbyNpc | null {
    const spots = s.nearbyNpcs.filter(n => /^fishing spot$/i.test(n.name) && opIndex(n, /^net$/i) !== undefined);
    return spots.sort((a, b) => a.distance - b.distance)[0] ?? null;
}

/**
 * What the bank must give for `casts` Camelot casts and the module's kit: law and air runes short of
 * the casts, a spade, garlic, and the coins short of the fee (plus the rod's price without a rod).
 */
export function kitShortfall(s: BotWorldState, casts: number): WithdrawSpec[] {
    const held = runesHeld(s);
    const cast = SPELLS.camelot.runes;
    const out: WithdrawSpec[] = [];
    const law = casts * (cast.law ?? 0) - held.law;
    if (law > 0) out.push({ item: ITEM.law, n: law });
    const air = casts * (cast.air ?? 0) - held.air;
    if (air > 0) out.push({ item: ITEM.air, n: air });
    if (invCount(s, ITEM.spade) < 1) out.push({ item: ITEM.spade, n: 1 });
    if (invCount(s, ITEM.garlic) < 1) out.push({ item: ITEM.garlic, n: 1 });
    const coins = FEE + (invCount(s, ITEM.rod) > 0 ? 0 : ROD_COINS) - invCount(s, ITEM.coins);
    if (coins > 0) out.push({ item: ITEM.coins, n: coins });
    return out;
}

/** Inventory items staging would deposit to free slots: everything that is not the kit. */
export function notKit(s: BotWorldState): string[] {
    return [...new Set(s.inventory.filter(i => !KEEP.some(p => matchesItem(i, p))).map(i => i.name))];
}

export interface TalkLine {
    seg: string;
    who: string;
    ticks: number | null;
    dialogueTicks: number | null;
    pages: number;
    options: number;
    bursts: number;
    failedBursts: number;
    matches: boolean | null;
}

/** The module's per-conversation notes (noteShape) from a run's rows. */
export function talkLines(rows: readonly TickRow[]): TalkLine[] {
    return rows
        .filter(r => r.kind === 'note' && r.meta && typeof r.meta.who === 'string' && typeof r.meta.pages === 'number')
        .map(r => {
            const m = r.meta!;
            const num = (v: unknown) => (typeof v === 'number' ? v : null);
            return {
                seg: r.step.split(':')[1] ?? r.step,
                who: m.who as string,
                ticks: num(m.ticks),
                dialogueTicks: num(m.dialogueTicks),
                pages: m.pages as number,
                options: num(m.options) ?? 0,
                bursts: num(m.bursts) ?? 0,
                failedBursts: num(m.failedBursts) ?? 0,
                matches: typeof m.matches === 'boolean' ? m.matches : null,
            };
        });
}

const mean = (xs: readonly number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : NaN);

/** The report's first line: per-talk ticks, bursts, failed bursts and shape matches, beside rs/287's pass. */
export function burstLine(where: string, mode: DialogueMode, talks: readonly TalkLine[]): string {
    const ticks = talks.map(t => t.ticks ?? NaN);
    const shaped = talks.filter(t => t.matches !== null);
    const bursts = talks.reduce((a, t) => a + t.bursts, 0);
    const failed = talks.reduce((a, t) => a + t.failedBursts, 0);
    const each = talks.map(t => `${t.seg} ${t.ticks ?? '?'}`).join(', ');
    return (
        `BURST ${where} (${mode}): ${talks.length} talks, click to closed ${each} (mean ${mean(ticks)}); ` +
        `failedBursts ${failed} of ${bursts}; shape matches ${shaped.filter(t => t.matches).length}/${shaped.length}. rs/287 Aereck demo pass: ${AERECK_PASS}`
    );
}

async function main(): Promise<void> {
    const account = botArg();
    const lab = process.argv.includes('--lab');
    const dialogue = arg('dialogue', 'burst') as DialogueMode;
    if (dialogue !== 'burst' && dialogue !== 'fixed') throw new Error(`--dialogue=${dialogue}: want burst or fixed`);
    const client = arg('client', 'browser') as ClientKind;
    if (client !== 'browser' && client !== 'lite') throw new Error(`--client=${client}: want browser or lite`);
    const traceEvery = Number(arg('trace', '0'));
    const trainFishing = process.argv.includes('--train-fishing');
    checkDemoTarget(loadBotEnv(account), lab);
    const where = `${lab ? 'lab dry run' : 'demo'}, ${client}`;
    const say = (m: string, d?: Record<string, unknown>) => console.log(`fc-demo: ${m}${d ? ` ${JSON.stringify(d)}` : ''}`);

    // In the lab the browser is this checkout's page in a tab owned here (as labMain does); on the demo it is bot.env's.
    const chrome: LabBrowser | null = lab && client === 'browser' ? await launchLabBrowser(account) : null;
    const s = await openSession(account, { client, launch: true, readyTimeoutMs: 180_000, ...(lab && client === 'browser' ? { insecureQueryLogin: true } : {}) });
    const sdk = s.sdk;
    const st = () => sdk.getState()!;
    const log = TickLog.memory('fc-demo');
    const out: Record<string, unknown> = { account, where, dialogue };
    const staging: Record<string, unknown> = {};
    const inventory = () => (st().inventory ?? []).map(i => `${i.name}${i.count > 1 ? ` x${i.count}` : ''}`);
    const at = () => [st().player!.worldX, st().player!.worldZ, st().player!.level];
    const fishing = () => st().skills.find(k => /^fishing$/i.test(k.name))?.baseLevel ?? 0;
    const segRows = () => log.rows.filter(r => !r.kind && r.step.startsWith(`${stepId}:`));
    let pass = false;
    let logout: LogoutResult | null = null;
    let untrace = () => undefined as void;

    /** Open the bank in reach, deposit what is not the kit if `freeUp`, withdraw `specs`, close. */
    const bank = async (label: string, specs: readonly WithdrawSpec[], freeUp: boolean) => {
        const open = await s.bot.openBank();
        if (!open.success) throw new Error(`${label}: no bank opened (${open.message}); the account must stand within reach of a bank`);
        if (freeUp && INVENTORY_SIZE - st().inventory.length < MIN_FREE) {
            const names = notKit(st());
            const d = await depositMatching(sdk as never, names);
            staging[`${label}Deposited`] = names;
            if (!d.ok) throw new Error(`${label}: deposit of ${names.join(', ')} failed`);
        }
        if (specs.length) {
            const w = await withdrawMany(sdk as never, specs);
            staging[`${label}Withdrawn`] = Object.fromEntries(w.gained);
            if (w.missing.length) throw new Error(`${label}: the bank holds no ${w.missing.map(m => String(m.item)).join(', ')}`);
            if (!w.ok) throw new Error(`${label}: withdraw ${w.reason ?? 'failed'}`);
        }
        await s.bot.closeBank();
    };

    try {
        if (lab) {
            await leaveTutorial(s);
            await clearInventory(sdk);
            await setStats(sdk, { fishing: trainFishing ? 1 : 74, magic: 99, agility: 75, hitpoints: 70 });
            await mustTele(sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);
            await give(sdk, ['spade', 'garlic']);
            await give(sdk, 'coins', 100);
            await give(sdk, 'lawrune', 10);
            await give(sdk, 'airrune', 50);
            const open = await s.bot.openBank();
            if (!open.success) throw new Error(`lab setup: ${open.message}`);
            await depositAll(sdk as never);
            await s.bot.closeBank();
        }
        out.start = { at: at(), quest: questStatus(st(), quest), inventory: inventory() };
        say('start', out.start as Record<string, unknown>);
        if (questStatus(st(), quest) !== 'not_started') throw new Error(`Fishing Contest is ${questStatus(st(), quest)} on ${account}: the check needs a fresh quest; nothing moved`);
        const levels = (trainFishing ? magicRefusal : levelRefusal)(st(), {});
        if (levels !== true) throw new Error(`${account} cannot run the module: ${levels}; nothing moved`);
        untrace = traceEvery > 0 ? trace(sdk as never, traceEvery) : () => undefined;
        const t0 = st().tick;

        const refusal = teleportRefusal(st(), 'camelot');
        if (refusal && !/runes short/.test(refusal)) throw new Error(`Camelot teleport: ${refusal}`);
        if (refusal && !inCatherby(st())) await bank('here', kitShortfall(st(), 3), false);
        if (!inCatherby(st())) {
            const t = await teleport(sdk as never, 'camelot', { walkOnRefusal: false });
            if (!t.ok && !inArea(sdk as never, SPELLS.camelot.landing)) throw new Error(`staging Camelot teleport: ${t.reason ?? 'not landed'}`);
        }
        const short = kitShortfall(st(), 2);
        if (short.length || INVENTORY_SIZE - st().inventory.length < MIN_FREE) {
            const r = await runTo(sdk as never, CATHERBY_BANK, { bot: s.bot as never, maxTicks: 300 });
            if (!r.ok) throw new Error(`to Catherby bank: ${r.reason ?? 'not arrived'}`);
            await bank('catherby', short, true);
        }
        if (invCount(st(), ITEM.rod) < 1) {
            const r = await runTo(sdk as never, HARRY, { bot: s.bot as never, maxTicks: 300 });
            if (!r.ok) throw new Error(`to Harry's shop: ${r.reason ?? 'not arrived'}`);
            const shop = await s.bot.openShop(/^harry$/i);
            if (!shop.success) throw new Error(`Harry's shop: ${shop.message}`);
            const bought = await s.bot.buyFromShop(ITEM.rod, 1);
            await s.bot.closeShop();
            if (!bought.success || invCount(st(), ITEM.rod) < 1) throw new Error(`fishing rod: ${bought.message}`);
        }
        if (trainFishing && fishing() < FISHING_NEED) {
            if (invCount(st(), NET) < 1) {
                const r = await runTo(sdk as never, HARRY, { bot: s.bot as never, maxTicks: 300 });
                if (!r.ok) throw new Error(`to Harry's shop: ${r.reason ?? 'not arrived'}`);
                const shop = await s.bot.openShop(/^harry$/i);
                if (!shop.success) throw new Error(`Harry's shop: ${shop.message}`);
                const bought = await s.bot.buyFromShop(NET, 1);
                await s.bot.closeShop();
                if (!bought.success || invCount(st(), NET) < 1) throw new Error(`small fishing net: ${bought.message}`);
            }
            const beach = await runTo(sdk as never, NET_BEACH, { bot: s.bot as never, maxTicks: 300 });
            if (!beach.ok) throw new Error(`to Catherby beach: ${beach.reason ?? 'not arrived'}`);
            const tt = st().tick;
            const from = fishing();
            while (fishing() < FISHING_NEED) {
                if (st().tick - tt > TRAIN_MAX_TICKS) throw new Error(`Fishing ${fishing()} after ${TRAIN_MAX_TICKS} ticks of netting`);
                // Each early catch is a level-up at the server's rate, and its page stops the netting: clear it, net again.
                if (st().dialog.isOpen) {
                    await converse(sdk as never, [], { idle: 2 });
                    continue;
                }
                const spot = netSpot(st());
                if (!spot) throw new Error(`no net fishing spot in view at ${at().join(',')}`);
                const before = invCount(st(), NET_CATCH);
                await act(sdk as never, () => sdk.sendInteractNpc(spot.index, opIndex(spot, /^net$/i)!), x => invCount(x, NET_CATCH) > before || x.dialog.isOpen, { maxTicks: 40, resendEvery: 10, maxResends: 3 });
            }
            if (st().dialog.isOpen) await converse(sdk as never, [], { idle: 2 });
            await dropItems(sdk as never, i => NET_CATCH.test(i.name));
            if (invCount(st(), NET_CATCH) > 0) throw new Error('the netted catch was not dropped (segment N refuses raw shrimps at the exit)');
            staging.trained = { fishing: `${from} to ${fishing()}`, ticks: st().tick - tt };
            say('trained', staging.trained as Record<string, unknown>);
        }
        const there = await runTo(sdk as never, ARRIVAL, { bot: s.bot as never, maxTicks: 400 });
        if (!there.ok) throw new Error(`to the arrival tile ${ARRIVAL.x},${ARRIVAL.z}: ${there.reason ?? 'not arrived'}`);
        const list = steps({ dialogue });
        const pre = list[0]!.preconditions(st(), {});
        if (pre !== true) throw new Error(`segment A refuses: ${pre}`);
        staging.ticks = st().tick - t0;
        staging.inventory = inventory();
        out.staging = staging;
        say('staged', staging);

        await runSteps(s, list, { log, c: {}, shouldStop: () => false, logout: async () => {}, tickMonitor: false });
        const lab0 = LAB_LITE[dialogue];
        out.segments = segRows().map(r => {
            const letter = r.step.split(':')[1]!.split('-')[0]!;
            const ref = lab0[letter];
            return { step: r.step, ok: r.ok, ticks: r.ticks, lite: ref, vsLite: ref ? `${Math.round(((r.ticks - ref) / ref) * 100)}%` : '' };
        });
        pass = questStatus(st(), quest) === 'complete' && segRows().some(r => r.step.startsWith(`${stepId}:N-`) && r.ok);
    } catch (err) {
        out.error = err instanceof Error ? err.message : String(err);
        out.staging = staging;
        out.partial = segRows().map(r => ({ step: r.step, ok: r.ok, ticks: r.ticks }));
    } finally {
        untrace();
        out.end = { at: at(), quest: questStatus(st(), quest), inventory: inventory() };
        logout = await logoutClean(s);
        await closeSession(s);
        await chrome?.kill();
    }

    const talks = talkLines(log.rows);
    console.log(`\n${burstLine(where, dialogue, talks)}`);
    console.log(`\n| Talk | Who | Click to closed | First page to closed | Pages | Options | Bursts | Failed | Shape |\n|---|---|---|---|---|---|---|---|---|`);
    for (const t of talks) console.log(`| ${t.seg} | ${t.who} | ${t.ticks ?? ''} | ${t.dialogueTicks ?? ''} | ${t.pages} | ${t.options} | ${t.bursts} | ${t.failedBursts} | ${t.matches === null ? '' : t.matches ? 'match' : 'MISMATCH'} |`);
    if (Array.isArray(out.segments)) {
        const rows = out.segments as Array<{ step: string; ticks: number; lite?: number; vsLite: string; ok: boolean }>;
        console.log(`\n| Segment | ${lab ? 'Lab dry run' : 'Demo'} (${client}) | Lite lab mean (${dialogue}) | vs lite |\n|---|---|---|---|`);
        for (const r of rows) console.log(`| ${r.step}${r.ok ? '' : ' (failed)'} | ${r.ticks} | ${r.lite ?? ''} | ${r.vsLite} |`);
        const total = rows.reduce((a, r) => a + r.ticks, 0);
        const lite = Object.values(LAB_LITE[dialogue]).reduce((a, x) => a + x, 0);
        console.log(`| **Total** | ${total} | ${Math.round(lite * 10) / 10} | ${Math.round(((total - lite) / lite) * 100)}% |`);
    }
    out.logout = logout ? { ok: logout.ok, latencyTicks: logout.latencyTicks, ...(logout.ok ? {} : { reason: (logout as { reason?: string }).reason }) } : null;
    result('fc demo', { pass, talks, ...out });
    process.exit(pass && logout?.ok ? 0 : 1);
}

if (import.meta.main) await main();
