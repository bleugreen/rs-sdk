// The Thieving stun pack (rs/106): Knights of Ardougne with dragon bones, Charge 80-99 and
// Fletching (arrowheads on headless arrows) inside each pickpocket stun, eating in success
// windows, and top-up trades from a helper bot standing beside the knights.
//
//   bun docs/speedrun/scripts/stun-pack-thieve.ts <scored-bot> [--helper=<bot>] [flags]
//
// Derived by copying interleave-thieve.ts (stun plans) and thieving-pickpocket.ts (roll timing by
// message, success-window eating); neither is edited. Both bots are driven from this one process
// through speedrun/lib/session.ts, and the top-up trade runs speedrun/lib/trade.ts's per-tick
// decisions (decideReceiver on SCORED, planOffers + decideGiver on the helper).
//
// Flags (defaults in brackets):
//   --level=57 --until=99      Thieving start level; stop when the base level reaches --until.
//   --hold=1 --ticks=N         hold Thieving at --level (setstat on every level-up) and stop after N
//                              ticks; Magic resets to 80 at 99 and Fletching to 75 at 99, so a
//                              fixed-level variant keeps carrying the pack.
//   --bones=3                  bones buried per stun: 0, 2 or 3 (picks the stun plan below).
//   --plan="2:hhhb,..."        explicit stun plan (overrides --bones).
//   --charge=in|out|off [in]   Charge inside stuns (as plan 'h' slots), outside them (3 casts
//                              before every knight click), or not at all.
//   --fletch=on|off [on]       arrows as plan 'h' slots.
//   --topup=stun|success|give [stun]  where a bone top-up trade goes: at the start of a stun, in
//                              place of the click after a success, or a ::give stand-in (no trade).
//   --helper=<bot>             the helper bot (needed for stun|success).
//   --hp=97 --magic=80 --fletching=1 --prayer=43 --defence=89   SCORED's post-MM stats.
//   --sharks=4                 sharks carried; each top-up brings the stock back to this.
//   --eatbelow=maxHp-20        eat a shark in a success window at or below this HP.
//   --margin=1                 free slots left in a bone load (a new arrow type can take one).
//   --tag=x                    log name suffix.
//
// Engine timing (read; interleaving.md section 4, thieving.md section 4). For an attempt landing
// on server tick T: the roll is at T+1 (the fail message is published in T+1's state, which this
// script calls f). A failure delays T+2 and T+3; T+4..T+10 accept packets while the stun just
// makes the pickpocket script return; T+11 is the next attempt. A packet sent on observing state
// f+k lands on T+2+k, so the stun window is k = 2..8. Bury (p_delay(0)) on k rejects k+1. Charge
// is an IF_BUTTON with no delay that never clears the interaction (charge.rs2). An OPHELDU (arrows)
// clears it, so a knight click goes last in any tick that carries one. A knight click, an
// inventory op or Charge (if_close) during a trade closes the trade, so nothing else is sent while
// a trade is open. Trade requests are refused while the target is busy: delayed, or with a modal
// (a level-up page) open (trade.rs2 [opplayer4], Player.busy()).
//
// Plan letters: h = one delay-free action (Charge while Magic < 99 and runes last, else an arrow
// action, else dropping a finished lower-tier arrow stack), b = bury a dragon bone, c = knight
// click. Offsets the plan names replace the click; offsets 0..8 not named send nothing.
//
// Log: $LAB_LOG/stun-pack-<tag>.jsonl (one row per tick) and a JSON summary on stdout.
import { appendFileSync, writeFileSync } from 'fs';
import { openSession, closeSession } from '../../../speedrun/lib/session';
import { decideGiver, decideReceiver, newGiverCtx, newReceiverCtx, planOffers, tradeOf, type GiverCtx, type OfferEntry, type ReceiverCtx } from '../../../speedrun/lib/trade';
import type { BotWorldState, InventoryItem } from '../../../sdk/types';

