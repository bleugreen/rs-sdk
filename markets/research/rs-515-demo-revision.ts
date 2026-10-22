// Dates the demo server's deployed engine commit from public evidence only
// (markets Q1d, rs/515; write-up in docs/markets/demo-revision.md).
//
// Read-only and gentle: six plain HTTP GETs to the demo, at least GAP_MS apart,
// one passive worldfeed WebSocket that sends nothing and is held until the server
// closes it or WS_HOLD_MS passes, and one GitHub API call for upstream's tip.
// No login, no game socket, no form posts.
//
// Each fingerprint is a string a dated upstream commit introduced into something
// the demo serves. Present on the demo => the deploy is at or after that commit.
// Absent => before it. The script prints each verdict and the resulting bracket
// against the Managing Miscellania coin-dupe fix (ca0fe09cc8, merged in e4441c6233).
//
//   bun markets/research/rs-515-demo-revision.ts                 # probe the demo
//   bun markets/research/rs-515-demo-revision.ts --verify-repo   # check each marker
//       first appears in its credited commit (git show <c>:<file> vs <c>^), no network
//
// The origin comes from speedrun/tools/hiscore-scrape.ts so no host is written here.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { BASE_URL } from '../../speedrun/tools/hiscore-scrape.ts';

const GAP_MS = 5_000;
const WS_HOLD_MS = 150_000;
const FIX = 'ca0fe09cc80';
const UPSTREAM_COMMITS_API = 'https://api.github.com/repos/MaxBittker/rs-sdk/commits?per_page=1';

type Surface = 'hiscores' | 'bundle' | 'worldfeed' | 'version';

const UNPUBLISHED = 'unpublished';
// ac6ef5e42cd's time cell; a later build appends text to the title, so allow a suffix.
const HISCORE_SPAN = /<span title="[\d,]+ ticks[^"]*" style="font-variant-numeric: tabular-nums">/;

type Fingerprint = {
    commit: string;
    date: string;
    subject: string;
    surface: Surface;
    path: string; // public path, origin omitted
    file: string; // repo file the marker lives in
    needle: string; // literal that appears in `file` first at `commit`
    test: (s: Observed) => boolean | null; // null = not observed
};

type Observed = {
    version?: string;
    hiscoresHtml?: string;
    bundle?: string;
    feedHello?: boolean;
    feedClose?: { code: number; reason: string; afterMs: number } | null;
};

const has = (body: string | undefined, re: RegExp | string): boolean | null =>
    body === undefined ? null : typeof re === 'string' ? body.includes(re) : re.test(body);

const FINGERPRINTS: Fingerprint[] = [
    {
        commit: '68ff9ebf826', date: '2026-10-09 15:10 -0400', subject: 'engine: add an optional live world feed',
        surface: 'worldfeed', path: '/worldfeed', file: 'server/engine/src/web/worldfeed.ts', needle: "t: 'hello'",
        test: s => s.feedHello ?? null
    },
    {
        commit: '8b7be3de4b0', date: '2026-10-11 01:10 -0400', subject: 'fix(sdk): reject text dialogue clicks after the page changes',
        surface: 'bundle', path: '/bot/client.js', file: 'server/webclient/src/bot/ActionExecutor.ts', needle: "'stale_dialog'",
        test: s => has(s.bundle, 'stale_dialog')
    },
    {
        commit: '07d53516abb', date: '2026-10-12 14:30 -0400', subject: "fix(webclient): don't report talk/trade NPC targets as combat opponents",
        surface: 'bundle', path: '/bot/client.js', file: 'server/webclient/src/bot/StateCollector.ts', needle: '/^attack$/i',
        test: s => has(s.bundle, '/^attack$/i')
    },
    {
        commit: '54f3e62084c', date: '2026-10-18 09:30 -0400', subject: "feat(webclient): publish nearby players' combat targets",
        surface: 'bundle', path: '/bot/client.js', file: 'server/webclient/src/bot/StateCollector.ts', needle: 'combatTargetTelemetryVersion',
        test: s => has(s.bundle, 'combatTargetTelemetryVersion')
    },
    {
        commit: 'ac6ef5e42cd', date: '2026-10-18 22:28 -0400', subject: 'feat(hiscores): show times to the second with aligned columns',
        surface: 'hiscores', path: '/hiscores?category=0&profile=main', file: 'server/engine/src/web/pages/hiscores.ts',
        needle: 'font-variant-numeric: tabular-nums',
        test: s => has(s.hiscoresHtml, HISCORE_SPAN)
    },
    {
        // The server sends close(1001, reason); the client has been seen to report code 1000 with
        // the same reason, so the reason text and the ~120 s delay are what identify it.
        commit: 'b565f2d920b', date: '2026-10-19 17:31 -0400', subject: 'Raise world feed capacity and expire idle clients',
        surface: 'worldfeed', path: '/worldfeed', file: 'server/engine/src/web/worldfeed.ts', needle: 'World feed idle timeout',
        test: s => (s.feedClose === undefined ? null : s.feedClose !== null && s.feedClose.reason === 'World feed idle timeout')
    },
    {
        // Not in any commit of upstream or this fork: present means the demo runs unpublished code
        // newer than upstream's tip. --verify-repo checks it is absent from all history.
        commit: UNPUBLISHED, date: '(not pushed)', subject: 'hiscore tick titles normalized to the live tick length',
        surface: 'hiscores', path: '/hiscores?category=0&profile=main', file: 'server/engine/src/web/pages/hiscores.ts',
        needle: 'ticks normalized to',
        test: s => has(s.hiscoresHtml, /title="[\d,]+ ticks normalized to \d+ ms per tick"/)
    }
];

