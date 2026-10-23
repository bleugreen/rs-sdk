import { describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, NearbyNpc, TradeItem } from '../../sdk/types';
import { baseState, drive, FakeSdk, type SentAction } from '../lib/fake-sdk';
import { levelForXp, XP_RATE, xpForLevel } from '../lib/xp';
import {
    castPicks, ENCHANTS, enchantedRingSpecs, enchantHeld, loadsDelivered, magicLevel, magicXp, newPageMemory, pagesAt, pageStep, resolveOptions, ROUTE_LOADS, s02Pre, s04Pre, s04Status,
    simulatePlan, steps, strikeTarget, strikeTo, tierOf, wantFor, heldRings, heldRingCounts, notedRings, notedRingRefusal, wieldStaff, WIELD_SENDS, WIELD_WAIT_TICKS, type MagicReport, type RingCounts,
} from './magic';

// ------------------------------------------------------------------ fixtures

const IDS: Record<string, number> = {
    'Sapphire ring': 1637, 'Emerald ring': 1639, 'Ruby ring': 1641, 'Diamond ring': 1643,
    'Ring of recoil': 2550, 'Ring of dueling(8)': 2552, 'Ring of forging': 2568, 'Ring of life': 2570,
    'Cosmic rune': 564, 'Air rune': 556, 'Fire rune': 554, 'Earth rune': 557, 'Mind rune': 558, 'Water rune': 555,
    'Staff of water': 1383, Tinderbox: 590,
};
const item = (slot: number, name: string, count = 1): InventoryItem =>
    ({ slot, id: IDS[name]!, name, count, optionsWithIndex: name === 'Staff of water' ? [{ text: 'Wield', opIndex: 2 }] : [] }) as unknown as InventoryItem;
const magic = (xp: number) => ({ name: 'Magic', level: levelForXp(xp), baseLevel: levelForXp(xp), experience: xp });
const STAFF_WORN = [item(3, 'Staff of water')];
const AT7 = xpForLevel(7);
const GIVER = 'ringer';
/** rs/41's per-load ring givers. */
const H8X = ['cairn_h81', 'cairn_h82', 'cairn_h83'];

/** S04's kit after S03: the tinderbox and four rune stacks (H1), the staff worn: 23 free slots. */
const kit = (): InventoryItem[] => [item(0, 'Tinderbox'), item(1, 'Cosmic rune', 60), item(2, 'Air rune', 81), item(3, 'Fire rune', 80), item(4, 'Earth rune', 50)];
const rings = (from: number, tiers: RingCounts): InventoryItem[] => {
    const out: InventoryItem[] = [];
    for (const t of ['sapphire', 'emerald', 'ruby', 'diamond'] as const) for (let i = 0; i < (tiers[t] ?? 0); i++) out.push(item(from + out.length, ENCHANTS[t].ring));
    return out;
};
const player = (x: number, z: number) => ({ name: 'scored', worldX: x, worldZ: z, x, z, level: 0 }) as unknown as BotWorldState['player'];

function state(over: Partial<BotWorldState> = {}, xp = AT7): BotWorldState {
    return baseState({
        tick: 100, player: player(3200, 3226), skills: [magic(xp)], inventory: kit(), equipment: STAFF_WORN,
        nearbyPlayers: [GIVER, ...H8X].map((name, i) => ({ name, index: 7 + i }) as unknown as BotWorldState['nearbyPlayers'][number]), ...over,
    });
}

const closed = { isOpen: false, options: [], isWaiting: false };
const levelPage = (tick: number, lvl: number) => ({ isOpen: true, options: [], isWaiting: false, pageId: `lvl-${tick}`, allComponents: [{ text: `Congratulations, you just advanced a Magic level. Your Magic level is now ${lvl}.` }] }) as unknown as BotWorldState['dialog'];
const unlockPage = (tick: number) => ({ isOpen: true, options: [], isWaiting: false, pageId: `unlock-${tick}`, allComponents: [{ text: 'You can now cast a new spell!' }] }) as unknown as BotWorldState['dialog'];
const msg = (text: string, tick: number) => ({ type: 0, text, tick, fromSelf: false }) as unknown as BotWorldState['gameMessages'][number];
const ti = (id: number, name: string, count: number): TradeItem => ({ slot: 0, id, name, count });

class Fake extends FakeSdk {
    sendCloseModal() { return this.sendAction({ method: 'sendCloseModal', args: [] }); }
    sendSpellOnItem(slot: number, com: number) { return this.sendAction({ method: 'sendSpellOnItem', args: [slot, com] }); }
}

// ------------------------------------------------------------------ the scripted server

