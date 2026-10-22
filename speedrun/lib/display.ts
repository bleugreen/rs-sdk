// The host's X display as the on-VM recording sees it (RUN-HOST.md step 5: ffmpeg x11grab of the
// whole display): which window is in front, whether a recording is running on it, and a live frame
// of it, grabbed the way the recording grabs it, matched against a page's own render. lib/tab.ts is
// the Chrome side of the same windows.

/** One top-level window on the X display, as xprop reads it. */
export interface XWindow {
    id: string;
    name: string;
    /** _NET_WM_WINDOW_TYPE atoms without the prefix: NORMAL, DOCK, DESKTOP, DIALOG... */
    types: string[];
    /** _NET_WM_STATE atoms without the prefix: HIDDEN, MAXIMIZED_VERT... */
    states: string[];
}

export interface FrontWindows {
    /** _NET_ACTIVE_WINDOW: the window with focus, or null with none. */
    active: XWindow | null;
    /** The highest window in the stacking order that can be seen over the desktop: what the recording shows. */
    top: XWindow | null;
    /** Managed windows on the display. */
    windows: number;
}

/** Runs `xprop <args>` on the display and returns its output. */
export type XpropRun = (args: readonly string[]) => Promise<string>;

async function output(cmd: string[], env: Record<string, string | undefined> = process.env): Promise<{ code: number; out: string; err: string }> {
    const child = Bun.spawn(cmd, { env, stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { code, out, err };
}

export function xpropRunner(display: string): XpropRun {
    return async args => {
        const r = await output(['xprop', ...args], { ...process.env, DISPLAY: display });
        if (r.code !== 0) throw new Error(`xprop ${args.join(' ')}: exit ${r.code}${r.err.trim() ? `: ${r.err.trim()}` : ''}`);
        return r.out;
    };
}

/** The window ids in `xprop -root` output for a WINDOW property; 0x0 means none. */
export function parseWindowIds(text: string): string[] {
    const hash = text.indexOf('#');
    if (hash < 0) return [];
    return (text.slice(hash + 1).match(/0x[0-9a-f]+/gi) ?? []).filter(id => Number.parseInt(id, 16) !== 0);
}

/** One window's `xprop -id <id> _NET_WM_NAME WM_NAME _NET_WM_WINDOW_TYPE _NET_WM_STATE`. */
export function parseWindowProps(id: string, text: string): XWindow {
    const str = (prop: string) => {
        const m = text.match(new RegExp(`^${prop}\\([^)]*\\) = "(.*)"\\s*$`, 'm'));
        return m ? m[1]!.replace(/\\(.)/g, '$1') : null;
    };
    const atoms = (prop: string, prefix: string) => {
        const m = text.match(new RegExp(`^${prop}\\(ATOM\\) = (.*)$`, 'm'));
        return m ? m[1]!.split(',').map(a => a.trim().replace(prefix, '')).filter(Boolean) : [];
    };
    return { id, name: str('_NET_WM_NAME') ?? str('WM_NAME') ?? '', types: atoms('_NET_WM_WINDOW_TYPE', '_NET_WM_WINDOW_TYPE_'), states: atoms('_NET_WM_STATE', '_NET_WM_STATE_') };
}

const UNDER_EVERYTHING = new Set(['DESKTOP', 'DOCK']);

/** Which window is in front of the display, by the window manager's own EWMH properties. */
export async function frontWindows(run: XpropRun): Promise<FrontWindows> {
    const props = async (id: string) => parseWindowProps(id, await run(['-id', id, '_NET_WM_NAME', 'WM_NAME', '_NET_WM_WINDOW_TYPE', '_NET_WM_STATE']));
    const [activeId] = parseWindowIds(await run(['-root', '_NET_ACTIVE_WINDOW']));
    const stacking = parseWindowIds(await run(['-root', '_NET_CLIENT_LIST_STACKING']));
    let top: XWindow | null = null;
    // Bottom to top: walk down from the top past the panel, the desktop and minimised windows.
    for (const id of [...stacking].reverse()) {
        const w = await props(id);
        if (w.types.some(t => UNDER_EVERYTHING.has(t)) || w.states.includes('HIDDEN')) continue;
        top = w;
        break;
    }
    const active = activeId ? (activeId === top?.id ? top : await props(activeId)) : null;
    return { active, top, windows: stacking.length };
}

// ------------------------------------------------------------------ the recording

export interface RecordingState {
    display: string | null;
    /** true: a recording ffmpeg grabs the display; false: none does; null: not known (see `why`). */
    on: boolean | null;
    pid?: number;
    /** The file it writes, when its command line names one. */
    file?: string;
    why?: string;
}

/** Whether an x11grab input names this display (`:10`, `:10.0`, `:10.0+0,0`), and not `:1` for `:10`. */
function grabsDisplay(input: string, display: string): boolean {
    const base = display.replace(/\.\d+$/, '');
    return input === base || input.startsWith(`${base}.`) || input.startsWith(`${base}+`);
}

/**
 * The recording among `pgrep -a ffmpeg` lines: an x11grab of this display that writes a file. The
 * operator's live view is another x11grab of it, but serves HTTP (`-listen`), so it never counts.
 */
export function findRecording(pgrepLines: string, display: string): { pid: number; file?: string } | null {
    for (const line of pgrepLines.split('\n')) {
        const m = line.trim().match(/^(\d+)\s+(.*)$/);
        if (!m) continue;
        const args = m[2]!.split(/\s+/);
        if (!args.includes('x11grab') || args.includes('-listen')) continue;
        const inputs = args.flatMap((a, i) => (a === '-i' && args[i + 1] ? [args[i + 1]!] : []));
        if (!inputs.some(i => grabsDisplay(i, display))) continue;
        const file = [...args].reverse().find(a => /\.(mkv|mp4|mov|webm)$/i.test(a));
        return { pid: Number(m[1]), ...(file ? { file } : {}) };
    }
    return null;
}

export async function recordingState(display: string | null): Promise<RecordingState> {
    if (!display) return { display, on: null, why: 'no DISPLAY' };
    try {
        const r = await output(['pgrep', '-a', 'ffmpeg']);
        // pgrep exits 1 when nothing matches.
        if (r.code > 1) return { display, on: null, why: `pgrep exit ${r.code}: ${r.err.trim()}` };
        const rec = findRecording(r.out, display);
        return rec ? { display, on: true, ...rec } : { display, on: false };
    } catch (e) {
        return { display, on: null, why: e instanceof Error ? e.message : String(e) };
    }
}

// ------------------------------------------------------------------ the live frame

/** Grab one frame of the whole display to a PNG, with the recording's own input (x11grab). */
export async function grabFrame(display: string, path: string): Promise<void> {
    const r = await output(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'x11grab', '-i', display, '-frames:v', '1', path]);
    if (r.code !== 0) throw new Error(`ffmpeg x11grab ${display}: exit ${r.code}${r.err.trim() ? `: ${r.err.trim()}` : ''}`);
}

/** A PNG's width and height, from its IHDR chunk. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
    const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
    if (png.byteLength < 24 || v.getUint32(12) !== 0x49484452) throw new Error('not a PNG');
    return { width: v.getUint32(16), height: v.getUint32(20) };
}

/** An image scaled to w x h, one gray byte per pixel. */
async function grayPixels(path: string, w: number, h: number): Promise<Uint8Array> {
    const child = Bun.spawn(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', path, '-vf', `scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-'], { stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0 || out.byteLength !== w * h) throw new Error(`ffmpeg gray ${path}: exit ${code}, ${out.byteLength} of ${w * h} bytes${err.trim() ? `: ${err.trim()}` : ''}`);
    return new Uint8Array(out);
}

/**
 * Where the page image `p` (pw x ph) sits best inside the frame `f` (fw x fh), both gray: the
 * offset with the least mean absolute difference, and that difference (0-255). Null when the page
 * is larger than the frame.
 */
export function bestOffset(f: Uint8Array, fw: number, fh: number, p: Uint8Array, pw: number, ph: number): { x: number; y: number; diff: number } | null {
    if (pw > fw || ph > fh) return null;
    let best: { x: number; y: number; diff: number } | null = null;
    for (let oy = 0; oy <= fh - ph; oy++) {
        for (let ox = 0; ox <= fw - pw; ox++) {
            let sum = 0;
            for (let y = 0; y < ph; y++) {
                const fr = (oy + y) * fw + ox;
                const pr = y * pw;
                for (let x = 0; x < pw; x++) sum += Math.abs(f[fr + x]! - p[pr + x]!);
            }
            const diff = sum / (pw * ph);
            if (!best || diff < best.diff) best = { x: ox, y: oy, diff };
        }
    }
    return best;
}

/** The standard deviation of a gray image: a near-flat page (a black loading screen) can't be told apart. */
export function contrast(p: Uint8Array): number {
    let s = 0;
    for (const v of p) s += v;
    const mean = s / p.length;
    let q = 0;
    for (const v of p) q += (v - mean) ** 2;
    return Math.sqrt(q / p.length);
}

/** Both images are compared at 1/FRAME_SCALE size, which absorbs scaling and anti-aliasing. */
export const FRAME_SCALE = 8;
/** The most mean gray difference (0-255) at which the frame still shows the page. */
export const FRAME_MATCH_MAX = 12;
/** Below this contrast the page is too flat for a match to mean anything. */
export const FRAME_MIN_CONTRAST = 8;

export interface FrameCheck {
    /** The display frame, kept as evidence. */
    path: string;
    /** true: the frame shows the page; false: it shows something else; null: inconclusive. */
    match: boolean | null;
    /** Least mean gray difference over where the page could sit, and where (display pixels). */
    diff: number | null;
    at: { x: number; y: number } | null;
    contrast: number;
    max: number;
}

/** Does the display frame at `framePath` show the page rendered at `pagePath`, anywhere on it? */
export async function frameShows(framePath: string, pagePath: string, opts: { max?: number; scale?: number } = {}): Promise<FrameCheck> {
    const scale = opts.scale ?? FRAME_SCALE;
    const max = opts.max ?? FRAME_MATCH_MAX;
    const F = pngSize(new Uint8Array(await Bun.file(framePath).arrayBuffer()));
    const P = pngSize(new Uint8Array(await Bun.file(pagePath).arrayBuffer()));
    const fw = Math.floor(F.width / scale), fh = Math.floor(F.height / scale);
    const pw = Math.floor(P.width / scale), ph = Math.floor(P.height / scale);
    const f = await grayPixels(framePath, fw, fh);
    const p = await grayPixels(pagePath, pw, ph);
    const c = contrast(p);
    const b = bestOffset(f, fw, fh, p, pw, ph);
    const base = { path: framePath, contrast: Math.round(c * 10) / 10, max };
    if (!b) return { ...base, match: null, diff: null, at: null };
    const diff = Math.round(b.diff * 10) / 10;
    return { ...base, match: c < FRAME_MIN_CONTRAST ? null : diff <= max, diff, at: { x: b.x * scale, y: b.y * scale } };
}
