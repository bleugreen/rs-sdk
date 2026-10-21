// Fleet events: one JSON line per noteworthy thing that happens to the fleet
// (logins and login refusals with their code, session ends with their reason,
// SDK stall warnings, watchdog restarts, gateway exits), in
// ~/rs-fleet/fleet-events.jsonl beside the ledger. A gateway or demo-server
// hiccup hits several accounts in the same minute, which is invisible in
// per-account logs and obvious here; `fleetctl status` summarises the last hour.
import { appendFileSync, renameSync, statSync } from 'node:fs';

export type FleetEventType =
    | 'fleet_start'
    | 'fleet_stop'
    | 'login'
    | 'login_error'
    | 'login_pause'
    | 'session_end'
    | 'logout'
    | 'logout_forced'
    | 'sdk_stall'
    | 'client_silent'
    | 'role_error'
    | 'role_stall'
    /** A role's run() returned: it finished its job and is not restarted. */
    | 'role_finished'
    | 'gateway_exit';

export interface FleetEvent {
    t: string;
    type: FleetEventType;
    account?: string;
    [key: string]: unknown;
}

/** Events that mean something went wrong, as opposed to the fleet doing its job. */
export const TROUBLE: ReadonlySet<FleetEventType> = new Set([
    'login_error',
    'session_end',
    'sdk_stall',
    'client_silent',
    'role_error',
    'role_stall',
    'gateway_exit',
    'logout_forced'
]);

const ROTATE_BYTES = 10 * 1024 * 1024;

export class EventLog {
    constructor(readonly path: string) {}

    record(type: FleetEventType, fields: Omit<FleetEvent, 't' | 'type'> = {}): void {
        const line = JSON.stringify({ t: new Date().toISOString(), type, ...fields });
        try {
            if (statSync(this.path).size > ROTATE_BYTES) renameSync(this.path, `${this.path}.1`);
        } catch {
            // no file yet
        }
        try {
            appendFileSync(this.path, `${line}\n`);
        } catch (e) {
            console.error(`[events] could not write ${this.path}:`, e);
        }
    }
}

export function parseEvents(text: string): FleetEvent[] {
    const out: FleetEvent[] = [];
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
            const e = JSON.parse(line) as FleetEvent;
            if (typeof e.t === 'string' && typeof e.type === 'string') out.push(e);
        } catch {
            // a torn last line while the fleet is writing
        }
    }
    return out;
}

export interface EventCluster {
    /** Start of the minute, ISO. */
    minute: string;
    accounts: string[];
    types: Partial<Record<FleetEventType, number>>;
}

export interface EventSummary {
    since: string;
    counts: Partial<Record<FleetEventType, number>>;
    /** Login refusals by engine response code. */
    loginErrors: Record<string, number>;
    /** Minutes in which trouble hit two or more accounts, or the gateway, newest first. */
    clusters: EventCluster[];
}

export function summariseEvents(events: FleetEvent[], now: number, windowMs = 3_600_000): EventSummary {
    const since = now - windowMs;
    const recent = events.filter(e => Date.parse(e.t) >= since && Date.parse(e.t) <= now);
    const counts: Partial<Record<FleetEventType, number>> = {};
    const loginErrors: Record<string, number> = {};
    const minutes = new Map<number, { accounts: Set<string>; types: Partial<Record<FleetEventType, number>>; gateway: boolean }>();
    for (const e of recent) {
        counts[e.type] = (counts[e.type] ?? 0) + 1;
        if (e.type === 'login_error') {
            const code = String(e.code ?? '?');
            loginErrors[code] = (loginErrors[code] ?? 0) + 1;
        }
        if (!TROUBLE.has(e.type)) continue;
        const minute = Math.floor(Date.parse(e.t) / 60_000) * 60_000;
        const bucket = minutes.get(minute) ?? { accounts: new Set<string>(), types: {}, gateway: false };
        if (e.account) bucket.accounts.add(e.account);
        if (e.type === 'gateway_exit') bucket.gateway = true;
        bucket.types[e.type] = (bucket.types[e.type] ?? 0) + 1;
        minutes.set(minute, bucket);
    }
    const clusters = [...minutes.entries()]
        .filter(([, b]) => b.accounts.size >= 2 || b.gateway)
        .sort(([a], [b]) => b - a)
        .map(([minute, b]) => ({ minute: new Date(minute).toISOString(), accounts: [...b.accounts].sort(), types: b.types }));
    return { since: new Date(since).toISOString(), counts, loginErrors, clusters };
}
