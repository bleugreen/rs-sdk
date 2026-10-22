import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { checkRunFloor, gitIn, MANIFEST_PATH, parseRunFloor } from './run-floor';

const entry0 = (hash: string) => `## 0. Run commit\n\n  - **\`RUN_COMMIT\` includes rs/164, main's \`c2d9eada\`** (#146)\n  - **\`RUN_COMMIT\` at or after the run-commit floor, \`${hash}\`** (#314; main, fold-in 22; the single\n    check)\n`;

describe('parseRunFloor', () => {
    test('the current line', () => {
        expect(parseRunFloor(entry0('df332771'))).toEqual({ ok: true, floor: 'df332771', line: 4 });
    });

    test('a moved floor is read as moved, with no constant anywhere', () => {
        expect(parseRunFloor(entry0('bf3e7ce376'))).toMatchObject({ ok: true, floor: 'bf3e7ce376' });
    });

    test('a missing line refuses', () => {
        const r = parseRunFloor('## 0. Run commit\n\n  - `RUN_COMMIT` includes rs/164\n');
        expect(r.ok).toBe(false);
        expect(!r.ok && r.reason).toContain('no "`RUN_COMMIT` at or after the run-commit floor');
    });

    test('a malformed hash refuses', () => {
        for (const bad of ['df33277', 'DF332771', 'df33-2771', '', 'df332771 or later']) {
            const r = parseRunFloor(entry0(bad));
            if (bad === 'df33277') { expect(r.ok).toBe(true); continue; } // 7 hex is a short hash
            expect(r.ok).toBe(false);
            expect(!r.ok && r.reason).toContain('is not a commit hash');
        }
        expect(parseRunFloor(entry0('df3327')).ok).toBe(false);
    });

    test('two lines that disagree refuse; the same floor twice is one floor', () => {
        expect(parseRunFloor(entry0('df332771') + entry0('4fe2d0a8')).ok).toBe(false);
        expect(parseRunFloor(entry0('df332771') + entry0('df332771'))).toMatchObject({ ok: true, floor: 'df332771', line: 4 });
    });
});

describe('checkRunFloor on a scratch repository', () => {
    let dir = '';
    let floor = '';
    let after = '';
    let before = '';
    const sh = async (...args: string[]) => (await gitIn(dir)(args)).out.trim();

    beforeAll(async () => {
        dir = mkdtempSync(join(tmpdir(), 'run-floor-'));
        await sh('init', '-q', '-b', 'main');
        await sh('config', 'user.email', 't@t');
        await sh('config', 'user.name', 't');
        mkdirSync(join(dir, 'docs/speedrun'), { recursive: true });
        writeFileSync(join(dir, 'a'), '1');
        await sh('add', '.');
        await sh('commit', '-q', '-m', 'before');
        before = await sh('rev-parse', 'HEAD');
        writeFileSync(join(dir, 'a'), '2');
        await sh('commit', '-q', '-am', 'floor');
        floor = await sh('rev-parse', 'HEAD');
        writeFileSync(join(dir, MANIFEST_PATH), entry0(floor.slice(0, 8)));
        await sh('add', '.');
        await sh('commit', '-q', '-m', 'manifest');
        after = await sh('rev-parse', 'HEAD');
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    test('a run commit at or after the floor passes; one before it refuses', async () => {
        const git = gitIn(dir);
        expect(await checkRunFloor(git, { mainRef: 'main', fetch: false, runCommit: after })).toMatchObject({ ok: true, floor: floor.slice(0, 8), runCommit: after });
        expect(await checkRunFloor(git, { mainRef: 'main', fetch: false, runCommit: floor })).toMatchObject({ ok: true });
        const r = await checkRunFloor(git, { mainRef: 'main', fetch: false, runCommit: before });
        expect(r.ok).toBe(false);
        expect(!r.ok && r.reason).toContain('does not include the run-commit floor');
    });

    test('a run commit or floor that does not resolve refuses', async () => {
        const git = gitIn(dir);
        const r = await checkRunFloor(git, { mainRef: 'main', fetch: false, runCommit: 'deadbeef' });
        expect(!r.ok && r.reason).toContain('does not resolve');
        const fake: Parameters<typeof checkRunFloor>[0] = async args => args[0] === 'show' ? { code: 0, out: entry0('abcdef12'), err: '' } : git(args);
        const f = await checkRunFloor(fake, { mainRef: 'main', fetch: false });
        expect(!f.ok && f.reason).toContain('floor abcdef12');
    });

    test('a fetch that fails refuses rather than reading a stale floor', async () => {
        const r = await checkRunFloor(gitIn(dir), { mainRef: 'origin/main' });
        expect(r.ok).toBe(false);
        expect(!r.ok && r.reason).toContain('git fetch origin main failed');
    });
});
