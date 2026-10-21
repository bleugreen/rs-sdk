// Lab verification of the engine sweep's top ten (docs/speedrun/research/engine-sweep.md, section 8).
//
//   LAB_HELPERS=srlab92b speedrun/lab/lab.sh srlab92a 'speedrun/lab/measure-sweep.ts:--helper=srlab92b:--n=3'
//
// Probes (`--probe=a,b,...`, default all):
//   tickets   5 xp-buy presses in one tick; tickets refused in a trade; a dropped ticket is
//             invisible to the other player (needs --helper)
//   staves    14 air battlestaves (orb on staff) fired at once: crafts per tick
//   kebab     13 kebabs at Cooking 1 and 37; the three mixture steps
//   levelup   27 sapphires from Crafting 20 (many level-ups) vs Crafting 99: cuts per tick
//   bankop    gem-cutting bank cycles with and without CLOSE_MODAL before the first cut
//   refused   k refused IF_BUTTONs ahead of 10 delay-free identifies: identifies per tick
//   makex     two make-X completions in one tick: the second one's p_delay(0)
//   magicpot  14 magic potions at Herblore 76: mixes per tick
//   hassan    Hassan's jug of water with a blind dialogue burst: ticks per jug
//   wine      bank wines fermented at Cooking 1 across a relog; the timer beside fly fishing
//   dswall    Dragon Slayer: the Karamja-side Crandor wall with %dragon_wall = 0
//
// Every probe prints RESULT lines; `tick k` counts published client ticks from the burst's tick.
import type { ActionResult } from '../../sdk/index';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { closeSession, login, logoutClean, openSession, type Session } from '../lib/session';
import { nextTick, waitTicks, waitUntil } from '../lib/wait';
import { arg, botArg, result } from './common';
import { cheat, setstat, tele, VARROCK_WEST_BANK } from './setup';

const main = await openSession(botArg());
const { sdk, bot } = main;
const helperName = arg('helper', '');
const probes = arg('probe', 'tickets,staves,kebab,levelup,bankop,refused,makex,magicpot,hassan,wine,dswall').split(',');
const N = Number(arg('n', '3'));

// Component ids (server/content/pack/interface.pack).
const TICKETS_100 = 8391; // agilityarena_trade:com_98
const NOTE_TOGGLE = 5386; // bank_main:com_93, hidden unless the bank is open
const SHAFTS_MAKE1 = 8889; // skill_multi3:make1_a (15 arrow shafts)
const CHOICE_2 = 2472; // multi3:com_2, the second option of ~p_choice3
const BARB_FLY = { x: 48 * 64 + 31, z: 53 * 64 + 38 }; // Barbarian Village lure spots
const JACKIE = { x: 2810, z: 3192 }; // agilityarena_tickettrader spawns at (2811,3192), m43_49.jm2
const HASSAN = { x: 3302, z: 3164 }; // Hassan at (3302,3163), m51_49.jm2
// Obj ids where names collide (good and bad kebabs are both "Ugthanki kebab").
const BOWL = 1923, ONION = 1957, TOMATO = 1982, MEAT = 1861, CHOPPED_ONION = 1871, ONION_TOMATO = 1875;
const KEBAB_MIX = 1881, PITTA = 1865, KEBAB = 1885, KEBAB_BAD = 1883;
const LANTADYME_UNF = 2483, POTATO_CACTUS = 3138, MAGIC_POTION = 3042;

// ---- per-tick record of every published state ----
const byTick = new Map<number, BotWorldState>();
sdk.onStateUpdate(s => byTick.set(s.tick, s));

const xp = (s: BotWorldState | null | undefined, skill: string) => s?.skills.find(k => k.name.toLowerCase() === skill)?.experience ?? 0;
const lvl = (s: BotWorldState | null | undefined, skill: string) => s?.skills.find(k => k.name.toLowerCase() === skill)?.baseLevel ?? 0;
/** An item matcher: a name pattern, or obj ids (server/content/pack/obj.pack) where names collide. */
type M = RegExp | number | number[];
const hit = (i: InventoryItem, m: M) => typeof m === 'number' ? i.id === m : Array.isArray(m) ? m.includes(i.id) : m.test(i.name);
const count = (s: BotWorldState | null | undefined, m: M) => (s?.inventory ?? []).filter(i => hit(i, m)).reduce((a, i) => a + i.count, 0);
const items = (s: BotWorldState | null | undefined, m: M) => (s?.inventory ?? []).filter(i => hit(i, m)).sort((a, b) => a.slot - b.slot);
const opOf = (i: InventoryItem, re: RegExp) => i.optionsWithIndex.find(o => re.test(o.text))?.opIndex;
const unid = (s: BotWorldState | null | undefined) => items(s, /./).filter(i => opOf(i, /^identify/i) !== undefined);
/** Base xp: published xp is stat_advance tenths x NODE_XPRATE (25) / 10. */
const base = (gameXp: number) => Math.round((gameXp / 25) * 10) / 10;

