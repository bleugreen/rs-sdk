// The lab check of lab/h45-atoll.ts (rs/613), once, on the local lab engine only: a stand-in h45 staged as rs/465 left
// cairn_h45 (end of Monkey Madness G, Grand Tree and Tree Gnome Village complete, adamant, coins 270, 11 sharks and the
// five Grand Tree items, logged out at (2465,3490)), a lab donor holding the shortfall (13 sharks + 1
// Superantipoison(4)) south of the Stronghold gate, then the driver itself in --lab --auto against the generated
// package. The staging uses staff cheats; the driver sends none.
//
//   LAB_RUNNERS=0 NODE_TICKRATE=400 LAB_TIMEOUT=2400 speedrun/lab/lab.sh srlab613 speedrun/lab/h45-atoll-lab.ts
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { h45LauncherEntry } from '../helpers/mule-ledger';
import { waitForPlayer } from '../helpers/wine';
import { closeSession, logoutClean, openSession, type Session } from '../lib/session';
import { give } from '../lib/trade';
import { waitTicks, waitUntil } from '../lib/wait';
import { opIndex } from '../lib/world';
import { h45Env } from './h45';
import { PREREQ_VARS } from './quests/monkey-madness';
import { cheat, clearInventory, leaveTutorial, mustTele, setStats, setVars } from './setup';

const ROOT = resolve(import.meta.dir, '..', '..');
const STAND_IN = 'cairn_lab45';
const DONOR = 'cairn_labd2';
/** lab/quests/monkey-madness.ts ATOLL_ARRIVED + HANGAR_DONE: segment G's end, as rs/463 read it. */
const END_OF_G = {
    mm_main: 3, mm_narnode: 7, mm_caranock: 3, mm_daero: 7, mm_waydar: 1, mm_lumdo: 3,
    mm_daero_option_bit_one: 1, mm_daero_option_bit_two: 1, mm_daero_option_bit_three: 1, mm_hangar_puzzle_complete: 1,
};
const GT_ITEMS = ['grandtree_scroll', 'grandtree_translationbook', 'grandtree_journal', 'grandtree_order', 'grandtree_gloughskey'];

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

async function stageStandIn(): Promise<void> {
    h45Env(STAND_IN);
    const s = await openSession(STAND_IN, { launch: true });
    await fresh(s);
    await clearInventory(s.sdk);
    await setStats(s.sdk, { attack: 99, strength: 99, defence: 99, hitpoints: 99, agility: 76, magic: 57 });
    for (const obj of ['adamant_full_helm', 'adamant_longsword', 'adamant_chainbody', 'adamant_platelegs']) await cheat(s.sdk, `give ${obj} 1`);
    await waitUntil(s.sdk, st => st.inventory.length >= 4, { maxTicks: 15 });
    for (let pass = 0; pass < 3 && s.sdk.getState()!.inventory.length; pass++) {
        for (const i of s.sdk.getState()!.inventory) {
            void s.sdk.sendUseItem(i.slot, opIndex(i, /^(wear|wield)$/i) ?? 2);
            await waitTicks(s.sdk, 1);
        }
        await waitTicks(s.sdk, 2);
    }
    await setVars(s.sdk, { ...PREREQ_VARS, ...END_OF_G });
    await cheat(s.sdk, 'give coins 270');
    await cheat(s.sdk, 'give shark 11');
    for (const obj of GT_ITEMS) await cheat(s.sdk, `give ${obj} 1`);
    await waitUntil(s.sdk, st => st.inventory.length >= 17, { maxTicks: 20 });
    await mustTele(s.sdk, 2465, 3490);
    const st = s.sdk.getState()!;
    console.log(`stand-in: ${st.inventory.length} slots ${JSON.stringify(st.inventory.map(i => [i.id, i.name, i.count]))}, worn ${st.equipment.map(e => e.name).join(', ')}`);
    // Logged out, so the driver's login publishes the quest tab the ::setvar calls changed (login.rs2).
    const out = await logoutClean(s);
    if (!out.ok) throw new Error(`stand-in logout: ${out.reason}`);
    await closeSession(s);
}

async function stageDonor(): Promise<Session> {
    h45Env(DONOR);
    const d = await openSession(DONOR, { launch: true });
    await fresh(d);
    await clearInventory(d.sdk);
    await cheat(d.sdk, 'give shark 13');
    await cheat(d.sdk, 'give 4dose2antipoison 1');
    await waitUntil(d.sdk, st => st.inventory.length >= 14, { maxTicks: 20 });
    await mustTele(d.sdk, 2462, 3379);
    return d;
}

async function main(): Promise<void> {
    const pkg = join(tmpdir(), `h45-pkg-${process.pid}.json`);
    writeFileSync(pkg, JSON.stringify(h45LauncherEntry(), null, 2));
    await stageStandIn();
    const donor = await stageDonor();
    const driver = Bun.spawn([process.execPath, 'speedrun/lab/h45-atoll.ts', STAND_IN, '--lab', '--auto', `--package=${pkg}`, `--donor=${DONOR}`], { cwd: ROOT, env: process.env, stdout: 'inherit', stderr: 'inherit' });
    const seen = await waitForPlayer(donor.sdk, STAND_IN, 20 * 60_000);
    if (seen) {
        const g = await give(donor.sdk, STAND_IN, [{ item: 385, n: 13 }, { item: 2448, n: 1 }], { openMaxTicks: 200 });
        console.log(`donor: give ${JSON.stringify({ ok: g.ok, reason: (g as { reason?: string }).reason ?? null })}`);
    } else console.log('donor: the stand-in never came to the gate');
    await logoutClean(donor).catch(() => undefined);
    await closeSession(donor);
    const code = await driver.exited;
    console.log(`RESULT h45_atoll_lab ${JSON.stringify({ driverExit: code })}`);
    process.exit(code);
}

if (import.meta.main) await main();
