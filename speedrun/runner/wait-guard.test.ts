import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { BotWorldState, InventoryItem, PlayerState } from '../../sdk/types';
import { muleDelivery } from '../helpers/mule-itinerary';
import { baseState, drive, FakeSdk, flush } from '../lib/fake-sdk';
import { TickLog } from '../lib/ticks';
import { waitUntil } from '../lib/wait';
import { loginUpkeep, LOGIN_STRETCH } from '../run';
import { muleScope, openGuarded } from './chain';
import { CueKeeper } from './cue-keeper';
import { DEATH_STEP, deathRow, diedResult, EXIT_DIED, type Death } from './death';
import { DeliveryOwner, READY_MAX_TICKS } from './delivery-owner';
import type { RunnerSession, StepContext } from './step';
import { CURE_RESEND, enteringEnds, guardWait, type Cure } from './wait-guard';

const GRAND_TREE_DOOR = { worldX: 2465, worldZ: 3489 };
const player = (p: Partial<PlayerState> = {}): PlayerState =>
    ({ name: 'scored', ...GRAND_TREE_DOOR, x: 0, z: 0, level: 0, hp: 42, maxHp: 42, isDead: false, lifeId: 1, respawnCount: 0, ...p }) as PlayerState;
const shark = (slot: number): InventoryItem => ({ slot, id: 385, name: 'Shark', count: 1, optionsWithIndex: [{ text: 'Eat', opIndex: 1 }] }) as unknown as InventoryItem;
const potion = (slot: number, doses: number, name = 'Superantipoison'): InventoryItem =>
    ({ slot, id: 2440 + doses, name: `${name}(${doses})`, count: 1, optionsWithIndex: [{ text: 'Drink', opIndex: 1 }] }) as unknown as InventoryItem;
const state = (more: Partial<BotWorldState> = {}, p: Partial<PlayerState> = {}) => baseState({ tick: 1000, player: player(p), ...more });

function ctxFor(sdk: FakeSdk): StepContext<unknown> & { session: RunnerSession & { died?: Death } } {
    const session = { sdk, bot: {}, name: 'scored', sessionId: 1 } as unknown as RunnerSession & { died?: Death };
    return { session, sdk: session.sdk, bot: session.bot, c: {}, log: TickLog.memory('wait-guard') };
}

/** A cure that reads a test flag: poisoned until a drink lands, which turns the potion's dose down a step. */
function flagCure(sdk: FakeSdk): Cure & { poison: boolean; noted: number[] } {
    const c = {
        poison: true,
        noted: [] as number[],
        poisoned: () => c.poison,
        cureDose: (s: BotWorldState) => s.inventory.find(i => /antipoison\(\d\)$/i.test(i.name)) ?? null,
        noteAntipoison: (t: number) => void c.noted.push(t),
    };
    void sdk;
    return c;
}

/** The server's side of an eat (hp up 20, the shark gone) and a drink (a dose down; `onDrink`), a tick after the click; `drop(n)` drops the n-th use. */
function serve(sdk: FakeSdk, o: { onDrink?: () => void; drop?: (n: number) => boolean } = {}): { uses: Array<{ slot: number; tick: number }> } {
    const uses: Array<{ slot: number; tick: number }> = [];
    sdk.onSend = a => {
        if (a.method !== 'sendUseItem') return;
        const slot = a.args[0] as number;
        uses.push({ slot, tick: sdk.state!.tick });
        if (o.drop?.(uses.length)) return;
        setTimeout(() => sdk.tick(s => {
            const it = s.inventory.find(i => i.slot === slot);
            if (!it) return {};
            if (/^shark$/i.test(it.name)) return { inventory: s.inventory.filter(i => i !== it), player: { ...s.player!, hp: Math.min(s.player!.maxHp, s.player!.hp + 20) } };
            const m = /^(.*)\((\d)\)$/.exec(it.name)!;
            o.onDrink?.();
            const left = Number(m[2]) - 1;
            return { inventory: s.inventory.map(i => (i === it ? (left ? { ...it, name: `${m[1]}(${left})` } : { ...it, name: 'Vial', optionsWithIndex: [] }) : i)) };
        }), 0);
    };
    return { uses };
}

const never = (sdk: FakeSdk, ticks: number) => () => waitUntil(sdk, () => false, { maxTicks: ticks });

