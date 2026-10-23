// What the engine keeps when SCORED dies: server/content/scripts/player/scripts/death.rs2.
//
// player_death_lose_items: an unskulled player keeps three units (~move_priciest_item_on_hero_to_death
// three times), a fourth under Protect Item (%prayer8), and drops the rest. Each call scans the
// inventory, then the worn set, for the obj with the highest `oc_cost`, skipping any obj with
// `param=destroy_death,^true`; a later candidate wins only on a strictly higher cost, so on a tie the
// first inventory item beats any worn one. One unit moves to the keep (inv_moveitem ... 1): one arrow
// of a quiver, one coin of a stack. The keep is moved back into the inventory at the respawn
// (~moveallinv(deathkeep, inv)), so a kept worn item comes back unworn.
//
// The costs are the obj configs' `cost=` under server/content/scripts; ids are server/content/pack/obj.pack.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { objPack, type ObjPack } from './obj-pack';

export interface ObjInfo {
    /** The config's debug name, `[shark]`. */
    debug: string;
    /** Its game name. */
    name: string;
    cost: number;
    /** `param=destroy_death,^true`: never kept, whatever its cost. */
    destroy: boolean;
    /** Has a `wearpos=`: it can be worn. */
    wearable?: boolean;
    /**
     * false when the engine refuses it in a trade (trade.rs2): `tradeable=no|false` or a dummy item,
     * rs/488's rule (its `untradeable(id)` in lib/items.ts, which replaces this once on the mission branch).
     */
    tradeable?: boolean;
    /** obj.pack's id for the debug name; undefined when the pack lacks it. */
    id?: number;
}

export interface ObjTable {
    byDebug: ReadonlyMap<string, ObjInfo>;
    /** By lower-case game name: every config with that name (the greegrees share one). */
    byName: ReadonlyMap<string, readonly ObjInfo[]>;
    /** By obj.pack id. */
    byId: ReadonlyMap<number, ObjInfo>;
}

export const CONTENT_SCRIPTS = join(import.meta.dir, '..', '..', 'server', 'content', 'scripts');

/** A table from the given configs (tests build their own). */
export function objTable(objs: readonly ObjInfo[]): ObjTable {
    const byDebug = new Map<string, ObjInfo>();
    const byName = new Map<string, ObjInfo[]>();
    const byId = new Map<number, ObjInfo>();
    for (const o of objs) {
        byDebug.set(o.debug, o);
        byName.set(o.name.toLowerCase(), [...(byName.get(o.name.toLowerCase()) ?? []), o]);
        if (o.id !== undefined) byId.set(o.id, o);
    }
    return { byDebug, byName, byId };
}

let loaded: ObjTable | null = null;

/** The checkout's obj configs (notes, `certtemplate=`, left out), read once. */
export function contentObjs(dir = CONTENT_SCRIPTS, pack: ObjPack = objPack()): ObjTable {
    if (loaded && dir === CONTENT_SCRIPTS) return loaded;
    const files = (d: string): string[] =>
        readdirSync(d).flatMap(f => {
            const p = join(d, f);
            return statSync(p).isDirectory() ? files(p) : p.endsWith('.obj') ? [p] : [];
        });
    const objs: ObjInfo[] = [];
    for (const f of files(dir)) {
        for (const b of readFileSync(f, 'utf8').split(/\n(?=\[)/)) {
            const debug = b.match(/^\[([^\]]+)\]/)?.[1];
            const name = b.match(/^name=(.*)$/m)?.[1];
            if (!debug || !name || /^certtemplate=/m.test(b)) continue;
            objs.push({ debug, name, cost: Number(b.match(/^cost=(\d+)$/m)?.[1] ?? 0), destroy: /^param=destroy_death,\^true$/m.test(b), wearable: /^wearpos=/m.test(b), tradeable: !/^(tradeable=(no|false)|dummyitem=.*)$/m.test(b), id: pack.ids.get(debug) });
        }
    }
    const table = objTable(objs);
    if (dir === CONTENT_SCRIPTS) loaded = table;
    return table;
}

/**
 * The obj an item names: by id when it has one, else by game name (the config whose debug name is the
 * name in snake case, then the only one; for an item worn, the only wearable one, as the strung
 * M'speak amulet against the unstrung). Undefined when unknown or when a name stays ambiguous.
 */
export function objOf(table: ObjTable, item: { name: string; id?: number; worn?: boolean }): ObjInfo | undefined {
    if (item.id !== undefined) return table.byId.get(item.id);
    const all = table.byName.get(item.name.toLowerCase()) ?? [];
    const snake = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const exact = all.find(o => o.debug === snake);
    if (exact) return exact;
    const pool = item.worn ? all.filter(o => o.wearable) : all;
    return pool.length === 1 ? pool[0] : undefined;
}

/** Whether the engine refuses obj `id` in a trade, by the table's configs; an id it lacks reads as tradeable. */
export function untradeable(table: ObjTable, id: number): boolean {
    return table.byId.get(id)?.tradeable === false;
}

/** A stack on the hero for the keep: `count` units of one obj, worn or carried. */
export interface HeroUnit {
    name: string;
    count: number;
    worn: boolean;
    /** oc_cost; 0 for a destroy_death obj (never kept), or an unknown one. */
    cost: number;
}

/**
 * death.rs2's keep, `n` times (3; 4 under Protect Item): each pass takes one unit of the priciest
 * obj, the inventory scanned before the worn set, a later one winning only on a strictly higher
 * cost. Returns the kept units in the order taken (one entry per unit) and what is left to drop.
 */
export function keepPriciest<U extends HeroUnit>(units: readonly U[], n = 3): { kept: U[]; lost: U[] } {
    const left = units.map(u => ({ ...u }));
    const kept: U[] = [];
    for (let i = 0; i < n; i++) {
        let best: U | undefined;
        for (const u of [...left.filter(u => !u.worn), ...left.filter(u => u.worn)]) if (u.count > 0 && u.cost > (best?.cost ?? 0)) best = u;
        if (!best) break;
        best.count -= 1;
        kept.push({ ...best, count: 1 });
    }
    return { kept, lost: left.filter(u => u.count > 0) };
}
