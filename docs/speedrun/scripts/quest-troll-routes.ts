// Walking legs of the troll chain (Death Plateau, Troll Stronghold, Troll
// Romance), measured offline with the SDK's collision pathfinder
// (sdk/pathfinding.ts over sdk/collision-data.json). No server or bot needed:
//
//   bun docs/speedrun/scripts/quest-troll-routes.ts
//
// Each leg prints the step count (a diagonal is one step) and the run ticks at
// 2 steps per tick (CONVENTIONS.md provisional primitive). Scripted obstacles
// (climbing rocks, tunnels, stairs, doors that knock) are not walkable in the
// collision map, so legs stop at the tile in front of each obstacle and the
// obstacle itself is timed separately in quest-troll-obstacles.ts.
import { findLongPath, initPathfinding } from '../../../sdk/pathfinding';

type P = [number, number, number?]; // x, z, level
interface Leg { quest: string; name: string; from: P; to: P }

const FALADOR_TELE: P = [2965, 3378];      // magic_spells.dbrow tele_coord 0_46_52_21_50
const CAMELOT_TELE: P = [2757, 3478];      // 0_43_54_5_22
const DENULTH: P = [2896, 3529];           // npc death_ig_commander at 2896,3528 (m45_55)
const CASTLE_STAIRS: P = [2898, 3565];     // board_game_stairs 2897..2899,3566
const CASTLE_TOP: P = [2898, 3568, 1];
const EOHRIC: P = [2902, 3565, 1];
const INN_STAIRS: P = [2914, 3538];        // stairs 2914,3539
const INN_TOP: P = [2914, 3541, 1];
const HAROLD_DOOR: P = [2906, 3544, 1];    // death_harold_door 2906,3543 level 1
const HAROLD: P = [2905, 3540, 1];
const STONES: P = [2893, 3563];            // stone balls 2893,3561..3565, mechanism 2894..2895,3562..3564
const SABA_CAVE: P = [2857, 3577];         // death_hermitcave_entrance 2857,3578
const SABA_IN: P = [2268, 4750];           // after p_teleport(0_35_74_29_16)? lands 2269,4752
const SABA: P = [2270, 4758];
const SABA_EXIT: P = [2268, 4751];         // death_hermitcave_exit 2268,4750
const SABA_OUT: P = [2858, 3577];          // p_teleport(0_44_55_42_57) = 2858,3577
const TENZING_DOOR: P = [2823, 3555];      // death_sherpa_door 2822,3555
const TENZING: P = [2820, 3555];
const BACKDOOR_OUT: P = [2820, 3558];      // death_sherpa_backdoor 2820,3557
const STILE_S: P = [2817, 3561];           // death_fullstyle 2817,3562
const STILE_N: P = [2817, 3564];
const SCOUT_ZONE: P = [2864, 3608];        // [zone,0_44_56_48_24] = 2864..2871,3608..3615
const DUNSTAN: P = [2919, 3573];
const DP_ROCKS_S: P = [2880, 3593];        // death_climbingrocks_bottom 2880,3594 (climbing boots)
const DP_ROCKS_N: P = [2880, 3597];
const ARENA_W: P = [2896, 3618];           // arena entrance 2897,3618..3619
const ARENA_IN_W: P = [2898, 3618];
const DAD: P = [2911, 3612];
const ARENA_IN_N: P = [2916, 3628];        // arena exit 2916..2917,3629
const ARENA_N: P = [2916, 3630];
const PASS_S: P = [2903, 3643];            // troll_pass_entrance 2903,3644
const PASS_N_OUT: P = [2908, 3654];        // troll_pass_exit -> 0_45_57_28_6
const PASS_IN_A: P = [2907, 10019];        // troll_pass_entrance -> 0_45_156_27_35
const PASS_IN_B: P = [2907, 10035];        // -> 0_45_156_27_51
const TH_ROCKS_S: P = [2910, 3685];        // troll_climbingrocks 2910,3686..3687
const TH_ROCKS_N: P = [2910, 3688];
const SH_DOOR: P = [2839, 3690];           // troll_stronghold_door 2839,3689
const SH_TOP_OUT: P = [2840, 3690];        // _troll_stronghold_top_exit -> 0_44_57_24_42
const SH_L2_IN: P = [2837, 10090, 2];      // troll_stronghold_door -> 2_44_157_21_42
const GENERAL: P = [2831, 10086, 2];       // troll_general (m44_157 level 2)
const L2_STAIRS_N: P = [2843, 10107, 2];   // troll_stronghold_stairstop 2843,10108 level 2
const L1_FROM_N: P = [2841, 10107, 1];     // stairstop loc_angle north: movecoord(-2,-1,0)
const PRISON_DOOR: P = [2847, 10107, 1];   // troll_stronghold_prison_door_closed 2848,10107 level 1
const L1_STAIRS_PRISON: P = [2851, 10107, 1]; // stairstop 2852,10107 level 1
const L0_PRISON: P = [2852, 10105];        // guess: lands south of the stairs; the lab confirms
const TWIG: P = [2833, 10079];             // troll_prison_guard1 2832,10079; cell door 2832,10078
const SH_EXIT: P = [2823, 10049];          // troll_stronghold_exit 2823,10048
const SECRET_OUT: P = [2827, 3646];        // troll_stronghold_exit -> 0_44_56_11_62
const SECRET_DOOR: P = [2827, 3646];       // troll_stronghold_entrance 2827,3647
const SH_L0_IN: P = [2823, 10050];         // troll_stronghold_entrance -> 0_44_157_7_2
const L0_STAIRS_UG: P = [2851, 10061];     // troll_stronghold_stairs 2852,10061 level 0
const L1_UG_ARRIVE: P = [2852, 10062, 1];  // guess: lands beside the stairs on level 1
const UG: P = [2827, 10065, 1];
const ARRG: P = [2828, 10096, 1];
const AGA: P = [2828, 10103, 1];
const ARRG_ARENA: P = [2914, 3611];        // trollromance_arrg_combat teleports to 0_45_56_34_27
const CAVE_TROLLHEIM: P = [2820, 3742];    // trollromance_caveentrance 2820,3743
const ICE_CAVE_IN: P = [2803, 10187];      // -> 0_43_159_51_11
const CREVASSE: P = [2772, 10232];         // trollromance_snow_cavewall_crevis 2772,10233
const WEISS_IN: P = [2778, 3869];          // -> 0_43_60_26_29
const SLED_START: P = [2772, 3836];        // barrier_down 2772..2773,3835
const RIDE1_END: P = [2790, 3794];         // ride 1 ends p_teleport(0_43_59_38_18)
const FLOWER: P = [2781, 3784];            // trollromance_rareflowers 2781,3783 (nearest of 13)
const RIDE2_START: P = [2785, 3772];       // barrier_down 2785..2786,3771

