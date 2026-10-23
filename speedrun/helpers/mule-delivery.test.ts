import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BankItem, BotWorldState, InventoryItem, PlayerState, TradeState } from '../../sdk/types';
import { baseState, FakeSdk, flush, simulateWalking } from '../lib/fake-sdk';
import { MANIFEST } from '../tools/slot-ledger';
import { loadFixtureCatalog } from '../lab/mule-delivery-fixtures';
import { noteLink, objPack } from '../lib/obj-pack';
import { PASSAGES } from '../lib/passages';
import { CueWriter, writeTopUpAsk } from './altar-cue';
import { countById, deliveryGroup, isStackableName, muleOptions, planCarryGroup, role, type Package } from './mule';
import { muleFromLedger, muleRunOptions } from './mule-ledger';
import { cancelMulePreparation, deliverySession, heldFor, holdMule, muleReadyPath, prepareMule, readMuleReady, readyFor, type MuleHeldExpected, type MuleReadyExpected } from './mule-readiness';
import { memoryRoleState, type RoleContext } from './role';
import { CueGate } from './standalone';

const manifest = readFileSync(MANIFEST, 'utf8');
const catalog = loadFixtureCatalog(objPack());
const receiver = 'delivery_receiver';
const account = 'delivery_helper';
const runId = 'delivery-test';
const closed: TradeState = { isOpen: false, screen: null, partner: null, myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false };

function fixture(rows: string[], initialState: Record<string, unknown> = {}, configure?: (packages: Package[]) => void) {
    const dir = mkdtempSync(join(tmpdir(), 'mule-delivery-'));
    const ledger = muleFromLedger(manifest, { rows, onRequest: [] });
    const options = muleRunOptions(ledger, dir, { deliveryRun: runId, serve: receiver });
    configure?.(options.packages);
    const bank: BankItem[] = [];
    for (const p of options.packages) for (const item of p.items) {
        const id = item.id ?? 10000 + bank.length;
        const existing = bank.find(b => item.id === undefined ? b.name === item.item : b.id === id);
        const count = 'topUp' in item ? item.topUp.max : item.amount;
        if (existing) existing.count += count;
        else bank.push({ slot: bank.length, id, name: item.item ?? catalog.get(noteLink(id).item)!.name, count });
    }
    const first = options.packages[0]!;
    const start = first.bank!;
    const sdk = new FakeSdk(baseState({
        player: { worldX: start.x, worldZ: start.z, level: start.level, x: start.x, z: start.z, hp: 10, maxHp: 10, isDead: false } as PlayerState,
        bank: { isOpen: false, items: bank, noteMode: false }, trade: closed
    }));
    const state = memoryRoleState(initialState);
    const logs: { message: string; data?: Record<string, unknown> }[] = [];
    const bankVisits: { x: number; z: number }[] = [];
    let walkBlocked = false;
    const walk = simulateWalking(sdk, { speed: 32, blocked: () => walkBlocked });
    const tidy = (items: InventoryItem[]) => items.map((i, slot) => ({ ...i, slot }));
    const put = (items: InventoryItem[], id: number, name: string, count: number) => {
        if (isStackableName(name)) {
            const old = items.find(i => i.id === id);
            if (old) old.count += count;
            else items.push({ slot: items.length, id, name, count, optionsWithIndex: [] });
        } else for (let i = 0; i < count; i++) items.push({ slot: items.length, id, name, count: 1, optionsWithIndex: [] });
    };
    const completedOffers: TradeState['myOffer'][] = [];
    let incoming: InventoryItem[] = [];
    let next: Partial<BotWorldState> | null = null;
    let completion: Partial<BotWorldState> | null = null;
    let emptyConfirm: (() => void) | undefined;
    let unexplained: InventoryItem[] = [];
    const walkingSend = sdk.onSend;
    sdk.onSend = (a, f) => {
        walkingSend(a, f);
        if (a.method === 'sendBankDeposit') {
            const item = f.getInventory().find(i => i.slot === a.args[0])!;
            const n = f.getInventory().filter(i => i.id === item.id).reduce((sum, i) => sum + i.count, 0);
            const b = bank.find(b => b.id === item.id);
            if (b) b.count += n; else bank.push({ slot: bank.length, id: item.id, name: item.name, count: n });
            f.push({ inventory: f.getInventory().filter(i => i.id !== item.id) });
        } else if (a.method === 'sendTradeRequest') {
            next = { trade: { ...closed, isOpen: true, screen: 'offer', partner: receiver, theirOffer: incoming } };
        } else if (a.method === 'sendOfferItem') {
            const item = f.getInventory().find(i => i.slot === a.args[0])!;
            const n = Number(a.args[1]);
            const count = n === -1 ? f.getInventory().filter(i => i.id === item.id).reduce((sum, i) => sum + i.count, 0) : n;
            const myOffer = f.getTradeState().myOffer.map(i => ({ ...i }));
            const offered = myOffer.find(i => i.id === item.id);
            if (offered) offered.count += count;
            else myOffer.push({ ...item, count });
            f.push({ trade: { ...f.getTradeState(), myOffer } });
        } else if (a.method === 'sendAcceptTrade') {
            if (f.getTradeState().screen === 'offer') next = { trade: { ...f.getTradeState(), screen: 'confirm', partnerAccepted: true } };
            else {
                completedOffers.push(f.getTradeState().myOffer.map(i => ({ ...i })));
                const offered = new Map(f.getTradeState().myOffer.map(i => [i.id, i.count]));
                const remaining = f.getInventory().flatMap(i => {
                    const take = Math.min(i.count, offered.get(i.id) ?? 0);
                    offered.set(i.id, (offered.get(i.id) ?? 0) - take);
                    return take === i.count ? [] : [{ ...i, count: i.count - take }];
                });
                next = { inventory: tidy([...remaining, ...incoming, ...unexplained]), trade: closed };
                if (emptyConfirm) {
                    completion = { ...next, gameMessages: [{ type: 0, text: 'Accepted trade.', sender: '', tick: f.state!.tick, fromSelf: false }] };
                    next = { inventory: tidy(remaining), trade: { ...f.getTradeState(), myOffer: [], theirOffer: [] } };
                }
                incoming = [];
            }
        }
    };
    Object.assign(sdk, {
        waitForReady: async () => {}, waitForTicks: async () => {},
        sendWait: (ticks: number) => sdk.sendAction({ method: 'sendWait', args: [ticks] }),
        getChat: () => [], isBankOpen: () => sdk.state!.bank.isOpen, getBankItems: () => bank
    });
    let shortWithdrawal = false;
    const bot = {
        dismissBlockingUI: async () => {},
        declineTrade: async () => { sdk.push({ trade: closed }); },
        openBank: async () => {
            const p = sdk.state!.player!;
            bankVisits.push({ x: p.worldX, z: p.worldZ });
            sdk.push({ bank: { ...sdk.state!.bank, isOpen: true } });
            return { success: true, message: 'opened' };
        },
        closeBank: async () => { sdk.push({ bank: { ...sdk.state!.bank, isOpen: false } }); return { success: true }; },
        withdrawItem: async (b: BankItem, count: number) => {
            if (count > b.count) return { success: false, message: 'short' };
            b.count -= count;
            const inventory = [...sdk.getInventory()];
            put(inventory, b.id, b.name, shortWithdrawal ? Math.max(0, count - 1) : count);
            sdk.push({ inventory: tidy(inventory) });
            return { success: true, amountWithdrawn: count };
        }
    };
    let abort = new AbortController();
    const ctx = { sdk, bot, account, options, state, signal: abort.signal, reportBank: () => {},
        log: (message: string, data?: Record<string, unknown>) => logs.push({ message, data }) } as unknown as RoleContext;
    let running: Promise<unknown> | undefined;
    const pump = async (n = 1) => {
        for (let i = 0; i < n; i++) {
            await flush();
            const patch = next ?? {};
            next = null;
            if (completion && patch.trade?.screen === 'confirm' && patch.trade.myOffer.length === 0) {
                emptyConfirm?.();
                next = completion;
                completion = null;
                emptyConfirm = undefined;
            }
            sdk.tick(patch);
            await flush();
        }
    };
    const until = async (done: () => boolean, n = 600) => {
        for (let i = 0; i < n && !done(); i++) await pump();
        if (!done()) throw new Error('delivery did not settle: ' + JSON.stringify({ logs: logs.slice(-6), sent: sdk.sent.slice(-30), trade: sdk.getTradeState() }));
    };
    const expected = (p: Package): MuleReadyExpected => ({ runId, account, row: p.scope!.step, receiver, at: p.at as MuleReadyExpected['at'] });
    const prepare = (p: Package, attempt?: number) => {
        const e = expected(p);
        const ticket = prepareMule(options.cueDir, { ...e, ...(attempt ? { attempt } : {}) });
        return { ...e, preparationSeq: ticket.seq };
    };
    const hold = (p: Package, attempt?: number): MuleHeldExpected => {
        const e = expected(p);
        const ticket = holdMule(options.cueDir, { ...e, ...(attempt ? { attempt } : {}) });
        return { runId, account, row: e.row, receiver, preparationSeq: ticket.seq };
    };
    const ready = (e: MuleReadyExpected) => readyFor(readMuleReady(options.cueDir, account), e);
    const held = (e: MuleHeldExpected) => heldFor(readMuleReady(options.cueDir, account), e);
    return {
        sdk, bank, state, logs, bankVisits, options, walk, pump, until, prepare, hold, ready, held, expected, completedOffers,
        block: (blocked = true) => { walkBlocked = blocked; },
        shortWithdrawals: () => { shortWithdrawal = true; },
        emptyConfirmation: (onEmpty: () => void = () => {}) => { emptyConfirm = onEmpty; },
        corruptCompletion: () => { unexplained = [{ slot: 27, id: 99999, name: 'Unexplained item', count: 1, optionsWithIndex: [] }]; },
        start: () => { abort = new AbortController(); ctx.signal = abort.signal; running = role.run(ctx); },
        abort: () => abort.abort(),
        stop: async () => { abort.abort(); await pump(5); await running; },
        giveBack: (n: number) => { incoming = Array.from({ length: n }, (_, slot) => ({ slot, id: 2552, name: 'Ring of dueling(8)', count: 1, optionsWithIndex: [] })); },
        cue: (p: Package, session = deliverySession(runId, p.scope!.step)) => {
            sdk.push({ nearbyPlayers: [{ kind: 'player', index: 4, name: receiver, distance: 1, x: p.at!.x + 1, z: p.at!.z, combatLevel: 3 }] });
            const writer = new CueWriter(options.cueDir, receiver, p.scope!, session);
            writer.write({ beacons: [{ tick: sdk.state!.tick, ms: Date.now() }], turns: [] });
            return writer;
        }
    };
}

