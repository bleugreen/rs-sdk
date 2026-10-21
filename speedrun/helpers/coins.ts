// Coin earner: Thieving by pickpocketing, banked where it is earned.
//
//   bun speedrun/helpers/coins.ts <account>        (ROLE_OPTIONS='{"target":"auto"}')
//
// Why pickpocketing: at 25x xp a fresh account reaches the useful targets in
// minutes (docs/speedrun/skills/thieving.md on the research branch: 1 -> 99 in
// about 2,840 ticks), the coins stack in one slot so the inventory never fills,
// and nothing is needed but food. Every target from Al-Kharid warriors up uses
// the same success curve (`success_chance,*,240` in pickpocket.dbrow), so at
// high levels about 94% of rolls succeed and the rate is set by the coin value
// per success and how often the bot must stop to eat or bank.
// docs/speedrun/helpers/coins.md has the measured rates on the demo server.
//
// Cadence: a success occupies 2 server ticks and a failure 11, and clicks sent
// while the player is delayed or stunned are dropped, never queued. So the
// loop clicks the target once per server tick and lets the server discard the
// extras. That only works when state arrives every tick: run the lite client
// and this script against a local gateway (GATEWAY_URL), because the demo's
// public gateway relays state in multi-second bursts.
//
// Targets (pickpocket.dbrow; gp per success, damage per failure):
//   man      Lumbridge, east of the castle      3 gp, 1 dmg  level 1
//   warrior  Al-Kharid palace, kebabs 1 gp      18 gp, 2 dmg level 25
//   guard    Varrock, west bank / palace        30 gp, 2 dmg level 40
// 'auto' picks man below 25, then warrior, then guard from `guardLevel` once
// the account carries enough kebabs for a guard session.
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, InventoryItem, NearbyNpc } from '../../sdk/types';
import { crossTollGate, inAlKharid } from './buyer';
import { runStandalone, type Role, type RoleContext } from './role';

interface Tile {
    x: number;
    z: number;
}

interface Spot {
    name: TargetName;
    npc: RegExp;
    level: number;
    /** Fixed stun damage per failure (pickpocket.dbrow stun_damage). */
    damage: number;
    gp: number;
    stand: Tile;
    /** Targets further than this from `stand` are ignored (some spawn behind walls). */
    radius: number;
    /** Bank booth area, or null where dying is cheaper than banking (Lumbridge respawn). */
    bank: Tile | null;
}

type TargetName = 'man' | 'warrior' | 'guard';

const SPOTS: Record<TargetName, Spot> = {
    // The men that spawn at x=3216 are inside the castle and not routable from
    // the courtyard (server/webclient/src/lite/swarm.ts); the reachable cluster
    // is the open ground at x=3230-3234. The respawn point is two tiles away,
    // so a death here costs a few ticks and the dropped coins are picked up.
    man: { name: 'man', npc: /^(man|woman)$/i, level: 1, damage: 1, gp: 3, stand: { x: 3231, z: 3218 }, radius: 7, bank: null },
    warrior: { name: 'warrior', npc: /^al-kharid warrior$/i, level: 25, damage: 2, gp: 18, stand: { x: 3293, z: 3172 }, radius: 14, bank: { x: 3270, z: 3167 } },
    guard: { name: 'guard', npc: /^guard$/i, level: 40, damage: 2, gp: 30, stand: { x: 3210, z: 3462 }, radius: 14, bank: { x: 3185, z: 3438 } }
};

const TOLL_WEST: Tile = { x: 3267, z: 3227 };
const KEBAB_SELLER: Tile = { x: 3273, z: 3180 };
const FOOD = /^(kebab|shark|lobster|swordfish|tuna|salmon|trout|cake|2\/3 cake|slice of cake|bread|meat pie|half a meat pie|cooked meat|cooked chicken|shrimps)$/i;

interface Options {
    target: 'auto' | TargetName;
    /** Carried coins that trigger a bank trip (bounds what a death can cost). */
    bankAt: number;
    /** Coins kept in the inventory after banking, for kebabs and the toll. */
    keepCoins: number;
    /** Kebabs bought per trip to the seller. */
    kebabs: number;
    /** Thieving level at which 'auto' moves from warriors to Varrock guards. */
    guardLevel: number;
    /** Ticks between progress log lines. */
    reportTicks: number;
}

