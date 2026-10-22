// Lab acceptance for the hand-off steps (speedrun/runner/handoff.ts): H1 at S01 (STEP-MANIFEST.md
// entry 33) and an out-and-back row (H13, rs/318's ruling 5).
//
//   LAB_HELPERS=<partner> speedrun/lab/lab.sh <scored> \
//     'speedrun/lab/handoff-accept.ts:--row=H1:--partner=<partner>[:--ledger=FILE | --ledger-ref=REF][:--client=browser][:--n=3]'
//
// The row is read from the inventory ledger: STEP-MANIFEST.md by default, `--ledger=FILE` (H13's
// out-and-back form is speedrun/lab/fixtures/handoff-h13.md until fold-in 18 writes it), or
// `--ledger-ref=REF` for the manifest as of another branch (rs/158's, where the table is). An
// executor cell that cannot fetch that branch takes the row's table lines in a file, `--ledger=FILE`.
//
// H1: S01's real precondition. <scored> must be a fresh account (its first login on this engine):
//   S00's tutorialSkip lands it on S01's tile (Lumbridge, 3222,3222), where the partner already
//   stands with the row's `in` and a standing request, and the step runs at once. One run per
//   invocation, since only a first login is fresh.
// H13 and other rows: <scored> holds what the row gives (a weapon worn, so it comes off first) and
//   arrives by ::tele beside the partner, already on its tile (--tile, default the Ardougne teleport
//   landing), and the step runs at once; `--n` runs. A `NAME(*)` give names no one obj to stage:
//   `--hold=OBJ,OBJ,...` puts those objs (debug names, one each) in SCORED's pack instead, e.g.
//   H13's mixed antipoison doses (speedrun/lab/fixtures/handoff-h13-doses.md):
//   --hold=3doseantipoison,1doseantipoison,1doseantipoison. An `@ID` entry is staged as its obj (its
//   note for an `in` at [n]).
// The partner is rs/41's HS1 giver code (helpers/mule.ts giveOpenTrade, burst, ANY_OFFER), with
// lib/trade.ts's one trade-click rule (decideTradeClick) for its standing request. --client=browser puts <scored> in a Chrome tab on the lab's
// /bot page (lab.sh with LAB_RUNNERS=0, so only the partner gets a lite runner).
//
// Pass: every run's step row is ok (its postcondition is the post-hand-off state) and the partner's
// give succeeded. Reports the step's in-world ticks per run (the TickLog row: observed ticks).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { wield } from '../lib/act';
import { closeSession, openSession, type Session } from '../lib/session';
import { formatReport, report } from '../lib/ticks';
import { waitTicks } from '../lib/wait';
import { onTutorialIsland, pos } from '../lib/world';
import { handOffFrom, handOffStep, type HandOffPlan, type HandOffReport } from '../runner/handoff';
import { runSteps } from '../runner/step';
import { LUMBRIDGE_SPAWN } from '../skills/start';
import { MANIFEST } from '../tools/slot-ledger';
import { launchLabBrowser, type LabBrowser } from './browser';
import { arg, botArg, labLog, result } from './common';
import { objFor, serveStandingRequest, stage, stageReceive, wipe } from './handoff-partner';
import { leaveTutorial, mustTele, setStats } from './setup';

const row = arg('row', 'H1');
const partnerName = arg('partner', '');
const runs = Number(arg('n', row === 'H1' ? '1' : '3'));
if (!partnerName) throw new Error('--partner=<lab bot> is required (and LAB_HELPERS=<it>)');
const ledgerRef = arg('ledger-ref', '');
const ledger = ledgerRef
    ? execFileSync('git', ['show', `${ledgerRef}:docs/speedrun/STEP-MANIFEST.md`], { encoding: 'utf8' })
    : readFileSync(arg('ledger', MANIFEST), 'utf8');
const plan = handOffFrom(ledger, row);

// The Ardougne teleport lands in (2659-2663, 3299-3303); the partner one tile west of the spread
// (SUPPLIES.md H23's tile), SCORED in its middle.
const [tx, tz] = arg('tile', '2658,3301').split(',').map(Number) as [number, number];
const PARTNER_TILE = row === 'H1' ? { x: LUMBRIDGE_SPAWN.x + 1, z: LUMBRIDGE_SPAWN.z } : { x: tx, z: tz };
const LANDING = { x: 2661, z: 3301 };
const AWAY = { x: 3222, z: 3218 };

const hold = arg('hold', '').split(',').filter(Boolean);

