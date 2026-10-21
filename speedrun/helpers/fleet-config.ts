// Fleet configuration: the JSON file the supervisor reads on start and on reload
// (~/rs-fleet/fleet.json on the fleet host). Validation is strict and collects
// every problem at once, because the file is hand-edited over SSH and a fleet
// that silently drops a misspelt account looks healthy while doing nothing.

import { existsSync, readFileSync } from 'node:fs';

/**
 * Absolute ceiling on configured accounts. The demo server allows 100 sessions
 * per source IP, and that budget is shared with everything else on the
 * operator's network (the scored run, labs, development); a 1,100-account swarm
 * once ran the 4 GB demo server out of memory.
 */
export const HARD_MAX_ACCOUNTS = 60;

/** Loopback gateway ports reserved for the fleet host. */
export const GATEWAY_PORT_RANGE = [7790, 7799] as const;

/**
 * Accounts the fleet must never log in as: the claimed spare `cairn_dot_md`, the operator's own
 * `cairn`, the former scored-account candidate `www_cairn_md`, and every name in the fleet host's
 * gitignored `forbidden-accounts.txt` at the checkout root. The scored account's real name is
 * kept out of git, so it goes in that file. A login adds playtime to the scored account, so this
 * list is checked even where ACCOUNT_NAME_RE would already refuse a name.
 */
export const FORBIDDEN_ACCOUNTS = new Set(['www_cairn_md', 'cairn_dot_md', 'cairn', ...readLocalForbidden()]);