const argv = process.argv.slice(2);
const flag = (name: string, def: string) => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : def;
};
const BOT = argv.find(a => !a.startsWith('--'))!;
const HELPER = flag('helper', '');
const LEVEL = Number(flag('level', '57'));
const UNTIL = Number(flag('until', '99'));
const HOLD = flag('hold', '0') === '1';
const TICKS = Number(flag('ticks', HOLD ? '600' : '4000'));
const BONES = Number(flag('bones', '3'));
const CHARGE = flag('charge', 'in');
const FLETCH = flag('fletch', 'on') === 'on';
const TOPUP = flag('topup', HELPER ? 'stun' : 'give');
const HP = Number(flag('hp', '97'));
const MAGIC = Number(flag('magic', '80'));
const FLETCHING = Number(flag('fletching', HOLD ? '75' : '1'));
const PRAYER = Number(flag('prayer', '43'));
const DEFENCE = Number(flag('defence', '89'));
const SHARKS = Number(flag('sharks', '4'));
const EATBELOW = Number(flag('eatbelow', String(HP - 20)));
const MARGIN = Number(flag('margin', '1'));
const TELE = flag('tele', '0,41,51,29,37'); // the rs/2 knight, (2653,3300)

const PLANS: Record<number, string> = {
    3: '2:hhhb,3:-,4:hhhb,5:-,6:hhhb,7:c,8:hhhc',
    2: '2:hhhb,3:-,4:hhhb,5:-,6:hhhh,7:hhhc,8:hhhc',
    0: '2:hhhh,3:hhhh,4:hhhh,5:hhhh,6:hhhh,7:hhhc,8:hhhc',
};
const PLAN_SRC = flag('plan', PLANS[BONES] ?? PLANS[3]!);
const plan = new Map<number, string>();
for (const part of PLAN_SRC.split(',').filter(Boolean)) { const [k, acts] = part.split(':'); plan.set(Number(k), acts === '-' ? '' : acts!); }
const BPS = [...plan.values()].join('').split('').filter(c => c === 'b').length;
const ARM_AT = Math.max(BPS * 2, 2); // pre-arm the helper this many bones ahead

const TAG = flag('tag', `b${BONES}-c${CHARGE}-f${FLETCH ? 1 : 0}-${TOPUP}-lv${LEVEL}${HOLD ? 'h' : ''}`);
const LOG = `${process.env.LAB_LOG ?? process.env.TMPDIR ?? '/tmp'}/stun-pack-${TAG}.jsonl`;
writeFileSync(LOG, '');
const log = (o: unknown) => appendFileSync(LOG, JSON.stringify(o) + '\n');

const CHARGE_COM = 1193;
const XP_BONE = 72 * 25, XP_CAST = 180 * 25;
const TIERS: Array<{ re: RegExp; level: number; product: RegExp }> = [
    { re: /^rune arrowheads$/i, level: 75, product: /^rune arrows?$/i },
    { re: /^adamant arrowheads$/i, level: 60, product: /^adamant arrows?$/i },
    { re: /^mithril arrowheads$/i, level: 45, product: /^mithril arrows?$/i },
    { re: /^steel arrowheads$/i, level: 30, product: /^steel arrows?$/i },
    { re: /^iron arrowheads$/i, level: 15, product: /^iron arrows?$/i },
    { re: /^bronze arrowheads$/i, level: 1, product: /^bronze arrows?$/i },
];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const skill = (s: BotWorldState, n: string) => s.skills.find(k => k.name.toLowerCase() === n)!;
const count = (s: BotWorldState, re: RegExp) => s.inventory.filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
const slot = (s: BotWorldState, re: RegExp): InventoryItem | undefined => s.inventory.find(i => re.test(i.name));
const BONE = /^dragon bones$/i, SHARK = /^shark$/i, BLOOD = /^blood rune$/i, AIR = /^air rune$/i, HEADLESS = /^headless arrow$/i;

const scored = await openSession(BOT);
const helper = HELPER ? await openSession(HELPER, { pathfinding: false }) : null;
const sdk = scored.sdk;
const say = (s: typeof sdk, c: string) => s.sendSay('::' + c);
const waitTicks = async (s: typeof sdk, n: number) => { const t0 = s.getState()!.tick; while (s.getState()!.tick < t0 + n) await sleep(20); };

