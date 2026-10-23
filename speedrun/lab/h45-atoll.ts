// One-off: take cairn_h45 (H12o, the atoll helper; docs/speedrun/helpers/mule.md) from the Grand Tree to P's tile
// (2803,2724,0) on Ape Atoll in ONE login, holding exactly its H12o package, and log it out there. rs/613.
//
//   bun speedrun/lab/h45-atoll.ts <account> --package=<mule-ledger --carried-h45 json> --ctl=<dir>
//       [--donor=cairn_h01] [--fleet-account] [--lab] [--auto]
//
// Phases, in order; each stops the script (fail closed: a confirmed logout where it stands) on any surprise:
//   journal  the Monkey Madness journal must show 'Chapter 2:' (JOURNAL_MARKS' G mark: mm_main past G) before
//            anything moves. Then the operator gate `go-bank`.
//   bank     into the Grand Tree, up to the first floor's bank (BANKS.gnomeStronghold), deposit the coins and the
//            five Grand Tree quest items by name; anything else unexpected in the pack stops it.
//   receive  down and out through the tree door and the Stronghold gate to GNOME_GATE_SOUTH; one trade from the
//            donor (the fleet's one-shot handover) wanting exactly the package's shortfall by id.
//   census   the package by id (every line's max summed) plus at most 3 other slots, mule.md's pack census.
//            Then the operator gate `go-travel`.
//   travel   back through the gate, up to Daero, then monkey-madness.ts's hangarRoute clicks (copied below; the
//            module stays byte-identical): Daero 'Yes' to the hangar, Waydar 'Yes' to Crash Island, Lumdo to the
//            landing. Then the landing to M's tile (2763,2704) and straight on, no wait, to P's tile.
//   park     exactly (2803,2724,0), the census again, a confirmed logout; the logout frame is printed.
//
// Gates: the script waits for the file <ctl>/go-<name>; <ctl>/abort at any gate logs out at once. --auto skips the
// gates (the lab check). Demo (default): the account's bot.env must carry a loopback GATEWAY_URL (tenet 12), a
// cairn_* account needs --fleet-account, and every chat line is refused (no staff command can be sent). --lab: the
// local lab engine only, where the lab harness has staged the stand-in; the script itself never sends a cheat.
// Credentials are never printed.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BotWorldState } from '../../sdk/types';
import { opLoc, talkTo, walkTo } from '../lib/act';
import { compactJournal, journalText, readQuestStage } from '../lib/quests';
import { closeSession, loadBotEnv, openSession, type Session } from '../lib/session';
import { receiveFrom } from '../lib/trade';
import { GNOME_STRONGHOLD_GATE, passGate, runTo } from '../lib/travel';
import { currentTick, waitTicks, waitUntil } from '../lib/wait';
import { chebyshev, pos } from '../lib/world';
import { AREAS, CRASH_ISLAND, HANGAR, inArea, JOURNAL_MARKS, MONKEY_CHATTER } from '../quests/monkey-madness';
import { arg, botArg, result } from './common';
import { startLoopbackGateway } from './loopback-gateway';
import { checkDemoTarget, refuseChat } from './quests/demo-quest';
import { confirmedLogout } from './quests/aereck-burst';

// monkey-madness.ts's places (233d0f34, :456-465), copied: they are not exported.
const GNOME_GATE_SOUTH = { x: 2461, z: 3382 };
const TREE_DOOR = { x: 2464, z: 3492 };
const TREE_DOOR_OUTSIDE = { x: 2465, z: 3490 };
const TREE_LADDER = { x: 2466, z: 3495 };
const DAERO = { x: 2484, z: 3487 };
/** buyer.ts BANKS.gnomeStronghold: the Grand Tree's first-floor bank. */
const STRONGHOLD_BANK = { x: 2449, z: 3482, level: 1 };
export const M_TILE = { x: 2763, z: 2704 };
export const P_TILE = { x: 2803, z: 2724, level: 0 };
const CHATTER = { interrupts: [MONKEY_CHATTER] } as const;

