// Runecraft altar table (runecraft.dbrow): level, base xp per essence, the room
// entry tile (enter_coord), the outside tile the exit portal drops you on
// (exit_coord) and the ruins' locate coord (altar_coord, the ruins tile).
// Measured use: docs/speedrun/skills/runecraft.md.

export interface Coord {
    x: number;
    z: number;
    level: number;
}

export interface AltarRow {
    level: number;
    xp: number;
    enter: Coord;
    exit: Coord;
    ruins: Coord;
}

/** A dbrow coord `level_mx_mz_lx_lz` as an absolute tile. */
export function coord(s: string): Coord {
    const [l = 0, mx = 0, mz = 0, lx = 0, lz = 0] = s.split('_').map(Number);
    return { x: mx * 64 + lx, z: mz * 64 + lz, level: l };
}

export const ALTARS: Record<string, AltarRow> = {
    air: { level: 1, xp: 5, enter: coord('0_44_75_25_30'), exit: coord('0_46_51_39_24'), ruins: coord('0_46_51_41_28') },
    mind: { level: 2, xp: 5.5, enter: coord('0_43_75_41_29'), exit: coord('0_46_54_36_55'), ruins: coord('0_46_54_38_58') },
    water: { level: 5, xp: 6, enter: coord('0_42_75_37_32'), exit: coord('0_49_49_46_26'), ruins: coord('0_49_49_49_29') },
    earth: { level: 9, xp: 6.5, enter: coord('0_41_75_33_30'), exit: coord('0_51_54_39_21'), ruins: coord('0_51_54_42_18') },
    fire: { level: 14, xp: 7, enter: coord('0_40_75_16_48'), exit: coord('0_51_50_46_52'), ruins: coord('0_51_50_49_55') },
    body: { level: 20, xp: 7.5, enter: coord('0_39_75_27_38'), exit: coord('0_47_53_42_50'), ruins: coord('0_47_53_45_53') },
    cosmic: { level: 27, xp: 8, enter: coord('0_33_75_30_13'), exit: coord('0_49_148_37_29'), ruins: coord('0_49_148_40_25') },
    chaos: { level: 35, xp: 8.5, enter: coord('3_35_75_35_47'), exit: coord('0_47_56_52_1'), ruins: coord('0_47_56_52_7') },
    nature: { level: 44, xp: 9, enter: coord('0_37_75_32_35'), exit: coord('0_44_47_49_14'), ruins: coord('0_44_47_53_11') },
    law: { level: 54, xp: 9.5, enter: coord('0_38_75_32_19'), exit: coord('0_44_52_42_50'), ruins: coord('0_44_52_42_53') }
};
