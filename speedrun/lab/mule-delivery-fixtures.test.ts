import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { MULE1_ORDER, MULE1_ON_REQUEST, muleFromLedger, muleRunOptionsByAccount, type MuleRunOptions } from '../helpers/mule-ledger';
import { createHash } from 'node:crypto';
import { objIdsNamed, untradeable } from '../lib/items';
import { objPack, parseObjPack } from '../lib/obj-pack';
import { MANIFEST, itemLabel, parseLedger, walk, type Held } from '../tools/slot-ledger';
import { itemPattern } from '../runner/handoff';
import { parseFallbacks } from '../helpers/mule-ledger';
import { fixtureSeedBatches, fixtureSlots, loadFixtureCatalog, planMuleDeliveryFixtures, type MuleDeliveryFixtureOptions, type RowFixtureOverrides } from './mule-delivery-fixtures';

const pack = objPack();
const catalog = loadFixtureCatalog(pack);
// without attempt 4's H4m row; the H4m test adds its own
const manifest = readFileSync(MANIFEST, 'utf8').replace(/^\| H4m\.1-H4m\.\d+ \|.*\n/m, '');
const table = (...rows: string[]) => '| row | in | out | equip | needAtStart | source |\n|---|---|---|---|---|---|\n' + rows.join('\n');
const plan = (manifest: string, rows: string[], extra: Partial<MuleDeliveryFixtureOptions> = {}) =>
    planMuleDeliveryFixtures({ manifest, rows, pack, catalog, ...extra });
const counts = (items: readonly { id: number; count: number }[]) => Object.fromEntries(items.map(i => [i.id, i.count]));
const override = (id: number, count: number) => ({ items: [{ id, count }], reason: 'Explicit test fixture authority' });
const KHAZARD_DROPS = 'khazard helmet x1 (drop: unworn first, on the tile; tradeable=no, quest_arena.obj); khazard armour x1 (drop: unworn first, on the tile; tradeable=no)';
const KHAZARD_SWAPS = 'khazard helmet x1 (swap: unworn first); khazard armour x1 (swap: unworn first)';

// Explicit caller choices, not a planner fallback or a second package quantity map.
// rs158: ordinary logs/coins/flour; quest configs: strung wearable amulet.
function fullRouteOverrides(text: string): Record<string, RowFixtureOverrides> {
    const rows = parseLedger(text).rows;
    const walked = walk(rows);
    const identities: Record<string, number> = {
        logs: 1511, coins: 995, 'pot of flour': 1933, "m'speak amulet": 4021,
        shortbow: 841, 'magic shortbow': 861,
    };
    const heldItems = (h: Held) => {
        if (h.count === null) throw Error('Unknown canonical quantity: ' + itemLabel(h));
        const candidates = [...catalog].filter(([, x]) => x.name.toLowerCase() === h.name.toLowerCase()).map(([id]) => id);
        const id = h.id ?? identities[h.name] ?? (candidates.length === 1 ? candidates[0] : undefined);
        if (id === undefined) throw Error('No explicit test object: ' + itemLabel(h));
        return { id: h.kind === 'n' ? pack.ids.get('cert_' + pack.names.get(id))! : id, count: h.count };
    };
    const out: Record<string, RowFixtureOverrides> = {};
    for (const row of [...rows.filter(r => [...MULE1_ORDER as readonly string[]].includes(r.row)), ...parseFallbacks(text)]) {
        const checkpoint = row.row === 'H4e' ? 'S07 last load' : row.row === 'H4m' ? 'S09' : row.row;
        const index = rows.findIndex(r => r.row === checkpoint);
        const before = walked[index - 1]!.stacks;
        const all = [...before.inv, ...before.worn];
        const config: RowFixtureOverrides = { before: {}, receive: {}, takeBacks: {} };
        for (const h of all) if (identities[h.name] !== undefined) {
            (config.before as Record<string, unknown>)[itemLabel(h)] = { items: [heldItems(h)], reason: 'Explicit test fixture identity; quantity from canonical walk before ' + checkpoint };
        }
        for (const e of row.in) if (identities[e.name] !== undefined) {
            (config.receive as Record<string, unknown>)[itemLabel(e)] = { items: [heldItems(e)], reason: 'Explicit standard object identity; canonical incoming count/max' };
        }
        for (const e of row.out) if (e.count === 'all' || e.count === 'any' || e.family || (e.placeholder && row.row !== 'H4' && identities[e.name] !== undefined)) {
            const held = all.filter(h => e.placeholder ? h.placeholder && h.name === e.name : e.id !== undefined ? h.id === e.id : itemPattern(e.name).test(h.name));
            (config.takeBacks as Record<string, unknown>)[itemLabel(e)] = { items: held.map(heldItems), reason: 'Explicit confirmation of complete walked before-state for this mechanical fixture; not a measured exit census' };
        }
        out[row.row] = config;
    }
    return out;
}

