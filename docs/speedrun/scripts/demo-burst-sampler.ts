// Overnight sampler for the demo's tick-overrun bursts (docs/speedrun/research/demo-latency.md,
// 'Overrun bursts overnight'). Two loops in one process:
//
//   pairs       every --every-min minutes (aligned to the PDT clock), dispatch the Ashburn pair
//               (demo-latency-probe.yml mode=pair) and re-dispatch while the job's vantage gate skips
//               the probe, until one run is gated or the slot is --slot-budget-min old. Each finished
//               run's artifacts land in DIR/runs/<id>/; a gated run appends one row to DIR/pairs.tsv
//               and keeps a trimmed direct.json in DIR/pairs/. Every dispatch appends to attempts.tsv.
//   playercount every --count-s seconds, the public /playercount with curl timings (no login).
//
//   bun docs/speedrun/scripts/demo-burst-sampler.ts --dir=/tmp/rs102-sampler [--until=12:00]
//       [--every-min=30] [--ref=agent/rs-83-coordinator-0] [--lite-ref=main] [--yield-min=10]
//       [--sample-minutes=6]   (0: the workflow's default react-only direct probe)
//       [--reserve=30-45]      (minutes past each PDT hour reserved for this sampler)
//       [--slot-offset-min=30] (with --every-min=60: one slot an hour at :30, when sharing the runner)
//       [--long-minutes=17 --long-idle-min=30]  (a direct-only long sample when the runner has been free)
//       [--foreign-since-min=60] (collect other dispatchers' finished runs from this far back)
//   bun docs/speedrun/scripts/demo-burst-sampler.ts --dir=... --collect=<run id>,...   (backfill, no dispatch)
//
// The workflow shares one concurrency group (and one demo account) with other dispatchers, and
// GitHub keeps only one pending run per group: a newer pending run cancels an older one. So a
// dispatch happens only when the workflow has no queued, waiting or in-progress run, no run this
// sampler did not start was created or updated in the last --yield-min minutes, and DIR/hold (an
// epoch in seconds, written by whoever needs the runner) is in the past.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) args.set(m[1]!, m[2] ?? 'true');
}
const DIR = args.get('dir') ?? '/tmp/rs102-sampler';
const REPO = args.get('repo') ?? 'bleugreen/rs-sdk';
const WORKFLOW = 'demo-latency-probe.yml';
const REF = args.get('ref') ?? 'agent/rs-83-coordinator-0';
const LITE_REF = args.get('lite-ref') ?? 'main';
const EVERY_MIN = Number(args.get('every-min') ?? 30);
const SLOT_OFFSET_MIN = Number(args.get('slot-offset-min') ?? 0);
const SLOT_BUDGET_MIN = Number(args.get('slot-budget-min') ?? 25);
const YIELD_MIN = Number(args.get('yield-min') ?? 10);
const COUNT_S = Number(args.get('count-s') ?? 20);
// The direct probe's command (the workflow's direct_command input): the default react trials plus
// --sample-minutes of tick steadiness in the same session, because only a vantage next to the app
// sees the server's tick spacing cleanly (a home path adds its own late-then-early pairs).
const SAMPLE_MIN = Number(args.get('sample-minutes') ?? 6);
const directCommand = (minutes: number) => args.get('direct-command') ??
    `bun docs/speedrun/scripts/demo-latency-probe.ts --label=gha-$RUNNER_AZURE_REGION --out=$OUT/direct.json --phases=react${minutes > 0 ? ',sample' : ''} --trials=$TRIALS --react-delay=0 --minutes=${minutes}`;
