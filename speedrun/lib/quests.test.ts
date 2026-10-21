import { describe, expect, test } from 'bun:test';

import type { QuestJournalState } from '../../sdk/types';
import { QUESTS, ROUTE_QUESTS } from '../data/quest-stages';
import { baseState, FakeSdk } from './fake-sdk';
import { journalProbeName, questDone, questStage, questStatus, readQuestStage, requireQuestStage, stagesFromJournal } from './quests';

/** FakeSdk plus the close readQuestStage sends (FakeSdk gains sendCloseModal with rs/41; then this can go). */
class JournalFake extends FakeSdk {
    sendCloseModal() {
        return this.sendAction({ method: 'sendCloseModal', args: [] });
    }
}

/** Lines as the server wraps them: arbitrary breaks, colour tags kept. */
function journal(title: string, text: string, tick = 100, open = true): QuestJournalState {
    const words = text.split(' ');
    const lines: string[] = [];
    for (let i = 0; i < words.length; i += 5) lines.push(`@dbl@${words.slice(i, i + 5).join(' ')}`);
    return { title, lines, open, tick };
}

const ELENA_MUD = 'Edmond has asked me to help find his daughter. @str@Alrena has made me a gas mask. I need to use Water to soften the ground near the sewer.';

describe('questStatus', () => {
    test('reads the tab, missing means not started', () => {
        const s = baseState({ quests: { doric: 'complete', elena: 'started' } });
        expect(questStatus(s, 'doric')).toBe('complete');
        expect(questStatus(s, 'elena')).toBe('started');
        expect(questStatus(s, 'cook')).toBe('not_started');
    });

    test('unobservable: out of game, an older client, a quest off the list', () => {
        expect(questStatus(baseState({ inGame: false, quests: {} }), 'doric')).toBeNull();
        expect(questStatus(baseState(), 'doric')).toBeNull();
        expect(questStatus(baseState({ quests: {} }), 'magearena')).toBeNull();
    });
});

