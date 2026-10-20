// Measures a fishing method's sustained rate on a local lab server.
//
//   bun docs/speedrun/scripts/fishing-rate.ts <bot> <method> <level> <ticks> [key=value ...]
//
// method: fly | pike | net | bait | cage | harpoon | bignet | shark
// keys:
//   drop=each|full     each: drop every catch and re-click the spot at once (default)
//                      full: let the inventory fill, then drop everything and re-click
//   react=move|none    move: re-click the spot as soon as it relocates (default)
//                      none: never re-click on a move (shows what the engine does alone)
//   tele=x,z           tile to start on (default per method)
//   pin=1              restore the level with ::setstat after every level-up
//   out=path           JSONL event log (default $TMPDIR/fishing-<method>-<level>.jsonl)
//
// Every event carries the server tick it was observed on (the lite client counts one
// tick per server tick). The summary is printed at the end; analyse the JSONL for gaps.
import { appendFileSync, writeFileSync } from 'fs';
import { runScript } from '../../../sdk/runner';
import type { BotWorldState, NearbyNpc } from '../../../sdk/types';

type Method = { tool: string; bait?: string; spotOps: string[]; op: string; tele: [number, number] };

// Barbarian Village (fly/pike) and Catherby (sea spots) by default.
const METHODS: Record<string, Method> = {
    fly: { tool: 'fly_fishing_rod', bait: 'feather', spotOps: ['Lure', 'Bait'], op: 'Lure', tele: [3102, 3432] },
    pike: { tool: 'fishing_rod', bait: 'fishing_bait', spotOps: ['Lure', 'Bait'], op: 'Bait', tele: [3102, 3432] },
    net: { tool: 'net', spotOps: ['Net', 'Bait'], op: 'Net', tele: [2837, 3434] },
    bait: { tool: 'fishing_rod', bait: 'fishing_bait', spotOps: ['Net', 'Bait'], op: 'Bait', tele: [2837, 3434] },
    cage: { tool: 'lobster_pot', spotOps: ['Cage', 'Harpoon'], op: 'Cage', tele: [2850, 3431] },
    harpoon: { tool: 'harpoon', spotOps: ['Cage', 'Harpoon'], op: 'Harpoon', tele: [2850, 3431] },
    bignet: { tool: 'big_net', spotOps: ['Net', 'Harpoon'], op: 'Net', tele: [2850, 3431] },
    shark: { tool: 'harpoon', spotOps: ['Net', 'Harpoon'], op: 'Harpoon', tele: [2850, 3431] }
};

const args = process.argv.slice(2);
const [, methodName = 'fly', levelArg = '99', ticksArg = '2000'] = args;
const opts = Object.fromEntries(args.slice(4).map(a => a.split('=') as [string, string]));
const method = METHODS[methodName];
if (!method) throw new Error(`unknown method ${methodName}`);
const level = Number(levelArg);
const runTicks = Number(ticksArg);
const dropMode = opts.drop ?? 'each';
const react = opts.react ?? 'move';
const pin = opts.pin === '1';
const tele = opts.tele ? (opts.tele.split(',').map(Number) as [number, number]) : method.tele;
const out = opts.out ?? `${process.env.TMPDIR ?? '/tmp'}/fishing-${methodName}-${level}.jsonl`;
writeFileSync(out, '');
const log = (ev: Record<string, unknown>) => appendFileSync(out, JSON.stringify(ev) + '\n');

