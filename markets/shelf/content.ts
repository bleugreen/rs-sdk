// What the server's content says about a shop, read from this checkout: each
// inventory's configured stock (server/content/scripts/**/*.inv, `stockN=obj,count,rate`),
// which shopkeeper owns which inventory (*.npc `param=owned_shop,<inv>`), and
// object debug names by id (speedrun/lib/obj-pack.ts). The reader uses it to name
// every shelf item's inventory and object and to flag stock outside the base
// config; the live price itself always comes from the server (the Value option).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { objPack } from '../../speedrun/lib/obj-pack';

export const CONTENT_SCRIPTS = resolve(import.meta.dir, '..', '..', 'server', 'content', 'scripts');

export interface StockLine {
    obj: string;
    count: number;
    /** Ticks per unit restocked. */
    rate: number;
}

/** `[inv]` blocks and their `stockN=obj,count,rate` lines. */
export function parseInvConfigs(text: string, into = new Map<string, StockLine[]>()): Map<string, StockLine[]> {
    let inv: string | null = null;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        const head = /^\[([^\]]+)\]$/.exec(line);
        if (head) {
            inv = head[1]!;
            into.set(inv, []);
            continue;
        }
        const stock = /^stock\d+=([^,]+),(\d+)(?:,(\d+))?/.exec(line);
        if (inv && stock) into.get(inv)!.push({ obj: stock[1]!, count: Number(stock[2]), rate: Number(stock[3] ?? 0) });
    }
    return into;
}

/** A shop's price parameters (shop.rs2 openshop): multipliers and the haggle, per mille of the base cost. */
export interface ShopParams {
    buy?: number;
    sell?: number;
    /** shop_delta: the price moves haggle/1000 of the base cost per unit away from the configured stock. */
    haggle?: number;
}

export interface NpcShop extends ShopParams {
    debug: string;
    name: string;
    inv: string;
}

/** NPC configs that own a shop: `[debug]`, `name=`, `param=owned_shop,<inv>` and its price params. */
export function parseNpcShops(text: string): NpcShop[] {
    const out: NpcShop[] = [];
    let cur: (Partial<NpcShop> & { debug: string; name: string }) | null = null;
    const flush = () => {
        if (cur?.inv) out.push(cur as NpcShop);
    };
    const param = (line: string, key: string) => (line.startsWith(`param=${key},`) ? Number(line.slice(`param=${key},`.length)) : undefined);
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        const head = /^\[([^\]]+)\]$/.exec(line);
        if (head) {
            flush();
            cur = { debug: head[1]!, name: '' };
        } else if (!cur) continue;
        else if (line.startsWith('name=')) cur.name = line.slice(5);
        else if (line.startsWith('param=owned_shop,')) cur.inv = line.slice('param=owned_shop,'.length);
        else {
            cur.buy = param(line, 'shop_buy_multiplier') ?? cur.buy;
            cur.sell = param(line, 'shop_sell_multiplier') ?? cur.sell;
            cur.haggle = param(line, 'shop_delta') ?? cur.haggle;
        }
    }
    flush();
    return out;
}

/** Shops a script opens itself: `~openshop(<inv>, <buy>, <sell>, <haggle>, "<title>")` (Zaff's). */
export function parseScriptShops(text: string): Map<string, ShopParams> {
    const out = new Map<string, ShopParams>();
    for (const m of text.matchAll(/~openshop\((\w+),\s*(\d+),\s*(\d+),\s*(\d+),/g)) out.set(m[1]!, { buy: Number(m[2]), sell: Number(m[3]), haggle: Number(m[4]) });
    return out;
}

function filesUnder(dir: string, ext: string): string[] {
    return (readdirSync(dir, { recursive: true }) as string[]).filter(f => f.endsWith(ext)).map(f => join(dir, f));
}

export interface Content {
    /** An inventory's configured stock; undefined for an inventory the content does not define. */
    stock(inv: string): readonly StockLine[] | undefined;
    /** An object's debug name by id. */
    objName(id: number): string | undefined;
    /** An inventory's price params from its shopkeeper's config or the script that opens it. */
    shopParams(inv: string): ShopParams | undefined;
}

let loaded: Content | null = null;

/** This checkout's content, read once. Throws when the checkout has no server content. */
export function loadContent(): Content {
    if (loaded) return loaded;
    if (!existsSync(CONTENT_SCRIPTS)) throw new Error(`shop content needs ${CONTENT_SCRIPTS}, which this checkout does not have`);
    const invs = new Map<string, StockLine[]>();
    for (const f of filesUnder(CONTENT_SCRIPTS, '.inv')) parseInvConfigs(readFileSync(f, 'utf8'), invs);
    const params = new Map<string, ShopParams>();
    for (const f of filesUnder(CONTENT_SCRIPTS, '.rs2')) {
        const text = readFileSync(f, 'utf8');
        if (text.includes('~openshop(')) for (const [inv, p] of parseScriptShops(text)) params.set(inv, p);
    }
    for (const n of contentNpcShops()) if (!params.has(n.inv)) params.set(n.inv, { buy: n.buy, sell: n.sell, haggle: n.haggle });
    const pack = objPack();
    loaded = { stock: inv => invs.get(inv), objName: id => pack.names.get(id), shopParams: inv => params.get(inv) };
    return loaded;
}

/** Every shop-owning NPC in the content (for checking the stop table). */
export function contentNpcShops(): NpcShop[] {
    return filesUnder(CONTENT_SCRIPTS, '.npc').flatMap(f => parseNpcShops(readFileSync(f, 'utf8')));
}

/** Of a stop's candidate inventories, the one whose configured stock is most of what is on the shelf. */
export function chooseInv(candidates: readonly string[], content: Content, shelfObjs: readonly (string | null)[]): string {
    if (candidates.length === 1) return candidates[0]!;
    const score = (inv: string) => {
        const base = new Set((content.stock(inv) ?? []).map(s => s.obj));
        return shelfObjs.filter(o => o !== null && base.has(o)).length;
    };
    return [...candidates].sort((a, b) => score(b) - score(a))[0]!;
}
