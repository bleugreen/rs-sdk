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
import type { ActionResult, BotWorldState, DialogOption, DialogState } from '../../sdk/types';
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

/**
 * The open page's own words. The lite client publishes them in
 * `allComponents`; `text` is rarely filled in and is only the fallback.
 */
export function pageText(dialog: DialogState | null | undefined): string {
    if (!dialog?.isOpen) return '';
    const words = (dialog.allComponents ?? []).map(c => c.text).filter(Boolean).join(' ');
    return (words || dialog.text || '').replace(/\s+/g, ' ').trim();
}

/** A string matches an option as a case-insensitive substring; a RegExp is tested against its text. */
export type OptionPattern = string | RegExp;

export function matchesOption(text: string, pattern: OptionPattern): boolean {
    if (typeof pattern === 'string') return text.toLowerCase().includes(pattern.toLowerCase());
    pattern.lastIndex = 0;
    return pattern.test(text);
}

export function findOption(dialog: DialogState | null | undefined, pattern: OptionPattern): DialogOption | undefined {
    if (!dialog?.isOpen) return undefined;
    return dialog.options.find(o => matchesOption(o.text, pattern));
}

export interface OptionClick {
    ok: boolean;
    /** The option text that was clicked (or would have been). */
    text?: string;
    /** `no_dialog`, `absent` (nothing sent), or the SDK's refusal (`stale_dialog`, ...). */
    reason?: string;
    /** The options on the page that was read. */
    options: string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Click a dialogue option by its text, guarded. The option is resolved on the
 * page as published, and when no option matches nothing is sent at all. The
 * click then goes out as the SDK's page-bound `clickDialogByText` with the
 * option's exact text, so a page re-published under a new id, or a different
 * page that replaced it, is refused (`stale_dialog`) instead of clicked: an
 * unguarded click on a stale copy lands on whatever page the server shows next.
 */
export async function clickOption(sdk: Pick<BotSDK, 'getState' | 'clickDialogByText'>, pattern: OptionPattern): Promise<OptionClick> {
    const d = sdk.getState()?.dialog;
    const options = d?.isOpen ? d.options.map(o => o.text) : [];
    if (!d?.isOpen) return { ok: false, reason: 'no_dialog', options };
    const match = findOption(d, pattern);
    if (!match) return { ok: false, reason: 'absent', options };
    const r = await sdk.clickDialogByText(new RegExp(`^${escapeRe(match.text)}$`));
    return r.success ? { ok: true, text: match.text, options } : { ok: false, text: match.text, reason: r.reason ?? r.message, options };
}

const CONTINUE = /click here to continue|^continue$/i;

/**
 * Continue the open page. A page that publishes its "Click here to continue"
 * option (with a page id and component) gets the guarded click, for the same
 * reason as `clickOption`; anything else (no option, an older client) gets the
 * plain `sendClickDialog(0)`.
 */
export async function clickContinue(sdk: Pick<BotSDK, 'getState' | 'sendClickDialog' | 'clickDialogByText'>): Promise<ActionResult> {
    const d = sdk.getState()?.dialog;
    const opt = d?.isOpen ? d.options.find(o => CONTINUE.test(o.text)) : undefined;
    if (d?.pageId && opt?.componentId !== undefined) return sdk.clickDialogByText(new RegExp(`^${escapeRe(opt.text)}$`));
    return sdk.sendClickDialog(0);
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
 * Wait for a fresh page, then act on it: a continue page gets `clickContinue`;
 * a choice page is answered with `clickOption(choose)`. Both refuse rather
 * than mis-click if the page changed under them.
 */
export async function advance(sdk: DialogueSdk, opts: { choose?: OptionPattern; maxTicks?: number } = {}): Promise<AdvanceResult> {
    const t0 = sdk.getState()?.tick ?? 0;
    const r = await waitUntil(sdk, s => isFresh(sdk, s.dialog), { maxTicks: opts.maxTicks ?? 10 });
    if (!r.ok) return { ok: false, kind: 'none', text: '', ticks: r.tick - t0, reason: 'no fresh page' };
    const s = r.state;
    const kind = classifyPage(s.dialog);
    const text = dialogText(s);
    const pageId = s.dialog.pageId;
    let failed: string | undefined;
    if (kind === 'choice') {
        if (!opts.choose) return { ok: false, kind, text, ticks: s.tick - t0, reason: 'choice page and no `choose` pattern' };
        const c = await clickOption(sdk, opts.choose);
        if (!c.ok) failed = c.reason;
    } else {
        const res = await clickContinue(sdk);
        if (!res.success) failed = res.reason ?? res.message;
    }
    acted.set(sdk, { pageId, sawWaiting: false });
    if (failed !== undefined) return { ok: false, kind, text, ticks: s.tick - t0, reason: failed };
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
    /** Ticks until the landing was confirmed (includes the quiet tick when there is no `until`). */
    ticks: number;
    /** Ticks until the landing page was first seen. */
    landedTicks?: number;
    reason?: string;
}

export interface BurstOptions {
    /**
     * Where the burst should land, e.g. `s => classifyPage(s.dialog) === 'choice'`
     * or `s => !s.dialog.isOpen`. With it the burst resolves the moment the
     * landing shows. Without it the burst waits for one quiet tick after the
     * ceil(k/5) floor: the same page, not waiting, across a tick boundary.
     */
    until?: (s: BotWorldState) => boolean;
    maxTicks?: number;
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
 * per tick. A burst fired mid-tick can split across server ticks (say 3, then
 * 5, then 2), and the client publishes once per tick, so the pages inside a
 * tick collapse into one and "some page moved" does not mean "k pages moved".
 * The burst therefore returns only on the caller's `until` landing, or after a
 * quiet tick. Returning earlier would let the caller's next continue land
 * behind still-buffered resumes, one page past k. Pass `until` when the
 * landing is known: it saves the quiet tick.
 *
 * Without blind continue, the client refuses continues 2..k locally (no server
 * event is spent), and the rest are sent one read-then-act at a time.
 */
export async function continueBurst(sdk: DialogueSdk, k: number, opts: BurstOptions = {}): Promise<BurstResult> {
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
        const floor = t0 + Math.ceil(k / 5);
        const landing = burstLanding(startPage, floor, opts.until);
        const r = await waitUntil(sdk, s => landing.step(s), { maxTicks: opts.maxTicks ?? Math.ceil(k / 5) + 5 });
        return {
            ok: r.ok,
            mode: 'burst',
            ticks: r.tick - t0,
            ...(r.ok ? { landedTicks: landing.landedAt() - t0 } : { reason: 'dialog did not settle after the burst' }),
        };
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
    return { ok: r.ok, mode: 'fallback', ticks: r.tick - t0, landedTicks: r.tick - t0 };
}

/**
 * The burst's landing detector, fed one published state at a time. Exported
 * for tests. A landing is a state at or past the floor tick, off the start
 * page, not waiting; it is confirmed by `until`, or by the same landing still
 * showing on a later tick (a quiet tick).
 */
export function burstLanding(startPage: string | undefined, floor: number, until?: (s: BotWorldState) => boolean) {
    let seen: { tick: number; sig: string } | null = null;
    let landedAt = -1;
    return {
        landedAt: () => landedAt,
        step(s: BotWorldState): boolean {
            if (s.tick < floor) return false;
            const d = s.dialog;
            if (d.isOpen && (d.isWaiting || d.pageId === startPage)) {
                seen = null;
                return false;
            }
            const sig = d.isOpen ? `page:${d.pageId}` : 'closed';
            if (until) {
                if (!until(s)) return false;
                landedAt = s.tick;
                return true;
            }
            if (seen && seen.sig === sig) {
                if (s.tick > seen.tick) {
                    landedAt = seen.tick;
                    return true;
                }
                return false;
            }
            seen = { tick: s.tick, sig };
            return false;
        },
    };
}
