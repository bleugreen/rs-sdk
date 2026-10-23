#!/usr/bin/env bun
// Wilderness head-count from the demo's public spectator feed (server/engine/src/web/worldfeed.ts):
// login-free, one sample a UTC minute, COUNTS ONLY on disk. Research for the S16 Wilderness risk
// row (docs/speedrun/research/demo-latency.md section 12); it changes nothing in the run.
//
//   bun wilderness-roster.ts sample [--server=H] [--state=DIR]   long-running sampler (what the service runs)
//   bun wilderness-roster.ts once [--server=H]                   one sample to stdout, then exit
//   bun wilderness-roster.ts install [--server=H] [--state=DIR]  install and start the systemd user service
//   bun wilderness-roster.ts uninstall [--purge]                 stop and remove it (--purge: delete its state)
//   bun wilderness-roster.ts export [--state=DIR] [--out=DIR]    copy the samples into per-UTC-date files
//   bun wilderness-roster.ts summary [--out=DIR] [--from=ISO]    per-hour markdown table from the dated files
//
// Defaults: server rs-sdk-demo.fly.dev; state ~/.local/state/wilderness-roster (samples.jsonl, the
// append-only record, and exclude.txt); out docs/speedrun/research/data/wilderness-roster in the
// checkout this script sits in.
//
// Install (on a stable home machine with lingering on, `loginctl show-user $USER -p Linger`; not a
// run machine, not a Cairn terminal):
//   bun docs/speedrun/scripts/wilderness-roster.ts install
// copies this file to ~/.local/share/wilderness-roster/, writes
// ~/.config/systemd/user/wilderness-roster.service (Restart=always) and enables it, so it outlives
// the checkout it came from. Check: `systemctl --user status wilderness-roster`,
// `journalctl --user -u wilderness-roster -n 20`, `tail -n 3 ~/.local/state/wilderness-roster/samples.jsonl`.
// Stop and remove: `bun docs/speedrun/scripts/wilderness-roster.ts uninstall` (the samples stay;
// add --purge to delete them), or by hand: `systemctl --user disable --now wilderness-roster`,
// then `rm ~/.config/systemd/user/wilderness-roster.service && systemctl --user daemon-reload`.
// A Cairn batch on that machine cannot write under $HOME (its sandbox allows reads only), so from a
// batch, run install and uninstall through the user manager, from a copy outside the checkout:
//   cp docs/speedrun/scripts/wilderness-roster.ts /tmp/wr.ts && systemd-run --user --wait --pipe --collect $(which bun) /tmp/wr.ts install
//   systemd-run --user --wait --pipe --collect $(which bun) ~/.local/share/wilderness-roster/wilderness-roster.ts uninstall
// Reading the state (status, journal, export) works from a batch directly.
// Pull into the repo (on the same machine, from a checkout): `bun docs/speedrun/scripts/wilderness-roster.ts export`,
// then commit docs/speedrun/research/data/wilderness-roster/. Export rewrites each dated file whole
// from the append-only record, so it is safe to rerun; `summary` prints the per-hour table.
//
// Feed protocol: after the hello frame ({tickMs, tick}) send {t:'roster', on:true}; every 10 ticks
// the engine sends {t:'roster', k, p: [[slot, displayName, x, z, level, combatLevel], ...]} for every
// online player. Feeds idle 2 min are closed, so this pings each minute; the engine allows at
// most WORLD_FEED_MAX_CLIENTS feeds in all, so this holds exactly one.
//
// Tenet 20: names and slots live only in this process's memory (the previous minute's tiles, to
// tell moving from idle) and in the local exclude file. Nothing it writes or logs carries a name,
// a slot or a per-player row.
//
// One line a minute, `v: 1`:
//   {v, utc, ok: true, tickMs, k, online, ageMs, excluded: {online, wild}, rects: {<id>: {n, cb, max, moving, idle, new}}}
//   {v, utc, ok: false, reason}  when no roster frame arrived in the last 15 s (a gap)
// online is the roster's length, ours included; every rect count leaves ours out (names starting
// cairn_, case-insensitive, spaces read as underscores, and the names in exclude.txt, one a line).
// cb is the combat histogram [<30, 30-59, 60-89, 90-109, 110+]; max the highest combat level (0 when
// n = 0). moving: in the rect now and not on the same tile a minute ago (including not online then);
// idle = n - moving; new: in the rect now and not in it a minute ago. moving, idle and new are null
// on the first sample after a start or a gap. Rects count plane 0 only, bounds inclusive.

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

type Rect = { id: string; label: string; x0: number; x1: number; z0: number; z1: number };

