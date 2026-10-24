// Lab driver for speedrun/skills/woodcutting.ts in the bot's browser tab. It sets a start with
// staff fixtures and runs the module's own steps through runner/step.ts, so the tick log holds
// exactly the rows an attempt writes: each step's measure row, the gated segments and each
// band's summary (rs/158's sub-band table). The tab must already be open (tickprog-lab.sh).
//
//   LAB_BLOCK=woodcutting NODE_TICKRATE=300 bash docs/speedrun/scripts/tickprog-lab.sh <bot> \
//     speedrun/lab/measure-woodcutting.ts:survey speedrun/lab/measure-woodcutting.ts:band:--level=15
//
// cases:
//   survey  ::tele to the oak and willow stands; list the trees in view and check SITES' `trees`
//   walk    a default-stats bot from Lumbridge at Woodcutting 1: walk-oaks (the approach
//           waypoints), then at level 73 walk-willows; ticks per leg and every hitpoint change
//   band    ::setstat woodcutting --level, the kit, ::tele to the band's stand, then the steps to
//           --to (default: the band's end)
//   chain   default stats at Lumbridge, Woodcutting set to --level (default 1), the kit by
//           ::give, every step to --to
// walk and chain set Woodcutting first, so a later case in the same tab starts where it says.
// options: --technique=auto|knife|plain, --plain-per-roll=4, --hold=0.15 (rs/156's forced slip),
//          --bad-probe (a gate rule no probe passes: plain, re-probed every 500 ticks),
//          --bury [--prayer=43] [--bones=N] [--helper=<bot> --load=23] (a second lab bot gives
//          loads by trade, asking while the account holds 2 or fewer, as Ashburn's helpers will;
//          without --helper the account starts with --bones and buries until they run out),
//          --prayer-to=0, --logs=5 (normal logs in the kit, as cairn_mule2 stages it), --log=<path>,
//          --starter (the tutorial's starter items, as a demo account carries them; walk and
//          chain), --hp-stop=N (the module's hpStop), --no-wait-respawn / --no-probe-dirs (the
//          module's two fixes off, for an A/B), --run=on|off (press the run button before the
//          steps start, on a tick with nothing pending: the button runs p_clearpendingaction)
// --givers=N (with --bury, band case): N bone givers cairn_b01.. taking turns as one group (bone-giver.ts
//   group, S07's b01-b04, staff-made bones), launched by the run-machine launcher (standalone.ts) against
//   this lab; the module takes each load from the group's server (bones.group) and writes their S07 cue.
//   --final=L (needs rs/383's group last load in bone-giver.ts): the group gives L loads, the last giver
//   carries finalExtras (law 1, air 5) and serves the L-th, and the module's lastLoad is 21.
//   --server-wait=N is the module's serverWait. Prints each load's giver and ticks, and the givers' logs.
//   --bone=<obj> the givers' bones (default dragon_bones; e.g. babydragon_bones, as rs/41 relaunched them).
//   --session=<id> the S07 cue session (the module's boneSession), and --counted=<giver>:<n>,... the loads
//   already given in it (cairn_b04=1,cairn_b01=1): the cue and those givers' statuses are written before the launcher starts, so the
//   givers resume their counts (bone-giver.ts onCue) as after a stopped attempt.
// --oak-logs=N oak logs in the kit (attempt 3's willow census carries one).
// Every segment row and load row prints as it is written, with its UTC time.
// --route=rimmington runs every case on the module's `rimmington` stands (the Rimmington oaks and
// the Draynor-west willows); the default is the scored run's `taverley`.
// Every walk and band step gets a telemetry line: tiles per tick (run 2, walk 1, still 0), run
// energy and weight at its start and end, and the run varp (`option_run`) at its start. The lab's run energy never drains (NODE_INFINITE_RUN defaults on,
// as on the demo), so neither energy nor weight is managed here.