interface Sim {
    delayedUntil: number;
    /** Ticks a cast landed on. */
    lands: number[];
    /** Spell clicks that reached the server inside a cast's delay. */
    dropped: number;
    /** Ticks our trade clicks were sent on, and those that landed inside the delay. */
    tradeClicks: number[];
    /** Each opened trade's partner, in order. */
    partners: string[];
    tradeDropped: number;
    /** What SCORED gave the giver, per completed trade. */
    received: TradeItem[][];
    loadIdx: number;
    continues: number;
    /** Wind Strike: tick the next spell may land. */
    nextAttack: number;
}

const freeSlots = (inv: readonly InventoryItem[], n: number): number[] => {
    const used = new Set(inv.map(i => i.slot));
    const out: number[] = [];
    for (let s = 0; s < 28 && out.length < n; s++) if (!used.has(s)) out.push(s);
    return out;
};

/**
 * The engine and the ring giver, as far as these steps touch them: a click sent on label T lands
 * on T+1; an enchant blocks spell and trade clicks for the next two ticks (p_delay(1)); a level
 * rise opens its page on the next tick and an unlock level chains one more; a landed cast closes
 * the page. The giver's request stands; our click opens the screens with the next load offered.
 */
function server(sdk: Fake, loads: readonly RingCounts[] = ROUTE_LOADS) {
    const sim: Sim = { delayedUntil: -1, lands: [], dropped: 0, tradeClicks: [], partners: [], tradeDropped: 0, received: [], loadIdx: 0, continues: 0, nextAttack: -1 };
    const queue: Array<{ due: number; fx: (s: BotWorldState) => Partial<BotWorldState> }> = [];
    const at = (due: number, fx: (s: BotWorldState) => Partial<BotWorldState>) => queue.push({ due, fx });
    const offerOf = (i: number): TradeItem[] => {
        const l = loads[i];
        if (!l) return [];
        return (['sapphire', 'emerald', 'ruby', 'diamond'] as const).filter(t => (l[t] ?? 0) > 0).map(t => ti(IDS[ENCHANTS[t].ring]!, ENCHANTS[t].ring, l[t]!));
    };
    const toConfirm = (tr: NonNullable<BotWorldState['trade']>) => ({ trade: { ...tr, screen: 'confirm' as const, myAccepted: false, partnerAccepted: true } });
    const levelUp = (cur: BotWorldState, xp0: number, xp: number) => {
        if (levelForXp(xp) > levelForXp(xp0)) at(cur.tick + 1, c => ({ dialog: levelPage(c.tick, levelForXp(xp)) }));
    };

    sdk.onSend = (a: SentAction) => {
        const s = sdk.state!;
        const next = s.tick + 1;
        switch (a.method) {
            case 'sendSpellOnItem': {
                const [slot, com] = a.args as [number, number];
                at(next, cur => {
                    if (cur.tick <= sim.delayedUntil) { sim.dropped++; return {}; }
                    const it = cur.inventory.find(i => i.slot === slot);
                    const tier = it && tierOf(it.name);
                    if (!tier || ENCHANTS[tier].com !== com || magicLevel(cur) < ENCHANTS[tier].level) return {};
                    const xp0 = magicXp(cur);
                    const xp = xp0 + ENCHANTS[tier].base * XP_RATE;
                    sim.delayedUntil = cur.tick + 2;
                    sim.lands.push(cur.tick);
                    levelUp(cur, xp0, xp);
                    return { inventory: cur.inventory.map(i => (i.slot === slot ? item(slot, ENCHANTS[tier].product) : i)), skills: [magic(xp)], dialog: closed };
                });
                break;
            }
            case 'sendSpellOnNpc': {
                const [index] = a.args as [number];
                at(next, cur => {
                    if (cur.tick < sim.nextAttack) return {};
                    const npc = cur.nearbyNpcs.find(n => n.index === index && n.hp !== 0);
                    if (!npc) return {};
                    sim.nextAttack = cur.tick + 5;
                    const xp0 = magicXp(cur);
                    const xp = xp0 + 7.5 * XP_RATE; // 5.5 on the cast + 2 for one damage
                    levelUp(cur, xp0, xp);
                    // The chicken dies; a fresh one walks in two ticks later.
                    at(cur.tick + 2, c => ({ nearbyNpcs: [...c.nearbyNpcs.filter(n => n.index !== index), chicken(index + 1, 3)] }));
                    return { skills: [magic(xp)], nearbyNpcs: cur.nearbyNpcs.map(n => (n.index === index ? { ...n, hp: 0 } : n)) };
                });
                break;
            }
            case 'sendClickDialog':
                at(next, cur => {
                    if (!cur.dialog.isOpen) return {};
                    sim.continues++;
                    const lvl = magicLevel(cur);
                    if (cur.dialog.pageId?.startsWith('lvl-') && pagesAt(lvl) === 2) return { dialog: unlockPage(cur.tick) };
                    return { dialog: closed };
                });
                break;
            case 'sendCloseModal':
                at(next, () => ({ dialog: closed, modalOpen: false }));
                break;
            case 'sendUseItem': {
                const [slot] = a.args as [number];
                at(next, cur => {
                    const it = cur.inventory.find(i => i.slot === slot);
                    if (!it || it.name !== 'Staff of water') return {};
                    return { inventory: cur.inventory.filter(i => i.slot !== slot), equipment: [item(3, 'Staff of water')] };
                });
                break;
            }
            case 'sendTradeRequest': {
                const [index] = a.args as [number];
                sim.tradeClicks.push(s.tick);
                at(next, cur => {
                    if (cur.tick <= sim.delayedUntil) { sim.tradeDropped++; return {}; }
                    const gameMessages = [...cur.gameMessages, msg('Sending trade offer...', cur.tick)];
                    if (cur.trade?.isOpen) return { trade: undefined, gameMessages };
                    const partner = cur.nearbyPlayers.find(p => p.index === index)?.name ?? '?';
                    sim.partners.push(partner);
                    return { gameMessages, trade: { isOpen: true, screen: 'offer', partner, myOffer: [], theirOffer: offerOf(sim.loadIdx), myAccepted: false, partnerAccepted: true } };
                });
                break;
            }
            case 'sendOfferItem': {
                const [slot] = a.args as [number];
                at(next, cur => {
                    const it = cur.inventory.find(i => i.slot === slot);
                    if (!it || !cur.trade?.isOpen) return {};
                    const moved = cur.inventory.filter(i => i.id === it.id);
                    return {
                        inventory: cur.inventory.filter(i => i.id !== it.id),
                        trade: { ...cur.trade, myOffer: [...cur.trade.myOffer, ti(it.id, it.name, moved.length)], myAccepted: false, partnerAccepted: false },
                    };
                });
                at(next + 1, cur => {
                    const tr = cur.trade;
                    if (!tr?.isOpen || tr.screen !== 'offer') return {};
                    return tr.myAccepted ? toConfirm(tr) : { trade: { ...tr, partnerAccepted: true } };
                });
                break;
            }
            case 'sendAcceptTrade':
                at(next, cur => {
                    const tr = cur.trade;
                    if (!tr?.isOpen) return {};
                    if (tr.screen === 'offer') return tr.partnerAccepted ? toConfirm(tr) : { trade: { ...tr, myAccepted: true } };
                    sim.received.push(tr.myOffer);
                    const incoming = tr.theirOffer.flatMap(i => Array.from({ length: i.count }, () => i));
                    const slots = freeSlots(cur.inventory, incoming.length);
                    sim.loadIdx += tr.theirOffer.length ? 1 : 0;
                    return {
                        trade: undefined,
                        inventory: [...cur.inventory, ...incoming.map((i, k) => item(slots[k]!, i.name))],
                        gameMessages: [...cur.gameMessages, msg('Accepted trade.', cur.tick)],
                    };
                });
                break;
            case 'sendDeclineTrade':
                at(next, cur => {
                    const tr = cur.trade;
                    if (!tr?.isOpen) return {};
                    const back = tr.myOffer.flatMap(i => Array.from({ length: i.count }, () => i));
                    const slots = freeSlots(cur.inventory, back.length);
                    return { trade: undefined, inventory: [...cur.inventory, ...back.map((i, k) => item(slots[k]!, i.name))] };
                });
                break;
        }
    };
    const tick = sdk.tick.bind(sdk);
    sdk.tick = patch => tick(cur => {
        let s: BotWorldState = { ...cur, tick: cur.tick + 1, ...(typeof patch === 'function' ? patch(cur) : patch) };
        for (let i = 0; i < queue.length; ) {
            if (queue[i]!.due <= s.tick) s = { ...s, ...queue.splice(i, 1)[0]!.fx(s) };
            else i++;
        }
        return s;
    });
    return sim;
}

