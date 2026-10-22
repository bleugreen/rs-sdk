// Lab driver for speedrun/skills/mining.ts in the bot's browser tab: the module's own steps
// through runner/step.ts, so the tick log holds exactly the rows an attempt writes. The tab
// must already be open (tickprog-lab.sh); the iron respawn is the engine's, pinned in content.
//
//   LAB_BLOCK=mining NODE_TICKRATE=300 bash docs/speedrun/scripts/tickprog-lab.sh <fresh bot> \
//     speedrun/lab/measure-mining.ts:chain:--respawn=13
//
// cases:
//   chain  a fresh bot after the tutorial skip, at default stats (combat 3): the rehearsal kit by
//          ::give (steel, mithril, adamant and rune pickaxes beside the starter bronze, a knife,
//          --logs=4 normal logs, --coins=60), then every step from level 1 (prep, copper at
//          Rimmington, the two ships, the zoo, both iron bands) to --to. Every hitpoint change
//          is logged with who hit, and the logs the knife burns are counted.
//   drops  a fresh bot's starter kit: the free slots after the skip, then --n=10 starter items
//          dropped with all their packets sent in one tick, and per tick how many have gone (the
//          receiver's cost to make room for a kit before S01).
//   contest  the contested-rock fallback: the bot at SCORED's S09 combat (Prayer 94, Magic 59,
//          Hitpoints 10: combat 43) mines the module's iron-63 band from Mining --level=95 at the
//          zoo with --fallback=auto; after --baseline=90 ores the HELPER account (tickprog-lab.sh
//          HELPER=<bot>, combat 3) mines the lap's first rock whenever it is live, from beside it,
//          and drops each ore it takes, so a full inventory never ends the contest.
//          Every xp tick of both, the band's contest events and switch, hitpoint changes and the
//          nearest bear are logged; then the helper stands on an ardougneNorth stand for
//          --bear-ticks=400 (are the bears there aggressive to combat 3?). The helper is tick-perfect
//          (it primes its clock on a spare rock and lands its click on the respawn tick), so at
//          D=15, where it ties the lap, the server's player order decides who rolls first.
//          --attach=1 attaches to a helper that is already in the world instead of launching it:
//          with GIVERS=<helper> tickprog-lab.sh logs it in as a lite runner before the tab, so the
//          server handles it before the main and it wins a same-tick race.
//     GIVERS=cairnch15 LAB_BLOCK=mining NODE_TICKRATE=300 bash docs/speedrun/scripts/tickprog-lab.sh \
//       cairnct15 speedrun/lab/measure-mining.ts:contest:--respawn=15:--attach=1:--helper=cairnch15
// options: --technique=auto|knife|plain (default auto), --respawn=13 (the pinned D), --to=99,
//          --log=<path>

import { hostname, loadavg } from 'os';
import { runScript } from '../../sdk/runner';
import type { BotWorldState } from '../../sdk/types';
import { formatReport, report, TickLog } from '../lib/ticks';
import { closeSession, openSession } from '../lib/session';
import { runSteps } from '../runner/step';
import { EMPTY_ROCKS, lapFor, miningLevel, parseSteps, SITES, STARTER_JUNK, steps } from '../skills/mining';
import { cheat, clearInventory, give, leaveTutorial, mustTele, setStats, tele } from './setup';

const bot = process.argv[2];
const which = process.argv[3];
const flag = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
if (!bot || !['chain', 'drops', 'contest'].includes(which ?? '')) {
    console.error('usage: bun speedrun/lab/measure-mining.ts <bot> chain|drops|contest [--respawn=13] [--to=99] [--technique=auto] [--logs=4] [--n=10] [--level=95] [--baseline=90] [--fallback=auto] [--bear-ticks=400] [--attach=1]');
    process.exit(2);
}
const where = () => `host ${hostname()} load ${loadavg().map(l => l.toFixed(1)).join(' ')} at ${new Date().toISOString()}`;
const logsIn = (s: BotWorldState | null) => (s?.inventory ?? []).filter(i => /^logs$/i.test(i.name)).reduce((n, i) => n + i.count, 0);

