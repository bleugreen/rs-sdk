// Dragon bones on the knife iron rotation (docs/speedrun/research/bones-placement.md, section 4).
//
//   bun docs/speedrun/scripts/bones-mine.ts <bot> --rot=demo|stay --bury=none|stay|all [--respawn=13]
//       [--ores=200] [--level=99] [--prayer=43] [--tag=x]
//
// A stripped-down tickmanip-mine.ts (open loop, knife starter, no host gate: the lab answers
// every packet on the next tick). Respawn 13 needs the player count pinned the way
// tick-manipulation.md section 5 does it (player_count.rs2, not committed). Rotations, one
// period of stand>rock steps on the six-rock cluster south of the Ardougne zoo:
//   demo  mining.md section 4, five moves, 15 ticks: no stay, so nowhere a bury is free.
//   stay  five rocks, 15 ticks, two stays: 2605,3234 touches 2605,3235 and 2605,3233, and
//         2602,3235 touches 2602,3234 and 2602,3236 (the cluster allows no third pair, since
//         2605,3235 is in both eastern pairs).
// Transition after a roll on R (labels are state.tick; a packet sent at label c lands on c+1,
// and the roll's xp shows at label R):
//   stay        R: [drop, click]: the first swing on the expired clock arms R+3.
//   stay+bury   R: [knife on logs, button 8889, drop, bury]: the knife writes R+3, the bury
//               (bury_bone.rs2: p_stopaction, p_delay(0)) clears the fletch and rejects R+2;
//               R+2: [click] lands on R+3 and rolls at once (mining.rs2:83-85). The
//               Woodcutting knifebury plan (bones-wc.ts).
//   move        R: [knife, button, drop, walk]; the click goes on the label the run ends (R+1 for
//               up to 2 tiles, R+2 for 3-4) -> roll R+3 either way (tickmanip-mine.ts sends it
//               on R+1, which on a 3-4 tile run re-paths to the nearest tile beside the rock).
//   move+bury   a delayed player's walk is dropped (World.ts: decodeIn, then unsetMapFlag when
//               delayed) and R+2 is rejected, so: R: [drop, bury]; R+2: [knife, button, walk]
//               (the knife writes R+5 on the clock left at R); the click on the label the run
//               ends (R+3 or R+4) -> roll R+5.
// Bones are topped up with ::give (trade cost is measured in bones-wc.ts). A roll whose xp is
// not seen by its label + 1 is a slip: clear the schedule, wait 5 ticks, restart with a plain
// transition.
import { appendFileSync, writeFileSync } from 'fs';
import { hostname, loadavg } from 'os';
import { isTileWalkable } from '../../../sdk/pathfinding';
import type { BotWorldState } from '../../../sdk/types';
import { closeSession, openSession } from '../../../speedrun/lib/session';
import { waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { stepMap } from './mining-lib';

type P = [number, number];
const argv = process.argv.slice(2);
const kv = (k: string, d: string) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const BOT = argv.find(a => !a.startsWith('-'))!;
const ROTS: Record<string, string> = {
    demo: '2604,3235>2605,3235 2602,3235>2602,3236 2603,3234>2602,3234 2603,3233>2602,3233 2605,3234>2605,3233',
    stay: '2605,3234>2605,3235 2605,3234>2605,3233 2603,3233>2602,3233 2602,3235>2602,3234 2602,3235>2602,3236',
    // the same five steps reordered so the east stay follows a 2-tile move, the west one a 3-tile move
    stay2: '2603,3233>2602,3233 2605,3234>2605,3235 2605,3234>2605,3233 2602,3235>2602,3234 2602,3235>2602,3236'
};
const ROT = kv('rot', 'stay');
const BURY = kv('bury', 'stay');
if (!ROTS[ROT] || !['none', 'stay', 'all'].includes(BURY)) { console.error('--rot=demo|stay --bury=none|stay|all'); process.exit(2); }
const STEPS = ROTS[ROT]!.split(' ').map(s => { const [a, b] = s.split('>'); return { stand: a!.split(',').map(Number) as P, rock: b!.split(',').map(Number) as P }; });
const D = Number(kv('respawn', '13'));
const ORES = Number(kv('ores', '200'));
const LEVEL = Number(kv('level', '99'));
const PRAYER = Number(kv('prayer', '43'));
const TAG = `${ROT}-${BURY}-D${D}${kv('tag', '') ? '-' + kv('tag', '') : ''}`;
const LOG = kv('log', `${process.env.LAB_LOG ?? process.env.TMPDIR ?? '/tmp'}/bones-mine-${TAG}.log`);
writeFileSync(LOG, `# bones-mine ${argv.join(' ')} host=${hostname()} load=${loadavg().map(x => x.toFixed(1)).join('/')} tickrate=${process.env.NODE_TICKRATE} at=${new Date().toISOString()}\n`);
const log = (l: string) => appendFileSync(LOG, l + '\n');
const key = (p: P) => `${p[0]},${p[1]}`;
const same = (a: P, b: P) => a[0] === b[0] && a[1] === b[1];
const xpOf = (s: BotWorldState, k: string) => s.skills.find(x => x.name.toLowerCase() === k)?.experience ?? 0;
const items = (s: BotWorldState, re: RegExp) => s.inventory.filter(i => re.test(i.name)).sort((a, b) => a.slot - b.slot);

const sess = await openSession(BOT, { pathfinding: false });
const sdk = sess.sdk;
await sess.bot.skipTutorial?.().catch(() => {});
for (const it of [...(sdk.getState()?.inventory ?? [])]) await sdk.sendDropItem(it.slot);
await waitTicks(sdk, 2);
for (const c of [`::setstat mining ${LEVEL}`, `::setstat prayer ${PRAYER}`, '::give rune_pickaxe 1', '::give knife 1', '::give logs 4', ...(BURY !== 'none' ? ['::give dragon_bones 20'] : [])]) await sdk.sendSay(c);
const [sx, sz] = STEPS[0]!.stand;
for (let i = 0; i < 6 && !(sdk.getState()?.player?.worldX === sx && sdk.getState()?.player?.worldZ === sz); i++) {
    await sdk.sendSay(`::tele 0,${sx >> 6},${sz >> 6},${sx & 63},${sz & 63}`);
    await waitUntil(sdk, s => s.player?.worldX === sx && s.player?.worldZ === sz, { maxTicks: 8 });
}
await waitTicks(sdk, 4);
if (sdk.getState()?.dialog?.isOpen) await sdk.sendClickDialog(0);

const s0 = sdk.getState()!;
const ids = new Map<string, number>();
for (const { rock } of STEPS) {
    const loc = s0.nearbyLocs.find(l => l.x === rock[0] && l.z === rock[1] && l.options.some(o => /^mine$/i.test(o)));
    if (!loc) throw new Error(`no live rock at ${key(rock)}`);
    ids.set(key(rock), loc.id);
}
const rockSet = new Set(STEPS.map(s => key(s.rock)));
// Ticks of running from a to b (2 tiles a tick). The rock click must land after the run ends:
// a click that lands mid-run re-paths to the tile beside the rock nearest the player, which
// rolls on time but leaves the player off the planned stand, so the next stay is not a stay.
const runTicks = (a: P, b: P) => Math.ceil((stepMap(a, rockSet, (x, z) => isTileWalkable(0, x, z), 8).get(key(b)) ?? 8) / 2);
for (let i = 0; i < STEPS.length; i++) {
    const a = STEPS[i]!.stand, b = STEPS[(i + 1) % STEPS.length]!.stand;
    const n = same(a, b) ? 0 : stepMap(a, rockSet, (x, z) => isTileWalkable(0, x, z), 6).get(key(b));
    log(`step ${key(a)} -> ${key(b)}: ${n ?? 'unreachable'} tiles`);
    if (n === undefined || n > 4) throw new Error(`move ${key(a)} -> ${key(b)} is ${n ?? 'unreachable'} tiles; the starter covers 4`);
}

let sent = 0;
const fire = (t: number, what: string, p: Promise<{ success: boolean; message?: string } | void>) => {
    sent++;
    log(`T${t} send ${what}`);
    p.then(r => { if (r && !r.success) log(`T${t} FAIL ${what}: ${r.message}`); }).catch(() => {});
};
type Act = [string, (s: BotWorldState) => void];
const sched = new Map<number, Act[]>();
const add = (label: number, act: Act) => { if (!sched.has(label)) sched.set(label, []); sched.get(label)!.push(act); };
const click = (rock: P): Act => [`click ${key(rock)}`, s => fire(s.tick, `click ${key(rock)}`, sdk.sendInteractLoc(rock[0], rock[1], ids.get(key(rock))!, 1))];
const walk = (to: P): Act => ['walk', s => fire(s.tick, `walk ${key(to)}`, sdk.sendWalk(to[0], to[1], true))];
const drop: Act = ['drop', s => { const o = items(s, /ore$|^uncut/i)[0]; if (o) fire(s.tick, `drop ${o.name}`, sdk.sendDropItem(o.slot)); }];
const knife: Act[] = [
    ['knife', s => { const k = items(s, /^knife$/i)[0], l = items(s, /^logs$/i)[0]; if (k && l) fire(s.tick, 'knife on logs', sdk.sendUseItemOnItem(k.slot, l.slot)); else fire(s.tick, 'give logs (slip)', sdk.sendSay('::give logs 2')); }],
    ['button', s => fire(s.tick, 'button 8889', sdk.sendClickComponent(8889) as Promise<{ success: boolean; message?: string }>)]
];
let buriesSent = 0;
const bury: Act = ['bury', s => { const b = items(s, /^dragon bones$/i)[0]; if (b) { buriesSent++; fire(s.tick, 'bury', sdk.sendUseItem(b.slot, b.optionsWithIndex.find(o => /^bury$/i.test(o.text))?.opIndex ?? 1)); } }];

const lastRoll = new Map<string, number>();
const predicted: number[] = [];
const kinds: Record<string, number> = {};
let pos: P = STEPS[0]!.stand;
let k = 0;
let R = 0;
const plan = (t: number, restart: boolean) => {
    const { stand, rock } = STEPS[k % STEPS.length]!;
    k++;
    const move = !same(pos, stand);
    const avail = (lastRoll.get(key(rock)) ?? -1e9) + D;
    const withBury = BURY === 'all' || (BURY === 'stay' && !move);
    const run = move ? runTicks(pos, stand) : 0;
    let kind: string, roll: number;
    if (restart) {
        kind = 'plain';
        if (move) add(t, walk(stand));
        const land = Math.max(t + 1 + run, avail);
        add(land - 1, click(rock));
        roll = land + 2;
    } else if (!move && !withBury) {
        kind = 'stay';
        add(R, drop);
        const land = Math.max(R + 1, avail);
        add(land - 1, click(rock));
        roll = land + 2;
    } else if (!move) {
        kind = 'stay+bury';
        for (const a of [...knife, drop, bury]) add(R, a);
        const land = Math.max(R + 3, avail);
        add(land - 1, click(rock));
        roll = land === R + 3 ? R + 3 : land + 2;
    } else if (!withBury) {
        kind = 'move';
        for (const a of [...knife, drop, walk(stand)]) add(R, a);
        // walk lands R+1 and ends on R+run; the click lands R+1+run (R+2 or R+3) on the clock
        // the knife set to R+3: a swing then the roll, or the roll at once
        const land = Math.max(R + 1 + run, avail);
        add(land - 1, click(rock));
        roll = land <= R + 3 ? R + 3 : land + 2;
    } else {
        kind = 'move+bury';
        add(R, drop);
        add(R, bury);
        for (const a of [...knife, walk(stand)]) add(R + 2, a);
        const land = Math.max(R + 3 + run, avail);
        add(land - 1, click(rock));
        roll = land <= R + 5 ? R + 5 : land + 2;
    }
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    log(`plan #${k} ${kind} ${key(pos)}->${key(stand)} rock ${key(rock)} roll@${roll}`);
    pos = stand;
    lastRoll.set(key(rock), roll);
    predicted.push(roll);
    R = roll;
};

const xpLabels: number[] = [];
const buries: number[] = [];
let lastM = xpOf(s0, 'mining'), lastP = xpOf(s0, 'prayer');
const m0 = lastM, p0 = lastP;
let slips = 0, onTime = 0, restartAt: number | null = s0.tick, lastSeen = s0.tick;
const xpSeen = new Set<number>();
const checked = new Set<number>();
await new Promise<void>(resolve => {
    let acted = -1;
    const off = sdk.onStateUpdate(s => {
        if (!s?.inGame || s.tick === acted) return;
        acted = s.tick;
        const t = s.tick;
        const m = xpOf(s, 'mining'), pr = xpOf(s, 'prayer');
        if (m > lastM) { xpLabels.push(t); xpSeen.add(t); lastSeen = t; if (predicted.includes(t)) onTime++; log(`T${t} XP +${m - lastM} at ${s.player?.worldX},${s.player?.worldZ}`); lastM = m; }
        if (pr > lastP) { buries.push(t); log(`T${t} PRAYER`); lastP = pr; }
        if (xpLabels.length >= ORES || t - lastSeen > 40) { off(); resolve(); return; }
        if (s.dialog?.isOpen) fire(t, 'dismiss', sdk.sendClickDialog(0));
        if (BURY !== 'none' && items(s, /^dragon bones$/i).length < 4) fire(t, 'give bones (trade stand-in)', sdk.sendSay('::give dragon_bones 12'));
        for (const p of predicted) {
            if (checked.has(p) || t < p + 1 || restartAt !== null) continue;
            checked.add(p);
            if (xpSeen.has(p) || xpSeen.has(p + 1)) continue;
            slips++;
            log(`T${t} SLIP: no xp for roll@${p} at ${s.player?.worldX},${s.player?.worldZ} anim ${s.player?.animId}; messages: ${s.gameMessages.slice(-3).map(g => g.text).join(' | ')}`);
            for (const q of predicted) checked.add(q);
            sched.clear();
            restartAt = t + 5;
        }
        if (restartAt !== null && t >= restartAt) {
            restartAt = null;
            pos = [s.player!.worldX, s.player!.worldZ];
            plan(t, true);
        } else if (restartAt === null && t === R) plan(t, false);
        const acts = sched.get(t);
        if (acts) { sched.delete(t); for (const [, fn] of acts) fn(s); }
    });
});

const steady = xpLabels.slice(5);
const gaps = steady.slice(1).map((t, i) => t - steady[i]!);
const h: Record<number, number> = {};
for (const g of gaps) h[g] = (h[g] ?? 0) + 1;
const span = steady[steady.length - 1]! - steady[0]!;
const bonesIn = buries.filter(b => b >= steady[0]! && b <= steady[steady.length - 1]!).length;
const out = [
    `== bones-mine ${TAG} (NODE_TICKRATE=${process.env.NODE_TICKRATE}, host ${hostname()}, load ${loadavg().map(x => x.toFixed(1)).join('/')}) ==`,
    `ores ${xpLabels.length}, on predicted tick ${onTime}, slips ${slips}; transitions ${JSON.stringify(kinds)}`,
    `steady state (from 6th ore): ${gaps.length} gaps, histogram ${Object.entries(h).map(([g, c]) => `${g}:${c}`).join(' ')}`,
    `ticks per ore ${(span / gaps.length).toFixed(3)}, base mining xp per tick ${((35 * gaps.length) / span).toFixed(3)}`,
    `bones buried ${buries.length} of ${buriesSent} sent; in the steady span ${bonesIn} = ${(bonesIn / span).toFixed(3)} per tick; base prayer ${lastP - p0}; packets ${sent}`,
    `RESULT ${JSON.stringify({ rot: ROT, bury: BURY, D, ores: xpLabels.length, onTime, slips, span, gaps: gaps.length, ticksPerOre: span / gaps.length, xpPerTick: (35 * gaps.length) / span, bones: buries.length, bonesInSpan: bonesIn, bonesPerTick: bonesIn / span, hist: h, base: lastM - m0 })}`
].join('\n');
log(out);
console.log(out);
await closeSession(sess).catch(() => {});
process.exit(0);
