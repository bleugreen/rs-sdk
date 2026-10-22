// The lab's one browser launcher: no other puppeteer launch exists under speedrun/lab (browser.test.ts).
// A lab bot's browser tab: Chrome on a DevTools port of its own (WEB_PORT + 5 unless the script names
// one), with the bot's page pointed at the lab's engine and gateway (or the page the script names), for
// openSession(bot, {client: 'browser', launch: true, ...}). The page must be this checkout's bundle
// (`bun run build` in server/webclient first).
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'puppeteer';
import { ROOT } from '../lib/session';

export interface LabBrowser {
    /** The Chrome itself, for a script that drives a page directly (a mid-run reload). */
    readonly browser: Browser;
    /** Close Chrome, and kill it outright if the close hangs: Chrome never outlives the lab script. */
    kill(): Promise<void>;
}

export interface LabBrowserOptions {
    /** false: a visible window (full Chrome). Default: chrome-headless-shell. */
    headless?: boolean;
    /** Chrome's DevTools port. Default: WEB_PORT + 5. */
    cdpPort?: number;
    /** The page the tab opens (bot.env's CLIENT_URL), such as a proxy.ts page. Default: labClientUrl(). */
    clientUrl?: string;
}

/** The lab's own /bot page. The page publishes to the gateway named in its URL; without one it uses the default port, not the lab's. */
export function labClientUrl(): string {
    const webPort = process.env.WEB_PORT ?? '9300';
    const agentPort = process.env.AGENT_PORT ?? '8300';
    return `http://localhost:${webPort}/bot?gateway=${encodeURIComponent(`ws://localhost:${agentPort}`)}`;
}

/**
 * bot.env with `clientUrl` as its CLIENT_URL and no CDP_URL: the tab is this launcher's Chrome, and a
 * CDP_URL another script left behind would outrank SPEEDRUN_CDP_URL and send the session to that Chrome.
 */
export function labBotEnv(envText: string, clientUrl: string): string {
    return envText.replace(/^(CLIENT_URL|CDP_URL)=.*\n?/gm, '').trimEnd() + `\nCLIENT_URL=${clientUrl}\n`;
}

export async function launchLabBrowser(bot: string, opts: LabBrowserOptions = {}): Promise<LabBrowser> {
    const cdpPort = opts.cdpPort ?? Number(process.env.WEB_PORT ?? '9300') + 5;
    // A Chrome left behind by an earlier script on this port would take the session's tab: refuse to start.
    const held = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(() => true, () => false);
    if (held) throw new Error(`port ${cdpPort} already serves a DevTools endpoint (a Chrome left running?); stop it first`);
    const envPath = join(ROOT, 'bots', bot, 'bot.env');
    writeFileSync(envPath, labBotEnv(readFileSync(envPath, 'utf8'), opts.clientUrl ?? labClientUrl()), { mode: 0o600 });

    // Loaded here, not at module load: under the rehearsal host's Bun 1.4.3 puppeteer's module graph
    // crashes as it loads (proxy-agent: `debug_1.default is not a function`), and scripts that run
    // there import this file without ever launching Chrome.
    const puppeteer = (await import('puppeteer')).default;
    // A profile and config home of its own: executors that sandbox $HOME refuse Chrome's ~/.config.
    const home = mkdtempSync(join(tmpdir(), 'lab-chrome-'));
    // Headless runs use chrome-headless-shell: bgsrv-ub's full Chrome traps on start under the executor.
    const browser = await puppeteer.launch({
        headless: opts.headless === false ? false : 'shell',
        defaultViewport: null,
        userDataDir: join(home, 'profile'),
        env: { ...process.env, XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home },
        // --password-store=basic: with a keyring backend, the first navigation hangs on a host with no
        // D-Bus (Ashburn) or waits ~25 s for the keyring timeout (bbs).
        args: ['--no-sandbox', '--password-store=basic', '--disable-crash-reporter', '--disable-breakpad', '--window-size=800,660', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${cdpPort}`]
    });
    process.env.SPEEDRUN_CDP_URL = `http://127.0.0.1:${cdpPort}`;
    return {
        browser,
        async kill() {
            await Promise.race([browser.close().catch(() => {}), Bun.sleep(5_000)]);
            browser.process()?.kill('SIGKILL');
        }
    };
}
