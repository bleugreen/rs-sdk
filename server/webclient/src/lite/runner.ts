// Headless bot runner: a LiteClient session wired to the SDK gateway.
//
// This is BotOverlay minus the browser - same StateCollector, ActionExecutor
// and BotActionQueue, but the gateway socket is a plain Bun WebSocket instead
// of the in-page GatewayConnection (which needs window.location). Controlling
// SDKs (sdk/runner.ts scripts, sdk/cli.ts, MCP execute_code) pair with it
// exactly as they would with a browser tab.
//
// Unlike BotOverlay, which runs queued actions from the draw loop, an action runs
// the moment the gateway delivers it and its packets are flushed before anything
// else happens, state collection included. The engine reads input once per tick,
// so every millisecond between the frame a bot reacts to and its packet on the
// wire comes out of the gap the reaction has to land in.
//
//   bun src/lite/runner.ts <botname>          # reads bots/<botname>/bot.env
//
// Run from server/webclient so the '#/*' import map resolves.

import { fileURLToPath } from 'node:url';

import { OutdatedClientError } from './net/GameConnection.js';
import { startSession, type LiteSession } from './session.js';
import { type ActionResult } from '#/bot/ActionExecutor.js';
import { BotActionQueue, type QueuedBotAction } from '#/bot/ActionQueue.js';
import type { BotAction, BotWorldState } from '#/bot/types.js';
import type { LiteClient } from './LiteClient.js';
import {
    FAST_KBD_RUNTIME_MODE,
    findFastKbdAttackTarget,
    findFastKbdPrayerOffIndices,
    findFastKbdPrayerOnIndices,
    isFastKbdPolicyState,
} from './fast-kbd.js';

/** Paces `wait` actions and queue expiry, in browser draw-loop frames like BotOverlay.tick(). */
const TICK_MS = 20;
const RECONNECT_MS = 3000;

export class LiteGatewayRunner {
    private client: LiteClient;
    private actionQueue = new BotActionQueue();
    private waitTicks = 0;
    private serverTick = 0;
    private lastFastKbdAttackTick = -1;
    private fastKbdPolicyEligible = false;
    private fastKbdWasVisible = false;
    private fastKbdRawWasVisible = false;
    private fastKbdLastState: BotWorldState | null = null;
    private lastFastKbdPrayerOnTick = -1;
    private lastFastKbdPrayerOnIndices: number[] = [];
    private fastKbdPrayerOffPending = false;
    private lastFastKbdPrayerOffDispatchTick = -1;

    private ws: WebSocket | null = null;
    private wsConnected = false;
    private preventReconnect = false;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private resolvingGateway = false;
    private tickTimer: ReturnType<typeof setInterval> | null = null;

    constructor(
        private session: LiteSession,
        private gatewayUrl: string,
        private fastKbdAttackEnabled = false,
    ) {
        this.client = session.client;
        // State collection and action execution go through the client, which
        // activates this bot's interface table first - see LiteClient.activate.
        this.client.setOnGameTickCallback(ticks => {
            this.serverTick += ticks;
            // Reuse the previous authoritative one-item policy snapshot and
            // probe the raw NPC table this tick's NPC_INFO just filled before
            // full state collection. This puts KBD op2 ahead of reachability,
            // nearby player/loc/item scans, and UI serialization.
            if (this.fastKbdAttackEnabled) {
                const targetIndex = this.fastKbdPolicyEligible
                    ? this.client.findNpcIndexByExactName('King black dragon')
                    : undefined;
                if (targetIndex !== undefined
                    && this.lastFastKbdAttackTick !== this.serverTick) {
                    if (!this.fastKbdRawWasVisible && this.fastKbdLastState) {
                        this.dispatchFastKbdPrayerOn(this.fastKbdLastState);
                    }
                    this.dispatchFastKbdAttack(targetIndex);
                    this.flushGame();
                }
                this.fastKbdRawWasVisible = targetIndex !== undefined;
            }
            this.sendState();
        });

        this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    }

    connect(): void {
        if (this.ws || this.resolvingGateway) return;
        // Re-checked on every (re)connect, so the direct port is picked up again
        // after a server restart and abandoned if it ever stops answering.
        this.resolvingGateway = true;
        void preferDirectGateway(this.gatewayUrl).then(url => {
            this.resolvingGateway = false;
            if (!this.ws && !this.preventReconnect) this.open(url);
        });
    }

