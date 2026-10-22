// The shelf reader's stop table, route planning and record shapes. Pure data and
// functions: no game session here, so all of it is unit-tested
// (stops.test.ts). The role that walks the route is shelf-reader.ts.
import type { ShopConfig, ShopState } from '../../sdk/types';
import { FARE, regionOf, voyagesBetween, type Region } from '../../speedrun/lib/ships';
import { isEastOfTollGate, TOLL_GP } from '../../speedrun/lib/toll-gate';

export interface Tile {
    x: number;
    z: number;
    /** Floor; 0 (the default) on the ground. Underground maps are level 0, 6,400 tiles north. */
    level?: number;
}

/**
 * Where a stop is, for fares: the four land masses a fresh account moves between.
 * Al Kharid is the mainland behind the toll gate (10 gp each way). Karamja and
 * Kandarin are reached by ship (30 gp a voyage, speedrun/lib/ships.ts); the land
 * route into Kandarin over White Wolf Mountain kills a 10-Hitpoints account, so
 * the reader never takes it.
 */
export type Zone = 'mainland' | 'alkharid' | 'karamja' | 'kandarin';

/** A door or trapdoor between the stand and the open map, which walkTo cannot path through. */
export type Entry =
    /** The Ice Mountain trapdoor down into the Dwarven Mine; the walk out climbs its ladder (underground.ts). */
    | { kind: 'trapdoor'; ground: Tile; below: Tile }
    /**
     * The Ranging Guild's diagonal door (ranging_guild_door.rs2): opens from outside
     * for current Ranged 40 and teleports the player two tiles through.
     */
    | { kind: 'guild-door'; door: Tile; outside: Tile; inside: Tile };

export interface Stop {
    key: string;
    /** The shop as players know it; the server's title is recorded from the open shop. */
    shop: string;
    /**
     * The shop's content inventory (the shopkeeper's `owned_shop`, or the inv a script
     * opens). Several when the world decides: Zaff opens memberstaffshop on a members
     * world and staffshop otherwise (zaff.rs2); the reader records the one whose
     * configured stock matches the shelf.
     */
    inv: readonly string[];
    /** Who offers Trade. */
    npc: RegExp;
    /** Walk target: the shopkeeper's spawn (openShop walks the last tiles itself). */
    stand: Tile;
    /** What markets wants from the shelf. */
    for: string;
    entry?: Entry;
    /** Current skill levels the stop needs; below them it is skipped (the reader never trains). */
    requires?: { ranged?: number };
    /** Not visited: kept as data only, with the reason. */
    configOnly?: string;
}

/** North Dwarven Mine by the Ice Mountain trapdoor (buyer.ts ICE_MOUNTAIN_TRAPDOOR): the south entrance lands among scorpions. */
const ICE_MOUNTAIN_TRAPDOOR: Entry = { kind: 'trapdoor', ground: { x: 3019, z: 3449 }, below: { x: 3019, z: 9849 } };

/** The guild door (m41_53, loc 2514) and the tiles either side the door script accepts (rune-arrows.ts). */
export const RANGING_GUILD_DOOR: Extract<Entry, { kind: 'guild-door' }> = {
    kind: 'guild-door',
    door: { x: 2658, z: 3438 },
    outside: { x: 2657, z: 3439 },
    inside: { x: 2659, z: 3437 }
};

/** Inside the Ranging Guild compound, around the door and Dargaud (rune-arrows.ts inGuild). */
export function inRangingGuild(p: Tile): boolean {
    const d = RANGING_GUILD_DOOR.door;
    return p.x >= d.x && p.x <= 2700 && p.z >= 3400 && p.z < d.z && p.x + p.z <= 6114;
}

/** General stores are run by a keeper and an assistant who open the same inventory. */
const GENERAL = /^shop (keeper|assistant)$/i;

