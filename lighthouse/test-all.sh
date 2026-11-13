#!/usr/bin/env bash
# Run every Lighthouse test suite and print one line per suite. Exit status is non-zero if any suite fails.
# The Jev key is removed from the environment so no test can reach the real Jev service (the tests use stand-ins).
#   bash lighthouse/test-all.sh
cd "$(dirname "$0")" || exit 2
unset TYPESAFE_API_KEY
exec node tests/run-all.cjs
