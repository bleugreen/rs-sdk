// Lab passes for speedrun/skills/thieving.ts in the browser tab (in-page pickpocket).
//
//   LAB_BLOCK=thieving NODE_TICKRATE=300 bash docs/speedrun/scripts/tickprog-lab.sh <bot> \
//       speedrun/lab/measure-thieving.ts:setup speedrun/lab/measure-thieving.ts:fresh:--from=thieving:men ...
//
// tickprog-lab.sh runs a `.ts` spec as `bun <spec> <bot> <args>` with SPEEDRUN_CDP_URL pointing
// at its tab, and the session opens with insecureQueryLogin, so `login` can re-navigate the tab. Modes:
//   setup    finish the tutorial by cheat (a fresh lab bot has no side tabs and the server
//            refuses its inventory ops); run the lab again in the same checkout to log in
//            with the tabs set
//   fresh    the rehearsal account at the tutorial exit: Lumbridge (3222,3222), 10 HP, the
//            tutorial's 18 items, the kit (38 noted cakes, 100 coins), Thieving 1, full energy
//   at       --thieving=N --hp=N --x= --z= [--cakes=N]: stage a band start by cheat
//            [--only=to-ardougne,provision] runs just those steps of steps() (names after
//            `thieving:`); [--kit-food=shark --kit-n=70] changes the noted food in the kit
//            [--light] leaves the heavy starter items out of the kit (the weight lever, off the clock)
//   steps    run steps() [--from=<step>] [--to=99] [--food=cake]
//   leg      only thieving:to-ardougne, from wherever the account stands
//   topup    S18's helper top-ups at the scored run's stats: --mode=idle|restart --helper=<bot>
//            (HELPER=<bot> in tickprog-lab.sh) [--thieving=57 --hp=97 --sharks=2 --below=2
//            --load=1 --to=99]. The helper is a lite stand-in that stays beside the account by
//            ::tele and answers the account's request with one shark offer.
// Staging is outside the measured steps. Every step row and every pickpocket end status is
// printed as a RESULT line; the end statuses carry the gap histograms, skippedTicks, frames,
// publish, react and loops. Every run also samples the account each tick, and a leg run prints
// its sub-legs (`RESULT leg <name>`): ticks, tiles, ticks at 2, 1 and 0 steps, energy, weight.

import { hostname, loadavg } from 'os';
import type { BotWorldState } from '../../sdk/types';
import type { ProgramStatus } from '../lib/programs';
import { programStatus } from '../lib/programs';
import { closeSession, openSession, type Session } from '../lib/session';
import { formatReport, report, TickLog, type TickRow } from '../lib/ticks';
import { clickBack, decideGiver, decideTradeClick, DROPPED_TICKS, newClickCtx, newGiverCtx, planOffers, sameName, sendTradeClick, tradeOf, type ClickCtx, type GiverCtx, type OfferEntry } from '../lib/trade';
import { waitTicks, waitUntil } from '../lib/wait';
import { runSteps } from '../runner/step';
import { type FoodName, type LegMark, steps, type ThievingOptions } from '../skills/thieving';
import { arg, result } from './common';
import { cheat, near, tele } from './setup';

const bot = process.argv[2] ?? '';
const mode = process.argv[3] ?? '';
if (!bot || !mode) throw new Error('usage: measure-thieving.ts <bot> setup|fresh|at|steps|leg [--k=v ...]');
const where = () => ({ host: hostname(), load: loadavg().map(l => +l.toFixed(1)), at: new Date().toISOString(), tickrate: process.env.NODE_TICKRATE ?? '' });

const session = await openSession(bot, { client: 'browser', insecureQueryLogin: true });
const { sdk } = session;
const say = async (cmd: string) => {
    await cheat(sdk, cmd);
    await waitTicks(sdk, 1);
};

const STARTER = ['bronze_axe', 'tinderbox', 'net', 'shrimp', 'bucket_empty', 'pot_empty', 'bread', 'bronze_pickaxe', 'bronze_dagger', 'bronze_sword', 'wooden_shield', 'shortbow'];
/** The starter items that weigh something (obj weights: axe, pickaxe, sword, shield, bucket, pot, bow, dagger). */
const HEAVY = new Set(['bronze_axe', 'bronze_pickaxe', 'bronze_sword', 'wooden_shield', 'bucket_empty', 'pot_empty', 'shortbow', 'bronze_dagger']);
const STARTER_STACKS: Array<[string, number]> = [['bronze_arrow', 25], ['airrune', 25], ['mindrune', 15], ['waterrune', 6], ['earthrune', 4], ['bodyrune', 2]];

