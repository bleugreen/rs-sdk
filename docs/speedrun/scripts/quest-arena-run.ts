// Fight Arena, end to end, as tick-stamped segments (docs/speedrun/quests/fight_arena.md).
//
//   bun docs/speedrun/scripts/quest-arena-run.ts <bot> [--stats 70] [--general yes|no] [--from 0|3|5|9]
//       [--att N --str N --def N --hp N] [--prayer N --pray yes --ppots N] [--magic N --spell fire_bolt|fire_blast]
//
// --att/--str/--def/--hp override --stats per skill (route-level runs,
// docs/speedrun/quests/pre_mm_fights.md). --pray yes keeps Protect from Melee on
// during each fight (Prayer --prayer, default 43, with --ppots Prayer potion(4)s).
// --spell casts that spell at the three monsters instead of meleeing, with a
// staff of fire and amulet of magic (Magic --magic, default 51). Rune armour is
// only worn at base Defence 40+ (its wield requirement).
//
// Starts next to Lady Servil with helper-supplied gear (rune scimitar, rune
// kiteshield, rune platelegs, amulet of power, 20 swordfish, 10 coins) and
// melee stats set to --stats. --from 5 jumps to the cell-keys stage
// (::setvar arenaquest 5, keys and Khazard armour given) and starts at Jeremy,
// which isolates the fight chain. --general yes also kills General Khazard,
// which the quest does not require (lady_servil.rs2:8-13 pays out at stage 12).
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';
import { opLoc, talkTo, walkTo, wield } from '../../../speedrun/lib/act';
import { fight, type FightOptions } from '../../../speedrun/lib/combat';
import { converse, type ConverseOptions } from '../../../speedrun/lib/converse';
import type { OptionPattern } from '../../../speedrun/lib/dialogue';
import { currentTick, waitTicks, waitUntil, type Pred } from '../../../speedrun/lib/wait';
import { at, invCount, pos, type NamePattern } from '../../../speedrun/lib/world';
import { Recorder } from '../../../speedrun/lab/record';
import { clearInventory, getvar, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';

function arg(name: string, dflt: string): string {
    const i = process.argv.indexOf('--' + name);
    return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : dflt;
}

/** True while the player stands inside the inclusive box on `level`. */
function inBox(s: BotWorldState, x0: number, z0: number, x1: number, z1: number, level = 0): boolean {
    const p = s.player;
    return !!p && p.level === level && p.worldX >= x0 && p.worldX <= x1 && p.worldZ >= z0 && p.worldZ <= z1;
}

const STATS = Number(arg('stats', '70'));
const stat = (k: string) => Number(arg(k, String(STATS)));
const ATT = stat('att'), STR = stat('str'), DEF = stat('def'), HP = stat('hp');
const PRAY = arg('pray', 'no') === 'yes';
const PRAYER = Number(arg('prayer', PRAY ? '43' : '1'));
const PPOTS = Number(arg('ppots', '0'));
const MAGIC = Number(arg('magic', '51'));
const SPELL = ({ fire_bolt: 1169, fire_blast: 1181 } as Record<string, number>)[arg('spell', '')];
const GENERAL = arg('general', 'no') === 'yes';
const FROM = Number(arg('from', '0'));
const FOOD = /swordfish/i;
const EAT_AT = Math.max(Math.min(12, HP - 3), Math.floor(HP * 0.45));
// Eat at EAT_AT hp or below. A quest page that opens mid-fight ends the fight
// (onDialog 'stop'); the next segment drives it.
const FIGHT: FightOptions = {
    food: FOOD, eatBelow: EAT_AT + 1, maxTicks: 3000, findTicks: 30,
    ...(SPELL ? { spell: SPELL } : {}), ...(PRAY ? { prayer: 'protect_from_melee' as const } : {}),
};

// loc ids from server/content/pack/loc.pack, tiles from the maps
const CHEST_SHUT = 75, CHEST_OPEN = 76;
const DOOR1 = 81, DOOR2 = 82;

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial?.();
    const rec = new Recorder(sdk, `Fight Arena (${ATT}/${STR}/${DEF}, ${HP} hp, prayer ${PRAY ? PRAYER : 'off'}, ${SPELL ? `spell ${arg('spell', '')} at Magic ${MAGIC}` : 'melee'}, general=${GENERAL}, from=${FROM})`);
    const stage = async () => `stage ${await getvar(sdk, 'arenaquest')}`;
    const walk = async (x: number, z: number, tol: number) => {
        const r = await walkTo(bot, sdk, x, z, tol);
        if (!r.ok) throw new Error(`walk to ${x},${z} failed: ${r.message}`);
    };
    const talk = async (npc: NamePattern, choices: OptionPattern[] = [], until?: Pred) => {
        const r = await talkTo(sdk, npc, choices, until ? { until } : {});
        rec.interact(r.clicks);
        if (!r.opened) throw new Error(`no dialogue opened for ${String(npc)}`);
        if (!r.ok) throw new Error(`dialogue with ${String(npc)}: ${r.reason}`);
        rec.dialogue(r);
    };
    const drive = async (opts: ConverseOptions) => {
        const r = await converse(sdk, [], opts);
        if (!r.ok) throw new Error(`dialogue did not finish: ${r.reason}; at ${JSON.stringify(pos(sdk))}`);
        rec.dialogue(r);
    };
    const loc = async (id: number, x: number, z: number, done: Pred, maxTicks: number) => {
        rec.interact();
        return opLoc(sdk, { id, x, z }, 1, done, { maxTicks });
    };
    const wear = async (re: RegExp) => {
        if (!(await wield(sdk, re)).ok) throw new Error('could not wear ' + re);
    };
    const fightSeg = (name: string, target: RegExp, o: FightOptions) => rec.seg(name, async () => {
        const r = await fight(sdk, target, o);
        rec.interact(r.attacks);
        if (r.end === 'timeout' || r.end === 'no target') throw new Error(`fight with ${target} did not end: ${JSON.stringify(r)}`);
        return JSON.stringify(r);
    }, 'fight');

    await bot.deactivateAllPrayers().catch(() => {}); // a prayer left on by an earlier script would drain through the cutscenes
    const weapons: [string, number][] = SPELL ? [['staff_of_fire', 1], ['amulet_of_magic', 1], ['chaosrune', 300], ['deathrune', 300], ['airrune', 2000]] : [['rune_scimitar', 1], ['amulet_of_power', 1]];
    const armour: [string, number][] = DEF >= 40 ? [['rune_kiteshield', 1], ['rune_platelegs', 1]] : [];
    await clearInventory(sdk);
    await setStats(sdk, { attack: ATT, strength: STR, defence: DEF, hitpoints: HP, thieving: 1, prayer: PRAYER, magic: MAGIC });
    // 28 slots: leave room for the Khazard helmet, armour and cell keys given at --from 3/5
    for (const [obj, n] of [...weapons, ...armour, ['coins', 10], ['swordfish', Math.min(20, 22 - weapons.length - armour.length - PPOTS)], ...(PPOTS ? [['4doseprayerrestore', PPOTS]] : [])] as [string, number][]) await give(sdk, obj, n);
    for (const re of [...(SPELL ? [/staff of fire/i, /amulet of magic/i] : [/rune scimitar/i, /amulet of power/i]), ...(DEF >= 40 ? [/rune kiteshield/i, /rune platelegs/i] : [])]) await wear(re);
    console.log('worn:', sdk.getState()!.equipment.map(e => e.name).join(', '), '| style:', JSON.stringify(sdk.getState()!.combatStyle));

    if (FROM === 0) {
        await setvar(sdk, 'arenaquest', 0);
        await mustTele(sdk, 2567, 3197);
        await rec.seg('Lady Servil: start', async () => {
            await talk(/lady servil/i, ['Can I help you?']);
            return stage();
        }, 'dialogue');
        await rec.seg('walk to guard chest (2613,3189)', async () => {
            await walk(2613, 3188, 1);
        }, 'travel');
        await rec.seg('open + search chest, wear helm + armour', async () => {
            await loc(CHEST_SHUT, 2613, 3189, s => s.nearbyLocs.some(l => l.id === CHEST_OPEN && l.x === 2613 && l.z === 3189), 20);
            await loc(CHEST_OPEN, 2613, 3189, s => s.inventory.some(i => /khazard armour/i.test(i.name)) || s.dialog.isOpen, 20);
            await drive({ idle: 2, openTicks: 2 });
            await wear(/khazard helmet/i); rec.interact();
            await wear(/khazard armour/i); rec.interact();
            return stage();
        }, 'interaction');
        await rec.seg('walk to north prison door (2617,3171)', async () => {
            await walk(2617, 3173, 0);
        }, 'travel');
        await rec.seg('north prison door (guard lets you in)', async () => {
            await loc(DOOR1, 2617, 3171, s => s.dialog.isOpen || (s.player?.worldZ ?? 9999) < 3171, 20);
            await drive({ idle: 2, openTicks: 2 });
            await waitUntil(sdk, s => (s.player?.worldZ ?? 9999) < 3171, { maxTicks: 10 });
        }, 'interaction');
        await rec.seg('walk to drunk guard (2615,3141)', async () => {
            await walk(2616, 3142, 1);
        }, 'travel');
        await rec.seg('drunk guard: first talk', async () => {
            await talk(254);
            return stage();
        }, 'dialogue');
    }
    if (FROM === 3) {
        await give(sdk, ['khazard_helmet', 'khazard_platemail']);
        await wear(/khazard helmet/i);
        await wear(/khazard armour/i);
        await mustTele(sdk, 2616, 3142);
        await setvar(sdk, 'arenaquest', 3);
    }
    if (FROM <= 3) {
        await rec.seg('walk to west prison door (2585,3141)', async () => {
            await walk(2585, 3141, 0);
        }, 'travel');
        await rec.seg('west prison door, out', async () => {
            await loc(DOOR1, 2585, 3141, s => (s.player?.worldX ?? 0) < 2585, 10);
        }, 'interaction');
        await rec.seg('walk to barman (2566,3140)', async () => {
            await walk(2567, 3140, 1);
        }, 'travel');
        await rec.seg('barman: buy Khali brew', async () => {
            await talk(/khazard barman/i, [/khali brew/i]);
            return `brew=${invCount(sdk, /khali brew/i)}`;
        }, 'dialogue');
        await rec.seg('walk back to west prison door', async () => {
            await walk(2583, 3141, 0);
        }, 'travel');
        await rec.seg('west prison door, in (guard lets you in)', async () => {
            await loc(DOOR1, 2585, 3141, s => s.dialog.isOpen || (s.player?.worldX ?? 0) >= 2585, 20);
            await drive({ idle: 2, openTicks: 2 });
            await waitUntil(sdk, s => (s.player?.worldX ?? 0) >= 2585, { maxTicks: 10 });
        }, 'interaction');
        await rec.seg('walk back to drunk guard', async () => {
            await walk(2616, 3142, 1);
        }, 'travel');
        await rec.seg('drunk guard: give brew, get keys', async () => {
            await talk(254);
            return `${await stage()} keys=${invCount(sdk, /keys/i)}`;
        }, 'dialogue');
        await rec.seg('walk to Jeremy (2616,3168)', async () => {
            await walk(2618, 3167, 0);
        }, 'travel');
    } else if (FROM >= 5) {
        await give(sdk, ['khazard_helmet', 'khazard_platemail', 'khazard_cellkeys']);
        await wear(/khazard helmet/i);
        await wear(/khazard armour/i);
        await mustTele(sdk, 2618, 3167);
        await setvar(sdk, 'arenaquest', 5);
    }

    // ---- the fight chain: everything from the keys to stage 12 ----
    const chainStart = currentTick(sdk);
    const inArena: Pred = s => inBox(s, 2581, 3151, 2606, 3171);
    if (FROM === 9) {
        await mustTele(sdk, 2600, 3142);
        await setvar(sdk, 'arenaquest', 9);
    }
    if (FROM < 9) await rec.seg('Jeremy: free him, cutscene into the arena', async () => {
        await talk(/jeremy servil/i, [], inArena);
        return `${await stage()} at ${JSON.stringify(pos(sdk))}`;
    }, 'mixed');
    if (FROM < 9) await fightSeg('fight: Khazard ogre', /khazard ogre/i, FIGHT);
    if (FROM < 9) await rec.seg('ogre dead: General dialogue + cell cutscene', async () => {
        await drive({ idle: 10, openTicks: 20, until: at(2600, 3142) });
        return `${await stage()} at ${JSON.stringify(pos(sdk))}`;
    }, 'mixed');
    await rec.seg('Hengrad: talk, guard escorts you to the arena', async () => {
        await talk(/hengrad/i, [], inArena);
        return `at ${JSON.stringify(pos(sdk))}`;
    }, 'mixed');
    await fightSeg('fight: Khazard scorpion', /khazard scorpion/i, FIGHT);
    await rec.seg('scorpion dead: General summons Bouncer', async () => {
        await drive({ idle: 3, openTicks: 20 });
        return stage();
    }, 'mixed');
    await fightSeg('fight: Bouncer', /bouncer/i, FIGHT);
    if (PRAY) await sdk.sendTogglePrayer('protect_from_melee').catch(() => {});
    await rec.seg('Bouncer dead: General frees the Servils', async () => {
        await drive({ idle: 2, openTicks: 20 });
        return stage();
    }, 'mixed');
    if (GENERAL) await fightSeg('fight: General Khazard (optional)', /general khazard/i, { food: FOOD, eatBelow: EAT_AT + 1, maxTicks: 1500, findTicks: 30 });
    console.log(`fight chain (keys to stage 12${GENERAL ? ' + General' : ''}): ${currentTick(sdk) - chainStart} ticks`);

    await rec.seg('walk to arena door (2606,3152)', async () => {
        await walk(2605, 3153, 0);
    }, 'travel');
    await rec.seg('arena door, out', async () => {
        await loc(DOOR2, 2606, 3152, s => (s.player?.worldX ?? 0) >= 2607, 10);
    }, 'interaction');
    await rec.seg('walk to west prison door (2585,3141)', async () => {
        await walk(2586, 3141, 0);
    }, 'travel');
    await rec.seg('west prison door, out', async () => {
        await loc(DOOR1, 2585, 3141, s => (s.player?.worldX ?? 9999) < 2585, 10);
    }, 'interaction');
    await rec.seg('walk to Lady Servil', async () => {
        await walk(2567, 3197, 1);
    }, 'travel');
    await rec.seg('Lady Servil: reward', async () => {
        await talk(/lady servil/i);
        await waitTicks(sdk, 2); // let the reward land before reading the stage
        return stage();
    }, 'dialogue');
    const s = sdk.getState()!;
    console.log('final skills', s.skills.filter(k => /attack|thieving/i.test(k.name)).map(k => `${k.name} ${k.level} xp=${k.experience}`).join(', '));
    console.log(`hp ${s.player?.hp}/${s.player?.maxHp}, swordfish left ${invCount(sdk, FOOD)}`);
    rec.report();
}, { timeout: 60 * 60_000 });
