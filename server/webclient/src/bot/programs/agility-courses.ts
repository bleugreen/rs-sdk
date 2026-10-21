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
}

export const AGILITY_COURSES: Record<string, AgilityCourse> = {
    gnome: {
        start: [2474, 3436, 0],
        lapBonus: 39,
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