/** Every stop the reader knows, keyed by markets' names. Spawns from wiki/npcs/*.md and wiki/shops/*.md. */
export const STOPS = {
    'general-lumbridge': { key: 'general-lumbridge', shop: 'Lumbridge General Store', inv: ['generalshop1'], npc: GENERAL, stand: { x: 3211, z: 3247 }, for: 'general stock and what players sold in' },
    gemtrader: { key: 'gemtrader', shop: 'Gem Trader, Al Kharid', inv: ['gemshop2'], npc: /^gem trader$/i, stand: { x: 3288, z: 3212 }, for: 'uncut and cut gems' },
    aubury: { key: 'aubury', shop: "Aubury's Rune Shop, Varrock", inv: ['runeshop'], npc: /^aubury$/i, stand: { x: 3253, z: 3401 }, for: 'elemental, mind, body, chaos and death runes' },
    'general-varrock': { key: 'general-varrock', shop: 'Varrock General Store', inv: ['generalshop2'], npc: GENERAL, stand: { x: 3217, z: 3413 }, for: 'general stock and what players sold in' },
    zaff: { key: 'zaff', shop: "Zaff's Superior Staffs, Varrock", inv: ['memberstaffshop', 'staffshop'], npc: /^zaff$/i, stand: { x: 3203, z: 3432 }, for: 'staves and battlestaves' },
    drogo: { key: 'drogo', shop: "Drogo's Mining Emporium, Dwarven Mine", inv: ['miningstore'], npc: /^drogo dwarf$/i, stand: { x: 3036, z: 9846 }, entry: ICE_MOUNTAIN_TRAPDOOR, for: 'ores and bars' },
    'general-falador': { key: 'general-falador', shop: 'Falador General Store', inv: ['generalshop4'], npc: GENERAL, stand: { x: 2957, z: 3387 }, for: 'general stock and what players sold in' },
    herquin: { key: 'herquin', shop: "Herquin's Gems, Falador", inv: ['gemshop'], npc: /^herquin$/i, stand: { x: 2944, z: 3334 }, for: 'gems' },
    grum: { key: 'grum', shop: "Grum's Gold Exchange, Port Sarim", inv: ['goldshop'], npc: /^grum$/i, stand: { x: 3013, z: 3248 }, for: 'gold jewellery' },
    betty: { key: 'betty', shop: "Betty's Magic Emporium, Port Sarim", inv: ['magicshop'], npc: /^betty$/i, stand: { x: 3013, z: 3258 }, for: 'runes' },
    jiminua: { key: 'jiminua', shop: "Jiminua's Jungle Store, Karamja", inv: ['junglestore'], npc: /^jiminua$/i, stand: { x: 2767, z: 3122 }, for: 'Antipoison and general stock' },
    davon: { key: 'davon', shop: "Davon's Amulet Store, Brimhaven", inv: ['amuletshop'], npc: /^davon$/i, stand: { x: 2803, z: 3152 }, for: 'amulets' },
    dargaud: {
        key: 'dargaud',
        shop: "Dargaud's Bow and Arrows, Ranging Guild",
        inv: ['ranging_guild_bowshop'],
        npc: /^bow and arrow salesman$/i,
        stand: { x: 2672, z: 3434 },
        entry: RANGING_GUILD_DOOR,
        requires: { ranged: 40 },
        for: 'rune arrows, arrowtips and bows'
    },
    hickton: { key: 'hickton', shop: 'Hicktons Archery Emporium, Catherby', inv: ['archeryshop2'], npc: /^hickton$/i, stand: { x: 2822, z: 3442 }, for: 'arrowtips' },
    magicguild: {
        key: 'magicguild',
        shop: 'Magic Guild Store, Yanille',
        inv: ['magicguildshop'],
        npc: /^magic store owner$/i,
        stand: { x: 2594, z: 3087, level: 1 },
        for: 'every elemental, catalytic and combination rune',
        configOnly: 'upstairs behind the Magic 66 guild door'
    },
    irksol: { key: 'irksol', shop: 'Irksol', inv: ['cheapringshop'], npc: /^irksol$/i, stand: { x: 3247, z: 9589 }, for: 'ruby rings', configOnly: 'not reachable by a fresh account' },
    lundail: {
        key: 'lundail',
        shop: "Lundail's Arena-side Rune Shop, Mage Arena",
        inv: ['magearena_runeshop'],
        npc: /^lundail$/i,
        stand: { x: 2536, z: 4718 },
        for: 'cosmic, law and death runes',
        configOnly: 'deep Wilderness: unsafe for a fresh account'
    }
} satisfies Record<string, Stop>;

