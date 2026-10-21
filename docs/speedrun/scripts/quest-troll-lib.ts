// Shared helpers for the troll-chain measurement scripts (quest-troll-*.ts).
// Not a script itself. Clock: `state.tick` counts PLAYER_INFO packets, one per
// server tick, so tick differences are server ticks.
import type { BotSDK } from '../../../sdk/index';
import type { BotActions } from '../../../sdk/actions';
import type { BotWorldState, NearbyNpc, NearbyLoc } from '../../../sdk/types';

export type Pred = (s: BotWorldState) => boolean;

export function now(sdk: BotSDK): number {
    return sdk.getState()?.tick ?? -1;
}

/** Resolve with the first published state (and its tick) for which `pred` holds, or null after maxTicks. */
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
        const wall = setTimeout(() => finish(null), (maxTicks + 30) * 400);
    });
}

export async function waitTicks(sdk: BotSDK, n: number): Promise<void> {
    const t = now(sdk);
    await waitUntil(sdk, s => s.tick >= t + n, n + 5);
}

export async function cheat(sdk: BotSDK, cmd: string): Promise<void> {
    await sdk.sendSay('::' + cmd);
    await waitTicks(sdk, 2);
}

export function pos(s: BotWorldState | null | undefined) {
    const p = s?.player;
    return { x: p?.worldX ?? -1, z: p?.worldZ ?? -1, level: p?.level ?? -1 };
}

export function near(x: number, z: number, level = 0, tol = 0): Pred {
    return s => {
        const p = pos(s);
        return p.level === level && Math.abs(p.x - x) <= tol && Math.abs(p.z - z) <= tol;
    };
}

/** Staff teleport (::tele level,mx,mz,lx,lz) to an absolute tile and wait for it. */
export async function tele(sdk: BotSDK, x: number, z: number, level = 0): Promise<void> {
    await sdk.sendSay(`::tele ${level},${x >> 6},${z >> 6},${x & 63},${z & 63}`);
    const r = await waitUntil(sdk, near(x, z, level), 30);
    if (!r) throw new Error(`tele to ${level},${x},${z} did not land (at ${JSON.stringify(pos(sdk.getState()))})`);
    await waitTicks(sdk, 3); // let the region and nearby entities load
}

export async function give(sdk: BotSDK, obj: string, n = 1): Promise<void> {
    await cheat(sdk, `give ${obj} ${n}`);
}

export async function setStats(sdk: BotSDK, stats: Record<string, number>): Promise<void> {
    for (const [k, v] of Object.entries(stats)) await cheat(sdk, `setstat ${k} ${v}`);
}

/** Empty the inventory and the worn slots by dropping and unequipping. */
export async function clearInv(bot: BotActions, sdk: BotSDK): Promise<void> {
    for (const it of bot.getEquipment()) await bot.unequipItem(it).catch(() => {});
    for (const it of [...sdk.getInventory()]) await bot.dropItem(it, 'all').catch(() => {});
}

export function invCount(s: BotWorldState | null | undefined, re: RegExp): number {
    return (s?.inventory ?? []).filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
}

export function findNpc(sdk: BotSDK, re: RegExp): NearbyNpc | undefined {
    return sdk.getState()?.nearbyNpcs.filter(n => re.test(n.name)).sort((a, b) => a.distance - b.distance)[0];
}

export async function findLoc(sdk: BotSDK, id: number, x?: number, z?: number): Promise<NearbyLoc | undefined> {
    const pick = (ls: NearbyLoc[]) => ls.filter(l => l.id === id && (x === undefined || (l.x === x && l.z === z))).sort((a, b) => a.distance - b.distance)[0];
    return pick(sdk.getNearbyLocs()) ?? pick(await sdk.scanNearbyLocs(30));
}

export function dialogText(s: BotWorldState | null | undefined): string {
    const d = s?.dialog;
    if (!d?.isOpen) return '';
    const body = d.text || (d.allComponents ?? []).map(c => c.text).filter(Boolean).join(' ');
    return body + (d.options.length ? ' | ' + d.options.map(o => `${o.index}:${o.text}`).join(' / ') : '');
}

export function lastMessages(s: BotWorldState | null | undefined, n = 5): string[] {
    return (s?.gameMessages ?? []).slice(-n).map(m => m.text);
}

/**
 * Drive an open dialogue: on each new page click the option matching the next
 * pattern in `choices` (in order), or continue when the page has no options.
 * Counts pages and option clicks. Stops when no dialogue has been open for
 * `idleTicks` ticks or after maxPages.
 */
export async function drive(sdk: BotSDK, choices: RegExp[] = [], opts: { idleTicks?: number; maxPages?: number; log?: boolean } = {}) {
    const idle = opts.idleTicks ?? 3, maxPages = opts.maxPages ?? 80;
    let pages = 0, clicks = 0, lastPage = '';
    const queue = [...choices];
    const start = now(sdk);
    for (;;) {
        const r = await waitUntil(sdk, s => s.dialog.isOpen && !s.dialog.isWaiting && (s.dialog.pageId ?? dialogText(s)) !== lastPage, idle);
        if (!r) break;
        const s = r.state;
        lastPage = s.dialog.pageId ?? dialogText(s);
        if (opts.log) console.log(`  t${s.tick} ${dialogText(s).slice(0, 140)}`);
        if (s.dialog.options.length) {
            const want = queue.find(q => s.dialog.options.some(o => q.test(o.text)));
            if (!want) throw new Error(`no choice for options: ${dialogText(s)}`);
            queue.splice(queue.indexOf(want), 1);
            await sdk.clickDialogByText(want);
            clicks++;
        } else {
            await sdk.sendClickDialog(0);
            pages++;
        }
        if (pages + clicks >= maxPages) break;
    }
    return { pages, clicks, ticks: now(sdk) - start };
}

export function stats(xs: number[]) {
    const n = xs.length;
    if (!n) return { n, min: NaN, max: NaN, mean: NaN, median: NaN };
    const s = [...xs].sort((a, b) => a - b);
    return { n, min: s[0], max: s[n - 1], mean: Math.round((xs.reduce((a, b) => a + b, 0) / n) * 10) / 10, median: s[Math.floor(n / 2)] };
}

export function result(name: string, data: unknown): void {
    console.log(`RESULT ${name} ${JSON.stringify(data)}`);
}
