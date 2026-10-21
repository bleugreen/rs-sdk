// Helper-fed anvil smithing (docs/speedrun/skills/smithing.md): a helper standing next to the
// scored account trades it the next inventory of bars and takes the finished items back in the
// same trade, so the scored account never banks or drops.
//
//   bun docs/speedrun/scripts/smithing-trade.ts <scored> --helper <bot> [--product adamant_platebody
//       --level 99 --cycles 4]          fixed product, one inventory per trade
//   bun docs/speedrun/scripts/smithing-trade.ts <scored> --helper <bot> --from 1 --until 99
//                                       route: the per-item plan of smithing-model.ts
//   common: [--dispose trade|drop] [--dialog ignore|click] [--minutes 40]
//
// Run it through smithing-lab.sh with HELPER=<bot>. It spawns itself as the helper
// (`--role helper`); the two processes share a plan file under $TMPDIR naming the next
// inventory's bars ({seq, bars, products}).
//
// Packet plan (all raw packets, from observed ticks):
//   free     from the tick after the inventory's last xp, trade-op the helper every tick (the
//            helper also requests every tick; a request to a delayed player is refused,
//            trade.rs2 [opplayer4,_], so whichever lands first opens the trade).
//   trade    offer-all once per finished item id; accept when the helper's bars and our
//            items are both on the screen; accept the confirm screen. The space check
//            (trade.rs2 enough_trade_space) counts the room our own offer frees.
//   anvil    use-bar-on-anvil every tick until the smithing interface opens, then make-10 /
//            make-5 / make-1 for the planned count (INV_BUTTON3/2/1).
// Level-up dialogs are clicked through the tick they appear.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';

const argv = process.argv.slice(2);
function arg(name: string, def: string): string {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : def;
}
const ROLE = arg('role', 'scored');
const PRODUCT = arg('product', 'adamant_platebody');
const LEVEL = Number(arg('level', '99'));
const CYCLES = Number(arg('cycles', '4'));
const FROM = Number(arg('from', '0'));
const UNTIL = Number(arg('until', '0'));
const OVERHEAD = Number(arg('overhead', '7')); // plan only: per-inventory turnaround
const SWITCH = Number(arg('switch', '2')); // plan only: cost of changing item in an inventory
const PLAN_FILE = arg('planfile', `${process.env.TMPDIR ?? '/tmp'}/smithing-trade-plan.json`);
const STALL = Number(arg('stall', '100'));
// trade: hand finished items back inside the trade. drop: drop up to 3 with the trade click and
// the rest with the next use-bar (5-bar items only: 25 free slots are needed for the bars).
const DISPOSE = arg('dispose', 'trade');
// click: dismiss level-up dialogs and wait for them to close before clicking the anvil.
// ignore: never touch them (the next use-bar-on-anvil interaction replaces the chat modal).
const DIALOG = arg('dialog', 'ignore');

const ANVIL: [number, number] = [3188, 3426]; // Varrock west anvil (loc 2783)
const ANVIL_ID = 2783;
const SCORED_TILE: [number, number] = [3187, 3426];
const HELPER_TILE: [number, number] = [3187, 3427];
const SMITHING_IF = 994;
const COLUMN_BASE = 1119; // interface.pack: 1119=smithing:column1 .. 1123=column5
const CAP = 27;

