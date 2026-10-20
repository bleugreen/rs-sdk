// Measure gathering cycles with and without eat tick-manipulation.
//
//   bun docs/speedrun/scripts/tickmanip-cycle.ts <bot> --mode=<method>-<technique> [--rolls=N]
//       [--level=L] [--phase=P] [--maxticks=T]
//
// method:    wc (willow, Draynor), fly (lure, Barbarian Village), cage (lobster, Catherby)
// technique: base (click once, re-click only when idle) or eat (one food bite per cycle)
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
// Every packet sent and every xp change is logged with its tick to --log
// (default $TMPDIR/tickmanip-<mode>.log); a summary goes to stdout.
import { runScript } from '../../../sdk/runner';
import type { BotWorldState, InventoryItem } from '../../../sdk/types';
import { appendFileSync, writeFileSync } from 'fs';

const args: Record<string, string> = Object.fromEntries(
    process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
        const [k, ...v] = a.slice(2).split('=');
        return [k, v.length ? v.join('=') : 'true'];
    })
);
const mode = args.mode ?? 'wc-eat';
const [methodName, technique] = mode.split('-');
const rollsTarget = Number(args.rolls ?? 200);
const level = Number(args.level ?? 99);
const phase = Number(args.phase ?? 0);
const maxTicks = Number(args.maxticks ?? rollsTarget * 12 + 200);
const dropProducts = args.drop !== 'false';
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
}

const METHODS: Record<string, Method> = {
    wc: { skill: 'woodcutting', tele: '0,48,50,15,34', give: [['rune_axe', 1]], kind: 'loc', target: /^willow/i, option: /^chop/i, product: /logs$/i, clickOnRoll: false, r0: 3 },
    fly: { skill: 'fishing', tele: '0,48,53,31,38', give: [['fly_fishing_rod', 1], ['feather', 5000]], kind: 'npc', target: /^fishing spot$/i, option: /^lure$/i, product: /^raw /i, clickOnRoll: false, r0: 4 },
    cage: { skill: 'fishing', tele: '0,44,53,34,41', give: [['lobster_pot', 1]], kind: 'npc', target: /^fishing spot$/i, option: /^cage$/i, product: /^raw /i, clickOnRoll: true, r0: 4 }
};

const method = METHODS[methodName];
if (!method || (technique !== 'base' && technique !== 'eat')) {
    console.error(`unknown mode ${mode}; methods ${Object.keys(METHODS).join(', ')}; techniques base, eat`);
    process.exit(2);
}

