// Conversations: drive a whole dialogue from the click that opened it until it
// has stayed closed, answering every page the moment it is published.
//
// Continue pages get `clickContinue` and choice pages `clickOption`; both are
// guarded, so a page that changed under the click is refused rather than
// mis-clicked, and the choice queue only advances when a click is accepted.
// Level-up pages (and their unlock pages) that interrupt a conversation are
// dismissed and counted apart from the conversation's own pages.
//
// Burst mode: given the conversation's known shape (`shape`, CONVENTIONS.md
// notation) and `burst`, each run of two or more pure continue pages is cleared
// with one blind `continueBurst`. Every page is checked against the shape as it
// comes; the first disagreement, or a burst that does not land whole, turns
// bursting off and the rest goes one page per tick. A shape that over-counts a
// run before a choice is not detectable (the extra continue is refused by the
// engine at the choice and costs nothing); one that under-counts is.

import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import { classifyPage, clickContinue, clickOption, continueBurst, findOption, pageText, type OptionPattern } from './dialogue';
import { levelUpChain } from './levelup';
import { STALLED, tickClock, type Pred, type StateSource } from './wait';

export type ConverseSdk = StateSource & Pick<BotSDK, 'sendClickDialog' | 'clickDialogByText' | 'sendCloseModal'>;

/** Re-answer a page that is still showing, not waiting, this many ticks after our click (a dropped click). */
export const STALL_TICKS = 4;

export interface ConverseOptions {
    /** Ticks the dialogue must stay closed before the conversation is over (default 3). Raise it for scripts that close the chat during a p_delay and reopen it. */
    idle?: number;
    /** Ticks to wait for the first page (default 15); after that the result has `opened: false`. */
    openTicks?: number;
    /** Give up after this many ticks (default 400), however slowly they come; only a client that stops publishing ends it sooner. */
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
    /**
     * Pages the conversation did not ask for (the Monkey Madness backpack
     * monkey's chat): each page an entry matches is dismissed, counted in
     * `interrupts`, and never counted as the conversation opening or reopening.
     * Checked before the level-up rule.
     */
    interrupts?: readonly Interrupt[];
    /**
     * What the call waits for. 'dialogue' (the default): a conversation. Pages
     * answered through `interrupts` never count as it opening, so without one
     * the call waits out the whole `openTicks`. 'interrupt': an `interrupts`
     * page is the target, as when a quest completion's reward raises a level.
     * Once one has been answered and the chat has stayed closed for `idle`
     * ticks (and `until` holds), the call is over with `opened` false and
     * `interrupts` above 0, with no `openTicks` wait. A conversation that opens
     * before then is still answered to its end. Keep the default where a real
     * conversation is due after the page (a talk click whose NPC dialogue opens
     * behind a queued level-up): with 'interrupt' the call can end between them.
     * Requires `interrupts`.
     */
    expect?: 'dialogue' | 'interrupt';
    /**
     * The conversation's known shape in CONVENTIONS.md notation, as recorded in
     * the quest docs: `Nc` a run of N pure continue pages, `opt` (or `N opt`) an
     * option click, `state` a continue page after which the server changes
     * state (a varp, an item, a p_delay), never burst across. For example
     * "3c, opt, 3c, state, 8c, opt, 13c". The pages seen are checked against it
     * (result `shape`); with `burst` it also drives the bursts.
     */
    shape?: string;
    /**
     * Clear each run of two or more continues in `shape` with one blind burst
     * (lib/dialogue.ts `continueBurst`, rs/51), falling back to one page per
     * tick once a burst does not land or the pages leave the shape. Requires
     * `shape`; false (the default) answers every page as it comes.
     */
    burst?: boolean;
}

/**
 * An unsolicited page and how to get rid of it, for `converse` and `act`.
 * `match` sees published states with a dialogue open. It may be called more
 * than once for one state and must give the same answer each time; it may keep
 * state across ticks (as `levelUpChain` does). A chain
 * of pages (the monkey's three-page dream) needs a `match` that covers every
 * page of it.
 */
