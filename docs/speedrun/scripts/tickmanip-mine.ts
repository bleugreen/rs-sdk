// Iron-rock rotation with the eat or knife starter (docs/speedrun/skills/tick-manipulation.md).
//
//   bun docs/speedrun/scripts/tickmanip-mine.ts <bot> --respawn=13 [--starter=eat|knife|none] [--ores=60]
//       [--level=99] [--xplag=0] [--gate=on|off] [--plain-cycle=3.61] [--lead=auto|N]
//       --steps 2604,3235>2605,3235 ...
//
// --steps is one period of stand>rock pairs (rs/5's rotation format, mining.md section 4);
// the bot teleports to the first stand. Labels are state.tick: a packet sent while label c
// is current is processed on server tick c+1, and xp from a roll on server tick R is first
// visible at label R + xplag. The lite client publishes a tick only after decoding all of
// it (#20), so stats from tick R are in the state labelled R: xplag 0. Clients older than
// #20 published at PLAYER_INFO, before that tick's stats: pass --xplag=1 for those.
// At level 63+ every iron roll succeeds, so the schedule is open-loop.
//
// Per transition after a roll on R (the rock is now depleted, the interaction has ended and
// %action_delay == R is left as is, mining.rs2:202-212):
//   eat starter  label R: [eat, drop ore, walk to stand]; click the rock so it lands by R+3.
//                Eating runs %action_delay += 3 (consume.rs2:129-131) -> R+3, so the first
//                swing finds the clock ahead (swing, roll at R+3) or equal (roll at once,
//                mining.rs2:81-85). Works for any move whose first swing comes by R+3: up to
//                4 tiles with run.
//   knife        the same with [knife on logs, button 8889] in place of the eat: the fletching
//                writer sets map_clock+2 = R+3 when the clock has expired (cut_logs.rs2:83-85);
//                the walk's clearPendingAction closes the menu and clears the queued fletch.
//   trick        rs/5's adjacent-rock starter (mining-rotation.ts): click a live rotation rock
//                beside us so it lands on u = max(R+1, its respawn); its first swing on the
//                expired clock sets map_clock+2 = u+2 without rolling (mining.rs2:76-79). Walk
//                to the stand (at most 2 tiles, one run tick) on u+1 and click the rock on u+2:
//                the first swing finds the clock equal and rolls at once. Used only while the
//                host gate is off.
//   plain        walk, click; the first swing on an expired clock sets map_clock+2
//                (mining.rs2:76-79), so a move costs a tick: roll at click-landing+2.
// A rock rolled on R accepts clicks landing from R+respawn (mining.md section 4).
//
// Host gate (tick-manipulation.md, "Run-time host gate"; speedrun/lib/hostgate.ts), on by
// default with a starter: probe packet latency before the first ore and after every slip,
// and every 500 ticks while off. While it is off the rotation runs closed-loop with the trick
// and plain transitions: each transition is planned on the label that shows its roll's xp,
// so a late packet costs the ticks it was late instead of the schedule. --gate=off always
// uses the starter (the rows measured before the gate). The gate's cost model takes
// --plain-cycle (the fallback rotation's ticks per ore; rs/5's adjacent-rock rotation
// measured 3.61 at respawn 13 and 3.84 at 19) and a miss cost of 9 ticks (the 5-tick wait
// after a slip plus a plain transition), and the measured rate overrides it.
//
// Lead. The schedule is anchored on its own bootstrap click, so a constant latency L shifts
// every roll by L-1 without breaking the lock; only the predicted labels move. --lead=N
// (auto: the gate's last probe, dominant latency - 1) sends everything N labels before the
// roll label it serves and puts the predicted rolls N labels later, so the slip check expects
// the xp where it will show.
import { runScript } from '../../../sdk/runner';
import { isTileWalkable } from '../../../sdk/pathfinding';
import type { BotWorldState } from '../../../sdk/types';
import { HostGate } from '../../../speedrun/lib/hostgate';
import { stepMap } from './mining-lib';

