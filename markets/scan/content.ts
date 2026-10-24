// Reads the game content the wealth scan prices: every obj's store cost, every shop's stock
// and multipliers, where shopkeepers stand, ground spawns, and the thieving and runecraft
// tables. Parsers take text so tests run on fixtures; `loadContent` walks the checkout.
//
// Sources (all under server/content):
// - scripts/**/*.obj   `[debugname]` blocks; cost defaults to 1, tradeable to yes, members to no
//                      (server/engine/src/cache/config/ObjType.ts). `_unpack/` is packed too.
// - pack/obj.pack      ids; a note is the obj `cert_<debugname>` and copies its item's cost.
// - scripts/**/*.inv   `stockN=obj,count,rate`: the base count and the restock period in ticks.
// - scripts/**/*.npc   `param=owned_shop,inv` plus shop_sell/buy_multiplier and shop_delta;
//                      missing params take shopkeeper.param's defaults (sell 100, buy 60, delta 10).
// - scripts/**/*.rs2   `~openshop(inv, buy, sell, delta, "title")` calls with literal arguments.
// - maps/mX_Z.jm2      `==== OBJ ====` and `==== NPC ====` lines `level x z: id [count]`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONTENT_DIR = join(import.meta.dir, '..', '..', 'server', 'content');

/** One `[name]` block of a config file: its `key=value` lines in order. */
export interface ConfigBlock {
    name: string;
    lines: { key: string; value: string }[];
}

export function parseConfigBlocks(text: string): ConfigBlock[] {
    const blocks: ConfigBlock[] = [];
    let cur: ConfigBlock | null = null;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('//')) continue;
        const head = /^\[([^\]]+)\]$/.exec(line);
        if (head) {
            cur = { name: head[1]!, lines: [] };
            blocks.push(cur);
            continue;
        }
        const eq = line.indexOf('=');
        if (!cur || eq <= 0) continue;
        cur.lines.push({ key: line.slice(0, eq), value: line.slice(eq + 1) });
    }
    return blocks;
}

function first(block: ConfigBlock, key: string): string | undefined {
    return block.lines.find(l => l.key === key)?.value;
}

function yes(v: string | undefined): boolean {
    return v === 'yes' || v === 'true';
}

/** `id=debugname` lines (obj.pack, npc.pack). */
export function parsePack(text: string): Map<string, number> {
    const ids = new Map<string, number>();
    for (const line of text.split('\n')) {
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const id = Number(line.slice(0, eq));
        const name = line.slice(eq + 1).trim();
        if (Number.isInteger(id) && name) ids.set(name, id);
    }
    return ids;
}

export interface Obj {
    /** Debugname, the key content uses. */
    name: string;
    id: number | null;
    /** In-game name. */
    display: string;
    /** ObjType.cost: what the bank board counts, per unit. */
    cost: number;
    stackable: boolean;
    members: boolean;
    tradeable: boolean;
    /** Ticks a ground spawn of this obj takes to come back. */
    respawnrate: number;
    /** The note's id, or null when the obj has none (a note's cost is always its item's). */
    note: number | null;
}

export function parseObjs(texts: string[], pack: Map<string, number> = new Map()): Map<string, Obj> {
    const objs = new Map<string, Obj>();
    for (const text of texts) {
        for (const b of parseConfigBlocks(text)) {
            if (b.name.startsWith('cert_')) continue;
            const cost = first(b, 'cost');
            const respawn = first(b, 'respawnrate');
            objs.set(b.name, {
                name: b.name,
                id: pack.get(b.name) ?? null,
                display: first(b, 'name') ?? b.name,
                cost: cost === undefined ? 1 : Number(cost),
                stackable: yes(first(b, 'stackable')),
                members: yes(first(b, 'members')),
                tradeable: first(b, 'tradeable') === undefined ? true : yes(first(b, 'tradeable')),
                respawnrate: respawn === undefined ? 100 : Number(respawn),
                note: pack.get(`cert_${b.name}`) ?? null,
            });
        }
    }
    return objs;
}

export interface StockLine {
    obj: string;
    /** The base count the shop restocks toward. */
    base: number;
    /** Ticks between restocks of one unit, on the world clock (World.ts `tick % stockrate`). */
    rate: number;
}

export interface Inv {
    name: string;
    stock: StockLine[];
    restock: boolean;
    /** A general store: buys anything and lets unlisted stock decay by one a minute. */
    allstock: boolean;
}

