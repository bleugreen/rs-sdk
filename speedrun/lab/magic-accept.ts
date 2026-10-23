// Lab acceptance for the Magic step module (speedrun/skills/magic.ts, STEP-MANIFEST.md entry 24).
//
//   [LAB_HELPERS="<g1> <g2> <g3>"] speedrun/lab/lab.sh <scored> 'speedrun/lab/magic-accept.ts:--mode=<mode>[:--givers=<g1>,<g2>,<g3>]'
//
// Modes (the scored stand-in is the lab bot named on the lab.sh line, never the scored account):
//   diamond25  Magic 57, 25 diamond rings, cosmic and earth runes: enchantHeld. Pass: 25 of 25 casts at 3-tick spacing.
//   s02        a fresh account: S00's tutorial skip (the starter kit's air and mind runes), ::tele to
//              the coop gate (3235,3295), then the S02 step. Reports the step's ticks against 18.
//   s04        S04 from its real preconditions: Magic 7, the staff of water wielded, cosmic 60, air 81,
//              fire 80, earth 50 and a tinderbox, at the Firemaking row's end (3200,3226), with one
//              stand-in ring giver per load beside it (rs/41's cairn_h81-h83) speaking magic.ts
//              RING_CONTRACT: each staged with its load by ::give, a request standing once its load
//              is next, give() with ANY_OFFER. Passes at the goal with the last load's 20
//              enchanted rings held (for S05's swap, rs/158). Reports the step's ticks against 204.
//   s04 also takes --loads=1..3 (a shorter run) and --clicks=N (spell clicks per label).
//
// Setup uses staff cheats and is untimed; the timed span is the step's own TickLog row.

import { closeSession, openSession, type Session } from '../lib/session';
import { formatReport, report } from '../lib/ticks';
import { ANY_OFFER, clickBack, decideTradeClick, give, newClickCtx, sameName, sendTradeClick, swap, tradeOf, type WantSpec } from '../lib/trade';
import { nextTick, waitTicks, waitUntil } from '../lib/wait';
import { wield } from '../lib/act';
import { runSteps } from '../runner/step';
import { ENCHANTS, enchantedRingSpecs, enchantHeld, magicLevel, magicXp, ROUTE_LOADS, steps, type MagicReport } from '../skills/magic';
import { onTutorialIsland } from '../lib/world';
import { tutorialSkip } from '../skills/start';
import { launchLabBrowser, type LabBrowser } from './browser';
import { giverTiles as sharedGiverTiles, serveLoads, stageLoad } from './ring-givers';
import { arg, botArg, labLog, result } from './common';
import { cheat, mustTele } from './setup';

const mode = arg('mode', 'diamond25');
const giverNames = arg('givers', '').split(',').filter(Boolean);
const nLoads = Number(arg('loads', '3'));
const clicks = Number(arg('clicks', '1'));
// No module fixes the row's end yet (RUN-ORDER.md T02-03); rs/198's lab row starts at (3240,3296)
// beside the coop, on open ground. The givers must stand on SCORED's side of any wall: a trade
// request paths around one, and both players then walk to meet (seen at (3200,3226)).
const ROW_END = { x: 3240, z: 3296 };
const COOP_GATE = { x: 3235, z: 3295 };
/** S05's arrival tile at Doric's (RUN-ORDER.md T04-05). */
const DORIC = { x: 2952, z: 3451 };

// S01's tile, where the staging stands before a cold arrival: 74 tiles south of the coop and the row,
// outside the area the client has loaded around them, so the teleport rebuilds the region.
const S01_TILE = { x: 3222, z: 3222 };

// --client=browser: SCORED in a Chrome tab on the lab's /bot page (main's standard for clicks right
// after a landing; lab.sh with LAB_RUNNERS=0, so only the givers get lite runners). The page
// publishes to the gateway named in its URL.
const browserMode = arg('client', 'lite') === 'browser';
const browser: LabBrowser | null = browserMode ? await launchLabBrowser(botArg()) : null;
const scored = await openSession(botArg(), browserMode ? { client: 'browser', launch: true, insecureQueryLogin: true } : {});
const log = labLog(`magic-${mode}`);
const noStop = { shouldStop: () => false, logout: async () => {} };

