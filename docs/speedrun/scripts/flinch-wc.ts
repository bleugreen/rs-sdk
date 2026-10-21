// Auto-retaliate flinch as a Woodcutting starter (self-only-methods.md, row 1 and section 3a).
//
// usage (inside docs/speedrun/scripts/woodcutting-lab.sh, woodcutting block):
//   bun docs/speedrun/scripts/flinch-wc.ts <bot> control 60
//   bun docs/speedrun/scripts/flinch-wc.ts <bot> npcs4 1200 knife 200
//   (lab.sh form: docs/speedrun/scripts/flinch-wc.ts:npcs4:1200:knife:200)
//   args: mode (control | npcsN), max labels, weapon (knife | none), target rolls, stand x,z
//
// Mechanism (traced with flinch-trace.patch): a hit on tick F runs
// [queue,playerhit_n_retaliate] the same tick; if the player has no interaction (a drop
// landed on F) and %action_delay < map_clock, it writes %action_delay = F + attackrate/2
// (auto_retaliate.rs2:9-22; bronze thrown knives attackrate 3, so F+1) and sets an attack
// interaction. A tree click landing on F+1 replaces the attack and rolls at once because
// the clock equals map_clock (woodcut.rs2:97-99). The bot sees the hitsplat on its label
// for tick F, so a click sent then lands on F+1.
//
// npcsN: hobgoblins are added with ::npcadd on the bot's tile, each attacking every 4
// ticks. The first spawn teaches the bot the delay from a spawn label to that NPC's first
// hit (mod 4); later spawns are timed so their hits land 2 ticks after the existing ones,
// giving a hit on every other tick. ::npcadd NPCs despawn after 500 ticks
// (ClientCheatHandler.ts:515), so whenever the hits of the last 8 ticks stop covering two
// residues 2 apart the controller spawns again (at most N spawns in all). Extra attackers
// are harmless: a hit on a click tick finds the chop interaction (busy2) and writes nothing.
//
// Loop, every label: if a new hitsplat is seen and the bot did not click on the previous
// label, click the oak; otherwise drop one log. Never two clicks in a row (a click on an
// expired clock arms it +3, woodcut.rs2:55-60). Dropping on every other label also clears
// the retaliate attack interaction, so the player's own attack never fires while the
// loop runs; the knife count is logged to confirm it.
//
// Output: one line per xp drop with the client's server tick, then the gap histogram,
// with gaps that span a tree fell reported separately.
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';