describe('questStage', () => {
    test('not started and complete come from the tab alone', () => {
        const s = baseState({ quests: { doric: 'complete' } });
        expect(questStage(s, 'doric')!.stages.map(x => x.name)).toEqual(['complete']);
        expect(questStage(s, 'tree')!.stages.map(x => x.name)).toEqual(['not_started']);
        // Plague City counts as complete from 29 on, and reading the scroll sets 30.
        expect(questStage(baseState({ quests: { elena: 'complete' } }), 'elena')!.stages.map(x => x.value)).toEqual([29, 30]);
    });

    test('started without a journal: every started stage', () => {
        const r = questStage(baseState({ quests: { tree: 'started' } }), 'tree')!;
        expect(r.source).toBe('status');
        expect(r.stages.map(x => x.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    test('a fresh journal narrows it; stages sharing text stay together', () => {
        const s = baseState({ tick: 101, quests: { elena: 'started' }, questJournal: journal('Plague City', ELENA_MUD, 100, false) });
        const r = questStage(s, 'elena')!;
        expect(r.source).toBe('journal');
        expect(r.stages.map(x => x.value)).toEqual([3, 4, 5, 6]);
    });

    test('a stale journal, or another quest\'s, is ignored', () => {
        const stale = baseState({ tick: 110, quests: { elena: 'started' }, questJournal: journal('Plague City', ELENA_MUD, 100, false) });
        expect(questStage(stale, 'elena')!.source).toBe('status');
        const other = baseState({ tick: 100, quests: { elena: 'started', tree: 'started' }, questJournal: journal('Plague City', ELENA_MUD) });
        expect(questStage(other, 'tree')!.source).toBe('status');
    });

    test('a resume probe counts however old the state is', () => {
        const state = baseState({ tick: 500, quests: { elena: 'started' } });
        const r = questStage({ state, probed: { [journalProbeName('elena')]: journal('Plague City', ELENA_MUD, 1, false) } }, 'elena')!;
        expect(r.stages.map(x => x.value)).toEqual([3, 4, 5, 6]);
    });

    test('text matching no marker is one of the unmarked started stages', () => {
        expect(stagesFromJournal('elena', journal('Plague City', 'nothing here a marker would match'))!.map(x => x.value)).toEqual([20, 21]);
    });
});

describe('requireQuestStage', () => {
    const at3to6 = baseState({ tick: 100, quests: { elena: 'started', doric: 'complete' }, questJournal: journal('Plague City', ELENA_MUD) });

    test('exact, from the tab', () => {
        expect(requireQuestStage(at3to6, 'doric', 'complete')).toBe(true);
        expect(requireQuestStage(at3to6, 'cook', 'not_started')).toBe(true);
        expect(requireQuestStage(at3to6, 'cook', 'started')).toBe("Cook's Assistant is at not_started (0), not started (1)");
    });

    test('atLeast passes when every possible stage is at or past it', () => {
        expect(requireQuestStage(at3to6, 'elena', 'gasmask', { atLeast: true })).toBe(true);
        expect(requireQuestStage(at3to6, 'elena', 'started_mud_patch', { atLeast: true })).toBe(true);
        expect(requireQuestStage(at3to6, 'elena', 'opened_tunnel', { atLeast: true })).toContain('not at least opened_tunnel (8)');
    });

    test('says so when the evidence cannot tell the stage from a neighbour', () => {
        expect(requireQuestStage(at3to6, 'elena', 'mud_patch2')).toContain('read the journal');
        expect(requireQuestStage(baseState({ quests: { tree: 'started' } }), 'tree', 'spoken_montai')).toContain('from the quest tab');
    });

    test('an unknown stage is a programming error', () => {
        expect(() => requireQuestStage(at3to6, 'elena', 'nope' as never)).toThrow('has no stage');
    });
});

test('questDone reads the tab from an observation', () => {
    const done = questDone('doric');
    expect(done({ state: baseState({ quests: { doric: 'complete' } }), probed: {} })).toBe(true);
    expect(done({ state: baseState({ quests: { doric: 'started' } }), probed: {} })).toBe(false);
});

describe('readQuestStage', () => {
    test('clicks the quest-tab entry, reads the journal, closes it', async () => {
        const sdk = new JournalFake(baseState({ tick: 50, quests: { elena: 'started' }, questJournal: null }));
        sdk.onSend = (a, f) => {
            if (a.method === 'sendClickComponent') {
                expect(a.args).toEqual([QUESTS.elena.questList.componentId]);
                queueMicrotask(() => f.tick(s => ({ questJournal: journal('Plague City', ELENA_MUD, s.tick + 1) })));
            } else if (a.method === 'sendCloseModal') {
                queueMicrotask(() => f.tick(s => ({ questJournal: { ...s.questJournal!, open: false } })));
            }
        };
        const r = await readQuestStage(sdk as never, 'elena');
        expect(r.reading.stages.map(x => x.value)).toEqual([3, 4, 5, 6]);
        expect(sdk.sent.map(a => a.method)).toEqual(['sendClickComponent', 'sendCloseModal']);
    });

    test('clicks once more when the server dropped the first click', async () => {
        const sdk = new JournalFake(baseState({ tick: 50, quests: { elena: 'started' }, questJournal: null }));
        let clicks = 0;
        sdk.onSend = (a, f) => {
            if (a.method === 'sendClickComponent' && ++clicks === 1) {
                // Busy: the click is skipped, and the ticks go by.
                setTimeout(() => { for (let i = 0; i < 4; i++) f.tick(); }, 0);
            } else if (a.method === 'sendClickComponent') {
                queueMicrotask(() => f.tick(s => ({ questJournal: journal('Plague City', ELENA_MUD, s.tick + 1) })));
            } else if (a.method === 'sendCloseModal') {
                queueMicrotask(() => f.tick(s => ({ questJournal: { ...s.questJournal!, open: false } })));
            }
        };
        const r = await readQuestStage(sdk as never, 'elena');
        expect(r.reading.source).toBe('journal');
        expect(sdk.sent.map(a => a.method)).toEqual(['sendClickComponent', 'sendClickComponent', 'sendCloseModal']);
    });

    test('no click when the tab alone leaves one stage', async () => {
        const sdk = new JournalFake(baseState({ quests: { cook: 'started' } }));
        const r = await readQuestStage(sdk as never, 'cook');
        expect(r.journal).toBeNull();
        expect(r.reading.stages.map(x => x.name)).toEqual(['started']);
        expect(sdk.sent).toEqual([]);
    });
});

test('every route quest on the quest list has a journal title, and every stage name is unique', () => {
    for (const key of ROUTE_QUESTS) {
        const t = QUESTS[key];
        if (t.questList) expect(t.journalTitle).not.toBeNull();
        const names = t.stages.map(s => s.name);
        expect(new Set(names).size).toBe(names.length);
    }
});