    private open(url: string): void {
        console.log(`[lite-runner] Connecting to gateway ${url}`);
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            this.wsConnected = true;
            const { username, password } = this.client.getCredentials();
            console.log(`[lite-runner] Gateway connected, registering as '${username}'`);
            this.send({
                type: 'connected',
                username,
                password,
                clientId: `${username}-lite-${Date.now()}`,
                maxMessageLength: this.client.getMaxMessageLength()
            });
            // Drop queued work from the previous connection (BotOverlay.onConnected)
            const active = this.actionQueue.active;
            this.actionQueue.beginGeneration();
            if (active && this.waitTicks > 0) {
                this.actionQueue.complete(active);
            }
            this.waitTicks = 0;
        };

        this.ws.onmessage = event => {
            try {
                this.handleMessage(JSON.parse(String(event.data)));
            } catch (e) {
                console.error('[lite-runner] Bad gateway message:', e);
            }
        };

        this.ws.onclose = () => {
            this.wsConnected = false;
            this.ws = null;
            if (!this.preventReconnect) {
                console.warn(`[lite-runner] Gateway closed, reconnecting in ${RECONNECT_MS}ms`);
                if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
                this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_MS);
            }
        };

        this.ws.onerror = () => {
            // onclose follows
        };
    }

    stop(): void {
        this.preventReconnect = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.tickTimer) clearInterval(this.tickTimer);
        this.ws?.close();
        this.session.stop();
    }

    private send(msg: unknown): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    private handleMessage(msg: any): void {
        if (msg.type === 'action') {
            this.onAction(msg.action, msg.actionId || null, msg.actionTimeoutMs);
        } else if (msg.type === 'screenshot_request') {
            // Headless: no canvas. Answer so the requester doesn't hang on a timeout.
            this.send({ type: 'screenshot_response', dataUrl: '', screenshotId: msg.screenshotId });
        } else if (msg.type === 'save_and_disconnect') {
            console.log(`[lite-runner] save_and_disconnect: ${msg.reason || 'session replaced'}`);
            // Closing the game socket triggers the engine-side save, same as browser logout.
            this.stop();
        }
    }

    private onAction(action: BotAction, actionId: string | null, actionTimeoutMs?: number): void {
        const queueTtlMs = actionTimeoutMs === undefined ? undefined : Math.max(0, actionTimeoutMs - 1_000);
        const queued = this.actionQueue.enqueue({ action, actionId }, queueTtlMs);
        if (!queued) {
            const result: ActionResult = {
                success: false,
                message: 'Action queue is full',
                phase: 'validation',
                reason: 'busy'
            };
            if (actionId) this.sendActionResult(actionId, result);
            return;
        }
        this.startQueued();
    }

    private tick(): void {
        for (const expired of this.actionQueue.expirePending()) {
            const result: ActionResult = {
                success: false,
                message: `Action expired in queue: ${expired.action.type}`,
                phase: 'validation',
                reason: 'queue_expired'
            };
            if (expired.actionId) this.sendActionResult(expired.actionId, result);
        }

        const activeExpired = this.actionQueue.expireActive();
        if (activeExpired) {
            // `expireActive` releases the queue first, so bypass finishAction's
            // identity guard and report a bounded failure to the controller.
            if (this.actionQueue.isCurrentGeneration(activeExpired) && activeExpired.actionId) {
                this.sendActionResult(activeExpired.actionId, {
                    success: false,
                    message: `Action expired while active: ${activeExpired.action.type}`,
                    phase: 'completion',
                    reason: 'queue_expired'
                });
            }
            this.sendState();
        }

        if (this.waitTicks > 0) {
            this.waitTicks--;
            if (this.waitTicks > 0) return;
            const active = this.actionQueue.active;
            if (active) {
                this.finishAction(active, { success: true, message: 'Wait complete', phase: 'completion' });
            }
        }

        this.startQueued();
    }

    /**
     * Run queued actions until one is still in flight (an async action or a
     * `wait`). Called when an action arrives, when one finishes, and on every
     * runner tick. The queue keeps it to one action at a time; several arriving
     * together run back to back, and the engine decodes 5 of their packets per
     * tick and carries the rest to the next (NetworkPlayer.decodeIn).
     */
    private startQueued(): void {
        while (this.waitTicks === 0 && !this.actionQueue.active) {
            const queued = this.actionQueue.startNext();
            if (!queued) return;

            const action = queued.action;
            let resultOrPromise: ReturnType<LiteClient['executeBotAction']>;
            try {
                resultOrPromise = this.client.executeBotAction(action);
            } catch (e) {
                this.flushGame();
                this.finishAction(queued, executionError(e));
                continue;
            }
            this.flushGame();

            if (resultOrPromise instanceof Promise) {
                resultOrPromise
                    .catch(executionError)
                    .then(result => {
                        this.flushGame();
                        this.finishAction(queued, result);
                        this.startQueued();
                    });
                return;
            }

            if (action.type === 'wait' && resultOrPromise.success) {
                this.waitTicks = (action as any).ticks || 1;
                return;
            }

            this.finishAction(queued, resultOrPromise);
        }
    }

    /**
     * Put queued game packets on the wire now, ahead of state collection (a few
     * ms at p50, tens at p90) and the gateway publish. A write failure leaves
     * the bytes queued; the session loop's own flush rethrows it and ends the
     * session with a reason, so it is not reported twice here.
     */
    private flushGame(): void {
        try {
            this.client.flush();
        } catch {
            // see above
        }
    }

    private finishAction(entry: QueuedBotAction, result: ActionResult): void {
        if (this.actionQueue.active !== entry) return;

        const publishResult = this.actionQueue.isCurrentGeneration(entry);
        this.actionQueue.complete(entry);
        if (!publishResult) return;

        if (entry.actionId) {
            this.sendActionResult(entry.actionId, result);
        }
        this.sendState();
    }

    private sendActionResult(actionId: string, result: ActionResult): void {
        this.send({ type: 'actionResult', actionId, result });
    }

    private dispatchFastKbdAttack(targetIndex: number): void {
        const result = this.client.interactNpc(targetIndex, 2);
        if (result.success) this.lastFastKbdAttackTick = this.serverTick;
    }

    private dispatchFastKbdPrayerOn(state: BotWorldState): void {
        const emitted: number[] = [];
        for (const prayerIndex of findFastKbdPrayerOnIndices(state)) {
            const result = this.client.executeBotAction({
                type: 'togglePrayer',
                prayerIndex,
                reason: 'runner-fast KBD publication',
            });
            if (!(result instanceof Promise) && result.success) emitted.push(prayerIndex);
        }
        if (emitted.length > 0) {
            this.lastFastKbdPrayerOnTick = this.serverTick;
            this.lastFastKbdPrayerOnIndices = emitted;
        }
    }

    private sendState(): void {
        if (!this.wsConnected) return;
        const state = this.client.collectBotState(this.serverTick);
        if (!state) return;
        if (this.fastKbdAttackEnabled) {
            const targetIndex = findFastKbdAttackTarget(state);
            if (targetIndex !== undefined && this.lastFastKbdAttackTick !== this.serverTick) {
                // This is intentionally in-process and before state publication:
                // the ordinary SDK path must traverse the gateway twice before
                // the same packet reaches this client.
                this.dispatchFastKbdPrayerOn(state);
                this.dispatchFastKbdAttack(targetIndex);
            }
            if (this.lastFastKbdAttackTick === this.serverTick) {
                state.fastKbdAttackTick = this.serverTick;
            }
            if (this.lastFastKbdPrayerOnTick === this.serverTick) {
                state.fastKbdPrayerOn = {
                    tick: this.serverTick,
                    prayerIndices: this.lastFastKbdPrayerOnIndices,
                };
            }

            const fastKbdVisible = targetIndex !== undefined;
            const policyEligible = isFastKbdPolicyState(state);
            if (this.fastKbdWasVisible && !fastKbdVisible && policyEligible) {
                this.fastKbdPrayerOffPending = true;
            }
            if (fastKbdVisible || !policyEligible) {
                this.fastKbdPrayerOffPending = false;
            }
            const prayerOffIndices = this.lastFastKbdPrayerOffDispatchTick === this.serverTick
                ? []
                : findFastKbdPrayerOffIndices(state, this.fastKbdPrayerOffPending);
            const emittedPrayerOffIndices: number[] = [];
            for (const prayerIndex of prayerOffIndices) {
                const result = this.client.executeBotAction({
                    type: 'togglePrayer',
                    prayerIndex,
                    reason: 'runner-fast KBD removal',
                });
                if (!(result instanceof Promise) && result.success) {
                    emittedPrayerOffIndices.push(prayerIndex);
                }
            }
            if (emittedPrayerOffIndices.length > 0) {
                this.lastFastKbdPrayerOffDispatchTick = this.serverTick;
                state.fastKbdPrayerOff = {
                    tick: this.serverTick,
                    prayerIndices: emittedPrayerOffIndices,
                };
            }
            if (this.fastKbdPrayerOffPending
                && !state.prayers.activePrayers.some(active => active)) {
                this.fastKbdPrayerOffPending = false;
            }
            this.flushGame();
            this.fastKbdPolicyEligible = policyEligible;
            this.fastKbdWasVisible = fastKbdVisible;
            this.fastKbdRawWasVisible = fastKbdVisible;
            this.fastKbdLastState = state;
        }
        this.send({ type: 'state', state });
    }
}

