#!/usr/bin/env bash
# The watch operator's instrument: the conduct reports of the boards it watches, printed as lines, one persistent
# Monitor like the others. Stamped by the installer; on a machine that watches no board it says so and exits.
#   bash watch.sh
cd "$(cd "$(dirname "$0")" && pwd)" || exit 1
case "__WATCH_BOARDS__" in
  none|"") echo "this machine watches no other board (__WATCH_BOARDS__ in its config)"; exit 0 ;;
esac
LH_TOKEN="$(tr -d '\r\n' < LH-TOKEN.txt)" exec node conductwatch.cjs --server __BOARD_SERVER__ \
  --boards "__WATCH_BOARDS__"