const chicken = (index: number, distance: number): NearbyNpc =>
    ({ kind: 'npc', id: 41, index, name: 'Chicken', combatLevel: 1, x: 3233, z: 3295, distance, hp: 3, maxHp: 3, healthPercent: 100, targetIndex: -1, inCombat: false, optionsWithIndex: [] }) as unknown as NearbyNpc;

const histogram = (xs: number[]) => xs.reduce<Record<number, number>>((h, x) => ((h[x] = (h[x] ?? 0) + 1), h), {});
const gapsOf = (ts: number[]) => ts.slice(1).map((t, i) => t - ts[i]!);

// ------------------------------------------------------------------ the plan

describe('the plan', () => {
    test('the route loads take the bottom of 7 to 59 with the manifest\'s casts and runes', () => {
        const p = simulatePlan(AT7, {}, ROUTE_LOADS, 59);
        expect(p.ok).toBe(true);
        expect(p.casts).toEqual({ sapphire: 12, emerald: 27, ruby: 16, diamond: 5 });
        expect(p.runes).toEqual({ cosmic: 60, air: 81, fire: 80, earth: 50 });
        expect(p.level).toBe(59);
        expect(ROUTE_LOADS.map(l => Object.values(l).reduce((a, n) => a + n!, 0))).toEqual([20, 20, 20]);
    });

    test('a ring that comes up before its level, or rings that run out, are named', () => {
        const early = simulatePlan(AT7, {}, [{ emerald: 8, sapphire: 0 }, ...ROUTE_LOADS], 59);
        expect(early.ok).toBe(false);
        expect(early.reason).toContain('emerald ring in load 1 comes up at Magic 7, below its 27');
        const short = simulatePlan(AT7, {}, ROUTE_LOADS.slice(0, 2), 59);
        expect(short.ok).toBe(false);
        expect(short.reason).toContain('short of 59');
    });

    test('the plan stops at the goal and leaves the rest', () => {
        const p = simulatePlan(xpForLevel(58), {}, [{ diamond: 20 }], 59);
        expect(p.ok).toBe(true);
        expect(p.casts.diamond!).toBeLessThan(20);
    });

    test('loads delivered are read back from the xp and the rings held, with S02\'s overshoot inside the slack', () => {
        const loads = ROUTE_LOADS;
        expect(loadsDelivered(AT7, {}, loads, AT7)).toBe(0);
        expect(loadsDelivered(AT7 + 13 * XP_RATE, {}, loads, AT7)).toBe(0);
        // Load 1 arrived, nothing cast yet.
        expect(loadsDelivered(AT7, { sapphire: 12, emerald: 8 }, loads, AT7)).toBe(1);
        // Load 1 cast out, 7 base of overshoot from S02.
        const after1 = AT7 + (12 * 17.5 + 8 * 37 + 7) * XP_RATE;
        expect(loadsDelivered(after1, {}, loads, AT7)).toBe(1);
        // Load 2 half cast.
        expect(loadsDelivered(after1 + 10 * 37 * XP_RATE, { emerald: 9, ruby: 1 }, loads, AT7)).toBe(2);
        // Everything cast.
        expect(loadsDelivered(AT7 + 2511.3 * XP_RATE - 23.28 * XP_RATE, {}, loads, AT7)).toBe(3);
    });

    test('casts go lowest tier first, then by slot, and only on rings the level can enchant', () => {
        const s = state({ inventory: [...kit(), item(20, 'Emerald ring'), item(9, 'Sapphire ring'), item(12, 'Sapphire ring')] });
        expect(castPicks(s, 7, 2)).toEqual([{ slot: 9, com: 1155, tier: 'sapphire' }, { slot: 12, com: 1155, tier: 'sapphire' }]);
        expect(castPicks(s, 27, 3).map(p => p.tier)).toEqual(['sapphire', 'sapphire', 'emerald']);
        expect(castPicks(state({ inventory: [item(5, 'Ruby ring')] }), 48)).toEqual([]);
        expect(wantFor({ ruby: 15, diamond: 5 })).toEqual([{ item: 1641, amount: 15 }, { item: 1643, amount: 5 }]);
    });

    test('page counts follow levelup_unlocks_magic.rs2', () => {
        expect([2, 3, 4, 5, 6, 7, 27, 28, 59].map(pagesAt)).toEqual([1, 2, 1, 2, 1, 2, 2, 1, 2]);
    });
});

