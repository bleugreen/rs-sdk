#!/bin/bash
# Run the bones role for ACCOUNT, restarting it 15 s after it exits, until $R/run/stop-ACCOUNT
# exists. While $R/run/pause-ACCOUNT exists the role is not (re)started.
# Options: $R/run/ACCOUNT.options.json, re-read at every start. Log: $R/logs/role-ACCOUNT.log.
a=$1; R=${BONES_DEV:-$HOME/rs-dev/babyblue}; PORT=${BONES_PORT:-7782}; log=$R/logs/role-$a.log
echo $$ > $R/run/$a.roleloop.pid
cd $R
while [ ! -e $R/run/stop-$a ]; do
  if [ -e $R/run/pause-$a ]; then sleep 5; continue; fi
  opts=$(cat $R/run/$a.options.json 2>/dev/null || echo '{}')
  GATEWAY_URL=ws://127.0.0.1:$PORT ROLE_OPTIONS="$opts" ~/.bun/bin/bun speedrun/helpers/bones.ts $a >> $log 2>&1 &
  echo $! > $R/run/$a.role.pid
  wait $!
  echo "{\"t\":\"$(date -u +%FT%TZ)\",\"message\":\"role-loop: role exited\"}" >> $log
  [ -e $R/run/stop-$a ] || [ -e $R/run/pause-$a ] || sleep 15
done
rm -f $R/run/$a.role.pid $R/run/$a.roleloop.pid
