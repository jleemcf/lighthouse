#!/bin/bash
# Run the record check against this machine's board server. Reads only; prints RECORD CHECK lines for the operator.
# Token: LH-TOKEN.txt beside this script (issued by Owner). Cursor: record-check-cursor.json beside this script.
D="$(cd "$(dirname "$0")" && pwd)"
T="$(tr -d '\r\n' < "$D/LH-TOKEN.txt" 2>/dev/null)"
# the machine's board address, not the test rig's localhost: a check against localhost is blind to the board
LH_TOKEN="$T" python3 "$D/record-check.py" --home "__FM_HOME__" --server "__BOARD_SERVER__" --board "__BOARD_ID__" \
  --cursor "$D/record-check-cursor.json"
