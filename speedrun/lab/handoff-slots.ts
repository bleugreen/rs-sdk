// rs/319's two slot-ledger trades on the lab engine, each run by the module's own step against
// rs/41's mule giver (speedrun/helpers/mule.ts giveOpenTrade, burst mode, which accepts what the
// other side offers back) as the trade giver's stand-in:
//
//   1. woodcutting:hand-back at the willow stand, Woodcutting 99: SCORED gives the rune axe and
//      3 leftover bones and takes T07-08's Camelot runes (1 law, 5 air). Ledger rows H4.end, T07-08.
//   2. mining.kit: H4p at the zoo, Mining 64: SCORED receives the rune pickaxe and 2 logs. Then, at
//      Mining 99, mining.exit drops the pickaxe, the logs and a leftover ore. Rows H4p, S09, H7.
//
//   LAB_HELPERS=<mule> speedrun/lab/lab.sh <scored> 'speedrun/lab/handoff-slots.ts:--mule=<mule>'
//
// Pass: each trade ok on both sides and SCORED's pack exactly as the ledger has it after each row.

import { giveOpenTrade } from '../helpers/mule';
import { closeSession, openSession, type Session } from '../lib/session';
import { sameName, tradeOf } from '../lib/trade';
import { nextTick, waitTicks, waitUntil } from '../lib/wait';
import { steps as miningSteps } from '../skills/mining';
import { steps as woodcuttingSteps } from '../skills/woodcutting';
import { arg, botArg, labLog, result } from './common';
import { cheat, leaveTutorial, setstat, tele } from './setup';

const scored = await openSession(botArg());
const mule = await openSession(arg('mule', 'srlab2'), { pathfinding: false });
await leaveTutorial(scored);
await leaveTutorial(mule);
const log = labLog('handoff-slots');
const ctx = { session: scored, sdk: scored.sdk, bot: scored.bot, c: {}, log } as never;

async function stage(s: Session, gives: string[], count: number): Promise<void> {
    await cheat(s.sdk, '~clearinv inv');
    await waitUntil(s.sdk, st => st.inventory.length === 0, { maxTicks: 10 });
    for (const g of gives) await cheat(s.sdk, g);
    await waitUntil(s.sdk, st => st.inventory.length >= count, { maxTicks: 10 });
    await waitTicks(s.sdk, 2);
}

/** The mule keeps a request standing, then gives its whole pack and accepts whatever comes back. */
function muleGives(scoredName: string) {
    const items = mule.sdk.getState()!.inventory;
    return (async () => {
        let last = -99;
        for (let i = 0; i < 60; i++) {
            const st = await nextTick(mule.sdk);
            if (tradeOf(st).isOpen) break;
            const p = st.nearbyPlayers.find(x => sameName(x.name, scoredName));
            if (p && st.tick - last >= 4) {
                void mule.sdk.sendTradeRequest(p.index);
                last = st.tick;
            }
        }
        return giveOpenTrade(mule.sdk, mule.bot, scoredName, items, 'burst', 30_000);
    })();
}

const pack = (s: Session) => s.sdk.getState()!.inventory.map(i => `${i.name} x${i.count}`).sort();
const sum = (items: Array<{ name: string; count: number }>) => items.map(i => `${i.name} x${i.count}`).sort();
const scoredName = scored.sdk.getState()!.player!.name;
const muleName = mule.sdk.getState()!.player!.name;

// ---- 1. the hand-back (rs/158 spec 2)
await tele(scored.sdk, 2920, 3406);
await tele(mule.sdk, 2920, 3407);
await setstat(scored.sdk, 'woodcutting', 99);
await stage(scored, ['give rune_axe 1', 'give knife 1', 'give logs 1', 'give dragon_bones 3'], 6);
await stage(mule, ['give law_rune 1', 'give air_rune 5'], 2);
const handBack = woodcuttingSteps({ handBack: muleName }).find(s => s.name === 'woodcutting:hand-back')!;
const pre1 = handBack.preconditions(scored.sdk.getState()!, {});
const m1 = muleGives(scoredName);
await waitTicks(scored.sdk, 2);
let err1: string | null = null;
await handBack.run(ctx).catch(e => (err1 = String(e)));
const r1 = await m1;
await waitTicks(scored.sdk, 2);
const after1 = pack(scored);
const post1 = handBack.postconditions(scored.sdk.getState()!, {});
const want1 = ['Air rune x5', 'Knife x1', 'Law rune x1', 'Logs x1'];
const pass1 = pre1 === true && err1 === null && post1 === true && r1.success && JSON.stringify(after1) === JSON.stringify(want1)
    && JSON.stringify(sum(r1.received)) === JSON.stringify(['Dragon bones x3', 'Rune axe x1']);
const row1 = log.rows.find(r => r.step === 'woodcutting:hand-back');

// ---- 2. H4p at the zoo, then the exit drops (rs/158 specs 3 and 4)
await tele(scored.sdk, 2607, 3235);
await tele(mule.sdk, 2608, 3235);
await setstat(scored.sdk, 'mining', 64);
await stage(scored, ['give knife 1', 'give logs 1'], 2);
await stage(mule, ['give rune_pickaxe 1', 'give logs 2'], 3);
const all = miningSteps({ travel: 'none', respawn: 13, kitGiver: muleName, dropAtExit: true });
const kit = all.find(s => s.name === 'mining.kit: H4p')!;
const exit = all.find(s => s.name === 'mining.exit')!;
const pre2 = kit.preconditions(scored.sdk.getState()!, {});
const m2 = muleGives(scoredName);
await waitTicks(scored.sdk, 2);
let err2: string | null = null;
await kit.run(ctx).catch(e => (err2 = String(e)));
const r2 = await m2;
await waitTicks(scored.sdk, 2);
const after2 = pack(scored);
const post2 = kit.postconditions(scored.sdk.getState()!, {});
const want2 = ['Knife x1', 'Logs x1', 'Logs x1', 'Logs x1', 'Rune pickaxe x1'];
const pass2 = pre2 === true && err2 === null && post2 === true && r2.success && JSON.stringify(after2) === JSON.stringify(want2);

await setstat(scored.sdk, 'mining', 99);
await cheat(scored.sdk, 'give iron_ore 1');
await waitUntil(scored.sdk, st => st.inventory.some(i => /iron ore/i.test(i.name)), { maxTicks: 10 });
const t0 = scored.sdk.getState()!.tick;
await exit.run(ctx);
const runTicks = scored.sdk.getState()!.tick - t0;
await waitTicks(scored.sdk, 2);
const after3 = pack(scored);
const pass3 = runTicks === 0 && JSON.stringify(after3) === JSON.stringify(['Knife x1']) && exit.done!({ state: scored.sdk.getState()!, probed: {} }, {}) === true;

const pass = pass1 && pass2 && pass3;
result('handoff-slots', {
    pass,
    handBack: { pass: pass1, pre: pre1, error: err1, post: post1, after: after1, free: 28 - after1.length, row: row1?.meta, mule: { success: r1.success, ticks: r1.ticks, received: sum(r1.received), message: r1.message } },
    kit: { pass: pass2, pre: pre2, error: err2, post: post2, after: after2, free: 28 - after2.length, mule: { success: r2.success, ticks: r2.ticks, message: r2.message } },
    exit: { pass: pass3, runTicks, after: after3, free: 28 - after3.length },
});
await closeSession(scored);
await closeSession(mule);
process.exit(pass ? 0 : 1);
