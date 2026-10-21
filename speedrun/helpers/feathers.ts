// Feathers: kill chickens at a Lumbridge-area coop, pick up only the feathers,
// bank them at Draynor. Fletching needs thousands of feathers (one per headless
// arrow) and this is the cheapest source a brand-new account has: chickens
// cannot hurt it, half of all chicken kills drop 5 or 15 feathers, and feathers
// stack in one slot, so a trip never fills the inventory and banking is only for
// safety and the ledger. It is also the fleet's proof role. Notes:
// docs/speedrun/helpers/feathers.md.
//
//   bun speedrun/helpers/feathers.ts <account>      (standalone; ROLE_OPTIONS='{"pen":"fred"}')
import type { GroundItem, NearbyNpc } from '../../sdk/types';
import { runStandalone, type Role, type RoleContext } from './role';

interface Pen {
    x: number;
    z: number;
    /** Chickens and feathers further than this from the centre belong to somebody else's walk. */
    radius: number;
}

// Chicken (npc 41) spawns from server/content/maps: m50_51 has nine at
// x 3225-3235, z 3297-3300 (the coop north of the Lumbridge cow field), m49_51
// five at x 3185-3191, z 3277-3279 (Fred the Farmer's). Spread accounts over
// both rather than crowding one coop.
const PENS: Record<string, Pen> = {
    east: { x: 3230, z: 3298, radius: 9 },
    fred: { x: 3188, z: 3278, radius: 8 }
};
const DRAYNOR_BANK = { x: 3092, z: 3243 };
const FEATHER = /^feather$/i;

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

function numberOption(ctx: RoleContext, key: string, fallback: number): number {
    const v = ctx.options[key];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

function where(ctx: RoleContext): { x: number; z: number } | null {
    const p = ctx.sdk.getState()?.player;
    return p ? { x: p.worldX, z: p.worldZ } : null;
}

/** Tutorial Island, south-west of Lumbridge; skipTutorial teleports the account to Lumbridge. */
function onTutorialIsland(p: { x: number; z: number } | null): boolean {
    return !!p && p.x >= 3050 && p.x <= 3160 && p.z >= 3050 && p.z <= 3140;
}

async function leaveTutorial(ctx: RoleContext): Promise<void> {
    for (let attempt = 1; attempt <= 6 && onTutorialIsland(where(ctx)); attempt++) {
        const r = await ctx.bot.skipTutorial();
        ctx.log('skipping the tutorial', { attempt, message: r.message });
        await ctx.sdk
            .waitForCondition(s => !!s.player && !onTutorialIsland({ x: s.player.worldX, z: s.player.worldZ }), 10_000)
            .catch(() => undefined);
    }
    if (onTutorialIsland(where(ctx))) throw new Error('still on Tutorial Island after 6 skip attempts');
}

async function equipWeapon(ctx: RoleContext): Promise<void> {
    if (ctx.bot.getEquipment().some(i => /sword|dagger|scimitar|axe|mace/i.test(i.name))) return;
    const weapon = ctx.sdk.getInventory().find(i => /sword|dagger|scimitar|mace/i.test(i.name))
        ?? ctx.sdk.getInventory().find(i => /axe/i.test(i.name) && !/pickaxe/i.test(i.name));
    if (weapon) {
        const r = await ctx.bot.equipItem(weapon);
        ctx.log('equipped a weapon', { item: weapon.name, ok: r.success });
    }
}

/** Walk to Draynor, deposit the feathers, report the bank. Throws if the bank cannot be used, so the fleet retries. */
async function bankTrip(ctx: RoleContext): Promise<number> {
    const { bot, sdk } = ctx;
    const carried = sdk.countInventoryItems(FEATHER);
    const walk = await bot.walkTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z, 4, { timeout: 240_000 });
    if (!walk.success) throw new Error(`could not reach Draynor bank: ${walk.message}`);
    const open = await bot.openBank();
    if (!open.success) throw new Error(`could not open the bank: ${open.message}`);
    if (carried > 0) {
        const d = await bot.depositItem(FEATHER, -1);
        if (!d.success) ctx.log('deposit incomplete', { message: d.message, deposited: d.amountDeposited ?? 0 });
    }
    const items = sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count }));
    ctx.reportBank({ items });
    await bot.closeBank();
    const inBank = items.filter(i => FEATHER.test(i.name)).reduce((s, i) => s + i.count, 0);
    ctx.log('banked', { deposited: carried, featherInBank: inBank });
    return carried;
}