function executionError(e: unknown): ActionResult {
    return { success: false, message: `Error: ${e}`, phase: 'completion', reason: 'execution_error' };
}

// ------------------------------------------------------------------ CLI entry

function deriveGatewayUrl(server: string): string {
    if (!server) return 'ws://localhost:7780';
    if (server.startsWith('ws://') || server.startsWith('wss://')) return server;
    if (server.startsWith('localhost') || server.startsWith('127.')) {
        return `ws://${server.includes(':') ? server : server + ':7780'}`;
    }
    return `wss://${server}/gateway`;
}

// Same table as sdk/index.ts preferDirectGateway: publish straight to the
// gateway's own TLS port when it answers (compressed frames, no relay through
// the game server's tick thread), else keep the relayed /gateway URL.
const DIRECT_GATEWAYS: Record<string, string> = {
    'wss://rs-sdk-demo.fly.dev/gateway': 'wss://rs-sdk-demo.fly.dev:7443',
};
async function preferDirectGateway(url: string): Promise<string> {
    const direct = DIRECT_GATEWAYS[url];
    if (!direct || process.env.GATEWAY_DIRECT === 'false') return url;
    try {
        const res = await fetch(direct.replace(/^ws/, 'http') + '/', { signal: AbortSignal.timeout(3000) });
        return res.ok ? direct : url;
    } catch {
        return url;
    }
}