describe('a served hand-off keeps the stand until its cue stop', () => {
    const served = (f: ReturnType<typeof fixture>) => f.logs.filter(l => l.message === 'hand-off' && l.data?.success).length;
    const at = (f: ReturnType<typeof fixture>) => ({ x: f.sdk.state!.player!.worldX, z: f.sdk.state!.player!.worldZ, level: f.sdk.state!.player!.level });
    for (const rows of [['H20'], ['H18', 'H19', 'H20']]) {
        test(`${rows.join(' then ')}: a final stop a few ticks after the last trade never moves the helper; a plain stop still banks`, async () => {
            for (const final of [true, false]) {
                const f = fixture(rows);
                const packages = f.options.packages;
                let e = f.prepare(packages[0]!);
                f.start();
                try {
                    for (let i = 0; i < packages.length; i++) {
                        const p = packages[i]!;
                        const stand = { x: p.at!.x, z: p.at!.z, level: p.at!.level };
                        await f.until(() => f.ready(e));
                        const cue = f.cue(p);
                        await f.until(() => served(f) === i + 1);
                        const visits = f.bankVisits.length;
                        // The receiver's stop lands a few ticks after its trade; until then the helper waits on its stand.
                        await f.pump(4);
                        expect(at(f)).toEqual(stand);
                        expect(f.bankVisits).toHaveLength(visits);
                        const last = i === packages.length - 1;
                        cue.stop([{ tick: f.sdk.state!.tick, ms: Date.now() }], { final: last && final });
                        if (last && final) {
                            await f.pump(15);
                            expect(at(f)).toEqual(stand);
                            expect(f.bankVisits).toHaveLength(visits);
                            expect(f.logs.some(l => l.message === 'delivery final stop: service ends on the stand')).toBe(true);
                        } else if (last) {
                            await f.until(() => f.bankVisits.length > visits);
                            // Then nothing more until the launcher ends it: no re-serve of a served row, and no
                            // prepare, travel or trade request without a new prepare from the run.
                            await f.pump(30);
                            const settled = { at: at(f), sent: f.sdk.sent.length, visits: f.bankVisits.length };
                            await f.pump(90);
                            expect(at(f)).toEqual(settled.at);
                            expect(f.bankVisits).toHaveLength(settled.visits);
                            expect(f.sdk.sent.slice(settled.sent).filter(a => a.method !== 'sendWait')).toEqual([]);
                            expect(f.completedOffers).toHaveLength(packages.length);
                            expect(f.state.data['mule-delivery-served']).toHaveLength(packages.length);
                        } else {
                            e = f.prepare(packages[i + 1]!);
                        }
                    }
                } finally { await f.stop(); }
            }
            // Two simulated passes of up to three rows: past bun's 5 s default on a loaded host.
        }, 30_000);
    }
});

