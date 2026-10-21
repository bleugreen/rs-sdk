#!/usr/bin/env bun
/**
 * Static scan for Firemaking lines near banks, from the SDK's collision data
 * (sdk/collision-data.json, the same map the SDK pathfinder uses).
 *
 *   bun docs/speedrun/scripts/firemaking-rows.ts [radius=20] [top=3]
 *
 * A line starts on a walkable tile outside every bank zone
 * (skill_firemaking/configs/bank_zones.dbrow) and runs west for as long as
 * each westward step is open: the next tile has no BLOCK_WEST flag (walk
 * blocked or a wall on its east side). After each success the player is
 * pushed west first (firemaking.rs2 push_player), so this length is how many
 * fires the line takes before the player has to step elsewhere. Collision
 * data cannot see interactable decorations, which also refuse a fire
 * (map_locaddunsafe), so every candidate is confirmed in the lab with
 * firemaking-line.ts.
 *
 * Reports, per bank, the longest lines starting within `radius` tiles
 * (Chebyshev) of the bank's stand tile, with that distance.
 */
import { initPathfinding, isFlagged } from '../../../sdk/pathfinding';
import { CollisionFlag } from '../../../server/vendor/rsmod-pathfinder';

const RADIUS = Number(process.argv[2] ?? 20);
const TOP = Number(process.argv[3] ?? 3);

// Bank zones from bank_zones.dbrow, level 0 only (coord = level_mx_mz_lx_lz).
const ZONES: Array<[string, string]> = [
    ['0_50_53_53_33', '0_50_53_53_35'], ['0_50_53_50_24', '1_50_53_57_32'], ['0_49_53_44_41', '1_49_53_54_55'],
    ['0_51_49_1_25', '0_51_49_8_37'], ['0_48_50_16_40', '0_48_50_25_46'], ['0_47_52_3_29', '0_47_52_6_30'],
    ['0_47_52_1_25', '0_47_52_13_28'], ['0_46_52_1_38', '0_46_52_3_45'], ['0_46_52_4_38', '0_46_52_5_41'],
    ['0_46_52_2_34', '0_46_52_4_37'], ['0_46_52_1_31', '0_46_52_4_33'], ['0_48_54_19_32', '0_48_54_26_43'],
    ['0_42_54_33_34', '1_42_54_42_41'], ['0_42_54_36_31', '0_42_54_39_33'], ['0_43_53_54_46', '0_43_53_60_53'],
    ['0_40_48_49_16', '0_40_48_56_25'], ['0_40_52_52_7', '0_40_52_54_7'], ['0_40_52_59_7', '0_40_52_61_7'],
    ['0_40_52_52_2', '0_40_52_61_6'], ['0_41_51_25_16', '2_41_51_34_23'], ['0_52_51_52_3', '0_52_51_56_7'],
    ['0_51_48_44_47', '0_51_48_45_49'],
];
const coord = (c: string) => { const [, mx, mz, lx, lz] = c.split('_').map(Number); return [mx * 64 + lx, mz * 64 + lz]; };
const boxes = ZONES.map(([a, b]) => { const [x1, z1] = coord(a); const [x2, z2] = coord(b); return [Math.min(x1, x2), Math.min(z1, z2), Math.max(x1, x2), Math.max(z1, z2)]; });
const inBank = (x: number, z: number) => boxes.some(([x1, z1, x2, z2]) => x >= x1 && x <= x2 && z >= z1 && z <= z2);

// Stand tiles in front of each bank's booths (approximate; level 0).
const BANKS: Record<string, [number, number]> = {
    'Varrock west': [3185, 3436], 'Varrock east': [3253, 3420], 'Falador east': [3013, 3355],
    'Falador west': [2946, 3368], 'Draynor': [3093, 3243], 'Edgeville': [3094, 3491],
    "Seers' Village": [2725, 3493], 'Catherby': [2809, 3441], 'Al Kharid': [3269, 3167],
    'Ardougne east (north)': [2655, 3283], 'Ardougne west (south)': [2615, 3332], 'Yanille': [2612, 3093],
    'Duel Arena': [3382, 3268], 'Shantay Pass': [3308, 3120],
};

initPathfinding();
const walkable = (x: number, z: number) => !isFlagged(x, z, 0, CollisionFlag.WALK_BLOCKED);
const canStepWest = (x: number, z: number) => !isFlagged(x - 1, z, 0, CollisionFlag.BLOCK_WEST);

function lineWest(x: number, z: number): number {
    if (!walkable(x, z) || inBank(x, z)) return 0;
    let n = 1;
    while (n < 200 && canStepWest(x - n + 1, z) && !inBank(x - n, z)) n++;
    return n;
}

const out: Record<string, Array<{ start: [number, number]; fires: number; fromBank: number }>> = {};
for (const [name, [bx, bz]] of Object.entries(BANKS)) {
    const rows: Array<{ start: [number, number]; fires: number; fromBank: number }> = [];
    for (let z = bz - RADIUS; z <= bz + RADIUS; z++) {
        for (let x = bx - RADIUS; x <= bx + RADIUS; x++) {
            // Only maximal lines: the tile east of the start must not extend it.
            if (lineWest(x + 1, z) > 0 && canStepWest(x + 1, z)) continue;
            const n = lineWest(x, z);
            if (n >= 10) rows.push({ start: [x, z], fires: n, fromBank: Math.max(Math.abs(x - bx), Math.abs(z - bz)) });
        }
    }
    rows.sort((a, b) => b.fires - a.fires || a.fromBank - b.fromBank);
    out[name] = rows.slice(0, TOP);
}
for (const [name, rows] of Object.entries(out)) {
    console.log(`${name.padEnd(24)} ${rows.map(r => `(${r.start[0]},${r.start[1]}) ${r.fires} fires, ${r.fromBank} from bank`).join(' | ')}`);
}