// The demo saved by an earlier session (2026-10-21 03:30Z, committed in c76dfd483b0).
const FIXTURE_2026_10_21 = 'speedrun/tools/fixtures/hiscores-2026-10-20.html';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const sha256 = (b: ArrayBuffer | string) => createHash('sha256').update(typeof b === 'string' ? b : Buffer.from(b)).digest('hex').slice(0, 16);
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const isAncestor = (a: string, b: string) => {
    if (b === UNPUBLISHED) return isAncestor(a, 'b565f2d920b'); // built on upstream's tip (its markers are present)
    try {
        execFileSync('git', ['merge-base', '--is-ancestor', a, b], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
};

function verifyRepo(): void {
    let ok = true;
    for (const f of FINGERPRINTS) {
        if (f.commit === UNPUBLISHED) {
            const hits = git('log', '--all', '--format=%h', '-S', f.needle, '--', 'server').trim();
            ok &&= hits === '';
            console.log(`${hits === '' ? 'ok  ' : 'FAIL'} ${JSON.stringify(f.needle)} is in no commit of any ref${hits ? ` (found in ${hits})` : ''}`);
            continue;
        }
        let at = '';
        let before = '';
        try { at = git('show', `${f.commit}:${f.file}`); } catch { /* file absent */ }
        try { before = git('show', `${f.commit}^:${f.file}`); } catch { /* file absent */ }
        const introduced = at.includes(f.needle) && !before.includes(f.needle);
        const afterFix = isAncestor(FIX, f.commit);
        ok &&= introduced;
        console.log(`${introduced ? 'ok  ' : 'FAIL'} ${f.commit} ${f.file} ${JSON.stringify(f.needle)} introduced=${introduced} containsFix=${afterFix}`);
    }
    const fixture: Observed = { hiscoresHtml: require('node:fs').readFileSync(FIXTURE_2026_10_21, 'utf8') };
    for (const f of FINGERPRINTS.filter(f => f.surface === 'hiscores')) {
        console.log(`fixture ${FIXTURE_2026_10_21}: ${f.commit} marker present=${f.test(fixture)}`);
    }
    process.exit(ok ? 0 : 1);
}

let lastRequest = 0;
async function get(path: string): Promise<Response> {
    const wait = lastRequest + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    const res = await fetch(`${BASE_URL}${path}`, { headers: { 'User-Agent': 'rs-sdk research (rs/515, read-only)' } });
    console.log(`GET <demo>${path} -> ${res.status} ${headerLine(res)}`);
    return res;
}

function headerLine(res: Response): string {
    return ['last-modified', 'etag', 'date', 'content-length', 'cache-control']
        .map(h => (res.headers.get(h) ? `${h}=${res.headers.get(h)}` : ''))
        .filter(Boolean).join(' ');
}

function holdWorldFeed(obs: Observed): Promise<void> {
    const url = `${BASE_URL.replace(/^http/, 'ws')}/worldfeed`;
    return new Promise(resolve => {
        const opened = Date.now();
        const ws = new WebSocket(url);
        const timer = setTimeout(() => {
            obs.feedClose = null; // still open after WS_HOLD_MS: no idle expiry
            ws.close();
            resolve();
        }, WS_HOLD_MS);
        ws.onmessage = ev => {
            if (obs.feedHello) return;
            try {
                const msg = JSON.parse(String(ev.data));
                if (msg.t === 'hello') {
                    obs.feedHello = true;
                    console.log(`worldfeed hello: ${JSON.stringify(msg).slice(0, 300)}`);
                }
            } catch { /* binary or non-JSON frame */ }
        };
        ws.onclose = ev => {
            if (obs.feedClose !== undefined) return;
            clearTimeout(timer);
            obs.feedClose = { code: ev.code, reason: ev.reason, afterMs: Date.now() - opened };
            console.log(`worldfeed closed by server: code=${ev.code} reason=${JSON.stringify(ev.reason)} after ${obs.feedClose.afterMs} ms`);
            resolve();
        };
        ws.onerror = () => console.log('worldfeed socket error');
    });
}

async function probe(): Promise<void> {
    const obs: Observed = {};

    // The worldfeed hold runs in the background while the HTTP reads proceed.
    const feed = holdWorldFeed(obs);

    const version = await get('/api/version');
    obs.version = await version.text();
    console.log(`version body: ${obs.version.slice(0, 200)}`);

    const root = await get('/');
    const rootHtml = await root.text();
    const token = rootHtml.match(/bot\/client\.js\?v=([0-9a-z]+)/)?.[1];
    if (token) {
        const started = new Date(parseInt(token, 36));
        console.log(`client cache-bust token ${token} = process start ${started.toISOString()} (CLIENT_CACHEBUST, web/pages/client.ts)`);
    }

    const bundle = await get(`/bot/client.js${token ? `?v=${token}` : ''}`);
    const bundleBuf = await bundle.arrayBuffer();
    obs.bundle = new TextDecoder().decode(bundleBuf);
    console.log(`bundle bytes=${bundleBuf.byteLength} sha256/16=${sha256(bundleBuf)}`);

    const hiscores = await get('/hiscores?category=0&profile=main');
    obs.hiscoresHtml = await hiscores.text();
    const sampleTime = obs.hiscoresHtml.match(/<span title="[^"]*ticks[^"]*"[^>]*>[^<]*<\/span>/)?.[0]
        ?? obs.hiscoresHtml.match(/\d+h \d+m(?: \d+s)?<br>/)?.[0];
    console.log(`hiscores sample time cell: ${sampleTime ?? '(none found)'}`);

    // Static files served through Bun.file: any Last-Modified here is the file's mtime in the image.
    await (await get('/ondemand.zip')).body?.cancel();
    await (await get('/favicon.ico')).arrayBuffer();

    const upstream = await fetch(UPSTREAM_COMMITS_API, { headers: { Accept: 'application/vnd.github+json' } });
    const tip = upstream.ok ? ((await upstream.json()) as { sha: string; commit: { committer: { date: string } } }[])[0] : undefined;
    if (tip) console.log(`upstream tip: ${tip.sha.slice(0, 11)} committed ${tip.commit.committer.date}`);

    console.log(`waiting up to ${WS_HOLD_MS / 1000}s for the worldfeed to expire the silent socket...`);
    await feed;

    console.log('\n| commit | date | marker | demo path | present | contains fix |');
    console.log('|---|---|---|---|---|---|');
    let lower: Fingerprint | undefined;
    let upper: Fingerprint | undefined;
    for (const f of FINGERPRINTS) {
        const seen = f.test(obs);
        console.log(`| ${f.commit} | ${f.date} | ${f.needle} | <demo>${f.path} | ${seen === null ? 'not observed' : seen ? 'yes' : 'no'} | ${isAncestor(FIX, f.commit) ? 'yes' : 'no'} |`);
        if (seen === true) lower = f;
        if (seen === false && !upper) upper = f;
    }

    const lowerHasFix = lower ? isAncestor(FIX, lower.commit) : false;
    const tipNote = lower?.commit === UNPUBLISHED ? `newer than upstream's tip ${tip?.sha.slice(0, 11) ?? '?'}` : `no later upstream commit (tip ${tip?.sha.slice(0, 11) ?? '?'})`;
    console.log(`\nbracket: at or after ${lower?.commit ?? '(none)'}${upper ? `, before ${upper.commit}` : `, ${tipNote}`}`);
    if (lower && upper && FINGERPRINTS.indexOf(upper) < FINGERPRINTS.indexOf(lower)) {
        console.log('inconsistent: a newer marker is present while an older one is absent; read the rows');
    }
    console.log(`verdict: ${lowerHasFix ? 'fix live (lower bound already contains ' + FIX + ')' : upper && !isAncestor(FIX, upper.commit) ? 'fix not live' : 'undetermined'}`);
}

if (process.argv.includes('--verify-repo')) verifyRepo();
else await probe();