export interface Interrupt {
    /** For transcripts. */
    name?: string;
    match: (s: BotWorldState) => boolean;
    /** `continue` clicks the page on (a chat page); `close` sends close-modal. */
    dismiss: 'continue' | 'close';
}

/** Level-up pages and the unlock pages after them, as an Interrupt (fresh chain state per call). */
export function levelUpInterrupt(): Interrupt {
    return { name: 'level-up', match: levelUpChain(), dismiss: 'continue' };
}

/** The first entry matching `s`, if its dialogue is open. */
export function matchInterrupt(interrupts: readonly Interrupt[] | undefined, s: BotWorldState): Interrupt | undefined {
    if (!interrupts?.length || !s.dialog.isOpen) return undefined;
    return interrupts.find(i => i.match(s));
}

/** Send an interrupt's dismissal. */
export function dismissInterrupt(sdk: Pick<BotSDK, 'getState' | 'sendClickDialog' | 'clickDialogByText' | 'sendCloseModal'>, it: Interrupt) {
    return it.dismiss === 'close' ? sdk.sendCloseModal() : clickContinue(sdk);
}

/** One part of a conversation's shape: a run of pure continue pages, an option click, or a state-changing continue page. */
export type ShapePart = { kind: 'continue'; n: number } | { kind: 'opt' } | { kind: 'state' };

/** What a conversation run with a `shape` did with it. */
export interface ConverseShape {
    /** Bursting was asked for. */
    burst: boolean;
    /** Continue pages cleared by blind bursts; the rest of `pages` (`stepPages`) went one per tick. */
    burstPages: number;
    stepPages: number;
    /** Bursts sent, and those that did not land whole (each turns bursting off). */
    bursts: number;
    failedBursts: number;
    /** The shape given and the pages seen, both as `dialogueRuns` writes them (state pages count as continues). */
    expected: string;
    seen: string;
    matches: boolean;
    /** Why bursting or shape-following stopped early, with the tick: the pages left the shape, or a burst failed. */
    stopped?: string;
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
    /** Tick the first page was seen (with `expect: 'interrupt'`, an interrupt page counts), -1 if none. */
    firstTick: number;
    /** First tick the dialogue was seen closed for good (or `until` first held after that), -1 if it never opened (and, with `expect: 'interrupt'`, no interrupt page was answered). */
    endTick: number;
    /** endTick - startTick, or 0 when endTick is -1. */
    ticks: number;
    /** `[tick] page: ...`, `[tick] > option`, `[tick] level-up`, `[tick] modal N closed`. */
    transcript: string[];
    /** Choices not used. */
    remaining: OptionPattern[];
    reason?: string;
    /** Present when `shape` was given. */
    shape?: ConverseShape;
    /** Pages dismissed by `interrupts` (present when interrupts were given). */
    interrupts?: number;
}

const short = (s: string) => s.replace(/\s+/g, ' ').slice(0, 90);

/** Parse a shape ("4c, opt, 6c, state, 2c"; "7 opt" is seven option clicks). Adjacent continue runs merge. Throws on anything else. */
export function parseShape(shape: string): ShapePart[] {
    const parts: ShapePart[] = [];
    for (const raw of shape.split(',')) {
        const t = raw.trim();
        if (!t) continue;
        const c = /^(\d+)\s*c$/i.exec(t);
        const o = /^(?:(\d+)\s*)?opt$/i.exec(t);
        if (c && Number(c[1]) > 0) {
            const prev = parts.at(-1);
            if (prev?.kind === 'continue') prev.n += Number(c[1]);
            else parts.push({ kind: 'continue', n: Number(c[1]) });
        } else if (o && (o[1] === undefined || Number(o[1]) > 0)) {
            for (let i = 0; i < Number(o[1] ?? 1); i++) parts.push({ kind: 'opt' });
        } else if (/^state$/i.test(t)) {
            parts.push({ kind: 'state' });
        } else {
            throw new Error(`converse: bad shape token "${t}" in "${shape}" (want Nc, opt, N opt or state)`);
        }
    }
    return parts;
}