export const role: Role = {
    name: 'feathers',
    produces: [FEATHER],
    async run(ctx) {
        const { bot, sdk, signal } = ctx;
        const penName = String(ctx.options.pen ?? 'east');
        const pen = PENS[penName];
        if (!pen) throw new Error(`unknown pen "${penName}"; options.pen is one of ${Object.keys(PENS).join(', ')}`);
        // Feathers stack, so these bound how much a death or a crash could lose, not inventory space.
        const bankAt = numberOption(ctx, 'bankAt', 300);
        const bankMinutes = numberOption(ctx, 'bankMinutes', 30);

        await leaveTutorial(ctx);
        await equipWeapon(ctx);

        let lastBank = 0; // bank on the first pass: records the account in the ledger and clears old stock
        let kills = 0;
        let picked = 0;
        let lastProgress = Date.now();
        const avoidNpc = new Map<number, number>(); // npc index -> time until which to leave it alone
        const avoidTile = new Map<string, number>(); // "x,z" of a feather pile we failed to take

        while (!signal.aborted) {
            await bot.dismissBlockingUI();
            const carried = sdk.countInventoryItems(FEATHER);
            if (lastBank === 0 || carried >= bankAt || Date.now() - lastBank > bankMinutes * 60_000 || sdk.getInventory().length >= 28) {
                await bankTrip(ctx);
                lastBank = Date.now();
                continue;
            }

            const me = where(ctx);
            if (!me) {
                await sdk.waitForTicks(1);
                continue;
            }
            if (dist(me, pen) > pen.radius + 3) {
                const r = await bot.walkTo(pen.x, pen.z, 3, { timeout: 240_000 });
                if (!r.success) ctx.log('walk to the coop failed', { message: r.message });
                continue;
            }

            // Feathers first: a pile is only ours alone for 100 ticks after the kill.
            const now = Date.now();
            const pile = (await sdk.scanGroundItems(12))
                .filter((g: GroundItem) => FEATHER.test(g.name) && g.reachable !== false && dist(g, pen) <= pen.radius + 2)
                .filter(g => (avoidTile.get(`${g.x},${g.z}`) ?? 0) < now)
                .sort((a, b) => a.distance - b.distance)[0];
            if (pile) {
                const r = await bot.pickupItem(pile);
                if (r.success) picked += pile.count;
                else avoidTile.set(`${pile.x},${pile.z}`, now + 30_000);
                continue;
            }

            const chicken = sdk
                .getNearbyNpcs()
                .filter((n: NearbyNpc) => /^chicken$/i.test(n.name) && n.reachable !== false && dist(n, pen) <= pen.radius)
                .filter(n => n.optionsWithIndex.some(o => /^attack$/i.test(o.text)))
                .filter(n => (avoidNpc.get(n.index) ?? 0) < now)
                .sort((a, b) => a.distance - b.distance)[0];
            if (!chicken) {
                await sdk.waitForTicks(3); // all dead or taken; they respawn after 50 ticks
                continue;
            }
            const attack = await bot.attack(chicken);
            if (!attack.success) {
                avoidNpc.set(chicken.index, now + 15_000);
                continue;
            }
            // A chicken has 3 hitpoints; it leaves the npc list a moment after it dies.
            const died = await sdk
                .waitForCondition(s => !s.nearbyNpcs.some(n => n.index === chicken.index), 25_000)
                .then(() => true, () => false);
            if (died) {
                kills++;
                await sdk.waitForTicks(1); // the drop lands on the tick after death
            } else {
                avoidNpc.set(chicken.index, Date.now() + 15_000);
            }

            if (Date.now() - lastProgress > 5 * 60_000) {
                lastProgress = Date.now();
                ctx.log('progress', {
                    kills,
                    featherPickedUp: picked,
                    carried: sdk.countInventoryItems(FEATHER),
                    attack: sdk.getSkill('Attack')?.baseLevel,
                    strength: sdk.getSkill('Strength')?.baseLevel
                });
            }
        }
    }
};

if (import.meta.main) await runStandalone(role);
