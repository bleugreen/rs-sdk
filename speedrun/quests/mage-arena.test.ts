import { describe, expect, test } from 'bun:test';
import { PRAYER_INDICES, type BotWorldState, type GroundItem, type InventoryItem, type NearbyNpc, type PlayerState } from '../../sdk/types';
import { drive, FakeSdk, baseState, runeNeedProblems } from '../lib/fake-sdk';
import { TickLog } from '../lib/ticks';
import type { Observed, StepContext } from '../runner/step';
import {
    AIR_RUNES, ARRIVAL, barredReason, entryRefusal, exitClean, exitDropItems, exitMagic, FALLBACK_RUNES, fightKolodion, fightReady, formPicker, KEEP_SHARKS, kit, LETTERS, newTally, quest,
    FIRE_WAVE_MAX_CASTS, RUNE_NEED, RUNE_USE, SPELL_RUNES, SPELLS, spellReady, spentKit, stepId, steps, type Options,
} from './mage-arena';
import { Observation, resolveResume } from '../runner/resume';
import type { RunnerSession } from '../runner/step';
import { prayerReserve } from './segments';
import { readFileSync } from 'fs';
import { MANIFEST, parseLedger, walk } from '../tools/slot-ledger';

// Config ids from server/content/pack/obj.pack: entryRefusal reads the categories by id.
const ID = {
    khazardHelmet: 74, khazardPlatemail: 75, shark: 385, air: 556, blood: 565, death: 560, runeArrow: 892, knife: 946,
    leatherGloves: 1059, staffOfFire: 1387, bowString: 1777, saradominCape: 2412, saradominStaff: 2415,
    prayerPotion: 2434, magicPotion: 3040, amulet: 4021, greegree: 4024, water: 555, law: 563,
} as const;

let nextSlot = 0;
const item = (name: string, id: number, count = 1, ops: string[] = []): InventoryItem =>
    ({ slot: nextSlot++, id, name, count, optionsWithIndex: ops.map((text, i) => ({ text, opIndex: i + 1 })) }) as unknown as InventoryItem;
const skill = (name: string, base: number, boosted = base) => ({ name, level: boosted, baseLevel: base, experience: 0 });
const player = (x: number, z: number, hp = 97): PlayerState => ({ name: 'lab', x, z, worldX: x, worldZ: z, level: 0, hp, maxHp: 97 }) as PlayerState;
const sharks = (n: number) => Array.from({ length: n }, () => item('Shark', ID.shark, 1, ['Eat']));

const CHAMBER_AT = { x: 2509, z: 4689 };
const ARENA_AT = { x: 3105, z: 3934 };

/** SCORED on the arrival tile in Kolodion's cellar with the ledger's S16 pack after H13 (lab fixture A). */
function arrival(over: Partial<BotWorldState> = {}, o: { magic?: number; boosted?: number; prayer?: number; points?: number } = {}): BotWorldState {
    nextSlot = 0;
    return baseState({
        tick: 100,
        player: player(ARRIVAL.x, ARRIVAL.z),
        skills: [skill('Magic', o.magic ?? 77, o.boosted ?? o.magic ?? 77), skill('Prayer', o.prayer ?? 94), skill('Hitpoints', 97)],
        prayers: { activePrayers: [], prayerPoints: o.points ?? 40, prayerLevel: o.prayer ?? 94 },
        equipment: [item('Staff of fire', ID.staffOfFire), item("M'speak amulet", ID.amulet)],
        inventory: [
            item('Water rune', ID.water, 8), item('Law rune', ID.law, 7), item('Air rune', ID.air, 756), item('Blood rune', ID.blood, 90), item('Death rune', ID.death, 25),
            ...Array.from({ length: 4 }, () => item('Prayer potion(4)', ID.prayerPotion, 1, ['Drink'])),
            item('Magic potion(4)', ID.magicPotion, 1, ['Drink']),
            ...sharks(9), item('Knife', ID.knife), item('Monkey greegree', ID.greegree, 1, ['Hold']),
        ],
        ...over,
    } as Partial<BotWorldState>);
}

const at = (s: BotWorldState, p: { x: number; z: number }): BotWorldState => ({ ...s, player: player(p.x, p.z) });
const without = (s: BotWorldState, re: RegExp): BotWorldState => ({ ...s, inventory: s.inventory.filter(i => !re.test(i.name)) });
const withInv = (s: BotWorldState, ...items: InventoryItem[]): BotWorldState => ({ ...s, inventory: [...s.inventory, ...items] });
const ground = (name: string, id: number, distance: number): GroundItem => ({ id, name, count: 1, x: CHAMBER_AT.x, z: CHAMBER_AT.z, distance });
const obs = (state: BotWorldState): Observed => ({ state, probed: {} });
const filler = (n: number) => Array.from({ length: n }, () => item('Knife', ID.knife));

const letterOf = (name: string) => name.split(':')[1]!.split('-')[0]!;
const seg = (l: string, opts?: Options) => steps(opts).find(s => letterOf(s.name) === l)!;

// ------------------------------------------------------------------ the table

describe('segment table', () => {
    test('S16 magearena, A..F in order, named per the brief', () => {
        expect(stepId).toBe('S16');
        expect(quest).toBe('magearena');
        expect(steps().map(s => s.name)).toEqual(['S16:A-kit', 'S16:B-kolodion', 'S16:C-fight', 'S16:D-pool', 'S16:E-statue', 'S16:F-guardian']);
        expect(steps().map(s => letterOf(s.name))).toEqual([...LETTERS]);
    });
    test('logout-unsafe only from the talk through the fight; D-F leave durable marks, C resumes in the arena', () => {
        const list = steps();
        expect(list.map(s => s.logoutSafe)).toEqual([true, false, false, true, true, true]);
        expect(list.slice(3).every(s => typeof s.done === 'function')).toBe(true);
        expect(typeof list[2]!.inProgress).toBe('function');
    });
    test('both dialogue modes and both spells build the same table', () => {
        const names = steps().map(s => s.name);
        expect(steps({ dialogue: 'fixed' }).map(s => s.name)).toEqual(names);
        expect(steps({ spell: 'fire_blast' }).map(s => s.name)).toEqual(names);
    });
});