// Long sample: when no other dispatcher has used the runner for LONG_IDLE_MIN, a slot runs the direct
// probe alone (mode=direct) with LONG_MIN of sample in one session, to see a burst's onset and end.
// The workflow kills a probe at 1200 s, so react (~1.5 min) plus 17 min is the longest that fits.
const LONG_MIN = Number(args.get('long-minutes') ?? 0);
const LONG_IDLE_MIN = Number(args.get('long-idle-min') ?? 30);
const FINGERPRINT_EVERY = Number(args.get('fingerprint-every') ?? 15); // count polls between bundle hashes
// A window each hour (minutes past the PDT hour) agreed with the other dispatcher, in which this
// sampler dispatches as soon as the workflow is idle instead of yielding to recent foreign runs.
const RESERVE_FROM = args.has('reserve') ? Number(args.get('reserve')!.split('-')[0]) : null;
const RESERVE_TO = args.has('reserve') ? Number(args.get('reserve')!.split('-')[1]) : null;
const inReserve = (ms: number) => {
    if (RESERVE_FROM === null) return false;
    const m = Number(pdtParts(ms).minute);
    return m >= RESERVE_FROM && m < RESERVE_TO!;
};
const LOGIN_COOLDOWN_MS = 3 * 60_000; // the demo holds a session ~3 min after logout
const HOST = 'rs-sdk-demo.fly.dev';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const pdtParts = (ms: number) =>
    Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(ms).map(p => [p.type, p.value]));
const pdt = (ms: number) => {
    const p = pdtParts(ms);
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
};
/** --until=HH:MM is the next such PDT wall time (today, or tomorrow if already past). */
function untilMs(s: string | undefined): number {
    if (!s) return Infinity;
    if (/^\d{10,}$/.test(s)) return Number(s) * (s.length <= 10 ? 1000 : 1);
    const [h, m] = s.split(':').map(Number);
    const now = Date.now();
    const p = pdtParts(now);
    const offsetMin = Number(p.hour) * 60 + Number(p.minute) - (h! * 60 + (m ?? 0));
    let t = now - offsetMin * 60_000 - Number(p.second) * 1000;
    if (t <= now) t += 24 * 3600_000;
    return t;
}
const UNTIL = untilMs(args.get('until'));
const SINCE = Date.now() - Number(args.get('foreign-since-min') ?? 60) * 60_000;

mkdirSync(join(DIR, 'runs'), { recursive: true });
mkdirSync(join(DIR, 'pairs'), { recursive: true });
const MINE = join(DIR, 'mine.txt');
const mine = new Set(existsSync(MINE) ? readFileSync(MINE, 'utf8').split('\n').filter(Boolean) : []);
const log = (msg: string) => {
    const line = `${pdt(Date.now())} ${msg}`;
    console.log(line);
    appendFileSync(join(DIR, 'sampler.log'), line + '\n');
};
function tsv(file: string, header: string[], row: (string | number | null | undefined)[]) {
    const path = join(DIR, file);
    if (!existsSync(path)) writeFileSync(path, header.join('\t') + '\n');
    appendFileSync(path, row.map(v => (v === null || v === undefined ? '' : String(v))).join('\t') + '\n');
}

