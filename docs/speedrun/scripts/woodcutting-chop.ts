// Woodcutting cycle, success-rate, depletion and drop-pattern measurement.
//
// usage:
//   bun docs/speedrun/scripts/woodcutting-chop.ts <bot> --tree Willow --level 99 \
//       --stand 3058,3253 --trees 3057,3251;3057,3254;3059,3252 --logs 300 --mode each
//
// --tree    loc name as the client shows it (Willow, Oak, Maple tree, Yew, Magic tree)
// --level   ::setstat woodcutting <level> before starting (omit to keep the current level)
// --stand   tile to teleport to; every tree in --trees must be in reach from it
// --trees   SW-corner coords of the trees to rotate between (woodcutting-spots.ts output)
// --logs    stop after this many logs
// --mode    each:    drop every log as it arrives, re-clicking the tree in the same batch
//           full:    let the inventory fill, then drop 4 logs + re-click the tree per tick
//           noclick: drop every log without re-clicking; re-click only after chopping stops
//
// Logs one line per event, with the client's server-tick counter (state.tick, one per
// server tick, so differences are server ticks):
//   X  xp gain (a log)           S  'You swing your axe' (printed on the tick a click is processed)
//   D  tree depleted (stump seen) R  tree respawned
//   C  click sent                P  drop sent
// and a summary: success rate from uninterrupted gaps, depletion rate, ticks lost per
// tree switch, respawn ticks, and the sustained base xp per tick.
import { runScript } from '../../../sdk/runner';
import type { BotWorldState, NearbyLoc } from '../../../sdk/types';

const argv = process.argv.slice(3);
const opt = (name: string, dflt?: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : dflt;
};
const treeName = opt('tree', 'Willow')!;
const level = opt('level');
const stand = opt('stand')?.split(',').map(Number);
const trees = (opt('trees') ?? '').split(';').filter(Boolean).map(s => s.split(',').map(Number) as [number, number]);
const targetLogs = Number(opt('logs', '100'));
const mode = opt('mode', 'each') as 'each' | 'full' | 'noclick';
const maxTicks = Number(opt('maxticks', String(targetLogs * 40 + 200)));

