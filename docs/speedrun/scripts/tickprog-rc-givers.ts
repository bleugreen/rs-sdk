// Lab givers for the in-page rc-cycle program (tickprog-measure.ts rc): lite clients in
// this process that play the giver half of rs/117's cue (speedrun/helpers/altar-cue.ts on
// the mission branch: request on T+K, offer all and accept on T+K+1, confirm on T+K+2, and
// robust a second confirm on T+K+3), plus run.ts's relay between the page and the givers.
//
// The real givers are rs/117's altar-giver role (rs/163: on the direct path) reading
// cue.json. Here the cue is handed over in memory the moment the page publishes it, which
// is quicker than the file, so the lab measures the program's schedule and its checks, not
// the cue's transport. Each giver maps the scored account's T into its own tick numbering
// by matching the page's beacons (frame arrivals, Date.now() scale) to its own frames'
// arrivals, and sends on the arrival of its frame for the tick before each landing.
//
// Staff cheats set the room up and restock a giver the moment it has given; the giver is
// then offered back to the program with a fresh readyAt, as run.ts does from the status files.

import type { BotSDK } from '../../../sdk/index';
import type { BotWorldState } from '../../../sdk/types';
import { awaitProgram, type ProgramStatus, rcCueFields, type RcShared, sendProgramInput, startProgram } from '../../../speedrun/lib/programs';
import { ALTARS, cheat, connect, invCount, rcXp, tele, waitTicks } from './runecraft-lib';

type Schedule = 'tuned' | 'robust';
const OPEN = 5;
const TRADE_ACCEPT = 3420;
const TRADE_CONFIRM = 3546;
const canon = (n: string) => n.trim().toLowerCase().replace(/[\s_]+/g, '_');

interface Deps {
    sdk: BotSDK;
    givers: string[];
    altar: string;
    schedule: Schedule;
    crafts: number;
    onProgress: (s: ProgramStatus) => void;
}

interface GiverLog {
    name: string;
    turns: number;
    gave: number;
    missed: number;
    late: number;
    clock: number;
    offsetErrMs: number[];
}

