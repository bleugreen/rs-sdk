// The stun pack on the browser client (rs/317): the in-page `pickpocket` program with rs/132's
// `stunActions: ['bury', 'charge', 'arrows']`, at SCORED's post-Monkey Madness stats
// (stun-pack.md section 3), in a browser tab instead of the lite client.
//
//   DECODE_TRACE=<bot> LAB_BLOCK=thieving NODE_TICKRATE=300 bash docs/speedrun/scripts/tickprog-lab.sh <bot> \
//       docs/speedrun/scripts/stun-pack-browser.ts:--until=99
//   bun docs/speedrun/scripts/stun-trace.ts $LAB_LOG/engine.log      # the server's view, per stun
//
// Flags: --level=57 --until=99; --hold=80 --ticks=1000 holds Thieving at 80 (Magic reset to 80 at 99,
// Fletching to 75 at 99) for a fixed-level variant; --bones=off stages no bones, so every window tick
// carries four delay-free actions (a dry stun); --params='{"k":v}' adds pickpocket params (an opt-in
// under test); --hp=97 --magic=80 --fletching=1 --prayer=43 --defence=89 --sharks=2.
//
// Bones and sharks are refilled by ::give (a stand-in for the helper's top-up trades, so no stun is a
// top-up stun here). A cheat is a user event, so the driver sends cheats only on a tick whose state
// shows a success, at most two: that tick's bundle is the click (2 events) and perhaps an eat.

import type { BotWorldState } from '../../../sdk/types';
import { arg, result } from '../../../speedrun/lab/common';
import { cheat, leaveTutorial, tele } from '../../../speedrun/lab/setup';
import { runProgram } from '../../../speedrun/lib/programs';
import { closeSession, openSession } from '../../../speedrun/lib/session';
import { waitTicks, waitUntil } from '../../../speedrun/lib/wait';

const bot = process.argv[2] ?? '';
if (!bot) throw new Error('usage: stun-pack-browser.ts <bot> [--until=99] [--hold=80 --ticks=1000] [--bones=off]');
const LEVEL = Number(arg('level', '57'));
const UNTIL = Number(arg('until', '99'));
const HOLD = Number(arg('hold', '0'));
const TICKS = Number(arg('ticks', '1000'));
const BONES = arg('bones', 'on') !== 'off';
const HP = Number(arg('hp', '97'));
const MAGIC = Number(arg('magic', '80'));
const FLETCHING = Number(arg('fletching', HOLD ? '75' : '1'));
const PRAYER = Number(arg('prayer', '43'));
const DEFENCE = Number(arg('defence', '89'));
const SHARKS = Number(arg('sharks', '2'));
const EXTRA = JSON.parse(arg('params', '{}')) as Record<string, unknown>;
/** The rs/2 knight's tile (stun-pack-thieve.ts TELE 0,41,51,29,37). */
const KNIGHT = { x: 2653, z: 3301 };
/** Arrowheads per tier for Fletching 1-99 (fletching.md; stun-pack-thieve.ts HEAD_LOADS). */
const HEAD_LOADS = [['bronze', 60], ['iron', 90], ['steel', 135], ['mithril', 225], ['adamant', 495], ['rune', 2595]] as const;
const SKILLS = ['thieving', 'prayer', 'magic', 'fletching', 'hitpoints'] as const;

const session = await openSession(bot, { client: 'browser', insecureQueryLogin: true });
const { sdk } = session;
const st = () => sdk.getState()!;
const count = (s: BotWorldState, re: RegExp) => s.inventory.filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
const xp = (s: BotWorldState) => Object.fromEntries(SKILLS.map(n => [n, s.skills.find(k => k.name.toLowerCase() === n)?.experience ?? 0]));
const lvl = (s: BotWorldState, n: string) => s.skills.find(k => k.name.toLowerCase() === n)?.baseLevel ?? 0;
const say = (c: string) => cheat(sdk, c, 1);