function gh(argv: string[], timeoutMs = 60_000): { ok: boolean; out: string } {
    const r = spawnSync('gh', argv, { encoding: 'utf8', timeout: timeoutMs });
    return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
interface RunRow { databaseId: number; status: string; conclusion: string; createdAt: string; updatedAt: string; headBranch: string }
function listRuns(): RunRow[] | null {
    const r = gh(['run', 'list', '-R', REPO, '-w', WORKFLOW, '-L', '30', '--json', 'databaseId,status,conclusion,createdAt,updatedAt,headBranch']);
    if (!r.ok) return null;
    try {
        return JSON.parse(r.out) as RunRow[];
    } catch {
        return null;
    }
}

/** Why the runner is not ours to take right now, or null when it is. */
function busyReason(): string | null {
    if (existsSync(join(DIR, 'hold'))) {
        const until = Number(readFileSync(join(DIR, 'hold'), 'utf8').trim()) * 1000;
        if (until > Date.now()) return `hold until ${pdt(until)}`;
    }
    const runs = listRuns();
    if (!runs) return 'gh run list failed';
    const active = runs.filter(r => r.status !== 'completed');
    if (active.length) return `active run ${active.map(r => `${r.databaseId} (${r.status}, ${r.headBranch})`).join(', ')}`;
    collectForeign(runs);
    const recent = runs.filter(r => !mine.has(String(r.databaseId)) && Date.now() - Date.parse(r.updatedAt) < YIELD_MIN * 60_000);
    if (recent.length && !inReserve(Date.now())) return `yielding to ${recent.map(r => r.databaseId).join(', ')} (${r0(recent)} ago)`;
    return null;
}
// Other dispatchers' runs on the same runner carry a direct-probe row too (rs/95's browser mode
// runs one as its reference): collect every finished one once, so each Ashburn row is in the series.
const SEEN = join(DIR, 'seen.txt');
const seen = new Set(existsSync(SEEN) ? readFileSync(SEEN, 'utf8').split('\n').filter(Boolean) : []);
function collectForeign(runs: RunRow[]) {
    for (const r of runs) {
        const id = String(r.databaseId);
        if (r.status !== 'completed' || mine.has(id) || seen.has(id) || Date.parse(r.createdAt) < SINCE) continue;
        seen.add(id);
        appendFileSync(SEEN, id + '\n');
        log(`foreign run ${id} (${r.headBranch}): ${collect(id, r.conclusion, r.headBranch.startsWith('agent/rs-95') ? 'rs95' : r.headBranch)}`);
    }
}
const r0 = (rs: RunRow[]) => `${Math.round((Date.now() - Math.max(...rs.map(r => Date.parse(r.updatedAt)))) / 60_000)} min`;

async function waitIdle(deadline: number): Promise<boolean> {
    let last = '';
    while (Date.now() < deadline) {
        const why = busyReason();
        if (!why) return true;
        if (why !== last) log(`waiting: ${why}`);
        last = why;
        await sleep(30_000);
    }
    return false;
}

function dispatch(long: boolean): string | null {
    const t0 = Date.now();
    const r = gh(['workflow', 'run', WORKFLOW, '-R', REPO, '--ref', REF, '-f', `lite_ref=${LITE_REF}`,
        '-f', `mode=${long ? 'direct' : 'pair'}`, '-f', `direct_command=${directCommand(long ? LONG_MIN : SAMPLE_MIN)}`]);
    if (!r.ok) {
        log(`dispatch failed: ${r.out.trim()}`);
        return null;
    }
    let id = /actions\/runs\/(\d+)/.exec(r.out)?.[1] ?? null;
    // Older gh prints no run URL: take the newest run on REF created after the dispatch.
    for (let i = 0; !id && i < 10; i++) {
        spawnSync('sleep', ['3']);
        const cand = (listRuns() ?? []).filter(x => x.headBranch === REF && Date.parse(x.createdAt) >= t0 - 5000 && !mine.has(String(x.databaseId)));
        if (cand.length) id = String(cand.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]!.databaseId);
    }
    if (!id) {
        log(`dispatched but no run id found: ${r.out.trim()}`);
        return null;
    }
    mine.add(id);
    appendFileSync(MINE, id + '\n');
    return id;
}

async function waitDone(id: string): Promise<string> {
    for (let i = 0; i < 120; i++) {
        const r = gh(['run', 'view', id, '-R', REPO, '--json', 'status,conclusion']);
        if (r.ok) {
            try {
                const j = JSON.parse(r.out);
                if (j.status === 'completed') return j.conclusion as string;
            } catch {}
        }
        await sleep(20_000);
    }
    return 'timeout';
}

const readJson = (p: string) => {
    try {
        return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
    } catch {
        return null;
    }
};
const readText = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

type Outcome = 'gated' | 'gate-skip' | 'probe-fail' | 'cancelled' | 'error';

