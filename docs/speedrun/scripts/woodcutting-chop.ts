// Woodcutting cycle, success-rate, depletion and drop-pattern measurement.
//
// usage:
//   bun docs/speedrun/scripts/woodcutting-chop.ts <bot> --tree Willow --level 99 \
//       --stand 3058,3253 --trees '3057,3251;3057,3254;3059,3252' --logs 300 \
//       --click rotate --drop each
//
// --tree    loc name as the client shows it (Tree, Oak, Willow, Maple tree, Yew, Magic tree)
// --level   ::setstat woodcutting <level> before starting
// --hold    re-apply ::setstat after every log, so the success rate is sampled at one level
// --stand   tile to teleport to; every tree in --trees must be in reach from it
// --trees   SW-corner coords of the trees to use (woodcutting-spots.ts output)
// --logs    stop after this many logs (or after --maxticks)
// --click   react:  click the current tree only when needed (start, after a drop,
//                   after the tree depletes)
//           rotate: every tick, click the next live tree in the list (a different one
//                   from last tick), so a depletion never leaves the player idle
// --drop    each:    drop every log once as it arrives (with a click in the same batch)
//           full:    let the inventory fill, then drop 4 logs + click per tick
//           noclick: drop every log with no click; re-click only after 12 idle ticks
//
// Every event line carries the client's server-tick counter (state.tick, one per
// server tick, so differences are server ticks):
//   X  xp gain (a log)   D  tree depleted (stump seen)   R  tree respawned
//   S  'You swing your axe' message   P  drop sent   I  chopping stopped
// The summary reports the success rate from xp gaps that lie on the 4-tick grid,
// ticks lost (gaps off the grid, counted mod 4), depletions per log, respawn ticks
// and the sustained base xp per tick against the ideal p * xp / 4.
import { runScript } from '../../../sdk/runner';
import type { BotWorldState, NearbyLoc } from '../../../sdk/types';

const argv = process.argv.slice(3);
const opt = (name: string, dflt?: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : dflt;
};
const flag = (name: string) => argv.includes(`--${name}`);
const treeName = opt('tree', 'Willow')!;
const level = opt('level');
const hold = flag('hold');
const stand = opt('stand')?.split(',').map(Number);
const trees = (opt('trees') ?? '').split(';').filter(Boolean).map(s => s.split(',').map(Number) as [number, number]);
const targetLogs = Number(opt('logs', '100'));
const clickMode = opt('click', 'react') as 'react' | 'rotate';
const dropMode = opt('drop', 'each') as 'each' | 'full' | 'noclick';
const maxTicks = Number(opt('maxticks', String(targetLogs * 40 + 200)));
const verbose = flag('verbose');

