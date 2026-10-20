// Shared helpers for the mining measurement scripts (docs/speedrun/skills/mining.md).
// Lab setup: docs/speedrun/LAB.md (mining port block). Requires LOCAL_STAFF_LEVEL>=4 for the cheats.
import type { BotWorldState, NearbyLoc } from '../../../sdk/types';

// Loc ids of iron rocks: ironrock1/ironrock2 (server/content/pack/loc.pack:2093-2094).
export const IRON_IDS = [2092, 2093];

export function arg(name: string, def: string): string {
    const argv = process.argv.slice(2);
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : def;
}

export function miningXp(s: BotWorldState): number {
    return s.skills.find(k => k.name.toLowerCase() === 'mining')?.experience ?? 0;
}

export function teleCmd(x: number, z: number, level = 0): string {
    return `::tele ${level},${x >> 6},${z >> 6},${x & 63},${z & 63}`;
}

/** Resolves with the first published state whose tick is greater than `after`. */
export function nextTick(sdk: any, after: number): Promise<BotWorldState> {
    return new Promise(resolve => {
        const cur = sdk.getState() as BotWorldState | null;
        if (cur && cur.tick > after) return resolve(cur);
        const off = sdk.onStateUpdate((s: BotWorldState) => {
            if (s.tick > after) {
                off();
                resolve(s);
            }
        });
    });
}

export async function waitTicks(sdk: any, n: number): Promise<BotWorldState> {
    let s = sdk.getState() as BotWorldState;
    const target = s.tick + n;
    while (s.tick < target) s = await nextTick(sdk, s.tick);
    return s;
}

/** Live iron rock at (x,z), if the client currently sees one there. */
export function liveRock(s: BotWorldState, x: number, z: number, ids = IRON_IDS): NearbyLoc | undefined {
    return s.nearbyLocs.find(l => l.x === x && l.z === z && ids.includes(l.id));
}

export function mineOp(loc: NearbyLoc): number {
    return loc.optionsWithIndex.find(o => /^mine$/i.test(o.text))?.opIndex ?? 1;
}

/** Staff-cheat setup: mining level, pickaxe, position. */
export async function setup(sdk: any, opts: { level: number; pick: string; x: number; z: number }): Promise<BotWorldState> {
    await sdk.sendSay(`::setstat mining ${opts.level}`);
    await waitTicks(sdk, 2);
    const have = (sdk.getState() as BotWorldState).inventory.some(i => /pickaxe/i.test(i.name));
    if (!have) {
        await sdk.sendSay(`::give ${opts.pick}`);
        await waitTicks(sdk, 2);
    }
    await sdk.sendSay(teleCmd(opts.x, opts.z));
    return await waitTicks(sdk, 4);
}

/** Drops every item matching `re`, at most `max` packets (the server accepts 5 user events per tick). */
export function dropMatching(sdk: any, s: BotWorldState, re: RegExp, max = 5): number {
    let n = 0;
    for (const item of s.inventory) {
        if (n >= max) break;
        if (re.test(item.name)) {
            sdk.sendDropItem(item.slot).catch(() => {});
            n++;
        }
    }
    return n;
}

export function summarize(label: string, ticks: number[], xps: number[]): void {
    const gaps = ticks.slice(1).map((t, i) => t - ticks[i]!);
    const hist: Record<number, number> = {};
    for (const g of gaps) hist[g] = (hist[g] ?? 0) + 1;
    const span = ticks[ticks.length - 1]! - ticks[0]!;
    const baseXp = xps.slice(1).reduce((a, b) => a + b, 0) / 25;
    console.log(`\n== ${label} ==`);
    console.log(`xp events: ${ticks.length}, span ${span} ticks`);
    console.log(`gap histogram (ticks: count): ${JSON.stringify(hist)}`);
    console.log(`mean gap: ${(span / Math.max(1, gaps.length)).toFixed(3)} ticks`);
    console.log(`base xp per tick (excluding first event): ${(baseXp / Math.max(1, span)).toFixed(3)}`);
}
