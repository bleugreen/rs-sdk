// The helper-fed Runecraft cycle inside an altar room: one craft, then one
// trade of essence from a helper standing next to the scored account, repeat.
// One process drives both bots (see runecraft-lib.ts).
//
// Run (through runecraft-lab.sh, which logs the bots in in list order):
//   bun docs/speedrun/scripts/runecraft-cycle.ts <helper>,<scored> [options]
//
// Options:
//   --mode=stock    both bots react to published state with stock SDK calls:
//                   the helper requests after each craft (retrying on "busy"),
//                   the scored account requests back, accepts once the essence
//                   is offered and accepted, accepts the confirm screen, and
//                   crafts when the essence is in its inventory.
//   --mode=tuned    blind tick schedule (runecraft.md section 4). With the craft
//                   on server tick T: both request at T+5, the helper offers all
//                   and accepts at T+6 and the scored account accepts at T+6, both
//                   confirm at T+7 and the scored account clicks the altar in the
//                   same tick. 7 ticks per cycle; needs the helper to be handled
//                   before the scored account each tick (log it in first).
//   --mode=robust   the same, but the scored account accepts and confirms at
//                   T+7 and crafts at T+8 (the helper confirms at T+7 and T+8).
//                   8 ticks, works whichever player the server handles first.
//   --altar=law|nature|air|body   room to use (default law)
//   --level=N       Runecraft level to set (default the altar's level)
//   --cycles=N      crafts to time (default 20)
//   --ess=N         essence per trade (default 27: the helper also carries
//                   the talisman it entered with)
//   --scored=<name> which bot is the scored account (default the last one)
//   --open=K        tuned/robust: the trade requests land on T+K (default 5;
//                   the craft lands on the tick after the publication its
//                   click is sent from, and so does every later click)
//   --gap=MS        tuned/robust: wall-clock wait after a publication before
//                   firing (default 25), so each client has applied that tick

import type { BotSDK } from '../../../sdk/index';
import { ALTARS, cheat, connect, hist, invCount, now, rcXp, result, sleep, stats, tele, waitTicks, waitUntil } from './runecraft-lib';

const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const bots = process.argv[2].split(',');
const scoredName = arg('scored', bots[bots.length - 1]);
const helperName = bots.find(b => b !== scoredName)!;
const mode = arg('mode', 'tuned');
const altarName = arg('altar', 'law');
const A = ALTARS[altarName];
const LEVEL = Number(arg('level', String(A.level)));
const CYCLES = Number(arg('cycles', '20'));
const ESS = Number(arg('ess', '27'));
const OPEN = Number(arg('open', '5'));
const GAP = Number(arg('gap', '25'));
const TALISMAN = `${altarName}_talisman`;

const S = await connect(scoredName);
const H = await connect(helperName);

// ---- setup: both in the room, scored south of the altar, helper east of it
const altarLoc = await (async () => {
    await tele(S, A.enter.x, A.enter.z, A.enter.level);
    return S.getNearbyLocs().find(l => /^altar$/i.test(l.name))!;
})();
if (!altarLoc) throw new Error('no altar visible from the room entry');
// Loc tiles are the south-west corner; altars are 3x3.
const sTile = { x: altarLoc.x + 1, z: altarLoc.z - 1 };
const hTile = { x: altarLoc.x + 2, z: altarLoc.z - 1 };
for (const [sdk, t] of [[S, sTile], [H, hTile]] as const) {
    await cheat(sdk, 'clearinv');
    await tele(sdk, t.x, t.z, A.enter.level);
}
await cheat(S, `setstat runecraft ${LEVEL}`);
await cheat(H, `give ${TALISMAN} 1`);
await cheat(H, `give blankrune ${ESS}`);
await waitTicks(S, 3);
console.log('helper inventory', JSON.stringify(H.getState()!.inventory.map(i => `${i.slot}:${i.name}x${i.count}`)));
console.log('scored inventory', JSON.stringify(S.getState()!.inventory.map(i => `${i.slot}:${i.name}x${i.count}`)));
const hp = () => S.getNearbyPlayers().find(p => p.name.toLowerCase() === helperName.toLowerCase())!;
const sp = () => H.getNearbyPlayers().find(p => p.name.toLowerCase() === scoredName.toLowerCase())!;
if (!hp() || !sp()) throw new Error('bots cannot see each other');
const essSlot = (sdk: BotSDK) => sdk.getState()!.inventory.find(i => /rune essence/i.test(i.name))?.slot ?? -1;