/** Per-tick deltas of `f` over [from, to], as {tickOffset: delta} for nonzero deltas. */
function deltas(from: number, to: number, f: (s: BotWorldState) => number): Record<number, number> {
    const out: Record<number, number> = {};
    let prev: number | undefined;
    for (let t = from; t <= to; t++) {
        const s = byTick.get(t);
        if (!s) continue;
        const v = f(s);
        if (prev !== undefined && v !== prev) out[t - from] = v - prev;
        prev = v;
    }
    return out;
}

const refusals: string[] = [];
function fire(what: string, p: Promise<ActionResult>) {
    p.then(r => { if (!r.success) refusals.push(`${what}: ${r.message}`); }).catch(e => refusals.push(`${what}: ${e}`));
}
function flushRefusals(step: string) {
    if (refusals.length) result(`${step} client-refusals`, refusals.splice(0));
}
/** OPHELDU without the SDK's client-side bank/shop guard (the guard is what #5 tests). */
function rawUseOn(source: number, target: number): Promise<ActionResult> {
    return (sdk as unknown as { sendAction(a: unknown): Promise<ActionResult> }).sendAction({ type: 'useItemOnItem', sourceSlot: source, targetSlot: target, reason: 'SDK' });
}

async function fresh(...cmds: string[]) {
    await cheat(sdk, '~clearinv');
    await waitTicks(sdk, 2);
    for (const c of cmds) await cheat(sdk, c);
    await waitTicks(sdk, 3);
}

async function teleTo(s: Session, x: number, z: number, level = 0) {
    for (let i = 0; i < 5; i++) if (await tele(s.sdk, x, z, level)) return;
    throw new Error(`tele ${x},${z},${level} failed`);
}

/** Answer continue pages (level-ups) until no dialog is open. */
async function dismissAll(s: Session = main, maxTicks = 60) {
    for (let i = 0; i < maxTicks; i++) {
        const st = await nextTick(s.sdk);
        if (!st.dialog.isOpen && !st.modalOpen) return;
        if (st.modalOpen && !st.dialog.isOpen) { fire('close', s.sdk.sendCloseModal()); continue; }
        fire('continue', s.sdk.sendClickDialog(0));
    }
}

// A bot made by create-bot is still in the tutorial: no side tabs, so the server refuses every
// held op and tab button. Finish the tutorial, leave the island and log in again.
async function ensureTabs(s: Session) {
    await cheat(s.sdk, 'setvar tutorial 1000');
    await waitTicks(s.sdk, 2);
    await teleTo(s, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);
    result(`setup logout ${s.name}`, await logoutClean(s));
    await login(s);
    await waitTicks(s.sdk, 5);
}