// ------------------------------------------------------------------ refusals

describe('preconditions refuse with a reason', () => {
    const o = resolveOptions({ giver: GIVER });

    test('S02: away from the coop, short of runes; a no-op once at 7', () => {
        const at = (x: number, z: number, inv: InventoryItem[] = [item(0, 'Air rune', 25), item(1, 'Mind rune', 15)]) => state({ player: player(x, z), inventory: inv }, 0);
        expect(s02Pre(at(3235, 3295), o)).toBe(true);
        expect(s02Pre(at(3222, 3222), o)).toContain('tiles from the chickens');
        expect(s02Pre(at(3235, 3295, [item(0, 'Air rune', 3), item(1, 'Mind rune', 15)]), o)).toContain('needs up to 5 air and mind runes');
        expect(s02Pre(state({ player: player(3222, 3222), inventory: [] }, AT7), o)).toBe(true);
    });

    test('S04: the kit as staged passes', () => {
        expect(s04Pre(state(), o)).toBe(true);
        // A held staff passes too: the step wields it.
        expect(s04Pre(state({ equipment: [], inventory: [...kit(), item(5, 'Staff of water')] }), o)).toBe(true);
    });

    test('S04: each missing input is named', () => {
        expect(s04Pre(state({}, xpForLevel(6)), o)).toContain('below Lvl-1 Enchant');
        expect(s04Pre(state({ equipment: [] }), o)).toContain('no staff of water');
        expect(s04Pre(state({ inventory: kit().map(i => (i.name === 'Earth rune' ? { ...i, count: 40 } : i)) }), o)).toContain('earth rune 40 of 50');
        expect(s04Pre(state(), resolveOptions({}))).toContain('has no giver');
        const full = [...kit(), ...Array.from({ length: 6 }, (_, i) => item(5 + i, 'Tinderbox'))];
        expect(s04Pre(state({ inventory: full }), o)).toBe('11 other items (Tinderbox, Cosmic rune, Air rune, Fire rune, Earth rune): need 20 free slots for ring load 1 (0 enchanted rings go back in its trade)');
        // Enchanted rings going back count as room: 8 other items and 20 products is a full
        // inventory, and load 2's 20 still fit through the swap.
        const swapFull = [...kit(), ...Array.from({ length: 3 }, (_, i) => item(5 + i, 'Tinderbox')), ...Array.from({ length: 20 }, (_, i) => item(8 + i, 'Ring of recoil'))];
        expect(swapFull.length).toBe(28);
        expect(s04Pre(state({ inventory: swapFull }, AT7 + 12 * 17.5 * XP_RATE + 8 * 37 * XP_RATE), o)).toBe(true);
        expect(s04Pre(state(), resolveOptions({ giver: GIVER, loads: [{ emerald: 20 }, ...ROUTE_LOADS] }))).toContain('comes up at Magic 7, below its 27');
    });

    test('S04: passed at the goal, with the last load\'s enchanted rings still held for S05', () => {
        const at59 = xpForLevel(59);
        expect(s04Status(state({}, at59), o).passed).toBe(true);
        const holding = state({ inventory: [...kit(), item(10, 'Ring of forging', 1), item(11, 'Ring of life'), item(12, 'Ring of life')] }, at59);
        expect(s04Status(holding, o).passed).toBe(true);
        expect(s04Pre(holding, o)).toBe(true);
        // S05's swap offers them: one offer-all entry per product id.
        expect(enchantedRingSpecs(holding)).toEqual([{ item: IDS['Ring of forging']! }, { item: IDS['Ring of life']! }]);
    });
});

