// Ticks per cast for every pre-Charge Magic training spell.
//
//   bun docs/speedrun/scripts/magic-cadence.ts <bot> [spells] [casts] [burst]
//   docs/speedrun/scripts/magic-lab.sh <bot> docs/speedrun/scripts/magic-cadence.ts:all:20:1
//
// spells: comma list from SPELLS below, or `all`. For each spell it wipes the inventory, sets Magic
// to the spell's level, wields the staff that removes one rune kind, gives the runes and fills the
// rest of the inventory with the target item. Then, on every server tick, it sends `burst` casts
// (each on a different not-yet-converted slot, or `burst` clicks of a teleport button) without
// waiting for the previous cast, and records Magic xp per tick. A cast that the server drops
// (OpHeldTHandler refuses OPHELDT while the player is delayed) costs nothing, so this measures the
// server's own floor. burst > 1 shows whether several casts can land in one tick.
import { runScript } from '../../../sdk/runner';
import { SPELLS } from './magic-cadence-spells';
import { cheat, freshKit, histogram, log, namePattern, nextTick, prepare, tick, waitTicks, xpRecorder } from './magic-lib';

const [spellArg = 'all', castsArg = '20', burstArg = '1'] = process.argv.slice(3);
const names = spellArg === 'all' ? Object.keys(SPELLS) : spellArg.split(',');
const CASTS = Number(castsArg);
const BURST = Number(burstArg);

await runScript(async ({ bot, sdk }) => {
    await prepare(sdk, bot);
    const rec = xpRecorder(sdk, 'Magic');
    const summary: string[] = [];
    for (const name of names) {
        const s = SPELLS[name];
        if (!s) throw new Error(`unknown spell ${name}`);
        await freshKit(sdk, bot, s.staff);
        // Magic at the bottom of the spell's level; give enough xp headroom that one level-up box
        // usually appears inside the run (OPHELDT closes it: Player.clearPendingAction).
        await cheat(sdk, `setstat magic ${s.level}`);
        for (const c of s.extra ?? []) await cheat(sdk, c);
        for (const [rune, n] of s.runes) await cheat(sdk, `give ${rune} ${n}`);
        const free = 28 - s.runes.length;
        const casts = s.item ? Math.min(CASTS, free) : CASTS;
        if (s.item) await cheat(sdk, `give ${s.item} ${casts}`);
        await waitTicks(sdk, 3);
        sdk.getNewChat({ types: [0] });
        const itemId = s.item ? sdk.getInventory().find((i) => namePattern(s.item!).test(i.name))?.id : undefined;
        if (s.item && itemId === undefined) throw new Error(`no ${s.item} in inventory`);

        const xp0 = sdk.getSkill('Magic')!.experience;
        const t0 = tick(sdk);
        let sent = 0;
        let t = t0;
        const deadline = t0 + casts * 8 + 20;
        while (tick(sdk) < deadline) {
            const gained = (sdk.getSkill('Magic')!.experience - xp0) / 25;
            if (gained >= casts * s.base - 0.01) break;
            if (s.item) {
                const todo = sdk.getInventory().filter((i) => i.id === itemId).slice(0, BURST);
                if (todo.length === 0) break;
                await Promise.all(todo.map((i) => sdk.sendSpellOnItem(i.slot, s.com)));
            } else {
                await Promise.all(Array.from({ length: BURST }, () => sdk.sendClickComponent(s.com)));
            }
            sent += BURST;
            t = await nextTick(sdk, t);
        }
        await waitTicks(sdk, 4);
        const t1 = tick(sdk);
        const gains = rec.gains(t0, t1);
        const n = gains.reduce((a, g) => a + g.base, 0) / s.base;
        const gaps = gains.slice(1).map((g, i) => g.tick - gains[i]!.tick);
        const perTick = gains.map((g) => g.base / s.base);
        const span = gains.length > 1 ? gains.at(-1)!.tick - gains[0]!.tick : 0;
        const tpc = n > 1 ? span / (n - 1) : NaN;
        const msgs = sdk.getNewChat({ types: [0] }).map((m) => m.text).filter((x) => !/^::|Inventory wiped|successfully enchant|You feel/.test(x));
        log(sdk, `${name}: ${n.toFixed(1)} casts, ${sent} clicks over ${t1 - t0} ticks; casts per xp tick ${histogram(perTick)}; gaps ${histogram(gaps)}; ${tpc.toFixed(2)} ticks/cast; ${(s.base / tpc).toFixed(2)} base xp/tick`);
        if (msgs.length) console.log('   chat:', [...new Set(msgs)].slice(0, 6).join(' | '));
        summary.push(`| ${name} | ${s.level} | ${s.base} | ${BURST} | ${n.toFixed(0)} | ${tpc.toFixed(2)} | ${(s.base / tpc).toFixed(2)} | ${histogram(gaps)} |`);
    }
    console.log(`\nNODE_TICKRATE=${process.env.NODE_TICKRATE ?? '?'} burst=${BURST}`);
    console.log('| Spell | Level | Base xp | Clicks/tick | Casts | Ticks/cast | Base xp/tick | Gaps (ticks:count) |');
    console.log('|---|---|---|---|---|---|---|---|');
    for (const r of summary) console.log(r);
    rec.off();
}, { timeout: 30 * 60_000, printState: false });