writeFileSync(logPath, `# tickmanip-cycle ${mode} level=${level} phase=${phase} rolls=${rollsTarget}\n`);
const log = (line: string) => appendFileSync(logPath, line + '\n');

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial();
    await sdk.waitForTicks(2);

    // Clean inventory, then stats, kit and position.
    for (const item of [...(sdk.getState()?.inventory ?? [])]) await sdk.sendDropItem(item.slot);
    await sdk.waitForTicks(2);
    await sdk.sendSay(`::setstat ${method.skill} ${level}`);
    for (const [obj, n] of method.give) await sdk.sendSay(`::give ${obj} ${n}`);
    if (technique === 'eat') await sdk.sendSay(`::give ${FOOD_OBJ} 18`);
    await sdk.sendSay(`::tele ${method.tele}`);
    await sdk.waitForTicks(6);

    const skillXp = (s: BotWorldState) => s.skills.find(k => k.name.toLowerCase() === method.skill)?.experience ?? 0;
    const startState = sdk.getState()!;
    const startXp = skillXp(startState);
    const startTick = startState.tick;
    log(`setup tick=${startTick} pos=${startState.player?.worldX},${startState.player?.worldZ} xp=${startXp}`);

    type Target = { kind: 'loc'; x: number; z: number; id: number; op: number } | { kind: 'npc'; index: number; op: number; x: number; z: number };
    let current: Target | null = null;

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
        p.then(r => { if (!r.success) log(`T${tick} FAIL ${what}: ${r.message}`); }).catch(e => log(`T${tick} ERR ${what}: ${e}`));
    };

    const click = (s: BotWorldState): boolean => {
        current = findTarget(s);
        if (!current) { log(`T${s.tick} no target; npcs=${s.nearbyNpcs.slice(0, 6).map(n => n.name + ':' + n.options.join('/')).join(', ')} locs=${s.nearbyLocs.slice(0, 6).map(l => l.name).join(', ')}`); return false; }
        if (current.kind === 'loc') fire(s.tick, `click loc ${current.id}@${current.x},${current.z} op${current.op}`, sdk.sendInteractLoc(current.x, current.z, current.id, current.op));
        else fire(s.tick, `click npc #${current.index}@${current.x},${current.z} op${current.op}`, sdk.sendInteractNpc(current.index, current.op));
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
    const dropOne = (s: BotWorldState) => {
        const p = invItem(s, method.product);
        if (p) fire(s.tick, `drop ${p.name} slot${p.slot}`, sdk.sendDropItem(p.slot));
    };

    // ---- measurement loop -------------------------------------------------
    const xpTicks: number[] = [];
    const breaks: number[] = []; // ticks at which the schedule was re-bootstrapped (gaps spanning these are excluded)
    let lastXp = startXp;
    let anchor: number | null = null; // observed tick on which the bootstrap click was sent
    let cooldownUntil = -1;
    let curPhase = ((phase % 3) + 3) % 3;
    let resyncs = 0;
    let actedTick = -1;
    let idleTicks = 0;
    let lastSeenTick = -1;
    let dialogsSeen = 0;
    let dialogOpenSince: number | null = null;

    const done = new Promise<void>(resolve => {
        const unsubscribe = sdk.onStateUpdate((s: BotWorldState) => {
            if (!s || !s.inGame) return;
            const t = s.tick;

            const xp = skillXp(s);
            if (xp > lastXp) {
                xpTicks.push(t);
                log(`T${t} XP +${xp - lastXp} (total ${xp})`);
                lastXp = xp;
            }
            if (s.dialog?.isOpen) {
                if (dialogOpenSince === null) { dialogOpenSince = t; dialogsSeen++; log(`T${t} DIALOG open: ${(s.dialog.text ?? '').slice(0, 60)}`); }
            } else if (dialogOpenSince !== null) {
                log(`T${t} DIALOG closed (open ${t - dialogOpenSince} ticks)`);
                dialogOpenSince = null;
            }

            if (t !== lastSeenTick) {
                lastSeenTick = t;
                idleTicks = (s.player?.animId ?? -1) === -1 ? idleTicks + 1 : 0;
            }

            if (xpTicks.length >= rollsTarget || t - startTick > maxTicks) {
                unsubscribe();
                resolve();
                return;
            }
            if (actedTick === t) return;

            // Food top-up is a lab convenience standing in for banking; sent off-beat.
            const foodCount = s.inventory.filter(i => FOOD.test(i.name)).length;

            const lastXpTick = xpTicks.length ? xpTicks[xpTicks.length - 1] : -1;
            const targetGone = current !== null && !sameTarget(current, findTarget(s));

            if (technique === 'base') {
                const full = s.inventory.length >= 28;
                if (full && dropProducts) {
                    actedTick = t;
                    for (const p of s.inventory.filter(i => method.product.test(i.name))) fire(t, `drop ${p.name} slot${p.slot}`, sdk.sendDropItem(p.slot));
                    breaks.push(t);
                    anchor = null;
                    return;
                }
                if (s.dialog?.isOpen) { actedTick = t; fire(t, 'dismiss dialog', sdk.sendClickDialog(0)); breaks.push(t); anchor = null; return; }
                const stalled = anchor !== null && t - Math.max(anchor, lastXpTick) > 12 && idleTicks >= 2;
                if (anchor === null || targetGone || stalled) {
                    actedTick = t;
                    current = null;
                    if (click(s)) { anchor = t; breaks.push(t); }
                }
                return;
            }

            // eat technique: open-loop schedule anchored on our own bootstrap click (see header)
            if (anchor !== null && (targetGone || (t - Math.max(anchor + method.r0 + 1, lastXpTick) > 15))) {
                // A lock with no xp is mistimed by a tick or two (latency moved); try the next phase.
                if (!targetGone) curPhase = (curPhase + 1) % 3;
                resyncs++;
                log(`T${t} resync (${targetGone ? 'target gone' : 'no xp'}), next phase ${curPhase}`);
                anchor = null;
                current = null;
                cooldownUntil = t + 5; // let the pushed clock expire so the bootstrap click starts a fresh cycle
            }
            if (anchor === null) {
                if (t < cooldownUntil) return;
                actedTick = t;
                if (click(s)) { anchor = t; breaks.push(t); log(`T${t} bootstrap phase ${curPhase}`); }
                return;
            }
            const d = t - anchor - method.r0 - 1 - curPhase;
            if (d < 0) return;
            const k = d % 3;
            if (k === 0) {
                actedTick = t;
                eat(s);
                if (dropProducts) dropOne(s);
                if (!method.clickOnRoll) click(s);
            } else if (k === 1) {
                if (foodCount < 4) { actedTick = t; fire(t, 'give food', sdk.sendSay(`::give ${FOOD_OBJ} 14`)); }
            } else if (k === 2 && method.clickOnRoll) {
                actedTick = t;
                click(s);
            }
        });
    });
    await done;

    // ---- summary ------------------------------------------------------------
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
    const summary = [
        `mode=${mode} level=${level} phase=${phase} xpEvents=${xpTicks.length} gapsCounted=${gaps.length} breaks=${breaks.length} resyncs=${resyncs} finalPhase=${curPhase} dialogs=${dialogsSeen}`,
        `gap histogram (ticks:count) ${Object.entries(hist).map(([g, c]) => `${g}:${c}`).join(' ')}`,
        `min gap ${minGap}, gcd of gaps ${cycle}, span ${span} ticks, ticks per xp event ${(span / Math.max(1, xpTicks.length - 1)).toFixed(2)}`,
        `rolls in span at cycle ${cycle || '?'}: ${cycle ? span / cycle : '?'}; success fraction ${cycle ? ((xpTicks.length - 1) / (span / cycle)).toFixed(3) : '?'}`,
        `game xp ${gameXp} (base ${gameXp / 25}), base xp per tick over span ${(span ? gameXp / 25 / span : 0).toFixed(2)}`,
        `log ${logPath}`
    ].join('\n');
    log(summary);
    console.log(summary);
}, { timeout: 30 * 60_000, printState: false });
