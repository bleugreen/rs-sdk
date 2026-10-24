// BotOverlay.ts - Main bot overlay controller
// Composes state collection, action execution, gateway connection, and UI

import type { Client } from '#/client/Client.js';
import type { BotState, BotAction, BotWorldState } from './types.js';
import { BotStateCollector } from './StateCollector.js';
import { ActionExecutor, formatAction } from './ActionExecutor.js';
import { formatBotState } from './formatters.js';
import { GatewayConnection, getLaunchId, type GatewayMessageHandler } from './GatewayConnection.js';
import { OverlayUI } from './OverlayUI.js';
import { BotActionQueue, type QueuedBotAction } from './ActionQueue.js';
import type { ActionResult } from './ActionExecutor.js';
import { ProgramHost } from './programs/host.js';

// Global instance reference (set when overlay is created)
let globalBotOverlay: BotOverlay | null = null;

export function getBotOverlay(): BotOverlay | null {
    return globalBotOverlay;
}

let taskChannel: MessageChannel | null = null;
const postedTasks: Array<() => void> = [];

/**
 * Run `fn` in a task of its own, behind the tasks already queued (typically the
 * rest of a burst's gateway messages). A MessageChannel rather than setTimeout,
 * which a background tab throttles to a second or more.
 */
function postTask(fn: () => void): void {
    if (typeof MessageChannel === 'undefined') {
        setTimeout(fn, 0);
        return;
    }
    if (!taskChannel) {
        taskChannel = new MessageChannel();
        taskChannel.port1.onmessage = () => postedTasks.shift()?.();
        // Bun and Node: an idle port must not hold a test process open.
        (taskChannel.port1 as { unref?: () => void }).unref?.();
    }
    postedTasks.push(fn);
    taskChannel.port2.postMessage(null);
}

export class BotOverlay implements GatewayMessageHandler {
    private client: Client;
    private collector: BotStateCollector;
    private executor: ActionExecutor;
    private gateway: GatewayConnection;
    private ui: OverlayUI;
    private programs: ProgramHost;

    // Action state
    private actionQueue = new BotActionQueue();
    private waitTicks: number = 0;

    // Server tick counter - advances by one per decoded PLAYER_INFO (one per server tick)
    private serverTick: number = 0;

    /** The page's ?launch= id, echoed in every published state (GatewayConnection getLaunchId). */
    private readonly launch: string | null = getLaunchId();

    /**
     * Most queued actions run in one pass, whether on arrival or in the game
     * loop. A burst a script releases behind a wait or an asynchronous action
     * (knife on logs, the menu button, a drop and a click in one tick) goes out
     * in one websocket frame; the cap only bounds a runaway queue's cost to a
     * single pass.
     */
    private static readonly MAX_ACTIONS_PER_PASS = 10;

    /** A flush is queued for the end of the current task (scheduleFlush). */
    private flushScheduled: boolean = false;
    /** A post-action state is queued in a task of its own (requestState). */
    private statePending: boolean = false;
    /** A drain is queued in a task of its own (postDrain). */
    private drainPosted: boolean = false;

    // Activity tracking for favicon
    private lastActionTime: number = 0;
    private activityCheckInterval: ReturnType<typeof setInterval> | null = null;

    constructor(client: Client) {
        this.client = client;
        this.collector = new BotStateCollector(client);
        this.executor = new ActionExecutor(client);
        this.gateway = new GatewayConnection(
            this,
            () => this.client.getCredentials(),
            () => ({ maxMessageLength: this.client.getMaxMessageLength() })
        );
        this.ui = new OverlayUI(client, {
            onPacketLogToggle: () => {}
        });

        // Wire scan provider so ActionExecutor can trigger on-demand scans
        this.executor.setScanProvider(this.collector);

        // In-page tick programs (bot/programs): they react in onGameTick and send
        // through the same executor; window.rsPrograms drives them from page scripts.
        this.programs = new ProgramHost(action => this.executor.execute(action), { search: window.location.search, loopCount: () => this.client.getClientCycle() });
        this.programs.expose(window as unknown as Record<string, unknown>);

        // Connect to gateway
        this.gateway.connect();

        // Publish state once per server tick, after the client has decoded all of it
        this.client.setOnGameTickCallback(this.onGameTick.bind(this));

        // Start activity check interval for favicon state
        this.activityCheckInterval = setInterval(() => this.checkActivity(), 500);

        // Set global reference
        globalBotOverlay = this;
    }

    // Check if we've had recent activity for favicon state
    private checkActivity(): void {
        const now = Date.now();
        const isActive = (now - this.lastActionTime) < 8000;

        if (typeof (window as any).setFaviconActive === 'function') {
            (window as any).setFaviconActive(isActive);
        }
    }

