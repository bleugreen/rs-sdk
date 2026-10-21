// Plague City: every segment, measured on a local server with the stock lite
// client. Each segment jumps the account to its stage with ::setvar elenaquest
// and ::tele, gives the items a helper would trade, then plays the real route,
// including the short walks between its steps.
//
//   bun docs/speedrun/scripts/quest-plague-city-segments.ts <bot> [segment...]
//
// Segments, in quest order:
//   start  Edmond (0->1), the picture, Alrena with dwellberries (1->2), Edmond (2->3)
//   cure   chocolate dust into milk, snape grass into chocolaty milk (hangover cure)
//   mud    four buckets of water on the mud patch (3->7), dig with the spade (7->8)
//   sewer  rope on the pipe (8->9), Edmond in the sewer (9->10), wear the gas mask, the pipe
//   west   Jethick (10->20), the Rehnisons (20->21->22), Milli (22->23), the plague
//          house door (23->24), the clerk (24->25)
//   bravek Bravek's door, Bravek twice (25->26->27)
//   rescue the warrant at the plague house door, the barrel key, the basement, Elena (27->28)
//   exit   back out through the manhole and the sewer, Edmond (28->29), read the scroll (29->30)
// With no segment names every segment runs. Run quest-primitives-setup.ts first.
//
// A step is one click and whatever dialogue it opens, answered as fast as the
// client allows; its ticks run from the click to the later of the dialogue
// closing and `done` first holding. Level-up pages are counted apart.

import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import type { BotActions } from '../../../sdk/actions';
import { actConverse, clickWalk, slotOf, talkTo, walkTo, wield, type ActResult } from '../../../speedrun/lib/act';
import type { OptionPattern } from '../../../speedrun/lib/dialogue';
import { currentTick, type Pred } from '../../../speedrun/lib/wait';
import { chebyshev, findLoc, findNpc, invCount, pos } from '../../../speedrun/lib/world';
import { Recorder, result, type Segment } from '../../../speedrun/lab/record';
import { dropMatching, ensureItem, getvar, mustTele, setvar } from '../../../speedrun/lab/setup';

const all = ['start', 'cure', 'mud', 'sewer', 'west', 'bravek', 'rescue', 'exit'];
const picked = process.argv.slice(3).filter(a => !a.startsWith('-'));
const segments = picked.length ? picked : all;

// Loc ids from server/content/pack/loc.pack; tiles from server/content/maps.
const LOC = {
    mudPatch: [2566, 3332, 2532],
    mudPile: [2561, 9738, 2533],
    pipe: [2530, 9701, 2541],
    manholeClosed: [2529, 3303, 2543],
    manholeOpen: [2529, 3303, 2544],
    rehnisonDoor: [2531, 3328, 2537],
    rehnisonStairs: [2527, 3332, 2539],
    plagueDoor: [2533, 3272, 2535],
    barrel: [2534, 3268, 2530],
    stairsDown: [2536, 3268, 2522],
    stairsUp: [2536, 9671, 2523],
    elenaDoor: [2539, 9672, 2526],
    bravekDoor: [2530, 3314, 2528],
} as const;

export interface StepOpts {
    choices?: OptionPattern[];
    /** Ticks the dialogue must stay closed before the step is over (raise it for scripts with p_delay gaps). */
    idle?: number;
    done?: Pred;
    maxTicks?: number;
}

/**
 * Record a generic action. actConverse owns retries, dialogue and the required
 * effect; this wrapper only translates its counts and timing to a lab row.
 * Effects latch on first observation. The idle grace window still answers
 * delayed pages, even when done already held when the click was sent.
 */
export async function step(rec: Recorder, sdk: BotSDK, label: string, click: () => Promise<unknown>, o: StepOpts = {}): Promise<Segment> {
    rec.begin(label);
    const r = await actConverse(sdk, click, o.choices ?? [], o);
    rec.interact(1 + r.resends);
    if (r.resends) rec.note(`click re-sent ${r.resends}x`);
    if (r.dialogue?.opened) rec.dialogue(r.dialogue);
    rec.mark(r.endTick);
    return rec.end(r.ok ? undefined : (r.reason ?? 'action failed'))!;
}

