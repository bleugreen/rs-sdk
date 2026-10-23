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
//            ::tele and answers the account's request with one shark offer. Both accounts leave
//            Tutorial Island through S00's skip first.
//   pack     S18 with the stun pack (rs/324): the account at post-Monkey Madness stats with Load 0
//            (stun-pack.md section 6), steps({ topUp, stunPack }) on the knights band, and the
//            helper stand-in as the courier: it brings dragon bones to fill, sharks back to 2, and
//            the adamant and rune arrowheads once each when the account is down to one tier.
//            --mode=idle|restart --helper=<bot> [--to=99 --below=2 --bones-below=3]
//            [--blood=500] the blood runes in Load 0 (S18's share: 30 at N = 100, stun-pack.md 15)
//            [--superheat[=1|2]] stunPack.superheat (stun-pack.md section 16): Load 0 carries 300
//            nature runes and ore in place of the bones (skills/thieving.ts superheatLoad, from
//            Smithing 1: copper and tin for the 12 bronze casts, then iron), the courier brings ore,
//            and the summary's `stuns` row classes every stun and gives the slip
//            [--stock=scored] the scored run's arrow stock (STEP-MANIFEST.md H14 and H14.x): 4,560
//            headless arrows and 1,485 mithril tips in Load 0, 2,220 adamant and 570 rune with the
//            courier, in place of the lab's rune-heavy 3,600 / 225 / 495 / 2,595; the summary's
//            `tiers` gives the tick each tier was first held and the stuns before it
// Both trade modes trace every request on the account's clock: the program's requests (its
// `stun:topup*` counters rising), the account's own trade lines, and the giver's 'wishes to trade',
// which the giver sees on its own tick and the trace moves onto the account's by the clocks' sampled
// offset (`clock` in the summary: the offset histogram, which is one value and its neighbours while
// no tick is dropped).
// Staging is outside the measured steps. Every step row and every pickpocket end status is
// printed as a RESULT line; the end statuses carry the gap histograms, skippedTicks, frames,
// publish, react and loops. Every run also samples the account each tick, and a leg run prints
// its sub-legs (`RESULT leg <name>`): ticks, tiles, ticks at 2, 1 and 0 steps, energy, weight.

import { hostname, loadavg } from 'os';
import { ChatHistory } from '../../sdk/chat-history';
import { FreshMessages } from '../../server/webclient/src/bot/programs/util';
import type { BotWorldState } from '../../sdk/types';
import type { ProgramStatus } from '../lib/programs';
import { programStatus } from '../lib/programs';
import { closeSession, openSession, type Session } from '../lib/session';
import { formatReport, report, TickLog, type TickRow } from '../lib/ticks';
import { clickBack, decideGiver, decideTradeClick, DROPPED_TICKS, newClickCtx, newGiverCtx, planOffers, sameName, sendTradeClick, tradeOf, type ClickCtx, type GiverCtx, type GiveSpec, type OfferEntry } from '../lib/trade';
import { waitTicks, waitUntil } from '../lib/wait';
import { runSteps } from '../runner/step';
import { FOODS, type FoodName, type LegMark, steps, superheatOre, type SuperheatOptions, type ThievingOptions, topUpAsk } from '../skills/thieving';
import { CueWriter, type CueScope } from '../helpers/altar-cue';
import { askOffer, BoneGiver } from '../helpers/bone-giver';
import { memoryRoleState, type RoleContext } from '../helpers/role';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { arg, result } from './common';
import { cheat, leaveTutorial, near, tele } from './setup';

const bot = process.argv[2] ?? '';
const mode = process.argv[3] ?? '';
if (!bot || !mode) throw new Error('usage: measure-thieving.ts <bot> setup|fresh|at|steps|leg [--k=v ...]');
const where = () => ({ host: hostname(), load: loadavg().map(l => +l.toFixed(1)), at: new Date().toISOString(), tickrate: process.env.NODE_TICKRATE ?? '' });

// the Thieving module writes the courier's ask to the cue directory: a scratch one, never the checkout's
process.env.RC_CUE_DIR ??= mkdtempSync(join(tmpdir(), 'thieving-cue-'));

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

/** Every program run's end status this process has seen (for the page-side `deferred` count). */
const endedPrograms: ProgramStatus[] = [];

