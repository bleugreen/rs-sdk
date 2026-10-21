// Shared helpers for the Magic measurement scripts (docs/speedrun/skills/magic.md).
// Staff commands need the engine started with LOCAL_STAFF_LEVEL=4 (docs/speedrun/LAB.md);
// docs/speedrun/scripts/magic-lab.sh does that on the magic port block.
import type { BotSDK } from '../../../sdk/index';
import type { BotActions } from '../../../sdk/actions';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Server tick as counted by the lite client (one PLAYER_INFO per tick). */
export function tick(sdk: BotSDK): number {
    return sdk.getState()?.tick ?? -1;
}

export async function waitTicks(sdk: BotSDK, n: number, wallMs = 10_000 + n * 1000): Promise<void> {
    const target = tick(sdk) + n;
    const deadline = Date.now() + wallMs;
    while (tick(sdk) < target) {
        if (Date.now() > deadline) throw new Error(`server ticks stopped arriving (tick ${tick(sdk)}, wanted ${target})`);
        await sleep(5);
    }
}

/** Resolve on the first state publication of a later server tick than `t`. */
export async function nextTick(sdk: BotSDK, t = tick(sdk)): Promise<number> {
    const deadline = Date.now() + 10_000;
    while (tick(sdk) <= t) {
        if (Date.now() > deadline) throw new Error(`server ticks stopped arriving at ${t}`);
        await sleep(2);
    }
    return tick(sdk);
}

export async function waitUntil(sdk: BotSDK, cond: () => boolean, maxTicks: number, label: string): Promise<number> {
    const t0 = tick(sdk);
    const wallDeadline = Date.now() + 10_000 + maxTicks * 1000;
    while (!cond()) {
        if (tick(sdk) - t0 > maxTicks || Date.now() > wallDeadline) {
            throw new Error(`timed out after ${tick(sdk) - t0} ticks waiting for: ${label}`);
        }
        await sleep(5);
    }
    return tick(sdk) - t0;
}

export async function cheat(sdk: BotSDK, command: string): Promise<void> {
    await sdk.sendSay(`::${command}`);
    await waitTicks(sdk, 2);
}

/** `::tele level,mx,mz,lx,lz` from absolute tile coordinates. */
export async function tele(sdk: BotSDK, x: number, z: number, level = 0): Promise<void> {
    await cheat(sdk, `tele ${level},${x >> 6},${z >> 6},${x & 63},${z & 63}`);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        const p = sdk.getState()?.player;
        if (p && p.worldX === x && p.worldZ === z) break;
        await sleep(50);
    }
    await waitTicks(sdk, 2);
}

export function log(sdk: BotSDK, msg: string, t0?: number): void {
    const t = tick(sdk);
    console.log(`[t=${t}${t0 !== undefined ? ` +${t - t0}` : ''}] ${msg}`);
}

/** Game xp (25x base) of a skill, recorded per server tick from state publications. */
export function xpRecorder(sdk: BotSDK, skill: string) {
    const at = new Map<number, number>();
    const off = sdk.onStateUpdate((s) => {
        const xp = s.skills.find((k) => k.name === skill)?.experience;
        if (xp !== undefined) at.set(s.tick, xp);
    });
    return {
        at,
        off,
        /** Ticks in [t0, t1] on which xp rose, with the rise in base xp. */
        gains(t0: number, t1: number): { tick: number; base: number }[] {
            const out: { tick: number; base: number }[] = [];
            let prev: number | undefined;
            for (let t = t0; t <= t1; t++) {
                const x = at.get(t);
                if (x === undefined) continue;
                if (prev !== undefined && x > prev) out.push({ tick: t, base: (x - prev) / 25 });
                prev = x;
            }
            return out;
        },
    };
}

/** Wipe inventory and worn items, then optionally wield a staff. */
export async function freshKit(sdk: BotSDK, bot: BotActions, staff?: string): Promise<void> {
    await cheat(sdk, 'clearinv inv');
    await cheat(sdk, 'clearinv worn');
    if (staff) {
        await cheat(sdk, `give ${staff} 1`);
        await waitUntil(sdk, () => sdk.getInventory().length > 0, 10, 'staff in inventory');
        const r = await bot.equipItem(sdk.getInventory()[0]!);
        if (!r.success) {
            const p = sdk.getState()?.player;
            const chat = sdk.getNewChat().map((m) => m.text).slice(-5).join(' | ');
            throw new Error(`could not wield ${staff}: ${r.message} at (${p?.worldX},${p?.worldZ}); chat: ${chat}`);
        }
        await cheat(sdk, 'clearinv inv');
    }
}

export function histogram(xs: number[]): string {
    const h = new Map<number, number>();
    for (const x of xs) h.set(x, (h.get(x) ?? 0) + 1);
    return [...h.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' ');
}
