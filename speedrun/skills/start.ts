// S00: the tutorial skip on a brand-new account's first login (STEP-MANIFEST.md entry 34).
//
// A fresh account logs in on Tutorial Island with the character-design screen open
// (tutorial.rs2 `[label,start_tutorial]`). Closing it queues %tutorial = designed_character, and
// the RuneScape Guide's first page then asks "Do you want to skip the tutorial?" while
// map_live is false (runescape_guide.rs2); "Yes please." runs `[label,tutorial_complete]`:
// telejump to Lumbridge (3222,3222), the starter kit, every side tab.
//
// The fast path sends the design accept and the talk in the same tick (FIFO puts the accept
// first), answers the guide's question page with a continue the tick it shows, and the choice
// page with a guarded click the tick it shows. The guard is the content's own: the page must ask
// about skipping, and the choice must offer "Yes please.". When the skip is not offered
// (map_live) the step fails: the full tutorial costs far more than any fallback would save.
// On landing it turns run on (lib/run-mode.ts), which no login can do on the island.
//
// The talk goes through lib/act.ts's ClickGuard, which re-sends it once when it draws no reply.
// The guide refuses about one talk in thirty with "I can't reach that!": it wanders, and when it
// stands next to the player the client sends no route, so a step it takes that tick leaves the
// engine nothing to walk.
//
// The waits after the talk, the continue and "Yes please." count from the server tick the click
// reached (lib/wait.ts serverClock), not from the send or the page. A starved browser tab runs a queued click
// only when it has decoded its backlog of ticks, and decodes the reply after the rest of it: with
// the tab throttled 30x from login, the continue sent at tick 4 executed at tick 19, wall time put
// the server near tick 29, and the choice page came at 30.
//
// The landing wait spans a silent window: after the telejump the browser client rebuilds the
// Lumbridge region and publishes nothing until it is built, then publishes the landing as the
// next tick (the rebuild costs no observed ticks). The window is ~0.6 s on a quiet machine and
// grows with a starved tab, so the wait's idle bound is LANDING_IDLE_TICKS, not wait.ts's IDLE_TICKS.

import type { BotWorldState, NearbyNpc } from '../../sdk/types';
import { ClickGuard, settle } from '../lib/act';
import { classifyPage } from '../lib/dialogue';
import { ensureRunOn } from '../lib/run-mode';
import { logNote } from '../lib/ticks';
import { feedTickPeriod, idleBoundMs, serverClock, TickPeriod, waitUntil, type IdleBound } from '../lib/wait';
import { onTutorialIsland } from '../lib/world';
import type { Step, StepContext } from '../runner/step';

export const skill = 'start';

/** Where `[label,tutorial_complete]` lands the player: p_telejump(0_50_50_22_22). */
export const LUMBRIDGE_SPAWN = { x: 3222, z: 3222 } as const;
/** The character-design screen (player_kit). */
export const PLAYER_KIT = 3559;
/**
 * Ticks of the observed tick length the tab may stay silent between "Yes please." and the landing.
 * Measured on the browser client (300 ms ticks): 0.6 s on a quiet machine, growing about linearly
 * with a starved tab (9.3 s at 20x CPU throttle, 21 s at 40x); at load ~165 it outlasted 6 s.
 * 100 ticks covers a tab about 50x starved (measured at 300 ms ticks); a dead client still fails here, and the
 * resumable runner recovers it. The measured table is in speedrun/README.md, section skills/start.ts.
 */
export const LANDING_IDLE_TICKS = 100;
/** Ticks from the talk reaching the server to the guide's page (ClickGuard's one re-send included). */
export const TALK_TICKS = 12;
/** Ticks from the continue reaching the server to the choice page. */
export const CHOICE_TICKS = 6;
/** Ticks from "Yes please." reaching the server to the landing with the starter kit. */
export const LANDING_TICKS = 8;
/** Items of the starter kit the postcondition checks (tutorial.rs2 inv_add list). */
export const STARTER_KIT = [/^bronze axe$/i, /^tinderbox$/i, /^small fishing net$/i, /^bronze pickaxe$/i] as const;

const GUIDE = /^runescape guide$/i;
const SKIP_PAGE = /skip the tutorial/i;
const YES = /^yes please/i;

export function atSpawn(s: BotWorldState): boolean {
    return s.player?.worldX === LUMBRIDGE_SPAWN.x && s.player?.worldZ === LUMBRIDGE_SPAWN.z;
}