// ---- 1. Agility Arena tickets ----
async function probeTickets() {
    await teleTo(main, JACKIE.x, JACKIE.z);
    await setstat(sdk, 'agility', 1);
    for (let n = 0; n < N; n++) {
        await fresh('give agilityarena_ticket 600');
        const jackie = sdk.getState()!.nearbyNpcs.find(p => p.optionsWithIndex.some(o => /trade/i.test(o.text)) && /jackie/i.test(p.name))
            ?? sdk.getState()!.nearbyNpcs.find(p => /jackie/i.test(p.name));
        if (!jackie) throw new Error(`no ticket trader; npcs: ${sdk.getState()!.nearbyNpcs.map(p => p.name).join(',')}`);
        const op = jackie.optionsWithIndex.find(o => /trade/i.test(o.text))?.opIndex ?? 3;
        fire('jackie', sdk.sendInteractNpc(jackie.index, op));
        const open = await waitUntil(sdk, s => s.modalOpen, { maxTicks: 10 });
        const s0 = await nextTick(sdk);
        for (let i = 0; i < 5; i++) fire('buy100', sdk.sendClickComponent(TICKETS_100));
        const s1 = await waitTicks(sdk, 4);
        result('tickets 5 presses', {
            interfaceOpened: open.ok,
            ticketsUsed: count(s0, /agility arena ticket/i) - count(s1, /agility arena ticket/i),
            agilityXpPerTick: Object.fromEntries(Object.entries(deltas(s0.tick, s1.tick, s => xp(s, 'agility'))).map(([k, v]) => [k, base(v)])),
            ticketsPerTick: deltas(s0.tick, s1.tick, s => count(s, /agility arena ticket/i)),
        });
        flushRefusals('tickets');
        fire('close', sdk.sendCloseModal());
        await waitTicks(sdk, 2);
    }
    if (!helperName) { result('tickets trade', { skipped: 'no --helper' }); return; }
    // the helper gets its own client from this script (lab.sh LAB_BOTS, no runner), so a relog never races a second client
    const helper = await openSession(helperName, { launch: true });
    await ensureTabs(helper);
    for (let n = 0; n < N; n++) {
        await teleTo(helper, JACKIE.x + 1, JACKIE.z);
        await cheat(helper.sdk, '~clearinv');
        await waitTicks(helper.sdk, 2);
        await cheat(helper.sdk, 'give agilityarena_ticket 10');
        await cheat(helper.sdk, 'give coins 100');
        await waitTicks(helper.sdk, 3);
        const me = helper.sdk.getState()!.nearbyPlayers.find(p => p.name.toLowerCase().replace(/[ _]/g, '') === main.name.toLowerCase().replace(/[ _]/g, ''));
        const them = sdk.getState()!.nearbyPlayers.find(p => p.name.toLowerCase().replace(/[ _]/g, '') === helper.name.toLowerCase().replace(/[ _]/g, ''));
        if (!me || !them) { result('tickets trade', { error: 'players not visible' }); break; }
        fire('req h', helper.sdk.sendTradeRequest(me.index));
        const asked = await waitUntil(sdk, s => s.gameMessages.some(m => m.type === 4), { maxTicks: 10 });
        fire('req m', sdk.sendTradeRequest(them.index));
        const open = await waitUntil(helper.sdk, s => !!s.trade?.isOpen, { maxTicks: 15 });
        result('tickets trade open', { mainSawRequest: asked.ok, open: open.ok, helperMsgs: helper.sdk.getState()!.gameMessages.slice(-3).map(m => `${m.type}:${m.text}`), mainMsgs: sdk.getState()!.gameMessages.slice(-3).map(m => `${m.type}:${m.text}`) });
        const hs = helper.sdk.getState()!;
        const ticket = items(hs, /agility arena ticket/i)[0];
        const coins = items(hs, /^coins$/i)[0];
        if (ticket) fire('offer ticket', helper.sdk.sendOfferItem(ticket.slot, 10));
        await waitTicks(helper.sdk, 2);
        if (coins) fire('offer coins', helper.sdk.sendOfferItem(coins.slot, 100));
        const after = await waitTicks(helper.sdk, 3);
        const msgs = after.gameMessages.filter(m => m.tick >= hs.tick - 1).map(m => m.text);
        result('tickets trade', {
            tradeOpened: open.ok,
            helperOffer: after.trade?.myOffer.map(i => `${i.name} x${i.count}`),
            mainSeesOffer: sdk.getState()!.trade?.theirOffer.map(i => `${i.name} x${i.count}`),
            messages: msgs.slice(-4),
        });
        fire('decline', helper.sdk.sendDeclineTrade());
        await waitTicks(helper.sdk, 3);
        // drop one ticket: visible to the helper only?
        const t2 = items(helper.sdk.getState(), /agility arena ticket/i)[0];
        if (t2) {
            fire('drop', helper.sdk.sendDropItem(t2.slot));
            await waitTicks(helper.sdk, 3);
            const seen = (s: BotWorldState | null) => (s?.groundItems ?? []).filter(g => /agility arena ticket/i.test(g.name)).length;
            result('tickets drop', { helperSees: seen(helper.sdk.getState()), mainSees: seen(sdk.getState()) });
        }
    }
    await closeSession(helper);
}

// ---- generic delay-free pair burst: k pairs (a[i], b[i]) fired at once ----
async function pairBurst(label: string, skill: string, give: string[], a: M, b: M, product: M, extra: Record<string, unknown> = {}) {
    await fresh(...give);
    const s0 = await nextTick(sdk);
    const as = items(s0, a), bs = items(s0, b);
    const k = Math.min(as.length, bs.length);
    for (let i = 0; i < k; i++) fire(label, sdk.sendUseItemOnItem(bs[i]!.slot, as[i]!.slot));
    if (k === 0) result(`${label} inventory`, s0.inventory.map(i => `${i.id}:${i.name}`));
    const s1 = await waitUntil(sdk, s => items(s, a).length === 0 || items(s, b).length === 0, { maxTicks: Math.ceil(k / 5) + 6 });
    const end = (await waitTicks(sdk, 2)).tick;
    const perTick = deltas(s0.tick, end, s => count(s, product));
    const ticks = Object.keys(perTick).map(Number);
    const r = {
        sent: k, made: count(byTick.get(end), product) - count(s0, product), perTick,
        ticksSpan: ticks.length ? Math.max(...ticks) : null,
        baseXp: base(xp(byTick.get(end), skill) - xp(s0, skill)), ...extra, done: s1.ok,
    };
    flushRefusals(label);
    return r;
}