const XP_PER_LOG: Record<string, number> = { Tree: 25, Oak: 37.5, Willow: 67.5, 'Maple tree': 100, Yew: 175, 'Magic tree': 250 };
const LOHI: Record<string, [number, number]> = { Tree: [224, 700], Oak: [112, 350], Willow: [56, 175], 'Maple tree': [28, 87], Yew: [14, 44], 'Magic tree': [7, 21] };
const pRoll = (L: number) => {
    const [lo, hi] = LOHI[treeName];
    const v = Math.floor((lo * (99 - L)) / 98) + Math.floor((hi * (L - 1)) / 98) + 1;
    return Math.min(v, 256) / 256;
};

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial();
    const say = (m: string) => sdk.sendSay(m);
    const ticks = (n: number) => sdk.waitForTicks(n);

    // ---- setup ----
    if (level) await say(`::setstat woodcutting ${level}`);
    await ticks(2);
    const st0 = sdk.getState()!;
    const hasAxe = st0.equipment.some(i => /axe/i.test(i.name)) || st0.inventory.some(i => /Rune axe/.test(i.name));
    if (!hasAxe) { await say('::give rune_axe 1'); await ticks(2); }
    const axe = sdk.getState()!.inventory.find(i => /Rune axe/.test(i.name));
    if (axe) {
        const wield = axe.optionsWithIndex.find(o => /wield/i.test(o.text));
        if (wield) await sdk.sendUseItem(axe.slot, wield.opIndex);
        await ticks(2);
    }
    for (const it of sdk.getState()!.inventory.filter(i => /logs/i.test(i.name))) { await sdk.sendDropItem(it.slot); await ticks(1); }
    if (stand) {
        await say(`::tele 0,${stand[0] >> 6},${stand[1] >> 6},${stand[0] & 63},${stand[1] & 63}`);
        await ticks(3);
    }
    const me = sdk.getState()!.player!;
    console.log(`setup: at (${me.worldX ?? (me as any).x},${me.worldZ ?? (me as any).z}) wc=${sdk.getSkill('woodcutting')?.level} mode=${mode} tree=${treeName}`);
    const seen = sdk.getState()!.nearbyLocs.filter(l => l.distance <= 4).map(l => `${l.name}@(${l.x},${l.z})`);
    console.log(`nearby: ${seen.join(' ')}`);

    // ---- measurement ----
    const alive = (s: BotWorldState, t: [number, number]): NearbyLoc | undefined =>
        s.nearbyLocs.find(l => l.x === t[0] && l.z === t[1] && l.name === treeName && l.options.some(o => /chop/i.test(o)));
    const fire = (p: Promise<unknown>) => { p.catch(e => console.log(`send error: ${e}`)); };

    let current: [number, number] | null = null;
    let lastXp = sdk.getSkillXp('woodcutting') ?? 0;
    let logs = 0;
    const seenMsg = new Set<number | string>();
    const events: { k: string; t: number; tree?: string; lvl?: number }[] = [];
    const deadSince = new Map<string, number>();
    const respawns: number[] = [];
    let startTick = -1;
    let lastTick = -1;
    let idleSince = -1; // noclick mode: tick chopping was noticed to stop
    const key = (t: [number, number]) => `${t[0]},${t[1]}`;
    const log = (k: string, t: number, extra = '') => { console.log(`${k} t=${t} ${extra}`); };

    const click = (s: BotWorldState, t: [number, number]) => {
        const loc = alive(s, t)!;
        fire(sdk.sendInteractLoc(loc.x, loc.z, loc.id, 1));
        events.push({ k: 'C', t: s.tick, tree: key(t) });
        log('C', s.tick, key(t));
    };

    await new Promise<void>(resolve => {
        const off = sdk.onStateUpdate(s => {
            if (s.tick === lastTick) return; // one pass per server tick
            lastTick = s.tick;
            if (startTick < 0) startTick = s.tick;
            if (s.dialog.isOpen) fire(sdk.sendClickDialog(0));

            const lvl = s.skills.find(k => k.name.toLowerCase() === 'woodcutting')!;
            const gained = lvl.experience > lastXp;
            if (gained) {
                logs++;
                events.push({ k: 'X', t: s.tick, tree: current ? key(current) : '?', lvl: lvl.level });
                log('X', s.tick, `lvl=${lvl.level} xp+${(lvl.experience - lastXp) / 25} tree=${current ? key(current) : '?'}`);
                lastXp = lvl.experience;
            }
            for (const m of s.gameMessages) {
                const id = m.observationId ?? `${m.tick}:${m.text}`;
                if (seenMsg.has(id)) continue;
                seenMsg.add(id);
                if (/swing your axe/.test(m.text)) { events.push({ k: 'S', t: s.tick }); log('S', s.tick); }
                if (/too full|need a Woodcutting level|do not have an axe/.test(m.text)) log('M', s.tick, m.text);
            }
            // depletion and respawn bookkeeping
            for (const t of trees) {
                const k = key(t);
                const up = !!alive(s, t);
                if (!up && !deadSince.has(k)) { deadSince.set(k, s.tick); events.push({ k: 'D', t: s.tick, tree: k }); log('D', s.tick, k); }
                if (up && deadSince.has(k)) { const d = s.tick - deadSince.get(k)!; respawns.push(d); deadSince.delete(k); events.push({ k: 'R', t: s.tick, tree: k }); log('R', s.tick, `${k} after ${d}`); }
            }
            if (current && !alive(s, current)) current = null;

            if (logs >= targetLogs || s.tick - startTick > maxTicks) { off(); resolve(); return; }

            const needTree = !current;
            if (needTree) {
                const next = trees.find(t => alive(s, t));
                if (!next) return; // all depleted: wait for a respawn
                current = next;
            }
            const logItems = s.inventory.filter(i => /logs/i.test(i.name));
            const free = 28 - s.inventory.length;
            if (mode === 'each') {
                if (logItems.length) { fire(sdk.sendDropItem(logItems[0].slot)); log('P', s.tick, `slot${logItems[0].slot}`); }
                if (logItems.length || needTree || startTick === s.tick) click(s, current!);
            } else if (mode === 'full') {
                const dropping = free === 0 || (logItems.length > 0 && events.some(e => e.k === 'P' && e.t === s.tick - 1));
                if (dropping) {
                    for (const it of logItems.slice(0, 4)) { fire(sdk.sendDropItem(it.slot)); events.push({ k: 'P', t: s.tick }); }
                    log('P', s.tick, `x${Math.min(4, logItems.length)} (free=${free})`);
                }
                if (dropping || needTree || startTick === s.tick) click(s, current!);
            } else {
                if (logItems.length) { fire(sdk.sendDropItem(logItems[0].slot)); log('P', s.tick, `slot${logItems[0].slot}`); }
                const lastX = [...events].reverse().find(e => e.k === 'X' || e.k === 'C');
                // re-click only when no xp for 12 ticks (chopping has visibly stopped)
                if (needTree || startTick === s.tick || (lastX && s.tick - lastX.t >= 12)) {
                    if (lastX && lastX.k === 'X' && s.tick - lastX.t >= 12) { idleSince = lastX.t; log('I', s.tick, `no xp for 12 ticks after drop at ${lastX.t}: interrupted`); }
                    click(s, current!);
                }
            }
        });
    });

    // ---- summary ----
    const xs = events.filter(e => e.k === 'X');
    const ss = events.filter(e => e.k === 'S');
    const ds = events.filter(e => e.k === 'D');
    // uninterrupted gaps: consecutive logs on the same tree with no tree switch between
    const gaps: { gap: number; lvl: number }[] = [];
    for (let i = 1; i < xs.length; i++) {
        const a = xs[i - 1], b = xs[i];
        if (a.tree !== b.tree) continue;
        if (ds.some(d => d.tree === a.tree && d.t >= a.t && d.t < b.t)) continue;
        gaps.push({ gap: b.t - a.t, lvl: a.lvl! });
    }
    const off4 = gaps.filter(g => g.gap % 4 !== 0);
    const rolls = gaps.reduce((n, g) => n + g.gap / 4, 0);
    const expected = gaps.reduce((n, g) => n + pRoll(g.lvl), 0) / gaps.length;
    const hist: Record<number, number> = {};
    for (const g of gaps) hist[g.gap] = (hist[g.gap] ?? 0) + 1;
    // tree-switch loss: depletion seen at D (= roll tick), first swing message after the
    // switch click at S (= click tick + 1), first roll on the new tree at S + 2;
    // without the switch the next roll would have been D + 4.
    const switchLoss: number[] = [];
    const swingToRoll: number[] = [];
    for (const d of ds) {
        const depletedTree = xs.find(x => x.t === d.t && x.tree === d.tree);
        if (!depletedTree) continue; // a respawn-timer depletion of a tree we were not chopping
        const s = ss.find(e => e.t > d.t);
        if (!s) continue;
        switchLoss.push(s.t + 2 - (d.t + 4));
        const nextX = xs.find(x => x.t > s.t);
        if (nextX) swingToRoll.push((nextX.t - (s.t + 2)) % 4);
    }
    const span = xs.length ? xs[xs.length - 1].t - startTick : 0;
    const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
    const summary = {
        tree: treeName, mode, logs: xs.length, ticks: span,
        gapsMeasured: gaps.length, gapsNotMultipleOf4: off4.length, gapHistogram: hist,
        rollsInGaps: rolls, successRate: gaps.length / rolls, expectedSuccessRate: expected,
        depletions: ds.filter(d => xs.some(x => x.t === d.t && x.tree === d.tree)).length,
        depletionPerLog: ds.filter(d => xs.some(x => x.t === d.t && x.tree === d.tree)).length / xs.length,
        switchLossTicks: switchLoss, meanSwitchLoss: mean(switchLoss),
        firstRollAfterSwitchAlignedTo4: swingToRoll.every(r => r === 0),
        respawnTicks: respawns,
        baseXpPerTick: (xs.length * XP_PER_LOG[treeName]) / span,
        idealBaseXpPerTick: (XP_PER_LOG[treeName] * expected) / 4,
        interrupted: idleSince >= 0,
    };
    console.log(`SUMMARY ${JSON.stringify(summary)}`);
}, { timeout: 30 * 60_000, printState: false });
