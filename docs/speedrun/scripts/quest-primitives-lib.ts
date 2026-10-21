// Shared helpers for the quest timing-primitive measurements
// (docs/speedrun/quests/primitives.md). Not a script itself.
//
// Clock: `state.tick` is the lite client's count of PLAYER_INFO packets, which
// the server sends exactly once per tick, so differences between two observed
// ticks are server ticks. A condition is timestamped with the first published
// state in which it holds (onStateUpdate fires for every publication).

import type { BotSDK } from '../../../sdk/index';
import type { BotWorldState } from '../../../sdk/types';

export type Pred = (s: BotWorldState) => boolean;

export function now(sdk: BotSDK): number {
    return sdk.getState()?.tick ?? -1;
}

/** Resolve with the first published state (and its tick) for which `pred` holds. */
export function waitUntil(sdk: BotSDK, pred: Pred, maxTicks = 100): Promise<{ tick: number; state: BotWorldState } | null> {
    return new Promise(resolve => {
        const cur = sdk.getState();
        if (cur && pred(cur)) return resolve({ tick: cur.tick, state: cur });
        const start = cur?.tick ?? 0;
        let done = false;
        const finish = (v: { tick: number; state: BotWorldState } | null) => {
            if (done) return;
            done = true;
            unsub();
            clearTimeout(wall);
            resolve(v);
        };
        const unsub = sdk.onStateUpdate(s => {
            if (pred(s)) finish({ tick: s.tick, state: s });
            else if (s.tick - start > maxTicks) finish(null);
        });
        // Wall-clock backstop (ticks are 300 ms on the lab engine).
        const wall = setTimeout(() => finish(null), (maxTicks + 20) * 400);
    });
}

export async function waitTicks(sdk: BotSDK, n: number): Promise<void> {
    const t = now(sdk);
    await waitUntil(sdk, s => s.tick >= t + n, n + 5);
}

export async function cheat(sdk: BotSDK, cmd: string): Promise<void> {
    await sdk.sendSay('::' + cmd);
}

export function pos(s: BotWorldState | null | undefined): { x: number; z: number; level: number } {
    const p = s?.player;
    return { x: p?.worldX ?? -1, z: p?.worldZ ?? -1, level: p?.level ?? -1 };
}

export function at(x: number, z: number, level = 0, tol = 0): Pred {
    return s => {
        const p = pos(s);
        return p.level === level && Math.abs(p.x - x) <= tol && Math.abs(p.z - z) <= tol;
    };
}

/** Staff teleport to an absolute tile (::tele level,mx,mz,lx,lz) and wait for it. */
export async function tele(sdk: BotSDK, x: number, z: number, level = 0): Promise<boolean> {
    if (at(x, z, level)(sdk.getState()!)) return true;
    await cheat(sdk, `tele ${level},${x >> 6},${z >> 6},${x & 63},${z & 63}`);
    const r = await waitUntil(sdk, at(x, z, level), 20);
    if (r) await waitTicks(sdk, 2); // let the region and nearby entities load
    return r !== null;
}

export async function give(sdk: BotSDK, obj: string, n = 1): Promise<void> {
    await cheat(sdk, `give ${obj} ${n}`);
    await waitTicks(sdk, 1);
}

export function invCount(s: BotWorldState | null | undefined, re: RegExp): number {
    return (s?.inventory ?? []).filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
}

/** Record one sample per tick until stopped: position, run energy, dialog page, anim. */
export function trace(sdk: BotSDK) {
    const rows: Array<{ tick: number; x: number; z: number; level: number; energy: number; anim: number; spot: number; dialog: string; modal: number }> = [];
    let last = -1;
    const unsub = sdk.onStateUpdate(s => {
        if (s.tick === last) return;
        last = s.tick;
        const p = pos(s);
        rows.push({
            tick: s.tick, ...p,
            energy: s.player?.runEnergy ?? -1,
            anim: s.player?.animId ?? -1,
            spot: s.player?.spotanimId ?? -1,
            dialog: s.dialog.isOpen ? (s.dialog.pageId ?? '?') : '',
            modal: s.modalOpen ? s.modalInterface : -1,
        });
    });
    return { rows, stop: unsub };
}

export function dialogText(s: BotWorldState | null | undefined): string {
    const d = s?.dialog;
    if (!d?.isOpen) return '';
    return (d.text ?? '') + ' | ' + d.options.map(o => `${o.index}:${o.text}`).join(' / ');
}

export function stats(xs: number[]): { n: number; min: number; max: number; mean: number } {
    const n = xs.length;
    if (n === 0) return { n, min: NaN, max: NaN, mean: NaN };
    return { n, min: Math.min(...xs), max: Math.max(...xs), mean: Math.round((xs.reduce((a, b) => a + b, 0) / n) * 100) / 100 };
}

export function result(name: string, data: unknown): void {
    console.log(`RESULT ${name} ${JSON.stringify(data)}`);
}
