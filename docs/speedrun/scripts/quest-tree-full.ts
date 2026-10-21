// Tree Gnome Village, played start to finish on the lab server and timed step
// by step (docs/speedrun/quests/tree_gnome_village.md). Resets %treequest to 0,
// gives the six logs a helper would trade, and walks every leg (run on,
// ::energy before each long walk so the result is the infinite-run case).
// Run: bun docs/speedrun/scripts/quest-tree-full.ts <botname>

import { runScript } from '../../../sdk/runner';
import { openDoor, opLoc, talkTo, walkTo } from '../../../speedrun/lib/act';
import { fight } from '../../../speedrun/lib/combat';
import { converse } from '../../../speedrun/lib/converse';
import type { OptionPattern } from '../../../speedrun/lib/dialogue';
import { pathTiles } from '../../../speedrun/lib/paths';
import { currentTick, waitTicks, waitUntil, type Pred } from '../../../speedrun/lib/wait';
import { invCount, pos, skillXp, type LocQuery } from '../../../speedrun/lib/world';
import { Recorder } from '../../../speedrun/lab/record';
import { cheat, clearInventory, getvar, give, mustTele, setvar } from '../../../speedrun/lab/setup';

// server/engine/src/util/WorldConfig.ts:102 (node.xpRate).
const XP_RATE = 25;

