// Shared helpers for the Runecraft measurements (docs/speedrun/skills/runecraft.md).
// Not a script itself. Unlike the other skill scripts these drive several bots
// from one process (the scored account and its essence givers), so they build
// one BotSDK per bot from bots/<name>/bot.env instead of using runScript.
//
// Clock: `state.tick` is the lite client's count of PLAYER_INFO packets, which
// the server sends once per tick. The stock client publishes state from the
// PLAYER_INFO handler, before the rest of that tick's packets (stats,
// inventories, interface opens) are applied, so anything the server did on
// tick T is visible in the publication for T+1. A packet sent right after the
// publication for tick X is handled by the server on tick X+1.

import { readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../../sdk/index';
import type { BotWorldState } from '../../../sdk/types';

export type Pred = (s: BotWorldState) => boolean;

export function loadEnv(name: string): Record<string, string> {
    const out: Record<string, string> = {};
    const text = readFileSync(join(process.cwd(), 'bots', name, 'bot.env'), 'utf-8');
    for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
    return out;
}

export async function connect(name: string): Promise<BotSDK> {
    const env = loadEnv(name);
    const sdk = new BotSDK({
        botUsername: env.BOT_USERNAME,
        password: env.PASSWORD,
        gatewayUrl: env.GATEWAY_URL || deriveGatewayUrl(env.SERVER),
        connectionMode: 'control',
        autoReconnect: true,
        autoLaunchBrowser: false,
        showChat: false,
    });
    await sdk.connect();
    const t0 = sdk.getState()?.tick ?? -1;
    await sdk.waitForCondition(s => s.tick !== t0 && !!s.player, 20_000);
    return sdk;
}

export function now(sdk: BotSDK): number {
    return sdk.getState()?.tick ?? -1;
}

/** Resolve with the first published state for which `pred` holds, or null after maxTicks. */
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

/** Staff teleport to an absolute tile (::tele level,mx,mz,lx,lz) and wait for it. */
export async function tele(sdk: BotSDK, x: number, z: number, level = 0): Promise<boolean> {
    const ok: Pred = s => { const p = pos(s); return p.x === x && p.z === z && p.level === level; };
    if (ok(sdk.getState()!)) return true;
    await cheat(sdk, `tele ${level},${x >> 6},${z >> 6},${x & 63},${z & 63}`);
    const r = await waitUntil(sdk, ok, 20);
    if (r) await waitTicks(sdk, 3);
    return r !== null;
}

export function invCount(s: BotWorldState | null | undefined, re: RegExp): number {
    return (s?.inventory ?? []).filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
}

export function rcXp(s: BotWorldState | null | undefined): number {
    return s?.skills.find(k => /runecraft/i.test(k.name))?.experience ?? -1;
}

export function stats(xs: number[]): { n: number; min: number; max: number; mean: number; median: number } {
    const v = xs.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
    const n = v.length;
    if (n === 0) return { n, min: NaN, max: NaN, mean: NaN, median: NaN };
    return { n, min: v[0], max: v[n - 1], mean: Math.round((v.reduce((a, b) => a + b, 0) / n) * 100) / 100, median: v[n >> 1] };
}

export function hist(xs: number[]): Record<string, number> {
    const h: Record<string, number> = {};
    for (const x of xs) h[String(x)] = (h[String(x)] ?? 0) + 1;
    return h;
}

export function result(name: string, data: unknown): void {
    console.log(`RESULT ${name} ${JSON.stringify(data)}`);
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Runecraft table rows (runecraft.dbrow): level, base xp per essence, the room
// entry tile (enter_coord), the outside tile the exit portal drops you on
// (exit_coord) and the ruins' locate coord (altar_coord, the ruins tile).
function c(s: string): { x: number; z: number; level: number } {
    const [l, mx, mz, lx, lz] = s.split('_').map(Number);
    return { x: mx * 64 + lx, z: mz * 64 + lz, level: l };
}
export const ALTARS: Record<string, { level: number; xp: number; enter: ReturnType<typeof c>; exit: ReturnType<typeof c>; ruins: ReturnType<typeof c> }> = {
    air: { level: 1, xp: 5, enter: c('0_44_75_25_30'), exit: c('0_46_51_39_24'), ruins: c('0_46_51_41_28') },
    mind: { level: 2, xp: 5.5, enter: c('0_43_75_41_29'), exit: c('0_46_54_36_55'), ruins: c('0_46_54_38_58') },
    water: { level: 5, xp: 6, enter: c('0_42_75_37_32'), exit: c('0_49_49_46_26'), ruins: c('0_49_49_49_29') },
    earth: { level: 9, xp: 6.5, enter: c('0_41_75_33_30'), exit: c('0_51_54_39_21'), ruins: c('0_51_54_42_18') },
    fire: { level: 14, xp: 7, enter: c('0_40_75_16_48'), exit: c('0_51_50_46_52'), ruins: c('0_51_50_49_55') },
    body: { level: 20, xp: 7.5, enter: c('0_39_75_27_38'), exit: c('0_47_53_42_50'), ruins: c('0_47_53_45_53') },
    cosmic: { level: 27, xp: 8, enter: c('0_33_75_30_13'), exit: c('0_49_148_37_29'), ruins: c('0_49_148_40_25') },
    chaos: { level: 35, xp: 8.5, enter: c('3_35_75_35_47'), exit: c('0_47_56_52_1'), ruins: c('0_47_56_52_7') },
    nature: { level: 44, xp: 9, enter: c('0_37_75_32_35'), exit: c('0_44_47_49_14'), ruins: c('0_44_47_53_11') },
    law: { level: 54, xp: 9.5, enter: c('0_38_75_32_19'), exit: c('0_44_52_42_50'), ruins: c('0_44_52_42_53') },
};