describe('actual generated mule delivery lifecycle', () => {
    test('H1 stages at its bank and reaches its exact tile before any serving cue', async () => {
        const f = fixture(['H1']);
        const p = f.options.packages[0]!;
        const e = f.prepare(p);
        f.start();
        try {
            await f.until(() => f.ready(e));
            expect(f.bankVisits[0]).toEqual({ x: p.bank!.x, z: p.bank!.z });
            expect(f.sdk.state!.player).toMatchObject({ worldX: p.at!.x, worldZ: p.at!.z, level: p.at!.level });
            expect(f.sdk.sent.some(a => a.method === 'sendTradeRequest')).toBe(false);
            expect(JSON.stringify(f.options)).not.toContain('"final":true');
        } finally { await f.stop(); }
    });

    test('generated H4 carries the full H4k kit and retains twenty rings without a second bank until H4k succeeds', async () => {
        const f = fixture(['H4', 'H4k']);
        const [h4, h4k] = f.options.packages as [Package, Package];
        expect(h4).toMatchObject({ carryNext: true, takeBackSlots: 20 });
        const plan = planCarryGroup(deliveryGroup(f.options.packages, h4), f.bank);
        expect(plan.peakSlots).toBe(23);
        const e = f.prepare(h4);
        f.start();
        try {
            await f.until(() => f.ready(e));
            expect(f.sdk.getInventory()).toHaveLength(18);
            expect(countById(f.sdk.getInventory())).toEqual(plan.inventory);
            f.giveBack(20);
            const cue = f.cue(h4);
            await f.until(() => f.logs.some(l => l.message === 'hand-off' && l.data?.success));
            cue.stop([{ tick: f.sdk.state!.tick, ms: Date.now() }]);
            const next = f.prepare(h4k);
            await f.until(() => f.ready(next));
            expect(countById(f.completedOffers[0]!)).toEqual(plan.held.get(h4)!);
            expect(f.sdk.getInventory().filter(i => i.id === 2552)).toHaveLength(20);
            expect(f.sdk.getInventory()).toHaveLength(23);
            expect(f.bankVisits).toHaveLength(1);
            expect(f.bank.some(b => b.id === 2552)).toBe(false);
            // A fresh prepare for the already pending member must not invalidate its reservation.
            const again = f.prepare(h4k);
            await f.until(() => f.ready(again));
            expect(f.bankVisits).toHaveLength(1);
            // The receiver closes each step's cue after its trade; only then does the helper leave its stand.
            const lastCue = f.cue(h4k);
            await f.until(() => f.completedOffers.length === 2);
            lastCue.stop([{ tick: f.sdk.state!.tick, ms: Date.now() }]);
            await f.until(() => f.bank.find(b => b.id === 2552)?.count === 20);
            expect(countById(f.completedOffers[1]!)).toEqual(plan.held.get(h4k)!);
            expect(f.completedOffers[1]!.some(i => i.id === 2552)).toBe(false);
            expect(f.bankVisits).toHaveLength(2);
            expect(f.state.data['mule-delivery-served']).toMatchObject([
                { session: deliverySession(runId, 'H4') }, { session: deliverySession(runId, 'H4k') }
            ]);
        } finally { await f.stop(); }
    });

    test('empty confirmation packets and a late cue stop preserve the proved carry trade', async () => {
        for (const stopCue of [false, true]) {
            const f = fixture(['H4', 'H4k']);
            const [h4, h4k] = f.options.packages as [Package, Package];
            f.prepare(h4);
            f.start();
            try {
                await f.until(() => f.ready(f.expected(h4)));
                f.giveBack(20);
                const cue = f.cue(h4);
                f.emptyConfirmation(() => { if (stopCue) cue.stop([{ tick: f.sdk.state!.tick, ms: Date.now() }]); });
                await f.until(() => f.logs.some(l => l.message === 'hand-off' && l.data?.success));
                const next = f.prepare(h4k);
                await f.until(() => f.ready(next));
                expect(f.sdk.getInventory()).toHaveLength(23);
                expect(f.sdk.getInventory().filter(i => i.id === 2552)).toHaveLength(20);
                expect(f.bankVisits).toHaveLength(1);
                expect(f.state.data['mule-delivery-attempt']).toBeUndefined();
                expect(f.logs.some(l => l.message.includes('reconciliation'))).toBe(false);
                expect(f.completedOffers).toHaveLength(1);
            } finally { await f.stop(); }
        }
    });

    test('actual generated H12 offers nine of fifteen sharks and all fixed lines, then banks six leftovers', async () => {
        const f = fixture(['H12']);
        simulatePassages(f);
        const h12 = f.options.packages[0]!;
        const e = f.prepare(h12);
        const fixed = new Map(f.bank.filter(b => b.name.toLowerCase() !== 'shark').map(b => [b.id, b.count]));
        expect(h12.items.some(i => i.id !== undefined)).toBe(true);
        expect(h12.items.find(i => i.id === 385)).toMatchObject({ topUp: { max: 15 } });
        f.start();
        try {
            await f.until(() => f.ready(e));
            expect(f.sdk.getInventory()).toHaveLength(27);
            writeTopUpAsk(f.options.cueDir, [{ item: '^shark$', count: 9 }], Date.now(), h12.scope);
            const cue = f.cue(h12);
            await f.until(() => f.completedOffers.length === 1);
            cue.stop([{ tick: f.sdk.state!.tick, ms: Date.now() }]);
            await f.until(() => f.bank.find(b => b.name.toLowerCase() === 'shark')?.count === 6);
            const offered = f.completedOffers[0]!;
            expect(offered.find(i => i.name.toLowerCase() === 'shark')?.count).toBe(9);
            expect(countById(offered.filter(i => i.name.toLowerCase() !== 'shark'))).toEqual(fixed);
            expect(f.sdk.getInventory()).toHaveLength(0);
            expect(f.bankVisits).toHaveLength(2);
            expect(f.state.data['mule-delivery-served']).toMatchObject([{ session: deliverySession(runId, 'H12') }]);
        } finally { await f.stop(); }
    });

    test('wrong-session cue never serves; nonfinal stop does not complete an untraded row', async () => {
        const f = fixture(['H1', 'H4']);
        const p = f.options.packages[0]!;
        const e = f.prepare(p);
        f.start();
        try {
            await f.until(() => f.ready(e));
            f.cue(p, 'old-run:H1');
            await f.pump(8);
            expect(f.sdk.sent.some(a => a.method === 'sendTradeRequest')).toBe(false);
            const cue = f.cue(p);
            cue.stop([{ tick: f.sdk.state!.tick, ms: Date.now() }]);
            await f.pump(8);
            expect(f.state.data['mule-delivery-served']).toBeUndefined();
            expect(f.ready(e)).toBe(true);
        } finally { await f.stop(); }
    });

    test('overlapping and distant reciprocal requests never move or request from the helper', async () => {
        const f = fixture(['H1']);
        const p = f.options.packages[0]!;
        f.prepare(p);
        f.start();
        try {
            await f.until(() => f.ready(f.expected(p)));
            const beforeWalks = f.walk.clicks.length;
            f.cue(p);
            for (const [i, [dx, dz]] of [[0, 0], [1, 1], [12, 0]].entries()) {
                const message = { type: 4, text: 'wishes to trade with you.', sender: receiver, tick: f.sdk.state!.tick, observationId: 100 + i, fromSelf: false };
                Object.assign(f.sdk, { getChat: () => [message] });
                f.sdk.push({ nearbyPlayers: [{ kind: 'player', index: 4, name: receiver, distance: Math.max(dx!, dz!), x: p.at!.x + dx!, z: p.at!.z + dz!, combatLevel: 3 }] });
                await f.pump(8);
                expect(f.sdk.sent.some(a => a.method === 'sendTradeRequest')).toBe(false);
                expect(f.walk.clicks).toHaveLength(beforeWalks);
                expect(f.sdk.state!.player).toMatchObject({ worldX: p.at!.x, worldZ: p.at!.z });
            }
            f.cue(p);
            await f.until(() => f.completedOffers.length === 1);
        } finally { await f.stop(); }
    });

    test('cancel before the first click and a frozen observation reject even a fresh cue', async () => {
        for (const reason of ['cancel', 'frozen']) {
            const f = fixture(['H1']);
            const p = f.options.packages[0]!;
            f.prepare(p);
            f.start();
            const now = Date.now;
            try {
                await f.until(() => f.ready(f.expected(p)));
                if (reason === 'cancel') cancelMulePreparation(f.options.cueDir, { runId, account, attempt: 1 });
                else Date.now = () => now() + 4000;
                f.cue(p);
                for (let i = 0; i < 12; i++) { f.sdk.push({}); await flush(); }
                expect(f.sdk.sent.some(a => a.method === 'sendTradeRequest')).toBe(false);
                expect(f.completedOffers).toHaveLength(0);
                expect(f.ready(f.expected(p))).toBe(false);
            } finally { Date.now = now; await f.stop(); }
        }
    });

    test('cancel/rearm requires acknowledgement on a new frame; frozen frames cannot renew ready', async () => {
        const f = fixture(['H1']);
        const p = f.options.packages[0]!;
        const e = f.prepare(p);
        f.start();
        try {
            await f.until(() => f.ready(e));
            const before = JSON.parse(readFileSync(muleReadyPath(f.options.cueDir, account), 'utf8'));
            for (let i = 0; i < 5; i++) { f.sdk.push({}); await flush(); }
            const after = JSON.parse(readFileSync(muleReadyPath(f.options.cueDir, account), 'utf8'));
            expect(after.ms).toBe(before.ms);
            expect(readyFor(after, e, after.ms + 3001)).toBe(false);
            cancelMulePreparation(f.options.cueDir, { runId, account, attempt: 1 });
            // The cancel aborted attempt 1; only an explicitly resumed attempt re-arms.
            const rearmed = f.prepare(p, 2);
            expect(f.ready(rearmed)).toBe(false);
            for (let i = 0; i < 5; i++) { f.sdk.push({}); await flush(); }
            expect(f.ready(rearmed)).toBe(false);
            await f.until(() => f.ready(rearmed));
        } finally { await f.stop(); }
    });

    test('blocked travel and wrong plane never publish readiness', async () => {
        const f = fixture(['H1']);
        const p = f.options.packages[0]!;
        const e = f.prepare(p);
        f.block();
        f.start();
        try {
            await f.pump(60);
            expect(f.ready(e)).toBe(false);
            f.sdk.push({ player: { ...f.sdk.state!.player!, worldX: p.at!.x, worldZ: p.at!.z, level: 1 } });
            await f.pump(5);
            expect(f.ready(e)).toBe(false);
        } finally { await f.stop(); }
    });

    test('an interrupted acceptance fails closed rather than replaying on restart', async () => {
        const f = fixture(['H1'], { 'mule-delivery-attempt': { runId, pkg: 'h1', session: deliverySession(runId, 'H1') } });
        const e = f.prepare(f.options.packages[0]!);
        f.start();
        try {
            await f.pump(10);
            expect(f.ready(e)).toBe(false);
            expect(f.bankVisits).toHaveLength(0);
        } finally { await f.stop(); }
    });

    test('carry readiness requires the entire reserved kit and rejects unknown additions', async () => {
        for (const corrupt of ['missing', 'extra']) {
            const f = fixture(['H4', 'H4k']);
            const e = f.prepare(f.options.packages[0]!);
            f.start();
            try {
                await f.until(() => f.ready(e));
                const inventory = f.sdk.getInventory();
                f.sdk.tick({ inventory: corrupt === 'missing' ? inventory.slice(0, -1) : [...inventory, { slot: 27, id: 99999, name: 'Unknown', count: 1, optionsWithIndex: [] }] });
                await f.pump(4);
                expect(f.ready(e)).toBe(false);
                f.cue(f.options.packages[0]!);
                await f.pump(8);
                expect(f.completedOffers).toHaveLength(0);
                expect(f.bankVisits).toHaveLength(1);
            } finally { await f.stop(); }
        }
    });

    test('oversized carry groups and cumulative take-backs fail before withdrawal', async () => {
        for (const mode of ['initial', 'returns']) {
            const f = fixture(['H4', 'H4k'], {}, packages => {
                if (mode === 'initial') packages[1]!.items = [{ id: 385, amount: 20 }];
                else packages[0]!.takeBackSlots = 28;
            });
            const e = f.prepare(f.options.packages[0]!);
            expect(() => planCarryGroup(f.options.packages, f.bank)).toThrow('slots');
            f.start();
            try {
                await f.until(() => f.logs.some(l => l.message === 'carry group refused'));
                expect(f.ready(e)).toBe(false);
                expect(f.sdk.getInventory()).toHaveLength(0);
            } finally { await f.stop(); }
        }
    });

    test('oversized incoming offer is declined without losing the frozen group or banking', async () => {
        const f = fixture(['H4', 'H4k']);
        const h4 = f.options.packages[0]!;
        const e = f.prepare(h4);
        f.start();
        try {
            await f.until(() => f.ready(e));
            const before = countById(f.sdk.getInventory());
            f.giveBack(21);
            const cue = f.cue(h4);
            await f.until(() => f.logs.some(l => l.message === 'hand-off' && l.data?.success === false));
            cue.stop([{ tick: f.sdk.state!.tick, ms: Date.now() }]);
            await f.pump(4);
            expect(f.completedOffers).toHaveLength(0);
            expect(f.state.data['mule-delivery-served']).toBeUndefined();
            expect(f.state.data['mule-delivery-attempt']).toBeUndefined();
            expect(countById(f.sdk.getInventory())).toEqual(before);
            expect(f.bankVisits).toHaveLength(1);
            f.giveBack(20);
            f.cue(h4);
            await f.until(() => f.completedOffers.length === 1);
        } finally { await f.stop(); }
    });

    test('restart rebanks only the unserved member and never replays H4', async () => {
        const f = fixture(['H4', 'H4k']);
        const [h4, h4k] = f.options.packages as [Package, Package];
        f.prepare(h4);
        f.start();
        try {
            await f.until(() => f.ready(f.expected(h4)));
            f.giveBack(20);
            const cue = f.cue(h4);
            await f.until(() => f.logs.some(l => l.message === 'hand-off' && l.data?.success));
            const next = f.prepare(h4k);
            await f.until(() => f.ready(next));
            cue.stop([{ tick: f.sdk.state!.tick, ms: Date.now() }]);
            await f.stop();
            const rearm = f.prepare(h4k);
            f.start();
            expect(f.ready(rearm)).toBe(false);
            await f.until(() => f.ready(rearm));
            expect(f.bank.find(b => b.id === 2552)?.count).toBe(20);
            expect(f.sdk.getInventory()).toHaveLength(3);
            expect(f.completedOffers).toHaveLength(1);
            f.prepare(h4);
            f.cue(h4);
            await f.pump(10);
            expect(f.completedOffers).toHaveLength(1);
            expect(f.state.data['mule-delivery-served']).toMatchObject([{ session: deliverySession(runId, 'H4') }]);
        } finally { await f.stop(); }
    });

    test('consecutive groups reserve shared stacks and retain unasked top-ups without restaging', async () => {
        for (const asked of [0, 1]) {
            const f = fixture(['H1', 'H4', 'H4k'], {}, packages => {
                packages[0]!.carryNext = true;
                packages[0]!.items = [{ id: 554, amount: 5 }, { id: 385, topUp: { max: 3 } }];
                packages[1]!.items = [{ id: 554, amount: 7 }, { id: 385, amount: 2 }];
                packages[1]!.takeBackSlots = 0;
                packages[2]!.items = [{ id: 554, amount: 9 }];
            });
            const [a, b, c] = f.options.packages as [Package, Package, Package];
            f.prepare(a);
            f.start();
            try {
                await f.until(() => f.ready(f.expected(a)));
                expect(f.sdk.getInventory().filter(i => i.name === 'Shark')).toHaveLength(5);
                if (asked) writeTopUpAsk(f.options.cueDir, [{ item: '^Shark$', count: asked }], Date.now(), a.scope);
                f.cue(a);
                await f.until(() => f.completedOffers.length === 1);
                const next = f.prepare(b);
                await f.until(() => f.ready(next));
                expect(f.completedOffers[0]!.find(i => i.name === 'Fire rune')?.count).toBe(5);
                expect(f.completedOffers[0]!.find(i => i.name === 'Shark')?.count ?? 0).toBe(asked);
                expect(f.sdk.getInventory().filter(i => i.name === 'Shark')).toHaveLength(5 - asked);
                expect(f.bankVisits).toHaveLength(1);
                f.cue(b);
                await f.until(() => f.completedOffers.length === 2);
                const last = f.prepare(c);
                await f.until(() => f.ready(last));
                expect(f.completedOffers[1]!.find(i => i.name === 'Fire rune')?.count).toBe(7);
                expect(f.completedOffers[1]!.find(i => i.name === 'Shark')?.count).toBe(2);
                expect(f.sdk.getInventory().filter(i => i.name === 'Shark')).toHaveLength(3 - asked);
                expect(f.bankVisits).toHaveLength(1);
                const lastCue = f.cue(c);
                await f.until(() => f.completedOffers.length === 3);
                lastCue.stop([{ tick: f.sdk.state!.tick, ms: Date.now() }]);
                await f.until(() => f.bankVisits.length === 2);
                expect(f.completedOffers[2]!.map(i => [i.name, i.count])).toEqual([['Fire rune', 9]]);
                await f.until(() => f.bank.find(i => i.name === 'Shark')?.count === 3 - asked);
            } finally { await f.stop(); }
        }
    });

    test('capacity includes unasked top-up leftovers and cumulative returns', () => {
        const bank: BankItem[] = [{ slot: 0, id: 10000, name: 'Shark', count: 28 }];
        const group: Package[] = [
            { name: 'a', items: [{ item: 'Shark', topUp: { max: 26 } }], carryNext: true, takeBackSlots: 1 },
            { name: 'b', items: [{ item: 'Shark', amount: 1 }], carryNext: true, takeBackSlots: 1 },
            { name: 'c', items: [{ item: 'Shark', amount: 1 }], takeBackSlots: 1 }
        ];
        expect(() => planCarryGroup(group, bank)).toThrow('29 slots');
        group[0]!.takeBackSlots = 0;
        expect(planCarryGroup(group, bank).peakSlots).toBe(28);
        bank[0]!.count = 27;
        expect(() => planCarryGroup(group, bank)).toThrow('short');
    });

    test('cancel and invalid preparation stop carry travel and serving, then valid rearm retains the group', async () => {
        for (const invalid of [false, true]) {
            const f = fixture(['H4', 'H4k']);
            const h4 = f.options.packages[0]!;
            const e = f.prepare(h4);
            f.block();
            f.start();
            try {
                await f.until(() => f.sdk.sent.some(a => a.method === 'sendWalk'));
                expect(f.sdk.getInventory()).toHaveLength(18);
                if (invalid) prepareMule(f.options.cueDir, { ...e, receiver: 'wrong_receiver' });
                else cancelMulePreparation(f.options.cueDir, { runId, account, attempt: 1 });
                await f.until(() => f.logs.some(l => l.message === 'delivery travel' && l.data?.ok === false));
                const sent = f.sdk.sent.length;
                f.cue(h4);
                await f.pump(8);
                expect(f.ready(e)).toBe(false);
                expect(f.completedOffers).toHaveLength(0);
                expect(f.sdk.sent).toHaveLength(sent);
                expect(f.bankVisits).toHaveLength(1);
                f.block(false);
                const rearm = f.prepare(h4, 2);
                // Stop the serving cue: preparation alone must not authorize a trade.
                const cue = f.cue(h4);
                cue.stop([{ tick: f.sdk.state!.tick, ms: Date.now() }]);
                await f.until(() => f.ready(rearm));
                expect(f.bankVisits).toHaveLength(1);
                expect(f.sdk.getInventory()).toHaveLength(18);
            } finally { await f.stop(); }
        }
    });

    test('a proved trade with unexplained inventory faults durably without replaying the served row', async () => {
        const f = fixture(['H4', 'H4k']);
        const [h4, h4k] = f.options.packages as [Package, Package];
        f.prepare(h4);
        f.start();
        try {
            await f.until(() => f.ready(f.expected(h4)));
            f.giveBack(20);
            f.corruptCompletion();
            f.cue(h4);
            await f.until(() => !!f.state.data['mule-delivery-fault']);
            await f.pump(2);
            expect(f.state.data['mule-delivery-served']).toMatchObject([{ session: deliverySession(runId, 'H4') }]);
            await f.stop();
            const next = f.prepare(h4k);
            f.start();
            await f.pump(10);
            expect(f.ready(next)).toBe(false);
            expect(f.bankVisits).toHaveLength(1);
            expect(f.completedOffers).toHaveLength(1);
            expect(f.state.data['mule-delivery-fault']).toMatchObject({ runId, pkg: h4.name, reason: 'carry trade inventory mismatch' });
        } finally { await f.stop(); }
    });

    test('cancel during an unanswered trade open stops requests before any attempt journal or offer', async () => {
        const f = fixture(['H4', 'H4k']);
        const h4 = f.options.packages[0]!;
        f.prepare(h4);
        f.start();
        try {
            await f.until(() => f.ready(f.expected(h4)));
            const send = f.sdk.onSend;
            f.sdk.onSend = (a, sdk) => { if (a.method !== 'sendTradeRequest') send(a, sdk); };
            const message = { type: 4, text: 'wishes to trade with you.', sender: receiver, tick: f.sdk.state!.tick + 1, fromSelf: false };
            Object.assign(f.sdk, { getChat: () => [message] });
            f.cue(h4);
            await f.until(() => f.sdk.sent.some(a => a.method === 'sendTradeRequest'));
            const requests = f.sdk.sent.filter(a => a.method === 'sendTradeRequest').length;
            cancelMulePreparation(f.options.cueDir, { runId, account, attempt: 1 });
            await f.until(() => f.logs.some(l => l.message === 'trade open failed' && l.data?.result === 'stopped'));
            await f.pump(10);
            expect(f.sdk.sent.filter(a => a.method === 'sendTradeRequest')).toHaveLength(requests);
            expect(f.sdk.sent.some(a => a.method === 'sendOfferItem')).toBe(false);
            expect(f.state.data['mule-delivery-attempt']).toBeUndefined();
            expect(f.completedOffers).toHaveLength(0);
            expect(f.bankVisits).toHaveLength(1);
        } finally { await f.stop(); }
    });

    test('an interrupted carry confirmation retains its attempt journal and refuses restart replay', async () => {
        const f = fixture(['H4', 'H4k']);
        const h4 = f.options.packages[0]!;
        f.prepare(h4);
        f.start();
        try {
            await f.until(() => f.ready(f.expected(h4)));
            const send = f.sdk.onSend;
            f.sdk.onSend = (a, sdk) => {
                if (a.method === 'sendAcceptTrade' && sdk.getTradeState().screen === 'confirm') return;
                send(a, sdk);
            };
            const cue = f.cue(h4);
            await f.until(() => f.sdk.sent.filter(a => a.method === 'sendAcceptTrade').length === 2);
            cue.stop([{ tick: f.sdk.state!.tick, ms: Date.now() }]);
            await f.until(() => f.logs.some(l => l.message === 'delivery outcome uncertain: reconciliation required'));
            expect(f.state.data['mule-delivery-attempt']).toMatchObject({ runId, pkg: h4.name, session: deliverySession(runId, 'H4') });
            expect(f.state.data['mule-delivery-served']).toBeUndefined();
            await f.stop();
            const e = f.prepare(h4);
            f.start();
            await f.pump(10);
            expect(f.ready(e)).toBe(false);
            expect(f.bankVisits).toHaveLength(1);
            expect(f.completedOffers).toHaveLength(0);
        } finally { await f.stop(); }
    });

    test('carry metadata is delivery-only, ordered and bounded', () => {
        const f = fixture(['H4', 'H4k']);
        const [first, second] = f.options.packages;
        expect(() => muleOptions({ ...f.options, deliveryRun: undefined })).toThrow('deliveryRun');
        expect(() => muleOptions({ ...f.options, packages: [first] })).toThrow('next ordered');
        expect(() => muleOptions({ ...f.options, packages: [{ ...first, onRequest: true }, second] })).toThrow('next ordered');
        expect(() => muleOptions({ ...f.options, packages: [first, { ...second, items: [{ id: 385, amount: -1 }] }] })).toThrow('bounded');
        for (const takeBackSlots of [-1, 29, 1.5, '20']) expect(() => muleOptions({ ...f.options, packages: [{ ...first, takeBackSlots }, second] })).toThrow('takeBackSlots');
        expect(() => muleOptions({ ...f.options, packages: [{ ...first, carryNext: false }, second] })).toThrow('carryNext');
    });

    test('generated configs reject absent, empty or plane-less delivery locations', () => {
        const f = fixture(['H1']);
        expect(() => muleOptions({ ...f.options, packages: [] })).toThrow('nonempty');
        for (const at of [undefined, null, {}, { x: 3222, z: 3222 }, { x: null, z: 3222, level: 0 }]) {
            expect(() => muleOptions({ ...f.options, packages: [{ ...f.options.packages[0]!, at }] })).toThrow();
        }
        expect(() => muleOptions({ ...f.options, packages: [{ ...f.options.packages[0]!, bank: undefined }] })).toThrow();
    });
});

