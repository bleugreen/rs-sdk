import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
    DEFAULT_WATCHLIST,
    DOC_END,
    DOC_PATH,
    DOC_START,
    ISOLATED_GIT_ENV,
    ISSUE_BODY_BUDGET,
    Matcher,
    compareHiscore,
    diffStat,
    loadWatchlist,
    matchCommit,
    parseHiscoreTop,
    parseLog,
    renderReport,
    renderWatchlistTable,
    splitDiff,
    type HiscoreRecord,
    type WatchEntry,
    type WatchReport
} from './upstream-watch.ts';

const TOOL = join(import.meta.dir, 'upstream-watch.ts');
const REPO_ROOT = resolve(import.meta.dir, '../..');
const FIXTURE = readFileSync(join(import.meta.dir, 'fixtures/hiscores-2026-10-20.html'), 'utf8');
const FIXTURE_TOP: HiscoreRecord = { name: 'stunbaron', level: 1881, ticks: 35916, time: '2h 59m 34s' };
const watchlist = loadWatchlist(DEFAULT_WATCHLIST);
const matcher = new Matcher(watchlist.entries);

describe('path attribution', () => {
    test('the first matching entry wins, so specific entries shadow general ones', () => {
        expect(matcher.attribute('server/content/scripts/skill_cooking/scripts/cooking_inv/scripts/wine/wine.rs2')?.id).toBe('wine');
        expect(matcher.attribute('server/content/scripts/skill_cooking/scripts/range.rs2')?.id).toBe('cooking');
        expect(matcher.attribute('server/content/scripts/skill_magic/scripts/spells/charge.rs2')?.id).toBe('charge');
        expect(matcher.attribute('server/content/scripts/skill_magic/scripts/spells/enchant.rs2')?.id).toBe('magic');
        expect(matcher.attribute('server/engine/src/web/pages/RankedHiscoresWorker.ts')?.id).toBe('hiscores');
        expect(matcher.attribute('server/engine/src/web/pages/worldfeed.ts')).toBeUndefined();
        expect(matcher.attribute('server/engine/test/hiscores-performance.test.ts')).toBeUndefined();
    });

    test('quest changes are grouped by quest directory', () => {
        const commit = parseLog('\x1eabc\x1f2026-10-20T00:00:00Z\x1fmax\x1fquests\nM\tserver/content/scripts/quests/quest_dragon/scripts/elvarg.rs2\nA\tserver/content/scripts/quests/quest_grandtree/configs/x.npc\n')[0]!;
        const files = matchCommit(commit, matcher);
        expect(files.map(f => [f.entry.id, f.group])).toEqual([
            ['quests', 'quest_dragon'],
            ['quests', 'quest_grandtree']
        ]);
    });

    test('a rename matches on either side', () => {
        const commit = parseLog(
            '\x1eabc\x1f2026-10-20T00:00:00Z\x1fmax\x1fmove\nR100\tserver/engine/src/engine/World.ts\tserver/engine/src/engine/WorldLoop.ts\nR090\tserver/engine/src/lib/x.ts\tsdk/x.ts\nR100\tdocs/a.md\tdocs/b.md\n'
        )[0]!;
        const files = matchCommit(commit, matcher);
        expect(files.map(f => [f.entry.id, f.change.oldPath, f.change.path])).toEqual([
            ['world', 'server/engine/src/engine/World.ts', 'server/engine/src/engine/WorldLoop.ts'],
            ['sdk', 'server/engine/src/lib/x.ts', 'sdk/x.ts']
        ]);
    });

    test('stale patterns are those matching no upstream file', () => {
        const entries: WatchEntry[] = [{ id: 'a', title: 'A', why: 'w', paths: ['src/a.ts', 'src/gone/**'] }];
        expect(new Matcher(entries).stalePatterns(['src/a.ts', 'src/b.ts']).map(s => s.pattern)).toEqual(['src/gone/**']);
    });
});

describe('diff parsing', () => {
    const show = [
        'diff --git a/x.ts b/x.ts',
        'index 1..2 100644',
        '--- a/x.ts',
        '+++ b/x.ts',
        '@@ -1,2 +1,2 @@',
        '-old',
        '+new',
        '+more',
        'diff --git a/gone.ts b/gone.ts',
        'deleted file mode 100644',
        '--- a/gone.ts',
        '+++ /dev/null',
        '@@ -1 +0,0 @@',
        '-bye',
        'diff --git a/from.ts b/to.ts',
        'similarity index 100%',
        'rename from from.ts',
        'rename to to.ts',
        'diff --git a/mode.sh b/mode.sh',
        'old mode 100644',
        'new mode 100755',
        ''
    ].join('\n');

    test('splits git show output per file, keyed by the post-change path', () => {
        const diffs = splitDiff(show);
        expect([...diffs.keys()]).toEqual(['x.ts', 'gone.ts', 'to.ts', 'mode.sh']);
        expect(diffStat(diffs.get('x.ts')!)).toEqual({ added: 2, removed: 1, binary: false });
        expect(diffStat(diffs.get('gone.ts')!)).toEqual({ added: 0, removed: 1, binary: false });
    });
});

