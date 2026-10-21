// Contract between helper roles and the fleet supervisor (speedrun/helpers/fleet.ts).
// A role is a long-running loop for one helper account. It must be restartable from
// any state: fresh account in the tutorial, mid-trip, full inventory, after a relog
// or a death. Roles use the standard SDK API (bot/sdk) so the same module runs
// standalone during development and inside the fleet unchanged.
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
    run(ctx: RoleContext): Promise<void>;
}

/**
 * Run one role on one account outside the fleet, from the repo root:
 *   bun speedrun/helpers/<role>.ts <account>
 * Needs bots/<account>/bot.env and the account's lite client already running
 * (cd server/webclient && bun src/lite/runner.ts <account>). Role options come
 * from the ROLE_OPTIONS environment variable as JSON. Log lines and bank
 * snapshots are printed as JSON lines on stdout. As in the fleet, the role
 * starts only on state from the live client session (lib/fresh-state.ts).
 */
export async function runStandalone(role: Role): Promise<void> {
    if (process.env.HELPER_PATH === 'direct') return runDirect(role);
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
            await role.run({
                bot,
                sdk,
                account,
                options,
                log: (message, data) => line({ message, ...data }),
                reportBank: snapshot => line({ bank: snapshot.items }),
                signal: controller.signal
            });
        },
        { onDisconnect: 'wait', reconnectTimeout: 300_000, printState: false }
    );
}

/** The line a direct-path role prints once its own client is in the world (standalone.ts waits for it). */
export const DIRECT_IN_WORLD = (account: string, host: string) => `[direct] '${account}' logged into ${host}`;
export const DIRECT_IN_WORLD_RE = /^\[direct\] '.+' logged into /;
/** The line a direct-path role prints when the server refuses its login, then exits 1. */
export const DIRECT_REFUSED_RE = /^\[direct\] login refused \(code (\d+)\)/;

/**
 * The direct path (launcher `path: 'direct'`, HELPER_PATH=direct): this process logs the
 * account in with its own lite client (speedrun/lib/direct.ts) and runs the role on a BotSDK
 * bridged to it in-process, so the role's state listeners run inside the client's tick
 * callback and its actions reach the engine without the gateway. Credentials come from the
 * environment (BOT_USERNAME, PASSWORD, SERVER), never argv. On SIGINT/SIGTERM the role is
 * aborted and the account clicks logout before the process exits; when the server ends the
 * session the process exits 1, so the launcher's next start is a new login. Exit 3: the
 * server runs another client revision (as the lite runner).
 */
async function runDirect(role: Role): Promise<never> {
    const [{ openDirectSession }, { initPathfinding }, { executionContext, abortable }, { LOGOUT_BUTTON, COMBAT_LOGOUT_TICKS }] = await Promise.all([
        import('../lib/direct'),
        import('../../sdk/pathfinding'),
        import('../../sdk/execution-context'),
        import('../lib/session')
    ]);
    const account = process.env.BOT_USERNAME ?? process.argv[2] ?? '';
    const host = process.env.SERVER ?? '';
    const options = JSON.parse(process.env.ROLE_OPTIONS ?? '{}') as Record<string, unknown>;
    const line = (data: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), account, role: role.name, path: 'direct', ...data }));
    if (!account || !process.env.PASSWORD || !host) {
        console.error('[direct] BOT_USERNAME, PASSWORD and SERVER must be set in the environment');
        process.exit(2);
    }
    const controller = new AbortController();
    let stopping = false;
    const stop = () => {
        stopping = true;
        controller.abort(new Error('stopped'));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);

    // Synchronous and slow on a cold host: pay it before the game socket exists, not inside a role's first walk.
    initPathfinding();
    const profanity = (process.env.PROFANITY_FILTER ?? '').toLowerCase();
    let session: Awaited<ReturnType<typeof openDirectSession>>;
    try {
        session = await openDirectSession({ host, username: account, password: process.env.PASSWORD!, profanityFilter: ['false', '0', 'off', 'no'].includes(profanity) ? false : undefined });
    } catch (e) {
        const err = e as { name?: string; code?: number; message?: string };
        if (err.name === 'OutdatedClientError') {
            console.error(`[direct] ${err.message}`);
            process.exit(3);
        }
        if (err.name === 'LoginError') console.log(`[direct] login refused (code ${err.code}): ${err.message}`);
        else console.error('[direct] login failed', e);
        process.exit(1);
    }
    process.env.LOGGED_IN_AT = String(Date.now());
    console.log(DIRECT_IN_WORLD(account, host));
    let end: { reason: string } | null = null;
    void session.ended.then(e => {
        end = e;
        if (!stopping) controller.abort(new Error(`session ended (${e.reason})`));
    });

    let code = 0;
    const { sdk, bot } = await session.connectSdk({ showChat: role.readsChat === true || process.env.SHOW_CHAT?.toLowerCase() !== 'false' });
    try {
        await executionContext.run({ signal: controller.signal }, async () => {
            const fresh = await waitForFreshState(sdk, { timeoutMs: 60_000, signal: controller.signal });
            line({ message: `session state at ${describeFreshState(fresh)}` });
            await abortable(
                role.run({
                    bot,
                    sdk,
                    account,
                    options,
                    log: (message, data) => line({ message, ...data }),
                    reportBank: snapshot => line({ bank: snapshot.items }),
                    signal: controller.signal
                })
            );
        });
    } catch (e) {
        if (!stopping) {
            code = 1;
            line({ message: 'role failed', error: String(e).slice(0, 300) });
        }
    }
    if (end && !stopping) code = 1;

    // Log out by the button, as the launcher does for a relayed client; refused in combat: wait it out once.
    if (!end) {
        const ended = (ms: number) => Promise.race([session.ended.then(() => true), new Promise<boolean>(r => setTimeout(() => r(false), ms))]);
        for (let attempt = 0; attempt < 2; attempt++) {
            const clickTick = sdk.getState()?.tick ?? 0;
            void sdk.sendClickComponent(LOGOUT_BUTTON).catch(() => undefined);
            if (await ended(8_000)) break;
            const refused = sdk.getState()?.gameMessages.some(m => /can't log ?out/i.test(m.text) && m.tick >= clickTick);
            if (!refused) {
                line({ message: 'no clean logout; closing the client' });
                break;
            }
            await Promise.race([session.waitTicks(COMBAT_LOGOUT_TICKS + 1), ended(15_000)]);
        }
    }
    session.close();
    process.exit(code);
}
