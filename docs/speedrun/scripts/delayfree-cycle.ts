// Delay-free helper-fed skills (rs/37): actions per tick and the bank cycle, end to end.
//
//   bun docs/speedrun/scripts/delayfree-cycle.ts <bot> --skill=herblore|crafting|kebab|battlestaff|fletching
//       [--mode=fast|stock] [--route=a,b,c | --recipe=x] [--level=N] [--until=99] [--cycles=N]
//       [--k=5] [--tag=x]
//
// The bot stands at Varrock west bank with the helpers' supplies already in its bank
// (deposited as banknotes during setup) and trains from --level to --until.
//
//   --mode=fast   one burst per observed tick, sent without waiting (fire-and-forget SDK
//                 calls; the lite runner writes one queued action every 20 ms, so a burst
//                 of 5 lands in one 300 ms server tick). Item actions: up to --k per tick.
//                 Bank visit: open-booth click in the same burst as the last item actions;
//                 on the tick the bank is seen open, withdraw-All B (fills the 14 free
//                 slots), deposit-All the product, withdraw-All A, close; item actions
//                 resume on the next tick, when the client sees the new inventory.
//   --mode=stock  the stock SDK porcelain: bot.openBank / bot.depositItem /
//                 bot.withdrawItem / bot.closeBank, then one awaited
//                 sdk.sendUseItemOnItem per action, each followed by waiting for the
//                 inventory to change (the SDK's read-then-act contract).
//
// Recipes are chosen per level from --route (the best recipe the current level allows).
// Pair recipes (herblore, battlestaff, kebab) hold 14 A in slots 0-13 and 14 B in
// slots 14-27; action i uses B@14+i on A@i. The content deletes the first matching
// item and adds the product to the first free slot, so the product lands in slot i
// (brew_potion herblore.rs2:10-24, craft_staff battlestaves.rs2:32-38; the kebab puts
// the bowl in slot i and the kebab in slot 14+i, ugthanki_kebab.rs2:121-132).
// Tool recipes (gems) hold the chisel in slot 0 and 27 uncut gems in 1-27.
// Fletching (arrows) is stackable: no bank.
//
// Every observed tick is logged with the xp gained and the packets sent (--log, default
// $TMPDIR/delayfree-<skill>-<mode>.log); the summary goes to stdout. Observed tick t is
// the lite client's count of server ticks; xp from server tick R is first seen at R+1.
import { runScript } from '../../../sdk/runner';
import type { BotWorldState, InventoryItem } from '../../../sdk/types';
import { appendFileSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const args: Record<string, string> = Object.fromEntries(
    process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
        const [key, ...v] = a.slice(2).split('=');
        return [key, v.length ? v.join('=') : 'true'];
    })
);
const SKILL_ARG = args.skill ?? 'herblore';
const MODE = args.mode ?? 'fast';
const K = Number(args.k ?? 5);
const UNTIL = Number(args.until ?? 99);
const MAX_CYCLES = Number(args.cycles ?? 1e9);
const TAG = `${SKILL_ARG}-${MODE}${args.tag ? '-' + args.tag : ''}`;
const LOG = args.log ?? `${process.env.LAB_LOG ?? process.env.TMPDIR ?? '/tmp'}/delayfree-${TAG}.log`;
writeFileSync(LOG, `# delayfree-cycle ${process.argv.slice(2).join(' ')} NODE_TICKRATE=${process.env.NODE_TICKRATE ?? '?'}\n`);
const log = (line: string) => appendFileSync(LOG, line + '\n');

// ---- item ids from the content pack (id=debugname per line) ----
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const OBJ: Record<string, number> = {};
for (const line of readFileSync(join(ROOT, 'server/content/pack/obj.pack'), 'utf8').split('\n')) {
    const m = line.match(/^(\d+)=(\S+)/);
    if (m) OBJ[m[2]!] = Number(m[1]);
}
const id = (name: string) => {
    const v = OBJ[name];
    if (v === undefined) throw new Error(`unknown obj ${name}`);
    return v;
};

