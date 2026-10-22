// The loopback SDK gateway a demo script owns (tenet 12): server/gateway/gateway.ts bound to
// 127.0.0.1 with no login server, on the port the account's bot.env names in
// GATEWAY_URL=ws://127.0.0.1:<port>. The script launches the lite client against it, so its control
// SDK never goes through the demo's public relay.
import type { Subprocess } from 'bun';
import { join, resolve } from 'node:path';
import { loadBotEnv } from '../lib/session';

const ROOT = resolve(import.meta.dir, '..', '..');

/** The port of a loopback gateway URL; throws for anything but ws://127.0.0.1:<port>. */
export function loopbackPort(url: string | undefined, where = 'bot.env'): number {
    const m = /^ws:\/\/127\.0\.0\.1:(\d+)\/?$/.exec(url ?? '');
    if (!m) throw new Error(`${where}: GATEWAY_URL must be ws://127.0.0.1:<port> (tenet 12, the loopback gateway), not "${url ?? ''}"`);
    return Number(m[1]);
}

/**
 * Start the loopback gateway on the port `account`'s bot.env names and wait until it answers.
 * Refuses a port something already answers on. Its stdout goes to $TMPDIR/<label>-gateway-<port>.log.
 */
export async function startLoopbackGateway(account: string, label = 'demo'): Promise<Subprocess> {
    const port = loopbackPort(loadBotEnv(account).GATEWAY_URL, `bots/${account}/bot.env`);
    const up = () => fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
    if (await up()) throw new Error(`something already answers on 127.0.0.1:${port}; pick another port`);
    const gateway = Bun.spawn([process.execPath, 'server/gateway/gateway.ts'], {
        cwd: ROOT,
        env: { ...process.env, AGENT_PORT: String(port), GATEWAY_HOSTNAME: '127.0.0.1', GATEWAY_PUBLIC_PORT: '0', LOGIN_SERVER: 'false', ENGINE_MANAGEMENT_URL: 'http://127.0.0.1:9' },
        stdin: 'ignore',
        stdout: Bun.file(join(process.env.TMPDIR ?? '/tmp', `${label}-gateway-${port}.log`)),
        stderr: 'inherit',
    });
    const deadline = Date.now() + 20_000;
    while (!(await up())) {
        if (gateway.exitCode !== null || Date.now() > deadline) {
            gateway.kill('SIGTERM');
            throw new Error(`gateway did not come up on 127.0.0.1:${port}`);
        }
        await Bun.sleep(250);
    }
    console.log(`${label}: loopback gateway up ${JSON.stringify({ port })}`);
    return gateway;
}