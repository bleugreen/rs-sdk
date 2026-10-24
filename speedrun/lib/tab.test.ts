import { describe, expect, test } from 'bun:test';
import { loginTokenProof } from '../../server/webclient/login-token';
import { fakeCdp } from './fake-cdp';
import {
    botTabs, closeBotTabs, evaluateInTab, frontTab, pageInGame, pageLabel, pageLogin, pageLoginExpression, pageLoginState, probePage, raiseTabWindow, screenshotTab, stageBotTab, type CdpTarget,
} from './tab';

test('botTabs finds this bot\'s client pages and nothing else', () => {
    const targets: CdpTarget[] = [
        // A token page, before and after the page strips the token from its address bar.
        { id: 'a', type: 'page', url: 'http://127.0.0.1:8899/bot?server=rs-sdk-demo.fly.dev&gateway=ws://127.0.0.1:7780&bot=runner1&token=x' },
        { id: 'b', type: 'page', url: 'http://127.0.0.1:8899/bot?bot=runner10' },
        { id: 'c', type: 'service_worker', url: 'http://127.0.0.1:8899/bot?bot=runner1' },
        { id: 'd', type: 'page', url: 'chrome://newtab/' },
        { id: 'e', type: 'page', url: 'http://127.0.0.1:8899/bot?server=rs-sdk-demo.fly.dev&gateway=ws://127.0.0.1:7780&bot=runner1' },
    ];
    expect(botTabs(targets, 'runner1').map(t => t.id)).toEqual(['a', 'e']);
    expect(botTabs(targets, 'nobody')).toEqual([]);
});