/** Download the run's artifacts and classify it; a gated run is logged to pairs.tsv. */
function collect(id: string, conclusion: string, source = 'rs102'): Outcome {
    const dest = join(DIR, 'runs', id);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    if (conclusion === 'cancelled') {
        tsv('attempts.tsv', ATTEMPT_COLS, [pdt(Date.now()), id, source, 'cancelled', '', '', '', '', runUrl(id)]);
        return 'cancelled';
    }
    // The artifact can lag the run's completion by several seconds.
    let sub: string | undefined;
    for (let i = 0; i < 4 && !sub; i++) {
        if (i) spawnSync('sleep', ['15']);
        gh(['run', 'download', id, '-R', REPO, '-D', dest], 120_000);
        sub = readdirSync(dest).map(d => join(dest, d)).find(d => existsSync(join(d, 'vantage.json')));
    }
    if (!sub) {
        tsv('attempts.tsv', ATTEMPT_COLS, [pdt(Date.now()), id, source, 'no-artifacts', '', '', '', conclusion, runUrl(id)]);
        return 'error';
    }
    const vantage = readJson(join(sub, 'vantage.json')) ?? {};
    const direct = readJson(join(sub, 'direct.json'));
    const gwp = readJson(join(sub, 'gateway-path.json'));
    const skipped = readText(join(sub, 'skipped.txt')).trim();
    const base = [vantage.time_pdt ?? pdt(Date.now()), id, source];
    const where = [vantage.edge_region, vantage.http_ms?.tcp_connect?.p50, vantage.runner?.azure?.location];
    if (skipped) {
        tsv('attempts.tsv', ATTEMPT_COLS, [...base, 'gate-skip', ...where, skipped.replace(/^.*?::notice::/, ''), runUrl(id)]);
        return 'gate-skip';
    }
    const trials: any[] = direct?.react?.trials ?? [];
    if (!trials.length) {
        const errs = (readText(join(sub, 'direct.txt')) + readText(join(sub, 'direct-full.log')) + readText(join(sub, 'lite-runner.log')))
            .split('\n').filter(l => /logged in|error|fail|refused|timeout/i.test(l)).slice(0, 3).join(' | ');
        tsv('attempts.tsv', ATTEMPT_COLS, [...base, conclusion === 'success' ? 'probe-fail' : 'error', ...where, errs.slice(0, 300), runUrl(id)]);
        return 'probe-fail';
    }
    tsv('attempts.tsv', ATTEMPT_COLS, [...base, 'gated', ...where, '', runUrl(id)]);

    const t0 = trials.filter(t => t.delay === 0);
    const count = (k: number) => t0.filter(t => t.ticks === k).length;
    const fr = direct.react.frames ?? {};
    const iv = fr.intervals ?? {};
    const relay = gwp?.reaction_ticks ?? {};
    const missCatch = t0.filter(t => t.nextIntervalMs !== null && t.nextIntervalMs < 200);
    tsv('pairs.tsv', PAIR_COLS, [
        vantage.time_pdt, id, source, vantage.players_online ?? direct.playercountStart, direct.playercountEnd,
        count(1), count(2), count(3), t0.filter(t => t.ticks === 99 || t.ticks > 3).length,
        relay['1'] ?? (gwp ? 0 : ''), relay['2'] ?? (gwp ? 0 : ''), relay['3'] ?? (gwp ? 0 : ''),
        iv.p10, iv.p50, iv.p90, iv.max, fr.over400, fr.under200, fr.n,
        `${missCatch.filter(t => t.ticks > 1).length}/${missCatch.length}`,
        gwp?.publication_interval_ms ?? '', vantage.http_ms?.tcp_connect?.p50, vantage.runner?.azure?.location, runUrl(id)
    ]);
    // Keep what the analysis needs (trials, raw frames, ticks, vantage); drop the warm-GET samples.
    const keep = { ...direct, vantage, gatewayPath: gwp, runUrl: runUrl(id), dispatchedBy: source, react: { ...direct.react, warm: undefined } };
    writeFileSync(join(DIR, 'pairs', `pair-${String(vantage.time_pdt ?? '').replace(/\D/g, '').slice(0, 12)}-${id}.json`), JSON.stringify(keep));
    log(`gated ${id}: direct ${count(1)}:${count(2)}:${count(3)} relay ${relay['1'] ?? '-'}:${relay['2'] ?? '-'} pub p90 ${iv.p90} max ${iv.max} >400 ${fr.over400} <200 ${fr.under200}, ${vantage.players_online} online`);
    return 'gated';
}
const runUrl = (id: string) => `https://github.com/${REPO}/actions/runs/${id}`;
const ATTEMPT_COLS = ['pdt', 'run_id', 'source', 'outcome', 'edge', 'tcp_p50_ms', 'azure_region', 'detail', 'url'];
const PAIR_COLS = ['pdt', 'run_id', 'source', 'players_start', 'players_end', 'direct_1', 'direct_2', 'direct_3', 'direct_lost', 'relay_1', 'relay_2', 'relay_3',
    'pub_p10', 'pub_p50', 'pub_p90', 'pub_max', 'over400', 'under200', 'n_intervals', 'miss_given_catchup', 'relay_publication', 'tcp_p50_ms', 'azure_region', 'url'];

