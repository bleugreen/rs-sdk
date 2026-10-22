import { describe, expect, test } from 'bun:test';

import '../../lite/test-support/browser-globals.js';

import { createRcCycle, cycleTicks, scoredSteps, type RcShared, type TurnResult } from './rc-cycle.js';
import { Harness, makeState } from './testkit.js';

/**
 * A deterministic model of the altar room (runecraft.md section 4, read from the
 * engine): per tick, the server reads each player's packets in processing order
 * (button handlers run there: accept, confirm, offer), then runs each player's turn
 * in the same order (trade ops and the craft). A loc or player click closes any open
 * modal, so it declines an open trade. The craft binds every essence held and delays
 * the account through T+4; while delayed its loc and player clicks are dropped and it
 * is busy to a trade request. An offer resets both accepts.
 *
 * The giver follows altar-cue.ts: it sees the program's shared cue `cueDelay` frames
 * after it was published, maps T to its own numbering through the beacons, arms the
 * newest turn naming it while its first send is still ahead, and sends request on
 * T+K, offer all + accept on T+K+1, confirm on T+K+2 (and T+K+3 robust), each on its
 * frame for the tick before.
 */
interface Pkt {
    kind: 'request' | 'accept' | 'confirm' | 'offer' | 'craft' | 'close';
    /** The giver a scored request names. */
    target?: number;
}

interface ModelOpts {
    order: 'giver-first' | 'scored-first';
    params?: Record<string, unknown>;
    givers?: string[];
    /** Ticks to run. */
    ticks: number;
    /** Frames between the program sharing a turn and the giver reading it. */
    cueDelay?: number;
    essenceAtStart?: number;
    tradeOpenAtStart?: boolean;
    /** Scored frames the page decodes together with the next one (the program misses their labels). */
    skipFrames?: Set<number>;
    /** Scored craft clicks that land a tick late (by click number, from 0). */
    lateCrafts?: Set<number>;
    /** Scored craft clicks the network loses (by click number, from 0). */
    lostCrafts?: Set<number>;
    /** Givers missing from the room. */
    absent?: Set<string>;
    /** Called on each frame with the harness, before the program runs. */
    onFrame?: (t: number, h: Harness) => void;
}

const OFFSET = 1000; // the giver's tick numbering is the scored one plus this
const EPOCH = 1.8e12; // Date.now() at the model's tick 0; ticks are 300 ms
const ALTAR = { id: 34768, x: 2399, z: 4840, name: 'Altar', options: ['Craft-rune'] };
const SCORED_TILE = { x: 2400, z: 4839 };
const SLOTS = [{ x: 2401, z: 4839 }, { x: 2399, z: 4839 }, { x: 2400, z: 4838 }];
const XP_PER_ESS = 9 * 25;

