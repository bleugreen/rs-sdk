// Agility courses as data for the in-page course program. Loc ids from
// server/content/pack/loc.pack, positions from server/content/maps (the same
// table as docs/speedrun/scripts/agility-course.ts).

export interface AgilityStep {
    name: string;
    /** Candidate locs [id, x, z]; the nearest visible one is clicked (else the first). */
    locs: Array<[number, number, number]>;
    /** Base xp the obstacle awards on success (the lap bonus included on the last step). */
    xp: number;
    /** For a step that awards no xp (a ladder): done when the player's plane becomes this. */
    plane?: number;
    /** Option index to use (default 1); -1 clicks the nearest loc offering Climb-down. */
    op?: number;
    /** Also done, without xp, when the player arrives on this z from another. */
    endZ?: number;
}

export interface AgilityCourse {
    start: [number, number, number];
    steps: AgilityStep[];
    /** Base xp of the lap bonus; an xp drop at least this large ends a lap. */
    lapBonus: number;
    /** After a fall at step X, take step resume[X] next (default: retry X). */
    resume?: Record<string, string>;
    /**
     * Where each step is taken from, as boxes [x0, z0, x1, z1] (inclusive, first
     * match wins), on `plane` when given (else any plane): `stepFromPosition` picks
     * the step a resumed run starts with. Tiles outside every box start at the first
     * step. A zone naming the first step is where a lap closes and the next begins.
     */
    zones?: Array<{ step: string; box: Box; plane?: number }>;
    /** The lap path and its pits: a player inside is another course user, not an approach. */
    lapArea?: Box[];
    /** The pit's ladder [id, x, z], clicked when the scene list does not show it yet (right after the fall). */
    pitExit?: [number, number, number];
}

export type Box = [number, number, number, number];

export function inBox(b: Box, x: number, z: number): boolean {
    return x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3];
}

/** The step whose zone holds tile (x, z) on `plane`, or undefined off every zone. */
export function zoneAt(course: AgilityCourse, x: number, z: number, plane = 0): string | undefined {
    return course.zones?.find(zn => (zn.plane === undefined || zn.plane === plane) && inBox(zn.box, x, z))?.step;
}

/** The step to take next from tile (x, z): a resumed band picks up mid-lap. */
export function stepFromPosition(course: AgilityCourse, x: number, z: number, plane = 0): string {
    return zoneAt(course, x, z, plane) ?? course.steps[0]!.name;
}

export const AGILITY_COURSES: Record<string, AgilityCourse> = {
    gnome: {
        start: [2474, 3436, 0],
        lapBonus: 39,
        // Landing tiles from gnome_course.rs2: the log ends at (2474,3429), the net on
        // plane 1 two tiles south, the branch on plane 2 at (2473,3420), the rope at
        // (2483,3420) still on plane 2, the tree-down on the ground at (2487,3420), the
        // second net two tiles north of where it is climbed, and the pipes at (2484,3437)
        // and (2487,3437), the lap start's row.
        zones: [
            { step: 'branch', plane: 1, box: [2465, 3410, 2495, 3445] },
            { step: 'rope', plane: 2, box: [2465, 3410, 2477, 3445] },
            { step: 'tree-down', plane: 2, box: [2478, 3410, 2495, 3445] },
            { step: 'pipe', plane: 0, box: [2484, 3431, 2487, 3436] },
            { step: 'pipe', plane: 0, box: [2479, 3426, 2495, 3430] },
            { step: 'net2', plane: 0, box: [2479, 3410, 2495, 3425] },
            { step: 'net', plane: 0, box: [2465, 3426, 2478, 3430] },
            { step: 'log', plane: 0, box: [2465, 3431, 2495, 3445] }
        ],
        steps: [
            { name: 'log', locs: [[2295, 2474, 3435]], xp: 7.5 },
            { name: 'net', locs: [[2285, 2473, 3425], [2285, 2475, 3425], [2285, 2471, 3425]], xp: 7.5 },
            { name: 'branch', locs: [[2313, 2473, 3422]], xp: 5 },
            { name: 'rope', locs: [[2312, 2478, 3420]], xp: 7.5 },
            { name: 'tree-down', locs: [[2314, 2486, 3419], [2315, 2487, 3420], [2315, 2487, 3418]], xp: 5 },
            { name: 'net2', locs: [[2286, 2485, 3426], [2286, 2483, 3426], [2286, 2487, 3426]], xp: 7.5 },
            { name: 'pipe', locs: [[154, 2484, 3431], [4058, 2487, 3431]], xp: 7.5 + 39 }
        ]
    },
    barbarian: {
        start: [2551, 3554, 0],
        lapBonus: 42,
        steps: [
            { name: 'ropeswing', locs: [[2282, 2551, 3550]], xp: 20 },
            { name: 'log', locs: [[2294, 2550, 3546]], xp: 12.5 },
            { name: 'net', locs: [[2284, 2538, 3545]], xp: 7.5 },
            { name: 'ledge', locs: [[2302, 2535, 3547]], xp: 20 },
            { name: 'ladder-down', locs: [], xp: 0, plane: 0, op: -1 },
            { name: 'wall1', locs: [[1948, 2536, 3553]], xp: 12.5 },
            { name: 'wall2', locs: [[1948, 2539, 3553]], xp: 12.5 },
            { name: 'wall3', locs: [[1948, 2542, 3553]], xp: 12.5 + 42 }
        ]
    },
    wilderness: {
        start: [3004, 3937, 0],
        lapBonus: 498.9,
        // both pits exit by the ladder at (3005,10363), which comes up north of the
        // rope swing, beside the stepping stones
        resume: { ropeswing: 'stones', log: 'stones' },
        // Landing tiles from wilderness_course.rs2: the pipe ends at (3004,3950), the
        // swing at (3005,3958), the stones at (2996,3960), the log at (2994,3945) and
        // the rocks at (2994,3933). The pit ladder comes up beside the stones.
        zones: [
            { step: 'stones', box: [2985, 10330, 3025, 10390] },
            { step: 'pipe', box: [2985, 3915, 3015, 3937] },
            { step: 'ropeswing', box: [3003, 3938, 3012, 3952] },
            { step: 'stones', box: [3002, 3953, 3012, 3965] },
            { step: 'log', box: [2990, 3953, 3001, 3965] },
            { step: 'rocks', box: [2985, 3938, 3000, 3952] }
        ],
        pitExit: [1755, 3005, 10363], // m46_161.jm2
        lapArea: [
            [2992, 3931, 3007, 3962],
            [2985, 10330, 3025, 10390]
        ],
        steps: [
            { name: 'pipe', locs: [[2288, 3004, 3938]], xp: 12.5 },
            { name: 'ropeswing', locs: [[2283, 3005, 3952]], xp: 20 },
            { name: 'stones', locs: [[2311, 3001, 3960]], xp: 20 },
            { name: 'log', locs: [[2297, 3001, 3945]], xp: 20 },
            // the rocks award nothing themselves (wilderness_course.rs2); a lap whose
            // progress was broken by a fall ends here without the bonus
            { name: 'rocks', locs: [[2328, 2994, 3936], [2328, 2993, 3936], [2328, 2995, 3936]], xp: 498.9, endZ: 3933 }
        ]
    }
};