const argv = process.argv.slice(3);
const mode = argv[0] ?? 'control';
const labels = Number(argv[1] ?? '60');
const npcMax = /^npcs\d+$/.test(mode) ? Number(mode.slice(4)) : 0;
const weapon = argv[2] ?? 'knife';
const targetRolls = Number(argv[3] ?? '200');
const stand = (argv[4] ?? '2948,3315').split(',').map(Number);

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial();
    const T = (n: number) => sdk.waitForTicks(n);
    const fire = (p: Promise<unknown>) => { p.catch(e => console.log(`send error: ${e}`)); };
    const say = async (s: string) => { await sdk.sendSay(s); await T(2); };

    for (const s of ['::setstat woodcutting 99', '::setstat hitpoints 99', '::setstat defence 99',
        '::give rune_axe 1', '::give bronze_knife 500', '::give logs 24']) await say(s);
    for (const pat of weapon === 'knife' ? [/Rune axe/, /Bronze knife/] : [/Rune axe/]) {
        const it = sdk.getState()!.inventory.find(i => pat.test(i.name));
        const w = it?.optionsWithIndex.find(o => /wield/i.test(o.text));
        if (it && w) { await sdk.sendUseItem(it.slot, w.opIndex); await T(2); }
    }
    await sdk.sendSetCombatStyle(0); // accurate: not rapid, so the knife flinch is +1
    await say(`::tele 0,${stand[0] >> 6},${stand[1] >> 6},${stand[0] & 63},${stand[1] & 63}`);
    await T(2);
    const findOak = () => sdk.getState()!.nearbyLocs.filter(l => l.name === 'Oak').sort((a, b) => a.distance - b.distance)[0];
    let oak = findOak();
    for (let i = 0; !oak && i < 10; i++) { await T(1); oak = findOak(); }
    // fallback: the multi-combat oak south-west of Falador (loc 1281 oaktree, map m46_51)
    if (!oak) oak = { x: 2949, z: 3314, id: 1281, name: 'Oak', distance: 1 } as any;
    const eq = () => sdk.getState()!.equipment.map(i => `${i.name}x${i.count}`).join(', ');
    console.log(`setup: mode=${mode} at (${sdk.getState()!.player!.worldX},${sdk.getState()!.player!.worldZ}) oak@(${oak.x},${oak.z}) equipment=[${eq()}]`);
    // one ordinary chop click to stand next to the oak, then stop it with a drop
    await sdk.sendInteractLoc(oak.x, oak.z, oak.id, 1);
    await T(6);

    const isLog = (n: string) => /logs$/i.test(n);
    const dropLog = (s: BotWorldState) => {
        const logs = s.inventory.filter(i => isLog(i.name));
        const log = logs[logs.length - 1];
        if (log) fire(sdk.sendDropItem(log.slot));
        else console.log(`t=${s.tick} no log to drop`);
    };

    let lastDmg = sdk.getState()!.player?.combat?.lastDamageTick ?? -1;
    const hitTicks: number[] = [];
    const seeHit = (s: BotWorldState) => {
        const dmg = s.player?.combat?.lastDamageTick ?? -1;
        if (dmg === lastDmg) return false;
        lastDmg = dmg;
        hitTicks.push(s.tick);
        return true;
    };

    // Spawn controller (runs inside the loop below, on every label).
    const residues = (now: number) => new Set(hitTicks.filter(t => t > now - 8).map(t => t % 4));
    const covered = (r: Set<number>) => [0, 1].some(a => r.has(a) && r.has(a + 2));
    let spawns = 0, spawnTick = -1, dMod: number | null = null, nextSpawn = 0;
    const spawnTicks: number[] = [];
    const controller = (s: BotWorldState, newHit: boolean) => {
        if (dMod === null && newHit && spawnTick >= 0) {
            dMod = (s.tick - spawnTick) % 4;
            console.log(`learned: spawn label ${spawnTick} -> first hit ${s.tick}, delay mod 4 = ${dMod}`);
        }
        if (spawns >= npcMax || s.tick < nextSpawn) return;
        const r = residues(s.tick);
        if (covered(r)) return;
        if (dMod !== null && r.size > 0) {
            const wanted = (Math.min(...r) + 2) % 4;
            if ((s.tick + dMod) % 4 !== wanted) return;
        } else if (dMod === null && spawns > 0) return; // still learning from the first spawn
        fire(sdk.sendSay('::npcadd hobgoblin_unarmed'));
        spawns++; spawnTick = s.tick; spawnTicks.push(s.tick); nextSpawn = s.tick + 10;
        console.log(`S t=${s.tick} spawn ${spawns}, hit residues {${[...r].sort().join(',')}}`);
    };

    let lastXp = sdk.getSkillXp('woodcutting') ?? 0;
    let clickedLast = false;
    const xpTicks: number[] = [];
    const clickLand: number[] = [];
    const fellAt: number[] = [];
    let wasStump = false;
    const knives0 = sdk.getState()!.equipment.find(i => /Bronze knife/.test(i.name))?.count ?? 0;
    const loopHits0 = hitTicks.length;

    const step = (s: BotWorldState) => {
        const xp = sdk.getSkillXp('woodcutting') ?? 0;
        if (xp > lastXp) { xpTicks.push(s.tick); console.log(`X t=${s.tick} +${(xp - lastXp) / 25}`); lastXp = xp; }
        const newHit = seeHit(s);
        controller(s, newHit);
        const stump = s.nearbyLocs.some(l => l.x === oak.x && l.z === oak.z && l.name !== 'Oak');
        if (stump && !wasStump) { fellAt.push(s.tick); console.log(`F t=${s.tick} oak felled`); }
        wasStump = stump;
        if (newHit && !clickedLast && !stump) {
            fire(sdk.sendInteractLoc(oak.x, oak.z, oak.id, 1));
            clickLand.push(s.tick + 1);
            clickedLast = true;
            return;
        }
        clickedLast = false;
        dropLog(s);
        if (s.inventory.filter(i => isLog(i.name)).length < 6 && s.tick % 5 === 0) fire(sdk.sendSay('::give logs 10'));
    };

    for (let i = 0; i < labels && xpTicks.length < targetRolls; i++) {
        let s: BotWorldState;
        try { s = await T(1); } catch (e) { console.log(`state stall: ${e}`); continue; }
        step(s);
    }

    const gaps: Record<number, number> = {};
    const fellGaps: number[] = [], spawnGaps: number[] = [];
    for (let i = 1; i < xpTicks.length; i++) {
        const g = xpTicks[i] - xpTicks[i - 1];
        const inGap = (ts: number[], lead: number) => ts.some(f => f > xpTicks[i - 1] - lead && f <= xpTicks[i]);
        if (inGap(fellAt, 0)) { fellGaps.push(g); continue; }
        if (inGap(spawnTicks, 8)) { spawnGaps.push(g); continue; }
        gaps[g] = (gaps[g] ?? 0) + 1;
    }
    const xpOnClick = xpTicks.filter(t => clickLand.includes(t)).length;
    const afterHit = xpTicks.filter(t => hitTicks.includes(t - 1)).length;
    const knives1 = sdk.getState()!.equipment.find(i => /Bronze knife/.test(i.name))?.count ?? 0;
    console.log(`summary: mode=${mode} weapon=${weapon} labelsHitsSeen=${hitTicks.length - loopHits0} clicks=${clickLand.length} xpDrops=${xpTicks.length} xpOnAClickTick=${xpOnClick} xpOnTickAfterSeenHit=${afterHit} fells=${fellAt.length} knives ${knives0}->${knives1}`);
    console.log(`gaps between xp drops, no fell in between (ticks:count): ${Object.entries(gaps).map(([g, c]) => `${g}:${c}`).join(' ')}`);
    console.log(`gaps spanning a fell: ${fellGaps.join(' ')}`);
    console.log(`gaps spanning a (re)spawn (from 8 ticks before it): ${spawnGaps.join(' ')}; spawns at ${spawnTicks.join(',')}`);
    const span = xpTicks.length > 1 ? (xpTicks[xpTicks.length - 1] - xpTicks[0]) / (xpTicks.length - 1) : NaN;
    console.log(`ticks per roll over the xp span, fells included: ${span.toFixed(2)}`);
}, { printState: false });
