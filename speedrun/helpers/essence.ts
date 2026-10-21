// Essence miner: takes a fresh account through Rune Mysteries, then mines rune
// essence through Aubury's teleport in Varrock and banks it at Varrock east.
//
//   bun speedrun/helpers/essence.ts <account>        (lite client already running)
//
// Options (ROLE_OPTIONS JSON or fleet config):
//   trips: number      stop after this many banked trips (default: run until aborted)
//   target: number     stop once the bank holds this many essence (default: none)
//
// Engine facts this role leans on (server/content/scripts):
// - Only rune essence exists in this revision (obj `blankrune`, "Rune essence");
//   there is no pure essence, and every altar binds it (runecraft.rs2).
// - Essence rocks never deplete and have no success roll: each pickaxe cycle
//   yields one essence (mining.rs2 `get_ore_essence`), so the rate is set by the
//   pickaxe's mining_rate (bronze 7 ... rune 2), not by Mining level. Any number of
//   players share the four rocks without contention.
// - The pickaxe counts when wielded (pickaxe_checker.rs2), which frees a slot.
// - Aubury's Teleport op needs Rune Mysteries complete; the mine's exit portal
//   returns you to whoever teleported you (essence_mine.rs2).
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, InventoryItem, NearbyLoc } from '../../sdk/types';
import type { Role, RoleContext } from './role';
import { runStandalone } from './role';

const ESSENCE = /^rune essence$/i;
const PICKAXE = /pickaxe$/i;
const TALISMAN = /^air talisman$/i;
const PACKAGE = /^research package$/i;
const NOTES = /^notes$/i;

// Coordinates read from the map files (server/content/maps) and scripts.
const AUBURY = { x: 3253, z: 3401 }; // m50_53 npc spawn; ^essence_mine_to_aubury 3253,3401
const VARROCK_EAST_BANK = { x: 3253, z: 3420 };
const WIZARDS_TOWER = { x: 3109, z: 3164 };
const TOWER_DOORWAY = { x: 3108, z: 3170 };
const SEDRIDOR = { x: 3103, z: 9571 }; // m48_149 npc spawn (Wizards' Tower basement)
const LUMBRIDGE_STAIRS = { x: 3206, z: 3209 };
const DUKE = { x: 3212, z: 3220 }; // m50_50 level 1

/**
 * Pickaxes best first: Mining level to use (pickaxes.obj `levelrequire`), Attack
 * level to wield (levelrequire/scripts/tier*.rs2), ticks per essence (mining_rate + 1).
 */
const PICKAXES: { name: RegExp; level: number; attack: number }[] = [
    { name: /^rune pickaxe$/i, level: 41, attack: 40 },
    { name: /^adamant pickaxe$/i, level: 31, attack: 30 },
    { name: /^mithril pickaxe$/i, level: 21, attack: 20 },
    { name: /^steel pickaxe$/i, level: 6, attack: 5 },
    { name: /^iron pickaxe$/i, level: 1, attack: 1 },
    { name: /^bronze pickaxe$/i, level: 1, attack: 1 }
];

export const inMine = (s: BotWorldState | null) =>
    !!s?.player && s.player.worldX >= 2870 && s.player.worldX <= 2950 && s.player.worldZ >= 4790 && s.player.worldZ <= 4880;
const inTowerBasement = (s: BotWorldState | null) =>
    !!s?.player && s.player.worldZ > 9500 && s.player.worldZ < 9650 && s.player.worldX > 3080 && s.player.worldX < 3130;
const onTutorialIsland = (s: BotWorldState | null) =>
    !!s?.player && s.player.worldX >= 3050 && s.player.worldX <= 3156 && s.player.worldZ >= 3056 && s.player.worldZ <= 3136;

class Stop extends Error {}

class EssenceMiner {
    private bot: BotActions;
    private sdk: BotSDK;
    private questDone = false;
    private startedAt = Date.now();
    private minedThisRun = 0;
    private trips = 0;
    /** Essence in the bank as of the last bank visit. */
    private bankEssence = 0;
    private phase: 'start' | 'tutorial' | 'quest' | 'mine' = 'start';

    /** Logged as `phase {from, to}` so a watcher can tell a quest step from a stuck loop. */
    private setPhase(to: EssenceMiner['phase']) {
        if (to === this.phase) return;
        this.ctx.log('phase', { from: this.phase, to });
        this.phase = to;
    }

    constructor(private ctx: RoleContext) {
        this.bot = ctx.bot;
        this.sdk = ctx.sdk;
    }