const XP_PER_LOG: Record<string, number> = { Tree: 25, Oak: 37.5, Willow: 67.5, 'Maple tree': 100, Yew: 175, 'Magic tree': 250 };
const LOHI: Record<string, [number, number]> = { Tree: [224, 700], Oak: [112, 350], Willow: [56, 175], 'Maple tree': [28, 87], Yew: [14, 44], 'Magic tree': [7, 21] };
const pRoll = (L: number) => {
    const [lo, hi] = LOHI[treeName];
    const v = Math.floor((lo * (99 - L)) / 98) + Math.floor((hi * (L - 1)) / 98) + 1;
    return Math.min(v, 256) / 256;
};

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial();
    const ticks = (n: number) => sdk.waitForTicks(n);

    // ---- setup ----
    if (level) await sdk.sendSay(`::setstat woodcutting ${level}`);
    await ticks(2);
    const st0 = sdk.getState()!;
    if (!st0.equipment.some(i => /axe/i.test(i.name)) && !st0.inventory.some(i => /Rune axe/.test(i.name))) {
        await sdk.sendSay('::give rune_axe 1');
        await ticks(2);
    }
    const axe = sdk.getState()!.inventory.find(i => /Rune axe/.test(i.name));
    const wield = axe?.optionsWithIndex.find(o => /wield/i.test(o.text));
    if (axe && wield) { await sdk.sendUseItem(axe.slot, wield.opIndex); await ticks(2); }
    for (const it of sdk.getState()!.inventory.filter(i => /logs/i.test(i.name))) { await sdk.sendDropItem(it.slot); await ticks(1); }
    if (stand) {
        await sdk.sendSay(`::tele 0,${stand[0] >> 6},${stand[1] >> 6},${stand[0] & 63},${stand[1] & 63}`);
        await ticks(4);
    }
    const me = sdk.getState()!.player!;
    console.log(`setup: at (${me.worldX},${me.worldZ}) wc=${sdk.getSkill('woodcutting')?.level} tree=${treeName} click=${clickMode} drop=${dropMode} hold=${hold}`);
    console.log(`nearby: ${sdk.getState()!.nearbyLocs.filter(l => l.distance <= 4).map(l => `${l.name}@(${l.x},${l.z})`).join(' ')}`);

    // ---- measurement ----
    const key = (t: [number, number]) => `${t[0]},${t[1]}`;
    const alive = (s: BotWorldState, t: [number, number]): NearbyLoc | undefined =>
        s.nearbyLocs.find(l => l.x === t[0] && l.z === t[1] && l.name === treeName && l.options.some(o => /chop/i.test(o)));
    const fire = (p: Promise<unknown>) => { p.catch(e => console.log(`send error: ${e}`)); };
    const out = (k: string, t: number, extra = '') => { if (verbose || k !== 'S') console.log(`${k} t=${t} ${extra}`); };

    type Ev = { k: string; t: number; tree?: string; lvl?: number };
    const events: Ev[] = [];
    const seenMsg = new Set<number | string>();
    const deadSince = new Map<string, number>();
    const respawns: number[] = [];
    const droppedAt = new Map<number, number>(); // slot -> tick a drop was sent
    let current: [number, number] | null = null;
    let lastClicked = '';
    let lastXp = sdk.getSkillXp('woodcutting') ?? 0;
    let logs = 0;
    let startTick = -1, lastTick = -1, interruptions = 0, allDeadTicks = 0;

    const click = (s: BotWorldState, t: [number, number]) => {
        const loc = alive(s, t)!;
        fire(sdk.sendInteractLoc(loc.x, loc.z, loc.id, 1));
        lastClicked = key(t);
        current = t;
    };

    await new Promise<void>(resolve => {
        const off = sdk.onStateUpdate(s => {
            if (s.tick === lastTick) return; // one pass per server tick
            lastTick = s.tick;
            if (startTick < 0) startTick = s.tick;
            if (s.dialog.isOpen) fire(sdk.sendClickDialog(0));

            // A log is counted from its 'You get some ...' message (one per success); xp
            // deltas would miss a log that lands on the same tick as a --hold level reset.
            const wc = s.skills.find(k => k.name.toLowerCase() === 'woodcutting')!;
            let gotLog = false;
            for (const m of s.gameMessages) {
                const id = m.observationId ?? `${m.tick}:${m.text}`;
                if (seenMsg.has(id)) continue;
                seenMsg.add(id);
                if (/^You get some/.test(m.text)) gotLog = true;
                if (/swing your axe/.test(m.text)) { events.push({ k: 'S', t: s.tick }); out('S', s.tick); }
                if (/too full|need a Woodcutting level|do not have an axe/.test(m.text)) out('M', s.tick, m.text);
            }
            if (gotLog) {
                logs++;
                // with --hold the roll was made at the held level
                events.push({ k: 'X', t: s.tick, tree: current ? key(current) : '?', lvl: hold && level ? Number(level) : wc.level });
                out('X', s.tick, `lvl=${wc.level} xp=${wc.experience} tree=${current ? key(current) : '?'}`);
                if (hold && level && wc.baseLevel !== Number(level)) fire(sdk.sendSay(`::setstat woodcutting ${level}`));
            }
            lastXp = wc.experience;
            for (const t of trees) {
                const k = key(t);
                const up = !!alive(s, t);
                if (!up && !deadSince.has(k)) { deadSince.set(k, s.tick); events.push({ k: 'D', t: s.tick, tree: k }); out('D', s.tick, k); }
                if (up && deadSince.has(k)) { const d = s.tick - deadSince.get(k)!; respawns.push(d); deadSince.delete(k); events.push({ k: 'R', t: s.tick, tree: k }); out('R', s.tick, `${k} after ${d}`); }
            }
            if (current && !alive(s, current)) current = null;
            if (logs >= targetLogs || s.tick - startTick > maxTicks) { off(); resolve(); return; }

            const live = trees.filter(t => alive(s, t));
            if (!live.length) { allDeadTicks++; return; }
            const needTree = !current;
            if (needTree) current = live[0];

            // drops: each log once (a dropped item lingers in state for a tick or two)
            const logItems = s.inventory.filter(i => /logs/i.test(i.name) && !(droppedAt.has(i.slot) && s.tick - droppedAt.get(i.slot)! < 4));
            const free = 28 - s.inventory.length;
            let drops: number[] = [];
            if (dropMode === 'each' || dropMode === 'noclick') drops = logItems.slice(0, 1).map(i => i.slot);
            else if (free === 0 || (events.some(e => e.k === 'P' && e.t === s.tick - 1) && logItems.length)) drops = logItems.slice(0, 4).map(i => i.slot);
            for (const slot of drops) { fire(sdk.sendDropItem(slot)); droppedAt.set(slot, s.tick); events.push({ k: 'P', t: s.tick }); }
            if (drops.length && dropMode !== 'each') out('P', s.tick, `x${drops.length} free=${free}`);

            if (dropMode === 'noclick') {
                const lastAct = [...events].reverse().find(e => e.k === 'X' || e.k === 'C');
                if (needTree || startTick === s.tick || (lastAct && s.tick - lastAct.t >= 12)) {
                    if (lastAct?.k === 'X' && s.tick - lastAct.t >= 12) { interruptions++; out('I', s.tick, `no xp for 12 ticks after the log at ${lastAct.t}`); }
                    click(s, current!);
                    events.push({ k: 'C', t: s.tick });
                }
                return;
            }
            if (clickMode === 'rotate') {
                const next = live.find(t => key(t) !== lastClicked) ?? live[0];
                click(s, next);
            } else if (drops.length || needTree || startTick === s.tick) {
                click(s, current!);
            }
        });
    });

    // ---- summary ----
    const xs = events.filter(e => e.k === 'X');
    const ds = events.filter(e => e.k === 'D' && xs.some(x => x.t === e.t));
    const gaps = xs.slice(1).map((b, i) => ({ gap: b.t - xs[i].t, lvl: xs[i].lvl!, depl: ds.some(d => d.t === xs[i].t) }));
    const onGrid = gaps.filter(g => g.gap % 4 === 0 && !g.depl);
    const rolls = onGrid.reduce((n, g) => n + g.gap / 4, 0);
    const expected = onGrid.reduce((n, g) => n + pRoll(g.lvl), 0) / onGrid.length;
    const hist: Record<number, number> = {};
    for (const g of gaps) hist[g.gap] = (hist[g.gap] ?? 0) + 1;
    const offGrid = gaps.filter(g => g.gap % 4 !== 0 && !g.depl);
    const deplGaps = gaps.filter(g => g.depl);
    const span = xs.length ? xs[xs.length - 1].t - xs[0].t : 0;
    const p = onGrid.length / rolls;
    const summary = {
        tree: treeName, click: clickMode, drop: dropMode, level: level ?? 'current', hold,
        logs: xs.length, ticksFirstToLastLog: span,
        successRate: +p.toFixed(4), expectedSuccessRate: +expected.toFixed(4), rollsSampled: rolls,
        stdErr: +Math.sqrt((p * (1 - p)) / rolls).toFixed(4),
        gapHistogram: hist,
        offGridGaps: offGrid.length, ticksLostOffGridMod4: offGrid.reduce((n, g) => n + (g.gap % 4), 0),
        depletions: ds.length, depletionPerLog: +(ds.length / xs.length).toFixed(4),
        afterDepletionGapMod4: deplGaps.map(g => g.gap % 4),
        meanLossAfterDepletionMod4: +(deplGaps.reduce((n, g) => n + (g.gap % 4), 0) / (deplGaps.length || 1)).toFixed(3),
        ticksWithAllTreesDown: allDeadTicks,
        respawnTicks: respawns,
        interruptions,
        baseXpPerTick: +(((xs.length - 1) * XP_PER_LOG[treeName]) / span).toFixed(3),
        idealBaseXpPerTick: +((XP_PER_LOG[treeName] * expected) / 4).toFixed(3),
    };
    console.log(`SUMMARY ${JSON.stringify(summary)}`);
}, { timeout: 60 * 60_000, printState: false });