// ---- level table (server/engine/src/engine/entity/Player.ts:77-85), in game xp ----
const LEVEL_XP: number[] = []; // LEVEL_XP[L] = game xp needed for level L
{
    let acc = 0;
    LEVEL_XP[1] = 0;
    for (let i = 0; i < 98; i++) {
        const level = i + 1;
        acc += Math.floor(level + Math.pow(2, level / 10) * 300);
        LEVEL_XP[i + 2] = Math.floor(acc / 4);
    }
}
const levelOf = (xp: number) => { let l = 1; while (l < 99 && xp >= LEVEL_XP[l + 1]!) l++; return l; };

// ---- recipes (base xp per action, read) ----
interface Recipe {
    name: string;
    skill: string;
    level: number;
    xp: number; // base xp per successful action
    a: string; // debugname, slots 0-13 (pair) or 1-27 (tool)
    b?: string; // pair partner, slots 14-27
    tool?: string; // stays in slot 0
    products: string[]; // everything the action leaves behind (deposited each visit)
    stack?: boolean; // stackable, no bank (arrows)
}
const H = (name: string, level: number, xp: number, a: string, b: string, product: string): Recipe =>
    ({ name, skill: 'herblore', level, xp, a, b, products: [product] });
const RECIPES: Recipe[] = [
    // brew_potion.struct (level, exp in tenths)
    H('attack', 1, 25, 'guamvial', 'eye_of_newt', '3dose1attack'),
    H('antipoison', 5, 37.5, 'marrentillvial', 'unicorn_horn_dust', '3doseantipoison'),
    H('strength', 12, 50, 'tarrominvial', 'limpwurt_root', '3dose1strength'),
    H('restore', 22, 62.5, 'harralandervial', 'red_spiders_eggs', '3dosestatrestore'),
    H('energy', 26, 67.5, 'harralandervial', 'chocolate_dust', '3dose1energy'),
    H('defence', 30, 75, 'ranarrvial', 'white_berries', '3dose1defense'),
    H('agility', 34, 80, 'toadflaxvial', 'toads_legs', '3dose1agility'),
    H('prayer', 38, 87.5, 'ranarrvial', 'snape_grass', '3doseprayerrestore'),
    H('superattack', 45, 100, 'iritvial', 'eye_of_newt', '3dose2attack'),
    H('fishing', 50, 112.5, 'avantoevial', 'snape_grass', '3dosefisherspotion'),
    H('superenergy', 52, 117.5, 'avantoevial', 'mortmyremushroom', '3dose2energy'),
    H('superstrength', 55, 125, 'kwuarmvial', 'limpwurt_root', '3dose2strength'),
    H('weaponpoison', 60, 137.5, 'kwuarmvial', 'dragon_scale_dust', 'weapon_poison'),
    H('superrestore', 63, 142.5, 'snapdragonvial', 'red_spiders_eggs', '3dose2restore'),
    H('superdefence', 66, 150, 'cadantinevial', 'white_berries', '3dose2defense'),
    H('antifire', 69, 157.5, 'lantadymevial', 'dragon_scale_dust', '3dose1antidragon'),
    H('ranging', 72, 162.5, 'dwarfweedvial', 'wine_of_zamorak', '3doserangerspotion'),
    H('magic', 76, 172.5, 'lantadymevial', 'cactus_potato', '3dose1magic'),
    H('zamorak', 78, 175, 'torstolvial', 'jangerberries', '3dosepotionofzamorak'),
    // gem.dbrow; opal/jade/red topaz can smash (stat_random), leaving crushed_gemstone
    { name: 'opal', skill: 'crafting', level: 1, xp: 15, a: 'uncut_opal', tool: 'chisel', products: ['opal', 'crushed_gemstone'] },
    { name: 'sapphire', skill: 'crafting', level: 20, xp: 50, a: 'uncut_sapphire', tool: 'chisel', products: ['sapphire'] },
    { name: 'emerald', skill: 'crafting', level: 27, xp: 67.5, a: 'uncut_emerald', tool: 'chisel', products: ['emerald'] },
    { name: 'ruby', skill: 'crafting', level: 34, xp: 85, a: 'uncut_ruby', tool: 'chisel', products: ['ruby'] },
    { name: 'diamond', skill: 'crafting', level: 43, xp: 107.5, a: 'uncut_diamond', tool: 'chisel', products: ['diamond'] },
    { name: 'dragonstone', skill: 'crafting', level: 55, xp: 137.5, a: 'uncut_dragonstone', tool: 'chisel', products: ['dragonstone'] },
    // battlestaves.struct
    { name: 'waterstaff', skill: 'crafting', level: 54, xp: 100, a: 'battlestaff', b: 'water_orb', products: ['water_battlestaff'] },
    { name: 'earthstaff', skill: 'crafting', level: 58, xp: 112.5, a: 'battlestaff', b: 'earth_orb', products: ['earth_battlestaff'] },
    { name: 'firestaff', skill: 'crafting', level: 62, xp: 125, a: 'battlestaff', b: 'fire_orb', products: ['fire_battlestaff'] },
    { name: 'airstaff', skill: 'crafting', level: 66, xp: 137.5, a: 'battlestaff', b: 'air_orb', products: ['air_battlestaff'] },
    // ugthanki_kebab.rs2:116-135: no level gate, stat_random(cooking, 118, 492)
    { name: 'kebab', skill: 'cooking', level: 1, xp: 120, a: 'bowl_oniontomugthanki', b: 'pitta_bread', products: ['ugthanki_kebab', 'ugthanki_kebab_bad', 'bowl_empty'] },
    // arrows.dbrow: 15 per action
    ...([['bronze', 1, 1.3], ['iron', 15, 2.5], ['steel', 30, 5], ['mithril', 45, 7.5], ['adamant', 60, 10], ['rune', 75, 12.5]] as const)
        .map(([m, level, each]) => ({ name: `${m}arrow`, skill: 'fletching', level, xp: each * 15, a: 'headless_arrow', b: `${m}_arrowheads`, products: [`${m}_arrow`], stack: true }))
];
const DEFAULT_ROUTE: Record<string, string> = {
    herblore: 'superdefence,ranging,zamorak',
    crafting: 'dragonstone',
    battlestaff: 'airstaff',
    kebab: 'kebab',
    fletching: 'runearrow'
};
const routeNames = (args.recipe ?? args.route ?? DEFAULT_ROUTE[SKILL_ARG] ?? '').split(',').filter(Boolean);
const route = routeNames.map(n => {
    const r = RECIPES.find(x => x.name === n);
    if (!r) throw new Error(`unknown recipe ${n}`);
    return r;
}).sort((x, y) => x.level - y.level);
if (!route.length) throw new Error('empty route');
const SKILL = route[0]!.skill;
const START_LEVEL = Number(args.level ?? route[0]!.level);
const pick = (level: number) => [...route].reverse().find(r => r.level <= level) ?? route[0]!;
const PAIR = 14;
const perInv = (r: Recipe) => (r.tool ? 27 : PAIR);

