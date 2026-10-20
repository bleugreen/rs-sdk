// Tree Gnome Village, played start to finish on the lab server and timed step
// by step (docs/speedrun/quests/tree_gnome_village.md). Resets %treequest to 0,
// gives the six logs a helper would trade, and walks every leg (run on,
// ::energy before each long walk so the result is the infinite-run case).
// Run: bun docs/speedrun/scripts/quest-tree-full.ts <botname>

import { runScript } from '../../../sdk/runner';
import { cheat, dialogue, fight, getvar, give, invCount, locOp, now, pos, Recorder, setvar, talk, tele, waitTicks, waitUntil, walk } from './quest-gnome-lib';

await runScript(async ({ bot, sdk }) => {
    const rec = new Recorder('tree_gnome_village');
    await cheat(sdk, 'clearinv inv');
    await setvar(sdk, 'treequest', 0);
    await give(sdk, 'logs', 6);
    await give(sdk, 'shark', 6);
    await tele(sdk, 2504, 3193);
    await cheat(sdk, 'energy');
    const atk0 = sdk.getSkill('attack')!.experience;
    const T0 = now(sdk);
    // The maze side of the village fence is z <= 3160; the loose railing at (2515,3161) has no requirement.
    const railing = () => locOp(sdk, /loose railing/i, /squeeze/i, s => pos(s).z >= 3162, 20);

    // 1. First entry: walk the maze to the loose railing, squeeze through, walk to King Bolren
    // (Elkoy only guides once the quest has started).
    rec.add(await walk(bot, sdk, 2515, 3160, 0), '1a maze to loose railing');
    rec.add(await railing(), '1b');
    rec.add(await walk(bot, sdk, 2541, 3171, 1), '1c railing to Bolren');
    rec.add(await talk(sdk, /^King Bolren$/i, [/Can I help at all/, /glad to help/], { idle: 4 }), '2 Bolren start');
    console.log('treequest', await getvar(sdk, 'treequest'), 'pos', pos(sdk.getState()));

    // 2. Commander Montai, three conversations.
    await cheat(sdk, 'energy');
    rec.add(await walk(bot, sdk, 2523, 3212, 1), '3 walk to Montai');
    rec.add(await talk(sdk, /^Commander Montai$/i, [/gather some wood/]), '4 Montai 1');
    rec.add(await talk(sdk, /^Commander Montai$/i, []), '5 Montai 2 (logs)');
    rec.add(await talk(sdk, /^Commander Montai$/i, [/try my best/]), '6 Montai 3');
    console.log('treequest', await getvar(sdk, 'treequest'));

    // 3. Ballista: the coordinates are fixed at 4/3/5 on this server, no tracker visits needed.
    {
        const locs = (await sdk.scanNearbyLocs(20)).filter(l => /ballista/i.test(l.name));
        const b = locs[0];
        const t0 = now(sdk);
        const d = dialogue(sdk, [/^0004$/, /^0003$/, /^0005$/], { idle: 4 });
        await sdk.sendInteractLoc(b.x, b.z, b.id, b.optionsWithIndex.find(o => /fire/i.test(o.text))!.opIndex);
        const run = await d;
        rec.add({ name: 'fire ballista', ticks: run.endTick - t0, approach: run.firstTick - t0, pages: run.pages, choices: run.choices }, '7');
    }
    console.log('treequest', await getvar(sdk, 'treequest'));

    // 4. Into the stronghold over the crumbled wall, up the ladder, open and search the chest.
    await cheat(sdk, 'energy');
    rec.add(await walk(bot, sdk, 2509, 3252, 0), '8 walk to crumbled wall');
    {
        const t0 = now(sdk);
        const d = dialogue(sdk, [], { idle: 3 });
        const r = await locOp(sdk, /crumbled wall/i, /climb/i, s => pos(s).z >= 3254, 30);
        await d;
        rec.add({ ...r, ticks: now(sdk) - t0 }, '9');
    }
    rec.add(await walk(bot, sdk, 2503, 3253, 0), '10 walk to ladder');
    rec.add(await locOp(sdk, /ladder/i, /climb-up/i, s => pos(s).level === 1, 20), '11');
    rec.add(await locOp(sdk, /chest/i, /^open$/i, s => (s.nearbyLocs ?? []).some(l => /^open chest$/i.test(l.name)), 30), '12');
    {
        const t0 = now(sdk);
        const d = dialogue(sdk, [], { idle: 3 });
        await locOp(sdk, /^open chest$/i, /search/i, s => invCount(s, /orb of protection/i) > 0, 30);
        const run = await d;
        rec.add({ name: 'search chest', ticks: Math.max(run.endTick, now(sdk)) - t0, pages: run.pages }, '13');
    }
    rec.add(await locOp(sdk, /ladder/i, /climb-down/i, s => pos(s).level === 0, 20), '14');

    // 5. Back to Bolren with the orb: walk out to Elkoy, who jumps you through the maze.
    await cheat(sdk, 'energy');
    rec.add(await walk(bot, sdk, 2504, 3193, 1), '15 walk to Elkoy');
    rec.add(await talk(sdk, /^Elkoy$/i, [/Yes please/], { idle: 3 }), '16 Elkoy guide in');
    rec.add(await railing(), '17a');
    rec.add(await walk(bot, sdk, 2541, 3171, 1), '17b railing to Bolren');
    rec.add(await talk(sdk, /^King Bolren$/i, [/find the warlord/], { idle: 4 }), '18 Bolren orb 1');
    console.log('treequest', await getvar(sdk, 'treequest'), 'pos', pos(sdk.getState()));

    // 6. The Khazard warlord north-west of the battlefield.
    await cheat(sdk, 'energy');
    rec.add(await walk(bot, sdk, 2459, 3300, 3), '19 walk to warlord');
    {
        const hp0 = sdk.getState()!.player!.hp;
        const d = dialogue(sdk, [], { idle: 3, startTimeout: 1500, maxTicks: 1600 });
        const f = await fight(sdk, bot, /^Khazard warlord$/i, { eatBelow: 35 });
        await d;
        await waitUntil(sdk, s => invCount(s, /orb of protection/i) > 0, 10);
        rec.add({ ...f, note: `hp ${hp0}->${sdk.getState()!.player!.hp}, damage taken ${f.damageTaken}, food ${f.food}` }, '20');
    }
    console.log('treequest', await getvar(sdk, 'treequest'));

    // 7. Return the orbs: Elkoy again, then the ceremony.
    await cheat(sdk, 'energy');
    rec.add(await walk(bot, sdk, 2504, 3193, 1), '21 walk to Elkoy');
    rec.add(await talk(sdk, /^Elkoy$/i, [/Yes please/], { idle: 3 }), '22 Elkoy guide in');
    rec.add(await railing(), '23a');
    rec.add(await walk(bot, sdk, 2541, 3171, 1), '23b railing to Bolren');
    rec.add(await talk(sdk, /^King Bolren$/i, [], { idle: 12 }), '24 Bolren finish + ceremony');
    await waitTicks(sdk, 3);
    const atk1 = sdk.getSkill('attack')!.experience;
    console.log('treequest', await getvar(sdk, 'treequest'), 'attack xp gained', atk1 - atk0, '=', (atk1 - atk0) / 25, 'base');
    console.log('wall ticks start->finish', now(sdk) - T0);
    rec.summary();
}, { timeout: 900_000 });
