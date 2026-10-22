// SCORED's pack at a point of the route, from the inventory ledger (STEP-MANIFEST.md "Inventory
// ledger", walked by speedrun/tools/slot-ledger.ts), as a lab fixture gives it: a change to an
// earlier row flows into every quest lab that stages from it.

import { readFileSync } from 'fs';
import { MANIFEST, parseLedger, walk } from '../../tools/slot-ledger';

/** Ledger names (lower case, the game's) to obj debug names, for the items the quest labs stage. */
export const LEDGER_OBJ: Readonly<Record<string, string>> = {
    knife: 'knife', 'water rune': 'waterrune', 'antipoison(3)': '3doseantipoison', shark: 'shark', 'death rune': 'deathrune', 'chaos rune': 'chaosrune',
    'air rune': 'airrune', 'fire rune': 'firerune', 'earth rune': 'earthrune', coins: 'coins', 'law rune': 'lawrune', 'staff of fire': 'staff_of_fire',
    'staff of water': 'staff_of_water', 'amulet of magic': 'amulet_of_magic',
    'khazard helmet': 'khazard_helmet', 'khazard armour': 'khazard_platemail', 'khazard cell keys': 'khazard_cellkeys',
    clay: 'clay', 'copper ore': 'copper_ore', 'iron ore': 'iron_ore', 'air talisman': 'air_talisman',
    egg: 'egg', 'bucket of milk': 'bucket_milk', 'pot of flour': 'pot_flour',
    'goblin mail': 'goblin_armour', 'orange dye': 'orangedye', 'blue dye': 'bluedye',
    'raw rat meat': 'raw_rat_meat', 'raw bear meat': 'raw_bear_meat', 'raw beef': 'raw_beef', 'raw chicken': 'raw_chicken',
    'cadava berries': 'cadavaberries', 'gold bar': 'gold_bar',
    "m'speak amulet": 'mm_amulet_of_monkey_speak', 'rune arrow': 'rune_arrow',
};

/** `held` / `worn` as slot-ledger.ts renders them ("knife x1, air rune x353") as obj debug name -> count. */
export function ledgerItems(rendered: string, obj: Readonly<Record<string, string>> = LEDGER_OBJ): Record<string, number> {
    if (rendered.trim() === '-') return {};
    const out: Record<string, number> = {};
    for (const part of rendered.split(', ')) {
        const m = /^(.+) x(\d+|\?)( \(noted\))?$/.exec(part.trim());
        if (!m) throw new Error(`ledger: cannot read "${part}"`);
        if (m[2] === '?') throw new Error(`ledger: ${m[1]} is held at an unknown count`);
        if (m[3]) throw new Error(`ledger: ${m[1]} is noted; the fixture gives unnoted items`);
        const name = obj[m[1]!];
        if (!name) throw new Error(`ledger: no obj name for "${m[1]}" (add it to LEDGER_OBJ)`);
        out[name] = (out[name] ?? 0) + Number(m[2]);
    }
    return out;
}

/** SCORED's pack and worn set once `row` is done, from the ledger. */
export function ledgerAfter(row: string, markdown = readFileSync(MANIFEST, 'utf8'), obj: Readonly<Record<string, string>> = LEDGER_OBJ): { inv: Record<string, number>; worn: Record<string, number> } {
    const { rows, errors } = parseLedger(markdown);
    if (errors.length) throw new Error(`the inventory ledger does not parse: ${errors.join('; ')}`);
    const e = walk(rows).find(x => x.row.row === row);
    if (!e) throw new Error(`no ledger row ${row}`);
    return { inv: ledgerItems(e.held, obj), worn: ledgerItems(e.worn, obj) };
}

/**
 * A fixture's `items` and `worn` from a ledger point: the quest items first (a full inventory drops
 * a give silently), then the pack, then one of each worn item (given, then worn by the fixture).
 */
export function fixturePack(at: { inv: Record<string, number>; worn: Record<string, number> }, quest: Record<string, number> = {}, drop: readonly string[] = []): { items: Record<string, number>; worn: string[] } {
    const inv = { ...at.inv };
    for (const d of drop) delete inv[d];
    const items: Record<string, number> = { ...quest };
    for (const [k, n] of Object.entries(inv)) items[k] = (items[k] ?? 0) + n;
    const worn = Object.keys(at.worn);
    for (const [k, n] of Object.entries(at.worn)) items[k] = (items[k] ?? 0) + n;
    return { items, worn };
}
