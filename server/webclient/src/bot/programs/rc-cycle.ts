// The scored account's side of the Runecraft hand-off in the altar room: a giver
// standing beside it trades in 27 essence, it crafts, the next giver trades.
// Cycle and engine rules: docs/speedrun/skills/runecraft.md section 4. The giver
// side and the cue file between the two: speedrun/helpers/altar-cue.ts (rs/117)
// and docs/speedrun/helpers/altar-giver.md.
//
// Ticks are the scored account's own (state.tick). T is the tick a craft lands on;
// the trade that refills it opens on T + open (K, default 5: the craft's delay ends
// on T+4). Every packet is sent on the decoded frame for the tick before it lands:
//
//   tuned (7):  request T+K, accept T+K+1, confirm + craft T+K+2
//   robust (8): request T+K, accept + confirm T+K+2, craft T+K+3
//
// Tuned needs the giver handled before the scored account in each tick, which the
// page cannot know in advance, so robust is the default and the driver opts in to
// tuned per giver. Each step is checked against the decoded trade state first; a
// tuned turn whose T+K+1 frame still shows the offer screen (the scored account was
// handled first, so the giver's offer reset its accept) finishes on robust's tail
// and costs 8 ticks instead of a declined trade.
//
// The program owns the schedule. It picks each turn's giver from the queue the
// driver feeds it (the `input` op, from the givers' status files, which the page
// cannot read), plans T when it sends the craft before it, and shares the turns,
// its recent frames as beacons, and every turn's outcome (`status.shared`, RcShared).
// The driver copies turns and beacons into cue.json. Everything else is derived
// from observed state on every tick, so a run started after a reload re-derives
// its anchor (essence held: craft now; a trade open: decline it; else a fresh
// turn) and never resumes stored turns: the reload is a new cue session.

import { TRADE_CONFIRM_ACCEPT_ID, TRADE_MAIN_ACCEPT_ID, type BotWorldState, type NearbyLoc, type NearbyPlayer } from '../types.js';
import type { FrameStamp, ProgramContext, ProgramParams, TickProgram } from './types.js';
import { baseLevel, FreshMessages, GapCounter, num, oneOf, regex, skillXp } from './util.js';

export type Schedule = 'tuned' | 'robust';
export type ScoredAction = 'request' | 'accept' | 'confirm' | 'craft';

/** A packet group landing on `land`; it is sent on the frame for land - 1. */
export interface Step {
    land: number;
    actions: ScoredAction[];
}

/** One turn as the cue carries it (altar-cue.ts Turn). */
export interface Turn {
    giver: string;
    T: number;
    schedule: Schedule;
}

/**
 * gave: the craft that used the giver's essence was seen. missed: the trade did not
 * open, the offer or confirm screen was not there in time, or the craft was not seen.
 * late: the page decoded the frame a step was due on together with the next one, so
 * the step could not go out on its tick. no-giver: the giver was not beside the
 * scored tile when the request was due.
 */
export type Outcome = 'gave' | 'missed' | 'late' | 'no-giver';

/** Who the server handled first in the turn's tick, read off the trade screens. */
export type Order = 'giver-first' | 'scored-first';

export interface TurnResult {
    giver: string;
    T: number;
    schedule: Schedule;
    outcome: Outcome;
    /** The scored tick the outcome was decided on. */
    tick: number;
    /** The craft's landing tick, for a turn that gave. */
    craft?: number;
    order?: Order;
    /** A tuned turn finished on robust's tail. */
    salvaged?: boolean;
    /** Ticks after T+K the page saw: the giver's request (chat), the trade open, its offer, the confirm screen, the essence. */
    seen: Partial<Record<'request' | 'open' | 'offer' | 'confirm' | 'essence', number>>;
    detail?: string;
}

/** A giver the driver offers for the next turns, oldest-ready first. */
export interface GiverEntry {
    name: string;
    /** This giver's schedule (tuned only if it is handled before the scored account). */
    schedule?: Schedule;
    /** Date.now() since it has been ready (its status file's readyAt). */
    readyAt?: number;
}

