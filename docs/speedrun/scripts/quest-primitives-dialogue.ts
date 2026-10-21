// Dialogue timing: ticks per chat page and per multi-option click when the bot
// answers as fast as the stock lite client allows. Uses the Lumbridge Cook's
// quest start (quest_cook.rs2), reset between runs with ::setvar cookquest 0.
// Run: bun docs/speedrun/scripts/quest-primitives-dialogue.ts <botname> [runs]

import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';
import { cheat, dialogText, now, result, stats, tele, waitTicks, waitUntil } from './quest-primitives-lib';

const RUNS = Number(process.argv[3] ?? 3);

// Answer patterns, tried in order against the option texts of a choice page.
const BRANCHES: Record<string, RegExp[]> = {
    short: [/^What's wrong\?/, /^Yes, I'll help you/],
    long: [/^You don't look very happy/, /^I'd take the rest/, /^Yes, I'll help you/],
};

await runScript(async ({ sdk }) => {
    const all: Record<string, { pageGaps: number[]; choiceGaps: number[]; openTicks: number[]; totals: number[]; pages: number[] }> = {};
    for (const [branch, answers] of Object.entries(BRANCHES)) {
        const agg = { pageGaps: [] as number[], choiceGaps: [] as number[], openTicks: [] as number[], totals: [] as number[], pages: [] as number[] };
        all[branch] = agg;
        for (let run = 0; run < RUNS; run++) {
            await cheat(sdk, 'setvar cookquest 0');
            await tele(sdk, 3209, 3215);
            await waitTicks(sdk, 2);
            const cook = sdk.findNearbyNpc(/^cook$/i);
            if (!cook) throw new Error('cook not found');
            const talk = cook.optionsWithIndex.find(o => /talk/i.test(o.text))!;

            // Event-driven answering: click the instant a fresh page is published.
            const pages: Array<{ tick: number; kind: 'page' | 'choice'; text: string }> = [];
            let lastPage = '';
            let ai = 0;
            let ended: number | null = null;
            const onState = (s: BotWorldState) => {
                const d = s.dialog;
                if (!d.isOpen) {
                    if (pages.length > 0 && ended === null) ended = s.tick;
                    return;
                }
                if (d.isWaiting || !d.pageId || d.pageId === lastPage) return;
                lastPage = d.pageId;
                const choice = d.options.length > 1;
                pages.push({ tick: s.tick, kind: choice ? 'choice' : 'page', text: dialogText(s).slice(0, 70) });
                if (choice) {
                    const want = answers[ai++];
                    const opt = d.options.find(o => want.test(o.text));
                    if (!opt) throw new Error('no option ' + want + ' in ' + dialogText(s));
                    void sdk.sendClickDialog(opt.index);
                } else {
                    void sdk.sendClickDialog(0);
                }
            };
            const unsub = sdk.onStateUpdate(onState);
            const t0 = now(sdk);
            await sdk.sendInteractNpc(cook.index, talk.opIndex);
            await waitUntil(sdk, () => ended !== null, 200);
            unsub();
            const gaps = pages.slice(1).map((p, i) => ({ gap: p.tick - pages[i].tick, after: pages[i].kind }));
            for (const g of gaps) (g.after === 'choice' ? agg.choiceGaps : agg.pageGaps).push(g.gap);
            // The last page closes the dialog: count its click-to-close too.
            if (ended !== null) agg.pageGaps.push(ended - pages[pages.length - 1].tick);
            agg.openTicks.push(pages[0].tick - t0);
            agg.totals.push((ended ?? NaN) - t0);
            agg.pages.push(pages.length);
            console.log(`${branch} run ${run}: click@${t0} first page +${pages[0].tick - t0}, ${pages.length} pages, closed +${(ended ?? NaN) - t0}`);
            for (const p of pages) console.log(`   ${p.tick - t0}\t${p.kind}\t${p.text}`);
            await waitTicks(sdk, 3);
        }
    }
    for (const [b, a] of Object.entries(all)) {
        result(`dialogue.${b}`, { pages: stats(a.pages), firstPageAfterClick: stats(a.openTicks), perContinuePage: stats(a.pageGaps), perChoiceClick: stats(a.choiceGaps), clickToClose: stats(a.totals) });
    }
}, { timeout: 300_000 });
