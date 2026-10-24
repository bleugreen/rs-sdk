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

/**
 * Send CDP commands in order on one connection to a target's websocket, each after the last one's
 * reply, and return the replies. One connection matters where a domain is enabled first: what
 * `enable` turns on lasts only as long as the connection that sent it. `timeoutMs` bounds them all.
 */
export function cdpCommands(wsUrl: string, cmds: readonly { method: string; params?: Record<string, unknown> }[], timeoutMs = 5_000): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const out: unknown[] = [];
        let done = false;
        const method = () => cmds[out.length]?.method ?? cmds[cmds.length - 1]?.method;
        const finish = (err?: Error) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            ws.close();
            if (err) reject(err);
            else resolve(out);
        };
        const timer = setTimeout(() => finish(new Error(`CDP ${method()}: no reply in ${timeoutMs} ms`)), timeoutMs);
        const send = () => ws.send(JSON.stringify({ id: out.length + 1, method: cmds[out.length]!.method, params: cmds[out.length]!.params ?? {} }));
        ws.onopen = () => (cmds.length ? send() : finish());
        ws.onmessage = ev => {
            const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string } };
            if (done || msg.id !== out.length + 1) return;
            if (msg.error) return finish(new Error(`CDP ${method()}: ${msg.error.message}`));
            out.push(msg.result);
            if (out.length === cmds.length) finish();
            else send();
        };
        ws.onerror = () => finish(new Error(`CDP ${method()}: websocket error`));
    });
}