// Actual CONFIG/LAB-ONLY GIVE projection: cairn://p/rs/496/comments/13.
// Numeric helper bundle: cairn://p/rs/496/comments/12, generated at
// fcf4949f8b2404ea9441a932a57f2a6e21cb0c54. Only four incoming identity cells
// changed; runtime step effects remain unresolved rather than inventing a census.
const rehearsalGiveLedger = [
    "| row | in | out | equip | needAtStart | source |",
    "|---|---|---|---|---|---|",
    "| S00 | bronze axe x1 [u]; tinderbox x1 [u]; small fishing net x1 [u]; shrimps x1 [u]; bucket x1 [u]; pot x1 [u]; bread x1 [u]; bronze pickaxe x1 [u]; bronze dagger x1 [u]; bronze sword x1 [u]; wooden shield x1 [u]; shortbow x1 [u]; bronze arrow x25 [s]; air rune x25 [s]; mind rune x15 [s]; water rune x6 [s]; earth rune x4 [s]; body rune x2 [s] | - | - | 18 | the starter kit, `tutorial.rs2:303-320` (r); 18 of 28 slots, rs/285 (m) |",
    "| H1 | staff of water x1 [u]; cosmic rune x60 [s]; air rune x81 [s]; fire rune x80 [s]; earth rune x50 [s]; law rune x1 [s] (T04-05's Falador teleport) | - | - | 4 | SUPPLIES H1 (r); the law rune, rs/158 23:29 PDT (r) |",
    "| S01 | - | - | +staff of water | 0 | MAN entry 24, the staff of water wielded from S01 (r) |",
    "| T01-02 | - | bronze axe x1 (drop: starter junk); small fishing net x1 (drop); shrimps x1 (drop); bucket x1 (drop); pot x1 (drop); bread x1 (drop); bronze pickaxe x1 (drop); bronze dagger x1 (drop); bronze sword x1 (drop); wooden shield x1 (drop); shortbow x1 (drop); bronze arrow all (drop); body rune all (drop); water rune all (drop: the staff of water covers water) | - | 0 | RUN-ORDER T01-02 (r); rs/285's count, 12 junk (m) |",
    "| S02 | - | air rune x4 (consume: Wind Strike, 3 or 4 casts); mind rune x4 (consume); mind rune all (drop: `dropAtStrikeExit`) | - | 0 | RUN-ORDER S02 (r); rs/285, 12 / 12 / 12 / 17 (m) |",
    "| H2 | - | - | - | 0 | SUPPLIES H2: 157 logs on the ground, lit where they lie, nothing in the pack (r); the traded fallback is 8 refills of 20 (rs/245, m) |",
    "| S03 | - | - | - | 0 | MAN entry 16 (r) |",
    "| H3 | law rune x47 [s]; air rune x221 [s]; fire rune x9 [s]; mind rune x32 [s] | - | - | 20 | SUPPLIES H3 (r); rs/285, ring trades 4 ticks (m); the givers are three ring givers, cairn_h81-h83, one load each, each taking the previous load's 20 back (magic.ts `RING_CONTRACT`, rs/285's measured 3-tick trades; fold-in 25, rs/443), not the trade giver |",
    "| S04 | <enchanted ring> x20 [u] (load 3's, kept for H4: `handBack: 'keep'`) | cosmic rune x60 (consume: 60 enchants); air rune x81 (consume: 27 emerald); fire rune x80 (consume: 16 ruby); earth rune x50 (consume: 5 diamond); <gem ring> x20 (consume: enchanted) | - | 0 | MAN entry 24 (r); rs/285, 191 and 191 (m) |",
    "| T04-05 | - | law rune x1 (consume: Falador teleport); air rune x3 (consume); tinderbox x1 (drop: S04's exit); earth rune all (drop: the leftover 4) | - | 0 | RUN-ORDER T04-05 (r); rs/158 23:30 PDT (r) |",
    "| H4 | clay x6 [u]; copper ore x4 [u]; iron ore x2 [u]; air talisman x1 [u]; law rune x2 [s]; air rune x6 [s] | <enchanted ring> x20 (swap: S04's last load, `swap()`) | - | 14 | SUPPLIES H4 (r); rs/285, the swap 6 / 6 (m) |",
    "| S05 | coins x180 [s] (Doric's reward) | clay x6 (hand-in); copper ore x4 (hand-in); iron ore x2 (hand-in) | - | 0 | `quest_doric` (r); MAN entry 30 (r) |",
    "| S05 C | - | coins all (drop: segment C answers the Mining level-up page and drops Doric's 180 coins on the tick they land; rs/416) | - | 0 | rs/416 (fold-in 23, m); a sub-row, because a row gives before it receives (r) |",
    "| T05-06 | - | law rune x1 (consume: Falador teleport); air rune x3 (consume); air talisman x1 (drop: on entry, runecraft.ts's first act at S06's start) | - | 0 | RUN-ORDER T05-06 (r); `runecraft.ts` dropTalisman (r) |",
    "| H5 | rune essence x26 [u] (one of 7 loads, 182 in all; each giver keeps its own talisman) | - | - | 26 | SUPPLIES H5 (r); rs/196, 26 a load 7 / 7 (m) |",
    "| S06 | air rune x572 [s] (crafted, into the held stack: seven 26-essence loads at Runecraft 1-44, one more rune a craft each 11 levels; rs/393's chunk, m, fold-in 28) | rune essence x26 (consume: one craft before the next load) | - | 0 | MAN entry 9 (r); rs/196's census, 26 free (m) |",
    "| T06-07 | - | law rune x1 (consume: Falador teleport); air rune x3 (consume); air rune all (drop: S06's air runes) | - | 0 | RUN-ORDER T06-07 (r) |",
    "| H4k | steel axe x1 [u]; knife x1 [u]; logs @1511 x1 [u] | - | - | 3 | SUPPLIES H4k (r); rs/318 ruling 1, bones-placement.md's assumption (r); the pickaxe and the Mining log moved to H4p (rs/319, d60cee33, m); staging rs/331, `helpers/staging.md` ba7303c5 (r) |",
    "| H4.x | bones x23 [u] (one load of n: 25 on the 2026-10-23 forecast, 16 with every line held, **42 as staged on 251 dragon** (fold-in 25, rs/383: 964 bones, dragon first from each giver's bank), 43 on the 21:20 UTC stock) | - | - | 24 | SUPPLIES H4.1-H4.n (r); `woodcutting.ts` preconditions: free + held bones >= load + 1, the 1 for the chopped log (r); 25 free, with `keepProducts: 1` on the normal band and every oak and willow band starting by dropping logs past 1, 0 ticks (rs/319, d60cee33, m, lab); the rune axe carried, not wielded, at Attack 1 (r) |",
    "| S07 | - | bones x23 (consume: buried in the knife loop, S25b) | - | 2 | MAN entry 3 (r); `woodcutting.ts`: 2 free (r); products past 1 normal log dropped (rs/319, d60cee33, m); T07a and S25b are inside S07 |",
    "| S07 last load | law rune x1 [s]; air rune x5 [s] (T07-08's Camelot teleport, beside the last load's 21 bones) | rune axe x1 (drop: `dropAxe` at S07's end, 0 ticks) | - | 2 | the 0-tick path (fold-in 22): rs/329's `finalExtras` / `finalN` on main with fleet snapshot 4 (#310), rs/333's `bones.lastLoad` with #293 (r); the last load is 21 bones + law 1 + air 5, the same 23 stacks (r); a sub-row, not a hand-off, so `runner/handoff.ts` makes no trade; the runes from cairn_b04's bank, b04 serving the group's last load (rs/383, 86ea3e16; fold-in 25), and until rs/329's giver code and rs/436 are on main the fallback below is in force; the fallback, H4e's swap at S07's end (the axe back, 4 ticks on SCORED's clock, rs/319, d60cee33, m, lab, +5 i); staging rs/331, `helpers/staging.md` ba7303c5 (r) |",
    "| T07-08 | - | law rune x1 (consume: Camelot teleport); air rune x5 (consume) | - | 0 | RUN-ORDER T07-08 (r); Camelot is 1 law and 5 air (r); the runes from S07's last load (fold-in 22; H4e's swap the fallback); the pack after it, the knife and 1 log, 24 free (rs/158 01:39 PDT, r) |",
    "| H6 | dwellberries x1 [u]; bucket of water @1929 x4 [u] (obj `bucket_water`; the game has three objs of that name); spade x1 [u]; rope x1 [u]; chocolate dust x1 [u]; bucket of milk x1 [u]; snape grass x1 [u]; law rune x2 [s] (Ardougne, T08-09; no water: T08-09 casts on the staff of water, so H6's 2 water runes, never spent, are dropped, rs/451's rune pins, fold-in 25) | - | - | 12 | SUPPLIES H6 (r); the Camelot runes moved to H4e (rs/318 ruling 2; rs/158 01:12 PDT, r); staging rs/331, `helpers/staging.md` ba7303c5 (r) |",
    "| S08 | bucket x4 [u] (empty, one back per pour, `mud_patch.rs2:41`); gas mask x1 [u] (Alrena's, `alrena.rs2:25`) | dwellberries x1 (hand-in); bucket of water @1929 x4 (consume: the mud patch); rope x1 (consume); chocolate dust x1 (consume: the hangover cure); bucket of milk x1 (consume); snape grass x1 (consume) | +gas mask; -gas mask | 2 | **needAtStart 2 with H6 held** (the picture and the gas mask, at D), from `slotNeed` over `QUEST_ITEMS`; 14 without H6 (12 for the trade + 2) (rs/400, fold-in 23, r); the exit drops moved from T08-09 into S08 (Z, 3 ticks, m, rs/400), on the next row; `quest_elena` (r): the gas mask worn to enter West Ardougne (`sewerpipe.rs2:5`); the picture, warrant, key, note and book taken back at completion (`quest_elena.rs2:6-10`); the magic scroll it adds (`:11`) is read inside the quest to unlock the Ardougne teleport (`elena_teleport_scroll.rs2:11-14`; `plague_city.md` step 32, m); the old need, 4, was the scruffy note, warrant and small key, and the picture if held, by script order (r, history) |",
    "| S08 exit | - | spade x1 (drop: Z's exit, inside S08's figure); bucket all (drop: the 4 empties); gas mask x1 (drop: taken off at Z) | - | 0 | rs/400 (fold-in 23: Z takes the gas mask off, then drops the spade, the 4 empty buckets and the mask, 3 ticks, m, r); a sub-row, because a row gives before it receives (r) |",
    "| T08-09 | - | law rune x2 (consume: Ardougne teleport; the staff of water covers the water) | - | 0 | RUN-ORDER T08-09 (r); rs/318 ruling 3, P1 (r); Plague City's exit drops moved into S08 (rs/400, fold-in 23, r) |",
    "| H4p | rune pickaxe x1 [u]; logs @1511 x1 [u] (with S07's kept log, the 2 Mining logs) | - | - | 2 | rs/318 ruling 1 (r); rs/319, d60cee33: `mining.ts` receives at S09's start, its precondition 6 free (the 2 kit slots and the band's 4), 3 ticks on the giver's clock (m, lab), priced +5 i on S09; 0 logs lost over 1,050 ores (rs/226, m); stands alone at S09 on the forecast stock; staging rs/331, `helpers/staging.md` ba7303c5 (r) |",
    "| H4m.x | - | - | - | 0 | SUPPLIES H4m: no bones on the 2026-10-23 forecast, the row in force; on the 21:20 UTC stock ~85 in loads of 24, 24, 24 and 13, sized to SCORED's free slots (r) |",
    "| S09 | - | rune pickaxe x1 (drop: `mining.exit` at 99); logs all (drop: `mining.exit`) | - | 4 | MAN entry 4 (r); `mining.ts` FREE_SLOTS 4: ore, a gem, a stray fletch (r); `mining.exit` drops every pickaxe, log and leftover ore, gem or arrow shaft at 99, never the knife, 0 ticks (rs/319, d60cee33, m, lab) |",
    "| S10a | - | - | - | 0 | retired: Prayer comes from S07, RUN-ORDER S10a (r) |",
    "| H7 | logs @1511 x6 [u]; staff of fire x1 [u]; antipoison(3) @175 x1 [u] (obj `3doseantipoison`); shark x2 [u]; death rune x110 [s]; chaos rune x40 [s]; air rune x550 [s] | - | +staff of fire; -staff of water | 13 | SUPPLIES H7 (r); 14, the staff of water back into the pack (rs/158 01:12 PDT, r); staging rs/331, `helpers/staging.md` ba7303c5 (r) |",
    "| S10b | gnome amulet x1 [u] (the reward, `quest_tree.rs2:97`) | logs x6 (hand-in: Montai, `commander_montai.rs2:32`); death rune x26 (consume: ~26 Fire Blasts, the measured count logged per run); air rune x104 (consume: S10b needs 35 casts' runes held at K, death 35 and air 140, `WARLORD_CASTS = 35`, `tree-gnome-village.ts:196, :667`, Fire Blast the warlord's default spell, `:62-69`, with the staff of fire worn; it spends no chaos; rs/185, fold-in 25); staff of water x1 (drop: segment A, dead since H7) | - | 1 | `quest_tree` (r): Bolren takes both orbs of protection back (`king_bolren.rs2:73,98`), so the amulet alone stays; the need, one orb held at a time (r); MAN entry 14 (r); the cast count ~26 (i); the staff's drop at A (rs/342, m; fold-in 22) |",
    "| S10b N | - | gnome amulet x1 (drop: segment N, after the reward) | - | 0 | rs/342 (m; fold-in 22): the reward drops at N, so S11a has nothing to drop; a sub-row, because a row gives before it receives (r) |",
    "| S11a | - | - | - | 0 | MAN entry 1 (r); nothing left to drop: S10b drops the staff of water at A and the gnome amulet at N (rs/342, fold-in 22), clearing S11b's segment L (r); P1 (r) |",
    "| H8 | law rune x7 [s] (S11b's B and C Ardougne casts, `grand-tree.ts:618`, `:636`, 2 law + 2 water each; J's Varrock, `:777`, 1 law + 3 air, the fire from the staff of fire worn since H7; and T11-12's Ardougne, 2 law + 2 water; fold-in 25, rs/393's run.ts chunk stopping at T11-12a 'runes short: 2 law', rs/185's cast count); air rune x3 [s]; fire rune x1 [s] (the no-staff spare); water rune x6 [s] | - | - | 2 | SUPPLIES H8 (r); `grand-tree.ts` :245-247, the kit check demanding exactly law 5, water 4, air 3 at S11b's entry, and the plague-scroll retry consuming nothing (rs/185, r; fold-in 25); 3: the potion and the new law and fire stacks (r); staging rs/331, `helpers/staging.md` ba7303c5 (r) |",
    "| S11b | translation book x1 [u]; hazelmere's scroll x1 [u]; glough's journal x1 [u]; lumber order x1 [u]; glough's key x1 [u] (kept after the reward, all untradeable) | chaos rune x24 (consume: Fire Bolts, at most 24, the measured max, rs/451's rune pins); air rune x75 (consume: 72 for the Bolts and 3 for J's Varrock teleport); law rune x5 (consume: B's and C's Ardougne teleports, 2 each, and J's Varrock, 1); water rune x4 (consume: B and C) | - | 9 | **S11b needs 35 casts' runes on hand, chaos 35 and air 108 (3 + 35 x 3), and uses at most 24** (`grand-tree.ts` `DEMON_CASTS = 35`, :63, :247-248; rs/185, rs/451, fold-in 25): at its entry H7's 40 chaos is intact, S10b spending none, and air is at least 550 - 140 + 3 = 413; fire 0, the staff; MAN entry 8: 9 free at segment L, the quest's items (r); rs/202's lab, 14 free at L (m); the five kept items (`king_narnode.rs2:306`, `hazelmere.rs2:36`, `quest_grandtree.rs2:104`, `foreman.rs2:114`, `anita.rs2:18`; only the Daconia rock is deleted, `quest_grandtree.rs2:195-197`), the peak 9 with the four twigs (r); the teleports inside the quest (i); the potion keeps its slot at 3 doses (r) |",
    "| T11-12 | - | law rune x2 (consume: Ardougne teleport, H8's; rs/393's chunk, T11-12 had law 2 and water 4 staged); water rune x2 (consume: H8's, H6's 2 dropped); agility potion(*) x1 (drop: drunk at M, so at 2 doses; dead); translation book x1 (drop: the Grand Tree's leftovers); hazelmere's scroll x1 (drop); glough's journal x1 (drop); lumber order x1 (drop); glough's key x1 (drop) | - | 0 | RUN-ORDER T11-12 (r); P1 (r); the Grand Tree's exit drops, rs/185's follow-up after rs/299, number pending (r) |",
    "| H9 | coins @995 x5 [s]; law rune x2 [s]; water rune x2 [s]; shark x3 [u] | - | - | 5 | SUPPLIES H9 (r); staging rs/331, `helpers/staging.md` ba7303c5 (r) |",
    "| S12 | coins x1000 [s] (the reward, `quest_arena.rs2:269`); khazard helmet x1 [u]; khazard armour x1 [u] | coins x5 (consume: the khali brew); death rune x35 (consume: Fire Blasts, up to 35, rs/379's 28-35; fold-in 25, rs/451); air rune x140 (consume) | +khazard helmet; +khazard armour | 2 | `quest_arena` (r): the armour worn to pass the guards (`khazard_guard.rs2:7`); **needAtStart 2** (`slotNeed`, `quests/fight-arena.ts`: B's uniform and K's keys + coins the peaks; rs/379, fold-in 23, r); the cell keys (`khazard_guard.rs2:123`) received at K and dropped at K's exit inside the step (unit-tested, rs/379), so neither in nor out here; **exit census measured** (rs/379, lab, lite, fedora, m): 14 used / 14 free: knife, water 4, antipoison(3), shark x5, death 50-60, chaos 9, air 217-257, fire 1, law 2, coins 1,000 (H12's swap takes the 1,000 Fight Arena coins); the Fire Blast casts (28-35, death 84 to 50-60, air 353 to 217-257) are stacks, so not walked; sharks 0 eaten (m) |",
    "| T12-13 | - | law rune x2 (consume: Ardougne teleport); water rune x2 (consume) | - | 0 | RUN-ORDER T12-13 (r); P1; **no key drop here since fold-in 23**: rs/379's module drops the cell keys at K's exit, inside S12 (unit-tested, r); S13 then starts with 11 free after H10 (rs/379, m) |",
    "| H10 | law rune x5 [s] (2 Ardougne, 1 Falador); water rune x5 [s]; air rune x3 [s]; shark to 8 [u] (counting those held from H7 and H9) | - | - | 4 | SUPPLIES H10 (r); rs/318 ruling 4, the top-up form (rs/158 01:30 PDT, r); S13's food precondition counts every shark held, `invCount >= 8` (rs/257, 5e01cac0, r); staging rs/331, `helpers/staging.md` ba7303c5 (r); **`shark to 8` cue-asked** (`{step: 'H10', family: 'mule'}`, fold-in 25), mule1's reader rs/429 **on main with fleet snapshot 8** (rs/438, merge c9472897, rs/429 as af1cffb4; main 4bfc4f7d; fold-in 25); the scope's step = the hand-off id for mule in fleet snapshot 9, **on main as #376 (dd225788)**, (the contract committed as 2c38a339 on rs/41's branch: step = the hand-off id, the package requested via the cue only, no separate file) (rs/443, on ff0dc396); **mule1's side deployed** (the fleet on 36edbf1d with SPEEDRUN_TICK_MS=400, rs/41, fold-in 28), so the drop-then-fixed fallback stays in force only until SCORED's ask writer is on main; and SCORED's ask writer rs/393 in `runner/handoff.ts`, general to every `to N` row (H10, H12, H22) with a test a row, writing the ask on the first open-trade frame (fold-in 25); fallback until both are deployed: SCORED drops its held sharks at the hand-off tile and mule1 gives a fixed 8, ~+1-2 i |",
    "| S13 | - | law rune x3 (consume: one Falador and one Ardougne teleport inside the quest); air rune x3 (consume); water rune x3 (consume) | - | 6 | MAN entry 12: 6 railings at A's end (r); rs/257's six runs (m); Lawgof takes the mould and notes at completion (`lawgof2.rs2:201-202`) and the module drops the tool kit (`lawgof2.rs2:121`) at its exit inside L, so S13 leaves with no quest item (rs/257, 5e01cac0, r); sharks eaten not subtracted, the walk's bound (i) |",
    "| T13-14 | - | law rune x2 (consume: Ardougne teleport); water rune x2 (consume) | - | 0 | RUN-ORDER T13-14 (r) |",
    "| H11 | cannon base x1 [u]; cannon stand x1 [u]; cannon barrels x1 [u]; cannon furnace x1 [u]; cannonball x100 [s]; mithril scimitar x1 [u]; law rune x4 [s] (2 Ardougne); water rune x4 [s] | - | - | 8 | SUPPLIES H11 (r); **no sharks since fold-in 24** (S14 eats none on rs/199's runs; rs/393's single cannon receiver declines any difference between a row and the helper's serve, `serveDrift`, so H11 is give-only to SCORED: the cannon set, 100 balls, the scimitar and the runes; rs/158, r); the top-up to 9 before it, rs/158's option (a) for S15's seal (fold-in 18), history; staging rs/331, `helpers/staging.md` ba7303c5 (r) |",
    "| S14 | - | cannonball x70 (consume: 65-72) | +mithril scimitar; -staff of fire | 0 | MAN entry 26 (r); rs/199 (m); the cannon is picked up again (r) |",
    "| T14-15 | - | law rune x2 (consume: Ardougne teleport); water rune x2 (consume) | - | 0 | RUN-ORDER T14-15 (r) |",
    "| H11r | magic shortbow x1 [u] (trade: from the cannon helper, cairn_h92); rune arrow x200 [s] (trade) | cannon base x1 (swap: back to the cannon helper); cannon stand x1 (swap); cannon barrels x1 (swap); cannon furnace x1 (swap); cannonball all (swap) | +magic shortbow; -mithril scimitar; +rune arrow | 2 | SUPPLIES H11r (r); **the two-way swap, the row in force since fold-in 23** (fleet snapshot 6 (rs/421) on main as merge 52b3c06e, carrying rs/403's `serve.returnExtras`, the cannon-receiver stand-in and `keepFood`; the fleet restarted on main 32627a55 at ~16:44Z with HEAD verified (rs/41), so the cannon helper's two-way trade is deployed; r): received the bow and Monkey Madness's 200 rune arrows, given the cannon set's 4 parts and `cannonball all`, so `runner/handoff.ts` runs it as one `swap()`; run.ts (rs/393) wields the bow and quivers the arrows straight after the trade, before T14-15, the combat style left to the Monkey Madness module; the scimitar to the pack and out in H12's swap; S14 ends at Ranged 50+, the shortbow's 50, and nothing between H11r and H12 uses the staff of fire (r); the bow and arrows move from cairn_mule1 to cairn_h92 (rs/41, once this row is on main) |",
    "",
].join('\n');

