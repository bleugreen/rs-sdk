// Executes an iron-rock rotation in the lab and checks the timing model of
// mining-rotation-plan.ts against observed xp ticks.
//
//   bun docs/speedrun/scripts/mining-rotation.ts <bot> --rocks 2710,3328 2711,3329 ...
//       [--start 2710,3329] [--ores 120] [--level 99] [--respawn 19] [--trick on|off]
//       [--agility 99] [--min-energy 9000] [--loghead 40]
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
import { isTileWalkable } from '../../../sdk/pathfinding';
import { IRON_IDS, arg, dropMatching, mineOp, miningXp, nextTick, setup, stepMap, summarize } from './mining-lib';

type P = [number, number];
const argv = process.argv.slice(2);
const ri = argv.indexOf('--rocks');
const ROCKS: P[] = [];
for (let i = ri + 1; ri >= 0 && i < argv.length && !argv[i]!.startsWith('--'); i++) ROCKS.push(argv[i]!.split(',').map(Number) as P);
// --steps stand>rock ... replays the planner's steps exactly (its --show output, one period).
// The bot walks to the planner's standing tile itself (MOVE_GAMECLICK) and clicks the rock
// once beside it; the first swing lands on the same tick the walk-into-op would, so choosing
// the tile costs nothing and keeps the planner's stay/trick options.
const si = argv.indexOf('--steps');
const STEPS: { stand: P; rock: P }[] = [];
for (let i = si + 1; si >= 0 && i < argv.length && !argv[i]!.startsWith('--'); i++) {
    const [a, b] = argv[i]!.replace(/^\d+:/, '').split('>');
    STEPS.push({ stand: a!.split(',').map(Number) as P, rock: b!.split(',').map(Number) as P });
}
if (STEPS.length) for (const st of STEPS) ROCKS.push(st.rock);
if (!ROCKS.length) throw new Error('--rocks x,z ... or --steps stand>rock ... required');
const START = arg('start', '').split(',').map(Number) as P;
const ORES = Number(arg('ores', '120'));
const LEVEL = Number(arg('level', '99'));
const RESPAWN = Number(arg('respawn', '19'));
const TRICK = arg('trick', 'on') === 'on';
const RUNSTEP = 2;
const AGILITY = Number(arg('agility', '1'));
const MIN_ENERGY = Number(arg('min-energy', '0'));

