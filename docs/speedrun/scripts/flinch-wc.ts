// Auto-retaliate flinch as a Woodcutting starter (self-only-methods.md, row 1).
//
// usage (inside docs/speedrun/scripts/lab.sh from rs/2's branch, woodcutting block):
//   bun docs/speedrun/scripts/flinch-wc.ts <bot> control 60
//   bun docs/speedrun/scripts/flinch-wc.ts <bot> npcs:6 300
//
// The bot alternates by server-tick parity: on one parity it sends only a log drop,
// on the other only a click on the oak. Without a flinch this never rolls: a click on
// an expired clock sets the roll 3 ticks later (woodcut.rs2:55-60), which is always a
// drop tick, and the drop clears the chop interaction (OpHeldHandler.ts:54-56) before
// the loop can roll. With NPCs attacking, a hit on a drop tick runs
// [queue,playerhit_n_retaliate] with no interaction, which writes
// %action_delay = map_clock + attackrate/2 (auto_retaliate.rs2:9-22); bronze thrown
// knives have attackrate 3, so +1, and the click on the next tick rolls at once
// (woodcut.rs2:97-99). Every xp drop in a run is therefore flinch-driven, and a 2-tick
// gap between xp drops means two flinches in a row. Oak at level 99 succeeds on every
// roll, so every roll is an xp drop.
//
// npcs:N spawns N hobgoblins on the bot's tile with ::npcadd, two ticks apart, at the
// multi-combat oak (2949,3314) area. If no xp arrives for 16 ticks the bot swaps the
// parity once (the hits may be landing on its click ticks).
//
// Output: one line per xp drop and per hitpoint loss with the client's server tick,
// then the gap histogram.
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';

const argv = process.argv.slice(3);
const mode = argv[0] ?? 'control';
const labels = Number(argv[1] ?? '60');
const npcCount = mode.startsWith('npcs:') ? Number(mode.split(':')[1]) : 0;
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
    const oak = sdk.getState()!.nearbyLocs.filter(l => l.name === 'Oak').sort((a, b) => a.distance - b.distance)[0];
    if (!oak) throw new Error('no oak in view');
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

    let phase = 0;
    let lastXp = sdk.getSkillXp('woodcutting') ?? 0;
    let lastHp = sdk.getState()!.skills.find(s => s.name.toLowerCase() === 'hitpoints')!.level;
    let lastXpTick = -1, startTick = -1, shifts = 0;
    const xpTicks: number[] = [];
    const hitTicks: number[] = [];
    const dropTicks: number[] = [];
    const clickTicks: number[] = [];

    const step = (s: BotWorldState) => {
        if (startTick < 0) { startTick = s.tick; lastXpTick = s.tick; }
        const xp = sdk.getSkillXp('woodcutting') ?? 0;
        if (xp > lastXp) { xpTicks.push(s.tick); console.log(`X t=${s.tick} +${(xp - lastXp) / 25}`); lastXp = xp; lastXpTick = s.tick; }
        const hp = s.skills.find(x => x.name.toLowerCase() === 'hitpoints')!.level;
        if (hp < lastHp) { hitTicks.push(s.tick); console.log(`H t=${s.tick} -${lastHp - hp}`); }
        lastHp = hp;
        if (npcCount && s.tick - lastXpTick >= 16 && shifts < 4) { phase ^= 1; shifts++; lastXpTick = s.tick; console.log(`shift t=${s.tick} phase=${phase}`); }
        if (s.tick % 2 === phase) {
            const log = s.inventory.find(i => i.name === 'Logs');
            if (log) { fire(sdk.sendDropItem(log.slot)); dropTicks.push(s.tick + 1); }
            else fire(sdk.sendSay('::give logs 20'));
        } else {
            const live = s.nearbyLocs.find(l => l.x === oak.x && l.z === oak.z && l.name === 'Oak');
            if (live) { fire(sdk.sendInteractLoc(live.x, live.z, live.id, 1)); clickTicks.push(s.tick + 1); }
        }
    };

    for (let i = 0; i < labels; i++) step(await T(1));

    const gaps: Record<number, number> = {};
    for (let i = 1; i < xpTicks.length; i++) { const g = xpTicks[i] - xpTicks[i - 1]; gaps[g] = (gaps[g] ?? 0) + 1; }
    console.log(`summary: mode=${mode} labels=${labels} xpDrops=${xpTicks.length} hpLosses=${hitTicks.length} shifts=${shifts}`);
    console.log(`gaps (ticks:count): ${Object.entries(gaps).map(([g, c]) => `${g}:${c}`).join(' ')}`);
    const span = xpTicks.length > 1 ? (xpTicks[xpTicks.length - 1] - xpTicks[0]) / (xpTicks.length - 1) : NaN;
    console.log(`ticks per roll over the xp span: ${span.toFixed(2)}`);
}, { printState: false });