// ------------------------------------------------------------------ spells and kit

describe('spells and kit (H13)', () => {
    test('Fire Wave by default: 90 blood, 25 death behind it, 550 air', () => {
        expect(kit('fire_wave').map(k => [String(k.item), k.n])).toEqual([
            [String(/^blood rune$/i), 90], [String(/^death rune$/i), FALLBACK_RUNES], [String(/^air rune$/i), AIR_RUNES],
        ]);
        expect(FALLBACK_RUNES).toBe(25);
    });
    test('Fire Blast has no fallback; spellRunes lowers only the spell\'s count', () => {
        expect(kit('fire_blast').map(k => k.n)).toEqual([90, AIR_RUNES]);
        expect(kit('fire_wave', 20).map(k => k.n)).toEqual([20, FALLBACK_RUNES, AIR_RUNES]);
    });
    test('the Fire Blast option: death runes, 90 (lab max 78 + 12), 4 air a cast', () => {
        expect(SPELL_RUNES.fire_blast).toBe(90);
        expect(SPELLS.fire_blast.air).toBe(4);
        expect(SPELLS.fire_wave.air).toBe(5);
        expect(String(kit('fire_blast')[0]!.item)).toBe(String(/^death rune$/i));
    });
    test('Fire Wave wants boosted 75: base 77 passes, base 74 only with a magic potion held', () => {
        expect(spellReady('fire_wave')(arrival(), undefined)).toBe(true);
        expect(spellReady('fire_wave')(arrival({}, { magic: 74 }), undefined)).toBe(true);
        expect(spellReady('fire_wave')(without(arrival({}, { magic: 74 }), /magic potion/i), undefined)).toMatch(/needs Magic 75.*base 74.*no magic potion/);
        expect(spellReady('fire_wave')(without(arrival({}, { magic: 74, boosted: 78 }), /magic potion/i), undefined)).toBe(true);
        expect(spellReady('fire_wave')(without(arrival({}, { magic: 70 }), /x^/), undefined)).not.toBe(true);
    });
    test('Fire Blast needs only 59', () => {
        expect(spellReady('fire_blast')(without(arrival({}, { magic: 60 }), /magic potion/i), undefined)).toBe(true);
    });
    test('prayer budget counts each dose at its restore (7 + level/4)', () => {
        expect(prayerReserve(arrival())).toBe(40 + 16 * (7 + 23));
        expect(prayerReserve(without(arrival({}, { points: 20 }), /prayer potion/i))).toBe(20);
    });
});

// ------------------------------------------------------------------ Kolodion's entry check

describe("Kolodion's entry check (mage_arena.rs2 ~can_enter_mage_arena)", () => {
    test('the S16 pack passes: staff of fire and amulet worn; runes, potions, sharks, knife, gree-gree carried', () => {
        expect(entryRefusal(arrival())).toBeNull();
    });
    test("H13's take-backs are refused carried: the Khazard helmet and platemail", () => {
        const s = withInv(arrival(), item('Khazard helmet', ID.khazardHelmet), item('Khazard armour', ID.khazardPlatemail));
        const r = entryRefusal(s)!;
        expect(r).toContain('Khazard helmet carried (armour_helmet)');
        expect(r).toContain('Khazard armour carried (armour_body)');
    });
    test('armour worn is refused too', () => {
        const s = arrival();
        s.equipment = [...s.equipment, item('Khazard helmet', ID.khazardHelmet), item('Khazard armour', ID.khazardPlatemail)];
        expect(entryRefusal(s)).toMatch(/Khazard helmet worn \(armour_helmet\).*Khazard armour worn \(armour_body\)/);
    });
    test('the check goes by category, not by slot: leather gloves are category gloves, not armour_hands, and pass', () => {
        const s = arrival();
        s.equipment = [...s.equipment, item('Leather gloves', ID.leatherGloves)];
        expect(entryRefusal(s)).toBeNull();
    });
    test("MM's leftover rune arrows: refused quivered and carried", () => {
        const quivered = arrival();
        quivered.equipment = [...quivered.equipment, item('Rune arrow', ID.runeArrow, 12)];
        expect(entryRefusal(quivered)).toContain('Rune arrow worn (arrows)');
        expect(entryRefusal(withInv(arrival(), item('Rune arrow', ID.runeArrow, 12)))).toContain('Rune arrow carried (arrows)');
    });
    test('a bow string is barred carried only (the check reads inv for it)', () => {
        const bs = item('Bow string', ID.bowString);
        expect(barredReason(bs, 'carried')).toBe('bow_string');
        expect(barredReason(bs, 'worn')).toBeNull();
    });
    test('unknown ids pass (only the configs decide)', () => {
        expect(barredReason({ id: 999_999, name: 'Mystery' }, 'carried')).toBeNull();
    });
});

// ------------------------------------------------------------------ A

