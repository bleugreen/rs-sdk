// End-to-end Magic route to 80 at a bank booth: the enchanting ladder plus its bank visits.
//
//   bun docs/speedrun/scripts/magic-route.ts <bot> [startLevel] [bands]
//   NODE_TICKRATE=300 docs/speedrun/scripts/magic-lab.sh <bot> docs/speedrun/scripts/magic-route.ts:57
//
// bands: comma list of `spell@fromLevel` (spells from magic-cadence-spells.ts), default the full
// ladder sapphire@7,emerald@27,ruby@49,diamond@57,dragonstone@68 (bands below startLevel are skipped).
// Staff of water worn; the inventory holds every rune stack the remaining bands need (cosmic, plus
// earth/air/fire as needed) and the rest is jewellery. The bank is cleared and stocked with each
// band's jewellery in band order, with one spare inventory each so no bank slot ever empties and
// the slots stay put. Casting: two clicks per tick on unconverted slots (magic-cadence.ts shows the
// server takes one per 3 ticks). Bank visit (the fast mode of magic-bank.ts): click the booth every
// tick until it opens, then deposit-all each product, withdraw-all the current band's slot, close.
// Reports server ticks from the first cast to level 80, the cast count and the bank visits.
import { runScript } from '../../../sdk/runner';
import { SPELLS } from './magic-cadence-spells';
import { cheat, freshKit, log, namePattern, nextTick, prepare, tick, waitTicks, waitUntil, xpRecorder } from './magic-lib';

const [startArg = '57', bandsArg = 'sapphire@7,emerald@27,ruby@49,diamond@57,dragonstone@68', goalArg = '80'] = process.argv.slice(3);
const START = Number(startArg);
const GOAL = Number(goalArg);
const all = bandsArg.split(',').map((b) => {
    const [name, from] = b.split('@');
    return { name: name!, from: Number(from), spell: SPELLS[name!]! };
});
const bands = all.filter((b, i) => (all[i + 1]?.from ?? 99) > START);

// base xp at the start of each level, Player.ts:77-85 (game xp in tenths, 25x)
const levelXp: number[] = [0, 0];
{
    let acc = 0;
    for (let l = 1; l < 99; l++) {
        acc += Math.floor(l + Math.pow(2, l / 10) * 300);
        levelXp[l + 1] = Math.floor(acc / 4) / 25;
    }
}

