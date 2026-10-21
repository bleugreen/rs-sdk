// Lab driver for speedrun/skills/fishing.ts in the bot's browser tab. It sets a band's start
// with staff fixtures and runs the module's own steps through runner/step.ts, so the tick log
// holds exactly the rows an attempt writes: each band's measure row, its gated segments and its
// summary (ticks per expected roll first). The tab must already be open (tickprog-lab.sh).
//
//   LAB_BLOCK=fishing NODE_TICKRATE=300 bash docs/speedrun/scripts/tickprog-lab.sh <bot> \
//     speedrun/lab/measure-fishing.ts:fly:--level=78:--technique=auto
//
// cases:
//   fly    ::setstat fishing --level (default 20), the fly kit, ::tele to the river, then the steps
//          to --to (default 99). From 78 the module first finishes fly-20-78 up to S22's 9,612
//          base, so fly-78-99 starts where the run's does.
//   chain  a fresh bot after the tutorial skip, at default stats: the fly kit by ::give, then every
//          step from level 1 (walks included) to --to. Hitpoint changes are logged, because
//          Draynor's dark wizards attack low-combat players.
// options: --stats=70|default (fly: 70 in hitpoints, attack, strength and defence, as the reference
//          runs had, so nothing near the river attacks; chain: default, as a fresh demo account),
//          --logs=5 (normal logs in the kit), --technique=auto|knife|plain (default auto), --feathers=800, --hold=0.15 (rs/156's
//          forced slip), --bad-probe (a gate rule no probe passes: the gate must run plain and
//          re-probe every 500 ticks), --log=<path>

import { hostname, loadavg } from 'os';
import { runScript } from '../../sdk/runner';
import { formatReport, report, TickLog } from '../lib/ticks';
import { runSteps } from '../runner/step';
import { fishingOf, RIVER, steps } from '../skills/fishing';
import { cheat, give, setstat, tele } from './setup';

const bot = process.argv[2];
const which = process.argv[3];
const flag = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const has = (name: string) => process.argv.includes(`--${name}`);
if (!bot || (which !== 'fly' && which !== 'chain')) {
    console.error('usage: bun speedrun/lab/measure-fishing.ts <bot> fly|chain [--level=20] [--to=99] [--technique=auto] [--feathers=800] [--hold=0.15] [--bad-probe] [--log=path]');
    process.exit(2);
}
const where = () => `host ${hostname()} load ${loadavg().map(l => l.toFixed(1)).join(' ')} at ${new Date().toISOString()}`;

await runScript(async ({ bot: actions, sdk }) => {
    await actions.skipTutorial().catch(() => {});
    await sdk.waitForTicks(2);
    while (sdk.getState()?.dialog.isOpen) {
        await sdk.sendClickDialog(0);
        await sdk.waitForTicks(1);
    }
    const kit = async () => {
        await give(sdk, ['fly_fishing_rod', 'knife', ...Array(Number(flag('logs', '5'))).fill('logs')]);
        await cheat(sdk, `give feather ${flag('feathers', '800')}`);
        await sdk.waitForTicks(2);
    };
    if (which === 'fly') {
        for (const item of [...(sdk.getState()?.inventory ?? [])]) await sdk.sendDropItem(item.slot);
        await sdk.waitForTicks(2);
        await setstat(sdk, 'fishing', Number(flag('level', '20')));
        if (flag('stats', '70') !== 'default') for (const stat of ['hitpoints', 'attack', 'strength', 'defence']) await setstat(sdk, stat, Number(flag('stats', '70')));
        await kit();
        if (!(await tele(sdk, RIVER.x, RIVER.z))) throw new Error('tele to the river failed');
    } else {
        await kit();
    }

    let hp = sdk.getState()?.player?.hp ?? 0;
    let minHp = hp;
    let deaths = sdk.getState()?.player?.respawnCount ?? 0;
    sdk.onStateUpdate(s => {
        const p = s.player;
        if (!p) return;
        if (p.hp < hp) {
            // who hit us: this tick's combat events on our player, by the source NPC's name
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

    const s0 = sdk.getState()!;
    console.log(`measure-fishing ${which}: Fishing ${fishingOf(s0).level} (${fishingOf(s0).xp} xp) at ${s0.player?.worldX},${s0.player?.worldZ}; ${where()}`);
    const log = TickLog.open(undefined, flag('log'));
    const hold = flag('hold');
    const all = steps({
        to: flag('to', '99'),
        technique: flag('technique', 'auto') as 'auto' | 'knife' | 'plain',
        ...(hold ? { params: { hold: Number(hold) } } : {}),
        ...(has('bad-probe') ? { gate: { direct: { trials: 20, pass: 21, floor: 21 } } } : {}),
        log: line => console.log(`  ${line}`)
    });
    const session = { sdk, bot: actions, name: bot, sessionId: 0 };
    try {
        await runSteps(session as never, all, { log, c: {}, shouldStop: () => false });
    } finally {
        const end = sdk.getState();
        console.log(`measure-fishing ${which} end: Fishing ${end ? fishingOf(end).level : '?'}; min hitpoints ${minHp}; ${where()}`);
        console.log(formatReport(report(log.rows)));
        for (const r of log.rows.filter(r => r.step.endsWith(':summary'))) {
            const { segments, histogram, ...band } = r.meta as Record<string, unknown>;
            console.log(`${r.step}: ${JSON.stringify(band)}`);
            console.log(`  histogram ${JSON.stringify(histogram)}`);
            for (const seg of segments as unknown[]) console.log(`  segment ${JSON.stringify(seg)}`);
        }
        console.log(`log: ${log.path}`);
    }
});
