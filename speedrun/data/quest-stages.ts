// Quest stage tables for the scored route: every quest's progress varp, its
// stage values, the quest points it grants and how its journal text reads at
// each stage, each value cited to the content script it was read from.
//
// What a client can observe (docs/speedrun/quests/quest-state.md):
//  - The progress varps themselves are server-only. None of them is declared
//    `transmit=yes`, and the engine only sends VARP_SMALL/VARP_LARGE for
//    transmitted varps, so `varp` below is reference data, never read live.
//  - BotWorldState.quests[key]: not_started / started / complete, from the quest
//    tab's colours (`questList` is the component whose colour carries it).
//  - BotWorldState.questPoints: the transmitted `qp` varp (101).
//  - The exact stage, on demand: open the journal and match `journal` markers
//    (speedrun/lib/quests.ts readQuestStage).
//
// Paths in `source` are relative to server/content/scripts/.
//
// Journal markers: `journal` is a phrase from the stage's journal text with
// colour tags (@dbl@, @str@, ...) and line breaks removed and whitespace
// collapsed. It must appear in that stage's text and in no other stage's
// text, whatever the inventory holds (several journals strike items through
// as they are collected, so markers avoid those lines). A stage without a
// marker shares its journal text with a neighbour, and readQuestStage reports
// the range. Markers are matched case-sensitively as substrings.

export interface QuestStage {
    /** The content constant's name without the quest prefix, e.g. `started`. */
    name: string;
    value: number;
    /** Unique phrase of this stage's journal text (see the header). */
    journal?: string;
    source: string;
}

export interface QuestTable {
    /** Key in BotWorldState.quests and the quest-list component name (questlist:<key>). */
    key: string;
    /** Quest-tab text. */
    title: string;
    /** Header of its journal (`~quest_journal` first argument); several differ from the title. */
    journalTitle: string | null;
    /** The progress varp (server-only, see the header). */
    varp: { name: string; id: number; source: string };
    questPoints: number;
    /** Value at which the quest counts as complete, and how the engine compares it. */
    complete: { value: number; test: '=' | '>='; source: string };
    /** Interface component (questlist:<key>) whose colour carries the status; null when off the list. */
    questList: { componentId: number; source: string } | null;
    /** Stages in ascending value. Includes the completion value and any post-completion values. */
    stages: QuestStage[];
    notes?: string;
}

const VARP_PACK = 'server/content/pack/varp.pack';
const IF_PACK = 'server/content/pack/interface.pack';
const QUEST_CONSTANT = 'general/configs/quest.constant';

export const QUESTS = {
    doric: {
        key: 'doric',
        title: "Doric's Quest",
        journalTitle: "Dorics' Quest",
        varp: { name: 'doricquest', id: 31, source: `${VARP_PACK}: 31=doricquest; quests/quest_doric/configs/quest_doric.varp` },
        questPoints: 1,
        complete: { value: 100, test: '=', source: `${QUEST_CONSTANT}: ^doric_complete = 100; general/scripts/quests.rs2 count_questpoints` },
        questList: { componentId: 7336, source: `${IF_PACK}: 7336=questlist:doric` },
        stages: [
            { name: 'not_started', value: 0, journal: 'I can start this quest by talking to Doric', source: 'quests/quest_doric/scripts/doric_journal.rs2:4' },
            { name: 'started', value: 10, journal: 'I need to collect some items and bring them to Doric', source: 'quests/quest_doric/scripts/quest_doric.rs2:59; doric_journal.rs2:6' },
            { name: 'complete', value: 100, journal: 'Doric rewarded me for all my hard work', source: 'quests/quest_doric/scripts/quest_doric.rs2:98; doric_journal.rs2:28' },
        ],
    },
    cook: {
        key: 'cook',
        title: "Cook's Assistant",
        journalTitle: "The Cook's Quest",
        varp: { name: 'cookquest', id: 29, source: `${VARP_PACK}: 29=cookquest; quests/quest_cook/configs/quest_cook.varp` },
        questPoints: 1,
        complete: { value: 2, test: '=', source: `${QUEST_CONSTANT}: ^cook_complete = 2; general/scripts/quests.rs2 count_questpoints` },
        questList: { componentId: 7333, source: `${IF_PACK}: 7333=questlist:cook` },
        stages: [
            { name: 'not_started', value: 0, journal: 'I can start this quest by speaking to the Cook', source: 'quests/quest_cook/scripts/cook_journal.rs2:4' },
            { name: 'started', value: 1, journal: "birthday and I have to help his Cook make him a birthday cake", source: 'quests/quest_cook/scripts/quest_cook.rs2:32; cook_journal.rs2:6' },
            { name: 'complete', value: 2, journal: 'the cook made a delicious looking cake with them', source: 'quests/quest_cook/scripts/quest_cook.rs2:88; cook_journal.rs2:27' },
        ],
    },
} as const satisfies Record<string, QuestTable>;

export type QuestKey = keyof typeof QUESTS;
export type StageName<K extends QuestKey> = (typeof QUESTS)[K]['stages'][number]['name'];

/** Every quest on the route, in run order (docs/speedrun/quests/README.md section 4). */
export const ROUTE_QUESTS: readonly QuestKey[] = ['doric', 'cook'];