describe('hiscores', () => {
    test('parses row 1 of the saved demo page', () => {
        expect(parseHiscoreTop(FIXTURE)).toEqual(FIXTURE_TOP);
    });

    test('an unchanged #1 is not a finding', () => {
        expect(compareHiscore(FIXTURE_TOP, { status: 'ok', record: parseHiscoreTop(FIXTURE)! }).finding).toBe(false);
    });

    test('a new name or a new tick count is a finding', () => {
        const renamed = parseHiscoreTop(FIXTURE.replace('/hiscores/player/stunbaron?', '/hiscores/player/someoneelse?'))!;
        expect(renamed.name).toBe('someoneelse');
        expect(compareHiscore(FIXTURE_TOP, { status: 'ok', record: renamed }).finding).toBe(true);

        const faster = parseHiscoreTop(FIXTURE.replace('title="35,916 ticks"', 'title="35,000 ticks"'))!;
        expect(faster.ticks).toBe(35000);
        expect(compareHiscore(FIXTURE_TOP, { status: 'ok', record: faster }).finding).toBe(true);
    });

    test('a page that loads but does not parse is a finding; an unreachable page is only a warning', () => {
        expect(parseHiscoreTop('<html><body>maintenance</body></html>')).toBeUndefined();
        expect(compareHiscore(FIXTURE_TOP, { status: 'unparsed', error: 'x' }).finding).toBe(true);
        expect(compareHiscore(FIXTURE_TOP, { status: 'unreachable', error: 'timeout' }).finding).toBe(false);
    });
});

describe('issue body budget', () => {
    test('an oversized report fits the budget and keeps the summary, hiscore and commit table', () => {
        const entry = watchlist.entries.find(e => e.id === 'player')!;
        const bigDiff = ['diff --git a/p.ts b/p.ts', '--- a/p.ts', '+++ b/p.ts', '@@ -1 +1,5000 @@', ...Array.from({ length: 5000 }, (_, i) => `+line ${i} ${'x'.repeat(40)}`)].join('\n');
        const watched = Array.from({ length: 12 }, (_, i) => ({
            commit: { sha: `${i}`.padStart(40, 'a'), date: '2026-10-20T00:00:00Z', author: 'max', subject: `change ${i}`, files: [] },
            files: [{ change: { status: 'M', path: 'p.ts' }, entry }],
            diffs: new Map([['p.ts', bigDiff]])
        }));
        const report: WatchReport = {
            web: 'https://github.com/MaxBittker/rs-sdk',
            base: 'b'.repeat(40),
            head: 'c'.repeat(40),
            baseStatus: 'ok',
            commitsTotal: 12,
            watched,
            hiscore: { status: 'ok', previous: FIXTURE_TOP, current: FIXTURE_TOP, finding: false },
            stale: [],
            warnings: []
        };
        const full = renderReport(report);
        const body = renderReport(report, ISSUE_BODY_BUDGET);
        expect(full.length).toBeGreaterThan(ISSUE_BODY_BUDGET);
        expect(body.length).toBeLessThanOrEqual(ISSUE_BODY_BUDGET);
        expect(body).toContain('Diffs truncated to fit a GitHub issue');
        expect(body).toContain('more diff lines in this file');
        expect(body).toContain('### Hiscore #1');
        expect(body).toContain('| Commit | Date | Author | Subject | Watched |');
        expect(body).toContain('change 11');
    });
});

describe('watchlist', () => {
    test('the documentation table matches the watchlist (regenerate with --write-doc)', () => {
        const doc = readFileSync(DOC_PATH, 'utf8');
        const section = doc.slice(doc.indexOf(DOC_START) + DOC_START.length, doc.indexOf(DOC_END)).trim();
        expect(section).toBe(renderWatchlistTable(watchlist));
    });

    test('every pattern matches a file in this checkout', () => {
        const files = Bun.spawnSync(['git', 'ls-files'], { cwd: REPO_ROOT }).stdout.toString().split('\n').filter(Boolean);
        expect(matcher.stalePatterns(files).map(s => s.pattern)).toEqual([]);
    });
});