// ---- content tables ----
const CONTENT = join(import.meta.dir, '../../../server/content/scripts/skill_smithing/configs/smithing');
type Row = { name: string; level: number; bar: string; bars: number; xp: number; com: number; slot: number };
const XP_PER_BAR: Record<string, number> = {};
{
    let cur: Record<string, string> = {};
    const flush = () => { if (cur.namedobj) XP_PER_BAR[cur.namedobj] = Number(cur.xpperbar) / 10; };
    for (const l of readFileSync(join(CONTENT, 'smithing.struct'), 'utf8').split('\n')) {
        if (l.startsWith('[')) { flush(); cur = {}; }
        const m = l.match(/^param=(\w+),(.*)$/);
        if (m) cur[m[1]!] = m[2]!;
    }
    flush();
}
const SLOT_OF = new Map<string, { com: number; slot: number }>();
{
    let inv = '';
    for (const l of readFileSync(join(CONTENT, 'smithing.inv'), 'utf8').split('\n')) {
        const h = l.match(/^\[smithing_[a-z]+(\d)\]$/);
        if (h) { inv = h[1]!; continue; }
        if (l.startsWith('[')) { inv = ''; continue; }
        const m = l.match(/^stock(\d+)=(\w+),/);
        if (m && inv) SLOT_OF.set(m[2]!, { com: COLUMN_BASE + Number(inv) - 1, slot: Number(m[1]) - 1 });
    }
}
const ROWS: Row[] = [];
{
    let cur: Record<string, string> = {};
    let name = '';
    const flush = () => {
        const pos = SLOT_OF.get(name);
        if (!cur.bar || !pos || /dart_tip|claws/.test(name)) return;
        const bars = Number(cur.bar_amount);
        ROWS.push({ name, level: Number(cur.levelrequired), bar: cur.bar, bars, xp: bars * XP_PER_BAR[cur.bar]!, ...pos });
    };
    for (const l of readFileSync(join(CONTENT, 'smithing.dbrow'), 'utf8').split('\n')) {
        const h = l.match(/^\[(\w+)\]$/);
        if (h) { flush(); cur = {}; name = h[1]!; continue; }
        const m = l.match(/^data=(\w+),(.*)$/);
        if (m) cur[m[1]!] = m[2]!;
    }
    flush();
}
const barRe = (bar: string) => new RegExp(`^${bar.replace('_', ' ')}$`, 'i');

// ---- level table (Player.ts) and the plan (same rule as smithing-model.ts) ----
const LEVEL_XP: number[] = [];
{
    let acc = 0;
    for (let i = 0; i < 99; i++) { acc += Math.floor(i + 1 + Math.pow(2.0, (i + 1) / 10.0) * 300.0); LEVEL_XP[i] = Math.floor(acc / 4) * 10; }
}
const baseFor = (level: number) => (level <= 1 ? 0 : LEVEL_XP[level - 2]! / 10 / 25);
const levelFor = (base: number) => { for (let l = 99; l > 1; l--) if (base + 1e-9 >= baseFor(l)) return l; return 1; };
type Seg = { row: Row; count: number };
type Inv = { segs: Seg[]; bars: Record<string, number> };
function routePlan(from: number, until: number): Inv[] {
    const rate = (r: Row) => r.xp / (5 + (r.bars * OVERHEAD) / CAP);
    const invs: Inv[] = [];
    let base = baseFor(from);
    let used = CAP;
    while (base < baseFor(until)) {
        const level = levelFor(base);
        const r = ROWS.filter(x => x.level <= level).sort((a, b) => rate(b) - rate(a) || b.xp - a.xp)[0]!;
        if (used + r.bars > CAP) { invs.push({ segs: [], bars: {} }); used = 0; }
        const inv = invs[invs.length - 1]!;
        const last = inv.segs[inv.segs.length - 1];
        if (last && last.row === r) last.count++; else inv.segs.push({ row: r, count: 1 });
        inv.bars[r.bar] = (inv.bars[r.bar] ?? 0) + r.bars;
        used += r.bars;
        base += r.xp;
    }
    return invs;
}
function fixedPlan(product: string, cycles: number): Inv[] {
    const r = ROWS.find(x => x.name === product);
    if (!r) throw new Error(`unknown product ${product}`);
    const n = Math.floor(CAP / r.bars);
    return Array.from({ length: cycles + 1 }, () => ({ segs: [{ row: r, count: n }], bars: { [r.bar]: n * r.bars } }));
}

// ---- tick helpers ----
function nextTick(sdk: any, after: number): Promise<BotWorldState> {
    return new Promise(resolve => {
        const cur = sdk.getState() as BotWorldState | null;
        if (cur && cur.tick > after) return resolve(cur);
        const off = sdk.onStateUpdate((s: BotWorldState) => { if (s.tick > after) { off(); resolve(s); } });
    });
}
async function waitTicks(sdk: any, n: number): Promise<BotWorldState> {
    let s = sdk.getState() as BotWorldState;
    const t = s.tick + n;
    while (s.tick < t) s = await nextTick(sdk, s.tick);
    return s;
}
const tele = (p: [number, number]) => `::tele 0,${p[0] >> 6},${p[1] >> 6},${p[0] & 63},${p[1] & 63}`;
const count = (items: { name: string; count: number }[], re: RegExp) => items.filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
const smith = (s: BotWorldState) => s.skills.find(k => k.name === 'Smithing')!;
type PlanMsg = { seq: number; bars: Record<string, number>; products: number };

