import { expect, test } from 'bun:test';

import '../lite/test-support/browser-globals.js';

import { getBotPassword, getBotUsername, getLaunchId, redeemLoginToken, type LoginTokenWindow } from './GatewayConnection.js';

test("the page's ?launch= id, which stays when the token leaves the URL; none without one", () => {
    expect(getLaunchId('?server=world.example&bot=srtok&launch=0123456789ab&token=t0k')).toBe('0123456789ab');
    expect(getLaunchId('?server=world.example&bot=srtok&launch=0123456789ab')).toBe('0123456789ab');
    expect(getLaunchId('?bot=srtok')).toBeNull();
    expect(getLaunchId('?bot=srtok&launch=')).toBeNull();
    expect(getLaunchId(undefined)).toBeNull();
});

function fakeWindow(href: string, answer: () => Response) {
    const calls: { url: string; body: string; addressBar: string }[] = [];
    const win = {
        location: { href },
        history: {
            state: null,
            replaceState: (_s: unknown, _t: string, url: string) => {
                win.location.href = url;
            }
        },
        fetch: async (url: string, init: RequestInit) => {
            calls.push({ url, body: String(init.body), addressBar: win.location.href });
            return answer();
        }
    };
    return { win: win as unknown as LoginTokenWindow & { location: { href: string } }, calls };
}

test('a page without ?token= makes no request', async () => {
    const { win, calls } = fakeWindow('http://127.0.0.1:8899/bot?bot=srtok', () => new Response('{}'));
    expect(await redeemLoginToken(win)).toBe(false);
    expect(calls).toEqual([]);
});

test('a refused token is still gone from the address bar', async () => {
    const { win, calls } = fakeWindow('http://127.0.0.1:8899/bot?bot=srtok&token=spent', () => new Response('{"error":"login token unknown"}', { status: 403 }));
    expect(await redeemLoginToken(win)).toBe(false);
    expect(calls).toHaveLength(1);
    expect(win.location.href).toBe('http://127.0.0.1:8899/bot?bot=srtok');
});

test('?token= leaves the address bar before it is redeemed, and the password lives only in memory', async () => {
    const { win, calls } = fakeWindow(
        'http://127.0.0.1:8899/bot?bot=srtok&token=t0k&server=world.example',
        () => new Response(JSON.stringify({ bot: 'srtok', password: 'hunter2' }))
    );
    expect(await redeemLoginToken(win)).toBe(true);
    expect(calls).toEqual([
        { url: 'http://127.0.0.1:8899/bot/login', body: '{"token":"t0k","bot":"srtok"}', addressBar: 'http://127.0.0.1:8899/bot?bot=srtok&server=world.example' }
    ]);
    expect(win.location.href).not.toContain('hunter2');
    expect(getBotUsername()).toBe('srtok');
    expect(getBotPassword()).toBe('hunter2');
});