export type StopKey = keyof typeof STOPS;

/**
 * The default route from a fresh spawn in Lumbridge: the Lumbridge general store
 * beside it, east through the toll gate to Al Kharid and back, north to Varrock
 * (Aubury, the general store, Zaff), west to Ice Mountain and down to the
 * Dwarven Mine, Falador (general store, Herquin), south to Port Sarim, the ship
 * to Karamja (Musa Point), across the island to Brimhaven, the ship to
 * Ardougne, north to the Ranging Guild and east to Catherby. 80 coins of fares:
 * the toll twice and two voyages.
 */
export const DEFAULT_ROUTE: StopKey[] = [
    'general-lumbridge',
    'gemtrader',
    'aubury',
    'general-varrock',
    'zaff',
    'drogo',
    'general-falador',
    'herquin',
    'grum',
    'betty',
    'jiminua',
    'davon',
    'dargaud',
    'hickton'
];

export function isStopKey(k: string): k is StopKey {
    return Object.hasOwn(STOPS, k);
}

export function stopOf(key: StopKey): Stop {
    return STOPS[key];
}

/** Parse `a,b,c` into stop keys; throws on an unknown name so a typo never silently shortens a route. */
export function parseStops(csv: string): StopKey[] {
    const keys = csv
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
    const unknown = keys.filter(k => !isStopKey(k));
    if (unknown.length) throw new Error(`unknown stop ${unknown.join(', ')}; known: ${Object.keys(STOPS).join(', ')}`);
    if (keys.length === 0) throw new Error('--stops is empty');
    return keys as StopKey[];
}

export function zoneOf(t: Tile): Zone {
    if (isEastOfTollGate(t)) return 'alkharid';
    return regionOf(t);
}

const regionOfZone = (z: Zone): Region => (z === 'alkharid' ? 'mainland' : z);

/** Coins to get from one zone to another: the toll for each crossing of the Al Kharid fence, 30 for each voyage. */
export function fareBetween(from: Zone, to: Zone): number {
    if (from === to) return 0;
    const toll = (from === 'alkharid' ? TOLL_GP : 0) + (to === 'alkharid' ? TOLL_GP : 0);
    return toll + voyagesBetween(regionOfZone(from), regionOfZone(to)).length * FARE;
}

export interface Situation {
    /** Where the account stands now. */
    zone: Zone;
    /** Coins in the inventory (the reader never touches the bank). */
    coins: number;
    /** Current Ranged level (the guild door checks the current level, not the base). */
    ranged: number;
}

export type Verdict = { go: true; fare: number } | { go: false; reason: string };

/**
 * Whether to visit `stop` from where the account is. Al Kharid counts its way
 * out too, so a short purse never strands the account behind the toll gate.
 */
export function judgeStop(stop: Stop, s: Situation): Verdict {
    if (stop.configOnly) return { go: false, reason: `config only: ${stop.configOnly}` };
    const need = stop.requires?.ranged;
    if (need !== undefined && s.ranged < need) return { go: false, reason: `Ranged ${s.ranged} is below ${need}: the guild door stays shut (the reader does not train)` };
    const to = zoneOf(stop.stand);
    const fare = fareBetween(s.zone, to) + (to === 'alkharid' ? TOLL_GP : 0);
    if (s.coins < fare) return { go: false, reason: `needs ${fare} coins for the fare from ${s.zone} to ${to} (and back out of Al Kharid), carries ${s.coins}` };
    return { go: true, fare };
}

// ------------------------------------------------------------------ prices

/** shop.rs2 calc_shop_value: the multiplier less haggle per unit of `diff`, clamped, scaled to the base cost. */
export function shopValue(baseCost: number, haggle: number, multiplier: number, diff: number): number {
    const off = Math.min(1000, Math.max(-5000, diff * haggle));
    return Math.floor((Math.max(100, multiplier - off) * baseCost) / 1000);
}

/**
 * The server's price to buy the next unit and the shop's offer for one, at
 * `count` on the shelf (shop.rs2 adjusted_item_cost_buying/_selling, price_mod):
 * the difference from the configured stock, or the whole count for stock
 * outside the base config (a general store's sold-in items).
 */