// Actions needed per recipe for START_LEVEL -> UNTIL, plus one spare inventory each.
function supplyPlan(): Map<Recipe, number> {
    const need = new Map<Recipe, number>();
    let xp = LEVEL_XP[START_LEVEL]!;
    const goal = LEVEL_XP[UNTIL]!;
    while (xp < goal) {
        const r = pick(levelOf(xp));
        need.set(r, (need.get(r) ?? 0) + 1);
        xp += r.xp * 25;
    }
    for (const [r, n] of need) need.set(r, (Math.ceil(n / perInv(r)) + 2) * perInv(r));
    return need;
}

const xpOf = (s: BotWorldState) => s.skills.find(k => k.name.toLowerCase() === SKILL)?.experience ?? 0;
const invAt = (s: BotWorldState, slot: number) => s.inventory.find(i => i.slot === slot);
const bankSlot = (s: BotWorldState, obj: string) => s.bank.items.find(i => i.id === id(obj) && i.count > 0)?.slot;

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial?.();
    await sdk.waitForTicks(2);
    // ---- setup (not timed) ----
    for (const st of ['attack', 'strength', 'defence', 'hitpoints']) await sdk.sendSay(`::setstat ${st} 99`);
    await sdk.sendSay(`::setstat ${SKILL} ${START_LEVEL}`);
    for (let attempt = 0; attempt < 5; attempt++) {
        await sdk.sendSay('::tele 0,49,53,49,44'); // Varrock west bank (3185,3436)
        await sdk.waitForTicks(4);
        const p = sdk.getState()?.player;
        if (p && Math.abs(p.worldX - 3185) <= 2 && Math.abs(p.worldZ - 3436) <= 2) break;
    }
    const plan = supplyPlan();
    console.log(`plan ${SKILL} ${START_LEVEL}->${UNTIL}: ${[...plan].map(([r, n]) => `${r.name} x${n}`).join(', ')}`);
    const opened = await bot.openBank();
    if (!opened.success) throw new Error(`openBank: ${opened.message}`);
    for (const it of [...(sdk.getState()?.inventory ?? [])]) await bot.depositItem(it, -1);
    await bot.closeBank();
    for (const [r, n] of plan) {
        for (const obj of [r.a, r.b].filter(Boolean) as string[]) {
            await sdk.sendSay(`::give ${r.stack ? obj : 'cert_' + obj} ${n * (r.stack ? 15 : 1)}`);
            await sdk.waitForTicks(2);
            if (r.stack) continue;
            await bot.openBank();
            const cert = sdk.getState()!.inventory.find(i => i.id === id('cert_' + obj));
            if (cert) await bot.depositItem(cert, -1);
            await bot.closeBank();
        }
        if (r.tool && !sdk.getState()!.inventory.some(i => i.id === id(r.tool!))) await sdk.sendSay(`::give ${r.tool} 1`);
    }
    await sdk.waitForTicks(3);
    // Remember the booth and bank tile; every later visit is one click on this booth.
    // Same option preference as bot.openBank (sdk/actions.ts _openBankOnce).
    const BANK_OP = [/^bank$/i, /use.quickly/i, /^use$/i];
    const bankOpOf = (l: { optionsWithIndex: Array<{ text: string; opIndex: number }> }) =>
        BANK_OP.map(re => l.optionsWithIndex.find(o => re.test(o.text))).find(Boolean);
    let booth = { x: 0, z: 0, id: 0 };
    let boothOp = 0;
    if (!pick(START_LEVEL).stack) {
        await bot.openBank();
        const b = sdk.getState()!.nearbyLocs
            .filter(l => /bank/i.test(l.name) && bankOpOf(l))
            .sort((a, b) => a.distance - b.distance)[0];
        if (!b) throw new Error(`no booth among ${sdk.getState()!.nearbyLocs.slice(0, 8).map(l => `${l.name}[${l.optionsWithIndex.map(o => o.text)}]`).join(' ')}`);
        booth = b;
        boothOp = bankOpOf(b)!.opIndex;
        await bot.closeBank();
    }
    for (let d = 0; d < 3 && sdk.getState()?.dialog?.isOpen; d++) { await sdk.sendClickDialog(0); await sdk.waitForTicks(1); }
    const p0 = sdk.getState()!.player!;
    console.log(`setup done at ${p0.worldX},${p0.worldZ}; booth ${booth.id}@${booth.x},${booth.z} op${boothOp}; bank ${sdk.getState()!.bank.items.length} stacks`);

    // ---- measured run ----
    const start = sdk.getState()!;
    const t0 = start.tick;
    const xp0 = xpOf(start);
    let lastXp = xp0;
    const actPerTick: number[] = []; // per observed tick in the run: actions landed (from xp)
    const cycles: Array<{ open: number; seen: number; done: number; actions: number; xp: number }> = [];
    let dialogs = 0;
    let packets = 0;
    let finished = '';

    const trackXp = (s: BotWorldState, r: Recipe) => {
        const x = xpOf(s);
        const d = x - lastXp;
        lastXp = x;
        if (d > 0) log(`T${s.tick - t0} XP +${d / 25} base (${(d / 25 / r.xp).toFixed(2)} actions) level ${levelOf(x)}`);
        actPerTick[s.tick - t0] = d / 25 / r.xp;
        if (s.dialog?.isOpen) dialogs++;
        return x;
    };

    if (MODE === 'fast') {
        await new Promise<void>(resolve => {
            type Phase = 'work' | 'opening' | 'closing';
            let phase: Phase = 'opening';
            let recipe = pick(START_LEVEL);
            let next = 0; // next action index within the inventory
            let todo = 0; // actions available in this inventory
            let openSentAt = -99;
            let acted = -1;
            let cycle = { open: 0, seen: 0, done: 0, actions: 0, xp: 0 };
            let stackLeft = 0;
            const send = (t: number, what: string[]) => { if (what.length) { packets += what.length; log(`T${t} send [${what.join(', ')}]`); } };
            const openBank = (t: number, burst: string[]) => {
                sdk.sendInteractLoc(booth.x, booth.z, booth.id, boothOp).catch(() => {});
                burst.push('open');
                openSentAt = t;
                phase = 'opening';
                cycle = { open: t, seen: 0, done: 0, actions: 0, xp: xpOf(sdk.getState()!) };
            };
            const off = sdk.onStateUpdate((s: BotWorldState) => {
                if (!s?.inGame || s.tick === acted) return;
                acted = s.tick;
                const t = s.tick - t0;
                const x = trackXp(s, recipe);
                const level = levelOf(x);
                if (level >= UNTIL || cycles.length >= MAX_CYCLES || finished) {
                    if (!finished) finished = level >= UNTIL ? `level ${UNTIL}` : `${cycles.length} cycles`;
                    off(); resolve(); return;
                }
                const burst: string[] = [];
                if (recipe.stack) {
                    // Fletching: re-pick the best arrowheads each tick and send K uses.
                    recipe = pick(level);
                    const heads = s.inventory.find(i => i.id === id(recipe.b!));
                    const shafts = s.inventory.find(i => i.id === id(recipe.a));
                    if (!heads || !shafts) { finished = 'out of arrow supplies'; off(); resolve(); return; }
                    stackLeft = Math.min(heads.count, shafts.count);
                    for (let i = 0; i < K && i * 15 < stackLeft; i++) {
                        sdk.sendUseItemOnItem(heads.slot, shafts.slot).catch(() => {});
                        burst.push('use');
                    }
                    send(t, burst);
                    return;
                }
                if (phase === 'work') {
                    const tool = recipe.tool ? 1 : 0;
                    while (burst.length < K && next < todo) {
                        const [src, dst] = recipe.tool ? [0, tool + next] : [PAIR + next, next];
                        sdk.sendUseItemOnItem(src, dst).catch(() => {});
                        burst.push(`use ${src}->${dst}`);
                        next++;
                    }
                    if (next >= todo && burst.length < 5) openBank(t, burst);
                    send(t, burst);
                    return;
                }
                if (phase === 'opening') {
                    if (!s.bank.isOpen) {
                        if (t - openSentAt >= 4) { openBank(t, burst); send(t, burst); }
                        return;
                    }
                    cycle.seen = t;
                    // Bank is open: refill. Product types first out, then A into the freed slots.
                    recipe = pick(level);
                    const aSlot = bankSlot(s, recipe.a);
                    const bSlot = recipe.b ? bankSlot(s, recipe.b) : undefined;
                    if (aSlot === undefined || (recipe.b && bSlot === undefined)) { finished = `out of ${recipe.name} supplies`; off(); resolve(); return; }
                    const keep = new Set([recipe.tool ? id(recipe.tool) : -1]);
                    const inv = s.inventory.filter(i => !keep.has(i.id));
                    const canonicalPair = !recipe.tool && inv.length === PAIR && inv.every(i => i.slot < PAIR);
                    const depositAllTypes = (items: InventoryItem[]) => {
                        const seen = new Set<number>();
                        for (const it of items) if (!seen.has(it.id)) { seen.add(it.id); sdk.sendBankDeposit(it.slot, -1).catch(() => {}); burst.push(`dep ${it.name}`); }
                    };
                    if (recipe.tool) {
                        depositAllTypes(inv);
                        sdk.sendBankWithdraw(aSlot, -1).catch(() => {}); burst.push('wd A all');
                    } else if (canonicalPair) {
                        // 14 products in 0-13: B fills 14-27, then the products go and A fills 0-13.
                        sdk.sendBankWithdraw(bSlot!, -1).catch(() => {}); burst.push('wd B all');
                        depositAllTypes(inv);
                        sdk.sendBankWithdraw(aSlot, -1).catch(() => {}); burst.push('wd A all');
                    } else if (recipe.name === 'kebab' && inv.length === 2 * PAIR) {
                        // Bowls in 0-13, kebabs in 14-27: kebabs out, pittas in, bowls out, mixtures in.
                        depositAllTypes(inv.filter(i => i.slot >= PAIR));
                        sdk.sendBankWithdraw(bSlot!, -1).catch(() => {}); burst.push('wd B all');
                        depositAllTypes(inv.filter(i => i.slot < PAIR));
                        sdk.sendBankWithdraw(aSlot, -1).catch(() => {}); burst.push('wd A all');
                    } else {
                        // First visit or a recipe change: empty the inventory, 10 + 1x4 A, then all B.
                        depositAllTypes(inv);
                        sdk.sendBankWithdraw(aSlot, 10).catch(() => {}); burst.push('wd A 10');
                        for (let i = 0; i < 4; i++) { sdk.sendBankWithdraw(aSlot, 1).catch(() => {}); burst.push('wd A 1'); }
                        sdk.sendBankWithdraw(bSlot!, -1).catch(() => {}); burst.push('wd B all');
                    }
                    sdk.sendCloseModal().catch(() => {}); burst.push('close');
                    phase = 'closing';
                    send(t, burst);
                    return;
                }
                if (phase === 'closing') {
                    if (s.bank.isOpen) return;
                    // Wait until the client shows the refilled layout, then work this tick.
                    const ok = recipe.tool
                        ? invAt(s, 0)?.id === id(recipe.tool) && invAt(s, 1)?.id === id(recipe.a)
                        : invAt(s, 0)?.id === id(recipe.a) && invAt(s, PAIR)?.id === id(recipe.b!);
                    if (!ok) return;
                    todo = recipe.tool
                        ? s.inventory.filter(i => i.id === id(recipe.a)).length
                        : Math.min(...[recipe.a, recipe.b!].map(o => s.inventory.filter(i => i.id === id(o)).length));
                    cycle.done = t; cycle.actions = todo; cycles.push(cycle);
                    next = 0;
                    phase = 'work';
                    const tool = recipe.tool ? 1 : 0;
                    while (burst.length < K && next < todo) {
                        const [src, dst] = recipe.tool ? [0, tool + next] : [PAIR + next, next];
                        sdk.sendUseItemOnItem(src, dst).catch(() => {});
                        burst.push(`use ${src}->${dst}`);
                        next++;
                    }
                    send(t, burst);
                }
            });
            // Kick off: the first bank visit.
            const s = sdk.getState()!;
            const burst: string[] = [];
            if (!pick(START_LEVEL).stack) { openBank(s.tick - t0, burst); cycle.open = 0; }
            send(s.tick - t0, burst);
        });
    } else {
        // ---- stock porcelain ----
        let recipe = pick(START_LEVEL);
        while (!finished) {
            const s0 = sdk.getState()!;
            trackXp(s0, recipe);
            if (levelOf(xpOf(s0)) >= UNTIL) { finished = `level ${UNTIL}`; break; }
            if (cycles.length >= MAX_CYCLES) { finished = `${cycles.length} cycles`; break; }
            recipe = pick(levelOf(xpOf(s0)));
            const cyc = { open: s0.tick - t0, seen: 0, done: 0, actions: 0, xp: xpOf(s0) };
            if (!recipe.stack) {
                const ob = await bot.openBank();
                if (!ob.success) throw new Error(`openBank: ${ob.message}`);
                cyc.seen = sdk.getState()!.tick - t0;
                const keep = recipe.tool ? id(recipe.tool) : -1;
                for (;;) {
                    const it = sdk.getState()!.inventory.find(i => i.id !== keep);
                    if (!it) break;
                    const r = await bot.depositItem(it, -1);
                    if (!r.success) throw new Error(`deposit: ${r.message}`);
                }
                // withdrawItem(number) means a bank slot, so pass the BankItem itself.
                const inBank = (o: string) => sdk.getState()!.bank.items.find(i => i.id === id(o) && i.count > 0);
                const aItem = inBank(recipe.a);
                const bItem = recipe.b ? inBank(recipe.b) : undefined;
                if (!aItem || (recipe.b && !bItem)) { finished = `out of ${recipe.name} supplies`; break; }
                await bot.withdrawItem(aItem, recipe.tool ? 27 : PAIR);
                if (bItem) await bot.withdrawItem(bItem, PAIR);
                await bot.closeBank();
                cyc.done = sdk.getState()!.tick - t0;
            }
            // one action per read: use, then wait for the inventory to change
            for (let n = 0; ; n++) {
                const s = sdk.getState()!;
                trackXp(s, recipe);
                if (levelOf(xpOf(s)) >= UNTIL) break;
                let src: number | undefined, dst: number | undefined;
                if (recipe.tool) {
                    src = s.inventory.find(i => i.id === id(recipe.tool!))?.slot;
                    dst = s.inventory.find(i => i.id === id(recipe.a))?.slot;
                } else {
                    src = s.inventory.find(i => i.id === id(recipe.b!))?.slot;
                    dst = s.inventory.find(i => i.id === id(recipe.a))?.slot;
                }
                if (src === undefined || dst === undefined) break;
                const before = JSON.stringify(s.inventory.map(i => [i.slot, i.id, i.count]));
                const t = s.tick;
                await sdk.sendUseItemOnItem(src, dst);
                packets++;
                log(`T${t - t0} send [use ${src}->${dst}] (stock)`);
                await sdk.waitForCondition(st => JSON.stringify(st.inventory.map(i => [i.slot, i.id, i.count])) !== before, 10_000).catch(() => {});
                if (sdk.getState()?.dialog?.isOpen) await sdk.sendClickDialog(0);
                cyc.actions++;
                if (recipe.stack && n > 2000) break;
            }
            cycles.push(cyc);
            if (recipe.stack) break;
        }
        trackXp(sdk.getState()!, recipe);
    }

    // ---- summary ----
    const end = sdk.getState()!;
    const span = end.tick - t0;
    const gained = (xpOf(end) - xp0) / 25;
    const gaps = cycles.slice(1).map((c, i) => c.open - cycles[i]!.open);
    const hist = (xs: number[]) => {
        const h: Record<string, number> = {};
        for (const v of xs) { const k = String(Math.round(v * 100) / 100); h[k] = (h[k] ?? 0) + 1; }
        return Object.entries(h).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => `${k}:${v}`).join(' ');
    };
    const landed = actPerTick.filter(v => v !== undefined && v > 0);
    const summary = [
        `== delayfree-cycle ${TAG} route=${routeNames.join(',')} (NODE_TICKRATE=${process.env.NODE_TICKRATE ?? '?'}) ==`,
        `${SKILL} ${START_LEVEL} -> ${levelOf(xpOf(end))} (${finished}); span ${span} ticks; ${gained.toFixed(1)} base xp = ${(gained / Math.max(1, span)).toFixed(1)} base xp per tick`,
        `bank cycles ${cycles.length}; open-to-open gaps (ticks:count) ${hist(gaps)}; mean ${(gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length)).toFixed(2)}`,
        `open click -> bank seen (ticks:count) ${hist(cycles.filter(c => c.seen).map(c => c.seen - c.open))}; open click -> refilled inventory seen ${hist(cycles.filter(c => c.done).map(c => c.done - c.open))}`,
        `actions landed per tick (on ticks with xp; actions:ticks) ${hist(landed)}`,
        `packets ${packets}; ticks with a dialog open ${dialogs}`,
        `log ${LOG}`
    ].join('\n');
    log(summary);
    console.log(summary);
}, { timeout: 60 * 60_000, printState: false });