test('successful withdrawal acknowledgements cannot substitute for the full observed package', async () => {
    const f = fixture(['H1']);
    const expected = f.prepare(f.options.packages[0]!);
    f.shortWithdrawals();
    f.start();
    try {
        await f.until(() => f.logs.some(l => l.message === 'delivery staging inventory mismatch'));
        expect(f.ready(expected)).toBe(false);
        expect(f.logs.some(l => l.message === 'package ready')).toBe(false);
        expect(f.completedOffers).toHaveLength(0);
    } finally { await f.stop(); }
});


/** Scripted passages are explicit loc actions, not successful walking through a wall. */
function simulatePassages(f: ReturnType<typeof fixture>, mode: 'pass' | 'missing' | 'stuck' = 'pass') {
    let scans = 0;
    const send = f.sdk.onSend;
    Object.assign(f.sdk, {
        scanNearbyLocs: async () => {
            scans++;
            const p = f.sdk.state!.player!;
            return mode === 'missing' ? [] : PASSAGES.filter(g => Math.max(Math.abs(g.at.x - p.worldX), Math.abs(g.at.z - p.worldZ)) <= 6)
                .map((g, id) => ({ id, name: g.name.includes('doors') ? 'Tree door' : 'Gate', ...g.at, level: 0, distance: 2, optionsWithIndex: [{ text: 'Open', opIndex: 1 }] }));
        },
        waitForTicks: async () => {
            const tick = f.sdk.state!.tick;
            await f.sdk.waitForCondition(s => s.tick > tick);
        }
    });
    f.sdk.onSend = (a, sdk) => {
        send(a, sdk);
        if (a.method !== 'sendInteractLoc' || mode !== 'pass') return;
        const gate = PASSAGES.find(g => g.at.x === a.args[0] && g.at.z === a.args[1])!;
        const p = sdk.state!.player!;
        const to = gate.sides[p.worldZ <= gate.at.z ? 1 : 0];
        f.walk.target = null;
        sdk.push({ player: { ...p, x: to.x, z: to.z, worldX: to.x, worldZ: to.z } });
    };
    return { scans: () => scans };
}