await runScript(async ({ bot: actions, sdk }) => {
    // contest stages its accounts with staff commands, so they leave the island through S00 (LAB.md)
    if (which === 'contest') await leaveTutorial({ sdk, bot: actions, name: bot, sessionId: 0 } as never);
    else await actions.skipTutorial().catch(() => {});
    await sdk.waitForTicks(2);
    while (sdk.getState()?.dialog.isOpen) {
        await sdk.sendClickDialog(0);
        await sdk.waitForTicks(1);
    }
    const s0 = sdk.getState()!;
    console.log(`measure-mining ${which}: ${s0.inventory.length} items after the skip (${28 - s0.inventory.length} free): ${s0.inventory.map(i => `${i.name}${i.count > 1 ? ` x${i.count}` : ''}`).join(', ')}; ${where()}`);

    if (which === 'drops') {
        const n = Number(flag('n', '10'));
        const junk = s0.inventory.filter(i => STARTER_JUNK.some(re => re.test(i.name))).slice(0, n);
        await sdk.waitForTicks(1);
        const t0 = sdk.getState()!.tick;
        const before = sdk.getState()!.inventory.length;
        await Promise.all(junk.map(i => sdk.sendDropItem(i.slot)));
        const perTick: number[] = [];
        let last = before;
        for (let k = 0; k < 12; k++) {
            await sdk.waitForTicks(1);
            const len = sdk.getState()!.inventory.length;
            perTick.push(last - len);
            last = len;
            if (before - len >= junk.length) break;
        }
        console.log(`drops: ${junk.length} sent on T${t0}; gone per tick after it: ${perTick.join(' ')}; ${before - last} gone in ${sdk.getState()!.tick - t0} ticks (the state shows a tick's drops one tick after they land)`);
        return;
    }

    if (which === 'contest') {
        await contest(sdk, actions, bot);
        return;
    }

    await give(sdk, ['steel_pickaxe', 'mithril_pickaxe', 'adamant_pickaxe', 'rune_pickaxe', 'knife', ...Array(Number(flag('logs', '4'))).fill('logs')]);
    await cheat(sdk, `give coins ${flag('coins', '60')}`);
    await sdk.waitForTicks(3);

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
                    const m = s.nearbyNpcs.find(x => x.index === e.sourceIndex);
                    return m ? `${m.name} (combat ${m.combatLevel}) at ${m.x},${m.z}` : `source #${e.sourceIndex}`;
                });
            console.log(`  T${s.tick} hitpoints ${hp} -> ${p.hp} at ${p.worldX},${p.worldZ}; by ${by.join(', ') || 'unknown'}`);
        }
        hp = p.hp;
        minHp = Math.min(minHp, p.hp);
        if (p.respawnCount > deaths) console.log(`  T${s.tick} DIED (respawn ${p.respawnCount})`);
        deaths = p.respawnCount;
    });
    // each logs change, for the kit's log count
    let logs = logsIn(sdk.getState());
    const logs0 = logs;
    sdk.onStateUpdate(s => {
        const l = logsIn(s);
        if (l !== logs) console.log(`  T${s.tick} logs ${logs} -> ${l} (Mining ${miningLevel(s)})`);
        logs = l;
    });

    const log = TickLog.open(undefined, flag('log'));
    const all = steps({ to: flag('to', '99'), respawn: flag('respawn', '13'), technique: flag('technique', 'auto') as 'auto' | 'knife' | 'plain' });
    const session = { sdk, bot: actions, name: bot, sessionId: 0 };
    const t0 = sdk.getState()!.tick;
    try {
        await runSteps(session as never, all, { log, c: {}, shouldStop: () => false });
    } finally {
        const end = sdk.getState();
        console.log(`measure-mining chain end: Mining ${miningLevel(end)} in ${(end?.tick ?? t0) - t0} ticks from the kit; min hitpoints ${minHp}; logs ${logs0} -> ${logsIn(end)}; ${where()}`);
        console.log(formatReport(report(log.rows)));
        for (const r of log.rows.filter(r => r.step.startsWith('(band)') || r.step.startsWith('(segment)'))) console.log(`${r.step} T${r.startTick}-${r.endTick} (${r.ticks}): ${JSON.stringify(r.meta)}`);
        console.log(`log: ${log.path}`);
    }
});
// runScript reports a script error and disconnects but does not exit, and a helper's lite-session
// machinery can hold the event loop open: without this a failed contest run idles until its batch bound.
process.exit(process.exitCode ?? 0);

type Sdk = Parameters<typeof give>[0] & { onStateUpdate(l: (s: BotWorldState) => void): () => void; getState(): BotWorldState | null };
// Declarations, not consts: the top-level `await runScript` above runs contest before any const below it is initialised.
function xpOf(s: BotWorldState): number {
    return s.skills.find(k => k.name.toLowerCase() === 'mining')?.experience ?? 0;
}
function chebTo(s: BotWorldState, p: [number, number]): number {
    return Math.max(Math.abs((s.player?.worldX ?? 0) - p[0]), Math.abs((s.player?.worldZ ?? 0) - p[1]));
}

