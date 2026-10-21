// A stand-in for the SDK gateway in tests, reduced to its handling of state:
// like server/gateway/gateway.ts it keeps a bot's last state across client
// sessions, replays it with its original receipt time to every SDK that
// connects, and fans each newly published state out to the connected SDKs.

export interface StubGateway {
    url: string;
    /** A state the gateway received at `receivedAt` (default now), fanned out to connected SDKs. */
    publish(state: unknown, receivedAt?: number): void;
    /** Resolves when an SDK connects (immediately if one already has). */
    sdkConnected(): Promise<void>;
    stop(): void;
}

export function stubGateway(): StubGateway {
    const sdks = new Set<{ send(data: string): unknown }>();
    let last: { state: unknown; receivedAt: number } | null = null;
    let connected: () => void = () => undefined;
    const firstSdk = new Promise<void>(r => (connected = r));
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response('websocket only', { status: 400 })),
        websocket: {
            message(ws, raw) {
                if (JSON.parse(String(raw)).type !== 'sdk_connect') return;
                sdks.add(ws);
                ws.send(JSON.stringify({ type: 'sdk_connected', success: true }));
                if (last) ws.send(JSON.stringify({ type: 'sdk_state', state: last.state, stateReceivedAt: last.receivedAt }));
                connected();
            },
            close(ws) {
                sdks.delete(ws);
            }
        }
    });
    return {
        url: `ws://127.0.0.1:${server.port}`,
        publish(state, receivedAt = Date.now()) {
            last = { state, receivedAt };
            for (const ws of sdks) ws.send(JSON.stringify({ type: 'sdk_state', state, stateReceivedAt: receivedAt }));
        },
        sdkConnected: () => firstSdk,
        stop: () => server.stop(true)
    };
}