export async function runGivers(d: Deps) {
    const A = ALTARS[d.altar];
    if (!A) throw new Error(`unknown altar ${d.altar}: ${Object.keys(ALTARS).join(', ')}`);
    const S = d.sdk;
    const scoredName = S.getState()!.player!.name;

    // ---- room: the scored account south of the altar, givers east and west of it
    await cheat(S, '~clearinv inv');
    await tele(S, A.enter.x, A.enter.z, A.enter.level);
    await waitTicks(S, 2);
    const altar = S.getState()!.nearbyLocs.find(l => /^altar$/i.test(l.name));
    if (!altar) throw new Error('no altar in sight from the room entry');
    const sTile = { x: altar.x + 1, z: altar.z - 1 };
    const slots = [{ x: altar.x + 2, z: altar.z - 1 }, { x: altar.x, z: altar.z - 1 }, { x: altar.x + 1, z: altar.z - 2 }];
    if (d.givers.length > slots.length) throw new Error(`at most ${slots.length} givers stand beside the scored tile`);
    await cheat(S, `setstat runecraft ${A.level}`);
    await tele(S, sTile.x, sTile.z, A.enter.level);
    const G = await Promise.all(d.givers.map(n => connect(n)));
    for (const [i, H] of G.entries()) {
        await cheat(H, '~clearinv inv');
        await tele(H, slots[i]!.x, slots[i]!.z, A.enter.level);
        await cheat(H, `give ${d.altar}_talisman 1`);
        await cheat(H, 'give blankrune 27');
    }
    await waitTicks(S, 4);
    for (const H of G) if (invCount(H.getState(), /rune essence/i) < 27) throw new Error(`giver ${H.getState()?.player?.name} has no essence`);

    // ---- the givers
    let cue: ReturnType<typeof rcCueFields> = null;
    const logs: GiverLog[] = d.givers.map(name => ({ name, turns: 0, gave: 0, missed: 0, late: 0, clock: 0, offsetErrMs: [] }));
    const readyAt = new Map<string, number>(d.givers.map(n => [n, Date.now()]));
    const feed = () =>
        sendProgramInput(S, { givers: [...readyAt].sort((a, b) => a[1] - b[1]).map(([name, at]) => ({ name, readyAt: at, schedule: d.schedule })) }).catch(e => console.log(`feed refused: ${(e as Error).message}`));

    const unsubs: Array<() => void> = [];
    for (const [i, H] of G.entries()) {
        const me = d.givers[i]!;
        const log = logs[i]!;
        const frames: Array<{ tick: number; ms: number }> = [];
        const done = new Set<string>();
        let armed: { key: string; myT: number; schedule: Schedule; fired: boolean; essence: number } | null = null;
        let lastTick = -1;
        const offsetOf = (): number | null => {
            const b = cue?.beacons[cue.beacons.length - 1];
            if (!b) return null;
            let best: { tick: number; err: number } | null = null;
            for (const f of frames) {
                const err = Math.abs(f.ms - b.ms);
                if (!best || err < best.err) best = { tick: f.tick, err };
            }
            if (!best || best.err > 100) return null;
            log.offsetErrMs.push(Math.round(best.err));
            return best.tick - b.tick;
        };
        const onFrame = (s: BotWorldState) => {
            const myNow = s.tick;
            if (cue && !cue.stop && !armed?.fired) {
                const turn = [...cue.turns].reverse().find(t => canon(t.giver) === canon(me));
                if (turn && !done.has(`${turn.T}`)) {
                    const offset = offsetOf();
                    if (offset === null) {
                        log.clock++;
                    } else {
                        const myT = turn.T + offset;
                        if (myNow < myT + OPEN - 1) {
                            if (armed?.key !== `${turn.T}`) log.turns++;
                            armed = { key: `${turn.T}`, myT, schedule: turn.schedule, fired: false, essence: invCount(s, /rune essence/i) };
                        } else if (armed?.key !== `${turn.T}`) {
                            log.late++;
                            done.add(`${turn.T}`);
                        }
                    }
                }
            } else if (cue?.stop && armed && !armed.fired) armed = null;
            const a = armed;
            if (!a) return;
            const o = a.myT + OPEN;
            const land = myNow + 1;
            const scored = H.getNearbyPlayers().find(p => canon(p.name) === canon(scoredName));
            if (land === o) {
                a.fired = true;
                if (scored) void H.sendTradeRequest(scored.index);
            } else if (land === o + 1) {
                const slot = s.inventory.find(it => /rune essence/i.test(it.name))?.slot ?? -1;
                void H.sendOfferItem(slot, -1).then(() => H.sendClickComponent(TRADE_ACCEPT));
            } else if (land === o + 2 || (land === o + 3 && a.schedule === 'robust')) {
                void H.sendClickComponent(TRADE_CONFIRM);
            } else if (land >= o + (a.schedule === 'robust' ? 5 : 4)) {
                // judged on the frame after its last landing: a completed trade has left the inventory
                const gave = invCount(s, /rune essence/i) === 0;
                if (gave) log.gave++;
                else log.missed++;
                done.add(a.key);
                armed = null;
                if (s.trade?.isOpen) void H.sendCloseModal();
                if (gave) {
                    void cheat(H, 'give blankrune 27').then(async () => {
                        await waitTicks(H, 2);
                        readyAt.set(me, Date.now());
                        await feed();
                    });
                }
            }
        };
        unsubs.push(H.onStateUpdate(s => {
            if (s.tick === lastTick) return; // republished within the tick after an action
            lastTick = s.tick;
            frames.push({ tick: s.tick, ms: Date.now() });
            if (frames.length > 200) frames.shift();
            onFrame(s);
        }));
    }

    // ---- run.ts's relay: the page's turns and beacons to the givers, as cue.json would carry them
    unsubs.push(S.onStateUpdate(s => {
        const f = rcCueFields((s as { program?: ProgramStatus }).program);
        if (f && f.key !== cue?.key) cue = f;
        else if (f && cue) cue = { ...cue, beacons: f.beacons };
    }));

    const xp0 = rcXp(S.getState());
    const untilXp = xp0 + d.crafts * 27 * A.xp * 25;
    const started = await startProgram(S, 'rc-cycle', { untilXp, schedule: d.schedule, givers: d.givers.map(name => ({ name, schedule: d.schedule, readyAt: readyAt.get(name) })) });
    let end: ProgramStatus;
    try {
        end = await awaitProgram(S, started.runId, { onProgress: d.onProgress });
    } finally {
        for (const u of unsubs) u();
        // an open SDK connection would keep the measure process alive after its last mode
        await Promise.all(G.map(H => H.disconnect().catch(() => {})));
    }
    const r = end.result as { crafts: number; ticksPerCycle: number; gaps: Record<string, number>; outcomes: Record<string, number>; orders: Record<string, number>; salvaged: number; reanchors: number };
    const shared = end.shared as RcShared | undefined;
    const results = shared?.results ?? [];
    const scoredFirstGaps = results.filter(x => x.order === 'scored-first' && x.craft !== undefined).map(x => x.craft! - x.T);
    return {
        altar: d.altar,
        schedule: d.schedule,
        end,
        givers: logs.map(l => ({ ...l, offsetErrMs: l.offsetErrMs.length ? Math.max(...l.offsetErrMs) : null })),
        summary: {
            altar: d.altar,
            schedule: d.schedule,
            givers: d.givers.length,
            crafts: r?.crafts,
            ticksPerCraft: r?.ticksPerCycle,
            gaps: r?.gaps,
            outcomes: r?.outcomes,
            orders: r?.orders,
            salvaged: r?.salvaged,
            reanchors: r?.reanchors,
            scoredFirstTurnTicks: scoredFirstGaps,
            notGave: results.filter(x => x.outcome !== 'gave').map(x => ({ giver: x.giver, T: x.T, outcome: x.outcome, detail: x.detail, seen: x.seen })),
            deferred: end.deferred,
            skippedTicks: end.skippedTicks
        }
    };
}
