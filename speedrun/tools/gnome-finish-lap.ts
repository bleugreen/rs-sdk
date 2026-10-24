// One-off: finish a Gnome Stronghold lap left mid-course, cheat-free, then log out cleanly.
//   bun speedrun/tools/gnome-finish-lap.ts <account> [--client=lite|browser]
// For an account parked after the balancing rope, on the level-2 platform by the tree (e.g.
// (2483,3420,2), where S11a's untilLevel stop can leave SCORED): clicks the lap's last three
// obstacles, tree-down (to level 0), net2 and pipe, with the loc ids and tiles of
// server/webclient/src/bot/programs/agility-courses.ts, and stops on the ground at the pipe's
// exit, the course end. gnome_course.rs2 has no fail branch, so an obstacle is done on its xp drop.
// Exit 0: on level 0 at the course end and logged out. 2: not where this tool starts (nothing
// clicked; already on level 0 is not an error: it only logs out). 3: an obstacle gave no xp.
// 4: the logout was not confirmed.
import type { BotSDK } from '../../sdk';
import type { BotWorldState } from '../../sdk/types';
import { agilityXp, waitTicksFor } from '../../docs/speedrun/scripts/agility-lib';
import { closeSession, logoutClean, openSession, type ClientKind } from '../lib/session';

const STEPS: Array<{ name: string; locs: Array<[number, number, number]> }> = [
    { name: 'tree-down', locs: [[2314, 2486, 3419], [2315, 2487, 3420], [2315, 2487, 3418]] },
    { name: 'net2', locs: [[2286, 2485, 3426], [2286, 2483, 3426], [2286, 2487, 3426]] },
    { name: 'pipe', locs: [[154, 2484, 3431], [4058, 2487, 3431]] }
];
/** The rope's far end and the tree-down platform (level 2). */
const PLATFORM = { x0: 2476, z0: 3417, x1: 2488, z1: 3422 };
/** South of net2, on the ground (after tree-down, before net2). */
const AFTER_TREE = { x0: 2480, z0: 3416, x1: 2492, z1: 3425 };
const EXIT = { ok: 0, notHere: 2, noXp: 3, logout: 4 } as const;

const say = (m: string) => console.log(`[gnome-finish-lap] ${m}`);
const where = (s: BotWorldState | null) => (s?.player ? `(${s.player.worldX},${s.player.worldZ},${s.player.level}) T${s.tick}` : '(no player)');
const inBox = (b: typeof PLATFORM, x: number, z: number) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;

function nearest(sdk: BotSDK, cands: Array<[number, number, number]>): [number, number, number] {
    const s = sdk.getState()!;
    const p = s.player!;
    let best: [number, number, number] | null = null;
    let d0 = Infinity;
    for (const c of cands) {
        if (!s.nearbyLocs.some(l => l.id === c[0] && l.x === c[1] && l.z === c[2])) continue;
        const d = Math.max(Math.abs(c[1] - p.worldX), Math.abs(c[2] - p.worldZ));
        if (d < d0) {
            d0 = d;
            best = c;
        }
    }
    return best ?? cands[0]!;
}

async function finishLap(sdk: BotSDK): Promise<number> {
    const s = sdk.getState()!;
    const p = s.player!;
    let first: number;
    if (p.level === 2 && inBox(PLATFORM, p.worldX, p.worldZ)) first = 0;
    else if (p.level === 0 && inBox(AFTER_TREE, p.worldX, p.worldZ)) first = 1;
    else if (p.level === 0) {
        say(`already on level 0 at ${where(s)}: nothing to click`);
        return EXIT.ok;
    } else {
        say(`not on the tree-down platform or just below it: ${where(s)}; clicking nothing`);
        return EXIT.notHere;
    }
    for (const step of STEPS.slice(first)) {
        let done = false;
        for (let attempt = 1; attempt <= 3 && !done; attempt++) {
            const xp0 = agilityXp(sdk.getState());
            const [id, x, z] = nearest(sdk, step.locs);
            say(`${step.name}: click loc ${id} at (${x},${z}) from ${where(sdk.getState())}, try ${attempt}`);
            await sdk.sendInteractLoc(x, z, id, 1);
            done = await waitTicksFor(sdk, st => agilityXp(st) > xp0, 40);
        }
        if (!done) {
            say(`${step.name}: no Agility xp after 3 clicks, at ${where(sdk.getState())}`);
            return EXIT.noXp;
        }
        // let the obstacle's movement finish before the next click
        await sdk.waitForTicks(1);
        say(`${step.name}: done, now at ${where(sdk.getState())}`);
    }
    const e = sdk.getState()?.player;
    say(`lap finished: ${where(sdk.getState())}${e && e.level === 0 ? '' : ' (NOT on level 0)'}`);
    return e && e.level === 0 ? EXIT.ok : EXIT.noXp;
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const account = args.find(a => !a.startsWith('--'));
    const client = (args.find(a => a.startsWith('--client='))?.slice(9) ?? 'lite') as ClientKind;
    if (!account || (client !== 'lite' && client !== 'browser')) {
        console.error('usage: bun speedrun/tools/gnome-finish-lap.ts <account> [--client=lite|browser]');
        process.exit(EXIT.notHere);
    }
    const session = await openSession(account, { client, pathfinding: false, readyTimeoutMs: 30_000 });
    let code: number = EXIT.noXp;
    try {
        code = await finishLap(session.sdk);
    } catch (err) {
        say((err as Error).message);
    }
    const logout = await logoutClean(session);
    await closeSession(session);
    say(`logout ${logout.ok ? 'confirmed' : `NOT confirmed (${logout.reason})`}`);
    process.exit(logout.ok ? code : EXIT.logout);
}
