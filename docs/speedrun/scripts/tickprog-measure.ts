// Measure an in-page tick program in the bot's browser tab (docs/speedrun/tick-programs.md).
//
//   bun docs/speedrun/scripts/tickprog-measure.ts <bot> <mode> [--key=value ...]
//
// modes (lab setup by staff cheats; --demo uses none and expects the kit in place):
//   probe        in-page latency probe            --trials=60 [--no-tele]
//   mine         knife iron rotation at respawn 13 (player_count pinned locally)
//                                                --ores=200 [--starter=knife|none] [--steps=d13|stay2|<pairs>]
//                [--level=99 [--hold]] holds Mining at the level (::setstat on each level-up)
//                [--pickaxes=rune|kit|bronze] kit: bronze, steel, mithril, adamant and rune
//                [--success] knife-mine's failed-roll handling (`success: 'iron'`), with `rate`
//                [--rotation=five|six] (mining.ts's laps; overrides --steps) [--respawn=13]
//                [--gated [--hold-starters=0.15]] [--bury [--prayer=43]]
//                --bury buries dragon bones on the lap's short-entry stay (knife-mine `bury`;
//                bones-placement.md section 4, the stay2 lap); topped up as in oak
//   mineband     speedrun/skills/mining.ts's iron bands from --level to --until, as the run
//                chains them (--respawn=13 --technique=auto|knife|plain --pickaxes=kit)
//   fly          knife fly fishing, Lumbridge     --level=20 --until=99 | --successes=N [--technique=plain]
//   willow       knife willows, Draynor           --successes=150
//   oak          knife oaks, Taverley (2914,3494) --successes=200 [--level=60] [--bury [--prayer=43]] [--technique=plain]
//   tav-willow   the same at the Taverley willow tile (2920,3406), --level=88
//                --bury buries dragon bones every cycle (knife: inside the 3-tick cycle; plain:
//                plain + bury); a ::give tops them up at 3 left (off the scored clock; the run's
//                trades cost rs/105's 5 ticks per load on top). Reports logs per tick, p(L) and
//                Σ1/p over the logs (ticks per expected roll), and bones per tick.
//   tree         knife normal trees, Lumbridge    --successes=150 [--level=1]  (the demo loop)
//                (knife modes: --successes counts xp drops, one log or fish each; the result's
//                ticksPerExpectedRoll is the figure to set against the cadence; on the trees it
//                needs an axe worn or carried, and the result names the one it used)
//                fly, willow and tree take --gated: run through speedrun/lib/gated-program.ts
//                (--technique=auto by default, --trials=20 for the gate's in-page probe,
//                --hold=0.15 holds that share of starters one tick, --plain-per-roll=N)
//   pickpocket   Ardougne knight, eat in windows  --level=55 --rolls=300 [--hold=1]
//                [--pack=bury,charge[,arrows]] runs rs/106's stun pack (stunActions) with a
//                ::give kit: dragon bones, blood and air runes, staff of fire, Magic 80 held
//                (Mage Arena set), and for arrows rune arrowheads at Fletching 75 held. Bones
//                and sharks are topped up by ::give (off the scored clock, like oak --bury)
//                [--helper=<bot>] tops bones up by trade instead (HELPER=<bot> in tickprog-lab.sh):
//                the program requests at stun +2..+4 when under 3 bones and idles while the
//                trade is open; the helper (a lite client teleported beside the account)
//                offers --load=9 bones with one press; this script accepts for the account
//   agility      Wilderness course                --laps=10 [--course=gnome] [--level --hp --cakes --until --eat-below [--eat-gap --eat-at=any|land] --run]
//   eat-probe    an eat against the walk to the Wilderness log balance  --trials=3 [--eat-delay=3]
//   agility-steps  speedrun/skills/agility.ts      [--level --hp --at=x,z --knife --cakes --to --only=steps --opt=k=v]
//   rc           rc-cycle at an altar with lite givers (GIVERS=a,b in tickprog-lab.sh)
//                --givers=a,b --crafts=30 --schedule=robust|tuned [--altar=body]
//                (this script plays run.ts: it hands the program's turns and beacons to the
//                givers in memory instead of cue.json, and feeds restocked givers back in)
//
// The page reacts on its own decoded tick; this script only sets up, starts the program
// through speedrun/lib/programs.ts, prints progress, and reports the program's result with
// the host, its load and the time. The tab must already be open (tickprog-tab.ts).
import { hostname, loadavg } from 'os';
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';
import { catchChance, CYCLE_METHODS } from '../../../server/webclient/src/bot/programs/knife-cycle';
import { FreshMessages, statRandom, XP_RATE } from '../../../server/webclient/src/bot/programs/util';
import { FAIL_RE as AGILITY_FAIL_RE } from '../../../server/webclient/src/bot/programs/agility';
import { AGILITY_COURSES, stepFromPosition } from '../../../server/webclient/src/bot/programs/agility-courses';
import { type GatedTechnique, inPageGate, runGatedProgram } from '../../../speedrun/lib/gated-program';
import { latencyHistogram } from '../../../speedrun/lib/hostgate';
import { awaitProgram, probeInPage, ProgramError, programStatus, runProgram, startProgram } from '../../../speedrun/lib/programs';
import { runGivers } from './tickprog-rc-givers';
import { openSession, closeSession, type Session } from '../../../speedrun/lib/session';
import { TickLog } from '../../../speedrun/lib/ticks';
import { decideGiver, decideReceiver, newGiverCtx, newReceiverCtx, planOffers, sameName, tradeOf, type GiverCtx, type OfferEntry, type ReceiverCtx } from '../../../speedrun/lib/trade';
import * as mining from '../../../speedrun/skills/mining';

const bot = process.argv[2];
const mode = process.argv[3];
const flag = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const has = (name: string) => process.argv.includes(`--${name}`);
const DEMO = has('demo');
const num = (name: string, def: number) => Number(flag(name, String(def)));
/** ::tele's level,mx,mz,lx,lz form of a ground tile. */
const teleSpec = (x: number, z: number) => `0,${x >> 6},${z >> 6},${x & 63},${z & 63}`;
const where = () => `host ${hostname()} load ${loadavg().map(l => l.toFixed(1)).join(' ')} at ${new Date().toISOString()}`;

// rs/5's zoo-cluster rotation at respawn 13 (tickmanip-mine-run.sh, mining.md section 4)
const D13 = '2604,3235>2605,3235 2602,3235>2602,3236 2603,3234>2602,3234 2603,3233>2602,3233 2605,3234>2605,3233';
// bones-placement.md section 4: the east stay follows a 2-tile move and carries the bone
const ROTATIONS: Record<string, string> = {
    d13: D13,
    stay2: '2603,3233>2602,3233 2605,3234>2605,3235 2605,3234>2605,3233 2602,3235>2602,3234 2602,3235>2602,3236'
};

