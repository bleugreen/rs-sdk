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
    elena: {
        key: 'elena',
        title: 'Plague City',
        journalTitle: 'Plague City',
        varp: { name: 'elenaquest', id: 165, source: `${VARP_PACK}: 165=elenaquest; _unpack/225/all.varp` },
        questPoints: 1,
        complete: { value: 29, test: '>=', source: `${QUEST_CONSTANT}: ^elena_complete = 29; general/scripts/quests.rs2 count_questpoints` },
        questList: { componentId: 7372, source: `${IF_PACK}: 7372=questlist:elena` },
        stages: [
            { name: 'not_started', value: 0, journal: 'I can start this quest by speaking to Edmond', source: 'quests/quest_elena/scripts/elena_journal.rs2:6' },
            { name: 'started', value: 1, journal: 'I need to get some Dwellberries for Alrena', source: 'quests/quest_elena/scripts/edmond.rs2:79; elena_journal.rs2:16' },
            { name: 'gasmask', value: 2, journal: 'I need to talk to Edmond about getting into West Ardougne', source: 'quests/quest_elena/scripts/alrena.rs2:23; elena_journal.rs2:24' },
            { name: 'started_mud_patch', value: 3, journal: 'I need to use Water to soften the ground', source: 'quests/quest_elena/scripts/edmond.rs2:22; elena_journal.rs2:38' },
            { name: 'mud_patch1', value: 4, source: 'quests/quest_elena/scripts/mud_patch.rs2:39 (from the switch at :31); elena_journal.rs2:38' },
            { name: 'mud_patch2', value: 5, source: 'quests/quest_elena/scripts/mud_patch.rs2:39 (from :32); elena_journal.rs2:38' },
            { name: 'mud_patch3', value: 6, source: 'quests/quest_elena/scripts/mud_patch.rs2:39 (from :33); elena_journal.rs2:38' },
            { name: 'mud_patch4', value: 7, journal: 'Now I need to dig a tunnel into West Ardougne', source: 'quests/quest_elena/scripts/mud_patch.rs2:39 (from :34); elena_journal.rs2:35' },
            { name: 'opened_tunnel', value: 8, journal: 'I need to find a way out of the sewers', source: 'quests/quest_elena/scripts/mud_patch.rs2:24; elena_journal.rs2:45' },
            { name: 'tied_rope', value: 9, journal: "I've tied a rope to the sewer grill", source: 'quests/quest_elena/scripts/sewerpipe.rs2:24; elena_journal.rs2:58' },
            { name: 'opened_pipe', value: 10, journal: 'look out for an old family friend named Jethick', source: 'quests/quest_elena/scripts/edmond.rs2:32; elena_journal.rs2:53' },
            { name: 'shown_picture', value: 20, source: 'quests/quest_elena/scripts/jethick.rs2:20; elena_journal.rs2:65' },
            { name: 'returned_book', value: 21, source: 'quests/quest_elena/scripts/doors.rs2:111; elena_journal.rs2:65' },
            { name: 'spoken_martha_ted', value: 22, journal: "The Rehnisons' daughter Milli may have seen Elena", source: 'quests/quest_elena/scripts/rehnisons.rs2:20; elena_journal.rs2:69' },
            { name: 'spoke_to_milli', value: 23, journal: 'I need to get access to the Plague House', source: 'quests/quest_elena/scripts/rehnisons.rs2:42; elena_journal.rs2:78' },
            { name: 'spoke_to_plague_house', value: 24, journal: 'I need clearance from either the Head Mourner or Bravek', source: 'quests/quest_elena/scripts/doors.rs2:89; elena_journal.rs2:80' },
            { name: 'spoke_to_clerk', value: 25, source: 'areas/area_ardougne_west/scripts/clerk.rs2:53; elena_journal.rs2:80' },
            { name: 'spoke_to_bravek', value: 26, journal: 'I need to bring Bravek the Hangover Cure', source: 'quests/quest_elena/scripts/bravek.rs2:51; elena_journal.rs2:88' },
            { name: 'spoke_cured_bravek', value: 27, journal: 'I need to get into the Plague House and find Elena', source: 'quests/quest_elena/scripts/bravek.rs2:66; elena_journal.rs2:94' },
            { name: 'freed_elena', value: 28, journal: 'I should go and talk to Edmond again', source: 'quests/quest_elena/scripts/elena.rs2:8; elena_journal.rs2:105' },
            { name: 'complete', value: 29, journal: "He's given me a spell to learn as a reward", source: 'quests/quest_elena/scripts/quest_elena.rs2:13; elena_journal.rs2:109' },
            { name: 'complete_read_scroll', value: 30, source: 'quests/quest_elena/scripts/elena_teleport_scroll.rs2:12; elena_journal.rs2:109' },
        ],
        notes: 'All stages go through ~quest_elena_set_progress (quest_elena.rs2:2). Shared journal text: 3-6 (mud_patch1-3 repeat started_mud_patch\'s line, journal on 3), 24-25 (journal on 24) and 29-30 (reading the teleport scroll changes nothing in the journal, journal on 29). 20-21 have no marker at all: their line ("I\'ve spoken to Jethick ...") is repeated word for word, struck through, at every later stage.',
    },
    tree: {
        key: 'tree',
        title: 'Tree Gnome Village',
        journalTitle: 'Tree Gnome Village',
        varp: { name: 'treequest', id: 111, source: `${VARP_PACK}: 111=treequest; quests/quest_tree/configs/quest_tree.varp` },
        questPoints: 2,
        complete: { value: 9, test: '=', source: `${QUEST_CONSTANT}: ^tree_complete = 9; general/scripts/quests.rs2 count_questpoints` },
        questList: { componentId: 7380, source: `${IF_PACK}: 7380=questlist:tree` },
        stages: [
            { name: 'not_started', value: 0, journal: 'I can start this quest by speaking to Bolren', source: 'quests/quest_tree/scripts/tree_journal.rs2:4' },
            { name: 'started', value: 1, journal: 'Commander Montai, North of the maze, can help me get it', source: 'areas/area_gnome/scripts/king_bolren.rs2:30; tree_journal.rs2:17' },
            { name: 'spoken_montai', value: 2, journal: 'I need to bring Montai logs to fortify their defences', source: 'areas/area_gnome/scripts/commander_montai.rs2:17; tree_journal.rs2:23' },
            { name: 'given_logs_montai', value: 3, journal: 'I should speak to Montai again and see what to do next', source: 'areas/area_gnome/scripts/commander_montai.rs2:33; tree_journal.rs2:30' },
            { name: 'finding_trackers', value: 4, journal: 'find the three Gnome trackers who have the firing coordinates', source: 'areas/area_gnome/scripts/commander_montai.rs2:52; tree_journal.rs2:37' },
            { name: 'ballista_fired', value: 5, journal: 'With the Khazard stronghold exposed I should get inside', source: 'quests/quest_tree/scripts/quest_tree.rs2:24; tree_journal.rs2:45' },
            { name: 'retrieved_orb', value: 6, journal: 'I should return the orb to King Bolren immediately', source: 'quests/quest_tree/scripts/quest_tree.rs2:83; tree_journal.rs2:53' },
            { name: 'returned_first_orb', value: 7, journal: 'I should retrieve the two remaining orbs from the warlord', source: 'areas/area_gnome/scripts/king_bolren.rs2:72; tree_journal.rs2:61' },
            { name: 'defeated_warlord', value: 8, journal: 'I should return them now to King Bolren where they belong', source: 'quests/quest_tree/scripts/khazard_warlord.rs2:45; tree_journal.rs2:68' },
            { name: 'complete', value: 9, journal: "I can now use the gnome's spirit tree to teleport around the world", source: 'quests/quest_tree/scripts/quest_tree.rs2:96; tree_journal.rs2:72' },
        ],
    },
    grandtree: {
        key: 'grandtree',
        title: 'The Grand Tree',
        journalTitle: 'The Grand Tree',
        varp: { name: 'grandtree', id: 150, source: `${VARP_PACK}: 150=grandtree; quests/quest_grandtree/configs/quest_grandtree.varp` },
        questPoints: 5,
        complete: { value: 160, test: '=', source: `${QUEST_CONSTANT}: ^grandtree_complete = 160; general/scripts/quests.rs2 count_questpoints` },
        questList: { componentId: 7361, source: `${IF_PACK}: 7361=questlist:grandtree` },
        stages: [
            { name: 'not_started', value: 0, journal: 'I can start this quest at the Grand Tree in the Gnome Stronghold', source: 'quests/quest_grandtree/scripts/grandtree_journal.rs2:4' },
            { name: 'started', value: 10, journal: 'He has asked me to take a sample of bark to the gnome Hazelmere', source: 'quests/quest_grandtree/scripts/king_narnode.rs2:303; grandtree_journal.rs2:19' },
            { name: 'spoken_hazelmere', value: 20, journal: 'a message that I need to translate using the translation book', source: 'areas/area_gnome/scripts/hazelmere.rs2:17; grandtree_journal.rs2:32' },
            { name: 'relayed_message_narnode', value: 30, journal: 'The King wants me to tell Glough about the Daconia rocks', source: 'quests/quest_grandtree/scripts/king_narnode.rs2:410; grandtree_journal.rs2:43' },
            { name: 'spoken_glough', value: 40, journal: 'Maybe I should have a chat with King Narnode', source: 'quests/quest_grandtree/scripts/glough.rs2:80; grandtree_journal.rs2:52' },
            { name: 'found_prisoner', value: 50, journal: 'King Narnode said I can speak to Charlie, the prisoner', source: 'quests/quest_grandtree/scripts/king_narnode.rs2:164; grandtree_journal.rs2:61' },
            { name: 'spoken_prisoner', value: 60, source: 'quests/quest_grandtree/scripts/charlie.rs2:50; grandtree_journal.rs2:69' },
            { name: 'found_journal', value: 70, journal: "I found Glough's journal in his tree house", source: 'quests/quest_grandtree/scripts/quest_grandtree.rs2:105; grandtree_journal.rs2:78' },
            { name: 'released_prison', value: 80, journal: 'The password is Ka-Lu-Min', source: 'quests/quest_grandtree/scripts/king_narnode.rs2:423; grandtree_journal.rs2:86' },
            { name: 'obtained_lumber_order', value: 90, source: 'quests/quest_grandtree/scripts/foreman.rs2:113, :135; grandtree_journal.rs2:96' },
            { name: 'clue_charlie', value: 100, journal: 'Charlie has suggested I ask Anita for the keys', source: 'quests/quest_grandtree/scripts/charlie.rs2:20; grandtree_journal.rs2:105' },
            { name: 'found_invasion_plans', value: 110, journal: 'I should talk to the King and see what he says', source: 'quests/quest_grandtree/scripts/quest_grandtree.rs2:87; grandtree_journal.rs2:115' },
            { name: 'given_twigs', value: 120, journal: "isn't convinced but gave me some twigs", source: 'quests/quest_grandtree/scripts/king_narnode.rs2:115; grandtree_journal.rs2:121' },
            { name: 'unlocked_trapdoor', value: 130, journal: "I should investigate what's behind the trap door", source: 'quests/quest_grandtree/scripts/quest_grandtree.rs2:45; grandtree_journal.rs2:129' },
            { name: 'defeated_black_demon', value: 140, journal: 'He should be in these caves somewhere', source: 'quests/quest_grandtree/scripts/grandtree_black_demon.rs2:39; grandtree_journal.rs2:139' },
            { name: 'searching_daconia', value: 150, journal: "hidden amongst the Grand Tree's roots", source: 'quests/quest_grandtree/scripts/king_narnode.rs2:69; grandtree_journal.rs2:147' },
            { name: 'complete', value: 160, journal: 'I found the last of the Daconia rocks and the Grand Tree is safe', source: 'quests/quest_grandtree/scripts/quest_grandtree.rs2:198; grandtree_journal.rs2:160' },
        ],
        notes: "60 and 90 have no marker: each one's whole journal text is repeated word for word, struck through, at the next stage (grandtree_journal.rs2:76-77 and :103-104), so no phrase is unique to them. 150's text switches on holding a Daconia rock; the marker is common to both versions.",
    },
    arena: {
        key: 'arena',
        title: 'Fight Arena',
        journalTitle: 'Fight Arena',
        varp: { name: 'arenaquest', id: 17, source: `${VARP_PACK}: 17=arenaquest; quests/quest_arena/configs/quest_arena.varp` },
        questPoints: 2,
        complete: { value: 14, test: '>=', source: `${QUEST_CONSTANT}: ^arena_complete = 14; general/scripts/quests.rs2 count_questpoints` },
        questList: { componentId: 7358, source: `${IF_PACK}: 7358=questlist:arena` },
        stages: [
            { name: 'not_started', value: 0, journal: 'I can start this quest by speaking to Lady Servil', source: 'quests/quest_arena/scripts/arena_journal.rs2:6' },
            { name: 'started', value: 1, journal: 'I should go to the Fight Arena and try to find her family', source: 'quests/quest_arena/scripts/lady_servil.rs2:40; arena_journal.rs2:9' },
            { name: 'obtained_armour', value: 2, source: 'quests/quest_arena/scripts/quest_arena.rs2:25; arena_journal.rs2:13' },
            { name: 'spoken_drunkguard', value: 3, journal: 'One of the guards told me that he really likes Khali Brew', source: 'quests/quest_arena/scripts/khazard_guard.rs2:104; arena_journal.rs2:18' },
            { name: 'given_khali_brew', value: 5, journal: "Now I've got the keys I should try to rescue Lady Servil's family", source: 'quests/quest_arena/scripts/khazard_guard.rs2:121; arena_journal.rs2:25' },
            { name: 'entered_ogre_fight', value: 6, journal: 'I need to protect Jeremy and his father from a huge Ogre', source: 'quests/quest_arena/scripts/jeremy_servil.rs2:77; arena_journal.rs2:33' },
            { name: 'defeated_ogre', value: 8, journal: 'I should talk to Jeremy in the Fight Arena', source: 'quests/quest_arena/scripts/khazard_ogre.rs2:16; arena_journal.rs2:42' },
            { name: 'sent_jail', value: 9, journal: "I'm going to have to fight in the Arena", source: 'quests/quest_arena/scripts/general_khazard.rs2:51; arena_journal.rs2:52' },
            { name: 'defeated_scorpion', value: 10, journal: 'ordered me to fight his pet, Bouncer', source: 'quests/quest_arena/scripts/khazard_scorpion.rs2:16; arena_journal.rs2:62' },
            { name: 'defeated_bouncer', value: 11, journal: 'I can stay to fight him, or I can run away', source: 'quests/quest_arena/scripts/bouncer.rs2:16; arena_journal.rs2:73' },
            { name: 'freed_servils', value: 12, journal: 'but I ran away. I should go and tell Lady Servil', source: 'quests/quest_arena/scripts/general_khazard.rs2:102; arena_journal.rs2:86' },
            { name: 'defeated_genkhazard', value: 13, journal: 'Now I should go and tell Lady Servil the good news', source: 'quests/quest_arena/scripts/general_khazard.rs2:114; arena_journal.rs2:99' },
            { name: 'complete', value: 14, journal: 'but I ran away. I then returned to Lady Servil', source: 'quests/quest_arena/scripts/quest_arena.rs2:268 (calc(%arenaquest + 2) from 12); arena_journal.rs2:113' },
            { name: 'complete_defeated_genkhazard', value: 15, journal: 'I eventually killed him. I then returned to Lady Servil', source: 'quests/quest_arena/scripts/quest_arena.rs2:268 (calc(%arenaquest + 2) from 13); arena_journal.rs2:127' },
        ],
        notes: "14 has no stage constant of its own (only ^arena_complete in quest.constant): quest_arena.rs2:268 adds 2, so running from General Khazard (12) completes at 14 and killing him (13) completes at 15. 4 and 7 are never set. 2 has no marker: its whole text is repeated word for word, struck through, at 3.",
    },
    mcannon: {
        key: 'mcannon',
        title: 'Dwarf Cannon',
        journalTitle: 'Dwarf Cannon',
        varp: { name: 'mcannon', id: 0, source: `${VARP_PACK}: 0=mcannon; quests/quest_mcannon/configs/quest_mcannon.varp` },
        questPoints: 1,
        complete: { value: 11, test: '=', source: `${QUEST_CONSTANT}: ^mcannon_complete = 11; general/scripts/quests.rs2 count_questpoints` },
        questList: { componentId: 7356, source: `${IF_PACK}: 7356=questlist:mcannon` },
        stages: [
            { name: 'not_started', value: 0, journal: 'I can start this quest by speaking to the Commander of the Black Watch', source: 'quests/quest_mcannon/scripts/mcannon_journal.rs2:8' },
            { name: 'tasked_with_fixing_railings', value: 1, source: 'quests/quest_mcannon/scripts/npcs/lawgof2.rs2:34; mcannon_journal.rs2:11' },
            { name: 'tasked_with_checking_guard_tower', value: 2, source: 'quests/quest_mcannon/scripts/npcs/lawgof2.rs2:57; mcannon_journal.rs2:27' },
            { name: 'tasked_with_finding_goblin_cave', value: 3, journal: 'I gave the remains to the Commander', source: 'quests/quest_mcannon/scripts/npcs/lawgof2.rs2:83; mcannon_journal.rs2:38' },
            { name: 'tasked_with_finding_gilobs_son', value: 4, journal: "I found the Goblin's base. Next I need to find the Dwarf child", source: 'quests/quest_mcannon/scripts/locs/mcannon_cave.rs2:7; mcannon_journal.rs2:44' },
            { name: 'return_to_dwarf_commander', value: 5, journal: 'I have rescued the dwarf child and sent him back to the Commander', source: 'quests/quest_mcannon/scripts/npcs/dwarfchildtw1.rs2:15; mcannon_journal.rs2:50' },
            { name: 'tasked_with_fixing_cannon', value: 6, journal: 'The Commander has asked me to fix the multicannon', source: 'quests/quest_mcannon/scripts/npcs/lawgof2.rs2:123; mcannon_journal.rs2:55' },
            { name: 'inspected_cannon_first_time', value: 7, source: 'quests/quest_mcannon/scripts/locs/mcannon_broken_cannon.rs2:4; mcannon_journal.rs2:59' },
            { name: 'has_repaired_cannon', value: 8, journal: "I've fixed the broken multicannon", source: 'quests/quest_mcannon/scripts/locs/mcannon_broken_cannon.rs2:8; mcannon_journal.rs2:64' },
            { name: 'tasked_with_speaking_to_nulodion', value: 9, journal: 'The Commander asked me to find Nulodion the Cannon Engineer', source: 'quests/quest_mcannon/scripts/npcs/lawgof2.rs2:172; mcannon_journal.rs2:71' },
            { name: 'return_to_dwarf_commander_with_notes', value: 10, journal: "I've spoken to Nulodion, He gave me an ammo mould and notes", source: 'quests/quest_mcannon/scripts/npcs/nulodion.rs2:25; mcannon_journal.rs2:76' },
            { name: 'complete', value: 11, journal: 'I can now buy a multicannon from Nulodion as a reward', source: 'quests/quest_mcannon/scripts/quest_mcannon.rs2:24; mcannon_journal.rs2:82' },
        ],
        notes: 'No marker on 1 or 2: 1 switches on the railing bits (getbit_range(%mcannonmulti, 5, 10) = 63) and 2 on holding the dwarf remains, and the two versions share only the opening line common to every started stage. 6-7 share their journal text (journal on 6).',
    },
    mm: {
        key: 'mm',
        title: 'Monkey Madness',
        journalTitle: 'Monkey Madness',
        varp: { name: 'mm_main', id: 365, source: `${VARP_PACK}: 365=mm_main; quests/quest_mm/configs/quest_mm.varp` },
        questPoints: 3,
        complete: { value: 9, test: '>=', source: `${QUEST_CONSTANT}: ^mm_complete = 9 (quest_mm.constant too); general/scripts/quests.rs2 count_questpoints` },
        questList: { componentId: 11132, source: `${IF_PACK}: 11132=questlist:mm` },
        stages: [
            { name: 'not_started', value: 0, journal: 'To start this quest I must check how King Shareen is faring', source: 'quests/quest_mm/scripts/mm_journal.rs2:3' },
            { name: 'started', value: 1, source: 'quests/quest_mm/scripts/mm_narnode.rs2:127; mm_journal.rs2:17' },
            { name: 'shown_seal', value: 2, source: 'quests/quest_mm/scripts/mm_caranock.rs2:51; mm_journal.rs2:17' },
            { name: 'arrived_atoll', value: 3, source: 'quests/quest_mm/scripts/quest_mm.rs2:14, :264, :284, :352; mm_journal.rs2:111' },
            { name: 'completed_ch2', value: 4, source: 'quests/quest_mm/scripts/quest_mm.rs2:24, :367, :462, :478; mm_journal.rs2:234' },
            { name: 'completed_ch3', value: 5, source: 'quests/quest_mm/scripts/quest_mm.rs2:34, :495, :617; mm_journal.rs2:234' },
            { name: 'defeated_demon', value: 6, journal: 'I must now report to King Narnode', source: 'quests/quest_mm/scripts/mm_demon.rs2:389; mm_journal.rs2:304' },
            { name: 'reported_narnode', value: 7, source: 'quests/quest_mm/scripts/mm_narnode.rs2:29; mm_journal.rs2:298' },
            { name: 'received_reward', value: 8, source: 'quests/quest_mm/scripts/mm_narnode.rs2:95; mm_journal.rs2:313' },
            { name: 'complete', value: 9, journal: 'I should find Daero and enroll with the Royal Guard training programme', source: 'quests/quest_mm/scripts/quest_mm.rs2:1168; mm_journal.rs2:321' },
            { name: 'complete_training', value: 10, journal: 'I found Daero and enrolled in the Royal Guard training', source: 'quests/quest_mm/scripts/mm_daero.rs2:293; mm_journal.rs2:319' },
        ],
        notes: "Only the main varp's stages are listed; the sub-varps (mm_narnode, mm_caranock, mm_daero, mm_garkor, mm_zooknock, mm_awowogei, ...) have their own constants in quest_mm.constant. No marker on 1-5: in those stages the journal is built from the sub-varps and the jail count, the main varp only adds chapter headers and struck summaries that later stages repeat, and 1-2 and 4-5 take identical main-varp branches. No marker on 7 or 8: each one's whole text is the start of the next stage's. 10 (complete_training) follows Daero's training option.",
    },
    magearena: {
        key: 'magearena',
        title: 'Mage Arena',
        journalTitle: null,
        varp: { name: 'magearena', id: 267, source: `${VARP_PACK}: 267=magearena; _unpack/225/all.varp` },
        questPoints: 0,
        complete: { value: 6, test: '>=', source: 'areas/area_mage_arena/configs/mage_arena.constant: ^mage_arena_complete = 6; skill_combat/scripts/npc/npc_combat.rs2:128 (%magearena < ^mage_arena_complete)' },
        questList: null,
        stages: [
            { name: 'not_started', value: 0, source: 'varp default; mage_arena.constant has no 0 constant' },
            { name: 'started', value: 1, source: 'areas/area_mage_arena/scripts/kolodion.rs2:99 (literal 1)' },
            { name: 'ogre', value: 2, source: 'areas/area_mage_arena/scripts/kolodion_fight.rs2:30 (literal 2, Kolodion\'s human form killed)' },
            { name: 'arachnid', value: 3, source: 'areas/area_mage_arena/scripts/kolodion_fight.rs2:54 (literal 3)' },
            { name: 'ethereal', value: 4, source: 'areas/area_mage_arena/scripts/kolodion_fight.rs2:78 (literal 4)' },
            { name: 'demon', value: 5, source: 'areas/area_mage_arena/scripts/kolodion_fight.rs2:102 (literal 5)' },
            { name: 'complete', value: 6, source: 'areas/area_mage_arena/scripts/kolodion_fight.rs2:128' },
            { name: 'prayed_at_statue', value: 7, source: 'areas/area_mage_arena/scripts/chamber.rs2:15' },
            { name: 'staff_given', value: 8, source: 'areas/area_mage_arena/scripts/chamber_guardian.rs2:15' },
        ],
        notes: "A miniquest, not on the quest list: no questlist component, no journal, no quest points. Its only client-side evidence is items (the god cape from a statue at 7, the god staff from the Chamber Guardian at 8) and game messages. Each value names the Kolodion form being fought (mage_arena_bosses enum); 1-5 are set as literals, names from mage_arena.constant. Charge needs 8, not 6: skill_magic/scripts/spells/charge.rs2:4 (%magearena < ^mage_arena_staff_given).",
    },
    seaslug: {
        key: 'seaslug',
        title: 'Sea Slug',
        journalTitle: 'Sea Slug',
        varp: { name: 'seaslugquest', id: 159, source: `${VARP_PACK}: 159=seaslugquest; quests/quest_seaslug/configs/quest_seaslug.varp` },
        questPoints: 1,
        complete: { value: 12, test: '=', source: `${QUEST_CONSTANT}: ^seaslug_complete = 12; general/scripts/quests.rs2 count_questpoints` },
        questList: { componentId: 7374, source: `${IF_PACK}: 7374=questlist:seaslug` },
        stages: [
            { name: 'not_started', value: 0, journal: 'I can start this quest by speaking to Caroline', source: 'quests/quest_seaslug/scripts/seaslug_journal.rs2:9' },
            { name: 'started', value: 1, journal: "I need to talk to Holgart He'll take me to the Fishing Platform", source: 'areas/area_ardougne_east/scripts/caroline.rs2:23; seaslug_journal.rs2:13' },
            { name: 'spoken_holgart', value: 2, source: 'areas/area_ardougne_east/scripts/holgart_ardougne.rs2:30; seaslug_journal.rs2:20' },
            { name: 'boat_repaired', value: 3, journal: 'I need to find Kent and Kennith', source: 'areas/area_ardougne_east/scripts/holgart_ardougne.rs2:45; seaslug_journal.rs2:33' },
            { name: 'spoken_kennith', value: 4, journal: 'hiding behind some boxes. I need to find Kent', source: 'areas/area_fishing_platform/scripts/kennith.rs2:10; seaslug_journal.rs2:40' },
            { name: 'sailed_kent', value: 5, source: 'areas/area_fishing_platform/scripts/holgart_platform.rs2:26; seaslug_journal.rs2:40' },
            { name: 'spoken_kent', value: 6, source: 'areas/area_fishing_platform/scripts/kent.rs2:17; seaslug_journal.rs2:46' },
            { name: 'lit_torch', value: 7, journal: "lighting this damp torch. Kennith won't go near the Sea Slugs", source: 'quests/quest_seaslug/scripts/quest_seaslug.rs2:62; seaslug_journal.rs2:55' },
            { name: 'kennith_need_escape', value: 8, journal: "let Kenneth escape. Kennith won't go near the Sea Slugs", source: 'areas/area_fishing_platform/scripts/kennith.rs2:23; seaslug_journal.rs2:65' },
            { name: 'panel_opened', value: 9, source: 'quests/quest_seaslug/scripts/quest_seaslug.rs2:90; seaslug_journal.rs2:65' },
            { name: 'need_kennith_path', value: 10, journal: "Kennith can't get downstairs without some help. Kennith won't go near", source: 'areas/area_fishing_platform/scripts/kennith.rs2:31; seaslug_journal.rs2:75' },
            { name: 'saved_kennith', value: 11, journal: 'I need to take the boat back to shore and talk to Caroline', source: 'quests/quest_seaslug/scripts/quest_seaslug.rs2:114; seaslug_journal.rs2:86' },
            { name: 'complete', value: 12, journal: 'she thanked me for rescuing her family from the Sea Slugs', source: 'areas/area_ardougne_east/scripts/caroline.rs2:42; seaslug_journal.rs2:98' },
        ],
        notes: "Shared journal text: 4-5 (case ^seaslug_spoken_kennith, ^seaslug_sailed_kent; journal on 4) and 8-9 (journal on 8). No marker on 2: it switches on holding swamp paste, and the two versions share only lines that 1 shows too. No marker on 6: its whole text is repeated word for word, struck through, at 7.",
    },
    fishingcompo: {
        key: 'fishingcompo',
        title: 'Fishing Contest',
        journalTitle: 'Fishing Contest',
        varp: { name: 'fishingcompo', id: 11, source: `${VARP_PACK}: 11=fishingcompo; quests/quest_fishingcompo/configs/quest_fishingcompo.varp` },
        questPoints: 1,
        complete: { value: 5, test: '=', source: `${QUEST_CONSTANT}: ^fishingcompo_complete = 5; general/scripts/quests.rs2 count_questpoints` },
        questList: { componentId: 7359, source: `${IF_PACK}: 7359=questlist:fishingcompo` },
        stages: [
            { name: 'not_started', value: 0, journal: 'I can start this quest by speaking to the Dwarves', source: 'quests/quest_fishingcompo/scripts/fishingcompo_journal.rs2:9' },
            { name: 'started', value: 1, journal: 'They gave me a Fishing Contest Pass to enter the contest', source: 'areas/area_white_wolf_mountain/scripts/mountain_dwarf.rs2:69; areas/area_seers/scripts/hemenster/bonzo.rs2:67, :77; fishingcompo_journal.rs2:19' },
            { name: 'in_comp', value: 2, journal: 'next to the willow tree', source: 'areas/area_seers/scripts/hemenster/bonzo.rs2:44; fishingcompo_journal.rs2:24' },
            { name: 'garlic_comp', value: 3, journal: 'next to the pipes', source: 'quests/quest_fishingcompo/scripts/quest_fishingcompo.rs2:92, :102; fishingcompo_journal.rs2:29' },
            { name: 'won_comp', value: 4, journal: 'I should take the Trophy back to the Dwarf', source: 'areas/area_seers/scripts/hemenster/bonzo.rs2:61; fishingcompo_journal.rs2:35' },
            { name: 'complete', value: 5, journal: 'I scared away a vampire with some garlic', source: 'quests/quest_fishingcompo/scripts/quest_fishingcompo.rs2:109; fishingcompo_journal.rs2:42' },
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
    gobdip: {
        key: 'gobdip',
        title: 'Goblin Diplomacy',
        journalTitle: 'Goblin Diplomacy',
        varp: { name: 'goblinquest', id: 62, source: `${VARP_PACK}: 62=goblinquest; _unpack/225/all.varp` },
        questPoints: 5,
        complete: { value: 6, test: '=', source: `${QUEST_CONSTANT}: ^gobdip_complete = 6; general/scripts/quests.rs2 count_questpoints` },
        questList: { componentId: 7338, source: `${IF_PACK}: 7338=questlist:gobdip` },
        stages: [
            { name: 'not_started', value: 0, journal: 'I can start this quest by talking to the Bartender in Port Sarim', source: 'quests/quest_gobdip/scripts/gobdip_journal.rs2:7' },
            { name: 'started', value: 1, journal: 'I should investigate before it turns into a full blown war', source: 'quests/quest_gobdip/scripts/quest_gobdip.rs2:18; gobdip_journal.rs2:9' },
            { name: 'will_bring_armour', value: 2, journal: 'I should bring the goblins some Orange Goblin Armour', source: 'quests/quest_gobdip/scripts/quest_gobdip.rs2:27; gobdip_journal.rs2:13' },
            { name: 'gave_orange', value: 3, source: 'quests/quest_gobdip/scripts/quest_gobdip.rs2:32; gobdip_journal.rs2:19' },
            { name: 'gave_blue', value: 4, source: 'quests/quest_gobdip/scripts/quest_gobdip.rs2:41; gobdip_journal.rs2:26' },
            { name: 'gave_brown', value: 5, journal: 'I should see if they liked the Brown Goblin Armour', source: 'quests/quest_gobdip/scripts/quest_gobdip.rs2:52; gobdip_journal.rs2:35' },
            { name: 'complete', value: 6, journal: "They're clearly not the smartest, but that's goblins for you", source: 'quests/quest_gobdip/scripts/quest_gobdip.rs2:61; gobdip_journal.rs2:46' },
        ],
        notes: "No marker on 3 or 4: each one's whole journal text is repeated word for word, struck through, at the next stage (the colour request lines at gobdip_journal.rs2:31 and :42).",
    },
    druid: {
        key: 'druid',
        title: 'Druidic Ritual',
        journalTitle: 'Druidic Ritual',
        varp: { name: 'druidquest', id: 80, source: `${VARP_PACK}: 80=druidquest; quests/quest_druid/configs/quest_druid.varp` },
        questPoints: 4,
        complete: { value: 4, test: '=', source: `${QUEST_CONSTANT}: ^druid_complete = 4; general/scripts/quests.rs2 count_questpoints` },
        questList: { componentId: 7355, source: `${IF_PACK}: 7355=questlist:druid` },
        stages: [
            { name: 'not_started', value: 0, journal: 'I can start this quest by speaking to Kaqemeex', source: 'quests/quest_druid/scripts/druid_journal.rs2:6' },
            { name: 'started', value: 1, journal: 'I should speak to Sanfew in the village to the South', source: 'areas/area_taverly/scripts/kaqemeex.rs2:76; druid_journal.rs2:8' },
            { name: 'spoken_sanfew', value: 2, journal: 'Sanfew told me for the ritual they would need me to place', source: 'areas/area_taverly/scripts/sanfew.rs2:40; druid_journal.rs2:10' },
            { name: 'given_ingredients', value: 3, journal: 'I should speak to Kaqemeex again and claim my reward', source: 'areas/area_taverly/scripts/sanfew.rs2:64; druid_journal.rs2:13' },
            { name: 'complete', value: 4, journal: 'Kaqemeex then taught me the basics of the skill Herblore', source: 'quests/quest_druid/scripts/quest_druid.rs2:2; druid_journal.rs2:16' },
        ],
    },
    romeojuliet: {
        key: 'romeojuliet',
        title: 'Romeo & Juliet',
        journalTitle: 'Romeo & Juliet',
        varp: { name: 'rjquest', id: 144, source: `${VARP_PACK}: 144=rjquest; quests/quest_romeojuliet/configs/quest_romeojuliet.varp` },
        questPoints: 5,
        complete: { value: 100, test: '=', source: `${QUEST_CONSTANT}: ^romeojuliet_complete = 100; general/scripts/quests.rs2 count_questpoints` },
        questList: { componentId: 7343, source: `${IF_PACK}: 7343=questlist:romeojuliet` },
        stages: [
            { name: 'not_started', value: 0, journal: 'I can start this quest by talking to Romeo in Varrock Square', source: 'quests/quest_romeojuliet/scripts/romeojuliet_journal.rs2:8' },
            { name: 'spoken_romeo', value: 10, journal: 'I should go and speak to Juliet', source: 'areas/area_varrock/scripts/romeo.rs2:43; romeojuliet_journal.rs2:11' },
            { name: 'spoken_juliet', value: 20, journal: 'I should take the message from Juliet to Romeo', source: 'areas/area_varrock/scripts/juliet.rs2:63; romeojuliet_journal.rs2:15' },
            { name: 'passed_message', value: 30, journal: 'I should find Father Lawrence and see how we can help', source: 'areas/area_varrock/scripts/romeo.rs2:58; romeojuliet_journal.rs2:20' },
            { name: 'spoken_father', value: 40, journal: 'I need to find the Apothecary to make a cadava potion', source: 'areas/area_varrock/scripts/father_lawrence.rs2:62; romeojuliet_journal.rs2:27' },
            { name: 'spoken_apothecary', value: 50, source: 'areas/area_varrock/scripts/apothecary.rs2:81; romeojuliet_journal.rs2:36' },
            { name: 'juliet_crypt', value: 60, journal: "I have to find Romeo and tell him what's happened", source: 'areas/area_varrock/scripts/juliet.rs2:99; romeojuliet_journal.rs2:53' },
            { name: 'complete', value: 100, journal: "I'm not exactly sure he understood what was happening", source: 'quests/quest_romeojuliet/scripts/quest_romeojuliet.rs2:2; romeojuliet_journal.rs2:64' },
        ],
        notes: "No marker on 50: its only new line switches on holding the cadava potion or berries (romeojuliet_journal.rs2:45-51), and the line before it is repeated, struck through, at 60 and 100.",
    },
    dragon: {
        key: 'dragon',
        title: 'Dragon Slayer',
        journalTitle: 'Dragon Slayer',
        varp: { name: 'dragonquest', id: 176, source: `${VARP_PACK}: 176=dragonquest; quests/quest_dragon/configs/quest_dragon.varp` },
        questPoints: 2,
        complete: { value: 10, test: '>=', source: `${QUEST_CONSTANT}: ^dragon_complete = 10; general/scripts/quests.rs2 count_questpoints` },
        questList: { componentId: 7383, source: `${IF_PACK}: 7383=questlist:dragon` },
        stages: [
            { name: 'not_started', value: 0, journal: 'I can start this quest by speaking to the Guildmaster', source: 'quests/quest_dragon/scripts/dragon_journal.rs2:4' },
            { name: 'spoken_to_guildmaster', value: 1, journal: 'I should speak to Oziach, who lives by the cliffs', source: 'areas/area_varrock/scripts/guild_master.rs2:27; dragon_journal.rs2:21' },
            { name: 'spoken_to_oziach', value: 2, source: 'areas/area_edgeville/scripts/oziach.rs2:100; dragon_journal.rs2:25' },
            { name: 'bought_ship', value: 3, source: 'areas/area_port_sarim/scripts/klarense.rs2:96; dragon_journal.rs2:37' },
            { name: 'repaired_ship', value: 7, journal: 'I have repaired my ship using wooden planks and steel nails. I still need to find a captain', source: 'quests/quest_dragon/scripts/lady_lumbridge.rs2:86; dragon_journal.rs2:51 (ds_ship_repairs :166)' },
            { name: 'ned_given_map', value: 8, journal: 'Now I should go to my ship in Port Sarim and set sail for Crandor', source: 'areas/area_draynor/scripts/ned.rs2:232; dragon_journal.rs2:61' },
            { name: 'sailed_to_crandor', value: 9, journal: 'Now all I need to do is kill the dragon', source: 'quests/quest_dragon/scripts/dragonslayer_ned.rs2:22; dragon_journal.rs2:70' },
            { name: 'complete', value: 10, journal: 'Oziach agreed to sell me Rune Plate, the armour of heroes', source: 'quests/quest_dragon/scripts/quest_dragon.rs2:32; dragon_journal.rs2:82' },
        ],
        notes: "Only dragonquest's stages; the oracle, shield and goblin constants in quest_dragon.constant belong to other varps. 4-6 are never set (lady_lumbridge.rs2:86 goes from 3 straight to 7). No marker on 2 or 3: Oziach sets 2 before giving his instructions (oziach.rs2:100) and Klarense sells the ship without checking them, so both stages can show the same 'return to Oziach' line (dragon_journal.rs2:27, :39). 7's marker leans on %dragonquestvar: 7 is set only once the repair count reaches 3 (lady_lumbridge.rs2:79-86), so its repair line always reads 'I have repaired my ship', which 3 never shows.",
    },
    sheep: {
        key: 'sheep',
        title: 'Sheep Shearer',
        journalTitle: 'Sheep Shearer',
        varp: { name: 'sheep', id: 179, source: `${VARP_PACK}: 179=sheep; quests/quest_sheep/configs/quest_sheep.varp` },
        questPoints: 1,
        complete: { value: 22, test: '=', source: `${QUEST_CONSTANT}: ^sheep_complete = 22; general/scripts/quests.rs2 count_questpoints` },
        questList: { componentId: 7344, source: `${IF_PACK}: 7344=questlist:sheep` },
        stages: [
            { name: 'not_started', value: 0, journal: 'I can start this quest by speaking to Farmer Fred', source: 'quests/quest_sheep/scripts/sheep_journal.rs2:4' },
            { name: 'started', value: 1, journal: 'I need to collect 20 more balls of wool', source: 'areas/area_lumbridge/scripts/fred_the_farmer.rs2:54; sheep_journal.rs2:13' },
            { name: 'wool_given_1', value: 2, journal: 'I need to collect 19 more balls of wool', source: 'areas/area_lumbridge/scripts/fred_the_farmer.rs2:73; sheep_journal.rs2:13' },
            { name: 'wool_given_2', value: 3, journal: 'I need to collect 18 more balls of wool', source: 'areas/area_lumbridge/scripts/fred_the_farmer.rs2:73; sheep_journal.rs2:13' },
            { name: 'wool_given_3', value: 4, journal: 'I need to collect 17 more balls of wool', source: 'areas/area_lumbridge/scripts/fred_the_farmer.rs2:73; sheep_journal.rs2:13' },
            { name: 'wool_given_4', value: 5, journal: 'I need to collect 16 more balls of wool', source: 'areas/area_lumbridge/scripts/fred_the_farmer.rs2:73; sheep_journal.rs2:13' },
            { name: 'wool_given_5', value: 6, journal: 'I need to collect 15 more balls of wool', source: 'areas/area_lumbridge/scripts/fred_the_farmer.rs2:73; sheep_journal.rs2:13' },
            { name: 'wool_given_6', value: 7, journal: 'I need to collect 14 more balls of wool', source: 'areas/area_lumbridge/scripts/fred_the_farmer.rs2:73; sheep_journal.rs2:13' },
            { name: 'wool_given_7', value: 8, journal: 'I need to collect 13 more balls of wool', source: 'areas/area_lumbridge/scripts/fred_the_farmer.rs2:73; sheep_journal.rs2:13' },
            { name: 'wool_given_8', value: 9, journal: 'I need to collect 12 more balls of wool', source: 'areas/area_lumbridge/scripts/fred_the_farmer.rs2:73; sheep_journal.rs2:13' },
            { name: 'wool_given_9', value: 10, journal: 'I need to collect 11 more balls of wool', source: 'areas/area_lumbridge/scripts/fred_the_farmer.rs2:73; sheep_journal.rs2:13' },
            { name: 'wool_given_10', value: 11, journal: 'I need to collect 10 more balls of wool', source: 'areas/area_lumbridge/scripts/fred_the_farmer.rs2:73; sheep_journal.rs2:13' },
            { name: 'wool_given_11', value: 12, journal: 'I need to collect 9 more balls of wool', source: 'areas/area_lumbridge/scripts/fred_the_farmer.rs2:73; sheep_journal.rs2:13' },
            { name: 'wool_given_12', value: 13, journal: 'I need to collect 8 more balls of wool', source: 'areas/area_lumbridge/scripts/fred_the_farmer.rs2:73; sheep_journal.rs2:13' },
            { name: 'wool_given_13', value: 14, journal: 'I need to collect 7 more balls of wool', source: 'areas/area_lumbridge/scripts/fred_the_farmer.rs2:73; sheep_journal.rs2:13' },
            { name: 'wool_given_14', value: 15, journal: 'I need to collect 6 more balls of wool', source: 'areas/area_lumbridge/scripts/fred_the_farmer.rs2:73; sheep_journal.rs2:13' },
            { name: 'wool_given_15', value: 16, journal: 'I need to collect 5 more balls of wool', source: 'areas/area_lumbridge/scripts/fred_the_farmer.rs2:73; sheep_journal.rs2:13' },
            { name: 'wool_given_16', value: 17, journal: 'I need to collect 4 more balls of wool', source: 'areas/area_lumbridge/scripts/fred_the_farmer.rs2:73; sheep_journal.rs2:13' },
            { name: 'wool_given_17', value: 18, journal: 'I need to collect 3 more balls of wool', source: 'areas/area_lumbridge/scripts/fred_the_farmer.rs2:73; sheep_journal.rs2:13' },
            { name: 'wool_given_18', value: 19, journal: 'I need to collect 2 more balls of wool', source: 'areas/area_lumbridge/scripts/fred_the_farmer.rs2:73; sheep_journal.rs2:13' },
            { name: 'last_wool', value: 20, journal: 'I need to collect 1 more balls of wool', source: 'areas/area_lumbridge/scripts/fred_the_farmer.rs2:73; sheep_journal.rs2:13' },
            { name: 'complete', value: 22, journal: 'I brought Farmer Fred 20 balls of wool', source: 'quests/quest_sheep/scripts/quest_sheep.rs2:2; sheep_journal.rs2:20' },
        ],
        notes: "The 1-QP contingency (docs/speedrun/quests/README.md section 7), not on the route. Each ball of wool adds 1 (fred_the_farmer.rs2:73) up to ^sheep_last_wool = 20 (19 balls given); the 20th ball completes the quest at 22 (fred_the_farmer.rs2:80-84, quest_sheep.rs2:2), so 21 is never set. 2-19 have no constants; the journal prints the balls still owed, 21 - value.",
    },
} as const satisfies Record<string, QuestTable>;

export type QuestKey = keyof typeof QUESTS;
export type StageName<K extends QuestKey> = (typeof QUESTS)[K]['stages'][number]['name'];

/** Every quest on the route, in run order (docs/speedrun/quests/README.md section 4). */
export const ROUTE_QUESTS: readonly QuestKey[] = ['doric', 'elena', 'tree', 'grandtree', 'arena', 'mcannon', 'mm', 'magearena', 'seaslug', 'fishingcompo', 'cook', 'gobdip', 'druid', 'romeojuliet', 'dragon'];
