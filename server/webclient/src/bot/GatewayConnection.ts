// GatewayConnection.ts - WebSocket connection to SDK gateway
// Handles connection, reconnection, message sending/receiving

import type { BotAction, BotWorldState } from './types.js';
import { gatewayUrl } from '#/util/Endpoints.js';

export interface GatewayMessageHandler {
    onAction(action: BotAction, actionId: string | null, actionTimeoutMs?: number): void;
    onScreenshotRequest(screenshotId?: string): void;
    onConnected(): void;
    onDisconnected(): void;
    /** Called when gateway requests graceful disconnect (new session taking over) */
    onSaveAndDisconnect(reason: string): void;
}

// Extract bot credentials from URL query params
function getUrlParams(): URLSearchParams | null {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search);
}

/** Credentials redeemed from a ?token= login; held in memory, never written to the URL. */
let tokenCredentials: { username: string; password: string } | null = null;

export function getBotUsername(): string {
    if (tokenCredentials) return tokenCredentials.username;
    const params = getUrlParams();
    return params?.get('bot') || 'default';
}

export function getBotPassword(): string | null {
    if (tokenCredentials) return tokenCredentials.password;
    const params = getUrlParams();
    return params?.get('password') || null;
}

/**
 * The launch id the page was opened with (?launch=, which the speedrun controller puts on every
 * tab it navigates), or null. It stays in the URL when the token leaves it, and the overlay echoes
 * it in every published state, so a controller can tell this page's states from a gateway's cached
 * state or another client's.
 */
export function getLaunchId(): string | null {
    return getUrlParams()?.get('launch') || null;
}

export type LoginTokenWindow = Pick<Window, 'location' | 'history'> & { fetch: (input: string, init: RequestInit) => Promise<Response> };

/**
 * Exchange a one-time ?token= (minted by server/webclient/proxy.ts, see
 * login-token.ts) for this account's credentials. The token leaves the address
 * bar before the request goes out, so neither it nor the password is left in
 * the URL, the tab list or the history; a manual reload therefore does not log
 * in again. Resolves true once getBotPassword() has the password.
 */
export async function redeemLoginToken(win: LoginTokenWindow = window): Promise<boolean> {
    const url = new URL(win.location.href);
    const token = url.searchParams.get('token');
    if (!token) return false;
    url.searchParams.delete('token');
    win.history.replaceState(win.history.state, '', url.toString());
    const res = await win.fetch(new URL('/bot/login', url).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, bot: url.searchParams.get('bot') ?? '' }),
        cache: 'no-store'
    });
    if (!res.ok) {
        console.error(`[GatewayConnection] login token refused: HTTP ${res.status} ${await res.text()}`);
        return false;
    }
    const body = (await res.json()) as { bot?: unknown; password?: unknown };
    if (typeof body.bot !== 'string' || typeof body.password !== 'string') return false;
    tokenCredentials = { username: body.bot, password: body.password };
    return true;
}

export class GatewayConnection {
    private ws: WebSocket | null = null;
    private reconnectTimer: number | null = null;
    private connected: boolean = false;
    private handler: GatewayMessageHandler;
    /** Returns the credentials the game client actually logged in with (may be empty pre-login) */
    private credentialSource: (() => { username: string; password: string }) | null;
    /** Returns the server-configured chat cap so the gateway can relay it to controlling SDKs */
    private configSource: (() => { maxMessageLength: number }) | null;
    /** When true, prevents auto-reconnect (used during graceful disconnect) */
    private preventReconnect: boolean = false;

    constructor(
        handler: GatewayMessageHandler,
        credentialSource?: () => { username: string; password: string },
        configSource?: () => { maxMessageLength: number }
    ) {
        this.handler = handler;
        this.credentialSource = credentialSource ?? null;
        this.configSource = configSource ?? null;
    }

    /**
     * Resolve credentials fresh on every connect attempt.
     * Prefer the game client's actual login credentials - URL params can be stale
     * (e.g. user typed different credentials into the login screen than what the
     * page was loaded with), which previously caused an infinite auth-fail
     * reconnect loop using the page-load values.
     */
    private resolveCredentials(): { username: string; password: string } {
        const creds = this.credentialSource?.();
        if (creds && creds.username && creds.password) {
            return creds;
        }
        return { username: getBotUsername(), password: getBotPassword() || '' };
    }

    connect(): void {
        if (this.ws) return;

        const url = gatewayUrl();

        try {
            this.ws = new WebSocket(url);

            this.ws.onopen = () => {
                this.connected = true;
                const { username, password } = this.resolveCredentials();
                console.log(`[GatewayConnection] Connected, registering as '${username}'`);

                // Register as bot with gateway. Relay the server-configured chat cap so
                // controlling SDKs learn it (they only talk to the gateway, not the engine).
                this.send({
                    type: 'connected',
                    username,
                    password,
                    clientId: `${username}-${Date.now()}`,
                    maxMessageLength: this.configSource?.().maxMessageLength
                });

                this.handler.onConnected();
            };

            this.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    this.handleMessage(msg);
                } catch (e) {
                    console.error('[GatewayConnection] Failed to parse message:', e);
                }
            };

            this.ws.onclose = () => {
                console.warn(`[LOGOUT DEBUG] GatewayConnection WebSocket closed - preventReconnect=${this.preventReconnect}`);
                this.connected = false;
                this.ws = null;
                this.handler.onDisconnected();

                // Only reconnect if not explicitly told to disconnect
                if (!this.preventReconnect) {
                    console.warn('[LOGOUT DEBUG] GatewayConnection scheduling auto-reconnect in 3s');
                    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = window.setTimeout(() => this.connect(), 3000);
                } else {
                    console.log('[GatewayConnection] Auto-reconnect disabled (graceful disconnect)');
                }
            };

            this.ws.onerror = () => {
                // Will trigger onclose
            };
        } catch (e) {
            console.error('[GatewayConnection] Failed to connect:', e);
        }
    }

    disconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
    }

    isConnected(): boolean {
        return this.connected;
    }

    send(msg: any): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    sendState(state: BotWorldState): void {
        if (!this.connected) return;
        this.send({
            type: 'state',
            state
        });
    }

    sendActionResult(actionId: string, result: { success: boolean; message: string; data?: any }): void {
        this.send({
            type: 'actionResult',
            actionId,
            result
        });
    }

    sendScreenshot(dataUrl: string, screenshotId?: string): void {
        this.send({
            type: 'screenshot_response',
            dataUrl,
            screenshotId
        });
    }

    private handleMessage(msg: any): void {
        if (msg.type === 'action') {
            console.log(`[GatewayConnection] Received action: ${msg.action?.type} (${msg.actionId})`);
            this.handler.onAction(msg.action, msg.actionId || null, msg.actionTimeoutMs);
        } else if (msg.type === 'status') {
            console.log(`[GatewayConnection] Gateway status: ${msg.status}`);
        } else if (msg.type === 'screenshot_request') {
            this.handler.onScreenshotRequest(msg.screenshotId);
        } else if (msg.type === 'save_and_disconnect') {
            console.warn(`[LOGOUT DEBUG] GatewayConnection received save_and_disconnect: ${msg.reason}`);
            console.log(`[GatewayConnection] Received save_and_disconnect: ${msg.reason}`);
            // Set flag to prevent auto-reconnect before calling handler
            this.preventReconnect = true;
            this.handler.onSaveAndDisconnect(msg.reason || 'Session being replaced');
        }
    }
}