/** A shape as `dialogueRuns` would write the transcript of a conversation that follows it: state pages count as continues. */
export function shapeRuns(shape: string | readonly ShapePart[]): string {
    const parts = typeof shape === 'string' ? parseShape(shape) : shape;
    const out: string[] = [];
    let c = 0;
    for (const p of parts) {
        if (p.kind === 'opt') {
            if (c) out.push(`${c}c`);
            c = 0;
            out.push('opt');
        } else c += p.kind === 'state' ? 1 : p.n;
    }
    if (c) out.push(`${c}c`);
    return out.join(', ');
}

const partText = (p: ShapePart | undefined, used = 0) => (!p ? 'the end' : p.kind === 'continue' ? `${p.n}c (${used} done)` : p.kind);

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
    if (opts.burst && opts.shape === undefined) return Promise.reject(new Error('converse: burst needs the conversation\'s shape'));
    const interruptTarget = opts.expect === 'interrupt';
    if (interruptTarget && !opts.interrupts?.length) return Promise.reject(new Error('converse: expect \'interrupt\' needs interrupts'));
    let plan: ShapePart[] | null;
    try {
        plan = opts.shape !== undefined ? parseShape(opts.shape) : null;
    } catch (e) {
        return Promise.reject(e);
    }
    const shape: ConverseShape | undefined = plan
        ? { burst: !!opts.burst, burstPages: 0, stepPages: 0, bursts: 0, failedBursts: 0, expected: shapeRuns(plan), seen: '', matches: false }
        : undefined;
    if (shape) res.shape = shape;
    if (opts.interrupts) res.interrupts = 0;
    // Position in the shape: the part the next page belongs to, and the pages of a continue run already answered.
    const cursor = { part: 0, used: 0 };
    let following = plan !== null;
    let bursting = following && !!opts.burst;
    const expected = () => (plan && following ? plan[cursor.part] : undefined);
    const leave = (tick: number, why: string) => {
        if (shape && shape.stopped === undefined) {
            shape.stopped = `[${tick}] ${why}`;
            note(tick, `shape: ${why}`);
        }
        bursting = false;
    };
    const diverge = (tick: number, why: string) => {
        if (!following) return;
        leave(tick, `${why} at part ${cursor.part + 1}, ${partText(plan![cursor.part], cursor.used)}`);
        following = false;
    };
    /** Before answering a page: does the shape expect it? */
    const checkShape = (tick: number, kind: 'continue' | 'opt') => {
        const p = expected();
        if (!following) return;
        if (kind === 'opt' ? p?.kind !== 'opt' : p?.kind !== 'continue' && p?.kind !== 'state') diverge(tick, `${kind === 'opt' ? 'a choice' : 'a continue page'} came`);
    };
    /** After answering: move the cursor past what was answered. */
    const consume = (tick: number, kind: 'continue' | 'opt', n = 1) => {
        const p = expected();
        if (!p) return;
        if (kind === 'opt' || p.kind === 'state') {
            cursor.part++;
            cursor.used = 0;
            return;
        }
        if (p.kind !== 'continue' || cursor.used + n > p.n) return diverge(tick, `${n} continue page(s) answered`);
        cursor.used += n;
        if (cursor.used === p.n) {
            cursor.part++;
            cursor.used = 0;
        }
    };

    return new Promise((resolve, reject) => {
        let last: { key: string; tick: number; sawWaiting: boolean } | null = null;
        /** The last pick that went out: its menu, its pattern and text, how many pages had been answered when it did, and its re-sends. */
        let picked: { menu: string; pattern: OptionPattern; text: string; answered: number; resent: number } | null = null;
        const answered = () => res.pages + res.levelUps + (res.interrupts ?? 0);
        let busy = false;
        let closedSince = -1;
        let untilAt = -1;
        let lastModal = -1;
        let interruptKey: string | undefined;
        let done = false;
        const stop = () => {
            done = true;
            unsub();
            clock.stop();
        };
        const finish = (ok: boolean, reason?: string) => {
            if (done) return;
            stop();
            res.ok = ok;
            if (reason) res.reason = reason;
            if (shape) {
                shape.stepPages = res.pages - shape.burstPages;
                shape.seen = dialogueRuns(res.transcript);
                shape.matches = shape.seen === shape.expected;
            }
            if (res.opened || (interruptTarget && res.interrupts)) {
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

        const answer = async (s: BotWorldState, it: Interrupt | undefined) => {
            busy = true;
            try {
                const d = s.dialog;
                if (it) {
                    const r = await dismissInterrupt(sdk, it);
                    if (r.success) {
                        res.interrupts = (res.interrupts ?? 0) + 1;
                        note(s.tick, `interrupt${it.name ? ` ${it.name}` : ''}: ${short(pageText(d))}`);
                    } else last = null;
                    return;
                }
                if (levelUp(s)) {
                    const r = await clickContinue(sdk);
                    if (r.success) {
                        res.levelUps++;
                        note(s.tick, 'level-up');
                    } else last = null;
                    return;
                }
                if (classifyPage(d) === 'continue') {
                    checkShape(s.tick, 'continue');
                    const p = expected();
                    const k = p?.kind === 'continue' ? p.n - cursor.used : 0;
                    if (bursting && k >= 2 && shape) {
                        const next = plan![cursor.part + 1];
                        const until: Pred | undefined = !next
                            ? st => !st.dialog.isOpen
                            : next.kind === 'opt'
                              ? st => classifyPage(st.dialog) === 'choice' && !st.dialog.isWaiting
                              : undefined; // a state page next: only a quiet tick tells the landing apart
                        const text = short(pageText(d));
                        const b = await continueBurst(sdk, k, { ...(until ? { until } : {}), maxTicks: Math.ceil(k / 5) + 3 });
                        shape.bursts++;
                        const landed = (how: string) => {
                            res.pages += k;
                            for (let i = 0; i < k; i++) note(s.tick, `page: ${i === 0 ? text : `(${how} ${i + 1}/${k})`}`);
                            consume(s.tick, 'continue', k);
                            last = null;
                        };
                        if (b.mode === 'burst' && b.ok) {
                            shape.burstPages += k;
                            landed('burst');
                            return;
                        }
                        shape.failedBursts++;
                        if (b.mode === 'fallback' && b.ok) {
                            // The first continue went out, the client refused the blind rest, and they went one per tick.
                            leave(s.tick, `burst of ${k} fell back to one page per tick`);
                            landed('fallback');
                            return;
                        }
                        if (b.mode === 'fallback' && b.ticks === 0) {
                            // Nothing was sent: answer this page the ordinary way, below.
                            leave(s.tick, `burst refused: ${b.reason ?? 'unknown'}`);
                        } else {
                            // Some pages moved, how many is unknown: the shape can no longer be followed.
                            diverge(s.tick, `burst of ${k} did not land (${b.reason ?? 'unknown'})`);
                            last = null;
                            return;
                        }
                    }
                    const r = await clickContinue(sdk);
                    if (r.success) {
                        res.pages++;
                        note(s.tick, `page: ${short(pageText(d))}`);
                        consume(s.tick, 'continue');
                    } else last = null;
                    return;
                }
                // The menu by its id, its page text (a header tells apart menus whose options are alike) and its options.
                const menu = `${d.pageId ?? ''}|${pageText(d)}|${d.options.map(o => o.text).join('/')}`;
                if (picked && picked.menu === menu && picked.answered === answered() && expected()?.kind !== 'opt') {
                    // The menu it was picked on, with no page since and no further menu in the shape: the client took the
                    // pick and the server never answered it. Send it again, once; it was counted, and the shape moved past it, when it first went out.
                    // A server that drops it again is not asked a third time: the next queued choice would be the wrong answer.
                    if (picked.resent >= 1) {
                        const after = res.transcript.slice(-4).join(' ');
                        return fail(new Error(`converse: "${picked.text}" was sent twice on the same menu and the server answered neither; after: ${after}`));
                    }
                    const c = await clickOption(sdk, picked.pattern);
                    if (c.ok) {
                        picked.resent++;
                        note(s.tick, `re-sent > ${c.text}`);
                    }
                    else if (c.reason === 'unsupported_client') fail(new Error('converse: the client does not support guarded dialogue clicks; update and restart it'));
                    else last = null;
                    return;
                }
                checkShape(s.tick, 'opt');
                const idx = queue.findIndex(p => findOption(d, p) !== undefined);
                let pattern: OptionPattern | undefined = idx >= 0 ? queue[idx] : undefined;
                if (pattern === undefined) {
                    const texts = d.options.map(o => o.text);
                    if (unmatched === 'first' && texts[0] !== undefined) pattern = texts[0];
                    else if (unmatched === 'stop') return finish(false, `no choice for [${texts.join(' | ')}]`);
                    else {
                        const after = res.transcript.slice(-4).join(' ');
                        return fail(new Error(`converse: no choice matches [${texts.join(' | ')}]; remaining ${queue.map(String).join(', ') || '(none)'}${after ? `; after: ${after}` : ''}`));
                    }
                }
                const c = await clickOption(sdk, pattern);
                if (c.ok) {
                    picked = { menu, pattern, text: c.text ?? String(pattern), answered: answered(), resent: 0 };
                    res.options++;
                    if (idx >= 0 && !opts.keep) queue.splice(idx, 1);
                    note(s.tick, `> ${c.text}${idx < 0 ? ' (default)' : ''}`);
                    consume(s.tick, 'opt');
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
            clock.see(s);
            if (clock.elapsed > maxTicks) return finish(false, 'timeout');
            const d = s.dialog;
            if (d.isOpen) {
                const key = d.pageId ?? `${pageText(d)}|${d.options.map(o => o.text).join('/')}`;
                if (last && last.key === key && d.isWaiting) last.sawWaiting = true;
                // A page keeps its id after its continue is sent, so the same id is a new
                // page only once we saw it waiting; a page still unchanged after STALL_TICKS
                // had its click dropped.
                const fresh = !d.isWaiting && !busy && !(last && last.key === key && !last.sawWaiting && s.tick - last.tick < STALL_TICKS);
                const it = fresh ? matchInterrupt(opts.interrupts, s) : undefined;
                if (it) interruptKey = key;
                // An interrupt page (and its waiting copy) is not the conversation opening or reopening.
                if (key !== interruptKey) {
                    if (!res.opened) {
                        res.opened = true;
                        if (res.firstTick < 0) res.firstTick = s.tick;
                    }
                    closedSince = -1;
                    untilAt = -1;
                } else if (interruptTarget) {
                    // A target page is showing: the idle wait starts again once it closes.
                    if (res.firstTick < 0) res.firstTick = s.tick;
                    closedSince = -1;
                    untilAt = -1;
                }
                if (!fresh) return;
                last = { key, tick: s.tick, sawWaiting: false };
                void answer(s, it);
                return;
            }
            if (opts.closeModals && s.modalOpen && s.modalInterface !== lastModal) {
                lastModal = s.modalInterface;
                note(s.tick, `modal ${s.modalInterface} closed`);
                void sdk.sendCloseModal();
            }
            if (!s.modalOpen) lastModal = -1;
            if (!res.opened && !(interruptTarget && res.interrupts)) {
                // With an interrupt as the target, not while a dismissal is in flight: it may be the target's.
                if (clock.elapsed > openTicks && !(interruptTarget && busy)) finish(true, 'no dialogue opened');
                return;
            }
            if (closedSince < 0) closedSince = s.tick;
            const u = !opts.until || opts.until(s);
            if (!u) untilAt = -1;
            else if (untilAt < 0) untilAt = s.tick;
            // Not while a click (or a burst, which spans ticks) is still being answered: its counts are not in yet.
            if (u && s.tick - closedSince >= idle && !busy && !(opts.closeModals && s.modalOpen)) finish(true);
        }

        const clock = tickClock(t0, () => finish(false, STALLED), sdk.getState()?.tick);
        const unsub = sdk.onStateUpdate(onState);
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
