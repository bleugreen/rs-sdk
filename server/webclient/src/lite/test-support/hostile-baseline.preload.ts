// Preload that captures a junk interface baseline before any test file loads:
// the state an earlier suite in the same `bun test` process can leave behind.
// Every suite that builds LiteClients without the real cache must pass under it,
// e.g.
//
//   LITE_TEST_ORIGIN=http://127.0.0.1:9 bun test \
//     --preload ./server/webclient/src/lite/test-support/hostile-baseline.preload.ts \
//     server/webclient/src/lite/game-tick.test.ts

import '../dom-shim.js';

import IfType from '#/config/IfType.js';

import { captureBaseInterfaces, resetBaseInterfaces } from '../interfaces.js';
import { stubComponent } from './stub-baseline.js';

resetBaseInterfaces();
IfType.list = [1, 2, 3].map(id => stubComponent(id, { text: 'junk' }));
captureBaseInterfaces();
