// Can an account with no quests get into Shilo Village, mine the gem rocks and bank there? (rs/685)
//
//   speedrun/lab/lab.sh <bot> markets/methods/lab/shilo-entry.ts:--way=gate:--ticks=600
//
// Content says yes (quest_zombiequeen.rs2): the metal gate's op1 from outside, answered "Yes, I am very nimble
// and agile!", has zombies drag the player in (forcemove to 2870,2953) and queues one green-mist burst; the broken
// cart's op2 telejumps a player across it; the gem rocks' mining script checks only the Mining level and a pickaxe.
// This probe checks it end to end on a Mining-40 account with %zombiequeen 0: in by `--way`, mine with mine.ts's
// Miner for `--ticks` (banking at the Shilo bank), out through the gate from inside, in again by the other way.
import type { BotWorldState } from '../../../sdk/types';
import { arg, botArg, result } from '../../../speedrun/lab/common';
import { clearInventory, getvar, give, leaveTutorial, mustTele, setStats } from '../../../speedrun/lab/setup';
import { actConverse } from '../../../speedrun/lib/act';
import { closeSession, openSession } from '../../../speedrun/lib/session';
import { waitTicks } from '../../../speedrun/lib/wait';
import { memoryRoleState } from '../../../speedrun/helpers/role';
import { Miner } from '../mine';

const session = await openSession(botArg());
const { sdk, bot } = session;
const way = arg('way', 'gate') as 'gate' | 'cart';
const ticks = Number(arg('ticks', '600'));
const OUTSIDE = { x: Number(arg('x', '2878')), z: Number(arg('z', '2953')) };

await leaveTutorial(session);
await waitTicks(sdk, 2);
await setStats(sdk, { mining: 40, hitpoints: Number(arg('hp', '30')) });
await clearInventory(sdk);
await give(sdk, 'adamant_pickaxe');
await waitTicks(sdk, 2);
const pick = sdk.getState()!.inventory.find(i => /pickaxe/i.test(i.name));
if (pick) await bot.equipItem(pick);
await mustTele(sdk, OUTSIDE.x, OUTSIDE.z);
await waitTicks(sdk, 3);

const here = (s: BotWorldState) => ({ x: s.player!.worldX, z: s.player!.worldZ, hp: s.player!.hp, tick: s.tick });
const view = (s: BotWorldState, what: string) =>
    result(what, {
        at: here(s),
        locs: s.nearbyLocs.filter(l => /gate|cart|bank|booth|gem|rock/i.test(l.name) && l.distance <= 15).map(l => ({ name: l.name, id: l.id, x: l.x, z: l.z, ops: l.optionsWithIndex.map(o => o.text) })),
        npcs: s.nearbyNpcs.filter(n => n.distance <= 15).map(n => ({ name: n.name, x: n.x, z: n.z, level: n.combatLevel, ops: n.optionsWithIndex.map(o => o.text) }))
    });

result('zombiequeen', { varp: await getvar(sdk, 'zombiequeen') });
view(sdk.getState()!, 'outside');

/** In by the gate (op1, the 'nimble' answer) or the cart (op2, the same answer); ok once west of the loc. */
async function enter(how: 'gate' | 'cart'): Promise<boolean> {
    const s = sdk.getState()!;
    const re = how === 'gate' ? /^metal gate$/i : /^broken cart$/i;
    const loc = s.nearbyLocs.filter(l => re.test(l.name)).sort((a, b) => a.distance - b.distance)[0];
    if (!loc) {
        result(`enter-${how}`, { ok: false, reason: 'no loc in view', at: here(s) });
        return false;
    }
    const hp0 = s.player!.hp;
    const op = how === 'gate' ? 1 : 2;
    const r = await actConverse(sdk, () => sdk.sendInteractLoc(loc.x, loc.z, loc.id, op), [/^Yes, I am very nimble/i], { done: st => (st.player?.worldX ?? loc.x) < loc.x, maxTicks: 60 });
    // the mist queue fires 16 ticks after the drag and bursts four times, 4 ticks apart
    await waitTicks(sdk, 36);
    const e = sdk.getState()!;
    result(`enter-${how}`, { ok: r.ok, reason: r.reason, ticks: r.ticks, loc: { x: loc.x, z: loc.z, id: loc.id }, at: here(e), hpLost: hp0 - e.player!.hp, transcript: r.dialogue?.transcript?.slice(0, 12) });
    return r.ok;
}

const ok = await enter(way);
view(sdk.getState()!, 'inside');
if (ok) {
    // mine with the method's own loop, banking at the Shilo bank
    const ctl = new AbortController();
    const logs: unknown[] = [];
    const miner = new Miner({
        bot, sdk, account: session.name, options: { site: 'shilo', reportTicks: 200 },
        log: (m, d) => { logs.push({ m, d }); console.log(`LOG ${m} ${JSON.stringify(d ?? {})}`); },
        reportBank: b => result('bank', b.items.filter(i => /uncut|coins/i.test(i.name))),
        signal: ctl.signal, state: memoryRoleState()
    });
    const t0 = sdk.getState()!.tick;
    const stop = sdk.onStateUpdate(st => { if (st.tick - t0 >= ticks) ctl.abort(); });
    await miner.run().catch(e => result('miner-error', { error: String(e) }));
    stop();
    result('mined', { got: miner.got, banks: miner.banks, depletions: miner.respawns.depletions, respawnSamples: miner.respawns.samples.slice(0, 10), hp: sdk.getState()!.player!.hp });

    // out through the gate from inside, then in again the other way
    const g = sdk.getState()!;
    await bot.walkTo(2869, 2953, 2);
    await waitTicks(sdk, 2);
    view(sdk.getState()!, 'by-gate-inside');
    const gate = sdk.getState()!.nearbyLocs.filter(l => /^metal gate$/i.test(l.name)).sort((a, b) => a.distance - b.distance)[0];
    if (gate) {
        const r = await actConverse(sdk, () => sdk.sendInteractLoc(gate.x, gate.z, gate.id, 1), [], { done: st => (st.player?.worldX ?? 0) >= gate.x, maxTicks: 30 });
        result('leave-gate', { ok: r.ok, reason: r.reason, at: here(sdk.getState()!), from: here(g) });
        await bot.walkTo(OUTSIDE.x, OUTSIDE.z, 2);
        await waitTicks(sdk, 2);
        await enter(way === 'gate' ? 'cart' : 'gate');
    }
}
await closeSession(session);
process.exit(0);
