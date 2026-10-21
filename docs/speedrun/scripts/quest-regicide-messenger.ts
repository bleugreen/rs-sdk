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
import { converse } from '../../../speedrun/lib/converse';
import { currentTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { invCount } from '../../../speedrun/lib/world';
import { result } from '../../../speedrun/lab/record';
import { getvar, setvar } from '../../../speedrun/lab/setup';

const LOGOUT_BUTTON = 2458; // logout:try_logout
const PHASE = process.argv[3] ?? 'out';

await runScript(async ({ sdk }) => {
    if (PHASE === 'out') {
        await setvar(sdk, 'upass', 10);
        await setvar(sdk, 'regicide_quest', 0);
        await setvar(sdk, 'regicide_bits', 0);
        await waitTicks(sdk, 20);
        await sdk.sendClickComponent(LOGOUT_BUTTON);
        await new Promise(r => setTimeout(r, 5000));
        result('messenger.out', { ok: true });
        return;
    }
    const t0 = currentTick(sdk);
    const spawn = await waitUntil(sdk, s => s.nearbyNpcs.some(n => /messenger/i.test(n.name)), { maxTicks: 1400 });
    const open = await waitUntil(sdk, s => s.dialog.isOpen, { maxTicks: 30 });
    const d = await converse(sdk, [/./], { keep: true });
    result('messenger.in', {
        loginToSpawn: spawn.ok ? spawn.tick - t0 : null,
        spawnToFirstPage: spawn.ok && open.ok ? open.tick - spawn.tick : null,
        // first page to the dialogue closing
        dialogue: { ticks: d.opened ? d.endTick - d.firstTick : 0, pages: d.pages, options: d.options },
        stage: await getvar(sdk, 'regicide_quest'),
        scroll: invCount(sdk, /King's message/i) > 0,
    });
}, { timeout: 900_000, onDisconnect: 'ignore' } as any);
