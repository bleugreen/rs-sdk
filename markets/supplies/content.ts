// Reads every NPC shop out of the game content: the shop invs (`*.inv`, `_unpack/` included), the
// shopkeeper NPCs that own them (`param=owned_shop` and the three price params) or the scripts that
// open them (`~openshop(inv, buy, sell, delta, title)`), the objs' `cost=`, and the shopkeepers'
// spawn tiles from the maps. Pure parsing over file text; `loadContent` does the file walk.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/** One `stockN=obj,count[,rate]` line. A line without a rate never restocks (the packer writes 0, and `tick % 0` is never 0). */
export interface StockLine {
    obj: string;
    /** The configured (base) stock: the shelf level the engine restocks towards, and the price's zero point. */
    count: number;
    /** Ticks per unit restocked while below `count` (World.ts, on the global tick clock); 0 for none. */
    rate: number;
}

export interface ShopInv {
    name: string;
    file: string;
    scope: string;
    restock: boolean;
    allstock: boolean;
    stock: StockLine[];
}

/** Who opens a shop, and at what prices (shop.rs2 `openshop` / `openshop_activenpc`). */
export interface ShopOwner {
    inv: string;
    /** The NPC debugname, or the opening script's file name for a scripted shop. */
    npc: string;
    npcName?: string;
    title?: string;
    /** `shop_sell_multiplier`: what the shop charges, per mille of cost at base stock. */
    sell: number;
    /** `shop_buy_multiplier`: what the shop pays. */
    buy: number;
    /** `shop_delta`: per-mille change per unit away from base stock. */
    delta: number;
    file: string;
    scripted: boolean;
}

export interface Obj {
    name: string;
    debugname: string;
    cost: number;
    members: boolean;
    id?: number;
}

export interface Spawn {
    x: number;
    z: number;
    level: number;
}

/** The shopkeeper param defaults (shop/configs/shopkeeper.param). */
export const PARAM_DEFAULTS = { sell: 100, buy: 60, delta: 10 } as const;

/** `[section]` blocks of `key=value` lines, comments stripped. */
export function sections(text: string): { name: string; lines: [string, string][] }[] {
    const out: { name: string; lines: [string, string][] }[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/\/\/.*$/, '').trim();
        if (!line) continue;
        const head = /^\[([^\]]+)\]$/.exec(line);
        if (head) {
            out.push({ name: head[1]!, lines: [] });
            continue;
        }
        const eq = line.indexOf('=');
        if (eq > 0 && out.length) out.at(-1)!.lines.push([line.slice(0, eq), line.slice(eq + 1)]);
    }
    return out;
}

export function parseInvs(text: string, file = ''): ShopInv[] {
    return sections(text).map(s => {
        const inv: ShopInv = { name: s.name, file, scope: '', restock: false, allstock: false, stock: [] };
        for (const [k, v] of s.lines) {
            if (k === 'scope') inv.scope = v;
            else if (k === 'restock') inv.restock = v === 'yes';
            else if (k === 'allstock') inv.allstock = v === 'yes';
            else if (/^stock\d+$/.test(k)) {
                const [obj, count, rate] = v.split(',').map(p => p.trim());
                inv.stock.push({ obj: obj!, count: Number(count), rate: rate === undefined ? 0 : Number(rate) });
            }
        }
        return inv;
    });
}

/** Shop owners declared on NPCs (`param=owned_shop,<inv>`). */
export function parseNpcOwners(text: string, file = ''): ShopOwner[] {
    const out: ShopOwner[] = [];
    for (const s of sections(text)) {
        const p = new Map<string, string>();
        let npcName: string | undefined;
        for (const [k, v] of s.lines) {
            if (k === 'name') npcName = v;
            if (k !== 'param') continue;
            const comma = v.indexOf(',');
            if (comma > 0) p.set(v.slice(0, comma), v.slice(comma + 1));
        }
        const inv = p.get('owned_shop');
        if (!inv) continue;
        out.push({
            inv,
            npc: s.name,
            npcName,
            title: p.get('shop_title'),
            sell: Number(p.get('shop_sell_multiplier') ?? PARAM_DEFAULTS.sell),
            buy: Number(p.get('shop_buy_multiplier') ?? PARAM_DEFAULTS.buy),
            delta: Number(p.get('shop_delta') ?? PARAM_DEFAULTS.delta),
            file,
            scripted: false,
        });
    }
    return out;
}

/**
 * Shops opened from a script: `~openshop(inv, buy, sell, delta, "title")`. The owner is named after
 * the script file. A script that branches on `map_members` opens its members shop first and its free
 * one second (zaff.rs2, rommik.rs2, dommik.rs2); the demo is a members world, so only the first of
 * each such pair is kept.
 */