async function slot(slotStart: number) {
    const deadline = slotStart + SLOT_BUDGET_MIN * 60_000;
    for (let attempt = 1; Date.now() < deadline; attempt++) {
        if (!(await waitIdle(deadline))) break;
        const runs = listRuns() ?? [];
        const long = LONG_MIN > 0 && !runs.some(r => !mine.has(String(r.databaseId)) && Date.now() - Date.parse(r.updatedAt) < LONG_IDLE_MIN * 60_000);
        const id = dispatch(long);
        if (!id) {
            await sleep(60_000);
            continue;
        }
        log(`slot ${pdt(slotStart)} attempt ${attempt}: dispatched ${id} (${long ? `long direct, ${LONG_MIN} min sample` : `pair, ${SAMPLE_MIN} min sample`})`);
        const conclusion = await waitDone(id);
        const outcome = collect(id, conclusion);
        log(`run ${id}: ${conclusion}, ${outcome}`);
        if (outcome === 'gated') return;
        if (outcome === 'probe-fail') await sleep(LOGIN_COOLDOWN_MS);
    }
    log(`slot ${pdt(slotStart)}: no gated run within ${SLOT_BUDGET_MIN} min`);
}

async function pairLoop() {
    while (Date.now() < UNTIL) {
        const period = EVERY_MIN * 60_000;
        // Slots on the PDT clock (:00 and :30 for 30 min, or --slot-offset-min past); PDT is a whole-hour UTC offset.
        const offset = SLOT_OFFSET_MIN * 60_000;
        const start = Math.floor((Date.now() - offset) / period) * period + offset;
        await slot(Math.max(start, Date.now() - 60_000));
        const next = start + period;
        if (next > Date.now()) await sleep(next - Date.now());
    }
    log('pairs: past --until, stopping');
}

