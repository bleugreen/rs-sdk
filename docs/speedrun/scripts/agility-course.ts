// Times laps of an Agility course on the local lab (docs/speedrun/LAB.md).
//   bun docs/speedrun/scripts/agility-course.ts <bot> <gnome|barbarian|wilderness> <laps> [agility=99] [hitpoints=99]
// Logs the server tick of every Agility xp change, then reports ticks per lap
// (gap between lap-bonus xp events), ticks per obstacle, failures and damage.
import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk';
import { XpLog, cheat, tele, pos, tick, waitTicksFor, summary, agilityXp, XP_RATE } from './agility-lib';

interface Step {
    name: string;
    /** candidate locs (id, x, z); the nearest visible one is clicked */
    locs: [number, number, number][];
    /** base xp the obstacle awards on success (lap bonus included on the last step) */
    xp: number;
    /** for steps that award no xp: done when the plane becomes this */
    plane?: number;
    /** option index to use (default 1) */
    op?: number;
}

interface Course {
    start: [number, number, number]; // x, z, plane
    steps: Step[];
    lapBonus: number;
}

// Loc ids from server/content/pack/loc.pack, positions from server/content/maps.
const COURSES: Record<string, Course> = {
    gnome: {
        start: [2474, 3436, 0],
        lapBonus: 39,
        steps: [
            { name: 'log', locs: [[2295, 2474, 3435]], xp: 7.5 },
            { name: 'net', locs: [[2285, 2473, 3425], [2285, 2475, 3425], [2285, 2471, 3425]], xp: 7.5 },
            { name: 'branch', locs: [[2313, 2473, 3422]], xp: 5 },
            { name: 'rope', locs: [[2312, 2478, 3420]], xp: 7.5 },
            { name: 'tree-down', locs: [[2314, 2486, 3419], [2315, 2487, 3420], [2315, 2487, 3418]], xp: 5 },
            { name: 'net2', locs: [[2286, 2485, 3426], [2286, 2483, 3426], [2286, 2487, 3426]], xp: 7.5 },
            { name: 'pipe', locs: [[154, 2484, 3431], [4058, 2487, 3431]], xp: 7.5 + 39 },
        ],
    },
    barbarian: {
        start: [2551, 3554, 0],
        lapBonus: 42,
        steps: [
            { name: 'ropeswing', locs: [[2282, 2551, 3550]], xp: 20 },
            { name: 'log', locs: [[2294, 2550, 3546]], xp: 12.5 },
            { name: 'net', locs: [[2284, 2538, 3545]], xp: 7.5 },
            { name: 'ledge', locs: [[2302, 2535, 3547]], xp: 20 },
            { name: 'ladder-down', locs: [], xp: 0, plane: 0, op: -1 },
            { name: 'wall1', locs: [[1948, 2536, 3553]], xp: 12.5 },
            { name: 'wall2', locs: [[1948, 2539, 3553]], xp: 12.5 },
            { name: 'wall3', locs: [[1948, 2542, 3553]], xp: 12.5 + 42 },
        ],
    },
    wilderness: {
        start: [3004, 3937, 0],
        lapBonus: 498.9,
        steps: [
            { name: 'pipe', locs: [[2288, 3004, 3938]], xp: 12.5 },
            { name: 'ropeswing', locs: [[2283, 3005, 3952]], xp: 20 },
            { name: 'stones', locs: [[2311, 3001, 3960]], xp: 20 },
            { name: 'log', locs: [[2297, 3001, 3945]], xp: 20 },
            { name: 'rocks', locs: [[2328, 2994, 3936], [2328, 2993, 3936], [2328, 2995, 3936]], xp: 498.9 },
        ],
    },
};

const [, , , courseName = 'wilderness', lapsArg = '5', aglArg = '99', hpArg = '99'] = process.argv;
const course = COURSES[courseName];
if (!course) throw new Error(`unknown course ${courseName}`);
const laps = +lapsArg;