describe('A: preconditions on the arrival tile', () => {
    const pre = (s: BotWorldState, o?: Options) => seg('A', o).preconditions(s, {});

    test('the arrival pack passes', () => {
        expect(pre(arrival())).toBe(true);
    });
    test('outside the cellar fails', () => {
        expect(pre(at(arrival(), { x: 2539, z: 4740 }))).toMatch(/Kolodion's cellar/);
    });
    test("base Magic below Kolodion's 60 fails", () => {
        expect(pre(arrival({}, { magic: 59 }))).toMatch(/base Magic 60/);
    });
    test('the staff of fire not wielded fails', () => {
        const s = arrival();
        s.equipment = s.equipment.filter(i => !/staff/i.test(i.name));
        expect(pre(s)).toMatch(/staff of fire is not wielded/);
    });
    test('Prayer below 37 fails (Protect from Magic)', () => {
        expect(pre(arrival({}, { prayer: 36 }))).toMatch(/Protect from Magic needs Prayer 37/);
    });
    test('the entry check is a precondition: a Khazard helmet carried fails', () => {
        expect(pre(withInv(arrival(), item('Khazard helmet', ID.khazardHelmet)))).toMatch(/Kolodion's entry check.*Khazard helmet/);
    });
    test('free slots must cover the cape (E) and the staff (F): 2 free pass, 1 free names the shortfall', () => {
        const base = arrival();
        const two = withInv(base, ...filler(28 - base.inventory.length - 2));
        expect(pre(two)).toBe(true);
        const one = withInv(base, ...filler(28 - base.inventory.length - 1));
        expect(pre(one)).toBe('inventory: segment F needs 2 free slots (1 God cape, 1 God staff), 1 free: 1 short');
    });
});

describe('A: postconditions (kit held, fight ready)', () => {
    const post = (s: BotWorldState, o?: Options) => seg('A', o).postconditions(s, {});

    test('the gree-gree must be gone', () => {
        expect(post(arrival())).toMatch(/monkey greegree is still held/);
        expect(post(without(arrival(), /greegree/i))).toBe(true);
    });
    test('89 blood is short of the Fire Wave kit', () => {
        const s = without(arrival(), /greegree/i);
        s.inventory = s.inventory.map(i => (/blood/i.test(i.name) ? { ...i, count: 89 } : i));
        expect(post(s)).toMatch(/kit missing: 1 x/);
    });
    // fightReady is B's start check; a part-spent kit is also B's restart entry (the spent-kit tests below).
    test("B's start check names both rune counts: blood >= 90 and death >= 25", () => {
        const s = without(without(arrival(), /greegree/i), /death/i);
        s.inventory = s.inventory.map(i => (/blood/i.test(i.name) ? { ...i, count: 70 } : i));
        expect(fightReady('fire_wave')(s, {})).toBe('kit (H13): blood rune 70 held, want >= 90; death rune 0 held, want >= 25');
    });
    test('the lab\'s spellRunes lowers the blood the start check wants', () => {
        const s = without(arrival(), /greegree/i);
        s.inventory = s.inventory.map(i => (/blood/i.test(i.name) ? { ...i, count: 20 } : i));
        expect(fightReady('fire_wave')(s, {})).toMatch(/blood rune 20 held, want >= 90/);
        expect(fightReady('fire_wave', 20)(s, {})).toBe(true);
        expect(seg('B', { spellRunes: 20 }).preconditions(s, {})).toBe(true);
    });
    test('the Fire Blast option wants 90 death runes instead', () => {
        const s = without(arrival(), /greegree/i);
        expect(post(s, { spell: 'fire_blast' })).toMatch(/kit missing: 65 x \/\^death rune\$\/i/);
        expect(post(withInv(s, item('Death rune', ID.death, 65)), { spell: 'fire_blast' })).toBe(true);
    });
    test('the prayer budget below 90 fails', () => {
        const s = without(without(arrival({}, { points: 40 }), /greegree/i), /prayer potion/i);
        expect(post(s)).toMatch(/prayer: 40 points and 0 potion doses make 40, the fight wants 90/);
    });
});

describe('A: run drops the gree-gree', () => {
    test('the kit is held, so no trade: one drop click and the gree-gree is gone', async () => {
        const sdk = new FakeSdk(arrival());
        const drops: number[] = [];
        sdk.onSend = a => { if (a.method === 'sendDropItem') drops.push(a.args[0] as number); };
        const each = (s: BotWorldState): Partial<BotWorldState> => (drops.length ? { inventory: s.inventory.filter(i => !drops.includes(i.slot)) } : {});
        const ctx = { sdk, c: {}, log: TickLog.memory('t') } as unknown as StepContext<unknown>;
        await drive(sdk, seg('A').run(ctx) as Promise<unknown>, 30, each);
        expect(sdk.sent.filter(a => a.method === 'sendDropItem').length).toBe(1);
        expect(seg('A').postconditions(sdk.getState()!, {})).toBe(true);
    });
});

// ------------------------------------------------------------------ B..E

describe('B and C: the arena', () => {
    test('C is in progress in the arena, not in the cellar', () => {
        expect(seg('C').inProgress!(obs(at(arrival(), ARENA_AT)), {})).toBe(true);
        expect(seg('C').inProgress!(obs(arrival()), {})).toBe(false);
    });
    test("B's postcondition wants the arena (or the fight already won)", () => {
        expect(seg('B').postconditions(at(arrival(), ARENA_AT), {})).toBe(true);
        expect(seg('B').postconditions(arrival(), {})).toMatch(/not in the arena/);
        expect(seg('B', { fought: true }).postconditions(arrival(), {})).toBe(true);
    });
    test("C's postcondition: back in the cellar with Kolodion's pages closed", () => {
        const s = arrival();
        expect(seg('C').postconditions(s, {})).toBe(true);
        expect(seg('C').postconditions({ ...s, dialog: { ...s.dialog, isOpen: true } }, {})).toMatch(/dialogue/);
    });
});

describe('B after a runner process restart: the fight won in an earlier process (rs/185 P1)', () => {
    /** The cellar with `blood` and `death` of H13's spell stacks, 200 air and the prayer spent: what a won fight leaves. */
    const cellar = (blood: number, death: number): BotWorldState => {
        const s = without(arrival({}, { points: 12 }), /greegree|prayer potion/i);
        return { ...s, inventory: s.inventory.map(i => (/^blood rune$/i.test(i.name) ? { ...i, count: blood } : /^death rune$/i.test(i.name) ? { ...i, count: death } : /^air rune$/i.test(i.name) ? { ...i, count: 200 } : i)).filter(i => i.count > 0) };
    };
    const walk = (s: BotWorldState) => resolveResume(steps(), new Observation(s, {}, {} as RunnerSession), {});

    test('spentKit: some of the spell stacks held and one below the kit; none (before A) or the full kit is not spent', () => {
        const spent = spentKit('fire_wave');
        expect([spent(cellar(40, 25)), spent(cellar(0, 12)), spent(cellar(89, 25)), spent(cellar(90, 24))]).toEqual([true, true, true, true]);
        expect([spent(cellar(0, 0)), spent(cellar(90, 25))]).toEqual([false, false]);
        expect(spentKit('fire_blast')(cellar(0, 40))).toBe(true);
    });

    test('a fresh steps() in the cellar with 40 blood / 25 death resolves B, and 0 blood / 12 death (the guard spent) too', async () => {
        for (const [b, d] of [[40, 25], [0, 12]] as const) {
            const p = await walk(cellar(b, d));
            expect([p.step, p.mode]).toEqual(['S16:B-kolodion', 'run']);
        }
    });

    test('0/0 (before A) does not resolve B; 90/25 resolves B on the start check as today', async () => {
        const before = await walk(cellar(0, 0)).catch((e: Error) => e);
        expect(before instanceof Error ? before.message : before.step).not.toBe('S16:B-kolodion');
        const ready = without(arrival(), /greegree/i);
        expect(fightReady('fire_wave')(ready, {})).toBe(true);
        expect([(await walk(ready)).step]).toEqual(['S16:B-kolodion']);
    });

    /** Kolodion beside SCORED; the fake server opens `pages` one at a time on the talk and each continue, and closes on close-modal. */
    function kolodionSdk(s: BotWorldState, pages: string[]) {
        const kol = { kind: 'npc', id: 905, index: 41, name: 'Kolodion', combatLevel: 0, x: ARRIVAL.x + 1, z: ARRIVAL.z, distance: 1, hp: null, optionsWithIndex: [{ text: 'Talk-to', opIndex: 1 }] } as unknown as NearbyNpc;
        const sdk = new FakeSdk({ ...s, nearbyNpcs: [kol] });
        const show = (text: string) => ({ dialog: { isOpen: true, options: [], isWaiting: false, allComponents: [{ text }] } }) as unknown as Partial<BotWorldState>;
        const closed = { dialog: { isOpen: false, options: [], isWaiting: false } } as unknown as Partial<BotWorldState>;
        let next = 0;
        let pending: Partial<BotWorldState> | null = null;
        sdk.onSend = a => {
            if (a.method === 'sendInteractNpc' && next === 0) pending = show(pages[next++]!);
            else if ((a.method === 'sendClickDialog' || a.method === 'clickDialogByText') && next < pages.length) pending = show(pages[next++]!);
            else if (a.method === 'sendCloseModal') pending = closed;
        };
        const each = (): Partial<BotWorldState> => {
            const p = pending;
            pending = null;
            return p ?? {};
        };
        const ctx = { sdk, c: {}, log: TickLog.memory('t') } as unknown as StepContext<unknown>;
        return { sdk, each, ctx };
    }
    const continues = (sdk: FakeSdk) => sdk.sent.filter(a => a.method === 'sendClickDialog' || a.method === 'clickDialogByText').length;

    test("'You're a tough one': B sets the fight won, closes the talk; C is then skipped and D can start in the same steps()", async () => {
        const list = steps();
        const s = cellar(40, 25);
        const { sdk, each, ctx } = kolodionSdk(s, ['Hello, Kolodion.', "Hello, young mage. You're a tough one.", 'What now?']);
        await drive(sdk, list[1]!.run(ctx) as Promise<unknown>, 40, each);
        const end = sdk.getState()!;
        expect(end.dialog.isOpen).toBe(false);
        expect(continues(sdk)).toBe(1);
        expect(sdk.sent.some(a => a.method === 'sendCloseModal')).toBe(true);
        expect(list[1]!.postconditions(end, {})).toBe(true);
        expect(list[2]!.preconditions(end, {})).toBe(true);
        expect(list[2]!.postconditions(end, {})).toBe(true);
        expect(list[3]!.preconditions(end, {})).toBe(true);
    });

    test("'Hi.' (1-5, the next page is the arena teleport): closed unanswered, and B throws for the operator", async () => {
        const list = steps();
        const { sdk, each, ctx } = kolodionSdk(cellar(40, 25), ['Hi.', 'You return, young conjurer. You obviously have a taste for the dark side of magic.']);
        await expect(drive(sdk, list[1]!.run(ctx) as Promise<unknown>, 40, each)).rejects.toThrow(
            'kolodion: kit spent (blood rune 40, death rune 25) and the fight is not won (his talk opened "Hi."): H13 cannot resupply'
        );
        expect(continues(sdk)).toBe(0);
        expect(sdk.sent.some(a => a.method === 'sendCloseModal')).toBe(true);
        expect(sdk.getState()!.dialog.isOpen).toBe(false);
        expect(list[3]!.preconditions(sdk.getState()!, {})).toMatch(/fight is not known to be won/);
    });

    test("a takeover in the arena with Kolodion's form attacking resolves C through its resume entry (the fight's own run), not a hold", async () => {
        const s = at(without(arrival(), /greegree/i), ARENA_AT);
        const fighting = { ...s, player: { ...s.player!, combat: { inCombat: true, lastDamageTick: s.tick - 1, targetIndex: 9001, targetType: 'npc' } } } as BotWorldState;
        const p = await walk(fighting);
        expect([p.step, p.mode]).toEqual(['S16:C-fight', 'resume']);
    });

    test('a full kit (90/25) runs B as today: the fight talk, never the spent-kit ask', async () => {
        const ready = without(arrival(), /greegree/i);
        const { sdk, each, ctx } = kolodionSdk(ready, ['Hello there. What is this place?']);
        // Today\'s talk sets Protect from Magic first: its click is the first send, before any talk.
        await drive(sdk, steps()[1]!.run(ctx) as Promise<unknown>, 6, each).catch(() => undefined);
        expect(sdk.sent[0]?.method).not.toBe('sendInteractNpc');
    });
});

describe("formPicker: this fight's own form, never an earlier fight's leftover", () => {
    const form = (id: number, index: number, hp: number | null = 100): NearbyNpc =>
        ({ kind: 'npc', id, index, name: 'Kolodion', combatLevel: 0, x: ARENA_AT.x, z: ARENA_AT.z, distance: 3, hp, optionsWithIndex: [{ text: 'Attack', opIndex: 2 }] }) as unknown as NearbyNpc;
    const view = (...npcs: NearbyNpc[]) => ({ ...at(arrival(), ARENA_AT), nearbyNpcs: npcs });

    test('a fight resumed in the arena starts at the lowest form in view and steps on as the next id appears', () => {
        const p = formPicker();
        expect(p.current(view(form(909, 50)))?.index).toBe(50);
        expect(p.stage).toBe(2);
        expect(p.current(view(form(910, 51)))?.index).toBe(51);
        expect(p.stage).toBe(3);
    });
    test('a dead form (hp 0) is not a target', () => {
        expect(formPicker().current(view(form(907, 40, 0)))).toBeUndefined();
    });
    test('the leftover 911 seen on the landing tick is ignored: the stage starts at the new 907 and stays on it', () => {
        const p = formPicker([8152]);
        expect(p.current(view(form(911, 8152)))).toBeUndefined();
        expect(p.current(view(form(911, 8152), form(907, 8153)))?.index).toBe(8153);
        expect(p.stage).toBe(0);
    });
    test('reaching stage 911 later, the fight takes its own 911, not the leftover', () => {
        const p = formPicker([8152]);
        p.current(view(form(911, 8152), form(910, 8160)));
        expect(p.stage).toBe(3);
        // 910 gone, the leftover still standing, the new demon spawned
        expect(p.current(view(form(911, 8152), form(911, 8161)))?.index).toBe(8161);
        expect(p.current(view(form(911, 8152)))).toBeUndefined();
    });
    test('without the landing record the old rule locks onto the leftover (the bgsrv-ub burst run 3 failure)', () => {
        const p = formPicker();
        p.current(view(form(911, 8152)));
        expect(p.current(view(form(911, 8152), form(907, 8153)))?.index).toBe(8152);
    });
});

describe('fightKolodion: Fire Wave finishes on Fire Blast when the blood runs out', () => {
    const WAVE = 1189;
    const BLAST = 1181;

    /**
     * SCORED in the arena under Protect from Magic against Kolodion's demon with `hp` casts to go. The
     * fake server spends the cast spell's rune (blood for Wave, death for Blast) and its air a tick
     * later, and a cast with no rune does nothing; the last hit lands SCORED in the cellar.
     */
    function arena(blood: number, death: number, hp: number) {
        nextSlot = 0;
        const active = Array.from({ length: 15 }, (_, i) => i === PRAYER_INDICES.protect_from_magic);
        const demon = { kind: 'npc', id: 911, index: 9001, name: 'Kolodion', combatLevel: 0, x: ARENA_AT.x, z: ARENA_AT.z, distance: 3, hp: 100, optionsWithIndex: [{ text: 'Attack', opIndex: 2 }] } as unknown as NearbyNpc;
        const s = baseState({
            tick: 100,
            player: player(ARENA_AT.x, ARENA_AT.z),
            skills: [skill('Magic', 77), skill('Prayer', 94), skill('Hitpoints', 97)],
            prayers: { activePrayers: active, prayerPoints: 60, prayerLevel: 94 },
            inventory: [item('Blood rune', ID.blood, blood), item('Death rune', ID.death, death), item('Air rune', ID.air, 400)].filter(i => i.count > 0),
            nearbyNpcs: [demon],
        } as Partial<BotWorldState>);
        const sdk = new FakeSdk(s);
        const sent: number[] = [];
        let pending: number | undefined;
        let left = hp;
        sdk.onSend = a => {
            if (a.method !== 'sendSpellOnNpc') return;
            sent.push(a.args[1] as number);
            pending = a.args[1] as number;
        };
        const spend = (inv: InventoryItem[], re: RegExp, n: number) => inv.map(i => (re.test(i.name) ? { ...i, count: i.count - n } : i)).filter(i => i.count > 0);
        const each = (st: BotWorldState): Partial<BotWorldState> => {
            const comp = pending;
            pending = undefined;
            const rune = comp === WAVE ? /^blood rune$/i : comp === BLAST ? /^death rune$/i : null;
            if (!rune || !st.inventory.some(i => rune.test(i.name))) return {};
            const inventory = spend(spend(st.inventory, rune, 1), /^air rune$/i, comp === WAVE ? 5 : 4);
            if (--left > 0) return { inventory };
            return { inventory, nearbyNpcs: [], player: player(2540, 4716) };
        };
        return { sdk, each, sent };
    }

    test('4 blood and 25 death against 10 casts: 4 Waves, then Blasts on the same form to the finish', async () => {
        const a = arena(4, 25, 10);
        const tally = newTally();
        await drive(a.sdk, fightKolodion(a.sdk as never, { tally }), 200, a.each);
        expect(tally.runesUsed).toBe(4);
        expect(tally.fallback).toMatchObject({ spell: 'fire_blast', runesUsed: 6 });
        expect(tally.fallback!.at).toBeGreaterThan(0);
        expect(tally.casts).toBe(10);
        expect(tally.airUsed).toBe(4 * 5 + 6 * 4);
        // every Wave click comes before every Blast click
        expect(a.sent.lastIndexOf(WAVE)).toBeLessThan(a.sent.indexOf(BLAST));
    });
    test('enough blood: no fallback, no death rune spent; the ignored leftovers are on the tally', async () => {
        const a = arena(20, 25, 10);
        const tally = newTally();
        await drive(a.sdk, fightKolodion(a.sdk as never, { tally, ignore: [8161] }), 200, a.each);
        expect(tally.ignored).toEqual([8161]);
        expect(tally.fallback).toBeNull();
        expect(tally.casts).toBe(10);
        expect(a.sent).not.toContain(BLAST);
    });
    test('no death runes behind the blood: the fight throws, naming the rune', async () => {
        const a = arena(3, 0, 10);
        await expect(drive(a.sdk, fightKolodion(a.sdk as never, {}), 200, a.each)).rejects.toThrow(/out of Blood runes at form 911/);
    });
    test('the fallback runs out too: the fight throws after it', async () => {
        const a = arena(2, 2, 10);
        await expect(drive(a.sdk, fightKolodion(a.sdk as never, {}), 200, a.each)).rejects.toThrow(/out of Death runes \(after the fire_blast fallback\)/);
    });
    test('fallback: null keeps the old behaviour', async () => {
        const a = arena(3, 25, 10);
        await expect(drive(a.sdk, fightKolodion(a.sdk as never, { fallback: null }), 200, a.each)).rejects.toThrow(/out of Blood runes/);
    });
});

describe('D and E: the pool and the statue', () => {
    const chamber = () => at(without(arrival(), /greegree/i), CHAMBER_AT);

    test('D starts only once the fight is known won (%magearena is not transmitted)', () => {
        expect(seg('D').preconditions(arrival(), {})).toMatch(/not known to be won/);
        expect(seg('D', { fought: true }).preconditions(arrival(), {})).toBe(true);
    });
    test('D is done in the chamber, or with a god item, not in the cellar', () => {
        expect(seg('D').done!(obs(arrival()), {})).toBe(false);
        expect(seg('D').done!(obs(chamber()), {})).toBe(true);
        expect(seg('D').done!(obs(withInv(arrival(), item('Cape of saradomin', ID.saradominCape))), {})).toBe(true);
    });
    test('E is done with the cape held; its postcondition names the cape', () => {
        expect(seg('E').done!(obs(chamber()), {})).toBe(false);
        expect(seg('E').postconditions(chamber(), {})).toMatch(/no god cape/);
        const cape = withInv(chamber(), item('Cape of saradomin', ID.saradominCape));
        expect(seg('E').done!(obs(cape), {})).toBe(true);
        expect(seg('E').postconditions(cape, {})).toBe(true);
    });
});

// ------------------------------------------------------------------ F and the exit drops

describe('exit drops (the ledger T16-18 row, done in F)', () => {
    const godItems = () => withInv(at(without(arrival(), /greegree/i), CHAMBER_AT), item('Cape of saradomin', ID.saradominCape), item('Staff of saradomin', ID.saradominStaff));

    test('drops the god staff, the god cape, every prayer potion and every shark after S18\'s 2; the magic potion stays for S18', () => {
        const names = exitDropItems(godItems()).map(i => i.name);
        expect(names.filter(n => n === 'Shark').length).toBe(9 - KEEP_SHARKS);
        expect(names).toContain('Staff of saradomin');
        expect(names).toContain('Cape of saradomin');
        expect(names.filter(n => n === 'Prayer potion(4)').length).toBe(4);
        expect(names).not.toContain('Magic potion(4)');
        expect(names.length).toBe(2 + 4 + 9 - KEEP_SHARKS);
        expect(exitDropItems(godItems(), 9).length).toBe(2 + 4);
    });
    test('exitClean names what is still held', () => {
        expect(exitClean()(godItems(), undefined)).toMatch(/still holding .*staff/);
        expect(exitClean(9)(without(godItems(), /saradomin/i), undefined)).toMatch(/still holding .*prayer potion/);
        const noGod = without(godItems(), /saradomin|prayer potion/i);
        expect(exitClean()(noGod, undefined)).toBe('9 sharks held, S18 takes 2 (the ledger\'s T16-18 row)');
        expect(exitClean(9)(noGod, undefined)).toBe(true);
    });
    test('F is done once both god items are down and the staff lies beside SCORED', () => {
        const done = (s: BotWorldState) => seg('F').done!(obs(s), {});
        const dropped = without(godItems(), /saradomin/i);
        expect(done(godItems())).toBe(false);
        expect(done({ ...dropped, groundItems: [ground('Staff of saradomin', ID.saradominStaff, 1)] })).toBe(true);
        expect(done({ ...dropped, groundItems: [ground('Staff of saradomin', ID.saradominStaff, 6)] })).toBe(false);
        expect(done(dropped)).toBe(false);
    });

    /**
     * SCORED in the chamber; the fake server drops whatever was clicked a tick later, the god staff onto the
     * tile, and a Prayer potion drunk restores 7 + level/4 a tick later, one dose down (a vial after the last).
     */
    function chamberSdk(s: BotWorldState) {
        const sdk = new FakeSdk(s);
        let drops: number[] = [];
        let drinks: number[] = [];
        sdk.onSend = a => {
            if (a.method === 'sendDropItem') drops.push(a.args[0] as number);
            if (a.method === 'sendUseItem') drinks.push(a.args[0] as number);
        };
        const each = (st: BotWorldState): Partial<BotWorldState> => {
            if (drinks.length) {
                const slot = drinks.shift()!;
                const pot = st.inventory.find(i => i.slot === slot && /^prayer potion\((\d)\)$/i.test(i.name));
                if (!pot) return {};
                const left = Number(/\((\d)\)/.exec(pot.name)![1]) - 1;
                const next = left ? { ...pot, name: `Prayer potion(${left})` } : { ...pot, name: 'Vial', optionsWithIndex: [] };
                const p = st.prayers;
                return { inventory: st.inventory.map(i => (i === pot ? next : i)), prayers: { ...p, prayerPoints: Math.min(p.prayerLevel, p.prayerPoints + 7 + Math.floor(p.prayerLevel / 4)) } };
            }
            if (!drops.length) return {};
            const gone = st.inventory.filter(i => drops.includes(i.slot));
            drops = [];
            const onFloor = gone.filter(i => /^staff of saradomin$/i.test(i.name)).map(i => ground('Staff of saradomin', i.id, 0));
            return { inventory: st.inventory.filter(i => !gone.includes(i)), groundItems: [...st.groundItems, ...onFloor] };
        };
        const ctx = { sdk, c: {}, log: TickLog.memory('t') } as unknown as StepContext<unknown>;
        return { sdk, each, ctx };
    }

    test('F with the staff in hand: no guardian talk, one drop pass, then the postconditions hold', async () => {
        const s = withInv(at(without(arrival(), /greegree/i), CHAMBER_AT), item('Cape of saradomin', ID.saradominCape), item('Staff of saradomin', ID.saradominStaff));
        const { sdk, each, ctx } = chamberSdk(s);
        const F = seg('F');
        await drive(sdk, F.run(ctx) as Promise<unknown>, 30, each);
        expect(sdk.sent.some(a => a.method === 'sendInteractNpc')).toBe(false);
        expect(sdk.sent.filter(a => a.method === 'sendDropItem').length).toBe(2 + 4 + 9 - KEEP_SHARKS);
        const end = sdk.getState()!;
        expect(end.inventory.filter(i => i.name === 'Shark').length).toBe(KEEP_SHARKS);
        expect(F.postconditions(end, {})).toBe(true);
        expect(F.done!(obs(end), {})).toBe(true);
    });

    test('F drinks the held prayer doses toward full, then drops every potion the drink left (rs/687 R3; the ledger\'s S16 out)', async () => {
        const s = withInv(at(without(arrival({}, { points: 40 }), /greegree/i), CHAMBER_AT), item('Cape of saradomin', ID.saradominCape), item('Staff of saradomin', ID.saradominStaff));
        const { sdk, each, ctx } = chamberSdk(s);
        const F = seg('F');
        await drive(sdk, F.run(ctx) as Promise<unknown>, 30, each);
        const end = sdk.getState()!;
        // 40 + 30 + 30 reaches the level, 94: two doses; the Prayer potion(2) and the three (4)s go down with the god items.
        expect(end.prayers.prayerPoints).toBe(94);
        expect(sdk.sent.filter(a => a.method === 'sendUseItem').length).toBe(2);
        expect(end.inventory.some(i => /^prayer potion|^vial$/i.test(i.name))).toBe(false);
        expect(sdk.sent.filter(a => a.method === 'sendDropItem').length).toBe(2 + 4 + 9 - KEEP_SHARKS);
        expect(F.postconditions(end, {})).toBe(true);
    });

    test('a dose whose name the drink changed after an earlier read is still dropped: the exit reads the pack at the drop', () => {
        const before = withInv(godItems(), item('Prayer potion(2)', ID.prayerPotion, 1, ['Drink']));
        const pot = before.inventory.find(i => i.name === 'Prayer potion(2)')!;
        // The sip turns the (2) into a (1) in the same slot, after `before` was read.
        const after = { ...before, inventory: before.inventory.map(i => (i === pot ? { ...pot, name: 'Prayer potion(1)' } : i)) };
        expect(exitDropItems(after).map(i => i.name)).toContain('Prayer potion(1)');
        expect(exitClean(9)(without(after, /saradomin/i), undefined)).toMatch(/still holding .*prayer potion/i);
    });

    test('the last dose drunk leaves a vial, which goes with the exit drops', async () => {
        const base = without(without(arrival({}, { points: 60 }), /greegree/i), /prayer potion/i);
        const s = withInv(at(base, CHAMBER_AT), item('Prayer potion(1)', ID.prayerPotion, 1, ['Drink']), item('Cape of saradomin', ID.saradominCape), item('Staff of saradomin', ID.saradominStaff));
        const { sdk, each, ctx } = chamberSdk(s);
        const F = seg('F');
        await drive(sdk, F.run(ctx) as Promise<unknown>, 30, each);
        const end = sdk.getState()!;
        expect(end.prayers.prayerPoints).toBe(90);
        expect(end.inventory.some(i => /^vial$/i.test(i.name) || /^prayer potion/i.test(i.name))).toBe(false);
        expect(F.postconditions(end, {})).toBe(true);
        expect(exitClean()(withInv(end, item('Vial', 229)), undefined)).toMatch(/still holding .*vial/i);
    });

    /**
     * rs/764 run 1 (F10): S16 entered with a Prayer potion(4) and a (2), C left (2) + (2), and the exit's drink stopped
     * at full with a (1) left, which no drop named, so H14 found 1 slot short. The pack here is the ledger's own after
     * S16's ins (its walk of STEP-MANIFEST.md), with rs/764's two potions in place of its prayer potions.
     */
    test("rs/764's two (2)s: the exit leaves the ledger's T16-18 pack, and H14 its 23 free against 22", async () => {
        const entries = walk(parseLedger(readFileSync(MANIFEST, 'utf8')).rows);
        const row = (id: string) => entries.find(e => e.row.row === id)!;
        const gameName = (n: string) => ({ 'god staff': 'Staff of saradomin', 'god cape': 'Cape of saradomin' })[n] ?? n[0]!.toUpperCase() + n.slice(1);
        const gameId = (n: string) => ({ 'god staff': ID.saradominStaff, 'god cape': ID.saradominCape, shark: ID.shark, knife: ID.knife, 'air rune': ID.air, 'law rune': ID.law, 'water rune': ID.water })[n] ?? 0;
        const s16 = row('S16').stacks;
        expect(s16.inv.some(h => /prayer potion|vial/i.test(h.name))).toBe(false);
        nextSlot = 0;
        const pack = s16.inv.flatMap(h => (h.kind === 's' ? [item(gameName(h.name), gameId(h.name), h.count ?? 1)] : Array.from({ length: h.count ?? 1 }, () => item(gameName(h.name), gameId(h.name), 1, h.name === 'shark' ? ['Eat'] : []))));
        const potions = [item('Prayer potion(2)', ID.prayerPotion, 1, ['Drink']), item('Prayer potion(2)', ID.prayerPotion, 1, ['Drink'])];
        const base = at(arrival({}, { points: 4 }), CHAMBER_AT);
        const s = { ...base, inventory: [...pack, ...potions], equipment: s16.worn.map(h => item(gameName(h.name), h.name === "m'speak amulet" ? ID.amulet : ID.staffOfFire)) };
        const { sdk, each, ctx } = chamberSdk(s);
        await drive(sdk, seg('F').run(ctx) as Promise<unknown>, 30, each);
        const end = sdk.getState()!;
        // 4 + 3 x 30 reaches 94: three doses, so one (2) is a vial and the other a (1), and both go down.
        expect(end.prayers.prayerPoints).toBe(94);
        expect(sdk.sent.filter(a => a.method === 'sendUseItem').length).toBe(3);
        expect(end.inventory.some(i => /^prayer potion|^vial$/i.test(i.name))).toBe(false);
        const t1618 = row('T16-18');
        expect(end.inventory.length).toBe(t1618.used);
        expect([...new Set(end.inventory.map(i => i.name.toLowerCase()))].sort()).toEqual(t1618.stacks.inv.map(h => h.name).sort());
        expect(end.equipment.map(i => i.name.toLowerCase()).sort()).toEqual(t1618.stacks.worn.map(h => h.name).sort());
        // H14 swaps the knife out before its check: 28 - (6 - 1) = 23 free against its 22.
        const h14 = row('H14');
        expect([h14.free, h14.need]).toEqual([23, 22]);
        expect(28 - (end.inventory.length - 1)).toBe(h14.free);
    });

    test('a second F attempt of the same steps() does not pass on the first one\'s staff: with none seen it goes to the guardian', async () => {
        const list = steps();
        const F = list[5]!;
        const first = withInv(at(without(arrival(), /greegree/i), CHAMBER_AT), item('Cape of saradomin', ID.saradominCape), item('Staff of saradomin', ID.saradominStaff));
        const a = chamberSdk(first);
        await drive(a.sdk, F.run(a.ctx) as Promise<unknown>, 30, a.each);
        expect(F.postconditions(a.sdk.getState()!, {})).toBe(true);

        // A fresh account at F with only the cape: the guardian beside it says nothing.
        const guardian = { kind: 'npc', id: 904, index: 7, name: 'Chamber guardian', combatLevel: 0, x: 2506, z: 4696, distance: 2, hp: null, optionsWithIndex: [{ text: 'Talk-to', opIndex: 1 }] } as unknown as NearbyNpc;
        const second = withInv(at(without(arrival(), /greegree/i), CHAMBER_AT), item('Cape of saradomin', ID.saradominCape));
        const b = chamberSdk({ ...second, nearbyNpcs: [guardian] });
        await expect(drive(b.sdk, F.run(b.ctx) as Promise<unknown>, 120, b.each)).rejects.toThrow(/guardian: no dialogue/);
        expect(b.sdk.sent.filter(x => x.method === 'sendInteractNpc').length).toBeGreaterThan(0);
        expect(F.postconditions(b.sdk.getState()!, {})).toMatch(/Charge not seen unlocked/);
    });
});

describe('exitMagic: what S18 sees', () => {
    test('81 is ready; 79 needs the sip (+4); 75 is short even with it', () => {
        expect(exitMagic(arrival({}, { magic: 81 }))).toMatchObject({ base: 81, chargeReady: true, sipNeeded: false });
        expect(exitMagic(arrival({}, { magic: 79 }))).toMatchObject({ chargeReady: false, sipNeeded: true });
        expect(exitMagic(arrival({}, { magic: 75 }))).toMatchObject({ chargeReady: false, sipNeeded: false });
    });
});

describe('rune pins: RUNE_USE and RUNE_NEED agree with the kit (tools/rune-pins.ts)', () => {
    test("RUNE_NEED.B is exactly what B's fightReady wants held (H13's kit)", () => {
        expect(runeNeedProblems(s => fightReady('fire_wave')(s, {}), without(arrival(), /greegree/i), RUNE_NEED.B!)).toEqual([]);
    });
    test("C's use is the guarded worst case, the whole kit: every Wave, then every fallback Blast", () => {
        expect(RUNE_USE.C).toEqual({ bloodrune: SPELL_RUNES.fire_wave, deathrune: FALLBACK_RUNES, airrune: AIR_RUNES });
        expect(RUNE_USE.C).toEqual(RUNE_NEED.B!);
        expect(FIRE_WAVE_MAX_CASTS).toBeLessThanOrEqual(SPELL_RUNES.fire_wave);
    });
    test('the kit check refuses 549 air and passes 550 (H13 stages 550)', () => {
        expect(AIR_RUNES).toBe(550);
        const ready = without(arrival(), /greegree/i);
        const air = (n: number) => ({ ...ready, inventory: ready.inventory.map(i => (/^air rune$/i.test(i.name) ? { ...i, count: n } : i)) });
        expect(seg('B').preconditions(air(549), {})).toMatch(/air rune 549 held, want >= 550/);
        expect(seg('B').preconditions(air(550), {})).toBe(true);
    });
});