const legs: Leg[] = [
    // Death Plateau
    { quest: 'DP', name: 'Falador tele -> Denulth', from: FALADOR_TELE, to: DENULTH },
    { quest: 'DP', name: 'Camelot tele -> Denulth', from: CAMELOT_TELE, to: DENULTH },
    { quest: 'DP', name: 'Denulth -> castle stairs', from: DENULTH, to: CASTLE_STAIRS },
    { quest: 'DP', name: 'castle top -> Eohric', from: CASTLE_TOP, to: EOHRIC },
    { quest: 'DP', name: 'castle stairs -> inn stairs', from: CASTLE_STAIRS, to: INN_STAIRS },
    { quest: 'DP', name: 'inn top -> Harold door', from: INN_TOP, to: HAROLD_DOOR },
    { quest: 'DP', name: 'Harold door -> Harold', from: HAROLD_DOOR, to: HAROLD },
    { quest: 'DP', name: 'castle stairs -> stones', from: CASTLE_STAIRS, to: STONES },
    { quest: 'DP', name: 'inn stairs -> stones', from: INN_STAIRS, to: STONES },
    { quest: 'DP', name: 'stones -> Saba cave', from: STONES, to: SABA_CAVE },
    { quest: 'DP', name: 'Saba cave in -> Saba', from: SABA_IN, to: SABA },
    { quest: 'DP', name: 'Saba -> cave exit', from: SABA, to: SABA_EXIT },
    { quest: 'DP', name: 'Saba cave -> Tenzing door', from: SABA_OUT, to: TENZING_DOOR },
    { quest: 'DP', name: 'Tenzing -> Dunstan', from: TENZING, to: DUNSTAN },
    { quest: 'DP', name: 'Dunstan -> Denulth', from: DUNSTAN, to: DENULTH },
    { quest: 'DP', name: 'Denulth -> Dunstan', from: DENULTH, to: DUNSTAN },
    { quest: 'DP', name: 'Dunstan -> Tenzing door', from: DUNSTAN, to: TENZING_DOOR },
    { quest: 'DP', name: 'Tenzing back door -> stile', from: BACKDOOR_OUT, to: STILE_S },
    { quest: 'DP', name: 'stile -> scout zone', from: STILE_N, to: SCOUT_ZONE },
    { quest: 'DP', name: 'scout zone -> Denulth', from: SCOUT_ZONE, to: DENULTH },
    { quest: 'DP', name: 'Dunstan -> Saba cave', from: DUNSTAN, to: SABA_CAVE },
    { quest: 'DP', name: 'Denulth -> Saba cave', from: DENULTH, to: SABA_CAVE },
    // Troll Stronghold
    { quest: 'TS', name: 'Denulth -> Death Plateau rocks', from: DENULTH, to: DP_ROCKS_S },
    { quest: 'TS', name: 'DP rocks top -> arena entrance', from: DP_ROCKS_N, to: ARENA_W },
    { quest: 'TS', name: 'arena entrance -> Dad', from: ARENA_IN_W, to: DAD },
    { quest: 'TS', name: 'Dad -> arena exit', from: DAD, to: ARENA_IN_N },
    { quest: 'TS', name: 'arena exit -> pass entrance', from: ARENA_N, to: PASS_S },
    { quest: 'TS', name: 'pass tunnel A -> B', from: PASS_IN_A, to: PASS_IN_B },
    { quest: 'TS', name: 'pass exit -> Trollheim rocks', from: PASS_N_OUT, to: TH_ROCKS_S },
    { quest: 'TS', name: 'Trollheim rocks -> stronghold door', from: TH_ROCKS_N, to: SH_DOOR },
    { quest: 'TS', name: 'pass exit -> stronghold door (any way)', from: PASS_N_OUT, to: SH_DOOR },
    { quest: 'TS', name: 'L2 arrival -> general', from: SH_L2_IN, to: GENERAL },
    { quest: 'TS', name: 'general -> L2 north stairs', from: GENERAL, to: L2_STAIRS_N },
    { quest: 'TS', name: 'L1 north -> prison door', from: L1_FROM_N, to: PRISON_DOOR },
    { quest: 'TS', name: 'prison door -> L1 prison stairs', from: PRISON_DOOR, to: L1_STAIRS_PRISON },
    { quest: 'TS', name: 'L0 prison stairs -> Twig', from: L0_PRISON, to: TWIG },
    { quest: 'TS', name: 'Twig -> stronghold exit', from: TWIG, to: SH_EXIT },
    { quest: 'TS', name: 'secret exit -> stile', from: SECRET_OUT, to: STILE_N },
    { quest: 'TS', name: 'stile -> Dunstan', from: STILE_S, to: DUNSTAN },
    { quest: 'TS', name: 'secret exit -> Dunstan (any way)', from: SECRET_OUT, to: DUNSTAN },
    { quest: 'TS', name: 'Dunstan -> Denulth', from: DUNSTAN, to: DENULTH },
    // Troll Romance
    { quest: 'TR', name: 'Dunstan -> secret door (any way)', from: DUNSTAN, to: SECRET_DOOR },
    { quest: 'TR', name: 'stile -> secret door', from: STILE_N, to: SECRET_DOOR },
    { quest: 'TR', name: 'Falador tele -> stile', from: FALADOR_TELE, to: STILE_S },
    { quest: 'TR', name: 'Camelot tele -> stile', from: CAMELOT_TELE, to: STILE_S },
    { quest: 'TR', name: 'L0 entrance -> L0 stairs', from: SH_L0_IN, to: L0_STAIRS_UG },
    { quest: 'TR', name: 'L1 stairs -> Ug', from: L1_UG_ARRIVE, to: UG },
    { quest: 'TR', name: 'Ug -> Aga', from: UG, to: AGA },
    { quest: 'TR', name: 'Aga -> L1 stairs', from: AGA, to: L1_UG_ARRIVE },
    { quest: 'TR', name: 'Ug -> Arrg', from: UG, to: ARRG },
    { quest: 'TR', name: 'L0 stairs -> exit', from: L0_STAIRS_UG, to: SH_EXIT },
    { quest: 'TR', name: 'secret exit -> Tenzing door', from: SECRET_OUT, to: TENZING_DOOR },
    { quest: 'TR', name: 'Tenzing -> Dunstan', from: TENZING, to: DUNSTAN },
    { quest: 'TR', name: 'stronghold top exit -> Trollheim cave', from: SH_TOP_OUT, to: CAVE_TROLLHEIM },
    { quest: 'TR', name: 'ice cave -> crevasse', from: ICE_CAVE_IN, to: CREVASSE },
    { quest: 'TR', name: 'Trollweiss arrival -> sled start', from: WEISS_IN, to: SLED_START },
    { quest: 'TR', name: 'ride 1 end -> flower', from: RIDE1_END, to: FLOWER },
    { quest: 'TR', name: 'flower -> ride 2 start', from: FLOWER, to: RIDE2_START },
    { quest: 'TR', name: 'Arrg arena -> arena west exit', from: ARRG_ARENA, to: ARENA_IN_W },
    { quest: 'TR', name: 'arena west -> secret door (any way)', from: ARENA_W, to: SECRET_DOOR },
    { quest: 'TR', name: 'Arrg arena -> arena north exit', from: ARRG_ARENA, to: ARENA_IN_N },
];

function steps(path: Array<{ x: number; z: number }>, from: P): number {
    let n = 0, px = from[0], pz = from[1];
    for (const w of path) {
        n += Math.max(Math.abs(w.x - px), Math.abs(w.z - pz));
        px = w.x; pz = w.z;
    }
    return n;
}

initPathfinding();
const rows: string[] = ['| quest | leg | from | to | steps | run ticks | reached |', '|---|---|---|---|---|---|---|'];
for (const leg of legs) {
    const level = leg.from[2] ?? 0;
    const path = findLongPath(level, leg.from[0], leg.from[1], leg.to[0], leg.to[1], 2000);
    const last = path[path.length - 1];
    const reached = !!last && Math.max(Math.abs(last.x - leg.to[0]), Math.abs(last.z - leg.to[1])) <= 1;
    const n = path.length ? steps(path, leg.from) : NaN;
    rows.push(`| ${leg.quest} | ${leg.name} | ${leg.from.join(',')} | ${leg.to.join(',')} | ${n} | ${Math.ceil(n / 2)} | ${reached ? 'yes' : `NO (ends ${last ? `${last.x},${last.z}` : 'nowhere'})`} |`);
}
console.log(rows.join('\n'));