// ---- 2. battlestaves ----
async function probeStaves() {
    await setstat(sdk, 'crafting', 99);
    for (let n = 0; n < N; n++) {
        result('staves air x14', await pairBurst('staff', 'crafting', ['give battlestaff 14', 'give air_orb 14'], /^battlestaff$/i, /^air orb$/i, /air battlestaff/i));
    }
}

// ---- 3. ugthanki kebab ----
async function probeKebab() {
    for (const level of [1, 37]) {
        for (let n = 0; n < N; n++) {
            await setstat(sdk, 'cooking', level);
            await dismissAll();
            const r = await pairBurst('kebab', 'cooking', ['give bowl_oniontomugthanki 13', 'give pitta_bread 13'], KEBAB_MIX, PITTA, [KEBAB, KEBAB_BAD]);
            const end = sdk.getState();
            result(`kebab x13 from Cooking ${level}`, { ...r, good: count(end, KEBAB), bad: count(end, KEBAB_BAD), levelAfter: lvl(end, 'cooking') });
            await dismissAll();
        }
    }
    // the three mixture steps, as a helper would make them: bowl+onion, +tomato, +meat (5 bowls)
    for (let n = 0; n < N; n++) {
        await fresh('give bowl_empty 5', 'give onion 5', 'give tomato 5', 'give cooked_ugthanki_meat 5');
        const s0 = await nextTick(sdk);
        const bowls = items(s0, BOWL), on = items(s0, ONION), to = items(s0, TOMATO), me = items(s0, MEAT);
        // the mixture stays in the bowl's slot through all three steps
        for (let i = 0; i < bowls.length; i++) fire('onion', sdk.sendUseItemOnItem(on[i]!.slot, bowls[i]!.slot));
        await nextTick(sdk);
        const s1 = await nextTick(sdk);
        const mix1 = items(s1, CHOPPED_ONION);
        for (let i = 0; i < Math.min(mix1.length, to.length); i++) fire('tomato', sdk.sendUseItemOnItem(to[i]!.slot, mix1[i]!.slot));
        await nextTick(sdk);
        const s2 = await nextTick(sdk);
        const mix2 = items(s2, ONION_TOMATO);
        for (let i = 0; i < Math.min(mix2.length, me.length); i++) fire('meat', sdk.sendUseItemOnItem(me[i]!.slot, mix2[i]!.slot));
        const s3 = await waitTicks(sdk, 3);
        result('kebab mixture 3 steps x5', {
            onionStep: mix1.length, tomatoStep: mix2.length, kebabMix: count(s3, KEBAB_MIX),
            perTickOnion: deltas(s0.tick, s1.tick, s => count(s, CHOPPED_ONION)),
            perTickMeat: deltas(s2.tick, s3.tick, s => count(s, KEBAB_MIX)),
            cookingXp: base(xp(s3, 'cooking') - xp(s0, 'cooking')),
        });
        flushRefusals('kebab mixture');
    }
}

// ---- 4. level-ups during a delay-free burst ----
async function probeLevelup() {
    for (const level of [20, 99]) {
        for (let n = 0; n < N; n++) {
            await setstat(sdk, 'crafting', level);
            await dismissAll();
            await fresh('give chisel 1', 'give uncut_sapphire 27');
            const s0 = await nextTick(sdk);
            const chisel = items(s0, /^chisel$/i)[0]!;
            const gems = items(s0, /uncut sapphire/i);
            for (const g of gems) fire('cut', sdk.sendUseItemOnItem(chisel.slot, g.slot));
            await waitUntil(sdk, s => count(s, /uncut sapphire/i) === 0, { maxTicks: 14 });
            const end = (await waitTicks(sdk, 2)).tick;
            const perTick = deltas(s0.tick, end, s => -count(s, /uncut sapphire/i));
            const dialogTicks: number[] = [];
            for (let t = s0.tick; t <= end; t++) if (byTick.get(t)?.dialog.isOpen) dialogTicks.push(t - s0.tick);
            result(`levelup sapphire x27 from Crafting ${level}`, {
                cut: gems.length - count(byTick.get(end), /uncut sapphire/i), perTick,
                lastCutTick: Math.max(...Object.keys(perTick).map(Number)),
                levelsGained: lvl(byTick.get(end), 'crafting') - lvl(s0, 'crafting'),
                ticksWithDialogOpen: dialogTicks,
            });
            flushRefusals('levelup');
            await dismissAll();
        }
    }
}

