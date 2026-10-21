// Dragon bones on a Woodcutting host, with real top-up trades (docs/speedrun/research/bones-placement.md).
//
//   bun docs/speedrun/scripts/bones-wc.ts <scored> --helper=<bot> --tree=oak|willow --mode=<mode>
//       [--level=60] [--prayer=43] [--ticks=600] [--load=N] [--trade=on|off] [--tag=x]
//
// Two lab sessions in one process (speedrun/lib/session.ts): the scored stand-in chops at the
// route's standing tile, and a helper stands beside it and hands over unnoted dragon bones with
// speedrun/lib/trade.ts (give / receiveFrom) whenever the scored account runs out. The helper's
// own restock is a ::give (its time is free on the scored clock).
//
// Labels are state.tick. Since #20 the lite client publishes a tick once fully decoded, so a
// roll on server tick R shows its xp (and its log, and a fell) at label R, and a packet sent
// while label t is current is processed on server tick t+1. The loop keeps R, the last roll
// tick (observed from xp, else predicted R + cycle for a failed roll), and sends by phase
// p = t - R:
//
//   plain      4-tick clock (woodcut.rs2:153-160). p0: [drop, click] -> lands R+1, arms R+4.
//   plainbury  4-tick clock with a bury in the 2-tick gap (interleaving.md section 3, the
//              1:c,2:b,3:-,0:c plan). p0: [drop, click]; p1: [bury] -> lands R+2, rejects R+3
//              (p_delay(0)) and clears the interaction; p3: [click] -> lands on the roll tick
//              R+4, where the first-click label finds %action_delay = map_clock and rolls at
//              once (woodcut.rs2:97-98).
//   knife      3-tick clock (tick-manipulation.md section 5). p0: [knife on logs, button 8889,
//              drop, click] -> the fletching writer sets R+3 (cut_logs.rs2:83-85), the click
//              continues at +2 and the continuation rolls on R+3.
//   knifebury  3-tick clock with a bury every cycle. p0: [knife on logs, button 8889, drop,
//              bury]: the knife writes R+3 first, then the bury (bury_bone.rs2: p_stopaction,
//              p_delay(0)) clears the interaction and the queued fletch (closeModal clears the
//              weak queue, Player.ts:817-820) and rejects every packet on R+2. p2: [click] ->
//              lands on R+3 itself, where the first-click label rolls at once. 4 user events,
//              then 1. The click also closes any level-up dialog (OpLocHandler:
//              clearPendingAction), so a Woodcutting or Prayer level-up costs no roll.
//
// Bootstrap (start, after a trade, after a lost lock): pretend a roll at the current label and
// send that label's p0 packets. On an expired clock the knife writes map_clock+2, so a knife
// bootstrap rolls 2 ticks after it lands; a plain click arms +3 and rolls 3 ticks after.
// Level-up dialog seen at p1 in plain/knife/plainbury: [dismiss, click] (plainbury skips that
// cycle's bury and re-bases R on the label, since the arming moved a tick).
// Trees: only the three trees reachable from the standing tile; the click goes to the current
// tree while it stands, else the next live one (a fell is visible at its roll label, so the
// switch costs nothing). All three down: idle, then bootstrap on the first respawn.
// Top-up: at a p0 label with no bones left (bury modes), the scored account sends a trade click
// to the helper (whose request has been pending since the load fell to --prerequest), receives
// --load bones, and bootstraps. The summary reports each trade's ticks (trade click label to
// the bones arriving) and the roll gap that spans it.
import { appendFileSync, writeFileSync } from 'fs';
import { hostname, loadavg } from 'os';
import type { BotWorldState, InventoryItem } from '../../../sdk/types';
import { closeSession, openSession, type Session } from '../../../speedrun/lib/session';
import { give as giveTrade, receiveFrom } from '../../../speedrun/lib/trade';
import { waitTicks, waitUntil } from '../../../speedrun/lib/wait';

