// Interactions: one click (an NPC, a loc, an item, a ground item, a walk, a
// spell) and the wait for its effect, with the re-click a player makes when
// the first one is dropped.
//
// The server drops a click that arrives while a script holds the player (a
// p_delay, a forced move), and the lite client drops an interaction it
// believes has no route. Neither says so, so `act` re-sends while the player
// stands still with no dialogue open, unless the click's script has already
// answered (a game message, an animation, an interface) to a click sent from an
// idle player: that click landed, and a re-send would restart its script. It also re-sends on "I can't reach
// that!", which a door animation or an NPC in the way can cause.
//
// Jumps (the jump guard, `settle` and `ClickGuard`): the first click after the
// player's position jumps is the one most often lost. A scripted move stepped
// by p_teleport (agility_walk: the Gnome Stronghold gate, the Grand Tree door)
// still holds the player on the tick it lands, so a click then is dropped; a
// p_telejump (a teleport, a ladder or stairs, login) does not hold them, but its
// first click can still miss; and while the browser client rebuilds the region its
// collision maps are stale, so the SDK refuses world clicks (scene_loading)
// and the lite client can refuse one as unroutable (cant_reach). So `act` and
// `talkTo` wait for a settled position (region built, not placed this tick)
// before the first click, re-send a refused send on the next settled tick, and
// re-send once a post-jump click that draws no reply within REPLY_TICKS. A
// click that is not just after a jump and is accepted behaves as before.
//
// Silence is counted from the server tick a click reached (`ClickGuard.replyFrom`):
// the later of the tick the tab executed it and wait.ts `serverClock` at that moment.
// A starved browser tab executes a queued click late and decodes the reply after
// the rest of its backlog, so its own tick undercounts how long the server has had
// the click. Both re-sends (the reply watch and `act`'s idle re-send) count from
// there, and neither fires while the tab has not executed the click yet.

import type { BotSDK } from '../../sdk/index';
import type { BotActions } from '../../sdk/actions';
import { PLAYER_CHAT_TYPES, type BotWorldState, type GroundItem, type NearbyLoc, type NearbyNpc } from '../../sdk/types';
import { converse, dismissInterrupt, matchInterrupt, type ConverseOptions, type ConverseResult, type ConverseSdk, type Interrupt } from './converse';
import { pageText, type OptionPattern } from './dialogue';
import { approachNpc, npcTile, unroutedReply } from './approach';
import { matchesItem, type ItemPattern } from './items';
import type { TravelSdk } from './travel';
import { serverClock, waitUntil, type Pred, type StateSource } from './wait';
import { chebyshev, configIds, findLoc, invCount, invItem, messageCursor, opIndex, pos, replyAfter, tileCounter, waitForNpc, worn, type LocQuery, type NamePattern, type OpPattern, type Tile } from './world';

export type ActSdk = StateSource &
    Pick<BotSDK, 'sendInteractNpc' | 'sendInteractLoc' | 'sendUseItem' | 'sendUseItemOnItem' | 'sendUseItemOnLoc' | 'sendUseItemOnNpc' | 'sendPickup' | 'sendWalk' | 'sendClickComponent' | 'sendDropItem' | 'scanNearbyLocs' | 'scanGroundItems'>;

export interface ActOptions {
    /** Give up after this many ticks (default 60). */
    maxTicks?: number;
    /** Re-send after the player has stood still this many ticks with no dialogue open (default 6; 0 never re-sends). */
    resendEvery?: number;
    /** At most this many re-sends (default 5). */
    maxResends?: number;
    /**
     * Pages the step did not ask for (converse.ts `Interrupt`): each is
     * dismissed as it shows, and once it has gone the click is re-sent (outside
     * `resendEvery` and `maxResends`). Needs an sdk with sendClickDialog,
     * clickDialogByText and sendCloseModal. Default none: an open dialogue only
     * holds off re-sends.
     */
    interrupts?: readonly Interrupt[];
}

export interface ActResult extends JumpCounts {
    ok: boolean;
    /** Click to the first state where `done` held (or to the timeout). */
    ticks: number;
    resends: number;
    reason?: string;
    /** Pages dismissed by `interrupts` (present when interrupts were given). */
    interrupts?: number;
}

const CANT_REACH = /can't reach that/i;
/** Any game message but CANT_REACH: a click's reply that says it landed. */
const NOT_CANT_REACH = new RegExp(`^(?![\\s\\S]*${CANT_REACH.source})`, 'i');

// ------------------------------------------------------------------ jumps

/** What the jump guard did for one click; each field is present only when non-zero. */
export interface JumpCounts {
    /** Ticks waited before the first click for a settled position (the region built, the player not placed that tick). */
    settleTicks?: number;
    /** Re-sends of a send the client refused (cant_reach) or the SDK could not confirm (scene_loading) that drew no reply. */
    refusedResends?: number;
    /** Re-sends of a click sent just after a jump that drew no reply within REPLY_TICKS. */
    unansweredResends?: number;
}

/** Ticks a post-jump click has to draw a reply, from the server tick it reached, before it is re-sent once. */
export const REPLY_TICKS = 3;
/** A click sent within this many ticks of the player's last teleport-type update is a post-jump click. */
export const JUMP_WINDOW = 2;
/** At most this many re-sends of a refused send per click. */
export const MAX_REFUSED_RESENDS = 5;

/**
 * Not yet a position to click from: the client is still building the region (sceneReady false),
 * or a scripted p_teleport step placed the player this very tick (teleportTick, no jump bit:
 * agility_walk, the Gnome Stronghold gate, the Grand Tree door), whose script still holds them.
 * A p_telejump (a ladder, a spell, login) holds nobody, so it does not wait; a click it drops is
 * caught by ClickGuard's reply check. Clients that publish none of these are always settled.
 */