// ---- 5. inventory op with the bank open ----
async function probeBankop() {
    await teleTo(main, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);
    await setstat(sdk, 'crafting', 99);
    await dismissAll();
    await fresh('give cert_uncut_sapphire 400');
    const opened = await bot.openBank();
    if (!opened.success) throw new Error(`openBank: ${opened.message}`);
    fire('dep', sdk.sendBankDeposit(items(sdk.getState(), /uncut sapphire/i)[0]!.slot, -1));
    await waitTicks(sdk, 2);
    fire('close', sdk.sendCloseModal());
    await waitTicks(sdk, 2);
    await cheat(sdk, 'give chisel 1');
    await waitTicks(sdk, 2);
    const booth = () => sdk.getState()!.nearbyLocs.filter(l => /bank booth/i.test(l.name)).sort((a, b) => a.distance - b.distance)[0]!;
    const boothOp = (l = booth()) => l.optionsWithIndex.find(o => /use-quickly|^bank/i.test(o.text))?.opIndex ?? 2;

    for (const variant of ['close', 'noclose'] as const) {
        for (let n = 0; n < N; n++) {
            // start each sample from an open bank with only the chisel in the inventory
            const b = booth();
            fire('booth', sdk.sendInteractLoc(b.x, b.z, b.id, boothOp(b)));
            await waitUntil(sdk, s => s.bank.isOpen, { maxTicks: 10 });
            await waitTicks(sdk, 1);
            const cycles: number[] = [];
            let t0 = (await nextTick(sdk)).tick;
            for (let c = 0; c < 3; c++) {
                // bank tick: deposit the cut gems, withdraw a full stack of uncut ones
                const s = sdk.getState()!;
                const cut = items(s, /^sapphire$/i)[0];
                if (cut) fire('deposit', sdk.sendBankDeposit(cut.slot, -1));
                const bslot = s.bank.items.find(i => /uncut sapphire/i.test(i.name))!.slot;
                fire('withdraw', sdk.sendBankWithdraw(bslot, -1));
                if (variant === 'close') fire('close', sdk.sendCloseModal());
                const got = await waitUntil(sdk, st => count(st, /uncut sapphire/i) === 27, { maxTicks: 6 });
                if (!got.ok) throw new Error(`withdraw failed (${variant})`);
                // cut 27 with the chisel, then the booth click in the same burst
                const st = sdk.getState()!;
                const chisel = items(st, /^chisel$/i)[0]!;
                for (const g of items(st, /uncut sapphire/i)) fire('cut', rawUseOn(chisel.slot, g.slot));
                const bb = booth();
                fire('booth', sdk.sendInteractLoc(bb.x, bb.z, bb.id, boothOp(bb)));
                const back = await waitUntil(sdk, x => x.bank.isOpen && count(x, /uncut sapphire/i) === 0, { maxTicks: 14 });
                if (!back.ok) throw new Error(`cycle stalled (${variant}): uncut ${count(sdk.getState(), /uncut sapphire/i)}, bank ${sdk.getState()!.bank.isOpen}`);
                cycles.push(back.tick - t0);
                t0 = back.tick;
            }
            result(`bankop ${variant}`, { cycleTicks: cycles });
            flushRefusals(`bankop ${variant}`);
        }
    }
    // deposit everything and close
    const s = sdk.getState()!;
    for (const it of s.inventory) if (!/chisel/i.test(it.name)) fire('dep', sdk.sendBankDeposit(it.slot, -1));
    await waitTicks(sdk, 2);
    fire('close', sdk.sendCloseModal());
    await waitTicks(sdk, 2);
    refusals.splice(0);
}

// ---- 6. refused USER events: CLIENT budget, not the 5 USER slots ----
async function probeRefused() {
    await setstat(sdk, 'herblore', 99);
    for (const k of [0, 5, 10]) {
        for (let n = 0; n < N; n++) {
            await fresh('give unidentified_guam 10');
            const s0 = await nextTick(sdk);
            for (let i = 0; i < k; i++) fire('hidden button', sdk.sendClickComponent(NOTE_TOGGLE));
            for (const h of unid(s0)) fire('identify', sdk.sendUseItem(h.slot, opOf(h, /^identify/i)!));
            await waitUntil(sdk, s => unid(s).length === 0, { maxTicks: 8 });
            const end = (await waitTicks(sdk, 2)).tick;
            result(`refused k=${k} then 10 identifies`, { perTick: deltas(s0.tick, end, s => -unid(s).length) });
            flushRefusals('refused');
        }
    }
}

