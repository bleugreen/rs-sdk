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
const SLOT_BUDGET_MIN = Number(args.get('slot-budget-min') ?? 25);
const YIELD_MIN = Number(args.get('yield-min') ?? 10);
const COUNT_S = Number(args.get('count-s') ?? 20);
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
    const recent = runs.filter(r => !mine.has(String(r.databaseId)) && Date.now() - Date.parse(r.updatedAt) < YIELD_MIN * 60_000);
    if (recent.length) return `yielding to ${recent.map(r => r.databaseId).join(', ')} (${r0(recent)} ago)`;
    return null;
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

function dispatch(): string | null {
    const t0 = Date.now();
    const r = gh(['workflow', 'run', WORKFLOW, '-R', REPO, '--ref', REF, '-f', `lite_ref=${LITE_REF}`]);
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
function collect(id: string, conclusion: string): Outcome {
    const dest = join(DIR, 'runs', id);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    if (conclusion === 'cancelled') {
        tsv('attempts.tsv', ATTEMPT_COLS, [pdt(Date.now()), id, 'cancelled', '', '', '', '', runUrl(id)]);
        return 'cancelled';
    }
    gh(['run', 'download', id, '-R', REPO, '-D', dest], 120_000);
    const sub = readdirSync(dest).map(d => join(dest, d)).find(d => existsSync(join(d, 'vantage.json'))) ?? dest;
    const vantage = readJson(join(sub, 'vantage.json')) ?? {};
    const direct = readJson(join(sub, 'direct.json'));
    const gwp = readJson(join(sub, 'gateway-path.json'));
    const skipped = readText(join(sub, 'skipped.txt')).trim();
    const base = [vantage.time_pdt ?? pdt(Date.now()), id];
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
        vantage.time_pdt, id, vantage.players_online ?? direct.playercountStart, direct.playercountEnd,
        count(1), count(2), count(3), t0.filter(t => t.ticks === 99 || t.ticks > 3).length,
        relay['1'] ?? (gwp ? 0 : ''), relay['2'] ?? (gwp ? 0 : ''), relay['3'] ?? (gwp ? 0 : ''),
        iv.p10, iv.p50, iv.p90, iv.max, fr.over400, fr.under200, fr.n,
        `${missCatch.filter(t => t.ticks > 1).length}/${missCatch.length}`,
        gwp?.publication_interval_ms ?? '', vantage.http_ms?.tcp_connect?.p50, vantage.runner?.azure?.location, runUrl(id)
    ]);
    // Keep what the analysis needs (trials, raw frames, ticks, vantage); drop the warm-GET samples.
    const keep = { ...direct, vantage, gatewayPath: gwp, runUrl: runUrl(id), react: { ...direct.react, warm: undefined } };
    writeFileSync(join(DIR, 'pairs', `pair-${String(vantage.time_pdt ?? '').replace(/\D/g, '').slice(0, 12)}-${id}.json`), JSON.stringify(keep));
    log(`gated ${id}: direct ${count(1)}:${count(2)}:${count(3)} relay ${relay['1'] ?? '-'}:${relay['2'] ?? '-'} pub p90 ${iv.p90} max ${iv.max} >400 ${fr.over400} <200 ${fr.under200}, ${vantage.players_online} online`);
    return 'gated';
}
const runUrl = (id: string) => `https://github.com/${REPO}/actions/runs/${id}`;
const ATTEMPT_COLS = ['pdt', 'run_id', 'outcome', 'edge', 'tcp_p50_ms', 'azure_region', 'detail', 'url'];
const PAIR_COLS = ['pdt', 'run_id', 'players_start', 'players_end', 'direct_1', 'direct_2', 'direct_3', 'direct_lost', 'relay_1', 'relay_2', 'relay_3',
    'pub_p10', 'pub_p50', 'pub_p90', 'pub_max', 'over400', 'under200', 'n_intervals', 'miss_given_catchup', 'relay_publication', 'tcp_p50_ms', 'azure_region', 'url'];

async function slot(slotStart: number) {
    const deadline = slotStart + SLOT_BUDGET_MIN * 60_000;
    for (let attempt = 1; Date.now() < deadline; attempt++) {
        if (!(await waitIdle(deadline))) break;
        const id = dispatch();
        if (!id) {
            await sleep(60_000);
            continue;
        }
        log(`slot ${pdt(slotStart)} attempt ${attempt}: dispatched ${id}`);
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
        // Slots on the PDT clock (:00 and :30 for 30 min); PDT is a whole-hour UTC offset.
        const start = Math.floor(Date.now() / period) * period;
        await slot(Math.max(start, Date.now() - 60_000));
        const next = start + period;
        if (next > Date.now()) await sleep(next - Date.now());
    }
    log('pairs: past --until, stopping');
}

async function countLoop() {
    while (Date.now() < UNTIL) {
        const r = spawnSync('curl', ['-s', '--max-time', '8', '-w', '\n%{time_connect} %{time_starttransfer}', `https://${HOST}/playercount`], { encoding: 'utf8' });
        const [body, timing] = (r.stdout ?? '').split('\n');
        let n: number | null = null;
        try {
            n = JSON.parse(body ?? '').count ?? null;
        } catch {}
        const [c, f] = (timing ?? '').split(' ').map(v => Math.round(Number(v) * 1000));
        tsv('playercount.tsv', ['pdt', 'epoch_ms', 'players', 'tcp_ms', 'ttfb_ms'], [pdt(Date.now()), Date.now(), n, c, f]);
        await sleep(COUNT_S * 1000);
    }
}

// --collect=ID,ID: classify and log finished runs (a backfill of earlier pairs), then exit.
if (args.has('collect')) {
    for (const id of args.get('collect')!.split(',').filter(Boolean)) {
        const r = gh(['run', 'view', id, '-R', REPO, '--json', 'conclusion']);
        log(`collect ${id}: ${collect(id, r.ok ? JSON.parse(r.out).conclusion : 'error')}`);
    }
    process.exit(0);
}

log(`start: ${WORKFLOW} on ${REPO} @ ${REF} (lite_ref=${LITE_REF}) every ${EVERY_MIN} min until ${UNTIL === Infinity ? 'stopped' : pdt(UNTIL)}; dir ${DIR}`);
await Promise.all([pairLoop(), countLoop()]);
