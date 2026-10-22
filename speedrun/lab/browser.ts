// A lab bot's browser tab: headless Chrome on the lab's DevTools port (WEB_PORT + 5), with the
// bot's page pointed at the lab's engine and gateway, for openSession(bot, {client: 'browser',
// launch: true, insecureQueryLogin: true}). The page must be this checkout's bundle (`bun run
// build` in server/webclient first).
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

export interface LabBrowser {
    /** Close Chrome, and kill it outright if the close hangs: Chrome never outlives the lab script. */
    kill(): Promise<void>;
}

export async function launchLabBrowser(bot: string, opts: { headless?: boolean } = {}): Promise<LabBrowser> {
    const webPort = process.env.WEB_PORT ?? '9300';
    const agentPort = process.env.AGENT_PORT ?? '8300';
    // The page publishes to the gateway named in its URL.
    const envPath = join(process.cwd(), 'bots', bot, 'bot.env');
    const envText = readFileSync(envPath, 'utf8');
    const clientUrl = `CLIENT_URL=http://localhost:${webPort}/bot?gateway=${encodeURIComponent(`ws://localhost:${agentPort}`)}`;
    writeFileSync(envPath, envText.replace(/^CLIENT_URL=.*\n?/m, '').trimEnd() + `\n${clientUrl}\n`, { mode: 0o600 });

    const cdpPort = Number(webPort) + 5;
    // A Chrome left behind by an earlier script on this port would take the session's tab: refuse to start.
    const held = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(() => true, () => false);
    if (held) throw new Error(`port ${cdpPort} already serves a DevTools endpoint (a Chrome left running?); stop it first`);
    // A profile and config home of its own: executors that sandbox $HOME refuse Chrome's ~/.config.
    const home = mkdtempSync(join(tmpdir(), 'lab-chrome-'));
    // Headless runs use chrome-headless-shell: bgsrv-ub's full Chrome traps on start under the executor.
    const browser = await puppeteer.launch({
        headless: opts.headless === false ? false : 'shell',
        defaultViewport: null,
        userDataDir: join(home, 'profile'),
        env: { ...process.env, XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home },
        args: ['--no-sandbox', '--disable-crash-reporter', '--disable-breakpad', '--window-size=800,660', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${cdpPort}`]
    });
    process.env.SPEEDRUN_CDP_URL = `http://127.0.0.1:${cdpPort}`;
    return {
        async kill() {
            await Promise.race([browser.close().catch(() => {}), Bun.sleep(5_000)]);
            browser.process()?.kill('SIGKILL');
        }
    };
}