const COINS = 995;
/** The Grand Tree's leftovers rs/465 reported in h45's pack (names as observed; not package stock). */
export const GRAND_TREE_ITEMS = [/^Hazelmere's scroll$/i, /^Translation book$/i, /^Glough's journal$/i, /^Lumber order$/i, /^Glough's key$/i];
/** mule.md: the 25-slot package plus at most this many other slots. */
export const OTHER_SLOTS_MAX = 3;

type Sdk = Session['sdk'];
interface Ctx { sdk: Sdk; bot: Session['bot'] }

const where = (sdk: Sdk) => JSON.stringify(pos(sdk));
const inGrandTree = (sdk: Sdk) => {
    const p = pos(sdk);
    return p.x >= 2455 && p.x <= 2495 && p.z >= 3480 && p.z <= 3510 && (p.level > 0 || p.z >= 3493);
};
const inStronghold = (sdk: Sdk) => pos(sdk).z >= GNOME_STRONGHOLD_GATE.loc.z + 2 && pos(sdk).x < 2560 && pos(sdk).z < 3600;

/** The package's total by obj id: each line's `topUp.max` (or `amount`) summed over every package. */
export function packageTotals(entry: { options: { packages: Array<{ items: Array<{ id?: number; topUp?: { max: number }; amount?: number }> }> } }): Map<number, number> {
    const out = new Map<number, number>();
    for (const p of entry.options.packages) {
        for (const line of p.items) {
            if (line.id === undefined) throw new Error('package line without an id: generate it with mule-ledger.ts --carried-h45');
            const n = line.topUp?.max ?? line.amount;
            if (n === undefined) throw new Error(`package line ${line.id} has no max or amount`);
            out.set(line.id, (out.get(line.id) ?? 0) + n);
        }
    }
    return out;
}

export interface Census {
    ok: boolean;
    /** Slots used by package ids. */
    packageSlots: number;
    /** Slots used by anything else. */
    otherSlots: number;
    byId: Record<string, { name: string; count: number; slots: number }>;
    problems: string[];
}

/** mule.md's pack census: every package id held at exactly its total, unstacked (one slot each), plus at most 3 other slots. */
export function packCensus(inv: ReadonlyArray<{ id: number; name: string; count: number }>, totals: ReadonlyMap<number, number>): Census {
    const byId: Census['byId'] = {};
    for (const i of inv) {
        const e = (byId[String(i.id)] ??= { name: i.name, count: 0, slots: 0 });
        e.count += i.count;
        e.slots += 1;
    }
    const problems: string[] = [];
    let packageSlots = 0;
    for (const [id, want] of totals) {
        const e = byId[String(id)];
        const have = e?.count ?? 0;
        if (have !== want) problems.push(`id ${id}: holds ${have}, the package needs exactly ${want}`);
        if (e && e.slots !== e.count) problems.push(`id ${id}: ${e.count} in ${e.slots} slots (noted or stacked; the package is unstacked)`);
        packageSlots += e?.slots ?? 0;
    }
    const otherSlots = inv.filter(i => !totals.has(i.id)).length;
    if (otherSlots > OTHER_SLOTS_MAX) problems.push(`${otherSlots} other slots, at most ${OTHER_SLOTS_MAX}`);
    return { ok: problems.length === 0, packageSlots, otherSlots, byId, problems };
}

/** What the bank phase deposits, by slot, or why it refuses: coins and the five Grand Tree items; package ids stay; anything else stops it. */
export function bankPlan(inv: ReadonlyArray<{ id: number; name: string; slot: number }>, keep: ReadonlySet<number>): { deposit: number[]; unexpected: string[] } {
    const deposit: number[] = [];
    const unexpected: string[] = [];
    for (const i of inv) {
        if (keep.has(i.id)) continue;
        if (i.id === COINS || GRAND_TREE_ITEMS.some(re => re.test(i.name))) deposit.push(i.slot);
        else unexpected.push(`${i.name} @${i.id}`);
    }
    return { deposit, unexpected };
}

function frame(s: BotWorldState) {
    const p = s.player!;
    return {
        tick: s.tick,
        tile: [p.worldX, p.worldZ, p.level],
        hp: [s.skills.find(k => /hitpoints/i.test(k.name))?.level, s.skills.find(k => /hitpoints/i.test(k.name))?.baseLevel],
        inventory: s.inventory.map(i => ({ slot: i.slot, id: i.id, name: i.name, count: i.count })),
        equipment: s.equipment.map(i => ({ id: i.id, name: i.name, count: i.count })),
    };
}

// ------------------------------------------------------------------ monkey-madness.ts's clicks, copied (233d0f34)

async function go(ctx: Ctx, to: { x: number; z: number }, tol = 0): Promise<void> {
    const r = await walkTo(ctx.bot, ctx.sdk, to.x, to.z, tol);
    if (!r.ok) throw new Error(`walk to ${to.x},${to.z} failed at ${where(ctx.sdk)}: ${r.message}`);
}

/** monkey-madness.ts climb (:1035-1048) without its shark top-up (h45 eats nothing on the way: its sharks are the package). */
async function climb(sdk: Sdk, at: { x: number; z: number }, op: RegExp): Promise<void> {
    const p0 = pos(sdk);
    const r = await opLoc(sdk, { ...at, op, radius: 15 }, op, s => pos(s).level !== p0.level, { resendEvery: 5, maxTicks: 30, ...CHATTER });
    if (!r.ok) throw new Error(`${r.loc.name} at ${at.x},${at.z} did not move the player (at ${where(sdk)})`);
}

/** monkey-madness.ts intoTree (:1670-1686): through the Grand Tree's door if outside, then the trunk ladder to `level`. */
async function intoTree(ctx: Ctx, level: number): Promise<void> {
    const { sdk } = ctx;
    if (!inGrandTree(sdk)) {
        const r = await runTo(sdk, { ...TREE_DOOR_OUTSIDE, tol: 1 }, { bot: ctx.bot });
        if (!r.ok) throw new Error(`run to the Grand Tree's door stopped at ${where(sdk)}: ${r.reason}`);
        const d = await opLoc(sdk, { ...TREE_DOOR, op: /^open$/i, radius: 6 }, /^open$/i, s => pos(s).z >= TREE_DOOR.z + 1, { resendEvery: 5, maxTicks: 20, ...CHATTER });
        if (!d.ok) throw new Error(`the Grand Tree's door did not let the player in (at ${where(sdk)})`);
    }
    for (let i = 0; i < 4 && pos(sdk).level !== level; i++) {
        const up = pos(sdk).level < level;
        if (chebyshev(pos(sdk), TREE_LADDER) > 3) await go(ctx, TREE_LADDER, 2);
        await climb(sdk, TREE_LADDER, up ? /^climb-up$/i : /^climb-down$/i);
    }
    if (pos(sdk).level !== level) throw new Error(`not on the Grand Tree's level ${level} (at ${where(sdk)})`);
}

/** monkey-madness.ts hangarRoute (:1695-1711), verbatim but for its Ctx: each hop's arrival checked by area, never by the talk's return. */
export async function hangarRoute(ctx: Ctx, toDaero: () => Promise<void>): Promise<void> {
    const { sdk } = ctx;
    const hop = async (label: string, npc: RegExp, choices: RegExp[], arrived: (s: BotWorldState) => boolean, opts: Record<string, unknown>) => {
        const r = await talkTo(sdk, npc, choices, { maxTicks: 120, ...opts, until: arrived, ...CHATTER });
        if (!arrived(sdk.getState()!)) throw new Error(`${label}: ${r.reason ?? r.transcript.slice(-2).join(' / ')} (at ${where(sdk)})`);
    };
    if (!inArea(sdk, AREAS.atoll) && !inArea(sdk, HANGAR) && !inArea(sdk, CRASH_ISLAND)) {
        await toDaero();
        await hop('Daero did not take the player to the hangar', /^Daero$/i, [/^Yes$/], s => inArea(s, HANGAR), { idle: 4, near: DAERO });
    }
    if (inArea(sdk, HANGAR)) await hop('Waydar did not fly to Crash Island', /^Waydar$/i, [/^Yes$/], s => inArea(s, CRASH_ISLAND), { idle: 4, closeModals: false });
    if (inArea(sdk, CRASH_ISLAND)) await hop('Lumdo did not sail to the atoll', /^Lumdo$/i, [], s => inArea(s, AREAS.atoll), { idle: 2 });
}

// ------------------------------------------------------------------ phases

async function gate(name: string, ctl: string, auto: boolean, sdk: Sdk): Promise<void> {
    if (auto) return;
    console.log(`GATE ${name}: waiting for ${join(ctl, `go-${name}`)} (or ${join(ctl, 'abort')})`);
    for (;;) {
        if (existsSync(join(ctl, 'abort'))) throw new Error(`operator abort at gate ${name}`);
        if (existsSync(join(ctl, `go-${name}`))) return;
        if (!sdk.getState()?.inGame) throw new Error(`the session dropped at gate ${name}`);
        await new Promise(r => setTimeout(r, 1000));
    }
}

/** The quest journal must show 'Chapter 2:' (mm_main past G). */
export const CHAPTER_2 = JOURNAL_MARKS.find(([letter, phrase]) => letter === 'G' && /^Chapter 2:/.test(phrase))![1];

async function journalPhase(sdk: Sdk): Promise<string> {
    const read = await readQuestStage(sdk, 'mm', { force: true });
    const text = journalText({ state: sdk.getState()!, probed: { 'journal:mm': read.journal } } as never, 'mm') ?? (read.journal ? compactJournal(read.journal.lines.join('')) : null);
    if (!read.journal || text === null) throw new Error(`the Monkey Madness journal did not open (reading ${JSON.stringify(read.reading)})`);
    const found = text.includes(compactJournal(CHAPTER_2));
    const line = read.journal.lines.find(l => compactJournal(l).includes(compactJournal(CHAPTER_2))) ?? null;
    result('h45_journal', { found, line, stage: read.reading?.stage ?? null, lines: read.journal.lines.length });
    if (!found) throw new Error(`'${CHAPTER_2}' is not in the Monkey Madness journal: mm_main is not past G`);
    return line ?? CHAPTER_2;
}

async function bankPhase(ctx: Ctx, keep: ReadonlySet<number>): Promise<void> {
    const { sdk, bot } = ctx;
    const plan0 = bankPlan(sdk.getState()!.inventory, keep);
    if (plan0.unexpected.length) throw new Error(`unexpected items in the pack, not banked: ${plan0.unexpected.join(', ')}`);
    await intoTree(ctx, STRONGHOLD_BANK.level);
    if (chebyshev(pos(sdk), STRONGHOLD_BANK) > 2) await go(ctx, STRONGHOLD_BANK, 2);
    const o = await bot.openBank();
    if (!o.success) throw new Error(`the Stronghold bank did not open: ${o.message} (at ${where(sdk)})`);
    const plan = bankPlan(sdk.getState()!.inventory, keep);
    const ids = new Set(plan.deposit.map(slot => sdk.getState()!.inventory.find(i => i.slot === slot)!.id));
    for (const slot of plan.deposit) await sdk.sendBankDeposit(slot, -1);
    const d = await waitUntil(sdk, s => !s.inventory.some(i => ids.has(i.id)), { maxTicks: 20 });
    await bot.closeBank();
    if (!d.ok) throw new Error(`the deposit did not clear ${[...ids].join(', ')}`);
    result('h45_banked', { ids: [...ids], inventory: frame(sdk.getState()!).inventory });
}

async function outToGate(ctx: Ctx): Promise<void> {
    const { sdk } = ctx;
    for (let i = 0; i < 4 && pos(sdk).level > 0; i++) {
        if (chebyshev(pos(sdk), TREE_LADDER) > 3) await go(ctx, TREE_LADDER, 2);
        await climb(sdk, TREE_LADDER, /^climb-down$/i);
    }
    if (inGrandTree(sdk)) {
        const d = await opLoc(sdk, { ...TREE_DOOR, op: /^open$/i, radius: 6 }, /^open$/i, s => pos(s).z <= TREE_DOOR.z - 1, { resendEvery: 5, maxTicks: 20, ...CHATTER });
        if (!d.ok) throw new Error(`the Grand Tree's door did not let the player out (at ${where(sdk)})`);
    }
    if (inStronghold(sdk)) {
        const g = await passGate(sdk, GNOME_STRONGHOLD_GATE, GNOME_STRONGHOLD_GATE.sides.south);
        if (!g.ok) throw new Error(`the Stronghold gate (out): ${g.reason} (at ${where(sdk)})`);
    }
    const r = await runTo(sdk, { ...GNOME_GATE_SOUTH, tol: 1 }, { bot: ctx.bot });
    if (!r.ok) throw new Error(`run to the gate's south tile stopped at ${where(sdk)}: ${r.reason}`);
}

async function receivePhase(ctx: Ctx, donor: string, need: Map<number, number>): Promise<void> {
    const { sdk } = ctx;
    const want = [...need].filter(([, n]) => n > 0).map(([id, n]) => ({ item: id, amount: n }));
    if (!want.length) {
        result('h45_received', { donor, skipped: 'nothing short' });
        return;
    }
    console.log(`AT THE GATE ${where(sdk)}: waiting for ${donor}'s trade, wanting ${JSON.stringify(want)}`);
    const r = await receiveFrom(sdk, donor, { want, openTimeoutMs: 40 * 60_000, maxTicks: 150 });
    result('h45_received', { donor, ok: r.ok, reason: r.reason ?? null, received: r.received, at: pos(sdk) });
    if (!r.ok) throw new Error(`the trade from ${donor} did not complete: ${r.reason}`);
}

async function travelPhase(ctx: Ctx): Promise<void> {
    const { sdk } = ctx;
    const t0 = currentTick(sdk);
    const legs: Record<string, number> = {};
    let mark = t0;
    const leg = (name: string) => {
        const now = currentTick(sdk);
        legs[name] = now - mark;
        mark = now;
        console.log(`  leg ${name}: ${legs[name]} ticks, at ${where(sdk)}`);
    };
    await hangarRoute(ctx, async () => {
        if (!inStronghold(sdk) && !inGrandTree(sdk)) {
            const r = await runTo(sdk, { ...GNOME_GATE_SOUTH, tol: 2 }, { bot: ctx.bot });
            if (!r.ok) throw new Error(`run to the Gnome Stronghold's gate stopped at ${where(sdk)}: ${r.reason}`);
            const g = await passGate(sdk, GNOME_STRONGHOLD_GATE, GNOME_STRONGHOLD_GATE.sides.north);
            if (!g.ok) throw new Error(`the Stronghold gate (in): ${g.reason} (at ${where(sdk)})`);
        }
        await intoTree(ctx, 1);
        if (chebyshev(pos(sdk), DAERO) > 3) await go(ctx, DAERO, 2);
        leg('to Daero');
    });
    leg('Daero, Waydar, Lumdo');
    if (!inArea(sdk, AREAS.atoll)) throw new Error(`not on the atoll after Lumdo (at ${where(sdk)})`);
    // Through M's tile without stopping: spiders there hit a waiting helper.
    await go(ctx, M_TILE, 1);
    leg('landing to M');
    for (let i = 0; i < 3 && (pos(sdk).x !== P_TILE.x || pos(sdk).z !== P_TILE.z); i++) await go(ctx, P_TILE, 0);
    leg('M to P');
    result('h45_travel', { ticks: currentTick(sdk) - t0, legs, at: pos(sdk) });
}

function mustBeOnP(sdk: Sdk): void {
    const p = pos(sdk);
    if (p.x !== P_TILE.x || p.z !== P_TILE.z || p.level !== P_TILE.level) throw new Error(`not on P's tile: at ${where(sdk)}`);
}

async function main(): Promise<void> {
    const account = botArg();
    const lab = process.argv.includes('--lab');
    const auto = process.argv.includes('--auto');
    if (auto && !lab) throw new Error('--auto (no operator gates) is for the lab check only');
    const fleetAccount = process.argv.includes('--fleet-account');
    const donor = arg('donor', '');
    const ctl = arg('ctl', '');
    if (!ctl && !auto) throw new Error('--ctl=<dir> is required for the operator gates');
    const entry = JSON.parse(readFileSync(arg('package', ''), 'utf8'));
    if (entry.account !== 'cairn_h45') throw new Error(`the package is ${entry.account}'s, not cairn_h45's`);
    const totals = packageTotals(entry);
    const keep = new Set(totals.keys());
    checkDemoTarget(loadBotEnv(account), { lab, fleetAccount });
    console.log(`h45-atoll: ${account} (${lab ? 'lab' : 'demo'}), package ${JSON.stringify([...totals])}, donor ${donor || '(none)'}`);

    const gateway = lab ? null : await startLoopbackGateway(account, 'h45-atoll');
    let exit = 1;
    try {
        const session = await openSession(account, { launch: true, readyTimeoutMs: 180_000 });
        const allow = refuseChat(session.sdk as unknown as { sendSay(m: string): Promise<unknown> });
        const ctx: Ctx = { sdk: session.sdk, bot: session.bot };
        const { sdk } = session;
        let phase = 'login';
        try {
            result('h45_login_frame', frame(sdk.getState()!));
            phase = 'journal';
            await journalPhase(sdk);
            await gate('bank', ctl, auto, sdk);
            phase = 'bank';
            await bankPhase(ctx, keep);
            phase = 'receive';
            const held = new Map<number, number>();
            for (const i of sdk.getState()!.inventory) held.set(i.id, (held.get(i.id) ?? 0) + i.count);
            const need = new Map([...totals].map(([id, n]) => [id, n - (held.get(id) ?? 0)] as [number, number]));
            if ([...need.values()].some(n => n < 0)) throw new Error(`h45 holds more than the package: ${JSON.stringify([...need])}`);
            if ([...need.values()].some(n => n > 0)) {
                if (!donor) throw new Error(`short ${JSON.stringify([...need])} and no --donor`);
                await outToGate(ctx);
                await receivePhase(ctx, donor, need);
            }
            phase = 'census';
            const c = packCensus(sdk.getState()!.inventory, totals);
            result('h45_census', { at: pos(sdk), ...c });
            if (!c.ok) throw new Error(`pack census FAILS: ${c.problems.join('; ')}`);
            await gate('travel', ctl, auto, sdk);
            phase = 'travel';
            await travelPhase(ctx);
            phase = 'park';
            mustBeOnP(sdk);
            await waitTicks(sdk, 1);
            const c2 = packCensus(sdk.getState()!.inventory, totals);
            result('h45_census_at_P', { at: pos(sdk), ...c2 });
            if (!c2.ok) throw new Error(`pack census at P FAILS: ${c2.problems.join('; ')}`);
            exit = 0;
        } catch (e) {
            result('h45_stopped', { phase, error: e instanceof Error ? e.message : String(e), at: pos(sdk) });
        } finally {
            allow();
            const last = sdk.getState();
            try {
                const lo = await confirmedLogout(session, { timeoutMs: 120_000 });
                result('h45_logout_frame', { ...(last ? frame(last) : {}), confirmedBy: lo.confirmedBy, latencyTicks: lo.latencyTicks });
            } catch (e) {
                result('h45_logout_failed', { reason: e instanceof Error ? e.message : String(e), ...(last ? frame(last) : {}) });
                exit = 2;
            }
            await closeSession(session);
        }
    } finally {
        gateway?.kill('SIGTERM');
    }
    process.exit(exit);
}

if (import.meta.main) await main();