/** Talk to an NPC as one step (talkTo re-clicks when nothing opens). */
export async function talk(rec: Recorder, sdk: BotSDK, label: string, npc: RegExp, o: StepOpts = {}): Promise<Segment> {
    rec.begin(label);
    const r = await talkTo(sdk, npc, o.choices ?? [], { idle: o.idle ?? 3, until: o.done, maxTicks: o.maxTicks ?? 300, findTicks: 6 });
    rec.interact(r.clicks);
    rec.dialogue(r);
    if (!r.opened) rec.note('no dialogue opened');
    if (r.clicks > 1) rec.note(`${r.clicks} clicks`);
    if (!r.ok) rec.note(r.reason ?? 'dialogue failed');
    return rec.end()!;
}

/** One action measured by its own result (a wear, a teleport, a pickup): click to effect. */
export function timed(rec: Recorder, sdk: BotSDK, label: string, fn: () => Promise<ActResult>): Promise<Segment> {
    return rec.seg(label, async () => {
        const t0 = currentTick(sdk);
        const r = await fn();
        rec.interact(1 + r.resends);
        rec.mark(t0 + r.ticks);
        return r.ok ? undefined : (r.reason ?? 'failed');
    });
}

/** A run click to (x,z), re-clicked when it stops short; bot.walkTo finishes a walk a closed door blocks. */
export async function walk(rec: Recorder, sdk: BotSDK, bot: BotActions, label: string, x: number, z: number): Promise<Segment> {
    rec.begin(label, 'walk');
    const w = await clickWalk(sdk, x, z, { maxTicks: chebyshev(pos(sdk), { x, z }) + 10 });
    rec.interact(1 + w.resends);
    if (!w.ok) {
        // A run click cannot path through a closed door; bot.walkTo opens doors on the way.
        const f = await walkTo(bot, sdk, x, z, 0);
        rec.note(`finished with bot.walkTo (doors)${f.ok ? '' : ` ${f.message}`}`);
    }
    return rec.end()!;
}

/** Long walk with bot.walkTo (chained clicks); 0.57 ticks/tile per primitives.md. */
export async function longWalk(rec: Recorder, sdk: BotSDK, bot: BotActions, label: string, x: number, z: number): Promise<Segment> {
    rec.begin(label, 'walk');
    const w = await walkTo(bot, sdk, x, z, 1);
    rec.interact();
    return rec.end(w.ok ? undefined : w.message)!;
}

export const has = (re: RegExp): Pred => s => invCount(s, re) > 0;
export const atLevel = (level: number): Pred => s => pos(s).level === level;

