// The courier trip (speedrun/helpers/mule.ts, docs/speedrun/helpers/mule.md) under its own role
// name, so the fleet, which loads `speedrun/helpers/<role>.ts` and runs its `role`, can assign it:
//   fleetctl assign cairn_h63 courier --options '{"mule":"cairn_h51","items":["^coins$"]}'
import { runStandalone } from './role';
import { courier } from './mule';

export const role = courier;

if (import.meta.main) await runStandalone(role);
