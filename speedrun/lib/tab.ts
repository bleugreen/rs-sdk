// The scored run's browser tab, driven over the Chrome DevTools protocol so a
// reconnect reloads the one tab instead of opening another each time.
//
// Launch the run machine's Chrome with --remote-debugging-port=9222 (beside the
// anti-throttling flags in STEP-MANIFEST.md's run-machine setup) and set
// CDP_URL=http://127.0.0.1:9222 in the bot.env (or SPEEDRUN_CDP_URL). The page
// auto-logs in once per load (Client.ts titleScreenDraw), and after a failed
// reconnect it sits on the title screen, so a fresh navigation is the only
// login path the SDK has. Without CDP the session falls back to opening the
// URL, which opens a new tab.

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
 * Navigate this bot's tab to `url` (a full reload with the credentials, which
 * triggers the page's one auto-login), closing any duplicate tab that would
 * fight it for the account; open one if there is none.
 */
export async function reloadOrOpenTab(cdpOrigin: string, url: string, botName: string): Promise<'reloaded' | 'opened'> {
    const base = cdpOrigin.replace(/\/+$/, '');
    const list = (await (await fetch(`${base}/json/list`)).json()) as CdpTarget[];
    const [tab, ...extra] = botTabs(list, botName);
    for (const t of extra) await fetch(`${base}/json/close/${t.id}`).catch(() => {});
    if (tab?.webSocketDebuggerUrl) {
        await cdpCommand(tab.webSocketDebuggerUrl, 'Page.navigate', { url });
        return 'reloaded';
    }
    const res = await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    if (!res.ok) throw new Error(`CDP /json/new: HTTP ${res.status}`);
    return 'opened';
}