// The public player count, and a fingerprint of what serves it: the Fly machine (sid) and worker
// (bn) on every poll, and every FINGERPRINT_EVERY polls a hash of the web client bundle. A deploy
// changes the bundle (and usually the machine's image); a crash or out-of-memory exit changes neither.
async function countLoop() {
    for (let i = 0; Date.now() < UNTIL; i++) {
        const r = spawnSync('curl', ['-s', '--max-time', '8', '-H', 'flyio-debug: doit', '-D', '-', '-w', '\n%{time_connect} %{time_starttransfer}', `https://${HOST}/playercount`], { encoding: 'utf8' });
        const lines = (r.stdout ?? '').split(/\r?\n/);
        const timing = lines.at(-1) ?? '';
        const body = lines.at(-2) ?? '';
        let n: number | null = null;
        try {
            n = JSON.parse(body).count ?? null;
        } catch {}
        let fly: any = {};
        try {
            fly = JSON.parse(lines.find(l => /^flyio-debug:/i.test(l))?.replace(/^flyio-debug:\s*/i, '') ?? '{}');
        } catch {}
        const [c, f] = timing.split(' ').map(v => Math.round(Number(v) * 1000));
        tsv('playercount.tsv', ['pdt', 'epoch_ms', 'players', 'tcp_ms', 'ttfb_ms', 'fly_sid', 'fly_bn'], [pdt(Date.now()), Date.now(), n, c, f, fly.sid, fly.bn]);
        if (i % FINGERPRINT_EVERY === 0) {
            const hdrFile = join(DIR, '.client-js-headers');
            const b = spawnSync('sh', ['-c', `curl -s --max-time 20 -D ${hdrFile} https://${HOST}/bot/client.js | sha256sum`], { encoding: 'utf8' });
            const hdr = readText(hdrFile).split(/\r?\n/);
            const h = (k: string) => hdr.find(l => l.toLowerCase().startsWith(k + ':'))?.split(':').slice(1).join(':').trim();
            tsv('fingerprint.tsv', ['pdt', 'epoch_ms', 'client_js_sha256', 'content_length', 'etag', 'last_modified', 'server'],
                [pdt(Date.now()), Date.now(), (b.stdout ?? '').slice(0, 16), h('content-length'), h('etag'), h('last-modified'), h('server')]);
        }
        // The login path: a websocket upgrade on the game socket (no login; closed at once). The engine
        // answers 101 from its tick thread, so during an outage this fails separately from /playercount.
        if (i % 3 === 0) {
            const w = spawnSync('curl', ['-s', '--http1.1', '--max-time', '2', '-o', '/dev/null', '-w', '%{http_code} %{time_starttransfer}',
                '-H', 'Connection: Upgrade', '-H', 'Upgrade: websocket', '-H', 'Sec-WebSocket-Version: 13', '-H', 'Sec-WebSocket-Key: cnMxMDItcHJvYmUtMDAwMQ==', /* 16 bytes, or the upgrade is refused */ '-H', 'Sec-WebSocket-Protocol: binary',
                `https://${HOST}/`], { encoding: 'utf8' });
            const [code, t] = (w.stdout ?? '').split(' ');
            tsv('wsupgrade.tsv', ['pdt', 'epoch_ms', 'http_code', 'ms'], [pdt(Date.now()), Date.now(), code, Math.round(Number(t) * 1000)]);
        }
        await sleep(COUNT_S * 1000);
    }
}

// Runs this sampler dispatched that finished while it was not running (a restart): collect them now.
function collectOrphans() {
    const logged = new Set(readText(join(DIR, 'attempts.tsv')).split('\n').map(l => l.split('\t')[1]).filter(Boolean));
    for (const id of mine) {
        if (logged.has(id)) continue;
        const r = gh(['run', 'view', id, '-R', REPO, '--json', 'status,conclusion']);
        if (!r.ok) continue;
        const j = JSON.parse(r.out);
        if (j.status === 'completed') log(`orphan ${id}: ${collect(id, j.conclusion)}`);
    }
}

// --collect=ID,ID: classify and log finished runs (a backfill of earlier pairs), then exit.
if (args.has('collect')) {
    for (const id of args.get('collect')!.split(',').filter(Boolean)) {
        const r = gh(['run', 'view', id, '-R', REPO, '--json', 'conclusion,headBranch']);
        const j = r.ok ? JSON.parse(r.out) : { conclusion: 'error', headBranch: '' };
        log(`collect ${id}: ${collect(id, j.conclusion, args.get('source') ?? (j.headBranch.startsWith('agent/rs-95') ? 'rs95' : 'rs102'))}`);
    }
    process.exit(0);
}

log(`start: ${WORKFLOW} on ${REPO} @ ${REF} (lite_ref=${LITE_REF}, direct sample ${SAMPLE_MIN} min) every ${EVERY_MIN} min until ${UNTIL === Infinity ? 'stopped' : pdt(UNTIL)}; dir ${DIR}`);
collectOrphans();
const counting = countLoop();
// An orphan still running when this process started: wait for it before the first slot.
for (const id of mine) {
    const r = gh(['run', 'view', id, '-R', REPO, '--json', 'status,conclusion']);
    if (r.ok && JSON.parse(r.out).status !== 'completed') {
        log(`orphan ${id} still running, waiting`);
        log(`orphan ${id}: ${collect(id, await waitDone(id))}`);
    }
}
await Promise.all([pairLoop(), counting]);