describe('generated delivery passage traversal', () => {
    for (const row of ['H8', 'H12']) test(row + ' traverses the canonical gate before readiness and again before banking', async () => {
        const f = fixture([row]);
        simulatePassages(f);
        const pkg = f.options.packages[0]!;
        const expected = f.prepare(pkg);
        f.start();
        try {
            await f.until(() => f.ready(expected));
            expect(f.sdk.sent.filter(a => a.method === 'sendInteractLoc')).toHaveLength(1);
            expect(f.logs.filter(l => l.message === 'passage')).toHaveLength(1);
            expect(f.sdk.state!.player).toMatchObject({ worldX: pkg.at!.x, worldZ: pkg.at!.z, level: 0 });
            expect(f.sdk.sent.some(a => a.method === 'sendTradeRequest')).toBe(false);
            if (row === 'H12') writeTopUpAsk(f.options.cueDir, [{ item: '^shark$', count: 9 }], Date.now(), pkg.scope);
            const cue = f.cue(pkg);
            await f.until(() => f.completedOffers.length === 1);
            cue.stop([{ tick: f.sdk.state!.tick, ms: Date.now() }]);
            await f.until(() => f.bankVisits.length === 2);
            expect(f.sdk.sent.filter(a => a.method === 'sendInteractLoc')).toHaveLength(2);
            expect(f.logs.filter(l => l.message === 'passage')).toHaveLength(2);
            expect(f.logs.filter(l => l.message === 'delivery travel').every(l => Number(l.data?.ticks) > 0)).toBe(true);
        } finally { await f.stop(); }
    });

    test('cancelled or failed passage never reaches ready or sends a trade', async () => {
        for (const mode of ['missing', 'stuck'] as const) {
            const f = fixture(['H8']);
            const passages = simulatePassages(f, mode);
            const expected = f.prepare(f.options.packages[0]!);
            f.start();
            try {
                await f.until(() => passages.scans() > 0);
                expect(f.ready(expected)).toBe(false);
                if (mode === 'missing') cancelMulePreparation(f.options.cueDir, { runId, account, attempt: 1 });
                await f.until(() => f.logs.some(l => l.message === 'delivery travel' && l.data?.ok === false));
                expect(f.ready(expected)).toBe(false);
                expect(f.sdk.sent.some(a => a.method === 'sendTradeRequest')).toBe(false);
                expect(f.sdk.sent.filter(a => a.method === 'sendInteractLoc')).toHaveLength(mode === 'missing' ? 0 : 6);
            } finally { await f.stop(); }
        }
    });
});


