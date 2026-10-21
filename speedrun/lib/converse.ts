// Conversations: drive a whole dialogue from the click that opened it until it
// has stayed closed, answering every page the moment it is published.
//
// Continue pages get `clickContinue` and choice pages `clickOption`; both are
// guarded, so a page that changed under the click is refused rather than
// mis-clicked, and the choice queue only advances when a click is accepted.
// Level-up pages (and their unlock pages) that interrupt a conversation are
// dismissed and counted apart from the conversation's own pages.

import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import { classifyPage, clickContinue, clickOption, findOption, pageText, type OptionPattern } from './dialogue';
import { levelUpChain } from './levelup';
import { tickMs, type Pred, type StateSource } from './wait';

export type ConverseSdk = StateSource & Pick<BotSDK, 'sendClickDialog' | 'clickDialogByText' | 'sendCloseModal'>;

/** Re-answer a page that is still showing, not waiting, this many ticks after our click (a dropped click). */
export const STALL_TICKS = 4;

export interface ConverseOptions {
    /** Ticks the dialogue must stay closed before the conversation is over (default 3). Raise it for scripts that close the chat during a p_delay and reopen it. */
    idle?: number;
    /** Ticks to wait for the first page (default 15); after that the result has `opened: false`. */
    openTicks?: number;
    /** Give up after this many ticks (default 400). */
    maxTicks?: number;
    /** Over only once this also holds with the dialogue closed: a scripted walk or teleport after the last page. */
    until?: Pred;
    /**
     * Choices are a priority list, not a queue: every choice page clicks the
     * first pattern that matches one of its options and nothing is consumed.
     * Default: the first queued pattern that matches is clicked and removed.
     */
    keep?: boolean;
    /** A choice page no remaining pattern answers: throw (default), take its first option, or stop with `ok:false`. */
    unmatched?: 'throw' | 'first' | 'stop';
    /** Close a main modal (a chapter card) open while no dialogue is. Default false: a dialogue can open a shop on purpose. */
    closeModals?: boolean;
    /** Print each answered page. */
    log?: boolean;
}

export interface ConverseResult {
    ok: boolean;
    /** Whether any page was seen. */
    opened: boolean;
    /** Continue pages clicked (level-ups excluded). */
    pages: number;
    /** Option clicks. */
    options: number;
    levelUps: number;
    /** Tick of the call. */
    startTick: number;
    /** Tick the first page was seen, -1 if none. */
    firstTick: number;
    /** First tick the dialogue was seen closed for good (or `until` first held after that), -1 if it never opened. */
    endTick: number;
    /** endTick - startTick, or 0 when nothing opened. */
    ticks: number;
    /** `[tick] page: ...`, `[tick] > option`, `[tick] level-up`, `[tick] modal N closed`. */
    transcript: string[];
    /** Choices not used. */
    remaining: OptionPattern[];
    reason?: string;
}

const short = (s: string) => s.replace(/\s+/g, ' ').slice(0, 90);

/**
 * Answer the dialogue that is open or about to open. Call it right after the
 * click that opens it (or fire that click after calling it: it only listens).
 * Rejects when a choice page has no answer and `unmatched` is 'throw'.
 */
