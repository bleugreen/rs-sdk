// Iron-rock rotation with the eat starter (docs/speedrun/skills/tick-manipulation.md).
//
//   bun docs/speedrun/scripts/tickmanip-mine.ts <bot> --respawn=13 [--eat=on|off] [--ores=60]
//       [--level=99] --steps 2604,3235>2605,3235 2602,3235>2602,3236 ...
//
// --steps is one period of stand>rock pairs (rs/5's rotation format, mining.md section 4);
// the bot teleports to the first stand. Labels are state.tick: a packet sent while label c
// is current is processed on server tick c+1, and xp from a roll on server tick R is first
// visible at label R+1. At level 63+ every iron roll succeeds, so the schedule is open-loop.
//
// Per transition after a roll on R (the rock is now depleted, the interaction has ended and
// %action_delay == R is left as is, mining.rs2:202-212):
//   eat starter  label R: [eat, drop ore, walk to stand]; click the rock so it lands by R+3.
//                Eating runs %action_delay += 3 (consume.rs2:129-131) -> R+3, so the first
//                swing finds the clock ahead (swing, roll at R+3) or equal (roll at once,
//                mining.rs2:81-85). Works for any move whose first swing comes by R+3: up to
//                4 tiles with run.
//   plain        walk, click; the first swing on an expired clock sets map_clock+2
//                (mining.rs2:76-79), so a move costs a tick: roll at click-landing+2.
// A rock rolled on R accepts clicks landing from R+respawn (mining.md section 4).
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';

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
const EAT = kv('eat', 'on') === 'on';
const ORES = Number(kv('ores', '60'));
const LEVEL = Number(kv('level', '99'));
const key = (p: P) => `${p[0]},${p[1]}`;
const same = (a: P, b: P) => a[0] === b[0] && a[1] === b[1];

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial();
    await sdk.waitForTicks(2);
    for (const item of [...(sdk.getState()?.inventory ?? [])]) await sdk.sendDropItem(item.slot);
    await sdk.sendSay(`::setstat mining ${LEVEL}`);
    await sdk.sendSay('::give rune_pickaxe 1');
    await sdk.sendSay('::give shrimp 20');
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
    const xpOf = (st: BotWorldState) => st.skills.find(k => k.name.toLowerCase() === 'mining')?.experience ?? 0;

    const log: string[] = [];
    const sched = new Map<number, Array<[string, () => Promise<unknown>]>>();
    const add = (label: number, what: string, fn: () => Promise<unknown>) => {
        const at = Math.max(label, s.tick);
        if (!sched.has(at)) sched.set(at, []);
        sched.get(at)!.push([what, fn]);
    };
    const click = (rock: P) => () => sdk.sendInteractLoc(rock[0], rock[1], ids.get(key(rock))!, 1);
    const eat = () => {
        const food = sdk.getState()?.inventory.find(i => /^shrimps$/i.test(i.name));
        return food ? sdk.sendUseItem(food.slot, 1) : Promise.resolve({ success: false, message: 'no food' });
    };
    const dropOre = () => {
        const ore = sdk.getState()?.inventory.find(i => /ore$|^uncut/i.test(i.name));
        return ore ? sdk.sendDropItem(ore.slot) : Promise.resolve();
    };

    const lastRoll = new Map<string, number>();
    const predicted: number[] = [];
    const kinds: Record<string, number> = { stay: 0, eat: 0, plain: 0, waited: 0 };
    let pos: P = STEPS[0]!.stand;
    let k = 0;
    let R = s.tick - 2; // so the bootstrap click goes out now: a stay landing on R+1... see plan()
    let eatsSent = 0;

    const plan = () => {
        const { stand, rock } = STEPS[k % STEPS.length]!;
        k++;
        const move = !same(pos, stand);
        const avail = (lastRoll.get(key(rock)) ?? -1e9) + D;
        const clickLand = Math.max(move ? R + 2 : R + 1, avail);
        let roll: number;
        let kind: string;
        let useEat = false;
        if (k === 1) { roll = s.tick + 3; kind = 'stay'; add(s.tick, `click ${key(rock)}`, click(rock)); }
        else {
            if (!move && clickLand === R + 1) { roll = R + 3; kind = 'stay'; }
            else if (EAT && clickLand <= R + 3) { roll = R + 3; kind = 'eat'; useEat = true; }
            else { roll = clickLand + 2; kind = clickLand > (move ? R + 2 : R + 1) ? 'waited' : 'plain'; }
            if (useEat) {
                add(R, 'eat', eat);
                eatsSent++;
                // Lab stand-in for restocking (a bank trip or a helper's trade): one food per move.
                if ((s.inventory.filter(i => /^shrimps$/i.test(i.name)).length) < 6 && eatsSent % 10 === 0) add(R + 2, 'give food', () => sdk.sendSay('::give shrimp 20'));
            }
            add(R, 'drop ore', dropOre);
            if (move) add(R, `walk ${key(stand)}`, () => sdk.sendWalk(stand[0], stand[1], true));
            add(clickLand - 1, `click ${key(rock)}`, click(rock));
        }
        kinds[kind]!++;
        log.push(`plan #${k} ${kind} ${key(pos)}->${key(stand)} rock ${key(rock)} avail@${avail > 0 ? avail : '-'} roll@${roll}`);
        pos = stand;
        lastRoll.set(key(rock), roll);
        predicted.push(roll);
        R = roll;
    };

    const xpLabels: number[] = [];
    let lastXp = xpOf(s);
    let onTime = 0;
    plan();
    while (xpLabels.length < ORES) {
        // run everything due, then plan the next transition on the roll label itself
        for (const [label, acts] of [...sched].sort((a, b) => a[0] - b[0])) {
            if (label > s.tick) continue;
            sched.delete(label);
            for (const [what, fn] of acts) {
                log.push(`  L${s.tick} send ${what}`);
                fn().catch(() => {});
            }
        }
        if (s.tick >= R) { plan(); continue; }
        const before = s.tick;
        s = await sdk.waitForCondition(st => st.tick > before, 10_000);
        const xp = xpOf(s);
        if (xp > lastXp) {
            xpLabels.push(s.tick);
            if (predicted.includes(s.tick - 1)) onTime++;
            log.push(`  L${s.tick} XP +${xp - lastXp} (roll ${s.tick - 1})`);
            lastXp = xp;
        }
        if (s.dialog.isOpen) sdk.sendClickDialog(0).catch(() => {});
        if (xpLabels.length && s.tick - xpLabels[xpLabels.length - 1]! > 30) throw new Error(`stalled at L${s.tick} pos ${s.player?.worldX},${s.player?.worldZ} anim ${s.player?.animId}; messages: ${s.gameMessages.slice(-4).map(m => m.text).join(' | ')}\n${log.slice(-70).join('\n')}`);
    }

    const steady = xpLabels.slice(5); // skip the first few: they include the bootstrap
    const gaps = steady.slice(1).map((t, i) => t - steady[i]!);
    const hist: Record<number, number> = {};
    for (const g of gaps) hist[g] = (hist[g] ?? 0) + 1;
    const span = steady[steady.length - 1]! - steady[0]!;
    console.log(log.slice(0, Number(kv('loghead', '30'))).join('\n'));
    console.log([
        `rotation of ${new Set(STEPS.map(st => key(st.rock))).size} rocks, respawn ${D}, eat=${EAT ? 'on' : 'off'}, level ${LEVEL}`,
        `transitions ${JSON.stringify(kinds)}, eats sent ${eatsSent}, xp events ${xpLabels.length}, on predicted tick ${onTime}`,
        `steady state (from 6th ore): ${gaps.length} gaps, histogram ${Object.entries(hist).map(([g, c]) => `${g}:${c}`).join(' ')}`,
        `ticks per ore ${(span / gaps.length).toFixed(2)}, base xp per tick ${((35 * gaps.length) / span).toFixed(2)}`
    ].join('\n'));
}, { timeout: 30 * 60_000, printState: false });
