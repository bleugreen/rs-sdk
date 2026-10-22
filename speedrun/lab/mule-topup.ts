// The trade giver's top-up line (H12's `shark to 15`, helpers/mule.ts serveStaged) against a stand-in
// for SCORED that writes its top-up ask on the frame that shows the trade open, as runner/handoff.ts
// does (rs/393): `writeTopUpAsk(dir, [{ item, count: 15 - held }], Date.now(), { step: 'S15', family: 'mule' })`,
// and no ask when it already holds 15. The mule stages a gold bar and 15 sharks (the line's max),
// keeps a request standing, and serves the package; SCORED takes it with swap() wanting the gold bar
// and exactly the asked sharks.
//
//   LAB_HELPERS=<mule> speedrun/lab/lab.sh <bot> 'speedrun/lab/mule-topup.ts:--mule=<mule>:--held=6,0,15'
//
// One round per `held` (sharks SCORED holds before the trade). Pass: every round's trade completes,
// SCORED receives the gold bar and exactly 15 - held sharks, and the mule's top-up count equals it.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeTopUpAsk, type CueScope } from '../helpers/altar-cue';
import { countById, packageOf, serveStaged } from '../helpers/mule';
import { closeSession, openSession, type Session } from '../lib/session';
import { sameName, swap, tradeOf } from '../lib/trade';
import { nextTick, waitTicks, waitUntil } from '../lib/wait';
import { arg, botArg, result } from './common';
import { cheat, leaveTutorial, tele, VARROCK_WEST_BANK } from './setup';

const SCOPE: CueScope = { step: 'S15', family: 'mule' };
const MAX = 15;
const pkg = packageOf({ name: 'h12-lab', scope: SCOPE, items: [{ item: 'Gold bar', amount: 1 }, { item: 'Shark', topUp: { max: MAX } }] });
const helds = arg('held', '6,0,15').split(',').map(Number);

const scored = await openSession(botArg());
const mule = await openSession(arg('mule', 'srlab2'), { pathfinding: false });
const dir = mkdtempSync(join(tmpdir(), 'mule-topup-cue-'));

async function stage(s: Session, gives: string[], count: number): Promise<void> {
    await cheat(s.sdk, 'setvar tutorial 1000');
    await cheat(s.sdk, '~clearinv inv');
    await waitUntil(s.sdk, st => st.inventory.length === 0, { maxTicks: 10 });
    for (const g of gives) await cheat(s.sdk, g);
    await waitUntil(s.sdk, st => st.inventory.length >= count, { maxTicks: 10 });
    await waitTicks(s.sdk, 2);
}

const sharksIn = (items: Array<{ name: string; count: number }>) => items.filter(i => /^shark$/i.test(i.name)).reduce((n, i) => n + i.count, 0);
const sum = (items: Array<{ name: string; count: number }>) => Object.fromEntries(items.map(i => [i.name, i.count]));

// A fresh lab account starts on Tutorial Island: leave it as S00 does before any teleport (a staging retry, not measured).
for (const s of [scored, mule]) {
    for (let attempt = 1; ; attempt++) {
        try {
            await leaveTutorial(s);
            break;
        } catch (e) {
            if (attempt >= 3) throw e;
        }
    }
}
await tele(scored.sdk, VARROCK_WEST_BANK.x - 1, VARROCK_WEST_BANK.z);
await tele(mule.sdk, VARROCK_WEST_BANK.x + 1, VARROCK_WEST_BANK.z);
const scoredName = scored.sdk.getState()!.player!.name;
const muleName = mule.sdk.getState()!.player!.name;

const rounds: unknown[] = [];
let lastServedMs = 0;
let pass = true;
for (const held of helds) {
    await stage(mule, ['give gold_bar 1', `give shark ${MAX}`], MAX + 1);
    if (held > 0) await stage(scored, [`give shark ${held}`], held);
    else await stage(scored, [], 0);
    const need = Math.max(0, MAX - held);

    // SCORED's half: on the first frame that shows the trade with the mule open, write the ask.
    let ask: { tick: number; count: number } | null = null;
    let scoredOpenTick = -1;
    const unsubScored = scored.sdk.onStateUpdate(st => {
        const t = tradeOf(st);
        if (scoredOpenTick >= 0 || !t.isOpen || !sameName(t.partner, muleName)) return;
        scoredOpenTick = st.tick;
        const n = Math.max(0, MAX - sharksIn(st.inventory));
        if (n > 0) {
            writeTopUpAsk(dir, [{ item: '^shark(?:\\(\\d\\))?$', count: n }], Date.now(), SCOPE);
            ask = { tick: st.tick, count: n };
        }
    });

    // The mule's half: record the open frame, keep a request standing, then serve the staged package.
    let openMs = 0;
    let muleOpenTick = -1;
    const unsubMule = mule.sdk.onStateUpdate(st => {
        if (openMs === 0 && tradeOf(st).isOpen) {
            openMs = Date.now();
            muleOpenTick = st.tick;
        }
    });
    const staged = mule.sdk.getState()!.inventory;
    const logs: string[] = [];
    const muleSide = (async () => {
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
        return serveStaged(mule.sdk, mule.bot, {
            partner: scoredName,
            pkg,
            held: countById(staged),
            timeoutMs: 30_000,
            ask: { dir, openMs: openMs || Date.now(), lastServedMs, maxTicks: 3 },
            log: m => logs.push(m)
        });
    })();
    await waitTicks(scored.sdk, 2);
    const want = [{ item: /^gold bar$/i, amount: 1 }, ...(need > 0 ? [{ item: /^shark$/i, amount: need }] : [])];
    const r = await swap(scored.sdk, muleName, [], want, { closeModals: true });
    const m = await muleSide;
    unsubScored();
    unsubMule();
    if (m.ask) lastServedMs = m.ask.ms;

    const received = sum(r.received);
    const gotSharks = received['Shark'] ?? 0;
    const ok = r.ok && m.success && received['Gold bar'] === 1 && gotSharks === need && (m.topUps[0]?.n ?? -1) === need && (need > 0) === (ask !== null);
    pass &&= ok;
    rounds.push({
        held,
        need,
        ok,
        ask,
        openToAsk: ask ? (ask as { tick: number }).tick - scoredOpenTick : null,
        swap: { ok: r.ok, ticks: r.ticks, openTicks: r.openTicks, received, ...(r.reason ? { reason: r.reason } : {}) },
        mule: { success: m.success, message: m.message, ticks: m.ticks, gave: sum(m.gave), topUps: m.topUps, openTick: muleOpenTick, logs },
        scoredSharksAfter: sharksIn(scored.sdk.getState()!.inventory)
    });
    await waitTicks(scored.sdk, 3);
}

result('mule-topup', { pass, rounds });
await closeSession(scored);
await closeSession(mule);
process.exit(pass ? 0 : 1);