describe('end to end against a local upstream', () => {
    let dir: string;
    let upstream: string;
    let served = FIXTURE;
    let server: ReturnType<typeof Bun.serve>;
    const shas: string[] = [];

    const git = (...args: string[]) => {
        const p = Bun.spawnSync(['git', '-c', 'user.name=Upstream', '-c', 'user.email=up@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: upstream, env: { ...process.env, ...ISOLATED_GIT_ENV } });
        if (p.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${p.stderr}`);
        return p.stdout.toString().trim();
    };
    const commit = (message: string) => {
        git('add', '-A');
        git('commit', '-q', '-m', message);
        shas.push(git('rev-parse', 'HEAD'));
    };
    const write = (path: string, content: string) => Bun.write(join(upstream, path), content);

    const run = async (...args: string[]) => {
        const p = Bun.spawn(['bun', TOOL, '--watchlist', join(dir, 'watchlist.json'), '--state', join(dir, 'state.json'), '--cache-dir', join(dir, 'cache.git'), '--summary-json', join(dir, 'summary.json'), ...args], {
            stdout: 'pipe',
            stderr: 'pipe'
        });
        const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
        return { code, stdout, stderr, summary: JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) };
    };
    const state = () => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));

    beforeAll(async () => {
        dir = mkdtempSync(join(tmpdir(), 'upstream-watch-'));
        upstream = join(dir, 'upstream');
        Bun.spawnSync(['git', 'init', '-q', '-b', 'main', upstream], { env: { ...process.env, ...ISOLATED_GIT_ENV } });
        await write('watched/a.txt', 'one\n');
        await write('watched/keep.txt', 'kept\n');
        await write('other/b.txt', 'b\n');
        commit('initial');
        await write('watched/a.txt', 'one\ntwo\n');
        commit('touch a watched file');
        await write('other/b.txt', 'b2\n');
        commit('touch an unwatched file');
        git('mv', 'watched/keep.txt', 'elsewhere/keep.txt');
        commit('move a watched file out');

        server = Bun.serve({ port: 0, fetch: () => new Response(served, { headers: { 'content-type': 'text/html' } }) });
        writeFileSync(
            join(dir, 'watchlist.json'),
            JSON.stringify({
                upstream: { url: `file://${upstream}`, branch: 'main', web: 'https://github.com/example/upstream' },
                hiscores: { url: `http://127.0.0.1:${server.port}/hiscores` },
                entries: [{ id: 'w', title: 'Watched', paths: ['watched/**'], why: 'Because the test says so.' }]
            })
        );
        writeFileSync(join(dir, 'state.json'), JSON.stringify({ upstream: { commit: shas[0] }, hiscore: FIXTURE_TOP }));
    });

    afterAll(() => {
        server?.stop(true);
        rmSync(dir, { recursive: true, force: true });
    });

    test('reports watched commits and leaves state alone without --update', async () => {
        const before = readFileSync(join(dir, 'state.json'), 'utf8');
        const r = await run();
        expect(r.code).toBe(1);
        expect(r.summary.commitsTotal).toBe(3);
        expect(r.summary.watchedCommits).toEqual([shas[1], shas[3]]);
        expect(r.summary.hiscoreChanged).toBe(false);
        expect(r.stdout).toContain('`watched/a.txt` (modified)');
        expect(r.stdout).toContain('`watched/keep.txt` → `elsewhere/keep.txt` (renamed)');
        expect(r.stdout).toContain('+two');
        expect(r.stdout).not.toContain('other/b.txt');
        expect(readFileSync(join(dir, 'state.json'), 'utf8')).toBe(before);
    }, 30_000);

    test('--update advances state, and a rerun has nothing to report', async () => {
        expect((await run('--update')).code).toBe(1);
        expect(state().upstream.commit).toBe(shas[3]);
        const again = await run('--update');
        expect(again.code).toBe(0);
        expect(again.summary.stateChanged).toBe(false);
    }, 30_000);

    test('a new hiscore #1 is reported and recorded', async () => {
        served = FIXTURE.replace('/hiscores/player/stunbaron?', '/hiscores/player/someoneelse?');
        const r = await run('--update');
        expect(r.code).toBe(1);
        expect(r.summary.title).toBe('Upstream watch: hiscore #1 changed (stunbaron → someoneelse)');
        expect(state().hiscore.name).toBe('someoneelse');
        served = FIXTURE;
    }, 30_000);

    test('a baseline missing from upstream history is reported and reset', async () => {
        writeFileSync(join(dir, 'state.json'), JSON.stringify({ upstream: { commit: 'f'.repeat(40) }, hiscore: FIXTURE_TOP }));
        const r = await run('--update');
        expect(r.code).toBe(1);
        expect(r.summary.baseStatus).toBe('missing');
        expect(r.stdout).toContain('upstream rewrote or force-pushed');
        expect(state().upstream.commit).toBe(shas[3]);
    }, 30_000);
});