export function livePrices(baseCost: number, cfg: ShopConfig, count: number, stockBase: number | null): { buy: number; sell: number } {
    const diff = count - (stockBase ?? 0);
    return { buy: Math.max(1, shopValue(baseCost, cfg.haggle, cfg.sellMultiplier, diff)), sell: shopValue(baseCost, cfg.haggle, cfg.buyMultiplier, diff) };
}

// ------------------------------------------------------------------ records

/** One JSONL line per shelf item. */
export interface ItemRecord {
    kind: 'item';
    utc: string;
    stop: string;
    /** 1-based read number (several with --repeat). */
    read: number;
    shopTitle: string;
    /** The shop's content inventory. */
    inv: string;
    slot: number;
    itemId: number;
    name: string;
    /** The object's content (debug) name; null when this checkout's obj.pack lacks the id. */
    obj: string | null;
    /** On the shelf when the shop opened. */
    count: number;
    /** The configured stock the price is reckoned from; null for stock outside the base config, or without content. */
    stockBase: number | null;
    /** Whether the item is in the inventory's base config (false: sold in by players); null without content. */
    inBaseConfig: boolean | null;
    baseCost: number;
    /**
     * The SDK's price to buy one (StateCollector): computed from baseCost and
     * shopConfig as if the shelf held its configured stock. Wrong for any shelf
     * above or below that stock; see valuePrice.
     */
    buyPrice: number;
    /** The SDK's price the shop pays for one, with the same configured-stock assumption. */
    sellPrice: number;
    /** The server's own price to buy the next unit now, from the shop's Value option ("X: currently costs N gp."); null when no answer came. */
    valuePrice: number | null;
    /** livePrices at `count` from the content's stock config: the buy price should equal valuePrice; null without content or shop config. */
    computedBuyPrice: number | null;
    /** What the shop pays for one at `count` (no Value message exists for selling without the item in hand). */
    computedSellPrice: number | null;
    tick: number;
}

/** What the content says about the open shop, for one read; null when the checkout has no content. */
export interface ShelfContent {
    inv: string;
    /**
     * The shop's haggle (shop_delta). The SDK's shopConfig.haggle is always its
     * fallback, 10: varp shop_haggle is not transmitted to the client (shop.varp),
     * unlike shop_buy and shop_sell.
     */
    haggle: number | undefined;
    objName(id: number): string | undefined;
    /** Configured stock of an object; undefined when it is not in the base config. */
    stockBase(obj: string): number | undefined;
}

/** One JSONL line per shop visit, before its items. */
export interface ShopRecord {
    kind: 'shop';
    utc: string;
    stop: string;
    read: number;
    shopTitle: string;
    inv: string;
    /** As the SDK reports it: the multipliers are the server's, the haggle is always 10 (see `haggle`). */
    shopConfig: ShopConfig | null;
    /** The shop's real haggle from the content (shop_delta), which the computed prices use; null without content. */
    haggle: number | null;
    items: number;
    at: Tile;
    tick: number;
    /** Wall time and ticks of the walk (and any voyage) from the previous stop. */
    legMs: number;
    legTicks: number;
}

export interface SkipRecord {
    kind: 'skip';
    utc: string;
    stop: string;
    reason: string;
    tick: number;
}

export interface RouteRecord {
    kind: 'route';
    utc: string;
    account: string;
    stops: string[];
    repeat: number;
    every: number;
    coins: number;
    ranged: number;
    at: Tile;
    tick: number;
}

export interface DoneRecord {
    kind: 'done';
    utc: string;
    read: string[];
    skipped: string[];
    /** Stopped by a signal before the route ended. */
    aborted: boolean;
    wallMs: number;
    ticks: number;
    tick: number;
}

export type ShelfRecord = ItemRecord | ShopRecord | SkipRecord | RouteRecord | DoneRecord;

/** The server's reply to the shop's Value option (shop.rs2 [inv_button1,shop_template:inv]). */
const VALUE_MESSAGE = /^(.+): currently costs (\d+)gp\.$/;