// ------------------------------------------------------------------ level-up pages

describe('level-up pages', () => {
    test('a level rise on R is answered by a blind burst on R+1, two at an unlock level', () => {
        const mem = newPageMemory();
        expect(pageStep(mem, state({ tick: 10 }, xpForLevel(6)))).toBe(0);
        expect(pageStep(mem, state({ tick: 11 }, xpForLevel(7)))).toBe(0); // the label that shows 7
        expect(pageStep(mem, state({ tick: 12 }, xpForLevel(7)))).toBe(2); // the page opens now
        expect(pageStep(mem, state({ tick: 13 }, xpForLevel(7)))).toBe(0);
    });

    test('the backstop answers a level-up page still open two labels after the last continue', () => {
        const mem = newPageMemory();
        pageStep(mem, state({ tick: 10 }, xpForLevel(5)));
        pageStep(mem, state({ tick: 11 }, xpForLevel(6)));
        expect(pageStep(mem, state({ tick: 12 }, xpForLevel(6)))).toBe(1);
        const open = (tick: number) => state({ tick, dialog: levelPage(tick, 6) }, xpForLevel(6));
        expect(pageStep(mem, open(13))).toBe(0);
        expect(pageStep(mem, open(14))).toBe(1);
    });
});

// ------------------------------------------------------------------ S02 on the scripted server

