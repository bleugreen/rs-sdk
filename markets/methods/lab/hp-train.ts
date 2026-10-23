// Hitpoints training time for a fresh account (docs/markets/phase2.md 'Setup'): the fleet's combat
// trainer (speedrun/helpers/bones.ts, its 'train' stage on the Lumbridge cows) from a brand-new lab
// account, with the tick each Hitpoints level is first reached.
//
//   speedrun/lab/lab.sh <bot> markets/methods/lab/hp-train.ts:--ticks=4500:--target=70
//
// Lab only: a fresh account, nothing staged. Prints `RESULT hp` with the level timeline.

import { hostname, loadavg } from 'os';
import { runScript } from '../../../sdk/runner';
import { memoryRoleState } from '../../../speedrun/helpers/role';
import { leaveTutorial } from '../../../speedrun/lab/setup';
import { waitTicks } from '../../../speedrun/lib/wait';

const arg = (name: string, d: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? d;
const bot = process.argv[2] ?? '';
const ticks = Number(arg('ticks', '4500'));
const target = Number(arg('target', '70'));
const out = (tag: string, data: unknown) => console.log(`${tag} ${bot} hp-train ${JSON.stringify(data)}`);

await runScript(async ({ bot: actions, sdk }) => {
    await sdk.waitForCondition(s => (s.player?.worldX ?? 0) > 0, 60_000);
    await leaveTutorial({ sdk, bot: actions, name: bot, sessionId: 0 } as never);
    await waitTicks(sdk, 2);
    const level = (n: string) => sdk.getState()!.skills.find(k => k.name === n)?.baseLevel ?? 0;
    const t0 = sdk.getState()!.tick, w0 = Date.now();
    out('RESULT start', { host: hostname(), load: loadavg().map(l => +l.toFixed(1)), ticks, target, hp: level('Hitpoints') });
    const reached: Record<number, number> = {};
    const controller = new AbortController();
    const stop = sdk.onStateUpdate(s => {
        const hp = s.skills.find(k => k.name === 'Hitpoints')?.baseLevel ?? 0;
        if (hp && reached[hp] === undefined) reached[hp] = s.tick - t0;
        if ((hp >= target || s.tick - t0 >= ticks) && !controller.signal.aborted) controller.abort();
    });
    const { role } = await import('../../../speedrun/helpers/bones');
    const running = role.run({
        bot: actions, sdk, account: bot, options: { train: 99, food: 'none' },
        log: (message, data) => out('LOG', { tick: sdk.getState()?.tick, message, ...data }),
        reportBank: () => undefined, signal: controller.signal, state: memoryRoleState()
    });
    await Promise.race([running.catch(e => out('LOG', { message: 'role threw', error: String(e) })), new Promise(r => controller.signal.addEventListener('abort', () => setTimeout(r, 5_000)))]);
    stop();
    const t1 = sdk.getState()!.tick;
    out('RESULT hp', {
        ranTicks: t1 - t0, msPerTick: +((Date.now() - w0) / Math.max(1, t1 - t0)).toFixed(1), reached,
        levels: { attack: level('Attack'), strength: level('Strength'), defence: level('Defence'), hitpoints: level('Hitpoints') },
        load: loadavg().map(l => +l.toFixed(1))
    });
}, { printState: false, onDisconnect: 'wait', reconnectTimeout: 120_000 });
process.exit(0);
