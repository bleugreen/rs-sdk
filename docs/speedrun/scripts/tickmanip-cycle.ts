// Measure gathering cycles with and without eat tick-manipulation.
//
//   bun docs/speedrun/scripts/tickmanip-cycle.ts <bot> --mode=<method>-<technique> [--rolls=N]
//       [--level=L] [--phase=P] [--maxticks=T]
//
// method:    wc (willow, Draynor), fly (lure, Barbarian Village), flylumb (lure, Lumbridge river,
//            the route's spot, fishing.md section 2), cage (lobster, Catherby)
// technique: base (click once, re-click only when idle), eat (one food bite per cycle) or
//            knife (knife on logs + the arrow-shafts button, sent blind in the same tick)
//
// Knife technique: the fletching writer runs after the menu choice
// (cut_logs.rs2:80-86: if %action_delay < map_clock, set map_clock+2), so the knife-on-logs
// packet, the skill_multi3:make1_a button (component 8889, arrow shafts from normal logs,
// Fletching 1) and the target click all go out together. The server registers the resume
// buttons as soon as the knife script suspends, so the blind button is accepted
// (IfButtonHandler.ts:20,29), and the click's closeModal clears the weak queue before the
// fletch runs (Player.ts:817-820): no log is used. It replaces the eat in the schedule below.
//
// Eat technique (docs/speedrun/skills/tick-manipulation.md): eating ordinary food runs
// %action_delay += 3 (consume.rs2) from an inventory op, with no menu. Sent on the tick
// after a roll R, it moves the next roll to R+3. The op also clears the interaction
// (OpHeldHandler -> clearPendingAction), so the target is re-clicked every cycle:
//   wc, fly:  [eat, drop?, click] on R+1 (their first-click labels fall through on offset +2)
//   cage:     [eat, drop?] on R+1, [click] on R+3 (its first-click label rolls only on offset 0)
// "Observed tick t" is the lite client's count of server ticks; packets sent while
// handling t land in server tick t+1. --phase shifts the schedule for calibration.
//
// Packets cannot react to an observed roll in time (state -> gateway -> script -> gateway
// -> client costs 1-2 ticks), so the schedule is open-loop: a click on an expired clock
// landing on tick C rolls at C+r0, so the first eat is sent r0+1 ticks after the click and
// then every 3 ticks; every packet shares the same latency, so relative timing survives.
// xp drops are only used to detect a lost lock (then: stop, let the clock expire, re-click).
//
// Route segments (levels change during the run):
//   --until=L       stop when the skill's base level reaches L (--rolls and --maxticks become caps)
//   --from-xp=B     report the segment from the tick base xp first reaches B (a quest start)
//   --dismiss=now|blind|none  answer a level-up dialog the tick it is seen with
//                   sendClickDialog(0) (blind: { blind: true }); default now
//   --dismiss=watcher|burst|click|none  the level-up lab's policies (levelup-dismiss.ts): the
//                   speedrun/lib watcher, one blind continue per expected page, a re-click of
//                   the target, or nothing (the next starter closes it); each level-up is logged
//                   as an episode and summarised
//   --reanchor=click|xp  after a lost lock or a moved spot: click (default) waits 5 ticks for
//                   the clock to expire, re-clicks and steps the phase; xp re-clicks the
//                   nearest target at once and anchors the schedule on the first xp it sees.
//                   After a roll on R the normal loop rolls next on R + r0 + 1, so the first
//                   starter goes out on label R + r0 + 1, the same as a bootstrap at label R.
//   --xplag=0|1     label offset of a roll's xp: 0 on the lite client since #20 (a tick is
//                   published once fully decoded), 1 before it
//   --marks=B1,B2,..  print the tick at which base xp first reaches each Bi and the ticks
//                   from there to the end (quest-start segments, fishing.md section 3)
//   --gate=on|off   run-time host gate (tick-manipulation.md, "Run-time host gate";
//                   speedrun/lib/hostgate.ts), on by default for eat and knife: probe packet
//                   latency before the first lock, after every lost lock (no xp), and every
//                   500 ticks while off. While it is off the base technique runs instead.
//                   off: always manipulate (the rows measured before the gate).
//   --threshold=F   the gate's on-time fraction (default 0.95)
// The lost-lock window for fly fishing scales with the read catch chance at the current
// level, so a run of honest misses at a low level is not taken for a lost lock: 3 ticks per
// roll for enough rolls that all of them fail with chance below 0.5% (at least 15 ticks).
// A fishing spot that teleports keeps its NPC index, so a move is detected by its tile; the
// client never follows it (fishing.md section 4).
//
// Every packet sent and every xp change is logged with its tick to --log
// (default $TMPDIR/tickmanip-<mode>.log); a summary goes to stdout.
import { runScript } from '../../../sdk/runner';
import type { BotWorldState, InventoryItem } from '../../../sdk/types';
import { appendFileSync, writeFileSync } from 'fs';
import { hostname } from 'os';
import { HostGate } from '../../../speedrun/lib/hostgate';
import { isPolicy, LevelUpLab } from './levelup-dismiss';