await runScript(async ({ bot: actions, sdk }) => {
    const say = async (cmd: string) => { if (!DEMO) { await sdk.sendSay(cmd); await sdk.waitForTicks(1); } };
    const tele = async (spec: string, x: number, z: number) => {
        if (DEMO) return;
        for (let i = 0; i < 5; i++) {
            await sdk.sendSay(`::tele ${spec}`);
            await sdk.waitForTicks(6);
            const p = sdk.getState()?.player;
            if (p && Math.abs(p.worldX - x) <= 2 && Math.abs(p.worldZ - z) <= 2) return;
        }
        throw new Error(`teleport to ${x},${z} did not land`);
    };
    const clearInventory = async () => {
        if (DEMO) return;
        for (const item of [...(sdk.getState()?.inventory ?? [])]) await sdk.sendDropItem(item.slot);
        await sdk.waitForTicks(2);
    };
    const knifeKit = async (logs = 10) => { await say('::give knife 1'); for (let i = 0; i < logs; i++) await say('::give logs 1'); };
    const progress = (s: { counters: Record<string, number>; gauges: Record<string, number>; tick: number; deferred: number }) => {
        if (s.tick % 100 === 0) console.log(`  T${s.tick} ${JSON.stringify(s.counters)} ${JSON.stringify(s.gauges)}${s.deferred ? ` deferred ${s.deferred}` : ''}`);
    };
    // Top-up stand-in for the run's helper trade (bones-placement.md section 3): a ::give at 3 bones left.
    const topUpBones = () => {
        let giving = false;
        return sdk.onStateUpdate(s => {
            if (DEMO || giving) return;
            const bones = s.inventory.filter(i => /^dragon bones$/i.test(i.name)).length;
            const free = 28 - s.inventory.length;
            if (bones > 3 || free < 6) return;
            giving = true;
            void sdk.sendSay(`::give dragon_bones ${free - 2}`).finally(() => sdk.waitForTicks(3).then(() => { giving = false; }));
        });
    };
    // every hitpoint change, with the NPCs that hit this tick (a fresh account dies to a river spider)
    const watchHitpoints = () => {
        let hp = sdk.getState()?.player?.hp ?? 0;
        let deaths = sdk.getState()?.player?.respawnCount ?? 0;
        sdk.onStateUpdate(s => {
            const p = s.player;
            if (!p) return;
            if (p.hp < hp) {
                const by = (s.combatEvents ?? []).filter(e => e.tick >= s.tick - 1 && e.targetType === 'player').map(e => s.nearbyNpcs.find(m => m.index === e.sourceIndex)?.name ?? `#${e.sourceIndex}`);
                console.log(`  T${s.tick} HP ${hp} -> ${p.hp} at ${p.worldX},${p.worldZ}; by ${by.join(', ') || 'unknown'}`);
            }
            if (p.respawnCount > deaths) console.log(`  T${s.tick} DIED (respawn ${p.respawnCount})`);
            hp = p.hp;
            deaths = p.respawnCount;
        });
    };
    const report = (name: string, end: { result?: unknown; packets: number; deferred: number; skippedTicks: number; maxTickMs: number; counters: Record<string, number> }) => {
        console.log(`${name}: ${where()}`);
        console.log(JSON.stringify({ result: end.result, counters: end.counters, packets: end.packets, deferred: end.deferred, skippedTicks: end.skippedTicks, maxTickMs: end.maxTickMs }, null, 1));
    };

    if (!DEMO) await actions.skipTutorial().catch(() => {});
    await sdk.waitForTicks(2);
    while (sdk.getState()?.dialog.isOpen) { await sdk.sendClickDialog(0); await sdk.waitForTicks(1); }

    try {
        await measure();
    } catch (e) {
        if (e instanceof ProgramError) console.log(`program error: ${e.message} (${where()})\n${JSON.stringify(e.status, null, 1)}`);
        throw e;
    }

    // knife-cycle under the in-page host gate: segments, the gate's decisions, the probe's cost
    async function gated(method: string, skill: string, params: Record<string, unknown>) {
        // success chance per roll at the player's level (willow: the rune axe's stat_random bounds, trees.dbrow)
        const level = (s: BotWorldState | null) => s?.skills.find(k => k.name.toLowerCase() === skill)?.baseLevel ?? 99;
        const p = (s: BotWorldState | null) => (method === 'willow' ? statRandom(level(s), 56, 175) : catchChance(CYCLE_METHODS[method]!, level(s)) ?? 1);
        const hold = Number(flag('hold', '0'));
        if (hold) params.hold = hold;
        delete params.technique;
        const say = (l: string) => console.log(`  ${l}`);
        const gate = inPageGate(sdk, { plainTicksPerRoll: num('plain-per-roll', CYCLE_METHODS[method]!.plainCycle), trials: num('trials', 20), log: say });
        const t0 = sdk.getState()!.tick;
        const run = await runGatedProgram(sdk, 'knife-cycle', params, { gate, technique: flag('technique', 'auto') as GatedTechnique, rollsPerDrop: s => 1 / p(s), onProgress: progress, log: say });
        const end = sdk.getState()!.tick;
        console.log(`knife-cycle ${method} gated (hold ${hold}): ${where()}`);
        let prevEnd = t0;
        let successes = 0;
        for (const seg of run.segments) {
            const st = seg.status;
            const r = (st.result ?? {}) as Record<string, unknown>;
            const n = st.counters.successes ?? 0;
            successes += n;
            const span = (st.endedTick ?? st.tick) - st.startedTick;
            console.log(
                `segment ${seg.technique} ${st.startedTick}-${st.endedTick} (${seg.reason}): ${n} successes in ${span} ticks, ${(span / n).toFixed(2)} per success, gap mean ${r.ticksPerSuccess}, ` +
                    `${(span / n * p(sdk.getState())).toFixed(2)} per expected roll; starters ${st.counters.starters ?? 0}, held ${st.counters.held ?? 0}, phaseResyncs ${st.counters.phaseResyncs ?? 0}, slips ${st.counters.slips ?? 0}, resyncs ${st.counters.resyncs ?? 0}; ` +
                    `${st.startedTick - prevEnd} ticks since the previous segment or start (probe and restart); histogram ${JSON.stringify(r.histogram)}`
            );
            prevEnd = st.endedTick ?? st.tick;
        }
        for (const h of gate.history) {
            const v = h.verdict as { status?: string } | undefined;
            console.log(`gate T${h.tick} ${h.why}: ${h.on ? 'knife' : 'plain'}${h.switched ? ' (switch)' : ''}${h.result ? `, probe ${h.result.ticks} ticks, latency ${latencyHistogram(h.result.latencies)} of ${h.result.trials}, ${v?.status}` : ''}${h.measured ? `, measured knife ${h.measured.knife.toFixed(2)} vs plain ${h.measured.plain}` : ''}`);
        }
        console.log(`total: ${successes} successes in ${end - t0} ticks from the call (probes included), ${((end - t0) / successes).toFixed(2)} per success; ended ${run.ended}`);
    }

    async function measure() {
    switch (mode) {
        case 'probe': {
            if (!DEMO && !has('no-tele')) await tele('0,50,50,22,18', 3222, 3218);
            const r = await probeInPage(sdk, { trials: num('trials', 60) });
            console.log(`in-page probe: ${where()}, server ${process.env.SERVER ?? '(bot.env)'}`);
            console.log(`latency in ticks: ${latencyHistogram(r.latencies)}  (${r.trials} trials, ${r.lost} lost, ${r.ticks} ticks)${r.reason ? `  ${r.reason}` : ''}`);
            console.log(`on time ${r.onTime}/${r.trials}; sequence ${r.latencies.join('')}`);
            const ms = [...((r as { publishMs?: number[] }).publishMs ?? [])].sort((a, b) => a - b);
            const q = (p: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : NaN);
            console.log(`decoded-tick interval ms in the page: p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)} max ${q(1)}`);
            const st = programStatus(sdk.getState());
            if (st) console.log(`frame arrival to decision ms: p50 ${st.react.p50} p90 ${st.react.p90} max ${st.react.max}; loops/s last ${st.loops.last} p10(10 s) ${st.loops.p10Last10s}; frames p90 ${st.frames.p90} ms, catch-ups ${st.frames.catchUps}`);
            return;
        }
        case 'mine':
        case 'mineband': {
            const level = num('level', 99);
            const kit = flag('pickaxes', mode === 'mineband' ? 'kit' : 'rune')!;
            const D = num('respawn', 13);
            const rotation = flag('rotation');
            const stepsName = rotation ?? flag('steps', 'd13')!;
            const steps = rotation ? mining.ROTATIONS[rotation]!.steps : (ROTATIONS[stepsName] ?? stepsName);
            const [sx, sz] = steps.trim().split(/\s+/)[0]!.split('>')[0]!.split(',').map(Number) as [number, number];
            const bury = has('bury');
            await clearInventory();
            await say(`::setstat mining ${level}`);
            // --stats=default keeps a fresh account's combat 3 (10 hitpoints), as a rehearsal has
            if (flag('stats', '70') !== 'default') for (const stat of ['hitpoints', 'defence', 'attack', 'strength']) await say(`::setstat ${stat} 70`);
            watchHitpoints();
            if (bury) await say(`::setstat prayer ${num('prayer', 43)}`);
            for (const p of kit === 'kit' ? ['bronze', 'steel', 'mithril', 'adamant', 'rune'] : [kit]) await say(`::give ${p}_pickaxe 1`);
            await knifeKit(bury ? 2 : 4);
            if (bury) await say('::give dragon_bones 20');
            await tele(`0,${sx >> 6},${sz >> 6},${sx & 63},${sz & 63}`, sx, sz);
            // every rotation rock live (the program takes each rock's id at its start)
            if (!DEMO) await sdk.waitForTicks(D + 2);
            while (sdk.getState()?.dialog.isOpen) { await sdk.sendClickDialog(0); await sdk.waitForTicks(1); }
            if (mode === 'mineband') {
                const until = num('until', 99);
                const log = TickLog.memory();
                const ctx = { session: { sdk, bot: actions, name: bot, sessionId: 0 }, sdk, bot: actions, c: {}, log } as never;
                const t0 = sdk.getState()!.tick;
                for (const st of mining.steps({ to: until, respawn: D, travel: 'none', technique: (flag('technique', 'auto') as mining.Technique), ...(rotation ? { rotation } : {}) })) {
                    if (!st.name.startsWith('mining.iron')) continue;
                    const s0 = sdk.getState()!.tick;
                    await st.run(ctx);
                    console.log(`${st.name}: ${sdk.getState()!.tick - s0} ticks, level ${mining.miningLevel(sdk.getState())}`);
                }
                console.log(`mineband ${level}-${until} at respawn ${D}: ${sdk.getState()!.tick - t0} ticks (${where()})`);
                for (const r of log.rows) console.log(`${r.step} T${r.startTick}-${r.endTick} (${r.ticks}): ${JSON.stringify(r.meta)}`);
                return;
            }
            const inv = sdk.getState()!.inventory;
            const params: Record<string, unknown> = {
                steps, respawn: D, starter: flag('starter', 'knife'), ores: num('ores', 200),
                ...(has('success') ? { success: 'iron', rate: mining.rateTable(inv) } : kit !== 'rune' ? { rate: mining.rateTable(inv) } : {}),
            };
            if (bury) params.bury = '^dragon bones$';
            if (has('self-starter')) params.selfStarter = true;
            // hold the level: the success chance and the pickaxe stay those of --level
            let last = level;
            const unHold = has('hold') ? sdk.onStateUpdate(s => {
                const lv = mining.miningLevel(s);
                if (lv !== level && lv !== last) void sdk.sendSay(`::setstat mining ${level}`);
                last = lv;
            }) : () => {};
            const unBones = bury ? topUpBones() : () => {};
            // logs the knife starter burns (the kit's log count): normal logs in the pack, start to end
            const logsHeld = () => sdk.getState()!.inventory.filter(i => /^logs$/i.test(i.name)).reduce((n, i) => n + i.count, 0);
            const logs0 = logsHeld();
            const tLogs0 = sdk.getState()!.tick;
            const un = () => { unHold(); unBones(); console.log(`logs: ${logs0} -> ${logsHeld()} over ${sdk.getState()!.tick - tLogs0} ticks`); };
            const label = `knife-mine ${stepsName} L${level} ${kit}${has('success') ? ' success' : ''}${bury ? ' bury' : ''}`;
            try {
                if (has('gated')) {
                    const hold = Number(flag('hold-starters', '0'));
                    if (hold) params.hold = hold;
                    // --plain-per-ore=N sets the switch-off reference (below 3 forces a measured switch to plain)
                    const gate = inPageGate(sdk, { plainTicksPerRoll: num('plain-per-ore', mining.plainTicksPerOre(D)), trials: num('trials', 20), ...(flag('off-reprobe') ? { offReprobeTicks: num('off-reprobe', 500) } : {}), log: l => console.log(`  ${l}`) });
                    const rocks = [...new Set(steps.trim().split(/\s+/).map(st => st.split('>')[1]!))].map(k => k.split(',').map(Number) as [number, number]);
                    const liveAt = (s: BotWorldState, [x, z]: [number, number]) => s.nearbyLocs.some(l => l.x === x && l.z === z && !mining.EMPTY_ROCKS.has(l.id) && l.optionsWithIndex.some(o => /^mine$/i.test(o.text)));
                    const liveLap = (s: BotWorldState) => rocks.every(r => liveAt(s, r));
                    const t0 = sdk.getState()!.tick;
                    const run = await runGatedProgram(sdk, 'knife-mine', params, {
                        gate, technique: flag('technique', 'auto') as GatedTechnique, onProgress: progress, log: l => console.log(`  ${l}`),
                        // as mining.ts: every restart waits for the whole lap to be live
                        beforeRestart: async (next, prev) => {
                            const w0 = sdk.getState()!.tick;
                            const live0 = rocks.filter(r => liveAt(sdk.getState()!, r)).length;
                            for (let i = 0; i < D + 10 && !liveLap(sdk.getState()!); i++) await sdk.waitForTicks(1);
                            console.log(`  restart wait: T${w0} ${prev.technique}:${prev.reason} -> ${next}, ${live0}/${rocks.length} rocks live, waited ${sdk.getState()!.tick - w0} ticks`);
                        }
                    });
                    let prevEnd = t0;
                    for (const seg of run.segments) {
                        const st = seg.status;
                        console.log(`segment ${seg.technique} (${seg.reason}) T${st.startedTick}-${st.endedTick}: ${st.counters.ores ?? 0} ores, ${st.startedTick - prevEnd} ticks since the previous segment (probe, wait, start)`);
                        prevEnd = st.endedTick ?? st.tick;
                        report(`knife-mine segment ${seg.technique} (${seg.reason})`, st);
                    }
                    console.log(`gated total: ${run.segments.reduce((n, sg) => n + (sg.status.counters.ores ?? 0), 0)} ores in ${sdk.getState()!.tick - t0} ticks (probes, waits and starts included)`);
                    for (const h of gate.history) console.log(`gate T${h.tick} ${h.why}: ${h.on ? 'knife' : 'plain'}${h.result ? `, probe ${h.result.ticks} ticks` : ''}${h.measured ? `, measured knife ${h.measured.knife.toFixed(2)} vs plain ${h.measured.plain}` : ''}`);
                    return;
                }
                const started = await startProgram(sdk, 'knife-mine', params);
                const end = await awaitProgram(sdk, started.runId, { onProgress: progress });
                const r = end.result as { ores: number; ticks: number; failed?: number } | undefined;
                const p = statRandom(level, 96, 350);
                // a slip's program log: its plan lines and what landed around it
                const tail = (end as { logTail?: string[] }).logTail ?? [];
                if ((end.counters.slips ?? 0) > 0) {
                    const i = tail.findIndex(l => /SLIP/.test(l));
                    console.log(`slip context (log tail, ${tail.length} lines):\n${tail.slice(Math.max(0, i - 30), i + 8).join('\n')}`);
                }
                if (r) console.log(`level ${level} (p ${p.toFixed(3)}, 3/p ${(3 / p).toFixed(2)}): ${r.ores} ores in ${r.ticks} ticks, ${(r.ticks / r.ores).toFixed(2)} per ore, ${(r.ticks / (r.ores + (r.failed ?? 0))).toFixed(2)} per roll seen, ${((r.ticks / r.ores) * p).toFixed(2)} per expected roll`);
                return report(label, end);
            } finally {
                un();
            }
        }
        case 'fly':
        case 'willow':
        case 'tree': {
            const method = mode;
            const skill = mode === 'fly' ? 'fishing' : 'woodcutting';
            const level = num('level', mode === 'tree' ? 1 : mode === 'fly' ? 20 : 99);
            if (!DEMO) {
                await clearInventory();
                await say(`::setstat ${skill} ${level}`);
                for (const stat of ['hitpoints', 'defence', 'attack', 'strength']) await say(`::setstat ${stat} 70`);
                if (mode === 'fly') { await say('::give fly_fishing_rod 1'); await say('::give feather 5000'); }
                else await say(mode === 'willow' ? '::give rune_axe 1' : '::give bronze_axe 1');
                await knifeKit();
                if (mode === 'fly') await tele('0,50,50,41,48', 3241, 3248);
                else if (mode === 'willow') await tele('0,48,50,15,34', 3087, 3234);
                else await tele('0,49,50,58,30', 3194, 3230);
            }
            const params: Record<string, unknown> = { method, technique: flag('technique', 'knife') };
            if (flag('until')) params.untilLevel = num('until', 99);
            else params.successes = num('successes', 150);
            params.maxTicks = num('maxticks', 30_000);
            if (flag('reanchor')) params.reanchor = flag('reanchor');
            if (has('gated')) return gated(method, skill, params);
            const end = await runProgram(sdk, 'knife-cycle', params, { onProgress: progress });
            return report(`knife-cycle ${method}`, end);
        }
        case 'oak':
        case 'tav-willow': {
            // rs/105's standing tiles and the three trees reached from each (bones-placement.md section 3,
            // woodcutting.md section 2); `chance` is the rune axe's stat_random bounds (trees.dbrow)
            const site = mode === 'oak'
                ? { method: 'oak', level: 60, tele: '0,45,54,34,38', at: [2914, 3494], trees: [[2912, 3491], [2914, 3495], [2915, 3492]], chance: [112, 350] }
                : { method: 'willow', level: 88, tele: '0,45,53,40,14', at: [2920, 3406], trees: [[2918, 3405], [2919, 3407], [2921, 3405]], chance: [56, 175] };
            const bury = has('bury');
            const technique = flag('technique', 'knife');
            const level = num('level', site.level);
            if (!DEMO) {
                await clearInventory();
                await say(`::setstat woodcutting ${level}`);
                await say(`::setstat prayer ${num('prayer', 43)}`);
                await say('::give rune_axe 1');
                await knifeKit(2);
                if (bury) await say('::give dragon_bones 20');
                await tele(site.tele, site.at[0]!, site.at[1]!);
                while (sdk.getState()?.dialog.isOpen) { await sdk.sendClickDialog(0); await sdk.waitForTicks(1); }
            }
            const params: Record<string, unknown> = { method: site.method, technique, successes: num('successes', 200), maxTicks: num('maxticks', 30_000) };
            // --any-tree clicks the nearest tree instead of the three reachable ones
            if (!has('any-tree')) params.trees = site.trees;
            if (bury) params.bury = '^dragon bones$';
            const started = await startProgram(sdk, 'knife-cycle', params);
            // Σ1/p: each log stands for 1/p(L) rolls at the level it was cut at (tickmanip-demo-report.ts).
            const wc = (s: NonNullable<ReturnType<typeof sdk.getState>>) => s.skills.find(k => k.name === 'Woodcutting');
            const s0 = sdk.getState()!;
            let lastXp = wc(s0)?.experience ?? 0;
            let lastLevel = wc(s0)?.baseLevel ?? level;
            const levels = { first: lastLevel, last: lastLevel };
            let unit = 0;
            let logs = 0;
            let expectedRolls = 0;
            // Top-up stand-in: the run's helper trades at the tree (bones-placement.md section 3).
            const unTopUp = bury ? topUpBones() : () => {};
            const un = sdk.onStateUpdate(s => {
                const k = wc(s);
                if (k && k.experience > lastXp) {
                    const d = k.experience - lastXp;
                    unit = unit ? Math.min(unit, d) : d;
                    const n = Math.max(1, Math.round(d / unit));
                    logs += n;
                    expectedRolls += n / statRandom(lastLevel, site.chance[0]!, site.chance[1]!);
                    lastXp = k.experience;
                    lastLevel = k.baseLevel;
                    levels.last = lastLevel;
                }
            });
            try {
                const end = await awaitProgram(sdk, started.runId, { onProgress: progress });
                const r = (end.result ?? {}) as { ticks?: number; buried?: number };
                const ticks = r.ticks ?? 0;
                const p = (l: number) => statRandom(l, site.chance[0]!, site.chance[1]!).toFixed(3);
                const per = (n: number) => (ticks ? (n / ticks).toFixed(3) : 'n/a');
                report(`knife-cycle ${site.method} ${technique}${bury ? ' bury' : ''} L${level}`, end);
                console.log(`  logs ${logs} over ${ticks} ticks = ${per(logs)} per tick; p(L) ${p(levels.first)} at L${levels.first} to ${p(levels.last)} at L${levels.last}; Σ1/p ${expectedRolls.toFixed(1)} expected rolls = ${(ticks / expectedRolls).toFixed(3)} ticks per expected roll`);
                if (bury) {
                    const b = r.buried ?? 0;
                    console.log(`  bones ${b} = ${per(b)} per tick; with the run's trades (5 ticks per 25-bone load, i) ${(b / (ticks + b / 5)).toFixed(3)} per tick`);
                }
                return;
            } finally {
                un();
                unTopUp();
            }
        }
        case 'pickpocket': {
            const level = num('level', 55);
            const pack = flag('pack')?.split(',').filter(Boolean) ?? [];
            const arrows = pack.includes('arrows');
            const SHARKS = pack.length ? 6 : 26;
            const HELPER = flag('helper');
            const LOAD = num('load', 9);
            if (HELPER && !pack.includes('bury')) throw new Error('--helper tops up bones: give --pack=bury,...');
            let helper: Session | null = null;
            if (HELPER && !DEMO) {
                helper = await openSession(HELPER, { launch: true, pathfinding: false });
                await helper.bot.skipTutorial().catch(() => {});
                for (const item of [...(helper.sdk.getState()?.inventory ?? [])]) await helper.sdk.sendDropItem(item.slot);
            }
            if (!DEMO) {
                await tele('0,41,51,29,37', 2653, 3301);
                await clearInventory();
                await say('::setstat hitpoints 40');
                await say(`::setstat thieving ${level}`);
                await say(`::give shark ${SHARKS}`);
                if (pack.length) {
                    await say('::setstat magic 80');
                    await say('::setstat prayer 43');
                    await say('::setvar magearena 8');
                    await say('::give staff_of_fire 1');
                    await sdk.waitForTicks(2);
                    const staff = sdk.getState()?.inventory.find(i => /^staff of fire$/i.test(i.name));
                    if (staff) { await sdk.sendUseItem(staff.slot, staff.optionsWithIndex.find(o => /wield/i.test(o.text))?.opIndex ?? 2); await sdk.waitForTicks(2); }
                    await say('::give bloodrune 60000');
                    await say('::give airrune 60000');
                    if (arrows) { await say('::setstat fletching 75'); await say('::give headless_arrow 60000'); await say('::give rune_arrowheads 60000'); }
                    await say(`::give dragon_bones ${helper ? 4 : 28 - (sdk.getState()?.inventory.length ?? 28) - 1}`);
                }
                if (helper) {
                    const p = sdk.getState()!.player!;
                    await helper.sdk.sendSay(`::tele 0,${(p.worldX + 1) >> 6},${p.worldZ >> 6},${(p.worldX + 1) & 63},${p.worldZ & 63}`);
                    await helper.sdk.sendSay(`::give dragon_bones ${LOAD}`);
                    await sdk.waitForTicks(4);
                }
            }
            // Hold the level like the lite lab script (--hold): the cheat goes over the relay
            // beside the program's own clicks, so the sample stays at one level.
            const hold = !DEMO && flag('hold', '1') !== '0';
            const params: Record<string, unknown> = { rolls: num('rolls', 300), food: '^shark$', heal: 20 };
            if (pack.length) params.stunActions = pack;
            if (helper) {
                const name = helper.name.replace(/[ _]/g, '[ _]');
                params.stunActions = [{ name: 'topup', kind: 'player', player: `^${name}$`, fewer: [{ item: '^dragon bones$', than: 3 }], window: [2, 4] }, ...pack];
                params.idleOnInterface = true;
            }
            // Top-up bookkeeping, timed on the account's ticks: failures, rolls, trade opens, burials.
            const fails: number[] = [], rollTicks: number[] = [], openTicks: number[] = [], buryTicks: number[] = [];
            const trades: Array<{ open: number; done?: number; ok: boolean; why?: string }> = [];
            let rctx: ReceiverCtx | null = null, lastScoredTick = -1, wasOpen = false;
            const seenMsg = new Set<string>();
            const stopHelper = helper ? runHelper(helper, LOAD) : () => {};
            const started = await startProgram(sdk, 'pickpocket', params);
            let last = level;
            // What the pack's actions did, from the skills' xp (only rises: a ::setstat hold lowers it)
            const xpOf = (s: { skills: Array<{ name: string; experience: number }> }, n: string) => s.skills.find(k => k.name === n)?.experience ?? 0;
            const s0 = sdk.getState()!;
            const prev = { Prayer: xpOf(s0, 'Prayer'), Magic: xpOf(s0, 'Magic'), Fletching: xpOf(s0, 'Fletching') };
            const gained = { Prayer: 0, Magic: 0, Fletching: 0 };
            let refilling = false;
            const un = sdk.onStateUpdate(s => {
                const lv = s.skills.find(k => k.name === 'Thieving')?.baseLevel ?? level;
                if (hold && lv !== level && lv !== last) void sdk.sendSay(`::setstat thieving ${level}`);
                last = lv;
                if (!pack.length || DEMO) return;
                const newTick = s.tick !== lastScoredTick;
                lastScoredTick = s.tick;
                for (const m of s.gameMessages ?? []) {
                    const key = m.observationId !== undefined ? `o${m.observationId}` : `${m.tick}|${m.text}`;
                    if (seenMsg.has(key)) continue;
                    seenMsg.add(key);
                    if (/You fail to pick/i.test(m.text)) { fails.push(s.tick); rollTicks.push(s.tick); }
                    else if (/^You pick the/i.test(m.text)) rollTicks.push(s.tick);
                }
                for (const n of ['Prayer', 'Magic', 'Fletching'] as const) {
                    const xp = xpOf(s, n);
                    if (xp > prev[n]) {
                        gained[n] += xp - prev[n];
                        if (n === 'Prayer') for (let b = 0; b < Math.round((xp - prev[n]) / 1800); b++) buryTicks.push(s.tick);
                    }
                    prev[n] = xp;
                }
                if (helper && newTick) {
                    // The account's side of the trade: the program idles while it is open.
                    const tr = tradeOf(s);
                    if (tr.isOpen && !wasOpen) { openTicks.push(s.tick); trades.push({ open: s.tick, ok: false }); }
                    wasOpen = tr.isOpen;
                    if (tr.isOpen && !rctx) rctx = newReceiverCtx(helper.name, s.inventory, [{ item: /^dragon bones$/i, amount: LOAD }]);
                    if (rctx) {
                        const d = decideReceiver(s, rctx);
                        rctx = d.next;
                        const cur = trades[trades.length - 1]!;
                        if (d.action === 'accept') void sdk.sendAcceptTrade();
                        else if (d.action === 'decline') { void sdk.sendDeclineTrade(); cur.why = d.reason; rctx = null; }
                        else if (d.action === 'done') { cur.ok = true; cur.done = s.tick; rctx = null; }
                        else if (d.action === 'closed') { cur.why = 'closed'; rctx = null; }
                        else if (tr.isOpen && s.tick - cur.open > 20) { void sdk.sendDeclineTrade(); cur.why = 'timeout'; rctx = null; }
                    }
                }
                const lvl = (n: string) => s.skills.find(k => k.name === n)?.baseLevel ?? 0;
                if (lvl('Magic') >= 99) void sdk.sendSay('::setstat magic 80');
                if (arrows && lvl('Fletching') >= 99) void sdk.sendSay('::setstat fletching 75');
                if (refilling) return;
                const bones = s.inventory.filter(i => /^dragon bones$/i.test(i.name)).length;
                const sharks = s.inventory.filter(i => /^shark$/i.test(i.name)).length;
                const free = 28 - s.inventory.length;
                if (tradeOf(s).isOpen) return;
                if ((!helper && pack.includes('bury') && bones <= 3 && free >= 6) || sharks <= 2) {
                    refilling = true;
                    const give = async () => {
                        if (sharks <= 2) await sdk.sendSay(`::give shark ${Math.min(4, free)}`);
                        const left = free - (sharks <= 2 ? Math.min(4, free) : 0) - 1;
                        if (!helper && pack.includes('bury') && left > 0) await sdk.sendSay(`::give dragon_bones ${left}`);
                        await sdk.waitForTicks(3);
                    };
                    void give().finally(() => { refilling = false; });
                }
            });
            try {
                const end = await awaitProgram(sdk, started.runId, { onProgress: progress });
                report(pack.length ? `pickpocket +${pack.join('+')}` : 'pickpocket', end);
                if (pack.length) console.log(`pack: ${(gained.Prayer / (72 * 25)).toFixed(0)} bones buried (Prayer xp), ${(gained.Magic / (180 * 25)).toFixed(0)} Charges (Magic xp), ${(gained.Fletching / (12.5 * 25 * 15)).toFixed(0)} rune arrow actions (Fletching xp)`);
                if (helper) console.log(`top-ups: ${JSON.stringify(topupReport(fails, rollTicks, openTicks, buryTicks, trades))}`);
                return;
            } finally {
                un();
                stopHelper();
                if (helper) await closeSession(helper);
            }
        }
        case 'agility': {
            // --level (99) --hp (99) --cakes=N (given, after clearing the inventory) --until=L (instead of --laps)
            // --eat-below (with --eat-gap, 3) --food --pause-for --start=x,z (instead of the course start)
            const course = flag('course', 'wilderness')!;
            const start: Record<string, [number, number]> = { wilderness: [3004, 3937], gnome: [2474, 3436], barbarian: [2551, 3554] };
            if (!DEMO) {
                await say(`::setstat agility ${num('level', 99)}`);
                await say(`::setstat hitpoints ${num('hp', 99)}`);
                if (flag('defence')) await say(`::setstat defence ${num('defence', 1)}`);
                if (flag('prayer')) await say(`::setstat prayer ${num('prayer', 1)}`);
                if (flag('cakes') || flag('sharks')) {
                    await clearInventory();
                    for (let i = 0; i < num('cakes', 0); i++) await say('::give cake 1');
                    for (let i = 0; i < num('sharks', 0); i++) await say('::give shark 1');
                }
                const [x, z] = flag('start') ? (flag('start')!.split(',').map(Number) as [number, number]) : start[course]!;
                await tele(teleSpec(x, z), x, z);
            }
            const params: Record<string, unknown> = { course, technique: flag('technique', 'react'), startStep: 'auto' };
            if (flag('until')) params.untilLevel = num('until', 99);
            else params.laps = num('laps', 10);
            // the lab rows in docs/speedrun/rehearsals/agility.md eat in any phase: eatGap turns that on
            if (flag('eat-below')) Object.assign(params, { eatBelow: num('eat-below', 0), eatGap: num('eat-gap', 3) });
            if (flag('eat-at')) params.eatAt = flag('eat-at');
            if (flag('food')) params.food = flag('food');
            if (flag('pause-for')) params.pauseFor = flag('pause-for');
            if (flag('protect')) params.protect = flag('protect');
            if (flag('flick-gap')) params.flickGap = num('flick-gap', 4);
            // --run turns run on first (controls:com_5, component 153; the button clears a pending
            // interaction, so it goes out before the program's first click)
            if (has('run') && sdk.getState()?.varps?.option_run !== 1) {
                await sdk.sendClickComponent(153);
                await sdk.waitForTicks(2);
            }
            console.log(`agility: option_run ${sdk.getState()?.varps?.option_run ?? 'unknown'}, run energy ${sdk.getState()?.player?.runEnergy ?? 'unknown'}`);
            // lap bonuses and falls with their ticks, each fall named by the obstacle zone the
            // player stood in the tick before (for falls per lap by obstacle)
            const lapLog = { bonus: [] as number[], falls: [] as Array<{ tick: number; step: string }>, steps: { one: 0, two: 0, jump: 0 } };
            const courseDef = AGILITY_COURSES[course as keyof typeof AGILITY_COURSES];
            const fresh = new FreshMessages(sdk.getState());
            let lastXp = sdk.getState()!.skills.find(k => /^agility$/i.test(k.name))?.experience ?? 0;
            let lastPos: [number, number] = [sdk.getState()!.player!.worldX, sdk.getState()!.player!.worldZ];
            let traceLeft = num('trace', 0);
            let traceXp = lastXp;
            const stopLapLog = sdk.onStateUpdate(s => {
                const xpNow = s.skills.find(k => /^agility$/i.test(k.name))?.experience ?? lastXp;
                if (courseDef && (xpNow - lastXp) / XP_RATE >= courseDef.lapBonus - 0.05) lapLog.bonus.push(s.tick);
                lastXp = xpNow;
                if (courseDef && fresh.take(s).some(m => AGILITY_FAIL_RE.test(m.text))) lapLog.falls.push({ tick: s.tick, step: stepFromPosition(courseDef, lastPos[0], lastPos[1]) ?? '?' });
                // --trace=N: one line per tick for the first N ticks (position, xp gained, animation)
                if (traceLeft > 0 && s.player) {
                    traceLeft--;
                    console.log(`TRACE ${s.tick} ${s.player.worldX},${s.player.worldZ} xp+${((xpNow - traceXp) / XP_RATE).toFixed(1)} anim ${s.player.animId}`);
                    traceXp = xpNow;
                }
                if (s.player) {
                    // ticks with a one-tile move (walking), a two-tile move (running), or more (a teleport or forced move)
                    const d = Math.max(Math.abs(s.player.worldX - lastPos[0]), Math.abs(s.player.worldZ - lastPos[1]));
                    if (d === 1) lapLog.steps.one++;
                    else if (d === 2) lapLog.steps.two++;
                    else if (d > 2) lapLog.steps.jump++;
                    lastPos = [s.player.worldX, s.player.worldZ];
                }
            });
            const t0 = sdk.getState()!.tick;
            const end = await runProgram(sdk, 'agility', params, { onProgress: progress });
            stopLapLog?.();
            console.log(`LAPLOG ${JSON.stringify(lapLog)}`);
            console.log(`agility: ${end.tick - t0} ticks from the start call to the end; hp ${sdk.getState()?.player?.hp}/${sdk.getState()?.player?.maxHp}`);
            return report(`agility ${course}`, end);
        }
        case 'eat-probe': {
            // The eat/obstacle mechanism (agility.md section 6.5): the Wilderness log balance
            // (3001,3945) clicked from (2996,3958), 13 tiles off, at Agility 99. Per trial: 'ctrl'
            // clicks only; 'walk' eats --eat-delay ticks after the click, during the walk; 'click'
            // sends the eat and then the click back to back. Prints ticks from the click to the
            // log's 20 xp ('lost' after 40), the tick the shark went, and where the player ended.
            const trials = num('trials', 3);
            const delay = num('eat-delay', 3);
            const LOG_LOC = [2297, 3001, 3945] as const;
            const FROM = [2996, 3958] as const;
            await say('::setstat agility 99');
            await say('::setstat hitpoints 99');
            await clearInventory();
            for (let i = 0; i < 27; i++) await say('::give shark 1');
            const xp = () => sdk.getState()!.skills.find(k => /^agility$/i.test(k.name))?.experience ?? 0;
            const sharks = () => sdk.getState()!.inventory.filter(i => /^shark$/i.test(i.name));
            const eat = async () => {
                const f = sharks()[0];
                if (!f) throw new Error('eat-probe: out of sharks');
                await sdk.sendUseItem(f.slot, f.optionsWithIndex.find(o => /^eat$/i.test(o.text))?.opIndex ?? 1);
            };
            const rows: Array<Record<string, unknown>> = [];
            for (const kind of ['ctrl', 'walk', 'click'] as const) {
                for (let n = 0; n < trials; n++) {
                    await tele(teleSpec(FROM[0], FROM[1]), FROM[0], FROM[1]);
                    await sdk.waitForTicks(3);
                    const x0 = xp();
                    const s0 = sharks().length;
                    const hp0 = sdk.getState()!.player!.hp;
                    if (kind === 'click') await eat();
                    await sdk.sendInteractLoc(LOG_LOC[1], LOG_LOC[2], LOG_LOC[0], 1);
                    const t0 = sdk.getState()!.tick;
                    let eatTick = -1;
                    let xpTick = -1;
                    let ate = false;
                    while (xpTick < 0) {
                        const s = await sdk.waitForTicks(1);
                        if (s.tick - t0 > 40) break;
                        if (kind === 'walk' && !ate && s.tick - t0 >= delay) {
                            ate = true;
                            await eat();
                        }
                        if (eatTick < 0 && sharks().length < s0) eatTick = s.tick;
                        if (xp() - x0 >= 19.9) xpTick = s.tick;
                    }
                    const p = sdk.getState()!.player!;
                    const row = {
                        kind, n, xpTicks: xpTick < 0 ? 'lost' : xpTick - t0, eatTick: eatTick < 0 ? null : eatTick - t0,
                        end: [p.worldX, p.worldZ], fell: p.worldZ > 6400, hpLost: hp0 - p.hp
                    };
                    rows.push(row);
                    console.log(`EATPROBE ${JSON.stringify(row)}`);
                    await sdk.waitForTicks(2);
                }
            }
            console.log(`RESULT eat-probe ${where()} ${JSON.stringify(rows)}`);
            return;
        }
        case 'rc': {
            const givers = (flag('givers') ?? process.env.GIVERS ?? '').split(',').filter(Boolean);
            if (givers.length === 0) throw new Error('rc needs --givers=a,b (lite runners logged in by tickprog-lab.sh GIVERS=...)');
            const lab = await runGivers({ sdk, givers, altar: flag('altar', 'body')!, schedule: flag('schedule', 'robust') as 'tuned' | 'robust', crafts: num('crafts', 30), onProgress: progress });
            report(`rc-cycle ${lab.altar} ${lab.schedule}`, lab.end);
            console.log(`givers: ${JSON.stringify(lab.givers)}`);
            console.log(`RESULT rc ${JSON.stringify(lab.summary)}`);
            return;
        }
        case 'agility-steps': {
            // speedrun/skills/agility.ts steps against the lab: --level --hp --at=x,z --cakes=N --knife --to=99
            // --only=step,step (default all) --opt=k=v,k=v (more steps() options). Logout is the logout button.
            const { steps } = await import('../../../speedrun/skills/agility');
            const { runSteps } = await import('../../../speedrun/runner/step');
            const { TickLog, formatReport, report: tickReport } = await import('../../../speedrun/lib/ticks');
            if (!DEMO) {
                await clearInventory();
                await say(`::setstat agility ${num('level', 1)}`);
                await say(`::setstat hitpoints ${num('hp', 10)}`);
                if (has('knife')) await say('::give knife 1');
                for (let i = 0; i < num('cakes', 0); i++) await say('::give cake 1');
                for (let i = 0; i < num('sharks', 0); i++) await say('::give shark 1');
                if (flag('at')) {
                    const [x, z] = flag('at')!.split(',').map(Number) as [number, number];
                    await tele(teleSpec(x, z), x, z);
                }
                await sdk.waitForTicks(2);
            }
            const extra = Object.fromEntries((flag('opt') ?? '').split(',').filter(Boolean).map(kv => kv.split('=') as [string, string]));
            const logout = async () => {
                const t = sdk.getState()!.tick;
                await sdk.sendClickComponent(2458);
                for (let k = 0; k < 20 && sdk.getState()?.inGame; k++) await new Promise(r => setTimeout(r, 300));
                console.log(`logout button clicked at tick ${t}; inGame ${sdk.getState()?.inGame}`);
            };
            let list = steps({ to: num('to', 99), ...extra, logout });
            // short names (walk-gnome): tickprog-lab.sh splits a mode's arguments on ':'
            if (flag('only')) list = list.filter(s => flag('only')!.split(',').some(n => s.name === n || s.name === `agility:${n}`));
            const log = TickLog.open(`agility-lab-${Date.now()}`);
            try {
                await runSteps({ sdk, bot: actions, name: bot!, sessionId: 1 }, list, { log, c: {} as never, shouldStop: () => false });
            } finally {
                console.log(formatReport(tickReport(log.rows)));
                for (const r of log.rows.filter(r => r.step.startsWith('agility:') && r.ticks === 0)) console.log(`ROW ${r.step} T${r.startTick} ${JSON.stringify(r.meta)}`);
                console.log(`log ${log.path}; ${where()}`);
            }
            return;
        }
        default:
            throw new Error(`unknown mode ${mode}: probe, mine, mineband, fly, willow, oak, tav-willow, tree, pickpocket, agility, agility-steps, eat-probe, rc`);
    }
    }

    /**
     * The helper's side (a lab stand-in: teleports beside the account, its stock by ::give).
     * It answers the account's request at once and offers the whole load with one press.
     */
    function runHelper(h: Session, load: number): () => void {
        let gctx: GiverCtx | null = null, plan: OfferEntry[] = [], lastTick = -1, lastTele = -100, lastReq = -100, lastStock = -100;
        const seen = new Set<string>();
        return h.sdk.onStateUpdate(hs => {
            if (!hs?.inGame || hs.tick === lastTick) return;
            lastTick = hs.tick;
            const s = sdk.getState();
            const scoredName = s?.player?.name ?? bot;
            const fresh = (hs.gameMessages ?? []).filter(m => {
                const key = m.observationId !== undefined ? `o${m.observationId}` : `${m.tick}|${m.text}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            const tr = tradeOf(hs);
            if (gctx) {
                const d = decideGiver(hs, gctx);
                gctx = d.next;
                if (d.action === 'burst') { for (const e of plan) for (const a of e.amounts) void h.sdk.sendOfferItem(e.slot, a); void h.sdk.sendAcceptTrade(); }
                else if (d.action === 'accept') void h.sdk.sendAcceptTrade();
                else if (d.action === 'decline') { void h.sdk.sendDeclineTrade(); gctx = null; }
                else if (d.action === 'done' || d.action === 'closed') gctx = null;
                return;
            }
            if (tr.isOpen) {
                plan = planOffers(hs.inventory, [{ item: /^dragon bones$/i, n: 'all' }]);
                gctx = newGiverCtx(scoredName, hs.inventory, plan);
                const d = decideGiver(hs, gctx);
                gctx = d.next;
                if (d.action === 'burst') { for (const e of plan) for (const a of e.amounts) void h.sdk.sendOfferItem(e.slot, a); void h.sdk.sendAcceptTrade(); }
                return;
            }
            const have = hs.inventory.filter(i => /^dragon bones$/i.test(i.name)).length;
            if (have < load && hs.tick - lastStock > 6) { void h.sdk.sendSay(`::give dragon_bones ${load - have}`); lastStock = hs.tick; }
            const idx = hs.nearbyPlayers.find(p => sameName(p.name, scoredName))?.index;
            if (idx !== undefined && fresh.some(m => /wishes to trade/i.test(m.text)) && hs.tick - lastReq >= 2) {
                void h.sdk.sendTradeRequest(idx);
                lastReq = hs.tick;
                return;
            }
            const me = hs.player, p = s?.player;
            if (me && p && Math.abs(me.worldX - p.worldX) + Math.abs(me.worldZ - p.worldZ) !== 1 && hs.tick - lastTele >= 6) {
                void h.sdk.sendSay(`::tele 0,${(p.worldX + 1) >> 6},${p.worldZ >> 6},${(p.worldX + 1) & 63},${p.worldZ & 63}`);
                lastTele = hs.tick;
            }
        });
    }
}, { timeout: 3 * 60 * 60_000, printState: false });

/** Per stun (failure to next roll): top-up stuns against the rest, and what each buried. */
function topupReport(fails: number[], rolls: number[], opens: number[], buries: number[], trades: Array<{ open: number; done?: number; ok: boolean; why?: string }>) {
    const rows = fails.map(f => {
        const next = rolls.find(r => r > f);
        return { f, gap: next === undefined ? null : next - f, topup: opens.some(o => o >= f && (next === undefined || o < next)), bones: buries.filter(b => b > f && (next === undefined || b <= next)).length };
    }).filter(r => r.gap !== null);
    const sum = (rs: typeof rows) => {
        const hist: Record<number, number> = {};
        for (const r of rs) hist[r.gap!] = (hist[r.gap!] ?? 0) + 1;
        return { stuns: rs.length, meanGap: rs.length ? +(rs.reduce((a, r) => a + r.gap!, 0) / rs.length).toFixed(2) : null, hist, bonesPerStun: rs.length ? +(rs.reduce((a, r) => a + r.bones, 0) / rs.length).toFixed(2) : null };
    };
    return {
        trades: { opened: trades.length, done: trades.filter(t => t.ok).length, failed: trades.filter(t => !t.ok).map(t => t.why ?? 'open at end'), openToDone: trades.filter(t => t.done !== undefined).map(t => t.done! - t.open) },
        topupStuns: sum(rows.filter(r => r.topup)),
        otherStuns: sum(rows.filter(r => !r.topup)),
        topupOpenAtK: rows.filter(r => r.topup).map(r => opens.find(o => o >= r.f)! - r.f)
    };
}
