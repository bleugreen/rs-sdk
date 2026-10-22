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
// options: --technique=auto|knife|plain (default auto), --respawn=13 (the pinned D), --to=99,
//          --log=<path>

import { hostname, loadavg } from 'os';
import { runScript } from '../../sdk/runner';
import type { BotWorldState } from '../../sdk/types';
import { formatReport, report, TickLog } from '../lib/ticks';
import { runSteps } from '../runner/step';
import { miningLevel, STARTER_JUNK, steps } from '../skills/mining';
import { cheat, give } from './setup';

const bot = process.argv[2];
const which = process.argv[3];
const flag = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
if (!bot || (which !== 'chain' && which !== 'drops')) {
    console.error('usage: bun speedrun/lab/measure-mining.ts <bot> chain|drops [--respawn=13] [--to=99] [--technique=auto] [--logs=4] [--n=10]');
    process.exit(2);
}
const where = () => `host ${hostname()} load ${loadavg().map(l => l.toFixed(1)).join(' ')} at ${new Date().toISOString()}`;
const logsIn = (s: BotWorldState | null) => (s?.inventory ?? []).filter(i => /^logs$/i.test(i.name)).reduce((n, i) => n + i.count, 0);

await runScript(async ({ bot: actions, sdk }) => {
    await actions.skipTutorial().catch(() => {});
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