function readOptions(raw: Record<string, unknown>): Options {
    const num = (k: string, d: number) => (typeof raw[k] === 'number' ? (raw[k] as number) : d);
    const target = typeof raw.target === 'string' ? (raw.target as Options['target']) : 'auto';
    if (target !== 'auto' && !(target in SPOTS)) throw new Error(`coins: unknown target ${target}`);
    return {
        target,
        bankAt: num('bankAt', 3000),
        keepCoins: num('keepCoins', 200),
        kebabs: num('kebabs', 24),
        guardLevel: num('guardLevel', 99),
        reportTicks: num('reportTicks', 1000)
    };
}

// ---------------------------------------------------------------- state helpers

const coinsIn = (s: BotWorldState) => s.inventory.filter(i => i.name === 'Coins').reduce((a, i) => a + i.count, 0);
const thievingOf = (s: BotWorldState) => s.skills.find(k => k.name === 'Thieving');
const foodIn = (s: BotWorldState) => s.inventory.filter(i => FOOD.test(i.name) && i.optionsWithIndex.some(o => /^eat$/i.test(o.text)));
const dist = (s: BotWorldState, t: Tile) => Math.max(Math.abs(s.player!.worldX - t.x), Math.abs(s.player!.worldZ - t.z));
const inTutorial = (s: BotWorldState) => s.player!.worldX >= 3050 && s.player!.worldX <= 3160 && s.player!.worldZ >= 3050 && s.player!.worldZ <= 3140;

function nextTick(sdk: BotSDK, after: number): Promise<BotWorldState> {
    return new Promise(resolve => {
        const now = sdk.getState();
        if (now && now.tick > after) return resolve(now);
        const off = sdk.onStateUpdate(s => {
            if (s.tick > after) {
                off();
                resolve(s);
            }
        });
    });
}

async function waitTicks(sdk: BotSDK, n: number): Promise<BotWorldState> {
    let s = sdk.getState()!;
    for (let i = 0; i < n; i++) s = await nextTick(sdk, s.tick);
    return s;
}

async function eat(sdk: BotSDK, item: InventoryItem): Promise<void> {
    const op = item.optionsWithIndex.find(o => /^eat$/i.test(o.text));
    if (op) await sdk.sendUseItem(item.slot, op.opIndex);
}

// ---------------------------------------------------------------- the role

class CoinEarner {
    private readonly o: Options;
    private readonly bot: BotActions;
    private readonly sdk: BotSDK;
    /** Coins gained from pickpocketing (positive coin deltas while thieving). */
    earned = 0;
    spent = 0;
    successes = 0;
    failures = 0;
    eats = 0;
    deaths = 0;
    banked = 0;
    private startedAt = Date.now();
    private startTick = 0;
    private lastReportTick = 0;

    constructor(private readonly ctx: RoleContext) {
        this.o = readOptions(ctx.options);
        this.bot = ctx.bot;
        this.sdk = ctx.sdk;
    }

    private get state(): BotWorldState {
        const s = this.sdk.getState();
        if (!s?.player) throw new Error('no game state');
        return s;
    }

    async run(): Promise<void> {
        await this.sdk.waitForCondition(s => (s.player?.worldX ?? 0) > 0, 60_000);
        if (inTutorial(this.state)) {
            const r = await this.bot.skipTutorial();
            this.ctx.log('tutorial', { success: r.success, result: r.message });
            await waitTicks(this.sdk, 3);
        }
        this.startTick = this.state.tick;
        this.lastReportTick = this.startTick;
        this.ctx.log('start', { options: this.o, thieving: thievingOf(this.state)?.baseLevel, coins: coinsIn(this.state) });

        let phase: TargetName | null = null;
        while (!this.ctx.signal.aborted) {
            await this.dismiss();
            const spot = SPOTS[this.chooseTarget()];
            if (spot.name !== phase) {
                this.ctx.log('phase', { from: phase, to: spot.name, levels: { thieving: thievingOf(this.state)?.baseLevel, hitpoints: this.state.player!.maxHp } });
                phase = spot.name;
            }
            try {
                await this.cycle(spot);
            } catch (e) {
                this.ctx.log('cycle error', { error: String(e) });
                await waitTicks(this.sdk, 5);
            }
        }
        this.report('stop');
    }

    private chooseTarget(): TargetName {
        if (this.o.target !== 'auto') return this.o.target;
        const level = thievingOf(this.state)?.baseLevel ?? 1;
        if (level < SPOTS.warrior.level) return 'man';
        if (level >= Math.max(this.o.guardLevel, SPOTS.guard.level) && foodIn(this.state).length >= 10) return 'guard';
        return 'warrior';
    }

