import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../sdk/types';
import { baseState, drive, FakeSdk } from '../lib/fake-sdk';
import type { RunnerSession } from '../runner/step';
import { LUMBRIDGE_SPAWN, PLAYER_KIT } from '../skills/start';
import { leaveTutorial, mustTele, tele, VARROCK_WEST_BANK } from './setup';

const prevTick = process.env.SPEEDRUN_TICK_MS;
beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });
afterAll(() => { if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS; else process.env.SPEEDRUN_TICK_MS = prevTick; });

const at = (x: number, z: number) => ({ worldX: x, worldZ: z, x, z, level: 0 }) as BotWorldState['player'];
const ISLAND = { x: 3094, z: 3106 };
const BANK_TELE = '::tele 0,49,53,49,44';

/** A staff server: `::tele level,mx,mz,lx,lz` lands the player on the next tick. */
function staffServer(sdk: FakeSdk): void {
    const prev = sdk.onSend;
    sdk.onSend = (a, f) => {
        prev(a, f);
        const m = a.method === 'sendSay' ? /^::tele (\d+),(\d+),(\d+),(\d+),(\d+)$/.exec(String(a.args[0])) : null;
        if (!m) return;
        const [level, mx, mz, lx, lz] = m.slice(1).map(Number) as [number, number, number, number, number];
        setTimeout(() => f.tick({ player: { ...at(mx * 64 + lx, mz * 64 + lz)!, level } }), 1);
    };
}

/** A first login: the design screen open beside the RuneScape Guide, answering the way the content does. */
function firstLogin(): FakeSdk {
    const guide = { kind: 'npc', index: 7, name: 'RuneScape Guide', optionsWithIndex: [{ text: 'Talk-to', opIndex: 1 }], options: ['Talk-to'] };
    const kit = ['Bronze axe', 'Tinderbox', 'Small fishing net', 'Bronze pickaxe'].map((name, slot) => ({ slot, id: slot, name, count: 1, optionsWithIndex: [] }));
    const sdk = new FakeSdk(baseState({ tick: 3, player: at(ISLAND.x, ISLAND.z), modalOpen: true, modalInterface: PLAYER_KIT, nearbyNpcs: [guide] as unknown as BotWorldState['nearbyNpcs'] }));
    sdk.onSend = (a, f) => {
        const page = (dialog: unknown, more: Partial<BotWorldState> = {}) => setTimeout(() => f.tick({ dialog: dialog as BotWorldState['dialog'], ...more }), 1);
        if (a.method === 'sendInteractNpc') page({ isOpen: true, isWaiting: false, pageId: 'p1', options: [{ index: 0, text: 'Click here to continue' }] }, { modalOpen: false, modalInterface: -1 });
        if (a.method === 'sendClickDialog') page({ isOpen: true, isWaiting: false, pageId: 'p2', options: [{ index: 1, text: 'Yes please.', buttonType: 1 }, { index: 2, text: 'No, thank you.', buttonType: 1 }] });
        if (a.method === 'clickDialogByText') page({ isOpen: false, options: [], isWaiting: false }, { player: at(LUMBRIDGE_SPAWN.x, LUMBRIDGE_SPAWN.z), inventory: kit as BotWorldState['inventory'] });
    };
    (sdk as unknown as Record<string, unknown>).sendAcceptCharacterDesign = () => sdk.sendAction({ method: 'sendAcceptCharacterDesign', args: [] });
    staffServer(sdk);
    return sdk;
}

const session = (sdk: FakeSdk) => ({ sdk, bot: {}, name: 'lab', sessionId: 1 }) as unknown as RunnerSession;
const says = (sdk: FakeSdk) => sdk.sent.filter(a => a.method === 'sendSay').map(a => a.args[0]);

describe('tele on Tutorial Island', () => {
    test('tele and mustTele refuse, naming S00\'s tutorialSkip, and send nothing', async () => {
        const sdk = new FakeSdk(baseState({ player: at(ISLAND.x, ISLAND.z) }));
        staffServer(sdk);
        await expect(tele(sdk as never, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z)).rejects.toThrow(/Tutorial Island.*tutorialSkip/);
        await expect(mustTele(sdk as never, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z)).rejects.toThrow(/Tutorial Island.*tutorialSkip/);
        expect(says(sdk)).toEqual([]);
    });

    test('the tutorial dungeon counts as the island', async () => {
        const sdk = new FakeSdk(baseState({ player: at(3100, 9500) }));
        await expect(tele(sdk as never, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z)).rejects.toThrow('refused');
    });

    test('off the island tele sends the staff command and lands', async () => {
        const sdk = new FakeSdk(baseState({ player: at(LUMBRIDGE_SPAWN.x, LUMBRIDGE_SPAWN.z) }));
        staffServer(sdk);
        expect(await drive(sdk, tele(sdk as never, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z))).toBe(true);
        expect(says(sdk)).toEqual([BANK_TELE]);
        expect(sdk.getState()!.player).toMatchObject({ worldX: VARROCK_WEST_BANK.x, worldZ: VARROCK_WEST_BANK.z });
    });

    test('leaveTutorial runs S00, after which mustTele stages the account', async () => {
        const sdk = firstLogin();
        await drive(sdk, leaveTutorial(session(sdk)));
        expect(sdk.sent.map(a => a.method)).toEqual(['sendAcceptCharacterDesign', 'sendInteractNpc', 'sendClickDialog', 'clickDialogByText']);
        await drive(sdk, mustTele(sdk as never, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z));
        expect(says(sdk)).toEqual([BANK_TELE]);
    });

    test('leaveTutorial is a no-op off the island', async () => {
        const sdk = new FakeSdk(baseState({ player: at(LUMBRIDGE_SPAWN.x, LUMBRIDGE_SPAWN.z) }));
        await leaveTutorial(session(sdk));
        expect(sdk.sent).toEqual([]);
    });
});