describe('S02 Wind Strike', () => {
    test('strikes 1 to 7, retargets after each kill and answers every page on the label after it opens', async () => {
        const sdk = new Fake(state({ player: player(3235, 3295), inventory: [item(0, 'Air rune', 25), item(1, 'Mind rune', 15)], nearbyNpcs: [chicken(1, 2), chicken(2, 4)] }, 0));
        const sim = server(sdk);
        const r = await drive(sdk, strikeTo(sdk as never, 7), 200);
        await drive(sdk, Promise.resolve(), 3);
        sdk.tick();
        sdk.tick();
        expect(r.ok).toBe(true);
        // 7.5 base a cast (1 damage): 3 casts make 22.5 base, short of 7's 23.3, so a 4th lands and
        // overshoots to 8 (28.2). Bigger hits reach 7 on 3 casts (lab: 3 of 4 runs).
        const levels = [1, 2, 3, 4].map(n => levelForXp(n * 7.5 * XP_RATE));
        expect(levels).toEqual([3, 5, 6, 8]);
        expect(magicLevel(sdk.state)).toBe(8);
        expect(r.xpTicks.length).toBe(4);
        expect(gapsOf(r.xpTicks)).toEqual([5, 5, 5]);
        const pages = levels.map(pagesAt).reduce((a, n) => a + n, 0);
        expect(r.pagesSent).toBe(pages);
        expect(sim.continues).toBe(pages);
        expect(sdk.state!.dialog.isOpen).toBe(false);
        // The goal shows on the 4th xp label; the burst goes on the next one and the step ends there.
        expect(r.endTick).toBe(r.xpTicks.at(-1)! + 1);
        const targets = sdk.sent.filter(a => a.method === 'sendSpellOnNpc').map(a => a.args[0]);
        expect(new Set(targets).size).toBe(4);
    });

    test('the step drops the mind runes on its exit label, after the goal shows (rs/158: H4 fits with a slot spare)', async () => {
        const sdk = new Fake(state({ player: player(3235, 3295), inventory: [item(0, 'Air rune', 25), item(1, 'Mind rune', 15), item(2, 'Tinderbox')], nearbyNpcs: [chicken(1, 2), chicken(2, 4)] }, 0));
        server(sdk);
        const reports: MagicReport[] = [];
        const [s02] = steps({ onReport: r => reports.push(r) });
        await drive(sdk, s02!.run({ sdk } as never), 200);
        const rep = reports[0] as Extract<MagicReport, { step: 'S02' }>;
        expect(rep.dropped).toEqual(['Mind rune']);
        const drops = sdk.sent.filter(a => a.method === 'sendDropItem');
        expect(drops.map(a => a.args[0])).toEqual([1]);
        // Sent on the exit, after every strike and page answer.
        expect(sdk.sent.at(-1)!.method).toBe('sendDropItem');
        expect(rep.strike.ok).toBe(true);

        // A resume already at the goal still drops them; an empty list drops nothing.
        const at7 = new Fake(state({ inventory: [item(1, 'Mind rune', 11)] }, xpForLevel(7)));
        await drive(at7, s02!.run({ sdk: at7 } as never), 3);
        expect(at7.sent.filter(a => a.method === 'sendDropItem').map(a => a.args[0])).toEqual([1]);
        const keep = new Fake(state({ inventory: [item(1, 'Mind rune', 11)] }, xpForLevel(7)));
        await drive(keep, steps({ dropAtStrikeExit: [] })[0]!.run({ sdk: keep } as never), 3);
        expect(keep.sent.some(a => a.method === 'sendDropItem')).toBe(false);
    });

    test('gives up with a reason when no chicken is in view', async () => {
        const sdk = new Fake(state({ player: player(3235, 3295), nearbyNpcs: [] }, 0));
        server(sdk);
        const r = await drive(sdk, strikeTo(sdk as never, 7), 40);
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('no live chicken');
    });

    test('prefers a free chicken, nearest first, and keeps its target while it lives', () => {
        const fighting = { ...chicken(1, 1), inCombat: true };
        const s = state({ nearbyNpcs: [fighting, chicken(2, 5), chicken(3, 3)] });
        expect(strikeTarget(s, null)!.index).toBe(3);
        expect(strikeTarget(s, 2)!.index).toBe(2);
        expect(strikeTarget(state({ nearbyNpcs: [{ ...chicken(2, 5), hp: 0 }, chicken(3, 3)] }), 2)!.index).toBe(3);
    });
});

// ------------------------------------------------------------------ S04 on the scripted server