async function clearInventory() {
    await say('~clearinv inv');
    await waitUntil(sdk, s => s.inventory.length === 0, { maxTicks: 5 });
}

async function giveAll(items: Array<[string, number]>) {
    const before = sdk.getState()!.inventory.length;
    for (const [name, n] of items) await cheat(sdk, `give ${name} ${n}`);
    await waitUntil(sdk, s => s.inventory.length >= before + items.length, { maxTicks: items.length + 10 });
    await waitTicks(sdk, 1);
}

const followPrograms = () => {
    const seen = new Set<number>();
    return sdk.onStateUpdate(s => {
        const st = programStatus(s) as ProgramStatus | null;
        if (!st || st.phase === 'running' || seen.has(st.runId)) return;
        seen.add(st.runId);
        result(`program ${st.name}#${st.runId} ${st.phase}`, {
            startedTick: st.startedTick, endedTick: st.endedTick, counters: st.counters, gauges: st.gauges, result: st.result, fault: st.fault,
            packets: st.packets, deferred: st.deferred, skippedTicks: st.skippedTicks, maxTickMs: st.maxTickMs, frames: st.frames, publish: st.publish, react: st.react, loops: st.loops
        });
    });
};

/** One published state a tick: where the account is and what its run state is. */
interface Sample { tick: number; x: number; z: number; level: number; energy: number; weight: number; run: number | null; dialog: boolean }

const sampleTicks = () => {
    const samples: Sample[] = [];
    const un = sdk.onStateUpdate(s => {
        const p = s.player;
        if (!p || samples[samples.length - 1]?.tick === s.tick) return;
        samples.push({ tick: s.tick, x: p.worldX, z: p.worldZ, level: p.level, energy: p.runEnergy, weight: p.runWeight, run: s.varps?.option_run ?? null, dialog: !!s.dialog?.isOpen });
    });
    return { samples, stop: un };
};

/**
 * The leg's sub-legs from the module's marks and the tick samples: per sub-leg its ticks, the
 * tiles moved (a step of 3+ tiles is a ship or a gangplank and counts as a jump), the ticks spent
 * at 2 steps (running), 1 (walking) and 0, and the energy and weight seen.
 */
export function legBreakdown(samples: readonly Sample[], from: { tick: number }, marks: readonly LegMark[]) {
    let start = from.tick;
    return marks.map(m => {
        const seg = samples.filter(s => s.tick > start && s.tick <= m.tick);
        const prevIdx = samples.findIndex(s => s.tick > start) - 1;
        let prev = prevIdx >= 0 ? samples[prevIdx] : seg[0];
        let tiles = 0, run = 0, walk = 0, still = 0, jumps = 0, dialog = 0;
        for (const s of seg) {
            const d = prev && prev.level === s.level ? Math.max(Math.abs(s.x - prev.x), Math.abs(s.z - prev.z)) : 99;
            if (d >= 3) jumps++;
            else { tiles += d; if (d === 2) run++; else if (d === 1) walk++; else still++; }
            if (s.dialog) dialog++;
            prev = s;
        }
        const row = { leg: m.leg, ...(m.talks === undefined ? {} : { talks: m.talks }), ticks: m.tick - start, tiles, run, walk, still, jumps, dialogTicks: dialog, gapTicks: m.tick - start - seg.length, energy: seg.length ? [seg[0]!.energy, Math.min(...seg.map(s => s.energy)), seg[seg.length - 1]!.energy] : [], weight: seg[0]?.weight ?? null, runVarp: [...new Set(seg.map(s => s.run))] };
        start = m.tick;
        return row;
    });
}

