import { describe, expect, test } from 'bun:test';

import '../lite/test-support/browser-globals.js';

const { BotStateCollector } = await import('./StateCollector.js');
const { default: IfType } = await import('#/config/IfType.js');

function createClient() {
    const skills = new Array(21).fill(1);
    skills[3] = 10;

    const client: any = {
        getClientCycle: () => 100,
        localPlayer: {
            name: 'Tester',
            combatLevel: 3,
            x: 128,
            z: 128,
            faceEntity: 7,
            // Deliberately different: the removed field must never win.
            targetId: 99,
            combatCycle: 120,
            damageCycles: new Int32Array([110, 0, 0, 0]),
            damageValues: new Int32Array([2, 0, 0, 0]),
            primaryAnim: -1,
            spotanimId: -1
        },
        statEffectiveLevel: [...skills],
        statBaseLevel: [...skills],
        mapBuildBaseX: 3200,
        mapBuildBaseZ: 3200,
        minusedlevel: 0,
        runenergy: 100,
        runweight: 0,
        npcCount: 1,
        npcIds: [7],
        npc: {
            7: {
                type: { name: 'Rat', vislevel: 1, op: ['Attack'] },
                x: 256,
                z: 128,
                health: 0,
                totalHealth: 0,
                faceEntity: -1,
                combatCycle: 0,
                primaryAnim: -1,
                spotanimId: -1,
                damageCycles: new Int32Array(4),
                damageValues: new Int32Array(4)
            }
        }
    };
    return client;
}

