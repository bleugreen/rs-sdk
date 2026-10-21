import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { stubGateway } from '../lib/stub-gateway';

const ROOT = join(import.meta.dir, '..', '..');

describe('runStandalone', () => {
    test('a standalone role starts on the live session, not the state the gateway replays from before it', async () => {
        const gw = stubGateway();
        const where = (x: number, z: number) => ({ name: 'cairn_h05', worldX: x, worldZ: z });
        // The bot's last state before the outage: the gateway still holds it and hands it to the role's SDK.
        gw.publish({ tick: 9000, inGame: true, player: where(3188, 3430), inventory: [] }, Date.now() - 7 * 60_000);
        const child = Bun.spawn([process.execPath, 'speedrun/helpers/idle.ts', 'cairn_h05'], {
            cwd: ROOT,
            env: { ...process.env, BOT_USERNAME: 'cairn_h05', PASSWORD: 'unused', SERVER: gw.url, GATEWAY_URL: '', ROLE_OPTIONS: '{"heartbeatMinutes":60}' },
            stdout: 'pipe',
            stderr: 'ignore'
        });
        // The new client session after the re-login, back at its checkpoint, publishing every 50 ms.
        let tick = 0;
        const publisher = gw.sdkConnected().then(() => setInterval(() => gw.publish({ tick: ++tick, inGame: true, player: where(3182, 3440), inventory: [] }), 50));
        try {
            const lines: Record<string, unknown>[] = [];
            const decoder = new TextDecoder();
            let buf = '';
            const reader = child.stdout.getReader();
            const deadline = Date.now() + 20_000;
            while (!lines.some(l => l.message === 'idle') && Date.now() < deadline) {
                const { done, value } = await Promise.race([reader.read(), Bun.sleep(deadline - Date.now()).then(() => ({ done: true, value: undefined }))]);
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
                    const text = buf.slice(0, i).trim();
                    if (text.startsWith('{')) lines.push(JSON.parse(text));
                }
            }
            // runScript's connect already waits for one tick change, so by the time the gate runs the
            // replay is behind it; what matters is that the role's first look is the new session.
            const session = lines.find(l => typeof l.message === 'string' && l.message.startsWith('session state'));
            const startTick = Number(/^session state at tick (\d+)/.exec(String(session?.message))?.[1]);
            expect(startTick).toBeGreaterThan(0);
            expect(startTick).toBeLessThan(9000);
            expect(lines.find(l => l.message === 'idle')).toMatchObject({ x: 3182, z: 3440 });
        } finally {
            clearInterval(await publisher);
            child.kill('SIGTERM');
            await child.exited;
            gw.stop();
        }
    }, 30_000);
});
