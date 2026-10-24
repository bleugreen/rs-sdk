// Film a bot script on the local lab: the game as the browser client renders it, a trace of every
// action the script sends with the source line that sent it, the player's state each tick, and the
// engine's world feed, all on one clock. Lab only: the bot's bot.env must point at a loopback server.
//
//   film/film.sh <bot> --clip=film/clips/firemaking-80.json [--out=DIR] [--seconds=N]
//
// film.sh starts the lab (speedrun/lab/lab.sh, with WORLD_FEED=true and no lite runner) and runs
// this file in it; to run it inside a lab you started yourself:
//
//   bun film/capture.ts <bot> --script=<path> [--setup=<setup.json>] [--opts=<options.json>]
//       [--args=a,b] [--out=DIR] [--seconds=N] [--fps=25] [--area=192] [--crf=26] [--codec=libx264]
//
// --clip names a clip spec, {script, opts | args, setup, seconds, fps, area, crf}; the other flags
// override its fields. A script that exports `steps(options)` (a step module) runs under
// film/run-steps.ts with `opts`; any other script runs as `bun <script> <bot> <args...>`, the lab's
// convention. Writes to DIR (default film/out/<clip>-<time>): clip.mp4 (clip.webm where ffmpeg has
// no H.264 encoder), trace.jsonl, feed.jsonl,
// meta.json, and the script's own output (script.out.log, script.err.log, steps.jsonl).

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');

// lab.sh runs a script with plain `bun`, and with the root bunfig's auto-install puppeteer fails to load
// (the executor-batches skill): run again with --no-install before anything imports it.
if (process.env.FILM_NO_INSTALL !== '1') {
    const p = Bun.spawn([process.execPath, '--no-install', import.meta.path, ...process.argv.slice(2)], {
        env: { ...process.env, FILM_NO_INSTALL: '1' },
        stdio: ['inherit', 'inherit', 'inherit']
    });
    process.exit(await p.exited);
}

const { BotSDK } = await import('../sdk/index');
const { launchLabBrowser } = await import('../speedrun/lab/browser');
const session = await import('../speedrun/lib/session');
const { recordFeed } = await import('./feed-recorder');
const { encodeClip, ffmpegEncoders, jpegSize, pickEncoder, startScreencast } = await import('./screencast');
const { applySetup, parseSetup } = await import('./setup');
const { feedTicks, frameStats, mergeTrace, serverTickAt, spread, StateDiff, tickGaps, xpGained } = await import('./trace');
type Observed = import('./trace').Observed;
type RawAction = import('./trace').RawAction;

interface ClipSpec {
    script: string;
    opts?: unknown;
    args?: string[];
    setup?: unknown;
    seconds?: number;
    fps?: number;
    area?: number;
    crf?: number;
}

const argv = process.argv.slice(2);
const flag = (n: string) => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const readJson = (p: string) => JSON.parse(readFileSync(resolve(p), 'utf8')) as unknown;
const bot = argv.find(a => !a.startsWith('-'));
const clipPath = flag('clip');
const clip: Partial<ClipSpec> = clipPath ? (readJson(clipPath) as Partial<ClipSpec>) : {};
if (flag('script')) clip.script = flag('script');
if (flag('setup')) clip.setup = readJson(flag('setup')!);
if (flag('opts')) clip.opts = readJson(flag('opts')!);
if (flag('args')) clip.args = flag('args')!.split(',');
if (!bot || !clip.script) throw new Error('usage: bun film/capture.ts <bot> (--clip=<spec.json> | --script=<path>) [--setup=...] [--opts=...] [--out=DIR] [--seconds=N]');