    /**
     * Called once the client has decoded a whole server tick (or several, if it
     * fell behind) - Client.setOnGameTickCallback. In-page tick programs hook
     * in here: their packets written now leave in this game-loop pass.
     */
    private onGameTick(ticks: number, arrivals: readonly number[]): void {
        this.serverTick += ticks;
        const connected = this.gateway.isConnected();
        if (!connected && !this.programs.active) return;
        const state = this.collectWorldState();
        if (!state) return;
        // The running program reacts to the state about to be published; what it sends
        // leaves in this game-loop pass, and the published state carries its status.
        this.programs.onTick(state, ticks, arrivals);
        if (connected) this.gateway.sendState(state);
    }

    // ============ GatewayMessageHandler Implementation ============

    onAction(action: BotAction, actionId: string | null, actionTimeoutMs?: number): void {
        console.log(`[BotOverlay] Received action: ${action.type} (${actionId})`);
        // Leave a small delivery margin so the SDK receives a deterministic
        // queue_expired result before its own action timeout rejects locally.
        const queueTtlMs = actionTimeoutMs === undefined
            ? undefined
            : Math.max(0, actionTimeoutMs - 1_000);
        const queued = this.actionQueue.enqueue({ action, actionId }, queueTtlMs);
        if (!queued) {
            const result: ActionResult = {
                success: false,
                message: 'Action queue is full',
                phase: 'validation',
                reason: 'busy'
            };
            if (actionId) this.gateway.sendActionResult(actionId, result);
            this.ui.logAction('failed', result.message);
            return;
        }
        this.lastActionTime = Date.now();
        // Reset idle timer - SDK actions count as activity
        this.client.idleTimer = performance.now();
        this.ui.logAction(action.type, formatAction(action));
        this.runArrived();
    }

    onScreenshotRequest(screenshotId?: string): void {
        this.captureAndSendScreenshot(screenshotId);
    }

    onConnected(): void {
        this.ui.logAction('connected', 'Connected to SDK gateway');

        // Drop queued work from the previous connection. An asynchronous action
        // already executing remains the active quiescence barrier until it
        // settles, so fresh actions can never overlap its game mutations.
        const active = this.actionQueue.active;
        if (this.actionQueue.active || this.actionQueue.pendingCount > 0) {
            console.log('[BotOverlay] Advancing action queue generation on connect');
        }
        this.actionQueue.beginGeneration();
        // Wait actions have no background promise and can be released safely.
        if (active && this.waitTicks > 0) {
            this.actionQueue.complete(active);
        }
        this.waitTicks = 0;
    }

    onDisconnected(): void {
        console.warn('[LOGOUT DEBUG] BotOverlay.onDisconnected() - SDK gateway connection lost');
        this.ui.logAction('disconnected', 'Disconnected from SDK gateway');
    }

    onSaveAndDisconnect(reason: string): void {
        console.warn(`[LOGOUT DEBUG] Gateway save_and_disconnect received - reason: ${reason}`);
        console.log(`[BotOverlay] Save and disconnect requested: ${reason}`);
        this.ui.logAction('disconnecting', `Save and disconnect: ${reason}`);

        // Trigger client logout - this will save to server via game protocol
        // The logout method handles stream close which triggers server-side save
        // GatewayConnection.preventReconnect is already set by the message handler
        const client = this.client as any;
        if (client && typeof client.logout === 'function') {
            console.log('[BotOverlay] Triggering client logout for graceful disconnect');
            client.logout().catch((e: any) => {
                console.error('[BotOverlay] Error during logout:', e);
            });
        } else {
            console.warn('[BotOverlay] No logout method available on client');
            // Fall back to just disconnecting gateway
            this.gateway.disconnect();
        }
    }

    // ============ Main Tick Loop ============