// ---- 7. two make-X completions in one tick ----
async function probeMakex() {
    await setstat(sdk, 'fletching', 99);
    await setstat(sdk, 'herblore', 99);
    await dismissAll();
    for (let n = 0; n < N; n++) {
        await fresh('give knife 1', 'give logs 2', 'give unidentified_guam 4');
        const s0 = await nextTick(sdk);
        const knife = items(s0, /^knife$/i)[0]!;
        const logs = items(s0, /^logs$/i);
        const herbs = unid(s0);
        const idOp = opOf(herbs[0]!, /^identify/i)!;
        // tick 0: menu, answer, menu, answer, identify
        fire('knife1', sdk.sendUseItemOnItem(knife.slot, logs[0]!.slot));
        fire('make1', sdk.sendClickComponent(SHAFTS_MAKE1));
        fire('knife2', sdk.sendUseItemOnItem(knife.slot, logs[1]!.slot));
        fire('make1', sdk.sendClickComponent(SHAFTS_MAKE1));
        fire('identify', sdk.sendUseItem(herbs[0]!.slot, idOp));
        // ticks 1, 2, 3: one identify each
        for (let t = 1; t <= 3; t++) {
            await nextTick(sdk);
            fire('identify', sdk.sendUseItem(herbs[t]!.slot, idOp));
        }
        const end = (await waitTicks(sdk, 8)).tick;
        result('makex two completions in one tick', {
            logsUsedPerTick: deltas(s0.tick, end, s => -count(s, /^logs$/i)),
            shaftsPerTick: deltas(s0.tick, end, s => count(s, /arrow shaft/i)),
            identifiedPerTick: deltas(s0.tick, end, s => -unid(s).length),
            fletchXpTicks: Object.keys(deltas(s0.tick, end, s => xp(s, 'fletching'))).map(Number),
        });
        flushRefusals('makex');
        // control: one completion, then an identify in the same tick and one a tick
        await fresh('give knife 1', 'give logs 1', 'give unidentified_guam 3');
        const c0 = await nextTick(sdk);
        const k2 = items(c0, /^knife$/i)[0]!, l2 = items(c0, /^logs$/i)[0]!, h2 = unid(c0);
        fire('knife', sdk.sendUseItemOnItem(k2.slot, l2.slot));
        fire('make1', sdk.sendClickComponent(SHAFTS_MAKE1));
        fire('identify', sdk.sendUseItem(h2[0]!.slot, idOp));
        await nextTick(sdk);
        fire('identify', sdk.sendUseItem(h2[1]!.slot, idOp));
        const cend = (await waitTicks(sdk, 8)).tick;
        result('makex control: one completion', {
            shaftsPerTick: deltas(c0.tick, cend, s => count(s, /arrow shaft/i)),
            identifiedPerTick: deltas(c0.tick, cend, s => -unid(s).length),
        });
        flushRefusals('makex control');
        // B: the same two completions with nothing behind them, so no later op clears the weak-queued fletch
        for (const twice of [true, false]) {
            await fresh('give knife 1', 'give logs 2');
            const b0 = await nextTick(sdk);
            const kn = items(b0, /^knife$/i)[0]!, lg = items(b0, /^logs$/i);
            fire('knife', sdk.sendUseItemOnItem(kn.slot, lg[0]!.slot));
            fire('make1', sdk.sendClickComponent(SHAFTS_MAKE1));
            if (twice) {
                fire('knife', sdk.sendUseItemOnItem(kn.slot, lg[1]!.slot));
                fire('make1', sdk.sendClickComponent(SHAFTS_MAKE1));
            }
            const bend = (await waitTicks(sdk, 12)).tick;
            result(`makex ${twice ? 'two completions' : 'one completion'}, nothing after`, {
                logsUsedPerTick: deltas(b0.tick, bend, s => -count(s, /^logs$/i)),
                fletchXpTicks: Object.keys(deltas(b0.tick, bend, s => xp(s, 'fletching'))).map(Number),
            });
            flushRefusals('makex B');
        }
    }
}

// ---- 8. magic potion ----
async function probeMagicpot() {
    await setstat(sdk, 'herblore', 76);
    await dismissAll();
    for (let n = 0; n < N; n++) {
        result('magicpot x14 at Herblore 76', await pairBurst('mix', 'herblore', ['give lantadymevial 14', 'give cactus_potato 14'], LANTADYME_UNF, POTATO_CACTUS, MAGIC_POTION));
        await dismissAll();
    }
}

