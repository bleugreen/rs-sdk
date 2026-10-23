// The game as the browser client renders it: Chrome's DevTools screencast (Page.startScreencast)
// saves every compositor frame as a JPEG with the frame's own wall-clock timestamp, and `encodeClip`
// re-times them onto a constant frame rate (trace.ts `schedule`) and encodes H.264 with ffmpeg. The
// screencast only sends a frame when the page repaints, so the re-timing is what makes the rate
// steady; the frame timestamps are what put the video on the trace's clock.

import { join } from 'node:path';
import type { Page } from 'puppeteer';
import { schedule } from './trace';

export interface CapturedFrame {
    /** When the compositor produced the frame (metadata.timestamp), epoch ms; the receive time if absent. */
    ms: number;
    /** When this process received it, epoch ms. */
    rxMs: number;
    file: string;
}

export interface Screencast {
    readonly count: number;
    stop(): Promise<CapturedFrame[]>;
}

export async function startScreencast(page: Page, dir: string, o: { quality?: number } = {}): Promise<Screencast> {
    const cdp = await page.createCDPSession();
    const frames: CapturedFrame[] = [];
    const writes: Promise<unknown>[] = [];
    cdp.on('Page.screencastFrame', ev => {
        const rxMs = Date.now();
        // The next frame is only sent once this one is acknowledged.
        void cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
        const file = join(dir, `${String(frames.length).padStart(6, '0')}.jpg`);
        const ts = ev.metadata.timestamp;
        frames.push({ ms: typeof ts === 'number' ? ts * 1000 : rxMs, rxMs, file });
        writes.push(Bun.write(file, Buffer.from(ev.data, 'base64')));
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: o.quality ?? 90, everyNthFrame: 1 });
    return {
        get count() {
            return frames.length;
        },
        async stop() {
            await cdp.send('Page.stopScreencast').catch(() => {});
            await Promise.all(writes);
            await cdp.detach().catch(() => {});
            return [...frames].sort((a, b) => a.ms - b.ms);
        }
    };
}

/** A JPEG's width and height, from its first start-of-frame marker. */
export function jpegSize(buf: Uint8Array): { width: number; height: number } {
    let i = 2;
    while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
            i++;
            continue;
        }
        const marker = buf[i + 1]!;
        const len = (buf[i + 2]! << 8) | buf[i + 3]!;
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { height: (buf[i + 5]! << 8) | buf[i + 6]!, width: (buf[i + 7]! << 8) | buf[i + 8]! };
        }
        i += 2 + len;
    }
    throw new Error('jpegSize: no start-of-frame marker');
}

export interface Crop {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * Encode `frames` as a constant-rate H.264 clip from `t0` to `t1` (epoch ms), cropped (even width
 * and height, as yuv420p needs). Output frame i starts at t0 + i / fps and shows the latest frame
 * captured by then.
 */
export async function encodeClip(frames: readonly CapturedFrame[], o: { fps: number; t0: number; t1: number; crop: Crop; out: string; crf?: number }): Promise<{ frames: number }> {
    const idx = schedule(frames.map(f => f.ms), o.fps, o.t0, o.t1);
    const { x, y } = o.crop;
    const w = o.crop.w & ~1;
    const h = o.crop.h & ~1;
    const ff = Bun.spawn(
        ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(o.fps), '-c:v', 'mjpeg', '-i', '-',
            '-vf', `crop=${w}:${h}:${x}:${y}`, '-c:v', 'libx264', '-preset', 'medium', '-crf', String(o.crf ?? 26), '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart', '-r', String(o.fps), o.out],
        { stdin: 'pipe', stdout: 'ignore', stderr: 'pipe' }
    );
    let last = -1;
    let buf: Uint8Array = new Uint8Array();
    for (const i of idx) {
        if (i !== last) {
            buf = await Bun.file(frames[i]!.file).bytes();
            last = i;
        }
        ff.stdin.write(buf);
        await ff.stdin.flush();
    }
    await ff.stdin.end();
    const [code, err] = await Promise.all([ff.exited, new Response(ff.stderr).text()]);
    if (code !== 0) throw new Error(`ffmpeg encode: exit ${code}: ${err.trim()}`);
    return { frames: idx.length };
}
