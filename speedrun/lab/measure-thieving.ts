// Lab passes for speedrun/skills/thieving.ts in the browser tab (in-page pickpocket).
//
//   LAB_BLOCK=thieving NODE_TICKRATE=300 bash docs/speedrun/scripts/tickprog-lab.sh <bot> \
//       speedrun/lab/measure-thieving.ts:setup speedrun/lab/measure-thieving.ts:fresh:--from=thieving:men ...
//
// tickprog-lab.sh runs a `.ts` spec as `bun <spec> <bot> <args>` with SPEEDRUN_CDP_URL pointing
// at its tab, and the session opens with insecureQueryLogin, so `login` can re-navigate the tab. Modes:
//   setup    finish the tutorial by cheat (a fresh lab bot has no side tabs and the server
//            refuses its inventory ops); run the lab again in the same checkout to log in
//            with the tabs set
//   fresh    the rehearsal account at the tutorial exit: Lumbridge (3222,3222), 10 HP, the
//            tutorial's 18 items, the kit (38 noted cakes, 100 coins), Thieving 1, full energy
//   at       --thieving=N --hp=N --x= --z= [--cakes=N]: stage a band start by cheat
//            [--only=to-ardougne,provision] runs just those steps of steps() (names after
//            `thieving:`); [--kit-food=shark --kit-n=70] changes the noted food in the kit
//   steps    run steps() [--from=<step>] [--to=99] [--food=cake]
//   leg      only thieving:to-ardougne, from wherever the account stands
// Staging is outside the measured steps. Every step row and every pickpocket end status is
// printed as a RESULT line; the end statuses carry the gap histograms, skippedTicks, frames,
// publish, react and loops.

import { hostname, loadavg } from 'os';
import type { ProgramStatus } from '../lib/programs';
import { programStatus } from '../lib/programs';
import { closeSession, openSession } from '../lib/session';
import { formatReport, report, TickLog } from '../lib/ticks';
import { waitTicks, waitUntil } from '../lib/wait';
import { runSteps } from '../runner/step';
import { type FoodName, steps } from '../skills/thieving';
import { arg, result } from './common';
import { cheat, near, tele } from './setup';

const bot = process.argv[2];
const mode = process.argv[3];
if (!bot || !mode) throw new Error('usage: measure-thieving.ts <bot> setup|fresh|at|steps|leg [--k=v ...]');
const where = () => ({ host: hostname(), load: loadavg().map(l => +l.toFixed(1)), at: new Date().toISOString(), tickrate: process.env.NODE_TICKRATE ?? '' });

const session = await openSession(bot, { client: 'browser', insecureQueryLogin: true });
const { sdk } = session;
const say = async (cmd: string) => {
    await cheat(sdk, cmd);
    await waitTicks(sdk, 1);
};

const STARTER = ['bronze_axe', 'tinderbox', 'net', 'shrimp', 'bucket_empty', 'pot_empty', 'bread', 'bronze_pickaxe', 'bronze_dagger', 'bronze_sword', 'wooden_shield', 'shortbow'];
const STARTER_STACKS: Array<[string, number]> = [['bronze_arrow', 25], ['airrune', 25], ['mindrune', 15], ['waterrune', 6], ['earthrune', 4], ['bodyrune', 2]];

async function clearInventory() {
    await say('~clearinv inv');
    await waitUntil(sdk, s => s.inventory.length === 0, { maxTicks: 5 });
}

async function giveAll(items: Array<[string, number]>) {
    const before = sdk.getState()!.inventory.length;
    for (const [name, n] of items) await cheat(sdk, `give ${name} ${n}`);
    await waitUntil(sdk, s => s.inventory.length >= before + items.length, { maxTicks: items.length + 10 });
    await waitTicks(sdk, 1);
}

const followPrograms = () => {
    const seen = new Set<number>();
    return sdk.onStateUpdate(s => {
        const st = programStatus(s) as ProgramStatus | null;
        if (!st || st.phase === 'running' || seen.has(st.runId)) return;
        seen.add(st.runId);
        result(`program ${st.name}#${st.runId} ${st.phase}`, {
            startedTick: st.startedTick, endedTick: st.endedTick, counters: st.counters, gauges: st.gauges, result: st.result, fault: st.fault,
            packets: st.packets, deferred: st.deferred, skippedTicks: st.skippedTicks, maxTickMs: st.maxTickMs, frames: st.frames, publish: st.publish, react: st.react, loops: st.loops
        });
    });
};

