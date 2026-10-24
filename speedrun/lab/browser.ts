// The lab's one browser launcher: no other puppeteer launch exists under speedrun/lab (browser.test.ts).
// A lab bot's browser tab: Chrome on a DevTools port of its own (WEB_PORT + 5 unless the script names
// one), with the bot's page pointed at the lab's engine and gateway (or the page the script names), for
// openSession(bot, {client: 'browser', launch: true, ...}). The page must be this checkout's bundle
// (`bun run build` in server/webclient first).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'puppeteer';
import type { Subprocess } from 'bun';
import { closeSession, openSession, ROOT, type Session } from '../lib/session';

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
    /** The window, as [width, height]. Default 800x660. */
    windowSize?: readonly [number, number];
    /** More Chrome switches, after the launcher's own. */
    extraArgs?: readonly string[];
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
        args: ['--no-sandbox', '--password-store=basic', '--disable-crash-reporter', '--disable-breakpad', `--window-size=${(opts.windowSize ?? [800, 660]).join(',')}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${cdpPort}`, ...(opts.extraArgs ?? [])]
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

type ProxyProcess = Pick<Subprocess, 'exitCode' | 'exited' | 'kill'>;

export interface SecureLabSession {
    session: Session;
    chrome: LabBrowser;
    /** Retained private credentials and proxy logs, outside the checkout. */
    scratch: string;
    close(): Promise<void>;
}

interface SecureLabDeps {
    spawn(args: string[], scratch: string): ProxyProcess;
    ready(proxy: ProxyProcess, url: string): Promise<void>;
    launch: typeof launchLabBrowser;
    open: typeof openSession;
    close: typeof closeSession;
    stopProxy(proxy: ProxyProcess): Promise<void>;
}

const secureLabDeps: SecureLabDeps = {
    spawn: (args, scratch) => Bun.spawn(args, {
        cwd: join(ROOT, 'server', 'webclient'),
        stdout: Bun.file(join(scratch, 'proxy.log')),
        stderr: Bun.file(join(scratch, 'proxy.err')),
    }),
    ready: async (proxy, url) => {
        for (let n = 0; n < 50; n++) {
            if (proxy.exitCode !== null) throw new Error(`lab token proxy exited ${proxy.exitCode}`);
            const ready = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(1_000) })
                .then(r => r.ok, () => false);
            if (ready) return;
            await Bun.sleep(200);
        }
        throw new Error('lab token proxy did not become ready');
    },
    launch: launchLabBrowser,
    open: openSession,
    close: closeSession,
    stopProxy: async proxy => {
        if (proxy.exitCode !== null) return;
        proxy.kill('SIGTERM');
        await Promise.race([proxy.exited, Bun.sleep(5_000)]);
        if (proxy.exitCode === null) proxy.kill('SIGKILL');
    },
};

/**
 * The production token path against a private lab world. Own every acquired handle before the
 * next await, including a proxy whose browser launch fails. No query-password login is enabled.
 */
export async function openSecureLabSession(
    bot: string,
    options: { root?: string; webPort?: number; agentPort?: number } = {},
    overrides: Partial<SecureLabDeps> = {},
): Promise<SecureLabSession> {
    if (!/^[a-zA-Z0-9_-]+$/.test(bot)) throw new Error('invalid lab bot directory');
    const webPort = options.webPort ?? Number(process.env.WEB_PORT ?? 9300);
    const agentPort = options.agentPort ?? Number(process.env.AGENT_PORT ?? 8300);
    if (![webPort, agentPort].every(p => Number.isSafeInteger(p) && p > 0 && p <= 65529)) throw new Error('invalid lab ports');
    const deps = { ...secureLabDeps, ...overrides };
    const scratch = mkdtempSync(join(tmpdir(), 'lab-token-'));
    const botsDir = join(scratch, 'bots');
    const botDir = join(botsDir, bot);
    mkdirSync(botDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(botDir, 'bot.env'), readFileSync(join(options.root ?? ROOT, 'bots', bot, 'bot.env')), { mode: 0o600 });
    const pagePort = webPort + 6;
    const origin = `http://127.0.0.1:${pagePort}`;
    const clientUrl = `${origin}/bot?server=localhost:${webPort}&gateway=${encodeURIComponent(`ws://127.0.0.1:${agentPort}`)}`;
    let proxy: ProxyProcess | null = null;
    let chrome: LabBrowser | null = null;
    let session: Session | null = null;
    let closing: Promise<void> | null = null;
    const close = (): Promise<void> => closing ??= (async () => {
        try {
            if (session) await deps.close(session);
        } finally {
            try {
                await chrome?.kill();
            } finally {
                if (proxy) await deps.stopProxy(proxy);
            }
        }
    })();
    try {
        proxy = deps.spawn(['bun', 'proxy.ts', `--world=http://127.0.0.1:${webPort}`, `--port=${pagePort}`, `--gateway=ws://127.0.0.1:${agentPort}`, `--bots-dir=${botsDir}`], scratch);
        await deps.ready(proxy, clientUrl);
        chrome = await deps.launch(bot, { cdpPort: webPort + 5, clientUrl });
        session = await deps.open(bot, { client: 'browser', launch: true, insecureQueryLogin: false });
        return { session, chrome, scratch, close };
    } catch (error) {
        await close().catch(() => {});
        throw error;
    }
}
