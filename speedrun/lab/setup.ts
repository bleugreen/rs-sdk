// Lab-only fixtures built on staff commands (::tele, ::give, ::setstat).
// Needs an engine started with LOCAL_STAFF_LEVEL=4 (lab.sh does this).
// Never imported by speedrun/lib: the scored run cannot use these.

import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import { depositAll } from '../lib/bank';
import type { Session } from '../lib/session';
import { waitTicks, waitUntil } from '../lib/wait';

type LabSdk = Pick<BotSDK, 'getState' | 'onStateUpdate' | 'sendSay'>;

export const VARROCK_WEST_BANK = { x: 3185, z: 3436 };
/** Next to Carla in West Ardougne: 10 pure continue pages, then a three-way choice. */
export const CARLA = { x: 2494, z: 3312 };

/** 28 distinct items that all have a noted form (cert_<name>). */
export const LAB_ITEMS = [
    'logs', 'oak_logs', 'willow_logs', 'maple_logs', 'yew_logs', 'copper_ore', 'tin_ore', 'iron_ore',
    'coal', 'gold_ore', 'mithril_ore', 'bronze_bar', 'iron_bar', 'steel_bar', 'raw_anchovies', 'raw_trout',
    'raw_salmon', 'bones', 'ball_of_wool', 'flax', 'uncut_sapphire', 'raw_shrimp', 'cow_hide', 'bow_string',
    'uncut_emerald', 'uncut_ruby', 'raw_lobster', 'leather',
] as const;

export async function cheat(sdk: LabSdk, cmd: string): Promise<void> {
    await sdk.sendSay('::' + cmd);
}

export function near(s: BotWorldState | null | undefined, x: number, z: number, r = 0): boolean {
    const p = s?.player;
    return !!p && Math.abs(p.worldX - x) <= r && Math.abs(p.worldZ - z) <= r;
}

export async function tele(sdk: LabSdk, x: number, z: number, level = 0): Promise<boolean> {
    if (near(sdk.getState(), x, z) && sdk.getState()?.player?.level === level) return true;
    await cheat(sdk, `tele ${level},${x >> 6},${z >> 6},${x & 63},${z & 63}`);
    const r = await waitUntil(sdk, s => near(s, x, z) && s.player?.level === level, { maxTicks: 20 });
    if (r.ok) await waitTicks(sdk, 3); // let the region and nearby entities load
    return r.ok;
}

/** Give each item (debug name) `n` times over, firing every command before waiting. */
export async function give(sdk: LabSdk, names: readonly string[], n = 1): Promise<void> {
    const before = sdk.getState()?.inventory.length ?? 0;
    await Promise.all(names.map(name => cheat(sdk, `give ${name} ${n}`)));
    await waitUntil(sdk, s => s.inventory.length >= Math.min(28, before + names.length), { maxTicks: Math.ceil(names.length / 2) + 10 });
    await waitTicks(sdk, 1);
}

export async function setstat(sdk: LabSdk, skill: string, level: number): Promise<void> {
    await cheat(sdk, `setstat ${skill} ${level}`);
    await waitTicks(sdk, 1);
}

/**
 * Stand in Varrock west bank with an empty inventory and a bank holding every
 * LAB_ITEMS item plus at least `ironOre` iron ore. Leaves the bank open.
 */
export async function bankFixture(session: Session, opts: { ironOre?: number } = {}): Promise<void> {
    const { sdk, bot } = session;
    if (!(await tele(sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z))) throw new Error('tele to Varrock west bank failed');
    const opened = await bot.openBank();
    if (!opened.success) throw new Error(`openBank: ${opened.message}`);
    await depositAll(sdk);
    const banked = new Set(sdk.getState()!.bank.items.map(i => i.name.toLowerCase().replace(/ /g, '_')));
    const missing = LAB_ITEMS.filter(n => !banked.has(n));
    if (missing.length) {
        await give(sdk, missing);
        await depositAll(sdk);
    }
    const ore = sdk.getState()!.bank.items.find(i => i.name === 'Iron ore')?.count ?? 0;
    const want = opts.ironOre ?? 100;
    if (ore < want) {
        await give(sdk, ['cert_iron_ore'], want - ore);
        await depositAll(sdk);
    }
}