export function parseInvs(texts: string[]): Map<string, Inv> {
    const invs = new Map<string, Inv>();
    for (const text of texts) {
        for (const b of parseConfigBlocks(text)) {
            const stock: StockLine[] = [];
            for (const l of b.lines) {
                if (!/^stock\d+$/.test(l.key)) continue;
                const [obj, count, rate] = l.value.split(',');
                stock.push({ obj: obj!, base: Number(count), rate: Number(rate) });
            }
            invs.set(b.name, { name: b.name, stock, restock: yes(first(b, 'restock')), allstock: yes(first(b, 'allstock')) });
        }
    }
    return invs;
}

/** A way to open a shop: an NPC's params or a script's literal ~openshop call. */
export interface ShopOpener {
    /** The NPC debugname, or the script file for a ~openshop call. */
    keeper: string;
    keeperDisplay: string;
    inv: string;
    /** Multiplier (per mille of cost) the shop sells to players at base stock. */
    sell: number;
    /** Multiplier (per mille of cost) the shop pays players at base stock. */
    buy: number;
    delta: number;
    title: string;
    source: 'npc' | 'script';
    /** True when a multiplier fell back to shopkeeper.param's default. */
    defaulted: boolean;
}

const SHOP_DEFAULTS = { sell: 100, buy: 60, delta: 10 };

export function parseNpcShops(texts: string[]): ShopOpener[] {
    const out: ShopOpener[] = [];
    for (const text of texts) {
        for (const b of parseConfigBlocks(text)) {
            const params = new Map<string, string>();
            for (const l of b.lines) {
                if (l.key !== 'param') continue;
                const comma = l.value.indexOf(',');
                params.set(l.value.slice(0, comma), l.value.slice(comma + 1));
            }
            const inv = params.get('owned_shop');
            if (!inv || inv === 'null') continue;
            const sell = params.get('shop_sell_multiplier');
            const buy = params.get('shop_buy_multiplier');
            const delta = params.get('shop_delta');
            out.push({
                keeper: b.name,
                keeperDisplay: first(b, 'name') ?? b.name,
                inv,
                sell: sell === undefined ? SHOP_DEFAULTS.sell : Number(sell),
                buy: buy === undefined ? SHOP_DEFAULTS.buy : Number(buy),
                delta: delta === undefined ? SHOP_DEFAULTS.delta : Number(delta),
                title: params.get('shop_title') ?? 'Shop.',
                source: 'npc',
                defaulted: sell === undefined || buy === undefined || delta === undefined,
            });
        }
    }
    return out;
}

/** `~openshop(inv, buy, sell, delta, "title")` calls whose arguments are literals. */
export function parseScriptShops(texts: { file: string; text: string }[]): ShopOpener[] {
    const out: ShopOpener[] = [];
    const re = /~openshop\(\s*([a-z0-9_]+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"([^"]*)"\s*\)/g;
    for (const { file, text } of texts) {
        for (const m of text.matchAll(re)) {
            out.push({
                keeper: file,
                keeperDisplay: m[5]!,
                inv: m[1]!,
                buy: Number(m[2]),
                sell: Number(m[3]),
                delta: Number(m[4]),
                title: m[5]!,
                source: 'script',
                defaulted: false,
            });
        }
    }
    return out;
}

export interface MapSpawn {
    level: number;
    x: number;
    z: number;
    id: number;
    count: number;
}

/** The OBJ or NPC section of one `mX_Z.jm2` map file, in absolute tile coordinates. */
export function parseMapSection(file: string, text: string, section: 'OBJ' | 'NPC' | 'LOC'): MapSpawn[] {
    const sq = /m(\d+)_(\d+)/.exec(file);
    if (!sq) return [];
    const baseX = Number(sq[1]) * 64;
    const baseZ = Number(sq[2]) * 64;
    const out: MapSpawn[] = [];
    let inSection = false;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (line.startsWith('====')) {
            inSection = line === `==== ${section} ====`;
            continue;
        }
        if (!inSection) continue;
        const m = /^(\d+) (\d+) (\d+): (\d+)(?: (\d+))?/.exec(line);
        if (!m) continue;
        out.push({ level: Number(m[1]), x: baseX + Number(m[2]), z: baseZ + Number(m[3]), id: Number(m[4]), count: m[5] === undefined ? 1 : Number(m[5]) });
    }
    return out;
}

