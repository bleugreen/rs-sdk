// Auto-retaliate flinch as a Woodcutting starter (self-only-methods.md, row 1).
//
// usage (inside docs/speedrun/scripts/lab.sh from rs/2's branch, woodcutting block):
//   bun docs/speedrun/scripts/flinch-wc.ts <bot> control 60
//   bun docs/speedrun/scripts/flinch-wc.ts <bot> npcs6 300
//   (lab.sh form: docs/speedrun/scripts/flinch-wc.ts:npcs6:300)
//
// The bot sends a log drop on every label except the one at which it first sees a new
// hitsplat on itself; then it sends one click on the oak instead (landing on the tick
// after the hit). Without a flinch a lone click on an expired clock only arms the roll
// 3 ticks later (woodcut.rs2:55-60), and the drops that follow clear the chop
// interaction (OpHeldHandler.ts:54-56) before it can roll, so nothing rolls. With NPCs attacking, a hit on a drop tick runs
// [queue,playerhit_n_retaliate] with no interaction, which writes
// %action_delay = map_clock + attackrate/2 (auto_retaliate.rs2:9-22); bronze thrown
// knives have attackrate 3, so +1, and the click on the next tick rolls at once
// (woodcut.rs2:97-99). Every xp drop in a run is therefore flinch-driven, and a 2-tick
// gap between xp drops means two flinches in a row. Oak at level 99 succeeds on every
// roll, so every roll is an xp drop.
//
// npcsN spawns N hobgoblins on the bot's tile with ::npcadd, two ticks apart, at the
// multi-combat oak (2949,3314) area. Hits are read from player.combat.lastDamageTick,
// which updates on every hitsplat including zero-damage ones (bot StateCollector).
//
// Output: one line per xp drop and per hitpoint loss with the client's server tick,
// then the gap histogram.
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';

const argv = process.argv.slice(3);
const mode = argv[0] ?? 'control';
const labels = Number(argv[1] ?? '60');
const npcCount = /^npcs\d+$/.test(mode) ? Number(mode.slice(4)) : 0;
const stand = (argv[2] ?? '2948,3315').split(',').map(Number);

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial();
    const T = (n: number) => sdk.waitForTicks(n);
    const fire = (p: Promise<unknown>) => { p.catch(e => console.log(`send error: ${e}`)); };
    const say = async (s: string) => { await sdk.sendSay(s); await T(2); };

    for (const s of ['::setstat woodcutting 99', '::setstat hitpoints 99', '::setstat defence 99',
        '::give rune_axe 1', '::give bronze_knife 500', '::give logs 24']) await say(s);
    for (const pat of [/Rune axe/, /Bronze knife/]) {
        const it = sdk.getState()!.inventory.find(i => pat.test(i.name));
        const w = it?.optionsWithIndex.find(o => /wield/i.test(o.text));
        if (it && w) { await sdk.sendUseItem(it.slot, w.opIndex); await T(2); }
    }
    await sdk.sendSetCombatStyle(0); // accurate: not rapid, so the flinch is +1
    await say(`::tele 0,${stand[0] >> 6},${stand[1] >> 6},${stand[0] & 63},${stand[1] & 63}`);
    await T(2);
    let oak = sdk.getState()!.nearbyLocs.filter(l => l.name === 'Oak').sort((a, b) => a.distance - b.distance)[0];
    for (let i = 0; !oak && i < 10; i++) {
        await T(1);
        oak = sdk.getState()!.nearbyLocs.filter(l => l.name === 'Oak').sort((a, b) => a.distance - b.distance)[0];
    }
    // fallback: the multi-combat oak south-west of Falador (loc 1281 oaktree, map m46_51)
    if (!oak) oak = { x: 2949, z: 3314, id: 1281, name: 'Oak', distance: 1 } as any;
    const eq = sdk.getState()!.equipment.map(i => i.name).join(', ');
    console.log(`setup: mode=${mode} at (${sdk.getState()!.player!.worldX},${sdk.getState()!.player!.worldZ}) oak@(${oak.x},${oak.z}) equipment=[${eq}]`);
    // walk next to the oak with one ordinary chop click
    await sdk.sendInteractLoc(oak.x, oak.z, oak.id, 1);
    await T(8);

    for (let i = 0; i < npcCount; i++) { await sdk.sendSay('::npcadd hobgoblin_unarmed'); await T(2); }
    if (npcCount) {
        // wait until the bot has been hit at least once (or 30 ticks)
        const hp0 = sdk.getState()!.skills.find(s => s.name.toLowerCase() === 'hitpoints')!.level;
        for (let i = 0; i < 30; i++) {
            const s = await T(1);
            const hp = s.skills.find(x => x.name.toLowerCase() === 'hitpoints')!.level;
            if (hp < hp0 || s.player?.inCombat) break;
        }
    }

    // Hit-driven loop (the OSRS method): click the oak only on the label at which a new
    // hitsplat (any damage, including 0) is first seen, so the click lands on the tick
    // after the hit; send a log drop on every other label, which keeps the interaction
    // clear for the next flinch. Never click on two labels in a row: a click on an
    // expired clock would re-arm it +3 (woodcut.rs2:55-60) and block the next flinch.
    let lastXp = sdk.getSkillXp('woodcutting') ?? 0;
    let lastDmg = sdk.getState()!.player?.combat?.lastDamageTick ?? -1;
    let clickedLast = false;
    const xpTicks: number[] = [];
    const hitTicks: number[] = [];
    const clickLand: number[] = [];

    const step = (s: BotWorldState) => {
        const xp = sdk.getSkillXp('woodcutting') ?? 0;
        if (xp > lastXp) { xpTicks.push(s.tick); console.log(`X t=${s.tick} +${(xp - lastXp) / 25}`); lastXp = xp; }
        const dmg = s.player?.combat?.lastDamageTick ?? -1;
        const newHit = dmg !== lastDmg;
        if (newHit) { hitTicks.push(s.tick); lastDmg = dmg; }
        if (newHit && !clickedLast) {
            const stump = s.nearbyLocs.some(l => l.x === oak.x && l.z === oak.z && l.name !== 'Oak');
            if (!stump) { fire(sdk.sendInteractLoc(oak.x, oak.z, oak.id, 1)); clickLand.push(s.tick + 1); clickedLast = true; return; }
        }
        clickedLast = false;
        const log = s.inventory.find(i => i.name === 'Logs');
        if (log) fire(sdk.sendDropItem(log.slot));
        else fire(sdk.sendSay('::give logs 27'));
    };

    for (let i = 0; i < labels; i++) step(await T(1));

    const gaps: Record<number, number> = {};
    for (let i = 1; i < xpTicks.length; i++) { const g = xpTicks[i] - xpTicks[i - 1]; gaps[g] = (gaps[g] ?? 0) + 1; }
    const xpOnClick = xpTicks.filter(t => clickLand.includes(t)).length;
    console.log(`summary: mode=${mode} labels=${labels} hitsplatsSeen=${hitTicks.length} clicks=${clickLand.length} xpDrops=${xpTicks.length} xpOnAClickTick=${xpOnClick}`);
    console.log(`gaps between xp drops (ticks:count): ${Object.entries(gaps).map(([g, c]) => `${g}:${c}`).join(' ')}`);
    const span = xpTicks.length > 1 ? (xpTicks[xpTicks.length - 1] - xpTicks[0]) / (xpTicks.length - 1) : NaN;
    console.log(`ticks per roll over the xp span: ${span.toFixed(2)}; hitsplats per tick: ${(hitTicks.length / labels).toFixed(2)}`);
}, { printState: false });