describe('stationary delivery keepalive', () => {
    test('generated delivery defaults to five minutes and never steps away during idle activity', async () => {
        const f = fixture(['H1']);
        expect(muleOptions({ ...f.options }).keepAliveMinutes).toBe(5);
        const expected = f.prepare(f.options.packages[0]!);
        const now = Date.now;
        let offset = 0;
        Date.now = () => now() + offset;
        f.start();
        try {
            await f.until(() => f.ready(expected));
            const position = { ...f.sdk.state!.player! };
            const inventory = structuredClone(f.sdk.getInventory());
            const sent = f.sdk.sent.length;
            offset = 301_000;
            await f.until(() => f.sdk.sent.slice(sent).some(a => a.method === 'sendWait'));
            expect(f.sdk.sent.slice(sent)).toEqual([{ method: 'sendWait', args: [1] }]);
            expect(f.sdk.state!.player).toEqual(position);
            expect(f.sdk.getInventory()).toEqual(inventory);
            expect(f.ready(expected)).toBe(true);

            offset += 301_000;
            const waits = f.sdk.sent.filter(a => a.method === 'sendWait').length;
            // Re-publishing the same SDK tick cannot make an old observation fresh.
            for (let i = 0; i < 8; i++) { f.sdk.push({}); await flush(); }
            expect(f.ready(expected)).toBe(false);
            expect(f.sdk.sent.filter(a => a.method === 'sendWait')).toHaveLength(waits);
            cancelMulePreparation(f.options.cueDir, { runId, account, attempt: 1 });
            await f.pump(6);
            expect(f.sdk.sent.filter(a => a.method === 'sendWait')).toHaveLength(waits);
            expect(f.ready(expected)).toBe(false);
        } finally { Date.now = now; await f.stop(); }
    });

    test('explicitly enabled delivery keepalive is stationary even when its SDK acknowledgement fails', async () => {
        const f = fixture(['H1']);
        Object.assign(f.options, { keepAliveMinutes: 5 });
        const expected = f.prepare(f.options.packages[0]!);
        Object.assign(f.sdk, { sendWait: async () => {
            await f.sdk.sendAction({ method: 'sendWait', args: [1] });
            return { success: false, message: 'disconnected' };
        } });
        const now = Date.now;
        let offset = 0;
        Date.now = () => now() + offset;
        f.start();
        try {
            await f.until(() => f.ready(expected));
            const sent = f.sdk.sent.length;
            offset = 301_000;
            await f.until(() => f.logs.some(l => l.message === 'keep-alive' && l.data?.success === false));
            expect(f.sdk.sent.slice(sent)).toEqual([{ method: 'sendWait', args: [1] }]);
            const ready = JSON.parse(readFileSync(muleReadyPath(f.options.cueDir, account), 'utf8'));
            offset += 4000;
            for (let i = 0; i < 8; i++) { f.sdk.push({}); await flush(); }
            expect(f.ready(expected)).toBe(false);
            expect(JSON.parse(readFileSync(muleReadyPath(f.options.cueDir, account), 'utf8')).tick).toBe(ready.tick);
        } finally { Date.now = now; await f.stop(); }
    });
});