const uniq = [...new Map(ROCKS.map(r => [`${r[0]},${r[1]}`, r])).values()];
const beside = (pos: P, r: P) => Math.abs(pos[0] - r[0]) + Math.abs(pos[1] - r[1]) === 1;
const cheb = (a: P, b: P) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
// Steps to the nearest tile beside rock r: corner-aware BFS over the SDK collision map with
// every iron rock treated as blocked (the client routes the same way).
const rockSet = new Set(uniq.map(r => `${r[0]},${r[1]}`));
const stepsTo = (pos: P, r: P) => {
    const d = stepMap(pos, rockSet, (x, z) => isTileWalkable(0, x, z));
    return Math.min(...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => d.get(`${r[0] + dx!},${r[1] + dz!}`) ?? Infinity));
};
void cheb;

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial?.();
    const start: P = START.length === 2 && !START.some(Number.isNaN) ? START : [ROCKS[0]![0], ROCKS[0]![1] + 1];
    let s: BotWorldState = await setup(sdk, { level: LEVEL, pick: 'rune_pickaxe', x: start[0], z: start[1] });
    // Run energy regenerates (agility/6)+8 per non-running tick (Player.ts updateEnergy).
    if (AGILITY > 1) await sdk.sendSay(`::setstat agility ${AGILITY}`);
    while ((s.player?.runEnergy ?? 0) < MIN_ENERGY) s = await nextTick(sdk, s.tick);
    console.log(`starting with run energy ${s.player?.runEnergy}`);
    const avail = new Map<string, number>(uniq.map(r => [`${r[0]},${r[1]}`, -Infinity]));
    const av = (r: P) => avail.get(`${r[0]},${r[1]}`)!;
    const locId = (st: BotWorldState, r: P) => st.nearbyLocs.find(l => l.x === r[0] && l.z === r[1] && IRON_IDS.includes(l.id))?.id ?? IRON_IDS[0]!;

    // pending sends: label -> rock to click, or a tile to walk to
    const sends = new Map<number, P>();
    const walks = new Set<number>(); // labels whose send is a walk, not a rock click
    const tileSteps = (a: P, b: P) => (a[0] === b[0] && a[1] === b[1] ? 0 : stepMap(a, rockSet, (x, z) => isTileWalkable(0, x, z)).get(`${b[0]},${b[1]}`) ?? Infinity);
    const predicted: number[] = [];
    // Rolls awaiting their xp; a roll on server tick R shows xp at label R+1.
    const pending: { roll: number; rock: P }[] = [];
    let onTime = 0, failed = 0, levelUps = 0;
    let prevAvail = -Infinity;
    let lastLevel = 0;
    let lastKind = '';
    const ticks: number[] = [];
    const xps: number[] = [];
    const kinds: Record<string, number> = { stay: 0, trick: 0, walk: 0 };
    const log: string[] = [];
    let lastXp = miningXp(s);
    let step = 0;
    let R = s.tick; // treat "now" as a roll tick so the first click goes out now
    let pos: P = [s.player!.worldX, s.player!.worldZ];
    let planUntil = -1; // label of the roll we are waiting for

    const planNext = () => {
        const r = ROCKS[step % ROCKS.length]!;
        const stand = STEPS.length ? STEPS[step % STEPS.length]!.stand : null;
        step++;
        const options: { kind: string; roll: number; sendsAt: [number, P][]; walkAt?: number[] }[] = [];
        if (stand && !(stand[0] === pos[0] && stand[1] === pos[1])) {
            const d = tileSteps(pos, stand);
            const m = Math.ceil(d / RUNSTEP);
            // walk to the stand, click the rock on arrival (processed the tick after arrival)
            const w = Math.max(R, av(r) - 1 - m);
            options.push({ kind: 'walk', roll: w + m + 3, sendsAt: [[w, stand], [w + m, r]], walkAt: [w] });
            if (TRICK && d <= RUNSTEP) {
                for (const st of uniq) {
                    if (!beside(pos, st)) continue;
                    const u = Math.max(R + 1, av(st));
                    if (av(r) <= u + 2) options.push({ kind: 'trick', roll: u + 2, sendsAt: [[u - 1, st], [u, stand], [u + 1, r]], walkAt: [u] });
                }
            }
        } else if (beside(pos, r)) {
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
        lastKind = o.kind;
        for (const [t, p] of o.sendsAt) {
            const at = Math.max(t, s.tick);
            sends.set(at, p);
            if (o.walkAt?.includes(t)) walks.add(at);
        }
        prevAvail = av(r);
        avail.set(`${r[0]},${r[1]}`, o.roll + RESPAWN);
        predicted.push(o.roll);
        pending.push({ roll: o.roll, rock: r });
        log.push(`plan #${step} ${o.kind} rock ${r.join(',')} from ${pos.join(',')} roll@${o.roll}`);
        R = o.roll;
        planUntil = o.roll;
    };
    const flush = (st: BotWorldState) => {
        for (const [t, p] of [...sends].sort((a, b) => a[0] - b[0])) {
            if (t > st.tick) continue;
            sends.delete(t);
            if (walks.delete(t)) {
                sdk.sendWalk(p[0], p[1], true).catch(() => {});
                continue;
            }
            dropMatching(sdk, st, /ore$|^uncut/i, 3);
            sdk.sendInteractLoc(p[0], p[1], locId(st, p), 1).catch(() => {});
        }
    };
    planNext();
    flush(s);

    while (ticks.length < ORES) {
        s = await nextTick(sdk, s.tick);
        const xp = miningXp(s);
        const lvl = s.skills.find(k => k.name.toLowerCase() === 'mining')?.baseLevel ?? 0;
        if (lvl > lastLevel && lastLevel > 0 && lastKind === 'walk') {
            // Walking continues while the modal is open (processInteraction still moves us), and the op
            // only fires after arrival; re-sending the same click now closes the modal before then, so
            // the planned roll tick stands.
            const last = pending[pending.length - 1];
            if (last) sdk.sendInteractLoc(last.rock[0], last.rock[1], locId(s, last.rock), 1).catch(() => {});
            levelUps++;
            log.push(`  level ${lvl} seen@${s.tick} during a walk: click re-sent, plan kept`);
        } else if (lvl > lastLevel && lastLevel > 0) {
            // A level-up from the roll on R (seen now, at R+1) queued [advancestat] in the ENGINE
            // queue, which runs on R+1 before interactions (World.ts processPlayers) and opens a
            // chat modal, so the click that landed on R+1 was blocked (Player.canAccess). Drop the
            // plan made on R and re-plan the same rock from now: the re-sent click lands on R+2 and
            // closes the modal itself (OpLocHandler: clearPendingAction -> closeModal).
            const last = pending.pop();
            sends.clear();
            if (last) {
                avail.set(`${last.rock[0]},${last.rock[1]}`, prevAvail);
                predicted.pop();
                step--;
            }
            levelUps++;
            log.push(`  level ${lvl} seen@${s.tick}: re-planning from here`);
            R = s.tick;
            pos = [s.player!.worldX, s.player!.worldZ];
            planNext();
        }
        lastLevel = lvl;
        if (s.dialog.isOpen && sends.size === 0 && s.tick < planUntil - 2) sdk.sendClickDialog(0).catch(() => {});
        if (xp > lastXp) {
            ticks.push(s.tick);
            xps.push(xp - lastXp);
            log.push(`  xp +${xp - lastXp} seen@${s.tick} (roll ${s.tick - 1})`);
        }
        for (let i = pending.length - 1; i >= 0; i--) {
            const pr = pending[i]!;
            if (pr.roll + 1 !== s.tick) continue;
            pending.splice(i, 1);
            if (xp > lastXp) onTime++;
            else {
                // Failed roll (or a model miss): the rock did not deplete, so it is clickable now.
                failed++;
                avail.set(`${pr.rock[0]},${pr.rock[1]}`, -Infinity);
                log.push(`  no xp for roll@${pr.roll} on ${pr.rock.join(',')}`);
            }
        }
        lastXp = xp;
        flush(s);
        // Plan the next rock on the roll tick itself: our position is current (PLAYER_INFO
        // carries this tick's movement) and the next click must go out on this label.
        if (s.tick >= planUntil && sends.size === 0) {
            pos = [s.player!.worldX, s.player!.worldZ];
            planNext();
            flush(s);
        }
        if (s.tick > planUntil + 40) throw new Error(`stalled; log:\n${log.slice(-12).join('\n')}`);
    }
    console.log(log.slice(0, Number(arg('loghead', '40'))).join('\n'));
    console.log(`\ntransitions: ${JSON.stringify(kinds)}  rolls with xp on the predicted tick: ${onTime}, rolls without xp: ${failed}, level-ups: ${levelUps}, xp events: ${ticks.length}`);
    summarize(`rotation of ${uniq.length} rocks, trick=${TRICK}`, ticks.slice(10), xps.slice(10));
    console.log(`run energy now: ${s.player?.runEnergy}`);
}, { timeout: 30 * 60_000 });
