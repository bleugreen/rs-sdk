// Lab: kit-return.ts's approach to the giver (rs/314). Owns the kit account's lite client (it relogs
// after each scenario's logout); the giver is a lab.sh helper runner standing on the default tile.
//
//   LAB_RUNNERS=0 LAB_HELPERS=<giver> speedrun/lab/lab.sh <kit-account> speedrun/lab/kit-return-lab.ts:--giver=<giver>
//
// Scenarios, each with one bronze axe to return, at 10 hitpoints unless noted:
//   refuse-far        Magic 1 at rs/296's Ardougne tile: refused, never moves (exit 3)
//   teleport-first    Magic 31 and the runes at Draynor: Lumbridge teleport, run, trade (exit 0)
//   damage-stop       Magic 1, 16 tiles out, a young dark wizard spawned on the account 8 tiles
//                     into the run: halted, backed off to the start, logged out alive (exit 4)
// A scenario passes only if the account did not die.
//   refuse-wilderness Magic 99 and the runes on the Wilderness Agility course, 99 hitpoints so
//                     the course's monsters do not kill it first: refused (exit 3)

import { isLoggedOut, login, openSession } from '../lib/session';
import { receiveFrom } from '../lib/trade';
import { waitTicks } from '../lib/wait';
import { pos } from '../lib/world';
import { DEFAULT_GIVER_TILE, EXIT, kitReturn } from '../tools/kit-return';
import { arg, botArg, result } from './common';
import { cheat, clearInventory, give, leaveTutorial, mustTele, setStats } from './setup';

const kit = await openSession(botArg(), { launch: true });
const giver = await openSession(arg('giver', 'kr314g'), { pathfinding: false });
for (const s of [kit, giver]) await leaveTutorial(s);
await mustTele(giver.sdk, DEFAULT_GIVER_TILE.x, DEFAULT_GIVER_TILE.z);
const items = [{ name: 'bronze axe', amount: 1 }];
const runes = async () => {
    await give(kit.sdk, 'airrune', 3);
    await give(kit.sdk, ['earthrune', 'lawrune']);
};

let failed = 0;
async function scenario(label: string, expect: number, stage: () => Promise<void>, during?: () => () => void) {
    if (await isLoggedOut(kit)) await login(kit);
    await waitTicks(kit.sdk, 3);
    await clearInventory(kit.sdk);
    await setStats(kit.sdk, { magic: 1, hitpoints: 10 });
    await give(kit.sdk, 'bronze_axe');
    await stage();
    await waitTicks(kit.sdk, 5);
    const from = pos(kit.sdk);
    const giverAxes0 = giver.sdk.getState()!.inventory.filter(i => /^bronze axe$/i.test(i.name)).length;
    const recv = expect === EXIT.ok
        ? giver.sdk.waitForTradeRequest({ from: kit.name, timeout: 120_000 }).then(req => (req ? receiveFrom(giver.sdk, kit.name) : null))
        : null;
    const t0 = kit.sdk.getState()!.tick;
    const stopDuring = during?.();
    const r = await kitReturn(kit, { giver: giver.name, items, at: DEFAULT_GIVER_TILE });
    stopDuring?.();
    const g = await recv;
    const giverAxes = giver.sdk.getState()!.inventory.filter(i => /^bronze axe$/i.test(i.name)).length;
    const pass = r.code === expect && r.logout.ok && !r.died && (expect !== EXIT.ok || giverAxes === giverAxes0 + 1);
    if (!pass) failed++;
    result(`kit-return ${label}`, {
        pass, expect, code: r.code, from, lastSeenAt: pos(kit.sdk), ticks: (kit.sdk.getState()?.tick ?? t0) - t0,
        plan: r.approach?.plan, reason: r.approach?.reason, damage: r.damage, gave: r.gave,
        giverReceived: g?.received ?? null, logout: { ok: r.logout.ok, by: r.logout.confirmedBy, reason: r.logout.reason },
        died: r.died, deaths: kit.sdk.getState()?.player?.respawnCount ?? null,
    });
}

await scenario('refuse-far', EXIT.refused, () => mustTele(kit.sdk, 2603, 3234));
await scenario('teleport-first', EXIT.ok, async () => {
    await setStats(kit.sdk, { magic: 31 });
    await runes();
    await mustTele(kit.sdk, 3093, 3244);
});
// An ambush: the wizard spawns on the account's own tile once the run is 8 tiles west of the
// start (east of x 3238 is the River Lum). A wizard spawned beside the start either missed it
// (it wanders, hunt range 3) or drew auto-retaliate before the walk began.
await scenario('damage-stop', EXIT.damaged, () => mustTele(kit.sdk, 3238, 3222), () => {
    let spawned = false;
    return kit.sdk.onStateUpdate(s => {
        if (spawned || !s.player || s.player.worldX > 3230) return;
        spawned = true;
        void cheat(kit.sdk, 'npcadd young_dark_wizard');
    });
});
await scenario('refuse-wilderness', EXIT.refused, async () => {
    await setStats(kit.sdk, { magic: 99, hitpoints: 99 });
    await runes();
    await mustTele(kit.sdk, 3002, 3940);
});
result('kit-return lab', { failed });
process.exit(failed ? 1 : 0);