export function unsettled(s: BotWorldState): boolean {
    return s.sceneReady === false || ((s.player?.teleportTick ?? null) === s.tick && s.player?.teleportJump === false);
}

/** Wait for a settled position (`unsettled` false); `ticks` is how long that took. */
export async function settle(sdk: StateSource, maxTicks = 60): Promise<{ ok: boolean; ticks: number }> {
    const s0 = sdk.getState();
    if (!s0 || !unsettled(s0)) return { ok: true, ticks: 0 };
    const r = await waitUntil(sdk, s => !unsettled(s), { maxTicks });
    return { ok: r.ok, ticks: r.tick - s0.tick };
}

const refusedSend = (r: unknown) => typeof r === 'object' && r !== null && (r as { success?: unknown }).success === false;

/**
 * One click and its re-sends under the jump rules. `send` sends it (every re-send of the caller
 * goes through it too); `step` is fed each published state and re-sends when a refused send can
 * go out again, or when a post-jump click has drawn no reply in REPLY_TICKS. The reply is
 * anything the engine does that a dropped click cannot cause: a step, a dialogue or modal, a new
 * animation, a game message, an inventory change, or the caller's own `answered`; but no page the
 * click did not open (`opts.npc`, `opts.interrupts`) and nothing a fight makes (inFightSince).
 */
export class ClickGuard {
    readonly counts: { refusedResends: number; unansweredResends: number } = { refusedResends: 0, unansweredResends: 0 };
    /**
     * The last send drew a script's answer (see replyKind): it landed and its script is running
     * (a loc op that p_delays before its dialogue: Dwarf Cannon's railings, the Wilderness lever,
     * the spirit trees), so it is never re-sent on idle ticks; re-sending would restart the script.
     * Only a send from an idle player latches it: when an earlier script was still answering at the
     * send (busyAt), its later messages and animations are not this click's, and that click may
     * have been dropped while the script held the player (a climb sent as a potion's boost shows,
     * before the drink's last message), so it keeps the idle re-send.
     */
    scriptAnswered = false;
    private idleAtSend = true;
    private refusedAt = -1;
    private reachedAt = -1;
    private inFlight = 0;
    private watching = false;
    private base: ReturnType<typeof snapshot> | null = null;
    private cantReach: ReturnType<typeof replyAfter> | null = null;

    constructor(
        private readonly sdk: StateSource & Partial<Pick<BotSDK, 'getStateReceivedAt'>>,
        private readonly click: () => Promise<unknown>,
        private readonly answered: Pred = () => false,
        /** Watch the first send for a reply even when it is not just after a jump (S00's first talk after login). */
        private readonly opts: {
            alwaysWatch?: boolean;
            /**
             * A server clock (wait.ts serverClock) anchored where the tab was last known current. The
             * guard's own clock starts from the state at the send, which a tab already starved at the
             * send (S00 throttled from login) publishes ticks late, so it cannot see that lag; the
             * later of the two counts. Only ever lengthens the bound.
             */
            clock?: (wallMs: number) => number;
            /**
             * The NPC the click talks to, by name: another NPC's chat page (the backpack monkey's
             * chatter as Waydar's talk goes out, rs/201 MM U) is not this click's answer.
             */
            npc?: string;
            /** Pages the caller dismisses as not the step's (converse.ts Interrupt): never this click's answer. */
            interrupts?: readonly Interrupt[];
        } = {}
    ) {}

    /**
     * The server tick the last send reached, which every silence bound counts from: the later of
     * the tick the tab executed it (its action result came back) and wait.ts `serverClock` then,
     * from the state current at the send. On a current tab the two agree; a starved tab executes a
     * click late and is still behind the server when it does (rs/345), so its own tick would bring a
     * re-send before the reply can arrive. Wall time only ever lengthens the bound.
     */
    get replyFrom(): number {
        return this.reachedAt;
    }

    /** The engine answered the last send with "I can't reach that!" (world.ts replyAfter, taken before the click). */
    refusedBy(s: BotWorldState): boolean {
        return this.cantReach?.seen(s) ?? false;
    }

    /** A send the tab has not executed yet: it cannot have drawn a reply, so nothing re-sends it. */
    get pending(): boolean {
        return this.inFlight > 0;
    }

    /** Send the click now; a refused send is re-sent from `step`. */
    async send(): Promise<void> {
        const s = this.sdk.getState();
        const tick = s?.tick ?? 0;
        const clock = serverClock(tick, this.sdk.getStateReceivedAt?.() || Date.now());
        this.reachedAt = tick;
        this.base = s ? snapshot(s, this.opts) : null;
        this.cantReach = replyAfter(this.sdk, CANT_REACH);
        this.scriptAnswered = false;
        this.idleAtSend = !s || !busyAt(s);
        const jumpTick = s?.player?.teleportTick ?? null;
        // Only the first send after a jump is watched for a reply, and it is re-sent at most once.
        if (this.counts.unansweredResends === 0 && (this.opts.alwaysWatch || (jumpTick !== null && tick - jumpTick <= JUMP_WINDOW))) this.watching = true;
        this.inFlight++;
        let r: unknown;
        try {
            r = await this.click();
        } finally {
            this.inFlight--;
        }
        const executed = this.sdk.getState()?.tick ?? tick;
        const now = Date.now();
        this.reachedAt = Math.max(executed, clock(now), this.opts.clock?.(now) ?? -1);
        // A refusal is the client's own (no route, region loading): it can go again on the tab's next settled tick.
        this.refusedAt = refusedSend(r) ? executed : -1;
    }

