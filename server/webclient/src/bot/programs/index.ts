// In-page tick programs: the registry of the speedrun's reactive loops.
// docs/speedrun/tick-programs.md describes the design and how a step script drives them.

import { createAgility } from './agility.js';
import { createKnifeCycle } from './knife-cycle.js';
import { createKnifeMine } from './knife-mine.js';
import { createPickpocket } from './pickpocket.js';
import { createProbe } from './probe.js';
import type { ProgramRuntime } from './runtime.js';

export { ProgramRuntime, parseProgramCommand, USER_EVENTS_PER_TICK } from './runtime.js';
export { ProgramHost } from './host.js';
export type { ProgramStatus, ProgramCommand, ProgramParams, TickProgram, ProgramContext } from './types.js';

/** Names the SDK starts programs by. */
export function registerPrograms(runtime: ProgramRuntime): ProgramRuntime {
    return runtime
        .register('probe', createProbe)
        .register('knife-cycle', createKnifeCycle)
        .register('knife-mine', createKnifeMine)
        .register('pickpocket', createPickpocket)
        .register('agility', createAgility);
}
