// The run-commit floor, read at run time from its one source: STEP-MANIFEST.md entry 0's line
// "`RUN_COMMIT` at or after the run-commit floor, `<hash>`", in main's current copy. No floor
// lives in code, so a fold-in that moves the floor moves every check with it. RUN-HOST.md's step 0
// reads the same line.
//
// The check is `git merge-base --is-ancestor <floor> <RUN_COMMIT>`. Anything that cannot be
// decided (no line, two lines that disagree, a token that is not a commit hash, a fetch or a
// commit that does not resolve) refuses with the reason; it never passes by default.

export const MANIFEST_PATH = 'docs/speedrun/STEP-MANIFEST.md';

/** The canonical line's shape, with whatever stands in the floor's backticks. */
const FLOOR_LINE = /`RUN_COMMIT` at or after the run-commit floor, `([^`]*)`/g;
const HASH = /^[0-9a-f]{7,40}$/;

export type FloorParse = { ok: true; floor: string; line: number } | { ok: false; reason: string };

/** The floor named by `markdown` (STEP-MANIFEST.md's text). */
export function parseRunFloor(markdown: string): FloorParse {
    const found: { token: string; line: number }[] = [];
    markdown.split('\n').forEach((text, i) => {
        for (const m of text.matchAll(FLOOR_LINE)) found.push({ token: m[1]!, line: i + 1 });
    });
    if (!found.length) return { ok: false, reason: `${MANIFEST_PATH} has no "\`RUN_COMMIT\` at or after the run-commit floor, \`<hash>\`" line (entry 0)` };
    const bad = found.find(f => !HASH.test(f.token));
    if (bad) return { ok: false, reason: `${MANIFEST_PATH}:${bad.line}: the run-commit floor \`${bad.token}\` is not a commit hash` };
    const tokens = [...new Set(found.map(f => f.token))];
    if (tokens.length > 1) return { ok: false, reason: `${MANIFEST_PATH} names ${tokens.length} run-commit floors (${found.map(f => `${f.token} at line ${f.line}`).join(', ')}); entry 0's line must be the only one` };
    return { ok: true, floor: tokens[0]!, line: found[0]!.line };
}

/**
 * The demo's tick length at the floor freeze, from the same entry-0 bullet as the floor: the code
 * span `tickMs=<ms>` on the floor's line or the bullet's wrapped continuation lines. A missing field
 * refuses exactly like a missing floor; a malformed one (not a positive integer) or two that differ
 * refuse too.
 */
export type TickMsParse = { ok: true; tickMs: number; line: number } | { ok: false; reason: string };

const TICK_FIELD = /`tickMs=([^`]*)`/g;

export function parseFloorTickMs(markdown: string): TickMsParse {
    const lines = markdown.split('\n');
    const floors = lines.flatMap((text, i) => (text.match(FLOOR_LINE) ? [i] : []));
    if (!floors.length) return { ok: false, reason: `${MANIFEST_PATH} has no run-commit floor line, so no \`tickMs=<ms>\` beside it (entry 0)` };
    const found: { token: string; line: number }[] = [];
    for (const at of floors) {
        for (let i = at; i < lines.length; i++) {
            if (i > at && (!lines[i]!.trim() || /^\s*[-*] /.test(lines[i]!) || !/^\s/.test(lines[i]!))) break;
            for (const m of lines[i]!.matchAll(TICK_FIELD)) found.push({ token: m[1]!, line: i + 1 });
        }
    }
    if (!found.length) return { ok: false, reason: `${MANIFEST_PATH}:${floors[0]! + 1}: the run-commit floor's bullet carries no \`tickMs=<ms>\` (the demo's tick at the freeze)` };
    const bad = found.find(f => !/^[1-9]\d*$/.test(f.token));
    if (bad) return { ok: false, reason: `${MANIFEST_PATH}:${bad.line}: \`tickMs=${bad.token}\` is not a tick length in ms` };
    const values = [...new Set(found.map(f => Number(f.token)))];
    if (values.length > 1) return { ok: false, reason: `${MANIFEST_PATH} names ${values.length} freeze tick lengths (${found.map(f => `${f.token} at line ${f.line}`).join(', ')})` };
    return { ok: true, tickMs: values[0]!, line: found[0]!.line };
}

/** One git invocation: exit code and stdout. Injected in tests. */
export type Git = (args: readonly string[]) => Promise<{ code: number; out: string; err: string }>;

export function gitIn(repo: string): Git {
    return async args => {
        const p = Bun.spawn(['git', '-C', repo, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
        const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
        return { code, out, err: err.trim() };
    };
}

/** The floor check, with the freeze's tick length read from the same copy of the manifest when the manifest was read. */
export type FloorCheck = ({ ok: true; floor: string; runCommit: string; line: number } | { ok: false; reason: string; floor?: string }) & { tickMs?: TickMsParse };

export interface FloorOptions {
    /** The commit the run executes (RUN_COMMIT; default HEAD). */
    runCommit?: string;
    /** Where main's copy is read from (default `origin/main`). */
    mainRef?: string;
    /** Fetch `mainRef`'s branch first (default true): the floor is main's current one, not the checkout's. */
    fetch?: boolean;
}

async function resolve(git: Git, ref: string): Promise<string | null> {
    const r = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return r.code === 0 ? r.out.trim() : null;
}

/** Read the floor from main's current STEP-MANIFEST.md and check that the run commit includes it. */
export async function checkRunFloor(git: Git, o: FloorOptions = {}): Promise<FloorCheck> {
    const mainRef = o.mainRef ?? 'origin/main';
    if (o.fetch !== false) {
        const [remote, ...branch] = mainRef.split('/');
        const f = await git(['fetch', '--quiet', remote!, branch.join('/')]);
        if (f.code !== 0) return { ok: false, reason: `git fetch ${remote} ${branch.join('/')} failed (${f.err || `exit ${f.code}`}): main's current floor cannot be read` };
    }
    const show = await git(['show', `${mainRef}:${MANIFEST_PATH}`]);
    if (show.code !== 0) return { ok: false, reason: `git show ${mainRef}:${MANIFEST_PATH} failed (${show.err || `exit ${show.code}`})` };
    const tickMs = parseFloorTickMs(show.out);
    const parsed = parseRunFloor(show.out);
    if (!parsed.ok) return { ...parsed, tickMs };
    const floor = await resolve(git, parsed.floor);
    if (!floor) return { ok: false, floor: parsed.floor, tickMs, reason: `the run-commit floor ${parsed.floor} (${MANIFEST_PATH}:${parsed.line} on ${mainRef}) does not resolve to a commit here` };
    const runRef = o.runCommit ?? 'HEAD';
    const run = await resolve(git, runRef);
    if (!run) return { ok: false, floor: parsed.floor, tickMs, reason: `RUN_COMMIT ${runRef} does not resolve to a commit` };
    const anc = await git(['merge-base', '--is-ancestor', floor, run]);
    if (anc.code === 0) return { ok: true, floor: parsed.floor, runCommit: run, line: parsed.line, tickMs };
    if (anc.code === 1) return { ok: false, floor: parsed.floor, tickMs, reason: `RUN_COMMIT ${run.slice(0, 10)} does not include the run-commit floor ${parsed.floor} (${MANIFEST_PATH}:${parsed.line} on ${mainRef})` };
    return { ok: false, floor: parsed.floor, tickMs, reason: `git merge-base --is-ancestor ${parsed.floor} ${run.slice(0, 10)} failed (${anc.err || `exit ${anc.code}`})` };
}
