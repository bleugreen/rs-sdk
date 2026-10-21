// Quest state as the client can see it.
//
// Quest progress varps (%doricquest, %elenaquest, ...) are server-only: none is
// declared `transmit=yes` in server/content, and the engine sends VARP_SMALL /
// VARP_LARGE only for transmitted varps. What does reach the client, on any
// server running this content:
//
// - A handful of transmitted varps, of which PUBLISHED_VARPS is the whitelist
//   bots need: quest points and two sticky settings no other field carries.
// - The quest tab's colours. The server sends IF_SETCOLOUR red / yellow / green
//   (not started / started / complete) for every quest at login
//   (~update_questlist), when a quest starts (~send_quest_progress) and when it
//   completes (~send_quest_complete), all in general/scripts/quests.rs2. The
//   cache's own colour for these components is red, so a client that has not
//   had the login update yet reads every quest as not started.
// - The quest journal. Clicking a quest-tab entry runs ~quest_journal
//   (player/scripts/quest_journal.rs2), which writes the title and all 50 lines
//   with IF_SETTEXT, then opens the scroll with IF_OPENMAIN. The text is a
//   function of the quest's stage, so a reader can map it back to the stage
//   (speedrun/data/quest-stages.ts).
//
// Component and varp ids are from server/content/pack/interface.pack and
// varp.pack.

import IfType from '#/config/IfType.js';

import type { QuestJournalState, QuestStatus } from './types.js';

/** Transmitted varps published in BotState.varps, by content name. */
export const PUBLISHED_VARPS = {
    /** Quest points (~update_questpoints). */
    qp: 101,
    /** 1 while run is toggled on. */
    option_run: 173,
    /** 1 while the bank withdraws notes (also BankState.noteMode, which is only published with the bank open). */
    bankcert: 115
} as const;

export type PublishedVarp = keyof typeof PUBLISHED_VARPS;

/**
 * Every quest-tab entry (questlist:<key>), in the order ~update_questlist sends
 * them. The key is the content's own name for the quest, which can differ from
 * the title (elena is Plague City, mm is Monkey Madness).
 */
export const QUEST_LIST_COMPONENTS: Readonly<Record<string, number>> = {
    runemysteries: 7335, doric: 7336, cook: 7333, romeojuliet: 7343, hetty: 7348, chompybird: 673,
    priest: 7337, squire: 7346, imp: 7340, druid: 7355, gobdip: 7338, sheep: 7344, fluffs: 7360,
    demon: 7334, prince: 7342, fortress: 7332, haunted: 7339, hunt: 7341, drunkmonk: 7369,
    vampire: 7347, totem: 7381, fishingcompo: 7359, scorpcatcher: 7373, zanaris: 7367, dragon: 7383,
    blackarmgang: 7345, elena: 7372, seaslug: 7374, arthur: 7368, tree: 7380, waterfall: 7350,
    grail: 7364, ball: 7351, murder: 7370, itexam: 7354, misc: 6518, hazeelcult: 7362, hero: 7363,
    itgronigen: 7371, arena: 7358, junglepotion: 7365, ikov: 7378, biohazard: 7352, sheepherder: 7375,
    mcannon: 7356, cog: 7353, grandtree: 7361, upass: 9927, zombiequeen: 7376, crest: 7357,
    desertrescue: 7379, itwatchtower: 7349, legends: 7366, elemental_workshop: 7459, priestperil: 8115,
    druidspirit: 8137, death: 8438, troll: 191, troll_love: 11858, tbwt: 1740, mortton: 8969,
    regicide: 8576, viking: 10115, horror: 10135, eadgar: 8679, mm: 11132, routequest: 11907,
    hauntedmine: 11857
};

/** questjournal_scroll: the modal, its title, and qj1..qj50 (8146 is the scrollbar, not a line). */
export const QUEST_JOURNAL_MODAL = 8134;
export const QUEST_JOURNAL_TITLE = 8144;
export const QUEST_JOURNAL_LINES: readonly number[] = [8145, ...Array.from({ length: 49 }, (_, i) => 8147 + i)];

/**
 * The quest-tab status a component colour means. The server sends 24-bit
 * ^red_rgb / ^yellow_rgb / ^green_rgb packed to 5 bits a channel, so the client
 * holds 0xF80000 / 0xF8F800 / 0x00F800; the cache default is 0xFF0000. Any
 * other colour is not a status.
 */
export function questStatusOfColour(colour: number): QuestStatus | null {
    const r = (colour >> 16) & 0xff;
    const g = (colour >> 8) & 0xff;
    const b = colour & 0xff;
    if (b !== 0) return null;
    if (r !== 0 && g === 0) return 'not_started';
    if (r !== 0 && g !== 0) return 'started';
    if (r === 0 && g !== 0) return 'complete';
    return null;
}

export function collectVarps(vars: ArrayLike<number> | undefined): Record<PublishedVarp, number> {
    const out = {} as Record<PublishedVarp, number>;
    for (const [name, id] of Object.entries(PUBLISHED_VARPS) as [PublishedVarp, number][]) {
        out[name] = vars?.[id] ?? 0;
    }
    return out;
}

/** Quests the tab shows as started or complete; a quest left out is not started. */
export function collectQuests(): Record<string, 'started' | 'complete'> {
    const out: Record<string, 'started' | 'complete'> = {};
    for (const [key, id] of Object.entries(QUEST_LIST_COMPONENTS)) {
        const com = IfType.list[id];
        if (!com) continue;
        const status = questStatusOfColour(com.colour);
        if (status === 'started' || status === 'complete') out[key] = status;
    }
    return out;
}

/**
 * Keeps the last quest journal seen open. The journal is published after it
 * closes too, so a reader that closes it in the same tick it reads it (or a
 * resume probe that sees it a tick late) still has the text; `tick` says when
 * it was last on screen.
 */
export class QuestJournalTracker {
    private last: QuestJournalState | null = null;

    collect(mainModalId: number, tick: number): QuestJournalState | null {
        if (mainModalId === QUEST_JOURNAL_MODAL) {
            const lines = QUEST_JOURNAL_LINES.map(id => IfType.list[id]?.text ?? '');
            while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
            this.last = { title: stripTags(IfType.list[QUEST_JOURNAL_TITLE]?.text ?? ''), lines, open: true, tick };
            return this.last;
        }
        if (this.last?.open) this.last = { ...this.last, open: false };
        return this.last;
    }
}

/** Remove @xxx@ colour and effect tags. */
export function stripTags(text: string): string {
    return text.replace(/@[a-z0-9]{3}@/gi, '');
}