/** What the program shares (`status.shared`); the driver copies beacons, turns, schedule, open and stop into cue.json. */
export interface RcShared {
    v: 1;
    open: number;
    /** The default schedule for givers that name none. */
    schedule: Schedule;
    /** The last frames, oldest first, on the Date.now() scale. */
    beacons: FrameStamp[];
    /** The recent turns, oldest first; a giver acts on the newest naming it. */
    turns: Turn[];
    /** Outcomes of finished turns, oldest first. */
    results: TurnResult[];
    /** Eligible givers in the order they will be used. */
    queue: string[];
    /** Why no turn is planned right now, if none is. */
    waiting: 'giver' | null;
    /** The run is over: armed givers stand down. */
    stop?: true;
}

export const TRADE_OP = 4;
const BEACONS = 8;
const KEEP_TURNS = 32;
const KEEP_RESULTS = 32;
const ESSENCE = /^rune essence$/i;
const TRADE_REQUEST = /wishes to trade with you/i;

/** Login names and display names compare equal in this form (altar-cue.ts canonName). */
export function canonName(name: string): string {
    return name.trim().toLowerCase().replace(/[\s_]+/g, '_');
}

/** The scored half of one turn (altar-cue.ts scoredSteps). */
export function scoredSteps(T: number, open: number, schedule: Schedule): Step[] {
    const o = T + open;
    if (schedule === 'tuned') {
        return [
            { land: o, actions: ['request'] },
            { land: o + 1, actions: ['accept'] },
            { land: o + 2, actions: ['confirm', 'craft'] }
        ];
    }
    return robustTail(T, open, [{ land: o, actions: ['request'] }]);
}

function robustTail(T: number, open: number, head: Step[]): Step[] {
    const o = T + open;
    return [...head, { land: o + 2, actions: ['accept', 'confirm'] }, { land: o + 3, actions: ['craft'] }];
}

/** Ticks from one craft to the next: 7 tuned, 8 robust at K = 5. */
export function cycleTicks(open: number, schedule: Schedule): number {
    return open + (schedule === 'tuned' ? 2 : 3);
}

function giverEntries(value: unknown, name: string): GiverEntry[] {
    if (!Array.isArray(value)) throw new Error(`${name} must be an array of giver names or {name, schedule?, readyAt?}`);
    return value.map((v, i) => {
        const e = typeof v === 'string' ? { name: v } : v;
        if (!e || typeof e !== 'object' || typeof (e as GiverEntry).name !== 'string' || !(e as GiverEntry).name.trim()) throw new Error(`${name}[${i}] needs a name`);
        const { name: n, schedule, readyAt } = e as GiverEntry;
        return {
            name: n,
            ...(schedule === undefined ? {} : { schedule: oneOf(schedule, ['tuned', 'robust'] as const, 'robust', `${name}[${i}].schedule`) }),
            ...(readyAt === undefined ? {} : { readyAt: num(readyAt, 0, `${name}[${i}].readyAt`) })
        };
    });
}

interface Active {
    turn: Turn;
    steps: Step[];
    next: number;
    seen: TurnResult['seen'];
    salvaged: boolean;
    order?: Order;
}

interface PendingCraft {
    land: number;
    /** The turn whose essence it binds (null for essence held at the start or after a missed craft). */
    from: Active | null;
}