type P = [number, number];
const argv = process.argv.slice(2);
const kv = (name: string, def: string) => argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? def;
const si = argv.indexOf('--steps');
const STEPS: { stand: P; rock: P }[] = [];
for (let i = si + 1; si >= 0 && i < argv.length && !argv[i]!.startsWith('--'); i++) {
    const [a, b] = argv[i]!.split('>');
    STEPS.push({ stand: a!.split(',').map(Number) as P, rock: b!.split(',').map(Number) as P });
}
if (!STEPS.length) throw new Error('--steps stand>rock ... required');
const D = Number(kv('respawn', '19'));
const STARTER = kv('starter', 'eat');
if (!['eat', 'knife', 'none'].includes(STARTER)) throw new Error('--starter=eat|knife|none');
const EAT = STARTER !== 'none';
const ORES = Number(kv('ores', '60'));
const LEVEL = Number(kv('level', '99'));
const XP_LAG = Number(kv('xplag', '0'));
const GATE = EAT && kv('gate', 'on') !== 'off';
const PLAIN_CYCLE = Number(kv('plain-cycle', '3.61'));
// A late starter in the closed loop costs the tick it was late (inferred; --inject-late
// measures it). The open loop (a lead) slips and restarts instead: about 9 ticks.
const MISS_COST = Number(kv('miss-cost', '1'));
const LEAD_ARG = kv('lead', 'auto');
// --inject-late=F sends a random fraction F of starter ticks one label late (lab stand-in for
// a host where that share of packets is late).
const INJECT_LATE = Number(kv('inject-late', '0'));
const key = (p: P) => `${p[0]},${p[1]}`;
const same = (a: P, b: P) => a[0] === b[0] && a[1] === b[1];
const beside = (a: P, b: P) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial();
    await sdk.waitForTicks(2);
    for (const item of [...(sdk.getState()?.inventory ?? [])]) await sdk.sendDropItem(item.slot);
    await sdk.sendSay(`::setstat mining ${LEVEL}`);
    await sdk.sendSay('::give rune_pickaxe 1');
    if (STARTER === 'eat') await sdk.sendSay('::give shrimp 20');
    if (STARTER === 'knife') { await sdk.sendSay('::give knife 1'); for (let i = 0; i < 10; i++) await sdk.sendSay('::give logs 1'); }
    const [sx, sz] = STEPS[0]!.stand;
    for (let attempt = 0; attempt < 5; attempt++) {
        await sdk.sendSay(`::tele 0,${sx >> 6},${sz >> 6},${sx & 63},${sz & 63}`);
        await sdk.waitForTicks(6);
        const p = sdk.getState()?.player;
        if (p && p.worldX === sx && p.worldZ === sz) break;
    }
    let s = sdk.getState()!;
    const ids = new Map<string, number>();
    for (const { rock } of STEPS) {
        const loc = s.nearbyLocs.find(l => l.x === rock[0] && l.z === rock[1] && l.options.some(o => /^mine$/i.test(o)));
        if (!loc) throw new Error(`no live rock at ${key(rock)}; locs there: ${s.nearbyLocs.filter(l => Math.abs(l.x - rock[0]) + Math.abs(l.z - rock[1]) <= 1).map(l => `${l.name}#${l.id}@${l.x},${l.z}`).join(' ')}`);
        ids.set(key(rock), loc.id);
    }
    const rocks = [...new Map(STEPS.map(st => [key(st.rock), st.rock])).values()];
    const rockSet = new Set(rocks.map(key));
    const walkable = (x: number, z: number) => !rockSet.has(`${x},${z}`) && isTileWalkable(0, x, z);
    const tilesTo = (a: P, b: P) => (same(a, b) ? 0 : stepMap(a, rockSet, (x, z) => isTileWalkable(0, x, z), 4).get(key(b)) ?? Infinity);
    const xpOf = (st: BotWorldState) => st.skills.find(k => k.name.toLowerCase() === 'mining')?.experience ?? 0;

    const log: string[] = [];
    const gate = GATE
        ? new HostGate(sdk, { model: { plainCycle: PLAIN_CYCLE, missCost: MISS_COST }, probe: { walkable }, log: line => { log.push(line); console.log(line); } })
        : null;
    const manip = () => (gate ? gate.on : EAT);
    let LEAD = 0; // fixed per schedule: set at each (re)start
    const leadNow = () => (LEAD_ARG === 'auto' ? (gate?.lead ?? 0) : Number(LEAD_ARG));
    const sched = new Map<number, Array<[string, () => Promise<unknown>]>>();
    // `label` is the label the send would go out on at latency 1; it goes LEAD labels earlier.
    const add = (label: number, what: string, fn: () => Promise<unknown>) => {
        const at = Math.max(label - LEAD, s.tick);
        if (!sched.has(at)) sched.set(at, []);
        sched.get(at)!.push([what, fn]);
    };
    const click = (rock: P) => () => sdk.sendInteractLoc(rock[0], rock[1], ids.get(key(rock))!, 1);
    const eat = () => {
        const food = sdk.getState()?.inventory.find(i => /^shrimps$/i.test(i.name));
        return food ? sdk.sendUseItem(food.slot, 1) : Promise.resolve({ success: false, message: 'no food' });
    };
    const knifeOnLogs = () => {
        const inv = sdk.getState()?.inventory ?? [];
        const knife = inv.find(i => /^knife$/i.test(i.name));
        const logs = inv.find(i => /^logs$/i.test(i.name));
        return knife && logs ? sdk.sendUseItemOnItem(knife.slot, logs.slot) : Promise.resolve({ success: false, message: 'no knife/logs' });
    };
    const dropOre = () => {
        const ore = sdk.getState()?.inventory.find(i => /ore$|^uncut/i.test(i.name));
        return ore ? sdk.sendDropItem(ore.slot) : Promise.resolve();
    };

    const lastRoll = new Map<string, number>();
    const predicted: number[] = [];
    const kinds: Record<string, number> = { stay: 0, starter: 0, trick: 0, plain: 0, waited: 0 };
    let pos: P = STEPS[0]!.stand;
    let k = 0;
    let R = s.tick - 2;
    let eatsSent = 0;
    let pendingRock: P | null = null; // rock of the transition whose roll we are waiting for
    let injected = 0;
    // Closed loop: plan each transition on the label that shows the previous roll's xp. With
    // no lead that is the same label the predicted loop uses on a punctual host, and a late
    // roll then costs only its late ticks: the predicted loop would send the next walk onto the
    // late roll's own tick, cancel it, and slip. A lead needs the open loop (it sends before
    // the roll is visible).
    const closedLoop = () => !manip() || LEAD === 0;

    const plan = () => {
        const { stand, rock } = STEPS[k % STEPS.length]!;
        k++;
        const move = !same(pos, stand);
        const avail = (lastRoll.get(key(rock)) ?? -1e9) + D;
        const clickLand = Math.max(move ? R + 2 : R + 1, avail);
        const m = manip();
        let roll: number;
        let kind: string;
        if (k === 1) { roll = s.tick + 3 + LEAD; kind = 'stay'; add(s.tick + LEAD, `click ${key(rock)}`, click(rock)); }
        else {
            let trick: { st: P; u: number } | null = null;
            if (!move && clickLand === R + 1) { roll = R + 3; kind = 'stay'; }
            else if (m && clickLand <= R + 3) { roll = R + 3; kind = 'starter'; }
            else {
                const plainRoll = clickLand + 2;
                if (!m && move && tilesTo(pos, stand) <= 2) {
                    for (const st of rocks) {
                        if (same(st, rock) || !beside(pos, st)) continue;
                        const u = Math.max(R + 1, (lastRoll.get(key(st)) ?? -1e9) + D);
                        if (avail <= u + 2 && u + 2 < plainRoll && (!trick || u < trick.u)) trick = { st, u };
                    }
                }
                if (trick) { roll = trick.u + 2; kind = 'trick'; }
                else { roll = plainRoll; kind = clickLand > (move ? R + 2 : R + 1) ? 'waited' : 'plain'; }
            }
            // --inject-late: this transition's starter tick goes out one label late
            const late = kind === 'starter' && INJECT_LATE > 0 && Math.random() < INJECT_LATE ? 1 : 0;
            if (late) { injected++; log.push(`  inject: starter for roll@${roll} held one label`); }
            if (kind === 'starter' && STARTER === 'knife') {
                add(R + late, 'knife on logs', knifeOnLogs);
                add(R + late, 'button 8889', () => sdk.sendClickComponent(8889));
                eatsSent++;
            } else if (kind === 'starter') {
                add(R + late, 'eat', eat);
                eatsSent++;
                // Lab stand-in for restocking (a bank trip or a helper's trade): one food per move.
                if ((s.inventory.filter(i => /^shrimps$/i.test(i.name)).length) < 6 && eatsSent % 10 === 0) add(R + 2, 'give food', () => sdk.sendSay('::give shrimp 20'));
            }
            if (trick) {
                const { st, u } = trick;
                add(u - 1, `starter click ${key(st)}`, click(st));
                add(u, 'drop ore', dropOre);
                add(u, `walk ${key(stand)}`, () => sdk.sendWalk(stand[0], stand[1], true));
                add(u + 1, `click ${key(rock)}`, click(rock));
            } else {
                add(R + late, 'drop ore', dropOre);
                if (move) add(R + late, `walk ${key(stand)}`, () => sdk.sendWalk(stand[0], stand[1], true));
                add(Math.max(clickLand - 1, R + late), `click ${key(rock)}`, click(rock));
            }
        }
        kinds[kind]!++;
        log.push(`plan #${k} ${kind} ${key(pos)}->${key(stand)} rock ${key(rock)} avail@${avail > 0 ? avail : '-'} roll@${roll}`);
        pos = stand;
        lastRoll.set(key(rock), roll);
        predicted.push(roll);
        pendingRock = rock;
        R = roll;
    };

    // Slip recovery. A packet that lands a tick late misses its roll, and the next eat then
    // adds 3 to a clock that was never consumed: from there every first swing finds the clock
    // ahead and nothing rolls. Every roll at 63+ succeeds, so no xp by label P+xplag+1 for a
    // roll predicted on P means a slip (one label of slack): drop the schedule, let the clock
    // expire, and restart with one plain transition from where the bot actually stands. While
    // the gate is off the loop waits for each roll's xp anyway, so only a roll whose xp is 6
    // labels overdue (a click that went nowhere) restarts it.
    let slips = 0;
    let restartAt: number | null = null;
    let rolled: number | null = null; // roll label of the xp seen since the last plan
    const xpSeen = new Set<number>();
    const checked = new Set<number>();
    const checkSlip = () => {
        const slack = closedLoop() ? 6 : 1;
        for (const p of predicted) {
            if (checked.has(p) || s.tick < p + 2 + slack) continue;
            checked.add(p);
            let seen = false;
            for (let x = p + XP_LAG; x <= p + XP_LAG + slack; x++) seen ||= xpSeen.has(x);
            if (seen) continue;
            slips++;
            log.push(`  L${s.tick} SLIP: no xp for roll@${p}; restarting`);
            for (const q of predicted) checked.add(q); // the rest of the schedule is void
            sched.clear();
            restartAt = s.tick + 5;
            R = Number.POSITIVE_INFINITY;
            rolled = null;
            gate?.slip();
            return;
        }
    };
    const restart = () => {
        restartAt = null;
        rolled = null;
        LEAD = manip() ? leadNow() : 0;
        pos = [s.player!.worldX, s.player!.worldZ];
        const { stand, rock } = STEPS[k % STEPS.length]!;
        k++;
        const avail = (lastRoll.get(key(rock)) ?? -1e9) + D;
        const clickLand = Math.max(s.tick + 3 + LEAD, avail); // up to 4 tiles of running before the click lands
        add(s.tick + LEAD, `walk ${key(stand)}`, () => sdk.sendWalk(stand[0], stand[1], true));
        add(clickLand - 1, `click ${key(rock)}`, click(rock));
        const roll = clickLand + 2;
        log.push(`restart #${k} ${key(pos)}->${key(stand)} rock ${key(rock)} roll@${roll}`);
        kinds.plain!++;
        pos = stand;
        lastRoll.set(key(rock), roll);
        predicted.push(roll);
        pendingRock = rock;
        R = roll;
    };

    const xpLabels: number[] = [];
    let lastXp = xpOf(s);
    let onTime = 0;
    let probeEnd = -1;
    // The probe walks a tile and back from where the bot stands and clears the interaction;
    // the schedule restarts from the next step afterwards.
    const probeHost = async (why: string) => {
        sched.clear();
        await gate!.probe(why);
        s = sdk.getState()!;
        probeEnd = s.tick;
        lastXp = xpOf(s);
        rolled = null;
    };
    if (gate) await probeHost('start');
    LEAD = manip() ? leadNow() : 0;
    plan();
    while (xpLabels.length < ORES) {
        if (restartAt !== null && s.tick >= restartAt) {
            if (gate?.due(s.tick)) await probeHost('slip');
            restart();
        }
        // run everything due, then plan the next transition: on the predicted roll label while
        // manipulating, on the label that shows the roll's xp while the gate is off
        for (const [label, acts] of [...sched].sort((a, b) => a[0] - b[0])) {
            if (label > s.tick) continue;
            sched.delete(label);
            for (const [what, fn] of acts) {
                log.push(`  L${s.tick} send ${what}`);
                fn().catch(() => {});
            }
        }
        if (restartAt === null && (closedLoop() ? rolled !== null : s.tick >= R - LEAD)) {
            if (closedLoop()) {
                R = rolled!;
                if (pendingRock) lastRoll.set(key(pendingRock), R);
            }
            rolled = null;
            if (gate?.due(s.tick)) {
                await probeHost('periodic');
                restart();
            } else plan();
            continue;
        }
        const before = s.tick;
        s = await sdk.waitForCondition(st => st.tick > before, 10_000);
        const xp = xpOf(s);
        if (xp > lastXp) {
            xpLabels.push(s.tick);
            xpSeen.add(s.tick);
            rolled = s.tick - XP_LAG;
            if (predicted.includes(s.tick - XP_LAG)) onTime++;
            log.push(`  L${s.tick} XP +${xp - lastXp} (roll ${s.tick - XP_LAG})`);
            lastXp = xp;
            if (gate?.drop(s.tick)) {
                // measured switch-off: drop the schedule and restart plain from here
                sched.clear();
                for (const q of predicted) checked.add(q);
                restartAt = s.tick;
                R = Number.POSITIVE_INFINITY;
            }
        }
        if (s.dialog.isOpen) sdk.sendClickDialog(0).catch(() => {});
        if (restartAt === null) checkSlip();
        const quietSince = Math.max(xpLabels[xpLabels.length - 1] ?? -1, probeEnd);
        if (quietSince >= 0 && s.tick - quietSince > 30) throw new Error(`stalled at L${s.tick} pos ${s.player?.worldX},${s.player?.worldZ} anim ${s.player?.animId}; messages: ${s.gameMessages.slice(-4).map(m => m.text).join(' | ')}\n${log.slice(-70).join('\n')}`);
    }

    const steady = xpLabels.slice(5); // skip the first few: they include the bootstrap
    const gaps = steady.slice(1).map((t, i) => t - steady[i]!);
    const hist: Record<number, number> = {};
    for (const g of gaps) hist[g] = (hist[g] ?? 0) + 1;
    const span = steady[steady.length - 1]! - steady[0]!;
    console.log(log.slice(0, Number(kv('loghead', '30'))).join('\n'));
    console.log([
        `rotation of ${rocks.length} rocks, respawn ${D}, starter=${STARTER}, level ${LEVEL}`,
        `end inventory: logs ${(sdk.getState()?.inventory ?? []).filter(i => /^logs$/i.test(i.name)).length}, arrow shafts ${(sdk.getState()?.inventory ?? []).filter(i => /^arrow shaft/i.test(i.name)).reduce((n, i) => n + i.count, 0)}`,
        `transitions ${JSON.stringify(kinds)}, starters sent ${eatsSent} (held a label: ${injected}), xp events ${xpLabels.length}, on predicted tick ${onTime}, slips ${slips}`,
        gate
            ? `gate: ${gate.history.length} events (${gate.summary()}), switches ${gate.switches() || 'none'}, ${gate.plainTicks(s.tick)} ticks plain, ends ${gate.on ? 'manipulating' : 'plain'}, lead ${LEAD}`
            : 'gate: off',
        `steady state (from 6th ore): ${gaps.length} gaps, histogram ${Object.entries(hist).map(([g, c]) => `${g}:${c}`).join(' ')}`,
        `ticks per ore ${(span / gaps.length).toFixed(2)}, base xp per tick ${((35 * gaps.length) / span).toFixed(2)}`
    ].join('\n'));
}, { timeout: 30 * 60_000, printState: false });