describe('S04 enchanting', () => {
    test('25 diamond enchants at one click a label: every gap 3, clicks inside the delay dropped, pages closed by the casts', async () => {
        const inv = [item(0, 'Cosmic rune', 25), item(1, 'Earth rune', 250), ...rings(2, { diamond: 25 })];
        const sdk = new Fake(state({ inventory: inv }, xpForLevel(57)));
        const sim = server(sdk);
        const r = await drive(sdk, enchantHeld(sdk as never, { untilLevel: 99 }), 120);
        expect(r.ok).toBe(true);
        expect(r.casts).toBe(25);
        expect(histogram(gapsOf(r.xpTicks))).toEqual({ 3: 24 });
        expect(sim.dropped).toBeGreaterThan(0);
        expect(sdk.state!.inventory.filter(i => i.name === 'Ring of life').length).toBe(25);
        expect(sdk.state!.dialog.isOpen).toBe(false);
    });

    test('two clicks a label keep the cadence at 3', async () => {
        const sdk = new Fake(state({ inventory: [...kit(), ...rings(5, { sapphire: 12 })] }));
        server(sdk);
        const r = await drive(sdk, enchantHeld(sdk as never, { untilLevel: 99, clicksPerTick: 2 }), 80);
        expect(r.casts).toBe(12);
        expect(histogram(gapsOf(r.xpTicks))).toEqual({ 3: 11 });
    });

    test('stops at the goal level and fails on rings the level cannot enchant', async () => {
        const sdk = new Fake(state({ inventory: [...kit(), ...rings(5, { sapphire: 12, emerald: 8 })] }));
        server(sdk);
        const r = await drive(sdk, enchantHeld(sdk as never, { untilLevel: 20 }), 80);
        expect(r.ok).toBe(true);
        expect(magicLevel(sdk.state)).toBe(20);
        expect(r.casts).toBeLessThan(12);

        const stuck = new Fake(state({ inventory: [...kit(), ...rings(5, { ruby: 2 })] }));
        server(stuck);
        const s = await drive(stuck, enchantHeld(stuck as never, { untilLevel: 59 }), 20);
        expect(s.ok).toBe(false);
        expect(s.reason).toContain('2 rings held that Magic 7 cannot enchant');
    });

    test('the full step: three ring loads from a giver each, every trade click sent two labels after the last cast', async () => {
        const reports: MagicReport[] = [];
        const sdk = new Fake(state({ equipment: [], inventory: [...kit(), item(5, 'Staff of water')] }));
        const sim = server(sdk);
        const [, s04] = steps({ loads: ROUTE_LOADS.map((rings, i) => ({ rings, giver: H8X[i]! })), onReport: r => reports.push(r) });
        expect(s04!.preconditions(sdk.state!, {})).toBe(true);
        await drive(sdk, s04!.run({ sdk } as never), 600);
        await drive(sdk, Promise.resolve(), 2);
        const s = sdk.state!;
        expect(s04!.postconditions(s, {})).toBe(true);
        expect(magicLevel(s)).toBe(59);
        expect(s.equipment.map(e => e.name)).toEqual(['Staff of water']);

        const rep = reports.find(r => r.step === 'S04') as Extract<MagicReport, { step: 'S04' }>;
        expect(rep.casts).toBe(60);
        expect(rep.gaps).toEqual({ 3: 57 });
        expect(rep.trades.map(t => [t.load, t.giver, t.ok, t.gave, t.received])).toEqual([
            [1, 'cairn_h81', true, 0, 20],
            [2, 'cairn_h82', true, 20, 20],
            [3, 'cairn_h83', true, 20, 20],
        ]);
        expect(sim.partners).toEqual(H8X);
        // What went back: load 1's 12 recoil + 8 dueling to h82, load 2's to h83; load 3's stay.
        const names = (xs: TradeItem[]) => Object.fromEntries(xs.map(x => [x.name, x.count]));
        expect(sim.received.map(names)).toEqual([{}, { 'Ring of recoil': 12, 'Ring of dueling(8)': 8 }, { 'Ring of dueling(8)': 19, 'Ring of forging': 1 }]);
        // Each later trade's first click goes out on the last cast + 2 and lands as the delay clears.
        // No trade follows the 60th cast.
        const firstClicks = sim.tradeClicks.filter(t => t > sim.lands[0]!);
        expect(firstClicks).toEqual([sim.lands[19]! + 2, sim.lands[39]! + 2]);
        expect(sim.tradeDropped).toBe(0);
        // Turnaround on the cast clock: the trade, plus the first cast a label after the rings arrive.
        expect(rep.turnarounds.length).toBe(2);
        for (const t of rep.turnarounds) expect(t).toBeLessThanOrEqual(12);
        // Load 3's 15 forging and 5 life stay for S05; no unenchanted ring is left.
        const held = names(s.inventory.filter(i => i.name.startsWith('Ring')) as unknown as TradeItem[]);
        expect(Object.values(held).length).toBe(2);
        expect(s.inventory.filter(i => i.name === 'Ring of forging').reduce((a, i) => a + i.count, 0)).toBe(15);
        expect(s.inventory.filter(i => i.name === 'Ring of life').reduce((a, i) => a + i.count, 0)).toBe(5);
        expect(s.inventory.some(i => tierOf(i.name))).toBe(false);
    });

    test('resumes mid-way: a held half load is cast first, then the next load is asked for', async () => {
        const xp = AT7 + (12 * 17.5 + 8 * 37 + 10 * 37) * XP_RATE;
        const inv = [...kit(), ...rings(5, { emerald: 9, ruby: 1 }), ...Array.from({ length: 10 }, (_, i) => item(15 + i, 'Ring of dueling(8)'))];
        const sdk = new Fake(state({ inventory: inv }, xp));
        const sim = server(sdk, ROUTE_LOADS);
        sim.loadIdx = 2;
        const o = resolveOptions({ giver: GIVER });
        expect(s04Status(sdk.state!, o).delivered).toBe(2);
        const [, s04] = steps({ giver: GIVER });
        expect(s04!.inProgress!({ state: sdk.state!, probed: {} }, {})).toBe(true);
        await drive(sdk, s04!.run({ sdk } as never), 300);
        expect(magicLevel(sdk.state)).toBe(59);
        // Load 3's swap takes the 20 enchanted (the 10 held and the 10 cast first); its own stay.
        expect(sim.received.length).toBe(1);
        expect(sim.received[0]!.reduce((a, i) => a + i.count, 0)).toBe(20);
    });
});

