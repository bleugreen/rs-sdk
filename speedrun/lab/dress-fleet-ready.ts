#!/usr/bin/env bun
// The dress rehearsal's new helper families brought to ready on the lab engine and stopped again, with
// no SCORED chain: the pre-flight for lab/dress-fleet.sh (and the lab smoke of rs/760). Each family
// launches through the same function lab/dress-rehearsal.ts calls (its launcher, its port, its ready
// check), prints one RESULT line with the seconds it took, and is stopped (every account logged out).
//
//   LOCAL_STAFF_LEVEL=4 speedrun/lab/lab.sh <scored> 'speedrun/lab/dress-fleet-ready.ts:--s21-givers=...:--courier=...:--h12o=...:--carriers=<m>,<w>,<e>[:--carrier-rows=H1,H6,H20]'
//
// <scored> (lab.sh's bot) is only the receiver the carriers serve and the cues name; it never logs in.
// --carrier-rows (default every bound row) selects the carriers file's rows, as a slice would.
// Exit: 0 every named family ready, 1 one was not, 3 refused (not a lab).

import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { loadBotEnv, ROOT } from '../lib/session';
import { prepareCueDir } from '../runner/cue-keeper';
import { loadRunConfig } from '../run';
import { muleCueDir, type RunConfig } from '../runner/chain';
import { readFileSync } from 'node:fs';
import { MANIFEST } from '../tools/slot-ledger';
import { carrierBase, carrierLaunch, carrierNames, CARRIER_PORT_OFFSET, cueRootOf, labCarriersFile, launchCarriers, productionBinding, PRODUCTION_BINDING, type CarrierRole } from './carrier-launch';
import { launchCourier } from './courier-launch';
import { labH12o, launchH12o } from './h12o-launch';
import { stopLauncher } from './helper-launch';
import { launchS21Givers } from './s21-launch';
import { args } from './dress-rehearsal';
import { labRefusal } from './stand-ins';
import { canonName } from '../helpers/altar-cue';

const list = (v: string | undefined) => (v ?? '').split(/[,\s]+/).filter(Boolean);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function main(argv: string[]): Promise<number> {
    const a = args(argv);
    if (!a.bot) {
        console.error('usage: bun speedrun/lab/dress-fleet-ready.ts <scored> [--s21-givers=...] [--courier=...] [--h12o=...] [--carriers=<m>,<w>,<e>] [--carrier-rows=...]');
        return 2;
    }
    const env = loadBotEnv(a.bot);
    const server = env.SERVER || `localhost:${process.env.WEB_PORT ?? '9300'}`;
    const refusal = labRefusal({ staffLevel: process.env.LOCAL_STAFF_LEVEL ?? '4', server, gateway: `ws://localhost:${process.env.AGENT_PORT ?? 8300}` });
    if (refusal) {
        console.error(`[fleet-ready] REFUSED: ${refusal}`);
        return 3;
    }
    const agentPort = Number(process.env.AGENT_PORT ?? 8300);
    const runDir = join(ROOT, 'run-machine');
    // The cue dir as a run config resolves it (RC_CUE_DIR, else run-machine/rc-cue).
    const cfg = { cueDir: loadRunConfigCueDir(runDir) } as Pick<RunConfig, 'cueDir' | 'h12o' | 'muleCueDir'>;
    prepareCueDir(cfg.cueDir, { fresh: true });
    prepareCueDir(muleCueDir(cfg), { fresh: true });
    const launchers: Subprocess[] = [];
    const results: { family: string; ok: boolean; detail: string }[] = [];
    const run = async (family: string, f: () => Promise<string>) => {
        try {
            results.push({ family, ok: true, detail: await f() });
        } catch (e) {
            results.push({ family, ok: false, detail: message(e) });
        }
        console.log(`RESULT fleet-ready ${JSON.stringify(results.at(-1))}`);
    };
    try {
        const s21 = list(a['s21-givers']);
        if (s21.length) await run('S21 givers', async () => `${s21.length} awaiting {S21, altar} after ${(await launchS21Givers({ root: ROOT, givers: s21, cueDir: cfg.cueDir, server, agentPort }, l => launchers.push(l))).secs} s`);
        if (a.courier) await run('S18 courier', async () => `${a.courier} awaiting {S18, courier} after ${(await launchCourier({ root: ROOT, account: a.courier!, cueDir: cfg.cueDir, server, agentPort }, l => launchers.push(l))).secs} s`);
        if (a.h12o) {
            const h = labH12o(a.h12o, cfg);
            for (const d of [h.cueDir, h.loginDir]) prepareCueDir(d, { fresh: true });
            await run('H12o helper', async () => `${a.h12o} awaiting {H12o, mule} in ${h.loginDir} after ${(await launchH12o({ root: ROOT, h12o: h, serve: env.BOT_USERNAME, cueDir: cfg.cueDir, server, agentPort }, l => launchers.push(l))).secs} s`);
        }
        const carriers = list(a.carriers);
        if (carriers.length) {
            await run('carriers', async () => {
                const names = carrierNames(carriers);
                const prod = productionBinding(JSON.parse(readFileSync(PRODUCTION_BINDING, 'utf8')));
                const rows = list(a['carrier-rows']);
                const deliveryRun = a['delivery-run'] ?? `lab-ready-${Date.now()}`;
                const file = labCarriersFile({ manifest: readFileSync(MANIFEST, 'utf8'), prod, names, cueRoot: cueRootOf(muleCueDir(cfg)), serve: env.BOT_USERNAME, deliveryRun, ...(rows.length ? { rows } : {}) });
                const b = carrierBase(file.accounts.map(e => e.account), server);
                const config = carrierLaunch({ entries: file.accounts, botsDir: b.botsDir, runDir: b.runDir, gatewayPort: agentPort + CARRIER_PORT_OFFSET });
                const roles = Object.fromEntries(Object.entries(names).map(([r, n]) => [canonName(n), r as CarrierRole]));
                const r = await launchCarriers({ root: ROOT, base: b.base, config, roles, muleDir: muleCueDir(cfg), serve: env.BOT_USERNAME, deliveryRun, agentPort, log: l => console.log(`[fleet-ready] ${l}`) }, l => launchers.push(l));
                return `${file.accounts.map(e => `${e.account} on ${e.options.packages[0]!.scope!.step}`).join(', ')} ready after ${r.secs} s`;
            });
        }
    } finally {
        for (const l of launchers) await stopLauncher(l).catch(() => {});
    }
    return results.every(r => r.ok) ? 0 : 1;
}

/** The cue dir loadRunConfig would give (RC_CUE_DIR, else <runDir>/rc-cue), without a config file. */
function loadRunConfigCueDir(runDir: string): string {
    void loadRunConfig;
    return process.env.RC_CUE_DIR ? join(process.env.RC_CUE_DIR) : join(runDir, 'rc-cue');
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
