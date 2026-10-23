import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BotWorldState } from '../../sdk/types';
import { canonName, nameHash, readJson, writeJsonAtomicSync } from './altar-cue';

/** World coordinates, never local scene coordinates; the plane is always explicit. */
export interface WorldTile {
    x: number;
    z: number;
    level: number;
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonnegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isWorldTile(value: unknown): value is WorldTile {
    return record(value) && nonnegativeInteger(value.x) && nonnegativeInteger(value.z)
        && nonnegativeInteger(value.level) && value.level <= 3;
}

/** Validate JSON options without coercing absent, null or string-valued coordinates. */
export function worldTile(value: unknown, name = 'tile'): WorldTile {
    if (!isWorldTile(value)) throw new Error(`${name} must be { x, z, level } with nonnegative integer coordinates and level 0..3`);
    return { x: value.x, z: value.z, level: value.level };
}

export function sameWorldTile(a: unknown, b: unknown): boolean {
    return isWorldTile(a) && isWorldTile(b) && a.x === b.x && a.z === b.z && a.level === b.level;
}

function token(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_.-]+$/.test(value);
}

/** Delimiter-free tokens make the run/row pair unambiguous. Reuse it for cue, ask and status. */
export function deliverySession(runId: string, row: string): string {
    if (!token(runId)) throw new Error('deliveryRun must be a nonempty token (letters, digits, underscore, dot or hyphen)');
    if (!token(row)) throw new Error('delivery row must be a nonempty token (letters, digits, underscore, dot or hyphen)');
    return `${runId}:${row}`;
}

export type MulePhase = 'staging' | 'travel' | 'ready' | 'trading' | 'fault' | 'off' | 'held';

export interface MuleReady {
    runId: string;
    account: string;
    row: string;
    session: string;
    receiverHash: string;
    phase: MulePhase;
    tile: WorldTile | null;
    staged: boolean;
    /** Acknowledged preparation generation, or zero for autonomous staging. */
    preparationSeq: number;
    tick: number;
    ms: number;
}

export interface MuleReadyExpected {
    runId: string;
    account: string;
    row: string;
    receiver: string;
    at: WorldTile;
    /** Bind a retained readiness snapshot to the generation returned by prepareMule. */
    preparationSeq?: number;
}

const PHASES: readonly MulePhase[] = ['staging', 'travel', 'ready', 'trading', 'fault', 'off', 'held'];
const FIELDS = ['runId', 'account', 'row', 'session', 'receiverHash', 'phase', 'tile', 'staged', 'preparationSeq', 'tick', 'ms'];

