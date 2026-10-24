/**
 * Where an account without a usable pickaxe gets one: the pickaxe stage, before iron's Mining. Pure; stages.ts walks it.
 *
 * From its bank when the runner last saw one there; else a bronze pickaxe from the shop on its side of the sea: Bob's
 * Brilliant Axes in Lumbridge, beside the spawn and the Lumbridge men, or Aemad's Adventuring Supplies in East
 * Ardougne (lumbridge.inv axeshop, ardougne_east.inv adventurershop; pickaxes.obj cost 1). An account that died has
 * lost the tutorial's pickaxe, and a fresh one has no coins in its pack (the tutorial banks its 25), so on the
 * mainland the stage earns the price on the men first; on the Ardougne side it takes the coins from the bank. An
 * account on Karamja, which has no shop on any route of ours, sails to the mainland first.
 *
 * A bank never seen this run counts as holding no pickaxe: a fresh account's holds only the tutorial's coins, and a
 * detour to Draynor to find that out costs more than Bob's 1 coin.
 */
import { BANKS, SHOPS, type ShopSpec } from '../../speedrun/helpers/buyer';
import { regionOf, type Tile } from '../../speedrun/lib/ships';
import { PICKAXES } from '../../speedrun/skills/mining';

/** Enough coins for a bronze pickaxe in either shop: cost 1, and Aemad sells at 130%. */
export const PICKAXE_COINS = 2;
export const BRONZE_PICKAXE = /^bronze pickaxe$/i;

type Named = { name: string };

/** The best pickaxe among `items` usable at `mining` (pickaxes.obj levelrequire; best first in PICKAXES), or null. */
export function bestPickaxe<T extends Named>(items: readonly T[], mining: number): T | null {
    for (const p of PICKAXES) {
        if (mining < p.level) continue;
        const it = items.find(i => p.name.test(i.name));
        if (it) return it;
    }
    return null;
}

/** The stage's goal: a pickaxe usable at the account's Mining level, carried or wielded. */
export const hasPickaxe = (s: { inventory: readonly Named[]; equipment: readonly Named[] }, mining: number): boolean => bestPickaxe([...s.inventory, ...s.equipment], mining) !== null;

export interface PickaxeSide {
    bank: Tile;
    shop: ShopSpec;
    /** How an empty pack gets the price: the Lumbridge men beside Bob, or the bank. */
    coins: 'earn' | 'bank';
}

export const SIDES: Readonly<Record<'mainland' | 'kandarin', PickaxeSide>> = {
    mainland: { bank: BANKS.draynor, shop: SHOPS.bob!, coins: 'earn' },
    kandarin: { bank: BANKS.ardougneSouth, shop: SHOPS.aemad!, coins: 'bank' }
};

export type PickaxeStep =
    | { do: 'sail'; to: Tile }
    | { do: 'bank'; at: Tile; take: 'pickaxe' | 'coins' }
    | { do: 'earn'; until: number }
    | { do: 'buy'; shop: ShopSpec };

export interface PickaxeInput {
    at: Tile;
    /** The bank at the runner's last sight of it, or null when not seen this run. */
    bank: readonly Named[] | null;
    coins: number;
    mining: number;
}

/**
 * The steps to a pickaxe, in order. The walker stops as soon as one is held, so a bank whose pickaxe has gone since
 * it was seen falls through to the shop.
 */
export function pickaxeSteps(i: PickaxeInput): PickaxeStep[] {
    const out: PickaxeStep[] = [];
    let region = regionOf(i.at);
    if (region === 'karamja') {
        out.push({ do: 'sail', to: SIDES.mainland.shop.stand });
        region = 'mainland';
    }
    const side = SIDES[region];
    if (i.bank && bestPickaxe(i.bank, i.mining)) out.push({ do: 'bank', at: side.bank, take: 'pickaxe' });
    if (i.coins < PICKAXE_COINS) out.push(side.coins === 'earn' ? { do: 'earn', until: PICKAXE_COINS } : { do: 'bank', at: side.bank, take: 'coins' });
    out.push({ do: 'buy', shop: side.shop });
    return out;
}