export function createRcCycle(params: ProgramParams): TickProgram {
    const open = num(params.open, 5, 'open');
    if (!Number.isInteger(open) || open < 2) throw new Error('open must be an integer of at least 2');
    let schedule: Schedule = oneOf(params.schedule, ['tuned', 'robust'] as const, 'robust', 'schedule');
    const untilLevel = num(params.untilLevel, 0, 'untilLevel');
    const untilXp = num(params.untilXp, 0, 'untilXp');
    if (!untilLevel && !untilXp) throw new Error('give untilLevel or untilXp (the stopping target comes from game state)');
    const lead = num(params.lead, 3, 'lead');
    const maxGiverDistance = num(params.maxGiverDistance, 1, 'maxGiverDistance');
    const maxFailures = num(params.maxFailures, 6, 'maxFailures');
    const altarRe = regex(params.altar, '^altar$', 'altar');
    const craftRe = regex(params.craftOption, '^craft', 'craftOption');
    let queue: GiverEntry[] = params.givers === undefined ? [] : giverEntries(params.givers, 'givers');

    const messages = new FreshMessages();
    const crafts = new GapCounter();
    /** Date.now() of the last trade each giver gave in, so a queue fed from a stale status file cannot reuse it. */
    const spentAt = new Map<string, number>();
    const outcomes: Record<Outcome, number> = { gave: 0, missed: 0, late: 0, 'no-giver': 0 };
    const orders: Record<Order, number> = { 'giver-first': 0, 'scored-first': 0 };
    const shared: RcShared = { v: 1, open, schedule, beacons: [], turns: [], results: [], queue: [], waiting: null };
    let started = false;
    let altar: NearbyLoc | undefined;
    let lastXp = 0;
    let startXp = 0;
    let active: Active | null = null;
    let pending: PendingCraft | null = null;
    /** Landing tick of the last craft seen: no trade can open before lastCraft + open. */
    let lastCraft = Number.NEGATIVE_INFINITY;
    let failures = 0;
    let salvaged = 0;
    let reanchors = 0;

    const summary = () => ({
        crafts: crafts.count,
        ticksPerCycle: crafts.ticksPerEvent,
        gaps: crafts.stats().histogram,
        outcomes: { ...outcomes },
        orders: { ...orders },
        salvaged,
        reanchors,
        baseXp: (lastXp - startXp) / 25,
        schedule
    });

    const eligible = (s: BotWorldState): Array<GiverEntry & { player: NearbyPlayer }> =>
        queue.flatMap(e => {
            const key = canonName(e.name);
            const spent = spentAt.get(key);
            if (spent !== undefined && !((e.readyAt ?? 0) > spent)) return [];
            if (active && canonName(active.turn.giver) === key) return [];
            const player = s.nearbyPlayers.find(p => canonName(p.name) === key);
            return player && player.distance <= maxGiverDistance ? [{ ...e, player }] : [];
        });

    const rotate = (giver: string) => {
        const key = canonName(giver);
        const i = queue.findIndex(e => canonName(e.name) === key);
        if (i >= 0) queue.push(...queue.splice(i, 1));
    };

    const publishTurn = (turn: Turn) => {
        shared.turns.push(turn);
        if (shared.turns.length > KEEP_TURNS) shared.turns.splice(0, shared.turns.length - KEEP_TURNS);
    };

    /** Plan the trade that follows a craft landing on (or the scored account being free from) T. */
    const plan = (ctx: ProgramContext, T: number): boolean => {
        const [giver] = eligible(ctx.state);
        if (!giver) {
            shared.waiting = 'giver';
            return false;
        }
        shared.waiting = null;
        const turn: Turn = { giver: giver.name, T, schedule: giver.schedule ?? schedule };
        publishTurn(turn);
        active = { turn, steps: scoredSteps(T, open, turn.schedule), next: 0, seen: {}, salvaged: false };
        ctx.count('turns');
        ctx.log(`turn ${giver.name} T=${T} ${turn.schedule}: request lands ${T + open}`);
        return true;
    };

    /** Move the planned turn to a new T (a craft seen a tick late): the giver acts on the newest turn naming it. */
    const replan = (ctx: ProgramContext, T: number) => {
        if (!active || active.next > 0 || active.turn.T === T) return;
        const turn: Turn = { ...active.turn, T };
        publishTurn(turn);
        active = { turn, steps: scoredSteps(T, open, turn.schedule), next: 0, seen: {}, salvaged: false };
        reanchors++;
        ctx.count('reanchors');
        ctx.log(`re-anchored ${turn.giver} to T=${T}`);
    };

    const finish = (ctx: ProgramContext, a: Active, outcome: Outcome, detail?: string, craft?: number) => {
        const r: TurnResult = { giver: a.turn.giver, T: a.turn.T, schedule: a.turn.schedule, outcome, tick: ctx.tick, seen: { ...a.seen } };
        if (craft !== undefined) r.craft = craft;
        if (a.order) r.order = a.order;
        if (a.salvaged) r.salvaged = true;
        if (detail) r.detail = detail;
        shared.results.push(r);
        if (shared.results.length > KEEP_RESULTS) shared.results.splice(0, shared.results.length - KEEP_RESULTS);
        outcomes[outcome]++;
        ctx.count(outcome === 'no-giver' ? 'noGiver' : outcome);
        if (outcome !== 'gave') {
            failures++;
            rotate(a.turn.giver);
            crafts.break(ctx.tick);
            ctx.log(`turn ${a.turn.giver} T=${a.turn.T} ${outcome}${detail ? `: ${detail}` : ''}`);
        } else {
            failures = 0;
        }
    };

    /** Abandon the active turn: decline an open trade so the giver keeps its essence. */
    const fail = (ctx: ProgramContext, outcome: Outcome, detail: string) => {
        const a = active!;
        active = null;
        finish(ctx, a, outcome, detail);
        if (ctx.state.trade?.isOpen) ctx.send({ type: 'closeModal' }, 'decline trade');
    };

    /** Click the altar; returns the tick the craft lands on, or null if it was not sent. */
    const sendCraft = (ctx: ProgramContext, from: Active | null): number | null => {
        const op = altar!.optionsWithIndex.find(o => craftRe.test(o.text))?.opIndex ?? 1;
        if (!ctx.send({ type: 'interactLoc', x: altar!.x, z: altar!.z, locId: altar!.id, optionIndex: op }, 'craft')) return null;
        pending = { land: ctx.tick + 1, from };
        return pending.land;
    };

    /** Observations of the active turn's trade on this frame, as ticks after T+K. */
    const watch = (s: BotWorldState, t: number, fresh: ReturnType<FreshMessages['take']>) => {
        if (!active) return;
        const a = active;
        const at = t - (a.turn.T + open);
        const giver = canonName(a.turn.giver);
        const trade = s.trade;
        if (a.seen.request === undefined && fresh.some(m => TRADE_REQUEST.test(m.text) && canonName(m.sender) === giver)) a.seen.request = at;
        if (trade?.isOpen && trade.partner && canonName(trade.partner) === giver) {
            a.seen.open ??= at;
            if (trade.theirOffer.some(i => ESSENCE.test(i.name))) a.seen.offer ??= at;
            if (trade.screen === 'confirm') a.seen.confirm ??= at;
        }
    };

    /** Send the active turn's step for this frame, if one is due, after checking the trade is where it must be. */
    const step = (ctx: ProgramContext, essence: number) => {
        const a = active;
        if (!a) return;
        const s = ctx.state;
        const t = ctx.tick;
        const due = a.steps[a.next];
        if (!due) return;
        if (due.land - 1 < t) return fail(ctx, 'late', `the frame for ${due.land - 1} was decoded with ${t}`);
        if (due.land - 1 > t) return;
        const trade = s.trade;
        const withGiver = !!trade?.isOpen && !!trade.partner && canonName(trade.partner) === canonName(a.turn.giver);
        const offered = withGiver && trade!.theirOffer.some(i => ESSENCE.test(i.name));
        const actions = due.actions.join('+');
        if (actions === 'request') {
            const player = s.nearbyPlayers.find(p => canonName(p.name) === canonName(a.turn.giver));
            if (!player || player.distance > maxGiverDistance) return fail(ctx, 'no-giver', player ? `giver ${player.distance} tiles away` : 'giver not in sight');
            if (!ctx.send({ type: 'interactPlayer', playerIndex: player.index, optionIndex: TRADE_OP }, `trade ${a.turn.giver}`)) return fail(ctx, 'missed', 'request not sent');
        } else if (actions === 'accept') {
            // tuned, frame T+K: both requests landed, so the trade is open
            if (!withGiver) return fail(ctx, 'missed', 'trade not open on T+K');
            ctx.send({ type: 'clickComponent', componentId: TRADE_MAIN_ACCEPT_ID }, 'accept');
        } else if (actions === 'confirm+craft') {
            // tuned, frame T+K+1: with the giver handled first both accepts stood and the confirm screen is up
            if (withGiver && trade!.screen === 'confirm') {
                a.order = 'giver-first';
                ctx.send({ type: 'clickComponent', componentId: TRADE_CONFIRM_ACCEPT_ID }, 'confirm');
                if (sendCraft(ctx, a) === null) return fail(ctx, 'missed', 'craft not sent');
            } else if (offered && trade!.screen === 'offer' && trade!.partnerAccepted) {
                // the giver's offer reset this account's accept: it was handled first. Robust's tail still lands the
                // trade (the giver's one confirm on T+K+2 comes after this account's accept and confirm in that tick).
                a.order = 'scored-first';
                a.salvaged = true;
                salvaged++;
                ctx.count('salvaged');
                a.steps = robustTail(a.turn.T, open, a.steps.slice(0, 1));
                a.next = 2; // robust's accept + confirm, landing T+K+2, goes out now
                ctx.send({ type: 'clickComponent', componentId: TRADE_MAIN_ACCEPT_ID }, 'accept (salvage)');
                ctx.send({ type: 'clickComponent', componentId: TRADE_CONFIRM_ACCEPT_ID }, 'confirm (salvage)');
                ctx.progress();
                return;
            } else {
                return fail(ctx, 'missed', withGiver ? `no confirm screen on T+K+1 (${trade!.screen}, offer ${offered})` : 'trade not open on T+K+1');
            }
        } else if (actions === 'accept+confirm') {
            // robust, frame T+K+1: the giver's offer and accept are in
            if (!offered) return fail(ctx, 'missed', withGiver ? 'no essence offered on T+K+1' : 'trade not open on T+K+1');
            ctx.send({ type: 'clickComponent', componentId: TRADE_MAIN_ACCEPT_ID }, 'accept');
            ctx.send({ type: 'clickComponent', componentId: TRADE_CONFIRM_ACCEPT_ID }, 'confirm');
        } else if (actions === 'craft') {
            // robust, frame T+K+2: done already (this account was handled first) or waiting on the giver's
            // second confirm, which the server handles before this click (the giver was first)
            const done = !trade?.isOpen && essence > 0;
            const waiting = withGiver && trade!.screen === 'confirm' && trade!.myAccepted;
            if (!done && !waiting) return fail(ctx, 'missed', withGiver ? `trade on ${trade!.screen} screen on T+K+2` : 'no essence on T+K+2');
            a.order ??= done ? 'scored-first' : 'giver-first';
            if (sendCraft(ctx, a) === null) return fail(ctx, 'missed', 'craft not sent');
        }
        a.next++;
        ctx.progress();
        if (a.next >= a.steps.length) {
            // the craft is out: the giver's essence is spent, and the next turn starts from this craft
            spentAt.set(canonName(a.turn.giver), ctx.wallMs);
            if (a.order) orders[a.order]++;
            active = null;
            plan(ctx, due.land);
        }
    };

    return {
        stallTicks: 60,
        snapshot: summary,
        onInput(data) {
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('rc-cycle input must be an object: {givers?, schedule?}');
            const d = data as Record<string, unknown>;
            if (d.givers !== undefined) queue = giverEntries(d.givers, 'givers');
            if (d.schedule !== undefined) schedule = oneOf(d.schedule, ['tuned', 'robust'] as const, 'robust', 'schedule');
            shared.schedule = schedule;
            return { queue: queue.map(e => e.name), schedule };
        },
        onStop() {
            shared.stop = true;
        },
        onTick(ctx) {
            const s = ctx.state;
            const t = ctx.tick;
            if (!s.player) return;
            for (const f of ctx.frames) shared.beacons.push(f);
            if (shared.beacons.length > BEACONS) shared.beacons.splice(0, shared.beacons.length - BEACONS);
            if (!started) {
                started = true;
                messages.take(s);
                startXp = lastXp = skillXp(s, 'runecraft');
            }
            altar = s.nearbyLocs.filter(l => altarRe.test(l.name)).sort((a, b) => a.distance - b.distance)[0];
            if (!altar) return ctx.fault('no altar in sight');
            const fresh = messages.take(s);
            const essence = s.inventory.filter(i => ESSENCE.test(i.name)).reduce((n, i) => n + i.count, 0);
            watch(s, t, fresh);
            if (active && essence > 0 && active.seen.essence === undefined && active.next > 0) active.seen.essence = t - (active.turn.T + open);

            // the craft: its xp shows on the frame it landed on
            const xp = skillXp(s, 'runecraft');
            if (xp > lastXp) {
                lastXp = xp;
                lastCraft = t;
                crafts.event(t);
                ctx.mark('crafts');
                ctx.count('crafts');
                ctx.progress();
                if (pending) {
                    if (t !== pending.land) {
                        // landed a tick late: the craft's delay, and so the next trade, moves with it
                        replan(ctx, t);
                        ctx.count('lateCrafts');
                    }
                    if (pending.from) finish(ctx, pending.from, 'gave', t === pending.land ? undefined : `craft landed on ${t}, planned ${pending.land}`, t);
                    pending = null;
                }
                ctx.gauge('ticksPerCycle', crafts.ticksPerEvent);
                if ((untilLevel && baseLevel(s, 'runecraft') >= untilLevel) || (untilXp && xp >= untilXp)) {
                    shared.stop = true;
                    ctx.share(shared);
                    return ctx.done(summary());
                }
            } else if (pending && t > pending.land + 1) {
                // no xp on the craft's tick or the one after: the click did not take
                const p = pending;
                pending = null;
                if (p.from) finish(ctx, p.from, 'missed', `no craft xp by ${p.land + 1}${essence ? ' (essence held)' : ''}`);
                else failures++;
                crafts.break(t);
                if (essence > 0 && !s.trade?.isOpen) {
                    // the essence came but the craft did not: bind it now, or the next trade has no free slots
                    const land = sendCraft(ctx, null);
                    if (land !== null) {
                        if (active) replan(ctx, land);
                        else plan(ctx, land);
                    }
                }
            }

            if (failures >= maxFailures) {
                shared.stop = true;
                ctx.share(shared);
                return ctx.fault(`${failures} turns in a row failed`, summary());
            }

            step(ctx, essence);

            if (!active && !pending) {
                // nothing in flight: derive the next move from what the account holds
                if (s.trade?.isOpen) {
                    ctx.send({ type: 'closeModal' }, 'decline stray trade');
                } else if (essence > 0) {
                    const land = sendCraft(ctx, null);
                    if (land !== null) plan(ctx, land);
                } else {
                    plan(ctx, Math.max(lastCraft, t + lead + 1 - open));
                }
                // waiting for a giver is the driver's to resolve, not a stall
                if (shared.waiting) ctx.progress();
            } else if (!active && pending && shared.waiting) {
                // a craft is out but no giver was free when it went: keep trying while it lands
                plan(ctx, Math.max(pending.land, t + lead + 1 - open));
            }
            shared.queue = eligible(s).map(e => e.name);
            ctx.gauge('queue', shared.queue.length);
            ctx.share(shared);
        }
    };
}