// Every fail branch in the course scripts prints one of these (gnome_course.rs2 has none).
const FAIL_RE = /slip and fall|lose your footing|lost your balance|missed a hand hold|missed the rope|were hit by|stumbled|stepped on a broken/i;

async function nearestLoc(sdk: BotSDK, cands: [number, number, number][]) {
    const locs = await sdk.scanNearbyLocs(25);
    const me = pos(sdk);
    let best: [number, number, number] | null = null;
    let bestD = 1e9;
    for (const c of cands) {
        if (!locs.some(l => l.id === c[0] && l.x === c[1] && l.z === c[2])) continue;
        const d = Math.max(Math.abs(c[1] - me.x), Math.abs(c[2] - me.z));
        if (d < bestD) { bestD = d; best = c; }
    }
    // Bridge-flagged locs (logs and ledges stored on plane 1 over plane-0 tiles)
    // never show up in the scan; the server resolves them anyway.
    return best ?? cands[0] ?? null;
}

async function clickByOption(sdk: BotSDK, re: RegExp) {
    const locs = await sdk.scanNearbyLocs(10);
    const me = pos(sdk);
    const loc = locs
        .filter(l => l.optionsWithIndex.some(o => re.test(o.text)))
        .sort((a, b) => Math.max(Math.abs(a.x - me.x), Math.abs(a.z - me.z)) - Math.max(Math.abs(b.x - me.x), Math.abs(b.z - me.z)))[0];
    if (!loc) return false;
    const op = loc.optionsWithIndex.find(o => re.test(o.text))!.opIndex;
    await sdk.sendInteractLoc(loc.x, loc.z, loc.id, op);
    return true;
}

/** After a fall into a pit (underground, z > 6400), climb back out. */
async function climbOutOfPit(sdk: BotSDK) {
    for (let i = 0; i < 5 && pos(sdk).z > 6400; i++) {
        if (!(await clickByOption(sdk, /climb-up/i))) {
            console.log('  no climb-up loc near', pos(sdk));
            return;
        }
        await waitTicksFor(sdk, s => (s.player?.worldZ ?? 0) < 6400, 40);
    }
}