const teleCmd = (x: number, z: number) => `::tele 0,${x >> 6},${z >> 6},${x & 63},${z & 63}`;
const fishingXp = (s: BotWorldState) => s.skills.find(k => k.name.toLowerCase() === 'fishing')!;
const isSpot = (n: NearbyNpc) => n.name === 'Fishing spot' && method.spotOps.every(o => n.options.includes(o));
const opIndex = (n: NearbyNpc) => n.optionsWithIndex.find(o => o.text === method.op)!.opIndex;
const tileOf = (n: NearbyNpc) => [n.tileX ?? n.x, n.tileZ ?? n.z] as const;

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial();
    await sdk.sendSay('::clearinv inv');
    await sdk.sendSay(`::setstat fishing ${level}`);
    await sdk.sendSay(`::give ${method.tool} 1`);
    if (method.bait) await sdk.sendSay(`::give ${method.bait} 20000`);
    await sdk.sendSay(teleCmd(tele[0], tele[1]));
    await sdk.waitForTicks(3);

    const keep = new Set<string>();
    for (const item of sdk.getInventory()) keep.add(item.name);

    let target: NearbyNpc | null = null;
    let targetTile: readonly [number, number] | null = null;
    let lastXp = fishingXp(sdk.getState()!).experience;
    let lastLevel = fishingXp(sdk.getState()!).baseLevel;
    let firstCatchTick = -1;
    let lastCatchTick = -1;
    let catches = 0;
    let baseXp = 0;
    let moves = 0;
    let levelUps = 0;
    let busy = false;
    let dialogBusy = false;
    let idleTicks = 0;
    let done = false;
    const gaps = new Map<number, number>();

    const nearestSpot = (s: BotWorldState) =>
        s.nearbyNpcs.filter(isSpot).sort((a, b) => a.distance - b.distance)[0] ?? null;

    // Serialise actions so each batch reaches the server in order.
    const run = (why: string, fn: () => Promise<unknown>) => {
        if (busy) return;
        busy = true;
        fn().catch(e => log({ ev: 'error', why, msg: String(e) })).finally(() => (busy = false));
    };
    let lastClickTick = -1;
    let lastPos = '';
    const click = async (s: BotWorldState, why: string, nearest = false) => {
        const spot = (!nearest && target && s.nearbyNpcs.find(n => n.index === target!.index && isSpot(n))) || nearestSpot(s);
        lastClickTick = s.tick;
        if (!spot) {
            log({ ev: 'nospot', tick: s.tick });
            return;
        }
        target = spot;
        targetTile = tileOf(spot);
        log({ ev: 'click', tick: s.tick, why, spot: spot.index, at: targetTile, dist: spot.distance });
        await sdk.sendInteractNpc(spot.index, opIndex(spot));
    };
    const dropAll = async (s: BotWorldState, max: number) => {
        const slots = s.inventory.filter(i => !keep.has(i.name)).slice(0, max);
        for (const it of slots) await sdk.sendDropItem(it.slot);
        log({ ev: 'drop', tick: s.tick, n: slots.length });
        return slots.length;
    };

    const start = sdk.getState()!;
    await click(start, 'start');

    const finished = new Promise<void>(resolve => {
        sdk.onStateUpdate(s => {
            if (done) return;
            const fx = fishingXp(s);
            if (fx.experience !== lastXp) {
                const d = (fx.experience - lastXp) / 25;
                lastXp = fx.experience;
                if (firstCatchTick < 0) firstCatchTick = s.tick;
                else {
                    const g = s.tick - lastCatchTick;
                    gaps.set(g, (gaps.get(g) ?? 0) + 1);
                }
                lastCatchTick = s.tick;
                catches++;
                baseXp += d;
                log({ ev: 'xp', tick: s.tick, base: d, level: fx.baseLevel });
                if (dropMode === 'each') run('drop-each', async () => { await dropAll(s, 3); await click(s, 'after-drop'); });
            }
            if (fx.baseLevel !== lastLevel) {
                levelUps++;
                log({ ev: 'levelup', tick: s.tick, level: fx.baseLevel });
                lastLevel = fx.baseLevel;
                if (pin && fx.baseLevel !== level) sdk.sendSay(`::setstat fishing ${level}`);
            }
            if (s.dialog?.isOpen && !dialogBusy) {
                dialogBusy = true;
                log({ ev: 'dialog', tick: s.tick, text: s.dialog.text });
                sdk.sendClickDialog(0).finally(() => (dialogBusy = false));
            }
            const free = 28 - s.inventory.length;
            if (dropMode === 'full' && free === 0) {
                run('drop-full', async () => {
                    log({ ev: 'full', tick: s.tick });
                    await dropAll(s, 28);
                    await click(sdk.getState()!, 'after-full');
                });
            }
            if (target) {
                const now = s.nearbyNpcs.find(n => n.index === target!.index);
                const tile = now ? tileOf(now) : null;
                if (!tile || !targetTile || tile[0] !== targetTile[0] || tile[1] !== targetTile[1]) {
                    moves++;
                    log({ ev: 'move', tick: s.tick, from: targetTile, to: tile });
                    targetTile = tile;
                    // The client routes every click itself (clientRoutefinder), so the server never
                    // follows a relocated spot: re-click, choosing whichever matching spot is nearest.
                    if (react === 'move') run('move', () => click(s, 'move', true));
                }
            }
            // Watchdog: idle animation for 10 ticks with no catch means the interaction died.
            const pos = s.player ? `${s.player.worldX},${s.player.worldZ}` : '';
            if (pos !== lastPos) {
                log({ ev: 'pos', tick: s.tick, pos });
                lastPos = pos;
            }
            idleTicks = s.player && s.player.animId === -1 ? idleTicks + 1 : 0;
            if (idleTicks >= 10 && s.tick - lastCatchTick > 10 && s.tick - lastClickTick > 10) {
                idleTicks = 0;
                log({ ev: 'watchdog', tick: s.tick });
                run('watchdog', () => click(s, 'watchdog', true));
            }
            if (firstCatchTick >= 0 && s.tick - firstCatchTick >= runTicks) {
                done = true;
                resolve();
            }
        });
    });
    await finished;

    const span = lastCatchTick - firstCatchTick;
    const summary = {
        method: methodName,
        level,
        dropMode,
        react,
        catches,
        baseXp: Math.round(baseXp * 10) / 10,
        spanTicks: span,
        xpPerTick: Math.round((baseXp / Math.max(span, 1)) * 1000) / 1000,
        moves,
        levelUps,
        gaps: Object.fromEntries([...gaps.entries()].sort((a, b) => a[0] - b[0]))
    };
    log({ ev: 'summary', ...summary });
    console.log(JSON.stringify(summary));
}, { printState: false });