/** Send one CDP command on a target's websocket and wait for its reply. */
async function cdpCommand(wsUrl: string, method: string, params: Record<string, unknown>, timeoutMs = 5_000): Promise<unknown> {
    return (await cdpCommands(wsUrl, [{ method, params }], timeoutMs))[0];
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
export function pageLoginExpression(botName: string, token: string, validUntil?: number): string {
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
    // Token redemption can outlive both the readiness observation and the page's idle state.
    if (c.ingame) return no('already in game');
    if (c.loginInProgress) return no('a login is already in progress');
    const validUntil = ${JSON.stringify(validUntil ?? null)};
    if (validUntil !== null && Date.now() >= validUntil) return no('login readiness expired');
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
export async function pageLogin(cdpOrigin: string, botName: string, token: string, validUntil?: number): Promise<PageLoginStart | null> {
    if (validUntil !== undefined && !Number.isFinite(validUntil)) throw new Error('invalid login readiness deadline');
    const out = await evaluateInTab<PageLoginStart>(cdpOrigin, botName, pageLoginExpression(botName, token, validUntil), 10_000);
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

/**
 * A launched page as the controller judges its login: the `?launch=` id its URL carries (the token
 * leaves the URL, the launch id stays), whether it has a client yet, and the client's own login
 * flags. `autoLoginAttempted` is the title screen's one auto-login (Client.botAutoLoginAttempted),
 * which starts once `loadingComplete` holds; a page that has made it and is neither in game nor
 * logging in has had its login end without getting in, or has dropped out of the game since.
 */
export interface PageLaunchState {
    launch: string | null;
    hasClient: boolean;
    loadingComplete: boolean;
    autoLoginAttempted: boolean;
    inGame: boolean;
    loginInProgress: boolean;
    message: string;
}

const LAUNCH_STATE_EXPRESSION = `(() => {
    let launch = null;
    try { launch = new URL(location.href).searchParams.get('launch'); } catch (e) {}
    const c = window.gameClient;
    if (!c) return { launch, hasClient: false, loadingComplete: false, autoLoginAttempted: false, inGame: false, loginInProgress: false, message: '' };
    return {
        launch,
        hasClient: true,
        loadingComplete: !!c.loadingComplete,
        autoLoginAttempted: !!c.botAutoLoginAttempted,
        inGame: !!c.ingame,
        loginInProgress: !!c.loginInProgress,
        message: [c.loginMes1, c.loginMes2].filter(Boolean).join(' ')
    };
})()`;

/** The bot's page as PageLaunchState, or null when there is no tab for it. */
export async function pageLaunchState(cdpOrigin: string, botName: string): Promise<PageLaunchState | null> {
    const out = await evaluateInTab<PageLaunchState>(cdpOrigin, botName, LAUNCH_STATE_EXPRESSION);
    return out ? out.value : null;
}

/** What the page answered to pageClickComponent. */
export interface PageClick {
    sent: boolean;
    reason?: string;
}

/**
 * Click interface component `componentId` from inside the page and put it on the wire at once
 * (Client.clickComponent, then flushNow): the IF_BUTTON packet goes straight down the page's game
 * socket, so it lands with our gateway down or the page's gateway socket closed. Null when there is
 * no tab for the bot.
 */
export async function pageClickComponent(cdpOrigin: string, botName: string, componentId: number): Promise<PageClick | null> {
    const expression = `(() => {
    const c = window.gameClient;
    if (!c || typeof c.clickComponent !== 'function') return { sent: false, reason: 'no game client on the page' };
    if (!c.ingame) return { sent: false, reason: 'not in game' };
    if (!c.clickComponent(${Number(componentId)})) return { sent: false, reason: 'the client refused the click' };
    if (typeof c.flushNow === 'function') c.flushNow();
    return { sent: true };
})()`;
    const out = await evaluateInTab<PageClick>(cdpOrigin, botName, expression);
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

// ------------------------------------------------------------------ the windows on the recorded display
//
// Every client tab on one Chrome is a window on the host's one X display, and the on-VM recording
// grabs that display whole (RUN-HOST.md step 5), so the recording shows whichever window is on top.
// The display side (which window is in front, the live frame) is lib/display.ts.

/**
 * A page target as a log may record it: `bot=<name>` for a client page, else the origin and path.
 * Never the query string, which can carry a one-time login token.
 */
export function pageLabel(t: Pick<CdpTarget, 'url'>): string {
    try {
        const u = new URL(t.url);
        const bot = u.searchParams.get('bot');
        if (bot) return `bot=${bot}`;
        return u.origin === 'null' ? `${u.protocol}${u.host ? `//${u.host}` : ''}${u.pathname}` : `${u.origin}${u.pathname}`;
    } catch {
        return '(unparsed url)';
    }
}

/** Chrome's own UI drawn as WebUI pages (the omnibox popup): listed as pages, but no window of their own. */
const BROWSER_UI = /^chrome:\/\/[^/]*\.top-chrome\//;

async function listPages(base: string): Promise<CdpTarget[]> {
    return ((await (await fetch(`${base}/json/list`)).json()) as CdpTarget[]).filter(t => t.type === 'page' && !BROWSER_UI.test(t.url));
}

/** A command on the browser target (the Browser domain lives there, not on a page). */
async function browserCommand(base: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const v = (await (await fetch(`${base}/json/version`)).json()) as { webSocketDebuggerUrl?: string };
    if (!v.webSocketDebuggerUrl) throw new Error('CDP /json/version: no browser websocket');
    return cdpCommand(v.webSocketDebuggerUrl, method, params);
}

export type WindowState = 'normal' | 'minimized' | 'maximized' | 'fullscreen';

async function windowOf(base: string, targetId: string): Promise<{ windowId: number; state: WindowState }> {
    const r = (await browserCommand(base, 'Browser.getWindowForTarget', { targetId })) as { windowId: number; bounds?: { windowState?: WindowState } };
    return { windowId: r.windowId, state: r.bounds?.windowState ?? 'normal' };
}

async function setWindowState(base: string, windowId: number, windowState: WindowState): Promise<void> {
    await browserCommand(base, 'Browser.setWindowBounds', { windowId, bounds: { windowState } });
}

/** Maximise a target's window; a minimised one goes through normal first. Returns the state it was in. */
async function maximize(base: string, targetId: string): Promise<WindowState> {
    const w = await windowOf(base, targetId);
    if (w.state === 'minimized') await setWindowState(base, w.windowId, 'normal');
    if (w.state !== 'maximized') await setWindowState(base, w.windowId, 'maximized');
    return w.state;
}

export interface TabStage {
    /** `present`: the bot already had its window; `opened`: a new one was opened on `url`. */
    how: 'present' | 'opened';
    /** The window's state before it was maximised. */
    was: WindowState;
}

/**
 * Put this bot's client window on the display, maximised, without logging in: `url` is the bare
 * client page (`bot=<name>`, no token), which waits on the title screen. A later login re-navigates
 * this same window (reloadOrOpenTab). Opening the next account's window before the last one closes
 * is what keeps Chrome up: it quits with its last window.
 */
export async function stageBotTab(cdpOrigin: string, botName: string, url: string, waitMs = 10_000): Promise<TabStage> {
    const base = cdpOrigin.replace(/\/+$/, '');
    let [tab] = botTabs(await listPages(base), botName);
    const how = tab ? 'present' : 'opened';
    if (!tab) {
        const res = await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
        if (!res.ok) throw new Error(`CDP /json/new: HTTP ${res.status}`);
        const until = Date.now() + waitMs;
        while (!(tab = botTabs(await listPages(base), botName)[0]) && Date.now() < until) await Bun.sleep(100);
        if (!tab) throw new Error(`${botName}'s window did not appear within ${waitMs} ms`);
    }
    return { how, was: await maximize(base, tab.id) };
}

export interface TabClose {
    /** This bot's tabs closed. */
    closed: number;
    /** The pages left afterwards, by pageLabel. */
    left: string[];
}

/**
 * Close this bot's tabs once the account is out of the world. Call it only after a confirmed
 * logout: a closed tab is a dropped client, which the server keeps in the world. It refuses to
 * close Chrome's last window, because Chrome quits with it: stage the next window first.
 */
export async function closeBotTabs(cdpOrigin: string, botName: string, waitMs = 5_000): Promise<TabClose> {
    const base = cdpOrigin.replace(/\/+$/, '');
    const pages = await listPages(base);
    const mine = botTabs(pages, botName);
    if (mine.length > 0 && mine.length === pages.length) throw new Error(`${botName}'s window is Chrome's last, and Chrome quits with its last window: stage the next one first`);
    for (const t of mine) {
        const res = await fetch(`${base}/json/close/${t.id}`);
        if (!res.ok) throw new Error(`CDP /json/close: HTTP ${res.status}`);
    }
    // /json/close answers before the target is gone (the twin still listed it right after): wait for it.
    const ids = new Set(mine.map(t => t.id));
    const until = Date.now() + waitMs;
    let left = await listPages(base);
    while (left.some(t => ids.has(t.id)) && Date.now() < until) {
        await Bun.sleep(100);
        left = await listPages(base);
    }
    if (left.some(t => ids.has(t.id))) throw new Error(`${botName}'s window was still open ${waitMs} ms after it was closed`);
    return { closed: mine.length, left: left.map(pageLabel) };
}

/** The separator between an account's mark and the page's own title (see frontTab). */
export const TITLE_MARK_SEPARATOR = ' - ';

/** Prefix the page's title with `mark` once, and report the title, focus, visibility and viewport. */
export function markTitleExpression(mark: string): string {
    return `(() => {
    const m = ${JSON.stringify(mark + TITLE_MARK_SEPARATOR)};
    if (!document.title.startsWith(m)) document.title = m + document.title;
    return { title: document.title, focused: document.hasFocus(), visibility: document.visibilityState,
        viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio } };
})()`;
}

export interface TabFront {
    /** The page's title after marking: the window's name on the display. */
    title: string;
    /** document.hasFocus(): true only while the tab's window is the active one. */
    focused: boolean;
    visibility: string;
    viewport: { width: number; height: number; dpr: number };
    windowState: WindowState;
    /** Every other page on this Chrome, by pageLabel: the windows that could cover this one. */
    others: string[];
}

/**
 * Bring this bot's tab to the front (Page.bringToFront) and prefix its title with `mark`. Every
 * client page is titled "2004Scape Bot Client", so the mark is what tells this tab's window apart
 * on the display (lib/display.ts frontWindows). Null when the bot has no tab.
 */
export async function frontTab(cdpOrigin: string, botName: string, mark: string): Promise<TabFront | null> {
    const base = cdpOrigin.replace(/\/+$/, '');
    const pages = await listPages(base);
    const [tab] = botTabs(pages, botName);
    if (!tab?.webSocketDebuggerUrl) return null;
    await cdpCommand(tab.webSocketDebuggerUrl, 'Page.bringToFront', {});
    const out = (await cdpCommand(tab.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: markTitleExpression(mark), returnByValue: true })) as {
        result?: { value?: Omit<TabFront, 'others' | 'windowState'> };
    };
    const v = out.result?.value;
    if (!v) throw new Error('the page did not answer the title mark');
    return { ...v, windowState: (await windowOf(base, tab.id)).state, others: pages.filter(p => p.id !== tab.id).map(pageLabel) };
}

/** A PNG of this bot's page as Chrome renders it (Page.captureScreenshot); null without a tab. */
export async function screenshotTab(cdpOrigin: string, botName: string): Promise<Buffer | null> {
    const base = cdpOrigin.replace(/\/+$/, '');
    const [tab] = botTabs(await listPages(base), botName);
    if (!tab?.webSocketDebuggerUrl) return null;
    const out = (await cdpCommand(tab.webSocketDebuggerUrl, 'Page.captureScreenshot', { format: 'png' }, 10_000)) as { data?: string };
    if (!out.data) throw new Error('Page.captureScreenshot returned no data');
    return Buffer.from(out.data, 'base64');
}

/**
 * Raise this bot's tab window over every other: minimise it, then restore and maximise it. A
 * window manager that refuses Page.bringToFront's activation (focus-stealing prevention) still maps
 * and raises a window the application restores.
 */
export async function raiseTabWindow(cdpOrigin: string, botName: string): Promise<void> {
    const base = cdpOrigin.replace(/\/+$/, '');
    const [tab] = botTabs(await listPages(base), botName);
    if (!tab?.webSocketDebuggerUrl) throw new Error(`${botName} has no tab`);
    const w = await windowOf(base, tab.id);
    await setWindowState(base, w.windowId, 'minimized');
    await setWindowState(base, w.windowId, 'normal');
    await setWindowState(base, w.windowId, 'maximized');
    await cdpCommand(tab.webSocketDebuggerUrl, 'Page.bringToFront', {});
}