function model(o: ModelOpts) {
    const giverNames = o.givers ?? ['cairn_h05', 'cairn_h06'];
    const display = (n: string) => n.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    let t = 100;
    // performance.now() is the model's ms since tick 0, Date.now() that plus EPOCH
    const h = new Harness('rc', createRcCycle, { now: () => t * 300 + 5, wallNow: () => EPOCH + t * 300 + 5 });
    const cueDelay = o.cueDelay ?? 1;
    let xp = 0;
    let essence = o.essenceAtStart ?? 0;
    let runes = 0;
    let delayedThrough = -1;
    let craftClicks = 0;
    const msgs: Array<{ text: string; tick: number; type: number; sender: string }> = [];
    interface Giver { name: string; essence: number; readyAt: number; done: Set<string>; armed: { T: number; myT: number; schedule: string; fired: boolean } | null; out: Map<number, Pkt[]> }
    const givers: Giver[] = giverNames.map(name => ({ name, essence: 27, readyAt: EPOCH, done: new Set(), armed: null, out: new Map() }));
    // run.ts's part: offer the ready givers, oldest readyAt first, whenever one restocks
    const feed = !o.params?.givers;
    // a trade: who, screen, offers and accepts
    let trade: null | { giver: Giver; screen: 'offer' | 'confirm'; offered: number; accS: boolean; accG: boolean } = o.tradeOpenAtStart ? { giver: givers[0]!, screen: 'offer', offered: 0, accS: false, accG: false } : null;
    // trade ops read this tick, run in the player's turn: 'a>b'
    const intents = new Set<string>();
    // requests made in a turn that the partner can answer with its own trade op: 'a>b' -> tick
    const outstanding = new Map<string, number>();
    let craftQueued = false;
    const scoredOut = new Map<number, Pkt[]>();
    const cues: Array<{ frame: number; cue: RcShared }> = [];
    const crafts: number[] = [];

    const state = () => makeState({
        tick: t,
        ...SCORED_TILE,
        skills: { Runecraft: { xp } },
        inventory: [...Array.from({ length: essence }, () => 'Rune essence'), ...(runes ? ['Nature rune'] : [])],
        locs: [ALTAR],
        players: givers.flatMap((g, i) => (o.absent?.has(g.name) ? [] : [{ index: 40 + i, name: display(g.name), ...SLOTS[i % 3]! }])),
        messages: msgs.slice(-20),
        trade: trade ? { partner: display(trade.giver.name), screen: trade.screen, theirOffer: Array.from({ length: trade.offered }, (_, i) => ({ slot: i, id: 1436, name: 'Rune essence', count: 1 })), myAccepted: trade.accS, partnerAccepted: trade.accG } as never : undefined
    });

    const decline = () => {
        trade = null;
    };
    const complete = () => {
        const g = trade!.giver;
        essence += trade!.offered;
        g.essence -= trade!.offered;
        trade = null;
        // restocked off-stage, ready again a few ticks later
        g.essence = 27;
        g.readyAt = EPOCH + (t + 3) * 300;
        restocks.push({ at: t + 3 });
    };
    const restocks: Array<{ at: number }> = [];

    const readPackets = (who: 'scored' | Giver, pkts: Pkt[]) => {
        const delayed = t <= delayedThrough;
        for (const p of pkts) {
            if (who === 'scored') {
                if (p.kind === 'request' || p.kind === 'craft') {
                    if (delayed) continue; // dropped
                    if (trade) decline(); // clearPendingAction closes the modal
                    if (p.kind === 'request') intents.add(`scored>${givers[p.target!]!.name}`);
                    else craftQueued = true;
                } else if (p.kind === 'close') decline();
                else if (p.kind === 'accept' && trade?.screen === 'offer') trade.accS = true;
                else if (p.kind === 'confirm' && trade?.screen === 'confirm') trade.accS = true;
            } else {
                const g = who;
                if (p.kind === 'request') intents.add(`${g.name}>scored`);
                else if (p.kind === 'offer' && trade?.giver === g && trade.screen === 'offer') {
                    trade.offered = g.essence;
                    trade.accS = false;
                    trade.accG = false;
                } else if (p.kind === 'accept' && trade?.giver === g && trade.screen === 'offer') trade.accG = true;
                else if (p.kind === 'confirm' && trade?.giver === g && trade.screen === 'confirm') trade.accG = true;
            }
            if (trade && trade.accS && trade.accG) {
                if (trade.screen === 'offer') Object.assign(trade, { screen: 'confirm', accS: false, accG: false });
                else complete();
            }
        }
    };
    const turnOf = (who: 'scored' | Giver) => {
        if (who === 'scored') {
            if (craftQueued) {
                craftQueued = false;
                if (essence > 0) {
                    xp += essence * XP_PER_ESS;
                    runes += essence;
                    essence = 0;
                    delayedThrough = t + 4;
                    crafts.push(t);
                }
            }
            for (const g of givers) if (intents.delete(`scored>${g.name}`)) tradeOp('scored', g);
        } else if (intents.delete(`${who.name}>scored`)) tradeOp(who, who);
    };
    /** A trade op in `who`'s turn: open the trade if the partner asked first (and neither is busy), else ask. */
    const tradeOp = (who: 'scored' | Giver, g: Giver) => {
        const fwd = who === 'scored' ? `scored>${g.name}` : `${g.name}>scored`;
        const back = who === 'scored' ? `${g.name}>scored` : `scored>${g.name}`;
        const scoredBusy = t <= delayedThrough || trade !== null;
        if (who !== 'scored' && scoredBusy) return; // "is busy at the moment"
        const asked = outstanding.get(back);
        if (asked !== undefined && t - asked <= 10) {
            outstanding.delete(back);
            trade = { giver: g, screen: 'offer', offered: 0, accS: false, accG: false };
        } else {
            outstanding.set(fwd, t);
            if (who !== 'scored') msgs.push({ text: 'wishes to trade with you.', tick: t, type: 4, sender: display(g.name) });
        }
    };

    const giverFrame = (g: Giver) => {
        // the giver's view of the cue, cueDelay frames old; offset from the newest beacon
        const seen = [...cues].reverse().find(c => c.frame <= t - cueDelay)?.cue;
        const myNow = t + OFFSET;
        if (seen && !seen.stop) {
            const b = seen.beacons[seen.beacons.length - 1];
            const offset = b ? Math.round((b.ms - EPOCH) / 300) + OFFSET - b.tick : null; // the giver's frame at that instant
            const turn = [...seen.turns].reverse().find(x => x.giver === g.name);
            if (turn && offset !== null && !g.done.has(`${turn.T}`) && !(g.armed?.fired)) {
                const myT = turn.T + offset;
                if (myNow < myT + seen.open - 1) g.armed = { T: turn.T, myT, schedule: turn.schedule, fired: false };
            }
        } else if (seen?.stop && g.armed && !g.armed.fired) g.armed = null;
        const a = g.armed;
        if (!a) return;
        const ot = a.myT + 5;
        const land = myNow + 1;
        const send = (kinds: Pkt['kind'][]) => {
            g.out.set(land - OFFSET, kinds.map(kind => ({ kind })));
            a.fired = true;
        };
        if (land === ot) send(['request']);
        else if (land === ot + 1) send(['offer', 'accept']);
        else if (land === ot + 2) send(['confirm']);
        else if (land === ot + 3 && a.schedule === 'robust') send(['confirm']);
        if (land > ot + (a.schedule === 'robust' ? 3 : 2)) {
            g.done.add(`${a.T}`);
            g.armed = null;
        }
    };

    h.start('rc', { untilXp: 1e9, givers: giverNames, ...o.params }, state());
    const offer = () => h.runtime.command({ op: 'input', data: { givers: [...givers].sort((a, b) => a.readyAt - b.readyAt).map(g => ({ name: g.name, readyAt: g.readyAt })) } });
    for (let i = 0; i < o.ticks && h.status.phase === 'running'; i++) {
        t++;
        // server tick t
        const order: Array<'scored' | Giver> = o.order === 'giver-first' ? [...givers, 'scored'] : ['scored', ...givers];
        for (const who of order) readPackets(who, who === 'scored' ? scoredOut.get(t) ?? [] : who.out.get(t) ?? []);
        for (const who of order) turnOf(who);
        // frame t
        if (feed && restocks.some(r => r.at === t)) offer();
        o.onFrame?.(t, h);
        if (o.skipFrames?.has(t)) continue; // decoded with t+1
        const ticks = o.skipFrames?.has(t - 1) ? 2 : 1;
        const arrivals = Array.from({ length: ticks }, (_, k) => (t - ticks + 1 + k) * 300);
        for (const s of h.step(state(), ticks, arrivals)) {
            const p: Pkt = s.action.type === 'interactPlayer' ? { kind: 'request', target: (s.action as { playerIndex: number }).playerIndex - 40 }
                : s.action.type === 'interactLoc' ? { kind: 'craft' }
                    : s.action.type === 'closeModal' ? { kind: 'close' }
                        : { kind: (s.action as { componentId: number }).componentId === 3420 ? 'accept' : 'confirm' };
            let land = t + 1;
            if (p.kind === 'craft') {
                const n = craftClicks++;
                if (o.lostCrafts?.has(n)) continue;
                if (o.lateCrafts?.has(n)) land++;
            }
            scoredOut.set(land, [...(scoredOut.get(land) ?? []), p]);
        }
        if (h.status.shared) cues.push({ frame: t, cue: JSON.parse(JSON.stringify(h.status.shared)) });
        for (const g of givers) if (!o.absent?.has(g.name)) giverFrame(g);
    }
    const shared = h.status.shared as RcShared;
    const gaps = crafts.slice(1).map((c, i) => c - crafts[i]!);
    return { h, crafts, gaps, shared, results: shared.results };
}