const argv = process.argv.slice(2);
const kv = (k: string, d: string) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const SCORED = argv.find(a => !a.startsWith('-'))!;
const HELPER = kv('helper', 'boneshelp');
const TREE = kv('tree', 'oak');
const MODE = kv('mode', 'knifebury');
const LEVEL = Number(kv('level', TREE === 'oak' ? '60' : '88'));
const PRAYER = Number(kv('prayer', '43'));
const TICKS = Number(kv('ticks', '600'));
const KNIFE = MODE.startsWith('knife');
const BURY = MODE.endsWith('bury');
const CYCLE = KNIFE ? 3 : 4;
// Slots: rune axe + product log (+ knife + one normal log for the knife modes), one spare slot
// for a fletched shafts stack or a level-up's extra log.
const LOAD = Number(kv('load', KNIFE ? '23' : '25'));
const TRADE = kv('trade', 'on') === 'on';
const PREREQUEST = Number(kv('prerequest', '4'));
const TAG = `${TREE}-${MODE}-L${LEVEL}${kv('tag', '') ? '-' + kv('tag', '') : ''}`;
const LOG = kv('log', `${process.env.LAB_LOG ?? process.env.TMPDIR ?? '/tmp'}/bones-wc-${TAG}.log`);
writeFileSync(LOG, `# bones-wc ${argv.join(' ')} host=${hostname()} load=${loadavg().map(x => x.toFixed(1)).join('/')} tickrate=${process.env.NODE_TICKRATE} at=${new Date().toISOString()}\n`);
const log = (line: string) => appendFileSync(LOG, line + '\n');

type P = [number, number];
const SITES: Record<string, { stand: P; helper: P; trees: P[]; name: RegExp; product: RegExp }> = {
    // woodcutting.md section 2: the oak tile north of Taverley and the Taverley willow tile.
    oak: { stand: [2914, 3494], helper: [2913, 3494], trees: [[2912, 3491], [2914, 3495], [2915, 3492]], name: /^oak$/i, product: /^oak logs$/i },
    willow: { stand: [2920, 3406], helper: [2920, 3407], trees: [[2918, 3405], [2919, 3407], [2921, 3405]], name: /^willow$/i, product: /^willow logs$/i }
};
const site = SITES[TREE];
if (!site || !['plain', 'plainbury', 'knife', 'knifebury'].includes(MODE)) {
    console.error('--tree=oak|willow --mode=plain|plainbury|knife|knifebury');
    process.exit(2);
}
const BONES = /^dragon bones$/i;
const KNIFE_LOG = /^logs$/i;
const SHAFTS_BUTTON = 8889; // skill_multi3:make1_a, "15 Arrow Shafts" (tick-manipulation.md section 2)

const say = (s: Session, cmd: string) => s.sdk.sendSay(cmd);
const teleCmd = ([x, z]: P) => `::tele 0,${x >> 6},${z >> 6},${x & 63},${z & 63}`;
const at = (s: BotWorldState | null | undefined, [x, z]: P) => !!s?.player && s.player.worldX === x && s.player.worldZ === z;
const xpOf = (s: BotWorldState, skill: string) => s.skills.find(k => k.name.toLowerCase() === skill)?.experience ?? 0;
const levelOf = (s: BotWorldState, skill: string) => s.skills.find(k => k.name.toLowerCase() === skill)?.baseLevel ?? 0;
const items = (s: BotWorldState, re: RegExp) => s.inventory.filter(i => re.test(i.name)).sort((a, b) => a.slot - b.slot);

async function teleTo(s: Session, tile: P) {
    for (let i = 0; i < 6 && !at(s.sdk.getState(), tile); i++) {
        await say(s, teleCmd(tile));
        await waitUntil(s.sdk, st => at(st, tile), { maxTicks: 8 });
    }
    if (!at(s.sdk.getState(), tile)) throw new Error(`${s.name}: tele to ${tile} failed`);
    await waitTicks(s.sdk, 3);
}

const scored = await openSession(SCORED, { pathfinding: false });
const helper = await openSession(HELPER, { pathfinding: false });

