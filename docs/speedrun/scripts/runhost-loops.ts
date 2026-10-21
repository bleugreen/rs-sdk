// Run host: sample the tab's game-loop rate (run gate (d)) beside per-process CPU and the
// recording's frame counters (docs/speedrun/RUN-HOST.md, "Gate (d)").
//
//   cd ~/rs-sdk && ~/.bun/bin/bun docs/speedrun/scripts/runhost-loops.ts <bot> --label=NAME
//       [--minutes=5] [--interval=10] [--display=:10] [--profile=$HOME/rs-run/chrome-profile]
//       [--progress=$HOME/recordings/ffmpeg-progress.log] [--out=FILE.jsonl] [--skip-tutorial] [--logout]
//
// Runs on the run host. Attaches to the bot's tab through the loopback gateway named by
// GATEWAY_URL in bots/<bot>/bot.env, the same path a run script uses, and starts the
// in-page probe for the length of the sample: the page publishes `loops` only while a
// program runs, and the probe is the cheapest one (one walk to a neighbouring tile and
// back per tick). Each condition gets a fresh probe run, so `loops.min` is that
// condition's own minimum. The probe is stopped at the end; the tab stays logged in unless
// --logout, which clicks the logout button (as speedrun/lib/session.ts logoutClean does) and
// waits until the tab is out of the game.
//
// Every --interval seconds it prints and appends one sample:
// - loops: the page's {last, p10Last10s, min} (server/webclient/src/bot/programs/frames.ts);
// - the probe's on-time / late / lost walk trials and frame catch-ups in the interval
//   (context only: gate (a)-(c) are measured with rs/96's probe, not this);
// - CPU per process group as a percentage of one core, from utime+stime deltas in
//   /proc/<pid>/stat over the interval (what `pidstat -u` reports): ffmpeg, Chrome
//   (browser, the busiest renderer = the tab, other renderers, GPU process, utilities;
//   the tree under the Chrome whose --user-data-dir is --profile), the page server
//   (proxy.ts), the gateway (gateway.ts), the session's Xorg (--display) and xrdp;
// - total CPU busy across all cores from /proc/stat, and the load average;
// - ffmpeg's frame, fps, drop_frames and dup_frames from its -progress file.
// At the end it prints a summary line per figure (min / median / max over the samples).
import { readdirSync, readFileSync, appendFileSync, statSync, openSync, readSync, closeSync } from 'fs';
import { cpus, hostname, loadavg } from 'os';
import { runScript } from '../../../sdk/runner';
import { programStatus, startProgram, stopProgram, type ProgramStatus } from '../../../speedrun/lib/programs';

const flag = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const HOME = process.env.HOME ?? '/home/ubuntu';
const label = flag('label', 'unlabelled')!;
const minutes = Number(flag('minutes', '5'));
const intervalS = Number(flag('interval', '10'));
const profile = flag('profile', `${HOME}/rs-run/chrome-profile`)!;
const display = flag('display', ':10')!;
const progressFile = flag('progress', `${HOME}/recordings/ffmpeg-progress.log`)!;
const out = flag('out');
const CLK_TCK = 100; // Linux USER_HZ
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Proc { pid: number; ppid: number; comm: string; args: string; cpuTicks: number }