// Route rectangles are the route's tiles (docs/speedrun/quests/mage_arena.md, walkthrough steps
// 3-7) widened by 15 tiles. Cores: keep, the lever's landing (3154,3924) to the north-wall web
// (3158,3951); webs, the keep's web west to the mage bank webs (3093-3095,3957); bank, the ladder
// (3091,3957) and its approach; arena, the fight's start (3105,3934, mage_arena.constant) in the
// arena enclosure (about x 3093-3117, z 3922-3946, approximate).
export const RECTS: Rect[] = [
    { id: 'wild', label: 'whole Wilderness', x0: 2944, x1: 3391, z0: 3520, z1: 3967 },
    { id: 'deep', label: 'deep (z >= 3900)', x0: 2944, x1: 3391, z0: 3900, z1: 3967 },
    { id: 'keep', label: 'Deserted Keep and the lever landing', x0: 3125, x1: 3185, z0: 3895, z1: 3966 },
    { id: 'webs', label: 'the webs and the run west', x0: 3080, x1: 3180, z0: 3925, z1: 3980 },
    { id: 'bank', label: 'mage bank approach and ladder', x0: 3065, x1: 3130, z0: 3930, z1: 3980 },
    { id: 'arena', label: 'Mage Arena (Kolodion fight)', x0: 3078, x1: 3132, z0: 3907, z1: 3961 }
];

const CB_BINS = [30, 60, 90, 110];
const ROSTER_STALE_MS = 15_000;
const SERVICE = 'wilderness-roster';

const args = process.argv.slice(2);
const cmd = args[0] ?? '';
const opt = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => args.includes(`--${name}`);

const server = opt('server') ?? 'rs-sdk-demo.fly.dev';
const stateDir = resolve(opt('state') ?? join(homedir(), '.local/state', SERVICE));
const outDir = resolve(opt('out') ?? join(import.meta.dir, '../research/data/wilderness-roster'));
if (!/^[A-Za-z0-9.-]+(:[0-9]+)?$/.test(server)) usage();

function usage(): never {
    console.error('usage: bun wilderness-roster.ts sample|once|install|uninstall|export|summary [--server=H] [--state=DIR] [--out=DIR]');
    process.exit(64);
}

type Player = [number, string, number, number, number, number];
type Roster = { k: number; p: Player[]; at: number };
type RectCount = { n: number; cb: number[]; max: number; moving: number | null; idle: number | null; new: number | null };

const normName = (name: string) => name.trim().toLowerCase().replace(/[\s_]+/g, '_');

function readExcludes(): Set<string> {
    const file = join(stateDir, 'exclude.txt');
    if (!existsSync(file)) return new Set();
    return new Set(
        readFileSync(file, 'utf8')
            .split('\n')
            .map(l => l.replace(/#.*/, ''))
            .filter(l => l.trim())
            .map(normName)
    );
}

const inRect = (r: Rect, x: number, z: number, level: number) => level === 0 && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

// Previous minute's state, in memory only: key (slot + name) to tile, and to the rects it was in.
type Prev = Map<string, { tile: string; rects: Set<string> }>;

function countMinute(roster: Roster, prev: Prev | null, excludes: Set<string>) {
    const next: Prev = new Map();
    const rects: Record<string, RectCount> = {};
    for (const r of RECTS) rects[r.id] = { n: 0, cb: [0, 0, 0, 0, 0], max: 0, moving: prev ? 0 : null, idle: prev ? 0 : null, new: prev ? 0 : null };
    let exOnline = 0;
    let exWild = 0;
    for (const pl of roster.p) {
        if (!Array.isArray(pl) || pl.length < 6) continue;
        const [slot, name, x, z, level, combat] = pl;
        const norm = normName(String(name));
        const ours = norm.startsWith('cairn_') || excludes.has(norm);
        if (ours) {
            exOnline++;
            if (inRect(RECTS[0]!, x, z, level)) exWild++;
            continue;
        }
        const key = `${slot}\u0000${name}`;
        const tile = `${x},${z},${level}`;
        const was = prev?.get(key);
        const here = new Set<string>();
        for (const r of RECTS) {
            if (!inRect(r, x, z, level)) continue;
            here.add(r.id);
            const c = rects[r.id]!;
            c.n++;
            let bin = 0;
            while (bin < CB_BINS.length && combat >= CB_BINS[bin]!) bin++;
            c.cb[bin]!++;
            c.max = Math.max(c.max, combat);
            if (prev) {
                if (was?.tile === tile) c.idle!++;
                else c.moving!++;
                if (!was?.rects.has(r.id)) c.new!++;
            }
        }
        next.set(key, { tile, rects: here });
    }
    return { rects, next, excluded: { online: exOnline, wild: exWild } };
}

// One feed connection, reconnected with backoff; keeps the latest roster frame.
function openFeed(onRoster: (r: Roster) => void, onHello: (tickMs: number) => void, log: (s: string) => void) {
    let ws: WebSocket | null = null;
    let backoff = 5_000;
    let lastFrameAt = Date.now();
    const connect = () => {
        lastFrameAt = Date.now();
        const sock = new WebSocket(`wss://${server}/worldfeed`);
        ws = sock;
        sock.onmessage = ev => {
            let m: { t?: unknown; k?: unknown; p?: unknown; tickMs?: unknown };
            try {
                m = JSON.parse(String(ev.data));
            } catch {
                return;
            }
            lastFrameAt = Date.now();
            if (m.t === 'hello') {
                backoff = 5_000;
                if (typeof m.tickMs === 'number') onHello(m.tickMs);
                sock.send(JSON.stringify({ t: 'roster', on: true }));
            } else if (m.t === 'roster' && typeof m.k === 'number' && Array.isArray(m.p)) {
                onRoster({ k: m.k, p: m.p as Player[], at: Date.now() });
            }
        };
        sock.onclose = ev => {
            if (ws !== sock) return;
            ws = null;
            log(`feed closed (${ev.code}); reconnecting in ${backoff / 1000}s`);
            setTimeout(connect, backoff);
            backoff = Math.min(backoff * 2, 120_000);
        };
        sock.onerror = () => {
            try {
                sock.close();
            } catch {
                // closing anyway
            }
        };
    };
    connect();
    // Keepalive (the engine drops feeds idle 2 min) and a watchdog for a silent socket.
    setInterval(() => {
        if (!ws) return;
        if (Date.now() - lastFrameAt > 60_000) {
            log('no frame for 60s; reconnecting');
            ws.close();
            return;
        }
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'ping' }));
    }, 30_000);
    return () => ws?.close();
}

