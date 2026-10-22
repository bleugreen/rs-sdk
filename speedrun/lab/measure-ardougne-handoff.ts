// The hand-offs at the Ardougne teleport landing (H11 before S14, H11r after it, H23 before S27;
// rs/158): what a trade with a helper on the serve tile costs SCORED net of the run west that
// T13-14, T14-15 and T26-27 make from the landing anyway.
//
//   LAB_HELPERS=srho2 bash speedrun/lab/lab.sh srho1 'speedrun/lab/measure-ardougne-handoff.ts:--helper=srho2:--n=10'
//
// The landing is random: map_findsquare(tele_coord (2661,3301), 0, 2, lineofwalk), so any walkable
// tile within 2 (teleport.rs2). Each sample: SCORED is ::tele'd away (untimed), casts the Ardougne
// teleport, and from the first state on the landing (L) either
// - trades: the helper, standing on the serve tile, requests the trade the tick SCORED lands and
//   offers 1 coin; SCORED accepts (lib/trade.ts receiveFrom, which paths it adjacent); then SCORED
//   runs west to WEST, a point every one of those legs' runs passes; or
// - runs straight from L to WEST (the baseline).
// Net approach cost = (L to WEST with the trade) - (trade open to items received) - mean baseline.
// Also logged: every landing tile, and whether anything else stood on the serve tile.

import { closeSession, openSession, type Session } from '../lib/session';
import { give as giveTrade, receiveFrom, tradeOf } from '../lib/trade';
import { castTeleport } from '../lib/act';
import { inArea, runTo, SPELLS, type TravelSdk } from '../lib/travel';
import { waitTicks, waitUntil } from '../lib/wait';
import { pos } from '../lib/world';
import { arg, botArg, result } from './common';
import { cheat, give, mustTele, setStats, tele } from './setup';

const n = Number(arg('n', '10'));
const TILES = [{ x: 2658, z: 3301 }, { x: 2659, z: 3301 }];
/** On every run west from the landing (to the lever at 2562,3311 or the Khazard young tree at 2555,3259). */
const WEST = { x: 2648, z: 3302, tol: 2 };
const AWAY = { x: 3222, z: 3218 };
const LANDING = SPELLS.ardougne.landing;

async function offIsland(s: Session): Promise<void> {
    const st = s.sdk.getState();
    if (st?.player && st.player.worldX > 3040 && st.player.worldX < 3160 && st.player.worldZ > 3040 && st.player.worldZ < 3140) {
        await s.bot.skipTutorial();
        await waitUntil(s.sdk, x => !!x.player && !(x.player.worldX > 3040 && x.player.worldX < 3160 && x.player.worldZ > 3040 && x.player.worldZ < 3140), { maxTicks: 40 });
    }
}

const sc = await openSession(botArg());
const hp = await openSession(arg('helper', 'srho2'), { pathfinding: false });
await offIsland(sc);
await offIsland(hp);
await setStats(sc.sdk, { magic: 99, hitpoints: 99 });
await give(sc.sdk, ['waterrune', 'lawrune'], 500);
await give(hp.sdk, 'coins', 1000);

let tile = TILES[0]!;
for (const t of TILES) {
    if (await tele(hp.sdk, t.x, t.z)) { tile = t; break; }
}
result('serve_tile', { tile, helperAt: pos(hp.sdk) });

const at = (s: Session) => pos(s.sdk);
const samples: Array<Record<string, unknown>> = [];
const baseline: number[] = [];
const trades: Array<{ net: number; approach: number; trade: number; post: number; landing: unknown }> = [];

async function landArdougne(): Promise<{ L: number; landing: { x: number; z: number } }> {
    await mustTele(sc.sdk, AWAY.x, AWAY.z);
    await waitTicks(sc.sdk, 2);
    const r = await castTeleport(sc.sdk as never, 'ardougne', 25, s => inArea(s, LANDING));
    if (!r.ok) throw new Error(`teleport: ${r.reason}`);
    const st = sc.sdk.getState()!;
    return { L: st.tick, landing: { x: st.player!.worldX, z: st.player!.worldZ } };
}

const occupied = () => {
    const s = hp.sdk.getState();
    return (s?.nearbyNpcs ?? []).some(x => x.x === tile.x && x.z === tile.z) || (s?.nearbyPlayers ?? []).some(p => p.x === tile.x && p.z === tile.z && p.name !== sc.name);
};

for (let i = 0; i < n + Math.ceil(n / 2); i++) {
    const traded = i % 3 !== 2; // two trade samples, then a baseline
    try {
        if (!(await tele(hp.sdk, tile.x, tile.z))) throw new Error('helper off its tile');
        const busy = occupied();
        const { L, landing } = await landArdougne();
        if (!traded) {
            const r = await runTo(sc.sdk as unknown as TravelSdk, WEST);
            const t = sc.sdk.getState()!.tick - L;
            baseline.push(t);
            samples.push({ i, kind: 'baseline', landing, ticks: t, ok: r.ok });
            result('sample', samples.at(-1));
            continue;
        }
        let openTick = -1;
        const stop = sc.sdk.onStateUpdate(s => { if (openTick < 0 && tradeOf(s).isOpen) openTick = s.tick; });
        const g = giveTrade(hp.sdk, sc.name, [{ item: /^coins$/i, n: 1 }]);
        const r = await receiveFrom(sc.sdk, hp.name, { want: [{ item: /^coins$/i, amount: 1 }] });
        const gr = await g;
        stop();
        const D = sc.sdk.getState()!.tick;
        if (!r.ok || !gr.ok) throw new Error(`trade: ${r.reason ?? ''} ${gr.reason ?? ''}`);
        const w = await runTo(sc.sdk as unknown as TravelSdk, WEST);
        const X = sc.sdk.getState()!.tick;
        const s = { i, kind: 'trade', landing, approach: openTick - L, trade: D - openTick, post: X - D, total: X - L, ok: w.ok, tileBusy: busy, scoredAtOpen: at(sc) };
        samples.push(s);
        result('sample', s);
        trades.push({ net: 0, approach: openTick - L, trade: D - openTick, post: X - D, landing });
    } catch (e) {
        result('sample', { i, error: e instanceof Error ? e.message : String(e) });
    }
    await cheat(sc.sdk, 'setstat hitpoints 99');
}

const mean = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : NaN);
const base = mean(baseline);
for (const t of trades) t.net = t.approach + t.post - base;
result('summary', {
    tile, baseline: { mean: base, runs: baseline },
    trades: trades.length, approach: mean(trades.map(t => t.approach)), trade: mean(trades.map(t => t.trade)), post: mean(trades.map(t => t.post)),
    netApproach: { mean: mean(trades.map(t => t.net)), runs: trades.map(t => t.net) },
    landings: samples.map(s => s.landing),
});
await closeSession(hp);
await closeSession(sc);