describe('BotStateCollector combat state', () => {
    test('uses the public tick for damage events and faceEntity for targeting', () => {
        const client = createClient();
        const collector = new BotStateCollector(client);

        (collector as any).collectCombatEvents(12);
        const player = (collector as any).collectPlayerState(12, 100);

        expect(player.combat.targetIndex).toBe(7);
        expect(player.combat.lastDamageTick).toBe(12);
        expect((collector as any).combatEvents[0].tick).toBe(12);
    });

    test("a damage_taken event on the player carries the hitsplat's type: 2 is a poison tick", () => {
        const client = createClient();
        client.localPlayer.damageTypes = new Int32Array([2, 0, 0, 0]);
        const collector = new BotStateCollector(client);

        (collector as any).collectCombatEvents(12);
        expect((collector as any).combatEvents[0]).toMatchObject({ type: 'damage_taken', targetType: 'player', damage: 2, hitmark: 2 });

        // A client entity without types (the fixture's default) publishes no hitmark rather than a guess.
        const bare = new BotStateCollector(createClient());
        (bare as any).collectCombatEvents(12);
        expect((bare as any).combatEvents[0].hitmark).toBeUndefined();
    });

    test('publishes UI-observed and same-tick duplicate messages on newer revisions', () => {
        const client = createClient();
        client.chatText = ['Hello'];
        client.chatUsername = ['Guide'];
        client.chatType = [0];
        client.messageTick = [9_999];
        client.messageSequence = [1];
        const collector = new BotStateCollector(client);

        // UI polling sees the message at server tick 5, but must not consume
        // the publication cursor before an agent-visible state is sent.
        const uiState = collector.collectState(5, false);
        expect(uiState.revision).toBe(0);
        expect(uiState.gameMessages[0]!.observationId).toBeUndefined();
        expect(uiState.combatEvents[0]!.observationId).toBeUndefined();

        const published = collector.collectState(6, true);
        expect(published.revision).toBe(1);
        expect(published.gameMessages[0]).toMatchObject({ tick: 5, observationId: 1 });
        expect(published.combatEvents[0]).toMatchObject({ tick: 5, observationId: 1 });

        // A repeated publication at the same server tick advances revision,
        // while old evidence retains its original observation id.
        const repeated = collector.collectState(6, true);
        expect(repeated).toMatchObject({ tick: 6, revision: 2 });
        expect(repeated.gameMessages[0]!.observationId).toBe(1);

        client.chatText.unshift('Hello');
        client.chatUsername.unshift('Guide');
        client.chatType.unshift(0);
        client.messageTick.unshift(9_999);
        client.messageSequence.unshift(2);
        const sameTickDuplicate = collector.collectState(6, true);

        expect(sameTickDuplicate.revision).toBe(3);
        expect(sameTickDuplicate.gameMessages.map(message => message.observationId)).toEqual([1, 3]);
    });

    test('represents unrevealed NPC health as unknown rather than dead', () => {
        const client = createClient();
        const collector = new BotStateCollector(client);

        const [npc] = (collector as any).collectNearbyNpcs(100);

        expect(npc.hp).toBeNull();
        expect(npc.maxHp).toBeNull();
        expect(npc.healthPercent).toBeNull();
    });

    test('reports health only inside the hitbar window, so respawns are not stuck at 0', () => {
        const client = createClient();
        client.npc[7].health = 0;
        client.npc[7].totalHealth = 22;
        const collector = new BotStateCollector(client);

        // Freshly hit (combatCycle runs 400 cycles past the hit): health is known.
        client.npc[7].combatCycle = 150;
        const [fighting] = (collector as any).collectNearbyNpcs(100);
        expect(fighting).toMatchObject({ hp: 0, maxHp: 22, healthPercent: 0, inCombat: true });

        // The window has passed — the entity keeps the dead value through respawn,
        // but the collector must go back to "unknown", not advertise a corpse.
        client.npc[7].combatCycle = 90;
        const [respawned] = (collector as any).collectNearbyNpcs(100);
        expect(respawned).toMatchObject({ hp: null, maxHp: null, healthPercent: null, inCombat: false });
    });

    test('drops a stale pinned target once nothing corroborates the fight', () => {
        const client = createClient();
        client.localPlayer.combatCycle = 90; // last hit long over
        const collector = new BotStateCollector(client);

        // Facing just began: walk-up grace keeps the target live.
        const approaching = (collector as any).collectPlayerState(1, 100);
        expect(approaching.combat).toMatchObject({ inCombat: true, targetIndex: 7 });

        // Ten+ seconds later with no hits on either side, the facing is just
        // the character staring at its old target (e.g. after a reconnect).
        const stale = (collector as any).collectPlayerState(2, 700);
        expect(stale.combat).toMatchObject({ inCombat: false, targetIndex: -1, targetType: 'none' });

        // But a fresh hit on the target (one-sided fight) keeps it real.
        client.npc[7].combatCycle = 800;
        const fighting = (collector as any).collectPlayerState(3, 700);
        expect(fighting.combat).toMatchObject({ inCombat: true, targetIndex: 7 });
    });

    test('does not identify talking or trading with a shopkeeper as a fight', () => {
        const client = createClient();
        client.npc[7].type = { name: 'Shop keeper', vislevel: 0, op: ['Talk-to', 'Trade'] };
        client.localPlayer.combatCycle = 90;
        const collector = new BotStateCollector(client);
        expect((collector as any).collectPlayerState(1, 100).combat)
            .toMatchObject({ inCombat: false, targetIndex: -1, targetType: 'none' });

        // Recent damage from another entity must not make the shopkeeper our opponent.
        client.localPlayer.combatCycle = 120;
        expect((collector as any).collectPlayerState(2, 100).combat)
            .toMatchObject({ inCombat: true, targetIndex: -1, targetType: 'none' });
    });

    test('decodes player targets, which the client packs above the npc index space', () => {
        const client = createClient();
        client.localPlayer.faceEntity = 32768 + 3; // player slot 3, not npc 32771

        const collector = new BotStateCollector(client);
        const player = (collector as any).collectPlayerState(1, 100);

        expect(player.combat).toMatchObject({ inCombat: true, targetType: 'player', targetIndex: 3 });
    });

    test('exposes death and respawn transitions with a stable life id', () => {
        const client = createClient();
        const collector = new BotStateCollector(client);

        const alive = (collector as any).collectPlayerState(1, 100);
        client.statEffectiveLevel[3] = 0;
        const dead = (collector as any).collectPlayerState(2, 100);
        client.statEffectiveLevel[3] = 10;
        const respawned = (collector as any).collectPlayerState(3, 100);

        expect(alive).toMatchObject({ isDead: false, lifeId: 1, respawnCount: 0 });
        expect(dead).toMatchObject({ isDead: true, lifeId: 1, lastDeathTick: 2 });
        expect(respawned).toMatchObject({ isDead: false, lifeId: 2, respawnCount: 1 });
    });
});

