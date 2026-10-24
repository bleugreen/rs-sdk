// A clip's staging, applied before filming starts with the lab's staff commands (speedrun/lab/setup.ts),
// so a clip can open mid-skill (Firemaking 80 with a full inventory of logs on the row) rather than on
// a fresh account. JSON, every key optional, applied in this order:
//
//   {
//     "leaveTutorial": true,                     a fresh account leaves Tutorial Island the run's way (default true)
//     "clearInventory": true,                    ::~clearinv inv and worn, then drop what is left
//     "stats": {"firemaking": 80},              ::setstat each
//     "give": {"tinderbox": 1, "magic_logs": 27}, ::give <debug name> <n>, waiting for each to land
//     "tele": [3019, 3362, 0],                   ::tele to x, z, level, waiting to land
//     "cheats": ["~energy"],                     any other :: commands, sent as written
//     "settleTicks": 3                           ticks to wait at the end (default 3)
//   }

import type { Session } from '../speedrun/lib/session';
import { waitTicks } from '../speedrun/lib/wait';
import { cheat, clearInventory, give, leaveTutorial, mustTele, setStats } from '../speedrun/lab/setup';

export interface SetupSpec {
    leaveTutorial?: boolean;
    clearInventory?: boolean;
    stats?: Record<string, number>;
    give?: Record<string, number>;
    tele?: [number, number] | [number, number, number];
    cheats?: string[];
    settleTicks?: number;
}

const KEYS = new Set(['leaveTutorial', 'clearInventory', 'stats', 'give', 'tele', 'cheats', 'settleTicks']);
const NAME = /^[a-z0-9_]+$/;
const int = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** Validate a setup spec read from a file; throws naming the first bad key. */
export function parseSetup(raw: unknown): SetupSpec {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('setup: must be a JSON object');
    const r = raw as Record<string, unknown>;
    for (const k of Object.keys(r)) if (!KEYS.has(k)) throw new Error(`setup: unknown key '${k}' (known: ${[...KEYS].join(', ')})`);
    for (const k of ['leaveTutorial', 'clearInventory'] as const) {
        if (r[k] !== undefined && typeof r[k] !== 'boolean') throw new Error(`setup: ${k} must be true or false`);
    }
    const table = (k: 'stats' | 'give', lo: number, hi: number) => {
        const v = r[k];
        if (v === undefined) return;
        if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`setup: ${k} must be an object of name: number`);
        for (const [name, n] of Object.entries(v)) {
            if (!NAME.test(name)) throw new Error(`setup: ${k} name '${name}' must be a debug name (a-z, 0-9, _)`);
            if (!int(n, lo, hi)) throw new Error(`setup: ${k}.${name} must be a whole number from ${lo} to ${hi}`);
        }
    };
    table('stats', 1, 99);
    table('give', 1, 2_147_483_647);
    if (r.tele !== undefined) {
        const t = r.tele;
        if (!Array.isArray(t) || t.length < 2 || t.length > 3 || !int(t[0], 0, 16383) || !int(t[1], 0, 16383) || (t.length === 3 && !int(t[2], 0, 3))) {
            throw new Error('setup: tele must be [x, z] or [x, z, level]');
        }
    }
    if (r.cheats !== undefined && (!Array.isArray(r.cheats) || r.cheats.some(c => typeof c !== 'string' || !c || c.startsWith('::')))) {
        throw new Error("setup: cheats must be a list of commands without the leading '::'");
    }
    if (r.settleTicks !== undefined && !int(r.settleTicks, 0, 100)) throw new Error('setup: settleTicks must be 0 to 100');
    return r as SetupSpec;
}

/** Stage the account. Returns one line per thing done, for the clip's log. */
export async function applySetup(session: Session, spec: SetupSpec): Promise<string[]> {
    const { sdk } = session;
    const done: string[] = [];
    if (spec.leaveTutorial !== false) {
        await leaveTutorial(session);
        done.push('off Tutorial Island');
    }
    if (spec.clearInventory) {
        await clearInventory(sdk);
        done.push('inventory and worn cleared');
    }
    if (spec.stats && Object.keys(spec.stats).length) {
        await setStats(sdk, spec.stats);
        done.push(`stats ${JSON.stringify(spec.stats)}`);
    }
    for (const [name, n] of Object.entries(spec.give ?? {})) {
        await give(sdk, name, n);
        done.push(`gave ${n} ${name}`);
    }
    if (spec.tele) {
        const [x, z, level = 0] = spec.tele;
        await mustTele(sdk, x, z, level);
        done.push(`at ${x},${z},${level}`);
    }
    for (const c of spec.cheats ?? []) {
        await cheat(sdk, c, 1);
        done.push(`::${c}`);
    }
    await waitTicks(sdk, spec.settleTicks ?? 3);
    return done;
}
