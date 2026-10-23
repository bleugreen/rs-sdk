#!/usr/bin/env bun
// The twin dress rehearsal: run.ts's chain on a throwaway on the demo, with the
// real helpers on the rehearsal machine, and a rehearsal-only substitution file for the rows the
// parallel helper set (attempts 2-3's stock) cannot serve as the inventory ledger writes them. run.ts
// itself is unchanged: this driver runs run.ts's own start gates and session runner
// (startGates, runChainOnSession) on a chain built from a rewritten ledger and then transformed.
//
//   SPEEDRUN_TICK_MS=400 bun speedrun/lab/twin-rehearsal.ts --substitute=<json> <run.ts flags...>
//
// The substitution file (every key optional):
//   ledger:  { "<row>": { "replace": { "<item>": "<item>" }, "drop": ["<item>"], "in": "<ledger in cell>" } }
//            rewrites the ledger text the chain's hand-offs read: H4k's axe (replace), H7's amulet (drop,
//            from the row's in and equip cells), H3's rings (in: the rune package).
//   S03:     { "walkTo": { "x": .., "z": .. } }  a run to the dropper row's entry before S03 (the
//            rehearsal row is not beside the coop, where T02-03 ends).
//   S04:     "teleport-xp"  S04's ring loads replaced by H3's (rewritten) hand-off from the S04 giver
//            (cfg.rings.giver) and a step that Wind Strikes the coop chickens to Magic 25 and casts
//            Varrock, Falador and Camelot teleports to 59, keeping one law rune for T04-05.
//   H7 dropping the amulet of magic also replaces S10b's A-kit segment with one that does not want it.
//   S07: 'babydragon' uses the rehearsal's five bone loads and does not require Prayer 99.
//
// Every substituted step is named `SUBSTITUTE ...` and writes a `(substitute) ...` note row, so the
// report keeps it out of the measured columns. The driver refuses (exit 3, nothing logged in) for a
// fleet, forbidden or scored login, with no claim owner or the run's own (run, host), and without a
// substitution file: it is never the scored run's path.

import { readFileSync } from 'fs';
import { join } from 'path';
import type { ActionResult, BotWorldState } from '../../sdk/types';
import { canonName, cueDir as defaultCueDir } from '../helpers/altar-cue';
import { FORBIDDEN_ACCOUNTS } from '../helpers/fleet-config';
import { annotation } from '../lib/attempt';
import { claimBin, claimOwner, ReservationWatch, reservationPath, claimToucher } from '../lib/host-reservation';
import { describePreflight } from '../lib/feed-hello';
import type { TickMsParse } from '../lib/run-floor';
import { closeSession, loadBotEnv, openSession, ROOT, type Session } from '../lib/session';
import { newRunId, parseLog, TickLog, type TickRow } from '../lib/ticks';
import { act, settle, TELEPORTS } from '../lib/act';
import { onStates, tickMs, waitUntil } from '../lib/wait';
import { runTo, teleport, teleportRefusal } from '../lib/travel';
import { baseToXp, levelForXp, xpForLevel, XP_RATE } from '../lib/xp';
import { aliasAccount, EXIT_REFUSED, hostGateIO, LOG_ACCOUNT, loadRunConfig, parseArgs, runChainOnSession, startGates, tickBeforeLogin, UsageError } from '../run';
import { buildChain, censused, chainProbes, muleCued, muleCueDir, noteRow, resolveFrom, sliceUntil, tag, type ChainStep, type CueSink, type RunConfig } from '../runner/chain';
import { RunCues, prepareCueDir } from '../runner/cue-keeper';
import { patchMethod } from '../runner/fence';
import { inRoom } from '../skills/runecraft';
import { steps as woodcuttingSteps } from '../skills/woodcutting';
import { steps as agilitySteps } from '../skills/agility';
import { handOffFrom, handOffStep } from '../runner/handoff';
import { formatRunReport, runReport } from '../runner/run-report';
import type { StepContext } from '../runner/step';
import { magicLevel, magicXp, strikeTo, type StrikeSdk } from '../skills/magic';
import { MANIFEST } from '../tools/slot-ledger';
import { H7, ITEM } from '../quests/tree-gnome-village';
import { dropMatching } from './setup';

export const SUBSTITUTE = 'SUBSTITUTE';