describe('BotStateCollector positions', () => {
    test('reports where the server put entities, not where they are drawn', () => {
        const client = createClient();
        // The server stepped the player from tile (1,1) to (2,1) and the rat from
        // (2,1) to (3,1); the browser is still easing both sprites across the
        // old tiles. The lite client snaps x/z to the server tile instead.
        Object.assign(client.localPlayer, { x: 128 + 64 + 40, z: 192, routeX: Int32Array.of(2), routeZ: Int32Array.of(1), size: 1 });
        Object.assign(client.npc[7], { x: 256 + 64 + 40, z: 192, routeX: Int32Array.of(3), routeZ: Int32Array.of(1), size: 1 });
        const collector = new BotStateCollector(client);

        const player = (collector as any).collectPlayerState(1, 100);
        expect([player.worldX, player.worldZ, player.x]).toEqual([3202, 3201, 2 * 128 + 64]);
        const [rat] = (collector as any).collectNearbyNpcs(100);
        expect([rat.x, rat.z, rat.distance]).toEqual([3203, 3201, 1]);
    });
});

describe('BotStateCollector jumps and region loading', () => {
    test('teleportTick is the tick of the last teleport-type update of the player, unchanged by walking', () => {
        const client = createClient();
        const collector = new BotStateCollector(client);
        expect((collector as any).collectPlayerState(1, 100).teleportTick).toBeNull();
        client.localPlayer.teleports = 1; // login, or a ladder, or one agility_walk p_teleport step
        expect((collector as any).collectPlayerState(5, 100).teleportTick).toBe(5);
        // a walk step moves the player without a teleport-type update
        client.localPlayer.x += 128;
        expect((collector as any).collectPlayerState(6, 100).teleportTick).toBe(5);
        client.localPlayer.teleports = 2;
        client.localPlayer.lastTeleportJump = false; // an agility_walk p_teleport step
        expect((collector as any).collectPlayerState(9, 100)).toMatchObject({ teleportTick: 9, teleportJump: false });
        // a second collect within the tick (the overlay's) does not move it
        expect((collector as any).collectPlayerState(10, 100).teleportTick).toBe(9);
    });

    test('sceneReady is false while the client builds the region (sceneState 1), true once built (2)', () => {
        const client = createClient();
        client.ingame = true;
        const collector = new BotStateCollector(client);
        client.sceneState = 1;
        expect(collector.collectState(1, false).sceneReady).toBe(false);
        client.sceneState = 2;
        expect(collector.collectState(2, false).sceneReady).toBe(true);
    });
});

describe('BotStateCollector op feedback', () => {
    test('counts a map-flag unset as a rejection only while the player stands still', () => {
        const client = createClient();
        client.mapFlagUnsetCount = 0;
        const collector = new BotStateCollector(client);

        // First collect only establishes the baseline.
        expect(collector.collectState(1, true).opFeedback).toMatchObject({
            opRejectedCount: 0,
            lastOpRejectedTick: -1
        });

        // Refused op: the flag is unset and the player has not moved.
        client.mapFlagUnsetCount = 1;
        expect(collector.collectState(2, true).opFeedback).toMatchObject({
            mapFlagUnsetCount: 1,
            opRejectedCount: 1,
            lastOpRejectedTick: 2
        });

        // A walk finishing also unsets the flag, but the player moved to get
        // there - that must not read as a rejection.
        client.localPlayer.x = 256;
        client.mapFlagUnsetCount = 2;
        expect(collector.collectState(3, true).opFeedback).toMatchObject({
            mapFlagUnsetCount: 2,
            opRejectedCount: 1,
            lastOpRejectedTick: 2
        });
    });

    test('an extra unpublished collect on the same tick cannot consume a delta', () => {
        const client = createClient();
        client.mapFlagUnsetCount = 0;
        const collector = new BotStateCollector(client);
        collector.collectState(1, true);

        client.mapFlagUnsetCount = 1;
        // BotOverlay polls for its UI between publications; that read must leave
        // the tracking alone rather than score a phantom "not moving since 2ms ago".
        expect(collector.collectState(2, false).opFeedback.opRejectedCount).toBe(1);
        expect(collector.collectState(2, true).opFeedback.opRejectedCount).toBe(1);

        client.mapFlagUnsetCount = 2;
        expect(collector.collectState(3, true).opFeedback.opRejectedCount).toBe(2);
    });
});