// --client=browser, as magic-accept.ts: a headless Chrome on the lab's /bot page.
const browserMode = arg('client', 'lite') === 'browser';
const browser: LabBrowser | null = browserMode ? await launchLabBrowser(botArg()) : null;

const scored = await openSession(botArg(), browserMode ? { client: 'browser', launch: true, insecureQueryLogin: true } : {});
const partner = await openSession(partnerName, { pathfinding: false });
const log = labLog(`handoff-${row}`);
const noStop = { shouldStop: () => false, logout: async () => {} };
const leave = (s: Session) => leaveTutorial(s, log);

const rows: Array<Record<string, unknown>> = [];
for (let n = 0; n < runs; n++) {
    if (onTutorialIsland(partner.sdk.getState()?.player)) await leave(partner);
    await mustTele(partner.sdk, PARTNER_TILE.x, PARTNER_TILE.z);
    await stageReceive(partner, plan);

    let fresh = false;
    if (row === 'H1') {
        // S01's precondition: the account's first login, then S00 lands it beside the partner.
        if (!onTutorialIsland(scored.sdk.getState()?.player)) throw new Error(`H1 needs a fresh account: ${scored.name} is off Tutorial Island already`);
        fresh = true;
    } else {
        if (onTutorialIsland(scored.sdk.getState()?.player)) await leave(scored);
        await mustTele(scored.sdk, AWAY.x, AWAY.z);
        await wipe(scored);
        await stageGives(scored, plan);
    }

    const scoredName = scored.sdk.getState()!.player!.name;
    let stop = false;
    const partnerSide = serveStandingRequest(partner, scoredName, () => stop);
    // The arrival, and the step at once: S00's landing for H1, a cold ::tele for the rest.
    if (fresh) await leave(scored);
    else await mustTele(scored.sdk, LANDING.x, LANDING.z);
    const reports: HandOffReport[] = [];
    const step = handOffStep<Record<string, never>>(plan, { partner: partnerName, onReport: r => reports.push(r) });
    const seen = scored.sdk.getState()?.nearbyPlayers.map(p => p.name) ?? [];
    let error: string | undefined;
    try {
        await runSteps(scored, [step], { log, c: {}, ...noStop, tickMonitor: false });
    } catch (e) {
        error = e instanceof Error ? e.message : String(e);
    }
    stop = true;
    const g = await Promise.race([partnerSide, waitTicks(partner.sdk, 10).then(() => undefined)]);
    const stepRow = log.rows.filter(r => r.step === step.name).at(-1);
    const end = scored.sdk.getState()!;
    rows.push({
        run: n + 1, client: browserMode ? 'browser' : 'lite', ok: !error && !!stepRow?.ok && !!g?.success, ticks: stepRow?.ticks, trade: reports[0],
        partnerOk: g?.success, partnerTicks: g?.ticks, partnerMessage: g?.message, seenOnArrival: seen, at: pos(end),
        worn: end.equipment.map(e => e.name), ...(error ? { error } : {}),
    });
    console.log(`HANDOFF ${JSON.stringify(rows.at(-1))}`);
    await waitTicks(scored.sdk, 3);
}

/** What the row gives, in SCORED's pack, with a weapon worn so the step takes it off first. */
async function stageGives(s: Session, p: HandOffPlan): Promise<void> {
    // The levels SCORED has by the out-and-back rows (the magic shortbow is Ranged 50; the scimitar Attack 20).
    await setStats(s.sdk, { ranged: 50, attack: 20 });
    // A family's doses come from --hold.
    const named = p.give.filter(g => !g.perObj || g.ids);
    await stage(s, [...named.map(g => ({ obj: objFor(g), count: g.count === 'all' ? 1 : g.count, kind: 'u' })), ...hold.map(obj => ({ obj, count: 1, kind: 'u' }))]);
    for (const g of p.give) {
        if (!/bow|staff|scimitar|sword|knife|axe/i.test(g.name)) continue;
        const w = await wield(s.sdk, g.pattern);
        if (!w.ok) throw new Error(`staging: wielding ${g.name}: ${w.reason ?? 'failed'}`);
    }
}

const pass = rows.length === runs && rows.every(r => r.ok);
const ticks = rows.map(r => r.ticks);
result(`handoff ${row}`, { pass, client: browserMode ? 'browser' : 'lite', trade: plan.give.length ? 'swap' : 'receive', ticks, rows });
console.log(formatReport(report(log.rows)));
await closeSession(partner);
await closeSession(scored);
await browser?.kill();
process.exit(pass ? 0 : 1);