// ---- 9. Hassan's jug of water ----
async function probeHassan() {
    await teleTo(main, HASSAN.x, HASSAN.z);
    await fresh();
    const hassan = () => sdk.getState()!.nearbyNpcs.find(p => /hassan/i.test(p.name));
    if (!hassan()) throw new Error('no Hassan');
    // learn the pages once, read-then-act
    fire('talk', sdk.sendInteractNpc(hassan()!.index, 1));
    const pages: string[] = [];
    for (let i = 0; i < 12; i++) {
        const s = await waitUntil(sdk, x => x.dialog.isOpen && !x.dialog.isWaiting, { maxTicks: 6 });
        if (!s.ok) break;
        const d = s.state!.dialog;
        pages.push(d.options.length > 1 ? `choice[${d.options.map(o => `${o.index}:${o.componentId}:${o.text}`).join('|')}]` : `page`);
        if (d.options.length > 1) fire('choose', sdk.clickDialogByText(/too hot/i));
        else fire('continue', sdk.sendClickDialog(0));
        await nextTick(sdk);
    }
    result('hassan pages (read-then-act)', { pages, jugs: count(sdk.getState(), /jug of water/i) });
    await dismissAll();
    // blind: once the greeting page is visible, [continue, choice 2, continue, continue, op]
    for (let n = 0; n < N; n++) {
        await fresh();
        const s0 = await nextTick(sdk);
        fire('talk', sdk.sendInteractNpc(hassan()!.index, 1));
        let bursts = 0;
        const jugsWanted = 10;
        while (count(sdk.getState(), /jug of water/i) < jugsWanted && sdk.getState()!.tick - s0.tick < 80) {
            const s = await waitUntil(sdk, x => x.dialog.isOpen && !x.dialog.isWaiting && x.dialog.options.length <= 1, { maxTicks: 8 });
            if (!s.ok) { fire('talk', sdk.sendInteractNpc(hassan()!.index, 1)); continue; }
            fire('c', sdk.sendClickDialog(0, { blind: true }));
            fire('choice', sdk.sendClickComponent(CHOICE_2));
            fire('c', sdk.sendClickDialog(0, { blind: true }));
            fire('c', sdk.sendClickDialog(0, { blind: true }));
            fire('talk', sdk.sendInteractNpc(hassan()!.index, 1));
            bursts++;
            await nextTick(sdk);
        }
        const end = (await waitTicks(sdk, 2)).tick;
        const perTick = deltas(s0.tick, end, s => count(s, /jug of water/i));
        const t = Object.keys(perTick).map(Number);
        result('hassan blind', { jugs: count(byTick.get(end), /jug of water/i), bursts, perTick, ticksFirstToLast: t.length > 1 ? t[t.length - 1]! - t[0]! : null, ticksPerJugSteady: t.length > 1 ? (t[t.length - 1]! - t[0]!) / (t.length - 1) : null });
        flushRefusals('hassan');
        await dismissAll();
    }
}