async function clearInventory(sdk: any, keep: RegExp) {
    for (let k = 0; k < 12; k++) {
        const s = sdk.getState() as BotWorldState;
        const junk = s.inventory.filter(i => !keep.test(i.name)).slice(0, 5);
        if (!junk.length) return;
        for (const j of junk) sdk.sendDropItem(j.slot).catch(() => {});
        await waitTicks(sdk, 2);
    }
}

// ================= helper =================
if (ROLE === 'helper') {
    const partner = arg('partner', '').toLowerCase();
    await runScript(async ({ bot, sdk }) => {
        await bot.skipTutorial?.();
        await sdk.sendSay(tele(HELPER_TILE));
        await waitTicks(sdk, 3);
        await clearInventory(sdk, /^$/);
        let s = await waitTicks(sdk, 1);
        let delivered = -1;
        let inTrade = false;
        let tradingSeq = -1;
        let seenSeq = -1;
        let seenTick = -1;
        let stagedSeq = -1;
        let stagedAt = -1;
        let offeredTick = -1;
        let gaveTick = -99;
        let plan: PlanMsg | null = null;
        const end = Date.now() + 60 * 60_000;
        while (Date.now() < end) {
            s = await nextTick(sdk, s.tick);
            try { plan = JSON.parse(readFileSync(PLAN_FILE, 'utf8')) as PlanMsg; } catch { /* mid-write */ }
            if (!plan) continue;
            if ((plan as any).stop) break;
            const t = s.trade;
            if (t?.isOpen) {
                if (!inTrade) { inTrade = true; tradingSeq = plan.seq; offeredTick = -99; }
                if (t.screen === 'offer') {
                    // Offer and accept in one tick. An offer resets both accepts (trade.rs2
                    // movetotrade), so if the scored account's offer lands after ours we re-accept
                    // on the next tick that shows it accepted.
                    const want = Object.values(plan.bars).reduce((a, b) => a + b, 0);
                    if (t.myOffer.reduce((a, i) => a + i.count, 0) < want && s.tick > offeredTick + 1) {
                        for (const bar of Object.keys(plan.bars)) {
                            if (count(t.myOffer, barRe(bar)) >= plan.bars[bar]!) continue;
                            const it = s.inventory.find(i => barRe(bar).test(i.name));
                            if (it) sdk.sendOfferItem(it.slot, -1).catch(() => {});
                        }
                        sdk.sendAcceptTrade().catch(() => {});
                        offeredTick = s.tick;
                    } else if (!t.myAccepted && s.tick > offeredTick) sdk.sendAcceptTrade().catch(() => {});
                } else if (t.screen === 'confirm' && !t.myAccepted) sdk.sendAcceptTrade().catch(() => {});
                continue;
            }
            if (inTrade) {
                inTrade = false;
                if (!Object.keys(plan.bars).some(b => count(s.inventory, barRe(b)) > 0)) delivered = tradingSeq;
            }
            if (plan.seq !== seenSeq) { seenSeq = plan.seq; seenTick = s.tick; }
            if (delivered >= plan.seq) {
                // Idle: get rid of the finished items the scored account handed back.
                const junk = s.inventory.slice(0, 5);
                for (const j of junk) sdk.sendDropItem(j.slot).catch(() => {});
                continue;
            }
            // Stage exactly the planned bars, then keep requesting the trade.
            const extra = s.inventory.filter(i => !Object.keys(plan!.bars).some(b => barRe(b).test(i.name)));
            const over = Object.keys(plan.bars).flatMap(b => s.inventory.filter(i => barRe(b).test(i.name)).slice(plan!.bars[b]!));
            const drops = [...extra, ...over].slice(0, 5);
            if (drops.length) { for (const d of drops) sdk.sendDropItem(d.slot).catch(() => {}); continue; }
            const short = Object.entries(plan.bars).filter(([b, n]) => count(s.inventory, barRe(b)) < n);
            if (short.length) {
                if (s.tick - gaveTick > 3) {
                    for (const [b, n] of short) sdk.sendSay(`::give ${b} ${n - count(s.inventory, barRe(b))}`).catch(() => {});
                    gaveTick = s.tick;
                }
                continue;
            }
            if (stagedSeq === plan.seq && s.tick - stagedAt === 32 && !s.trade?.isOpen) console.log(`HELPER waiting seq ${plan.seq} at ${s.tick}: pos ${s.player?.worldX},${s.player?.worldZ} msgs ${s.gameMessages.slice(-5).map(m => `${m.tick}:${m.text}`).join(' | ')}`);
            if (stagedSeq !== plan.seq) { stagedAt = s.tick; stagedSeq = plan.seq; console.log(`HELPER seq ${plan.seq}: plan seen ${seenTick}, staged ${s.tick}`); }
            const p = s.nearbyPlayers.find(x => x.name.toLowerCase() === partner);
            if (p) sdk.sendTradeRequest(p.index).catch(() => {});
        }
    }, { timeout: 61 * 60_000, printState: false });
    process.exit(0);
}