    /** Feed a published state; true when it re-sent. */
    step(s: BotWorldState): boolean {
        if (!this.scriptAnswered && this.idleAtSend && this.base && replyKind(this.base, s) === 'script') this.scriptAnswered = true;
        if (this.pending) return false;
        if (this.refusedAt >= 0) {
            // A send reported as scene_loading did go out and may have landed: a reply settles it.
            if (this.answered(s) || (this.base && replied(this.base, s))) {
                this.refusedAt = -1;
                this.watching = false;
                return false;
            }
            if (s.tick <= this.refusedAt || unsettled(s) || this.counts.refusedResends >= MAX_REFUSED_RESENDS) return false;
            this.counts.refusedResends++;
            void this.send();
            return true;
        }
        if (!this.watching) return false;
        if (this.answered(s) || (this.base && replied(this.base, s))) {
            this.watching = false;
            return false;
        }
        if (s.tick - this.reachedAt < REPLY_TICKS || unsettled(s)) return false;
        this.watching = false;
        this.counts.unansweredResends++;
        void this.send();
        return true;
    }

    /** The counts as a result's JumpCounts (zero fields left out). */
    report(settleTicks = 0): JumpCounts {
        return {
            ...(settleTicks ? { settleTicks } : {}),
            ...(this.counts.refusedResends ? { refusedResends: this.counts.refusedResends } : {}),
            ...(this.counts.unansweredResends ? { unansweredResends: this.counts.unansweredResends } : {}),
        };
    }
}

const invKey = (s: BotWorldState) => s.inventory.map(i => `${i.slot}:${i.id}:${i.count}`).join(',');

/** The combat-event cursor, on messageCursor's rule: the newest event's observation id, or its tick where it has none. */
function fightCursor(s: BotWorldState): number {
    let c = 0;
    for (const e of s.combatEvents ?? []) c = Math.max(c, e.observationId ?? e.tick);
    return c;
}

function snapshot(s: BotWorldState, page: { npc?: string; interrupts?: readonly Interrupt[] } = {}) {
    const p = pos(s);
    return {
        x: p.x, z: p.z, level: p.level, anim: s.player?.animId ?? -1, inv: invKey(s), messages: messageCursor(s), fight: fightCursor(s), modal: s.modalOpen,
        npc: page.npc?.trim().toLowerCase(), interrupts: page.interrupts,
        /** A fight was seen since the send (inFightSince), latched for the rest of this send's window. */
        fought: false,
    };
}

let defendSeqs: ReadonlySet<number> | null = null;

/**
 * The player's block and defend animations: seq.pack's human_*_block, _def and _defence (420
 * human_stafforb_block, 424 human_unarmedblock, 1156 human_shield_defence ...), what combat.rs2
 * combat_defend_anim plays on a hit. No other script plays one on the player but for a hit
 * (dragonfire, Nezikchened, the big-fish event's blow), so one is a fight, never a click's answer.
 */
function defendAnim(id: number): boolean {
    defendSeqs ??= new Set([...configIds('seq')].filter(([name]) => /^human_\w*(block|def|defence)$/.test(name)).map(([, seq]) => seq));
    return defendSeqs.has(id);
}

/** A player target as an NPC publishes it: StateCollector passes faceEntity raw, a player slot + 32768. */
const PLAYER_TARGET = 32768;

/**
 * An attackable NPC beside the player, facing a player: the attacker on the player before any
 * hit of its is published (rs/457: the Khazard commander faces SCORED from t81, SCORED's blocks
 * at t81, t85, t89 come with inCombat false and no combat event; both start at t91). A talker
 * faces the player too (chat.rs2 chatnpc: playerfaceclose), but only an NPC with an Attack
 * option counts, and in a fight a dialogue or a step still answers.
 */
function attackerBeside(s: BotWorldState): boolean {
    const p = pos(s);
    return s.nearbyNpcs.some(n => {
        if (!(n.targetIndex >= PLAYER_TARGET) || !n.options.some(o => /^attack$/i.test(o))) return false;
        if (n.tileX === undefined || n.tileZ === undefined) return n.distance <= 1;
        const size = n.size ?? 1;
        const dx = Math.max(n.tileX - p.x, p.x - (n.tileX + size - 1), 0);
        const dz = Math.max(n.tileZ - p.z, p.z - (n.tileZ + size - 1), 0);
        return Math.max(dx, dz) <= 1;
    });
}

/**
 * The player has been in a fight since the send: a combat event (a hit taken or dealt, blocked or
 * not) published after it, a combat target, a block or defend animation of the player's, or an
 * attacker beside them; once seen, for the rest of the send's window. Its animations (a blocked
 * hit's block, the auto-retaliate swing), its messages and upkeep's eats are the fight's, not the
 * click's, and an eat or the retaliation itself clears the click's pending interaction (rs/391,
 * rs/457: TGV segment H). The lite client publishes inCombat and the hit events of a fight's first
 * ~10 ticks late, so the player's own block and the attacker's facing are what mark them.
 */
function inFightSince(b: ReturnType<typeof snapshot>, s: BotWorldState): boolean {
    if (b.fought) return true;
    b.fought = !!s.player?.combat?.inCombat
        || (s.combatEvents ?? []).some(e => (e.observationId ?? e.tick) > b.fight)
        || defendAnim(s.player?.animId ?? -1)
        || attackerBeside(s);
    return b.fought;
}

/** npcchat1-4's name component (interface.pack npcchatN:com_1, which chat.rs2 chatnpc_page sets to the speaker's name). */
let npcChatNames: ReadonlySet<number> | null = null;

/** The NPC speaking on the open page, or undefined when it is not an NPC's chat page (the player's, a message box, a choice). */
function npcSpeaker(s: BotWorldState): string | undefined {
    if (!npcChatNames) {
        const ids = configIds('interface');
        npcChatNames = new Set([1, 2, 3, 4].map(n => ids.get(`npcchat${n}:com_1`)).filter((id): id is number => id !== undefined));
    }
    const name = s.dialog.allComponents?.find(c => npcChatNames!.has(c.id))?.text;
    return name === undefined ? undefined : name.trim().toLowerCase();
}