if (import.meta.main) {
    await main();
}

async function main(): Promise<void> {
    const botName = process.argv[2];
    if (!botName) {
        console.error('Usage: bun src/lite/runner.ts <botname>');
        process.exit(1);
    }

    const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
    // LITE_BOT_ENV lets a launcher keep credentials outside the checkout (speedrun/helpers/standalone.ts).
    const envPath = process.env.LITE_BOT_ENV || `${repoRoot}bots/${botName}/bot.env`;
    const env = Object.fromEntries(
        (await Bun.file(envPath).text())
            .split('\n')
            .filter(l => l.includes('=') && !l.startsWith('#'))
            .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
    );

    const host = env.SERVER || 'localhost';
    // No config channel from the server (see LiteClient's maxMessageLength note), so
    // mirror the server's NODE_PROFANITY_FILTER by hand: PROFANITY_FILTER=false in
    // bot.env or the process env disables local chat censoring.
    const profanityRaw = (env.PROFANITY_FILTER ?? process.env.PROFANITY_FILTER ?? '').toLowerCase();
    const session = await startSession({
        host,
        username: env.BOT_USERNAME!,
        password: env.PASSWORD!,
        profanityFilter: ['false', '0', 'off', 'no'].includes(profanityRaw) ? false : undefined,
        quiet: true
    }).catch((err: unknown) => {
        // A revision mismatch won't fix itself: exit 3 so a supervisor can stop restarting us
        if (err instanceof OutdatedClientError) {
            console.error(`[lite-runner] ${err.message}`);
            process.exit(3);
        }
        throw err;
    });

    console.log(`[lite-runner] '${env.BOT_USERNAME}' logged into ${host}`);

    // SERVER doubles as game-server origin and gateway address, which breaks for
    // local hosts with an explicit web port (localhost:8888 is the engine, not the
    // gateway). GATEWAY_URL (bot.env or process env) overrides the derivation.
    const gatewayUrl = env.GATEWAY_URL || process.env.GATEWAY_URL || deriveGatewayUrl(host);
    const runtimeMode = await Bun.file(`${repoRoot}bots/logs/fleet-runtime.mode`).text()
        .then(value => value.trim())
        .catch(() => '');
    const fastKbdAttackEnabled = runtimeMode === FAST_KBD_RUNTIME_MODE;
    if (fastKbdAttackEnabled) {
        console.log('[lite-runner] in-process KBD op2 enabled');
    }
    const runner = new LiteGatewayRunner(session, gatewayUrl, fastKbdAttackEnabled);
    runner.connect();

    process.on('SIGINT', () => {
        console.log('\n[lite-runner] SIGINT, shutting down');
        runner.stop();
        process.exit(0);
    });

    // One bot per process, so re-login is the supervisor's job (systemd, a shell
    // loop, whatever launched us). Exit non-zero on anything we did not ask for, so
    // it can tell "finished" from "died".
    const end = await session.stopped;
    console.log(`[lite-runner] Game session ended (${end.reason})`, end.error ?? '');
    runner.stop();
    process.exit(end.reason === 'stopped' ? 0 : 1);
}