/** Hitpoint drops (who hit) and the nearest bear, from `sdk`'s states, tagged `who`. */
function watchHarm(sdk: Sdk, who: string) {
    let hp = sdk.getState()?.player?.hp ?? 0;
    const out = { drops: 0, minHp: hp, nearestBear: Infinity, bearTicks: 0 };
    const unsub = sdk.onStateUpdate(s => {
        const p = s.player;
        if (!p) return;
        if (p.hp < hp) {
            out.drops++;
            const by = (s.combatEvents ?? []).filter(e => e.tick >= s.tick - 1 && e.targetType === 'player').map(e => s.nearbyNpcs.find(x => x.index === e.sourceIndex)?.name ?? `#${e.sourceIndex}`);
            console.log(`  ${who} T${s.tick} hitpoints ${hp} -> ${p.hp} at ${p.worldX},${p.worldZ}; by ${by.join(', ') || 'unknown'}`);
        }
        hp = p.hp;
        out.minHp = Math.min(out.minHp, p.hp);
        for (const n of s.nearbyNpcs.filter(n => /^bear$/i.test(n.name))) {
            const d = Math.max(Math.abs(n.x - p.worldX), Math.abs(n.z - p.worldZ));
            out.nearestBear = Math.min(out.nearestBear, d);
            if (d <= 2) out.bearTicks++;
        }
    });
    return { out, stop: unsub };
}