import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { hostname, loadavg, tmpdir } from 'os';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import type { BotWorldState } from '../../sdk/types';
import { closeSession, openSession, type Session } from '../lib/session';
import { formatReport, report, TickLog } from '../lib/ticks';
import { give as giveTrade } from '../lib/trade';
import { runSteps, type Step } from '../runner/step';
import { writeJsonAtomicSync } from '../helpers/altar-cue';
import { BANDS, BoneCue, ROUTES, type RouteName, S07_BONE_CUE, steps, type SubBandRow, type TechniqueFigures, type Tree, wcLevel, type WoodcuttingOptions } from '../skills/woodcutting';
import { give, leaveTutorial, setstat, tele } from './setup';

const ROOT = join(import.meta.dir, '../..');
const bot = process.argv[2];
const which = process.argv[3];
const flag = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const has = (name: string) => process.argv.includes(`--${name}`);
const CASES = ['survey', 'walk', 'band', 'chain'];
if (!bot || !CASES.includes(which ?? '')) {
    console.error(`usage: bun speedrun/lab/measure-woodcutting.ts <bot> ${CASES.join('|')} [--level=15] [--to=N] [--technique=auto] [--bury [--helper=<bot>]] ...`);
    process.exit(2);
}
const route = flag('route', 'taverley')!;
if (!Object.hasOwn(ROUTES, route)) throw new Error(`unknown --route ${route} (${Object.keys(ROUTES).join(', ')})`);
const sites = ROUTES[route as RouteName];
const where = () => `host ${hostname()} load ${loadavg().map(l => l.toFixed(1)).join(' ')} at ${new Date().toISOString()}`;
const LUMBRIDGE = [3222, 3222] as const;
/** controls:com_4 (run off) and com_5 (run on), interface.pack; player_controls.rs2. */
const RUN_BUTTON = { off: 152, on: 153 } as const;
const BONES = /^dragon bones$/i;
/** The helper's tile beside each stand (STEP-MANIFEST.md entry 3; bones-wc.ts). */
const HELPER_TILE: Record<'oak' | 'willow', readonly [number, number]> = { oak: [2913, 3494], willow: [2920, 3407] };

const f2 = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? '-' : n.toFixed(2));
function techCols(t: TechniqueFigures | undefined): string {
    return t ? `${t.ticks} t, ${t.logs} logs, ${f2(t.ticksPerExpectedRoll)}/roll, ${f2(t.ticksPerLog)}/log (lattice ${f2(t.latticeTicksPerLog)}), success fit ${f2(t.fittedSuccess)} vs ${f2(t.formulaSuccess)}` : '-';
}
function printBand(step: string, meta: Record<string, unknown>): void {
    const { subBands, segments, histogram, gate, counters, ...rest } = meta as unknown as { subBands: SubBandRow[]; segments: unknown[]; histogram: unknown; gate?: { history: unknown[]; switches: string }; counters: unknown } & SubBandRow;
    console.log(`${step}: ${rest.ticks} ticks (probes ${rest.probeTicks}, bones ${rest.bonesTicks}), knife share ${f2(rest.knifeShare)}; ended ${(meta as { ended: string }).ended}`);
    for (const r of [...subBands, { ...rest, from: 0, to: 0 }]) {
        const label = r.from ? `${r.from}-${r.to}` : 'band';
        console.log(`  ${label.padEnd(6)} knife: ${techCols(r.knife)}`);
        console.log(`  ${''.padEnd(6)} plain: ${techCols(r.plain)}; share ${f2(r.knifeShare)}; probes ${r.probeTicks}, bones ${r.bonesTicks}`);
    }
    console.log(`  counters ${JSON.stringify(counters)}; histogram ${JSON.stringify(histogram)}`);
    for (const seg of segments) console.log(`  segment ${JSON.stringify(seg)}`);
    if (gate) {
        console.log(`  gate switches: ${gate.switches || 'none'}`);
        for (const h of gate.history) console.log(`  gate ${JSON.stringify(h)}`);
    }
}