describe('noted rings are refused, never cast or counted (rs/626, attempt 2)', () => {
    const o = resolveOptions({ giver: GIVER });
    // Attempt 2 at tick 883: h63's load came noted (Emerald ring @1640 x19) beside one unnoted ruby, Magic 37, 13,300 xp.
    const noted = (id: number, name: string, count: number, slot: number) => ({ slot, id, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
    const attempt2 = () => state({ inventory: [...kit(), noted(1640, 'Emerald ring', 19, 5), item(6, 'Ruby ring')] }, 13_300);

    test("heldRings and the counts take the unnoted id only: attempt 2's pack holds one castable ring", () => {
        const s = attempt2();
        expect(heldRings(s).map(r => [r.id, r.tier])).toEqual([[1641, 'ruby']]);
        expect(heldRingCounts(s)).toEqual({ ruby: 1 });
        expect(notedRings(s).map(i => [i.id, i.count])).toEqual([[1640, 19]]);
    });

    test("s04Pre refuses attempt 2's exact inventory with the reason, before any cast", () => {
        expect(s04Pre(attempt2(), o)).toBe('noted rings held: Emerald ring @1640 x19 (unnoted is @1639); S04 enchants unnoted rings only, so the ring givers must stage them unnoted');
        expect(notedRingRefusal(state())).toBeNull();
    });

    test('a noted stack is no delivered load: the resume count reads the unnoted rings only', () => {
        const unnoted = state({ inventory: [...kit(), ...rings(5, { emerald: 19 })] }, 13_300);
        const withNoted = state({ inventory: [...kit(), noted(1640, 'Emerald ring', 19, 5)] }, 13_300);
        expect(heldRingCounts(withNoted)).toEqual({});
        expect(s04Status(withNoted, o).held).toEqual({});
        expect(s04Status(unnoted, o).held).toEqual({ emerald: 19 });
    });

    test('the S04 trade wants each tier by its unnoted obj id, so a noted offer never satisfies it', () => {
        expect(wantFor({ sapphire: 12, emerald: 8 })).toEqual([{ item: 1637, amount: 12 }, { item: 1639, amount: 8 }]);
        for (const t of ['sapphire', 'emerald', 'ruby', 'diamond'] as const) expect(ENCHANTS[t].ringId).toBe(IDS[ENCHANTS[t].ring]!);
    });
});

describe("S04's staff of water wield is confirmed (rs/627)", () => {
    const held = () => state({ equipment: [], inventory: [...kit(), item(5, 'Staff of water')] });
    const wields = (sdk: FakeSdk) => sdk.sent.filter(a => a.method === 'sendUseItem');
    /** The server equips the staff on the tick after a wield click, except the clicks listed as dropped (1-based). */
    const server = (sdk: FakeSdk, dropped: number[]) => {
        let n = 0;
        sdk.onSend = (a: SentAction, f: FakeSdk) => {
            if (a.method !== 'sendUseItem' || dropped.includes(++n)) return;
            queueMicrotask(() => f.tick(s => ({ equipment: [item(3, 'Staff of water')], inventory: s.inventory.filter(i => i.name !== 'Staff of water') })));
        };
    };

    test('a dropped first click is re-sent after the quiet ticks, and the wield is confirmed on the tick it shows worn', async () => {
        const sdk = new Fake(held());
        server(sdk, [1]);
        const r = await drive(sdk, wieldStaff(sdk), 40);
        expect(r).toEqual({ ok: true, tick: sdk.state!.tick, sends: 2 });
        expect(wields(sdk).map(a => a.args)).toEqual([[5, 2], [5, 2]]);
        // The quiet ticks after the dropped click, then the re-sent click's round trip.
        expect(r.ok ? r.tick - 100 : -1).toBeLessThanOrEqual(WIELD_WAIT_TICKS + 2);
    });

    test('the first click landing: one send', async () => {
        const sdk = new Fake(held());
        server(sdk, []);
        expect(await drive(sdk, wieldStaff(sdk), 40)).toMatchObject({ ok: true, sends: 1 });
    });

    test('already worn: no click; every click dropped: S04 refuses after the bound with the reason; no staff: refused', async () => {
        const worn = new Fake(state());
        expect(await drive(worn, wieldStaff(worn), 5)).toEqual({ ok: true, tick: 100, sends: 0 });
        expect(wields(worn)).toEqual([]);
        const deaf = new Fake(held());
        server(deaf, [1, 2, 3, 4]);
        expect(await drive(deaf, wieldStaff(deaf), 40)).toEqual({ ok: false, sends: WIELD_SENDS, reason: `staff of water not worn after ${WIELD_SENDS} wield clicks, ${WIELD_WAIT_TICKS} observed ticks each` });
        expect(wields(deaf)).toHaveLength(WIELD_SENDS);
        const none = new Fake(state({ equipment: [] }));
        expect(await drive(none, wieldStaff(none), 5)).toEqual({ ok: false, sends: 0, reason: 'no staff of water held or worn' });
    });
});