// Exact two-mule options extract, not a recreation of the other fifteen helper entries.
// Full helpers.json SHA256: 29228daf1789ec73861320260fe63411407c2e8f32e9b6fe3e7e5961006c804d.
const rehearsalMuleAccounts: { account: string; options: MuleRunOptions }[] = [
    {
        account: "cairn_mule2",
        options: {
            serveMode: "request",
            cueDir: "/home/ubuntu/rs496/run-machine/rc-cue/mule",
            deliveryRun: "rs496-twin-20261023-a",
            serve: "rehearsal_receiver_redacted",
            packages: [
                {"name":"h1","items":[{"id":1383,"amount":1},{"id":564,"amount":60},{"id":556,"amount":81},{"id":554,"amount":80},{"id":557,"amount":50},{"id":563,"amount":1}],"scope":{"step":"H1","family":"mule"},"at":{"x":3222,"z":3222,"level":0},"bank":{"x":3092,"z":3245,"level":0}},
                {"name":"h3","items":[{"id":563,"amount":47},{"id":556,"amount":221},{"id":554,"amount":9},{"id":558,"amount":32}],"scope":{"step":"H3","family":"mule"},"at":{"x":3223,"z":3219,"level":0},"bank":{"x":3092,"z":3245,"level":0}},
                {"name":"h4","items":[{"id":434,"amount":6},{"id":436,"amount":4},{"id":440,"amount":2},{"id":1438,"amount":1},{"id":563,"amount":2},{"id":556,"amount":6}],"scope":{"step":"H4","family":"mule"},"carryNext":true,"takeBackSlots":20,"at":{"x":2951,"z":3451,"level":0},"bank":{"x":2946,"z":3369,"level":0}},
                {"name":"h4k","items":[{"id":1353,"amount":1},{"id":946,"amount":1},{"id":1511,"amount":1}],"scope":{"step":"H4k","family":"mule"},"at":{"x":2911,"z":3494,"level":0},"bank":{"x":2946,"z":3369,"level":0}},
            ],
        },
    },
    {
        account: "cairn_h55",
        options: {
            serveMode: "request",
            cueDir: "/home/ubuntu/rs496/run-machine/rc-cue/mule",
            deliveryRun: "rs496-twin-20261023-a",
            serve: "rehearsal_receiver_redacted",
            packages: [
                {"name":"h6","items":[{"id":2126,"amount":1},{"id":1929,"amount":4},{"id":952,"amount":1},{"id":954,"amount":1},{"id":1975,"amount":1},{"id":1927,"amount":1},{"id":231,"amount":1},{"id":563,"amount":2}],"scope":{"step":"H6","family":"mule"},"at":{"x":2568,"z":3334,"level":0},"bank":{"x":2615,"z":3333,"level":0}},
                {"name":"h4p","items":[{"id":1275,"amount":1},{"id":1511,"amount":1}],"scope":{"step":"H4p","family":"mule"},"at":{"x":2604,"z":3235,"level":0},"bank":{"x":2654,"z":3283,"level":0}},
                {"name":"h7","items":[{"id":1511,"amount":6},{"id":1387,"amount":1},{"id":175,"amount":1},{"id":385,"amount":2},{"id":560,"amount":110},{"id":562,"amount":40},{"id":556,"amount":550}],"scope":{"step":"H7","family":"mule"},"at":{"x":2504,"z":3191,"level":0},"bank":{"x":2654,"z":3283,"level":0}},
                {"name":"h8","items":[{"id":563,"amount":7},{"id":556,"amount":3},{"id":554,"amount":1},{"id":555,"amount":6}],"scope":{"step":"H8","family":"mule"},"at":{"x":2465,"z":3489,"level":0},"bank":{"x":2615,"z":3333,"level":0}},
                {"name":"h9","items":[{"id":995,"amount":5},{"id":563,"amount":2},{"id":555,"amount":2},{"id":385,"amount":3}],"scope":{"step":"H9","family":"mule"},"at":{"x":2658,"z":3301,"level":0},"bank":{"x":2654,"z":3283,"level":0}},
                {"name":"h10","items":[{"id":563,"amount":5},{"id":555,"amount":5},{"id":556,"amount":3},{"id":385,"topUp":{"max":8}}],"scope":{"step":"H10","family":"mule"},"at":{"x":2658,"z":3301,"level":0},"bank":{"x":2654,"z":3283,"level":0}},
            ],
        },
    },
];