export function parseValueMessage(text: string): { name: string; price: number } | null {
    const m = VALUE_MESSAGE.exec(text.trim());
    return m ? { name: m[1]!, price: Number(m[2]) } : null;
}

export interface ShelfRead {
    stop: string;
    read: number;
    utc: string;
    tick: number;
    at: Tile;
    legMs: number;
    legTicks: number;
    shop: Pick<ShopState, 'title' | 'shopItems' | 'shopConfig'>;
    /** Server Value prices by shelf slot. */
    values: ReadonlyMap<number, number>;
    /** The stop's inventory name when there is no content to say more. */
    inv: string;
    content: ShelfContent | null;
}

/** The shop line and one item line per shelf slot for one read of one shop. */
export function shelfRecords(r: ShelfRead): [ShopRecord, ...ItemRecord[]] {
    const inv = r.content?.inv ?? r.inv;
    const base = { utc: r.utc, stop: r.stop, read: r.read, shopTitle: r.shop.title, tick: r.tick };
    const haggle = r.content?.haggle ?? null;
    const reported = r.shop.shopConfig;
    const cfg = reported && haggle !== null ? { ...reported, haggle } : reported;
    const shop: ShopRecord = { kind: 'shop', ...base, inv, shopConfig: reported ?? null, haggle, items: r.shop.shopItems.length, at: r.at, legMs: r.legMs, legTicks: r.legTicks };
    const items = r.shop.shopItems.map((i): ItemRecord => {
        const obj = r.content?.objName(i.id) ?? null;
        const stockBase = r.content && obj !== null ? (r.content.stockBase(obj) ?? null) : null;
        const inBaseConfig = r.content && obj !== null ? stockBase !== null : null;
        const live = cfg && inBaseConfig !== null ? livePrices(i.baseCost, cfg, i.count, stockBase) : null;
        return {
            kind: 'item',
            ...base,
            inv,
            slot: i.slot,
            itemId: i.id,
            name: i.name,
            obj,
            count: i.count,
            stockBase,
            inBaseConfig,
            baseCost: i.baseCost,
            buyPrice: i.buyPrice,
            sellPrice: i.sellPrice,
            valuePrice: r.values.get(i.slot) ?? null,
            computedBuyPrice: live?.buy ?? null,
            computedSellPrice: live?.sell ?? null
        };
    });
    return [shop, ...items];
}

// ------------------------------------------------------------------ options

export interface Options {
    stops: StopKey[];
    /** JSONL file the records are appended to. */
    out: string | null;
    /** Reads of each stop on the route (1 = once). */
    repeat: number;
    /** Ticks between the starts of repeated reads of one stop. */
    every: number;
}

export function parseOptions(o: Record<string, unknown>): Options {
    const int = (key: string, fallback: number, min: number) => {
        const v = typeof o[key] === 'string' ? Number(o[key]) : o[key];
        if (v === undefined) return fallback;
        if (typeof v !== 'number' || !Number.isInteger(v) || v < min) throw new Error(`${key} must be an integer >= ${min}, got ${JSON.stringify(o[key])}`);
        return v;
    };
    const stops = o.stops === undefined ? [...DEFAULT_ROUTE] : Array.isArray(o.stops) ? parseStops(o.stops.join(',')) : parseStops(String(o.stops));
    return { stops, out: typeof o.out === 'string' && o.out ? o.out : null, repeat: int('repeat', 1, 1), every: int('every', 100, 0) };
}

/** `--stops a,b --out f --repeat 3 --every 200` (and `--key=value`) into role options. */
export function parseArgs(argv: string[]): Record<string, unknown> {
    const known = new Set(['stops', 'out', 'repeat', 'every']);
    const out: Record<string, unknown> = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]!;
        if (!a.startsWith('--')) continue;
        const eq = a.indexOf('=');
        const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
        if (!known.has(key)) throw new Error(`unknown option ${a}; known: --stops, --out, --repeat, --every`);
        const value = eq > 0 ? a.slice(eq + 1) : argv[++i];
        if (value === undefined) throw new Error(`${a} needs a value`);
        out[key] = key === 'repeat' || key === 'every' ? Number(value) : value;
    }
    return out;
}
