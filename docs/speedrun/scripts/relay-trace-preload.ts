// Runtime hop tracer for the SDK reaction path (docs/speedrun/research/demo-latency.md, section 5).
// Loaded with `bun --preload` into the lite runner and into the SDK script, so nothing under
// server/ or sdk/ changes. Every event is a wall-clock time (performance.timeOrigin + now()) on
// this machine, so the two processes' logs line up.
//
//   RELAY_TRACE_FILE=path      where to write JSON lines (required; tracer is inert without it)
//   RELAY_TRACE_LITE=1         also wrap LiteClient (load into the lite runner only)
//
// Events: ws_in / ws_out (every websocket message, with its kind: binary game data, or the
// JSON type of a gateway message and its state tick), markGameTick (a PLAYER_INFO decoded; the
// tick is published at the end of that drain), collectBotState (collectBotState start/end), exec (executeBotAction), flush
// (LiteClient.flush that wrote bytes to the game socket).
import { appendFileSync } from 'node:fs';

const FILE = process.env.RELAY_TRACE_FILE;
const now = () => performance.timeOrigin + performance.now();
const buf: string[] = [];
const log = (e: Record<string, unknown>) => {
    if (FILE) buf.push(JSON.stringify(e));
};
if (FILE) {
    const drain = () => {
        if (buf.length) appendFileSync(FILE, buf.splice(0).join('\n') + '\n');
    };
    setInterval(drain, 1000).unref?.();
    process.on('exit', drain);
    for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { drain(); process.exit(0); });
}

/** Kind of a websocket payload: 'bin' for game bytes, else the JSON type (+ state tick, action type). */
function kind(data: unknown): Record<string, unknown> {
    if (typeof data !== 'string') return { k: 'bin', n: (data as ArrayBuffer)?.byteLength ?? (data as Uint8Array)?.length ?? 0 };
    const type = /"type":"([a-z_A-Z]+)"/.exec(data.slice(0, 200))?.[1] ?? '?';
    const e: Record<string, unknown> = { k: type, n: data.length };
    if (type === 'state' || type === 'sdk_state') {
        const tick = /"tick":(\d+)/.exec(data)?.[1];
        if (tick) e.tick = Number(tick);
    }
    if (type === 'action' || type === 'sdk_action') e.a = /"action":\{"type":"([a-zA-Z]+)"/.exec(data)?.[1];
    return e;
}

if (FILE) {
    const Base = globalThis.WebSocket;
    class TracedWebSocket extends Base {
        constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols as any);
            const u = String(url);
            this.addEventListener('message', (ev: MessageEvent) => log({ ev: 'ws_in', t: now(), u, ...kind(ev.data) }));
        }
        override send(data: any): void {
            log({ ev: 'ws_out', t: now(), u: this.url, ...kind(data) });
            super.send(data);
        }
    }
    globalThis.WebSocket = TracedWebSocket as any;
}

if (FILE && process.env.RELAY_TRACE_LITE === '1') {
    await import('../../../server/webclient/src/lite/dom-shim.js');
    const { LiteClient } = await import('../../../server/webclient/src/lite/LiteClient.js');
    const P = LiteClient.prototype as any;
    const wrap = (name: string, before: (self: any, args: any[]) => Record<string, unknown> | null, after?: (self: any, r: any, t0: number) => Record<string, unknown> | null) => {
        const orig = P[name];
        P[name] = function (this: any, ...args: any[]) {
            const t0 = now();
            const b = before(this, args);
            const r = orig.apply(this, args);
            const finish = (v: any) => {
                const a = after?.(this, v, t0);
                if (b || a) log({ ev: name, t0, t1: now(), ...(b ?? {}), ...(a ?? {}) });
                return v;
            };
            return r instanceof Promise ? r.then(finish) : finish(r);
        };
    };
    wrap('markGameTick', () => ({}));
    wrap('collectBotState', (_self, args) => ({ tick: args[0] }));
    wrap('executeBotAction', (_self, args) => ({ a: args[0]?.type }));
    wrap('flush', self => (self.conn?.out?.pos > 0 ? { bytes: self.conn.out.pos } : null));
}
