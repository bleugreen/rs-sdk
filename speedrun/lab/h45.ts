// H12o's atoll helper on the lab engine: a stand-in for cairn_h45 (docs/speedrun/helpers/mule.md) staged as run eve
// leaves it, and the run-machine launcher (helpers/standalone.ts) running its mule role in carried mode with H12o's
// config: logged out until H12oM's cue opens (loginOn), logged out on H12oP's stop (stopOn). Used by atoll-mule.ts
// (the helper's own end-to-end check) and by lab/quests/monkey-madness.ts --h45 (SCORED's chains), so both drive one
// helper. Lab only.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Subprocess } from 'bun';

import type { CueScope } from '../helpers/altar-cue';
import { mTopUpCap } from '../quests/monkey-madness';
import type { LauncherStatus } from '../helpers/standalone';
import { closeSession, loadBotEnv, logoutClean, openSession, type Session } from '../lib/session';
import { waitTicks, waitUntil } from '../lib/wait';
import { opIndex } from '../lib/world';
import { cheat, clearInventory, leaveTutorial, mustTele, setStats } from './setup';

const ROOT = resolve(import.meta.dir, '..', '..');
export const H45_M: CueScope = { step: 'H12oM', family: 'mule' };
export const H45_P: CueScope = { step: 'H12oP', family: 'mule' };
export const H45_M_TILE = { x: 2763, z: 2704 };
export const H45_P_TILE = { x: 2803, z: 2724 };
/** h45's H12oM line max: the module's ask cap, H12o-M's ledger row (`shark to 15`), so the stand-in serves what SCORED asks. */
export const H45_M_MAX = mTopUpCap();
export const H45_P_SHARKS = 9;
/** The launcher takes cairn_ helper names only; this lab-only one exists on the lab engine alone. */
export const H45_BOT = 'cairn_lab45';

export type PForm = 'fixed' | 'topup';

/**
 * h45's packages. P's 'topup' form is rs/158's ruling (rs/517): both lines top-ups, sized by SCORED's ask; 'fixed' is
 * mule.md's earlier 9 sharks + 1 potion with no ask.
 */
export function h45Packages(pForm: PForm = 'topup') {
    return [
        { name: 'H12oM', scope: H45_M, at: H45_M_TILE, items: [{ item: 'Shark', topUp: { max: H45_M_MAX } }] },
        {
            name: 'H12oP', scope: H45_P, at: H45_P_TILE,
            items: pForm === 'topup'
                ? [{ item: 'Superantipoison(4)', topUp: { max: 1 } }, { item: 'Shark', topUp: { max: H45_P_SHARKS } }]
                : [{ item: 'Shark', amount: H45_P_SHARKS }, { item: 'Superantipoison(4)', amount: 1 }],
        },
    ];
}

const sharksIn = (s: { inventory: { name: string; count: number }[] }) => s.inventory.filter(i => /^shark$/i.test(i.name)).reduce((n, i) => n + i.count, 0);

async function fresh(s: Session): Promise<void> {
    for (let attempt = 1; ; attempt++) {
        try {
            await leaveTutorial(s);
            return;
        } catch (e) {
            if (attempt >= 3) throw e;
        }
    }
}

async function giveN(s: Session, obj: string, n: number, matches: RegExp): Promise<void> {
    await cheat(s.sdk, `give ${obj} ${n}`);
    const r = await waitUntil(s.sdk, st => st.inventory.filter(i => matches.test(i.name)).reduce((a, i) => a + i.count, 0) >= n, { maxTicks: 15 });
    if (!r.ok) throw new Error(`::give ${obj} ${n} did not land`);
}

/** The lab account's bot.env (gitignored; bots/create-bot.ts takes no underscore), pointed at this lab's ports. */
export function h45Env(muleBot = H45_BOT): { account: string; password: string } {
    const path = join(ROOT, 'bots', muleBot, 'bot.env');
    const old = existsSync(path) ? loadBotEnv(muleBot) : null;
    const password = old?.PASSWORD ?? randomBytes(6).toString('hex');
    mkdirSync(join(ROOT, 'bots', muleBot), { recursive: true, mode: 0o700 });
    writeFileSync(
        path,
        `BOT_USERNAME=${muleBot}\nPASSWORD=${password}\nSERVER=localhost:${process.env.WEB_PORT ?? '9300'}\nGATEWAY_URL=ws://localhost:${process.env.AGENT_PORT ?? '8300'}\nSHOW_CHAT=false\nTELEMETRY=false\nPROFANITY_FILTER=false\n`,
        { mode: 0o600 }
    );
    return { account: loadBotEnv(muleBot).BOT_USERNAME!, password };
}

