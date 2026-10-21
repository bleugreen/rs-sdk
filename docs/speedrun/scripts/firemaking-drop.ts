#!/usr/bin/env bun
/**
 * Helper-dropped log rows. A helper (LAB_HELPERS=fmhelp) walks the same
 * snake firemaking-line.ts lights and drops one log per tile. A player drop
 * lives 300 ticks (drop.rs2: lootdrop_duration * 3 / 2) and is private to
 * the dropper for the first 100 (World.ts addObj, NODE_OBJ_REVEAL_TICKS,
 * default 100, not set in fly.toml). This script runs as the scored account,
 * drives the helper as a child process, and reports when each log became
 * visible to the scored account. Follow it with
 * `firemaking-line.ts --mode=ground` on the same --row to light them.
 *
 *   bun docs/speedrun/scripts/firemaking-drop.ts <bot> [--helper=fmhelp]
 *       [--logs=magic_logs] [--n=54] [--row=3019,3362,27] [--rows=2]
 */
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';

const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : def;
};
const ROLE = flag('role', 'main')!;
const HELPER = flag('helper', 'fmhelp')!;
const LOGS = flag('logs', 'magic_logs')!;
const N = Number(flag('n', '54'));
const ROWARG = flag('row', '3019,3362,27')!;
const [RX, RZ, RLEN] = ROWARG.split(',').map(Number);
const ROWS = Number(flag('rows', '2'));
const logName = LOGS === 'logs' ? /^logs$/i : new RegExp(`^${LOGS.replace('_logs', '').replace(/_/g, ' ')} logs$`, 'i');
function snakeTile(i: number): [number, number] {
    const row = Math.floor(i / RLEN) % ROWS;
    const k = i % RLEN;
    return [row % 2 === 0 ? RX - k : RX - RLEN + 1 + k, RZ - row];
}
const tele = (x: number, z: number) => `::tele 0,${x >> 6},${z >> 6},${x & 63},${z & 63}`;

await runScript(async ({ bot, sdk }) => {
    const nextTick = (after: number) => new Promise<BotWorldState>(resolve => {
        const now = sdk.getState();
        if (now && now.tick > after) return resolve(now);
        const off = sdk.onStateUpdate(s => { if (s.tick > after) { off(); resolve(s); } });
    });
    const waitTicks = async (n: number) => { let t = sdk.getState()!.tick; for (let i = 0; i < n; i++) t = (await nextTick(t)).tick; };
    await sdk.waitForCondition(s => (s.player?.worldX ?? 0) > 0, 15000);
    await bot.skipTutorial().catch(() => {});

    if (ROLE === 'helper') {
        const t0 = sdk.getState()!.tick;
        let dropped = 0;
        while (dropped < N) {
            await sdk.sendSay('::~clearinv inv'); await waitTicks(1);
            await sdk.sendSay(`::give ${LOGS} ${Math.min(28, N - dropped)}`); await waitTicks(2);
            while (dropped < N) {
                const lg = sdk.getState()!.inventory.find(i => logName.test(i.name));
                if (!lg) break;
                const [x, z] = snakeTile(dropped);
                await sdk.sendSay(tele(x, z)); await waitTicks(1);
                await sdk.sendDropItem(lg.slot); await waitTicks(1);
                dropped++;
            }
        }
        console.log(JSON.stringify({ helperDropped: dropped, helperTicks: sdk.getState()!.tick - t0 }));
        return;
    }

    const [sx, sz] = snakeTile(0);
    await sdk.sendSay(tele(sx + 3, sz)); await waitTicks(3);
    const t0 = sdk.getState()!.tick;
    const child = Bun.spawn(['bun', import.meta.path, HELPER, '--role=helper', `--logs=${LOGS}`, `--n=${N}`, `--row=${ROWARG}`, `--rows=${ROWS}`], { stdout: 'inherit', stderr: 'inherit' });
    // Watch the scored account's view of the snake tiles.
    const seenAt = new Map<number, number>();
    let s = sdk.getState()!;
    const tiles = Array.from({ length: N }, (_, i) => snakeTile(i));
    // Hand over to the lighting run as soon as the first log is public and the
    // helper is done: the helper drops one log per ~2 ticks and lighting takes
    // 4, so lighting never catches up with the reveal, and waiting for every
    // log would let the first ones run into their 300-tick despawn.
    let helperDone = false;
    void child.exited.then(() => { helperDone = true; });
    while (!(helperDone && seenAt.size > 0) && s.tick - t0 < 600) {
        s = await nextTick(s.tick);
        tiles.forEach(([x, z], i) => {
            if (!seenAt.has(i) && s.groundItems.some(g => g.x === x && g.z === z && logName.test(g.name))) seenAt.set(i, s.tick - t0);
        });
    }
    await child.exited;
    const seen = [...seenAt.entries()].sort((a, b) => a[0] - b[0]);
    console.log(JSON.stringify({ logsVisibleToScored: seenAt.size, firstVisibleAfter: seen[0]?.[1], lastVisibleAfter: seen.at(-1)?.[1], visibleTicks: seen.map(e => e[1]).join(',') }));
}, { timeout: 0, printState: false });