// ------------------------------------------------------------------ setup (lab only)
async function emptyInventory(s: typeof sdk) {
    for (let pass = 0; pass < 3 && s.getState()!.inventory.length; pass++) {
        for (const it of [...s.getState()!.inventory]) void s.sendDropItem(it.slot);
        await waitTicks(s, 8);
    }
}
await say(sdk, `tele ${TELE}`);
await waitTicks(sdk, 3);
await emptyInventory(sdk);
for (const [st, lv] of [['hitpoints', HP], ['defence', DEFENCE], ['prayer', PRAYER], ['magic', MAGIC], ['fletching', FLETCHING], ['thieving', LEVEL], ['attack', 70], ['strength', 70], ['ranged', 70]] as const) await say(sdk, `setstat ${st} ${lv}`);
await say(sdk, 'setvar magearena 8');
await say(sdk, 'give staff_of_fire 1');
await waitTicks(sdk, 3);
const staff = slot(sdk.getState()!, /^staff of fire$/i);
if (staff) { await sdk.sendUseItem(staff.slot, staff.optionsWithIndex.find(o => /wield/i.test(o.text))?.opIndex ?? 2); await waitTicks(sdk, 2); }
// Load 0: the pre-Thieving hand-off (a ::give stand-in for one helper trade).
const big = HOLD ? 60000 : 0;
await say(sdk, `give bloodrune ${big || 500}`);
await say(sdk, `give airrune ${big || 500}`);
if (FLETCH) {
    await say(sdk, `give headless_arrow ${big || 3600}`);
    if (HOLD) await say(sdk, 'give rune_arrowheads 60000');
    else for (const [n, c] of [['bronze', 60], ['iron', 90], ['steel', 135], ['mithril', 225], ['adamant', 495], ['rune', 2595]] as const) await say(sdk, `give ${n}_arrowheads ${c}`);
}
await say(sdk, `give shark ${SHARKS}`);
await waitTicks(sdk, 3);
const firstBones = BPS ? Math.max(0, 28 - sdk.getState()!.inventory.length - 1 /* coins */ - (FLETCH ? 1 : 0) /* product */ - MARGIN) : 0;
if (firstBones) await say(sdk, `give dragon_bones ${firstBones}`);
await waitTicks(sdk, 4);
if (helper) {
    await emptyInventory(helper.sdk);
    const p = sdk.getState()!.player!;
    await say(helper.sdk, `tele 0,${(p.worldX + 1) >> 6},${p.worldZ >> 6},${(p.worldX + 1) & 63},${p.worldZ & 63}`);
    await waitTicks(helper.sdk, 4);
}
while (sdk.getState()!.dialog?.isOpen) { await sdk.sendClickDialog(0); await waitTicks(sdk, 1); }

// ------------------------------------------------------------------ shared state
type Stun = { f: number; level: number; bones: number; casts: number; arrows: number; pages: number; topup: boolean; ate: boolean; next?: number; sent: string[] };
const stuns: Stun[] = [];
const rolls: Array<{ t: number; ok: boolean }> = [];
const topups: Array<{ mode: string; armedAt: number; clickAt: number; doneAt?: number; recvTicks?: number; ok: boolean; reason?: string; bones: number; sharks: number; afterRoll: number; gap?: number }> = [];
const outside = { bones: 0, casts: 0, arrows: 0 };
const pages: Record<string, number> = {};
let pagesInStun = 0, pagesOutside = 0;
let eats = 0, forcedEats = 0, stunEats = 0, hpLost = 0, deaths = 0;
const dmg: Record<number, number> = {};
let f = -1000, lastStunEnd = -100, lastEat = -100;
let armed = false, armedAt = -1, reqConfirmed = false, staged = false, stagedLoad = { bones: 0, sharks: 0 };
let rctx: ReceiverCtx | null = null, rctxStart = -1, rctxTopup: (typeof topups)[number] | null = null;
let giveRefills = 0, chargeOutSent = 0, setstats = 0;
const unseen: Record<number, number> = {};

const s0 = sdk.getState()!;
const t0 = s0.tick;
const xp0 = { th: skill(s0, 'thieving').experience, pr: skill(s0, 'prayer').experience, mg: skill(s0, 'magic').experience, fl: skill(s0, 'fletching').experience };
let last = { pr: xp0.pr, mg: xp0.mg, headless: count(s0, HEADLESS), hp: s0.player!.hp, tick: t0 };
const seen = new Set<number>();
for (const m of s0.gameMessages) if (m.observationId !== undefined) seen.add(m.observationId);
const hseen = new Set<number>();
if (helper) for (const m of helper.sdk.getState()!.gameMessages) if (m.observationId !== undefined) hseen.add(m.observationId);
let target: any;
let done = false;
let reachedAt = -1;