export function parseScriptedOwners(text: string, file: string): ShopOwner[] {
    const npc = file.replace(/^.*\//, '').replace(/\.rs2$/, '');
    const calls = [...text.matchAll(/~openshop\(\s*(\w+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"([^"]*)"\s*\)/g)];
    const membersBranch = /map_members\s*=\s*\^true/.test(text);
    return calls
        .filter((_, i) => !membersBranch || i % 2 === 0)
        .map(m => ({ inv: m[1]!, npc, title: m[5], buy: Number(m[2]), sell: Number(m[3]), delta: Number(m[4]), file, scripted: true }));
}

/** Objs with their display name, `cost=` (engine default 1) and members flag. */
export function parseObjs(text: string): Obj[] {
    return sections(text).map(s => {
        const o: Obj = { debugname: s.name, name: s.name, cost: 1, members: false };
        for (const [k, v] of s.lines) {
            if (k === 'name') o.name = v;
            else if (k === 'cost') o.cost = Number(v);
            else if (k === 'members') o.members = v === 'yes';
        }
        return o;
    });
}

/** `id=debugname` lines of a pack file (obj.pack, npc.pack). */
export function parsePack(text: string): Map<string, number> {
    const ids = new Map<string, number>();
    for (const line of text.split(/\r?\n/)) {
        const m = /^(\d+)=(\S+)$/.exec(line.trim());
        if (m) ids.set(m[2]!, Number(m[1]));
    }
    return ids;
}

/**
 * NPC spawns in one map square file `mX_Z.jm2`: the `==== NPC ====` block's `level lx lz: id` lines,
 * placed at world (X*64 + lx, Z*64 + lz).
 */
export function parseMapNpcs(text: string, file: string): { id: number; at: Spawn }[] {
    const sq = /m(\d+)_(\d+)\.jm2$/.exec(file);
    if (!sq) return [];
    const [mx, mz] = [Number(sq[1]) * 64, Number(sq[2]) * 64];
    const out: { id: number; at: Spawn }[] = [];
    let inNpc = false;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (line.startsWith('====')) {
            inNpc = line === '==== NPC ====';
            continue;
        }
        if (!inNpc) continue;
        const m = /^(\d+) (\d+) (\d+): (\d+)$/.exec(line);
        if (m) out.push({ id: Number(m[4]), at: { level: Number(m[1]), x: mx + Number(m[2]), z: mz + Number(m[3]) } });
    }
    return out;
}

export interface Content {
    invs: Map<string, ShopInv>;
    owners: ShopOwner[];
    objs: Map<string, Obj>;
    /** NPC debugname -> spawn tiles. */
    spawns: Map<string, Spawn[]>;
}

function walk(dir: string, ext: string[], out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, ext, out);
        else if (ext.some(x => e.name.endsWith(x))) out.push(p);
    }
    return out;
}

/** Parse the whole content tree (`server/content`). Paths in the result are relative to `scripts/`. */
export function loadContent(root = 'server/content'): Content {
    const scripts = join(root, 'scripts');
    const rel = (p: string) => p.slice(scripts.length + 1);
    const invs = new Map<string, ShopInv>();
    const owners: ShopOwner[] = [];
    const objs = new Map<string, Obj>();
    for (const f of walk(scripts, ['.inv', '.npc', '.obj', '.rs2'])) {
        const text = readFileSync(f, 'utf8');
        if (f.endsWith('.inv')) for (const inv of parseInvs(text, rel(f))) if (inv.stock.length) invs.set(inv.name, inv);
        if (f.endsWith('.npc')) owners.push(...parseNpcOwners(text, rel(f)));
        if (f.endsWith('.obj')) for (const o of parseObjs(text)) objs.set(o.debugname, o);
        if (f.endsWith('.rs2') && text.includes('~openshop(')) owners.push(...parseScriptedOwners(text, rel(f)));
    }
    // An NPC that both owns a shop by param and opens it from a script (Rommik) is one shop.
    const seen = new Set<string>();
    const owners1 = owners.filter(o => {
        const k = `${o.inv}|${o.npc.toLowerCase()}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
    owners.length = 0;
    owners.push(...owners1);
    const objIds = parsePack(readFileSync(join(root, 'pack/obj.pack'), 'utf8'));
    for (const o of objs.values()) o.id = objIds.get(o.debugname);
    const npcIds = parsePack(readFileSync(join(root, 'pack/npc.pack'), 'utf8'));
    const npcById = new Map([...npcIds].map(([n, id]) => [id, n]));
    const spawns = new Map<string, Spawn[]>();
    for (const f of walk(join(root, 'maps'), ['.jm2'])) {
        for (const s of parseMapNpcs(readFileSync(f, 'utf8'), f)) {
            const n = npcById.get(s.id);
            if (!n) continue;
            spawns.set(n, [...(spawns.get(n) ?? []), s.at]);
        }
    }
    return { invs, owners, objs, spawns };
}
