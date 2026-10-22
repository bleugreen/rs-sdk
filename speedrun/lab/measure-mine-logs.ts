// Log loss of the in-page knife-mine starter over a long lap, on the lab (rs/226).
//
//   LAB_BLOCK=17 NODE_TICKRATE=300 bash docs/speedrun/scripts/tickprog-lab.sh <bot> \
//     speedrun/lab/measure-mine-logs.ts:--ores=1050
//
// Needs the bot's page open (tickprog-lab.sh opens it) and respawn 13, which on the lab means
// player_count.rs2 pinned to min(1262, 2000) for the batch (tick-programs.md, not committed).
//
// The knife starter sends knife on logs and the "15 Arrow Shafts" button on the roll label R.
// The button puts the fletch on a weak queue due 2 ticks after it lands (cut_logs.rs2,
// process_fletch_logs). If nothing clears that queue first, the fletch completes: one log
// becomes 15 shafts and Fletching gains 75 xp. This script runs knife-mine on the S09 lap
// (`stay2`, `bury` on, Mining 64, rune pickaxe, dragon bones topped up by ::give) and records
// every Fletching xp change, every change in the log count and every "You carefully cut"
// message on its tick. A positive control follows the lap: a bare knife on logs and button with
// nothing sent after it, which must complete, to show the detector sees a completed fletch.
//
//   [--ores=1050] [--logs=10] [--level=64] [--prayer=43] [--respawn=13] [--no-bury] [--no-control]
import { hostname, loadavg } from 'os';
import { ChatHistory } from '../../sdk/chat-history';
import { runScript } from '../../sdk/runner';
import type { BotWorldState } from '../../sdk/types';
import { awaitProgram, ProgramError, startProgram } from '../lib/programs';
import { arg, result } from './common';

const STAY2 = '2603,3233>2602,3233 2605,3234>2605,3235 2605,3234>2605,3233 2602,3235>2602,3234 2602,3235>2602,3236';
const SHAFTS_BUTTON = 8889;
const bot = process.argv[2]!;
const has = (name: string) => process.argv.includes(`--${name}`);
const ORES = Number(arg('ores', '1050'));
const LOGS = Number(arg('logs', '10'));
const LEVEL = Number(arg('level', '64'));
const BURY = !has('no-bury');
const where = () => `host ${hostname()} load ${loadavg().map(l => l.toFixed(1)).join(' ')} at ${new Date().toISOString()}`;

const count = (s: BotWorldState, re: RegExp) => s.inventory.filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
const logsOf = (s: BotWorldState) => count(s, /^logs$/i);
const shaftsOf = (s: BotWorldState) => count(s, /^arrow shaft$/i);
const fletchXp = (s: BotWorldState) => s.skills.find(k => k.name === 'Fletching')?.experience ?? 0;

interface Watch {
    events: Array<{ tick: number; what: string; detail: string }>;
    stop: () => void;
}

