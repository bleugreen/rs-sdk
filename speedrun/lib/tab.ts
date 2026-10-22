// The scored run's browser tab, driven over the Chrome DevTools protocol so a
// reconnect reloads the one tab instead of opening another each time.
//
// Launch the run machine's Chrome with --remote-debugging-port=9222 (beside the
// anti-throttling flags in STEP-MANIFEST.md's run-machine setup) and set
// CDP_URL=http://127.0.0.1:9222 in the bot.env (or SPEEDRUN_CDP_URL). The page
// auto-logs in once per load (Client.ts titleScreenDraw), and after a failed
// reconnect it sits on the title screen, so a fresh navigation is the only
// login path the SDK has. CDP is also what keeps the login secret off every
// command line: the navigation to a one-time token URL (session.ts
// openBrowserClient) is a websocket message to Chrome, not a process argument.

export interface CdpTarget {
    id: string;
    type: string;
    url: string;
    webSocketDebuggerUrl?: string;
}

/** Page targets showing this bot's client (the URL carries bot=<name>), first one first. */
export function botTabs(targets: readonly CdpTarget[], botName: string): CdpTarget[] {
    return targets.filter(t => {
        if (t.type !== 'page') return false;
        try {
            return new URL(t.url).searchParams.get('bot') === botName;
        } catch {
            return false;
        }
    });
}

/** Send one CDP command on a target's websocket and wait for its reply. */
function cdpCommand(wsUrl: string, method: string, params: Record<string, unknown>, timeoutMs = 5_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const timer = setTimeout(() => {
            ws.close();
            reject(new Error(`CDP ${method}: no reply in ${timeoutMs} ms`));
        }, timeoutMs);
        ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
        ws.onmessage = ev => {
            const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string } };
            if (msg.id !== 1) return;
            clearTimeout(timer);
            ws.close();
            if (msg.error) reject(new Error(`CDP ${method}: ${msg.error.message}`));
            else resolve(msg.result);
        };
        ws.onerror = () => {
            clearTimeout(timer);
            reject(new Error(`CDP ${method}: websocket error`));
        };
    });
}

/**
 * The page's own in-game flag (window.gameClient.ingame) in this bot's tab, or null when there is
 * no such tab. Throws when Chrome's DevTools port does not answer.
 */
export async function pageInGame(cdpOrigin: string, botName: string): Promise<boolean | null> {
    const base = cdpOrigin.replace(/\/+$/, '');
    const [tab] = botTabs((await (await fetch(`${base}/json/list`)).json()) as CdpTarget[], botName);
    if (!tab?.webSocketDebuggerUrl) return null;
    const out = (await cdpCommand(tab.webSocketDebuggerUrl, 'Runtime.evaluate', {
        expression: '!!(window.gameClient && window.gameClient.ingame)',
        returnByValue: true,
    })) as { result?: { value?: unknown } };
    return out.result?.value === true;
}

/** Whether this bot's tab shows a client that is in game; false with no tab. */
export async function tabInGame(cdpOrigin: string, botName: string): Promise<boolean> {
    return (await pageInGame(cdpOrigin, botName)) === true;
}

/**
 * Evaluate `expression` in this bot's tab, awaiting it when it is a promise, and return its value
 * as `{ value }`; null when there is no such tab. Throws when the expression throws or Chrome's
 * DevTools port does not answer.
 */
export async function evaluateInTab<T>(cdpOrigin: string, botName: string, expression: string, timeoutMs = 5_000): Promise<{ value: T } | null> {
    const base = cdpOrigin.replace(/\/+$/, '');
    const [tab] = botTabs((await (await fetch(`${base}/json/list`)).json()) as CdpTarget[], botName);
    if (!tab?.webSocketDebuggerUrl) return null;
    const out = (await cdpCommand(tab.webSocketDebuggerUrl, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs)) as {
        result?: { value?: unknown };
        exceptionDetails?: { text?: string; exception?: { description?: string } };
    };
    if (out.exceptionDetails) throw new Error(`page threw: ${out.exceptionDetails.exception?.description ?? out.exceptionDetails.text ?? 'unknown'}`);
    return { value: out.result?.value as T };
}

/** What the page answered when asked to log in again in place (pageLogin). */
export interface PageLoginStart {
    /** The page redeemed the token and its login is under way. */
    started: boolean;
    /** Why it did not start: no client, already in game, a login already running, the token refused. */
    reason?: string;
    /**
     * The overlay's client tick count when the login started (BotOverlay.serverTick). The page
     * counts PLAYER_INFO only in game and is not reloaded, so the new session's Nth tick reads
     * tickBase + N, where a freshly loaded page would read N. Null when the page does not expose it.
     */
    tickBase: number | null;
    /** Whether the overlay's gateway socket was up (it stays open across an in-page logout). */
    gatewayConnected: boolean | null;
}