/** Stage h45 through its own client as run eve leaves it: 99 melee in rune, 13 + 9 sharks and the potion, parked logged out on P's tile. */
export async function stageH45(muleBot = H45_BOT, log: (line: string) => void = console.log): Promise<void> {
    h45Env(muleBot);
    const h45 = await openSession(muleBot, { launch: true });
    await fresh(h45);
    await clearInventory(h45.sdk);
    await setStats(h45.sdk, { attack: 99, strength: 99, defence: 99, hitpoints: 99 });
    // The best melee armour h45 can buy with no Dragon Slayer (the rune platebody needs it).
    for (const obj of ['rune_full_helm', 'rune_chainbody', 'rune_platelegs', 'rune_kiteshield', 'rune_scimitar']) await cheat(h45.sdk, `give ${obj} 1`);
    await waitUntil(h45.sdk, s => s.inventory.length >= 5, { maxTicks: 15 });
    for (let pass = 0; pass < 3 && h45.sdk.getState()!.inventory.length; pass++) {
        for (const i of h45.sdk.getState()!.inventory) {
            void h45.sdk.sendUseItem(i.slot, opIndex(i, /^(wear|wield)$/i) ?? 2);
            await waitTicks(h45.sdk, 1);
        }
        await waitTicks(h45.sdk, 2);
    }
    const dressed = h45.sdk.getState()!;
    if (dressed.inventory.length) throw new Error(`h45: not worn: ${dressed.inventory.map(i => `${i.name} [${i.optionsWithIndex.map(o => o.text).join('/')}]`).join(', ')}; worn: ${dressed.equipment.map(e => e.name).join(', ')}`);
    await giveN(h45, 'shark', H45_M_MAX + H45_P_SHARKS, /^shark$/i);
    await giveN(h45, '4dose2antipoison', 1, /^superantipoison\(4\)$/i);
    await mustTele(h45.sdk, H45_P_TILE.x, H45_P_TILE.z);
    const st = h45.sdk.getState()!;
    log(`h45: staged as ${st.player!.name}: ${st.inventory.length} slots (${sharksIn(st)} sharks), worn ${st.equipment.map(e => e.name).join(', ')}, at ${st.player!.worldX},${st.player!.worldZ}`);
    const out = await logoutClean(h45);
    if (!out.ok) throw new Error(`h45 logout: ${out.reason}`);
    await closeSession(h45);
}

/** One line of the mule's own log (runDir/logs/<account>.role.log), stamped with the tick `tick()` gave as it was read. */
export interface RoleLine {
    tick: number;
    message: string;
    data: Record<string, unknown>;
}

export interface H45Launcher {
    account: string;
    cueDir: string;
    child: Subprocess<'ignore', 'pipe', 'inherit'>;
    launcherLines: string[];
    roleLines: RoleLine[];
    role(re: RegExp): RoleLine[];
    status(): LauncherStatus['accounts'][number] | undefined;
    /** Stop the launcher (SIGTERM, then up to 40 s for its logouts). */
    stop(): Promise<void>;
}

/**
 * The launcher for h45 alone, as run day's config, its files in a fresh temp directory: `cueDir` is h45's, where
 * SCORED writes the H12o cues and asks. Every launcher and mule line is echoed through `log` with `tick()`.
 */
export function launchH45(o: { scoredAccount: string; gatewayPort: number; tick: () => number; pForm?: PForm; muleBot?: string; log?: (line: string) => void }): H45Launcher {
    const log = o.log ?? console.log;
    const env = h45Env(o.muleBot ?? H45_BOT);
    const base = mkdtempSync(join(tmpdir(), 'h45-'));
    const botsDir = join(base, 'bots');
    const runDir = join(base, 'run');
    const cueDir = join(base, 'h45-cue');
    mkdirSync(join(botsDir, env.account), { recursive: true, mode: 0o700 });
    writeFileSync(join(botsDir, env.account, 'bot.env'), `BOT_USERNAME=${env.account}\nPASSWORD=${env.password}\nSERVER=localhost:${process.env.WEB_PORT ?? '9300'}\nSHOW_CHAT=false\nTELEMETRY=false\nPROFANITY_FILTER=false\n`, { mode: 0o600 });
    const config = {
        account: env.account, role: 'mule', cueDir, loginOn: H45_M, stopOn: H45_P,
        options: { serve: o.scoredAccount, serveMode: 'request', carried: true, packages: h45Packages(o.pForm) },
    };
    const configPath = join(base, 'launch.json');
    writeFileSync(configPath, JSON.stringify({ gatewayPort: o.gatewayPort, botsDir, runDir, loginSpacingMs: 1000, accounts: [config] }, null, 2));
    log(`h45: launcher files in ${base}`);

    const launcherLines: string[] = [];
    const child: Subprocess<'ignore', 'pipe', 'inherit'> = Bun.spawn([process.execPath, 'speedrun/helpers/standalone.ts', configPath], { cwd: ROOT, env: process.env, stdin: 'ignore', stdout: 'pipe', stderr: 'inherit' });
    void (async () => {
        const decoder = new TextDecoder();
        let buf = '';
        const reader = child.stdout.getReader();
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, nl);
                buf = buf.slice(nl + 1);
                launcherLines.push(line);
                log(`[t${o.tick()}] ${line}`);
            }
        }
    })();

    const roleLines: RoleLine[] = [];
    let roleRead = 0;
    const rolePoll = setInterval(() => {
        let text = '';
        try {
            text = readFileSync(join(runDir, 'logs', `${env.account}.role.log`), 'utf8');
        } catch {
            return;
        }
        const lines = text.split('\n');
        for (const line of lines.slice(roleRead, lines.length - 1)) {
            const json = line.slice(line.indexOf('{'));
            try {
                const d = JSON.parse(json) as Record<string, unknown>;
                roleLines.push({ tick: o.tick(), message: String(d.message ?? ''), data: d });
                log(`[t${o.tick()}] h45: ${String(d.message ?? '')} ${JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => !['t', 'account', 'role', 'message'].includes(k))))}`);
            } catch {
                /* a lite or non-JSON line */
            }
        }
        roleRead = lines.length - 1;
    }, 100);
    const status = () => {
        try {
            return (JSON.parse(readFileSync(join(runDir, 'launcher.json'), 'utf8')) as LauncherStatus).accounts.find(a => a.account === env.account);
        } catch {
            return undefined;
        }
    };
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
    return {
        account: env.account, cueDir, child, launcherLines, roleLines, status,
        role: re => roleLines.filter(l => re.test(l.message)),
        async stop() {
            clearInterval(rolePoll);
            if (child.exitCode === null) {
                child.kill('SIGTERM');
                await Promise.race([child.exited, sleep(40_000)]);
            }
        },
    };
}