/** A lab helper bot on the same block as `main` (its bot.env pointed at main's ports). */
async function openHelper(name: string, main: string): Promise<Session> {
    const envPath = (b: string) => join(ROOT, 'bots', b, 'bot.env');
    if (!existsSync(envPath(name))) {
        const p = Bun.spawnSync(['bun', 'bots/create-bot.ts', name, '--local', '--no-chat'], { cwd: ROOT, stderr: 'pipe' });
        if (p.exitCode !== 0) throw new Error(`create-bot ${name}: ${p.stderr.toString()}`);
    }
    const mainEnv = readFileSync(envPath(main), 'utf8');
    const pick = (k: string) => mainEnv.match(new RegExp(`^${k}=.*$`, 'm'))?.[0];
    let env = readFileSync(envPath(name), 'utf8');
    for (const k of ['SERVER', 'GATEWAY_URL']) {
        const line = pick(k);
        if (line) env = env.match(new RegExp(`^${k}=`, 'm')) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), line) : `${env.trimEnd()}\n${line}\n`;
    }
    writeFileSync(envPath(name), env);
    return openSession(name, { client: 'lite', launch: true, pathfinding: false });
}

interface Group {
    group: string[];
    cueDir: string;
    runDir: string;
    stop(): Promise<void>;
}

/** The bone giver group, one bone-giver role per account under the run-machine launcher, on this lab's engine. */
async function startGroup(n: number, final: number | null, tree: 'oak' | 'willow', main: string, bone: { item: string; obj: string } | null, prestage?: (cueDir: string) => void): Promise<Group> {
    const webPort = readFileSync(join(ROOT, 'bots', main, 'bot.env'), 'utf8').match(/^SERVER=localhost:(\d+)$/m)?.[1];
    if (!webPort) throw new Error(`--givers: bots/${main}/bot.env has no SERVER=localhost:<port>`);
    const base = mkdtempSync(join(tmpdir(), 'wc-givers-'));
    const botsDir = join(base, 'bots');
    const runDir = join(base, 'run');
    const group = Array.from({ length: n }, (_, i) => `cairn_b0${i + 1}`);
    for (const account of group) {
        mkdirSync(join(botsDir, account), { recursive: true, mode: 0o700 });
        writeFileSync(join(botsDir, account, 'bot.env'), `BOT_USERNAME=${account}\nPASSWORD=${randomBytes(6).toString('hex')}\nSERVER=localhost:${webPort}\nSHOW_CHAT=false\nTELEMETRY=false\nPROFANITY_FILTER=false\n`, { mode: 0o600 });
    }
    // Both sites in run order, as the run's givers have them (bone-giver.ts S07_SITES): the cue names the one SCORED is at.
    const giverSites = (['oak', 'willow'] as const).map(t => ({ giver: { x: HELPER_TILE[t][0], z: HELPER_TILE[t][1] }, receiver: { x: sites[t].stand[0], z: sites[t].stand[1] } }));
    const runes = [{ item: 'Law rune', count: 1, obj: 'lawrune' }, { item: 'Air rune', count: 5, obj: 'airrune' }];
    const accounts = group.map((account, i) => ({
        account,
        role: 'bone-giver',
        options: {
            restock: { kind: 'cheat' },
            sites: giverSites,
            scope: S07_BONE_CUE,
            group,
            ...(bone ? { item: bone.item, obj: bone.obj } : {}),
            ...(final !== null ? { trades: final } : {}),
            ...(final !== null && i === n - 1 ? { finalExtras: runes } : {})
        }
    }));
    const configPath = join(base, 'launch.json');
    writeFileSync(configPath, JSON.stringify({ gatewayPort: Number(process.env.BONE_GW_PORT ?? 8486), botsDir, runDir, loginSpacingMs: 2000, accounts }, null, 2));
    const cueDir = join(runDir, 'rc-cue');
    if (prestage) {
        mkdirSync(cueDir, { recursive: true });
        prestage(cueDir);
    }
    const child = Bun.spawn([process.execPath, 'speedrun/helpers/standalone.ts', configPath], {
        cwd: ROOT,
        env: { ...process.env, HELPER_LAB_TELE: '1', RC_CUE_DIR: cueDir },
        stdout: Bun.file(join(base, 'launcher.out')),
        stderr: Bun.file(join(base, 'launcher.err'))
    });
    console.log(`  givers ${group.join(', ')}${final !== null ? `, ${final} loads, the last from ${group[n - 1]}` : ''}: launcher pid ${child.pid}, run files in ${base}`);
    const t0 = Date.now();
    for (;;) {
        const status = existsSync(join(runDir, 'launcher.json')) ? (JSON.parse(readFileSync(join(runDir, 'launcher.json'), 'utf8')) as { helpersReady?: boolean }) : null;
        if (status?.helpersReady) break;
        if (child.exitCode !== null) throw new Error(`the launcher exited ${child.exitCode}: ${readFileSync(join(base, 'launcher.err'), 'utf8').slice(-2000)}`);
        if (Date.now() - t0 > 180_000) throw new Error('the givers were not all in within 180 s');
        await Bun.sleep(1000);
    }
    console.log(`  givers in after ${Math.round((Date.now() - t0) / 1000)} s`);
    return {
        group,
        cueDir,
        runDir,
        async stop() {
            child.kill('SIGINT');
            await Promise.race([child.exited, Bun.sleep(30_000)]);
            if (child.exitCode === null) child.kill('SIGKILL');
        }
    };
}