export function hasStarterKit(s: BotWorldState): boolean {
    return STARTER_KIT.every(re => s.inventory.some(i => re.test(i.name)));
}

function guideOf(s: BotWorldState): NearbyNpc | undefined {
    return s.nearbyNpcs.find(n => GUIDE.test(n.name));
}

const designOpen = (s: BotWorldState) => s.modalOpen && s.modalInterface === PLAYER_KIT;

/** The open page's text from the dialog history, when it is from this page's tick; '' when unknown. */
function pageBody(s: BotWorldState): string {
    const entry = s.recentDialogs?.[0];
    if (!entry || entry.tick < s.tick - 1) return '';
    return entry.text.join(' ').trim();
}

async function skip(ctx: StepContext<unknown>): Promise<void> {
    // The landing wait's idle bound scales with the tick length this client observes.
    const period = new TickPeriod();
    const unsubscribe = feedTickPeriod(ctx.sdk, period);
    try {
        await skipObserved(ctx, { ticks: LANDING_IDLE_TICKS, period });
    } finally {
        unsubscribe();
    }
}

function where(s: BotWorldState | null): string {
    return s?.player ? `${s.player.worldX},${s.player.worldZ}` : 'unknown';
}

/** The last state, for failure messages: tick, position, page, modal and the last game message. */
function stateTrace(s: BotWorldState | null): string {
    if (!s) return 'no state';
    const d = s.dialog;
    const page = d.isOpen ? `${classifyPage(d)} page${d.isWaiting ? ' (waiting)' : ''}` : 'no page';
    const msg = s.gameMessages.at(-1);
    return `last state tick ${s.tick} at ${where(s)}, ${page}, modal ${s.modalOpen ? s.modalInterface : 'none'}${msg ? `, last message "${msg.text}" (tick ${msg.tick})` : ''}`;
}

/** A click's ticks for failure messages: sent, executed (its action result came back), reached the server. */
interface ClickTicks {
    sent: number;
    executed: number;
    reached: number;
}

const clickTicks = (c: ClickTicks) => `sent ${c.sent}, executed ${c.executed}, reached ${c.reached}`;