const all = (gaps: number[], n: number) => gaps.every(g => g === n);

describe('rc-cycle schedule', () => {
    test('the scored half matches altar-cue.ts and runecraft.md section 4', () => {
        expect(scoredSteps(100, 5, 'tuned')).toEqual([{ land: 105, actions: ['request'] }, { land: 106, actions: ['accept'] }, { land: 107, actions: ['confirm', 'craft'] }]);
        expect(scoredSteps(100, 5, 'robust')).toEqual([{ land: 105, actions: ['request'] }, { land: 107, actions: ['accept', 'confirm'] }, { land: 108, actions: ['craft'] }]);
        expect(cycleTicks(5, 'tuned')).toBe(7);
        expect(cycleTicks(5, 'robust')).toBe(8);
    });

    test('needs a stopping target from game state', () => {
        const h = new Harness('rc', createRcCycle);
        expect(h.start('rc', {}).phase).toBe('fault');
        expect(h.start('rc', { untilLevel: 44, schedule: 'fast' }).phase).toBe('fault');
        expect(h.start('rc', { untilXp: 1e6, givers: [{}] }).phase).toBe('fault');
    });
});

describe('rc-cycle against the model', () => {
    test('robust: 8 ticks a cycle with either processing order', () => {
        for (const order of ['giver-first', 'scored-first'] as const) {
            const { gaps, results } = model({ order, ticks: 180 });
            expect(gaps.length).toBeGreaterThanOrEqual(18);
            expect(all(gaps, 8)).toBe(true);
            expect(results.every(r => r.outcome === 'gave' && r.schedule === 'robust')).toBe(true);
            expect(results.every(r => r.order === order)).toBe(true);
        }
    });

    test('tuned with the giver handled first: 7 ticks a cycle, two packets at most per tick', () => {
        const { h, gaps, results } = model({ order: 'giver-first', ticks: 160, params: { schedule: 'tuned' } });
        expect(gaps.length).toBeGreaterThanOrEqual(18);
        expect(all(gaps, 7)).toBe(true);
        expect(results.every(r => r.outcome === 'gave' && !r.salvaged)).toBe(true);
        const perTick = new Map<number, number>();
        for (const s of h.sent) perTick.set(s.tick, (perTick.get(s.tick) ?? 0) + 1);
        expect(Math.max(...perTick.values())).toBeLessThanOrEqual(2);
        // a steady cycle: request, accept, confirm + craft on consecutive frames, crafts 7 apart
        const tl = h.timeline().slice(-6);
        expect(tl.map(l => l.split(' ')[1])).toEqual(['interactPlayer', 'clickComponent', 'clickComponent,interactLoc', 'interactPlayer', 'clickComponent', 'clickComponent,interactLoc']);
    });

    test('tuned with the scored account handled first finishes each turn on robust\'s tail: 8, never a declined trade', () => {
        const { gaps, results, h } = model({ order: 'scored-first', ticks: 180, params: { schedule: 'tuned' } });
        expect(gaps.length).toBeGreaterThanOrEqual(18);
        expect(all(gaps, 8)).toBe(true);
        expect(results.every(r => r.outcome === 'gave' && r.salvaged && r.order === 'scored-first')).toBe(true);
        expect(h.status.counters.salvaged).toBe(results.length);
    });

    test('turns and beacons: T steps by the cycle, beacons are the last 8 frames on the Date.now() scale', () => {
        const { shared } = model({ order: 'giver-first', ticks: 120 });
        const Ts = shared.turns.map(x => x.T);
        expect(Ts.slice(1).map((T, i) => T - Ts[i]!).every(d => d === 8)).toBe(true);
        expect(shared.beacons).toHaveLength(8);
        for (const b of shared.beacons) expect(b.ms).toBe(EPOCH + b.tick * 300);
        expect(shared.open).toBe(5);
        expect(shared.schedule).toBe('robust');
    });

    test('the first turn is planned with lead frames for the giver, from an empty inventory', () => {
        const { results, crafts } = model({ order: 'giver-first', ticks: 30 });
        // started on frame 100: the request lands on 101 + lead (3) + 1 = 105... from the first frame 101
        expect(results[0]!.T + 5 - 1).toBeGreaterThanOrEqual(101 + 3);
        expect(crafts[0]).toBe(results[0]!.T + 8);
    });

    test('essence held at the start is crafted at once, and the next turn follows that craft', () => {
        const { crafts, gaps } = model({ order: 'giver-first', ticks: 60, essenceAtStart: 27 });
        expect(crafts[0]).toBe(102); // first frame 101, lands 102
        expect(all(gaps, 8)).toBe(true);
    });

    test('a trade open at the start is declined before anything else', () => {
        const { h, crafts } = model({ order: 'giver-first', ticks: 60, tradeOpenAtStart: true });
        expect(h.sent[0]!.action.type).toBe('closeModal');
        expect(crafts.length).toBeGreaterThan(3);
    });

    test('a step whose frame the page decoded together with the next is reported late, and the cycle recovers', () => {
        // the first turn's request frame (T+K-1) is skipped
        const first = model({ order: 'giver-first', ticks: 40 }).results[0]!;
        const skip = new Set([first.T + 5 - 1]);
        const { results, gaps } = model({ order: 'giver-first', ticks: 120, skipFrames: skip });
        expect(results[0]!.outcome).toBe('late');
        expect(results.slice(1).every(r => r.outcome === 'gave')).toBe(true);
        expect(gaps.filter(g => g !== 8)).toEqual([]);
    });

    test('a craft landing a tick late re-anchors the planned turn instead of losing it', () => {
        const { h, gaps, results } = model({ order: 'giver-first', ticks: 120, lateCrafts: new Set([2]) });
        expect(h.status.counters.reanchors).toBe(1);
        expect(results.every(r => r.outcome === 'gave')).toBe(true);
        expect(gaps.filter(g => g !== 8)).toEqual([9]);
    });

    test('a craft that does not take is retried with the essence held, and the next turn moves with it', () => {
        const { h, results, crafts, shared } = model({ order: 'giver-first', ticks: 120, lostCrafts: new Set([1]) });
        const lost = results.find(r => r.outcome !== 'gave')!;
        expect(lost.outcome).toBe('missed');
        expect(lost.detail).toContain('essence held');
        // the essence is bound on the frame the miss is decided (two after the planned landing), landing the tick after
        expect(crafts).toContain(lost.craft ?? lost.tick + 1);
        expect(h.status.counters.reanchors).toBe(1);
        // the turn planned off the lost craft moved to the retry, and every later turn gave on 8
        const after = results.filter(r => r.T > lost.T);
        expect(after.length).toBeGreaterThan(5);
        expect(after.every(r => r.outcome === 'gave')).toBe(true);
        const tail = crafts.filter(c => c > lost.tick);
        expect(tail.slice(1).every((c, i) => c - tail[i]! === 8)).toBe(true);
        expect(shared.stop).toBeUndefined();
    });

    test('givers rotate; a spent giver comes back only with a newer readyAt; waiting is not a stall', () => {
        let fed = false;
        const { h, results } = model({
            order: 'giver-first',
            ticks: 200,
            givers: ['cairn_h05', 'cairn_h06'],
            params: { givers: ['cairn_h05', 'cairn_h06'] },
            onFrame: (t, hh) => {
                const sh = hh.status.shared as RcShared | undefined;
                if (!fed && sh?.waiting === 'giver' && t > 180) {
                    fed = true;
                    const now = EPOCH + t * 300;
                    hh.runtime.command({ op: 'input', data: { givers: [{ name: 'cairn_h06', readyAt: now - 1 }, { name: 'cairn_h05', readyAt: now }] } });
                }
            }
        });
        expect(results.slice(0, 2).map(r => r.giver)).toEqual(['cairn_h05', 'cairn_h06']);
        expect(fed).toBe(true);
        expect(h.status.phase).toBe('running');
        expect(results.slice(2, 4).map(r => r.giver)).toEqual(['cairn_h06', 'cairn_h05']);
        expect(results.every((r: TurnResult) => r.outcome === 'gave')).toBe(true);
    });

    test('a giver not beside the scored tile is reported no-giver and rotated behind the next', () => {
        const { results } = model({ order: 'giver-first', ticks: 120, givers: ['cairn_h05', 'cairn_h06'], absent: new Set(['cairn_h05']), params: { givers: ['cairn_h05', 'cairn_h06'] } });
        expect(results[0]!.giver).toBe('cairn_h06'); // h05 is not in sight, so it is never planned
        expect(results[0]!.outcome).toBe('gave');
    });

    test('stops on the xp target with stop shared for the cue; a stopped run shares stop too', () => {
        const { h, crafts } = model({ order: 'giver-first', ticks: 200, params: { untilXp: 4 * 27 * XP_PER_ESS } });
        expect(h.status.phase).toBe('done');
        expect(crafts).toHaveLength(4);
        expect((h.status.shared as RcShared).stop).toBe(true);
        expect((h.status.result as { crafts: number; ticksPerCycle: number }).ticksPerCycle).toBe(8);

        const h2 = new Harness('rc', createRcCycle);
        h2.start('rc', { untilLevel: 99 });
        h2.step(makeState({ tick: 1, locs: [ALTAR], ...SCORED_TILE }));
        h2.runtime.stop();
        expect((h2.status.shared as RcShared).stop).toBe(true);
    });

    test('input is validated at the boundary and refused when nothing runs', () => {
        const h = new Harness('rc', createRcCycle);
        expect(h.runtime.command({ op: 'input', data: { givers: ['a'] } }).success).toBe(false);
        h.start('rc', { untilLevel: 99 });
        expect(h.runtime.command({ op: 'input', data: { givers: 'a' } }).success).toBe(false);
        expect(h.runtime.command({ op: 'input', data: { schedule: 'fast' } }).success).toBe(false);
        const ok = h.runtime.command({ op: 'input', data: { givers: ['cairn_h05', { name: 'cairn_h06', schedule: 'tuned' }], schedule: 'robust' } });
        expect(ok.success).toBe(true);
        expect(ok.data).toEqual({ queue: ['cairn_h05', 'cairn_h06'], schedule: 'robust' });
    });

    test('faults with no altar in sight', () => {
        const h = new Harness('rc', createRcCycle);
        h.start('rc', { untilLevel: 99 });
        h.step(makeState({ tick: 1 }));
        expect(h.status.phase).toBe('fault');
    });
});