describe("SCORED's helper waits run under a DeathWatch (rs/761 (f))", () => {
    test("a readiness wait that sees SCORED die ends at once with the death, which run.ts writes as the (death) row and ends EXIT_DIED", async () => {
        const dir = mkdtempSync(join(tmpdir(), 'wait-guard-'));
        // H12's carrier never reports ready (h55 served its row and will not come again).
        const owner = new DeliveryOwner(dir, 'a5-20261024', 'Scored Name', [{ row: 'H12', account: 'h55', at: muleDelivery('H12').at }]);
        const keeper = new CueKeeper(dir, 'Scored Name', owner);
        const sdk = new FakeSdk(state({}, { hp: 4 }));
        const off = keeper.attach(sdk);
        const ctx = ctxFor(sdk);
        const t0 = sdk.state!.tick;
        const rejected = openGuarded(muleScope('H12'), ctx, keeper, { fresh: true }).then(() => null, (e: Error) => e);
        // The poison takes the last hitpoints on the 6th tick: hp 0, dead.
        const e = await drive(sdk, rejected, 40, s => (s.tick - t0 >= 5 ? { player: { ...s.player!, hp: 0, isDead: true } } : {}));
        off();
        expect(e?.message).toStartWith('SCORED died waiting for the H12/mule cue:');
        // Long before READY_MAX_TICKS: the death ends the wait, not its bound.
        expect(sdk.state!.tick - t0).toBeLessThan(10);
        expect(READY_MAX_TICKS).toBe(600);
        expect(ctx.session.died?.signs).toContain('dead');
        const row = deathRow(ctx.log, 'scored', 1, ctx.session.died!);
        expect(row.step).toBe(DEATH_STEP);
        expect(diedResult(row, { outcome: 'FAILED: S15:A-narnode', code: 1, paused: null }).code).toBe(EXIT_DIED);
    });

    test('a wait that ends on its own returns its result, and a throw is its own', async () => {
        const sdk = new FakeSdk(state());
        const ctx = ctxFor(sdk);
        expect(await guardWait(ctx, 'waiting', async () => 7)).toBe(7);
        await expect(guardWait(ctx, 'waiting', async () => { throw new Error('carrier h55 was not ready within 600 ticks'); })).rejects.toThrow('not ready within 600');
        expect(ctx.session.died).toBeUndefined();
    });
});

describe("the wait upkeep: the legs' eat rule and the shared antipoison, held while a trade is open (rs/761 (f))", () => {
    test('a poisoned wait drinks once: the dose noted in the tick it is sent, and nothing more once cured', async () => {
        const sdk = new FakeSdk(state({ inventory: [potion(0, 4)] }, { hp: 30 }));
        const cure = flagCure(sdk);
        const served = serve(sdk, { onDrink: () => void (cure.poison = false) });
        await drive(sdk, guardWait(ctxFor(sdk), 'waiting', never(sdk, 60), { cure }));
        expect(served.uses).toEqual([{ slot: 0, tick: 1000 }]);
        expect(cure.noted).toEqual([1000]);
        expect(sdk.state!.inventory[0]!.name).toBe('Superantipoison(3)');
    });

    test(`a drink that does not land (the dose still held as clicked) is sent again after ${CURE_RESEND} ticks`, async () => {
        const sdk = new FakeSdk(state({ inventory: [potion(0, 4)] }, { hp: 30 }));
        const cure = flagCure(sdk);
        const served = serve(sdk, { onDrink: () => void (cure.poison = false), drop: n => n === 1 });
        await drive(sdk, guardWait(ctxFor(sdk), 'waiting', never(sdk, 60), { cure }));
        expect(served.uses.map(u => u.tick)).toEqual([1000, 1000 + CURE_RESEND]);
    });

    test("hitpoints under the legs' threshold eat (travel's eatDue), once per landing", async () => {
        const sdk = new FakeSdk(state({ inventory: [shark(3), shark(4)] }, { hp: 11 }));
        const cure = { ...flagCure(sdk), poison: false };
        const served = serve(sdk);
        await drive(sdk, guardWait(ctxFor(sdk), 'waiting', never(sdk, 30), { cure }));
        expect(served.uses.map(u => u.slot)).toEqual([3]);
        expect(sdk.state!.player!.hp).toBe(31);
    });

    test('poisoned under the threshold: the eat first, the drink on a later frame', async () => {
        const sdk = new FakeSdk(state({ inventory: [shark(0), potion(1, 4)] }, { hp: 11 }));
        const cure = flagCure(sdk);
        const served = serve(sdk, { onDrink: () => void (cure.poison = false) });
        await drive(sdk, guardWait(ctxFor(sdk), 'waiting', never(sdk, 30), { cure }));
        expect(served.uses.map(u => u.slot)).toEqual([0, 1]);
        expect(served.uses[1]!.tick).toBeGreaterThan(served.uses[0]!.tick);
    });

    test('a trade open holds both the eat and the drink; they go once it closes', async () => {
        const trade = { isOpen: true, screen: 'offer' as const, partner: 'h55', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false };
        const sdk = new FakeSdk(state({ inventory: [shark(0), potion(1, 4)], trade }, { hp: 11 }));
        const cure = flagCure(sdk);
        const served = serve(sdk, { onDrink: () => void (cure.poison = false) });
        const p = guardWait(ctxFor(sdk), 'waiting', never(sdk, 40), { cure });
        for (let i = 0; i < 15; i++) {
            await flush();
            sdk.tick();
        }
        expect(served.uses).toEqual([]);
        const closed = sdk.tick({ trade: undefined }).tick;
        await drive(sdk, p);
        expect(served.uses.map(u => u.slot)).toEqual([0, 1]);
        expect(served.uses[0]!.tick).toBe(closed);
    });

    test('a guard inside a guard adds nothing: one upkeep, one eat', async () => {
        const sdk = new FakeSdk(state({ inventory: [shark(0), shark(1)] }, { hp: 11 }));
        const cure = { ...flagCure(sdk), poison: false };
        const served = serve(sdk);
        const ctx = ctxFor(sdk);
        await drive(sdk, guardWait(ctx, 'outer', () => guardWait(ctx, 'inner', never(sdk, 20), { cure }), { cure }));
        expect(served.uses.map(u => u.slot)).toEqual([0]);
    });
});