    /**
     * Called once per game cycle by Client.gameLoop, before it flushes outgoing
     * packets. Actions normally run when they arrive (runArrived); this is the
     * fallback drain that counts `wait` actions down, expires stale work, and
     * runs what was held while the client was off the game screen.
     */
    tick(): void {
        for (const expired of this.actionQueue.expirePending()) {
            const result: ActionResult = {
                success: false,
                message: `Action expired in queue: ${expired.action.type}`,
                phase: 'validation',
                reason: 'queue_expired'
            };
            if (expired.actionId) this.gateway.sendActionResult(expired.actionId, result);
            this.ui.logAction('failed', result.message);
        }

        const activeExpired = this.actionQueue.expireActive();
        if (activeExpired) {
            // `expireActive` releases the queue first, so bypass finishAction's
            // identity guard and report a bounded failure to the controller.
            const result: ActionResult = {
                success: false,
                message: `Action expired while active: ${activeExpired.action.type}`,
                phase: 'completion',
                reason: 'queue_expired'
            };
            if (this.actionQueue.isCurrentGeneration(activeExpired) && activeExpired.actionId) {
                this.gateway.sendActionResult(activeExpired.actionId, result);
            }
            this.ui.logAction('failed', result.message);
            this.requestState();
        }

        // Handle wait ticks
        if (this.waitTicks > 0) {
            this.waitTicks--;
            if (this.waitTicks > 0) return;
            const active = this.actionQueue.active;
            if (active) {
                this.finishAction(active, { success: true, message: 'Wait complete', phase: 'completion' });
            }
        }

        this.runQueued();
    }

    /**
     * Run a gateway action the moment it arrives instead of on the next game
     * cycle, and put its packets on the wire at the end of this task. Off the
     * game screen actions stay queued for the loop, which drains only in game.
     * This never runs in the middle of a tick's decode: the client decodes inside
     * one game-loop pass whose awaits all resolve on bytes already buffered, and
     * a gateway message is a task of its own.
     */
    private runArrived(): void {
        if (!this.client.isInGame()) return;
        this.runQueued();
        this.scheduleFlush();
    }

    private runQueued(): void {
        for (let n = 0; n < BotOverlay.MAX_ACTIONS_PER_PASS; n++) {
            if (!this.runNextAction()) return;
        }
    }

    /**
     * Flush at the end of the current task, so whatever ran in it (a burst
     * delivered together, or one released from behind an asynchronous action)
     * leaves as one websocket message and the engine reads it in one tick. The
     * engine decodes 5 user packets per tick (ClientGameProtCategory.USER_EVENT)
     * and carries any excess to the next. A microtask adds no latency: it runs
     * before the page handles its next message.
     */
    private scheduleFlush(): void {
        if (this.flushScheduled) return;
        this.flushScheduled = true;
        queueMicrotask(() => {
            this.flushScheduled = false;
            this.client.flushNow();
        });
    }

    /**
     * Start what waited behind an asynchronous action once it settles, in a task
     * of its own: the promise can settle in the middle of a game-loop pass,
     * where the next action must not run against half-decoded state.
     */
    private postDrain(): void {
        if (this.drainPosted) return;
        this.drainPosted = true;
        postTask(() => {
            this.drainPosted = false;
            this.runArrived();
        });
    }

    /**
     * Publish the state after an action in a task of its own, after its packets
     * are on the wire and the rest of a burst has run. Collecting it costs a few
     * ms (tens at p90), which in line would hold the flush and spread a burst's
     * packets apart. It is collected when it is sent, so it reflects the action
     * and anything decoded since.
     */
    private requestState(): void {
        if (this.statePending) return;
        this.statePending = true;
        postTask(() => {
            this.statePending = false;
            this.sendState();
        });
    }

    /**
     * Start the next queued action - the overlay's action entry point: every
     * SDK action (and any new one, such as starting or stopping an in-page
     * program) is dispatched here through ActionExecutor.execute, and its result
     * and a fresh state go back through finishAction. True when it completed synchronously, so
     * the following one may run in the same pass; false when the queue is
     * empty or an asynchronous action or a wait now holds it.
     */
    private runNextAction(): boolean {
        // Never overlap an asynchronous action with the next queued action.
        if (this.actionQueue.active) return false;

        const queued = this.actionQueue.startNext();
        if (!queued) return false;

        const action = queued.action;
        console.log(`[BotOverlay] Executing action: ${action.type}`);
        const resultOrPromise = action.type === 'program' ? this.programs.command(action) : this.executor.execute(action);

        if (resultOrPromise instanceof Promise) {
            resultOrPromise.then(result => {
                console.log(`[BotOverlay] Async action result: ${result.success ? 'success' : 'failed'} - ${result.message}`);
                this.finishAction(queued, result);
            }).catch(e => {
                console.error(`[BotOverlay] Async action error:`, e);
                this.finishAction(queued, {
                    success: false,
                    message: `Error: ${e}`,
                    phase: 'completion',
                    reason: 'execution_error'
                });
            }).then(() => this.postDrain());
            return false;
        }

        const result = resultOrPromise;
        console.log(`[BotOverlay] Action result: ${result.success ? 'success' : 'failed'} - ${result.message}`);

        if (action.type === 'wait' && result.success) {
            this.waitTicks = action.ticks || 1;
            return false;
        }

        this.finishAction(queued, result);
        return true;
    }