await runScript(async ({ bot, sdk }) => {
    const rec = new Recorder(sdk, 'tree_gnome_village');
    const energy = () => cheat(sdk, '~energy', 1);
    const walk = (name: string, x: number, z: number, tol: number) => rec.seg(name, async () => {
        const p = pos(sdk);
        const est = pathTiles(p.level, p.x, p.z, x, z);
        const w = await walkTo(bot, sdk, x, z, tol);
        return `${est.tiles} path tiles${w.ok ? '' : ' FAILED ' + w.message}`;
    });
    const talk = (name: string, npc: RegExp, choices: OptionPattern[], idle = 3) => rec.seg(name, async () => {
        const r = await talkTo(sdk, npc, choices, { idle, maxTicks: 600, unmatched: 'stop', closeModals: true });
        rec.dialogue(r);
        rec.interact(r.clicks);
        if (r.firstTick >= 0) rec.note(`approach ${r.firstTick - r.startTick}`);
        return r.ok ? undefined : r.reason;
    });
    // A loc click, timed to the effect `done`; with `talks` the page the click opens is answered and the
    // segment runs to whichever ends later, the effect or the page.
    const locStep = (name: string, q: LocQuery, op: RegExp, done: Pred, o: { maxTicks?: number; talks?: boolean } = {}) => rec.seg(name, async () => {
        const maxTicks = o.maxTicks ?? 30;
        const conv = o.talks ? converse(sdk, [], { idle: 3, openTicks: maxTicks, closeModals: true, unmatched: 'stop' }) : null;
        const r = await opLoc(sdk, { radius: 20, ...q }, op, done, { maxTicks });
        rec.interact(1 + r.resends);
        rec.mark();
        if (conv) rec.dialogue(await conv);
        return r.ok ? undefined : 'TIMEOUT';
    });

    await clearInventory(sdk);
    await setvar(sdk, 'treequest', 0);
    await give(sdk, 'logs', 6);
    await give(sdk, 'shark', 6);
    await mustTele(sdk, 2504, 3193);
    await energy();
    const atk0 = skillXp(sdk, 'attack');
    const T0 = currentTick(sdk);
    // The maze side of the village fence is z <= 3160; squeezing through the loose railing at (2515,3161)
    // (no requirement) moves you one tile, onto the railing line, on the village side.
    const railing = (label: string) => locStep(`${label} squeeze through the loose railing`, { name: /loose railing/i, op: /squeeze/i }, /squeeze/i, s => pos(s).z >= 3161, { maxTicks: 20 });

    // 1. First entry: walk the maze to the loose railing, squeeze through, walk to King Bolren
    // (Elkoy only guides once the quest has started).
    await walk('1a maze to loose railing', 2515, 3160, 0);
    await railing('1b');
    await walk('1c railing to Bolren', 2541, 3171, 1);
    await talk('2 Bolren start', /^King Bolren$/i, [/Can I help at all/, /glad to help/], 4);
    console.log('treequest', await getvar(sdk, 'treequest'), 'pos', pos(sdk));

    // 2. Commander Montai, three conversations.
    await energy();
    await walk('3 walk to Montai', 2523, 3212, 1);
    await talk('4 Montai 1', /^Commander Montai$/i, [/gather some wood/]);
    await talk('5 Montai 2 (logs)', /^Commander Montai$/i, []);
    await talk('6 Montai 3', /^Commander Montai$/i, [/try my best/]);
    console.log('treequest', await getvar(sdk, 'treequest'));

    // 3. Ballista: the coordinates are fixed at 4/3/5 on this server, no tracker visits needed.
    await rec.seg('7 fire ballista', async () => {
        const conv = converse(sdk, [/^0004$/, /^0003$/, /^0005$/], { idle: 4, openTicks: 60, maxTicks: 600, unmatched: 'stop' });
        await opLoc(sdk, { name: /ballista/i, op: /fire/i, radius: 20 }, /fire/i);
        rec.interact();
        const r = rec.dialogue(await conv);
        if (r.firstTick >= 0) rec.note(`approach ${r.firstTick - r.startTick}`);
        return r.ok ? undefined : r.reason;
    });
    console.log('treequest', await getvar(sdk, 'treequest'));

    // 4. Into the stronghold over the crumbled wall, up the ladder, open and search the chest.
    await energy();
    await walk('8 walk to crumbled wall', 2509, 3252, 0);
    await locStep('9 climb over the crumbled wall', { name: /crumbled wall/i, op: /climb/i }, /climb/i, s => pos(s).z >= 3254, { talks: true });
    // The ladder (2503,3252) is in the next room: through the door at (2505,3256).
    await rec.seg('10a open door (2505,3256)', async () => {
        const r = await openDoor(sdk, 2505, 3256);
        if (r.ticks > 0) rec.interact(1 + r.resends);
        return r.ok ? undefined : 'TIMEOUT';
    });
    await locStep('10b walk + 11 climb up the ladder', { name: /^ladder$/i, op: /climb-up/i }, /climb-up/i, s => pos(s).level === 1);
    await locStep('12 open chest', { name: /chest/i, op: /^open$/i }, /^open$/i, s => s.nearbyLocs.some(l => /^open chest$/i.test(l.name)));
    await locStep('13 search chest', { name: /^open chest$/i, op: /search/i }, /search/i, s => invCount(s, /orb of protection/i) > 0, { talks: true });
    await locStep('14 climb down the ladder', { name: /ladder/i, op: /climb-down/i }, /climb-down/i, s => pos(s).level === 0, { maxTicks: 20 });

    // 5. Back to Bolren with the orb: walk out to Elkoy, who jumps you through the maze.
    await energy();
    await walk('15 walk to Elkoy', 2504, 3193, 1);
    await talk('16 Elkoy guide in', /^Elkoy$/i, [/Yes please/]);
    await railing('17a');
    await walk('17b railing to Bolren', 2541, 3171, 1);
    await talk('18 Bolren orb 1', /^King Bolren$/i, [/find the warlord/], 4);
    console.log('treequest', await getvar(sdk, 'treequest'), 'pos', pos(sdk));

    // 6. The Khazard warlord north-west of the battlefield.
    await energy();
    await walk('19 walk to warlord', 2459, 3300, 3);
    {
        const hp0 = sdk.getState()!.player!.hp;
        // Pages that open mid-fight are clicked through; a page after the kill is answered before the orbs are checked.
        const f = await fight(sdk, /^Khazard warlord$/i, { eatBelow: 35, maxTicks: 1500, onDialog: 'continue' });
        await converse(sdk, [], { idle: 3, openTicks: 5, closeModals: true });
        await waitUntil(sdk, s => invCount(s, /orb of protection/i) > 0, { maxTicks: 10 });
        rec.add({ name: `20 fight Khazard warlord (${f.end})`, ticks: f.ticks, levelUps: f.levelUps, note: `hp ${hp0}->${sdk.getState()!.player!.hp}, damage taken ${f.taken}, food ${f.eats}` });
    }
    console.log('treequest', await getvar(sdk, 'treequest'));

    // 7. Return the orbs: Elkoy again, then the ceremony.
    await energy();
    await walk('21 walk to Elkoy', 2504, 3193, 1);
    await talk('22 Elkoy guide in', /^Elkoy$/i, [/Yes please/]);
    await railing('23a');
    await walk('23b railing to Bolren', 2541, 3171, 1);
    // The ceremony leaves the chat box closed for about 17 ticks while the gnomes chant.
    await talk('24 Bolren finish + ceremony', /^King Bolren$/i, [], 25);
    await waitTicks(sdk, 3);
    const atk1 = skillXp(sdk, 'attack');
    console.log('treequest', await getvar(sdk, 'treequest'), 'attack xp gained', atk1 - atk0, '=', (atk1 - atk0) / XP_RATE, 'base');
    console.log('wall ticks start->finish', currentTick(sdk) - T0);
    rec.report();
}, { timeout: 900_000 });
