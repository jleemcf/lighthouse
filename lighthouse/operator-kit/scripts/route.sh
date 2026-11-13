#!/usr/bin/env bash
# Owner's route: his messages, printed as "Owner (...): ..." lines, one persistent Monitor like the other
# instruments. Runs the board watch with this machine's settings stamped in by the installer, so the operator's page
# names no server and no board:   bash route.sh
cd "$(cd "$(dirname "$0")" && pwd)" || exit 1
LH_TOKEN="$(tr -d '\r\n' < LH-TOKEN.txt)" exec node boardwatch.cjs --server __BOARD_SERVER__ --board __BOARD_ID__
