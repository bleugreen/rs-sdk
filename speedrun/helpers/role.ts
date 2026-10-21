// Contract between helper roles and the fleet supervisor (speedrun/helpers/fleet.ts).
// A role is a loop for one helper account. It must be restartable from any state:
// fresh account in the tutorial, mid-trip, full inventory, after a relog or a death.
// Roles use the standard SDK API (bot/sdk) so the same module runs standalone during
// development and inside the fleet unchanged.
//
// How run() ends decides what happens next, the same in the fleet and in the
// run-machine launcher (standalone.ts, where it is the role process's exit code):
//   - resolves while ctx.signal is not aborted: the role has finished its job (a
//     handover, one courier trip, a bounded target). It is not started again for
//     this assignment; the fleet moves the account to the assignment's `then`.
//   - throws: it is restarted with backoff.
//   - ctx.signal aborted (stop, reassignment, stall, re-login): it is restarted
//     when the account has a session again, from wherever the account is.
// A role whose job must never be repeated (a trade) records what it has done in
// ctx.state, which survives every one of those restarts.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import { describeFreshState, waitForFreshState } from '../lib/fresh-state';

export interface BankSnapshot {
    /** Every bank item, as sdk.getBankItems() reports it while the bank is open. */
    items: { id: number; name: string; count: number }[];
}

export interface RoleContext {
    bot: BotActions;
    sdk: BotSDK;
    /** Account username, e.g. cairn_h10. */
    account: string;
    /** Free-form role options from the fleet config (e.g. { tree: 'yew' }). */
    options: Record<string, unknown>;
    /** Structured progress line; the fleet timestamps it and files it per account. */
    log(message: string, data?: Record<string, unknown>): void;
    /** Call after every bank visit with the full bank; the fleet writes it into stockpile.json. */
    reportBank(snapshot: BankSnapshot): void;
    /** Aborted when the fleet stops or reassigns this account; check it between cycles and return. */
    signal: AbortSignal;
    /** This account's durable notes, kept across role restarts, re-logins and supervisor restarts. */
    state: RoleState;
}

/**
 * Per-account key/value notes on disk (the fleet's fleet-run/role-state/<account>.json).
 * Values are JSON. `set` resolves only once the value is on disk, so a role can
 * record "about to trade" before the trade and trust it after a crash.
 */
export interface RoleState {
    get(key: string): unknown;
    /** `undefined` removes the key. */
    set(key: string, value: unknown): Promise<void>;
}

/** What a finished role may hand back to its supervisor. */
export interface RoleFinish {
    /** Something a person must look at (an uncertain trade): logged loudly and shown in `fleetctl status`. */
    attention?: string;
}

/** A RoleState kept in memory only, for tests. */
export function memoryRoleState(initial: Record<string, unknown> = {}): RoleState & { data: Record<string, unknown> } {
    const data: Record<string, unknown> = { ...initial };
    return {
        data,
        get: key => data[key],
        set: async (key, value) => {
            if (value === undefined) delete data[key];
            else data[key] = JSON.parse(JSON.stringify(value));
        }
    };
}

/**
 * The RoleState in `path`, read now. A missing file is empty; an unreadable one
 * throws, because a role that cannot see what it already did must not act.
 * Writes are serialised and atomic (temp file, then rename).
 */
export async function openRoleState(path: string): Promise<RoleState> {
    let data: Record<string, unknown> = {};
    const text = await readFile(path, 'utf8').catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return null;
        throw e;
    });
    if (text !== null) {
        const parsed = (() => {
            try {
                return JSON.parse(text) as unknown;
            } catch {
                return null;
            }
        })();
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`role state ${path} is not a JSON object; fix or move it before this account runs again`);
        data = parsed as Record<string, unknown>;
    }
    let chain: Promise<void> = Promise.resolve();
    return {
        get: key => data[key],
        set(key, value) {
            const next = { ...data };
            if (value === undefined) delete next[key];
            else next[key] = JSON.parse(JSON.stringify(value));
            data = next;
            const write = chain.then(async () => {
                await mkdir(dirname(path), { recursive: true });
                const tmp = `${path}.tmp-${process.pid}`;
                await writeFile(tmp, JSON.stringify(next, null, 2) + '\n');
                await rename(tmp, path);
            });
            chain = write.catch(() => undefined);
            return write;
        }
    };
}

/** Where a standalone role keeps its RoleState: $ROLE_STATE_DIR, else the checkout's fleet-run/role-state (shared with the fleet). */
export function standaloneStateDir(env: Record<string, string | undefined> = process.env): string {
    return env.ROLE_STATE_DIR ?? join(resolve(import.meta.dir, '..', '..'), 'fleet-run', 'role-state');
}

export interface Role {
    /** Stable id used in fleet config, logs and the ledger, e.g. 'woodcutter'. */
    name: string;
    /** Bank items this role produces (matched against item names) so the ledger can attribute stock. */
    produces: RegExp[];
    /**
     * Set true for a role that reads player chat (public chat and private messages).
     * The fleet's SDK hides player chat by default (showChat: false), which also hides
     * private messages from getNewChat and waitForChat; this turns it on while the role
     * runs. Roles that never chat leave it unset.
     */
    readsChat?: boolean;
    run(ctx: RoleContext): Promise<void | RoleFinish>;
}

/**
 * Run one role on one account outside the fleet, from the repo root:
 *   bun speedrun/helpers/<role>.ts <account>
 * Needs bots/<account>/bot.env and the account's lite client already running
 * (cd server/webclient && bun src/lite/runner.ts <account>). Role options come
 * from the ROLE_OPTIONS environment variable as JSON. Log lines and bank
 * snapshots are printed as JSON lines on stdout. As in the fleet, the role
 * starts only on state from the live client session (lib/fresh-state.ts).
 * Its RoleState is <standaloneStateDir()>/<account>.json.
 */
export async function runStandalone(role: Role): Promise<void> {
    const { runScript } = await import('../../sdk/runner');
    const account = process.argv[2] ?? process.env.BOT_USERNAME ?? '';
    const options = JSON.parse(process.env.ROLE_OPTIONS ?? '{}') as Record<string, unknown>;
    const controller = new AbortController();
    process.on('SIGINT', () => controller.abort());
    process.on('SIGTERM', () => controller.abort());
    const line = (data: Record<string, unknown>) =>
        console.log(JSON.stringify({ t: new Date().toISOString(), account, role: role.name, ...data }));
    await runScript(
        async ({ bot, sdk }) => {
            // A helper's bot.env carries SHOW_CHAT=false, which runScript honours.
            if (role.readsChat) sdk.config.showChat = true;
            const fresh = await waitForFreshState(sdk, { timeoutMs: 60_000, signal: controller.signal });
            line({ message: `session state at ${describeFreshState(fresh)}` });
            const state = await openRoleState(join(standaloneStateDir(), `${account}.json`));
            const finish = await role.run({
                bot,
                sdk,
                account,
                options,
                log: (message, data) => line({ message, ...data }),
                reportBank: snapshot => line({ bank: snapshot.items }),
                signal: controller.signal,
                state
            });
            if (finish?.attention) line({ message: 'ATTENTION', attention: finish.attention });
        },
        { onDisconnect: 'wait', reconnectTimeout: 300_000, printState: false }
    );
}