// ---- 10. wine from Cooking 1, and the timer beside a gathering loop ----
async function probeWine() {
    await dismissAll();
    for (let n = 0; n < N; n++) {
        await teleTo(main, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);
        await setstat(sdk, 'cooking', 99);
        await fresh('give jug_unfermented_wine 27');
        const opened = await bot.openBank();
        if (!opened.success) throw new Error(`openBank: ${opened.message}`);
        // clear old wines out of the bank view count: deposit the 27 new ones
        fire('dep', sdk.sendBankDeposit(items(sdk.getState(), /unfermented/i)[0]!.slot, -1));
        await waitTicks(sdk, 2);
        const bankBefore = (re: RegExp) => sdk.getState()!.bank.items.filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
        const before = { unf: bankBefore(/unfermented/i), wine: bankBefore(/^jug of wine$/i), bad: bankBefore(/bad wine/i) };
        fire('close', sdk.sendCloseModal());
        await waitTicks(sdk, 2);
        await setstat(sdk, 'cooking', 1);
        await waitTicks(sdk, 2);
        const x0 = xp(sdk.getState(), 'cooking');
        result('wine setup', { bankBefore: before, cookingLevel: lvl(sdk.getState(), 'cooking'), cookingXp: x0 });
        await logoutClean(main);
        await login(main);
        // the login arms fermenting_wine for 20 ticks; leave every modal closed until it fires
        const l0 = sdk.getState()!.tick;
        const fired = await waitUntil(sdk, s => xp(s, 'cooking') > x0, { maxTicks: 40 });
        await waitTicks(sdk, 3);
        const x1 = xp(sdk.getState(), 'cooking');
        const levelAfter = lvl(sdk.getState(), 'cooking');
        await dismissAll();
        const re = await bot.openBank();
        const bk = (r: RegExp) => sdk.getState()!.bank.items.filter(i => r.test(i.name)).reduce((a, i) => a + i.count, 0);
        const good = bk(/^jug of wine$/i) - before.wine, bad = bk(/bad wine/i) - before.bad;
        result('wine from Cooking 1 (27 bank wines, relog)', {
            firedAtTickAfterLogin: fired.ok ? fired.tick - l0 : null,
            bankOpened: re.success, good, bad, unfermentedLeft: bk(/unfermented/i),
            baseXp: base(x1 - x0), expectedBaseXp: good * 110, levelAfter,
        });
        fire('close', sdk.sendCloseModal());
        await waitTicks(sdk, 2);
    }
    // O4: the fermentation timer fires while a fishing loop keeps running (Cooking 99: no level-up chat)
    await teleTo(main, BARB_FLY.x, BARB_FLY.z);
    await setstat(sdk, 'cooking', 99);
    await setstat(sdk, 'fishing', 99);
    await dismissAll();
    for (let n = 0; n < N; n++) {
        await fresh('give fly_fishing_rod 1', 'give feather 500', 'give grapes 1', 'give jug_water 1');
        const a = await nextTick(sdk);
        fire('wine', sdk.sendUseItemOnItem(items(a, /^grapes$/i)[0]!.slot, items(a, /jug of water/i)[0]!.slot));
        await nextTick(sdk);
        const spot = sdk.getState()!.nearbyNpcs.filter(p => /^fishing spot$/i.test(p.name) && p.optionsWithIndex.some(o => /^lure/i.test(o.text))).sort((x, y) => x.distance - y.distance)[0];
        if (!spot) throw new Error('no lure spot');
        fire('lure', sdk.sendInteractNpc(spot.index, spot.optionsWithIndex.find(o => /^lure/i.test(o.text))!.opIndex));
        const end = (await waitTicks(sdk, 40)).tick;
        const fish = Object.keys(deltas(a.tick, end, s => xp(s, 'fishing'))).map(Number);
        const fermentTick = Number(Object.keys(deltas(a.tick, end, s => count(s, /unfermented/i))).map(Number).filter(t => t > 1)[0] ?? -1);
        result('wine timer beside fly fishing', { fermentedAtTick: fermentTick, catchTicks: fish, catchesAfterFerment: fish.filter(t => t > fermentTick).length, cookingXpBase: base(xp(byTick.get(end), 'cooking') - xp(a, 'cooking')) });
        flushRefusals('wine+fish');
    }
}

// ---- Dragon Slayer wall from the Karamja side ----
async function probeDswall() {
    for (let n = 0; n < N; n++) {
        await teleTo(main, 2836, 9599);
        await cheat(sdk, 'setvar dragon_wall 0');
        await waitTicks(sdk, 2);
        const wall = sdk.getState()!.nearbyLocs.filter(l => l.id === 2606 || /wall/i.test(l.name)).sort((a, b) => a.distance - b.distance)[0];
        if (!wall) { result('dswall', { error: 'no wall loc', locs: sdk.getState()!.nearbyLocs.slice(0, 8).map(l => `${l.id}:${l.name}@${l.x},${l.z}`) }); return; }
        const s0 = await nextTick(sdk);
        fire('wall', sdk.sendInteractLoc(wall.x, wall.z, wall.id, wall.optionsWithIndex[0]?.opIndex ?? 1));
        const s1 = await waitTicks(sdk, 6);
        result('dswall', {
            wall: `${wall.id}:${wall.name}@${wall.x},${wall.z} ops=${wall.optionsWithIndex.map(o => o.text).join('/')}`,
            before: `${s0.player?.worldX},${s0.player?.worldZ}`, after: `${s1.player?.worldX},${s1.player?.worldZ}`,
            messages: s1.gameMessages.filter(m => m.tick >= s0.tick - 1).map(m => m.text).slice(-3),
        });
        flushRefusals('dswall');
    }
}

const table: Record<string, () => Promise<void>> = {
    tickets: probeTickets, staves: probeStaves, kebab: probeKebab, levelup: probeLevelup, bankop: probeBankop,
    refused: probeRefused, makex: probeMakex, magicpot: probeMagicpot, hassan: probeHassan, wine: probeWine, dswall: probeDswall,
};
result('measure-sweep start', { probes, n: N, tickrate: process.env.NODE_TICKRATE ?? '' });
if (arg('setup', '1') !== '0') await ensureTabs(main);
for (const p of probes) {
    try {
        await table[p]!();
    } catch (e) {
        result(`${p} error`, String(e));
        refusals.splice(0);
        try { await dismissAll(main, 10); } catch { /* keep going */ }
    }
}
await closeSession(main);
process.exit(0);
