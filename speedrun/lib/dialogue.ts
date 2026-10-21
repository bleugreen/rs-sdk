// Dialogue: read-then-act for choice pages, and a blind burst for runs of pure
// "Click here to continue" pages.
//
// The server advances one page per RESUME_PAUSEBUTTON synchronously, so k
// continues cover k pages in ceil(k/5) ticks. The clients refuse a second
// continue until the next page arrives (the resumedPauseButton latch); rs/51
// adds an opt-in `sendClickDialog(0, {blind:true})` that skips only that latch.
// Until a client with rs/51 is running, continueBurst falls back to one
// read-then-act per page and says so in its result.

import type { BotSDK } from '../../sdk/index';
import type { ActionResult, BotWorldState, DialogState } from '../../sdk/types';
import { waitUntil, type StateSource } from './wait';

export type DialogueSdk = StateSource & Pick<BotSDK, 'sendClickDialog' | 'clickDialogByText'>;

/** IfType ButtonType.BUTTON_OK: an option registered with if_addresumebutton (a choice). */
const BUTTON_OK = 1;

export type PageKind = 'none' | 'continue' | 'choice';

/**
 * A dialog with at most one option, none of them a registered choice button,
 * is a continue page (the same rule as the SDK's dismissBlockingUI).
 */
export function classifyPage(dialog: DialogState | null | undefined): PageKind {
    if (!dialog?.isOpen) return 'none';
    if (dialog.options.length > 1 || dialog.options.some(o => o.buttonType === BUTTON_OK)) return 'choice';
    return 'continue';
}

export function dialogText(s: BotWorldState | null | undefined): string {
    const d = s?.dialog;
    if (!d?.isOpen) return '';
    const body = s?.recentDialogs?.[0]?.text.join(' ') ?? '';
    const opts = d.options.map(o => o.text).join(' / ');
    return opts ? `${body} | ${opts}` : body;
}

// The page we last acted on, per SDK. A page keeps its id after its continue
// is sent (isWaiting marks the round trip), so "fresh" means a different id,
// or the same id after we saw it waiting (two identical pages in a row).
const acted = new WeakMap<object, { pageId: string | undefined; sawWaiting: boolean }>();

function isFresh(sdk: object, d: DialogState): boolean {
    if (!d.isOpen || d.isWaiting) return false;
    const last = acted.get(sdk);
    if (!last) return true;
    return d.pageId !== last.pageId || last.sawWaiting;
}

/** Forget the last acted page (e.g. after leaving a dialogue some other way). */
export function resetDialogueMemory(sdk: object): void {
    acted.delete(sdk);
}

export interface AdvanceResult {
    ok: boolean;
    kind: PageKind;
    text: string;
    ticks: number;
    reason?: string;
}

/**
 * Wait for a fresh page, then act on it: a continue page gets a continue; a
 * choice page is answered with the guarded `clickDialogByText(choose)`, which
 * refuses rather than mis-clicks if the page changed under it.
 */
export async function advance(sdk: DialogueSdk, opts: { choose?: RegExp; maxTicks?: number } = {}): Promise<AdvanceResult> {
    const t0 = sdk.getState()?.tick ?? 0;
    const r = await waitUntil(sdk, s => isFresh(sdk, s.dialog), { maxTicks: opts.maxTicks ?? 10 });
    if (!r.ok) return { ok: false, kind: 'none', text: '', ticks: r.tick - t0, reason: 'no fresh page' };
    const s = r.state;
    const kind = classifyPage(s.dialog);
    const text = dialogText(s);
    const pageId = s.dialog.pageId;
    let res: ActionResult;
    if (kind === 'choice') {
        if (!opts.choose) return { ok: false, kind, text, ticks: s.tick - t0, reason: 'choice page and no `choose` pattern' };
        res = await sdk.clickDialogByText(opts.choose);
    } else {
        res = await sdk.sendClickDialog(0);
    }
    acted.set(sdk, { pageId, sawWaiting: false });
    if (!res.success) return { ok: false, kind, text, ticks: s.tick - t0, reason: res.reason ?? res.message };
    // The client marks a sent continue as waiting and republishes right away;
    // record that so an identical next page still counts as fresh.
    if (kind === 'continue') {
        const w = await waitUntil(sdk, st => st.dialog.isWaiting || st.dialog.pageId !== pageId || !st.dialog.isOpen, { maxTicks: 2 });
        if (w.ok && w.state.dialog.isWaiting && w.state.dialog.pageId === pageId) acted.set(sdk, { pageId, sawWaiting: true });
    }
    return { ok: true, kind, text, ticks: s.tick - t0 };
}