const num = (v: unknown, def: number, lo: number, hi: number, what: string) => {
    const n = v === undefined ? def : Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${what} must be from ${lo} to ${hi}, not ${String(v)}`);
    return n;
};
const seconds = num(flag('seconds') ?? clip.seconds, 60, 5, 900, '--seconds');
const fps = num(flag('fps') ?? clip.fps, 25, 5, 60, '--fps');
const areaSize = num(flag('area') ?? clip.area, 192, 64, 384, '--area');
const crf = num(flag('crf') ?? clip.crf, 26, 0, 51, '--crf');
const setup = parseSetup(clip.setup);
const encoder = pickEncoder(ffmpegEncoders(), flag('codec'));
const script = relative(ROOT, resolve(clip.script));
if (!existsSync(join(ROOT, script))) throw new Error(`no script at ${script}`);
const stepModule = /export\s+(async\s+)?function\s+steps\s*\(|export\s+const\s+steps\s*=/.test(readFileSync(join(ROOT, script), 'utf8'));
const name = clipPath ? basename(clipPath, '.json') : basename(script, '.ts');
const out = resolve(flag('out') ?? join(ROOT, 'film', 'out', `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}`));
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'film-'));
mkdirSync(join(work, 'frames'));
const say = (m: string) => console.log(`[film] ${m}`);

// Lab only: refuse any bot whose bot.env points anywhere but this machine.
const env0 = session.loadBotEnv(bot);
const server = env0.SERVER ?? '';
if (!server || !session.isLoopbackHost(server)) throw new Error(`${bot}: bot.env SERVER is '${server}', not the local lab; film only runs against a loopback lab engine`);

const webPort = Number(server.split(':')[1] ?? process.env.WEB_PORT ?? 9300);
const chrome = await launchLabBrowser(bot, { cdpPort: webPort + 5 });
let exitCode = 0;
try {
    // --------------------------------------------------------------- the client
    const env = session.loadBotEnv(bot); // launchLabBrowser wrote CLIENT_URL
    const page = (await chrome.browser.pages())[0] ?? (await chrome.browser.newPage());
    page.on('pageerror', e => say(`page error: ${e instanceof Error ? e.message : String(e)}`));
    // ?minimal is the page with no panels, its canvas filling the viewport; a viewport of the client's
    // own 765 x 503 makes that 1:1, so the video holds the client's pixels unscaled.
    await page.setViewport({ width: 765, height: 503 });
    await page.goto(`${session.browserUrl(env, { insecureQueryLogin: true })}&minimal`, { waitUntil: 'domcontentloaded' });
    for (let i = 0; !(await page.evaluate(() => Boolean((window as unknown as { gameClient?: { ingame?: boolean } }).gameClient?.ingame))); i++) {
        if (i > 600) throw new Error('the browser client never reached the game');
        await Bun.sleep(200);
    }
    say(`${bot} in game in the browser client`);

    // --------------------------------------------------------------- staging
    const staging = await session.openSession(bot, { client: 'browser' });
    const staged = await applySetup(staging, setup);
    const at = staging.sdk.getState()?.player;
    await session.closeSession(staging);
    if (!at) throw new Error('no player state after setup');
    say(`staged: ${staged.join('; ') || 'nothing'}`);

    // --------------------------------------------------------------- recorders
    const gatewayUrl = session.sessionGateway(env, session.pageWorld(env));
    const observer = new BotSDK({ botUsername: env.BOT_USERNAME, password: env.PASSWORD, gatewayUrl, connectionMode: 'observe', autoReconnect: true, autoLaunchBrowser: false, showChat: true });
    await observer.connect();
    const diff = new StateDiff();
    const observed: Observed[] = [];
    const feedUrl = `ws://${server}/worldfeed`;
    // The area follows the bot by its roster position, as the live recorder follows the scored account.
    const feed = recordFeed({ url: feedUrl, out: join(out, 'feed.jsonl'), centre: { x: at.worldX, z: at.worldZ }, size: areaSize, follow: env.BOT_USERNAME, log: m => say(`feed: ${m}`) });
    const hello = await Promise.race([feed.hello, Bun.sleep(10_000).then(() => null)]);
    if (!hello) throw new Error(`no hello from the world feed at ${feedUrl}: start the engine with WORLD_FEED=true (film.sh does)`);
    observer.onStateUpdate(s => observed.push(...diff.next(s, Date.now())));
    // Film from a known server tick: the first tick frame follows the hello's sub by up to a tick.
    for (let i = 0; i < 50 && !feed.ticks().length; i++) await Bun.sleep(100);

    const box = await page.evaluate(() => {
        const r = document.querySelector('canvas')!.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, vw: window.innerWidth };
    });
    const cast = await startScreencast(page, join(work, 'frames'));
    await Bun.sleep(1_000); // a second of the staged scene before the script's first action

    // --------------------------------------------------------------- the script
    const actionsFile = join(work, 'actions.jsonl');
    writeFileSync(actionsFile, '');
    const entry = stepModule
        ? [join(ROOT, 'film', 'run-steps.ts'), bot, `--module=${script}`, `--log=${join(out, 'steps.jsonl')}`, ...(clip.opts ? [`--opts=${join(work, 'opts.json')}`] : [])]
        : [script, bot, ...(clip.args ?? [])];
    if (clip.opts) writeFileSync(join(work, 'opts.json'), JSON.stringify(clip.opts));
    say(`running ${stepModule ? `step module ${script}` : script} for up to ${seconds} s`);
    const scriptStart = Date.now();
    // The hook rides in BUN_OPTIONS rather than --preload so that any Bun process the script starts (a
    // lab script's helper roles) loads it too and appends its own bot's actions to the same log.
    const bunOptions = [process.env.BUN_OPTIONS, `--preload=${join(ROOT, 'film', 'hook.ts')}`].filter(Boolean).join(' ');
    const child = Bun.spawn([process.execPath, '--no-install', ...entry], {
        cwd: ROOT,
        env: { ...process.env, BUN_OPTIONS: bunOptions, FILM_ACTIONS: actionsFile, FILM_SCRIPT: script },
        stdout: Bun.file(join(out, 'script.out.log')),
        stderr: Bun.file(join(out, 'script.err.log'))
    });
    const exited = await Promise.race([child.exited, Bun.sleep(seconds * 1000).then(() => null)]);
    let scriptEnd: string;
    if (exited === null) {
        child.kill('SIGTERM');
        if ((await Promise.race([child.exited, Bun.sleep(5_000).then(() => null)])) === null) child.kill('SIGKILL');
        scriptEnd = `stopped at ${seconds} s`;
    } else scriptEnd = `exited ${exited} after ${((Date.now() - scriptStart) / 1000).toFixed(1)} s`;
    say(`script ${scriptEnd}`);
    await Bun.sleep(1_000);
    const frames = await cast.stop();
    await observer.disconnect();
    await feed.stop();
    if (frames.length < 2) throw new Error(`the screencast captured ${frames.length} frames`);

    // --------------------------------------------------------------- the clip
    const t0 = frames[0]!.ms;
    const t1 = frames[frames.length - 1]!.ms;
    const img = jpegSize(await Bun.file(frames[0]!.file).bytes());
    const scale = img.width / box.vw;
    const crop = { x: Math.round(box.x * scale), y: Math.round(box.y * scale), w: Math.floor(box.w * scale) & ~1, h: Math.floor(box.h * scale) & ~1 };
    const clipFile = join(out, encoder.file);
    const encoded = await encodeClip(frames, { fps, t0, t1, crop, out: clipFile, encoder, crf });
    say(`${encoder.file} (${encoder.name}): ${encoded.frames} frames at ${fps} fps, ${crop.w}x${crop.h}, ${(statSync(clipFile).size / 1e6).toFixed(2)} MB`);

    // --------------------------------------------------------------- the trace
    const actions = readFileSync(actionsFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as RawAction);
    const ticks = feedTicks(readFileSync(join(out, 'feed.jsonl'), 'utf8'));
    const trace = mergeTrace(actions, observed, ticks, t0, t1);
    writeFileSync(join(out, 'trace.jsonl'), trace.map(e => JSON.stringify(e)).join('\n') + '\n');
    const kinds: Record<string, number> = {};
    for (const e of trace) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;

    // --------------------------------------------------------------- meta
    const git = (args: string[]) => Bun.spawnSync(['git', ...args], { cwd: ROOT }).stdout.toString().trim();
    const inClip = observed.filter(e => e.ms <= t1);
    const start = inClip.find(e => e.kind === 'start');
    const levels: Record<string, [number, number]> = {};
    for (const e of inClip) if (e.kind === 'level') levels[e.skill] = [levels[e.skill]?.[0] ?? e.from, e.to];
    const clientTickAt = (ms: number) => [...observed].reverse().find(e => e.ms <= ms)?.clientTick ?? observed[0]?.clientTick ?? null;
    const meta = {
        bot,
        script,
        kind: stepModule ? 'step module (film/run-steps.ts)' : 'script',
        ...(clip.opts ? { opts: clip.opts } : {}),
        ...(clip.args ? { args: clip.args } : {}),
        ...(clipPath ? { clip: relative(ROOT, resolve(clipPath)) } : {}),
        setup,
        staged,
        // Dirty means the code differs from the commit; the clip being written (into film/samples, say) does not count.
        git: { commit: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain', '--', '.', `:(exclude)${relative(ROOT, out) || '.'}`]).length > 0 },
        tickMs: { configured: Number(process.env.NODE_TICKRATE) || null, feedHello: hello.tickMs, observed: spread(tickGaps(ticks)) },
        start: { ms: t0, tick: serverTickAt(ticks, t0), clientTick: clientTickAt(t0) },
        end: { ms: t1, tick: serverTickAt(ticks, t1), clientTick: clientTickAt(t1) },
        durationMs: Math.round(t1 - t0),
        run: { startVideoMs: Math.round(scriptStart - t0), end: scriptEnd },
        xpGained: xpGained(inClip),
        levels,
        startSkills: start?.kind === 'start' ? start.skills : null,
        video: {
            file: encoder.file,
            encoder: encoder.name,
            crf,
            bytes: statSync(clipFile).size,
            fps,
            width: crop.w,
            height: crop.h,
            frames: encoded.frames,
            method: `Chrome DevTools Page.startScreencast (JPEG q90, chrome-headless-shell, the bot page's ?minimal canvas at 765x503), each frame stamped with its compositor time, re-timed to a constant rate (the latest frame at each output frame), encoded by ffmpeg ${encoder.name}`,
            captured: frames.length,
            ...frameStats(frames.map(f => f.ms), fps, t0, t1),
            receiveLagMs: spread(frames.map(f => f.rxMs - f.ms)),
            crop
        },
        feed: { file: 'feed.jsonl', url: feedUrl, protocol: hello.v, frames: feed.frames, ticks: ticks.length, areas: feed.areas, followedSlot: feed.followedSlot },
        trace: { file: 'trace.jsonl', ...kinds },
        clock: 'ms fields are wall-clock epoch ms on the lab machine; videoMs = ms - start.ms; tick is the server tick from the feed, clientTick the browser client\'s own tick count'
    };
    writeFileSync(join(out, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
    console.log(`RESULT film ${JSON.stringify({ out: relative(ROOT, out), durationMs: meta.durationMs, xpGained: meta.xpGained, trace: kinds, video: { mb: +(meta.video.bytes / 1e6).toFixed(2), captureFps: meta.video.captureFps, intervalMs: meta.video.intervalMs, staleMs: meta.video.staleMs, receiveLagMs: meta.video.receiveLagMs }, tickMs: meta.tickMs, script: scriptEnd })}`);
} catch (e) {
    console.error(`[film] ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    console.error(`[film] captured frames and the raw action log are kept in ${work}`);
    exitCode = 1;
} finally {
    await chrome.kill();
    if (exitCode === 0) rmSync(work, { recursive: true, force: true });
}
process.exit(exitCode);