export interface LedgerSub {
    replace?: Readonly<Record<string, string>>;
    drop?: readonly string[];
    /** The whole `in` cell, for a row whose items change outright (H3's rings to runes). */
    in?: string;
}

export interface Substitutions {
    ledger?: Readonly<Record<string, LedgerSub>>;
    S03?: { walkTo: { x: number; z: number } };
    S04?: 'teleport-xp';
    /** Five rehearsal loads, not the scored run's dragon bones or Prayer 99. */
    S07?: 'babydragon';
    /** The tree's climb still needs 25 when H8 has no agility potion. */
    S11a?: 25;
}

const lower = (s: string) => s.trim().toLowerCase();
/** An entry's item name: the text before its ` xN` count. */
const entryName = (e: string) => lower(e.replace(/\s+x\d+\b.*$/i, ''));

/**
 * The ledger text with each row rewritten as `subs` says. Throws when a row, or an item it names, is
 * not there: a substitution that silently matches nothing would run the ledger's own row.
 */
export function applyLedgerSubs(manifest: string, subs: Readonly<Record<string, LedgerSub>>): string {
    const lines = manifest.split('\n');
    for (const [row, sub] of Object.entries(subs)) {
        const at = lines.findIndex(l => l.startsWith(`| ${row} |`));
        if (at < 0) throw new Error(`substitute ${row}: no such row in the inventory ledger`);
        const cells = lines[at]!.split(' | ');
        // cells: '| row', in, out, equip, need, source...
        if (cells.length < 6) throw new Error(`substitute ${row}: line ${at + 1} has ${cells.length} cells`);
        if (sub.in !== undefined) cells[1] = sub.in;
        for (const [from, to] of Object.entries(sub.replace ?? {})) {
            const entries = cells[1]!.split('; ');
            const i = entries.findIndex(e => entryName(e) === lower(from));
            if (i < 0) throw new Error(`substitute ${row}: no ${from} in its in cell`);
            entries[i] = entries[i]!.replace(new RegExp(`^${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), lower(to));
            cells[1] = entries.join('; ');
        }
        for (const item of sub.drop ?? []) {
            const entries = cells[1]!.split('; ');
            const kept = entries.filter(e => entryName(e) !== lower(item));
            if (kept.length === entries.length) throw new Error(`substitute ${row}: no ${item} in its in cell`);
            cells[1] = kept.join('; ');
            const equip = cells[3]!.split('; ').filter(e => lower(e) !== `+${lower(item)}`);
            cells[3] = equip.length ? equip.join('; ') : '-';
            const need = Number(cells[4]);
            if (Number.isInteger(need) && need > 0) cells[4] = String(need - (entries.length - kept.length));
        }
        lines[at] = cells.join(' | ');
    }
    return lines.join('\n');
}

/** Why this login or claim may not run a substituted chain (null when it may). */
export function substituteRefusal(login: string, owner: string | undefined, subs: Substitutions | null): string | null {
    if (!subs || !Object.keys(subs).length) return 'no substitution file: the plain chain is run.ts, not this driver';
    const name = canonName(login);
    if (name === 'scored' || FORBIDDEN_ACCOUNTS.has(name)) return `${login} is a fleet, forbidden or scored account: substitutions are for a rehearsal throwaway only`;
    if (/^cairn_/.test(name)) return `${login} is a cairn_ helper name: the rehearsal's scored side is an unbranded throwaway`;
    if (!owner) return 'no claim owner (--claim-owner): a rehearsal runs under its own claim';
    if (['run', 'host'].includes(owner.trim().toLowerCase())) return `the claim owner ${owner} is the scored run's: substitutions never run under it`;
    return null;
}

// ------------------------------------------------------------------ S04 teleport-xp

/** Base xp per cast and the level each needs (lib/travel.ts SPELLS; teleport.rs2's magic xp). */
export const TELEPORT_XP: Readonly<Record<'varrock' | 'falador' | 'camelot', { level: number; base: number }>> = {
    varrock: { level: 25, base: 35 },
    falador: { level: 37, base: 48 },
    camelot: { level: 45, base: 55.5 },
};
export const STRIKE_TO = 25;
/** Wind Strike's damage-independent XP (magic_combat_spells.dbrow experience=55 tenths). */
export function strikeUpperBound(xp: number): number {
    return Math.max(0, Math.ceil((xpForLevel(STRIKE_TO) - xp) / (5.5 * XP_RATE)));
}
export const TELEPORT_XP_TARGET = 59;
/** The coop's chickens (S02's site): where the strikes to 25 go. */
export const COOP = { x: 3233, z: 3295, tol: 3 } as const;

/** The best teleport at `level`: the highest-xp one it can cast. */
export function teleportFor(level: number): 'varrock' | 'falador' | 'camelot' {
    return level >= TELEPORT_XP.camelot.level ? 'camelot' : level >= TELEPORT_XP.falador.level ? 'falador' : 'varrock';
}

/** The casts from `xp` (at Magic 25 or above) to `target`, by spell, on lib/xp.ts's curve. */
export function teleportPlan(xp: number, target = TELEPORT_XP_TARGET): Record<'varrock' | 'falador' | 'camelot', number> {
    const out = { varrock: 0, falador: 0, camelot: 0 };
    let x = Math.max(xp, xpForLevel(STRIKE_TO));
    while (levelForXp(x) < target) {
        const sp = teleportFor(levelForXp(x));
        out[sp]++;
        x += baseToXp(TELEPORT_XP[sp].base);
    }
    return out;
}

const LAW = /^law rune$/i;
const STAFF = /^staff of water$/i;
const count = (s: BotWorldState, p: RegExp) => s.inventory.filter(i => p.test(i.name)).reduce((n, i) => n + i.count, 0);
const wornName = (s: BotWorldState, p: RegExp) => s.equipment.some(i => p.test(i.name));

type TeleSdk = StrikeSdk & Parameters<typeof teleport>[0] & Parameters<typeof dropMatching>[0] & { sendUseItem(slot: number, op: number): Promise<unknown> };

/** A teleport for XP, including casts that land on the very same tile. Travel's movement predicate
 * cannot confirm those. XP acknowledges the cast; teleport.rs2's p_delay(1), p_delay(0) then finish
 * before the next click (three ticks after that acknowledgement), followed by scene settling. */
export async function castXpTeleport(sdk: TeleSdk, spell: ReturnType<typeof teleportFor>): Promise<{ ticks: number; xp: number }> {
    if (!(await settle(sdk)).ok) throw new Error('teleport-xp: scene did not settle');
    const why = teleportRefusal(sdk, spell);
    if (why) throw new Error(`teleport-xp: ${why}`);
    const before = sdk.getState()!;
    const xp = magicXp(before);
    const cast = await act(sdk, () => sdk.sendClickComponent(TELEPORTS[spell]), s => magicXp(s) > xp, { maxTicks: 25, maxResends: 0 });
    if (!cast.ok) throw new Error(`teleport-xp: ${spell} did not award XP`);
    const awarded = sdk.getState()!;
    const landed = await waitUntil(sdk, s => s.tick >= awarded.tick + 3, { maxTicks: 6 });
    if (!landed.ok || !(await settle(sdk)).ok) throw new Error(`teleport-xp: ${spell} landing did not settle`);
    return { ticks: sdk.getState()!.tick - before.tick, xp: magicXp(sdk.getState()!) - xp };
}

/** S04 as the rehearsal set can serve it: strikes to 25 at the coop, teleports to 59, S04's exit drops. */
export function teleportXpStep(): ChainStep {
    const run = async (ctx: StepContext<unknown>) => {
        const sdk = ctx.sdk as unknown as TeleSdk;
        const s0 = sdk.getState()!;
        const startTick = s0.tick;
        noteRow(ctx, `(substitute) S04: teleport xp`, { substitute: 'teleport-xp', magic: magicLevel(s0), plan: teleportPlan(magicXp(s0)) });
        // The staff of water pays every Falador teleport's water rune (magic.ts wieldStaff).
        const staff = s0.inventory.find(i => STAFF.test(i.name));
        if (staff && !wornName(s0, STAFF)) await sdk.sendUseItem(staff.slot, 2);
        let strikes: unknown = null;
        if (magicLevel(sdk.getState()) < STRIKE_TO) {
            const w = await runTo(sdk, COOP);
            if (!w.ok) throw new Error(`S04 teleport-xp: the run to the coop failed`);
            const r = await strikeTo(sdk, STRIKE_TO, { maxTicks: 900 });
            strikes = { clicks: r.clicks, ticks: r.ticks, pages: r.pagesSent };
            if (!r.ok) throw new Error(`S04 teleport-xp: strikes to ${STRIKE_TO}: ${r.reason}`);
        }
        const casts: Record<string, number> = {};
        const castTicks: number[] = [];
        for (;;) {
            const s = sdk.getState()!;
            if (magicLevel(s) >= TELEPORT_XP_TARGET) break;
            // A level-up page holds the next click: answer it first (one continue a page).
            if (s.dialog?.isOpen) {
                let last = -1;
                const pages = await onStates(sdk, 25, state => {
                    if (!state.dialog?.isOpen) return true;
                    if (state.tick !== last) { last = state.tick; void sdk.sendClickDialog(0); }
                    return undefined;
                });
                if (!pages.ok) throw new Error('S04 teleport-xp: level-up dialog did not close');
                continue;
            }
            const sp = teleportFor(magicLevel(s));
            // One law rune stays for T04-05's Falador teleport.
            if (count(s, LAW) < 2) throw new Error(`S04 teleport-xp: ${count(s, LAW)} law rune(s) left at Magic ${magicLevel(s)}; one is T04-05's`);
            const r = await castXpTeleport(sdk, sp);
            casts[sp] = (casts[sp] ?? 0) + 1;
            castTicks.push(r.ticks);
        }
        // S04's own exit: the tinderbox and the runes nothing later casts (the S06 slot rule).
        await dropMatching(sdk, [/^tinderbox$/i, /^cosmic rune$/i, /^earth rune$/i, /^fire rune$/i, /^mind rune$/i]);
        const end = sdk.getState()!;
        noteRow(ctx, `(substitute) S04: teleport xp done`, { substitute: 'teleport-xp', strikes, casts, castTicks, ticks: end.tick - startTick, magic: magicLevel(end), law: count(end, LAW), skills: end.skills.map(s => ({ name: s.name, baseLevel: s.baseLevel, experience: s.experience })) });
    };
    return {
        id: 'S04',
        kind: 'step',
        name: `${SUBSTITUTE} S04 teleport xp`,
        logoutSafe: true,
        preconditions: s => (s.inGame ? true : 'not in game'),
        postconditions: s => (magicLevel(s) >= TELEPORT_XP_TARGET ? true : `Magic ${magicLevel(s)}, below ${TELEPORT_XP_TARGET}`),
        done: o => magicLevel(o.state as BotWorldState) >= TELEPORT_XP_TARGET,
        run,
        resume: run,
    };
}

// ------------------------------------------------------------------ S03 walk, S10b's kit without the amulet

export function walkToRowStep(to: { x: number; z: number }): ChainStep {
    const near = (s: BotWorldState) => !!s.player && Math.max(Math.abs(s.player.worldX - to.x), Math.abs(s.player.worldZ - to.z)) <= 2;
    const run = async (ctx: StepContext<unknown>) => {
        const sdk = ctx.sdk as unknown as TeleSdk;
        if (near(sdk.getState()!)) return;
        const r = await runTo(sdk, { x: to.x, z: to.z, tol: 1 });
        noteRow(ctx, `(substitute) S03: walk to the dropper row`, { substitute: 'S03 row walk', to, ok: r.ok, ticks: r.ticks });
        if (!r.ok) throw new Error(`S03 row walk to ${to.x},${to.z} failed`);
    };
    return { id: 'S03', kind: 'leg', name: `${SUBSTITUTE} S03 walk to the dropper row`, logoutSafe: true, preconditions: s => (s.inGame ? true : 'not in game'), postconditions: s => (near(s) ? true : `not within 2 of ${to.x},${to.z}`), run, resume: run };
}

const lineMatch = (i: { id: number; name: string }, p: unknown) => (p instanceof RegExp ? p.test(i.name) : i.id === p);

/** tree-gnome-village.ts kitCheck with the dropped items left out. */
export function kitCheckWithout(s: BotWorldState, dropped: readonly string[]): true | string {
    for (const l of H7) {
        if (dropped.some(d => lower(d) === lower(l.name))) continue;
        if (l.wear) {
            if (!s.equipment.some(i => lineMatch(i, l.item))) return `${l.name} not worn`;
        } else {
            const n = [...s.inventory, ...s.equipment].filter(i => lineMatch(i, l.item)).reduce((a, i) => a + i.count, 0);
            if (n < l.n) return `holds ${n} of H7's ${l.n} ${l.name}`;
        }
    }
    return s.inventory.some(i => lineMatch(i, ITEM.staffOfWater)) || s.equipment.some(i => lineMatch(i, ITEM.staffOfWater)) ? 'the staff of water is still held (dropped at A, rs/158)' : true;
}

/** S10b's A-kit when H7 came without some items: H7's hand-off already wore the rest; drop the staff of water. */
export function kitStepWithout(orig: ChainStep, dropped: readonly string[]): ChainStep {
    const run = async (ctx: StepContext<unknown>) => {
        const sdk = ctx.sdk as unknown as TeleSdk;
        noteRow(ctx, `(substitute) S10b: kit without ${dropped.join(', ')}`, { substitute: 'H7 drop', dropped });
        await dropMatching(sdk, [ITEM.staffOfWater as RegExp]);
    };
    return { ...orig, name: `${SUBSTITUTE} ${orig.name} (no ${dropped.join(', ')})`, run, resume: run, postconditions: s => kitCheckWithout(s, dropped), done: (o, c) => !!orig.done?.(o, c) || kitCheckWithout(o.state, dropped) === true };
}

// ------------------------------------------------------------------ the chain

/** run.ts's chain with the substitutions applied (the ledger rewrite comes first, through buildChain's manifest). */
export function substitutedChain(cfg: RunConfig, cues: CueSink, subs: Substitutions, manifest: string, o: { s21Relog?: boolean } = {}): ChainStep[] {
    const text = subs.ledger ? applyLedgerSubs(manifest, subs.ledger) : manifest;
    let chain = buildChain(cfg, { cues, manifest: text, ...(o.s21Relog !== undefined ? { s21Relog: o.s21Relog } : {}) });
    if (subs.S03) {
        const at = chain.findIndex(s => s.id === 'S03' && s.kind === 'step');
        if (at < 0) throw new Error('substitute S03: no S03 step on the chain');
        chain = [...chain.slice(0, at), censused(walkToRowStep(subs.S03.walkTo)), ...chain.slice(at)];
    }
    if (subs.S04 === 'teleport-xp') {
        const first = chain.findIndex(s => s.id === 'S04');
        if (first < 0) throw new Error('substitute S04: no S04 step on the chain');
        let last = first;
        while (chain[last + 1]?.id === 'S04') last++;
        const plan = handOffFrom(text, 'H3');
        const h3: ChainStep = { ...handOffStep(plan, { partner: cfg.rings.giver }), id: 'S04', kind: 'handoff', name: `${SUBSTITUTE} H3 runes for rings` } as ChainStep;
        chain = [...chain.slice(0, first), censused(muleCued(h3, 'H3', cues)), censused(teleportXpStep()), ...chain.slice(last + 1)];
    }
    const dropped = subs.ledger?.H7?.drop ?? [];
    if (dropped.length) {
        const at = chain.findIndex(s => s.name === 'S10b:A-kit');
        if (at < 0) throw new Error('substitute H7: no S10b:A-kit on the chain');
        chain = chain.map((s, i) => (i === at ? censused(kitStepWithout(s, dropped)) : s));
    }
    if (subs.S07) {
        if (cfg.bones.group?.length !== 4) throw new Error('substitute S07: needs the four-giver rehearsal group, final giver last');
        const replacement = woodcuttingSteps({ bury: '^babydragon bones$', bones: { ...cfg.bones, load: 23, lastLoad: 21 }, cueDir: cfg.cueDir, dropAxe: true, prayerTo: 0 });
        chain = chain.map(s => {
            if (s.id !== 'S07') return s;
            const step = replacement.find(r => r.name === s.name);
            if (!step) throw new Error(`substitute S07: no replacement for ${s.name}`);
            const tagged = tag(s.id, s.kind, step);
            if (step.name !== 'woodcutting:willow-73-99') return censused(tagged);
            const run = async (ctx: StepContext<unknown>) => {
                await tagged.run(ctx);
                assertBoneDelivery(ctx.log.rows, ctx.sdk.getState()!, cfg.bones.group!);
                noteRow(ctx, '(substitute) S07: five loads and final runes confirmed', { substitute: 'babydragon', loads: 5, finalGiver: cfg.bones.group!.at(-1) });
            };
            return censused({ ...tagged, run, resume: run });
        });
    }
    if (subs.S11a === 25) {
        const step = agilitySteps({ to: 25 }).find(s => s.name === 'agility:gnome');
        if (!step) throw new Error('substitute S11a: no gnome agility step');
        chain = chain.map(s => s.id === 'S11a' ? censused(tag(s.id, s.kind, step)) : s);
    }
    return chain.map(s => {
        const reason = substitutionReason(s, subs);
        if (!reason) return s;
        const run = (f: ChainStep['run']) => async (ctx: StepContext<unknown>) => {
            noteRow(ctx, `(substitute) ${s.id}: ${reason}`, { substitute: reason });
            await f(ctx);
        };
        return { ...s, name: s.name.startsWith(SUBSTITUTE) ? s.name : `${SUBSTITUTE} ${s.name}`, run: run(s.run), resume: run(s.resume ?? s.run) };
    });
}

/** Evidence from the canonical woodcutting receiver, not just a helper's planned stock. */
export function assertBoneDelivery(rows: readonly TickRow[], state: BotWorldState, group: readonly string[]): void {
    const loads = rows.filter(r => r.meta?.kind === 'wc-bones-load');
    if (loads.length !== 5 || loads.some(r => !r.ok)) throw new Error(`S07 substitute: expected five successful bone loads, observed ${loads.length}`);
    if (loads.some((r, i) => r.meta?.received !== (i === 4 ? 21 : 23))) throw new Error('S07 substitute: bone loads differ from 23/23/23/23/21');
    if (loads.some(r => !group.some(g => canonName(g) === canonName(String(r.meta?.giver))))) throw new Error('S07 substitute: load from outside the configured group');
    if (canonName(String(loads[4]!.meta?.giver)) !== canonName(group.at(-1)!)) throw new Error('S07 substitute: final load did not come from the configured final giver');
    if (count(state, LAW) < 1 || count(state, /^air rune$/i) < 5) throw new Error('S07 substitute: final Camelot runes not delivered');
}

function substitutionReason(s: ChainStep, subs: Substitutions): string | null {
    if (s.name.startsWith(SUBSTITUTE)) return s.name;
    if (s.id === 'H8' && subs.ledger?.H8) return 'H8 without agility potion';
    if (['S11a', 'S11b'].includes(s.id) && subs.S11a) return 'S11a trained to Agility 25 instead of potion';
    if (s.id === 'H4k' && subs.ledger?.H4k) return 'H4k substituted axe';
    if (s.id === 'S07' && (subs.ledger?.H4k || subs.S07)) return 'S07 substituted axe/bones; not Prayer 99';
    if (s.name === 'S05:A-h4-swap' && subs.S04) return 'H4 give-only (no rings)';
    if (subs.ledger?.H7?.drop?.length && ['H7', 'S10b', 'S11b', 'S12'].includes(s.id)) return 'H7 kit without amulet; fights not scored-equivalent';
    return null;
}

/** Substitute rows remain in the evidence, but never enter the canonical measured totals. */
export function rehearsalReport(rows: readonly TickRow[], chain: readonly ChainStep[], runOrder: string) {
    const substituted = new Set(chain.filter(s => s.name.startsWith(SUBSTITUTE)).map(s => s.name));
    const isSub = (r: TickRow) => r.step.startsWith(SUBSTITUTE) || substituted.has(r.step) || !!r.meta?.substitute;
    const substitutes = rows.filter(r => !r.kind && isSub(r)).map(r => ({ step: r.step, ticks: r.ticks, ok: r.ok }));
    return { ...runReport(rows.filter(r => !isSub(r)), chain, runOrder), partial: true, substitutes };
}

export function formatRehearsalReport(r: ReturnType<typeof rehearsalReport>): string {
    return `SUBSTITUTE (excluded from measured totals):\n${r.substitutes.map(s => `${s.step}: ${s.ticks} ticks${s.ok ? '' : ' FAILED'}`).join('\n')}\n\n${formatRunReport(r)}`;
}

export function labelSubstituteRows(log: TickLog, chain: readonly ChainStep[]): () => void {
    const names = new Set(chain.filter(s => s.name.startsWith(SUBSTITUTE)).map(s => s.name));
    const append = log.append;
    log.append = row => append.call(log, names.has(row.step) ? { ...row, meta: { ...row.meta, substitute: row.step } } : row);
    return () => { log.append = append; };
}

/** Observe the actual first air-room walk call, not its first movement frame. The original
 * promise is returned unchanged; no wait, action or retry is added. Path queries are counted
 * directly, but the SDK does not expose an internal retry count, so that remains unknown. */
export function observeFirstAirWalk(session: Pick<Session, 'sdk' | 'bot' | 'name' | 'sessionId'>, log: TickLog): () => void {
    let selected = false;
    let active = false;
    let pathQueries = 0;
    const unPath = patchMethod(session.sdk, 'sendFindPath', send => (...args) => {
        if (active) pathQueries++;
        return send(...args);
    });
    const unWalk = patchMethod(session.bot, 'walkTo', walk => (...args) => {
        const before = session.sdk.getState();
        if (selected || !before || !inRoom(before, 'air')) return walk(...args);
        selected = true;
        active = true;
        const sessionId = session.sessionId;
        const startTick = before.tick;
        const started = Date.now();
        const meta = { sceneReadyAtCall: before.sceneReady ?? null, from: before.player ? { x: before.player.worldX, z: before.player.worldZ, level: before.player.level } : null, target: { x: args[0], z: args[1], tolerance: args[2] ?? 3 } };
        const record = (step: string, result?: ActionResult, error?: unknown) => {
            const endTick = session.sdk.getState()?.tick ?? startTick;
            log.append({
                v: 1, kind: 'note', runId: log.runId, account: session.name, sessionId, step,
                startTick, endTick, ticks: Math.max(0, endTick - startTick), wallMs: Date.now() - started,
                ok: error === undefined && result?.success !== false, tickMs: tickMs(), at: new Date().toISOString(),
                ...(error !== undefined ? { error: error instanceof Error ? error.message : String(error) } : {}),
                meta: { ...meta, pathQueries, retryCount: null, reportedStuck: result ? /stuck/i.test(result.message) : null,
                    ...(result ? { result: { success: result.success, message: result.message, reason: result.reason ?? null } } : {}),
                    crossedSession: session.sessionId !== sessionId },
            });
        };
        record('S06 first altar-room walk:start');
        let promise: Promise<ActionResult>;
        try { promise = walk(...args); }
        catch (e) { active = false; record('S06 first altar-room walk', undefined, e); throw e; }
        void promise.then(
            result => { active = false; record('S06 first altar-room walk', result); },
            error => { active = false; record('S06 first altar-room walk', undefined, error); },
        );
        return promise;
    });
    return () => { active = false; unWalk(); unPath(); };
}

// ------------------------------------------------------------------ main (run.ts's, on the substituted chain)

function takeFlag(argv: string[], name: string): { value: string | undefined; rest: string[] } {
    const at = argv.findIndex(a => a.startsWith(`--${name}=`));
    if (at < 0) return { value: undefined, rest: argv };
    return { value: argv[at]!.slice(name.length + 3), rest: [...argv.slice(0, at), ...argv.slice(at + 1)] };
}

async function main(argv: string[]): Promise<number> {
    const { value: subFile, rest } = takeFlag(argv, 'substitute');
    const a = parseArgs(rest);
    const subs: Substitutions | null = subFile ? (JSON.parse(readFileSync(subFile, 'utf8')) as Substitutions) : null;
    const env = loadBotEnv(a.bot);
    const owner = claimOwner(a.claimOwner);
    const why = substituteRefusal(env.BOT_USERNAME, owner, subs);
    if (why) {
        console.error(`[rehearsal] REFUSED: ${why}`);
        return EXIT_REFUSED;
    }
    const cfg = loadRunConfig(a.config, a.runDir);
    if (cfg.cueDir !== defaultCueDir()) {
        console.error(`[gate] REFUSED cue directory: ${cfg.cueDir} is not the one the helpers' writers use (${defaultCueDir()})`);
        return EXIT_REFUSED;
    }
    const keeper = new RunCues({ main: cfg.cueDir, mule: muleCueDir(cfg) }, env.BOT_USERNAME);
    let full: ChainStep[];
    try {
        full = substitutedChain(cfg, keeper, subs!, readFileSync(MANIFEST, 'utf8'), { s21Relog: a.s21Relog });
        chainProbes(full);
    } catch (e) {
        console.error(`[gate] REFUSED run config or substitution: ${e instanceof Error ? e.message : e}`);
        return EXIT_REFUSED;
    }
    if (!a.until || sliceUntil(full, a.until).length > sliceUntil(full, 'H11r').length) {
        console.error('[rehearsal] REFUSED: --until must stop at H11r or earlier');
        return EXIT_REFUSED;
    }
    const chain = sliceUntil(full, a.until);
    const from = resolveFrom(chain, a.from);
    const io = hostGateIO(a, owner);
    const gates = await startGates(chain, io);
    for (const g of gates) console.log(`[gate] ${g.ok ? 'ok     ' : 'REFUSED'} ${g.gate}: ${g.detail}`);
    const substituted = chain.filter(s => s.name.startsWith(SUBSTITUTE)).map(s => s.name);
    console.log(`[rehearsal] substitutions: ${substituted.join('; ')}`);
    if (a.dryRun) {
        chain.forEach((s, i) => console.log(`${String(i).padStart(3)}  ${s.id.padEnd(14)} ${s.kind.padEnd(8)} ${s.name}`));
        return gates.every(g => g.ok) ? 0 : EXIT_REFUSED;
    }
    if (!gates.every(g => g.ok)) {
        console.error('[run] nothing was logged in');
        return EXIT_REFUSED;
    }
    const earlier = (() => {
        try {
            return parseLog(readFileSync(a.log, 'utf8'));
        } catch {
            return [];
        }
    })();
    const fresh = earlier.length === 0 && from === undefined;
    const removed = [...prepareCueDir(cfg.cueDir, { fresh }), ...prepareCueDir(muleCueDir(cfg), { fresh }).map(f => `mule/${f}`)];
    const log = TickLog.open(`rehearsal-${newRunId()}`, a.log);
    const bin = owner ? claimBin() : null;
    const reservation = new ReservationWatch(reservationPath(a.hostReservation), { label: 'rehearsal', ...(owner ? { owner, touch: bin ? claimToucher(bin) : null } : {}) });
    const session = await openSession(a.bot, { client: a.client, launch: true });
    const recorded = gates.find(g => g.gate === 'demo tick rate')!.meta!.recorded as TickMsParse;
    session.beforeLogin = tickBeforeLogin(io, recorded, t => {
        log.append(annotation(log, session.name, 'gate', '(gate) demo tick rate before login', { ok: t.ok, meta: { ...t } }));
        console.log(`[gate] ${t.ok ? 'ok     ' : 'REFUSED'} demo tick rate before login: ${describePreflight(t)}`);
    });
    const unlabel = labelSubstituteRows(log, chain);
    const unalias = aliasAccount(log, session.name);
    const unWalk = observeFirstAirWalk(session, log);
    log.append(annotation(log, session.name, 'gate', '(gate) start', { meta: { gates, fresh, cueDir: cfg.cueDir, removed, until: a.until ?? null, steps: chain.length, substitutions: subs, substituted } }));
    console.log(`[run] ${LOG_ACCOUNT} on ${a.client}; ${chain.length} steps${a.until ? ` to ${a.until}` : ''}; log ${log.path}`);
    let code: number;
    try {
        const { result } = await runChainOnSession(session, { log, chain, reservation, cues: keeper, label: 'rehearsal', ...(from !== undefined ? { from } : {}) });
        code = result.code;
        console.log(`[run] ${result.outcome}`);
    } finally {
        unWalk();
        unalias();
        unlabel();
        await closeSession(session);
    }
    console.log('\n' + formatRehearsalReport(rehearsalReport([...earlier, ...log.rows], chain, readFileSync(join(ROOT, 'docs/speedrun/RUN-ORDER.md'), 'utf8'))));
    return code;
}

if (import.meta.main) {
    try {
        process.exit(await main(process.argv.slice(2)));
    } catch (e) {
        if (e instanceof UsageError) {
            console.error(e.message);
            process.exit(2);
        }
        throw e;
    }
}
