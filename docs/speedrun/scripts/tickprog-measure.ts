// Measure an in-page tick program in the bot's browser tab (docs/speedrun/tick-programs.md).
//
//   bun docs/speedrun/scripts/tickprog-measure.ts <bot> <mode> [--key=value ...]
//
// modes (lab setup by staff cheats; --demo uses none and expects the kit in place):
//   probe        in-page latency probe            --trials=60 [--no-tele]
//   mine         knife iron rotation at respawn 13 (player_count pinned locally)
//                                                --ores=200 [--starter=knife|none]
//   fly          knife fly fishing, Lumbridge     --level=20 --until=99 | --successes=N [--technique=plain]
//   willow       knife willows, Draynor           --successes=150
//   oak          knife oaks, Taverley (2914,3494) --successes=200 [--level=60] [--bury [--prayer=43]]
//                --bury buries dragon bones inside the cycle; a ::give tops them up at 3 left
//                (off the scored clock; the run's trades cost rs/105's 5 ticks per load on top)
//   tree         knife normal trees, Lumbridge    --successes=150 [--level=1]  (the demo loop)
//                (knife modes: --successes counts xp drops, one log or fish each; the result's
//                ticksPerExpectedRoll is the figure to set against the cadence; on the trees it
//                needs an axe worn or carried, and the result names the one it used)
//   pickpocket   Ardougne knight, eat in windows  --level=55 --rolls=300 [--hold=1]
//   agility      Wilderness course                --laps=10 [--course=gnome]
//
// The page reacts on its own decoded tick; this script only sets up, starts the program
// through speedrun/lib/programs.ts, prints progress, and reports the program's result with
// the host, its load and the time. The tab must already be open (tickprog-tab.ts).
import { hostname, loadavg } from 'os';
import { runScript } from '../../../sdk/runner';
import { latencyHistogram } from '../../../speedrun/lib/hostgate';
import { awaitProgram, probeInPage, ProgramError, programStatus, runProgram, startProgram } from '../../../speedrun/lib/programs';

const bot = process.argv[2];
const mode = process.argv[3];
const flag = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const has = (name: string) => process.argv.includes(`--${name}`);
const DEMO = has('demo');
const num = (name: string, def: number) => Number(flag(name, String(def)));
const where = () => `host ${hostname()} load ${loadavg().map(l => l.toFixed(1)).join(' ')} at ${new Date().toISOString()}`;

// rs/5's zoo-cluster rotation at respawn 13 (tickmanip-mine-run.sh, mining.md section 4)
const D13 = '2604,3235>2605,3235 2602,3235>2602,3236 2603,3234>2602,3234 2603,3233>2602,3233 2605,3234>2605,3233';

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
        case 'mine': {
            await clearInventory();
            await say('::setstat mining 99');
            await say('::give rune_pickaxe 1');
            await knifeKit();
            await tele('0,40,50,44,35', 2604, 3235);
            const end = await runProgram(sdk, 'knife-mine', { steps: flag('steps', D13), respawn: num('respawn', 13), starter: flag('starter', 'knife'), ores: num('ores', 200) }, { onProgress: progress });
            return report('knife-mine', end);
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
            const end = await runProgram(sdk, 'knife-cycle', params, { onProgress: progress });
            return report(`knife-cycle ${method}`, end);
        }
        case 'oak': {
            const bury = has('bury');
            const level = num('level', 60);
            if (!DEMO) {
                await clearInventory();
                await say(`::setstat woodcutting ${level}`);
                await say(`::setstat prayer ${num('prayer', 43)}`);
                await say('::give rune_axe 1');
                await knifeKit(2);
                if (bury) await say('::give dragon_bones 20');
                await tele('0,45,54,34,38', 2914, 3494);
                while (sdk.getState()?.dialog.isOpen) { await sdk.sendClickDialog(0); await sdk.waitForTicks(1); }
            }
            const params: Record<string, unknown> = { method: 'oak', technique: flag('technique', 'knife'), successes: num('successes', 200), maxTicks: num('maxticks', 30_000) };
            // the three oaks reached from 2914,3494 (woodcutting.md section 2); --any-tree clicks the nearest oak
            if (!has('any-tree')) params.trees = [[2912, 3491], [2914, 3495], [2915, 3492]];
            if (bury) params.bury = '^dragon bones$';
            const started = await startProgram(sdk, 'knife-cycle', params);
            // Top-up stand-in: the run's helper trades at the tree (bones-placement.md section 3).
            let giving = false;
            const un = sdk.onStateUpdate(s => {
                if (!bury || DEMO || giving) return;
                const bones = s.inventory.filter(i => /^dragon bones$/i.test(i.name)).length;
                const free = 28 - s.inventory.length;
                if (bones > 3 || free < 6) return;
                giving = true;
                void sdk.sendSay(`::give dragon_bones ${free - 2}`).finally(() => sdk.waitForTicks(3).then(() => { giving = false; }));
            });
            try {
                const end = await awaitProgram(sdk, started.runId, { onProgress: progress });
                return report(`knife-cycle oak${bury ? ' bury' : ''} L${level}`, end);
            } finally {
                un();
            }
        }
        case 'pickpocket': {
            const level = num('level', 55);
            if (!DEMO) {
                await tele('0,41,51,29,37', 2653, 3301);
                await say('::setstat hitpoints 40');
                await say(`::setstat thieving ${level}`);
                await say('::give shark 26');
            }
            // Hold the level like the lite lab script (--hold): the cheat goes over the relay
            // beside the program's own clicks, so the sample stays at one level.
            const hold = !DEMO && flag('hold', '1') !== '0';
            const started = await startProgram(sdk, 'pickpocket', { rolls: num('rolls', 300), food: '^shark$', heal: 20 });
            let last = level;
            const un = sdk.onStateUpdate(s => {
                const lv = s.skills.find(k => k.name === 'Thieving')?.baseLevel ?? level;
                if (hold && lv !== level && lv !== last) void sdk.sendSay(`::setstat thieving ${level}`);
                last = lv;
            });
            try {
                const end = await awaitProgram(sdk, started.runId, { onProgress: progress });
                return report('pickpocket', end);
            } finally {
                un();
            }
        }
        case 'agility': {
            const course = flag('course', 'wilderness')!;
            const start: Record<string, [string, number, number]> = { wilderness: ['0,46,61,60,33', 3004, 3937], gnome: ['0,38,53,42,44', 2474, 3436], barbarian: ['0,39,55,55,34', 2551, 3554] };
            if (!DEMO) {
                await say('::setstat agility 99');
                await say('::setstat hitpoints 99');
                const [spec, x, z] = start[course]!;
                await tele(spec, x, z);
            }
            const end = await runProgram(sdk, 'agility', { course, laps: num('laps', 10), technique: flag('technique', 'react') }, { onProgress: progress });
            return report(`agility ${course}`, end);
        }
        default:
            throw new Error(`unknown mode ${mode}: probe, mine, fly, willow, oak, tree, pickpocket, agility`);
    }
    }
}, { timeout: 3 * 60 * 60_000, printState: false });
