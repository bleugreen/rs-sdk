// Pre-Charge Magic training spells as the measurement scripts set them up.
// Levels, rune costs and xp: server/content/scripts/skill_magic/configs/magic_spells.dbrow;
// interface components: sdk/spells.ts.
export type Spell = {
    level: number;
    com: number;
    base: number; // base xp per cast (magic_spells.dbrow experience / 10)
    staff?: string;
    runes: [string, number][];
    item?: string; // target item (OPHELDT spells); absent for teleports (IF_BUTTON)
    extra?: string[]; // extra cheats (e.g. smithing level)
};

const R = 5000;
export const SPELLS: Record<string, Spell> = {
    sapphire: { level: 7, com: 1155, base: 17.5, staff: 'staff_of_water', runes: [['cosmicrune', R]], item: 'sapphire_ring' },
    lowalch: { level: 21, com: 1162, base: 31, staff: 'staff_of_fire', runes: [['naturerune', R]], item: 'iron_platebody' },
    emerald: { level: 27, com: 1165, base: 37, staff: 'staff_of_air', runes: [['cosmicrune', R]], item: 'emerald_ring' },
    superheat: { level: 43, com: 1173, base: 53, staff: 'staff_of_fire', runes: [['naturerune', R]], item: 'gold_ore', extra: ['setstat smithing 40'] },
    ruby: { level: 49, com: 1176, base: 59, staff: 'staff_of_fire', runes: [['cosmicrune', R]], item: 'ruby_ring' },
    highalch: { level: 55, com: 1178, base: 65, staff: 'staff_of_fire', runes: [['naturerune', R]], item: 'iron_platebody' },
    diamond: { level: 57, com: 1180, base: 67, staff: 'staff_of_earth', runes: [['cosmicrune', R]], item: 'diamond_ring' },
    dragonstone: { level: 68, com: 1187, base: 78, staff: 'staff_of_water', runes: [['cosmicrune', R], ['earthrune', R]], item: 'dragonstone_ring' },
    varrock: { level: 25, com: 1164, base: 35, staff: 'staff_of_air', runes: [['lawrune', R], ['firerune', R]] },
    camelot: { level: 45, com: 1174, base: 55.5, staff: 'staff_of_air', runes: [['lawrune', R]] },
};