export function converse(sdk: ConverseSdk, choices: OptionPattern[] = [], opts: ConverseOptions = {}): Promise<ConverseResult> {
    const idle = opts.idle ?? 3;
    const openTicks = opts.openTicks ?? 15;
    const maxTicks = opts.maxTicks ?? 400;
    const unmatched = opts.unmatched ?? 'throw';
    const queue = [...choices];
    const levelUp = levelUpChain();
    const t0 = sdk.getState()?.tick ?? 0;
    const res: ConverseResult = { ok: true, opened: false, pages: 0, options: 0, levelUps: 0, startTick: t0, firstTick: -1, endTick: -1, ticks: 0, transcript: [], remaining: queue };
    const note = (tick: number, line: string) => {
        res.transcript.push(`[${tick}] ${line}`);
        if (opts.log) console.log(`  [dlg ${tick}] ${line}`);
    };

    return new Promise((resolve, reject) => {
        let last: { key: string; tick: number; sawWaiting: boolean } | null = null;
        let busy = false;
        let closedSince = -1;
        let untilAt = -1;
        let lastModal = -1;
        let done = false;
        const stop = () => {
            done = true;
            unsub();
            clearTimeout(wall);
        };
        const finish = (ok: boolean, reason?: string) => {
            if (done) return;
            stop();
            res.ok = ok;
            if (reason) res.reason = reason;
            if (res.opened) {
                res.endTick = closedSince >= 0 ? Math.max(closedSince, untilAt) : (sdk.getState()?.tick ?? t0);
                res.ticks = res.endTick - t0;
            }
            resolve(res);
        };
        const fail = (e: unknown) => {
            if (done) return;
            stop();
            reject(e instanceof Error ? e : new Error(String(e)));
        };

        const answer = async (s: BotWorldState) => {
            busy = true;
            try {
                const d = s.dialog;
                if (levelUp(s)) {
                    const r = await clickContinue(sdk);
                    if (r.success) {
                        res.levelUps++;
                        note(s.tick, 'level-up');
                    } else last = null;
                    return;
                }
                if (classifyPage(d) === 'continue') {
                    const r = await clickContinue(sdk);
                    if (r.success) {
                        res.pages++;
                        note(s.tick, `page: ${short(pageText(d))}`);
                    } else last = null;
                    return;
                }
                const idx = queue.findIndex(p => findOption(d, p) !== undefined);
                let pattern: OptionPattern | undefined = idx >= 0 ? queue[idx] : undefined;
                if (pattern === undefined) {
                    const texts = d.options.map(o => o.text);
                    if (unmatched === 'first' && texts[0] !== undefined) pattern = texts[0];
                    else if (unmatched === 'stop') return finish(false, `no choice for [${texts.join(' | ')}]`);
                    else return fail(new Error(`converse: no choice matches [${texts.join(' | ')}]; remaining ${queue.map(String).join(', ') || '(none)'}`));
                }
                const c = await clickOption(sdk, pattern);
                if (c.ok) {
                    res.options++;
                    if (idx >= 0 && !opts.keep) queue.splice(idx, 1);
                    note(s.tick, `> ${c.text}${idx < 0 ? ' (default)' : ''}`);
                } else if (c.reason === 'unsupported_client') {
                    fail(new Error('converse: the client does not support guarded dialogue clicks; update and restart it'));
                } else last = null; // stale or gone: judge the next published page afresh
            } catch (e) {
                fail(e);
            } finally {
                busy = false;
                // Pages published while the click was in flight were skipped: judge the latest now.
                const cur = sdk.getState();
                if (cur && cur !== s && !done) onState(cur);
            }
        };

        function onState(s: BotWorldState): void {
            if (done) return;
            if (s.tick - t0 > maxTicks) return finish(false, 'timeout');
            const d = s.dialog;
            if (d.isOpen) {
                if (!res.opened) {
                    res.opened = true;
                    res.firstTick = s.tick;
                }
                closedSince = -1;
                untilAt = -1;
                const key = d.pageId ?? `${pageText(d)}|${d.options.map(o => o.text).join('/')}`;
                if (last && last.key === key && d.isWaiting) last.sawWaiting = true;
                if (d.isWaiting || busy) return;
                // A page keeps its id after its continue is sent, so the same id is a new
                // page only once we saw it waiting; a page still unchanged after STALL_TICKS
                // had its click dropped.
                if (last && last.key === key && !last.sawWaiting && s.tick - last.tick < STALL_TICKS) return;
                last = { key, tick: s.tick, sawWaiting: false };
                void answer(s);
                return;
            }
            if (opts.closeModals && s.modalOpen && s.modalInterface !== lastModal) {
                lastModal = s.modalInterface;
                note(s.tick, `modal ${s.modalInterface} closed`);
                void sdk.sendCloseModal();
            }
            if (!s.modalOpen) lastModal = -1;
            if (!res.opened) {
                if (s.tick - t0 > openTicks) finish(true, 'no dialogue opened');
                return;
            }
            if (closedSince < 0) closedSince = s.tick;
            const u = !opts.until || opts.until(s);
            if (!u) untilAt = -1;
            else if (untilAt < 0) untilAt = s.tick;
            if (u && s.tick - closedSince >= idle && !(opts.closeModals && s.modalOpen)) finish(true);
        }

        const unsub = sdk.onStateUpdate(onState);
        const wall = setTimeout(() => finish(false, 'client stopped publishing'), (maxTicks + 20) * tickMs());
        const cur = sdk.getState();
        if (cur) onState(cur);
    });
}

/** The dialogue shape in CONVENTIONS.md notation: "4c, opt, 6c" (continue runs and option clicks; level-ups left out). */
export function dialogueRuns(transcript: readonly string[]): string {
    const out: string[] = [];
    let c = 0;
    for (const line of transcript) {
        if (/^\[\d+\] > /.test(line)) {
            if (c) out.push(`${c}c`);
            c = 0;
            out.push('opt');
        } else if (/^\[\d+\] page: /.test(line)) c++;
    }
    if (c) out.push(`${c}c`);
    return out.join(', ');
}

/** Dialogue ticks if every continue run went as one blind burst (ceil(run/5)) and each option took a tick. */
export function burstTicks(transcript: readonly string[]): number {
    let t = 0;
    for (const part of dialogueRuns(transcript).split(', ')) {
        if (part === 'opt') t += 1;
        else if (part) t += Math.ceil(parseInt(part, 10) / 5);
    }
    return t;
}