await runScript(async ({ bot: actions, sdk }) => {
    await leaveTutorial({ sdk, bot: actions, name: bot, sessionId: 0 } as never);
    await sdk.waitForTicks(2);
    while (sdk.getState()?.dialog.isOpen) {
        await sdk.sendClickDialog(0);
        await sdk.waitForTicks(1);
    }
    const clear = async () => {
        for (const item of [...(sdk.getState()?.inventory ?? [])]) await sdk.sendDropItem(item.slot);
        await sdk.waitForTicks(2);
    };
    const kit = async () => {
        await give(sdk, ['rune_axe', 'knife', ...Array(Number(flag('logs', '5'))).fill('logs'), ...Array(Number(flag('oak-logs', '0'))).fill('oak_logs')]);
        await sdk.waitForTicks(2);
    };

    if (which === 'survey') {
        for (const tree of ['oak', 'willow'] as const) {
            const site = sites[tree];
            if (!(await tele(sdk, site.stand[0], site.stand[1]))) throw new Error(`tele to the ${tree} stand failed`);
            await sdk.waitForTicks(3);
            const s = sdk.getState()!;
            const trees = s.nearbyLocs.filter(l => /^(oak|willow|tree|dead tree|evergreen)$/i.test(l.name) && l.distance <= 15).sort((a, b) => a.distance - b.distance);
            console.log(`${tree} stand ${site.stand.join(',')}: player at ${s.player?.worldX},${s.player?.worldZ}; ${where()}`);
            for (const l of trees) {
                const listed = site.trees?.some(t => t[0] === l.x && t[1] === l.z) ? ' (in SITES)' : '';
                console.log(`  ${l.name} #${l.id} at ${l.x},${l.z} distance ${l.distance}; ${l.optionsWithIndex.map(o => o.text).join('/')}${listed}`);
            }
            const missing = (site.trees ?? []).filter(t => !trees.some(l => l.x === t[0] && l.z === t[1] && l.name.toLowerCase() === tree));
            console.log(`  ${tree}: ${missing.length ? `MISSING ${missing.map(t => t.join(',')).join(' ')}` : `all ${site.trees?.length} listed trees present`}`);
        }
        return;
    }

    let hp = sdk.getState()?.player?.hp ?? 0;
    let minHp = hp;
    let deaths = sdk.getState()?.player?.respawnCount ?? 0;
    sdk.onStateUpdate(s => {
        const p = s.player;
        if (!p) return;
        if (p.hp < hp) {
            const by = (s.combatEvents ?? [])
                .filter(e => e.tick >= s.tick - 1 && e.targetType === 'player')
                .map(e => {
                    const n = s.nearbyNpcs.find(m => m.index === e.sourceIndex);
                    return n ? `${n.name} #${n.index} (combat ${n.combatLevel}) at ${n.x},${n.z}` : `source #${e.sourceIndex}`;
                });
            console.log(`  T${s.tick} hitpoints ${hp} -> ${p.hp} at ${p.worldX},${p.worldZ}; by ${by.join(', ') || 'unknown'}`);
        } else if (p.hp !== hp) console.log(`  T${s.tick} hitpoints ${hp} -> ${p.hp}`);
        hp = p.hp;
        minHp = Math.min(minHp, p.hp);
        if (p.respawnCount > deaths) console.log(`  T${s.tick} DIED (respawn ${p.respawnCount})`);
        deaths = p.respawnCount;
    });

    const level = Number(flag('level', which === 'band' ? '15' : '1'));
    const tree: Tree = level >= 73 ? 'willow' : level >= 15 ? 'oak' : 'normal';
    const bury = has('bury');
    const helperName = flag('helper');
    const load = Number(flag('load', '23'));
    let helper: Session | null = null;
    const nGivers = Number(flag('givers', '0'));
    const final = flag('final') === undefined ? null : Number(flag('final'));
    let givers: Group | null = null;
    if (nGivers && (!bury || helperName || tree === 'normal' || nGivers < 2 || nGivers > 9)) throw new Error('--givers=N takes 2-9 givers, with --bury, without --helper, on an oak or willow band');
    if (final !== null && (!nGivers || !Number.isInteger(final) || final < 1)) throw new Error('--final=L needs --givers and a load count');

    if (which === 'band') {
        await clear();
        await setstat(sdk, 'woodcutting', level);
        if (flag('prayer')) await setstat(sdk, 'prayer', Number(flag('prayer')));
        await kit();
        // a giver or a group brings the first load; alone the account starts with one
        const bones = Number(flag('bones', bury && !helperName && !nGivers ? String(load) : '0'));
        if (bones) await give(sdk, Array(bones).fill('dragon_bones'));
        const stand = sites[tree].stand;
        if (!(await tele(sdk, stand[0], stand[1]))) throw new Error(`tele to ${stand.join(',')} failed`);
    } else {
        // walk and chain: a fresh account's stats, from Lumbridge, carrying the kit (and with
        // --starter the tutorial's items, as on the demo). Woodcutting is set first: an earlier
        // case in this tab may have left it at 73, and walk-oaks is a no-op from oak 73 on.
        await clear();
        await setstat(sdk, 'woodcutting', level);
        if (has('starter')) {
            // tutorial.rs2 tutorial_complete's inv_add list, so a later case in the same tab carries the same
            await give(sdk, ['bronze_axe', 'tinderbox', 'net', 'shrimp', 'bucket_empty', 'pot_empty', 'bread', 'bronze_pickaxe', 'bronze_dagger', 'bronze_sword', 'wooden_shield', 'shortbow']);
            for (const [name, n] of [['bronze_arrow', 25], ['airrune', 25], ['mindrune', 15], ['waterrune', 6], ['earthrune', 4], ['bodyrune', 2]] as const) await give(sdk, name, n);
        }
        await kit();
        if (!(await tele(sdk, LUMBRIDGE[0], LUMBRIDGE[1]))) throw new Error('tele to Lumbridge failed');
    }
    await sdk.waitForTicks(2);
    const runMode = flag('run');
    if (runMode !== undefined) {
        if (runMode !== 'on' && runMode !== 'off') throw new Error(`--run takes on or off, not ${runMode}`);
        const want = runMode === 'on' ? 1 : 0;
        if (sdk.getState()?.varps?.option_run !== want) {
            await sdk.sendClickComponent(RUN_BUTTON[runMode]);
            await sdk.waitForCondition(s => s.varps?.option_run === want, 5000);
        }
        await sdk.waitForTicks(1);
        console.log(`  run ${runMode}: option_run ${sdk.getState()?.varps?.option_run} at T${sdk.getState()?.tick}`);
    }

    // Walk telemetry: the last state seen on each tick.
    const samples = new Map<number, { x: number; z: number; e: number; w: number; run?: number }>();
    sdk.onStateUpdate(s => {
        const p = s.player;
        if (!p) return;
        samples.set(s.tick, { x: p.worldX, z: p.worldZ, e: p.runEnergy, w: p.runWeight, ...(s.varps?.option_run !== undefined ? { run: s.varps.option_run } : {}) });
    });
    const walkLine = (step: string, from: number, to: number): string => {
        const n = { run: 0, walk: 0, still: 0, gaps: 0 };
        let tiles = 0;
        let first: number | null = null;
        let last: number | null = null;
        for (let t = from + 1; t <= to; t++) {
            const a = samples.get(t - 1);
            const b = samples.get(t);
            if (!a || !b) {
                n.gaps++;
                continue;
            }
            const d = Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z));
            tiles += d;
            if (d >= 2) n.run++;
            else if (d === 1) n.walk++;
            else n.still++;
            if (d > 0) {
                first ??= t;
                last = t;
            }
        }
        const s0 = samples.get(from);
        const s1 = samples.get(to);
        const lead = first === null ? 0 : first - from - 1;
        const tail = last === null ? 0 : to - last;
        return `moves ${step}: ${to - from} ticks, ${tiles} tiles; run ${n.run}, walk ${n.walk}, still ${n.still} (before the first step ${lead}, after the last ${tail}), unseen ${n.gaps}; energy ${s0?.e}% -> ${s1?.e}%, weight ${s0?.w} -> ${s1?.w} kg, option_run ${s0?.run ?? '-'}`;
    };

    if (bury && helperName) {
        if (tree === 'normal') throw new Error('--helper needs an oak or willow band');
        helper = await openHelper(helperName, bot);
        await helper.bot.skipTutorial?.().catch(() => {});
        const spot = HELPER_TILE[tree];
        if (!(await tele(helper.sdk, spot[0], spot[1]))) throw new Error('helper tele failed');
        await give(helper.sdk, Array(load).fill('dragon_bones'));
        let pending = false;
        const me = sdk.getState()?.player?.name ?? bot;
        sdk.onStateUpdate(s => {
            if (pending || s.inventory.filter(i => BONES.test(i.name)).length > 2) return;
            pending = true;
            console.log(`  T${s.tick} helper asks to trade (account holds ${s.inventory.filter(i => BONES.test(i.name)).length} bones)`);
            giveTrade(helper!.sdk, me, [{ item: BONES, n: 'all' }], { maxTicks: 80, openTimeoutMs: 60_000 })
                .then(async g => {
                    console.log(`  helper give: ${g.ok ? 'ok' : g.reason}, ${g.ticks} ticks`);
                    await give(helper!.sdk, Array(load).fill('dragon_bones'));
                    await helper!.sdk.waitForTicks(2);
                })
                .catch(e => console.log(`  helper give failed: ${e}`))
                .finally(() => {
                    pending = false;
                });
        });
    }

    const boneObj = flag('bone');
    const bone = boneObj ? { obj: boneObj, item: boneObj.charAt(0).toUpperCase() + boneObj.slice(1).replace(/_/g, ' ') } : null;
    const boneSession = flag('session');
    // giver=n pairs: lab.sh splits a script's arguments on ':'
    const counted = (flag('counted') ?? '').split(',').filter(Boolean).map(e => e.split('=') as [string, string]);
    if (counted.length && !boneSession) throw new Error('--counted needs --session');
    // A stopped attempt's S07 session: its cue, and each counted giver's status in it (restocking, its loads given).
    const prestage = boneSession
        ? (cueDir: string) => {
              new BoneCue(cueDir, boneSession).write(sdk.getState(), bot, sites[tree as 'oak' | 'willow'].stand);
              for (const [account, n] of counted) {
                  writeJsonAtomicSync(join(cueDir, `bones-${account}.json`), {
                      v: 1, account, phase: 'restock', held: 0, n: load, trades: Number(n), bounces: 0, tile: null, readyAt: null, session: boneSession,
                      final: final !== null && account === `cairn_b0${nGivers}`, loads: final, ms: Date.now()
                  });
              }
              console.log(`  staged S07 session ${boneSession} in ${cueDir}: ${counted.map(([a, n]) => `${a} ${n}`).join(', ') || 'no loads'} counted`);
          }
        : undefined;
    if (nGivers) givers = await startGroup(nGivers, final, tree as 'oak' | 'willow', bot, bone, prestage);

    const s0 = sdk.getState()!;
    console.log(`measure-woodcutting ${which}: Woodcutting ${wcLevel(s0)} at ${s0.player?.worldX},${s0.player?.worldZ}; ${where()}`);
    const log = TickLog.open(undefined, flag('log'));
    // Live lines: each load and each segment as the band writes it.
    const utc = () => new Date().toISOString().slice(11, 19) + 'Z';
    const append = log.append.bind(log);
    log.append = (row => {
        append(row);
        const m = (row.meta ?? {}) as Record<string, unknown>;
        if (m.kind === 'wc-bones-load') {
            console.log(`[${utc()}] T${row.endTick} load ${m.load} from ${m.giver ?? '-'} ${row.ok ? 'ok' : `FAILED (${m.reason})`}: click to bones ${m.ticks} t, step ${m.stepTicks} t (server wait ${m.serverWait ?? '-'}, re-picks ${m.repicks ?? '-'}), received ${m.received}; Prayer ${sdk.getState()?.skills.find(k => k.name === 'Prayer')?.baseLevel}, WC ${wcLevel(sdk.getState())}`);
        } else if (m.kind === 'wc-segment') {
            const c = (m.counters ?? {}) as Record<string, number>;
            const r = (m.result ?? {}) as { histogram?: Record<string, number>; ticksPerExpectedRoll?: number; ticksPerSuccess?: number };
            const f = (m.frames ?? {}) as { n?: number; overSevenSixthsT?: number; catchUps?: number };
            const gaps = Object.entries(r.histogram ?? {}).map(([g, n]) => [Number(g), n] as const);
            const all = gaps.reduce((a, [, n]) => a + n, 0);
            const lattice = gaps.filter(([g]) => g % 3 === 0).reduce((a, [, n]) => a + n, 0);
            console.log(
                `[${utc()}] T${row.startTick}-${row.endTick} segment run ${m.runId} ${m.technique} ended ${m.reason} at WC ${m.level}: ${row.endTick - row.startTick} t, ${c.successes ?? 0} logs, ` +
                    `${f2(r.ticksPerExpectedRoll)} t/expected roll, ${f2(r.ticksPerSuccess)} t/log, gaps on the 3-lattice ${lattice}/${all}; buried ${c.buried ?? 0} of ${c.burySent ?? 0} sent, ` +
                    `no-bone cycles ${c.noBoneCycles ?? 0}; late clicks ${c.lateClicks ?? 0}, phase resyncs ${c.phaseResyncs ?? 0}, slips ${c.slips ?? 0}, resyncs ${c.resyncs ?? 0}, respawn waits ${c.respawnWaits ?? 0}; ` +
                    `frames ${f.n ?? '-'}, over 7/6 T ${f.overSevenSixthsT ?? '-'} (on time ${f.n ? ((1 - (f.overSevenSixthsT ?? 0) / f.n) * 100).toFixed(1) : '-'}%), catch-ups ${f.catchUps ?? '-'}`
            );
        }
    }) as typeof log.append;
    const opts: WoodcuttingOptions = {
        to: flag('to', which === 'band' ? String(BANDS.find(b => b.tree === tree)!.end) : '99'),
        technique: flag('technique', 'auto') as 'auto' | 'knife' | 'plain',
        ...(flag('plain-per-roll') ? { plainTicksPerRoll: flag('plain-per-roll') } : {}),
        ...(flag('hold') ? { hold: flag('hold') } : {}),
        ...(has('bad-probe') ? { gate: { direct: { trials: 20, pass: 21, floor: 21 } } } : {}),
        ...(bury ? { bury: true, prayerTo: flag('prayer-to', '0') } : {}),
        ...(bury && helperName ? { bones: { giver: helper!.name, load } } : {}),
        ...(givers ? { bones: { group: givers.group, load, ...(final !== null ? { lastLoad: load - 2 } : {}), ...(flag('server-wait') ? { serverWait: Number(flag('server-wait')) } : {}) }, cueDir: givers.cueDir, ...(boneSession ? { boneSession } : {}) } : {}),
        route,
        ...(flag('hp-stop') ? { hpStop: flag('hp-stop') } : {}),
        ...(has('no-wait-respawn') ? { waitRespawn: false } : {}),
        ...(has('no-probe-dirs') ? { probeDirs: false } : {}),
        log: line => console.log(`  ${line}`)
    };
    const all = steps(opts);
    const session = { sdk, bot: actions, name: bot, sessionId: 0 };
    const run = async (chain: Step[]) => runSteps(session as never, chain, { log, c: {}, shouldStop: () => false });
    try {
        if (which === 'walk') {
            await run(all.filter(s => s.name === 'woodcutting:walk-oaks'));
            await setstat(sdk, 'woodcutting', 73);
            await sdk.waitForTicks(2);
            await run(all.filter(s => s.name === 'woodcutting:walk-willows'));
        } else await run(all);
    } finally {
        const end = sdk.getState();
        console.log(`measure-woodcutting ${which} end: Woodcutting ${wcLevel(end)}, Prayer ${end?.skills.find(k => k.name === 'Prayer')?.baseLevel}; min hitpoints ${minHp}; ${where()}`);
        console.log(formatReport(report(log.rows)));
        for (const r of log.rows.filter(r => /^woodcutting:(walk-oaks|walk-willows|normal-1-15|oak-15-73|willow-73-99)$/.test(r.step) && r.ticks > 0)) console.log(walkLine(r.step, r.startTick, r.endTick));
        for (const r of log.rows.filter(r => (r.meta as { kind?: string } | undefined)?.kind === 'wc-segment')) {
            const waits = ((r.meta as { result?: { respawnWaits?: number[] } }).result?.respawnWaits ?? []);
            if (waits.length) console.log(`respawn waits ${r.step} run ${(r.meta as { runId: number }).runId}: ${JSON.stringify(waits)}`);
        }
        const loadRows = log.rows.filter(r => r.step === 'woodcutting:bones-load');
        for (const r of loadRows) console.log(`bones-load ${JSON.stringify(r.meta)}`);
        if (givers) {
            const m = loadRows.map(r => r.meta as { giver: string | null; ticks: number; stepTicks: number; serverWait: number; received: number });
            const mean = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : '-');
            console.log(`group loads: ${loadRows.filter(r => r.ok).length} of ${loadRows.length} ok; givers in order ${m.map(x => x.giver ?? '-').join(' ')}`);
            console.log(`  click to bones (receiveFrom ticks) mean ${mean(m.map(x => x.ticks))}, all ${m.map(x => x.ticks).join(' ')}`);
            console.log(`  load step ticks (server wait + trade) mean ${mean(m.map(x => x.stepTicks))}, all ${m.map(x => x.stepTicks).join(' ')}; server waits ${m.map(x => x.serverWait).join(' ')}`);
            await givers.stop();
            for (const account of givers.group) {
                const path = join(givers.runDir, 'logs', `${account}.role.log`);
                const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
                for (const line of text.split('\n')) if (/"message":"(trade|request|phase|trip|resumed)"/.test(line)) console.log(`giver ${account} ${line.slice(line.indexOf('{'))}`);
            }
        }
        for (const r of log.rows.filter(r => (r.meta as { kind?: string } | undefined)?.kind === 'wc-band')) printBand(r.step, r.meta as Record<string, unknown>);
        console.log(`log: ${log.path}`);
        if (helper) await closeSession(helper);
    }
});
