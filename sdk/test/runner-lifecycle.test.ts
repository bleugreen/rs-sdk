import { expect, test } from 'bun:test';
import { join } from 'node:path';

// Shutdown is what these tests guard: from the script finishing to the process
// exiting takes 0.1-0.2 s on an idle 8-core host and at most 1.7 s with its
// cores 8x oversubscribed, while a leaked timer holds the process for the 10 s
// disconnect bound or the 60 s script deadline.
const SHUTDOWN_BOUND_MS = 4_000;
// Once the script has finished, a process still alive this long has leaked a
// timer; kill it so the test fails now instead of waiting out the deadline.
const SHUTDOWN_WATCHDOG_MS = 8_000;
// Starting bun and loading the SDK is the slow part, and it is not under test:
// 1.4 s idle, 10-11.5 s at 4x and 20-21 s at 8x oversubscription. The
// consecutive mode adds a 5.5 s script, for 27 s in total at 8x. This ceiling
// only catches a child that never finishes.
const CHILD_CEILING_MS = 50_000;
const TEST_TIMEOUT_MS = 60_000;

async function runChild(mode: string) {
    // Exercise the real managed SDK connection and process lifetime. The
    // gateway is local and supplies fabricated ticks; no game client is used.
    const server = Bun.serve<{ timer?: ReturnType<typeof setInterval>; tick: number }, {}>({
        port: 0,
        fetch(req, srv) {
            if (srv.upgrade(req, { data: { tick: 0 } })) return;
            return new Response('WebSocket only', { status: 400 });
        },
        websocket: {
            message(ws, raw) {
                if (JSON.parse(String(raw)).type !== 'sdk_connect') return;
                ws.send(JSON.stringify({ type: 'sdk_connected', success: true }));
                const publish = () => ws.send(JSON.stringify({
                    type: 'sdk_state',
                    state: {
                        tick: ++ws.data.tick,
                        inGame: true,
                        player: { worldX: 3222, worldZ: 3218 },
                        skills: [],
                        nearbyLocs: [{ id: 1, name: 'Tree', x: 3223, z: 3218 }]
                    },
                    stateReceivedAt: Date.now()
                }));
                publish();
                ws.data.timer = setInterval(publish, 50);
            },
            close(ws) {
                clearInterval(ws.data.timer);
            }
        }
    });
    const child = Bun.spawn({
        cmd: [process.execPath, join(import.meta.dir, 'fixtures/runner-lifecycle.ts'), mode],
        env: {
            ...process.env,
            BOT_USERNAME: 'runner-test', PASSWORD: 'test-password', SERVER: 'localhost',
            GATEWAY_URL: `ws://localhost:${server.port}`
        },
        stdout: 'pipe',
        stderr: 'pipe'
    });
    const ceiling = setTimeout(() => child.kill(), CHILD_CEILING_MS);
    let shutdownWatchdog: ReturnType<typeof setTimeout> | undefined;
    let stdout = '';
    let finishedAt = NaN;
    const readStdout = async () => {
        const decoder = new TextDecoder();
        const reader = child.stdout.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            stdout += decoder.decode(value, { stream: true });
            const finished = Number.isNaN(finishedAt) && stdout.match(/^FINISHED_AT:(\d+)$/m);
            if (finished) {
                finishedAt = Number(finished[1]);
                shutdownWatchdog = setTimeout(() => child.kill(), SHUTDOWN_WATCHDOG_MS);
            }
        }
    };
    try {
        const [, stderr, [exitCode, exitedAt]] = await Promise.all([
            readStdout(),
            new Response(child.stderr).text(),
            child.exited.then(code => [code, Date.now()] as const)
        ]);
        // Measured from the script finishing, not from spawn, so a slow start
        // on a busy host cannot be mistaken for a held process.
        return { stdout, stderr, exitCode, shutdown: exitedAt - finishedAt };
    } finally {
        clearTimeout(ceiling);
        clearTimeout(shutdownWatchdog);
        server.stop(true);
    }
}

test('managed run cleanup cannot terminate a subsequent run', async () => {
    const result = await runChild('consecutive');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('SECOND_SCRIPT_FINISHED');
    expect(result.stdout).toContain('RUN_FINISHED:true:true');
    expect(result.stderr).not.toContain('forcing exit');
}, TEST_TIMEOUT_MS);

test('a completed managed script exits naturally without the disconnect deadline', async () => {
    const result = await runChild('success');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('RUN_FINISHED:true');
    expect(result.shutdown).toBeLessThan(SHUTDOWN_BOUND_MS);
}, TEST_TIMEOUT_MS);

test('a failed managed script clears its deadline and retains a nonzero exit code', async () => {
    const result = await runChild('failure');
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('RUN_FINISHED:false:expected script failure');
    expect(result.shutdown).toBeLessThan(SHUTDOWN_BOUND_MS);
}, TEST_TIMEOUT_MS);