async function runList(list: ReturnType<typeof steps>, from?: string) {
    const log = TickLog.open(`lab-thieving-${bot}-${Date.now()}`);
    const unfollow = followPrograms();
    const ticks = sampleTicks();
    const p = sdk.getState()!.player!;
    result('start', { ...where(), at: [p.worldX, p.worldZ, p.level], hp: p.hp, maxHp: p.maxHp, energy: p.runEnergy, thieving: sdk.getState()!.skills.find(k => k.name === 'Thieving')?.baseLevel, inventory: sdk.getState()!.inventory.map(i => `${i.name}x${i.count}`) });
    try {
        await runSteps(session, list, { log, c: {}, ...(from ? { from } : {}), shouldStop: () => false });
    } catch (e) {
        result('error', String(e));
    } finally {
        unfollow();
        ticks.stop();
        for (const r of log.rows) result(`row ${r.step}`, { ticks: r.ticks, startTick: r.startTick, endTick: r.endTick, ok: r.ok, ...(r.error ? { error: r.error } : {}), ...(r.meta ? { meta: r.meta } : {}) });
        const leg = log.rows.find(r => r.step === 'thieving:to-ardougne:detail')?.meta as { from?: { tick: number }; marks?: LegMark[] } | undefined;
        if (leg?.from && leg.marks) for (const b of legBreakdown(ticks.samples, leg.from, leg.marks)) result(`leg ${b.leg}`, b);
        console.log(formatReport(report(log.rows)));
        const q = sdk.getState()!.player!;
        result('end', { ...where(), at: [q.worldX, q.worldZ, q.level], hp: q.hp, thieving: sdk.getState()!.skills.find(k => k.name === 'Thieving')?.baseLevel, coins: sdk.getState()!.inventory.filter(i => /^coins$/i.test(i.name)).reduce((a, i) => a + i.count, 0), inventory: sdk.getState()!.inventory.map(i => `${i.name}x${i.count}`) });
    }
    return log.rows;
}

const opts = (): ThievingOptions => ({
    to: Number(arg('to', '99')),
    food: arg('food', 'cake') as FoodName
});

/**
 * The lab stand-in for the S18 trade giver: it holds a side tile of the account by ::tele (never
 * while a trade is open; never a corner, never the knight's tile), answers the account's trade request with its own and keeps it standing the way
 * the S18 courier does (lib/trade.ts decideTradeClick: re-sent after a busy refusal or no
 * reply, for up to 10 ticks), offers `load` sharks with one press and accepts both screens, and
 * restocks itself by ::give. `events` is its side of every top-up, by tick.
 *
 * Why a side tile: an op on a player reaches it only from a side (rsmod's rectangle reach,
 * GameMap.reachedEntity), and the stunned account cannot step round a corner, so a request sent
 * at +2 to a giver on a corner goes nowhere and draws no message. Holding Chebyshev distance 1
 * (this stand-in's rule until rs/279) left it on a corner for whole runs: 6 of 17 due top-ups
 * lost in idle mode, 5 of 15 in restart mode, every one with the giver on a corner or 2 away.
 */