describe('BotStateCollector modal inventories', () => {
    const LAYER = 0;
    const INV = 2;

    function inv(id: number, slots: number[], extra: Record<string, unknown>) {
        const linkObjType = new Int32Array(25);
        const linkObjNumber = new Int32Array(25);
        for (const slot of slots) {
            linkObjType[slot] = 1000 + slot + 1; // wire value is obj id + 1
            linkObjNumber[slot] = 1;
        }
        (IfType.list as any)[id] = { id, type: INV, linkObjType, linkObjNumber, objOps: false, iop: null, ...extra };
    }

    test('publishes every visible inventory in the open modal with its slot layout', () => {
        const modal = 61000;
        (IfType.list as any)[modal] = { id: modal, type: LAYER, hide: false, children: [61001, 61002, 61003] };
        inv(61001, [0, 1, 23], { objOps: true }); // a sliding-puzzle grid: slot 24 is the gap
        inv(61002, [4], { iop: ['Deposit 1', null, null, null, 'Deposit X'] });
        (IfType.list as any)[61003] = { id: 61003, type: LAYER, hide: true, children: [61004] };
        inv(61004, [0], {}); // inside a hidden layer: not shown to the player

        const client = createClient();
        client.mainModalId = modal;
        const state = (new BotStateCollector(client) as any).collectInterfaceState();

        expect(state.inventories.map((i: any) => i.componentId)).toEqual([61001, 61002]);

        const [grid, side] = state.inventories;
        expect(grid.size).toBe(25);
        expect(grid.items.map((item: any) => [item.slot, item.id])).toEqual([[0, 1000], [1, 1001], [23, 1023]]);

        // Without objOps the menu offers the component's own options (INV_BUTTON).
        expect(side.items[0].optionsWithIndex).toEqual([
            { text: 'Deposit 1', opIndex: 1 },
            { text: 'Deposit X', opIndex: 5 }
        ]);
    });

    test('publishes no inventories when no modal is open', () => {
        const client = createClient();
        client.mainModalId = -1;
        expect((new BotStateCollector(client) as any).collectInterfaceState().inventories).toEqual([]);
    });
});