async function leaveTutorial(s: Session): Promise<void> {
    // rs/196, rs/284: a new account must pass S00 before staging, or inventory ops are ignored.
    if (onTutorialIsland(s.sdk.getState()?.player)) await runSteps(s, [tutorialSkip], { log, c: {}, ...noStop });
}

async function wipe(s: Session): Promise<void> {
    await cheat(s.sdk, '~clearinv inv');
    await cheat(s.sdk, '~clearinv worn');
    await waitUntil(s.sdk, st => st.inventory.length === 0 && st.equipment.length === 0, { maxTicks: 10 });
}

async function giveAll(s: Session, cmds: string[], slots: number): Promise<void> {
    for (const c of cmds) await cheat(s.sdk, `give ${c}`);
    const r = await waitUntil(s.sdk, st => st.inventory.length >= slots, { maxTicks: 15 });
    if (!r.ok) throw new Error(`staging: ${s.sdk.getState()?.inventory.length} slots after ${cmds.join(', ')}`);
    await waitTicks(s.sdk, 2);
}

const giverTiles = (n: number, at: { x: number; z: number } = ROW_END) => sharedGiverTiles(n, at);

const stepTicks = (name: string) => log.rows.filter(r => r.step === name).map(r => ({ ticks: r.ticks, ok: r.ok, ...(r.error ? { error: r.error } : {}) }));
const histogram = (xs: number[]) => xs.reduce<Record<number, number>>((h, x) => ((h[x] = (h[x] ?? 0) + 1), h), {});

let pass = false;