export interface Loot {
    obj: string;
    min: number;
    max: number;
    /** Rarity numerator. */
    weight: number;
}

export interface Pickpocket {
    row: string;
    npcs: string[];
    level: number;
    stunTicks: number;
    /** stat_random low and high (out of 256, interpolated from level 1 to 99). */
    chance: [number, number];
    loot: Loot[];
}

export function parsePickpockets(text: string): Pickpocket[] {
    return parseConfigBlocks(text).filter(b => first(b, 'table') === 'pickpocket').map(b => {
        const data = b.lines.filter(l => l.key === 'data').map(l => l.value.split(','));
        const field = (k: string) => data.filter(d => d[0] === k).map(d => d.slice(1));
        const chance = field('success_chance')[0] ?? ['0', '0'];
        return {
            row: b.name,
            npcs: field('npc').map(d => d[0]!),
            level: Number(field('level')[0]?.[0] ?? 1),
            stunTicks: Number(field('stun_ticks')[0]?.[0] ?? 0),
            chance: [Number(chance[0]), Number(chance[1])],
            loot: field('loot').map(d => ({ obj: d[0]!, min: Number(d[1]), max: Number(d[2]), weight: Number(d[3]) })),
        };
    });
}

export interface Stall {
    row: string;
    loc: string;
    level: number;
    respawnTicks: number;
    loot: Loot[];
    lootTotal: number;
}

export function parseStalls(text: string): Stall[] {
    return parseConfigBlocks(text).filter(b => first(b, 'table') === 'stealing').map(b => {
        const data = b.lines.filter(l => l.key === 'data').map(l => l.value.split(','));
        const field = (k: string) => data.filter(d => d[0] === k).map(d => d.slice(1));
        return {
            row: b.name,
            loc: field('loc')[0]?.[0] ?? b.name,
            level: Number(field('level')[0]?.[0] ?? 1),
            respawnTicks: Number(field('respawn_ticks')[0]?.[0] ?? 0),
            loot: field('loot').map(d => ({ obj: d[0]!, min: Number(d[1]), max: Number(d[2]), weight: Number(d[3]) })),
            lootTotal: Number(field('loot_total')[0]?.[0] ?? 0),
        };
    });
}

export interface Altar {
    row: string;
    level: number;
    rune: string;
    /** Runes per essence = floor(level / multiplier) + 1 (runecraft.rs2); null when the altar has none. */
    multiplier: number | null;
}

export function parseAltars(text: string): Altar[] {
    return parseConfigBlocks(text).filter(b => first(b, 'table') === 'runecraft_table').map(b => {
        const data = new Map(b.lines.filter(l => l.key === 'data').map(l => {
            const c = l.value.indexOf(',');
            return [l.value.slice(0, c), l.value.slice(c + 1)] as const;
        }));
        return {
            row: b.name,
            level: Number(data.get('level') ?? 1),
            rune: data.get('rune') ?? '',
            multiplier: data.has('multiplier') ? Number(data.get('multiplier')) : null,
        };
    });
}

export interface MineRow {
    row: string;
    rocks: string[];
    /** Null for the gem rock, which rolls gem_rock_table instead. */
    output: string | null;
    level: number;
    chance: [number, number];
    /** Base respawn in ticks; the engine shortens it on a busy world (mining.md: iron 19 -> 13 at ~1,260 players). */
    respawn: number;
    /** Map spawns of any of `rocks`. */
    count: number;
    /** Spawns per 64x64 map square: one login works one site. */
    sites: Record<string, number>;
}

export function parseMineRows(text: string): MineRow[] {
    return parseConfigBlocks(text).filter(b => first(b, 'table') === 'mining_table').map(b => {
        const data = b.lines.filter(l => l.key === 'data').map(l => l.value.split(','));
        const field = (k: string) => data.filter(d => d[0] === k).map(d => d.slice(1));
        const chance = field('rock_successchance')[0] ?? ['0', '0'];
        return {
            row: b.name,
            rocks: field('rock').map(d => d[0]!),
            output: field('rock_output')[0]?.[0] ?? null,
            level: Number(field('rock_level')[0]?.[0] ?? 1),
            chance: [Number(chance[0]), Number(chance[1])],
            respawn: Number(field('rock_respawnrate')[0]?.[0] ?? 0),
            count: 0,
            sites: {},
        };
    });
}