describe('run.ts: the upkeep from login to the first step (rs/761 (c))', () => {
    const steps = (body: (ctx: StepContext<unknown>) => void) => [{ name: 'S15:A-narnode', run: async (ctx: StepContext<unknown>) => body(ctx) }];

    test('a resume with SCORED poisoned at 11 HP eats and cures before the first step\'s body, each a note row; the step\'s entry ends it', async () => {
        // A poison hit on SCORED (^hitmark_poison) every 30 ticks, as poison.rs2 lands them.
        const t0 = 60_000;
        const hit = (tick: number) => ({ tick, type: 'damage_taken' as const, damage: 2, sourceType: 'npc' as const, sourceIndex: -1, targetType: 'player' as const, targetIndex: -1, hitmark: 2 });
        const sdk = new FakeSdk(state({ tick: t0, inventory: [shark(0), potion(1, 4)], combatEvents: [hit(t0 - 1)] }, { hp: 11 }));
        const served = serve(sdk);
        const ctx = ctxFor(sdk);
        const log = TickLog.memory('login');
        const upkeep = loginUpkeep(ctx.session as never, log, () => {});
        // The census, the gates and the resume walk: ~20 ticks with no step.
        for (let i = 0; i < 20; i++) {
            await flush();
            sdk.tick();
        }
        let atBody: number[] = [];
        const [first] = enteringEnds(steps(() => void (atBody = served.uses.map(u => u.slot))), upkeep);
        await first!.run(ctx);
        expect(atBody).toEqual([0, 1]);
        expect(sdk.state!.player!.hp).toBe(31);
        expect(sdk.state!.inventory.map(i => i.name)).toEqual(['Superantipoison(3)']);
        expect(log.rows.map(r => r.step)).toEqual([`(run) upkeep ${LOGIN_STRETCH}: eat`, `(run) upkeep ${LOGIN_STRETCH}: cure`]);
        // The step's own upkeep from here: the stretch sends nothing more, poisoned or hurt.
        sdk.tick(s => ({ inventory: [...s.inventory, shark(5)], player: { ...s.player!, hp: 5 }, combatEvents: [hit(s.tick)] }));
        for (let i = 0; i < 10; i++) {
            await flush();
            sdk.tick();
        }
        expect(served.uses.map(u => u.slot)).toEqual([0, 1]);
    });

    test('an open dialogue holds the stretch: nothing is sent until it closes', async () => {
        const page = { isOpen: true, options: [], isWaiting: false };
        const sdk = new FakeSdk(state({ tick: 70_000, inventory: [shark(0)], dialog: page }, { hp: 9 }));
        const served = serve(sdk);
        const ctx = ctxFor(sdk);
        const upkeep = loginUpkeep(ctx.session as never, TickLog.memory('login'), () => {});
        for (let i = 0; i < 8; i++) {
            await flush();
            sdk.tick();
        }
        expect(served.uses).toEqual([]);
        sdk.tick({ dialog: { isOpen: false, options: [], isWaiting: false } });
        await flush();
        expect(served.uses.map(u => u.slot)).toEqual([0]);
        upkeep.stop();
    });

    test('a death between login and the first step fails that step\'s entry with it before its body runs', async () => {
        const sdk = new FakeSdk(state({ tick: 80_000 }, { hp: 3 }));
        const ctx = ctxFor(sdk);
        const upkeep = loginUpkeep(ctx.session as never, TickLog.memory('login'), () => {});
        sdk.tick(s => ({ player: { ...s.player!, hp: 0, isDead: true } }));
        let ran = false;
        const [first] = enteringEnds(steps(() => void (ran = true)), upkeep);
        await expect(first!.run(ctx)).rejects.toThrow(`SCORED died ${LOGIN_STRETCH}:`);
        expect(ran).toBe(false);
        expect(ctx.session.died?.signs).toContain('dead');
    });
});
