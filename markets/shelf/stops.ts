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

/** Every stop the reader knows, keyed by markets' names. Spawns from wiki/npcs/*.md. */
export const STOPS = {
    gemtrader: { key: 'gemtrader', shop: 'Gem Trader, Al Kharid', npc: /^gem trader$/i, stand: { x: 3288, z: 3212 }, for: 'uncut and cut gems' },
    aubury: { key: 'aubury', shop: "Aubury's Rune Shop, Varrock", npc: /^aubury$/i, stand: { x: 3253, z: 3401 }, for: 'elemental, mind, body, chaos and death runes' },
    drogo: { key: 'drogo', shop: "Drogo's Mining Emporium, Dwarven Mine", npc: /^drogo dwarf$/i, stand: { x: 3036, z: 9846 }, entry: ICE_MOUNTAIN_TRAPDOOR, for: 'ores and bars' },
    herquin: { key: 'herquin', shop: "Herquin's Gems, Falador", npc: /^herquin$/i, stand: { x: 2944, z: 3334 }, for: 'gems' },
    grum: { key: 'grum', shop: "Grum's Gold Exchange, Port Sarim", npc: /^grum$/i, stand: { x: 3013, z: 3248 }, for: 'gold jewellery' },
    betty: { key: 'betty', shop: "Betty's Magic Emporium, Port Sarim", npc: /^betty$/i, stand: { x: 3013, z: 3258 }, for: 'runes' },
    jiminua: { key: 'jiminua', shop: "Jiminua's Jungle Store, Karamja", npc: /^jiminua$/i, stand: { x: 2767, z: 3122 }, for: 'Antipoison and general stock' },
    davon: { key: 'davon', shop: "Davon's Amulet Store, Brimhaven", npc: /^davon$/i, stand: { x: 2803, z: 3152 }, for: 'amulets' },
    dargaud: {
        key: 'dargaud',
        shop: "Dargaud's Bow and Arrows, Ranging Guild",
        npc: /^bow and arrow salesman$/i,
        stand: { x: 2672, z: 3434 },
        entry: RANGING_GUILD_DOOR,
        requires: { ranged: 40 },
        for: 'rune arrows, arrowtips and bows'
    },
    hickton: { key: 'hickton', shop: 'Hicktons Archery Emporium, Catherby', npc: /^hickton$/i, stand: { x: 2822, z: 3442 }, for: 'arrowtips' },
    magicguild: {
        key: 'magicguild',
        shop: 'Magic Guild Store, Yanille',
        npc: /^magic store owner$/i,
        stand: { x: 2594, z: 3087, level: 1 },
        for: 'every elemental, catalytic and combination rune',
        configOnly: 'upstairs behind the Magic 66 guild door'
    },
    irksol: { key: 'irksol', shop: 'Irksol', npc: /^irksol$/i, stand: { x: 3247, z: 9589 }, for: 'ruby rings', configOnly: 'not reachable by a fresh account' },
    lundail: {
        key: 'lundail',
        shop: "Lundail's Arena-side Rune Shop, Mage Arena",
        npc: /^lundail$/i,
        stand: { x: 2536, z: 4718 },
        for: 'cosmic, law and death runes',
        configOnly: 'deep Wilderness: unsafe for a fresh account'
    }
} satisfies Record<string, Stop>;

export type StopKey = keyof typeof STOPS;

/**
 * The default route from a fresh spawn in Lumbridge: east through the toll gate
 * to Al Kharid and back, north to Varrock, west to Ice Mountain and down to the
 * Dwarven Mine, Falador, south to Port Sarim, the ship to Karamja (Musa Point),
 * across the island to Brimhaven, the ship to Ardougne, north to the Ranging
 * Guild and east to Catherby. 80 coins of fares: the toll twice and two voyages.
 */
export const DEFAULT_ROUTE: StopKey[] = ['gemtrader', 'aubury', 'drogo', 'herquin', 'grum', 'betty', 'jiminua', 'davon', 'dargaud', 'hickton'];

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

// ------------------------------------------------------------------ records

/** One JSONL line per shelf item. */
export interface ItemRecord {
    kind: 'item';
    utc: string;
    stop: string;
    /** 1-based read number (several with --repeat). */
    read: number;
    shopTitle: string;
    slot: number;
    itemId: number;
    name: string;
    /** On the shelf when the shop opened. */
    count: number;
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
    tick: number;
}

/** One JSONL line per shop visit, before its items. */
export interface ShopRecord {
    kind: 'shop';
    utc: string;
    stop: string;
    read: number;
    shopTitle: string;
    shopConfig: ShopConfig | null;
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
    /** Server Value prices by item name, lower-cased. */
    values: ReadonlyMap<string, number>;
}

/** The shop line and one item line per shelf slot for one read of one shop. */
export function shelfRecords(r: ShelfRead): [ShopRecord, ...ItemRecord[]] {
    const base = { utc: r.utc, stop: r.stop, read: r.read, shopTitle: r.shop.title, tick: r.tick };
    const shop: ShopRecord = { kind: 'shop', ...base, shopConfig: r.shop.shopConfig ?? null, items: r.shop.shopItems.length, at: r.at, legMs: r.legMs, legTicks: r.legTicks };
    const items = r.shop.shopItems.map(
        (i): ItemRecord => ({
            kind: 'item',
            ...base,
            slot: i.slot,
            itemId: i.id,
            name: i.name,
            count: i.count,
            baseCost: i.baseCost,
            buyPrice: i.buyPrice,
            sellPrice: i.sellPrice,
            valuePrice: r.values.get(i.name.toLowerCase()) ?? null
        })
    );
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