async function runList(list: ReturnType<typeof steps>, from?: string) {
    const log = TickLog.open(`lab-thieving-${bot}-${Date.now()}`);
    const unfollow = followPrograms();
    const p = sdk.getState()!.player!;
    result('start', { ...where(), at: [p.worldX, p.worldZ, p.level], hp: p.hp, maxHp: p.maxHp, energy: p.runEnergy, thieving: sdk.getState()!.skills.find(k => k.name === 'Thieving')?.baseLevel, inventory: sdk.getState()!.inventory.map(i => `${i.name}x${i.count}`) });
    try {
        await runSteps(session, list, { log, c: {}, ...(from ? { from } : {}), shouldStop: () => false });
    } catch (e) {
        result('error', String(e));
    } finally {
        unfollow();
        for (const r of log.rows) result(`row ${r.step}`, { ticks: r.ticks, startTick: r.startTick, endTick: r.endTick, ok: r.ok, ...(r.error ? { error: r.error } : {}), ...(r.meta ? { meta: r.meta } : {}) });
        console.log(formatReport(report(log.rows)));
        const q = sdk.getState()!.player!;
        result('end', { ...where(), at: [q.worldX, q.worldZ, q.level], hp: q.hp, thieving: sdk.getState()!.skills.find(k => k.name === 'Thieving')?.baseLevel, coins: sdk.getState()!.inventory.filter(i => /^coins$/i.test(i.name)).reduce((a, i) => a + i.count, 0), inventory: sdk.getState()!.inventory.map(i => `${i.name}x${i.count}`) });
    }
}

const opts = () => ({
    to: Number(arg('to', '99')),
    food: arg('food', 'cake') as FoodName
});

switch (mode) {
    case 'setup': {
        await say('setvar tutorial 1000');
        if (!(await tele(sdk, 3222, 3222))) throw new Error('tele to Lumbridge failed');
        // Inside the tutorial there is no logout tab, so a clean logout is refused. The
        // engine's shutdown at the end of this lab logs the player out and saves it; the
        // next tickprog-lab.sh boot in the same checkout logs in with the side tabs set.
        result('setup', { tutorial: 1000, at: near(sdk.getState(), 3222, 3222, 1), next: 'run the lab again in this checkout' });
        await waitTicks(sdk, 5);
        break;
    }
    case 'fresh': {
        await clearInventory();
        for (const stat of ['thieving', 'hitpoints']) await say(`setstat ${stat} ${stat === 'hitpoints' ? 10 : 1}`);
        if (!(await tele(sdk, 3222, 3222))) throw new Error('tele to Lumbridge failed');
        await giveAll([...STARTER.map(n => [n, 1] as [string, number]), ...STARTER_STACKS, [`cert_${arg('kit-food', 'cake')}`, Number(arg('kit-n', '38'))], ['coins', Number(arg('coins', '100'))]]);
        await say('~energy');
        result('fresh', { at: near(sdk.getState(), 3222, 3222, 1), inventory: sdk.getState()!.inventory.length });
        const only = arg('only', '');
        // tickprog-lab.sh splits specs on ':', so --only names steps by the part after `thieving:`
        await runList(steps(opts()).filter(s => !only || only.split(',').some(o => s.name === `thieving:${o}`)), arg('from', '') || undefined);
        break;
    }
    case 'at': {
        await say(`setstat thieving ${arg('thieving', '55')}`);
        await say(`setstat hitpoints ${arg('hp', '10')}`);
        const cakes = Number(arg('cakes', '0'));
        if (cakes > 0) {
            await clearInventory();
            await giveAll(Array.from({ length: Math.min(cakes, 27) }, () => ['cake', 1] as [string, number]));
        }
        if (!(await tele(sdk, Number(arg('x', '2670')), Number(arg('z', '3305'))))) throw new Error('tele failed');
        result('at', { thieving: arg('thieving', '55'), hp: sdk.getState()!.player!.hp, cakes });
        await runList(steps(opts()), arg('from', '') || undefined);
        break;
    }
    case 'steps':
        await runList(steps(opts()), arg('from', '') || undefined);
        break;
    case 'leg':
        await runList(steps(opts()).filter(s => s.name === 'thieving:to-ardougne'));
        break;
    default:
        throw new Error(`unknown mode ${mode}`);
}
await closeSession(session);
process.exit(0);
