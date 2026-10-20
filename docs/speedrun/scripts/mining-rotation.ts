// Executes an iron-rock rotation in the lab and checks the timing model of
// mining-rotation-plan.ts against observed xp ticks.
//
//   bun docs/speedrun/scripts/mining-rotation.ts <bot> --rocks 2710,3328 2711,3329 ...
//       [--start 2710,3329] [--ores 120] [--level 99] [--respawn 19] [--trick on|off]
//
// --rocks is the order rocks are mined in, repeated cyclically (take it from the
// planner's --show output). Ticks below are state.tick labels; a click sent while
// label c is current is processed on server tick c+1, and xp from a roll on server
// tick R is first visible at label R+1 (see mining-cycle.ts).
//
// For each next rock the script takes whichever lands the roll earliest:
//   stay   the rock is beside us: click it; roll 2 ticks after the click lands.
//   trick  click a live rock beside us (starts the 2-tick timer without mining it),
//          next tick click the target; we run there and the first swing on arrival+1
//          rolls at once because %action_delay == map_clock (mining.rs2:81-85).
//   walk   click the target; we run m ticks, op fires the tick after arrival
//          (Player.ts: tryInteract(stepsTaken === 0)), roll 2 ticks later.
// A rock depleted by a roll on tick R accepts clicks processed from R+respawn.
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';
import { IRON_IDS, arg, dropMatching, mineOp, miningXp, nextTick, setup, summarize } from './mining-lib';

type P = [number, number];
const argv = process.argv.slice(2);
const ri = argv.indexOf('--rocks');
const ROCKS: P[] = [];
for (let i = ri + 1; ri >= 0 && i < argv.length && !argv[i]!.startsWith('--'); i++) ROCKS.push(argv[i]!.split(',').map(Number) as P);
if (!ROCKS.length) throw new Error('--rocks x,z x,z ... required');
const START = arg('start', '').split(',').map(Number) as P;
const ORES = Number(arg('ores', '120'));
const LEVEL = Number(arg('level', '99'));
const RESPAWN = Number(arg('respawn', '19'));
const TRICK = arg('trick', 'on') === 'on';
const RUNSTEP = 2;

const uniq = [...new Map(ROCKS.map(r => [`${r[0]},${r[1]}`, r])).values()];
const beside = (pos: P, r: P) => Math.abs(pos[0] - r[0]) + Math.abs(pos[1] - r[1]) === 1;
const cheb = (a: P, b: P) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
// Steps to the nearest tile beside rock r (ignores collision; the client routes for real).
const stepsTo = (pos: P, r: P) => Math.min(...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => cheb(pos, [r[0] + dx!, r[1] + dz!])));

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial?.();
    const start: P = START.length === 2 && !START.some(Number.isNaN) ? START : [ROCKS[0]![0], ROCKS[0]![1] + 1];
    let s: BotWorldState = await setup(sdk, { level: LEVEL, pick: 'rune_pickaxe', x: start[0], z: start[1] });
    const avail = new Map<string, number>(uniq.map(r => [`${r[0]},${r[1]}`, -Infinity]));
    const av = (r: P) => avail.get(`${r[0]},${r[1]}`)!;
    const locId = (st: BotWorldState, r: P) => st.nearbyLocs.find(l => l.x === r[0] && l.z === r[1] && IRON_IDS.includes(l.id))?.id ?? IRON_IDS[0]!;

    // pending sends: label -> rock to click (and whether to drop ore with it)
    const sends = new Map<number, P>();
    const predicted: number[] = [];
    const ticks: number[] = [];
    const xps: number[] = [];
    const kinds: Record<string, number> = { stay: 0, trick: 0, walk: 0 };
    const log: string[] = [];
    let lastXp = miningXp(s);
    let step = 0;
    let R = s.tick - 2; // pretend a roll just happened so the first click goes out now
    let pos: P = [s.player!.worldX, s.player!.worldZ];
    let planUntil = -1; // label of the roll we are waiting for

    const planNext = () => {
        const r = ROCKS[step % ROCKS.length]!;
        step++;
        const options: { kind: string; roll: number; sendsAt: [number, P][] }[] = [];
        if (beside(pos, r)) {
            const send = Math.max(R, av(r) - 1);
            options.push({ kind: 'stay', roll: send + 3, sendsAt: [[send, r]] });
        } else {
            const m = Math.ceil(stepsTo(pos, r) / RUNSTEP);
            const send = Math.max(R, av(r) - 1 - m);
            options.push({ kind: 'walk', roll: send + 1 + m + 2, sendsAt: [[send, r]] });
            if (TRICK && m === 1) {
                for (const st of uniq) {
                    if (!beside(pos, st)) continue;
                    const u = Math.max(R + 1, av(st)); // starter click processed on u
                    if (av(r) <= u + 2) options.push({ kind: 'trick', roll: u + 2, sendsAt: [[u - 1, st], [u, r]] });
                }
            }
        }
        options.sort((a, b) => a.roll - b.roll || (a.kind === 'stay' ? -1 : 1));
        const o = options[0]!;
        kinds[o.kind]!++;
        for (const [t, p] of o.sendsAt) sends.set(Math.max(t, s.tick), p);
        avail.set(`${r[0]},${r[1]}`, o.roll + RESPAWN);
        predicted.push(o.roll);
        log.push(`plan #${step} ${o.kind} rock ${r.join(',')} from ${pos.join(',')} roll@${o.roll}`);
        R = o.roll;
        planUntil = o.roll;
    };
    planNext();

    while (ticks.length < ORES) {
        s = await nextTick(sdk, s.tick);
        if (s.dialog.isOpen) sdk.sendClickDialog(0).catch(() => {});
        const xp = miningXp(s);
        if (xp > lastXp) {
            ticks.push(s.tick);
            xps.push(xp - lastXp);
            log.push(`  xp +${xp - lastXp} seen@${s.tick} (roll ${s.tick - 1}, predicted ${predicted[ticks.length - 1]})`);
            lastXp = xp;
        }
        const p = sends.get(s.tick);
        if (p) {
            sends.delete(s.tick);
            dropMatching(sdk, s, /ore$|^uncut/i, 3);
            sdk.sendInteractLoc(p[0], p[1], locId(s, p), 1).catch(() => {});
        }
        // Plan the next rock on the roll tick itself: our position is current (PLAYER_INFO
        // carries this tick's movement) and the next click must go out on this label.
        if (s.tick >= planUntil && sends.size === 0) {
            pos = [s.player!.worldX, s.player!.worldZ];
            planNext();
            const now = sends.get(s.tick);
            if (now) {
                sends.delete(s.tick);
                dropMatching(sdk, s, /ore$|^uncut/i, 3);
                sdk.sendInteractLoc(now[0], now[1], locId(s, now), 1).catch(() => {});
            }
        }
        if (s.tick > planUntil + 40) throw new Error(`stalled; log:\n${log.slice(-12).join('\n')}`);
    }
    const off = ticks.map((t, i) => t - 1 - predicted[i]!);
    const offHist: Record<number, number> = {};
    for (const o of off) offHist[o] = (offHist[o] ?? 0) + 1;
    console.log(log.slice(-40).join('\n'));
    console.log(`\ntransitions: ${JSON.stringify(kinds)}  observed-minus-predicted roll tick: ${JSON.stringify(offHist)}`);
    summarize(`rotation of ${uniq.length} rocks, trick=${TRICK}`, ticks.slice(10), xps.slice(10));
    console.log(`run energy now: ${s.player?.runEnergy}`);
}, { timeout: 30 * 60_000 });
