// The first import of every webclient test suite.
//
// graphics/Jpeg.ts touches `document` at module scope and IfType reaches it, so a
// suite that loads client modules needs DOM globals in place before its first
// import that could get there. Each suite installs them itself, with this import
// ahead of every other, and none assigns window, document, navigator or fetch on
// its own:
//
// - The root `bun run test` passes --isolate, so every file gets a fresh global
//   object and module registry: whatever an earlier file installed is gone.
// - A run without --isolate (`cd server/webclient && bun test src`, or files named
//   on the command line) shares one registry, and a module that throws while it is
//   first evaluated stays broken for the rest of the run. The first suite to reach
//   Jpeg.ts without the globals leaves IfType uninitialized for every file after it
//   ("Cannot access 'IfType' before initialization"). Which file is first is the
//   order Bun scans a directory in, which differs between machines.
//
// The rule covers suites whose imports do not reach browser code today, since one
// import added to a module under test is enough to change that.
// browser-globals.test.ts holds every suite to it.
//
// ../dom-shim.js only fills in globals that are missing, so importing it from every
// suite is harmless.

import '../dom-shim.js';