await runScript(async ({ bot: actions, sdk }) => {
    const say = async (cmd: string) => { await sdk.sendSay(cmd); await sdk.waitForTicks(1); };
    const state = () => sdk.getState()!;

    /** Every Fletching xp change, log-count change and cut message, on the tick it shows. */
    const watch = (): Watch => {
        const events: Watch['events'] = [];
        const s0 = state();
        let xp = fletchXp(s0), logs = logsOf(s0), shafts = shaftsOf(s0), lastTick = s0.tick;
        const chat = new ChatHistory();
        chat.record(s0.gameMessages ?? []);
        const off = sdk.onStateUpdate(s => {
            if (!s?.inGame || s.tick === lastTick) return;
            lastTick = s.tick;
            const x = fletchXp(s), l = logsOf(s), sh = shaftsOf(s);
            if (x !== xp) events.push({ tick: s.tick, what: 'fletching-xp', detail: `${xp} -> ${x}` });
            if (l !== logs) events.push({ tick: s.tick, what: 'logs', detail: `${logs} -> ${l}` });
            if (sh !== shafts) events.push({ tick: s.tick, what: 'shafts', detail: `${shafts} -> ${sh}` });
            xp = x; logs = l; shafts = sh;
            for (const m of chat.record(s.gameMessages ?? [])) {
                if (/carefully cut|run out of/i.test(m.text)) events.push({ tick: s.tick, what: 'message', detail: m.text });
            }
        });
        return { events, stop: off };
    };

    // Lab setup by staff cheats, as tickprog-measure.ts's mine mode does it.
    await actions.skipTutorial().catch(() => {});
    await sdk.waitForTicks(2);
    while (state().dialog.isOpen) { await sdk.sendClickDialog(0); await sdk.waitForTicks(1); }
    for (const item of [...state().inventory]) await sdk.sendDropItem(item.slot);
    await sdk.waitForTicks(2);
    await say(`::setstat mining ${LEVEL}`);
    if (BURY) await say(`::setstat prayer ${arg('prayer', '43')}`);
    await say('::give rune_pickaxe 1');
    await say('::give knife 1');
    for (let i = 0; i < LOGS; i++) await say('::give logs 1');
    if (BURY) await say('::give dragon_bones 12');
    const [sx, sz] = STAY2.split(' ')[0]!.split('>')[0]!.split(',').map(Number) as [number, number];
    for (let i = 0; i < 5; i++) {
        await sdk.sendSay(`::tele 0,${sx >> 6},${sz >> 6},${sx & 63},${sz & 63}`);
        await sdk.waitForTicks(6);
        const p = state().player;
        if (p?.worldX === sx && p.worldZ === sz) break;
    }
    await sdk.waitForTicks(14); // every rock respawned
    while (state().dialog.isOpen) { await sdk.sendClickDialog(0); await sdk.waitForTicks(1); }

    // Bones top-up stand-in for the run's helper trade: a ::give at 3 left.
    let giving = false;
    const unTopUp = BURY
        ? sdk.onStateUpdate(s => {
            if (giving) return;
            const bones = s.inventory.filter(i => /^dragon bones$/i.test(i.name)).length;
            const free = 28 - s.inventory.length;
            if (bones > 3 || free < 6) return;
            giving = true;
            void sdk.sendSay(`::give dragon_bones ${free - 2}`).finally(() => sdk.waitForTicks(3).then(() => { giving = false; }));
        })
        : () => {};

    const s0 = state();
    const start = { tick: s0.tick, logs: logsOf(s0), shafts: shaftsOf(s0), fletchingXp: fletchXp(s0), mining: s0.skills.find(k => k.name === 'Mining')?.baseLevel };
    console.log(`start: ${JSON.stringify(start)} ${where()}`);
    const lap = watch();
    const params: Record<string, unknown> = { steps: STAY2, respawn: Number(arg('respawn', '13')), starter: 'knife', ores: ORES };
    if (BURY) params.bury = '^dragon bones$';
    let programResult: Record<string, unknown> = {};
    try {
        const started = await startProgram(sdk, 'knife-mine', params);
        const end = await awaitProgram(sdk, started.runId, {
            onProgress: s => { if (s.tick % 300 === 0) console.log(`  T${s.tick} ${JSON.stringify(s.counters)} logs ${logsOf(state())}`); }
        });
        programResult = (end.result ?? {}) as Record<string, unknown>;
        console.log(`knife-mine stay2${BURY ? ' bury' : ''} L${LEVEL}: ${where()}`);
        console.log(JSON.stringify({ result: end.result, counters: end.counters, packets: end.packets, deferred: end.deferred, skippedTicks: end.skippedTicks }, null, 1));
    } catch (e) {
        if (e instanceof ProgramError) console.log(`program error: ${e.message}\n${JSON.stringify(e.status, null, 1)}`);
        throw e;
    } finally {
        unTopUp();
    }
    await sdk.waitForTicks(4); // a fletch queued on the last label would complete within 3
    lap.stop();
    const s1 = state();
    const endRow = { tick: s1.tick, logs: logsOf(s1), shafts: shaftsOf(s1), fletchingXp: fletchXp(s1) };
    const knifeTicks = Number(programResult.ticks ?? s1.tick - start.tick);
    const fletches = lap.events.filter(e => e.what === 'fletching-xp');
    const logsUsed = start.logs - endRow.logs;
    // With no loss seen, the one-sided 95% upper bound on a Poisson rate is 3.0 events over the exposure.
    const per1000 = (n: number) => +((1000 * n) / knifeTicks).toFixed(3);
    result('lap', {
        start, end: endRow, logsUsed, knifeTicks,
        ores: programResult.ores, ticksPerOre: programResult.ticksPerOre, histogram: programResult.histogram,
        transitions: programResult.transitions, starters: programResult.starters, slips: programResult.slips,
        buried: programResult.buried, bonesPerTick: programResult.bonesPerTick,
        fletchTicks: fletches.map(e => e.tick - start.tick),
        logsPer1000KnifeTicks: per1000(logsUsed),
        ...(logsUsed === 0 ? { upper95Per1000KnifeTicks: per1000(3) } : {}),
        events: lap.events.map(e => ({ ...e, at: e.tick - start.tick }))
    });

    if (has('no-control')) return;
    // Positive control: knife on logs and the button, then nothing for 6 ticks. The fletch must
    // complete, and the watcher must see it.
    while (state().dialog.isOpen) { await sdk.sendClickDialog(0); await sdk.waitForTicks(1); }
    await sdk.waitForTicks(6);
    const control = watch();
    const c0 = state();
    const knife = c0.inventory.find(i => /^knife$/i.test(i.name));
    const log = c0.inventory.find(i => /^logs$/i.test(i.name));
    if (!knife || !log) { result('control', { skipped: 'no knife or logs left' }); control.stop(); return; }
    void sdk.sendUseItemOnItem(knife.slot, log.slot);
    void sdk.sendClickComponent(SHAFTS_BUTTON);
    await sdk.waitForTicks(6);
    control.stop();
    const c1 = state();
    result('control', {
        sentAt: c0.tick, logs: `${logsOf(c0)} -> ${logsOf(c1)}`, fletchingXp: `${fletchXp(c0)} -> ${fletchXp(c1)}`,
        detected: control.events.some(e => e.what === 'fletching-xp'), events: control.events.map(e => ({ ...e, at: e.tick - c0.tick }))
    });
}, { timeout: 2 * 60 * 60_000, printState: false });
process.exit(0);