// ---- craft log: every Runecraft xp change the scored account publishes
const crafts: Array<{ tick: number; baseXp: number }> = [];
let lastXp = rcXp(S.getState());
S.onStateUpdate(s => {
    const xp = rcXp(s);
    if (xp > lastXp) crafts.push({ tick: s.tick, baseXp: (xp - lastXp) / 25 });
    lastXp = xp;
});
const positions = new Set<string>();
S.onStateUpdate(s => positions.add(`${s.player?.worldX},${s.player?.worldZ}`));

// --debug: one line per publication per bot (trade screen and accepts,
// essence held, dialog, new messages)
if (process.argv.includes('--debug')) {
    for (const [tag, sdk] of [['S', S], ['H', H]] as const) {
        let seen = 0;
        sdk.onStateUpdate(s => {
            const msgs = s.gameMessages.filter(m => (m.observationId ?? 0) > seen);
            for (const m of msgs) seen = Math.max(seen, m.observationId ?? 0);
            const t = s.trade;
            console.log(`${tag} ${s.tick} trade=${t?.isOpen ? `${t.screen}${t.myAccepted ? '+me' : ''}${t.partnerAccepted ? '+them' : ''} mine=${t.myOffer.length} theirs=${t.theirOffer.length}` : '-'} ess=${invCount(s, /rune essence/i)} xp=${rcXp(s)} dlg=${s.dialog.isOpen ? 1 : 0} ${msgs.map(m => `[${m.type}:${m.text}]`).join(' ')}`);
        });
    }
}

async function refill() {
    if (invCount(H.getState(), /rune essence/i) < ESS) await cheat(H, `give blankrune ${ESS - invCount(H.getState(), /rune essence/i)}`);
}
const craftClick = () => S.sendInteractLoc(altarLoc.x, altarLoc.z, altarLoc.id, 1);

// ---------------------------------------------------------------- stock
async function stockTrade(): Promise<boolean> {
    // helper: request, and retry if the scored account was busy
    const helperSide = (async () => {
        for (let attempt = 0; attempt < 20; attempt++) {
            const t0 = now(H);
            await H.sendTradeRequest(sp().index);
            const r = await waitUntil(H, s => s.trade?.isOpen === true || s.gameMessages.some(m => m.tick > t0 && /is busy/i.test(m.text)), 30);
            if (!r) return false;
            if (r.state.trade?.isOpen) break;
        }
        const open = await waitUntil(H, s => s.trade?.isOpen === true && s.trade.screen === 'offer', 40);
        if (!open) return false;
        await H.sendOfferItem(essSlot(H), -1);
        await waitUntil(H, s => (s.trade?.myOffer.length ?? 0) > 0, 20);
        await H.sendAcceptTrade();
        if (!(await waitUntil(H, s => s.trade?.screen === 'confirm', 40))) return false;
        await H.sendAcceptTrade();
        await waitUntil(H, s => !s.trade?.isOpen, 40);
        return true;
    })();
    // scored: answer the request, accept both screens
    const t0 = now(S);
    const req = await waitUntil(S, s => s.gameMessages.some(m => m.tick > t0 - 1 && /wishes to trade/i.test(m.text)) || s.trade?.isOpen === true, 60);
    if (!req) return false;
    if (!req.state.trade?.isOpen) await S.sendTradeRequest(hp().index);
    if (!(await waitUntil(S, s => (s.trade?.theirOffer.length ?? 0) > 0 && s.trade!.partnerAccepted, 40))) return false;
    await S.sendAcceptTrade();
    if (!(await waitUntil(S, s => s.trade?.screen === 'confirm', 40))) return false;
    await S.sendAcceptTrade();
    const got = await waitUntil(S, s => !s.trade?.isOpen && invCount(s, /rune essence/i) > 0, 40);
    await helperSide;
    return got !== null;
}

