// Logout mid-quest: does the account come back at the same tile with its quest
// state, and what resets? Two phases, with a lite-client restart in between
// (the runner exits when the session logs out):
//   bun docs/speedrun/scripts/quest-primitives-logout.ts <botname> out
//   (restart: cd server/webclient && bun src/lite/runner.ts <botname>)
//   bun docs/speedrun/scripts/quest-primitives-logout.ts <botname> in
// `out` sets a permanent quest varp (cookquest, perm) and a temporary one
// (regicide_still_total, no scope=perm so SCOPE_TEMP), stands on a known tile,
// first tries to log out straight after a hit in combat, then logs out.

import { runScript } from '../../../sdk/runner';
import { getvar, mustTele, setvar } from '../../../speedrun/lab/setup';
import { result } from '../../../speedrun/lab/record';
import { currentTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { findNpc, messagesSince, opIndex, pos } from '../../../speedrun/lib/world';

const PHASE = process.argv[3] ?? 'out';
const LOGOUT_BUTTON = 2458; // logout:try_logout (server/content/pack/interface.pack)
const SPOT = { x: 3208, z: 3218 };

await runScript(async ({ sdk }) => {
    if (PHASE === 'out') {
        // 1. combat blocks logout
        await mustTele(sdk, 3250, 3235);
        await waitTicks(sdk, 2);
        const npc = findNpc(sdk, /^(goblin|man)$/i);
        let combat: unknown = 'no npc';
        if (npc) {
            await sdk.sendInteractNpc(npc.index, opIndex(npc, /attack/i)!);
            await waitUntil(sdk, s => s.combatEvents.some(e => e.type === 'damage_taken' || e.type === 'damage_dealt'), { maxTicks: 30 });
            const t = currentTick(sdk);
            await sdk.sendClickComponent(LOGOUT_BUTTON);
            const m = await waitUntil(sdk, s => messagesSince(s, t, /can't log out/i).length > 0, { maxTicks: 10 });
            combat = { blocked: m.ok, message: m.ok ? messagesSince(m.state, t, /log out/i).pop() : undefined };
            await sdk.sendWalk(3250, 3230, true);
        }
        // 2. quest state, then log out on a known tile
        await setvar(sdk, 'cookquest', 1);
        await setvar(sdk, 'regicide_still_total', 5);
        await waitTicks(sdk, 20); // past the combat logout window
        await mustTele(sdk, SPOT.x, SPOT.z);
        const before = { pos: pos(sdk), cookquest: await getvar(sdk, 'cookquest'), regicide_still_total: await getvar(sdk, 'regicide_still_total') };
        const t0 = currentTick(sdk);
        await sdk.sendClickComponent(LOGOUT_BUTTON);
        // the session ends; the last published tick bounds the logged-in cost
        let last = t0;
        const unsub = sdk.onStateUpdate(s => { if (s.inGame) last = s.tick; });
        await new Promise(r => setTimeout(r, 6000));
        unsub();
        result('logout.out', { combat, before, clickTick: t0, lastInGameTick: last, ticksToLeave: last - t0 });
    } else {
        await waitTicks(sdk, 2);
        const p = pos(sdk);
        const after = { pos: p, atSpot: p.x === SPOT.x && p.z === SPOT.z, cookquest: await getvar(sdk, 'cookquest'), regicide_still_total: await getvar(sdk, 'regicide_still_total') };
        result('logout.in', after);
    }
}, { timeout: 120_000, onDisconnect: 'ignore' } as any);