const followPrograms = () => {
    const seen = new Set<number>();
    return sdk.onStateUpdate(s => {
        const st = programStatus(s) as ProgramStatus | null;
        if (!st || st.phase === 'running' || seen.has(st.runId)) return;
        seen.add(st.runId);
        endedPrograms.push(st);
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

/** What the stand-in offers when a trade opens (from both sides' states), and the ::give commands that restock it. */
interface GiverPolicy {
    load(hs: BotWorldState, account: BotWorldState | null): GiveSpec[];
    restock(hs: BotWorldState): string[];
}

const sharkGiver = (load: number): GiverPolicy => ({
    load: () => [{ item: /^shark$/i, n: load }],
    restock: hs => {
        const have = hs.inventory.filter(i => /^shark$/i.test(i.name)).length;
        return have < load * 4 ? [`give shark ${load * 8 - have}`] : [];
    }
});

/** A giver event on both clocks: `own` is the giver's tick, `tick` the account's (giver tick less the clock offset). */
export interface GiverEvent { tick: number; own: number; ev: string }

/**
 * Each client counts the server ticks it decoded since it started, so the giver's tick and the
 * account's differ by a fixed offset while neither drops a tick. `skew` samples it from both
 * sides: on a giver update (giver tick less the account's latest) and on an account update (the
 * giver's latest less the account tick). The side whose state arrived second reads the other's
 * current tick and the first reads the other's previous one, so the samples are the offset and
 * one either side of it, and the offset is the value both sides see most. It is taken from the
 * samples near each event, so a client that drops a tick moves it there and not run-wide.
 */
function clockOffset(skew: ReadonlyArray<{ own: number; d: number }>, own: number, near = 50): number | null {
    const counts = new Map<number, number>();
    for (const s of skew) if (Math.abs(s.own - own) <= near) counts.set(s.d, (counts.get(s.d) ?? 0) + 1);
    if (counts.size === 0) return skew.length && near < Infinity ? clockOffset(skew, own, Infinity) : null;
    return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
}

/**
 * The giver session's clock against the account's: samples `skew` on both sessions' updates (the
 * doc above) and moves a giver's events, stamped on its own ticks, onto the account's. One for the
 * lab stand-in and the run's courier alike.
 */
function giverClock(h: Session) {
    const skew: Array<{ own: number; d: number }> = [];
    let lastAccountTick = -1, lastGiverTick = -1;
    const unAccount = sdk.onStateUpdate(s => {
        if (!s?.inGame || s.tick === lastAccountTick) return;
        lastAccountTick = s.tick;
        const g = h.sdk.getState();
        if (g?.inGame) skew.push({ own: g.tick, d: g.tick - s.tick });
    });
    const unGiver = h.sdk.onStateUpdate(hs => {
        if (!hs?.inGame || hs.tick === lastGiverTick) return;
        lastGiverTick = hs.tick;
        const s = sdk.getState();
        if (s?.inGame) skew.push({ own: hs.tick, d: hs.tick - s.tick });
    });
    const onAccount = (own: number) => {
        const off = clockOffset(skew, own);
        return off === null ? null : own - off;
    };
    return {
        map: (raw: ReadonlyArray<{ tick: number; ev: string }>): GiverEvent[] => raw.flatMap(e => {
            const tick = onAccount(e.tick);
            return tick === null ? [] : [{ tick, own: e.tick, ev: e.ev }];
        }),
        summary: (raw: ReadonlyArray<{ tick: number; ev: string }>) => {
            const offsets: Record<number, number> = {};
            for (const k of skew) offsets[k.d] = (offsets[k.d] ?? 0) + 1;
            return { offsets, samples: skew.length, unmapped: raw.filter(e => onAccount(e.tick) === null).length };
        },
        stop: () => { unAccount(); unGiver(); }
    };
}

function runGiver(h: Session, policy: GiverPolicy): { stop: () => void; teles: number; events: Array<{ tick: number; ev: string }> } {
    let gctx: GiverCtx | null = null, plan: OfferEntry[] = [], lastTick = -1, lastTele = -100, lastStock = -100;
    let answer: { rc: ClickCtx; until: number } | null = null;
    const chat = new ChatHistory();
    chat.record(h.sdk.getState()?.gameMessages ?? []);
    const out = { teles: 0, stop: () => {}, events: [] as Array<{ tick: number; ev: string }> };
    const ev = (tick: number, e: string) => out.events.push({ tick, ev: e });
    const burst = () => { for (const e of plan) for (const a of e.amounts) void h.sdk.sendOfferItem(e.slot, a); void h.sdk.sendAcceptTrade(); };
    // an exception would otherwise vanish inside the SDK's listener and leave the trade hanging
    const step = (hs: BotWorldState) => {
        try {
            onState(hs);
        } catch (e) {
            ev(hs.tick, `error: ${String(e).slice(0, 200)}`);
        }
    };
    const onState = (hs: BotWorldState) => {
        if (!hs?.inGame || hs.tick === lastTick) return;
        lastTick = hs.tick;
        const s = sdk.getState();
        const account = s?.player?.name ?? bot;
        const fresh = chat.record(hs.gameMessages ?? []);
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
            answer = null;
            plan = planOffers(hs.inventory, policy.load(hs, s));
            ev(hs.tick, `open: ${plan.map(e => `${e.name} x${e.expected}`).join(', ') || 'nothing to offer'}`);
            gctx = newGiverCtx(account, hs.inventory, plan);
            const d = decideGiver(hs, gctx);
            gctx = d.next;
            if (d.action === 'burst') burst();
            return;
        }
        const stock = hs.tick - lastStock > 6 ? policy.restock(hs) : [];
        for (const c of stock.slice(0, 3)) void h.sdk.sendSay(`::${c}`);
        if (stock.length) lastStock = hs.tick;
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
    };
    out.stop = h.sdk.onStateUpdate(step);
    return out;
}

/**
 * The account's side of the top-up lab, from its own published state: every failure and roll by
 * its game message, the trade's open and close ticks, the food count, and whether the giver was
 * within 1 tile on each failure's +2 (the program's `player` action needs it). It also records
 * the tick of every trade request (the restart path's `openTrade` clicks; the idle path's go out
 * from the page program and show as its `stun:topup*` counters rising, on the first state that
 * carries the rise) and every server op rejection (UNSET_MAP_FLAG, which OpPlayerHandler sends for
 * a click from a delayed player). `giverEventsNow` is the giver's side on the account's clock.
 *
 * With `stock` (the pack) a stun is also due when the account holds fewer of what the pack tops
 * up (bones, or ore with superheat), and `topUpLog` is one row per due stun: the giver's tile
 * less the account's on +2 (the tick the program decides on) as side, corner, same tile, further
 * or unseen; the tick the request fired (idle: the program's `stun:topup*` counters rising;
 * restart: the module's request click); and whether the trade opened and completed (bones, ore
 * or sharks held went up across it).
 *
 * `stunStats` classes every stun by what its state showed between the failure and the next roll:
 * a superheat stun (Smithing xp rose, no trade), a bury stun (Prayer xp rose, no trade), a top-up
 * stun (a trade opened) or a dry one, each with and without a level-up page; the xp ticks' offsets
 * from the failure; and the slip, superheat stuns' mean failure-to-next less the dry and bury
 * stuns' (stun-pack.md section 16).
 */
function trackTopUps(giver: string, below: number, giverEventsNow: () => ReadonlyArray<GiverEvent>, stock?: { of: (s: BotWorldState) => number; below: number }) {
    const fails: number[] = [], rolls: number[] = [], opens: number[] = [], closes: number[] = [];
    const clicks: number[] = [], rejects: number[] = [];
    const send = sdk.sendTradeRequest.bind(sdk);
    sdk.sendTradeRequest = (...a: Parameters<typeof send>) => {
        clicks.push(sdk.getState()?.tick ?? -1);
        return send(...a);
    };
    let rejected = sdk.getState()?.opFeedback?.opRejectedCount ?? 0;
    /**
     * The account's trade lines (requests, refusals, sends) by tick, with the publication that first
     * carried each (`id`, its observationId), how many messages that publication brought (`of`) and
     * the line's place among them (`at`, from 0): a reader that keys on observationId alone keeps
     * only the first message of each publication.
     */
    const tradeLines: Array<{ tick: number; text: string; id: number | null; of: number; at: number; program: boolean; before: string[] }> = [];
    const dueFails: number[] = [], adjacentAt2: Record<number, boolean> = {};
    /** The giver's tile less the account's on each failure's +2: an op on a player reaches it only from a side, not a corner. */
    const offsetAt2: Record<number, [number, number]> = {};
    const chat = new ChatHistory();
    chat.record(sdk.getState()?.gameMessages ?? []);
    // The program's own reader beside the trace's, on the same states: `program` on a trade line
    // says whether the pickpocket program's FreshMessages surfaced it too.
    const programReader = new FreshMessages(sdk.getState() as never);
    let last = -1, wasOpen = false, food = Infinity;
    const bonesOf = (s: BotWorldState) => s.inventory.filter(i => /bones$/i.test(i.name)).reduce((a, i) => a + i.count, 0);
    const oreOf = (s: BotWorldState) => s.inventory.filter(i => /^(iron|copper|tin) ore$/i.test(i.name)).length;
    const supplies = (s: BotWorldState) => bonesOf(s) + oreOf(s) + s.inventory.filter(i => /^shark$/i.test(i.name)).length;
    /** Ticks on which a skill's xp rose, and ticks with a dialogue (a level-up page) open. */
    const xpTicks: Record<'smithing' | 'prayer' | 'magic' | 'fletching', number[]> = { smithing: [], prayer: [], magic: [], fletching: [] };
    const xpLast: Record<string, number> = {};
    const pageTicks: number[] = [];
    /** Due stuns (by the +2 state, which is what the program's `fewer` reads), program request ticks, and supplies across each trade. */
    const due: number[] = [], requests: number[] = [], trades: Array<{ open: number; close: number | null; before: number; after: number | null }> = [];
    let reqRun = -1, reqSeen = 0;
    /** Ticks a bone left the pack (a bury; a trade only adds bones). */
    const buries: number[] = [];
    let bonesWas = -1;
    /** The first tick each arrowtip tier was held, and base Fletching then (the courier's tiers arrive by trade). */
    const tierSeen: Record<string, { tick: number; fletching: number }> = {};
    const un = sdk.onStateUpdate((s: BotWorldState) => {
        if (s.tick === last) return;
        last = s.tick;
        for (const k of Object.keys(xpTicks) as Array<keyof typeof xpTicks>) {
            const xp = s.skills.find(x => x.name.toLowerCase() === k)?.experience;
            if (xp === undefined) continue;
            if (xpLast[k] !== undefined && xp > xpLast[k]!) xpTicks[k].push(s.tick);
            xpLast[k] = xp;
        }
        if (s.dialog?.isOpen) pageTicks.push(s.tick);
        const b = bonesOf(s);
        if (bonesWas >= 0) for (let k = b; k < bonesWas; k++) buries.push(s.tick);
        bonesWas = b;
        for (const i of s.inventory) {
            const tier = /^(\w+) arrow(head|tip)s$/i.exec(i.name)?.[1]?.toLowerCase();
            if (tier && !tierSeen[tier]) tierSeen[tier] = { tick: s.tick, fletching: s.skills.find(k => k.name.toLowerCase() === 'fletching')?.baseLevel ?? 1 };
        }
        const st = programStatus(s);
        if (st && st.name === 'pickpocket') {
            const n = (st.counters['stun:topup'] ?? 0) + (st.counters['stun:topup:bones'] ?? 0) + (st.counters['stun:topup:ore'] ?? 0);
            if (st.runId !== reqRun) { reqRun = st.runId; reqSeen = 0; }
            for (; reqSeen < n; reqSeen++) requests.push(s.tick);
        }
        const fresh = chat.record(s.gameMessages ?? []);
        const programFresh = programReader.take(s as never);
        for (const m of fresh) {
            if (/You fail to pick/i.test(m.text)) { fails.push(s.tick); rolls.push(s.tick); if (food < below) dueFails.push(s.tick); }
            else if (/^You pick the/i.test(m.text)) rolls.push(s.tick);
            else if (/trade|busy/i.test(m.text)) {
                const pub = fresh.filter(o => o.observationId === m.observationId);
                const program = programFresh.some(o => o.observationId === m.observationId && o.text === m.text);
                tradeLines.push({ tick: s.tick, text: m.text.slice(0, 60), id: m.observationId ?? null, of: pub.length, at: pub.indexOf(m), program, before: pub.slice(0, pub.indexOf(m)).map(o => o.text.slice(0, 40)) });
            }
        }
        food = s.inventory.filter(i => /^shark$/i.test(i.name)).length;
        const r = s.opFeedback?.opRejectedCount ?? rejected;
        for (; rejected < r; rejected++) rejects.push(s.tick);
        const f = fails[fails.length - 1];
        if (f !== undefined && s.tick - f === 2) {
            const g = s.nearbyPlayers.find(p => sameName(p.name, giver));
            adjacentAt2[f] = !!g && g.distance <= 1;
            if (g && s.player) offsetAt2[f] = [g.x - s.player.worldX, g.z - s.player.worldZ];
            if (stock !== undefined && (food < below || stock.of(s) < stock.below)) due.push(f);
        }
        const open = tradeOf(s).isOpen;
        if (open && !wasOpen) { opens.push(s.tick); trades.push({ open: s.tick, close: null, before: supplies(s), after: null }); }
        if (!open && wasOpen) {
            closes.push(s.tick);
            const t = trades[trades.length - 1];
            if (t && t.close === null) { t.close = s.tick; t.after = supplies(s); }
        }
        wasOpen = open;
    });
    const summary = () => {
        // per failure: the gap to the next roll (11 is on time), and whether a trade opened inside it
        const rows = fails.map(f => {
            const next = rolls.find(r => r > f);
            const open = opens.find(o => o > f && (next === undefined || o < next));
            const close = open === undefined ? undefined : closes.find(c => c >= open);
            // rs/158's measure for the standing request: bones buried after the trade closed, still in this stun
            const buried = close === undefined ? 0 : buries.filter(t => t > close && (next === undefined || t < next)).length;
            return { f, gap: next === undefined ? null : next - f, open: open === undefined ? null : open - f, close: close === undefined ? null : close - f, buried };
        }).filter(r => r.gap !== null);
        const stat = (rs: typeof rows) => {
            const hist: Record<number, number> = {};
            for (const r of rs) hist[r.gap!] = (hist[r.gap!] ?? 0) + 1;
            const mean = rs.length ? rs.reduce((a, r) => a + r.gap!, 0) / rs.length : null;
            const sd = mean !== null && rs.length > 1 ? Math.sqrt(rs.reduce((a, r) => a + (r.gap! - mean) ** 2, 0) / (rs.length - 1)) : null;
            return { stuns: rs.length, meanGap: mean === null ? null : +mean.toFixed(2), sdGap: sd === null ? null : +sd.toFixed(2), hist };
        };
        const top = rows.filter(r => r.open !== null);
        const other = stat(rows.filter(r => r.open === null && !dueFails.includes(r.f)));
        const topStat = stat(top);
        // a stun's window: its failure to +12, cut at the next failure so two stuns never share a tick
        const inStun = (t: number, f: number) => {
            const next = fails.find(x => x > f);
            return t >= f && t <= f + 12 && (next === undefined || t < next);
        };
        const giverEvents = giverEventsNow();
        const wishes = giverEvents.filter(e => e.ev === 'wishes to trade').map(e => e.tick);
        const sentLines = tradeLines.filter(l => /^sending trade offer/i.test(l.text)).map(l => l.tick);
        // per due failure: the request (the program's or the module's click), what the engine ran, and the trade
        const perDue = dueFails.map(f => ({
            f,
            requested: [...requests, ...clicks].some(t => inStun(t, f)),
            wishes: wishes.filter(t => inStun(t, f)).length,
            sent: sentLines.filter(t => inStun(t, f)).length,
            opened: opens.some(o => inStun(o, f)),
            gap: rows.find(r => r.f === f)?.gap ?? null
        }));
        const missed = rows.filter(r => r.open === null && dueFails.includes(r.f));
        const missedStat = stat(missed);
        return {
            allStuns: stat(rows), topUpStuns: topStat, otherStuns: other, missedDueStuns: missedStat,
            costPerTopUp: topStat.meanGap !== null && other.meanGap !== null ? +(topStat.meanGap - other.meanGap).toFixed(2) : null,
            costPerMissedStun: missedStat.meanGap !== null && other.meanGap !== null ? +(missedStat.meanGap - other.meanGap).toFixed(2) : null,
            topUps: top.map(r => ({ f: r.f, open: r.open, close: r.close, gap: r.gap, buried: r.buried })),
            topUpStunsBurying: top.filter(r => r.buried > 0).length,
            bonesPerTopUpStun: top.length ? +(top.reduce((a, r) => a + r.buried, 0) / top.length).toFixed(2) : null,
            programRequests: requests.length, giverWishes: wishes.length, accountSent: sentLines.length,
            // the account's "Sending trade offer..." lines that a reader keying on observationId alone would drop
            accountSentShared: tradeLines.filter(l => /^sending trade offer/i.test(l.text) && l.at > 0).length,
            // the same lines as the pickpocket program's FreshMessages surfaced them, on the same states
            programSent: tradeLines.filter(l => /^sending trade offer/i.test(l.text) && l.program).length,
            dueRequested: perDue.filter(d => d.requested).length,
            dueLanded: perDue.filter(d => d.opened).length,
            // a stun whose partner saw 'wishes to trade' twice, or whose account the engine answered twice
            doubleRequests: perDue.filter(d => d.wishes > 1 || d.sent > 1).length,
            // every 'wishes to trade' outside a due stun's window (a request the trace did not expect)
            strayWishes: wishes.filter(t => !dueFails.some(f => inStun(t, f))).length,
            dueFails: dueFails.length,
            dueNotAdjacent: dueFails.filter(f => adjacentAt2[f] === false).length,
            dueDiagonal: dueFails.filter(f => offsetAt2[f] && offsetAt2[f]![0] !== 0 && offsetAt2[f]![1] !== 0).length,
            // per due failure, both sides' trade lines at their offset from it (the next 12 ticks)
            requestClicks: clicks.length,
            trace: dueFails.slice(0, 60).map(f => ({
                f,
                giverAt2: offsetAt2[f]?.join(',') ?? null,
                requests: requests.filter(t => inStun(t, f)).map(t => `+${t - f}`),
                gap: rows.find(r => r.f === f)?.gap ?? null,
                clicks: clicks.filter(t => t >= f && t <= f + 12).map(t => `+${t - f}`),
                rejected: rejects.filter(t => t >= f && t <= f + 12).map(t => `+${t - f}`),
                account: tradeLines.filter(l => inStun(l.tick, f)).map(l => `+${l.tick - f} ${l.text} [o${l.id ?? '-'} ${l.at + 1}/${l.of}${l.program ? '' : ' unseen by program'}${l.before.length ? ` after: ${l.before.join(' | ')}` : ''}]`),
                giver: giverEvents.filter(e => inStun(e.tick, f)).map(e => `+${e.tick - f} ${e.ev}`),
                opened: opens.find(o => o >= f && o <= f + 12) ?? null
            }))
        };
    };
    /** stun-pack.md section 3's measures: the success gap, the failure to the next roll, and the run normalised to 84.2 failures. */
    const rollStats = () => {
        const failSet = new Set(fails);
        const gaps = (pick: (t: number) => boolean) => rolls.map((t, i) => (pick(t) && i + 1 < rolls.length ? rolls[i + 1]! - t : null)).filter((g): g is number => g !== null);
        const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
        const sg = gaps(t => !failSet.has(t)), fg = gaps(t => failSet.has(t));
        const successes = rolls.length - fails.length;
        return {
            rolls: rolls.length, successes, failures: fails.length, firstToLastRoll: rolls.length > 1 ? rolls[rolls.length - 1]! - rolls[0]! : 0,
            successGap: +mean(sg).toFixed(3), failToNext: +mean(fg).toFixed(3), normalised: Math.round(successes * mean(sg) + 84.2 * mean(fg))
        };
    };
    /** rs/158's per-top-up record (the doc above): one row per due stun, and the counts by giver tile. */
    const topUpLog = () => {
        const giverEvents = giverEventsNow();
        const tile = (o: [number, number] | undefined) => {
            if (!o) return 'unseen';
            const [dx, dz] = o.map(Math.abs) as [number, number];
            return dx + dz === 0 ? 'same' : dx + dz === 1 ? 'side' : dx === 1 && dz === 1 ? 'corner' : 'further';
        };
        const within = (ts: readonly number[], f: number, a: number, b: number) => ts.find(t => t >= f + a && t <= f + b);
        const rows = due.map(f => {
            const req = within([...requests, ...clicks], f, 0, 8);
            const tr = trades.find(t => t.open >= f && t.open <= f + 12);
            return {
                f, giverAt2: offsetAt2[f]?.join(',') ?? null, tile: tile(offsetAt2[f]),
                fired: req === undefined ? null : req - f,
                opened: tr ? tr.open - f : null, closed: tr?.close != null ? tr.close - f : null, completed: !!tr && tr.after !== null && tr.after > tr.before,
                giver: giverEvents.filter(e => e.tick >= f && e.tick <= f + 16).map(e => `+${e.tick - f} ${e.ev}`)
            };
        });
        const by = (k: string) => rows.filter(r => r.tile === k).length;
        return {
            due: rows.length, side: by('side'), corner: by('corner'), same: by('same'), further: by('further'), unseen: by('unseen'),
            fired: rows.filter(r => r.fired !== null).length,
            opened: rows.filter(r => r.opened !== null).length, completed: rows.filter(r => r.completed).length,
            requestsSeen: requests.length + clicks.length, trades: trades.length,
            lostOnCorner: rows.filter(r => r.tile === 'corner' && !r.completed).length,
            rows
        };
    };
    /** Every completed stun, classed (the doc above). */
    const stunRows = () => {
        const inStun = (ts: readonly number[], f: number, next: number) => ts.filter(t => t > f && t < next);
        return fails.map(f => {
            const next = rolls.find(r => r > f);
            if (next === undefined) return null;
            const casts = inStun(xpTicks.smithing, f, next), buries = inStun(xpTicks.prayer, f, next);
            const trade = opens.some(o => o > f && o < next);
            const pages = inStun(pageTicks, f, next);
            const page = pages.length > 0;
            const kind = trade ? 'topup' : casts.length ? 'superheat' : buries.length ? 'bury' : 'dry';
            return { f, gap: next - f, kind, page, pageFrom: page ? pages[0]! - f : null, casts: casts.map(t => t - f), buries: buries.map(t => t - f) };
        }).filter((r): r is NonNullable<typeof r> => r !== null);
    };
    /** Each arrowtip tier's first tick held, base Fletching then, and the stuns (all, and superheat) before it. */
    const tierArrivals = () => {
        const rows = stunRows();
        return Object.fromEntries(Object.entries(tierSeen).map(([t, a]) => [t, { ...a, stunsBefore: rows.filter(r => r.f < a.tick).length, superheatStunsBefore: rows.filter(r => r.f < a.tick && r.kind === 'superheat').length }]));
    };
    /** The stuns by class (the doc above) and the slip per superheat stun. */
    const stunStats = () => {
        const rows = stunRows();
        const mean = (a: number[]) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : null);
        const hist = (a: number[]) => { const h: Record<number, number> = {}; for (const v of a) h[v] = (h[v] ?? 0) + 1; return h; };
        const cls = (pick: (r: (typeof rows)[number]) => boolean) => {
            const rs = rows.filter(pick);
            return { n: rs.length, meanGap: mean(rs.map(r => r.gap)), gaps: hist(rs.map(r => r.gap)) };
        };
        const byKind: Record<string, ReturnType<typeof cls>> = {};
        for (const k of ['superheat', 'bury', 'dry', 'topup']) {
            byKind[k] = cls(r => r.kind === k);
            byKind[`${k}:page`] = cls(r => r.kind === k && r.page);
            byKind[`${k}:noPage`] = cls(r => r.kind === k && !r.page);
        }
        const sh = byKind.superheat!, ref = cls(r => r.kind === 'dry' || r.kind === 'bury');
        const shNo = byKind['superheat:noPage']!, refNo = cls(r => (r.kind === 'dry' || r.kind === 'bury') && !r.page);
        return {
            byKind,
            castsPerSuperheatStun: hist(rows.filter(r => r.kind === 'superheat').map(r => r.casts.length)),
            // the offset a page first showed, and the stun's gap, per class: a page first seen late keeps the attempt waiting
            pageFrom: Object.fromEntries(['superheat', 'bury', 'dry'].map(k => [k, hist(rows.filter(r => r.kind === k && r.pageFrom !== null).map(r => r.pageFrom!))])),
            gapByPageFrom: Object.fromEntries(['superheat', 'bury', 'dry'].map(k => {
                const by: Record<number, number[]> = {};
                for (const r of rows.filter(x => x.kind === k && x.pageFrom !== null)) (by[r.pageFrom!] ??= []).push(r.gap);
                return [k, Object.fromEntries(Object.entries(by).map(([o, g]) => [o, { n: g.length, meanGap: mean(g) }]))];
            })),
            castOffsets: hist(rows.flatMap(r => r.casts)),
            buryOffsets: hist(rows.filter(r => r.kind !== 'topup').flatMap(r => r.buries)),
            topUpBuryOffsets: hist(rows.filter(r => r.kind === 'topup').flatMap(r => r.buries)),
            slip: sh.meanGap !== null && ref.meanGap !== null ? +(sh.meanGap - ref.meanGap).toFixed(3) : null,
            slipNoPage: shNo.meanGap !== null && refNo.meanGap !== null ? +(shNo.meanGap - refNo.meanGap).toFixed(3) : null,
            reference: { n: ref.n, meanGap: ref.meanGap, noPage: refNo }
        };
    };
    return { stop: () => { un(); sdk.sendTradeRequest = send; }, summary, rollStats, topUpLog, stunStats, tierArrivals };
}

/**
 * The pack's courier stand-in (stun-pack.md sections 5 and 6): at each trade it reads the account's
 * state as the trade opens and offers what the Thieving module's ask names (thieving.ts topUpAsk, the
 * sizing the run's courier gets through the cue directory). It keeps 22 bones, 2 sharks and the
 * arrowheads still due, by ::give. `--courier=role` runs the run's courier itself instead
 * (bone-giver.ts, mode on-request; courierRole below).
 *
 * With `superheat` the ask carries ore in place of bones (thieving.ts topUpAsk, superheatOre): copper and
 * tin pairs while bronze casts are due before Smithing 15, iron ore in the rest. The stand-in keeps the
 * account's next load by ::give, copper and tin at exactly the ask so they go as All (one X a trade,
 * the iron), and clears its pack when it holds ore no load still wants.
 */
const ORE_DEBUG: Record<string, string> = { 'copper ore': 'copper_ore', 'tin ore': 'tin_ore', 'iron ore': 'iron_ore' };

/** The ore a load for the account's state brings, as counts to give (thieving.ts superheatOre). */
function oreLoad(s: BotWorldState, free: number): Array<{ name: string; n: number }> {
    return superheatOre(s, free).map(l => ({ name: l.name, n: l.give })).filter(e => e.n > 0);
}

/** The courier's adamant and rune tips: the lab's rune-heavy stock, or the scored run's (`--stock=scored`). */
interface CourierTips {
    adamant: number;
    rune: number;
}
const LAB_TIPS: CourierTips = { adamant: 495, rune: 2595 };
const SCORED_TIPS: CourierTips = { adamant: 2220, rune: 570 };

function courier(tips: CourierTips, superheat?: Required<SuperheatOptions>): GiverPolicy {
    const mem = { tiers: new Set<string>() };
    return {
        load: (hs, s) => (s ? askOffer({ items: topUpAsk(s, FOODS.shark, true, mem, superheat) }, hs.inventory).specs : []),
        restock: hs => {
            const n = (re: RegExp) => hs.inventory.filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
            let ore: string[] = [];
            if (superheat) {
                const s = sdk.getState();
                // the account's next full load (its pack less sharks, arrowheads, coins and the arrow
                // product: 16 slots), counting the bronze casts its held copper and tin still cover
                const want = s ? oreLoad(s, 28 - 10 - 2) : [];
                const target = (name: string) => want.find(e => e.name === name)?.n ?? 0;
                // copper and tin exactly at the next load (offered as All), iron only while a load wants it
                const stale = Object.keys(ORE_DEBUG).some(name => (name === 'iron ore' ? target(name) === 0 : n(new RegExp(`^${name}$`, 'i')) > target(name)) && n(new RegExp(`^${name}$`, 'i')) > 0);
                if (stale) return ['~clearinv inv'];
                const free = 28 - hs.inventory.length;
                let room = free;
                ore = Object.entries(ORE_DEBUG).flatMap(([name, debug]) => {
                    const give = Math.min(room, target(name) - n(new RegExp(`^${name}$`, 'i')));
                    if (give <= 0) return [];
                    room -= give;
                    return [`give ${debug} ${give}`];
                });
            }
            return [
                ...ore,
                ...(!superheat && n(/^dragon bones$/i) < 22 ? [`give dragon_bones ${22 - n(/^dragon bones$/i)}`] : []),
                ...(n(/^shark$/i) < 2 ? [`give shark ${2 - n(/^shark$/i)}`] : []),
                ...(!mem.tiers.has('adamant') && n(/^adamant arrow(head|tip)s$/i) === 0 ? [`give adamant_arrowheads ${tips.adamant}`] : []),
                ...(!mem.tiers.has('rune') && n(/^rune arrow(head|tip)s$/i) === 0 ? [`give rune_arrowheads ${tips.rune}`] : [])
            ];
        }
    };
}

/** The courier's S18 side tile among the knights; it re-steps beside the account from there. */
const COURIER_SITE = { giver: { x: 2671, z: 3305 }, receiver: { x: 2670, z: 3305 } };

/**
 * The run's courier (bone-giver.ts, mode on-request) on the helper's session, in this process: the
 * cue names the account by hash, the module's TopUpAsker writes each ask, and the courier restocks
 * by ::give (restock kind cheat). Its log lines and trade messages are `events`, for the trace.
 */
function courierRole(h: Session, helperBot: string, scored: string, standing: boolean, tips: CourierTips) {
    const dir = process.env.RC_CUE_DIR!;
    process.env.HELPER_LAB_TELE = '1';
    // a launched role has its bot.env's SERVER; restock kind cheat checks it is the local lab
    process.env.SERVER ??= `localhost:${process.env.WEB_PORT ?? ''}`;
    const s0 = sdk.getState()!;
    const scope: CueScope = { step: 'S18', family: 'courier' };
    new CueWriter(dir, scored, scope).write({ beacons: [{ tick: s0.tick, ms: Date.now() }], turns: [] });
    const events: Array<{ tick: number; ev: string }> = [];
    const tick = () => h.sdk.getState()?.tick ?? -1;
    // ChatHistory, as runGiver's reader: messages first seen on one tick share an observationId, so a
    // reader keyed on the id alone keeps only the first of them (rs/352, rs/356)
    const chat = new ChatHistory();
    chat.record(h.sdk.getState()?.gameMessages ?? []);
    const unMsg = h.sdk.onStateUpdate(hs => {
        for (const m of chat.record(hs.gameMessages ?? [])) {
            if (/wishes to trade|busy at the moment|^sending trade offer/i.test(m.text)) events.push({ tick: hs.tick, ev: m.text.replace(/^.*(wishes to trade|busy|sending trade offer).*$/i, '$1').toLowerCase() });
        }
    });
    const ac = new AbortController();
    const options = {
        mode: 'on-request', item: 'Babydragon bones', hold: 22, refillBelow: 21, standing, scope,
        restock: { kind: 'cheat' }, sites: [COURIER_SITE],
        carry: [{ item: 'Shark', count: 2, obj: 'shark' }, { item: 'Adamant arrowtips', count: tips.adamant, obj: 'adamant_arrowheads', once: true }, { item: 'Rune arrowtips', count: tips.rune, obj: 'rune_arrowheads', once: true }]
    };
    const ctx: RoleContext = {
        bot: h.bot, sdk: h.sdk, account: helperBot, options, signal: ac.signal, state: memoryRoleState(), reportBank: () => {},
        log: (message, data) => {
            events.push({ tick: tick(), ev: `${message} ${JSON.stringify(data ?? {})}`.slice(0, 240) });
        }
    } as RoleContext;
    const done = new BoneGiver(ctx).run().catch(e => events.push({ tick: tick(), ev: `role error ${String(e).slice(0, 200)}` }));
    return {
        events,
        teles: 0,
        stop: async () => {
            ac.abort();
            await Promise.race([done, Bun.sleep(15_000)]);
            unMsg();
        }
    };
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
        await leaveTutorial(session);
        const helper = await openSession(helperBot, { launch: true, pathfinding: false });
        await leaveTutorial(helper);
        await helper.sdk.sendSay('::~clearinv inv');
        await helper.sdk.sendSay(`::give shark ${load * 8}`);
        await say(`setstat thieving ${arg('thieving', '57')}`);
        await say(`setstat hitpoints ${arg('hp', '97')}`);
        await clearInventory();
        await giveAll([['shark', Number(arg('sharks', '2'))]]);
        if (!(await tele(sdk, 2670, 3305))) throw new Error('tele to the knights failed');
        const giver = helper.sdk.getState()?.player?.name ?? helperBot;
        const g = runGiver(helper, sharkGiver(load));
        await waitUntil(sdk, s => s.nearbyPlayers.some(p => sameName(p.name, giver) && p.distance <= 1), { maxTicks: 30 });
        const clk = giverClock(helper);
        const track = trackTopUps(giver, below, () => clk.map(g.events));
        const clock = () => ({ clock: clk.summary(g.events) });
        result('topup', { ...where(), mode: tuMode, giver, below, load, hp: sdk.getState()!.player!.hp, thieving: arg('thieving', '57'), to: arg('to', '99') });
        try {
            const rows = await runList(steps({ ...opts(), food: 'shark', topUp: { giver, below, mode: tuMode } }).filter(s => s.name === 'thieving:knights'));
            const band = rows.find(r => r.step === 'thieving:knights');
            // the module's receiver: a trade that closed without the food arriving is a closed trade
            const trades = ((rows.find(r => r.step === 'thieving:knights:detail')?.meta as { topUp?: { trades?: Array<{ ok: boolean; reason?: string }> } } | undefined)?.topUp?.trades) ?? [];
            result(`topup ${tuMode} summary`, { bandTicks: band?.ticks ?? null, helperTeles: g.teles, trades: trades.length, closedTrades: trades.filter(t => !t.ok).map(t => t.reason ?? 'closed'), ...clock(), ...track.rollStats(), ...track.summary() });
        } catch (e) {
            // a band that ran out of food still reports what its top-ups did
            result(`topup ${tuMode} summary`, { bandTicks: null, error: String(e), helperTeles: g.teles, ...clock(), ...track.rollStats(), ...track.summary() });
        } finally {
            track.stop();
            clk.stop();
            g.stop();
            await closeSession(helper);
        }
        break;
    }
    case 'pack': {
        const helperBot = arg('helper', '');
        if (!helperBot) throw new Error('pack needs --helper=<bot> (HELPER=<bot> in tickprog-lab.sh)');
        const tuMode = arg('mode', 'idle') as 'idle' | 'restart';
        const below = Number(arg('below', '2'));
        const bonesBelow = Number(arg('bones-below', '3'));
        const blood = Number(arg('blood', '500'));
        const shFlag = process.argv.find(a => a === '--superheat' || a.startsWith('--superheat='));
        const casts = shFlag ? Number(shFlag.split('=')[1] ?? '2') : 0;
        // --courier=role: the run's courier (bone-giver.ts) instead of the stand-in; --standing turns on its standing request
        const asRole = arg('courier', 'standin') === 'role';
        const standing = process.argv.includes('--standing');
        const stock = arg('stock', 'lab');
        if (stock !== 'lab' && stock !== 'scored') throw new Error(`--stock is lab or scored, not ${stock}`);
        const tips = stock === 'scored' ? SCORED_TIPS : LAB_TIPS;
        if (asRole && casts) throw new Error("pack --courier=role --superheat: the run's courier carries no ore yet (rs/41 stages it), so this lab runs with the stand-in only");
        const helper = await openSession(helperBot, { launch: true, pathfinding: asRole });
        await leaveTutorial(helper);
        await helper.sdk.sendSay('::~clearinv inv');
        // staging, off the clock: SCORED after Monkey Madness and the Mage Arena (stun-pack.md section 3)
        await leaveTutorial(session);
        for (const [k, v] of [['hitpoints', 97], ['defence', 89], ['prayer', 43], ['magic', 80], ['fletching', 1], ['thieving', 57], ['attack', 70], ['strength', 70], ['ranged', 70], ['smithing', 1]] as const) await say(`setstat ${k} ${v}`);
        await say('setvar magearena 8');
        await clearInventory();
        await giveAll([['staff_of_fire', 1]]);
        const staff = sdk.getState()!.inventory.find(i => /^staff of fire$/i.test(i.name))!;
        await sdk.sendUseItem(staff.slot, staff.optionsWithIndex.find(o => /wield/i.test(o.text))?.opIndex ?? 2);
        await waitUntil(sdk, s => s.equipment.some(i => /^staff of fire$/i.test(i.name)), { maxTicks: 5 });
        // Load 0 (H14): runes for 163 casts (or --blood), headless arrows, bronze to mithril arrowheads, 2 sharks;
        // with superheat its nature runes too
        const load0: Array<[string, number]> = [['bloodrune', blood], ['airrune', 500], ...(casts ? [['naturerune', 300] as [string, number]] : []), ['headless_arrow', stock === 'scored' ? 4560 : 3600], ['bronze_arrowheads', 60], ['iron_arrowheads', 90], ['steel_arrowheads', 135], ['mithril_arrowheads', stock === 'scored' ? 1485 : 225], ['shark', 2]];
        await giveAll(load0.filter(([, n]) => n > 0));
        if (!(await tele(sdk, 2670, 3305))) throw new Error('tele to the knights failed');
        // every free slot less one for coins and one for a new arrow product stack: bones, or the superheat ore
        const fill = 28 - sdk.getState()!.inventory.length - 2;
        if (casts) for (const e of oreLoad(sdk.getState()!, fill)) await say(`give ${ORE_DEBUG[e.name]} ${e.n}`);
        else await say(`give dragon_bones ${fill}`);
        await waitTicks(sdk, 2);
        while (sdk.getState()!.dialog?.isOpen) { await sdk.sendClickDialog(0); await waitTicks(sdk, 1); }
        const giver = helper.sdk.getState()?.player?.name ?? helperBot;
        const g = asRole ? courierRole(helper, helperBot, sdk.getState()!.player!.name, standing, tips) : runGiver(helper, courier(tips, casts ? { casts, oreBelow: casts } : undefined));
        await waitUntil(sdk, s => s.nearbyPlayers.some(p => sameName(p.name, giver) && Math.abs(p.x - s.player!.worldX) + Math.abs(p.z - s.player!.worldZ) === 1), { maxTicks: asRole ? 200 : 40 });
        const oreHeldNow = (s: BotWorldState) => s.inventory.filter(i => /^(iron|copper) ore$/i.test(i.name)).length;
        const clk = giverClock(helper);
        const track = trackTopUps(giver, below, () => clk.map(g.events), casts ? { of: oreHeldNow, below: casts } : { of: s => s.inventory.filter(i => /bones$/i.test(i.name)).reduce((a, i) => a + i.count, 0), below: bonesBelow });
        const s0 = sdk.getState()!;
        const bloodOf = (s: BotWorldState | null) => (s?.inventory ?? []).filter(i => /^blood runes?$/i.test(i.name)).reduce((a, i) => a + i.count, 0);
        const levels = (s: BotWorldState | null) => Object.fromEntries(['magic', 'fletching', 'smithing', 'thieving'].map(k => [k, s?.skills.find(x => x.name.toLowerCase() === k)?.baseLevel ?? null]));
        const blood0 = bloodOf(sdk.getState());
        result('pack', { ...where(), mode: tuMode, giver, courier: asRole ? (standing ? 'role, standing' : 'role') : 'stand-in', stock, tips, below, bonesBelow, blood, superheat: casts || false, hp: s0.player!.hp, inventory: s0.inventory.map(i => `${i.name}x${i.count}`), equipment: s0.equipment.map(i => i.name) });
        const stunPack = casts ? { chargeUnlocked: true, superheat: { casts } } : { bonesBelow, chargeUnlocked: true };
        try {
            const rows = await runList(steps({ to: Number(arg('to', '99')), food: 'shark', topUp: { giver, below, mode: tuMode }, stunPack }).filter(s => s.name === 'thieving:knights'));
            const band = rows.find(r => r.step === 'thieving:knights');
            const detail = rows.find(r => r.step === 'thieving:knights:detail')?.meta as { runs?: Array<{ startedTick: number; endedTick?: number }>; pack?: unknown } | undefined;
            const programTicks = (detail?.runs ?? []).reduce((a, r) => a + ((r.endedTick ?? r.startedTick) - r.startedTick), 0);
            const programDeferred = endedPrograms.reduce((a, st) => a + (st.deferred ?? 0), 0);
            const end = sdk.getState();
            result(`pack ${tuMode} summary`, { bandTicks: band?.ticks ?? null, ok: band?.ok ?? false, programTicks, programDeferred, end: levels(end), bloodUsed: blood0 - bloodOf(end), tiers: track.tierArrivals(), ...track.rollStats(), pack: detail?.pack ?? null, topUpTrades: (detail as { topUp?: unknown } | undefined)?.topUp ?? null, helperTeles: g.teles, clock: clk.summary(g.events), ...track.summary() });
            result(`pack ${tuMode} topups`, track.topUpLog());
            result(`pack ${tuMode} stuns`, track.stunStats());
        } catch (e) {
            result(`pack ${tuMode} summary`, { bandTicks: null, error: String(e), end: levels(sdk.getState()), bloodUsed: blood0 - bloodOf(sdk.getState()), tiers: track.tierArrivals(), helperTeles: g.teles, clock: clk.summary(g.events), ...track.rollStats(), ...track.summary() });
            result(`pack ${tuMode} topups`, track.topUpLog());
            result(`pack ${tuMode} stuns`, track.stunStats());
        } finally {
            // the giver's own ticks (its client counts from its login, not the account's)
            result(`pack ${tuMode} giver`, { accountTick: sdk.getState()?.tick, giverTick: helper.sdk.getState()?.tick, events: g.events.slice(-40) });
            track.stop();
            clk.stop();
            await g.stop();
            if (asRole) result(`pack ${tuMode} courier`, { events: g.events.filter(e => !/^(wishes to trade|busy|sending trade offer)$/.test(e.ev)).slice(-150) });
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
