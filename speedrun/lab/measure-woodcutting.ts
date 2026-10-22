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
//   walk    a default-stats bot from Lumbridge: walk-oaks (the approach waypoints), then at
//           level 73 walk-willows; ticks per leg and every hitpoint change
//   band    ::setstat woodcutting --level, the kit, ::tele to the band's stand, then the steps to
//           --to (default: the band's end)
//   chain   default stats at Lumbridge, the kit by ::give, every step from level 1 to --to
// options: --technique=auto|knife|plain, --plain-per-roll=4, --hold=0.15 (rs/156's forced slip),
//          --bad-probe (a gate rule no probe passes: plain, re-probed every 500 ticks),
//          --bury [--prayer=43] [--bones=N] [--helper=<bot> --load=23] (a second lab bot gives
//          loads by trade, asking while the account holds 2 or fewer, as Ashburn's helpers will;
//          without --helper the account starts with --bones and buries until they run out),
//          --prayer-to=0, --logs=5 (normal logs in the kit, as cairn_mule2 stages it), --log=<path>,
//          --starter (keep the tutorial's starter items, as a demo account carries them; walk and
//          chain), --lighten (the module drops them before the oak walk), --potions=N (N energy
//          potions, 4 doses, drunk while walking whenever run energy is at or under --drink-at=60%),
//          --no-wait-respawn / --no-probe-dirs (the module's two fixes off, for an A/B)
// --route=rimmington runs every case on the closer stands (ROUTES below: Rimmington oaks and the
// Draynor-west willows, rs/236's survey), passed to the module as `sites` data.
// Every walk step gets a telemetry line: tiles per tick (run 2, walk 1, still 0), run energy and
// weight at its start and end. `walk` refills run energy to 100% first (super energy, off the clock).

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { hostname, loadavg } from 'os';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import type { BotWorldState } from '../../sdk/types';
import { closeSession, openSession, type Session } from '../lib/session';
import { formatReport, report, TickLog } from '../lib/ticks';
import { give as giveTrade } from '../lib/trade';
import { runSteps, type Step } from '../runner/step';
import { BANDS, SITES, steps, type SubBandRow, type TechniqueFigures, type Tree, wcLevel, type WoodcuttingOptions } from '../skills/woodcutting';
import { give, setstat, tele } from './setup';

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
/** Alternative stands, as the module's `sites` data (rs/236: tree tiles from the map, unverified until surveyed). */
const ROUTES: Record<string, Partial<typeof SITES>> = {
    rimmington: {
        normal: { stand: [2984, 3205] },
        oak: { stand: [2984, 3205], trees: [[2981, 3205], [2984, 3206], [2985, 3203]] },
        willow: { stand: [3058, 3253], trees: [[3057, 3251], [3057, 3254], [3059, 3252]] },
        approach: []
    }
};
const route = flag('route');
if (route && !ROUTES[route]) throw new Error(`unknown --route ${route} (${Object.keys(ROUTES).join(', ')})`);
const sites: typeof SITES = { ...SITES, ...(route ? ROUTES[route] : {}) };
const where = () => `host ${hostname()} load ${loadavg().map(l => l.toFixed(1)).join(' ')} at ${new Date().toISOString()}`;
const LUMBRIDGE = [3222, 3222] as const;
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