async function skipObserved({ sdk, session, log }: StepContext<unknown>, landingIdle: IdleBound): Promise<void> {
    let s = sdk.getState()!;
    const clock = serverClock(s.tick, sdk.getStateReceivedAt?.() || Date.now(), landingIdle.period);
    /** Send a click and wait for its action result: the tab has executed it. */
    const click = async <T>(send: () => Promise<T>): Promise<ClickTicks & { result: T }> => {
        const sent = sdk.getState()?.tick ?? -1;
        const result = await send();
        const executed = sdk.getState()?.tick ?? sent;
        return { sent, executed, reached: Math.max(executed, clock(Date.now())), result };
    };

    // The design screen arrives with the first in-world frames; give it one tick if it is not up yet.
    if (!designOpen(s) && !s.dialog.isOpen) {
        const w = await waitUntil(sdk, st => designOpen(st) || st.dialog.isOpen, { maxTicks: 1 });
        s = w.state ?? s;
    }
    if (designOpen(s)) void sdk.sendAcceptCharacterDesign();

    let guard: ClickGuard | null = null;
    let talkSent = -1;
    let talkLate = 0;
    if (!s.dialog.isOpen) {
        const guide = guideOf(s);
        if (!guide) throw new Error('no RuneScape Guide in view');
        const talk = guide.optionsWithIndex.find(o => /^talk/i.test(o.text));
        if (!talk) throw new Error('the RuneScape Guide has no Talk-to option');
        // The first click after login is the one most often lost (the browser client is still
        // building the region): sent from a settled position, and re-sent once if it draws no reply.
        await settle(sdk);
        guard = new ClickGuard(sdk, () => sdk.sendInteractNpc(guide.index, talk.opIndex), st => st.dialog.isOpen, { alwaysWatch: true, clock });
        talkSent = sdk.getState()?.tick ?? -1;
        await guard.send();
        // The page wait below runs from this tick; a tab behind the server gets the page that much later.
        const executed = sdk.getState()?.tick ?? talkSent;
        talkLate = Math.max(0, clock(Date.now()) - executed);
    }

    // Page one: the guide's question, a continue page.
    const stopGuard = guard ? sdk.onStateUpdate(st => void guard.step(st)) : () => {};
    const asked = await waitUntil(sdk, st => classifyPage(st.dialog) !== 'none' && !st.dialog.isWaiting, { maxTicks: TALK_TICKS + talkLate }).finally(stopGuard);
    const resends = guard?.report() ?? {};
    if (Object.keys(resends).length) logNote(log, session, 'S00:resend', { click: 'talk', ...resends });
    if (!asked.ok) {
        const talked = guard ? `talk sent at tick ${talkSent}${talkLate ? `, reached the server ${talkLate} ticks after it executed` : ''}, re-sends ${JSON.stringify(resends)}; ` : '';
        throw new Error(`the guide did not answer within ${TALK_TICKS} ticks (${talked}${stateTrace(asked.state)})`);
    }
    let page = asked.state;
    if (classifyPage(page.dialog) === 'continue') {
        // The page body is checked when the client published it (dialog history); the lite client
        // leaves it empty, and the choice page below is the guard that always holds.
        const body = pageBody(page);
        if (body && !SKIP_PAGE.test(body)) throw new Error(`the guide's first page does not offer the skip: "${body}"`);
        const cont = await click(() => sdk.sendClickDialog(0));
        const next = await waitUntil(sdk, st => classifyPage(st.dialog) === 'choice', { maxTicks: CHOICE_TICKS + Math.max(0, cont.reached - page.tick), after: page.tick });
        if (!next.ok) throw new Error(`no choice page after the guide's question within ${CHOICE_TICKS} ticks of the continue reaching the server (${clickTicks(cont)}; ${stateTrace(next.state)})`);
        page = next.state;
    }

    // Page two: "Yes please." / "No, thank you."
    if (!page.dialog.options.some(o => YES.test(o.text))) {
        throw new Error(`the skip is not offered (choice: ${page.dialog.options.map(o => o.text).join(' / ')})`);
    }
    const yes = await click(() => sdk.clickDialogByText(YES));
    if (!yes.result.success) throw new Error(`clicking "Yes please.": ${yes.result.message}`);

    const boundMs = idleBoundMs(landingIdle);
    const landed = await waitUntil(sdk, st => atSpawn(st) && hasStarterKit(st), { maxTicks: LANDING_TICKS + Math.max(0, yes.reached - page.tick), after: page.tick, idle: landingIdle });
    if (!landed.ok) {
        const why = landed.reason === 'idle'
            ? `the tab stayed silent past ${LANDING_IDLE_TICKS} ticks, ${(boundMs / 1000).toFixed(1)} s`
            : `${LANDING_TICKS} ticks passed after "Yes please." reached the server (${clickTicks(yes)})`;
        const kit = landed.state && hasStarterKit(landed.state) ? 'with' : 'without';
        throw new Error(`not at Lumbridge with the starter kit after the skip (${why}): last state tick ${landed.tick} (choice page at ${page.tick}), at ${where(landed.state)} ${kit} the kit, silent ${(landed.silentMs / 1000).toFixed(1)} s`);
    }
    // The login could not turn run on (the controls tab is hidden on the island); tutorial_complete opened it.
    // Recorded, never fatal: see lib/run-mode.ts.
    logNote(log, session, 'S00:run', { ...(await ensureRunOn(sdk)) });
}

/** S00 as a step: precondition Tutorial Island, postcondition Lumbridge spawn with the starter kit. */
export const tutorialSkip: Step<any> = {
    name: 'S00 tutorial skip',
    preconditions: s => {
        if (!s.inGame || !s.player) return 'not in game';
        if (!onTutorialIsland(s.player)) return `not on Tutorial Island (at ${s.player.worldX},${s.player.worldZ}): the tutorial is already behind this account`;
        return true;
    },
    run: skip,
    postconditions: s => {
        if (!atSpawn(s)) return `not at ${LUMBRIDGE_SPAWN.x},${LUMBRIDGE_SPAWN.z} (at ${s.player?.worldX},${s.player?.worldZ})`;
        if (!hasStarterKit(s)) return 'the starter kit is not in the inventory';
        // Side tabs are not published in BotWorldState; tutorial_complete opens them in the same script.
        return true;
    },
    logoutSafe: true,
    done: o => !!o.state.player && !onTutorialIsland(o.state.player),
};

/** The step-module convention (`skill`, `steps()`), so a run or the rehearsal harness chains it. */
export function steps(_opts: { to?: number; [k: string]: unknown } = {}): Step<any>[] {
    return [tutorialSkip];
}