/** The open page is the click's answer: not a page the caller dismisses, nor another NPC's chat when the click talks to an NPC. */
function pageAnswers(b: ReturnType<typeof snapshot>, s: BotWorldState): boolean {
    if (!s.dialog.isOpen || matchInterrupt(b.interrupts, s)) return false;
    const speaker = b.npc ? npcSpeaker(s) : undefined;
    return speaker === undefined || speaker === b.npc;
}

/**
 * The engine's first answer to a click since `b` was taken: 'script' when its script has started
 * (a dialogue or modal, a new animation, a game message, an inventory change), 'moved' when the
 * only answer is a step, null when nothing yet. Other players' chat, "I can't reach that!" (the
 * click failing) and a page the click did not open (pageAnswers) are not answers. In a fight since
 * the send only a dialogue, a modal or a step answers: the fight makes the animations, messages and
 * inventory changes (inFightSince).
 */
function replyKind(b: ReturnType<typeof snapshot>, s: BotWorldState): 'script' | 'moved' | null {
    // A modal already open at the send (S00's character design) is not an answer.
    if (pageAnswers(b, s) || (s.modalOpen && !b.modal)) return 'script';
    if (inFightSince(b, s)) return moved(b, s);
    const anim = s.player?.animId ?? -1;
    if (anim >= 0 && anim !== b.anim) return 'script';
    // Past the cursor, not past the send's tick: the browser stamps a reply with the click's own tick.
    if (s.gameMessages.some(m => (m.observationId ?? m.tick) > b.messages && !PLAYER_CHAT_TYPES.includes(m.type) && !CANT_REACH.test(m.text))) return 'script';
    if (invKey(s) !== b.inv) return 'script';
    return moved(b, s);
}

function moved(b: ReturnType<typeof snapshot>, s: BotWorldState): 'moved' | null {
    const p = pos(s);
    return p.x !== b.x || p.z !== b.z || p.level !== b.level ? 'moved' : null;
}

/** Ticks before a send in which a script's message still marks the player as busy with that script. */
const BUSY_TICKS = 2;

/** An earlier script is still answering: an animation is playing, or it sent a game message in the last BUSY_TICKS ticks. */
function busyAt(s: BotWorldState): boolean {
    if ((s.player?.animId ?? -1) >= 0) return true;
    return s.gameMessages.some(m => m.tick >= s.tick - BUSY_TICKS && !PLAYER_CHAT_TYPES.includes(m.type) && !CANT_REACH.test(m.text));
}

function replied(b: ReturnType<typeof snapshot>, s: BotWorldState): boolean {
    return replyKind(b, s) !== null;
}

type DismissSdk = Pick<BotSDK, 'getState' | 'sendClickDialog' | 'clickDialogByText' | 'sendCloseModal'>;

/** Send `click`, then wait for `done`, re-sending a click that was evidently dropped. */
export async function act(sdk: StateSource & Partial<DismissSdk>, click: () => Promise<unknown>, done: Pred, opts: ActOptions = {}): Promise<ActResult> {
    const t0 = sdk.getState()?.tick ?? 0;
    const every = opts.resendEvery ?? 6;
    const maxResends = opts.maxResends ?? 5;
    const interrupts = opts.interrupts?.length ? opts.interrupts : undefined;
    if (interrupts && !(sdk.sendClickDialog && sdk.clickDialogByText && sdk.sendCloseModal)) throw new Error('act: interrupts need an sdk that can click and close dialogues');
    let resends = 0;
    let dismissed = 0;
    let dismissedKey: string | null = null;
    let dismissedAt = -Infinity;
    let resendAfterInterrupt = false;
    const settled = await settle(sdk, opts.maxTicks ?? 60);
    if (!settled.ok) return { ok: false, ticks: settled.ticks, resends: 0, settleTicks: settled.ticks, reason: 'the region never finished loading' };
    const guard = new ClickGuard(sdk, click, done, { interrupts });
    const t1 = sdk.getState()?.tick ?? t0;
    let sent = t1;
    let still = t1;
    let last: Tile = pos(sdk);
    await guard.send();
    const r = await waitUntil(
        sdk,
        s => {
            if (done(s)) return true;
            const p = pos(s);
            if (p.x !== last.x || p.z !== last.z || p.level !== last.level) still = s.tick;
            last = p;
            if (guard.step(s)) {
                sent = s.tick;
                still = s.tick;
                return false;
            }
            if (interrupts) {
                const d = s.dialog;
                if (d.isOpen) {
                    const key = d.pageId ?? pageText(d);
                    // One dismissal per page; the same page still up 3 ticks later had its click dropped.
                    const it = !d.isWaiting && (key !== dismissedKey || s.tick - dismissedAt >= 3) ? matchInterrupt(interrupts, s) : undefined;
                    if (it) {
                        dismissedKey = key;
                        dismissedAt = s.tick;
                        dismissed++;
                        resendAfterInterrupt = true;
                        void dismissInterrupt(sdk as DismissSdk, it);
                    }
                    return false;
                }
                if (resendAfterInterrupt) {
                    resendAfterInterrupt = false;
                    sent = s.tick;
                    still = s.tick;
                    resends++;
                    void guard.send();
                    return false;
                }
            }
            // The idle re-send is only for a click that drew nothing: one whose script answered has
            // landed, and re-sending it would restart the script (rs/257: Dwarf Cannon's railing).
            if (every <= 0 || resends >= maxResends || s.dialog.isOpen || guard.scriptAnswered || guard.pending) return false;
            if (guard.refusedBy(s) || (s.tick - Math.max(sent, still, guard.replyFrom) >= every)) {
                sent = s.tick;
                still = s.tick;
                resends++;
                void guard.send();
            }
            return false;
        },
        { maxTicks: opts.maxTicks ?? 60 }
    );
    return {
        ok: r.ok, ticks: r.tick - t0, resends, ...guard.report(settled.ticks),
        ...(interrupts ? { interrupts: dismissed } : {}), ...(r.ok ? {} : { reason: 'timeout' }),
    };
}