async function contest(sdk: Sdk & Parameters<typeof runSteps>[0]['sdk'], actions: unknown, bot: string): Promise<void> {
    const HELPER = flag('helper') ?? process.env.HELPER;
    if (!HELPER) throw new Error('contest needs a second account: HELPER=<bot> in tickprog-lab.sh');
    const D = Number(flag('respawn', '13'));
    const level = Number(flag('level', '95'));
    const baseline = Number(flag('baseline', '90'));
    const zooLap = parseSteps(SITES.zoo!.rotations[lapFor('zoo', D)]!.steps);
    const target = zooLap[0]!.rock; // the contender's rock

    // SCORED at S09: combat 43 (mining.test.ts)
    await setStats(sdk, { mining: level, prayer: 94, magic: 59, hitpoints: 10 });
    await clearInventory(sdk as never);
    await give(sdk, ['rune_pickaxe', 'knife', 'logs', 'logs']);
    await mustTele(sdk, zooLap[0]!.stand[0], zooLap[0]!.stand[1]);

    const attach = flag('attach') === '1';
    const helper = await openSession(HELPER, { launch: !attach, pathfinding: false });
    // a throw past here must still log the helper out: its lite runner would hold the process open
    try {
        await leaveTutorial(helper);
        await setStats(helper.sdk as never, { mining: 70 });
        await clearInventory(helper.sdk as never);
        await give(helper.sdk as never, ['rune_pickaxe']);
        // The stand: orthogonally beside the target and beside a spare live iron rock off the lap, which
        // primes the contender's clock (below). Rock tiles come from the helper's scene at the zoo.
        const lapRocks = new Set(zooLap.map(st => `${st.rock}`));
        const isMine = (l: BotWorldState['nearbyLocs'][number]) => l.optionsWithIndex.some(o => /^mine$/i.test(o.text));
        const liveAt = (st: BotWorldState, p: readonly [number, number]) => st.nearbyLocs.find(l => l.x === p[0] && l.z === p[1] && !EMPTY_ROCKS.has(l.id) && isMine(l));
        const ORTHO = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
        await mustTele(helper.sdk as never, zooLap[0]!.stand[0], zooLap[0]!.stand[1]);
        const scene = helper.sdk.getState()!;
        const rockTiles = new Set(scene.nearbyLocs.filter(isMine).map(l => `${l.x},${l.z}`));
        const stands: Array<{ stand: [number, number]; spare?: [number, number] }> = [];
        for (const [dx, dz] of ORTHO) {
            const stand: [number, number] = [target[0] + dx, target[1] + dz];
            if (rockTiles.has(`${stand}`)) continue;
            const spare = ORTHO.map(([ex, ez]) => [stand[0] + ex, stand[1] + ez] as [number, number]).find(r => `${r}` !== `${target}` && !lapRocks.has(`${r}`) && liveAt(scene, r));
            stands.push({ stand, ...(spare ? { spare } : {}) });
        }
        stands.sort((x, y) => Number(!!y.spare) - Number(!!x.spare));
        let helperStand: [number, number] | undefined;
        let spare: [number, number] | undefined;
        for (const c of stands) {
            if (await tele(helper.sdk as never, c.stand[0], c.stand[1])) {
                helperStand = c.stand;
                spare = c.spare;
                break;
            }
        }
        if (!helperStand) throw new Error(`the helper could not stand beside ${target}`);
        if (!spare) console.log(`  WARNING: no spare iron rock beside ${helperStand}: the contender clicks plain and cannot beat the lap`);
        const targetLoc = liveAt(helper.sdk.getState()!, target) ?? liveAt(scene, target);
        if (!targetLoc) throw new Error(`no live rock seen at ${target}`);
        const targetOp = targetLoc.optionsWithIndex.find(o => /^mine$/i.test(o.text))!.opIndex;
        console.log(`contest: D=${D}, Mining ${level}, combat-43 main; ${HELPER} (combat 3, ${attach ? 'attached, logged in before the main' : 'launched after the main'}) at ${helperStand} contends for the zoo lap's ${target}${spare ? ` (primer ${spare})` : ''} after ${baseline} ores; ${where()}`);

        // every xp tick of the main, and where
        const mainOres: Array<{ tick: number; site: string }> = [];
        let lastXp = xpOf(sdk.getState()!);
        sdk.onStateUpdate(s => {
            const xp = xpOf(s);
            if (xp > lastXp) mainOres.push({ tick: s.tick, site: Object.keys(SITES).find(n => chebTo(s, SITES[n]!.centre) <= 10) ?? 'away' });
            lastXp = xp;
        });
        const harm = watchHarm(sdk, bot);
        // For --trace=N ticks after the main first stands at another site: each xp tick and each
        // live/dead change on that site's rocks, with loc ids (the evidence ContestWatch pairs).
        const traceTicks = Number(flag('trace', '80'));
        let traceFrom = -1;
        let traceXp = xpOf(sdk.getState()!);
        const traceLive = new Map<string, string>();
        sdk.onStateUpdate(s => {
            const at = Object.keys(SITES).find(n => n !== 'zoo' && chebTo(s, SITES[n]!.centre) <= 10);
            if (traceFrom < 0 && at) traceFrom = s.tick;
            const xp = xpOf(s);
            if (traceFrom >= 0 && s.tick - traceFrom <= traceTicks && at) {
                const out: string[] = [];
                if (xp > traceXp) out.push(`xp +${xp - traceXp}`);
                const rocks = [...new Map(Object.values(SITES[at]!.rotations).flatMap(r => parseSteps(r.steps)).map(st => [`${st.rock}`, st.rock])).values()];
                for (const r of rocks) {
                    const l = s.nearbyLocs.find(x => x.x === r[0] && x.z === r[1] && x.optionsWithIndex.some(o => /^mine$/i.test(o.text)));
                    const v = l ? `${EMPTY_ROCKS.has(l.id) ? 'dead' : 'live'}#${l.id}` : 'unseen';
                    if (traceLive.get(`${r}`) !== v) out.push(`${r} ${traceLive.get(`${r}`) ?? '-'}->${v}`);
                    traceLive.set(`${r}`, v);
                }
                const p = s.player;
                if (out.length) console.log(`  trace T${s.tick} at ${p?.worldX},${p?.worldZ}: ${out.join('; ')}`);
            }
            traceXp = xp;
        });

        // The contender, tick-perfect as a scripted rival is. It knows the target's respawn from the
        // depletion it saw on label R (a click landing from R + D is accepted). A first swing on a live
        // rock with an expired clock sets the clock 2 ticks on without rolling, and a click on a due
        // clock rolls as it lands (mining.rs2; the trick in knife-mine.ts's header). So it clicks the
        // spare rock to land on R + D - 2 and the target to land on R + D: it rolls on the respawn tick,
        // 2 ticks before the knife lap's R + 15 at D=13 and level with it at D=15. A packet sent on
        // label L lands on L + 1. Its ores are stamped with the main's tick, the clock the band uses.
        const takes: number[] = [];
        let hXp = xpOf(helper.sdk.getState()!);
        let contending = false;
        let startedAt = -1;
        let deadAt = -1;
        let wasLive = true;
        let clicks = 0;
        const unsubH = helper.sdk.onStateUpdate(s => {
            const main = sdk.getState();
            const mt = main?.tick ?? -1;
            const xp = xpOf(s);
            if (xp > hXp) {
                takes.push(mt);
                // a full inventory would end the contest after 27 ores (a sustained rival banks or drops)
                const ore = s.inventory.find(i => /^iron ore$/i.test(i.name));
                if (ore) void helper.sdk.sendDropItem(ore.slot);
            }
            hXp = xp;
            if (!contending && mainOres.filter(o => o.site === 'zoo').length >= baseline) {
                contending = true;
                startedAt = mt;
                console.log(`  contender starts T${mt}`);
            }
            const live = !!liveAt(s, target);
            if (wasLive && !live) deadAt = s.tick;
            wasLive = live;
            if (!contending || !main || chebTo(main, SITES.zoo!.centre) > 10 || deadAt < 0) return;
            if (spare && s.tick === deadAt + D - 3) {
                const l = liveAt(s, spare);
                if (l) void helper.sdk.sendInteractLoc(spare[0], spare[1], l.id, l.optionsWithIndex.find(o => /^mine$/i.test(o.text))!.opIndex);
            }
            if (s.tick === deadAt + D - (spare ? 1 : 2)) {
                clicks++;
                void helper.sdk.sendInteractLoc(target[0], target[1], targetLoc.id, targetOp);
            }
        });

        const log = TickLog.open(undefined, flag('log'));
        const band = steps({ to: flag('to', '99'), respawn: D, technique: (flag('technique', 'knife') as 'knife'), travel: 'none', fallback: flag('fallback', 'auto') }).filter(s => s.name === 'mining.iron-63');
        const t0 = sdk.getState()!.tick;
        let err: unknown = null;
        try {
            await runSteps({ sdk, bot: actions, name: bot, sessionId: 0 } as never, band, { log, c: {}, shouldStop: () => false });
        } catch (e) {
            err = e;
            console.log(`band failed: ${(e as Error).message}`);
        }
        unsubH();
        harm.stop();

        const row = log.rows.find(r => r.step === '(band) mining.iron-63');
        const meta = (row?.meta ?? {}) as Record<string, any>;
        const sw = meta.contest?.switches?.[0];
        const rate = (o: Array<{ tick: number }>) => (o.length > 6 ? Math.round(((o[o.length - 1]!.tick - o[5]!.tick) / (o.length - 6)) * 1000) / 1000 : null);
        const zoo = mainOres.filter(o => o.site === 'zoo');
        const zooBefore = zoo.filter(o => startedAt < 0 || o.tick < startedAt);
        const alt = mainOres.filter(o => sw && o.site === sw.to);
        const firstTake = takes.find(t => t >= startedAt);
        const summary = {
            D, level, end: miningLevel(sdk.getState()), ticks: sdk.getState()!.tick - t0, failed: err ? String((err as Error).message) : null,
            zoo: { ores: zoo.length, uncontested: zooBefore.length, ticksPerOre: rate(zooBefore), contestedOres: zoo.length - zooBefore.length },
            contender: { startedAt, clicks, takes: takes.filter(t => t >= startedAt).length, firstTake, takeTicks: takes.filter(t => t >= startedAt).slice(0, 12) },
            events: meta.contest?.events, retries: meta.contest?.retries, own: meta.contest?.own,
            detection: sw && firstTake !== undefined ? { firstTakeToLeave: sw.tick - firstTake, firstTakeToThirdEvent: (meta.contest.events[2]?.tick ?? NaN) - firstTake } : null,
            switch: sw ?? null,
            alternate: sw ? { site: sw.to, firstOreAfterDecision: alt.length ? alt[0]!.tick - sw.tick : null, ores: alt.length, ticksPerOre: rate(alt), span: alt.length ? alt[alt.length - 1]!.tick - alt[0]!.tick : 0 } : null,
            main: { combat: 43, ...harm.out },
            segments: meta.segments, restarts: meta.restarts, observedRespawn: meta.observedRespawn,
        };
        console.log(`contest summary: ${JSON.stringify(summary)}`);
        for (const r of log.rows.filter(r => r.step.startsWith('(segment)'))) console.log(`${r.step} T${r.startTick}-${r.endTick}: ${JSON.stringify({ ...r.meta, logTail: undefined, frames: undefined })}`);

        // a combat-3 account on an ardougneNorth stand: do the bears come for it?
        const bearTicks = Number(flag('bear-ticks', '400'));
        if (bearTicks > 0) {
            const stand = parseSteps(SITES.ardougneNorth!.rotations.five!.steps)[1]!.stand;
            await mustTele(helper.sdk as never, stand[0], stand[1]);
            const h = watchHarm(helper.sdk as never, HELPER);
            await helper.sdk.waitForTicks(bearTicks);
            h.stop();
            console.log(`bears at ardougneNorth for combat 3 (${HELPER} on ${stand}, ${bearTicks} ticks): ${JSON.stringify(h.out)}`);
        }
        console.log(`log: ${log.path}`);
    } finally {
        await closeSession(helper).catch(() => {});
    }
}