// ================= scored account =================
const HELPER = arg('helper', 'smithhelp');
const route = UNTIL > 0;
const start = route ? FROM || 1 : LEVEL;
const PLAN = route ? routePlan(start, UNTIL) : fixedPlan(PRODUCT, CYCLES);
type InvLog = { request: number; tradeOpen: number; barsIn: number; clicks: number[]; xps: number[] };

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial?.();
    await sdk.sendSay(`::setstat smithing ${start}`);
    await sdk.sendSay(tele(SCORED_TILE));
    let s = await waitTicks(sdk, 3);
    for (let k = 0; k < 20 && smith(s).baseLevel !== start; k++) s = await waitTicks(sdk, 1);
    await clearInventory(sdk, /^hammer$/i);
    if (!(sdk.getState() as BotWorldState).inventory.some(i => /^hammer$/i.test(i.name))) await sdk.sendSay('::give hammer 1');
    s = await waitTicks(sdk, 3);
    console.log(`dispose=${DISPOSE} dialog=${DIALOG}; plan: ${PLAN.length} inventories from level ${smith(s).baseLevel}; first: ${PLAN[0]!.segs.map(g => `${g.count}x ${g.row.name}`).join(', ')}`);
    if (route) for (const [i, inv] of PLAN.entries()) if (inv.segs.length > 1 || i < 3) console.log(`  inv ${i}: ${inv.segs.map(g => `${g.count}x ${g.row.name}`).join(', ')}`);

    const me = s.player!.name;
    const writePlan = (seq: number, products: number) => writeFileSync(PLAN_FILE, JSON.stringify({ seq, bars: PLAN[seq]?.bars ?? {}, products } satisfies PlanMsg));
    writePlan(0, 0);
    const helperProc = Bun.spawn(['bun', import.meta.path, HELPER, '--role', 'helper', '--partner', me, '--planfile', PLAN_FILE], { stdout: 'inherit', stderr: 'inherit' });

    let phase: 'free' | 'trade' | 'anvil' | 'smith' = 'free';
    let inv = 0;
    let seg = 0;
    let left = PLAN[0]!.segs[0]!.count;
    let expect = 0;
    let freeFrom = s.tick;
    let lastXp = smith(s).experience;
    let progress = s.tick;
    const logs: InvLog[] = [{ request: -1, tradeOpen: -1, barsIn: -1, clicks: [], xps: [] }];
    const levelTicks: Record<number, number> = {};
    let dialogTicks = 0; // observed ticks with a chat dialog (level-up) open
    let firstRequest = -1;
    let reached = -1;
    const offered = new Set<number>();
    let lastClick = -99;
    let lastXpTick = -99;
    let clickArgs: [number, number, number] = [0, 1, 0];
    let retries = 0;
    let closes = 0;
    const end = Date.now() + Number(arg('minutes', '40')) * 60_000;
    const done = () => (route ? reached >= 0 : inv >= CYCLES) || Date.now() > end;

    while (!done()) {
        s = await nextTick(sdk, s.tick);
        const log = logs[inv]!;
        if (s.dialog.isOpen) { dialogTicks++; if (DIALOG === 'click') sdk.sendClickDialog(0).catch(() => {}); }
        const sk = smith(s);
        if (!levelTicks[sk.baseLevel]) levelTicks[sk.baseLevel] = s.tick;
        if (route && sk.baseLevel >= UNTIL) { reached = s.tick; log.xps.push(s.tick); break; }
        if (sk.experience > lastXp) {
            lastXp = sk.experience;
            lastXpTick = s.tick;
            progress = s.tick;
            log.xps.push(s.tick);
            expect--;
            left--;
            if (expect <= 0 && phase === 'smith') {
                freeFrom = s.tick + 1;
                if (left > 0) phase = 'anvil';
                else if (++seg < PLAN[inv]!.segs.length) { left = PLAN[inv]!.segs[seg]!.count; phase = 'anvil'; }
                else {
                    phase = 'free';
                    inv++;
                    if (inv >= PLAN.length || (!route && inv >= CYCLES)) break;
                    logs.push({ request: -1, tradeOpen: -1, barsIn: -1, clicks: [], xps: [] });
                    seg = 0;
                    left = PLAN[inv]!.segs[0]!.count;
                    offered.clear();
                }
            }
        }
        if (s.tick - progress > STALL) {
            console.log(`STALL phase ${phase} inv ${inv} seg ${seg} left ${left} at ${s.tick}: trade ${JSON.stringify(s.trade)} if ${s.interface?.interfaceId} dialog ${s.dialog.isOpen}`);
            console.log(s.gameMessages.slice(-6).map(m => m.text).join(' | '));
            break;
        }
        const L = logs[inv]!;
        if (phase === 'free' && s.tick >= freeFrom) {
            if (s.trade?.isOpen) { phase = 'trade'; L.tradeOpen = s.tick; progress = s.tick; }
            else {
                // An open chat modal (level-up dialog, "not enough bars" mesbox) makes us busy()
                // (Player.ts), and the helper's trade requests bounce off until it closes.
                if (s.dialog.isOpen || s.modalOpen) { sdk.sendCloseModal().catch(() => {}); closes++; }
                if (L.request > 0 && s.tick - L.request === 8) console.log(`SLOW OPEN inv ${inv} at ${s.tick}: pos ${s.player?.worldX},${s.player?.worldZ} helper ${JSON.stringify(s.nearbyPlayers.map(p => [p.name, p.x, p.z]))} msgs ${s.gameMessages.slice(-5).map(m => `${m.tick}:${m.text}`).join(' | ')}`);
                const h = s.nearbyPlayers.find(p => p.name.toLowerCase() === HELPER.toLowerCase());
                if (h) {
                    if (DISPOSE === 'drop') for (const p of s.inventory.filter(i => !/^hammer$/i.test(i.name)).slice(0, 3)) sdk.sendDropItem(p.slot).catch(() => {});
                    sdk.sendTradeRequest(h.index).catch(() => {});
                    if (L.request < 0) L.request = s.tick;
                    if (firstRequest < 0) firstRequest = s.tick;
                }
            }
        }
        if (phase === 'trade') {
            const t = s.trade;
            const want = Object.values(PLAN[inv]!.bars).reduce((a, b) => a + b, 0);
            if (t?.isOpen && t.screen === 'offer') {
                // Offer-all once per finished item id (the trade-side inventory keeps main-inventory slots).
                // Offer-all once per finished item id, then accept in the same tick (see the helper).
                const products = DISPOSE === 'drop' ? [] : s.inventory.filter(i => !/^hammer$/i.test(i.name) && !offered.has(i.id));
                for (const p of products.slice(0, 4)) { sdk.sendOfferItem(p.slot, -1).catch(() => {}); offered.add(p.id); }
                const theirs = t.theirOffer.reduce((a, i) => a + i.count, 0);
                if (products.length && products.length <= 4) sdk.sendAcceptTrade().catch(() => {});
                else if (!products.length && !t.myAccepted && (theirs >= want || s.tick === L.tradeOpen)) sdk.sendAcceptTrade().catch(() => {});
            } else if (t?.isOpen && t.screen === 'confirm' && !t.myAccepted) sdk.sendAcceptTrade().catch(() => {});
            else if (!t?.isOpen) {
                const have = Object.keys(PLAN[inv]!.bars).reduce((a, b) => a + count(s.inventory, barRe(b)), 0);
                if (have >= want) {
                    L.barsIn = s.tick;
                    progress = s.tick;
                    phase = 'anvil';
                    freeFrom = s.tick;
                    writePlan(inv + 1, DISPOSE === 'drop' ? 0 : PLAN[inv]!.segs.reduce((a, g) => a + g.count, 0));
                } else if (s.tick - L.tradeOpen > 10) { phase = 'free'; offered.clear(); }
            }
        }
        // attempt_smithing starts with if_close, so while the interface is still open after a
        // click the click was refused (InvButtonHandler); re-send it. A click that closed the
        // interface without xp falls back to a fresh use-bar.
        if (phase === 'smith' && s.tick > lastClick && s.tick - progress > 2 && lastXpTick < lastClick) {
            if (s.interface?.isOpen && s.interface.interfaceId === SMITHING_IF) {
                sdk.sendClickComponentWithOption(clickArgs[0], clickArgs[1], clickArgs[2]).catch(() => {});
                lastClick = s.tick;
                retries++;
            } else if (s.tick - lastClick > 5) { phase = 'anvil'; retries++; }
        }
        if (phase === 'anvil' && s.tick >= freeFrom && !(DIALOG === 'click' && s.dialog.isOpen)) {
            const g = PLAN[inv]!.segs[seg]!;
            if (s.interface?.isOpen && s.interface.interfaceId === SMITHING_IF) {
                // When no later item in this inventory needs this bar, make-5/make-10 runs until
                // the bars are gone (smithing.rs2 stops with a mesbox), so any count is one click.
                const lastOfBar = !PLAN[inv]!.segs.slice(seg + 1).some(x => x.row.bar === g.row.bar);
                const make = left >= 10 || (lastOfBar && left > 5) ? 10 : left >= 5 || (lastOfBar && left > 1) ? 5 : 1;
                clickArgs = [g.row.com, make === 10 ? 3 : make === 5 ? 2 : 1, g.row.slot];
                sdk.sendClickComponentWithOption(clickArgs[0], clickArgs[1], clickArgs[2]).catch(() => {});
                expect = Math.min(make, left);
                lastClick = s.tick;
                L.clicks.push(s.tick);
                phase = 'smith';
            } else {
                const bar = s.inventory.find(i => barRe(g.row.bar).test(i.name));
                const a = s.nearbyLocs.find(l => l.id === ANVIL_ID && l.x === ANVIL[0] && l.z === ANVIL[1]);
                if (bar && a) {
                    sdk.sendUseItemOnLoc(bar.slot, a.x, a.z, a.id).catch(() => {});
                    if (DISPOSE === 'drop') {
                        const isBar = (n: string) => Object.keys(PLAN[inv]!.bars).some(b => barRe(b).test(n));
                        for (const p of s.inventory.filter(i => !/^hammer$/i.test(i.name) && !isBar(i.name)).slice(0, 3)) sdk.sendDropItem(p.slot).catch(() => {});
                    }
                }
            }
        }
    }
    writeFileSync(PLAN_FILE, JSON.stringify({ stop: true, seq: 1e9, bars: {}, products: 0 }));

    // ---- report ----
    console.log('\ninv  request  ->open  ->barsIn  ->click  xp ticks after first click              lastXp->nextClick  click->nextClick');
    logs.forEach((l, i) => {
        const c0 = l.clicks[0] ?? -1;
        const next = logs[i + 1]?.clicks[0] ?? -1;
        const last = l.xps[l.xps.length - 1] ?? -1;
        console.log(`${String(i).padStart(3)}  ${String(l.request).padStart(7)}  ${String(l.tradeOpen - l.request).padStart(6)}  ${String(l.barsIn - l.tradeOpen).padStart(7)}  ${String(c0 - l.barsIn).padStart(7)}  ${l.xps.map(t => t - c0).join(',').padEnd(40)} ${String(next > 0 ? next - last : '-').padStart(17)}  ${String(next > 0 ? next - c0 : '-').padStart(16)}`);
    });
    const full = logs.filter((l, i) => logs[i + 1]?.clicks.length && l.clicks.length);
    if (full.length) {
        const per = full.map(l => logs[logs.indexOf(l) + 1]!.clicks[0]! - l.clicks[0]!);
        console.log(`click->next click: ${per.join(' ')} (mean ${(per.reduce((a, b) => a + b, 0) / per.length).toFixed(2)})`);
    }
    const gaps: Record<number, number> = {};
    for (const l of logs) for (let i = 1; i < l.xps.length; i++) { const g = l.xps[i]! - l.xps[i - 1]!; gaps[g] = (gaps[g] ?? 0) + 1; }
    console.log(`xp gap histogram (within inventories): ${JSON.stringify(gaps)}`);
    console.log(`close-modal sends: ${closes}; interface click resends: ${retries}; ticks with a dialog open: ${dialogTicks}; levels ${Math.min(...Object.keys(levelTicks).map(Number))} -> ${smith(s).baseLevel}`);
    if (route) {
        console.log(`route ${start} -> ${UNTIL}: first trade request ${firstRequest}, level ${UNTIL} at ${reached}: ${reached - firstRequest} ticks over ${logs.length} inventories (plan ${PLAN.length})`);
        const marks = [10, 20, 30, 33, 40, 48, 50, 60, 68, 70, 80, 88, 90, 95, 99].filter(l => levelTicks[l]);
        console.log(`ticks from first request to level: ${marks.map(l => `${l}:${levelTicks[l]! - firstRequest}`).join(' ')}`);
    }
    helperProc.kill();
}, { timeout: 61 * 60_000 });