// ------------------------------------------------------------------ staging (off the clock)
await leaveTutorial(session);
if (!(await tele(sdk, KNIGHT.x, KNIGHT.z))) throw new Error('tele to the knights failed');
await say('~clearinv inv');
await waitUntil(sdk, s => s.inventory.length === 0, { maxTicks: 5 });
for (const [s, v] of [['hitpoints', HP], ['defence', DEFENCE], ['prayer', PRAYER], ['magic', MAGIC], ['fletching', FLETCHING], ['thieving', HOLD || LEVEL], ['attack', 70], ['strength', 70], ['ranged', 70]] as const) await say(`setstat ${s} ${v}`);
await say('setvar magearena 8');
await say('give staff_of_fire 1');
await waitUntil(sdk, s => s.inventory.some(i => /^staff of fire$/i.test(i.name)), { maxTicks: 5 });
const staff = st().inventory.find(i => /^staff of fire$/i.test(i.name))!;
await sdk.sendUseItem(staff.slot, staff.optionsWithIndex.find(o => /wield/i.test(o.text))?.opIndex ?? 2);
await waitTicks(sdk, 2);
await say(`give bloodrune ${HOLD ? 60000 : 500}`);
await say(`give airrune ${HOLD ? 60000 : 500}`);
await say(`give headless_arrow ${HOLD ? 60000 : 3600}`);
if (HOLD) await say('give rune_arrowheads 60000');
else for (const [n, c] of HEAD_LOADS) await say(`give ${n}_arrowheads ${c}`);
await say(`give shark ${SHARKS}`);
await waitTicks(sdk, 3);
/** Free slots for bones: one stays for coins, one for a new arrow product stack, one margin. */
const boneRoom = (s: BotWorldState) => Math.max(0, 28 - s.inventory.length - (s.inventory.some(i => /^coins$/i.test(i.name)) ? 0 : 1) - 2);
if (BONES) await say(`give dragon_bones ${boneRoom(st())}`);
await waitTicks(sdk, 3);
while (st().dialog?.isOpen) { await sdk.sendClickDialog(0); await waitTicks(sdk, 1); }

// ------------------------------------------------------------------ the run
const s0 = st();
const xp0 = xp(s0);
const rolls: Array<{ t: number; ok: boolean }> = [];
const cheats: Array<{ t: number; c: string }> = [];
const seen = new Set<string>();
let lastTick = -1;
const unsub = sdk.onStateUpdate(s => {
    if (!s?.inGame || s.tick === lastTick) return;
    lastTick = s.tick;
    let success = false;
    for (const m of s.gameMessages ?? []) {
        const key = m.observationId !== undefined ? `o${m.observationId}` : `${m.tick}|${m.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (/^You pick the/i.test(m.text)) { rolls.push({ t: s.tick, ok: true }); success = true; }
        else if (/You fail to pick/i.test(m.text)) rolls.push({ t: s.tick, ok: false });
    }
    if (!success || rolls.length < 2) return;
    const due: string[] = [];
    if (BONES && count(s, /^dragon bones$/i) < 3 && boneRoom(s) > 0) due.push(`give dragon_bones ${boneRoom(s) + count(s, /^dragon bones$/i) > 0 ? boneRoom(s) : 0}`);
    if (count(s, /^shark$/i) < SHARKS) due.push(`give shark ${SHARKS - count(s, /^shark$/i)}`);
    if (HOLD && lvl(s, 'thieving') !== HOLD) due.push(`setstat thieving ${HOLD}`);
    if (HOLD && lvl(s, 'magic') >= 99) due.push(`setstat magic ${MAGIC}`);
    if (HOLD && lvl(s, 'fletching') >= 99) due.push('setstat fletching 75');
    for (const c of due.slice(0, 2)) { cheats.push({ t: s.tick, c }); void sdk.sendSay('::' + c); }
});

const params = {
    ...(HOLD ? { maxTicks: TICKS } : { untilLevel: UNTIL }),
    food: '^shark$',
    heal: 20,
    eatBelow: HP - 20,
    forcedBelow: 6,
    retargetTicks: 12,
    stunActions: ['bury', 'charge', 'arrows'],
    stallTicks: 120,
    ...EXTRA
};
result('start', { bot, tick: s0.tick, hold: HOLD, bones: BONES, at: [s0.player!.worldX, s0.player!.worldZ], inventory: s0.inventory.map(i => `${i.name}x${i.count}`), params });
let status;
try {
    status = await runProgram(sdk, 'pickpocket', params, { staleMs: 30_000 });
} finally {
    unsub();
}
const s1 = st();
const xp1 = xp(s1);
const fails = rolls.filter(r => !r.ok).map(r => r.t);
const failGaps = fails.map(f => { const n = rolls.find(r => r.t > f); return n ? n.t - f : null; }).filter((g): g is number => g !== null);
const hist = (a: number[]) => a.reduce<Record<number, number>>((h, g) => ((h[g] = (h[g] ?? 0) + 1), h), {});
result('end', {
    phase: status.phase, fault: status.fault, programTicks: (status.endedTick ?? s1.tick) - status.startedTick,
    firstToLastRoll: rolls.length > 1 ? rolls[rolls.length - 1]!.t - rolls[0]!.t : 0,
    rolls: rolls.length, successes: rolls.length - fails.length, failures: fails.length,
    failToNext: { mean: failGaps.length ? +(failGaps.reduce((a, g) => a + g, 0) / failGaps.length).toFixed(3) : null, hist: hist(failGaps) },
    xpGained: Object.fromEntries(SKILLS.map(n => [n, xp1[n]! - xp0[n]!])),
    levels: Object.fromEntries(SKILLS.map(n => [n, [lvl(s0, n), lvl(s1, n)]])),
    cheats: cheats.length, packets: status.packets, deferred: status.deferred,
    result: status.result, counters: status.counters
});
await closeSession(session);
process.exit(0);
