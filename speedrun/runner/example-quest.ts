// Example quest step: start Cook's Assistant, its pre- and postconditions read
// from the published quest state (speedrun/lib/quests.ts).
//
//   bun speedrun/runner/example-quest.ts <bot> [--launch]
//
// A fresh account first skips the tutorial (outside the step, not logged).
// Before and after the step the script opens the Cook's Assistant journal
// (readQuestStage with force) and prints what the quest tab and the journal
// say, so the run shows the stage as the client sees it on either side.

import { advance } from '../lib/dialogue';
import { questStage, readQuestStage, requireQuestStage, stagesFromJournal } from '../lib/quests';
import { closeSession, openSession } from '../lib/session';
import { formatReport, report, TickLog } from '../lib/ticks';
import { runSteps, type Step } from './step';

/** The Cook, in the Lumbridge castle kitchen (server/content/maps, lumbridge.npc). */
const KITCHEN = { x: 3208, z: 3213 };

const startCooksAssistant: Step = {
    name: "start Cook's Assistant",
    preconditions: s => requireQuestStage(s, 'cook', 'not_started'),
    run: async ({ bot, sdk }) => {
        const walked = await bot.walkTo(KITCHEN.x, KITCHEN.z, 4);
        if (!walked.success) throw new Error(`walkTo kitchen: ${walked.message}`);
        const talk = await bot.talkTo(/^Cook$/);
        if (!talk.success) throw new Error(`talkTo Cook: ${talk.message}`);
        // "What's wrong?", then "Yes, I'll help you." (quest_cook.rs2:2, :29); continue the rest.
        for (let i = 0; i < 20; i++) {
            const s = sdk.getState()!;
            if (s.quests?.cook === 'started' && !s.dialog.isOpen) return;
            const r = await advance(sdk, { choose: /^(What's wrong\?|Yes, I'll help you\.)$/ });
            if (!r.ok && r.reason !== 'no fresh page') throw new Error(`dialogue: ${r.reason} on "${r.text}"`);
        }
        throw new Error('the Cook\'s dialogue did not finish within 20 pages');
    },
    postconditions: s => requireQuestStage(s, 'cook', 'started'),
    done: o => requireQuestStage(o, 'cook', 'started', { atLeast: true }) === true,
    logoutSafe: true,
};

async function show(label: string, session: Awaited<ReturnType<typeof openSession>>): Promise<void> {
    const { reading, journal } = await readQuestStage(session.sdk, 'cook', { force: true });
    const s = session.sdk.getState()!;
    const fromJournal = journal ? stagesFromJournal('cook', journal)?.map(x => `${x.name} (${x.value})`) : null;
    console.log(`[${label}] tick ${s.tick} qp ${s.questPoints} tab ${reading.status} -> ${questStage(s, 'cook')!.stages.map(x => x.name).join('|')}`);
    console.log(`[${label}] journal "${journal?.title}": ${journal?.lines.join(' / ')}`);
    console.log(`[${label}] journal markers -> ${fromJournal?.join(', ') ?? 'none'}`);
}

const args = process.argv.slice(2);
const bot = args.find(a => !a.startsWith('-'));
if (!bot) {
    console.error('Usage: bun speedrun/runner/example-quest.ts <bot> [--launch]');
    process.exit(2);
}

const session = await openSession(bot, { launch: args.includes('--launch') });
try {
    const s0 = session.sdk.getState()!;
    if (s0.modalOpen || s0.dialog.isOpen || session.sdk.findNearbyNpc(/runescape guide/i)) {
        const r = await session.bot.skipTutorial();
        console.log(`[setup] skipTutorial: ${r.message}`);
    }
    await show('before', session);
    const log = TickLog.open();
    await runSteps(session, [startCooksAssistant], { log, c: {} });
    await show('after', session);
    console.log(formatReport(report(log.rows)));
    console.log(`log: ${log.path}`);
} finally {
    await closeSession(session);
}
process.exit(0);