describe('probePage: a bounded page read that tells a page that cannot answer from its answer', () => {
    test('in game, out of game, and no tab for the bot (absent; pageInGame null as before)', async () => {
        const cdp = fakeCdp('scored');
        try {
            expect(await probePage(cdp.origin, 'scored')).toEqual({ inGame: true });
            cdp.client.ingame = false;
            expect(await probePage(cdp.origin, 'scored')).toEqual({ inGame: false });
            expect(await pageInGame(cdp.origin, 'scored')).toBe(false);
            cdp.page.tab = false;
            expect(await probePage(cdp.origin, 'scored')).toEqual({ gone: "no tab for the bot in Chrome's targets", absent: true });
            expect(await pageInGame(cdp.origin, 'scored')).toBeNull();
        } finally {
            cdp.stop();
        }
    });

    test("a crashed renderer: its target still listed, the evaluate rejected; gone, and pageInGame throws as before", async () => {
        const cdp = fakeCdp('scored');
        try {
            cdp.page.renderer = 'crashed';
            expect(await probePage(cdp.origin, 'scored')).toEqual({ gone: 'its renderer did not answer (CDP Runtime.evaluate: Target crashed)' });
            await expect(pageInGame(cdp.origin, 'scored')).rejects.toThrow('Target crashed');
        } finally {
            cdp.stop();
        }
    });

    test('a hung renderer: gone at the bound, not later', async () => {
        const cdp = fakeCdp('scored');
        try {
            cdp.page.renderer = 'hung';
            const t0 = Date.now();
            expect(await probePage(cdp.origin, 'scored', 150)).toEqual({ gone: 'its renderer did not answer (CDP Runtime.evaluate: no reply in 150 ms)' });
            expect(Date.now() - t0).toBeLessThan(1_000);
        } finally {
            cdp.stop();
        }
    });

    test('a DevTools port that does not answer: gone, never a throw', async () => {
        const cdp = fakeCdp('scored');
        cdp.stop();
        const p = await probePage(cdp.origin, 'scored', 500);
        expect('gone' in p && p.gone).toMatch(/^Chrome's DevTools port did not answer \/json\/list/);
        await expect(pageInGame(cdp.origin, 'scored', 500)).rejects.toThrow("Chrome's DevTools port did not answer");
    });
});

describe('pageLogin: the tab logs itself back in, no navigation', () => {
    const PASSWORD = 's3cr3t-Pw9';

    /** Mint a token the way session.ts does: the proof, never the password. */
    async function mint(cdp: ReturnType<typeof fakeCdp>): Promise<string> {
        const res = await fetch(new URL('/bot/login-token', cdp.clientUrl), { method: 'POST', body: JSON.stringify({ bot: 'srtest', proof: loginTokenProof('srtest', PASSWORD) }) });
        return ((await res.json()) as { token: string }).token;
    }

    test('the page script carries the token and the bot name, never the password, and quotes them', () => {
        const e = pageLoginExpression('sr "test', 'tok\'1"');
        expect(e).toContain(JSON.stringify('tok\'1"'));
        expect(e).toContain(JSON.stringify('sr "test'));
        expect(e).not.toContain('password:');
    });

    test('a logged-out page redeems the token in the page and runs its own login', async () => {
        const cdp = fakeCdp('srtest', PASSWORD);
        try {
            cdp.client.ingame = false;
            cdp.client.botOverlay!.serverTick = 57;
            const token = await mint(cdp);
            const r = await pageLogin(cdp.origin, 'srtest', token);
            expect(r).toEqual({ started: true, tickBase: 57, gatewayConnected: true });
            expect(cdp.page.redeemed).toEqual([token]);
            expect(cdp.page.autoLogins).toEqual([{ username: 'srtest', password: PASSWORD }]);
            expect(cdp.client.loginInProgress).toBe(true);
            expect(cdp.page.navigations).toEqual([]);
            for (const e of cdp.page.expressions) expect(e).not.toContain(PASSWORD);
            expect(await pageLoginState(cdp.origin, 'srtest')).toEqual({ inGame: false, loginInProgress: true, message: 'Connecting to server...', error: '' });
        } finally {
            cdp.stop();
        }
    });

    test('it does not start in game, mid-login, without a client, or with a spent token; no tab is null', async () => {
        const cdp = fakeCdp('srtest', PASSWORD);
        try {
            expect(await pageLogin(cdp.origin, 'srtest', await mint(cdp))).toMatchObject({ started: false, reason: 'already in game' });
            cdp.client.ingame = false;
            cdp.client.loginInProgress = true;
            expect(await pageLogin(cdp.origin, 'srtest', await mint(cdp))).toMatchObject({ started: false, reason: 'a login is already in progress' });
            cdp.client.loginInProgress = false;
            const token = await mint(cdp);
            expect((await pageLogin(cdp.origin, 'srtest', token))?.started).toBe(true);
            cdp.client.loginInProgress = false;
            expect(await pageLogin(cdp.origin, 'srtest', token)).toMatchObject({ started: false, reason: 'login token refused: HTTP 403' });
            cdp.page.hasClient = false;
            expect(await pageLogin(cdp.origin, 'srtest', await mint(cdp))).toMatchObject({ started: false, reason: 'no game client on the page' });
            expect(await pageLoginState(cdp.origin, 'srtest')).toBeNull();
            cdp.page.tab = false;
            expect(await pageLogin(cdp.origin, 'srtest', await mint(cdp))).toBeNull();
            expect(cdp.page.autoLogins).toHaveLength(1);
        } finally {
            cdp.stop();
        }
    });

    test('a page without the overlay still logs in, with no tick base', async () => {
        const cdp = fakeCdp('srtest', PASSWORD);
        try {
            cdp.client.ingame = false;
            cdp.client.botOverlay = null;
            expect(await pageLogin(cdp.origin, 'srtest', await mint(cdp))).toEqual({ started: true, tickBase: null, gatewayConnected: null });
        } finally {
            cdp.stop();
        }
    });

    test('evaluateInTab reports a page exception as an error', async () => {
        const cdp = fakeCdp('srtest', PASSWORD);
        try {
            expect(await evaluateInTab(cdp.origin, 'srtest', '1 + 1')).toEqual({ value: 2 });
            await expect(evaluateInTab(cdp.origin, 'srtest', 'window.nope.x')).rejects.toThrow(/page threw/);
        } finally {
            cdp.stop();
        }
    });
});

describe('windows on the recorded display: stage, close, front, raise', () => {
    test('pageLabel names a client page by its bot and never carries the query string', () => {
        expect(pageLabel({ url: 'http://127.0.0.1:8899/bot?server=rs-sdk-demo.fly.dev&bot=cairn_twin&token=secret-1' })).toBe('bot=cairn_twin');
        expect(pageLabel({ url: 'http://127.0.0.1:8899/other?token=secret-1' })).toBe('http://127.0.0.1:8899/other');
        expect(pageLabel({ url: 'about:blank' })).toBe('about:blank');
        expect(pageLabel({ url: 'chrome://newtab/' })).toBe('chrome://newtab/');
        expect(pageLabel({ url: 'not a url' })).toBe('(unparsed url)');
    });

    test('stage opens the next account\'s bare window and maximises it; then the gate\'s window can close', async () => {
        const cdp = fakeCdp('cairn_twin');
        try {
            cdp.page.window = 'normal';
            const bare = 'http://127.0.0.1:8899/bot?server=rs-sdk-demo.fly.dev&bot=cairn_smoke';
            expect(await stageBotTab(cdp.origin, 'cairn_smoke', bare)).toEqual({ how: 'opened', was: 'normal' });
            expect(cdp.page.opened).toEqual([bare]);
            expect(cdp.page.windowStates).toEqual(['maximized']);
            expect(await closeBotTabs(cdp.origin, 'cairn_twin')).toEqual({ closed: 1, left: ['bot=cairn_smoke'] });
            expect(cdp.page.closed).toEqual(['t1']);
        } finally {
            cdp.stop();
        }
    });

    test('stage keeps a window the account already has, maximising it through normal when minimised', async () => {
        const cdp = fakeCdp('cairn_smoke');
        try {
            cdp.page.window = 'minimized';
            expect(await stageBotTab(cdp.origin, 'cairn_smoke', 'unused')).toEqual({ how: 'present', was: 'minimized' });
            expect(cdp.page.opened).toEqual([]);
            expect(cdp.page.windowStates).toEqual(['normal', 'maximized']);
            cdp.page.windowStates = [];
            await stageBotTab(cdp.origin, 'cairn_smoke', 'unused');
            expect(cdp.page.windowStates).toEqual([]);
        } finally {
            cdp.stop();
        }
    });

    test('closeBotTabs refuses Chrome\'s last window, since Chrome quits with it', async () => {
        const cdp = fakeCdp('cairn_twin');
        try {
            await expect(closeBotTabs(cdp.origin, 'cairn_twin')).rejects.toThrow("cairn_twin's window is Chrome's last");
            expect(cdp.page.closed).toEqual([]);
            cdp.page.tab = false;
            cdp.page.others.push({ id: 't2', url: 'about:blank' });
            expect(await closeBotTabs(cdp.origin, 'cairn_twin')).toEqual({ closed: 0, left: ['about:blank'] });
        } finally {
            cdp.stop();
        }
    });

    test('Chrome\'s own UI pages are no windows: they neither keep Chrome up nor count as other pages', async () => {
        const cdp = fakeCdp('cairn_twin');
        try {
            cdp.page.others.push({ id: 'ui', url: 'chrome://omnibox-popup.top-chrome/' }, { id: 'ui2', url: 'chrome://omnibox-popup.top-chrome/omnibox_popup_aim.html' });
            await expect(closeBotTabs(cdp.origin, 'cairn_twin')).rejects.toThrow("Chrome's last");
            cdp.page.others.push({ id: 'n1', url: 'http://127.0.0.1:8899/bot?bot=cairn_smoke' });
            expect(await closeBotTabs(cdp.origin, 'cairn_twin')).toEqual({ closed: 1, left: ['bot=cairn_smoke'] });
            expect((await frontTab(cdp.origin, 'cairn_smoke', 'cairn_smoke'))!.others).toEqual([]);
        } finally {
            cdp.stop();
        }
    });

    test('frontTab brings the tab to the front, marks its title once, and reports viewport, window and other pages', async () => {
        const cdp = fakeCdp('cairn_smoke');
        try {
            cdp.page.others.push({ id: 't2', url: 'http://127.0.0.1:8899/bot?bot=cairn_twin&token=secret-3' });
            const f = await frontTab(cdp.origin, 'cairn_smoke', 'cairn_smoke');
            expect(f).toEqual({
                title: 'cairn_smoke - 2004Scape Bot Client', focused: true, visibility: 'visible', viewport: { width: 1920, height: 978, dpr: 1 }, windowState: 'maximized', others: ['bot=cairn_twin'],
            });
            expect(cdp.page.methods.slice(0, 2)).toEqual(['Page.bringToFront', 'Runtime.evaluate']);
            expect((await frontTab(cdp.origin, 'cairn_smoke', 'cairn_smoke'))!.title).toBe('cairn_smoke - 2004Scape Bot Client');
            expect(await frontTab(cdp.origin, 'nobody', 'nobody')).toBeNull();
        } finally {
            cdp.stop();
        }
    });

    test('screenshotTab returns the page\'s PNG bytes; null without a tab', async () => {
        const cdp = fakeCdp('cairn_smoke');
        try {
            expect([...(await screenshotTab(cdp.origin, 'cairn_smoke'))!]).toEqual([0x89, 0x50, 0x4e, 0x47]);
            expect(await screenshotTab(cdp.origin, 'nobody')).toBeNull();
        } finally {
            cdp.stop();
        }
    });

    test('raiseTabWindow minimises the window, then restores it to maximised', async () => {
        const cdp = fakeCdp('cairn_smoke');
        try {
            await raiseTabWindow(cdp.origin, 'cairn_smoke');
            expect(cdp.page.windowStates).toEqual(['minimized', 'normal', 'maximized']);
            expect(cdp.page.methods.at(-1)).toBe('Page.bringToFront');
            await expect(raiseTabWindow(cdp.origin, 'nobody')).rejects.toThrow('nobody has no tab');
        } finally {
            cdp.stop();
        }
    });
});