describe('ledger-derived mule delivery fixtures', () => {
    test('actual rehearsal packages do not imply a coherent full inventory walk', () => {
        expect(createHash('sha256').update(rehearsalGiveLedger).digest('hex')).toBe('fdd73a1a85d62f5e3d1311fdaac83cbe83bdae6dac8f515a7efab121bf55f57f');
        const rows = ['H1', 'H3', 'H4', 'H4k', 'H6', 'H4p', 'H7', 'H8', 'H9', 'H10'];
        const packages = muleFromLedger(rehearsalGiveLedger, { rows, pack });
        expect(packages.map(p => p.row)).toEqual(rows);
        const itinerary = { rehearsal: { firemakingEnd: { x: 3223, z: 3219, level: 0 } } };
        const first = rehearsalMuleAccounts[0]!.options;
        const generated = muleRunOptionsByAccount(packages, first.cueDir.slice(0, -'/mule'.length), {
            deliveryRun: first.deliveryRun, serve: first.serve, itinerary,
            accounts: Object.fromEntries(rehearsalMuleAccounts.flatMap(a =>
                a.options.packages.map(p => [p.scope!.step, a.account]))),
        });
        // Compare every numeric item, quantity/top-up maximum, note flag, order, scope,
        // carry bound and location with the emitted archive, not a parallel package map.
        expect(generated.map(a => a.options)).toEqual(rehearsalMuleAccounts.map(a => a.options));
        const numeric = generated.flatMap(a => a.options.packages);
        expect(numeric).toHaveLength(10);
        expect(numeric.flatMap(p => p.items).every(i => typeof i.id === 'number' && i.item === undefined)).toBe(true);
        expect(numeric.find(p => p.name === 'h3')!.items).toEqual([
            { id: 563, amount: 47 }, { id: 556, amount: 221 },
            { id: 554, amount: 9 }, { id: 558, amount: 32 },
        ]);
        expect(numeric.find(p => p.name === 'h4k')!.items).toContainEqual({ id: 1511, amount: 1 });
        expect(numeric.find(p => p.name === 'h4p')!.items).toContainEqual({ id: 1511, amount: 1 });
        expect(numeric.find(p => p.name === 'h7')!.items).toContainEqual({ id: 1511, amount: 6 });
        expect(numeric.find(p => p.name === 'h9')!.items).toContainEqual({ id: 995, amount: 5 });
        const parsed = parseLedger(rehearsalGiveLedger);
        expect(parsed.errors).toEqual([]);
        const errors = walk(parsed.rows).filter(e => e.verdict === 'ERROR');
        expect(errors.map(e => e.row.row)).toContain('S04');
        expect(errors.map(e => e.row.row)).toContain('S07 last load');
        expect(errors.map(e => e.row.row)).toContain('T11-12');
        const p = plan(rehearsalGiveLedger, rows, {
            itinerary,
            overrides: { H1: { before: { shortbow: override(841, 1) } } },
        });
        expect(p.fixtures.map(f => f.row)).toEqual(['H1', 'H3']);
        expect(p.fixtures[1]!.at).toEqual({ x: 3223, z: 3219, level: 0 });
        expect(p.unresolved.map(r => r.row)).toEqual(rows.slice(2));
        for (const row of p.unresolved) expect(row.reasons.join()).toContain('Ledger walk errors before row: S04');
        expect(p.ok).toBe(false);
        expect(p.bankSeed).toBeNull();
        expect(p.seedBatches).toBeNull();
    });

    test('engine-backed identity and tradeability use the shared content helpers', () => {
        expect(catalog.idsNamed!(/^coins$/i)).toEqual(objIdsNamed(/^coins$/i));
        expect([...catalog].map(([id, item]) => [id, item.tradeable])).toEqual(
            [...catalog.keys()].map(id => [id, !untradeable(id)]),
        );
    });
    test('canonical H4 swaps authorized twenty recoil rings and preserves worn staff', () => {
        const p = plan(manifest, ['H4']);
        expect(p.unresolved).toEqual([]);
        const f = p.fixtures[0]!;
        expect(f.takeBacks.map(i => [i.id, i.count])).toEqual([[2550, 20]]);
        expect(f.give).toEqual([{ item: 2550, n: 20 }]);
        expect(f.beforeEquipment.some(i => i.id === 1383)).toBe(true);
        expect(f.beforeInventory.some(i => i.id === 1383)).toBe(false);
        expect(f.slots.helperAfterSwap).toBe(20);
        expect(f.receivingArea).toMatchObject({ x: 2952, z: 3451, tol: 1 });
        expect(f.at).toEqual({ x: 2951, z: 3451, level: 0 });
        expect(f.scoredArrivalAccepted).toBe(false);
    });

    test('top-up ask derives the difference; bank reserves the maximum, not the ask', () => {
        const text = table(
            '| S00 | shark x5 [u] | - | - | 5 | test (r) |',
            '| H10 | shark to 8 [u]; law rune x5 [s] | - | - | 4 | test (r) |',
            '| S13 | - | - | - | 0 | test (r) |');
        const p = plan(text, ['H10']);
        expect(p.unresolved).toEqual([]);
        const f = p.fixtures[0]!;
        expect(f.topUpAsk).toEqual({ scope: { step: 'H10', family: 'mule' }, items: [{ item: '^shark(?:\\(\\d\\))?$', count: 3 }] });
        expect(counts(f.receive)[385]).toBe(3);
        expect(counts(f.reserve)[385]).toBe(8);
        expect(counts(p.bankSeed!)[385]).toBe(8);
        expect(counts(f.afterInventory)[385]).toBe(8);
        expect(f.slots.helperAfterSwap).toBe(5);
        const changed = plan(text.replace('shark x5', 'shark x7'), ['H10']);
        expect(changed.fixtures[0]!.topUpAsk!.items[0]!.count).toBe(1);
    });

    test('zero-missing top-ups omit unpublishable zero asks and receive lines', () => {
        const p = plan(table(
            '| S00 | shark x8 [u] | - | - | 8 | test (r) |',
            '| H10 | shark to 8 [u] | - | - | 0 | test (r) |',
            '| S13 | - | - | - | 0 | test (r) |'), ['H10']);
        expect(p.unresolved).toEqual([]);
        expect(p.fixtures[0]!.topUpAsk).toBeNull();
        expect(p.fixtures[0]!.receive).toEqual([]);
        expect(counts(p.bankSeed!)[385]).toBe(8);
    });

    test('all returns need explicit confirmation and cannot change the walked count', () => {
        const text = table(
            '| S00 | coins @995 x180 [s] | - | - | 1 | test (r) |',
            '| H12 | shark x1 [u] | coins all (swap) | - | 1 | test (r) |',
            '| S15 | - | - | - | 0 | test (r) |');
        const missing = plan(text, ['H12']);
        expect(missing.ok).toBe(false);
        expect(missing.unresolved[0]!.reasons.join()).toContain('explicit concrete');
        const good = plan(text, ['H12'], { overrides: { H12: { takeBacks: { coins: override(995, 180) } } } });
        expect(good.unresolved).toEqual([]);
        expect(good.fixtures[0]!.give).toEqual([{ item: 995, n: 180 }]);
        const wrong = plan(text, ['H12'], { overrides: { H12: { takeBacks: { coins: override(995, 179) } } } });
        expect(wrong.unresolved[0]!.reasons.join()).toContain('differs from the intended before-state');
    });

    test('dose-family returns preserve each exact object id', () => {
        const text = table(
            '| S00 | antipoison(3) @175 x1 [u]; antipoison(1) @179 x2 [u] | - | - | 3 | test (r) |',
            '| H13 | knife x1 [u] | antipoison(*) all (swap) | - | 1 | test (r) |',
            '| S16 | - | - | - | 0 | test (r) |');
        expect(plan(text, ['H13']).ok).toBe(false);
        const p = plan(text, ['H13'], { overrides: { H13: { takeBacks: {
            'antipoison(*)': { items: [{ id: 175, count: 1 }, { id: 179, count: 2 }], reason: 'Explicit mixed-dose fixture' },
        } } } });
        expect(p.unresolved).toEqual([]);
        expect(counts(p.fixtures[0]!.takeBacks)).toEqual({ 175: 1, 179: 2 });
    });

    test('unknown canonical counts cannot be filled by an override', () => {
        const text = table(
            '| S00 | coins x? [s] | - | - | 1 | test (r) |',
            '| H15 | shark x1 [u] | coins all (swap) | - | 1 | test (r) |',
            '| S19 | - | - | - | 0 | test (r) |');
        const p = plan(text, ['H15'], { overrides: { H15: { before: { coins: override(995, 12) }, takeBacks: { coins: override(995, 12) } } } });
        expect(p.ok).toBe(false);
        expect(p.unresolved[0]!.reasons.join()).toContain('unknown canonical quantity');
        expect(p.bankSeed).toBeNull();
        expect(p.seedBatches).toBeNull();
    });

    test('unfinished potions use cert links, monkey bones use exact unnoted identity', () => {
        const p = plan(table(
            '| S00 | - | - | - | 0 | test (r) |',
            '| H21d | guam potion (unf) @91 x358 [n]; irit potion (unf) @101 x82 [n]; monkey bones @3183 x1 [u]; superantipoison(1) @185 x1 [u] | - | - | 4 | test (r) |',
            '| S25d | - | - | - | 0 | test (r) |'), ['H21d']);
        expect(p.unresolved).toEqual([]);
        expect(counts(p.fixtures[0]!.receive)).toEqual({ 92: 358, 102: 82, 3183: 1, 185: 1 });
        expect(counts(p.bankSeed!)).toEqual({ 91: 358, 101: 82, 3183: 1, 185: 1 });
        expect(p.seedBatches!.every(b => fixtureSlots(b) <= 28)).toBe(true);
        expect(p.seedBatches!.flat().some(i => i.id === 92 && i.count === 358)).toBe(true);
    });

    test('receiver pre- and post-swap capacity and helper full reserve fail closed', () => {
        const make = (held: number, incoming: number) => table(
            '| S00 | logs @1511 x' + held + ' [u] | - | - | 0 | test (r) |',
            '| H1 | shark x' + incoming + ' [u] | - | - | 0 | test (r) |',
            '| S01 | - | - | - | 0 | test (r) |');
        expect(plan(make(28, 1), ['H1']).unresolved[0]!.reasons.join()).toContain('recipient after swap');
        expect(plan(make(29, 1), ['H1']).unresolved[0]!.reasons.join()).toContain('recipient before');
        expect(plan(make(1, 29), ['H1']).ok).toBe(false);
    });

    test('unknown counts in outs are not canonical handoff implicit all', () => {
        const p = plan(table(
            '| S00 | logs x1 [u] | - | - | 1 | test (r) |',
            '| H1 | shark x1 [u] | logs x? (swap) | - | 1 | test (r) |',
            '| S01 | - | - | - | 0 | test (r) |'), ['H1']);
        expect(p.unresolved[0]!.reasons.join()).toContain('unknown canonical return quantity');
    });

    test('unresolved rows never hide resolved rows or create a partial seed plan', () => {
        // STEP-MANIFEST H15 returns placeholder stacks (`... arrow all`, `coins @995 ...`) that need explicit
        // fixtures; H19 (flour @1933) and H20 now resolve from the live rows alone.
        const p = plan(manifest, ['H15', 'H19', 'H20']);
        expect(p.fixtures.map(f => f.row)).toEqual(['H19', 'H20']);
        expect(p.unresolved.map(f => f.row)).toEqual(['H15']);
        expect(p.unresolved[0]!.reasons.join()).toContain('explicit concrete fixture override');
        expect(p.bankSeed).toBeNull();
        const ready = plan(manifest, ['H19', 'H20']);
        expect(ready.unresolved).toEqual([]);
        expect(ready.fixtures[0]!.ledger.package.items.every(i => i.id !== undefined && i.item === undefined)).toBe(true);
        expect(ready.fixtures[0]!.ledger.package.items.some(i => i.id === 1933)).toBe(true);
        expect(ready.seedBatches!.every(b => fixtureSlots(b) <= 28)).toBe(true);
    });

    test('production H3 is refused but a concrete transformed rehearsal row works', () => {
        expect(plan(manifest, ['H3']).ok).toBe(false);
        const text = table(
            '| S00 | - | - | - | 0 | test (r) |',
            '| H3 | sapphire ring @1637 x20 [u] | - | - | 20 | rehearsal transform (r) |',
            '| S04 | - | - | - | 0 | test (r) |');
        const p = plan(text, ['H3'], { itinerary: { rehearsal: { firemakingEnd: { x: 3200, z: 3200, level: 0 } } } });
        expect(p.unresolved).toEqual([]);
        expect(p.fixtures[0]!.at).toEqual({ x: 3200, z: 3200, level: 0 });
        expect(p.fixtures[0]!.receive[0]!.count).toBe(20);
    });

    test('conditional H4e uses before-final-runes checkpoint; retired H4m is never accepted', () => {
        const p = plan(manifest, [], { onRequest: ['H4e'] });
        expect(p.unresolved).toEqual([]);
        expect(p.fixtures[0]!.takeBacks[0]!.name).toBe('Rune axe');
        expect(p.fixtures[0]!.scoredArrivalAccepted).toBe(false);
        // STEP-MANIFEST: the bare retired H4m row is gone (attempt 4's loads are H4m.1-H4m.N); even an explicit fixture cannot revive it.
        expect(manifest).toContain("**H4m, attempt 4's variant, in force**");
        const retired = plan(manifest, [], { onRequest: ['H4m'], overrides: { H4m: { before: { logs: override(1511, 2) } } } });
        expect(retired.fixtures).toEqual([]);
        expect(retired.unresolved).toEqual([{ row: 'H4m', reasons: ['H4m: expected exactly one ledger row, found 0'] }]);
    });

    test("H4m's loads: fixtures from the one fallback row, after H4p; load 1 carried with H4p (22 slots), SCORED on the east stay", () => {
        const withRow = manifest.replace(/^\| H4e \|/m, '| H4m.1-H4m.3 | big bones @532 x20 [u] | - | - | 20 | fixture (r) |\n| H4e |');
        const p = plan(withRow, ['H4p', 'H4m.1', 'H4m.2', 'H4m.3']);
        expect(p.unresolved).toEqual([]);
        expect(p.fixtures.map(f => f.row)).toEqual(['H4p', 'H4m.1', 'H4m.2', 'H4m.3']);
        const [h4p, ...loads] = p.fixtures;
        expect(h4p!.carryNext).toBe('H4m.1');
        expect(h4p!.slots.helperStaged).toBe(22);
        expect(h4p!.helperAfterInventory.map(i => [i.id, i.count])).toEqual([[532, 20]]);
        for (const f of loads) {
            expect(f.at).toEqual({ x: 2606, z: 3234, level: 0 });
            expect(f.receivingArea).toEqual({ x: 2605, z: 3234, level: 0, tol: 0 });
            expect(f.receive.map(i => [i.id, i.count])).toEqual([[532, 20]]);
            expect(f.beforeInventory.map(i => [i.name, i.count])).toEqual([['Knife', 1], ['Logs', 2], ['Rune pickaxe', 1]]);
            expect(f.slots.afterSwap).toBe(24);
            expect(f.ledger.anchor).toBe('H4p');
        }
        expect(loads[1]!.carryNext).toBeUndefined();
        expect(p.bankSeed!.map(i => [i.debugName, i.count])).toEqual([['rune_pickaxe', 1], ['logs', 1], ['big_bones', 60]]);
        expect(plan(withRow, ['H4p', 'H4m.4']).unresolved[0]!.reasons.join()).toContain("not one of the manifest's H4m loads");
        expect(plan(withRow, ['H4m.1']).unresolved[0]!.reasons.join()).toContain('follows H4p');
        expect(plan(manifest, ['H4p', 'H4m.1']).unresolved[0]!.reasons.join()).toContain("not one of the manifest's H4m loads");
    });

    test('full production enumeration accounts for every ordered and conditional row', () => {
        const p = plan(manifest, [...MULE1_ORDER], { onRequest: MULE1_ON_REQUEST });
        expect(p.fixtures.length + p.unresolved.length).toBe(20);
        expect(new Set([...p.fixtures.map(f => f.row), ...p.unresolved.map(f => f.row)])).toEqual(new Set([...MULE1_ORDER, ...MULE1_ON_REQUEST]));
        console.log('FULL_ROUTE_FIXTURE_AUDIT', JSON.stringify({
            resolved: p.fixtures.map(f => ({ row: f.row, slots: f.slots })),
            unresolved: p.unresolved,
        }));
        expect(p.unresolved.find(r => r.row === 'H15')!.reasons.join()).toContain('explicit concrete fixture override');
    });

    test('explicit caller fixtures preserve untradeable and unauthorized placeholder blockers', () => {
        const p = plan(manifest, [...MULE1_ORDER], { onRequest: MULE1_ON_REQUEST, overrides: fullRouteOverrides(manifest) });
        console.log('EXPLICIT_FULL_ROUTE_FIXTURE_AUDIT', JSON.stringify({
            resolved: p.fixtures.map(f => ({ row: f.row, before: f.slots.before, afterSwap: f.slots.afterSwap, helperAfterSwap: f.slots.helperAfterSwap, ask: f.topUpAsk })),
            unresolved: p.unresolved,
        }));
        expect(p.fixtures.length + p.unresolved.length).toBe(20);
        // H21d's live row no longer carries a placeholder platebody return, so with explicit fixtures it resolves,
        // and H13 now drops its untradeable Khazard helmet and armour on the tile (live STEP-MANIFEST H13).
        // The retired on-request H4m is no longer among mule1's on-request rows (H4m's loads are h55's, in order).
        expect(p.unresolved).toEqual([]);
        // The untradeable blocker stands: the same live row with those drops written as swaps is refused.
        expect(manifest).toContain(KHAZARD_DROPS);
        const swapped = manifest.replace(KHAZARD_DROPS, KHAZARD_SWAPS);
        const s = plan(swapped, ['H13']);
        expect(s.unresolved.map(r => r.row)).toEqual(['H13']);
        expect(s.unresolved[0]!.reasons.join()).toContain('untradeable');
        expect(p.fixtures.find(f => f.row === 'H21d')!.takeBacks.map(i => i.name)).toEqual(['Hammer']);
        expect(p.fixtures.find(f => f.row === 'H15')!.takeBacks.find(i => i.id === 995)!.count).toBe(22450);
        expect(p.fixtures.find(f => f.row === 'H14')!.receivingArea).toMatchObject({ x: 2670, z: 3305 });
    });

    test('a greegree is held, never worn, at an off-atoll meeting (the engine unequips it leaving its zone)', () => {
        const p = plan(manifest, ['H13'], { overrides: fullRouteOverrides(manifest) });
        expect(p.unresolved).toEqual([]);
        const f = p.fixtures[0]!;
        expect(f.beforeEquipment.some(i => /greegree/i.test(i.name))).toBe(false);
        expect(f.beforeInventory.some(i => /greegree/i.test(i.name))).toBe(true);
        expect(f.afterEquipment.some(i => /greegree/i.test(i.name))).toBe(false);
        expect(f.afterInventory.some(i => /greegree/i.test(i.name))).toBe(true);
        expect(f.takeBacks.some(i => /greegree|khazard/i.test(i.name))).toBe(false);
    });

    test('owner-authorized lab projection pins ordinary IDs and has no H21d platebody', () => {
        const projected = readFileSync(new URL('../../docs/speedrun/research/mule-delivery-ledger.md', import.meta.url), 'utf8');
        const provenance = JSON.parse(readFileSync(new URL('../../docs/speedrun/research/mule-delivery-ledger.provenance.json', import.meta.url), 'utf8'));
        expect(createHash('sha256').update(projected).digest('hex')).toBe(provenance.projection.sha256);
        expect(provenance.purpose).toBe('LAB_ONLY_NOT_LIVE_AUTHORIZATION');
        const parsed = parseLedger(projected);
        expect(parsed.errors).toEqual([]);
        expect(walk(parsed.rows).filter(e => e.verdict === 'ERROR')).toEqual([]);
        const h21d = parsed.rows.find(r => r.row === 'H21d')!;
        expect(h21d.out.map(itemLabel)).toEqual(['hammer']);
        expect(parsed.rows.find(r => r.row === 'S25a')!.in).toEqual([]);
        for (const row of parsed.rows) for (const item of [...row.in, ...row.out]) {
            const expected = ({ logs: 1511, coins: 995, 'pot of flour': 1933 } as Record<string, number>)[item.name];
            if (expected !== undefined) expect(item.id).toBe(expected);
        }
        // The projection's H13 was refreshed to the live drop of the untradeable Khazard pieces.
        expect(projected).toContain(KHAZARD_DROPS);
        const p = plan(projected, [...MULE1_ORDER], { onRequest: MULE1_ON_REQUEST, overrides: fullRouteOverrides(projected) });
        expect(p.unresolved).toEqual([]);
        expect(p.fixtures).toHaveLength(20);
        const blocked = plan(projected.replace(KHAZARD_DROPS, KHAZARD_SWAPS), ['H13']);
        expect(blocked.unresolved[0]!.reasons.join()).toContain('untradeable');
        const f = p.fixtures.find(f => f.row === 'H21d')!;
        expect(f.beforeInventory.map(i => i.id)).toEqual([2347]);
        expect(f.takeBacks.map(i => i.id)).toEqual([2347]);
        expect(f.slots.afterSwap).toBe(17);
        console.log('PROJECTED_FULL_ROUTE_FIXTURE_AUDIT', JSON.stringify({
            resolved: p.fixtures.map(f => ({ row: f.row, slots: f.slots })),
            unresolved: p.unresolved,
        }));
    });

    test('canonical carry selection preserves the next kit and all twenty returned rings', () => {
        const p = plan(manifest, ['H4', 'H4k'], { overrides: fullRouteOverrides(manifest) });
        expect(p.unresolved).toEqual([]);
        const [first, next] = p.fixtures;
        expect(first!.carryNext).toBe('H4k');
        expect(first!.slots.helperStaged).toBe(18);
        expect(first!.slots.helperAfterSwap).toBe(23);
        expect(next!.slots.helperStaged).toBe(23);
        expect(next!.slots.helperAfterSwap).toBe(20);
        expect(counts(next!.helperAfterInventory)).toEqual({ 2550: 20 });
    });

    test('bank seed batching splits unnoteable objects and uses nonadjacent cert links', () => {
        const pack = parseObjPack('10=unnotable\n20=thing\n99=cert_thing');
        const catalog = new Map([[10, { name: 'Unnotable', stackable: false }], [20, { name: 'Thing', stackable: false }]]);
        const batches = fixtureSeedBatches([
            { id: 10, bankId: 10, count: 60, name: 'Unnotable', debugName: 'unnotable', kind: 'u' },
            { id: 20, bankId: 20, count: 500, name: 'Thing', debugName: 'thing', kind: 'u' },
        ], pack, catalog);
        expect(batches.map(fixtureSlots)).toEqual([28, 28, 5]);
        expect(batches.flat().find(i => i.id === 99)!.count).toBe(500);
        expect(batches.flat().filter(i => i.id === 10).reduce((n, i) => n + i.count, 0)).toBe(60);
    });

    test('incoming overrides reject wrong count, object, kind, unknown keys and missing reason', () => {
        const text = table('| H1 | logs x1 [u] | - | - | 1 | test (r) |', '| S01 | - | - | - | 0 | test (r) |');
        for (const chosen of [override(1511, 2), override(385, 1), override(1512, 1), { items: [{ id: 1511, count: 1 }], reason: '' }]) {
            expect(plan(text, ['H1'], { overrides: { H1: { receive: { logs: chosen } } } }).ok).toBe(false);
        }
        expect(plan(text, ['H1'], { overrides: { H1: { receive: { stale: override(1511, 1) } } } }).ok).toBe(false);
        expect(plan(text, ['H1'], { overrides: { H1: { receive: { logs: override(1511, 1) } } } }).ok).toBe(true);
    });

    test('malformed selection, duplicate and missing rows are explicit diagnostics', () => {
        expect(plan(manifest, []).unresolved[0]!.row).toBe('<selection>');
        expect(plan(manifest, ['H1', 'H1']).unresolved).toHaveLength(2);
        expect(plan(manifest, ['H999']).unresolved[0]!.reasons.join()).toContain('exactly one ledger row');
        expect(plan(manifest, ['H20', 'H19']).unresolved.find(r => r.row === 'H19')!.reasons.join()).toContain('ledger order');
    });
});
