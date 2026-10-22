import { afterAll, describe, expect, test } from 'bun:test';

import '../lite/test-support/browser-globals.js';

const { Client } = await import('../client/Client.js');
const { default: Pix8 } = await import('#/graphics/Pix8.js');

// loadTitleImages depacks the title archive's sprites; the stand-in has no archive,
// and only the redraw's effect on the loading bookkeeping is under test.
const realDepack = Pix8.depack;
Pix8.depack = (() => ({})) as unknown as typeof Pix8.depack;
afterAll(() => {
    Pix8.depack = realDepack;
});

/**
 * A browser client stand-in carrying only what loading, autoLogin, logout and the
 * title redraw read. The title images count as prepared (imageTitle2 is set) so
 * drawProgress skips rebuilding them, and login() enters the game without a server.
 */
function standIn() {
    const logins: string[] = [];
    const client = Object.assign(Object.create(Client.prototype), {
        ingame: false,
        loginInProgress: false,
        loginscreen: 0,
        loginSelect: 0,
        loginUser: '',
        loginPass: '',
        lastProgressPercent: 0,
        lastProgressMessage: '',
        loadingComplete: false,
        title: {},
        imageTitle2: {},
        imageTitle4: null,
        imageRunes: [],
        titleFlames: null,
        redrawFrame: false,
        searchParams: new URLSearchParams(),
        botOverlay: null,
        stream: null,
        world: null,
        collision: [],
        async login(this: { ingame: boolean }, username: string, password: string): Promise<void> {
            logins.push(`${username}:${password}`);
            this.ingame = true;
        }
    });
    return { client, logins };
}

/** Resolves with 'done' when `p` settles within `ms`, otherwise with 'waiting'. */
function within(p: Promise<unknown>, ms: number): Promise<'done' | 'waiting'> {
    return Promise.race([p.then(() => 'done' as const), new Promise<'waiting'>(resolve => setTimeout(() => resolve('waiting'), ms))]);
}

describe('autoLogin in a page that logs in more than once', () => {
    test('waits for loading to finish, then logs in again after a logout and its title redraw', async () => {
        const { client, logins } = standIn();

        await client.drawProgress('Connecting to web server', 10);
        const first = client.autoLogin('cairn', 'secret');
        await client.loadTitleImages();
        await client.drawProgress('Unpacking interfaces', 95);
        expect(await within(first, 250)).toBe('waiting');
        expect(logins).toEqual([]);

        await client.drawProgress('Preparing game engine', 100);
        expect(await within(first, 1_000)).toBe('done');
        expect(logins).toEqual(['cairn:secret']);
        expect(client.ingame).toBe(true);

        await client.logout();
        expect(client.ingame).toBe(false);
        expect(client.loginscreen).toBe(0);

        // Back on the title screen the client redraws its title images, and that redraw
        // puts the loading bar back to 10% even though nothing is loading.
        client.loadTitleImages();
        await Bun.sleep(20);
        expect(client.lastProgressPercent).toBe(10);

        const second = client.autoLogin('cairn', 'secret');
        expect(await within(second, 1_000)).toBe('done');
        expect(logins).toEqual(['cairn:secret', 'cairn:secret']);
        expect(client.ingame).toBe(true);

        await client.logout();
        client.loadTitleImages();
        const third = client.autoLogin('cairn', 'secret');
        expect(await within(third, 1_000)).toBe('done');
        expect(logins).toHaveLength(3);
    });
});