function minuteIso(ms: number) {
    return new Date(Math.floor(ms / 60_000) * 60_000).toISOString().replace('.000Z', 'Z');
}

function runSampler(once: boolean) {
    const log = (s: string) => console.error(`${new Date().toISOString()} ${s}`);
    let latest: Roster | null = null;
    let tickMs: number | null = null;
    let prev: Prev | null = null;
    const file = join(stateDir, 'samples.jsonl');
    if (!once) mkdirSync(stateDir, { recursive: true });
    const close = openFeed(
        r => {
            latest = r;
        },
        t => {
            tickMs = t;
        },
        log
    );
    const sample = () => {
        const now = Date.now();
        const utc = minuteIso(now + 1_000);
        let line: Record<string, unknown>;
        const r = latest as Roster | null;
        if (!r || now - r.at > ROSTER_STALE_MS) {
            line = { v: 1, utc, ok: false, reason: r ? 'stale roster' : 'no roster' };
            prev = null;
        } else {
            const c = countMinute(r, prev, readExcludes());
            prev = c.next;
            line = { v: 1, utc, ok: true, tickMs, k: r.k, online: r.p.length, ageMs: now - r.at, excluded: c.excluded, rects: c.rects };
        }
        const text = JSON.stringify(line);
        if (once) {
            console.log(text);
            close();
            process.exit(line.ok ? 0 : 1);
        }
        appendFileSync(file, text + '\n');
        if (!line.ok) log(`gap at ${utc}: ${line.reason}`);
    };
    if (once) {
        setTimeout(sample, 12_000);
        return;
    }
    log(`sampling ${RECTS.length} rects once a minute into ${file}`);
    // Sample on each UTC minute boundary; utc names the minute the sample was taken at.
    const schedule = () => setTimeout(() => {
        sample();
        schedule();
    }, 60_000 - (Date.now() % 60_000));
    schedule();
}

function systemctl(...a: string[]) {
    const r = spawnSync('systemctl', ['--user', ...a], { stdio: 'inherit' });
    return r.status === 0;
}