function freshMessages(s: BotWorldState, set: Set<number>) {
    const out: Array<{ text: string; type: number; sender: string }> = [];
    for (const m of s.gameMessages) {
        if (m.observationId === undefined || set.has(m.observationId)) continue;
        set.add(m.observationId);
        out.push({ text: m.text, type: m.type, sender: m.sender });
    }
    return out;
}
const sameName = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase().replace(/[\s_ ]+/g, ' ') === b.toLowerCase().replace(/[\s_ ]+/g, ' ');
function helperAdjacent(s: BotWorldState): { ok: boolean; index?: number; d?: number } {
    if (!helper) return { ok: false };
    const p = s.nearbyPlayers.find(x => sameName(x.name, helper.name));
    if (!p) return { ok: false };
    const dx = Math.abs(p.x - s.player!.worldX), dz = Math.abs(p.z - s.player!.worldZ);
    return { ok: dx + dz === 1, index: p.index, d: dx + dz };
}

// ------------------------------------------------------------------ SCORED: per-tick loop
function onScored(s: BotWorldState) {
    if (!s?.inGame || done) return;
    const t = s.tick;
    if (t <= last.tick) return;
    if (t - last.tick > 1) unseen[t - last.tick - 1] = (unseen[t - last.tick - 1] ?? 0) + 1;
    last.tick = t;
    const ev: string[] = [];
    const msgs = freshMessages(s, seen);
    const th = skill(s, 'thieving');
    const hp = s.player!.hp;
    const cur = stuns.length ? stuns[stuns.length - 1]! : null;
    const inWindow = (x: number) => cur && x - cur.f >= 1 && x - cur.f <= 12;

    // Rolls, by message (published on the roll tick).
    for (const m of msgs) {
        if (/^You pick the/.test(m.text)) { rolls.push({ t, ok: true }); ev.push('success'); }
        if (/You fail to pick/.test(m.text)) {
            rolls.push({ t, ok: false }); ev.push('fail');
            f = t;
            stuns.push({ f: t, level: th.baseLevel, bones: 0, casts: 0, arrows: 0, pages: 0, topup: false, ate: false, sent: [] });
        }
        if (/You've been stunned/.test(m.text)) lastStunEnd = t + 8;
        const adv = /advanced (?:a|an) (\w+) level/i.exec(m.text);
        if (adv) { pages[adv[1]!.toLowerCase()] = (pages[adv[1]!.toLowerCase()] ?? 0) + 1; if (inWindow(t)) { pagesInStun++; stuns[stuns.length - 1]!.pages++; } else pagesOutside++; }
        if (m.type === 4 && /wishes to trade/i.test(m.text) && helper && sameName(m.sender, helper.name) && armed) { reqConfirmed = true; ev.push('tradereq'); }
        if (/you are dead/i.test(m.text)) deaths++;
    }
    // First roll after each stun.
    const open = stuns.find(x => x.next === undefined && x.f < t && rolls.some(r => r.t > x.f));
    if (open) open.next = rolls.find(r => r.t > open.f)!.t - open.f;
    // Landed actions (xp is applied a tick after the action; attribute to the stun window).
    const pr = skill(s, 'prayer').experience, mg = skill(s, 'magic').experience, hl = count(s, HEADLESS);
    const nb = Math.round((pr - last.pr) / XP_BONE), nc = Math.round((mg - last.mg) / XP_CAST), na = hl < last.headless ? Math.round((last.headless - hl) / 15) : 0;
    if (nb || nc || na) {
        const tgt = inWindow(t) ? stuns[stuns.length - 1]! : outside;
        tgt.bones += Math.max(0, nb); tgt.casts += Math.max(0, nc); tgt.arrows += na;
        if (nb) ev.push(`+${nb}bone`); if (nc) ev.push(`+${nc}cast`); if (na) ev.push(`+${na}arrow`);
    }
    last.pr = pr; last.mg = mg; last.headless = hl;
    if (hp < last.hp) { const d = last.hp - hp; hpLost += d; dmg[d] = (dmg[d] ?? 0) + 1; ev.push(`hp-${d}`); }
    last.hp = hp;

    // Stop conditions and level holds.
    if (!HOLD && th.baseLevel >= UNTIL && reachedAt < 0) reachedAt = t;
    if ((HOLD && t - t0 >= TICKS) || (!HOLD && reachedAt > 0) || t - t0 >= (HOLD ? TICKS : 6000)) { done = true; finish(); return; }
    if (HOLD && th.baseLevel !== LEVEL) { void say(sdk, `setstat thieving ${LEVEL}`); setstats++; }
    if (HOLD && skill(s, 'magic').baseLevel >= 99) void say(sdk, `setstat magic ${MAGIC}`);
    if (HOLD && skill(s, 'fletching').baseLevel >= 99) void say(sdk, 'setstat fletching 75');

    // Top-up bookkeeping.
    const bones = count(s, BONE), sharks = count(s, SHARK);
    if (TOPUP !== 'give' && helper && BPS && !armed && bones <= ARM_AT) { armed = true; armedAt = t; reqConfirmed = false; ev.push('arm'); }
    const needNow = BPS > 0 && bones < BPS;

    // An open trade owns the tick: nothing else may be sent.
    if (rctx) {
        const d = decideReceiver(s, rctx);
        rctx = d.next;
        const tu = rctxTopup!;
        if (d.action === 'accept') { void sdk.sendAcceptTrade(); ev.push('t-accept'); }
        else if (d.action === 'decline') { void sdk.sendDeclineTrade(); tu.ok = false; tu.reason = d.reason; rctx = null; ev.push('t-decline'); }
        else if (d.action === 'done') { tu.ok = true; tu.doneAt = t; tu.recvTicks = t - rctxStart; rctx = null; armed = false; reqConfirmed = false; staged = false; ev.push('t-done'); }
        else if (d.action === 'closed') { tu.ok = false; tu.reason = 'closed'; rctx = null; ev.push('t-closed'); }
        else if (!rctx.sawOpen && t - rctxStart > 4) { tu.ok = false; tu.reason = 'did not open'; rctx = null; ev.push('t-noopen'); }
        else if (t - rctxStart > 25) { void sdk.sendDeclineTrade(); tu.ok = false; tu.reason = 'timeout'; rctx = null; ev.push('t-timeout'); }
        if (rctx || ev.some(e => e.startsWith('t-'))) { log({ t, k: t - f, lvl: th.baseLevel, hp, ev, msgs: msgs.map(m => m.text) }); if (rctx) return; }
        if (tradeOf(s).isOpen) { log({ t, ev: ['trade still open'] }); return; }
    }

    const knight = pickKnight(s);
    const op = knight?.optionsWithIndex.find((o: any) => /pickpocket/i.test(o.text))?.opIndex ?? 3;
    const click = () => { if (knight) { void sdk.sendInteractNpc(knight.index, op); ev.push('pick'); } else ev.push('noknight'); };
    const k = t - f;

    // Lab stand-in top-up (no trade): ::give in any tick, cost-free by construction.
    if (TOPUP === 'give' && needNow && k > 8) {
        const free = 28 - s.inventory.length;
        const n = Math.max(0, free - MARGIN - Math.max(0, SHARKS - sharks));
        if (n) void say(sdk, `give dragon_bones ${n}`);
        if (sharks < SHARKS) void say(sdk, `give shark ${SHARKS - sharks}`);
        giveRefills++;
        ev.push('give-refill');
    }

    const hAdj = helperAdjacent(s);
    const canTrade = TOPUP !== 'give' && helper && armed && reqConfirmed && staged && hAdj.ok && hAdj.index !== undefined;

    // ---- inside the stun window
    if (k >= 0 && k <= 8) {
        const st = stuns[stuns.length - 1]!;
        if (k === 0 || k === 1) { log({ t, k, lvl: th.baseLevel, hp, ev, msgs: msgs.map(m => m.text) }); return; }
        // Forced eat only (it costs 3 ticks here).
        if (hp > 0 && hp <= 6) { const sh = slot(s, SHARK); if (sh) { void sdk.sendUseItem(sh.slot, 1); eats++; forcedEats++; stunEats++; st.ate = true; ev.push('eat-forced'); } }
        if (TOPUP === 'stun' && needNow && canTrade && k <= 4 && !st.topup) {
            st.topup = true;
            rctx = newReceiverCtx(helper!.name, s.inventory, wantFor(stagedLoad));
            rctxStart = t;
            rctxTopup = { mode: 'stun', armedAt, clickAt: t, ok: false, bones: stagedLoad.bones, sharks: stagedLoad.sharks, afterRoll: f };
            topups.push(rctxTopup);
            void sdk.sendTradeRequest(hAdj.index!);
            ev.push('t-click');
            log({ t, k, lvl: th.baseLevel, hp, ev, msgs: msgs.map(m => m.text) });
            return;
        }
        const acts = plan.get(k);
        if (acts !== undefined) {
            const sent = runActs(s, acts, click);
            st.sent.push(`${k}:${sent.join('')}`);
            ev.push(...sent);
        }
        log({ t, k, lvl: th.baseLevel, hp, ev, msgs: msgs.map(m => m.text) });
        return;
    }

    // ---- outside the stun window
    const picked = msgs.some(m => /^You pick the/.test(m.text));
    if (TOPUP === 'success' && needNow && canTrade && picked) {
        rctx = newReceiverCtx(helper!.name, s.inventory, wantFor(stagedLoad));
        rctxStart = t;
        rctxTopup = { mode: 'success', armedAt, clickAt: t, ok: false, bones: stagedLoad.bones, sharks: stagedLoad.sharks, afterRoll: t };
        topups.push(rctxTopup);
        void sdk.sendTradeRequest(hAdj.index!);
        ev.push('t-click');
        log({ t, k, lvl: th.baseLevel, hp, ev, msgs: msgs.map(m => m.text) });
        return;
    }
    // Eat: in the success window (same tick as the click after a success, >= 4 ticks after a stun
    // ended), or at once when the next failure could kill.
    const sh = slot(s, SHARK);
    if (sh && hp > 0 && ((picked && hp <= EATBELOW && t - lastStunEnd >= 4 && t - lastEat >= 3) || hp <= 6)) {
        void sdk.sendUseItem(sh.slot, 1); eats++; lastEat = t; if (!picked) forcedEats++; ev.push(picked ? 'eat' : 'eat-forced');
    }
    if (s.dialog?.isOpen) { void sdk.sendClickDialog(0); ev.push('dialog'); }
    if (CHARGE === 'out' && skill(s, 'magic').baseLevel < 99 && count(s, BLOOD) >= 3 && count(s, AIR) >= 3) {
        for (let i = 0; i < 3; i++) void sdk.sendClickComponent(CHARGE_COM);
        chargeOutSent += 3; ev.push('CCC');
    }
    click();
    log({ t, k: k > 200 ? null : k, lvl: th.baseLevel, hp, ev, msgs: msgs.map(m => m.text), me: [s.player!.worldX, s.player!.worldZ], hd: hAdj.d });
}

function wantFor(load: { bones: number; sharks: number }) {
    const w: Array<{ item: RegExp; amount: number }> = [];
    if (load.bones) w.push({ item: BONE, amount: load.bones });
    if (load.sharks) w.push({ item: SHARK, amount: load.sharks });
    return w.length ? w : undefined;
}

function pickKnight(s: BotWorldState) {
    if (target) target = s.nearbyNpcs.find(n => n.index === target.index && /^knight of ardougne$/i.test(n.name));
    if (!target) target = s.nearbyNpcs.filter(n => /^knight of ardougne$/i.test(n.name)).sort((a, b) => a.distance - b.distance)[0];
    return target;
}

/** Send one tick's plan entry. Helpers first, bury and click last. */
function runActs(s: BotWorldState, acts: string, click: () => void): string[] {
    const sent: string[] = [];
    const v = { blood: count(s, BLOOD), air: count(s, AIR), headless: count(s, HEADLESS), magic: skill(s, 'magic').baseLevel, fl: skill(s, 'fletching').baseLevel };
    const tierHeads = new Map<RegExp, number>();
    for (const tr of TIERS) tierHeads.set(tr.re, count(s, tr.re));
    const dropped = new Set<number>();
    let tail = '';
    for (const a of acts) {
        if (a === 'h') {
            if (CHARGE === 'in' && v.magic < 99 && v.blood >= 3 && v.air >= 3) {
                void sdk.sendClickComponent(CHARGE_COM); v.blood -= 3; v.air -= 3; sent.push('C'); continue;
            }
            const tier = FLETCH && v.fl < 99 && v.headless > 0 ? TIERS.find(tr => tr.level <= v.fl && (tierHeads.get(tr.re) ?? 0) > 0) : undefined;
            if (tier) {
                const heads = slot(s, tier.re)!, hl = slot(s, HEADLESS)!;
                void sdk.sendUseItemOnItem(heads.slot, hl.slot);
                const n = Math.min(15, v.headless, tierHeads.get(tier.re)!);
                v.headless -= n; tierHeads.set(tier.re, tierHeads.get(tier.re)! - n);
                sent.push('A'); continue;
            }
            // Drop a finished arrow stack of a tier we no longer make.
            const curTier = TIERS.find(tr => tr.level <= v.fl && (tierHeads.get(tr.re) ?? 0) > 0);
            const junk = s.inventory.find(i => !dropped.has(i.slot) && TIERS.some(tr => tr.product.test(i.name) && tr !== curTier));
            if (junk) { void sdk.sendDropItem(junk.slot); dropped.add(junk.slot); sent.push('D'); continue; }
            sent.push('_');
        } else if (a === 'b') {
            const b = slot(s, BONE);
            if (b) { tail = 'b'; void sdk.sendUseItem(b.slot, b.optionsWithIndex.find(o => /^bury$/i.test(o.text))?.opIndex ?? 1); sent.push('B'); }
            else sent.push('nob');
        } else if (a === 'c') {
            click(); sent.push('c');
        }
    }
    void tail;
    return sent;
}

// ------------------------------------------------------------------ helper: per-tick loop
let gctx: GiverCtx | null = null, gplan: OfferEntry[] = [], hLast = -1, lastReq = -100, hBusy = 0, hReqs = 0, stageAt = -100;
function onHelper(hs: BotWorldState) {
    if (!helper || !hs?.inGame || done) return;
    if (hs.tick === hLast) return;
    hLast = hs.tick;
    const msgs = freshMessages(hs, hseen);
    if (msgs.some(m => /busy at the moment/i.test(m.text))) { hBusy++; lastReq = -100; reqConfirmed = false; }
    const tr = tradeOf(hs);
    if (gctx) {
        const d = decideGiver(hs, gctx);
        gctx = d.next;
        if (d.action === 'burst') { for (const e of gplan) for (const a of e.amounts) void helper.sdk.sendOfferItem(e.slot, a); void helper.sdk.sendAcceptTrade(); }
        else if (d.action === 'accept') void helper.sdk.sendAcceptTrade();
        else if (d.action === 'decline') { void helper.sdk.sendDeclineTrade(); gctx = null; }
        else if (d.action === 'done' || d.action === 'closed') gctx = null;
        return;
    }
    if (tr.isOpen) {
        gplan = planOffers(hs.inventory, 'all');
        gctx = newGiverCtx(scored.name, hs.inventory, gplan);
        onHelperGiver(hs);
        return;
    }
    if (!armed) return;
    const s = sdk.getState()!;
    if (!staged) {
        if (hs.inventory.length === 0 && hs.tick - stageAt > 6) {
            const sharks = Math.max(0, SHARKS - count(s, SHARK));
            const nonBone = s.inventory.filter(i => !BONE.test(i.name)).length + (s.inventory.some(i => /^coins$/i.test(i.name)) ? 0 : 1);
            const bones = Math.max(0, 28 - nonBone - sharks - MARGIN);
            if (bones) void say(helper.sdk, `give dragon_bones ${bones}`);
            if (sharks) void say(helper.sdk, `give shark ${sharks}`);
            stagedLoad = { bones, sharks };
            stageAt = hs.tick;
        } else if (hs.inventory.length > 0 && count(hs, BONE) >= stagedLoad.bones && count(hs, SHARK) >= stagedLoad.sharks && stagedLoad.bones) {
            staged = true;
        }
        return;
    }
    // Request (and so stand adjacent): until SCORED has seen a request, and again whenever SCORED
    // has walked off. Never while SCORED is mid-trade.
    if (rctx) return;
    const me = hs.player!, p = s.player!;
    const adj = Math.abs(me.worldX - p.worldX) + Math.abs(me.worldZ - p.worldZ) === 1;
    const scoredIdx = hs.nearbyPlayers.find(x => sameName(x.name, scored.name))?.index;
    if (scoredIdx === undefined) return;
    if ((!reqConfirmed || !adj) && hs.tick - lastReq >= 3) { void helper.sdk.sendTradeRequest(scoredIdx); lastReq = hs.tick; hReqs++; }
}
function onHelperGiver(hs: BotWorldState) {
    const d = decideGiver(hs, gctx!);
    gctx = d.next;
    if (d.action === 'burst') { for (const e of gplan) for (const a of e.amounts) void helper!.sdk.sendOfferItem(e.slot, a); void helper!.sdk.sendAcceptTrade(); }
}

// ------------------------------------------------------------------ summary
let resolveDone: () => void;
const finished = new Promise<void>(r => (resolveDone = r));
function finish() {
    const end = sdk.getState()!;
    const span = (reachedAt > 0 ? reachedAt : end.tick) - t0;
    const ok = rolls.filter(r => r.ok).length, fails = rolls.length - ok;
    const gapS: Record<number, number> = {}, gapF: Record<number, number> = {};
    for (let i = 1; i < rolls.length; i++) { const g = rolls[i]!.t - rolls[i - 1]!.t; const m = rolls[i - 1]!.ok ? gapS : gapF; m[g] = (m[g] ?? 0) + 1; }
    const full = stuns.filter(x => x.next !== undefined);
    const normal = full.filter(x => !x.topup), tu = full.filter(x => x.topup);
    const mean = (a: number[]) => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null;
    const hist = (a: number[]) => a.reduce((m: Record<number, number>, x) => (m[x] = (m[x] ?? 0) + 1, m), {});
    const tot = { bones: stuns.reduce((a, x) => a + x.bones, 0) + outside.bones, casts: stuns.reduce((a, x) => a + x.casts, 0) + outside.casts, arrows: stuns.reduce((a, x) => a + x.arrows, 0) + outside.arrows };
    for (const u of topups) if (u.mode === 'success') { const nxt = rolls.find(r => r.t > u.afterRoll); if (nxt) u.gap = nxt.t - u.afterRoll; }
    const summary = {
        tag: TAG, tickrate: process.env.NODE_TICKRATE ?? '?', plan: PLAN_SRC, bonesPerStun: BPS, charge: CHARGE, fletch: FLETCH, topup: TOPUP,
        levels: { thieving: [LEVEL, skill(end, 'thieving').baseLevel], magic: [MAGIC, skill(end, 'magic').baseLevel], fletching: [FLETCHING, skill(end, 'fletching').baseLevel], prayer: [PRAYER, skill(end, 'prayer').baseLevel] },
        span, reached99At: reachedAt > 0 ? reachedAt - t0 : null, thievingBase: (skill(end, 'thieving').experience - xp0.th) / 25,
        rolls: rolls.length, successes: ok, fails, gapAfterSuccess: gapS, gapAfterFail: gapF,
        stuns: stuns.length,
        normalStuns: { n: normal.length, next: hist(normal.map(x => x.next!)), meanNext: mean(normal.map(x => x.next!)), bones: mean(normal.map(x => x.bones)), casts: mean(normal.map(x => x.casts)), arrows: mean(normal.map(x => x.arrows)), pages: mean(normal.map(x => x.pages)) },
        nextByPages: { withPage: mean(normal.filter(x => x.pages > 0).map(x => x.next!)), withoutPage: mean(normal.filter(x => x.pages === 0).map(x => x.next!)), nWith: normal.filter(x => x.pages > 0).length },
        topupStuns: { n: tu.length, next: hist(tu.map(x => x.next!)), bones: mean(tu.map(x => x.bones)), casts: mean(tu.map(x => x.casts)), arrows: mean(tu.map(x => x.arrows)) },
        topups: { n: topups.length, ok: topups.filter(u => u.ok).length, recvTicks: hist(topups.filter(u => u.recvTicks !== undefined).map(u => u.recvTicks!)), successGaps: hist(topups.filter(u => u.gap !== undefined).map(u => u.gap!)), failures: topups.filter(u => !u.ok).map(u => u.reason), list: topups, helperRequests: hReqs, helperBusy: hBusy, giveRefills },
        totals: tot, outside, chargeOutSent,
        pages, pagesInStun, pagesOutside,
        eats, forcedEats, stunEats, hpLost, damage: dmg, deaths, setstats,
        standaloneReplaced: { bury: tot.bones * 2, charge: +(tot.casts / 5).toFixed(1), fletch: +(tot.arrows / 5).toFixed(1) },
        ticksUnseen: unseen,
        log: LOG,
    };
    log({ summary });
    console.log(JSON.stringify(summary, null, 1));
    resolveDone();
}

sdk.onStateUpdate(onScored);
if (helper) helper.sdk.onStateUpdate(onHelper);
await finished;
await closeSession(scored);
if (helper) await closeSession(helper);
process.exit(0);
