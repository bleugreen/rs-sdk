import { describe, expect, test } from 'bun:test';
import { bestOffset, contrast, findRecording, frontWindows, parseWindowIds, parseWindowProps, pngSize } from './display';

describe('frontWindows: the window in front of the X display, from xprop', () => {
    // What xprop printed on an XFCE display: the desktop, two Chrome windows, the panel on top.
    const props: Record<string, string> = {
        '0x1a00003': '_NET_WM_NAME(UTF8_STRING) = "Desktop"\nWM_NAME(STRING) = "Desktop"\n_NET_WM_WINDOW_TYPE(ATOM) = _NET_WM_WINDOW_TYPE_DESKTOP\n_NET_WM_STATE:  not found.\n',
        '0x2800004': '_NET_WM_NAME(UTF8_STRING) = "cairn_smoke - 2004Scape Bot Client"\nWM_NAME(STRING) = "cairn_smoke - 2004Scape Bot Client"\n_NET_WM_WINDOW_TYPE(ATOM) = _NET_WM_WINDOW_TYPE_NORMAL\n_NET_WM_STATE(ATOM) = _NET_WM_STATE_MAXIMIZED_VERT, _NET_WM_STATE_MAXIMIZED_HORZ\n',
        '0x2800009': '_NET_WM_NAME(UTF8_STRING) = "2004Scape \\"Bot\\" Client"\n_NET_WM_WINDOW_TYPE(ATOM) = _NET_WM_WINDOW_TYPE_NORMAL\n_NET_WM_STATE(ATOM) = _NET_WM_STATE_HIDDEN\n',
        '0x1600007': '_NET_WM_NAME(UTF8_STRING) = "xfce4-panel"\n_NET_WM_WINDOW_TYPE(ATOM) = _NET_WM_WINDOW_TYPE_DOCK\n_NET_WM_STATE(ATOM) = _NET_WM_STATE_STICKY, _NET_WM_STATE_ABOVE\n',
    };
    const run = (active: string) => async (args: readonly string[]) => {
        if (args[0] === '-root' && args[1] === '_NET_ACTIVE_WINDOW') return `_NET_ACTIVE_WINDOW(WINDOW): window id # ${active}\n`;
        if (args[0] === '-root') return '_NET_CLIENT_LIST_STACKING(WINDOW): window id # 0x1a00003, 0x2800004, 0x2800009, 0x1600007\n';
        return props[args[1]!]!;
    };

    test('parses ids, names with escapes, types and states', () => {
        expect(parseWindowIds('_NET_ACTIVE_WINDOW(WINDOW): window id # 0x0\n')).toEqual([]);
        expect(parseWindowIds('_NET_CLIENT_LIST_STACKING:  not found.\n')).toEqual([]);
        expect(parseWindowProps('0x2800009', props['0x2800009']!)).toEqual({ id: '0x2800009', name: '2004Scape "Bot" Client', types: ['NORMAL'], states: ['HIDDEN'] });
        expect(parseWindowProps('0x1', 'WM_NAME(STRING) = "only the old name"\n').name).toBe('only the old name');
    });

    test('the top is the highest window past the panel, the desktop and minimised windows', async () => {
        const w = await frontWindows(run('0x2800004'));
        expect(w.top?.name).toBe('cairn_smoke - 2004Scape Bot Client');
        expect(w.active).toBe(w.top);
        expect(w.windows).toBe(4);
        const none = await frontWindows(run('0x0'));
        expect(none.active).toBeNull();
        expect(none.top?.id).toBe('0x2800004');
    });
});

describe('findRecording: the recording ffmpeg on a display, never the live view', () => {
    // RUN-HOST.md step 5's two grabs, as pgrep -a prints them.
    const rec = '2749 ffmpeg -hide_banner -loglevel warning -f x11grab -draw_mouse 1 -framerate 30 -video_size 1920x1080 -i :10.0+0,0 -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -progress /home/ubuntu/recordings/ffmpeg-progress.log /home/ubuntu/recordings/rs232-smoke-20261022T020000Z.mkv';
    const live = '2790 ffmpeg -nostdin -hide_banner -loglevel warning -f x11grab -draw_mouse 1 -framerate 3 -video_size 1920x1080 -i :10.0+0,0 -vf scale=960:540 -c:v mjpeg -q:v 8 -f mpjpeg -listen 1 http://127.0.0.1:8090/live.mjpg';

    test('the recording counts, with its file', () => {
        expect(findRecording(`${live}\n${rec}\n`, ':10')).toEqual({ pid: 2749, file: '/home/ubuntu/recordings/rs232-smoke-20261022T020000Z.mkv' });
        expect(findRecording(rec, ':10.0')?.pid).toBe(2749);
    });

    test('the live view alone, another display, or a :1 grab for :10 does not', () => {
        expect(findRecording(live, ':10')).toBeNull();
        expect(findRecording(rec, ':99')).toBeNull();
        expect(findRecording(rec.replace(':10.0+0,0', ':1.0+0,0'), ':10')).toBeNull();
        expect(findRecording(rec.replace(':10.0+0,0', ':100'), ':10')).toBeNull();
        expect(findRecording('', ':10')).toBeNull();
    });
});

describe('the live frame against the page', () => {
    test('pngSize reads the IHDR chunk', () => {
        const png = new Uint8Array(24);
        png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
        new DataView(png.buffer).setUint32(16, 1920);
        new DataView(png.buffer).setUint32(20, 1080);
        expect(pngSize(png)).toEqual({ width: 1920, height: 1080 });
        expect(() => pngSize(new Uint8Array(8))).toThrow('not a PNG');
    });

    // A 6x5 frame with a 3x2 "page" pasted at (2,3), the rest flat.
    const page = Uint8Array.from([10, 200, 90, 250, 30, 140]);
    const frame = (at: { x: number; y: number }, noise = 0) => {
        const f = new Uint8Array(30).fill(60);
        for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) f[(at.y + y) * 6 + at.x + x] = page[y * 3 + x]! + noise;
        return f;
    };

    test('bestOffset finds where the page sits, and how well it matches', () => {
        expect(bestOffset(frame({ x: 2, y: 3 }), 6, 5, page, 3, 2)).toEqual({ x: 2, y: 3, diff: 0 });
        expect(bestOffset(frame({ x: 0, y: 0 }, 4), 6, 5, page, 3, 2)).toEqual({ x: 0, y: 0, diff: 4 });
        // Something else on screen: no offset matches well.
        expect(bestOffset(new Uint8Array(30).fill(60), 6, 5, page, 3, 2)!.diff).toBeGreaterThan(50);
        expect(bestOffset(frame({ x: 0, y: 0 }), 6, 5, page, 7, 1)).toBeNull();
    });

    test('contrast tells a flat page from a varied one', () => {
        expect(contrast(new Uint8Array(10).fill(3))).toBe(0);
        expect(contrast(page)).toBeGreaterThan(50);
    });
});