export interface ActConverseOptions extends ActOptions, Omit<ConverseOptions, 'until' | 'openTicks'> {
    /** Required effect, latched the first time it holds, even while dialogue is open. */
    done?: Pred;
    /** Without a required effect, give up if no dialogue opens within this many ticks (default 30). */
    openTicks?: number;
}

export interface ActConverseResult extends ActResult {
    startTick: number;
    /** Later of the first effect and the final dialogue closing; on failure, the tick we stopped. */
    endTick: number;
    /** First tick done held, or -1 when absent or never observed. */
    effectTick: number;
    dialogue?: ConverseResult;
}

/**
 * Click and retry with act, then answer with converse. With done, both its
 * first observed effect and any dialogue must finish; without it, a dialogue
 * must open. Once either is seen the action is never re-sent.
 *
 * After an effect, allow idle ticks (default 3) for a delayed first page.
 * An already-true done still sends the click and waits this grace window.
 * Successful ticks exclude settling time. maxTicks (default 300) is shared
 * by the action and conversation, not restarted between them.
 */
export async function actConverse(sdk: ConverseSdk, click: () => Promise<unknown>, choices: OptionPattern[] = [], opts: ActConverseOptions = {}): Promise<ActConverseResult> {
    const startTick = sdk.getState()?.tick ?? 0;
    const maxTicks = opts.maxTicks ?? 300;
    const idle = opts.idle ?? 3;
    let effectTick = -1;
    const observe = (s: BotWorldState) => {
        if (effectTick < 0 && opts.done?.(s)) effectTick = s.tick;
    };
    const stop = sdk.onStateUpdate(observe);
    try {
        const cur = sdk.getState();
        if (cur) observe(cur);
        // An interrupt page is not the action's dialogue: act dismisses it and re-sends.
        const a = await act(sdk, click, s => (s.dialog.isOpen && !matchInterrupt(opts.interrupts, s)) || effectTick >= 0, {
            ...opts,
            maxTicks: opts.done ? maxTicks : Math.min(opts.openTicks ?? 30, maxTicks),
        });
        if (!a.ok) {
            return { ...a, startTick, endTick: startTick + a.ticks, effectTick, reason: opts.done ? 'done never held' : 'no dialogue opened' };
        }
        const dialogue = await converse(sdk, choices, {
            ...opts,
            idle,
            openTicks: idle,
            until: opts.done ? () => effectTick >= 0 : undefined,
            maxTicks: Math.max(0, maxTicks - ((sdk.getState()?.tick ?? startTick) - startTick)),
        });
        // converse intentionally permits no dialogue, but a required effect
        // must not be mistaken for that successful no-op.
        const ok = dialogue.ok && (opts.done ? effectTick >= 0 : dialogue.opened);
        const endTick = ok
            ? Math.max(effectTick, dialogue.endTick)
            : (sdk.getState()?.tick ?? startTick);
        return {
            ok, ticks: endTick - startTick, resends: a.resends,
            startTick, endTick, effectTick, dialogue,
            ...(ok ? {} : { reason: !dialogue.ok ? dialogue.reason : opts.done ? 'done never held' : 'no dialogue opened' }),
        };
    } finally {
        stop();
    }
}

/** The inventory slot of the first item matching `item`; throws when there is none. */
export function slotOf(sdk: StateSource, item: ItemPattern): number {
    const it = invItem(sdk, item);
    if (!it) throw new Error(`no ${String(item)} in the inventory`);
    return it.slot;
}

/**
 * Interact with a loc: one found by `q` (or that loc itself), with the option
 * matching `op` (or that opIndex). Without `done` it only sends.
 */
export async function opLoc(sdk: ActSdk, q: LocQuery | NearbyLoc, op: OpPattern | number, done?: Pred, opts: ActOptions = {}): Promise<ActResult & { loc: NearbyLoc }> {
    const loc = 'optionsWithIndex' in q ? q : await findLoc(sdk, { ...q, ...(typeof op === 'number' ? {} : { op }) });
    if (!loc) throw new Error(`no loc ${JSON.stringify({ ...q, op: String(op) })} near ${JSON.stringify(pos(sdk))}`);
    const o = typeof op === 'number' ? op : opIndex(loc, op);
    if (o === undefined) throw new Error(`${loc.name} at ${loc.x},${loc.z} has no option ${op}: ${loc.options.join('/')}`);
    const click = () => sdk.sendInteractLoc(loc.x, loc.z, loc.id, o);
    if (!done) {
        await click();
        return { ok: true, ticks: 0, resends: 0, loc };
    }
    return { ...(await act(sdk, click, done, opts)), loc };
}

/** Open the closed door or gate at (x, z) and wait until no closed one is left there. A door that is already open is ok at 0 ticks. */
export async function openDoor(sdk: ActSdk, x: number, z: number, opts: ActOptions = {}): Promise<ActResult> {
    const closedHere = (l: NearbyLoc) => l.x === x && l.z === z && /door|gate/i.test(l.name) && opIndex(l, /^open$/i) !== undefined;
    const door = await findLoc(sdk, { x, z, op: /^open$/i, name: /door|gate/i });
    if (!door) return { ok: true, ticks: 0, resends: 0 };
    return act(sdk, () => sdk.sendInteractLoc(door.x, door.z, door.id, opIndex(door, /^open$/i)!), s => !s.nearbyLocs.some(closedHere), { resendEvery: 5, maxTicks: 30, ...opts });
}