    // ============ State Collection ============

    private collectWorldState(): BotWorldState | null {
        if (!this.collector || !this.client) return null;

        const baseState = this.collector.collectState(this.serverTick, true);
        const c = this.client as any;

        // Get dialog state - include componentId for direct clicking
        const dialogOptions: Array<{ index: number; text: string; componentId?: number; buttonType?: number }> = [];
        const allDialogComponents: Array<{ id: number; type: number; buttonType: number; option: string; text: string }> = [];
        if (c.chatModalId !== -1) {
            const options = this.client.getDialogOptions();
            for (const opt of options) {
                dialogOptions.push({
                    index: opt.index,
                    text: opt.text,
                    componentId: opt.componentId,
                    buttonType: opt.buttonType
                });
            }
            // Also get ALL components for debugging
            if (typeof this.client.debugDialogComponents === 'function') {
                const debugComps = this.client.debugDialogComponents();
                for (const comp of debugComps) {
                    allDialogComponents.push(comp);
                }
            }
        }

        // Collect interface options (for crafting menus like fletching)
        const interfaceOptions: Array<{ index: number; text: string; componentId: number }> = [];
        if (this.client.isViewportInterfaceOpen()) {
            const options = this.client.getInterfaceOptions();
            for (const opt of options) {
                interfaceOptions.push({ index: opt.index, text: opt.text, componentId: opt.componentId });
            }
        }

        return {
            ...baseState,
            dialog: {
                ...baseState.dialog,
                isOpen: this.client.isDialogOpen(),
                options: dialogOptions,
                isWaiting: this.client.isWaitingForDialog(),
                allComponents: allDialogComponents
            },
            interface: {
                ...baseState.interface,
                isOpen: this.client.isViewportInterfaceOpen(),
                interfaceId: this.client.getViewportInterface(),
                options: interfaceOptions,
                debugInfo: this.client.isViewportInterfaceOpen()
                    ? this.client.getInterfaceDebugInfo(this.client.getViewportInterface())
                    : []
            },
            modalOpen: this.client.isModalOpen(),
            modalInterface: this.client.getModalInterface(),
            program: this.programs.status(),
            ...(this.launch ? { launch: this.launch } : {})
        };
    }

    private sendState(): void {
        if (!this.gateway.isConnected()) return;

        const state = this.collectWorldState();
        if (!state) return;

        this.gateway.sendState(state);
    }

    private finishAction(entry: QueuedBotAction, result: ActionResult): void {
        // Ignore a completion that is not the active quiescence barrier.
        if (this.actionQueue.active !== entry) return;

        const publishResult = this.actionQueue.isCurrentGeneration(entry);
        this.actionQueue.complete(entry);
        if (!publishResult) {
            console.log(`[BotOverlay] Released stale action after reconnect: ${entry.action.type}`);
            return;
        }

        if (entry.actionId) {
            this.gateway.sendActionResult(entry.actionId, result);
            this.ui.logAction(result.success ? 'success' : 'failed', result.message);
        }
        this.requestState();
    }

    private captureAndSendScreenshot(screenshotId?: string): void {
        const canvasEl = (window as any).gameCanvas || document.querySelector('canvas');
        if (!canvasEl) return;

        try {
            const dataUrl = canvasEl.toDataURL('image/png');
            this.gateway.sendScreenshot(dataUrl, screenshotId);
        } catch (e) {
            console.error('[BotOverlay] Failed to capture screenshot:', e);
        }
    }

    // ============ Public API ============

    update(): void {
        if (!this.ui.isVisible() || this.ui.isMinimized()) return;

        const state = this.collector.collectState(this.serverTick);
        this.ui.updateContent(formatBotState(state));
    }

    getState(): BotState {
        return this.collector.collectState(this.serverTick);
    }

    toggle(): void {
        this.ui.toggle();
    }

    show(): void {
        this.ui.show();
    }

    hide(): void {
        this.ui.hide();
    }

    isVisible(): boolean {
        return this.ui.isVisible();
    }

    toggleMinimize(): void {
        this.ui.toggleMinimize();
    }

    togglePacketLog(): void {
        this.ui.togglePacketLog();
    }

    destroy(): void {
        this.gateway.disconnect();

        // Clean up callbacks
        this.client.setOnGameTickCallback(null);
        if (this.ui.isPacketLoggingEnabled()) {
            this.client.setPacketLogCallback(null);
        }

        // Clean up activity check interval
        if (this.activityCheckInterval) {
            clearInterval(this.activityCheckInterval);
            this.activityCheckInterval = null;
        }

        this.ui.destroy();
        globalBotOverlay = null;
    }
}