/** A weighted drop table (`table=drop_table`, `data=drop,obj,count,weight`). */
export function parseDropTable(text: string): { total: number; drops: { obj: string; n: number; weight: number }[] } {
    const b = parseConfigBlocks(text)[0];
    const data = (b?.lines ?? []).filter(l => l.key === 'data').map(l => l.value.split(','));
    return {
        total: Number(data.find(d => d[0] === 'total')?.[1] ?? 0),
        drops: data.filter(d => d[0] === 'drop').map(d => ({ obj: d[1]!, n: Number(d[2]), weight: Number(d[3]) })),
    };
}

export interface Content {
    mines: MineRow[];
    gemRockTable: ReturnType<typeof parseDropTable>;
    objs: Map<string, Obj>;
    invs: Map<string, Inv>;
    shops: ShopOpener[];
    /** Shopkeeper NPC debugname -> spawn tiles. */
    npcSpawns: Map<string, { x: number; z: number; level: number }[]>;
    groundObjs: (MapSpawn & { obj: string })[];
    pickpockets: Pickpocket[];
    stalls: Stall[];
    altars: Altar[];
}

function walk(dir: string, ext: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, ext, out);
        else if (e.name.endsWith(ext)) out.push(p);
    }
    return out;
}

const read = (p: string) => readFileSync(p, 'utf8');

export function loadContent(dir = CONTENT_DIR): Content {
    const scripts = join(dir, 'scripts');
    const objPack = parsePack(read(join(dir, 'pack', 'obj.pack')));
    const npcPack = parsePack(read(join(dir, 'pack', 'npc.pack')));
    const locPack = parsePack(read(join(dir, 'pack', 'loc.pack')));
    const locById = new Map([...locPack].map(([n, id]) => [id, n]));
    const mines = parseMineRows(read(join(scripts, 'skill_mining', 'configs', 'mine.dbrow')));
    const rockRow = new Map<string, MineRow>();
    for (const m of mines) for (const r of m.rocks) rockRow.set(r, m);
    const npcById = new Map([...npcPack].map(([n, id]) => [id, n]));
    const objById = new Map([...objPack].map(([n, id]) => [id, n]));
    const objs = parseObjs(walk(scripts, '.obj').map(read), objPack);
    const invs = parseInvs(walk(scripts, '.inv').map(read));
    const shops = [
        ...parseNpcShops(walk(scripts, '.npc').map(read)),
        ...parseScriptShops(walk(scripts, '.rs2').map(p => ({ file: p.slice(scripts.length + 1), text: read(p) })).filter(f => f.text.includes('~openshop('))),
    ];
    const keepers = new Set(shops.filter(s => s.source === 'npc').map(s => s.keeper));
    const npcSpawns = new Map<string, { x: number; z: number; level: number }[]>();
    const groundObjs: (MapSpawn & { obj: string })[] = [];
    for (const file of walk(join(dir, 'maps'), '.jm2')) {
        const text = read(file);
        for (const s of parseMapSection(file, text, 'NPC')) {
            const name = npcById.get(s.id);
            if (!name || !keepers.has(name)) continue;
            const list = npcSpawns.get(name) ?? [];
            list.push({ x: s.x, z: s.z, level: s.level });
            npcSpawns.set(name, list);
        }
        for (const s of parseMapSection(file, text, 'OBJ')) {
            const obj = objById.get(s.id);
            if (obj) groundObjs.push({ ...s, obj });
        }
        for (const s of parseMapSection(file, text, 'LOC')) {
            const m = rockRow.get(locById.get(s.id) ?? '');
            if (!m) continue;
            m.count++;
            const sq = `${s.x >> 6}_${s.z >> 6}`;
            m.sites[sq] = (m.sites[sq] ?? 0) + 1;
        }
    }
    const sk = (p: string) => read(join(scripts, p));
    return {
        mines,
        gemRockTable: parseDropTable(sk('skill_mining/configs/gem_rock_table.dbrow')),
        objs,
        invs,
        shops,
        npcSpawns,
        groundObjs,
        pickpockets: parsePickpockets(sk('skill_thieving/configs/pickpocking/pickpocket.dbrow')),
        stalls: parseStalls(sk('skill_thieving/configs/stalls/stealing.dbrow')),
        altars: parseAltars(sk('skill_runecraft/configs/runecraft.dbrow')),
    };
}
