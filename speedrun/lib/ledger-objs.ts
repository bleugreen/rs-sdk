// The ::give debug name of an inventory-ledger entry (STEP-MANIFEST.md's ledger names a game item
// by its NAME, or `NAME @ID`): the lab staging (lab/stub-giver.ts, the dress rehearsal's staff
// supply) and the cannon holder's serve config built from the ledger (helpers/cannon-receiver.ts
// serveFromLedger) all resolve names here, against server/content/pack/obj.pack.

import { CANNON_PART_OBJS, CANNON_PARTS, CANNONBALL_OBJ } from './cannon';
import { objPack } from './obj-pack';

/** Ledger NAMEs whose obj.pack debug name is no spelling of them (read from obj.pack). */
export const LEDGER_OBJS: Readonly<Record<string, string>> = {
    'prayer potion(4)': '4doseprayerrestore',
    'magic potion(4)': '4dose1magic',
    'ranging potion(4)': '4doserangerspotion',
    'superantipoison(4)': '4dose2antipoison',
    'superantipoison(1)': '1dose2antipoison',
    'super attack(3)': '3dose2attack',
    'super strength(3)': '3dose2strength',
    'bronze arrowtips': 'bronze_arrowheads',
    'iron arrowtips': 'iron_arrowheads',
    'steel arrowtips': 'steel_arrowheads',
    'mithril arrowtips': 'mithril_arrowheads',
    'adamant arrowtips': 'adamant_arrowheads',
    'rune arrowtips': 'rune_arrowheads',
    'bucket of milk': 'bucket_milk',
    'pot of flour': 'pot_flour',
    'goblin mail': 'goblin_armour',
    'khazard armour': 'khazard_platemail',
    'agility potion(3)': '3dose1agility',
    'agility potion(4)': '4dose1agility',
    'unfired bowl': 'bowl_unfired',
    plank: 'woodplank',
    "m'speak amulet": 'mm_amulet_of_monkey_speak',
    // lib/cannon.ts CANNON_PARTS / CANNON_PART_OBJS and CANNONBALL_OBJ.
    ...Object.fromEntries(CANNON_PARTS.map((p, i) => [p.toLowerCase(), CANNON_PART_OBJS[i]!])),
    cannonball: CANNONBALL_OBJ,
};

let names: Set<string> | null = null;
function packNames(): Set<string> {
    return (names ??= new Set(objPack().ids.keys()));
}

/** The ::give debug name of a ledger entry: the override, its obj id's name, LEDGER_OBJS, or an obj.pack spelling of its NAME. */
export function debugNameFor(name: string, id: number | undefined, overrides: Readonly<Record<string, string>> = {}, known: ReadonlySet<string> = packNames()): string | null {
    if (overrides[name]) return overrides[name]!;
    if (id === undefined && LEDGER_OBJS[name]) return LEDGER_OBJS[name]!;
    if (id !== undefined) return objPack().names.get(id) ?? null;
    const base = name.toLowerCase().replace(/\(\*?\d?\)$/, '').replace(/['()]/g, '').trim();
    for (const c of [base.replace(/\s+/g, '_'), base.replace(/\s+/g, '')]) if (known.has(c)) return c;
    return null;
}