test('actual H20 launcher stop scope aborts after confirmation without replay or a return-bank walk', async () => {
    const artifact = JSON.parse(readFileSync(join(import.meta.dir, '../../docs/speedrun/research/mule-delivery-production.json'), 'utf8'));
    const entry = artifact.accounts.find((a: { account: string }) => a.account === 'cairn_h03');
    expect(entry.stopOn).toEqual({ step: 'H20', family: 'mule' });
    expect(entry.loginOn).toBeUndefined();
    expect(entry.final).toBeUndefined();
    const f = fixture(['H20']);
    expect(f.options.packages).toEqual(entry.options.packages);
    const pkg = f.options.packages[0]!;
    const expected = f.prepare(pkg);
    let stopped = false;
    const gate = new CueGate({ dir: f.options.cueDir, login: null, stop: entry.stopOn, since: Date.now(),
        onStop: () => { stopped = true; f.abort(); }, log: () => {}, pollMs: 1 });
    f.start();
    try {
        await f.until(() => f.ready(expected));
        const walks = f.sdk.sent.filter(a => a.method === 'sendWalk').length;
        const cue = f.cue(pkg);
        // The last confirm is in flight; the next observed frame proves completion.
        await f.until(() => f.completedOffers.length === 1);
        cue.stop([{ tick: f.sdk.state!.tick, ms: Date.now() }], { final: true });
        await f.until(() => stopped);
        await f.stop();
        expect(f.state.data['mule-delivery-served']).toEqual([expect.objectContaining({ pkg: 'h20', session: deliverySession(runId, 'H20') })]);
        expect(f.state.data['mule-delivery-attempt']).toBeUndefined();
        expect(f.completedOffers).toHaveLength(1);
        expect(f.sdk.getInventory()).toHaveLength(0);
        expect(f.bankVisits).toHaveLength(1);
        expect(f.sdk.sent.filter(a => a.method === 'sendWalk')).toHaveLength(walks);
        expect(f.ready(expected)).toBe(false);
    } finally { gate.close(); await f.stop(); }
});


