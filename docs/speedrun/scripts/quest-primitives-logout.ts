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
import { cheat, now, pos, result, tele, waitTicks, waitUntil } from './quest-primitives-lib';

const PHASE = process.argv[3] ?? 'out';
const LOGOUT_BUTTON = 2458; // logout:try_logout (server/content/pack/interface.pack)
const SPOT = { x: 3208, z: 3218 };

async function getvar(sdk: any, name: string): Promise<string | null> {
    const t = now(sdk);
    await cheat(sdk, `getvar ${name}`);
    const r = await waitUntil(sdk, s => s.gameMessages.some(m => m.tick >= t && new RegExp(`get ${name}`, 'i').test(m.text)), 10);
    return r?.state.gameMessages.filter(m => new RegExp(`get ${name}`, 'i').test(m.text)).pop()?.text ?? null;
}

await runScript(async ({ sdk }) => {
    if (PHASE === 'out') {
        // 1. combat blocks logout
        await tele(sdk, 3250, 3235);
        await waitTicks(sdk, 2);
        const npc = sdk.findNearbyNpc(/^(goblin|man)$/i);
        let combat: unknown = 'no npc';
        if (npc) {
            await sdk.sendInteractNpc(npc.index, npc.optionsWithIndex.find(o => /attack/i.test(o.text))!.opIndex);
            await waitUntil(sdk, s => s.combatEvents.some(e => e.type === 'damage_taken' || e.type === 'damage_dealt'), 30);
            const t = now(sdk);
            await sdk.sendClickComponent(LOGOUT_BUTTON);
            const m = await waitUntil(sdk, s => s.gameMessages.some(x => x.tick >= t && /can't log out/i.test(x.text)), 10);
            combat = { blocked: !!m, message: m?.state.gameMessages.filter(x => /log out/i.test(x.text)).pop()?.text };
            await sdk.sendWalk(3250, 3230, true);
        }
        // 2. quest state, then log out on a known tile
        await cheat(sdk, 'setvar cookquest 1'); await waitTicks(sdk, 1);
        await cheat(sdk, 'setvar regicide_still_total 5'); await waitTicks(sdk, 1);
        await waitTicks(sdk, 20); // past the combat logout window
        await tele(sdk, SPOT.x, SPOT.z);
        const before = { pos: pos(sdk.getState()), cookquest: await getvar(sdk, 'cookquest'), regicide_still_total: await getvar(sdk, 'regicide_still_total') };
        const t0 = now(sdk);
        await sdk.sendClickComponent(LOGOUT_BUTTON);
        // the session ends; the last published tick bounds the logged-in cost
        let last = t0;
        const unsub = sdk.onStateUpdate(s => { if (s.inGame) last = s.tick; });
        await new Promise(r => setTimeout(r, 6000));
        unsub();
        result('logout.out', { combat, before, clickTick: t0, lastInGameTick: last, ticksToLeave: last - t0 });
    } else {
        await waitTicks(sdk, 2);
        const after = { pos: pos(sdk.getState()), atSpot: pos(sdk.getState()).x === SPOT.x && pos(sdk.getState()).z === SPOT.z, cookquest: await getvar(sdk, 'cookquest'), regicide_still_total: await getvar(sdk, 'regicide_still_total') };
        result('logout.in', after);
    }
}, { timeout: 120_000, onDisconnect: 'ignore' } as any);