await runScript(async ({ sdk }) => {
    await cheat(sdk, `setstat agility ${aglArg}`);
    await cheat(sdk, `setstat hitpoints ${hpArg}`);
    await tele(sdk, course.start[0], course.start[1], course.start[2]);
    const log = new XpLog(sdk);
    const startXp = agilityXp(sdk.getState());
    const t0 = tick(sdk);
    const fails: Record<string, number> = {};
    const attempts: Record<string, number> = {};
    const stepTicks: Record<string, number[]> = {};
    const lapTicks: number[] = [];
    const failDamage: { step: string; hpBefore: number; dmg: number }[] = [];
    let lastDoneTick = t0;
    let stuck = 0;
    let heals = 0;

    for (let lap = 0; lap < laps; lap++) {
        let i = 0;
        const lapStart = tick(sdk);
        while (i < course.steps.length) {
            const step = course.steps[i];
            attempts[step.name] = (attempts[step.name] ?? 0) + 1;
            const evBefore = log.events.length;
            const hpBefore = sdk.getState()?.player?.hp ?? 0;
            const clickTick = tick(sdk);
            if (step.op === -1) {
                if (!(await clickByOption(sdk, /climb-down/i))) throw new Error('no climb-down ladder found');
                const ok = await waitTicksFor(sdk, s => s.player?.level === step.plane, 40);
                if (!ok) throw new Error(`${step.name} did not change plane`);
                (stepTicks[step.name] ??= []).push(tick(sdk) - lastDoneTick);
                lastDoneTick = tick(sdk);
                i++;
                continue;
            }
            const target = await nearestLoc(sdk, step.locs);
            if (!target) {
                console.log(`  lap ${lap} ${step.name}: no candidate loc visible from`, pos(sdk));
                if (++stuck > 5) throw new Error('stuck');
                if (i > 0) i--;
                continue;
            }
            sdk.getNewChat({ types: [0] });
            const msgs: string[] = [];
            if (tick(sdk) - lapStart > 3000) throw new Error(`lap ${lap} exceeded 3000 ticks at step ${step.name}`);
            await sdk.sendInteractLoc(target[1], target[2], target[0], 1);
            // done when an xp event of at least the obstacle's xp arrives; failed on a fail message
            let moved = false;
            let failed = false;
            const p0 = pos(sdk);
            const ok = await waitTicksFor(sdk, s => {
                const p = s.player;
                if (p && (p.worldX !== p0.x || p.worldZ !== p0.z || p.level !== p0.level)) moved = true;
                for (const m of sdk.getNewChat({ types: [0] })) {
                    msgs.push(m.text);
                    if (FAIL_RE.test(m.text)) failed = true;
                }
                // falls into a pit (wilderness/barbarian) land underground
                if ((p?.worldZ ?? 0) > 6400 && p0.z < 6400) failed = true;
                if (failed) return true;
                return log.events.slice(evBefore).some(e => e.baseGain >= step.xp - 0.05);
            }, 80);
            const gained = log.events.slice(evBefore).some(e => e.baseGain >= step.xp - 0.05);
            if (gained) {
                const ev = log.events.slice(evBefore).find(e => e.baseGain >= step.xp - 0.05)!;
                (stepTicks[step.name] ??= []).push(ev.tick - lastDoneTick);
                lastDoneTick = ev.tick;
                stuck = 0;
                i++;
                continue;
            }
            if (failed) {
                // let the fail script finish
                await sdk.waitForTicks(4);
                const hpNow = sdk.getState()?.player?.hp ?? 0;
                fails[step.name] = (fails[step.name] ?? 0) + 1;
                failDamage.push({ step: step.name, hpBefore, dmg: hpBefore - hpNow });
                if (pos(sdk).z > 6400) await climbOutOfPit(sdk);
                console.log(`  lap ${lap} ${step.name}: FAIL at tick ${clickTick}, -${hpBefore - hpNow}hp, now at`, pos(sdk));
                if (sdk.getState()!.player!.hp < +hpArg * 0.4) { await cheat(sdk, `setstat hitpoints ${hpArg}`); heals++; }
                // progress varp is kept, so retry the same obstacle
                continue;
            }
            console.log(`  lap ${lap} ${step.name}: no xp after click (ok=${ok}, moved=${moved}) at`, pos(sdk), msgs.slice(-3));
            if (sdk.getState()!.player!.hp < +hpArg * 0.4) { await cheat(sdk, `setstat hitpoints ${hpArg}`); heals++; }
            if (++stuck > 5) throw new Error('stuck');
            if (!moved && i > 0) i--; // unreachable from here: redo the previous obstacle
        }
        const bonus = log.events.filter(e => e.baseGain >= course.lapBonus - 0.05);
        if (bonus.length >= 2) lapTicks.push(bonus[bonus.length - 1].tick - bonus[bonus.length - 2].tick);
        console.log(`lap ${lap + 1} done at tick ${lastDoneTick} (${tick(sdk) - t0} since start), run energy ${sdk.getState()?.player?.runEnergy}, hp ${sdk.getState()?.player?.hp}, hp lost so far ${log.hpLost}`);
    }
    const total = tick(sdk) - t0;
    const xp = (agilityXp(sdk.getState()) - startXp) / XP_RATE;
    log.stop();
    console.log(JSON.stringify({
        course: courseName, agility: +aglArg, laps, totalTicks: total, baseXp: +xp.toFixed(1),
        baseXpPerTick: +(xp / total).toFixed(2),
        lapTicks: summary(lapTicks), lapTicksList: lapTicks,
        stepTicks: Object.fromEntries(Object.entries(stepTicks).map(([k, v]) => [k, summary(v)])),
        attempts, fails, failDamage, hpLostTotal: log.hpLost, labHeals: heals,
    }, null, 1));
}, { timeout: 3_600_000, printState: false });