/**
 * The page script for pageLogin. It carries the one-time token and the bot name, never the
 * password: the page redeems the token at its own server (POST /bot/login, proxy.ts), exactly as a
 * ?token= page load does (GatewayConnection.ts redeemLoginToken), and hands the credentials
 * straight to the client's autoLogin, so they stay inside the page.
 */
export function pageLoginExpression(botName: string, token: string): string {
    return `(async () => {
    const c = window.gameClient;
    const o = c && c.botOverlay;
    const tickBase = o && typeof o.serverTick === 'number' ? o.serverTick : null;
    const gatewayConnected = o && o.gateway && typeof o.gateway.connected === 'boolean' ? o.gateway.connected : null;
    const no = reason => ({ started: false, reason, tickBase, gatewayConnected });
    if (!c || typeof c.autoLogin !== 'function') return no('no game client on the page');
    if (c.ingame) return no('already in game');
    if (c.loginInProgress) return no('a login is already in progress');
    const res = await fetch(new URL('/bot/login', location.href).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: ${JSON.stringify(token)}, bot: ${JSON.stringify(botName)} }),
        cache: 'no-store'
    });
    if (!res.ok) return no('login token refused: HTTP ' + res.status);
    const body = await res.json();
    if (typeof body.bot !== 'string' || typeof body.password !== 'string') return no('the page server answered without credentials');
    window.__rsPageLoginError = '';
    c.autoLogin(body.bot, body.password).catch(e => { window.__rsPageLoginError = String((e && e.stack) || e); });
    return { started: true, tickBase, gatewayConnected };
})()`;
}

/**
 * Log this bot's tab back in without navigating it: the page, sitting on the title screen after a
 * logout, redeems `token` and runs its own login (see pageLoginExpression). The page, its game
 * cache and its gateway socket all stay as they are. Null when there is no tab for the bot.
 */
export async function pageLogin(cdpOrigin: string, botName: string, token: string): Promise<PageLoginStart | null> {
    const out = await evaluateInTab<PageLoginStart>(cdpOrigin, botName, pageLoginExpression(botName, token), 10_000);
    return out ? out.value : null;
}

/** The page's login status: in game, a login running, the title screen's message lines, and what the last in-page login threw. */
export interface PageLoginState {
    inGame: boolean;
    loginInProgress: boolean;
    message: string;
    /** The client's login rethrows anything but a socket error, leaving "Connecting to server..." on screen. */
    error: string;
}

const LOGIN_STATE_EXPRESSION = `(() => {
    const c = window.gameClient;
    if (!c) return null;
    return { inGame: !!c.ingame, loginInProgress: !!c.loginInProgress, message: [c.loginMes1, c.loginMes2].filter(Boolean).join(' '), error: window.__rsPageLoginError || '' };
})()`;

/** The page's login status, or null when there is no tab or no client on it. */
export async function pageLoginState(cdpOrigin: string, botName: string): Promise<PageLoginState | null> {
    const out = await evaluateInTab<PageLoginState | null>(cdpOrigin, botName, LOGIN_STATE_EXPRESSION);
    return out ? out.value : null;
}

/** Close the overlay's gateway socket for good (no auto-reconnect); true when there was one. */
export const RELEASE_GATEWAY_EXPRESSION = `(() => {
    const g = window.gameClient && window.gameClient.botOverlay && window.gameClient.botOverlay.gateway;
    if (!g || typeof g.disconnect !== 'function') return false;
    g.preventReconnect = true;
    g.disconnect();
    return true;
})()`;

/**
 * Navigate this bot's tab to `url` (a full reload with a login token, which
 * triggers the page's one auto-login), closing any duplicate tab that would
 * fight it for the account; open one if there is none.
 */
export async function reloadOrOpenTab(cdpOrigin: string, url: string, botName: string): Promise<'reloaded' | 'opened'> {
    const base = cdpOrigin.replace(/\/+$/, '');
    const list = (await (await fetch(`${base}/json/list`)).json()) as CdpTarget[];
    const [tab, ...extra] = botTabs(list, botName);
    for (const t of extra) await fetch(`${base}/json/close/${t.id}`).catch(() => {});
    if (tab?.webSocketDebuggerUrl) {
        // Close the old page's gateway socket first. On the twin's Chrome the navigation did not
        // close it, so the gateway took the new page for a second session and held it in its
        // takeover wait (5 s timeout + 700 ms, server/gateway/gateway.ts), dropping its states:
        // the bot first saw the new session at its tick ~20. Best effort; no overlay, no harm.
        await cdpCommand(tab.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: RELEASE_GATEWAY_EXPRESSION, returnByValue: true }, 2_000).catch(() => {});
        await cdpCommand(tab.webSocketDebuggerUrl, 'Page.navigate', { url });
        return 'reloaded';
    }
    const res = await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    if (!res.ok) throw new Error(`CDP /json/new: HTTP ${res.status}`);
    return 'opened';
}