await runScript(async ({ bot: actions, sdk }) => {
    await actions.skipTutorial().catch(() => {});
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
        await give(sdk, ['rune_axe', 'knife', ...Array(Number(flag('logs', '5'))).fill('logs')]);
        await sdk.waitForTicks(2);
    };
    const POTION = /^(super )?energy potion\(\d\)$/i;
    const drink = async (re: RegExp) => {
        const p = sdk.getState()?.inventory.find(i => re.test(i.name));
        const op = p?.optionsWithIndex.find(o => /^drink$/i.test(o.text));
        if (!p || !op) return false;
        await sdk.sendUseItem(p.slot, op.opIndex);
        return true;
    };
    /** Run energy back to 100% between measurements: super energies, drunk off the clock, then the vials dropped. */
    const refill = async () => {
        if ((sdk.getState()?.player?.runEnergy ?? 100) >= 100) return;
        await give(sdk, ['4dose2energy', '4dose2energy']);
        for (let i = 0; i < 12 && (sdk.getState()?.player?.runEnergy ?? 100) < 100; i++) {
            if (!(await drink(/^super energy\(\d\)$/i))) break;
            await sdk.waitForTicks(3);
        }
        for (const it of [...(sdk.getState()?.inventory ?? [])].filter(i => /^(super energy\(\d\)|vial)$/i.test(i.name))) await sdk.sendDropItem(it.slot);
        await sdk.waitForTicks(2);
        console.log(`  refilled: run energy ${sdk.getState()?.player?.runEnergy}%`);
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

    if (which === 'band') {
        await clear();
        await setstat(sdk, 'woodcutting', level);
        if (flag('prayer')) await setstat(sdk, 'prayer', Number(flag('prayer')));
        await kit();
        const bones = Number(flag('bones', bury && !helperName ? String(load) : '0'));
        if (bones) await give(sdk, Array(bones).fill('dragon_bones'));
        const stand = sites[tree].stand;
        if (!(await tele(sdk, stand[0], stand[1]))) throw new Error(`tele to ${stand.join(',')} failed`);
    } else {
        // walk and chain: a fresh account's stats, from Lumbridge, carrying the kit (and with
        // --starter the tutorial's items, as on the demo)
        await clear();
        if (has('starter')) {
            // tutorial.rs2 tutorial_complete's inv_add list, so a later case in the same tab carries the same
            await give(sdk, ['bronze_axe', 'tinderbox', 'net', 'shrimp', 'bucket_empty', 'pot_empty', 'bread', 'bronze_pickaxe', 'bronze_dagger', 'bronze_sword', 'wooden_shield', 'shortbow']);
            for (const [name, n] of [['bronze_arrow', 25], ['airrune', 25], ['mindrune', 15], ['waterrune', 6], ['earthrune', 4], ['bodyrune', 2]] as const) await give(sdk, name, n);
        }
        await kit();
        if (flag('potions')) await give(sdk, Array(Number(flag('potions'))).fill('4dose1energy'));
        if (!(await tele(sdk, LUMBRIDGE[0], LUMBRIDGE[1]))) throw new Error('tele to Lumbridge failed');
        if (which === 'walk') await refill();
    }
    await sdk.waitForTicks(2);

    // Walk telemetry: the last state seen on each tick, and the potions drunk.
    const samples = new Map<number, { x: number; z: number; e: number; w: number }>();
    const drinkAt = Number(flag('drink-at', '60'));
    let drinks = 0;
    let lastDrink = -10;
    let drinking = false;
    sdk.onStateUpdate(s => {
        const p = s.player;
        if (!p) return;
        samples.set(s.tick, { x: p.worldX, z: p.worldZ, e: p.runEnergy, w: p.runWeight });
        const prev = samples.get(s.tick - 1);
        const moving = !!prev && (prev.x !== p.worldX || prev.z !== p.worldZ);
        if (flag('potions') && moving && p.runEnergy <= drinkAt && s.tick - lastDrink >= 3 && !drinking) {
            drinking = true;
            lastDrink = s.tick;
            drink(POTION)
                .then(ok => {
                    if (ok) console.log(`  T${s.tick} drink ${++drinks} at ${p.runEnergy}%`);
                })
                .finally(() => (drinking = false));
        }
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
        return `walk ${step}: ${to - from} ticks, ${tiles} tiles; run ${n.run}, walk ${n.walk}, still ${n.still} (before the first step ${lead}, after the last ${tail}), unseen ${n.gaps}; energy ${s0?.e}% -> ${s1?.e}%, weight ${s0?.w} -> ${s1?.w} kg`;
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

    const s0 = sdk.getState()!;
    console.log(`measure-woodcutting ${which}: Woodcutting ${wcLevel(s0)} at ${s0.player?.worldX},${s0.player?.worldZ}; ${where()}`);
    const log = TickLog.open(undefined, flag('log'));
    const opts: WoodcuttingOptions = {
        to: flag('to', which === 'band' ? String(BANDS.find(b => b.tree === tree)!.end) : '99'),
        technique: flag('technique', 'auto') as 'auto' | 'knife' | 'plain',
        ...(flag('plain-per-roll') ? { plainTicksPerRoll: flag('plain-per-roll') } : {}),
        ...(flag('hold') ? { hold: flag('hold') } : {}),
        ...(has('bad-probe') ? { gate: { direct: { trials: 20, pass: 21, floor: 21 } } } : {}),
        ...(bury ? { bury: true, prayerTo: flag('prayer-to', '0') } : {}),
        ...(bury && helperName ? { bones: { giver: helper!.name, load } } : {}),
        ...(has('lighten') ? { lighten: true } : {}),
        ...(route ? { sites: ROUTES[route] } : {}),
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
            if (has('refill-between')) await refill();
            await run(all.filter(s => s.name === 'woodcutting:walk-willows'));
        } else await run(all);
    } finally {
        const end = sdk.getState();
        console.log(`measure-woodcutting ${which} end: Woodcutting ${wcLevel(end)}, Prayer ${end?.skills.find(k => k.name === 'Prayer')?.baseLevel}; min hitpoints ${minHp}; ${where()}`);
        console.log(formatReport(report(log.rows)));
        for (const r of log.rows.filter(r => r.step.startsWith('woodcutting:walk-') && r.ticks > 0)) console.log(walkLine(r.step, r.startTick, r.endTick));
        if (flag('potions')) console.log(`potions: ${drinks} doses drunk`);
        for (const r of log.rows.filter(r => (r.meta as { kind?: string } | undefined)?.kind === 'wc-segment')) {
            const waits = ((r.meta as { result?: { respawnWaits?: number[] } }).result?.respawnWaits ?? []);
            if (waits.length) console.log(`respawn waits ${r.step} run ${(r.meta as { runId: number }).runId}: ${JSON.stringify(waits)}`);
        }
        for (const r of log.rows.filter(r => r.step === 'woodcutting:bones-load')) console.log(`bones-load ${JSON.stringify(r.meta)}`);
        for (const r of log.rows.filter(r => (r.meta as { kind?: string } | undefined)?.kind === 'wc-band')) printBand(r.step, r.meta as Record<string, unknown>);
        console.log(`log: ${log.path}`);
        if (helper) await closeSession(helper);
    }
});