// ---- setup -------------------------------------------------------------------
for (const s of [scored, helper]) {
    await s.bot.skipTutorial?.().catch(() => {});
    for (const it of [...(s.sdk.getState()?.inventory ?? [])]) await s.sdk.sendDropItem(it.slot);
    await waitTicks(s.sdk, 2);
}
await say(scored, `::setstat woodcutting ${LEVEL}`);
await say(scored, `::setstat prayer ${PRAYER}`);
await say(scored, '::give rune_axe 1');
if (KNIFE) { await say(scored, '::give knife 1'); await say(scored, '::give logs 1'); }
if (BURY) await say(scored, `::give dragon_bones ${LOAD}`);
await teleTo(scored, site.stand);
await teleTo(helper, site.helper);
if (BURY) await say(helper, `::give dragon_bones ${LOAD}`);
await waitTicks(scored.sdk, 3);
for (const s of [scored, helper]) if (s.sdk.getState()?.dialog?.isOpen) await s.sdk.sendClickDialog(0);
await waitTicks(scored.sdk, 2);
{
    const s = scored.sdk.getState()!;
    const line = `setup: scored at ${s.player?.worldX},${s.player?.worldZ} wc ${levelOf(s, 'woodcutting')} prayer ${levelOf(s, 'prayer')}; inventory ${s.inventory.map(i => i.name).join(', ')}; helper at ${helper.sdk.getState()?.player?.worldX},${helper.sdk.getState()?.player?.worldZ}`;
    log(line);
    console.log(line);
}

// ---- loop --------------------------------------------------------------------
type Tree = { x: number; z: number; id: number; op: number };
const liveTrees = (s: BotWorldState): Tree[] =>
    site.trees.flatMap(([x, z]) => {
        const l = s.nearbyLocs.find(l => l.x === x && l.z === z && site.name.test(l.name) && l.optionsWithIndex.some(o => /^chop/i.test(o.text)));
        return l ? [{ x, z, id: l.id, op: l.optionsWithIndex.find(o => /^chop/i.test(o.text))!.opIndex }] : [];
    });

const sdk = scored.sdk;
const s0 = sdk.getState()!;
const wc0 = xpOf(s0, 'woodcutting'), pr0 = xpOf(s0, 'prayer'), fl0 = xpOf(s0, 'fletching');
let lastWc = wc0, lastPr = pr0;
const rollTicks: number[] = [];
const buryTicks: number[] = [];
const breaks: number[] = []; // labels where the schedule was rebuilt (gaps across them are not cycle gaps)
const trades: Array<{ click: number; done: number; ok: boolean; reason?: string; got: number; prevRoll: number; nextRoll?: number }> = [];
const levelUps: Array<{ tick: number; skill: string; level: number }> = [];
let lvWc = levelOf(s0, 'woodcutting'), lvPr = levelOf(s0, 'prayer');
let R: number | null = null; // last roll tick (observed or predicted)
let current: Tree | null = null;
let acted = -1, busy = false, sentPackets = 0, bonesSent = 0, logsGiven = 0, resyncs = 0, allDown = 0, dialogs = 0;
let buriedAt = -1; // label of the last knifebury bundle that carried a bury (its p2 click lands on the roll)
let sinceXp = 0; // rolls predicted since the last observed xp
let helperRequest: Promise<unknown> | null = null;
const startTick = s0.tick;

const fire = (t: number, what: string, p: Promise<{ success: boolean; message?: string }>) => {
    sentPackets++;
    log(`T${t} send ${what}`);
    p.then(r => { if (!r.success) log(`T${t} FAIL ${what}: ${r.message}`); }).catch(e => log(`T${t} ERR ${what}: ${e}`));
};
const pickTree = (s: BotWorldState): Tree | null => {
    const live = liveTrees(s);
    if (current && live.some(l => l.x === current!.x && l.z === current!.z)) return current;
    current = live[0] ?? null;
    return current;
};
const click = (s: BotWorldState): boolean => {
    const tr = pickTree(s);
    if (!tr) return false;
    fire(s.tick, `click ${tr.x},${tr.z}`, sdk.sendInteractLoc(tr.x, tr.z, tr.id, tr.op));
    return true;
};
const drop = (s: BotWorldState) => {
    const p = items(s, site.product)[0];
    if (p) fire(s.tick, `drop ${p.name} slot${p.slot}`, sdk.sendDropItem(p.slot));
};
const knifeStart = (s: BotWorldState): boolean => {
    const knife = items(s, /^knife$/i)[0], lg = items(s, KNIFE_LOG)[0];
    if (!knife || !lg) { log(`T${s.tick} no knife or log`); return false; }
    fire(s.tick, `knife on logs slot${lg.slot}`, sdk.sendUseItemOnItem(knife.slot, lg.slot));
    fire(s.tick, 'button 8889', sdk.sendClickComponent(SHAFTS_BUTTON) as Promise<{ success: boolean; message?: string }>);
    return true;
};
const bury = (s: BotWorldState): boolean => {
    const b = items(s, BONES)[0];
    if (!b) return false;
    const op = b.optionsWithIndex.find(o => /^bury$/i.test(o.text))?.opIndex ?? 1;
    fire(s.tick, `bury slot${b.slot}`, sdk.sendUseItem(b.slot, op));
    bonesSent++;
    return true;
};

