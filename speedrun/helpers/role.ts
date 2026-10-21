// Contract between helper roles and the fleet supervisor (speedrun/helpers/fleet.ts).
// A role is a long-running loop for one helper account. It must be restartable from
// any state: fresh account in the tutorial, mid-trip, full inventory, after a relog
// or a death. Roles use the standard SDK API (bot/sdk) so the same module runs
// standalone during development and inside the fleet unchanged.
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';

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
 * snapshots are printed as JSON lines on stdout.
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