const args: Record<string, string> = Object.fromEntries(
    process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
        const [k, ...v] = a.slice(2).split('=');
        return [k, v.length ? v.join('=') : 'true'];
    })
);
const mode = args.mode ?? 'wc-eat';
const [methodName, technique] = mode.split('-');
const untilLevel = args.until ? Number(args.until) : 0;
const rollsTarget = Number(args.rolls ?? (untilLevel ? Infinity : 200));
const level = Number(args.level ?? 99);
const phase = Number(args.phase ?? 0);
const maxTicks = Number(args.maxticks ?? (untilLevel ? 30_000 : rollsTarget * 12 + 200));
const fromXp = Number(args['from-xp'] ?? 0);
const dismiss = args.dismiss ?? 'now';
const reanchor = args.reanchor ?? 'click';
const XP_LAG = Number(args.xplag ?? 0);
const marks = (args.marks ?? '').split(',').filter(Boolean).map(Number);
const dropProducts = args.drop !== 'false';
const DEMO = args.demo === 'true';
// --inject-late=F holds a random fraction F of starter bundles one label, so they land a tick
// late: a lab stand-in for a host where that share of packets is late (main's Ashburn probe).
const INJECT_LATE = Number(args['inject-late'] ?? 0);
// A mistimed lock starves completely (each eat pushes the clock past the next click), so
// "no xp for lockWindow ticks" means lost lock; size it so honest misses rarely trip it.
const LOCK_WINDOW: Record<string, number> = { wc: 18, oak: 18, tree: 18, fly: 15, flylumb: 15, cage: 45 };
const logPath = args.log ?? `${process.env.TMPDIR ?? '/tmp'}/tickmanip-${mode}${args.tag ? '-' + args.tag : ''}.log`;
const FOOD = /^shrimps$/i;
const FOOD_OBJ = 'shrimp';

interface Method {
    skill: string;
    tele: string;
    give: Array<[string, number]>;
    kind: 'loc' | 'npc';
    target: RegExp;
    option: RegExp;
    product: RegExp;
    /** First-click label rolls only when the clock equals map_clock (click on R+3). */
    clickOnRoll: boolean;
    /** Ticks from a click on an expired clock to its first roll, read from the first-click label. */
    r0: number;
    /** Read chance that a roll gives xp at a level (sizes the lost-lock window). */
    catchP?: (level: number) => number;
    /** The plain loop's ticks per roll, for the host gate's cost model. */
    plainCycle: number;
    /** The target is gone after every successful roll (normal trees). */
    depletes?: boolean;
}

// stat_random (PlayerOps.ts): floor(lo*(99-L)/98) + floor(hi*(L-1)/98) + 1 > rand(256)
const statRandom = (L: number, lo: number, hi: number) => Math.min(1, (Math.floor((lo * (99 - L)) / 98) + Math.floor((hi * (L - 1)) / 98) + 1) / 256);
// fly: salmon (16, 96) rolled first from level 30, then trout (32, 192) (freshfish.rs2, fishing.rs2)
const flyCatchP = (L: number) => {
    const pt = statRandom(L, 32, 192);
    if (L < 30) return pt;
    const ps = statRandom(L, 16, 96);
    return ps + (1 - ps) * pt;
};

const METHODS: Record<string, Method> = {
    // rune axe success (trees.dbrow successchance): willow 56,175; oak 112,350
    wc: { skill: 'woodcutting', tele: '0,48,50,15,34', give: [['rune_axe', 1]], kind: 'loc', target: /^willow/i, option: /^chop/i, product: /^willow logs$/i, clickOnRoll: false, r0: 3, plainCycle: 4, catchP: (L: number) => statRandom(L, 56, 175) },
    // the route's oak tile north of Taverley (2914,3494), three oaks in reach (woodcutting.md section 2)
    oak: { skill: 'woodcutting', tele: '0,45,54,34,38', give: [['rune_axe', 1]], kind: 'loc', target: /^oak/i, option: /^chop/i, product: /^oak logs$/i, clickOnRoll: false, r0: 3, plainCycle: 4, catchP: (L: number) => statRandom(L, 112, 350) },
    // Normal trees with a bronze axe (the starter kit; trees.dbrow successchance 64,200). A
    // normal tree always falls on its first log (woodcut.rs2 get_logs, deplete_chance 0), so
    // each log re-bootstraps on the next tree. Lab tele: the trees west of Lumbridge castle.
    tree: { skill: 'woodcutting', tele: '0,49,50,58,30', give: [['bronze_axe', 1]], kind: 'loc', target: /^(tree|dead tree|evergreen)$/i, option: /^chop/i, product: /^logs$/i, clickOnRoll: false, r0: 3, plainCycle: 4, depletes: true, catchP: (L: number) => statRandom(L, 64, 200) },
    fly: { skill: 'fishing', tele: '0,48,53,31,38', give: [['fly_fishing_rod', 1], ['feather', 5000]], kind: 'npc', target: /^fishing spot$/i, option: /^lure$/i, product: /^raw /i, clickOnRoll: false, r0: 4, catchP: flyCatchP, plainCycle: 5 },
    // standing tile (3241,3248) between the river's two spot clusters
    flylumb: { skill: 'fishing', tele: '0,50,50,41,48', give: [['fly_fishing_rod', 1], ['feather', 5000]], kind: 'npc', target: /^fishing spot$/i, option: /^lure$/i, product: /^raw /i, clickOnRoll: false, r0: 4, catchP: flyCatchP, plainCycle: 5 },
    cage: { skill: 'fishing', tele: '0,44,53,34,41', give: [['lobster_pot', 1]], kind: 'npc', target: /^fishing spot$/i, option: /^cage$/i, product: /^raw /i, clickOnRoll: true, r0: 4, plainCycle: 6 }
};