/** The packets of phase 0 (also the bootstrap). Returns false if no tree is up. */
const phase0 = (s: BotWorldState): boolean => {
    if (!pickTree(s)) return false;
    if (KNIFE) {
        if (!knifeStart(s)) return false;
        drop(s);
        if (BURY && bury(s)) buriedAt = s.tick;
        else click(s);
    } else {
        drop(s);
        click(s);
    }
    return true;
};

async function topUp(t: number, prevRoll: number) {
    busy = true;
    const s = sdk.getState()!;
    const before = items(s, BONES).length;
    log(`T${t} TRADE start (bones ${before}, free ${28 - s.inventory.length})`);
    const r = await receiveFrom(sdk, helper.name, { want: [{ item: BONES, amount: LOAD }], maxTicks: 60, openTimeoutMs: 20_000 });
    const done = sdk.getState()!.tick;
    const got = items(sdk.getState()!, BONES).length - before;
    trades.push({ click: t, done, ok: r.ok, ...(r.reason ? { reason: r.reason } : {}), got, prevRoll });
    log(`T${done} TRADE ${r.ok ? 'done' : 'FAILED ' + r.reason} in ${r.ticks} ticks, +${got} bones`);
    await helperRequest?.catch(() => {});
    helperRequest = null;
    await say(helper, `::give dragon_bones ${LOAD}`); // the helper's own restock, off the scored clock
    R = null;
    breaks.push(done);
    busy = false;
}

await new Promise<void>(resolve => {
    const off = sdk.onStateUpdate((s: BotWorldState) => {
        if (!s?.inGame) return;
        const t = s.tick;
        const wc = xpOf(s, 'woodcutting'), pr = xpOf(s, 'prayer');
        let rolled = false;
        if (wc > lastWc) {
            rollTicks.push(t);
            log(`T${t} WC +${(wc - lastWc) / 25}`);
            lastWc = wc;
            rolled = true;
            const tr = trades[trades.length - 1];
            if (tr && tr.nextRoll === undefined) tr.nextRoll = t;
        }
        if (pr > lastPr) { buryTicks.push(t); log(`T${t} PRAYER +${(pr - lastPr) / 25}`); lastPr = pr; }
        for (const [skill, prev] of [['woodcutting', lvWc], ['prayer', lvPr]] as const) {
            const lv = levelOf(s, skill);
            if (lv > prev) { levelUps.push({ tick: t, skill, level: lv }); log(`T${t} LEVEL ${skill} ${lv}`); if (skill === 'woodcutting') lvWc = lv; else lvPr = lv; }
        }
        if (s.dialog?.isOpen) dialogs++;
        if (t - startTick >= TICKS) { off(); resolve(); return; }
        if (busy || acted === t) return;
        acted = t;

        if (KNIFE && items(s, KNIFE_LOG).length === 0) { logsGiven++; fire(t, 'give logs (slip stand-in)', sdk.sendSay('::give logs 1')); }
        if (BURY && TRADE && !helperRequest && items(s, BONES).length <= PREREQUEST) {
            // The helper asks to trade ahead of time; the request waits until the scored account clicks.
            helperRequest = giveTrade(helper.sdk, scored.name, [{ item: BONES, n: 'all' }], { maxTicks: 80, openTimeoutMs: 60_000 })
                .then(g => log(`helper give: ${g.ok ? 'ok' : g.reason} ${g.ticks} ticks, ${g.sent} events`));
            log(`T${t} helper requests a trade`);
        }

        if (rolled) { R = t; sinceXp = 0; }
        if (R === null) {
            // Bootstrap: treat this label as a roll and send its phase-0 packets.
            if (!at(s, site.stand)) { fire(t, 'walk back', sdk.sendWalk(site.stand[0], site.stand[1])); return; }
            if (phase0(s)) { R = t; breaks.push(t); log(`T${t} bootstrap`); }
            else { allDown++; }
            return;
        }
        while (t - R >= CYCLE) { R += CYCLE; sinceXp++; }
        // A roll every cycle at oak 60+ (100%); at willow allow honest misses before calling the lock lost.
        if (sinceXp > (TREE === 'oak' && LEVEL >= 60 ? 1 : 8)) { resyncs++; log(`T${t} resync (no xp for ${sinceXp} cycles)`); R = null; current = null; return; }
        const p = t - R;
        if (p === 0) {
            if (BURY && TRADE && items(s, BONES).length === 0 && trades.length < 99) { void topUp(t, rollTicks[rollTicks.length - 1] ?? -1); return; }
            if (!phase0(s)) { allDown++; log(`T${t} all trees down`); R = null; }
            return;
        }
        const dialog = !!s.dialog?.isOpen;
        if (MODE === 'knifebury') {
            if (p === 2 && buriedAt === R) click(s);
            return;
        }
        if (MODE === 'plainbury') {
            if (p === 1) {
                if (dialog) { fire(t, 'dismiss', sdk.sendClickDialog(0)); click(s); R = t; breaks.push(t); return; }
                bury(s);
            } else if (p === 3) click(s);
            return;
        }
        if (p === 1 && dialog) { fire(t, 'dismiss', sdk.sendClickDialog(0)); click(s); }
    });
});