describe('BotStateCollector combat styles', () => {
    const SELECT_BUTTON = 5;

    /**
     * Install a combat tab shaped like the real ones: a layer holding one
     * select-button per style, each carrying its com_mode value in scriptOperand.
     */
    function defineCombatTab(interfaceId: number, styleCount: number): void {
        const layerId = interfaceId + 100;
        const buttonIds = Array.from({ length: styleCount }, (_, i) => interfaceId + 200 + i);

        (IfType.list as any)[interfaceId] = { id: interfaceId, children: [layerId] };
        (IfType.list as any)[layerId] = { id: layerId, children: buttonIds };
        buttonIds.forEach((id, index) => {
            (IfType.list as any)[id] = { id, buttonType: SELECT_BUTTON, scriptOperand: [index] };
        });
    }

    function collectStyles(tabInterfaceId: number, comMode: number) {
        const client = createClient();
        client.sideIcon = [tabInterfaceId, -1, -1];
        client.var = [];
        client.var[43] = comMode; // com_mode
        return (new BotStateCollector(client) as any).collectCombatStyle();
    }

    test('reads the style table from the combat tab, not the weapon name', () => {
        // combat_stabsword (weapon_stab): a bronze sword's index 2 is aggressive,
        // trains Strength and hits with Slash. Guessing from the name "sword"
        // used to report Controlled/Shared here, which trains nothing it claims.
        defineCombatTab(2276, 4);
        const style = collectStyles(2276, 0);

        expect(style.known).toBeTrue();
        expect(style.tabInterfaceId).toBe(2276);
        expect(style.styles.map((s: any) => `${s.name}/${s.type}/${s.trainsSkills.join('+')}/${s.damageType}`)).toEqual([
            'Stab/Accurate/Attack/Stab',
            'Lunge/Aggressive/Strength/Stab',
            'Slash/Aggressive/Strength/Slash',
            'Block/Defensive/Defence/Stab'
        ]);
    });

    test('separates the two sword tabs: scimitars really are controlled at index 2', () => {
        defineCombatTab(2423, 4); // combat_hacksword -> weapon_slash_table
        const style = collectStyles(2423, 2);

        expect(style.styles[2]).toMatchObject({
            name: 'Lunge',
            type: 'Controlled',
            trainsSkills: ['Attack', 'Strength', 'Defence'],
            damageType: 'Stab'
        });
        expect(style.currentStyle).toBe(2);
    });

    test('reports longrange as training Ranged and Defence', () => {
        defineCombatTab(1764, 3); // combat_bow
        const style = collectStyles(1764, 2);

        expect(style.styles[2]).toMatchObject({
            name: 'Longrange',
            type: 'Longrange',
            trainsSkills: ['Ranged', 'Defence'],
            damageType: 'Ranged'
        });
    });

    test('clamps com_mode to the styles the tab actually has, as the server does', () => {
        defineCombatTab(425, 3); // combat_blunt has 3 styles
        expect(collectStyles(425, 3).currentStyle).toBe(2);
    });

    test('says unknown rather than guessing when the tab is unrecognised', () => {
        defineCombatTab(6666, 2);
        const style = collectStyles(6666, 0);

        expect(style.known).toBeFalse();
        expect(style.styles).toEqual([
            { index: 0, name: 'Style 0', type: 'Unknown', trainsSkills: [], damageType: 'Unknown' },
            { index: 1, name: 'Style 1', type: 'Unknown', trainsSkills: [], damageType: 'Unknown' }
        ]);
    });
});

describe('BotStateCollector quest state', () => {
    // Colours as the client stores them after IF_SETCOLOUR (5 bits a channel).
    const RED = 0xf80000, YELLOW = 0xf8f800, GREEN = 0x00f800;

    function questClient() {
        const client = createClient();
        client.var = [];
        client.var[101] = 7; // qp
        client.var[173] = 1; // option_run
        client.var[31] = 100; // doricquest: never transmitted, must not leak
        client.mainModalId = -1;
        (IfType.list as any)[7336] = { id: 7336, colour: GREEN }; // questlist:doric
        (IfType.list as any)[7372] = { id: 7372, colour: YELLOW }; // questlist:elena
        (IfType.list as any)[7333] = { id: 7333, colour: RED }; // questlist:cook
        (IfType.list as any)[7380] = { id: 7380, colour: 0xff0000 }; // questlist:tree, the cache default
        (IfType.list as any)[8144] = { id: 8144, text: '@dre@Plague City' };
        (IfType.list as any)[8145] = { id: 8145, text: '@dbl@I need to use Water to soften' };
        (IfType.list as any)[8147] = { id: 8147, text: '@dbl@the ground near the sewer.' };
        for (let id = 8148; id <= 8195; id++) (IfType.list as any)[id] = { id, text: '' };
        return client;
    }

    test('publishes the varp whitelist, quest points and the started/complete quests', () => {
        const state = new BotStateCollector(questClient()).collectState(1, true);

        expect(state.varps).toEqual({ qp: 7, option_run: 1, bankcert: 0 });
        expect(state.questPoints).toBe(7);
        expect(state.quests).toEqual({ doric: 'complete', elena: 'started' });
        expect(state.questJournal).toBeNull();
    });

    test('keeps the journal after it closes, with the tick it was last open', () => {
        const client = questClient();
        const collector = new BotStateCollector(client);

        client.mainModalId = 8134;
        expect(collector.collectState(5, true).questJournal).toEqual({
            title: 'Plague City',
            lines: ['@dbl@I need to use Water to soften', '@dbl@the ground near the sewer.'],
            open: true,
            tick: 5
        });

        client.mainModalId = -1;
        expect(collector.collectState(6, true).questJournal).toMatchObject({ title: 'Plague City', open: false, tick: 5 });
    });
});
