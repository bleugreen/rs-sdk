import { describe, expect, test } from 'bun:test';
import { loginTokenProof } from '../../server/webclient/login-token';
import { fakeCdp } from './fake-cdp';
import { botTabs, evaluateInTab, pageLogin, pageLoginExpression, pageLoginState, type CdpTarget } from './tab';

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