function readProcs(): Map<number, Proc> {
    const procs = new Map<number, Proc>();
    for (const d of readdirSync('/proc')) {
        if (!/^\d+$/.test(d)) continue;
        try {
            const stat = readFileSync(`/proc/${d}/stat`, 'utf8');
            // comm is parenthesised and may hold spaces: split after the last ')'
            const close = stat.lastIndexOf(')');
            const comm = stat.slice(stat.indexOf('(') + 1, close);
            const f = stat.slice(close + 2).split(' ');
            const args = readFileSync(`/proc/${d}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
            procs.set(Number(d), { pid: Number(d), ppid: Number(f[1]), comm, args, cpuTicks: Number(f[11]) + Number(f[12]) });
        } catch {
            // exited between readdir and read
        }
    }
    return procs;
}

/** Process groups by role; a pid's group is fixed by its command line. */
function classify(procs: Map<number, Proc>): Map<number, string> {
    const groups = new Map<number, string>();
    const chromeRoot = [...procs.values()].find(p => p.args.includes(`--user-data-dir=${profile}`) && !p.args.includes('--type='));
    const inChrome = (p: Proc): boolean => {
        for (let q: Proc | undefined = p, hops = 0; q && hops < 8; q = procs.get(q.ppid), hops++) if (chromeRoot && q.pid === chromeRoot.pid) return true;
        return false;
    };
    for (const p of procs.values()) {
        if (p.comm === 'ffmpeg' && p.args.includes('x11grab')) groups.set(p.pid, 'ffmpeg');
        else if (chromeRoot && inChrome(p)) {
            const type = p.args.match(/--type=([a-z-]+)/)?.[1];
            groups.set(p.pid, !type ? 'chrome.browser' : type === 'renderer' ? 'chrome.renderer' : type === 'gpu-process' ? 'chrome.gpu' : 'chrome.other');
        } else if (p.args.includes('proxy.ts')) groups.set(p.pid, 'pageServer');
        else if (p.args.includes('gateway.ts')) groups.set(p.pid, 'gateway');
        else if (p.comm === 'Xorg' && p.args.split(' ').includes(display)) groups.set(p.pid, 'xorg');
        else if (p.comm === 'xrdp' || p.comm === 'xrdp-chansrv') groups.set(p.pid, 'xrdp');
    }
    return groups;
}

function totalCpu(): { busy: number; all: number } {
    const f = readFileSync('/proc/stat', 'utf8').split('\n')[0]!.trim().split(/\s+/).slice(1).map(Number);
    const idle = f[3]! + f[4]!; // idle + iowait
    const all = f.reduce((a, b) => a + b, 0);
    return { busy: all - idle, all };
}

/** The last complete block of ffmpeg's -progress output, or null when it isn't recording. */
function ffmpegProgress(): Record<string, string> | null {
    try {
        const size = statSync(progressFile).size;
        if (Date.now() - statSync(progressFile).mtimeMs > 5000) return null; // ffmpeg not running
        const len = Math.min(size, 4096);
        const buf = Buffer.alloc(len);
        const fd = openSync(progressFile, 'r');
        readSync(fd, buf, 0, len, size - len);
        closeSync(fd);
        const blocks = buf.toString('utf8').split(/progress=\w+\n/);
        const last = blocks.length >= 2 ? blocks[blocks.length - 2]! : '';
        return Object.fromEntries(last.split('\n').filter(l => l.includes('=')).map(l => l.split('=', 2) as [string, string]));
    } catch {
        return null;
    }
}

const r1 = (x: number) => Math.round(x * 10) / 10;

await runScript(async ({ bot, sdk }) => {
    const state = sdk.getState();
    if (!state?.inGame) throw new Error('the tab is not in game');
    if (process.argv.includes('--skip-tutorial')) await bot.skipTutorial().catch(() => {});
    const before = programStatus(sdk.getState());
    if (before?.phase === 'running') throw new Error(`program ${before.name} is running in the tab; stop it first (this sampler starts its own probe)`);
    const started = await startProgram(sdk, 'probe', { trials: 1_000_000, stallTicks: 100_000 });
    const header = `runhost-loops: ${label}, host ${hostname()} (${cpus().length} cpus), display ${display}, ${new Date().toISOString()}, probe run ${started.runId}, ${minutes} min every ${intervalS} s`;
    console.log(header);

    // let the page's 10 s loop window fill with this run before the first sample
    await sleep(intervalS * 1000);
    let procs = readProcs();
    let tot = totalCpu();
    let st = programStatus(sdk.getState()) as ProgramStatus;
    let t = performance.now();
    const samples: Array<Record<string, number | string | null>> = [];
    const n = Math.round((minutes * 60) / intervalS);
    for (let i = 1; i <= n; i++) {
        await sleep(intervalS * 1000);
        const now = performance.now();
        const procs2 = readProcs();
        const tot2 = totalCpu();
        const st2 = programStatus(sdk.getState()) as ProgramStatus;
        if (!st2 || st2.runId !== started.runId || st2.phase !== 'running') throw new Error(`probe run ${started.runId} is no longer running: ${JSON.stringify(st2?.phase)} ${st2?.fault ?? ''}`);
        const dt = (now - t) / 1000;
        const cpu: Record<string, number> = {};
        const renderers: Array<{ pid: number; pct: number }> = [];
        for (const [pid, group] of classify(procs2)) {
            const a = procs.get(pid);
            const b = procs2.get(pid)!;
            const pct = ((b.cpuTicks - (a?.cpuTicks ?? b.cpuTicks)) / CLK_TCK / dt) * 100;
            if (group === 'chrome.renderer') renderers.push({ pid, pct });
            else cpu[group] = (cpu[group] ?? 0) + pct;
        }
        renderers.sort((x, y) => y.pct - x.pct);
        cpu['chrome.tab'] = renderers[0]?.pct ?? 0;
        cpu['chrome.otherRenderers'] = renderers.slice(1).reduce((s, r) => s + r.pct, 0);
        const chromeAll = Object.entries(cpu).filter(([k]) => k.startsWith('chrome.')).reduce((s, [, v]) => s + v, 0);
        const totalBusy = ((tot2.busy - tot.busy) / (tot2.all - tot.all)) * 100;
        const ff = ffmpegProgress();
        const d = (k: string) => (st2.counters[k] ?? 0) - (st.counters[k] ?? 0);
        const sample = {
            label, i, at: new Date().toISOString(),
            loopsLast: st2.loops.last, loopsP10: st2.loops.p10Last10s, loopsMin: st2.loops.min,
            onTime: d('onTime'), late: d('late'), lost: d('lost'), catchUps: st2.frames.catchUps - st.frames.catchUps,
            ffmpeg: r1(cpu.ffmpeg ?? 0), chromeTab: r1(cpu['chrome.tab']), chromeGpu: r1(cpu['chrome.gpu'] ?? 0),
            chromeBrowser: r1(cpu['chrome.browser'] ?? 0), chromeOther: r1((cpu['chrome.other'] ?? 0) + cpu['chrome.otherRenderers']), chromeAll: r1(chromeAll),
            pageServer: r1(cpu.pageServer ?? 0), gateway: r1(cpu.gateway ?? 0), xorg: r1(cpu.xorg ?? 0), xrdp: r1(cpu.xrdp ?? 0),
            totalBusyPct: r1(totalBusy), load1: r1(loadavg()[0]!),
            ffFrame: ff ? Number(ff.frame) : null, ffFps: ff ? Number(ff.fps) : null, ffDrop: ff ? Number(ff.drop_frames) : null, ffDup: ff ? Number(ff.dup_frames) : null, ffSpeed: ff?.speed ?? null
        };
        samples.push(sample);
        console.log(`${String(i).padStart(2)} loops/s last ${sample.loopsLast} p10 ${sample.loopsP10} min ${sample.loopsMin} | trials ${sample.onTime}/${sample.late}/${sample.lost} catch-ups ${sample.catchUps} | cpu% ffmpeg ${sample.ffmpeg} tab ${sample.chromeTab} gpu ${sample.chromeGpu} chrome ${sample.chromeAll} page ${sample.pageServer} gw ${sample.gateway} xorg ${sample.xorg} xrdp ${sample.xrdp} | total ${sample.totalBusyPct}% load ${sample.load1}` +
            (ff ? ` | ffmpeg frame ${sample.ffFrame} fps ${sample.ffFps} drop ${sample.ffDrop} dup ${sample.ffDup} speed ${sample.ffSpeed}` : ' | ffmpeg not recording'));
        if (out) appendFileSync(out, JSON.stringify(sample) + '\n');
        procs = procs2; tot = tot2; st = st2; t = now;
    }
    const end = await stopProgram(sdk);
    const stats = (k: string) => {
        const v = samples.map(s => s[k]).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
        return v.length ? `${v[0]} / ${v[Math.floor((v.length - 1) / 2)]} / ${v[v.length - 1]}` : '-';
    };
    console.log(`summary ${label} (min / median / max over ${samples.length} samples): loops p10 ${stats('loopsP10')}; run min ${end?.loops.min ?? '-'}; ` +
        `cpu% ffmpeg ${stats('ffmpeg')}, tab ${stats('chromeTab')}, gpu ${stats('chromeGpu')}, chrome ${stats('chromeAll')}, page server ${stats('pageServer')}, gateway ${stats('gateway')}, xorg ${stats('xorg')}, xrdp ${stats('xrdp')}; ` +
        `total busy ${stats('totalBusyPct')}%, load ${stats('load1')}; probe on time ${end?.counters.onTime ?? 0}, late ${end?.counters.late ?? 0}, lost ${end?.counters.lost ?? 0}; frames p90 ${end?.frames.p90} ms, catch-ups ${end?.frames.catchUps}` +
        (samples.some(s => s.ffFps !== null) ? `; ffmpeg fps ${stats('ffFps')}, dropped at end ${samples.at(-1)?.ffDrop}, duplicated at end ${samples.at(-1)?.ffDup}` : ''));
    if (process.argv.includes('--logout')) {
        const LOGOUT_BUTTON = 2458; // speedrun/lib/session.ts
        await sdk.sendClickComponent(LOGOUT_BUTTON);
        const deadline = Date.now() + 20_000;
        while (sdk.getState()?.inGame && Date.now() < deadline) await sleep(500);
        console.log(sdk.getState()?.inGame ? 'logout: still in game after 20 s (log out by hand)' : 'logout: out of the game');
    }
}, { timeout: (minutes + 2) * 60_000 + intervalS * 1000, printState: false });