export interface BurstResult {
    ok: boolean;
    mode: 'burst' | 'fallback';
    ticks: number;
    reason?: string;
}

type BlindClick = (option: number, opts: { blind: boolean }) => Promise<ActionResult>;

/**
 * Advance through `k` pure continue pages as fast as the client allows.
 *
 * Contract: the caller guarantees the current page and the next k-1 pages are
 * all pure continue pages and that none of them follows a server-side state
 * change (a p_delay, a teleport, an inventory change the script waits on). A
 * burst never crosses a choice page, because the engine refuses a bare resume
 * while a choice is pending, but a burst that runs out early leaves the
 * remainder unsent.
 *
 * With rs/51's blind continue, all k are fired at once and the server takes 5
 * per tick. Without it, the client refuses continues 2..k locally (no server
 * event is spent), and the rest are sent one read-then-act at a time.
 */
export async function continueBurst(sdk: DialogueSdk, k: number, opts: { maxTicks?: number } = {}): Promise<BurstResult> {
    const s0 = sdk.getState();
    const t0 = s0?.tick ?? 0;
    if (!s0 || classifyPage(s0.dialog) !== 'continue' || s0.dialog.isWaiting) {
        return { ok: false, mode: 'fallback', ticks: 0, reason: 'not on a fresh continue page' };
    }
    if (k <= 0) return { ok: true, mode: 'burst', ticks: 0 };
    const startPage = s0.dialog.pageId;
    const blind = sdk.sendClickDialog as unknown as BlindClick;
    const acks = await Promise.all(Array.from({ length: k }, () => blind.call(sdk, 0, { blind: true })));
    const accepted = acks.filter(a => a.success).length;
    acted.set(sdk, { pageId: startPage, sawWaiting: true });

    if (accepted >= k) {
        const minTick = t0 + Math.ceil(k / 5);
        const r = await waitUntil(
            sdk,
            s => s.tick >= minTick && (!s.dialog.isOpen || (s.dialog.pageId !== startPage && !s.dialog.isWaiting)),
            { maxTicks: opts.maxTicks ?? Math.ceil(k / 5) + 3 }
        );
        return { ok: r.ok, mode: 'burst', ticks: r.tick - t0, ...(r.ok ? {} : { reason: 'dialog did not move past the burst' }) };
    }

    if (accepted === 0) return { ok: false, mode: 'fallback', ticks: 0, reason: acks[0]?.message ?? 'continue refused' };
    // The first continue went out normally; read-then-act for the rest.
    for (let i = accepted; i < k; i++) {
        const r = await advance(sdk, { maxTicks: opts.maxTicks ?? 10 });
        if (!r.ok) return { ok: false, mode: 'fallback', ticks: (sdk.getState()?.tick ?? t0) - t0, reason: r.reason };
        if (r.kind !== 'continue') return { ok: false, mode: 'fallback', ticks: (sdk.getState()?.tick ?? t0) - t0, reason: 'hit a choice page' };
    }
    // Wait for the page after the last continue, so ticks cover all k pages.
    const last = acted.get(sdk)?.pageId;
    const r = await waitUntil(sdk, s => !s.dialog.isOpen || (s.dialog.pageId !== last && !s.dialog.isWaiting), { maxTicks: opts.maxTicks ?? 10 });
    return { ok: r.ok, mode: 'fallback', ticks: r.tick - t0 };
}