    /** One pass: travel, restock, bank, then thieve until something needs doing. */
    private async cycle(spot: Spot): Promise<void> {
        const s = this.state;
        // Every target above men eats kebabs, which only Al-Kharid sells; the
        // toll is 10 gp each way, so earn it on the men if the account is broke.
        const needFood = spot.name !== 'man' && foodIn(s).length === 0;
        const wantEast = spot.name === 'warrior' || needFood;
        if (spot.name !== 'man' && wantEast !== inAlKharid(s)) {
            if (coinsIn(s) < 10) {
                await this.thieve(SPOTS.man, st => coinsIn(st) >= 10 + this.o.kebabs);
                return;
            }
            if (wantEast) await this.walk(TOLL_WEST);
            const r = await crossTollGate(this.bot, this.sdk, wantEast, this.ctx.log);
            this.spent += r.paid;
            return;
        }
        if (needFood) {
            await this.buyKebabs();
            return;
        }
        if (spot.bank && coinsIn(s) >= this.o.bankAt) {
            await this.bankCoins(spot);
            return;
        }
        if (dist(s, spot.stand) > spot.radius) {
            await this.walk(spot.stand);
            return;
        }
        const reason = await this.thieve(spot);
        if (reason) this.ctx.log('session end', { target: spot.name, reason, coins: coinsIn(this.state), hp: this.state.player!.hp });
    }

    private async dismiss(): Promise<void> {
        const s = this.state;
        if (s.dialog.isOpen) await this.sdk.sendClickDialog(0);
        if (s.shop.isOpen) await this.bot.closeShop();
        if (s.interface?.isOpen) await this.sdk.sendCloseModal();
    }

    private async walk(t: Tile): Promise<void> {
        for (let i = 0; i < 4 && !this.ctx.signal.aborted; i++) {
            const r = await this.bot.walkTo(t.x, t.z, 2);
            if (r.success || dist(this.state, t) <= 3) return;
            this.ctx.log('walk retry', { to: t, message: r.message });
            await waitTicks(this.sdk, 2);
        }
    }

    /**
     * Click the nearest matching target once per server tick until `stop`
     * says so or the session needs an errand (food, bank, death). Returns the
     * reason it stopped, or '' when `stop` fired.
     */
    private async thieve(spot: Spot, stop?: (s: BotWorldState) => boolean): Promise<string> {
        let s = this.state;
        let lastXp = thievingOf(s)!.experience;
        let lastCoins = coinsIn(s);
        let lastHp = s.player!.hp;
        let lastStunEnd = -100;
        let lastEat = -100;
        let lastProgress = s.tick;
        let target: NearbyNpc | undefined;
        const skipUntil = new Map<number, number>();

        while (!this.ctx.signal.aborted) {
            s = await nextTick(this.sdk, s.tick);
            const t = s.tick;
            const p = s.player!;
            const xp = thievingOf(s)!.experience;
            const coins = coinsIn(s);
            let success = false;
            if (xp > lastXp) {
                this.successes++;
                success = true;
                lastProgress = t;
            }
            if (coins > lastCoins) this.earned += coins - lastCoins;
            if (p.hp < lastHp && p.hp > 0) {
                this.failures++;
                lastStunEnd = t + 8;
                lastProgress = t;
            }
            lastXp = xp;
            lastCoins = coins;

            if (p.isDead || p.hp <= 0) {
                this.deaths++;
                this.ctx.log('died', { target: spot.name, coins });
                await this.sdk.waitForCondition(st => !!st.player && st.player.hp > 0 && !st.player.isDead, 30_000).catch(() => undefined);
                await waitTicks(this.sdk, 3);
                await this.collectLooseCoins();
                return 'died';
            }
            lastHp = p.hp;

            if (t - this.lastReportTick >= this.o.reportTicks) this.report('progress', spot);
            if (s.dialog.isOpen) await this.sdk.sendClickDialog(0); // level-ups block every op
            if (stop?.(s)) return '';
            if (spot.bank && coins >= this.o.bankAt) return 'bank';

            // Eat in a success window (free) or at once if the next failure could kill.
            const food = foodIn(s)[0];
            const forced = p.hp <= spot.damage + 1;
            const window = success && t - lastStunEnd >= 4 && t - lastEat >= 3;
            if (food && ((window && p.hp <= p.maxHp - 6) || (forced && t - lastEat >= 2))) {
                await eat(this.sdk, food);
                this.eats++;
                lastEat = t;
            } else if (!food && forced && spot.name !== 'man') {
                // Waiting on regeneration costs 100 ticks per hp; go for food instead.
                return 'out of food';
            }

            if (dist(s, spot.stand) > spot.radius + 6) return 'left station';
            if (t - lastProgress > 40) {
                // Nothing resolved for 40 ticks: the target is unreachable or gone.
                if (target) skipUntil.set(target.index, t + 100);
                target = undefined;
                lastProgress = t;
                if (dist(s, spot.stand) > 2) await this.sdk.sendWalk(spot.stand.x, spot.stand.z, true);
            }

            if (!target || !s.nearbyNpcs.some(n => n.index === target!.index)) {
                target = s.nearbyNpcs
                    .filter(n => spot.npc.test(n.name) && n.reachable !== false && (skipUntil.get(n.index) ?? 0) < t)
                    .filter(n => Math.max(Math.abs((n.tileX ?? n.x) - spot.stand.x), Math.abs((n.tileZ ?? n.z) - spot.stand.z)) <= spot.radius)
                    .sort((a, b) => a.distance - b.distance)[0];
            } else {
                target = s.nearbyNpcs.find(n => n.index === target!.index);
            }
            const op = target?.optionsWithIndex.find(o => /pickpocket/i.test(o.text));
            if (target && op) await this.sdk.sendInteractNpc(target.index, op.opIndex);
        }
        return 'aborted';
    }

