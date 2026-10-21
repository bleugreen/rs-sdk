// Regicide start: the King's messenger. Its timer is armed only at login
// (login_logout/login.rs2:74 -> regicide_kings_messenger.rs2:1-4) when %upass is
// complete and %regicide_quest is 0, for ~random_range(400, 1200) ticks. Two
// phases with a lite-client restart in between (the runner exits on logout):
//   bun docs/speedrun/scripts/quest-regicide-messenger.ts <bot> out
//   (restart: cd server/webclient && bun src/lite/runner.ts <bot>)
//   bun docs/speedrun/scripts/quest-regicide-messenger.ts <bot> in
// `in` waits (standing still) for the messenger, answers its pages and reports
// login-to-spawn, spawn-to-first-page and the page count.

import { runScript } from '../../../sdk/runner';
import { getVar, now, result, setVar, talkThrough, waitTicks, waitUntil } from './quest-regicide-lab';

const LOGOUT_BUTTON = 2458; // logout:try_logout
const PHASE = process.argv[3] ?? 'out';

await runScript(async ({ sdk }) => {
    if (PHASE === 'out') {
        await setVar(sdk, 'upass', 10);
        await setVar(sdk, 'regicide_quest', 0);
        await setVar(sdk, 'regicide_bits', 0);
        await waitTicks(sdk, 20);
        await sdk.sendClickComponent(LOGOUT_BUTTON);
        await new Promise(r => setTimeout(r, 5000));
        result('messenger.out', { ok: true });
        return;
    }
    const t0 = now(sdk);
    const spawn = await waitUntil(sdk, () => sdk.getNearbyNpcs().some(n => /messenger/i.test(n.name)), 1400);
    const open = await waitUntil(sdk, s => s.dialog.isOpen, 30);
    const d = await talkThrough(sdk, [/./]);
    result('messenger.in', {
        loginToSpawn: spawn ? spawn.tick - t0 : null,
        spawnToFirstPage: spawn && open ? open.tick - spawn.tick : null,
        dialogue: { ticks: d.ticks, pages: d.pages, options: d.options },
        stage: await getVar(sdk, 'regicide_quest'),
        scroll: sdk.getInventory().some(i => /King's message/i.test(i.name)),
    });
}, { timeout: 900_000, onDisconnect: 'ignore' } as any);
