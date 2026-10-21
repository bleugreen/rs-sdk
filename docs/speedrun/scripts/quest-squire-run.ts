// The Knight's Sword, end to end, as tick-stamped segments (docs/speedrun/quests/knights_sword.md).
//
//   bun docs/speedrun/scripts/quest-squire-run.ts <bot> [--from 0..4] [--mining 10] [--pick steel_pickaxe]
//
// Teleports are not cast: the script ::tele's to the spell's or the glory's
// landing tile and prints a TELEPORT line, and the document costs it with the
// measured primitive (spell 4 ticks, glory 6; docs/speedrun/quests/primitives.md).
// Everything after the landing is walked and measured.
//   0  Falador: squire starts the quest; Varrock: Reldo
//   1  glory to Draynor, walk to the ice dungeon, mine blurite, Thurgo (pie, then the sword talk)
//   2  Falador: squire (portrait hint), castle ladders to Sir Vyvin's cupboard
//   3  glory to Draynor, walk to Thurgo: portrait, then blurite + 2 iron bars for the sword
//   4  Falador: squire takes the sword
// Helper-supplied (tradeable): redberry pie, 2 iron bars, pickaxe.
import { runScript } from '../../../sdk/runner';
import { opLoc, talkTo, walkTo, wield } from '../../../speedrun/lib/act';
import { converse } from '../../../speedrun/lib/converse';
import type { OptionPattern } from '../../../speedrun/lib/dialogue';
import { currentTick, waitTicks, waitUntil, type Pred } from '../../../speedrun/lib/wait';
import { invCount, pos, type NamePattern } from '../../../speedrun/lib/world';
import { Recorder } from '../../../speedrun/lab/record';
import { clearInventory, getvar, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';

function arg(name: string, dflt: string): string {
    const i = process.argv.indexOf('--' + name);
    return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : dflt;
}

const FROM = Number(arg('from', '0'));
const MINING = Number(arg('mining', '10'));
const PICK = arg('pick', 'steel_pickaxe');
const VYVIN_CUPBOARD_SHUT = 2271, VYVIN_CUPBOARD_OPEN = 2272;
const BLURITE = 2110;
const ROCKS: [number, number][] = [[3049, 9566], [3059, 9564]];

const teleports: string[] = [];

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial?.();
    const rec = new Recorder(sdk, `The Knight's Sword (from ${FROM}, Mining ${MINING}, ${PICK})`);
    const stage = async () => `stage ${await getvar(sdk, 'squire')}`;
    const teleport = async (what: string, x: number, z: number) => { teleports.push(what); console.log(`TELEPORT ${what}`); await mustTele(sdk, x, z); };
    const walk = async (x: number, z: number, tol: number) => {
        const r = await walkTo(bot, sdk, x, z, tol);
        if (!r.ok) throw new Error(`walk to ${x},${z} failed: ${r.message}`);
    };
    const talk = async (npc: NamePattern, choices: OptionPattern[] = []) => {
        const r = await talkTo(sdk, npc, choices);
        rec.interact(r.clicks);
        if (!r.opened) throw new Error(`no dialogue opened for ${String(npc)}`);
        if (!r.ok) throw new Error(`dialogue with ${String(npc)}: ${r.reason}`);
        rec.dialogue(r);
    };
    /** The loc at (x, z) offering `op` (ladders, stairs): click it and wait for `done`. */
    const climb = async (x: number, z: number, op: RegExp, done: Pred) => {
        rec.interact();
        const r = await opLoc(sdk, { x, z, op }, op, done, { maxTicks: 20 });
        if (!r.ok) throw new Error(`${op} at ${x},${z} did not land; at ${JSON.stringify(pos(sdk))}`);
    };

    await clearInventory(sdk);
    await setStats(sdk, { mining: MINING, hitpoints: 60, defence: 60, attack: 60, strength: 60 });
    await give(sdk, [PICK, 'redberry_pie'], 1);
    await give(sdk, 'iron_bar', 2);
    await wield(sdk, /pickaxe/i).catch(() => {}); // wieldable pickaxes free a slot; mining works either way

    if (FROM === 0) {
        await setvar(sdk, 'squire', 0);
        await teleport('Falador teleport (2965,3378)', 2965, 3378);
        await rec.seg('walk to the squire (2977,3342)', () => walk(2977, 3343, 1), 'travel');
        await rec.seg('squire: start', async () => {
            await talk(/^squire$/i, ['And how is life as a squire?', 'I can make a new sword if you like...', 'So would these dwarves make another one?', "Ok, I'll give it a go."]);
            return stage();
        }, 'dialogue');
        await teleport('Varrock teleport (3213,3424)', 3213, 3424);
        await rec.seg('walk to Reldo (3209,3495), round the palace west side', async () => {
            // the SDK collision snapshot sees a gap at (3212,3438) that the server blocks; go round
            for (const [x, z] of [[3182, 3436], [3180, 3470], [3206, 3480], [3210, 3494]] as [number, number][]) await walk(x, z, 1);
        }, 'travel');
        await rec.seg('Reldo: Imcando dwarves', async () => {
            await talk(/reldo/i, [/imcando/i]);
            return stage();
        }, 'dialogue');
    }
    if (FROM <= 1) {
        if (FROM === 1) await setvar(sdk, 'squire', 2);
        await teleport('Amulet of glory, Draynor Village (3105,3251)', 3105, 3251);
        await rec.seg('walk to the ice dungeon trapdoor (3008,3150)', () => walk(3008, 3151, 1), 'travel');
        await rec.seg('climb down', () => climb(3008, 3150, /climb-down/i, s => (s.player?.worldZ ?? 0) > 6000), 'interaction');
        await rec.seg('walk to blurite (3049,9566)', () => walk(3048, 9567, 1), 'travel');
        await rec.seg(`mine one blurite (Mining ${MINING})`, async () => {
            const t0 = currentTick(sdk);
            let clicks = 0;
            while (invCount(sdk, /blurite/i) === 0 && currentTick(sdk) - t0 < 300) {
                const rock = ROCKS.map(([x, z]) => sdk.getState()!.nearbyLocs.find(l => l.id === BLURITE && l.x === x && l.z === z)).find(Boolean);
                if (rock) { rec.interact(); await opLoc(sdk, rock, 1); clicks++; }
                await waitUntil(sdk, s => invCount(s, /blurite/i) > 0, { maxTicks: 12 });
            }
            return `clicks=${clicks}`;
        }, 'interaction');
        await rec.seg('walk back to the ladder (3008,9550)', () => walk(3008, 9551, 1), 'travel');
        await rec.seg('climb up', () => climb(3008, 9550, /climb-up/i, s => (s.player?.worldZ ?? 9999) < 6000), 'interaction');
        await rec.seg('walk to Thurgo (3001,3144)', () => walk(3002, 3144, 1), 'travel');
        await rec.seg('Thurgo: redberry pie', async () => {
            await talk(/thurgo/i, ['Would you like a redberry pie?']);
            return stage();
        }, 'dialogue');
        await rec.seg('Thurgo: can you make me a special sword?', async () => {
            await talk(/thurgo/i);
            return stage();
        }, 'dialogue');
    }
    if (FROM <= 2) {
        if (FROM === 2) { await setvar(sdk, 'squire', 4); await give(sdk, 'blurite_ore', 1); }
        await teleport('Falador teleport (2965,3378)', 2965, 3378);
        await rec.seg('walk to the squire', () => walk(2977, 3343, 1), 'travel');
        await rec.seg('squire: picture of the sword', async () => {
            await talk(/^squire$/i);
            return stage();
        }, 'dialogue');
        await rec.seg('walk to the castle ladder (2994,3341)', () => walk(2993, 3341, 0), 'travel');
        await rec.seg('ladder up, first-floor stairs up to Vyvin\'s floor', async () => {
            await climb(2994, 3341, /climb-up/i, s => s.player?.level === 1);
            await walk(2985, 3337, 1);
            await climb(2984, 3337, /climb-up/i, s => s.player?.level === 2);
            return `at ${JSON.stringify(pos(sdk))}`;
        }, 'interaction');
        await rec.seg('walk to Vyvin\'s cupboard (2984,3336)', () => walk(2985, 3336, 1), 'travel');
        await rec.seg('open + search cupboard: portrait', async () => {
            const vy = sdk.getState()!.nearbyNpcs.find(n => /vyvin/i.test(n.name));
            const note = `vyvin at ${vy?.x},${vy?.z}, me ${JSON.stringify(pos(sdk))}`;
            for (let attempt = 0; attempt < 12 && invCount(sdk, /portrait/i) === 0; attempt++) {
                if (sdk.getState()!.nearbyLocs.some(l => l.id === VYVIN_CUPBOARD_SHUT)) {
                    rec.interact();
                    await opLoc(sdk, { id: VYVIN_CUPBOARD_SHUT, x: 2984, z: 3336 }, 1, s => s.nearbyLocs.some(l => l.id === VYVIN_CUPBOARD_OPEN), { maxTicks: 10 });
                }
                rec.interact();
                await opLoc(sdk, { id: VYVIN_CUPBOARD_OPEN, x: 2984, z: 3336 }, 1, s => invCount(s, /portrait/i) > 0 || s.dialog.isOpen, { maxTicks: 10 });
                if (sdk.getState()!.dialog.isOpen) rec.dialogue(await converse(sdk, [], { idle: 2 }));
            }
            return `${note}; portrait=${invCount(sdk, /portrait/i)}`;
        }, 'interaction');
    }
    if (FROM <= 3) {
        if (FROM === 3) { await setvar(sdk, 'squire', 5); await give(sdk, ['knights_portrait', 'blurite_ore'], 1); }
        await teleport('Amulet of glory, Draynor Village (3105,3251)', 3105, 3251);
        await rec.seg('walk Draynor to Thurgo', () => walk(3002, 3144, 1), 'travel');
        await rec.seg('Thurgo: portrait', async () => {
            await talk(/thurgo/i);
            return stage();
        }, 'dialogue');
        await rec.seg('Thurgo: blurite + 2 iron bars, sword', async () => {
            await talk(/thurgo/i);
            return `sword=${invCount(sdk, /blurite sword/i)}`;
        }, 'dialogue');
    }
    if (FROM <= 4) {
        if (FROM === 4) { await setvar(sdk, 'squire', 6); await give(sdk, 'faladian_sword', 1); }
        await teleport('Falador teleport (2965,3378)', 2965, 3378);
        await rec.seg('walk to the squire', () => walk(2977, 3343, 1), 'travel');
        await rec.seg('squire: hand over the sword', async () => {
            await talk(/^squire$/i);
            await waitTicks(sdk, 2); // let the reward land before reading the stage
            return stage();
        }, 'dialogue');
        const s = sdk.getState()!;
        console.log('final', s.skills.filter(k => /smithing/i.test(k.name)).map(k => `${k.name} ${k.level} xp=${k.experience}`).join(', '));
    }
    console.log(`teleports used (cost from primitives.md): ${teleports.join('; ')}`);
    rec.report();
}, { timeout: 60 * 60_000 });
