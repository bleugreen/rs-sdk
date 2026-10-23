import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { BotWorldState, InventoryItem, PlayerState } from '../../sdk/types';
import { baseState, drive, FakeSdk } from '../lib/fake-sdk';
import { TickLog } from '../lib/ticks';
import { Observation, resolveResume } from '../runner/resume';
import { giveSpecs } from '../runner/handoff';
import type { RunnerSession, StepContext } from '../runner/step';
import { enchantedRingSpecs } from '../skills/magic';
import { MANIFEST, parseLedger, walk } from '../tools/slot-ledger';
import { ARRIVAL, DEAD_AT_EXIT, h4Landed, h4Plan, LETTERS, observed, quest, stepId, steps } from './dorics-quest';
import { freeSlots } from './segments';

// ------------------------------------------------------------------ SCORED's pack, from the ledger

const IDS: Record<string, number> = { 'Ring of forging': 2568, 'Ring of life': 2570, Clay: 434, 'Copper ore': 436, 'Iron ore': 440, 'Air talisman': 1438, 'Law rune': 563, 'Air rune': 556, Coins: 995 };
const STACKS = /rune$|^coins$|arrow$/i;
let nextSlot = 0;
const item = (name: string, count = 1): InventoryItem => ({ slot: nextSlot++, id: IDS[name] ?? 5000 + nextSlot, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
const skill = (name: string, level: number) => ({ name, level, baseLevel: level, experience: 0 });
const player = (x: number, z: number): PlayerState => ({ name: 'lab', x, z, worldX: x, worldZ: z, level: 0, hp: 10, maxHp: 10 }) as PlayerState;
const filler = (n: number) => Array.from({ length: n }, (_, i) => item(`Junk ${i}`));

/** S04's last load as SCORED holds it: 15 rings of forging and 5 of life (load 3, rs/285's plan). */
const RINGS = () => [...Array.from({ length: 15 }, () => item('Ring of forging')), ...Array.from({ length: 5 }, () => item('Ring of life'))];

/** A ledger `held` string ("air rune x18, enchanted ring x20") as inventory items, the rings as load 3's. */
function packFrom(held: string): InventoryItem[] {
    nextSlot = 0;
    if (held.trim() === '-') return [];
    const out: InventoryItem[] = [];
    for (const part of held.split(', ')) {
        const [, name, n] = /^(.+) x(\d+)$/.exec(part.trim())!;
        if (name === 'enchanted ring') {
            out.push(...RINGS());
            continue;
        }
        const game = name!.charAt(0).toUpperCase() + name!.slice(1);
        if (STACKS.test(game)) out.push(item(game, Number(n)));
        else for (let k = 0; k < Number(n); k++) out.push(item(game));
    }
    return out;
}

const ledgerHeld = (markdown: string, row: string, offset = 0) => {
    const entries = walk(parseLedger(markdown).rows);
    const i = entries.findIndex(e => e.row.row === row);
    return entries[i + offset]!;
};
const fixtureFile = (name: string) => join(import.meta.dir, '../tools/fixtures/slot-ledger', `${name}.md`);

/** SCORED on the arrival tile with `inventory`, Doric's Quest at `tab`. */
function arrival(inventory: InventoryItem[], tab?: 'started' | 'complete', over: Partial<BotWorldState> = {}): BotWorldState {
    return baseState({
        tick: 100,
        quests: (tab ? { [quest]: tab } : {}) as BotWorldState['quests'],
        skills: [skill('Magic', 59), skill('Mining', tab === 'complete' ? 49 : 1), skill('Firemaking', 99)],
        player: player(ARRIVAL.x, ARRIVAL.z),
        inventory,
        ...over,
    });
}

const MANIFEST_MD = readFileSync(MANIFEST, 'utf8');
/** The route at Doric's: after T04-05 (the rings still held) and after H4 (the trade landed). */
const beforeH4 = () => packFrom(ledgerHeld(MANIFEST_MD, 'T04-05').held);
const afterH4 = () => packFrom(ledgerHeld(MANIFEST_MD, 'H4').held);

const list = steps();
const letterOf = (name: string) => name.split(':')[1]!.split('-')[0]!;
const byLetter = (l: string) => list.find(s => letterOf(s.name) === l)!;

// ------------------------------------------------------------------ tests

describe('segment table', () => {
    test('S05: the H4 swap, the start, the hand-in; every one logout-safe with a durable mark', () => {
        expect(stepId).toBe('S05');
        expect(quest).toBe('doric');
        expect(list.map(s => s.name)).toEqual(['S05:A-h4-swap', 'S05:B-doric-start', 'S05:C-doric-hand-in']);
        expect(list.map(s => letterOf(s.name))).toEqual([...LETTERS]);
        expect(list.every(s => s.logoutSafe && s.done)).toBe(true);
        expect(steps({ dialogue: 'fixed' }).map(s => s.name)).toEqual(list.map(s => s.name));
    });
});

describe('H4 from the inventory ledger', () => {
    test("the row's items in; S04's rings out, one give per item id, as magic.ts's enchantedRingSpecs", () => {
        const s = arrival(beforeH4());
        const plan = h4Plan(s);
        expect(plan.receive.map(r => [r.name, r.count])).toEqual([['clay', 6], ['copper ore', 4], ['iron ore', 2], ['air talisman', 1], ['law rune', 2], ['air rune', 6]]);
        expect(plan.placeholders).toEqual([]);
        expect(plan.give).toHaveLength(1);
        expect(plan.give[0]).toMatchObject({ name: 'enchanted ring', ids: [2568, 2570], count: 'all' });
        expect(giveSpecs(s, plan)).toEqual(enchantedRingSpecs(s).map(g => ({ ...g, n: 'all' })));
    });

    test('no rings held: a plain delivery', () => {
        const s = arrival(beforeH4().filter(i => !/^Ring of/.test(i.name)));
        expect(h4Plan(s).give).toEqual([]);
    });

    test('after the trade: landed (the items in, no ring left)', () => {
        expect(h4Landed(arrival(beforeH4()))).toBe(false);
        expect(h4Landed(arrival(afterH4()))).toBe(true);
    });
});

describe("A: H4's free slots, refused up front, agreeing with the slot ledger", () => {
    const pre = (s: BotWorldState, ledger?: string) => steps(ledger ? { ledger } : {})[0]!.preconditions(s, {});

    test('the route as the ledger walks it: the rings free their 20 slots, H4 fits', () => {
        const s = arrival(beforeH4());
        // The pack builder reproduces the ledger: its H4 free (after the swap outs) is ours plus the rings.
        expect(freeSlots(s) + 20).toBe(ledgerHeld(MANIFEST_MD, 'H4').free);
        expect(pre(s)).toBe(true);
    });

    test("the need is the ledger's: 14 slots (13 unstackables and the new law stack; the air merges)", () => {
        // Without the rings and with 14 other items, 13 free: refused with the shortfall and the row named.
        const s = arrival([item('Air rune', 18), ...filler(14)]);
        const r = pre(s) as string;
        expect(r).toMatch(/H4: 13 free slots, 0 freed by what it gives: the trade adds 14, 1 short/);
        expect(r).toMatch(/inventory ledger, row H4 line \d+\); refused before the trade/);
        expect(pre(arrival([item('Air rune', 18), ...filler(13)]))).toBe(true);
        expect(ledgerHeld(MANIFEST_MD, 'H4').need).toBe(14);
    });

    test("route-original (rs/285): H4 refused, 22 free against 23", () => {
        const md = readFileSync(fixtureFile('route-original'), 'utf8');
        const before = ledgerHeld(md, 'H4', -1);
        const s = arrival(packFrom(before.held));
        expect(freeSlots(s) + 20).toBe(ledgerHeld(md, 'H4').free);
        expect(pre(s, fixtureFile('route-original'))).toMatch(/1 short/);
    });

    test("route-h4-rule (main's 23:31 ruling): the body and mind runes dropped, H4 fits with 1 spare", () => {
        const md = readFileSync(fixtureFile('route-h4-rule'), 'utf8');
        const s = arrival(packFrom(ledgerHeld(md, 'H4', -1).held));
        expect(freeSlots(s) + 20).toBe(24);
        expect(pre(s, fixtureFile('route-h4-rule'))).toBe(true);
        // One more item uses the spare; a second no longer fits.
        s.inventory.push(item('Tinderbox'));
        expect(pre(s, fixtureFile('route-h4-rule'))).toBe(true);
        s.inventory.push(item('Bucket'));
        expect(pre(s, fixtureFile('route-h4-rule'))).toMatch(/the trade adds 23, 1 short/);
    });

    test('refused away from Doric, and once the quest is complete', () => {
        expect(pre(arrival(beforeH4(), undefined, { player: player(2965, 3378) }))).toMatch(/Doric's house/);
        expect(pre(arrival(afterH4(), 'complete'))).toMatch(/already complete/);
    });

    test('a landed H4 needs no slots and no giver; an undelivered one with no kitFrom fails the run', async () => {
        expect(pre(arrival(afterH4()))).toBe(true);
        const sdk = new FakeSdk(arrival(beforeH4()));
        const ctx = { session: { sdk, bot: {}, name: 'lab', sessionId: 0 }, sdk, bot: {}, c: {}, log: TickLog.memory('t') } as unknown as StepContext<unknown>;
        await expect(drive(sdk, list[0]!.run(ctx) as Promise<unknown>, 5)).rejects.toThrow(/S05:A: H4 not delivered .* and no kitFrom/);
        expect(sdk.sent).toEqual([]);
    });

    test("H4 placed as run.ts's own hand-off step: the kit held and the rings gone, A sends no trade, even with a giver in view, and only checks", async () => {
        const giver = 'h4giver';
        const s = arrival(afterH4(), undefined, { nearbyPlayers: [{ name: giver, x: ARRIVAL.x + 1, z: ARRIVAL.z } as never] });
        expect(s.inventory.some(i => /^Ring of/.test(i.name))).toBe(false);
        expect(h4Landed(s)).toBe(true);
        const a = steps({ kitFrom: giver })[0]!;
        expect(a.preconditions!(s, undefined as never)).toBe(true);
        const sdk = new FakeSdk(s);
        const ctx = { session: { sdk, bot: {}, name: 'lab', sessionId: 0 }, sdk, bot: {}, c: {}, log: TickLog.memory('t') } as unknown as StepContext<unknown>;
        await drive(sdk, a.run(ctx) as Promise<unknown>, 5);
        expect(sdk.sent).toEqual([]);
        expect(a.postconditions!(sdk.getState()!, undefined as never)).toBe(true);
        expect(a.done!(observed(sdk.getState()!), {})).toBe(true);
    });
});

describe('B and C: the stage and the hand-in items', () => {
    test('B at stage 0 needs H4 delivered; once started it passes through', () => {
        expect(byLetter('B').preconditions(arrival(beforeH4()), {})).toBe('H4 not delivered yet');
        expect(byLetter('B').preconditions(arrival(afterH4()), {})).toBe(true);
        expect(byLetter('B').preconditions(arrival(afterH4(), 'started'), {})).toBe(true);
    });
    test('C needs the started stage and every hand-in item', () => {
        expect(byLetter('C').preconditions(arrival(afterH4(), 'started'), {})).toBe(true);
        expect(byLetter('C').preconditions(arrival(afterH4()), {})).toMatch(/Doric's Quest/);
        const short = arrival(afterH4().filter(i => i.name !== 'Iron ore' || i.slot % 2), 'started');
        expect(byLetter('C').preconditions(short, {})).toMatch(/short 1 iron ore/);
    });
});

describe('done and the resume walk', () => {
    const walkFrom = async (s: BotWorldState) => resolveResume(list, new Observation(s), {});
    const complete = (coins: boolean) => arrival([item('Air rune', 24), item('Air talisman'), item('Law rune', 2), ...(coins ? [item('Coins', 180)] : [])], 'complete');

    test('a fresh arrival holding the rings starts A; after the trade, B; started, C', async () => {
        expect((await walkFrom(arrival(beforeH4()))).step).toBe('S05:A-h4-swap');
        expect((await walkFrom(arrival(afterH4()))).step).toBe('S05:B-doric-start');
        expect((await walkFrom(arrival(afterH4(), 'started'))).step).toBe('S05:C-doric-hand-in');
    });
    test('complete still holding the coins resumes C to drop them; without them it is finished', async () => {
        expect((await walkFrom(complete(true))).step).toBe('S05:C-doric-hand-in');
        expect((await walkFrom(complete(false))).mode).toBe('finished');
        expect(byLetter('A').done!(observed(complete(false)), {})).toBe(true);
    });
});

describe('C: the exit state and its drop', () => {
    test('the coins are dead at the exit; the talisman and the runes for T05-06 and T06-07 are not', () => {
        const deadName = (n: string) => DEAD_AT_EXIT.some(p => p.test(n));
        expect(deadName('Coins')).toBe(true);
        for (const n of ['Air talisman', 'Law rune', 'Air rune']) expect(deadName(n)).toBe(false);
    });
    test('a resumed C with the quest complete only drops the coins, and then passes', async () => {
        const s = arrival([item('Air rune', 24), item('Air talisman'), item('Law rune', 2), item('Coins', 180)], 'complete');
        const coinSlot = s.inventory.find(i => i.name === 'Coins')!.slot;
        const sdk = new FakeSdk(s);
        let dropped = false;
        sdk.onSend = a => { if (a.method === 'sendDropItem') dropped = true; };
        const session = { sdk, bot: {}, name: 'lab', sessionId: 0 } as unknown as RunnerSession;
        const ctx = { session, sdk, bot: session.bot, c: {}, log: TickLog.memory('t') } as unknown as StepContext<unknown>;
        await drive(sdk, byLetter('C').run(ctx) as Promise<unknown>, 20, st => (dropped ? { inventory: st.inventory.filter(i => i.slot !== coinSlot) } : {}));
        expect(sdk.sent.map(a => a.method)).toEqual(['sendDropItem']);
        expect(sdk.sent[0]!.args[0]).toBe(coinSlot);
        expect(byLetter('C').postconditions(sdk.getState()!, {})).toBe(true);
    });
    test('complete but holding the coins, or below Mining 49, fails the postcondition', () => {
        const post = (s: BotWorldState) => byLetter('C').postconditions(s, {});
        expect(post(arrival([item('Coins', 180)], 'complete'))).toBe('exit: still holding Coins');
        expect(post(arrival([], 'complete', { skills: [skill('Mining', 30)] }))).toMatch(/mining 30\/49/);
    });
});