export interface TalkOptions extends ConverseOptions {
    /** The NPC option that opens the conversation (default Talk-to). */
    op?: OpPattern;
    /** Ticks to wait for the NPC to come into view (default 10). */
    findTicks?: number;
    /** Sort candidates by distance to this tile. */
    near?: { x: number; z: number };
    /** Clicks to try when no dialogue opens (default 3). */
    attempts?: number;
    /**
     * Finds the talk's approach may make (approach.ts approachNpc: doors opened, a run to within 1
     * of the live tile) after a click that came back unrouted or cant_reach opened nothing (default
     * 2; 0 turns it off). A caller that approached before the talk passes what is left of its budget.
     */
    refinds?: number;
}

/**
 * Talk to the nearest matching NPC and answer the conversation. A click that
 * opens nothing within `openTicks` is sent again, as a player would. Each click
 * goes out under the jump rules (`ClickGuard`): after a settled position, with a
 * refused send re-sent on the next tick and a post-jump click that draws no
 * reply re-sent once, while the conversation listens. The result's ticks run
 * from the call. A click whose send came back unrouted (the browser) or
 * cant_reach (lite) and opened nothing means the NPC is behind something (a
 * door shut behind it): before the next click the talk opens the doors toward
 * its live tile and runs to within 1 of it (approach.ts approachNpc, within
 * `refinds` finds), then clicks the NPC as found there. A talk with `until`
 * whose chat closes mid-talk (a poison tick's if_close) is re-engaged with the
 * same click (converse.ts `reopen`).
 */
export async function talkTo(sdk: ActSdk & ConverseSdk, npc: NamePattern | NearbyNpc, choices: OptionPattern[] = [], opts: TalkOptions = {}): Promise<ConverseResult & JumpCounts & { npc: NearbyNpc; clicks: number; approachFinds?: number }> {
    let n = typeof npc === 'object' && 'index' in npc ? npc : await waitForNpc(sdk, npc, opts.findTicks ?? 10, opts.near);
    if (!n) throw new Error(`no npc ${String(npc)} near ${JSON.stringify(pos(sdk))}`);
    const travel = typeof (sdk as Partial<TravelSdk>).findPath === 'function' ? (sdk as unknown as TravelSdk) : null;
    const budget = opts.refinds ?? 2;
    let approachFinds = 0;
    const op = opIndex(n, opts.op ?? /^talk-to$/i) ?? 1;
    const t0 = sdk.getState()?.tick ?? 0;
    const attempts = opts.attempts ?? 3;
    const settled = await settle(sdk, opts.maxTicks ?? 60);
    const counts = { refusedResends: 0, unansweredResends: 0 };
    let remaining = choices;
    for (let clicks = 1; ; clicks++) {
        // The answer is this NPC's conversation opening (replyKind), not any page: see ClickGuard's npc.
        const target = n;
        let unrouted = false;
        const guard = new ClickGuard(sdk, () => sdk.sendInteractNpc(target.index, op).then(res => { if (unroutedReply(res)) unrouted = true; return res; }), undefined, { npc: target.name, interrupts: opts.interrupts });
        // A talk cut short (a poison tick's if_close) is re-engaged with this same click (converse `reopen`).
        const conv = converse(sdk, remaining, { ...opts, reopen: () => guard.send() });
        const stop = sdk.onStateUpdate(s => void guard.step(s));
        await guard.send();
        const r = await conv.finally(stop);
        counts.refusedResends += guard.counts.refusedResends;
        counts.unansweredResends += guard.counts.unansweredResends;
        if (r.opened || clicks >= attempts) {
            const jump: JumpCounts = {
                ...(settled.ticks ? { settleTicks: settled.ticks } : {}),
                ...(counts.refusedResends ? { refusedResends: counts.refusedResends } : {}),
                ...(counts.unansweredResends ? { unansweredResends: counts.unansweredResends } : {}),
            };
            return { ...r, ...jump, startTick: t0, ticks: r.opened ? r.endTick - t0 : 0, npc: target, clicks, ...(approachFinds ? { approachFinds } : {}) };
        }
        remaining = r.remaining;
        if (unrouted && travel && approachFinds < budget) {
            const a = await approachNpc(travel, target.id, { near: opts.near ?? npcTile(target), findTicks: opts.findTicks ?? 10, refinds: budget - approachFinds - 1, interrupts: opts.interrupts });
            approachFinds += a.finds;
            if (a.npc) n = a.npc;
        }
    }
}

/** Use an inventory item's option (Wear, Rub, Read, Bury...), then wait for `done` if given. */
export async function invOp(sdk: ActSdk, item: ItemPattern, op: OpPattern, done?: Pred, opts: ActOptions = {}): Promise<ActResult> {
    const it = invItem(sdk, item);
    if (!it) throw new Error(`no ${String(item)} in the inventory`);
    const o = opIndex(it, op);
    if (o === undefined) throw new Error(`${it.name} has no option ${op}: ${it.optionsWithIndex.map(x => x.text).join('/')}`);
    const click = () => sdk.sendUseItem(invItem(sdk, item)?.slot ?? it.slot, o);
    if (!done) {
        await click();
        return { ok: true, ticks: 0, resends: 0 };
    }
    return act(sdk, click, done, { resendEvery: 3, maxTicks: 10, ...opts });
}

/**
 * What to use an item on. A loc given with its tile and id (or a NearbyLoc) is
 * clicked as is, with no lookup, so locs the client does not list (bridged
 * levels) work; any other loc query goes through `findLoc`. An NPC is the
 * nearest match (or that NPC). An item is the first inventory match other
 * than the used item's own slot.
 */
export type UseTarget = { loc: LocQuery | NearbyLoc } | { npc: NamePattern | NearbyNpc } | { item: ItemPattern };