const SIDES: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function runGiver(h: Session, load: number): { stop: () => void; teles: number; events: Array<{ tick: number; ev: string }> } {
    let gctx: GiverCtx | null = null, plan: OfferEntry[] = [], lastTick = -1, lastTele = -100, lastStock = -100;
    let answer: { rc: ClickCtx; until: number } | null = null;
    const seen = new Set<string>();
    const out = { teles: 0, stop: () => {}, events: [] as Array<{ tick: number; ev: string }> };
    const ev = (tick: number, e: string) => out.events.push({ tick, ev: e });
    const burst = () => { for (const e of plan) for (const a of e.amounts) void h.sdk.sendOfferItem(e.slot, a); void h.sdk.sendAcceptTrade(); };
    out.stop = h.sdk.onStateUpdate(hs => {
        if (!hs?.inGame || hs.tick === lastTick) return;
        lastTick = hs.tick;
        const s = sdk.getState();
        const account = s?.player?.name ?? bot;
        const fresh = (hs.gameMessages ?? []).filter(m => {
            const key = m.observationId !== undefined ? `o${m.observationId}` : `${m.tick}|${m.text}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        for (const m of fresh) if (/wishes to trade|busy at the moment|^sending trade offer/i.test(m.text)) ev(hs.tick, m.text.replace(/^.*(wishes to trade|busy|sending trade offer).*$/i, '$1').toLowerCase());
        if (gctx) {
            const d = decideGiver(hs, gctx);
            gctx = d.next;
            if (d.action === 'burst') burst();
            else if (d.action === 'accept') void h.sdk.sendAcceptTrade();
            else if (d.action === 'decline') { void h.sdk.sendDeclineTrade(); gctx = null; }
            else if (d.action === 'done' || d.action === 'closed') gctx = null;
            return;
        }
        if (tradeOf(hs).isOpen) {
            if (answer) ev(hs.tick, 'open');
            answer = null;
            plan = planOffers(hs.inventory, [{ item: /^shark$/i, n: load }]);
            gctx = newGiverCtx(account, hs.inventory, plan);
            const d = decideGiver(hs, gctx);
            gctx = d.next;
            if (d.action === 'burst') burst();
            return;
        }
        const have = hs.inventory.filter(i => /^shark$/i.test(i.name)).length;
        if (have < load * 4 && hs.tick - lastStock > 6) { void h.sdk.sendSay(`::give shark ${load * 8 - have}`); lastStock = hs.tick; }
        const idx = hs.nearbyPlayers.find(p => sameName(p.name, account))?.index;
        if (!answer && fresh.some(m => /wishes to trade/i.test(m.text))) answer = { rc: newClickCtx(), until: hs.tick + 10 };
        if (answer) {
            if (hs.tick > answer.until) {
                ev(hs.tick, `gave up after ${answer.rc.sends} sends`);
                answer = null;
            } else if (idx === undefined) ev(hs.tick, 'account out of sight');
            else {
                const d = decideTradeClick(hs, answer.rc, { noReplyTicks: DROPPED_TICKS, resendTicks: 100 });
                answer.rc = d.next;
                if (d.action === 'send') {
                    const a = answer;
                    sendTradeClick(h.sdk, idx, a.rc.sentTick, (sent, tick) => (a.rc = clickBack(a.rc, sent, tick)));
                    ev(hs.tick, `send ${d.why}`);
                }
                return;
            }
        }
        const me = hs.player, p = s?.player;
        if (me && p && !tradeOf(s!).isOpen && Math.abs(me.worldX - p.worldX) + Math.abs(me.worldZ - p.worldZ) !== 1 && hs.tick - lastTele >= 3) {
            const npcAt = (x: number, z: number) => s!.nearbyNpcs.some(n => (n.tileX ?? n.x) === x && (n.tileZ ?? n.z) === z);
            const [x, z] = SIDES.map(([dx, dz]) => [p.worldX + dx, p.worldZ + dz] as const).find(([x, z]) => !npcAt(x, z)) ?? [p.worldX + 1, p.worldZ];
            void h.sdk.sendSay(`::tele 0,${x >> 6},${z >> 6},${x & 63},${z & 63}`);
            lastTele = hs.tick;
            out.teles++;
        }
    });
    return out;
}

/**
 * The account's side of the top-up lab, from its own published state: every failure and roll by
 * its game message, the trade's open and close ticks, the food count, and whether the giver was
 * within 1 tile on each failure's +2 (the program's `player` action needs it). It also records
 * the tick of every trade request the module sends (the restart path's `openTrade` clicks; the
 * idle path's request goes out from the page program and is not seen here) and every server
 * op rejection (UNSET_MAP_FLAG, which OpPlayerHandler sends for a click from a delayed player).
 */
function trackTopUps(giver: string, below: number, giverEvents: ReadonlyArray<{ tick: number; ev: string }>) {
    const fails: number[] = [], rolls: number[] = [], opens: number[] = [], closes: number[] = [];
    const clicks: number[] = [], rejects: number[] = [];
    const send = sdk.sendTradeRequest.bind(sdk);
    sdk.sendTradeRequest = (...a: Parameters<typeof send>) => {
        clicks.push(sdk.getState()?.tick ?? -1);
        return send(...a);
    };
    let rejected = sdk.getState()?.opFeedback?.opRejectedCount ?? 0;
    /** The account's trade lines (requests, refusals, sends) by tick. */
    const tradeLines: Array<{ tick: number; text: string }> = [];
    const dueFails: number[] = [], adjacentAt2: Record<number, boolean> = {};
    /** The giver's tile less the account's on each failure's +2: an op on a player reaches it only from a side, not a corner. */
    const offsetAt2: Record<number, [number, number]> = {};
    const seen = new Set<string>();
    let last = -1, wasOpen = false, food = Infinity;
    const un = sdk.onStateUpdate((s: BotWorldState) => {
        if (s.tick === last) return;
        last = s.tick;
        for (const m of s.gameMessages ?? []) {
            const key = m.observationId !== undefined ? `o${m.observationId}` : `${m.tick}|${m.text}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (/You fail to pick/i.test(m.text)) { fails.push(s.tick); rolls.push(s.tick); if (food < below) dueFails.push(s.tick); }
            else if (/^You pick the/i.test(m.text)) rolls.push(s.tick);
            else if (/trade|busy/i.test(m.text)) tradeLines.push({ tick: s.tick, text: m.text.slice(0, 60) });
        }
        food = s.inventory.filter(i => /^shark$/i.test(i.name)).length;
        const r = s.opFeedback?.opRejectedCount ?? rejected;
        for (; rejected < r; rejected++) rejects.push(s.tick);
        const f = fails[fails.length - 1];
        if (f !== undefined && s.tick - f === 2) {
            const g = s.nearbyPlayers.find(p => sameName(p.name, giver));
            adjacentAt2[f] = !!g && g.distance <= 1;
            if (g && s.player) offsetAt2[f] = [g.x - s.player.worldX, g.z - s.player.worldZ];
        }
        const open = tradeOf(s).isOpen;
        if (open && !wasOpen) opens.push(s.tick);
        if (!open && wasOpen) closes.push(s.tick);
        wasOpen = open;
    });
    const summary = () => {
        // per failure: the gap to the next roll (11 is on time), and whether a trade opened inside it
        const rows = fails.map(f => {
            const next = rolls.find(r => r > f);
            const open = opens.find(o => o > f && (next === undefined || o < next));
            const close = open === undefined ? undefined : closes.find(c => c >= open);
            return { f, gap: next === undefined ? null : next - f, open: open === undefined ? null : open - f, close: close === undefined ? null : close - f };
        }).filter(r => r.gap !== null);
        const stat = (rs: typeof rows) => {
            const hist: Record<number, number> = {};
            for (const r of rs) hist[r.gap!] = (hist[r.gap!] ?? 0) + 1;
            return { stuns: rs.length, meanGap: rs.length ? +(rs.reduce((a, r) => a + r.gap!, 0) / rs.length).toFixed(2) : null, hist };
        };
        const top = rows.filter(r => r.open !== null);
        const other = stat(rows.filter(r => r.open === null));
        const topStat = stat(top);
        return {
            topUpStuns: topStat, otherStuns: other,
            costPerTopUp: topStat.meanGap !== null && other.meanGap !== null ? +(topStat.meanGap - other.meanGap).toFixed(2) : null,
            topUps: top.map(r => ({ f: r.f, open: r.open, close: r.close, gap: r.gap })),
            dueFails: dueFails.length,
            dueNotAdjacent: dueFails.filter(f => adjacentAt2[f] === false).length,
            dueDiagonal: dueFails.filter(f => offsetAt2[f] && offsetAt2[f]![0] !== 0 && offsetAt2[f]![1] !== 0).length,
            // per due failure, both sides' trade lines at their offset from it (the next 12 ticks)
            requestClicks: clicks.length,
            trace: dueFails.slice(0, 40).map(f => ({
                f,
                giverAt2: offsetAt2[f]?.join(',') ?? null,
                clicks: clicks.filter(t => t >= f && t <= f + 12).map(t => `+${t - f}`),
                rejected: rejects.filter(t => t >= f && t <= f + 12).map(t => `+${t - f}`),
                account: tradeLines.filter(l => l.tick >= f && l.tick <= f + 12).map(l => `+${l.tick - f} ${l.text}`),
                giver: giverEvents.filter(e => e.tick >= f && e.tick <= f + 12).map(e => `+${e.tick - f} ${e.ev}`),
                opened: opens.find(o => o >= f && o <= f + 12) ?? null
            }))
        };
    };
    return { stop: () => { un(); sdk.sendTradeRequest = send; }, summary };
}

switch (mode) {
    case 'setup': {
        await say('setvar tutorial 1000');
        if (!(await tele(sdk, 3222, 3222))) throw new Error('tele to Lumbridge failed');
        // Inside the tutorial there is no logout tab, so a clean logout is refused. The
        // engine's shutdown at the end of this lab logs the player out and saves it; the
        // next tickprog-lab.sh boot in the same checkout logs in with the side tabs set.
        result('setup', { tutorial: 1000, at: near(sdk.getState(), 3222, 3222, 1), next: 'run the lab again in this checkout' });
        await waitTicks(sdk, 5);
        break;
    }
    case 'fresh': {
        await clearInventory();
        for (const stat of ['thieving', 'hitpoints']) await say(`setstat ${stat} ${stat === 'hitpoints' ? 10 : 1}`);
        if (!(await tele(sdk, 3222, 3222))) throw new Error('tele to Lumbridge failed');
        const light = process.argv.includes('--light');
        await giveAll([...STARTER.filter(n => !light || !HEAVY.has(n)).map(n => [n, 1] as [string, number]), ...STARTER_STACKS, [`cert_${arg('kit-food', 'cake')}`, Number(arg('kit-n', '38'))], ['coins', Number(arg('coins', '100'))]]);
        await say('~energy');
        const p = sdk.getState()!.player!;
        result('fresh', { at: near(sdk.getState(), 3222, 3222, 1), inventory: sdk.getState()!.inventory.length, light, weight: p.runWeight, energy: p.runEnergy, runVarp: sdk.getState()!.varps?.option_run ?? null });
        const only = arg('only', '');
        // tickprog-lab.sh splits specs on ':', so --only names steps by the part after `thieving:`
        await runList(steps(opts()).filter(s => !only || only.split(',').some(o => s.name === `thieving:${o}`)), arg('from', '') || undefined);
        break;
    }
    case 'at': {
        await say(`setstat thieving ${arg('thieving', '55')}`);
        await say(`setstat hitpoints ${arg('hp', '10')}`);
        const cakes = Number(arg('cakes', '0'));
        if (cakes > 0) {
            await clearInventory();
            await giveAll(Array.from({ length: Math.min(cakes, 27) }, () => ['cake', 1] as [string, number]));
        }
        if (!(await tele(sdk, Number(arg('x', '2670')), Number(arg('z', '3305'))))) throw new Error('tele failed');
        result('at', { thieving: arg('thieving', '55'), hp: sdk.getState()!.player!.hp, cakes });
        await runList(steps(opts()), arg('from', '') || undefined);
        break;
    }
    case 'topup': {
        const helperBot = arg('helper', '');
        if (!helperBot) throw new Error('topup needs --helper=<bot> (HELPER=<bot> in tickprog-lab.sh)');
        const tuMode = arg('mode', 'idle') as 'idle' | 'restart';
        const below = Number(arg('below', '2'));
        const load = Number(arg('load', '1'));
        const helper = await openSession(helperBot, { launch: true, pathfinding: false });
        await helper.bot.skipTutorial().catch(() => {});
        await helper.sdk.sendSay('::~clearinv inv');
        await helper.sdk.sendSay(`::give shark ${load * 8}`);
        await say(`setstat thieving ${arg('thieving', '57')}`);
        await say(`setstat hitpoints ${arg('hp', '97')}`);
        await clearInventory();
        await giveAll([['shark', Number(arg('sharks', '2'))]]);
        if (!(await tele(sdk, 2670, 3305))) throw new Error('tele to the knights failed');
        const giver = helper.sdk.getState()?.player?.name ?? helperBot;
        const g = runGiver(helper, load);
        await waitUntil(sdk, s => s.nearbyPlayers.some(p => sameName(p.name, giver) && p.distance <= 1), { maxTicks: 30 });
        const track = trackTopUps(giver, below, g.events);
        result('topup', { ...where(), mode: tuMode, giver, below, load, hp: sdk.getState()!.player!.hp, thieving: arg('thieving', '57'), to: arg('to', '99') });
        try {
            const rows = await runList(steps({ ...opts(), food: 'shark', topUp: { giver, below, mode: tuMode } }).filter(s => s.name === 'thieving:knights'));
            const band = rows.find(r => r.step === 'thieving:knights');
            result(`topup ${tuMode} summary`, { bandTicks: band?.ticks ?? null, helperTeles: g.teles, ...track.summary() });
        } catch (e) {
            // a band that ran out of food still reports what its top-ups did
            result(`topup ${tuMode} summary`, { bandTicks: null, error: String(e), helperTeles: g.teles, ...track.summary() });
        } finally {
            track.stop();
            g.stop();
            await closeSession(helper);
        }
        break;
    }
    case 'steps':
        await runList(steps(opts()), arg('from', '') || undefined);
        break;
    case 'leg':
        await runList(steps(opts()).filter(s => s.name === 'thieving:to-ardougne'));
        break;
    default:
        throw new Error(`unknown mode ${mode}`);
}
await closeSession(session);
process.exit(0);