function accountName(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

/** Unknown fields are refused: this file has no place for credentials or arbitrary options. */
export function isMuleReady(value: unknown): value is MuleReady {
    return record(value) && Object.keys(value).length === FIELDS.length
        && Object.keys(value).every(key => FIELDS.includes(key))
        && token(value.runId) && token(value.row)
        && value.session === deliverySession(value.runId, value.row)
        && accountName(value.account)
        && typeof value.receiverHash === 'string' && /^[a-f0-9]{64}$/.test(value.receiverHash)
        && PHASES.includes(value.phase as MulePhase)
        && (value.tile === null || (isWorldTile(value.tile) && Object.keys(value.tile).length === 3))
        && typeof value.staged === 'boolean' && nonnegativeInteger(value.preparationSeq)
        && nonnegativeInteger(value.tick) && nonnegativeInteger(value.ms);
}

/** One replaceable status per helper. Hashing canonical names also prevents path traversal. */
export function muleReadyPath(dir: string, account: string): string {
    if (!accountName(account)) throw new Error('mule readiness needs a nonempty account');
    return join(dir, `mule-${nameHash(account)}.json`);
}

export function writeMuleReady(dir: string, status: MuleReady): void {
    if (!isMuleReady(status)) throw new Error('invalid mule readiness status');
    writeJsonAtomicSync(muleReadyPath(dir, status.account), { ...status, account: canonName(status.account) });
}

/** Missing, malformed, unknown-schema and misplaced status files all fail closed. */
export function readMuleReady(dir: string, account: string): MuleReady | null {
    if (!accountName(account)) return null;
    const status = readJson<unknown>(muleReadyPath(dir, account));
    if (!isMuleReady(status) || canonName(status.account) !== canonName(account)) return null;
    // No control is the autonomous staging path. An existing invalid control is not absence.
    if (!existsSync(mulePreparationPath(dir, account))) return status.preparationSeq === 0 && status.phase !== 'held' ? status : null;
    const control = readMulePreparation(dir, account);
    // A held status binds identity and generation only: it reports where the helper stands, not the meeting tile.
    if (!control || control.op === 'cancel' || (control.op === 'hold') !== (status.phase === 'held')
        || control.runId !== status.runId
        || control.row !== status.row || control.session !== status.session
        || control.receiverHash !== status.receiverHash
        || (control.op === 'prepare' && !sameWorldTile(control.at, status.tile))
        || control.seq !== status.preparationSeq || control.ms > status.ms) return null;
    return status;
}

/** Readiness expires by wall clock; ticks are local to each client and cannot establish freshness. */
export function readyFor(status: unknown, expected: MuleReadyExpected, now = Date.now(), maxAgeMs = 3000): boolean {
    if (!isMuleReady(status) || !record(expected) || !token(expected.runId) || !token(expected.row)
        || !accountName(expected.account) || !accountName(expected.receiver) || !isWorldTile(expected.at)
        || (expected.preparationSeq !== undefined && !nonnegativeInteger(expected.preparationSeq))
        || !Number.isFinite(now) || now < 0 || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) return false;
    return status.runId === expected.runId && status.row === expected.row
        && status.session === deliverySession(expected.runId, expected.row)
        && canonName(status.account) === canonName(expected.account)
        && status.receiverHash === nameHash(expected.receiver)
        && status.phase === 'ready' && status.staged
        && (expected.preparationSeq === undefined || status.preparationSeq === expected.preparationSeq)
        && sameWorldTile(status.tile, expected.at)
        && status.ms <= now && now - status.ms <= maxAgeMs;
}

export interface MuleHeldExpected {
    runId: string;
    account: string;
    row: string;
    receiver: string;
    /** The hold generation returned by holdMule; never a hardcoded value. */
    preparationSeq: number;
}

/** A held helper is logged in and freshly observed but deliberately unstaged; it never satisfies readyFor. */
export function heldFor(status: unknown, expected: MuleHeldExpected, now = Date.now(), maxAgeMs = 3000): boolean {
    if (!isMuleReady(status) || !record(expected) || !token(expected.runId) || !token(expected.row)
        || !accountName(expected.account) || !accountName(expected.receiver)
        || !nonnegativeInteger(expected.preparationSeq) || expected.preparationSeq < 1
        || !Number.isFinite(now) || now < 0 || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) return false;
    return status.runId === expected.runId && status.row === expected.row
        && status.session === deliverySession(expected.runId, expected.row)
        && canonName(status.account) === canonName(expected.account)
        && status.receiverHash === nameHash(expected.receiver)
        && status.phase === 'held' && !status.staged && status.tile !== null
        && status.preparationSeq === expected.preparationSeq
        && status.ms <= now && now - status.ms <= maxAgeMs;
}

/**
 * The one healthy-frame boundary for both ready and held: in game, alive, and no bank, trade,
 * shop, dialog, modal or generic interface open. An unknown interface state is not healthy.
 */
export function muleHealthy(state: BotWorldState | null | undefined): state is BotWorldState & { player: NonNullable<BotWorldState['player']> } {
    return state?.inGame === true && state.sceneReady !== false && state.bank?.isOpen === false
        && state.trade?.isOpen !== true && state.modalOpen === false
        && state.shop?.isOpen === false && state.dialog?.isOpen === false && state.interface?.isOpen === false
        && !!state.player && state.player.isDead !== true && state.player.hp > 0;
}

/** The sender must establish exact inventory staging separately; proximity alone is never ready. */
export function muleCanReady(state: BotWorldState | null, at: WorldTile, staged: boolean, travelling: boolean): boolean {
    return staged === true && travelling === false && muleHealthy(state)
        && sameWorldTile({ x: state.player.worldX, z: state.player.worldZ, level: state.player.level }, at);
}

interface MuleControlBase {
    runId: string;
    account: string;
    /** Per-write counter. Readiness and held status bind to its exact value. */
    seq: number;
    ms: number;
    /** Runner attempt generation, at least 1. Only an explicit operator resume after an abort mints a higher one. */
    attempt: number;
    /** Highest attempt a cancel in this run has aborted. Carried forward on every write; never decreases. */
    abortedAttempt: number;
}

interface MuleBinding {
    row: string;
    session: string;
    receiverHash: string;
    at: WorldTile;
}

/**
 * Scored-owned control, separate from both the helper's status and the trade cue.
 * `hold` is the distinct initial state: logged in, stationary and unstaged until this
 * run's own `prepare` releases it. A `cancel` ends the current attempt and keeps its binding.
 */
export type MulePreparation = MuleControlBase & (
    | (MuleBinding & { op: 'prepare' })
    | (MuleBinding & { op: 'hold' })
    | ({ op: 'cancel' } & Partial<MuleBinding>)
);
export type MulePrepare = Extract<MulePreparation, { op: 'prepare' }>;
export type MuleHold = Extract<MulePreparation, { op: 'hold' }>;

/** Writer input. `attempt` defaults to 1, the first start; a resumed runner passes the attempt it minted. */
export type MuleControlExpected = Omit<MuleReadyExpected, 'preparationSeq'> & { attempt?: number };

const CONTROL_FIELDS = ['op', 'runId', 'account', 'seq', 'ms', 'attempt', 'abortedAttempt'];
const BOUND_FIELDS = [...CONTROL_FIELDS, 'row', 'session', 'receiverHash', 'at'];

export function isMulePreparation(value: unknown): value is MulePreparation {
    if (!record(value) || !token(value.runId) || !accountName(value.account)
        || !nonnegativeInteger(value.seq) || value.seq < 1 || !nonnegativeInteger(value.ms)
        || !nonnegativeInteger(value.attempt) || value.attempt < 1 || !nonnegativeInteger(value.abortedAttempt)) return false;
    if (value.op !== 'prepare' && value.op !== 'hold' && value.op !== 'cancel') return false;
    // A cancel aborts its own attempt; a live hold or prepare is above every aborted attempt.
    if (value.op === 'cancel' ? value.abortedAttempt < value.attempt : value.attempt <= value.abortedAttempt) return false;
    const bound = value.op !== 'cancel' || 'row' in value;
    const fields = bound ? BOUND_FIELDS : CONTROL_FIELDS;
    if (Object.keys(value).length !== fields.length || !Object.keys(value).every(key => fields.includes(key))) return false;
    return !bound || (token(value.row) && value.session === deliverySession(value.runId, value.row)
        && typeof value.receiverHash === 'string' && /^[a-f0-9]{64}$/.test(value.receiverHash)
        && isWorldTile(value.at) && Object.keys(value.at).length === 3);
}

export function mulePreparationPath(dir: string, account: string): string {
    if (!accountName(account)) throw new Error('mule preparation needs a nonempty account');
    return join(dir, `mule-prepare-${nameHash(account)}.json`);
}

export function readMulePreparation(dir: string, account: string): MulePreparation | null {
    if (!accountName(account)) return null;
    const control = readJson<unknown>(mulePreparationPath(dir, account));
    return isMulePreparation(control) && canonName(control.account) === canonName(account) ? control : null;
}

function controlStamp(previous: MulePreparation | null, runId: string): { seq: number; ms: number } {
    const seq = previous?.runId === runId ? previous.seq + 1 : 1;
    const ms = Date.now();
    if (!nonnegativeInteger(seq) || !nonnegativeInteger(ms)) throw new Error('mule preparation clock or sequence exhausted');
    return { seq, ms };
}

function controlAttempt(value: unknown): number {
    if (value === undefined) return 1;
    if (!nonnegativeInteger(value) || value < 1) throw new Error('mule control attempt must be an integer >= 1');
    return value;
}

function controlInput(expected: MuleControlExpected): { account: string; attempt: number; binding: MuleBinding } {
    if (!record(expected) || !accountName(expected.account) || !accountName(expected.receiver))
        throw new Error('mule preparation needs an account and receiver');
    const session = deliverySession(expected.runId, expected.row);
    const at = worldTile(expected.at, 'mule preparation.at');
    return { account: canonName(expected.account), attempt: controlAttempt(expected.attempt),
        binding: { row: expected.row, session, receiverHash: nameHash(expected.receiver), at } };
}

function existingControl(dir: string, account: string): MulePreparation | null {
    const previous = readMulePreparation(dir, account);
    if (existsSync(mulePreparationPath(dir, account)) && !previous) throw new Error('invalid existing mule preparation');
    return previous;
}

/**
 * The one generation fence, shared by hold and prepare. An aborted attempt never
 * re-arms, and an older attempt never overwrites a newer one. A crash that never
 * reaches the abort path cancels nothing, so a crash-resume sees an unchanged control.
 */
function fenced(previous: MulePreparation | null, runId: string, attempt: number, op: 'hold' | 'prepare') {
    // Only a cancelled (terminal) control may be replaced by a different run; seq then restarts for that run.
    if (previous && previous.runId !== runId && previous.op !== 'cancel') {
        throw new Error(`mule ${op} refused: run ${runId} cannot replace run ${previous.runId}'s live ${previous.op} (attempt ${previous.attempt}, seq ${previous.seq})`);
    }
    const same = previous?.runId === runId ? previous : null;
    const abortedAttempt = same?.abortedAttempt ?? 0;
    if (attempt <= abortedAttempt) throw new Error(`mule ${op} refused: attempt ${attempt} <= aborted attempt ${abortedAttempt}`);
    if (same && attempt < same.attempt) throw new Error(`mule ${op} refused: attempt ${attempt} < current attempt ${same.attempt}`);
    return { ...controlStamp(previous, runId), abortedAttempt };
}

/**
 * The runner preflight's initial hold, written before the launcher starts the helper.
 * An identical repeat returns the existing control unchanged, so it cannot race the
 * helper's first held status. Within one attempt a hold never follows a prepare or
 * replaces another hold; a higher attempt is the resumed process's fresh pre-start gate.
 */
export function holdMule(dir: string, expected: MuleControlExpected): MuleHold {
    const { account, attempt, binding } = controlInput(expected);
    const previous = existingControl(dir, account);
    const same = previous?.runId === expected.runId ? previous : null;
    if (same?.op === 'hold' && same.attempt === attempt && same.session === binding.session
        && same.receiverHash === binding.receiverHash && sameWorldTile(same.at, binding.at)) return same;
    const stamp = fenced(previous, expected.runId, attempt, 'hold');
    if (same && same.attempt === attempt) throw new Error(`mule hold refused: attempt ${attempt} already has ${same.op} seq ${same.seq}`);
    const control: MuleHold = { op: 'hold', runId: expected.runId, account, ...binding, attempt, ...stamp };
    writeJsonAtomicSync(mulePreparationPath(dir, account), control);
    return control;
}

/** Only this run's own row step, S22's included, writes this; never an operator command. Every call advances seq. */
export function prepareMule(dir: string, expected: MuleControlExpected): MulePrepare {
    const { account, attempt, binding } = controlInput(expected);
    const previous = existingControl(dir, account);
    const control: MulePrepare = { op: 'prepare', runId: expected.runId, account, ...binding, attempt, ...fenced(previous, expected.runId, attempt, 'prepare') };
    writeJsonAtomicSync(mulePreparationPath(dir, account), control);
    return control;
}

/** The caller's own attempt: a cancel is always bound to the attempt that issues it. */
export interface MuleCancelExpected {
    runId: string;
    account: string;
    attempt: number;
}

/**
 * A cancellation ends the caller's attempt: it records that attempt in the carried-forward
 * fence and keeps the binding. It never overwrites another run's control, nor invents one
 * (null). A delayed cancel from an older attempt, or one naming an attempt not yet written,
 * is refused with both numbers; repeating the cancel of an already-aborted attempt is a no-op.
 */
export function cancelMulePreparation(dir: string, expected: MuleCancelExpected): MulePreparation | null {
    if (!record(expected) || !token(expected.runId) || !accountName(expected.account)) return null;
    if (!nonnegativeInteger(expected.attempt) || expected.attempt < 1) throw new Error('mule cancel needs the caller\'s attempt, an integer >= 1');
    const previous = readMulePreparation(dir, expected.account);
    if (!previous || previous.runId !== expected.runId) return null;
    if (previous.op === 'cancel' && previous.attempt === expected.attempt) return previous;
    if (expected.attempt !== previous.attempt) {
        const relation = expected.attempt < previous.attempt ? '<' : '>';
        throw new Error(`mule cancel refused: attempt ${expected.attempt} ${relation} current attempt ${previous.attempt} (${previous.op} seq ${previous.seq})`);
    }
    const binding: Partial<MuleBinding> = previous.row === undefined ? {}
        : { row: previous.row, session: previous.session, receiverHash: previous.receiverHash, at: previous.at };
    const control: MulePreparation = {
        op: 'cancel', runId: expected.runId, account: canonName(expected.account), ...binding,
        attempt: previous.attempt, ...controlStamp(previous, expected.runId),
        abortedAttempt: Math.max(previous.abortedAttempt, previous.attempt),
    };
    writeJsonAtomicSync(mulePreparationPath(dir, expected.account), control);
    return control;
}

/** What a starting runner process finds for its own run in the control file. */
export interface MuleAttemptState {
    attempt: number;
    abortedAttempt: number;
    /** The current attempt was cancelled; only an explicit operator resume continues this run. */
    aborted: boolean;
    op: MulePreparation['op'];
    seq: number;
}

/** Null when this run has written no control (a fresh start). An invalid file is an error, not absence. */
export function readMuleAttempt(dir: string, account: string, runId: string): MuleAttemptState | null {
    if (!token(runId)) throw new Error('deliveryRun must be a nonempty token');
    const control = existingControl(dir, account);
    if (!control || control.runId !== runId) return null;
    return { attempt: control.attempt, abortedAttempt: control.abortedAttempt, aborted: control.op === 'cancel', op: control.op, seq: control.seq };
}

/**
 * The attempt a (re)starting runner process uses. A crash cancels nothing, so a crash-resume
 * reuses the current attempt. After a recorded abort, only `operatorResume` mints the next
 * attempt; without it the run stays stopped. Minting never happens without an abort.
 */
export function resumeMuleAttempt(dir: string, account: string, runId: string, operatorResume: boolean): { attempt: number; minted: boolean } {
    const current = readMuleAttempt(dir, account, runId);
    if (!current) return { attempt: 1, minted: false };
    if (!current.aborted) return { attempt: current.attempt, minted: false };
    if (operatorResume !== true) throw new Error(`mule attempt ${current.attempt} of run ${runId} was aborted; only an explicit operator resume mints attempt ${current.abortedAttempt + 1}`);
    return { attempt: current.abortedAttempt + 1, minted: true };
}