export interface UseOnOptions {
    /** Give up after this many ticks (default 60). */
    maxTicks?: number;
    /**
     * Opt-in blind re-send, act's rule: after this many ticks standing still
     * with no dialogue open. Default 0, because most uses spend the item or
     * start an action, and a second click can spend a second item.
     */
    resendEvery?: number;
    /**
     * Re-send a click that evidently did nothing: none of movement, an
     * animation, a dialogue or modal, a game message or an inventory change
     * for this many ticks after the send (or after the last step walked toward
     * the target). "I can't reach that!" counts as nothing at once. Default 6;
     * 0 never re-sends.
     */
    droppedAfter?: number;
    /** At most this many re-sends of either kind (default 2). */
    maxResends?: number;
}

export interface UseOnResult extends ActResult {
    /** Something other than walking was seen after a send: the use reached the server. */
    landed: boolean;
    /** The send, as clicked. */
    target: { kind: 'loc'; x: number; z: number; id: number } | { kind: 'npc'; index: number; name: string } | { kind: 'item'; slot: number; name: string };
}

const invSignature = (s: BotWorldState) => s.inventory.map(i => `${i.slot}:${i.id}:${i.count}`).join(',');

/**
 * Use an inventory item on a loc, an NPC or another item, and wait for `done`.
 * Unlike `act`, it does not re-send blindly by default (see UseOnOptions).
 */
export async function useOn(sdk: ActSdk, item: ItemPattern, target: UseTarget, done: Pred, opts: UseOnOptions = {}): Promise<UseOnResult> {
    const used = invItem(sdk, item);
    if (!used) throw new Error(`useOn: no ${String(item)} in the inventory`);
    const slotNow = () => invItem(sdk, item)?.slot ?? used.slot;
    let click: () => Promise<unknown>;
    let sent: UseOnResult['target'];
    if ('loc' in target) {
        const q = target.loc;
        const exact = 'optionsWithIndex' in q || (q.x !== undefined && q.z !== undefined && q.id !== undefined);
        const l = exact ? (q as { x: number; z: number; id: number }) : await findLoc(sdk, q);
        if (!l) throw new Error(`useOn: no loc ${JSON.stringify(q)} near ${JSON.stringify(pos(sdk))}`);
        sent = { kind: 'loc', x: l.x, z: l.z, id: l.id };
        click = () => sdk.sendUseItemOnLoc(slotNow(), l.x, l.z, l.id);
    } else if ('npc' in target) {
        const t = target.npc;
        const n = typeof t === 'object' && 'index' in t ? t : await waitForNpc(sdk, t, 10);
        if (!n) throw new Error(`useOn: no npc ${String(t)} near ${JSON.stringify(pos(sdk))}`);
        sent = { kind: 'npc', index: n.index, name: n.name };
        click = () => sdk.sendUseItemOnNpc(slotNow(), n.index);
    } else {
        const pattern = target.item;
        const other = (src: BotWorldState | null) => src?.inventory.find(i => matchesItem(i, pattern) && i.slot !== (invItem(src, item)?.slot ?? used.slot)) ?? null;
        const o = other(sdk.getState());
        if (!o) throw new Error(`useOn: no ${String(pattern)} to use ${used.name} on`);
        sent = { kind: 'item', slot: o.slot, name: o.name };
        click = () => sdk.sendUseItemOnItem(slotNow(), other(sdk.getState())?.slot ?? o.slot);
    }

    const s0 = sdk.getState();
    const t0 = s0?.tick ?? 0;
    const every = opts.resendEvery ?? 0;
    const droppedAfter = opts.droppedAfter ?? 6;
    const maxResends = opts.maxResends ?? 2;
    let resends = 0;
    let landed = false;
    let sentAt = t0;
    // Each send's replies, from the cursor taken just before it goes out.
    let refusal = replyAfter(sdk, CANT_REACH);
    let reply = replyAfter(sdk, NOT_CANT_REACH);
    let moved = t0;
    let last: Tile = pos(sdk);
    let inv = s0 ? invSignature(s0) : '';
    let anim = s0?.player?.animId ?? -1;
    const resend = (tick: number) => {
        sentAt = tick;
        refusal = replyAfter(sdk, CANT_REACH);
        reply = replyAfter(sdk, NOT_CANT_REACH);
        moved = tick;
        resends++;
        void click();
    };
    await click();
    const r = await waitUntil(
        sdk,
        s => {
            if (done(s)) return true;
            const p = pos(s);
            if (p.x !== last.x || p.z !== last.z || p.level !== last.level) moved = s.tick;
            last = p;
            const a = s.player?.animId ?? -1;
            const sig = invSignature(s);
            const refused = refusal.seen(s);
            if (s.dialog.isOpen || s.modalOpen || (a >= 0 && a !== anim) || sig !== inv || reply.seen(s)) landed = true;
            anim = a;
            inv = sig;
            if (resends >= maxResends || s.dialog.isOpen) return false;
            if (every > 0 && s.tick - Math.max(sentAt, moved) >= every) resend(s.tick);
            else if (!landed && droppedAfter > 0 && (refused || s.tick - Math.max(sentAt, moved) >= droppedAfter)) resend(s.tick);
            return false;
        },
        { maxTicks: opts.maxTicks ?? 60 }
    );
    return { ok: r.ok, ticks: r.tick - t0, resends, landed: landed || r.ok, target: sent, ...(r.ok ? {} : { reason: landed ? 'done never held' : 'timeout' }) };
}

/** Wear or wield the first matching item, confirmed by the equipment list. */
export async function wield(sdk: ActSdk, item: ItemPattern, opts: ActOptions = {}): Promise<ActResult> {
    if (worn(sdk, item)) return { ok: true, ticks: 0, resends: 0 };
    return invOp(sdk, item, /^(wear|wield|hold)$/i, s => worn(s, item) !== null, opts); // a gree-gree is held
}