function install() {
    const shareDir = join(homedir(), '.local/share', SERVICE);
    const unitDir = join(homedir(), '.config/systemd/user');
    mkdirSync(shareDir, { recursive: true });
    mkdirSync(unitDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    const script = join(shareDir, 'wilderness-roster.ts');
    copyFileSync(import.meta.path, script);
    const unit = [
        '[Unit]',
        'Description=Wilderness head-count from the demo spectator feed (counts only)',
        'After=network-online.target',
        '',
        '[Service]',
        `ExecStart=${process.execPath} ${script} sample --server=${server} --state=${stateDir}`,
        'Restart=always',
        'RestartSec=30',
        '',
        '[Install]',
        'WantedBy=default.target',
        ''
    ].join('\n');
    writeFileSync(join(unitDir, `${SERVICE}.service`), unit);
    const ok = systemctl('daemon-reload') && systemctl('enable', '--now', SERVICE) && systemctl('restart', SERVICE);
    console.log(ok ? `installed; samples append to ${join(stateDir, 'samples.jsonl')}` : 'systemctl failed');
    process.exit(ok ? 0 : 1);
}

function uninstall() {
    systemctl('disable', '--now', SERVICE);
    rmSync(join(homedir(), '.config/systemd/user', `${SERVICE}.service`), { force: true });
    systemctl('daemon-reload');
    rmSync(join(homedir(), '.local/share', SERVICE), { recursive: true, force: true });
    if (flag('purge')) rmSync(stateDir, { recursive: true, force: true });
    console.log(flag('purge') ? 'removed, state deleted' : `removed; samples kept in ${stateDir}`);
}

// The samples file holds counts only, so export copies lines as they are, grouped by UTC date.
function exportDated() {
    const file = join(stateDir, 'samples.jsonl');
    if (!existsSync(file)) {
        console.error(`no samples at ${file}`);
        process.exit(1);
    }
    const byDate = new Map<string, string[]>();
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let utc: unknown;
        try {
            utc = JSON.parse(line).utc;
        } catch {
            continue;
        }
        if (typeof utc !== 'string') continue;
        const date = utc.slice(0, 10);
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date)!.push(line);
    }
    mkdirSync(outDir, { recursive: true });
    for (const [date, lines] of [...byDate].sort()) {
        writeFileSync(join(outDir, `${date}.jsonl`), lines.join('\n') + '\n');
        console.log(`${date}.jsonl: ${lines.length} lines (${lines.filter(l => l.includes('"ok":true')).length} ok)`);
    }
}

function summary() {
    const from = opt('from') ?? '';
    type Line = { utc: string; ok: boolean; online?: number; rects?: Record<string, RectCount> };
    const lines: Line[] = [];
    for (const f of readdirSync(outDir).filter(f => f.endsWith('.jsonl')).sort()) {
        for (const l of readFileSync(join(outDir, f), 'utf8').split('\n')) {
            if (!l.trim()) continue;
            const j = JSON.parse(l) as Line;
            if (j.utc >= from) lines.push(j);
        }
    }
    const hours = new Map<string, Line[]>();
    for (const l of lines) {
        const h = l.utc.slice(0, 13);
        if (!hours.has(h)) hours.set(h, []);
        hours.get(h)!.push(l);
    }
    const ids = RECTS.map(r => r.id);
    console.log(`| hour (UTC) | samples ok/all | online mean | ${ids.map(id => `${id} mean / max`).join(' | ')} | combat max (wild / deep / route) | moving share (wild / deep / route) |`);
    console.log(`|---|---|---|${ids.map(() => '---|').join('')}---|---|`);
    for (const [h, ls] of [...hours].sort()) {
        const ok = ls.filter(l => l.ok && l.rects);
        const mean = (f: (l: Line) => number) => (ok.length ? ok.reduce((s, l) => s + f(l), 0) / ok.length : 0);
        const cells = ids.map(id => `${mean(l => l.rects![id]!.n).toFixed(2)} / ${Math.max(0, ...ok.map(l => l.rects![id]!.n))}`);
        const route = ['keep', 'webs', 'bank', 'arena'];
        const cbMax = (set: string[]) => Math.max(0, ...ok.flatMap(l => set.map(id => l.rects![id]!.max)));
        const share = (set: string[]) => {
            let mv = 0;
            let n = 0;
            for (const l of ok) for (const id of set) {
                const c = l.rects![id]!;
                if (c.moving === null) continue;
                mv += c.moving;
                n += c.n;
            }
            return n ? `${Math.round((100 * mv) / n)}%` : '-';
        };
        // A player in two overlapping route rects counts in both; the route columns are a union of rect-minutes.
        console.log(
            `| ${h.slice(5, 10)} ${h.slice(11)}:00 | ${ok.length}/${ls.length} | ${mean(l => l.online ?? 0).toFixed(0)} | ${cells.join(' | ')} | ${cbMax(['wild'])} / ${cbMax(['deep'])} / ${cbMax(route)} | ${share(['wild'])} / ${share(['deep'])} / ${share(route)} |`
        );
    }
}

if (import.meta.main) {
    if (cmd === 'sample') runSampler(false);
    else if (cmd === 'once') runSampler(true);
    else if (cmd === 'install') install();
    else if (cmd === 'uninstall') uninstall();
    else if (cmd === 'export') exportDated();
    else if (cmd === 'summary') summary();
    else usage();
}