if (mode === 'diamond25') {
    await leaveTutorial(scored);
    await mustTele(scored.sdk, ROW_END.x, ROW_END.z);
    await wipe(scored);
    await cheat(scored.sdk, 'setstat magic 57');
    await waitUntil(scored.sdk, st => magicLevel(st) === 57, { maxTicks: 10 });
    await giveAll(scored, ['cosmicrune 25', 'earthrune 250', 'diamond_ring 25'], 27);
    await nextTick(scored.sdk);
    const r = await enchantHeld(scored.sdk, { untilLevel: 99, clicksPerTick: clicks });
    const gaps = r.xpTicks.slice(1).map((t, i) => t - r.xpTicks[i]!);
    pass = r.ok && r.casts === 25 && gaps.every(g => g === 3);
    result('magic diamond25', { pass, casts: r.casts, gaps: histogram(gaps), span: r.xpTicks.length ? r.xpTicks.at(-1)! - r.xpTicks[0]! : 0, clicks: r.clicks, ...(r.reason ? { reason: r.reason } : {}) });
} else if (mode === 's02') {
    await leaveTutorial(scored);
    // As S01 leaves SCORED: Magic 1 at the landing tile, the starter runes (a reset, so a lab
    // account serves several runs). Then a cold arrival at the coop and the step at once.
    await mustTele(scored.sdk, S01_TILE.x, S01_TILE.z);
    await wipe(scored);
    if (magicLevel(scored.sdk.getState()) > 1) {
        await cheat(scored.sdk, 'setstat magic 1');
        await waitUntil(scored.sdk, st => magicXp(st) === 0, { maxTicks: 10 });
    }
    if (magicXp(scored.sdk.getState()) !== 0) throw new Error(`s02 needs Magic xp 0, not ${magicXp(scored.sdk.getState())}`);
    await giveAll(scored, ['tinderbox 1', 'airrune 25', 'mindrune 15', 'waterrune 6', 'earthrune 4', 'bodyrune 2'], 6);
    await mustTele(scored.sdk, COOP_GATE.x, COOP_GATE.z);
    const reports: MagicReport[] = [];
    const [s02] = steps({ onReport: r => reports.push(r) });
    await runSteps(scored, [s02!], { log, c: {}, ...noStop });
    const rep = reports.find(r => r.step === 'S02') as Extract<MagicReport, { step: 'S02' }> | undefined;
    const rows = stepTicks(s02!.name);
    // The exit drop (rs/158): the mind runes are gone a few labels later.
    const gone = await waitUntil(scored.sdk, st => !st.inventory.some(i => /^mind rune$/i.test(i.name)), { maxTicks: 5 });
    pass = rows.length === 1 && rows[0]!.ok && magicLevel(scored.sdk.getState()) >= 7 && gone.ok;
    result('magic s02', { pass, step: rows, against: 18, level: magicLevel(scored.sdk.getState()), xp: magicXp(scored.sdk.getState()), dropped: rep?.dropped, mindGone: gone.ok, strike: rep?.strike });
} else if (mode === 's04') {
    if (giverNames.length < Math.min(nLoads, 3)) throw new Error(`--givers=<a,b,c> needs one lab bot per load (${nLoads}), each also on LAB_HELPERS`);
    const givers: Session[] = [];
    for (const n of giverNames.slice(0, nLoads)) givers.push(await openSession(n, { pathfinding: false }));
    for (const s of [scored, ...givers]) await leaveTutorial(s);
    // SCORED is staged away from the row and arrives cold just before the step (below).
    await mustTele(scored.sdk, S01_TILE.x, S01_TILE.z);
    const tiles = giverTiles(givers.length);
    for (const [i, g] of givers.entries()) await mustTele(g.sdk, tiles[i]!.x, tiles[i]!.z);
    for (const s of [scored, ...givers]) await wipe(s);
    await cheat(scored.sdk, 'setstat magic 7');
    await waitUntil(scored.sdk, st => magicLevel(st) === 7, { maxTicks: 10 });
    await giveAll(scored, ['staff_of_water 1'], 1);
    const w = await wield(scored.sdk, /^staff of water$/i);
    if (!w.ok) throw new Error(`wielding the staff: ${w.reason ?? 'failed'}`);
    await giveAll(scored, ['tinderbox 1', 'cosmicrune 60', 'airrune 81', 'firerune 80', 'earthrune 50'], 5);

    // ---------------------------------------------------------------- the stand-in ring givers
    // One giver per load (rs/41: cairn_h81-h83), each staged with its load before the step: the
    // contract's "staged during S03". A giver keeps a request standing only once its load is next.
    const loads = ROUTE_LOADS.slice(0, nLoads);
    const untilLevel = nLoads >= 3 ? 59 : nLoads === 2 ? 49 : 27;
    const scoredName = scored.sdk.getState()!.player!.name;
    const giverLog: Array<Record<string, unknown>> = [];
    let stopGiver = false;
    for (const [i, l] of loads.entries()) await stageLoad(givers[i]!, l);
    const giverLoop = serveLoads(givers, scoredName, loads, () => stopGiver, s => giverLog.push({ ...s }));
    if (process.argv.includes('--trace')) {
        // Every side's trade screens and new game messages, per published state that changes them.
        for (const [who, s] of [['scored', scored], ...givers.map((g, i) => [`giver${i + 1}`, g] as const)] as const) {
            let prev = '';
            let seen = s.sdk.getState()?.gameMessages.length ?? 0;
            s.sdk.onStateUpdate(st => {
                const t = tradeOf(st);
                const at = `@${st.player?.worldX},${st.player?.worldZ} `;
                const line = at + (t.isOpen ? `${t.screen} mine=${t.myOffer.map(i => `${i.name}x${i.count}`).join(',')} theirs=${t.theirOffer.map(i => `${i.name}x${i.count}`).join(',')} acc=${t.myAccepted}/${t.partnerAccepted}` : `closed dialog=${st.dialog.isOpen} modal=${st.modalOpen}`);
                const msgs = st.gameMessages.slice(seen).map(m => m.text);
                seen = st.gameMessages.length;
                if (line !== prev || msgs.length) console.log(`TRACE t=${st.tick} ${who} ${line}${msgs.length ? ` msgs=${JSON.stringify(msgs)}` : ''}`);
                prev = line;
            });
        }
    }
    // The cold arrival (main's standard): SCORED lands at the row's end and the step starts at
    // once, so its first trade and cast go out while the region is still loading.
    await mustTele(scored.sdk, ROW_END.x, ROW_END.z);
    const where = givers.map((g, i) => `${giverNames[i]}@${g.sdk.getState()?.player?.worldX},${g.sdk.getState()?.player?.worldZ}`);
    console.log(`GIVERS ${where.join(' ')} scored-sees-on-landing=${JSON.stringify(scored.sdk.getState()?.nearbyPlayers.map(p => p.name))} client=${browserMode ? 'browser' : 'lite'}`);

    const reports: MagicReport[] = [];
    const [, s04] = steps({ loads: loads.map((rings, i) => ({ rings, giver: giverNames[i]! })), untilLevel, clicksPerTick: clicks, onReport: r => reports.push(r) });
    let error: string | undefined;
    try {
        await runSteps(scored, [s04!], { log, c: {}, ...noStop });
    } catch (e) {
        error = e instanceof Error ? e.message : String(e);
    }
    {
        const where = givers.map((g, i) => {
            const st = g.sdk.getState();
            return `${giverNames[i]}@${st?.player?.worldX},${st?.player?.worldZ} inGame=${st?.inGame} tick=${st?.tick} sees=${JSON.stringify(st?.nearbyPlayers.map(p => p.name))}`;
        });
        const ss = scored.sdk.getState();
        console.log(`AFTER scored@${ss?.player?.worldX},${ss?.player?.worldZ} tick=${ss?.tick} sees=${JSON.stringify(ss?.nearbyPlayers.map(p => `${p.name}#${p.index}`))} | ${where.join(' | ')}`);
    }
    stopGiver = true;
    await Promise.race([giverLoop, waitTicks(scored.sdk, 10)]);
    const rep = reports.find(r => r.step === 'S04') as Extract<MagicReport, { step: 'S04' }> | undefined;
    const rows = stepTicks(s04!.name);
    const end = scored.sdk.getState()!;
    // S04 never walks: a SCORED that left its tile was pulled by a trade around an obstacle.
    const moved = Math.max(Math.abs(end.player!.worldX - ROW_END.x), Math.abs(end.player!.worldZ - ROW_END.z));
    if (moved > 2 && !error) error = `SCORED moved ${moved} tiles during the step (to ${end.player!.worldX},${end.player!.worldZ})`;
    // The last load's 20 enchanted rings stay held for S05 (rs/158); nothing unenchanted is left.
    const enchanted = end.inventory.filter(i => /^ring of /i.test(i.name)).length;
    const unenchanted = end.inventory.filter(i => / ring$/i.test(i.name)).length;
    const lastLoad = Object.values(loads.at(-1)!).reduce((a, n) => a + (n ?? 0), 0);
    pass = !error && rows.length === 1 && rows[0]!.ok && magicLevel(end) >= untilLevel && enchanted === lastLoad && unenchanted === 0;
    const against = Math.round((204 * nLoads) / 3);
    result('magic s04', { pass, loads: nLoads, untilLevel, step: rows, against, moved, level: magicLevel(end), enchanted, unenchanted, report: rep, giver: giverLog, ...(error ? { error } : {}) });
    for (const g of givers) await closeSession(g);
}

if (mode === 'h4') {
    // SUPPLIES.md hand-off H4 at Doric's: SCORED offers S04's last 20 enchanted rings in the same
    // trade (rs/158's ruling; S05's module owns the call), against a plain receive of H4.
    if (giverNames.length < 1) throw new Error('--givers=<lab bot> is required for h4 (and LAB_HELPERS=<it>)');
    const giver = await openSession(giverNames[0]!, { pathfinding: false });
    for (const s of [scored, giver]) await leaveTutorial(s);
    const trials = Number(arg('n', '2'));
    const H4_GIVES = ['clay 6', 'copper_ore 4', 'iron_ore 2', 'lawrune 3', 'airrune 9', 'waterrune 3', 'air_talisman 1', 'rune_axe 1', 'rune_pickaxe 1', 'knife 1', 'logs 6'];
    const H4_SLOTS = 6 + 4 + 2 + 3 + 1 + 1 + 1 + 1 + 6; // clay, copper, iron, 3 rune stacks, talisman, axe, pickaxe, knife, logs
    const want: WantSpec[] = [
        [/^clay$/i, 6], [/^copper ore$/i, 4], [/^iron ore$/i, 2], [/^law rune$/i, 3], [/^air rune$/i, 9], [/^water rune$/i, 3],
        [/^air talisman$/i, 1], [/^rune axe$/i, 1], [/^rune pickaxe$/i, 1], [/^knife$/i, 1], [/^logs$/i, 6],
    ].map(([item, amount]) => ({ item: item as RegExp, amount: amount as number }));
    // What SCORED holds after S04: the tinderbox and the starter kit's 5 rune stacks (S04 spends
    // H1's cosmic, air, fire and earth exactly), the staff of water worn, and the 20 rings.
    // --drop=bodyrune,... leaves those starter stacks out (dropped on the way, a slot each).
    const dropped = arg('drop', '').split(',').filter(Boolean);
    const KEPT = ['tinderbox 1', 'airrune 21', 'mindrune 11', 'waterrune 6', 'earthrune 4', 'bodyrune 2'].filter(k => !dropped.includes(k.split(' ')[0]!));
    const rows: Array<Record<string, unknown>> = [];
    for (let t = 0; t < trials * 2; t++) {
        const withRings = t % 2 === 0;
        await mustTele(scored.sdk, DORIC.x, DORIC.z);
        await mustTele(giver.sdk, giverTiles(1, DORIC)[0]!.x, giverTiles(1, DORIC)[0]!.z);
        await wipe(scored);
        await wipe(giver);
        await giveAll(scored, ['staff_of_water 1'], 1);
        const w = await wield(scored.sdk, /^staff of water$/i);
        if (!w.ok) throw new Error(`wielding the staff: ${w.reason ?? 'failed'}`);
        await giveAll(scored, withRings ? [...KEPT, 'ring_of_forging 15', 'ring_of_life 5'] : KEPT, KEPT.length + (withRings ? 20 : 0));
        await giveAll(giver, H4_GIVES, H4_SLOTS);
        const free = 28 - scored.sdk.getState()!.inventory.length;
        let req = newClickCtx();
        let stop = false;
        const giverSide = (async () => {
            while (!stop) {
                const st = await nextTick(giver.sdk);
                if (!tradeOf(st).isOpen) {
                    const p = st.nearbyPlayers.find(x => sameName(x.name, scored.sdk.getState()!.player!.name));
                    if (!p) continue;
                    const d = decideTradeClick(st, req, { noReplyTicks: 3, resendTicks: 100 });
                    req = d.next;
                    if (d.action === 'send') sendTradeClick(giver.sdk, p.index, req.sentTick, (sent, tick) => (req = clickBack(req, sent, tick)));
                    continue;
                }
                return give(giver.sdk, scored.sdk.getState()!.player!.name, H4_GIVES.map(g => ({ item: new RegExp(`^${g.split(' ')[0]!.replace(/_/g, ' ').replace(/rune$/, ' rune')}$`, 'i') })), { expectTheirs: ANY_OFFER, maxTicks: 40 });
            }
            return undefined;
        })();
        await waitTicks(scored.sdk, 3);
        const r = await swap(scored.sdk, giverNames[0]!, withRings ? enchantedRingSpecs(scored.sdk.getState()!) : [], want, { closeModals: true });
        stop = true;
        const g = await Promise.race([giverSide, waitTicks(giver.sdk, 5).then(() => undefined)]);
        const end = scored.sdk.getState()!;
        const msgs = end.gameMessages.slice(-6).map(m => m.text).filter(m => /space|room|free/i.test(m));
        rows.push({ variant: withRings ? 'swap' : 'receive', ok: r.ok, ticks: r.ticks, openTicks: r.openTicks, freeBefore: free, freeAfter: 28 - end.inventory.length, kept: KEPT.length, ringsLeft: end.inventory.filter(i => /^ring of /i.test(i.name)).length, giverOk: g?.ok, ...(r.reason ? { reason: r.reason } : {}), ...(g?.reason ? { giverReason: g.reason } : {}), ...(msgs.length ? { msgs } : {}) });
        console.log(`H4 ${JSON.stringify(rows.at(-1))}`);
        await waitTicks(scored.sdk, 3);
    }
    const ok = (v: string) => rows.filter(r => r.variant === v && r.ok).map(r => r.ticks as number);
    pass = rows.every(r => r.ok);
    result('magic h4', { pass, swap: ok('swap'), receive: ok('receive'), rows });
    await closeSession(giver);
}

console.log(formatReport(report(log.rows)));
await closeSession(scored);
await browser?.kill();
process.exit(pass ? 0 : 1);