    // ---------------------------------------------------------------- basics

    private state(): BotWorldState {
        const s = this.sdk.getState();
        if (!s?.player) throw new Error('no game state');
        return s;
    }
    private tick(): number {
        return this.sdk.getState()?.tick ?? 0;
    }
    private pos() {
        const p = this.state().player!;
        return { x: p.worldX, z: p.worldZ, level: p.level };
    }
    private checkSignal() {
        if (this.ctx.signal.aborted) throw new Stop();
    }
    private has(pattern: RegExp): InventoryItem | undefined {
        return this.sdk.getInventory().find(i => pattern.test(i.name));
    }
    private count(pattern: RegExp): number {
        return this.sdk.countInventoryItems(pattern);
    }
    private freeSlots(): number {
        return 28 - this.sdk.getInventory().length;
    }
    private async until(pred: (s: BotWorldState) => boolean, ms: number): Promise<boolean> {
        try {
            await this.sdk.waitForCondition(pred, ms);
            return true;
        } catch {
            return false;
        }
    }
    private messagesSince(tick: number): string[] {
        return (this.sdk.getState()?.gameMessages ?? []).filter(m => m.tick >= tick).map(m => m.text);
    }

    /** Walk with the SDK pathfinder, retrying from wherever the last attempt stopped. */
    private async travel(dest: { x: number; z: number }, tolerance = 2, what = ''): Promise<void> {
        for (let attempt = 1; attempt <= 6; attempt++) {
            this.checkSignal();
            await this.bot.dismissBlockingUI();
            const p = this.pos();
            if (Math.abs(p.x - dest.x) <= tolerance && Math.abs(p.z - dest.z) <= tolerance) return;
            if (attempt === 1) this.ctx.log('walk', { to: what || dest, from: p });
            const r = await this.bot.walkTo(dest.x, dest.z, tolerance, { timeout: 180_000 });
            if (r.success) return;
            this.ctx.log('walk retry', { to: what || dest, attempt, reason: r.message, at: this.pos() });
            const q = this.pos();
            if (q.level === 0 && q.x >= 3098 && q.x <= 3118 && q.z >= 3154 && q.z <= 3172) await this.localWalk(TOWER_DOORWAY, 2);
            else await this.sdk.waitForTicks(3);
        }
        throw new Error(`could not reach ${what || JSON.stringify(dest)} from ${JSON.stringify(this.pos())}`);
    }

    /** One click routed by the client itself (live collision, within the loaded area). */
    private async localWalk(dest: { x: number; z: number }, tolerance: number): Promise<void> {
        const near = (s: BotWorldState) =>
            !!s.player && Math.abs(s.player.worldX - dest.x) <= tolerance && Math.abs(s.player.worldZ - dest.z) <= tolerance;
        for (let attempt = 1; attempt <= 3 && !near(this.state()); attempt++) {
            await this.sdk.sendWalk(dest.x, dest.z, true);
            await this.until(near, 10_000);
        }
    }

    private async findLoc(name: RegExp, option: RegExp, radius = 20): Promise<NearbyLoc | null> {
        const locs = await this.sdk.scanNearbyLocs(radius);
        const level = this.pos().level;
        return (
            locs
                .filter(l => name.test(l.name) && l.level === level && l.optionsWithIndex.some(o => option.test(o.text)))
                .sort((a, b) => a.distance - b.distance)[0] ?? null
        );
    }

    /** Use a ladder/staircase/portal and wait for the position predicate to hold. */
    private async useLoc(name: RegExp, option: RegExp, arrived: (s: BotWorldState) => boolean, what: string): Promise<void> {
        for (let attempt = 1; attempt <= 4; attempt++) {
            this.checkSignal();
            if (arrived(this.state())) return;
            const loc = await this.findLoc(name, option, 30);
            if (!loc) throw new Error(`no ${what} near ${JSON.stringify(this.pos())}`);
            await this.bot.interactLoc(loc, option);
            if (await this.until(arrived, 15_000)) return;
            this.ctx.log('loc retry', { what, attempt, at: this.pos() });
        }
        throw new Error(`${what} did not take us anywhere (at ${JSON.stringify(this.pos())})`);
    }

    // ---------------------------------------------------------------- dialogue