// ---- summary -----------------------------------------------------------------
const end = sdk.getState()!;
const span = end.tick - startTick;
const gaps: number[] = [];
for (let i = 1; i < rollTicks.length; i++) {
    const a = rollTicks[i - 1]!, b = rollTicks[i]!;
    if (!breaks.some(x => x >= a && x < b)) gaps.push(b - a);
}
const hist = (xs: number[]) => { const h: Record<number, number> = {}; for (const x of xs) h[x] = (h[x] ?? 0) + 1; return Object.entries(h).map(([k, v]) => `${k}:${v}`).join(' '); };
const wcBase = (xpOf(end, 'woodcutting') - wc0) / 25;
const prBase = (xpOf(end, 'prayer') - pr0) / 25;
const tradeTicks = trades.map(x => x.done - x.click);
const tradeGaps = trades.filter(x => x.nextRoll !== undefined && x.prevRoll >= 0).map(x => x.nextRoll! - x.prevRoll);
const summary = [
    `== bones-wc ${TAG} (NODE_TICKRATE=${process.env.NODE_TICKRATE}, host ${hostname()}, load ${loadavg().map(x => x.toFixed(1)).join('/')}) ==`,
    `span ${span} ticks; woodcutting ${lvWc} at end; rolls with xp ${rollTicks.length}; base wc ${wcBase} = ${(wcBase / span).toFixed(3)} per tick`,
    `cycle gaps (no rebuild inside) ${hist(gaps)}`,
    `bones buried ${buryTicks.length} of ${bonesSent} sent = ${(buryTicks.length / span).toFixed(3)} per tick; base prayer ${prBase}; prayer ${lvPr} at end`,
    `trades ${trades.length} (${trades.filter(x => x.ok).length} ok), bones received ${trades.reduce((n, x) => n + x.got, 0)}; trade click to bones ${hist(tradeTicks)}; roll gap spanning a trade ${hist(tradeGaps)}`,
    `level-ups ${levelUps.length} (${hist(levelUps.map(l => l.skill.length))} by name length: 11=woodcutting 6=prayer); dialog-open labels ${dialogs}`,
    `resyncs ${resyncs}; all-down labels ${allDown}; knife logs given (slips) ${logsGiven}; fletching base ${(xpOf(end, 'fletching') - fl0) / 25}; packets ${sentPackets}`,
    `end inventory ${end.inventory.map(i => i.name + (i.count > 1 ? 'x' + i.count : '')).join(', ')}`,
    `RESULT ${JSON.stringify({ tree: TREE, mode: MODE, level: LEVEL, span, rolls: rollTicks.length, wcBase, wcPerTick: wcBase / span, bones: buryTicks.length, bonesPerTick: buryTicks.length / span, trades: trades.length, tradeTicks, tradeGaps, levelUps: levelUps.length, resyncs, slips: logsGiven, gaps: hist(gaps) })}`,
    `log ${LOG}`
].join('\n');
log(summary);
console.log(summary);
await closeSession(scored).catch(() => {});
await closeSession(helper).catch(() => {});
process.exit(0);