if (import.meta.main) await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    const rec = new Recorder(sdk, 'Plague City segments');
    const varps: Record<string, unknown> = {};
    const setStage = (v: number) => setvar(sdk, 'elenaquest', v);
    const quest = async (label: string) => {
        varps[label] = await getvar(sdk, 'elenaquest');
        console.log(`  elenaquest after ${label}: ${varps[label]}`);
    };
    const S = (label: string, click: () => Promise<unknown>, o?: StepOpts) => step(rec, sdk, label, click, o);
    const T = (label: string, npc: RegExp, o?: StepOpts) => talk(rec, sdk, label, npc, o);
    const W = (label: string, x: number, z: number) => walk(rec, sdk, bot, label, x, z);
    const loc = (k: keyof typeof LOC, op = 1) => {
        const [x, z, id] = LOC[k];
        return () => sdk.sendInteractLoc(x, z, id, op);
    };
    // The slot is taken when the step starts, so a re-sent click never looks up a used-up item.
    const useOn = (item: RegExp, k: keyof typeof LOC) => {
        const slot = slotOf(sdk, item);
        const [x, z, id] = LOC[k];
        return () => sdk.sendUseItemOnLoc(slot, x, z, id);
    };
    const useOnItem = (a: RegExp, b: RegExp) => {
        const sa = slotOf(sdk, a);
        const sb = slotOf(sdk, b);
        return () => sdk.sendUseItemOnItem(sa, sb);
    };
    // Drop quest items left from earlier runs so each segment starts clean.
    await dropMatching(sdk, [/^(Picture|Book|Warrant|A small key|A scruffy note|Hangover cure|Dwellberries|Bucket|Bucket of water|Rope|Spade|Chocolaty milk|A magic scroll)$/i]);

    for (const seg of segments) {
        console.log(`\n-- ${seg}`);
        if (seg === 'start') {
            await setvar(sdk, 'biohazard', 0);
            await setStage(0);
            await dropMatching(sdk, [/^Gas mask$/i]);
            await mustTele(sdk, 2568, 3332);
            await T('Edmond: start (0->1)', /^Edmond$/, { choices: [/What's happened to her/, /Can I help find her/] });
            await quest('edmond1');
            await ensureItem(sdk, 'dwellberries', /^Dwellberries$/i);
            const pic = (await sdk.scanGroundItems(12)).find(g => /^Picture$/i.test(g.name));
            // bot.pickupItem walks next to the item (sendPickup alone does not route) and opens doors on the way.
            if (pic) await S('pick up the picture (2576,3334)', () => bot.pickupItem(pic), { done: has(/^Picture$/i), idle: 0 });
            else console.log('  picture not on the ground (already taken?)');
            await T('Alrena: dwellberries -> gas mask (1->2)', /^Alrena$/, { idle: 6, done: has(/^Gas mask$/i) });
            await quest('alrena');
            await T('Edmond: gas mask (2->3)', /^Edmond$/);
            await quest('edmond2');
        } else if (seg === 'cure') {
            await dropMatching(sdk, [/^(Chocolate dust|Bucket of milk|Snape grass|Chocolaty milk|Hangover cure)$/i]);
            await ensureItem(sdk, 'chocolate_dust', /^Chocolate dust$/i);
            await ensureItem(sdk, 'bucket_milk', /^Bucket of milk$/i);
            await ensureItem(sdk, 'snape_grass', /^Snape grass$/i);
            await S('chocolate dust on milk', useOnItem(/^Chocolate dust$/i, /^Bucket of milk$/i), { done: has(/^Chocolaty milk$/i) });
            await S('snape grass on chocolaty milk', useOnItem(/^Snape grass$/i, /^Chocolaty milk$/i), { done: has(/^Hangover cure$/i) });
        } else if (seg === 'mud') {
            await setStage(3);
            await ensureItem(sdk, 'bucket_water', /^Bucket of water$/i, 4);
            await ensureItem(sdk, 'spade', /^Spade$/i);
            await mustTele(sdk, 2567, 3332);
            for (let i = 1; i <= 4; i++) await S(`bucket of water on the mud patch #${i}`, useOn(/^Bucket of water$/i, 'mudPatch'));
            await quest('buckets');
            await S('dig the mud patch: fall into the sewer (7->8)', useOn(/^Spade$/i, 'mudPatch'), { done: s => pos(s).z > 9000 });
            varps.landed = pos(sdk);
            await quest('dig');
        } else if (seg === 'sewer') {
            await setStage(8);
            await ensureItem(sdk, 'rope', /^Rope$/i);
            await ensureItem(sdk, 'gasmask', /^Gas mask$/i);
            if (pos(sdk).z < 9000) await mustTele(sdk, 2561, 9737);
            await W('mud pile -> pipe', 2530, 9702);
            await S('rope on the pipe grill (8->9)', useOn(/^Rope$/i, 'pipe'));
            await quest('rope');
            await W('pipe -> Edmond', 2535, 9718);
            await T('Edmond in the sewer: pull the grill (9->10)', /^Edmond$/);
            await quest('edmondSewer');
            await W('Edmond -> pipe', 2530, 9702);
            console.log('  inventory before wearing:', sdk.getInventory().map(i => i.name).join(', '));
            await timed(rec, sdk, 'wear the gas mask', () => wield(sdk, /^Gas mask$/i, { maxTicks: 20 }));
            console.log('  equipment:', sdk.getEquipment().map(i => i.name).join(', '));
            await S('climb through the pipe to West Ardougne', loc('pipe'), { done: s => pos(s).z < 9000 });
            varps.westArrival = pos(sdk);
        } else if (seg === 'west') {
            await setStage(10);
            await ensureItem(sdk, 'elena_picture', /^Picture$/i);
            const p = pos(sdk);
            if (p.level !== 0 || p.x !== 2529 || p.z !== 3304) await mustTele(sdk, 2529, 3304);
            await W('manhole -> Jethick', 2539, 3305);
            await T('Jethick: picture -> book (10->20)', /^Jethick$/, { choices: [/looking for a woman from East Ardougne/] });
            await quest('jethick');
            await W('Jethick -> Rehnison door', 2531, 3327);
            await S('Rehnison door: return the book (20->21)', loc('rehnisonDoor'), { done: s => pos(s).z >= 3329 });
            await quest('rehnisonDoor');
            await T('Ted Rehnison (21->22)', /^Ted Rehnison$/);
            await quest('ted');
            await S('Rehnison stairs up', loc('rehnisonStairs'), { done: atLevel(1), idle: 0 });
            await T('Milli (22->23)', /^Milli/);
            await quest('milli');
            const top = await findLoc(sdk, { name: /stair/i, radius: 6 });
            if (!top) throw new Error('Rehnison stairs top not found');
            await S('Rehnison stairs down', () => sdk.sendInteractLoc(top.x, top.z, top.id, 1), { done: atLevel(0), idle: 0 });
            await S('Rehnison door (out)', loc('rehnisonDoor'), { done: s => pos(s).z <= 3328, idle: 0 });
            await W('Rehnison door -> plague house door', 2533, 3273);
            await S('plague house door: the mourner (23->24)', loc('plagueDoor'), { choices: [/I fear not a mere plague/] });
            await quest('plagueDoor');
            // A run click from the door tile right after the mourner's dialogue does not move the bot; bot.walkTo does.
            // Stand east of the clerk: the stage only advances if Bravek (2536,3314) is within 7 tiles
            // of the player (clerk.rs2 .npc_find(coord, bravek, 7, 0)); from x=2528 he is 8 away.
            await longWalk(rec, sdk, bot, 'plague house -> clerk (bot.walkTo)', 2529, 3316);
            const bravekNpc = findNpc(sdk, /^Bravek$/);
            console.log(`  before clerk: player ${JSON.stringify(pos(sdk))}, Bravek ${bravekNpc ? `${bravekNpc.x},${bravekNpc.z}` : 'not seen'}`);
            await T('clerk (24->25)', /^Clerk$/, { choices: [/I need permission to enter a plague house/, /This is urgent though/] });
            await quest('clerk');
        } else if (seg === 'clerk') {
            await setStage(24);
            await mustTele(sdk, 2529, 3316);
            await sdk.waitForTicks(2);
            // The stage only advances if Bravek is within 7 tiles of the player when the clerk's
            // last page runs (clerk.rs2 .npc_find(coord, bravek, 7, 0)). Bravek wanders around
            // (2536,3314) and the player cannot stand east of x=2529, so measure the hit rate.
            const tries = Number(process.env.CLERK_TRIES ?? 8);
            const where = () => {
                const b = findNpc(sdk, /^Bravek$/);
                return b ? `${b.x},${b.z}` : 'not seen';
            };
            for (let i = 1; i <= tries; i++) {
                await setStage(24);
                const before = where();
                await T(`clerk try ${i} (24->25)`, /^Clerk$/, { choices: [/I need permission to enter a plague house/, /This is urgent though/] });
                const v = await getvar(sdk, 'elenaquest');
                console.log(`  clerk try ${i}: Bravek ${before} -> ${where()}, stage ${v}`);
                varps[`clerk${i}`] = { before, after: where(), stage: v };
            }
        } else if (seg === 'bravek') {
            await setStage(25);
            await ensureItem(sdk, 'hangover_cure', /^Hangover cure$/i);
            if (Math.abs(pos(sdk).x - 2528) > 3 || Math.abs(pos(sdk).z - 3316) > 3) await mustTele(sdk, 2528, 3316);
            await S('Bravek door', loc('bravekDoor'), { done: s => pos(s).x >= 2530, idle: 0 });
            await W('door -> Bravek', 2535, 3314);
            await T('Bravek: the note (25->26)', /^Bravek$/, { choices: [/This is really important though/, /Do you know what is in the cure/] });
            await quest('bravek1');
            await T('Bravek: hangover cure -> warrant (26->27)', /^Bravek$/, { choices: [/They won't listen to me/] });
            await quest('bravek2');
        } else if (seg === 'rescue') {
            await setStage(27);
            await ensureItem(sdk, 'warrant', /^Warrant$/i);
            await dropMatching(sdk, [/^A small key$/i]);
            await mustTele(sdk, 2533, 3273);
            await S('plague house door with the warrant', loc('plagueDoor'), { done: s => pos(s).z <= 3271 });
            await W('door -> barrel', 2534, 3269);
            await S('search the barrel: key', loc('barrel'), { done: has(/^A small key$/i) });
            await S('stairs down to the basement', loc('stairsDown'), { done: s => pos(s).z > 9000, idle: 0 });
            await W('basement -> Elena door', 2539, 9672);
            await S('unlock the Elena door', loc('elenaDoor'), { done: s => pos(s).x >= 2540 });
            await T('Elena (27->28)', /^Elena$/);
            await quest('elena');
        } else if (seg === 'exit') {
            await setStage(28);
            if (pos(sdk).z < 9000) await mustTele(sdk, 2540, 9672);
            await S('Elena door, back out', loc('elenaDoor'), { done: s => pos(s).x <= 2539, idle: 0 });
            await S('basement stairs up', loc('stairsUp'), { done: s => pos(s).z < 9000, idle: 0 });
            await S('plague house door, out', loc('plagueDoor'), { done: s => pos(s).z >= 3272, idle: 0 });
            await W('plague house -> manhole', 2529, 3304);
            await S('open the manhole', loc('manholeClosed'), { done: s => s.nearbyLocs.some(l => l.x === 2529 && l.z === 3303 && l.id === 2544), idle: 0 });
            await S('climb down the manhole', loc('manholeOpen'), { done: s => pos(s).z > 9000, idle: 0 });
            await W('sewer -> mud pile', 2561, 9737);
            await S('climb the mud pile', loc('mudPile'), { done: s => pos(s).z < 9000, idle: 0 });
            await W('garden -> Edmond', 2567, 3333);
            await T('Edmond: reward (28->29)', /^Edmond$/, { idle: 4, done: has(/^A magic scroll$/i) });
            await sdk.waitForTicks(2);
            if (sdk.getState()!.modalOpen) await S('close the quest-complete scroll', () => sdk.sendCloseModal(), { done: s => !s.modalOpen, idle: 0 });
            await quest('edmondReward');
            const scroll = slotOf(sdk, /^A magic scroll$/i);
            await S('read the magic scroll (29->30)', () => sdk.sendUseItem(scroll, 1));
            await quest('scroll');
        }
    }
    rec.report();
    result('plague-city-varps', varps);
}, { timeout: 1_800_000, printState: false });