    private async collectLooseCoins(): Promise<void> {
        for (let i = 0; i < 5; i++) {
            const pile = this.sdk.findGroundItem(/^coins$/i);
            if (!pile || pile.distance > 12) return;
            await this.bot.pickupItem(pile);
        }
    }

    private async buyKebabs(): Promise<void> {
        await this.walk(KEBAB_SELLER);
        const want = Math.min(this.o.kebabs, 28 - this.state.inventory.length + foodIn(this.state).length);
        let bought = 0;
        for (let i = 0; i < want + 5 && bought < want && coinsIn(this.state) > 0 && !this.ctx.signal.aborted; i++) {
            const seller = this.sdk.findNearbyNpc(/^karim$|kebab/i);
            const talk = seller?.optionsWithIndex.find(o => /talk/i.test(o.text));
            if (!seller || !talk) {
                this.ctx.log('kebab seller not found');
                await this.walk(KEBAB_SELLER);
                continue;
            }
            const before = this.state.inventory.filter(it => /^kebab$/i.test(it.name)).length;
            await this.sdk.sendInteractNpc(seller.index, talk.opIndex);
            for (let k = 0; k < 30; k++) {
                const s = await waitTicks(this.sdk, 1);
                if (s.inventory.filter(it => /^kebab$/i.test(it.name)).length > before) break;
                if (!s.dialog.isOpen) continue;
                const yes = s.dialog.options.find(o => /yes please/i.test(o.text));
                await this.sdk.sendClickDialog(yes ? yes.index : 0);
            }
            if (this.state.inventory.filter(it => /^kebab$/i.test(it.name)).length > before) {
                bought++;
                this.spent += 1;
            }
        }
        while (this.state.dialog.isOpen) {
            await this.sdk.sendClickDialog(0);
            await waitTicks(this.sdk, 1);
        }
        this.ctx.log('kebabs', { bought, carried: foodIn(this.state).length });
    }

    private async bankCoins(spot: Spot): Promise<void> {
        if (!spot.bank) return;
        await this.walk(spot.bank);
        const opened = await this.bot.openBank();
        if (!opened.success) {
            this.ctx.log('bank failed', { message: opened.message });
            return;
        }
        const carried = coinsIn(this.state);
        const amount = carried - this.o.keepCoins;
        if (amount > 0) {
            const r = await this.bot.depositItem(/^coins$/i, amount);
            if (r.success) this.banked += amount;
            else this.ctx.log('deposit failed', { message: r.message });
        }
        this.ctx.reportBank({ items: this.sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count })) });
        await this.bot.closeBank();
        this.report('banked', spot);
    }

    private report(message: string, spot?: Spot): void {
        const s = this.sdk.getState();
        const ticks = (s?.tick ?? 0) - this.startTick;
        const hours = (Date.now() - this.startedAt) / 3_600_000;
        this.lastReportTick = s?.tick ?? 0;
        this.ctx.log(message, {
            target: spot?.name,
            thieving: s ? thievingOf(s)?.baseLevel : undefined,
            carried: s ? coinsIn(s) : undefined,
            earned: this.earned,
            spent: this.spent,
            banked: this.banked,
            successes: this.successes,
            failures: this.failures,
            eats: this.eats,
            deaths: this.deaths,
            ticks,
            gpPerHour: hours > 0 ? Math.round((this.earned - this.spent) / hours) : 0,
            gpPerTick: ticks > 0 ? +((this.earned - this.spent) / ticks).toFixed(2) : 0
        });
    }
}

export const role: Role = {
    name: 'coins',
    produces: [/^Coins$/],
    run: ctx => new CoinEarner(ctx).run()
};

if (import.meta.main) await runStandalone(role);