async function runStock() {
    if (!(await stockTrade())) throw new Error('first trade failed');
    for (let i = 0; i < CYCLES; i++) {
        const n0 = crafts.length;
        await craftClick();
        await waitUntil(S, () => crafts.length > n0, 30);
        if (S.getState()?.dialog.isOpen) await S.sendClickDialog(0);
        await refill();
        if (!(await stockTrade())) throw new Error(`trade ${i} failed`);
    }
    const n0 = crafts.length;
    await craftClick();
    await waitUntil(S, () => crafts.length > n0, 30);
}

// ------------------------------------------------------- tuned / robust
// Fire `fn` once on the scored account's publication with tick `t`.
function at(t: number, fn: () => void): Promise<void> {
    return new Promise(resolve => {
        const go = () => { sleep(GAP).then(() => { fn(); resolve(); }); };
        if (now(S) >= t) return go();
        const un = S.onStateUpdate(s => { if (s.tick >= t) { un(); go(); } });
    });
}

async function runScheduled(robust: boolean) {
    if (!(await stockTrade())) throw new Error('first trade failed');
    let failures = 0;
    // A click sent after publication p lands on server tick p+1 (in the scored
    // account's numbering). T = the tick the craft lands on; clicks for tick
    // T+j are sent after publication T+j-1.
    let T = now(S) + 1;
    await at(T - 1, () => { craftClick(); });
    for (let i = 0; i < CYCLES; i++) {
        const n0 = crafts.length;
        // refill the helper while the scored account is delayed
        await at(T + 1, () => { refill(); });
        await at(T + OPEN - 1, () => { H.sendTradeRequest(sp().index); S.sendTradeRequest(hp().index); });
        await at(T + OPEN, () => {
            H.sendOfferItem(essSlot(H), -1).then(() => H.sendClickComponent(3420));
            if (!robust) S.sendClickComponent(3420);
        });
        if (!robust) {
            await at(T + OPEN + 1, () => { H.sendClickComponent(3546); S.sendClickComponent(3546).then(() => craftClick()); });
            T = T + OPEN + 2;
        } else {
            await at(T + OPEN + 1, () => { H.sendClickComponent(3546); S.sendClickComponent(3420).then(() => S.sendClickComponent(3546)); });
            await at(T + OPEN + 2, () => { H.sendClickComponent(3546); craftClick(); });
            T = T + OPEN + 3;
        }
        const k = T - 1;
        const ok = await waitUntil(S, () => crafts.length > n0, 8);
        if (!ok || crafts[crafts.length - 1].tick > k + 3) {
            failures++;
            console.log(`cycle ${i} missed (craft seen ${ok ? crafts[crafts.length - 1].tick - k : 'never'})`);
            if (!ok) {
                // resync: close anything open, re-run one stock trade and craft
                await S.sendCloseModal(); await H.sendCloseModal();
                await waitTicks(S, 2); await refill();
                if (!(await stockTrade())) throw new Error('resync trade failed');
                T = now(S) + 1;
                await at(T - 1, () => { craftClick(); });
            }
        }
    }
    return failures;
}

let failures = 0;
if (mode === 'stock') await runStock();
else failures = await runScheduled(mode === 'robust');
await waitTicks(S, 3);

const gaps = crafts.slice(1).map((c, i) => c.tick - crafts[i].tick);
const baseTotal = crafts.slice(1).reduce((a, c) => a + c.baseXp, 0);
const ticks = crafts[crafts.length - 1].tick - crafts[0].tick;
result('cycle', {
    mode, altar: altarName, level: LEVEL, ess: ESS, open: OPEN, scored: scoredName, helper: helperName,
    crafts: crafts.length, failures, gapHist: hist(gaps), gap: stats(gaps),
    basePerCraft: stats(crafts.map(c => c.baseXp)),
    basePerTick: Math.round((baseTotal / ticks) * 100) / 100,
    scoredTiles: [...positions],
});
await S.disconnect(); await H.disconnect();
process.exit(0);