/** Pick up the nearest ground item matching `item` and wait until the inventory holds more of it. */
export async function pickup(sdk: ActSdk, item: ItemPattern, opts: ActOptions = {}): Promise<ActResult & { item: GroundItem }> {
    const near = (list: GroundItem[]) => list.filter(g => matchesItem(g, item)).sort((a, b) => a.distance - b.distance)[0];
    const g = near(sdk.getState()?.groundItems ?? []) ?? near(await sdk.scanGroundItems(25));
    if (!g) throw new Error(`no ground ${String(item)} near ${JSON.stringify(pos(sdk))}`);
    const before = invCount(sdk, item);
    const r = await act(sdk, () => sdk.sendPickup(g.x, g.z, g.id), s => invCount(s, item) > before, { resendEvery: 3, maxTicks: 40, ...opts });
    return { ...r, item: g };
}

/** Drop every inventory item `which` selects, fired at once, and wait until they are gone. */
export async function dropItems(sdk: ActSdk, which: (i: { id: number; name: string }) => boolean, maxTicks = 10): Promise<ActResult> {
    const items = (sdk.getState()?.inventory ?? []).filter(which);
    if (!items.length) return { ok: true, ticks: 0, resends: 0 };
    const gone = (s: BotWorldState) => !items.some(d => s.inventory.some(i => i.slot === d.slot && i.id === d.id));
    return act(sdk, () => Promise.all(items.map(i => sdk.sendDropItem(i.slot))), gone, { resendEvery: 0, maxTicks });
}

export interface WalkResult extends ActResult {
    tiles: number;
    at: Tile;
}

/**
 * Walk by clicking the destination tile (the client's own router), clicking
 * again when the player stops short. For areas the SDK's long-path map does
 * not cover (bridged floors), where `bot.walkTo` finds no waypoints.
 */
export async function clickWalk(sdk: ActSdk, x: number, z: number, opts: ActOptions & { tol?: number } = {}): Promise<WalkResult> {
    const tiles = tileCounter(sdk);
    const level = pos(sdk).level;
    const r = await act(sdk, () => sdk.sendWalk(x, z, true), s => pos(s).level === level && chebyshev(pos(s), { x, z }) <= (opts.tol ?? 0), { resendEvery: 3, maxTicks: 60, maxResends: 20, ...opts });
    tiles.stop();
    return { ...r, tiles: tiles.tiles, at: pos(sdk) };
}

/**
 * `bot.walkTo` (the SDK pathfinder, doors opened on the way), retried when it
 * reports failure (it occasionally reports Stuck on open ground), with the
 * tiles actually stepped. It costs about 0.57 ticks per route tile against
 * 0.5 for chained clicks (docs/speedrun/quests/primitives.md).
 */
export async function walkTo(bot: Pick<BotActions, 'walkTo'>, sdk: StateSource, x: number, z: number, tol = 0, retries = 3): Promise<WalkResult & { message: string }> {
    const t0 = sdk.getState()?.tick ?? 0;
    const tiles = tileCounter(sdk);
    let r = await bot.walkTo(x, z, tol);
    for (let i = 0; i < retries && !r.success; i++) r = await bot.walkTo(x, z, tol);
    tiles.stop();
    return { ok: r.success, ticks: (sdk.getState()?.tick ?? t0) - t0, resends: 0, tiles: tiles.tiles, at: pos(sdk), message: r.message ?? '' };
}

/** Standard-spellbook teleports: the spell's IF_BUTTON component (server/content/pack/interface.pack). */
export const TELEPORTS = { varrock: 1164, lumbridge: 1167, falador: 1170, camelot: 1174, ardougne: 1540 } as const;

/** What teleport.rs2 and check_spell_requirements say when they refuse a cast. */
export const TELEPORT_REFUSED = /mysterious force blocks|can't use this teleport|do not have enough|not high enough|must have completed|haven't learnt how to cast|cannot teleport/i;

/**
 * Cast a teleport and wait until the player has jumped more than 30 tiles, or has left its tile for
 * one where `landed` holds (a cast from 30 tiles or less of the landing: Lumbridge from the river
 * fly spots is exactly 30); one re-cast if the first is dropped. A refusal message ends the wait
 * at once with `ok: false` and a `refused: ...` reason. travel.ts `teleport` adds the precheck,
 * the landing tile and the walk on refusal.
 *
 * The re-cast is `act`'s idle re-send at its default bound, as for any world click. A cast that
 * landed answers on its first tick (teleport.rs2: the cast animation and the runes taken, the jump
 * two ticks later), which latches `scriptAnswered`, so a slow landing (a browser region rebuild)
 * is never re-cast; only a cast that drew nothing is, 6 ticks after it reached the server.
 */
export async function castTeleport(sdk: ActSdk, spell: keyof typeof TELEPORTS | number, maxTicks = 25, landed?: Pred): Promise<ActResult & { at: Tile }> {
    const p0 = pos(sdk);
    const refused = replyAfter(sdk, TELEPORT_REFUSED);
    const component = typeof spell === 'number' ? spell : TELEPORTS[spell];
    let refusal: string | undefined;
    const r = await act(
        sdk,
        () => sdk.sendClickComponent(component),
        s => {
            const d = chebyshev(pos(s), p0);
            if (d > 30 || pos(s).level !== p0.level || (d > 0 && landed?.(s))) return true;
            if (!refused.seen(s)) return false;
            refusal = refused.first();
            return true;
        },
        { maxResends: 1, maxTicks }
    );
    return refusal !== undefined ? { ...r, ok: false, reason: `refused: ${refusal}`, at: pos(sdk) } : { ...r, at: pos(sdk) };
}