/** One account per line, `#` starts a comment; display forms (`Www Cairn Md`) are canonicalised. */
export function parseForbiddenList(text: string): string[] {
    return text
        .split('\n')
        .map(line => line.replace(/#.*/, '').trim().toLowerCase().replace(/\s+/g, '_'))
        .filter(Boolean);
}

function readLocalForbidden(): string[] {
    const file = new URL('../../forbidden-accounts.txt', import.meta.url);
    return existsSync(file) ? parseForbiddenList(readFileSync(file, 'utf8')) : [];
}

/** Helper accounts all carry the operator's prefix; usernames are at most 12 characters. */
export const ACCOUNT_NAME_RE = /^cairn_[a-z0-9_]{1,6}$/;

/** Role ids are module names under speedrun/helpers/. */
export const ROLE_NAME_RE = /^[a-z][a-z0-9-]*$/;

/** A role and its options: what an account does. */
export interface Assignment {
    role: string;
    options: Record<string, unknown>;
}

export interface AccountConfig extends Assignment {
    account: string;
    /**
     * Where the account goes when its role finishes (run() returns, role.ts): the
     * fleet rewrites this entry to this role and options and starts it. Set by
     * `fleetctl assign ... --then ROLE` or `--return`.
     */
    then?: Assignment;
    /** false keeps the entry (and its ledger rows) but logs the account out. */
    enabled: boolean;
    /** Restart the role if it has not logged for this long. */
    stallMinutes: number;
}

export interface FleetConfig {
    /** Most accounts logged in at once; enabled accounts beyond it wait, in file order. */
    maxOnline: number;
    /** Loopback SDK gateway port on the fleet host. */
    gatewayPort: number;
    /** Minimum spacing between any two logins the fleet makes, first logins and re-logins alike. */
    loginStaggerMs: number;
    /** Sustained fleet-wide login rate (token bucket refill). */
    loginsPerMinute: number;
    /** Logins allowed back to back before loginsPerMinute applies. */
    loginBurst: number;
    accounts: AccountConfig[];
}

export const CONFIG_DEFAULTS = {
    maxOnline: 40,
    gatewayPort: 7790,
    loginStaggerMs: 4000,
    loginsPerMinute: 4,
    loginBurst: 3,
    stallMinutes: 20
} as const;

export class ConfigError extends Error {
    constructor(readonly problems: string[]) {
        super(`fleet config is invalid:\n  - ${problems.join('\n  - ')}`);
        this.name = 'ConfigError';
    }
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function intIn(v: unknown, lo: number, hi: number): v is number {
    return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

/** Validate a parsed fleet.json. Throws ConfigError naming every problem found. */
export function parseFleetConfig(raw: unknown): FleetConfig {
    const problems: string[] = [];
    if (!isRecord(raw)) {
        throw new ConfigError(['top level must be an object: { "maxOnline": 40, "accounts": [ ... ] }']);
    }

    const known = new Set(['maxOnline', 'gatewayPort', 'loginStaggerMs', 'loginsPerMinute', 'loginBurst', 'accounts']);
    for (const key of Object.keys(raw)) {
        if (!known.has(key)) problems.push(`unknown top-level key "${key}"`);
    }

    const maxOnline = raw.maxOnline ?? CONFIG_DEFAULTS.maxOnline;
    if (!intIn(maxOnline, 1, HARD_MAX_ACCOUNTS)) {
        problems.push(`maxOnline must be an integer from 1 to ${HARD_MAX_ACCOUNTS} (got ${JSON.stringify(raw.maxOnline)})`);
    }
    const gatewayPort = raw.gatewayPort ?? CONFIG_DEFAULTS.gatewayPort;
    if (!intIn(gatewayPort, GATEWAY_PORT_RANGE[0], GATEWAY_PORT_RANGE[1])) {
        problems.push(`gatewayPort must be in ${GATEWAY_PORT_RANGE[0]}-${GATEWAY_PORT_RANGE[1]} (got ${JSON.stringify(raw.gatewayPort)})`);
    }
    const loginStaggerMs = raw.loginStaggerMs ?? CONFIG_DEFAULTS.loginStaggerMs;
    if (!intIn(loginStaggerMs, 1000, 60_000)) {
        problems.push(`loginStaggerMs must be an integer from 1000 to 60000 (got ${JSON.stringify(raw.loginStaggerMs)})`);
    }
    // The demo answers bursts with "Too many login attempts"; these bounds keep the fleet polite.
    const loginsPerMinute = raw.loginsPerMinute ?? CONFIG_DEFAULTS.loginsPerMinute;
    if (!intIn(loginsPerMinute, 1, 12)) {
        problems.push(`loginsPerMinute must be an integer from 1 to 12 (got ${JSON.stringify(raw.loginsPerMinute)})`);
    }
    const loginBurst = raw.loginBurst ?? CONFIG_DEFAULTS.loginBurst;
    if (!intIn(loginBurst, 1, 6)) {
        problems.push(`loginBurst must be an integer from 1 to 6 (got ${JSON.stringify(raw.loginBurst)})`);
    }

    const accounts: AccountConfig[] = [];
    if (!Array.isArray(raw.accounts)) {
        problems.push('accounts must be an array of { "account", "role", "options"? , "enabled"? }');
    } else {
        const seen = new Set<string>();
        raw.accounts.forEach((entry, i) => {
            const where = `accounts[${i}]`;
            if (!isRecord(entry)) {
                problems.push(`${where} must be an object`);
                return;
            }
            const allowed = new Set(['account', 'role', 'options', 'enabled', 'stallMinutes', 'then']);
            for (const key of Object.keys(entry)) {
                if (!allowed.has(key)) problems.push(`${where}: unknown key "${key}"`);
            }
            const account = entry.account;
            if (typeof account !== 'string' || !ACCOUNT_NAME_RE.test(account)) {
                problems.push(`${where}: account must match ${ACCOUNT_NAME_RE} (got ${JSON.stringify(account)})`);
            } else if (FORBIDDEN_ACCOUNTS.has(account)) {
                problems.push(`${where}: ${account} is not a helper account and must never be run by the fleet`);
            } else if (seen.has(account)) {
                problems.push(`${where}: ${account} is listed twice`);
            }
            if (typeof account === 'string') seen.add(account);

            const role = entry.role;
            if (typeof role !== 'string' || !ROLE_NAME_RE.test(role)) {
                problems.push(`${where}: role must match ${ROLE_NAME_RE} (got ${JSON.stringify(role)})`);
            }
            const options = entry.options ?? {};
            if (!isRecord(options)) problems.push(`${where}: options must be an object`);
            const enabled = entry.enabled ?? true;
            if (typeof enabled !== 'boolean') problems.push(`${where}: enabled must be true or false`);
            const stallMinutes = entry.stallMinutes ?? CONFIG_DEFAULTS.stallMinutes;
            if (!intIn(stallMinutes, 1, 24 * 60)) problems.push(`${where}: stallMinutes must be an integer from 1 to 1440`);
            let then: Assignment | undefined;
            if (entry.then !== undefined) {
                const t = entry.then;
                if (!isRecord(t)) {
                    problems.push(`${where}: then must be { "role", "options"? }`);
                } else {
                    for (const key of Object.keys(t)) {
                        if (key !== 'role' && key !== 'options') problems.push(`${where}.then: unknown key "${key}"`);
                    }
                    if (typeof t.role !== 'string' || !ROLE_NAME_RE.test(t.role)) problems.push(`${where}.then: role must match ${ROLE_NAME_RE} (got ${JSON.stringify(t.role)})`);
                    const thenOptions = t.options ?? {};
                    if (!isRecord(thenOptions)) problems.push(`${where}.then: options must be an object`);
                    then = { role: String(t.role), options: isRecord(thenOptions) ? thenOptions : {} };
                }
            }

            accounts.push({
                account: String(account),
                role: String(role),
                options: isRecord(options) ? options : {},
                enabled: enabled === true,
                stallMinutes: Number(stallMinutes),
                ...(then ? { then } : {})
            });
        });
        const enabledCount = accounts.filter(a => a.enabled).length;
        if (enabledCount > HARD_MAX_ACCOUNTS) {
            problems.push(`${enabledCount} accounts are enabled; the fleet refuses to run more than ${HARD_MAX_ACCOUNTS}`);
        }
    }

    if (problems.length > 0) throw new ConfigError(problems);
    return {
        maxOnline: maxOnline as number,
        gatewayPort: gatewayPort as number,
        loginStaggerMs: loginStaggerMs as number,
        loginsPerMinute: loginsPerMinute as number,
        loginBurst: loginBurst as number,
        accounts
    };
}

export function loginLimitPolicy(config: FleetConfig): { perMinute: number; burst: number; minSpacingMs: number } {
    return { perMinute: config.loginsPerMinute, burst: config.loginBurst, minSpacingMs: config.loginStaggerMs };
}

/** The accounts the fleet should keep online: enabled ones, in file order, up to maxOnline. */
export function activeAccounts(config: FleetConfig): AccountConfig[] {
    return config.accounts.filter(a => a.enabled).slice(0, config.maxOnline);
}

/** What a reload changes, by account name. `changed` means same account, new role or options. */
export interface ConfigDiff {
    start: AccountConfig[];
    stop: string[];
    changed: AccountConfig[];
}

/** Same role with the same options. */
export function sameAssignment(a: Assignment, b: Assignment): boolean {
    return a.role === b.role && JSON.stringify(a.options) === JSON.stringify(b.options);
}

/**
 * The fleet.json that moves `finished.account` on to its `then`, as the file
 * holds it now: the entry keeps everything but `then`, and takes the `then`
 * role and options exactly. A string says why not: the file no longer assigns
 * the role that finished (someone reassigned it; their reload decides), or it
 * has no `then`, or the result would not validate.
 */
export function returnAssignment(raw: unknown, finished: Pick<AccountConfig, 'account' | 'role' | 'options'>): { config: Record<string, unknown>; next: AccountConfig } | string {
    if (!isRecord(raw) || !Array.isArray(raw.accounts)) return 'fleet.json has no accounts list';
    const i = raw.accounts.findIndex(a => isRecord(a) && a.account === finished.account);
    if (i < 0) return `${finished.account} is no longer in fleet.json`;
    const entry = raw.accounts[i] as Record<string, unknown>;
    const onDisk = { role: String(entry.role), options: isRecord(entry.options) ? entry.options : {} };
    if (!sameAssignment(onDisk, finished)) return `fleet.json now assigns ${finished.account} ${onDisk.role} ${JSON.stringify(onDisk.options)}; leaving it to the next reload`;
    if (!isRecord(entry.then)) return `fleet.json gives ${finished.account} no "then"`;
    const { then, ...rest } = entry as Record<string, unknown> & { then: Record<string, unknown> };
    const accounts = [...raw.accounts];
    accounts[i] = { ...rest, role: then.role, options: then.options ?? {} };
    const config = { ...raw, accounts };
    try {
        const next = parseFleetConfig(config).accounts.find(a => a.account === finished.account)!;
        return { config, next };
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

export function diffActive(before: AccountConfig[], after: AccountConfig[]): ConfigDiff {
    const prev = new Map(before.map(a => [a.account, a]));
    const next = new Map(after.map(a => [a.account, a]));
    const start = after.filter(a => !prev.has(a.account));
    const stop = before.filter(a => !next.has(a.account)).map(a => a.account);
    const changed = after.filter(a => {
        const old = prev.get(a.account);
        return old !== undefined && (
            old.role !== a.role ||
            old.stallMinutes !== a.stallMinutes ||
            JSON.stringify(old.options) !== JSON.stringify(a.options)
        );
    });
    return { start, stop, changed };
}