await runScript(async ({ bot, sdk }) => {
    await prepare(sdk, bot);
    await freshKit(sdk, bot, 'staff_of_water');
    await cheat(sdk, '~clearbank');
    await cheat(sdk, `setstat magic ${START}`);
    const runeNames = new Set<string>();
    for (const b of bands) for (const [r] of b.spell.runes) runeNames.add(r);
    // staff of water covers water; give the other rune kinds the remaining bands need
    const runes = new Map<string, number>([['cosmicrune', 5000], ['earthrune', 5000], ['airrune', 5000], ['firerune', 5000]]);
    const needed = ['cosmicrune', ...(bands.some((b) => ['diamond', 'dragonstone'].includes(b.name)) ? ['earthrune'] : []), ...(bands.some((b) => b.name === 'emerald') ? ['airrune'] : []), ...(bands.some((b) => b.name === 'ruby') ? ['firerune'] : [])];
    const free = 28 - needed.length;
    // casts per band from the xp table
    let xp = levelXp[START]!;
    const plan = bands.map((b, i) => {
        const to = Math.min(bands[i + 1]?.from ?? GOAL, GOAL);
        const casts = Math.max(0, Math.ceil((levelXp[to]! - xp) / b.spell.base));
        xp += casts * b.spell.base;
        return { ...b, to, casts };
    });
    log(sdk, `plan from ${START}: ${plan.map((p) => `${p.name} ${p.from}->${p.to} ${p.casts} casts`).join(', ')}; ${free} jewellery per inventory`);
    // stock the bank in band order
    let r = await bot.openBank();
    if (!r.success) throw new Error(`openBank: ${r.message}`);
    for (const p of plan) {
        let left = p.casts + free;
        while (left > 0) {
            const n = Math.min(left, 28);
            await cheat(sdk, `give ${p.spell.item} ${n}`);
            await waitUntil(sdk, () => sdk.getInventory().some((x) => namePattern(p.spell.item!).test(x.name)), 10, 'given');
            const d = await bot.depositItem(namePattern(p.spell.item!), -1);
            if (!d.success) throw new Error(`stock deposit: ${d.message}`);
            left -= n;
        }
    }
    await waitTicks(sdk, 2);
    const bankOrder = sdk.getBankItems().map((b) => b.name);
    log(sdk, `bank: ${sdk.getBankItems().map((b) => `${b.slot}:${b.name} x${b.count}`).join(', ')}`);
    await bot.closeBank();
    for (const rn of needed) await cheat(sdk, `give ${rn} ${runes.get(rn)}`);
    await waitTicks(sdk, 2);
    const booth = sdk.findNearbyLoc(/bank booth/i)!;
    const bankOp = booth.optionsWithIndex.find((o) => /^bank$|use.quickly/i.test(o.text)) ?? booth.optionsWithIndex[0]!;
    const isRune = (n: string) => / rune$/i.test(n);

    const rec = xpRecorder(sdk, 'Magic');
    const level = () => sdk.getSkill('Magic')!.baseLevel;
    const band = () => plan.filter((p) => p.from <= level()).at(-1) ?? plan[0]!;
    let banks = 0;
    let casts = 0;
    const bankTicks: number[] = [];
    let t = tick(sdk);
    let t0 = -1;
    let lastCastTick = -1;
    const xpGain = () => rec.gains(t0 < 0 ? t : t0 - 1, tick(sdk));
    // first inventory comes from the bank too, so the run starts with a bank visit
    while (level() < GOAL) {
        const b = band();
        const pat = namePattern(b.spell.item!);
        const todo = sdk.getInventory().filter((x) => pat.test(x.name)).slice(0, 2);
        const open = sdk.isBankOpen();
        if (todo.length > 0 && !open) {
            if (t0 < 0) t0 = tick(sdk);
            await Promise.all(todo.map((x) => sdk.sendSpellOnItem(x.slot, b.spell.com)));
        } else if (todo.length > 0 && open) {
            await sdk.sendCloseModal();
        } else if (!open) {
            await sdk.sendInteractLoc(booth.x, booth.z, booth.id, bankOp.opIndex);
        } else {
            // deposit every non-rune product type (one click each), withdraw this band's stack
            const kinds = new Map<number, number>();
            for (const x of sdk.getInventory()) if (!isRune(x.name) && !pat.test(x.name)) kinds.set(x.id, x.slot);
            const slot = bankOrder.findIndex((n) => pat.test(n));
            await Promise.all([...[...kinds.values()].map((s) => sdk.sendBankDeposit(s, -1)), sdk.sendBankWithdraw(slot, -1), sdk.sendCloseModal()]);
            banks++;
            if (lastCastTick >= 0) bankTicks.push(tick(sdk));
        }
        t = await nextTick(sdk, t);
        const g = rec.gains(t - 1, t);
        if (g.length) lastCastTick = t;
    }
    await waitTicks(sdk, 2);
    const gains = rec.gains(t0, tick(sdk));
    casts = gains.length;
    const first = gains[0]!.tick;
    const last = gains.at(-1)!.tick;
    const gaps = gains.slice(1).map((g, i) => g.tick - gains[i]!.tick);
    const big = gaps.filter((g) => g > 4);
    const hist = gaps.reduce((m: Record<number, number>, g) => ((m[g] = (m[g] ?? 0) + 1), m), {});
    log(sdk, `ROUTE ${START}->${GOAL} NODE_TICKRATE=${process.env.NODE_TICKRATE ?? '?'}: ${casts} casts, ${last - first + 3} ticks from first cast to ${GOAL} (+3 for the first cast's own window); bank sends ${banks} (incl. the opening withdraw); gap histogram ${JSON.stringify(hist)}; bank-visit gaps ${JSON.stringify(big)}; final xp ${sdk.getSkill('Magic')!.experience / 25} base, level ${level()}`);
    rec.off();
}, { timeout: 60 * 60_000, printState: false });