    /**
     * Talk to an NPC and click through the whole conversation. At each choice the
     * first pattern in `choices` that matches an offered option is clicked; if none
     * matches, the conversation is abandoned. Returns every text line shown.
     */
    private async converse(npc: RegExp, choices: RegExp[]): Promise<{ lines: string[]; offered: string[][] }> {
        const lines: string[] = [];
        const offered: string[][] = [];
        const startTick = this.tick();
        await this.bot.dismissBlockingUI();
        const talk = await this.bot.talkTo(npc);
        if (!talk.success) throw new Error(`talkTo ${npc}: ${talk.message}`);
        const deadline = Date.now() + 120_000;
        let closedSince = 0;
        while (Date.now() < deadline) {
            const s = this.sdk.getState();
            const d = s?.dialog;
            if (!d?.isOpen) {
                // A page can close a tick before the next one opens.
                if (!closedSince) closedSince = Date.now();
                if (Date.now() - closedSince > 1500) break;
                await this.sdk.waitForTicks(1);
                continue;
            }
            closedSince = 0;
            if (d.isWaiting) {
                await this.sdk.waitForTicks(1);
                continue;
            }
            const page = d.pageId;
            if (d.options.length > 0) {
                const texts = d.options.map(o => o.text);
                offered.push(texts);
                // Message boxes (~mesbox/~objbox) publish their continue link as an option.
                const pick = [...choices, /^click here to continue$/i].map(c => d.options.find(o => c.test(o.text))).find(Boolean);
                if (!pick) {
                    this.ctx.log('no matching dialogue option', { npc: String(npc), options: texts });
                    await this.sdk.sendCloseModal();
                    break;
                }
                await this.sdk.clickDialogByText(new RegExp(`^${pick.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
            } else {
                await this.sdk.sendClickDialog(0);
            }
            await this.until(st => !st.dialog.isOpen || st.dialog.pageId !== page, 6_000);
        }
        // recentDialogs is newest first and only records a page when the chat
        // interface changes, so consecutive same-type pages are missing. Good enough
        // for the phrases matched here, each of which follows a page of another type.
        for (const entry of [...(this.sdk.getState()?.recentDialogs ?? [])].reverse()) {
            if (entry.tick >= startTick) lines.push(...entry.text);
        }
        this.ctx.log('talked', { npc: String(npc), choices: offered.length, lastLine: lines.at(-1) });
        return { lines, offered };
    }

    // ---------------------------------------------------------------- navigation

    /** Get back to the ground floor of the overworld from the mine, the tower basement or Lumbridge castle. */
    private async toSurface(): Promise<void> {
        if (inMine(this.state())) await this.leaveMine();
        if (inTowerBasement(this.state())) {
            await this.useLoc(/ladder/i, /climb-up/i, s => !inTowerBasement(s), 'tower basement ladder');
            // The SDK's precomputed collision encloses the ladder's landing tile
            // (3105,3162), so walkTo finds no route out. The client's own router
            // uses the live map: one local step to the north doorway clears it.
            await this.localWalk(TOWER_DOORWAY, 2);
        }
        for (let i = 0; i < 3 && this.pos().level > 0; i++) {
            const from = this.pos().level;
            await this.useLoc(/stair|ladder/i, /climb-down/i, s => (s.player?.level ?? 0) < from, 'stairs down');
        }
    }

    private async goToDuke(): Promise<void> {
        await this.toSurface();
        await this.travel(LUMBRIDGE_STAIRS, 2, 'Lumbridge castle stairs');
        await this.useLoc(/staircase/i, /climb-up/i, s => (s.player?.level ?? 0) === 1, 'Lumbridge castle staircase');
        await this.travel(DUKE, 3, 'Duke Horacio');
    }

    private async goToSedridor(): Promise<void> {
        if (!inTowerBasement(this.state())) {
            await this.toSurface();
            await this.travel(WIZARDS_TOWER, 3, "Wizards' Tower");
            await this.useLoc(/ladder/i, /climb-down/i, inTowerBasement, "Wizards' Tower ladder");
        }
        await this.travel(SEDRIDOR, 3, 'Sedridor');
    }

    private async goToAubury(): Promise<void> {
        await this.toSurface();
        await this.travel(AUBURY, 3, "Aubury's rune shop");
    }

    // ---------------------------------------------------------------- Rune Mysteries

    /**
     * Drive Rune Mysteries to completion from whatever stage the account is in.
     * The stage is not published to the SDK, so it is read from what the account
     * holds (talisman, package, notes) and from what the NPCs say.
     */
    private async ensureQuest(): Promise<void> {
        if (this.questDone) return;
        let hint: 'duke' | 'sedridor' | 'aubury' | null = null;
        // A restart near Varrock with no quest items is almost always a finished
        // quest with the talisman banked: asking Aubury for the teleport settles it
        // in a few ticks instead of a walk to Lumbridge.
        const p = this.pos();
        if (
            p.level === 0 && !inMine(this.state()) && Math.abs(p.x - AUBURY.x) + Math.abs(p.z - AUBURY.z) < 120 &&
            !this.has(NOTES) && !this.has(PACKAGE) && !this.has(TALISMAN)
        ) {
            await this.goToAubury();
            const t0 = this.tick();
            await this.bot.interactNpc(/^aubury$/i, /teleport/i);
            if (await this.until(inMine, 12_000)) return this.markQuestDone('aubury teleported us');
            if (!this.messagesSince(t0).some(m => /completed the rune mysteries/i.test(m))) {
                this.ctx.log('teleport probe inconclusive', { msgs: this.messagesSince(t0) });
            }
            hint = 'aubury';
        } else if (inTowerBasement(this.state()) || Math.abs(p.x - WIZARDS_TOWER.x) + Math.abs(p.z - WIZARDS_TOWER.z) < 40) {
            // Near Sedridor with nothing held: most likely he has the talisman (stage 2).
            hint = 'sedridor';
        }
        for (let step = 1; step <= 14; step++) {
            this.checkSignal();
            const s = this.state();
            if (inMine(s) || this.count(ESSENCE) > 0) return this.markQuestDone('holding essence');

            if (this.has(NOTES)) {
                await this.goToSedridor();
                const r = await this.converse(/^sedridor$/i, [/teleport me to the rune essence/i]);
                if (!this.has(NOTES) && this.has(TALISMAN)) return this.markQuestDone('notes delivered');
                this.ctx.log('sedridor kept talking', { lines: r.lines.slice(-3) });
                continue;
            }
            if (this.has(PACKAGE)) {
                await this.goToAubury();
                await this.converse(/^aubury$/i, [/package for you/i]);
                if (!this.has(PACKAGE)) await this.converse(/^aubury$/i, [/no thank you/i]);
                hint = this.has(NOTES) ? null : 'aubury';
                continue;
            }
            if (hint === 'aubury') {
                await this.goToAubury();
                const r = await this.converse(/^aubury$/i, [/teleport me to the rune essence/i, /package for you/i, /no thank you/i]);
                if (r.offered.some(o => o.some(t => /teleport me to the rune essence/i.test(t)))) return this.markQuestDone('aubury offers teleport');
                hint = this.has(NOTES) ? null : 'sedridor';
                continue;
            }
            if (this.has(TALISMAN) || hint === 'sedridor') {
                await this.goToSedridor();
                // "Nothing thanks" is last: it is only reached when he offers the
                // essence teleport (quest done) or has not heard of the quest.
                const r = await this.converse(/^sedridor$/i, [/looking for the head wizard/i, /ok, here you are/i, /yes, certainly/i, /^nothing thanks/i]);
                const offeredTeleport = r.offered.some(o => o.some(t => /teleport me to the rune essence/i.test(t)));
                if (offeredTeleport) return this.markQuestDone('sedridor offers teleport');
                if (this.has(PACKAGE) || this.has(NOTES)) continue;
                hint = /speak to him again|speak to aubury once more/i.test(r.lines.join(' ')) ? 'aubury' : 'duke';
                continue;
            }
            await this.goToDuke();
            const r = await this.converse(/^duke horacio$/i, [/any quests for me/i, /sure, no problem/i]);
            if (/all is well for me/i.test(r.lines.join(' '))) return this.markQuestDone('duke: all is well');
            hint = 'sedridor';
        }
        throw new Error('Rune Mysteries did not complete within 14 steps');
    }

    private markQuestDone(why: string) {
        this.questDone = true;
        this.ctx.log('rune mysteries complete', { why });
    }

    // ---------------------------------------------------------------- banking

    private bestPickaxeFor(level: number, names: string[]): RegExp | null {
        for (const p of PICKAXES) if (level >= p.level && names.some(n => p.name.test(n))) return p.name;
        return null;
    }

    /** Open the Varrock east bank, deposit everything except the best usable pickaxe, report the bank. */
    private async bankAtVarrockEast(): Promise<void> {
        await this.toSurface();
        await this.travel(VARROCK_EAST_BANK, 3, 'Varrock east bank');
        let opened = false;
        for (let attempt = 1; attempt <= 3 && !opened; attempt++) {
            const r = await this.bot.openBank();
            opened = r.success;
            if (!opened) this.ctx.log('openBank retry', { attempt, reason: r.message });
        }
        if (!opened) throw new Error('could not open Varrock east bank');

        const mining = this.sdk.getSkill('Mining')?.baseLevel ?? 1;
        const held = [...this.sdk.getInventory(), ...this.sdk.getEquipment()].map(i => i.name);
        const banked = this.sdk.getBankItems().map(i => i.name);
        const best = this.bestPickaxeFor(mining, [...held, ...banked]);
        const keep = best && held.some(n => best.test(n)) ? best : null;

        const essence = this.count(ESSENCE);
        if (essence > 0) await this.deposit(ESSENCE);
        for (const item of [...this.sdk.getInventory()]) {
            if (ESSENCE.test(item.name)) continue;
            if (keep && keep.test(item.name)) continue;
            await this.deposit(new RegExp(`^${item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
        }
        if (best && !keep) {
            const w = await this.bot.withdrawItem(best, 1);
            this.ctx.log('withdrew pickaxe', { pickaxe: String(best), ok: w.success });
        }
        const items = this.sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count }));
        this.ctx.reportBank({ items });
        await this.bot.closeBank();
        await this.wieldPickaxe();
        this.bankEssence = items.find(i => ESSENCE.test(i.name))?.count ?? 0;
        this.ctx.log('banked', { essence, bankEssence: this.bankEssence });
    }

    private async deposit(pattern: RegExp): Promise<void> {
        const r = await this.bot.depositItem(pattern, -1);
        if (!r.success) this.ctx.log('deposit short', { item: String(pattern), reason: r.message });
    }

    /** Wield the best pickaxe if the account can; otherwise it stays in the pack and still works. */
    private async wieldPickaxe(): Promise<void> {
        const mining = this.sdk.getSkill('Mining')?.baseLevel ?? 1;
        const carried = this.sdk.getInventory().filter(i => PICKAXE.test(i.name));
        if (carried.length === 0) return;
        const best = this.bestPickaxeFor(mining, carried.map(i => i.name));
        if (!best) return;
        const worn = this.sdk.getEquipment().find(i => PICKAXE.test(i.name));
        const rank = (name: string) => PICKAXES.findIndex(p => p.name.test(name));
        if (worn && rank(worn.name) <= PICKAXES.findIndex(p => p.name === best)) return;
        const item = carried.find(i => best.test(i.name))!;
        const attack = this.sdk.getSkill('Attack')?.baseLevel ?? 1;
        if ((PICKAXES.find(p => p.name === best)?.attack ?? 1) > attack) return; // works from the pack
        if (!item.optionsWithIndex.some(o => /wield/i.test(o.text))) return;
        const r = await this.bot.equipItem(item);
        if (!r.success) this.ctx.log('could not wield pickaxe', { pickaxe: item.name, reason: r.message });
    }

    private hasPickaxe(): boolean {
        return [...this.sdk.getInventory(), ...this.sdk.getEquipment()].some(i => PICKAXE.test(i.name));
    }

    // ---------------------------------------------------------------- mining

    private async teleportToMine(): Promise<void> {
        for (let attempt = 1; attempt <= 4; attempt++) {
            this.checkSignal();
            if (inMine(this.state())) return;
            await this.goToAubury();
            const t0 = this.tick();
            const r = await this.bot.interactNpc(/^aubury$/i, /teleport/i);
            if (await this.until(inMine, 12_000)) return;
            const msgs = this.messagesSince(t0);
            if (msgs.some(m => /completed the rune mysteries/i.test(m))) {
                this.questDone = false;
                await this.ensureQuest();
                continue;
            }
            this.ctx.log('teleport retry', { attempt, result: r.message, msgs });
        }
        throw new Error('Aubury teleport failed 4 times');
    }

    private async leaveMine(): Promise<void> {
        await this.useLoc(/^portal$/i, /use/i, s => !inMine(s), 'essence mine portal');
    }

    /** Mine until the pack is full. Returns essence gained. */
    private async mineUntilFull(): Promise<number> {
        const before = this.count(ESSENCE);
        let lastCount = before;
        let lastGainAt = Date.now();
        let rock: NearbyLoc | null = null;
        while (this.freeSlots() > 0) {
            this.checkSignal();
            const s = this.state();
            if (!inMine(s)) throw new Error('left the mine while mining');
            if (s.dialog.isOpen) await this.bot.dismissBlockingUI(); // level-up
            const now = this.count(ESSENCE);
            if (now > lastCount) {
                lastCount = now;
                lastGainAt = Date.now();
            }
            // Pickaxe cycles are 3-8 ticks; 12 ticks without a gain means the loop stopped.
            const stalled = Date.now() - lastGainAt > 12 * 300 || rock === null;
            if (stalled) {
                // The SDK names mining rocks "Rocks <ore>": this one is "Rocks rune essence ore".
                rock = await this.findLoc(/rune essence/i, /^mine$/i, 40);
                if (!rock) throw new Error(`no essence rock visible from ${JSON.stringify(this.pos())}`);
                await this.bot.interactLoc(rock, /mine/i);
                lastGainAt = Date.now();
                continue;
            }
            await this.sdk.waitForTicks(1);
        }
        return this.count(ESSENCE) - before;
    }

    private async trip(): Promise<void> {
        const t0 = this.tick();
        const w0 = Date.now();
        await this.teleportToMine();
        const t1 = this.tick();
        const mined = await this.mineUntilFull();
        const t2 = this.tick();
        await this.leaveMine();
        await this.bankAtVarrockEast();
        await this.goToAubury();
        const t3 = this.tick();
        this.trips++;
        this.minedThisRun += mined;
        const hours = (Date.now() - this.startedAt) / 3_600_000;
        this.ctx.log('trip', {
            trip: this.trips,
            mined,
            ticks: t3 - t0,
            ticksToMine: t1 - t0,
            ticksMining: t2 - t1,
            ticksBack: t3 - t2,
            seconds: Math.round((Date.now() - w0) / 1000),
            mining: this.sdk.getSkill('Mining')?.baseLevel,
            pickaxe: [...this.sdk.getEquipment(), ...this.sdk.getInventory()].find(i => PICKAXE.test(i.name))?.name,
            perHourThisRun: hours > 0 ? Math.round(this.minedThisRun / hours) : null
        });
    }

    // ---------------------------------------------------------------- main loop

    async run(): Promise<void> {
        const maxTrips = Number(this.ctx.options.trips ?? Infinity);
        const target = Number(this.ctx.options.target ?? Infinity);
        await this.sdk.waitForReady(30_000);
        if (onTutorialIsland(this.state())) {
            this.setPhase('tutorial');
            for (let i = 0; i < 30 && onTutorialIsland(this.state()); i++) {
                await this.bot.skipTutorial();
                await this.sdk.waitForTicks(3);
            }
            this.ctx.log('tutorial skipped', { at: this.pos() });
        }
        let failures = 0;
        while (!this.ctx.signal.aborted && this.trips < maxTrips && this.bankEssence < target) {
            try {
                await this.bot.dismissBlockingUI();
                if (this.state().player!.isDead) await this.sdk.waitForTicks(10);
                if (!this.questDone) this.setPhase('quest');
                await this.ensureQuest();
                this.setPhase('mine');
                // Restart cases: essence or starter junk in the pack, or no pickaxe on us.
                const s = this.state();
                if (inMine(s) && this.freeSlots() > 0 && this.hasPickaxe()) {
                    await this.mineUntilFull();
                }
                if (this.count(ESSENCE) > 0 || this.sdk.getInventory().some(i => !PICKAXE.test(i.name)) || !this.hasPickaxe()) {
                    await this.bankAtVarrockEast();
                    if (!this.hasPickaxe()) throw new Error('no pickaxe in inventory, equipment or bank');
                }
                await this.trip();
                failures = 0;
            } catch (e) {
                if (e instanceof Stop) break;
                failures++;
                this.ctx.log('cycle failed', { error: String((e as Error)?.message ?? e), failures, at: this.sdk.getState()?.player ? this.pos() : null });
                if (failures >= 8) throw e;
                // Plain timers here: after a dropped session no ticks arrive until the
                // client re-logs, and a tick wait would throw out of the loop.
                await new Promise(r => setTimeout(r, 3_000 * failures));
                await this.sdk.waitForReady(120_000).catch(() => {});
            }
        }
        this.ctx.log('stopping', { trips: this.trips, minedThisRun: this.minedThisRun, bankEssence: this.bankEssence });
    }
}

export const role: Role = {
    name: 'essence',
    produces: [ESSENCE],
    async run(ctx: RoleContext) {
        await new EssenceMiner(ctx).run();
    }
};

if (import.meta.main) await runStandalone(role);
