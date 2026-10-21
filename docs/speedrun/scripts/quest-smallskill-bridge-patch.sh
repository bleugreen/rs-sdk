#!/usr/bin/env bash
# LAB ONLY. Applies (or with --check, reports) a local patch to the lite client
# that stores server loc changes on bridged tiles at the map level the static
# loc index uses, so that a door opened on a bridged floor (the Sea Slug
# fishing platform) stops blocking the client's router. Never commit the patched
# file: run it inside a batch without a commit message, which discards the edit.
#
# The defect (read): protocol/zone.ts writes LOC_ADD_CHANGE / LOC_DEL into the
# overlay at c.minusedlevel (the player's real level, 0 on the platform's ground
# floor), but the static LocIndex keeps a bridged tile's locs at map level 1.
# CollisionBuilder.ts then shifts the level-0 overlay entry to level -1 and
# drops it, and keeps the static closed door, so the door never opens for
# routing. See docs/speedrun/quests/sea_slug.md.
set -eu
cd "$(git rev-parse --show-toplevel)/server/webclient/src/lite/protocol"
grep -q 'smallskill-bridge-patch' zone.ts && { echo '[patch] already applied'; exit 0; }
[ "${1:-}" = "--check" ] && { echo '[patch] not applied'; exit 0; }
perl -0pi -e 's|(case ServerProt\.LOC_ADD_CHANGE: \{\n\s*const info = buf\.g1\(\);\n\s*const id = buf\.g2\(\);\n\s*if \(inArea\) \{\n\s*)c\.world\.addLoc\(level,|$1c.world.addLoc(mapLevel(c, level, x, z), /* smallskill-bridge-patch */|; s|(case ServerProt\.LOC_DEL: \{\n\s*const info = buf\.g1\(\);\n\s*if \(inArea\) \{\n\s*)c\.world\.delLoc\(level,|$1c.world.delLoc(mapLevel(c, level, x, z),|' zone.ts
cat >> zone.ts <<'EOF'

// smallskill-bridge-patch (lab only): the static index keys a bridged tile's locs one level up.
function mapLevel(c: LiteClient, level: number, x: number, z: number): number {
    return level < 3 && (c.locIndex.mapFlags(1, c.mapBuildBaseX + x, c.mapBuildBaseZ + z) & 0x2) !== 0 ? level + 1 : level;
}
EOF
grep -c 'mapLevel(c, level, x, z)' zone.ts
