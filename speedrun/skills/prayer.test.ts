import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { baseState, drive, FakeSdk, flush, simulateBurying, type SentAction } from '../lib/fake-sdk';
import { TickLog } from '../lib/ticks';
import { levelForXp, XP_RATE, xpForLevel } from '../lib/xp';
import { Observation, resolveResume } from '../runner/resume';
import { runSteps, StepError, type RunnerSession } from '../runner/step';
import { SCORED_TILE, VARROCK_WEST } from './herblore';
import {
    BONE_TYPES,
    bonesFor,
    bonesToLevel,
    BURY_RESEND,
    BURY_STALL,
    buryAtBooth,
    buryHeld,
    planLoad,
    preconditions,
    prayerStep,
    skill,
    STEP_NAME,
    steps,
    type BoothReport
} from './prayer';

const ROOT = join(import.meta.dir, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const DRAGON = 536;
const DRAGON_NOTE = 537;
const BABY = 534;
const COINS = 995;
const NAMES: Record<number, string> = { 536: 'Dragon bones', 537: 'Dragon bones', 534: 'Babydragon bones', 535: 'Babydragon bones', 995: 'Coins', 1351: 'Bronze axe' };
const BASE: Record<number, number> = { 536: 72, 534: 30 };
const NOTES = new Set([537, 535]);
const BOOTH_LOC = { id: VARROCK_WEST.id, name: 'Bank booth', x: VARROCK_WEST.x, z: VARROCK_WEST.z, level: 0, distance: 1, optionsWithIndex: [{ text: 'Use', opIndex: 1 }, { text: 'Use-quickly', opIndex: 2 }], options: ['Use', 'Use-quickly'] };

interface Slot { id: number; count: number }

/**
 * The server's side of the booth, one tick per `step()`: packets sent while label T was the
 * latest are decoded on T+1 in order (processClientsIn), then the delayed bury completes
 * (processPlayers), as bury_bone.rs2 and the engine order them (prayer.md section 4):
 * - an accepted Bury p_delay(0)s: delayedUntil = N + 1, so a click decoded on N + 1 is dropped,
 *   and on N + 1 the bone leaves and the xp lands; a level rise opens a level-up page;
 * - a Bury or booth click is dropped while delayed, a Bury while a page is open or the bank is;
 * - the booth (Use-quickly) opens the bank on the tick it is decoded;
 * - deposit-all moves every unit of an id, a note banking as its item; withdraw takes the bank
 *   slot's item into free slots (All: as many as fit), and the bank compacts an emptied slot.
 */
class BoothServer {
    tick = 100;
    inv: Array<Slot | null> = Array(28).fill(null);
    bank: Slot[] = [];
    bankOpen = false;
    noteMode = false;
    xp: number;
    delayedUntil = -1;
    pending: { slot: number; at: number } | null = null;
    page: { n: number; tick: number; level: number } | null = null;
    pages = 0;
    at: { x: number; z: number } = { x: SCORED_TILE.x, z: SCORED_TILE.z };
    lastPage: { text: string[]; tick: number; interfaceId: number } | null = null;
    /** Every send, with the label it was sent on. */
    log: Array<SentAction & { label: number }> = [];
    queue: SentAction[] = [];
    dropped = { delayed: 0, page: 0, bank: 0 };
    buryTicks: number[] = [];
    bankOpenTicks: number[] = [];

    constructor(readonly sdk: FakeSdk, opts: { level?: number; xp?: number } = {}) {
        this.xp = opts.xp ?? xpForLevel(opts.level ?? 1);
        sdk.onSend = a => {
            this.log.push({ ...a, label: this.sdk.state!.tick });
            this.queue.push(a);
        };
    }

    give(id: number, n: number) {
        if (NOTES.has(id) || id === COINS) {
            this.inv[this.inv.findIndex(x => !x)] = { id, count: n };
            return;
        }
        for (let i = 0; i < n; i++) this.inv[this.inv.findIndex(x => !x)] = { id, count: 1 };
    }

    level() {
        return levelForXp(this.xp);
    }

    state(): BotWorldState {
        const inventory: InventoryItem[] = [];
        this.inv.forEach((it, slot) => {
            if (it) inventory.push({ slot, id: it.id, name: NAMES[it.id] ?? `obj ${it.id}`, count: it.count, optionsWithIndex: BASE[it.id] ? [{ text: 'Bury', opIndex: 1 }] : [] });
        });
        const text = this.page ? ['Congratulations, you just advanced a Prayer level.', `Your Prayer level is now ${this.page.level}.`] : [];
        if (this.page) this.lastPage = { text, tick: this.page.tick, interfaceId: 6247 };
        return baseState({
            tick: this.tick,
            player: { worldX: this.at.x, worldZ: this.at.z, x: this.at.x, z: this.at.z, level: 0 } as BotWorldState['player'],
            skills: [{ name: 'Prayer', level: this.level(), baseLevel: this.level(), experience: this.xp }],
            inventory,
            bank: { isOpen: this.bankOpen, items: this.bankOpen ? this.bank.map((b, slot) => ({ slot, id: b.id, name: NAMES[b.id] ?? `obj ${b.id}`, count: b.count })) : [], noteMode: this.noteMode },
            dialog: this.page ? { isOpen: true, options: [], isWaiting: false, pageId: `levelup-${this.page.n}`, text: text.join(' ') } : { isOpen: false, options: [], isWaiting: false },
            recentDialogs: this.lastPage ? [this.lastPage] : [],
            nearbyLocs: [BOOTH_LOC] as BotWorldState['nearbyLocs']
        });
    }

    publish() {
        this.sdk.push(this.state());
    }

    step() {
        const n = this.tick + 1;
        const packets = this.queue;
        this.queue = [];
        for (const a of packets) {
            const [x, y] = a.args as [number, number];
            switch (a.method) {
                case 'sendClickDialog':
                    this.page = null;
                    break;
                case 'sendUseItem': {
                    if (this.bankOpen) this.dropped.bank++;
                    else if (this.page) this.dropped.page++;
                    else if (n <= this.delayedUntil) this.dropped.delayed++;
                    else if (this.inv[x] && BASE[this.inv[x]!.id]) {
                        this.pending = { slot: x, at: n + 1 };
                        this.delayedUntil = n + 1;
                    }
                    break;
                }
                case 'sendInteractLoc':
                    if (n <= this.delayedUntil || this.page) this.dropped.delayed++;
                    else if (!this.bankOpen) {
                        this.bankOpen = true;
                        this.bankOpenTicks.push(n);
                    }
                    break;
                case 'sendBankDeposit': {
                    const it = this.inv[x];
                    if (!this.bankOpen || !it) break;
                    let k = 0;
                    this.inv.forEach((o, i) => {
                        if (o?.id === it.id) {
                            k += o.count;
                            this.inv[i] = null;
                        }
                    });
                    const id = NOTES.has(it.id) ? it.id - 1 : it.id;
                    const b = this.bank.find(s => s.id === id);
                    if (b) b.count += k;
                    else this.bank.push({ id, count: k });
                    break;
                }
                case 'sendBankWithdraw': {
                    const b = this.bank[x];
                    if (!this.bankOpen || !b) break;
                    let want = y === -1 ? b.count : Math.min(y, b.count);
                    for (let i = 0; i < 28 && want > 0; i++) {
                        if (this.inv[i]) continue;
                        this.inv[i] = { id: this.noteMode ? b.id + 1 : b.id, count: 1 };
                        b.count--;
                        want--;
                    }
                    if (b.count === 0) this.bank.splice(x, 1);
                    break;
                }
                case 'sendCloseModal':
                    this.bankOpen = false;
                    break;
                case 'sendClickComponent':
                    if (x === 5386) this.noteMode = true;
                    if (x === 5387) this.noteMode = false;
                    break;
            }
        }
        if (this.pending && this.pending.at === n) {
            const it = this.inv[this.pending.slot]!;
            this.inv[this.pending.slot] = null;
            const before = this.level();
            this.xp += BASE[it.id]! * XP_RATE;
            this.buryTicks.push(n);
            if (this.level() > before) this.page = { n: ++this.pages, tick: n, level: this.level() };
            this.pending = null;
        }
        this.tick = n;
        this.publish();
    }

    sendsOn(label: number) {
        return this.log.filter(a => a.label === label).map(a => a.method);
    }
}

function setup(opts: { level?: number; bank?: Slot[]; held?: Slot[]; at?: { x: number; z: number } } = {}) {
    const sdk = new FakeSdk(baseState());
    const srv = new BoothServer(sdk, { level: opts.level ?? 1 });
    srv.bank = (opts.bank ?? []).map(b => ({ ...b }));
    for (const h of opts.held ?? []) srv.give(h.id, h.count);
    if (opts.at) srv.at = opts.at;
    srv.publish();
    return { sdk, srv };
}

/** Step the server until `p` settles. */
async function run<T>(srv: BoothServer, p: Promise<T>, maxTicks = 2000): Promise<T> {
    let settled = false;
    p.then(() => (settled = true), () => (settled = true));
    for (let i = 0; i < maxTicks; i++) {
        await flush();
        if (settled) return p;
        srv.step();
    }
    await flush();
    if (settled) return p;
    throw new Error(`still running after ${maxTicks} ticks`);
}

const session = (sdk: FakeSdk): RunnerSession => ({ sdk: sdk as never, bot: {} as never, name: 'prayerlab', sessionId: 1 });
const noStop = { shouldStop: () => false, logout: async () => {}, tickMonitor: false as const };

// ---------------------------------------------------------------- the content

describe('the content', () => {
    test('BONE_TYPES match obj.pack ids and bones.obj bone_exp (tenths), dragon first', () => {
        const pack = new Map<string, number>();
        for (const line of read('server/content/pack/obj.pack').split('\n')) {
            const m = line.match(/^(\d+)=(\S+)/);
            if (m) pack.set(m[2]!, Number(m[1]));
        }
        const obj = read('server/content/scripts/skill_prayer/configs/bones.obj');
        for (const t of BONE_TYPES) {
            expect(t.id).toBe(pack.get(t.obj)!);
            expect(t.note).toBe(pack.get(`cert_${t.obj}`)!);
            const block = obj.split(/\n(?=\[)/).find(b => b.startsWith(`[${t.obj}]`))!;
            expect(block).toContain(`name=${t.name}`);
            expect(block).toContain('iop1=Bury');
            expect(Number(block.match(/param=bone_exp,(\d+)/)![1]) / 10).toBe(t.base);
        }
        expect(BONE_TYPES.map(t => t.obj)).toEqual(['dragon_bones', 'babydragon_bones']);
    });

    test('the step-module convention: skill, steps() with one S25b step, booth only', () => {
        expect(skill).toBe('prayer');
        const s = steps();
        expect(s.map(x => x.name)).toEqual([STEP_NAME]);
        expect(STEP_NAME.startsWith('S25b')).toBe(true);
        expect(s[0]!.logoutSafe).toBe(true);
        expect(s[0]!.probes).toEqual(['boneBank']);
        // no inline mode: the option does not exist
        expect(read('speedrun/skills/prayer.ts')).not.toMatch(/mode\??:\s*'inline'/);
    });

    test('bonesFor takes ids, debugnames and game names, in order, and refuses the unknown', () => {
        expect(bonesFor()).toEqual([...BONE_TYPES]);
        expect((bonesFor([BABY, 'dragon_bones']) as { id: number }[]).map(t => t.id)).toEqual([BABY, DRAGON]);
        expect((bonesFor(['Dragon bones']) as { id: number }[]).map(t => t.id)).toEqual([DRAGON]);
        expect(bonesFor(['big_bones'])).toMatch(/unknown bone type "big_bones"/);
        expect(bonesFor([])).toMatch(/no bone type/);
    });

    test('bonesToLevel: 555 dragon bones from 1 to 99 (prayer.md section 1), 8 to 37 and 11 to 43', () => {
        expect(bonesToLevel(0, 99)).toBe(555);
        expect(bonesToLevel(0, 37)).toBe(8);
        expect(bonesToLevel(0, 43)).toBe(11);
    });
});

// ---------------------------------------------------------------- planLoad

describe('planLoad', () => {
    const bank = (d: number, b = 0) => [...(d ? [{ slot: 0, id: DRAGON, name: 'Dragon bones', count: d }] : []), ...(b ? [{ slot: d ? 1 : 0, id: BABY, name: 'Babydragon bones', count: b }] : [])];
    test('a stock larger than the pack is one Withdraw-All (fill)', () => {
        expect(planLoad(bank(300), BONE_TYPES, 28, Infinity, Infinity)).toEqual({ specs: [{ item: DRAGON, n: 'fill' }], bones: 28 });
    });
    test('the last of a stock is All', () => {
        expect(planLoad(bank(13), BONE_TYPES, 28, Infinity, Infinity)).toEqual({ specs: [{ item: DRAGON, n: 'all' }], bones: 13 });
    });
    test('dragon first, then babydragon by exact count so neither crowds the other', () => {
        expect(planLoad(bank(20, 100), BONE_TYPES, 28, Infinity, Infinity)).toEqual({ specs: [{ item: DRAGON, n: 'all' }, { item: BABY, n: 8 }], bones: 28 });
        expect(planLoad(bank(0, 100), BONE_TYPES, 28, Infinity, Infinity).specs).toEqual([{ item: BABY, n: 'fill' }]);
    });
    test('the xp to untilLevel and the count cap the load', () => {
        expect(planLoad(bank(300), BONE_TYPES, 28, Infinity, 5 * 72 * XP_RATE - 1).bones).toBe(5);
        expect(planLoad(bank(300), BONE_TYPES, 28, 3, Infinity)).toEqual({ specs: [{ item: DRAGON, n: 3 }], bones: 3 });
    });
});

// ---------------------------------------------------------------- preconditions

describe('preconditions refuse with a reason', () => {
    const at = (srv: BoothServer) => srv.state();
    test('a clean start at the booth passes (bank closed: the stock is out of sight)', () => {
        const { srv } = setup();
        expect(preconditions(at(srv))).toBe(true);
    });
    test('not at the Varrock west booth', () => {
        const { srv } = setup({ at: { x: 3210, z: 3424 } });
        expect(preconditions(at(srv))).toMatch(/^not at the Varrock west booth: at 3210,3424/);
    });
    test('no booth in view', () => {
        const { srv } = setup();
        expect(preconditions({ ...at(srv), nearbyLocs: [{ ...BOOTH_LOC, x: 3186, z: 3438 }] as BotWorldState['nearbyLocs'] })).toMatch(/no bank booth \(3186,3436\) in view/);
    });
    test('no bones banked, when the open bank shows none and none are held', () => {
        const { srv } = setup({ bank: [{ id: COINS, count: 5 }] });
        srv.bankOpen = true;
        expect(preconditions(at(srv))).toMatch(/^no bones banked/);
        srv.bank.push({ id: DRAGON, count: 3 });
        expect(preconditions(at(srv))).toBe(true);
    });
    test('the free-slot rule: 28 free at the first withdrawal, the bones themselves not counted', () => {
        const { srv } = setup({ held: [{ id: DRAGON_NOTE, count: 400 }, { id: DRAGON, count: 5 }, { id: COINS, count: 100 }] });
        expect(preconditions(at(srv))).toMatch(/1 other items \(Coins\): the first withdrawal needs 28 free slots and would have 27/);
        // a ledger row that asks for less
        expect(preconditions(at(srv), { freeSlots: 27 })).toBe(true);
    });
    test('bad options refuse, never throw', () => {
        const { srv } = setup();
        expect(preconditions(at(srv), { take: ['ashes'] })).toMatch(/unknown bone type/);
        expect(preconditions(at(srv), { untilLevel: 120 })).toMatch(/untilLevel 120/);
        expect(preconditions(at(srv), { bones: -1 })).toMatch(/bones -1/);
        expect(preconditions({ ...at(srv), player: null })).toBe('not in game');
    });
    test('a level already reached is a no-op anywhere', () => {
        const { srv } = setup({ level: 99, at: { x: 3000, z: 3000 } });
        expect(preconditions(at(srv))).toBe(true);
    });
});

// ---------------------------------------------------------------- the loop

describe('the load loop', () => {
    test('two full loads from level 1: 58 ticks bank open to bank open, every bury 2 ticks inside a load', async () => {
        const { sdk, srv } = setup({ bank: [{ id: DRAGON, count: 56 }] });
        const r: BoothReport = await run(srv, buryAtBooth(sdk as never));
        expect(r.buried).toBe(56);
        expect(r.byType).toEqual({ 'Dragon bones': 56 });
        expect(r.loads).toEqual([28, 28]);
        expect(r.stop).toBe('exhausted');
        // the third visit finds the stock gone
        expect(r.bankOpens).toHaveLength(3);
        expect(r.cycleTicks).toEqual([58, 58]);
        expect(r.ticksPerInventory).toBe(58);
        const gaps = srv.buryTicks.slice(1).map((t, i) => t - srv.buryTicks[i]!);
        expect(gaps.filter(g => g === 2)).toHaveLength(54);
        // the one bank gap: last xp to next xp is 4 (prayer.md section 4)
        expect(gaps.filter(g => g !== 2)).toEqual([4]);
        expect(srv.dropped.page).toBe(0);
        expect(srv.dropped.bank).toBe(0);
        // withdraw and close leave in the same tick
        for (const open of srv.bankOpenTicks.slice(0, 2)) expect(srv.sendsOn(open)).toEqual(['sendBankWithdraw', 'sendCloseModal']);
        expect(r.eventPeak).toBeLessThanOrEqual(5);
        expect(r.boothClicks).toBe(3);
        expect(srv.inv.every(x => !x)).toBe(true);
        expect(srv.bankOpen).toBe(false);
    });

    test('level-up pages during a bury burst: Continue then Bury on the page tick, no tick lost', async () => {
        const { sdk, srv } = setup({ bank: [{ id: DRAGON, count: 28 }] });
        const r = await run(srv, buryAtBooth(sdk as never));
        expect(srv.pages).toBeGreaterThan(20);
        expect(r.levelUps).toBe(srv.pages);
        // every page is answered on the tick it shows, ahead of that tick's Bury or booth click
        for (const t of srv.buryTicks) {
            const sends = srv.sendsOn(t);
            if (!sends.includes('sendClickDialog')) continue;
            expect(sends[0]).toBe('sendClickDialog');
            expect(sends.slice(1).every(m => m === 'sendUseItem' || m === 'sendInteractLoc')).toBe(true);
        }
        expect(srv.dropped.page).toBe(0);
        const gaps = srv.buryTicks.slice(1).map((t, i) => t - srv.buryTicks[i]!);
        expect(gaps.every(g => g === 2)).toBe(true);
        // a level-up on the last bone: the booth still opens 2 ticks after it
        expect(r.cycleTicks).toEqual([58]);
    });

    test('untilLevel: the last load takes only the bones it needs, and nothing is left in the pack', async () => {
        const { sdk, srv } = setup({ level: 1, bank: [{ id: DRAGON, count: 300 }] });
        const r = await run(srv, buryAtBooth(sdk as never, { untilLevel: 43 }));
        expect(r.buried).toBe(bonesToLevel(xpForLevel(1), 43));
        expect(r.level).toBe(43);
        expect(r.stop).toBe('level');
        expect(srv.inv.every(x => !x)).toBe(true);
        expect(srv.bank).toEqual([{ id: DRAGON, count: 300 - 11 }]);
    });

    test('a count: 30 bones as a full load and an exact 2, then stop', async () => {
        const { sdk, srv } = setup({ level: 99 - 40, bank: [{ id: DRAGON, count: 300 }] });
        const r = await run(srv, buryAtBooth(sdk as never, { bones: 30 }));
        expect(r.buried).toBe(30);
        expect(r.loads).toEqual([28, 2]);
        expect(r.stop).toBe('count');
        expect(srv.bank[0]!.count).toBe(270);
    });

    test('dragon first, then babydragon in the same load', async () => {
        const { sdk, srv } = setup({ level: 90, bank: [{ id: BABY, count: 10 }, { id: DRAGON, count: 20 }] });
        const r = await run(srv, buryAtBooth(sdk as never));
        expect(r.loads).toEqual([28, 2]);
        expect(r.byType).toEqual({ 'Dragon bones': 20, 'Babydragon bones': 10 });
    });

    test("the helper's noted stack held: banked on the first visit, withdrawn the next tick", async () => {
        const { sdk, srv } = setup({ held: [{ id: DRAGON_NOTE, count: 40 }] });
        const r = await run(srv, buryAtBooth(sdk as never));
        expect(r.buried).toBe(40);
        expect(r.loads).toEqual([28, 12]);
        expect(srv.sendsOn(srv.bankOpenTicks[0]!)).toEqual(['sendBankDeposit']);
        expect(srv.sendsOn(srv.bankOpenTicks[0]! + 1)).toEqual(['sendBankWithdraw', 'sendCloseModal']);
        // one tick more than a steady visit
        expect(r.cycleTicks[0]).toBe(59);
    });

    test('no bones banked: the first visit refuses (the closed bank hid it from the precondition)', async () => {
        const { sdk, srv } = setup({ bank: [{ id: COINS, count: 5 }] });
        await expect(run(srv, buryAtBooth(sdk as never))).rejects.toThrow(/^no bones banked/);
        await run(srv, Promise.resolve());
    });
});

// ---------------------------------------------------------------- the step: done, resume

describe('the step', () => {
    const obs = (srv: BoothServer, probed: Record<string, unknown> = {}) => ({ state: srv.state(), probed });

    test('done: Prayer at untilLevel, or no bones held and none banked (the open bank or the probe)', () => {
        const step = prayerStep({ untilLevel: 80 });
        const { srv } = setup({ level: 80 });
        expect(step.done!(obs(srv), {})).toBe(true);
        const low = setup({ level: 50 }).srv;
        expect(step.done!(obs(low, { boneBank: { bones: 0, byType: {} } }), {})).toBe(true);
        expect(step.done!(obs(low, { boneBank: { bones: 12, byType: {} } }), {})).toBe(false);
        // unknown bank: not done
        expect(step.done!(obs(low, { boneBank: null }), {})).toBe(false);
        low.bankOpen = true;
        expect(step.done!(obs(low), {})).toBe(true);
        const held = setup({ level: 50, held: [{ id: DRAGON, count: 3 }] }).srv;
        expect(step.done!(obs(held, { boneBank: { bones: 0, byType: {} } }), {})).toBe(false);
    });

    test('resume mid-stock: the walk finds it in progress, the pack is buried first, then the bank', async () => {
        const { sdk, srv } = setup({ level: 60, held: [{ id: DRAGON, count: 13 }], bank: [{ id: DRAGON, count: 20 }] });
        const s = steps();
        const o = new Observation(srv.state(), { boneBank: async () => ({ bones: 20, byType: { 'Dragon bones': 20 } }) }, session(sdk));
        const point = await resolveResume(s, o, {});
        expect(point.mode).toBe('resume');
        const log = TickLog.memory();
        await run(srv, runSteps(session(sdk), s, { log, c: {}, startMode: 'resume', observed: o, ...noStop }));
        const note = log.rows.find(r => r.kind === 'note' && r.step === 'S25b:booth')!.meta as unknown as BoothReport;
        expect(note.buried).toBe(33);
        expect(note.loads).toEqual([20]);
        // the 13 held went first: the first bank visit comes after them
        expect(srv.bankOpenTicks[0]! - 100).toBeGreaterThanOrEqual(13 * 2);
        expect(srv.inv.every(x => !x)).toBe(true);
        expect(log.rows.some(r => !r.kind && r.step === STEP_NAME && r.ok)).toBe(true);
    });

    test('runSteps refuses before any click when the account is not at the booth', async () => {
        const { sdk, srv } = setup({ at: { x: 3210, z: 3424 }, bank: [{ id: DRAGON, count: 28 }] });
        const log = TickLog.memory();
        const err = await run(srv, runSteps(session(sdk), steps(), { log, c: {}, ...noStop }).then(() => null, e => e));
        expect(err).toBeInstanceOf(StepError);
        expect((err as StepError).phase).toBe('precondition');
        expect((err as StepError).detail).toMatch(/not at the Varrock west booth/);
        expect(srv.log).toHaveLength(0);
    });

    test('steps({to}) carries the rehearsal harness --to as untilLevel', () => {
        const { srv } = setup({ level: 40 });
        expect(steps({ to: 40 })[0]!.done!(obs(srv), {})).toBe(true);
        expect(steps({ to: 41 })[0]!.done!(obs(srv, { boneBank: { bones: 5, byType: {} } }), {})).toBe(false);
    });
});

describe('buryHeld: the bones held, at the engine rate, never a click into the bury delay (rs/700)', () => {
    const pack = (n: number, prayer = 50, extra: string[] = ['Rune axe', 'Knife', 'Logs']) => {
        const names = [...extra, ...Array.from({ length: n }, () => 'Dragon bones')];
        return baseState({
            tick: 1000,
            skills: [{ name: 'Prayer', level: prayer, baseLevel: prayer, experience: 0 }],
            inventory: names.map((name, slot) => ({ slot, id: name === 'Dragon bones' ? DRAGON : 2000 + slot, name, count: 1, optionsWithIndex: name === 'Dragon bones' ? [{ text: 'Bury', opIndex: 1 }] : [] }))
        });
    };
    const bonesLeft = (sdk: FakeSdk) => sdk.getState()!.inventory.filter(i => /bones$/i.test(i.name)).length;
    const gaps = (ts: number[]) => ts.slice(1).map((t, i) => t - ts[i]!);

    test('bury_bone.rs2 is p_delay(0) and OpHeldHandler drops a delayed click: the engine facts the loop is built on', () => {
        expect(read('server/content/scripts/skill_prayer/scripts/bury_bone.rs2')).toMatch(/p_delay\(0\);[\s\S]*inv_delslot\(inv, \$slot\)/);
        expect(read('server/engine/src/engine/script/handlers/PlayerOps.ts')).toContain('delayedUntil = World.currentTick + 1 + check(state.popInt(), NumberNotNull)');
        expect(read('server/engine/src/network/game/client/handler/OpHeldHandler.ts')).toMatch(/if \(player\.delayed\) \{\s*\/\/ normal: cannot interact while delayed\s*return false;/);
    });

    test('a round trip inside a tick: 23 bones, one every 2 ticks, 23 clicks, every click taken (none landed in the delay)', async () => {
        const sdk = new FakeSdk(pack(23));
        const sim = simulateBurying(sdk, { latency: 1 });
        const r = await drive(sdk, buryHeld(sdk, /bones$/i), 200);
        expect([r.buried, r.sends, r.resends, r.stop]).toEqual([23, 23, 0, 'none']);
        expect(bonesLeft(sdk)).toBe(0);
        expect(sim.clicks.every(c => c.accepted)).toBe(true);
        expect(new Set(gaps(sim.buried))).toEqual(new Set([2]));
        expect(gaps(r.buryTicks).every(g => g === 2)).toBe(true);
        // the first Bury lands on 1001 and its bone goes on 1002; the last of 23 on 1046
        expect([sim.buried[0], sim.buried.at(-1), r.endTick - r.startTick]).toEqual([1002, 1046, 46]);
        // the kit is never clicked
        expect(sim.clicks.every(c => c.slot >= 3)).toBe(true);
    });

    test('a slower round trip (2 ticks) costs a tick a bone, and still no click lands in the delay', async () => {
        const sdk = new FakeSdk(pack(10));
        const sim = simulateBurying(sdk, { latency: 2 });
        const r = await drive(sdk, buryHeld(sdk, /bones$/i), 200);
        expect([r.buried, r.sends, r.resends]).toEqual([10, 10, 0]);
        expect(sim.clicks.every(c => c.accepted)).toBe(true);
        expect(new Set(gaps(sim.buried))).toEqual(new Set([3]));
    });

    test('the blind every-frame click would land in the delay: the model drops it, which is what buryHeld never sends', async () => {
        const sdk = new FakeSdk(pack(4));
        const sim = simulateBurying(sdk, { latency: 1 });
        const p = (async () => {
            while (bonesLeft(sdk)) {
                const b = sdk.getState()!.inventory.find(i => /bones$/i.test(i.name))!;
                void sdk.sendUseItem(b.slot, 1);
                await new Promise<void>(r => { const off = sdk.onStateUpdate(() => { off(); r(); }); });
            }
        })();
        await drive(sdk, p, 100);
        expect(sim.clicks.filter(c => !c.accepted).length).toBeGreaterThan(0);
        expect(new Set(gaps(sim.buried))).toEqual(new Set([2]));
    });

    test(`a lost click is sent again after ${BURY_RESEND} unanswered frames, once`, async () => {
        const sdk = new FakeSdk(pack(3));
        const sim = simulateBurying(sdk, { latency: 1, accept: n => n !== 0 });
        const r = await drive(sdk, buryHeld(sdk, /bones$/i), 100);
        expect([r.buried, r.sends, r.resends]).toEqual([3, 4, 1]);
        expect(sim.clicks.map(c => c.accepted)).toEqual([false, true, true, true]);
        expect(sim.clicks[1]!.sent - sim.clicks[0]!.sent).toBe(BURY_RESEND);
    });

    test(`a server that takes nothing: stalled after ${BURY_STALL} unanswered Burys, bones still held`, async () => {
        const sdk = new FakeSdk(pack(5));
        simulateBurying(sdk, { accept: () => false });
        const r = await drive(sdk, buryHeld(sdk, /bones$/i), 100);
        expect([r.stop, r.buried, r.sends]).toEqual(['stalled', 0, BURY_STALL]);
        expect(r.endTick - r.startTick).toBe(BURY_STALL * BURY_RESEND);
        expect(bonesLeft(sdk)).toBe(5);
    });

    test('keepOn and untilLevel stop it on the frame they say so, with no click after; an empty pack returns at once', async () => {
        const sdk = new FakeSdk(pack(20, 50));
        const sim = simulateBurying(sdk, { prayer: n => (n >= 6 ? 51 : null) });
        const r = await drive(sdk, buryHeld(sdk, /bones$/i, { untilLevel: 51 }), 100);
        expect([r.stop, r.buried, r.sends]).toEqual(['level', 6, 6]);
        expect(sim.clicks).toHaveLength(6);
        expect(bonesLeft(sdk)).toBe(14);

        const k = new FakeSdk(pack(20, 50));
        simulateBurying(k);
        const kr = await drive(k, buryHeld(k, /bones$/i, { keepOn: s => s.inventory.filter(i => /bones$/i.test(i.name)).length > 12 }), 100);
        expect([kr.stop, kr.buried]).toEqual(['target', 8]);

        const e = new FakeSdk(pack(0));
        const er = await buryHeld(e, /bones$/i);
        expect([er.stop, er.buried, er.sends, e.sent.length]).toEqual(['none', 0, 0, 0]);
    });

    test('an abort ends it at once', async () => {
        const sdk = new FakeSdk(pack(20));
        simulateBurying(sdk);
        const stop = new AbortController();
        const p = buryHeld(sdk, /bones$/i, { signal: stop.signal });
        sdk.tick();
        sdk.tick();
        stop.abort();
        const r = await p;
        expect(r.stop).toBe('aborted');
        expect(r.buried).toBeLessThanOrEqual(1);
    });
});