describe('initial hold', () => {
    test('a held helper stays stationary and unstaged until its own prepare releases it', async () => {
        const f = fixture(['H20']);
        const p = f.options.packages[0]!;
        const h = f.hold(p);
        const now = Date.now;
        let offset = 0;
        Date.now = () => now() + offset;
        f.start();
        try {
            await f.until(() => f.held(h));
            const position = { ...f.sdk.state!.player! };
            const inventory = structuredClone(f.sdk.getInventory());
            expect(f.ready({ ...f.expected(p), preparationSeq: h.preparationSeq })).toBe(false);
            // Two simulated hours of fresh frames under the default five-minute stationary keepalive.
            for (let minute = 0; minute < 120; minute++) {
                offset += 60_000;
                await f.pump(2);
                expect(f.held(h)).toBe(true);
            }
            expect(f.bankVisits).toHaveLength(0);
            expect([...new Set(f.sdk.sent.map(a => a.method))]).toEqual(['sendWait']);
            expect(f.sdk.sent.length).toBeGreaterThanOrEqual(20);
            expect(f.sdk.state!.player).toEqual(position);
            expect(f.sdk.getInventory()).toEqual(inventory);
            const released = f.prepare(p);
            expect(released.preparationSeq).toBe(h.preparationSeq + 1);
            await f.until(() => f.ready(released));
            expect(f.bankVisits).toHaveLength(1);
            expect(f.held(h)).toBe(false);
        } finally { Date.now = now; await f.stop(); }
    });

    test('an abort ends the hold: the same-attempt prepare is refused; only a fresh pre-start hold re-arms', async () => {
        const f = fixture(['H20']);
        const p = f.options.packages[0]!;
        const h = f.hold(p);
        f.start();
        try {
            await f.until(() => f.held(h));
            cancelMulePreparation(f.options.cueDir, { runId, account, attempt: 1 });
            await f.pump(3);
            expect(f.held(h)).toBe(false);
            expect(() => f.prepare(p)).toThrow('attempt 1 <= aborted attempt 1');
            await f.pump(20);
            expect(f.bankVisits).toHaveLength(0);
            const resumed = f.hold(p, 2);
            expect(resumed.preparationSeq).toBe(h.preparationSeq + 2);
            expect(f.held(resumed)).toBe(false);
            await f.until(() => f.held(resumed));
            await f.pump(20);
            expect(f.bankVisits).toHaveLength(0);
            const released = f.prepare(p, 2);
            await f.until(() => f.ready(released));
            expect(f.bankVisits).toHaveLength(1);
        } finally { await f.stop(); }
    });

    test('held is published only on a healthy, fresh frame: any open interface, death or frozen frames report off', async () => {
        const f = fixture(['H20']);
        const p = f.options.packages[0]!;
        const h = f.hold(p);
        const now = Date.now;
        let offset = 0;
        Date.now = () => now() + offset;
        f.start();
        try {
            await f.until(() => f.held(h));
            const healthy = structuredClone(f.sdk.state!);
            for (const open of [
                { modalOpen: true },
                { dialog: { isOpen: true, options: [], isWaiting: false } },
                { shop: { isOpen: true, title: '', shopItems: [], playerItems: [] } },
                { interface: { isOpen: true, interfaceId: 1, options: [], inventories: [] } },
                { player: { ...healthy.player!, isDead: true } },
                { player: { ...healthy.player!, hp: 0 } },
            ]) {
                f.sdk.push(open);
                await f.pump(3);
                expect(f.held(h)).toBe(false);
                f.sdk.push({ modalOpen: healthy.modalOpen, dialog: healthy.dialog, shop: healthy.shop, interface: healthy.interface, player: healthy.player });
                await f.until(() => f.held(h));
            }
            // Frozen frames: no new observation, so the last held status expires on the wall clock.
            offset += 3001;
            expect(f.held(h)).toBe(false);
            expect(f.bankVisits).toHaveLength(0);
            expect(f.sdk.sent.every(a => a.method === 'sendWait')).toBe(true);
            expect(f.sdk.state!.player).toMatchObject({ worldX: healthy.player!.worldX, worldZ: healthy.player!.worldZ, level: healthy.player!.level });
        } finally { Date.now = now; await f.stop(); }
    });

    test('a delayed abort from attempt 1 after the operator resume leaves attempt 2 held and releasable', async () => {
        const f = fixture(['H20']);
        const p = f.options.packages[0]!;
        f.hold(p);
        f.start();
        try {
            cancelMulePreparation(f.options.cueDir, { runId, account, attempt: 1 });
            const resumed = f.hold(p, 2);
            await f.until(() => f.held(resumed));
            expect(() => cancelMulePreparation(f.options.cueDir, { runId, account, attempt: 1 })).toThrow('attempt 1 < current attempt 2');
            await f.pump(5);
            expect(f.held(resumed)).toBe(true);
            expect(f.bankVisits).toHaveLength(0);
            const released = f.prepare(p, 2);
            await f.until(() => f.ready(released));
            expect(f.bankVisits).toHaveLength(1);
        } finally { await f.stop(); }
    });

    test('a hold for another receiver or row never holds, stages or trades', async () => {
        for (const change of [{ receiver: 'someone_else' }, { row: 'H19' }]) {
            const f = fixture(['H20']);
            const p = f.options.packages[0]!;
            holdMule(f.options.cueDir, { ...f.expected(p), ...change });
            f.start();
            try {
                await f.pump(30);
                expect(readMuleReady(f.options.cueDir, account)).toBeNull();
                expect(f.bankVisits).toHaveLength(0);
                expect(f.sdk.sent.some(a => a.method !== 'sendWait')).toBe(false);
            } finally { await f.stop(); }
        }
    });

    test('rows with no control file still auto-stage exactly as before', async () => {
        const f = fixture(['H1']);
        const p = f.options.packages[0]!;
        f.start();
        try {
            await f.until(() => f.ready({ ...f.expected(p), preparationSeq: 0 }));
            expect(f.bankVisits).toHaveLength(1);
        } finally { await f.stop(); }
    });
});