const method = METHODS[methodName] ? { ...METHODS[methodName]! } : undefined;
// --click=same|roll overrides when the target is re-clicked: with the starter (same) or on
// the predicted roll tick (roll). Used to test a method against the other timing.
if (method && args.click) method.clickOnRoll = args.click === 'roll';
if (!method || !['base', 'eat', 'knife'].includes(technique!)) {
    console.error(`unknown mode ${mode}; methods ${Object.keys(METHODS).join(', ')}; techniques base, eat, knife`);
    process.exit(2);
}
const lockWindowAt = (L: number) => {
    if (args.window) return Number(args.window);
    const base = LOCK_WINDOW[methodName]!;
    const p = method.catchP?.(L);
    if (!p || p >= 1) return base;
    return Math.max(base, 3 * Math.ceil(Math.log(0.005) / Math.log(1 - p)));
};

const gated = technique !== 'base' && args.gate !== 'off';
// --lead=N sends an xp-anchored schedule N ticks early; auto (the default) takes the gate's
// last probe (dominant latency - 1). A schedule anchored on its own send needs none.
const LEAD_ARG = args.lead ?? 'auto';
writeFileSync(logPath, `# tickmanip-cycle ${mode} level=${level} phase=${phase} rolls=${rollsTarget} until=${untilLevel} dismiss=${dismiss} reanchor=${reanchor} xplag=${XP_LAG} gate=${gated ? 'on' : 'off'} lead=${LEAD_ARG} demo=${DEMO} inject-late=${INJECT_LATE} host=${hostname()} at=${new Date().toISOString()}\n`);
const log = (line: string) => appendFileSync(logPath, line + '\n');

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial();
    await sdk.waitForTicks(2);

    // --demo: no staff cheats. The account must already stand by the targets with its kit
    // (for knife: a knife and at least one normal log).
    if (DEMO) {
        const inv = sdk.getState()?.inventory ?? [];
        const has = (re: RegExp) => inv.some(i => re.test(i.name));
        if (technique === 'knife' && (!has(/^knife$/i) || !has(/^logs$/i))) throw new Error('--demo knife needs a knife and a normal log in the inventory');
        if (technique === 'eat' && !has(FOOD)) throw new Error('--demo eat needs shrimps');
    } else {
    // Clean inventory, then stats, kit and position.
    for (const item of [...(sdk.getState()?.inventory ?? [])]) await sdk.sendDropItem(item.slot);
    await sdk.waitForTicks(2);
    await sdk.sendSay(`::setstat ${method.skill} ${level}`);
    // Dark wizards beside the Draynor willows attack a level-3 bot and kill it within about
    // 40 ticks; eating hides this by healing. Raise combat so they ignore or bounce off it.
    for (const stat of ['hitpoints', 'defence', 'attack', 'strength']) await sdk.sendSay(`::setstat ${stat} 70`);
    for (const [obj, n] of method.give) await sdk.sendSay(`::give ${obj} ${n}`);
    if (technique === 'eat') await sdk.sendSay(`::give ${FOOD_OBJ} 18`);
    // Spare logs: a cycle whose click slips lets the queued fletch run and use one log.
    const SPARE_LOGS = 10;
    if (technique === 'knife') { await sdk.sendSay('::give knife 1'); for (let i = 0; i < SPARE_LOGS; i++) await sdk.sendSay('::give logs 1'); }
    // A fresh account's tutorial exit can land after the first teleport; retry until we are there.
    const [, mx, mz, lx, lz] = method.tele.split(',').map(Number);
    for (let attempt = 0; attempt < 5; attempt++) {
        await sdk.sendSay(`::tele ${method.tele}`);
        await sdk.waitForTicks(6);
        const p = sdk.getState()?.player;
        if (p && Math.abs(p.worldX - (mx * 64 + lx)) <= 2 && Math.abs(p.worldZ - (mz * 64 + lz)) <= 2) break;
    }
    }

    type Target = { kind: 'loc'; x: number; z: number; id: number; op: number } | { kind: 'npc'; index: number; op: number; x: number; z: number };
    let current: Target | null = null;
    let currentTile: [number, number] | null = null; // an npc target's route tile when clicked
    let packetsSent = 0;

    const skillXp = (s: BotWorldState) => s.skills.find(k => k.name.toLowerCase() === method.skill)?.experience ?? 0;

    const findTarget = (s: BotWorldState): Target | null => {
        if (method.kind === 'loc') {
            const locs = s.nearbyLocs
                .filter(l => method.target.test(l.name) && l.optionsWithIndex.some(o => method.option.test(o.text)))
                .sort((a, b) => a.distance - b.distance);
            if (current?.kind === 'loc') {
                const same = locs.find(l => l.x === current!.x && l.z === current!.z && l.id === (current as any).id);
                if (same) return current;
            }
            const l = locs[0];
            return l ? { kind: 'loc', x: l.x, z: l.z, id: l.id, op: l.optionsWithIndex.find(o => method.option.test(o.text))!.opIndex } : null;
        }
        const npcs = s.nearbyNpcs
            .filter(n => method.target.test(n.name) && n.optionsWithIndex.some(o => method.option.test(o.text)))
            .sort((a, b) => a.distance - b.distance);
        if (current?.kind === 'npc') {
            const same = npcs.find(n => n.index === (current as any).index);
            if (same) return { ...current, x: same.x, z: same.z };
        }
        const n = npcs[0];
        return n ? { kind: 'npc', index: n.index, x: n.x, z: n.z, op: n.optionsWithIndex.find(o => method.option.test(o.text))!.opIndex } : null;
    };

    const sameTarget = (a: Target | null, b: Target | null): boolean =>
        !!a && !!b && a.kind === b.kind && (a.kind === 'loc' ? a.x === b.x && a.z === b.z && a.id === (b as any).id : a.index === (b as any).index);

    const fire = (tick: number, what: string, p: Promise<{ success: boolean; message?: string }>) => {
        log(`T${tick} send ${what}`);
        packetsSent++;
        p.then(r => { if (!r.success) log(`T${tick} FAIL ${what}: ${r.message}`); }).catch(e => log(`T${tick} ERR ${what}: ${e}`));
    };

    const click = (s: BotWorldState): boolean => {
        current = findTarget(s);
        if (!current) { log(`T${s.tick} no target at ${s.player?.worldX},${s.player?.worldZ}; npcs=${s.nearbyNpcs.slice(0, 6).map(n => n.name + ':' + n.options.join('/')).join(', ')} locs=${s.nearbyLocs.slice(0, 6).map(l => l.name).join(', ')}`); return false; }
        if (current.kind === 'loc') fire(s.tick, `click loc ${current.id}@${current.x},${current.z} op${current.op}`, sdk.sendInteractLoc(current.x, current.z, current.id, current.op));
        else {
            const n = s.nearbyNpcs.find(m => m.index === (current as any).index);
            currentTile = n ? [n.tileX ?? n.x, n.tileZ ?? n.z] : null;
            fire(s.tick, `click npc #${current.index}@${currentTile ?? `${current.x},${current.z}`} op${current.op}`, sdk.sendInteractNpc(current.index, current.op));
        }
        return true;
    };

    const invItem = (s: BotWorldState, re: RegExp): InventoryItem | undefined => s.inventory.find(i => re.test(i.name));
    const eat = (s: BotWorldState): boolean => {
        const food = invItem(s, FOOD);
        if (!food) { log(`T${s.tick} out of food`); return false; }
        const op = food.optionsWithIndex.find(o => /^eat$/i.test(o.text))?.opIndex ?? 1;
        fire(s.tick, `eat slot${food.slot}`, sdk.sendUseItem(food.slot, op));
        return true;
    };
    const SHAFTS_BUTTON = 8889; // skill_multi3:make1_a (server/content/pack/interface.pack)
    const knifeStart = (s: BotWorldState): boolean => {
        const knife = invItem(s, /^knife$/i);
        const logs = invItem(s, /^logs$/i);
        if (!knife || !logs) { log(`T${s.tick} missing knife or logs`); return false; }
        fire(s.tick, `knife slot${knife.slot} on logs slot${logs.slot}`, sdk.sendUseItemOnItem(knife.slot, logs.slot));
        fire(s.tick, `button ${SHAFTS_BUTTON}`, sdk.sendClickComponent(SHAFTS_BUTTON) as Promise<{ success: boolean; message?: string }>);
        return true;
    };
    // When the product is the knife's own log, keep a few for the starter (in every technique,
    // so a plain block leaves logs for the knife block after it).
    const keepProducts = method.product.test('Logs') ? 3 : 0;
    const droppable = (s: BotWorldState) => s.inventory.filter(i => method.product.test(i.name)).slice(keepProducts);
    const dropOne = (s: BotWorldState) => {
        const p = droppable(s)[0];
        if (p) fire(s.tick, `drop ${p.name} slot${p.slot}`, sdk.sendDropItem(p.slot));
    };
    // A slipped knife cycle lets the queued fletch run and turns one log into shafts. Long
    // runs top the spares up (a lab stand-in for carrying more); the summary counts gifts.
    let logsGiven = 0;

    // Warm-up: one ordinary click so the bot is standing at the target before any timing
    // starts (a click that has to walk first shifts the open-loop anchor), then stop and
    // let the clock expire.
    {
        const s0 = sdk.getState()!;
        current = findTarget(s0);
        if (current) {
            if (current.kind === 'loc') await sdk.sendInteractLoc(current.x, current.z, current.id, current.op);
            else await sdk.sendInteractNpc(current.index, current.op);
            const xp0 = skillXp(s0);
            await sdk.waitForCondition(s => skillXp(s) > xp0, 60 * Number(process.env.NODE_TICKRATE ?? 300)).catch(() => {});
        }
        const here = sdk.getState()!.player!;
        await sdk.sendWalk(here.worldX, here.worldZ); // stop the interaction
        await sdk.waitForTicks(6);
        for (const p of droppable(sdk.getState()!)) await sdk.sendDropItem(p.slot);
        await sdk.waitForTicks(2);
    }
    // Run-time host gate: probe before the first lock; the probe ends on the tile it started on.
    // --plain-rate=T gives the measured override plain's ticks per drop; without it the gate
    // compares against the last plain stretch it measured itself.
    const gate = gated
        ? new HostGate(sdk, {
              model: { plainCycle: method.plainCycle },
              plainTicksPerDrop: args['plain-rate'] ? Number(args['plain-rate']) : undefined,
              log: line => { log(line); console.log(line); },
          })
        : null;
    if (gate) await gate.probe('start');
    const lead = () => (LEAD_ARG === 'auto' ? (gate?.lead ?? 0) : Number(LEAD_ARG));
    const plainNow = () => technique === 'base' || (gate !== null && !gate.on);
    const startState = sdk.getState()!;
    const startXp = skillXp(startState);
    const startTick = startState.tick;
    const baseLevelOf = (s: BotWorldState) => s.skills.find(k => k.name.toLowerCase() === method.skill)?.baseLevel ?? 0;
    log(`setup tick=${startTick} pos=${startState.player?.worldX},${startState.player?.worldZ} xp=${startXp} level=${baseLevelOf(startState)}`);

    // ---- measurement loop -------------------------------------------------
    const xpTicks: number[] = [];
    const breaks: number[] = []; // ticks at which the schedule was re-bootstrapped (gaps spanning these are excluded)
    let lastXp = startXp;
    let anchor: number | null = null; // observed tick on which the bootstrap click was sent
    let anchorLead = 0; // ticks the schedule sends early: only when anchored on an observed roll
    let deferredTo = -1; // --inject-late: the label a held starter bundle goes out on
    let injected = 0;
    let cooldownUntil = -1;
    let curPhase = ((phase % 3) + 3) % 3;
    let resyncs = 0;
    let actedTick = -1;
    let idleTicks = 0;
    let lastSeenTick = -1;
    let dialogsSeen = 0;
    let dialogOpenSince: number | null = null;
    let lastDismiss = -1;
    let lastLevel = baseLevelOf(startState);
    const levelUps: Array<{ tick: number; level: number }> = [];
    const moves: number[] = [];
    let awaitXpSince: number | null = null; // --reanchor=xp: clicked, waiting for the first xp
    let segStartTick: number | null = fromXp > 0 && startXp / 25 >= fromXp ? startTick : null;
    let segStartXp = segStartTick !== null ? startXp : 0;
    let segEndTick: number | null = null;
    const markTicks = new Map<number, number>();
    const seenMsgs = new Set<string>((startState.gameMessages ?? []).map(m => `${m.tick ?? ''}|${m.text}`));
    let lastHp = -2;
    let probing = false;
    // --dismiss=watcher|burst|click (levelup-dismiss.ts) replaces the dismissal below; 'none'
    // keeps its old meaning (nothing sent) and also records episodes.
    const lab = isPolicy(dismiss) ? new LevelUpLab(sdk, dismiss, method.skill, { reclick: st => { if (current) click(st); }, log }) : null;

    const done = new Promise<void>(resolve => {
        const unsubscribe = sdk.onStateUpdate((s: BotWorldState) => {
            if (!s || !s.inGame) return;
            const t = s.tick;

            const xp = skillXp(s);
            let xpNow = false;
            if (xp > lastXp) {
                xpTicks.push(t);
                xpNow = true;
                log(`T${t} XP +${xp - lastXp} (total ${xp})`);
                lastXp = xp;
                if (gate && !probing && gate.drop(t)) { anchor = null; awaitXpSince = null; current = null; breaks.push(t); }
                if (segStartTick === null && fromXp > 0 && xp / 25 >= fromXp) { segStartTick = t; segStartXp = xp; log(`T${t} SEGMENT start at base ${xp / 25}`); }
                for (const m of marks) if (!markTicks.has(m) && xp / 25 >= m) markTicks.set(m, t);
            }
            const lvl = baseLevelOf(s);
            if (lvl > lastLevel) {
                levelUps.push({ tick: t, level: lvl });
                log(`T${t} LEVEL ${lvl}`);
                lastLevel = lvl;
            }
            // Game messages and hitpoint changes explain lost locks (random events, deaths).
            const msgs = s.gameMessages ?? [];
            for (const m of msgs.slice(Math.max(0, msgs.length - 5))) {
                const key = `${m.tick ?? ''}|${m.text}`;
                if (!seenMsgs.has(key)) { seenMsgs.add(key); log(`T${t} MSG ${m.text}`); }
            }
            const hp = s.skills.find(k => k.name.toLowerCase() === 'hitpoints')?.level ?? -1;
            if (hp !== lastHp) { if (lastHp !== -2) log(`T${t} HP ${lastHp} -> ${hp} at ${s.player?.worldX},${s.player?.worldZ}`); lastHp = hp; }
            if (s.dialog?.isOpen) {
                if (dialogOpenSince === null) { dialogOpenSince = t; dialogsSeen++; log(`T${t} DIALOG open at ${s.player?.worldX},${s.player?.worldZ}: ${(s.dialog.text ?? '').slice(0, 60)}`); }
            } else if (dialogOpenSince !== null) {
                log(`T${t} DIALOG closed (open ${t - dialogOpenSince} ticks)`);
                dialogOpenSince = null;
            }
            // Answer a level-up the tick it is seen (and again if it is still open 3 ticks on).
            if (!probing && !plainNow() && !lab && s.dialog?.isOpen && t !== lastDismiss && (dialogOpenSince === t || t - lastDismiss >= 3)) {
                lastDismiss = t;
                fire(t, `dismiss dialog${dismiss === 'blind' ? ' (blind)' : ''}`, sdk.sendClickDialog(0, dismiss === 'blind' ? { blind: true } : {}));
            }

            if (t !== lastSeenTick) {
                lastSeenTick = t;
                idleTicks = (s.player?.animId ?? -1) === -1 ? idleTicks + 1 : 0;
            }

            if (untilLevel && lvl >= untilLevel && segEndTick === null) segEndTick = t;
            if (xpTicks.length >= rollsTarget || t - startTick > maxTicks || segEndTick !== null) {
                unsubscribe();
                resolve();
                return;
            }
            if (probing || actedTick === t) return;

            // Gate probe: at once while plain (periodic re-probe); while manipulating only after a
            // lost lock, at the re-bootstrap, once the pushed clock has expired. The probe walks a
            // tile and back and clears the interaction, so every path re-clicks afterwards.
            if (gate && gate.due(t) && (plainNow() || (anchor === null && awaitXpSince === null && t >= cooldownUntil))) {
                actedTick = t;
                probing = true;
                breaks.push(t);
                gate.probe(plainNow() ? 'periodic' : 'lost lock')
                    .catch(e => log(`T${t} gate probe failed: ${e}`))
                    .finally(() => {
                        probing = false;
                        anchor = null;
                        awaitXpSince = null;
                        current = null;
                        currentTile = null;
                        cooldownUntil = -1;
                        const now = sdk.getState()?.tick ?? t;
                        breaks.push(now);
                    });
                return;
            }

            // Food top-up is a lab convenience standing in for banking; sent off-beat.
            const foodCount = s.inventory.filter(i => FOOD.test(i.name)).length;

            const lastXpTick = xpTicks.length ? xpTicks[xpTicks.length - 1] : -1;
            const targetGone = current !== null && !sameTarget(current, findTarget(s));

            if (plainNow()) {
                const full = s.inventory.length >= 28;
                if (full && dropProducts) {
                    actedTick = t;
                    for (const p of droppable(s)) fire(t, `drop ${p.name} slot${p.slot}`, sdk.sendDropItem(p.slot));
                    breaks.push(t);
                    anchor = null;
                    return;
                }
                if (s.dialog?.isOpen && (!lab || lab.policy === 'none')) { actedTick = t; fire(t, 'dismiss dialog', sdk.sendClickDialog(0)); breaks.push(t); anchor = null; return; }
                const stalled = anchor !== null && t - Math.max(anchor, lastXpTick) > 12 && idleTicks >= 2;
                if (anchor === null || targetGone || stalled) {
                    actedTick = t;
                    current = null;
                    if (click(s)) { anchor = t; breaks.push(t); }
                }
                return;
            }

            if (!DEMO && technique === 'knife' && s.inventory.filter(i => /^logs$/i.test(i.name)).length < 4 && t % 3 === 1 && logsGiven < 200) {
                logsGiven++;
                fire(t, 'give logs', sdk.sendSay('::give logs 1'));
            }

            // A spot that teleported keeps its index: compare its tile with the clicked one.
            let moved = false;
            if (current?.kind === 'npc' && currentTile && (anchor !== null || awaitXpSince !== null)) {
                const n = s.nearbyNpcs.find(m => m.index === (current as any).index);
                const tile = n ? [n.tileX ?? n.x, n.tileZ ?? n.z] : null;
                if (!tile || tile[0] !== currentTile[0] || tile[1] !== currentTile[1]) {
                    moved = true;
                    moves.push(t);
                    log(`T${t} MOVE spot #${current.index} ${currentTile.join(',')} -> ${tile ? tile.join(',') : 'gone'}`);
                }
            }

            // eat technique: open-loop schedule anchored on our own bootstrap click (see header)
            const lost = anchor !== null && t - Math.max(anchor + method.r0 + 1, lastXpTick) > lockWindowAt(lvl);
            // A depleting target fell to the roll we just saw: start the next one from this
            // label with a starter bundle, like a bootstrap (its own send is the anchor, so no
            // lead and no cooldown). The starter lands while the clock has expired and the
            // first swing on the new target rolls 2 ticks later, if it is within reach by then.
            if (method.depletes && targetGone && xpNow && technique === 'knife' && (anchor !== null || awaitXpSince !== null)) {
                anchor = t - method.r0 - 1 - curPhase;
                anchorLead = 0;
                awaitXpSince = null;
                current = null;
                log(`T${t} next target`);
            } else if (moved || (anchor !== null && (targetGone || lost))) {
                const why = moved ? 'spot moved' : targetGone ? 'target gone' : 'no xp';
                // A lock with no xp is mistimed by a tick or two (latency moved); try the next phase.
                if (reanchor === 'click' && why === 'no xp') curPhase = (curPhase + 1) % 3;
                if (why === 'no xp') gate?.slip();
                resyncs++;
                log(`T${t} resync (${why})${reanchor === 'click' ? `, next phase ${curPhase}` : ''}`);
                anchor = null;
                awaitXpSince = null;
                current = null;
                currentTile = null;
                cooldownUntil = reanchor === 'xp' ? t : t + 5; // click: let the pushed clock expire so the bootstrap click starts a fresh cycle
            }
            if (awaitXpSince !== null) {
                if (xpNow && t > awaitXpSince) {
                    // roll on R = t - xplag; the loop's own re-arm puts the next roll on R + r0 + 1
                    anchor = t - XP_LAG;
                    anchorLead = lead();
                    curPhase = 0;
                    awaitXpSince = null;
                    log(`T${t} anchored on xp (roll ${anchor}), lead ${anchorLead}`);
                } else {
                    if (t - awaitXpSince > 30) { actedTick = t; current = null; if (click(s)) awaitXpSince = t; log(`T${t} re-click while waiting for xp`); }
                    return;
                }
            }
            if (anchor === null) {
                if (t < cooldownUntil) return;
                actedTick = t;
                if (reanchor === 'xp') {
                    if (click(s)) { awaitXpSince = t; breaks.push(t); log(`T${t} re-click, anchoring on the next xp`); }
                    return;
                }
                if (click(s)) { anchor = t; anchorLead = 0; breaks.push(t); log(`T${t} bootstrap phase ${curPhase}`); }
                return;
            }
            const starterBundle = () => {
                actedTick = t;
                if (technique === 'knife') knifeStart(s); else eat(s);
                if (dropProducts) dropOne(s);
                if (!method.clickOnRoll) click(s);
            };
            if (deferredTo === t) { deferredTo = -1; starterBundle(); return; }
            const d = t - anchor - method.r0 - 1 - curPhase + anchorLead;
            if (d < 0) return;
            const k = d % 3;
            if (k === 0) {
                if (INJECT_LATE > 0 && Math.random() < INJECT_LATE) {
                    deferredTo = t + 1;
                    injected++;
                    log(`T${t} inject: starter held to T${t + 1}`);
                    return;
                }
                starterBundle();
            } else if (k === 1) {
                if (technique === 'eat' && foodCount < 4) { actedTick = t; fire(t, 'give food', sdk.sendSay(`::give ${FOOD_OBJ} 14`)); }
            } else if (k === 2 && method.clickOnRoll) {
                actedTick = t;
                click(s);
            }
        });
    });
    await done;
    lab?.stop();

    // ---- summary ------------------------------------------------------------
    const endInv = sdk.getState()?.inventory ?? [];
    const countOf = (re: RegExp) => endInv.filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
    const gaps: number[] = [];
    for (let i = 1; i < xpTicks.length; i++) {
        const a = xpTicks[i - 1], b = xpTicks[i];
        if (breaks.some(x => x > a && x < b)) continue;
        gaps.push(b - a);
    }
    const hist: Record<number, number> = {};
    for (const g of gaps) hist[g] = (hist[g] ?? 0) + 1;
    const span = xpTicks.length > 1 ? xpTicks[xpTicks.length - 1] - xpTicks[0] : 0;
    const minGap = gaps.length ? Math.min(...gaps) : 0;
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const cycle = gaps.reduce((a, b) => gcd(a, b), 0);
    const gameXp = lastXp - startXp;

    // Level-ups and moves: the gap from the xp drop at (or before) each event to the next drop,
    // and whether the schedule had to be re-anchored inside it.
    const nextXp = (t: number) => xpTicks.find(x => x > t);
    const prevXp = (t: number) => [...xpTicks].reverse().find(x => x <= t);
    const around = (t: number) => {
        const a = prevXp(t), b = nextXp(t);
        return { gap: a !== undefined && b !== undefined ? b - a : NaN, broke: breaks.some(x => x >= t && (b === undefined || x < b)) };
    };
    const lvRows = levelUps.map(l => ({ ...l, ...around(l.tick) }));
    // Rolls lost per gap (level-up lab): a counted gap of g ticks holds g/c rolls at cycle c, of
    // which 1/p are expected at the read catch chance p of the level the bot had after the gap's
    // first drop. The excess is the gap's lost rolls; its variance is (1-p)/p^2. Gaps that start
    // on a level-up drop are kept apart from the rest (the control, which should average 0).
    const lostRolls = (() => {
        if (!method.catchP) return null;
        const c = technique === 'base' ? method.plainCycle : 3;
        const levelAt = (t: number) => { let L = level; for (const l of levelUps) if (l.tick <= t) L = l.level; return L; };
        const lvTicks = new Set(levelUps.map(l => l.tick));
        const acc = { lv: { n: 0, sum: 0, v: 0 }, other: { n: 0, sum: 0, v: 0 } };
        for (let i = 1; i < xpTicks.length; i++) {
            const a = xpTicks[i - 1]!, b = xpTicks[i]!;
            if (breaks.some(x => x > a && x < b)) continue;
            const p = Math.min(1, method.catchP!(levelAt(a)));
            const bucket = lvTicks.has(a) ? acc.lv : acc.other;
            bucket.n++;
            bucket.sum += (b - a) / c - 1 / p;
            bucket.v += (1 - p) / (p * p);
        }
        const fmt = (x: { n: number; sum: number; v: number }) =>
            x.n ? `${x.n} gaps, ${(x.sum / x.n).toFixed(2)} +/- ${(Math.sqrt(x.v) / x.n).toFixed(2)} rolls lost per gap (${((x.sum / x.n) * c).toFixed(2)} ticks)` : '0 gaps';
        return `rolls lost (cycle ${c}, read catch chance): after a level-up drop ${fmt(acc.lv)}; other gaps ${fmt(acc.other)}`;
    })();
    const mvRows = moves.map(m => ({ tick: m, ...around(m) }));
    const histOf = (xs: number[]) => { const h: Record<number, number> = {}; for (const x of xs) if (Number.isFinite(x)) h[x] = (h[x] ?? 0) + 1; return Object.entries(h).map(([g, c]) => `${g}:${c}`).join(' '); };
    const segEnd = segEndTick ?? xpTicks[xpTicks.length - 1] ?? startTick;
    const segFrom = segStartTick ?? startTick;
    const segCatches = xpTicks.filter(x => x > segFrom && x <= segEnd).length;
    const segBase = (lastXp - (segStartTick !== null ? segStartXp : startXp)) / 25;
    const summary = [
        `segment: from ${segStartTick !== null ? `base ${(segStartXp / 25).toFixed(1)} at T${segFrom}` : `start T${segFrom}`} to ${segEndTick !== null ? `level ${untilLevel} at T${segEnd}` : `last xp T${segEnd}`}: ${segEnd - segFrom} ticks, ${segCatches} catches, ${((segEnd - segFrom) / Math.max(1, segCatches)).toFixed(2)} ticks per catch, base ${segBase.toFixed(1)}, ${(segBase / Math.max(1, segEnd - segFrom)).toFixed(2)} base per tick`,
        `level-ups ${levelUps.length}: gap from the level's drop to the next ${histOf(lvRows.map(r => r.gap))}; re-anchored after ${lvRows.filter(r => r.broke).length}`,
        `  ${lvRows.map(r => `L${r.level}@T${r.tick}:${r.gap}${r.broke ? 'R' : ''}`).join(' ')}`,
        `spot moves ${moves.length}: spanning gaps ${histOf(mvRows.map(r => r.gap))}`,
        `  ${mvRows.map(r => `T${r.tick}:${r.gap}`).join(' ')}`,
        `logs given during the run ${logsGiven}`,
        `starters held a label (--inject-late=${INJECT_LATE}): ${injected}`,
        gate
            ? `gate: ${gate.history.length} events (${gate.summary()}), switches ${gate.switches() || 'none'}, ${gate.plainTicks(segEnd)} ticks plain, ends ${gate.on ? 'manipulating' : 'plain'}, lead ${lead()}`
            : 'gate: off',
        ...(marks.length ? [`marks (base xp: tick passed, ticks to end T${segEnd}): ${marks.map(m => markTicks.has(m) ? `${m}: T${markTicks.get(m)} ${segEnd - markTicks.get(m)!}` : `${m}: -`).join(' | ')}`] : []),
        `levels reached: ${levelUps.map(l => `${l.level}@T${l.tick}`).join(' ')}`,
        `mode=${mode} level=${level} phase=${phase} xpEvents=${xpTicks.length} gapsCounted=${gaps.length} breaks=${breaks.length} resyncs=${resyncs} finalPhase=${curPhase} dialogs=${dialogsSeen}`,
        `gap histogram (ticks:count) ${Object.entries(hist).map(([g, c]) => `${g}:${c}`).join(' ')}`,
        `min gap ${minGap}, gcd of gaps ${cycle}, span ${span} ticks, ticks per xp event ${(span / Math.max(1, xpTicks.length - 1)).toFixed(2)}`,
        `rolls in span at cycle ${cycle || '?'}: ${cycle ? span / cycle : '?'}; success fraction ${cycle ? ((xpTicks.length - 1) / (span / cycle)).toFixed(3) : '?'}`,
        `game xp ${gameXp} (base ${gameXp / 25}), base xp per tick over span ${(span ? gameXp / 25 / span : 0).toFixed(2)}`,
        `end inventory: logs ${countOf(/^logs$/i)}, arrow shafts ${countOf(/^arrow shaft/i)}, shrimps ${countOf(FOOD)}, packets sent ${packetsSent}`,
        ...(lostRolls ? [lostRolls] : []),
        ...(lab ? [lab.summary()] : []),
        `log ${logPath}`
    ].join('\n');
    log(summary);
    console.log(summary);
}, { timeout: 30 * 60_000, printState: false });
