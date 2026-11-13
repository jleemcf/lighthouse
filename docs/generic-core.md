# Shared core and local profiles

The shared inventory is `scripts/export-inventory.json`. Local machine
configurations, policy history, profile data and private notes belong outside the public tree.
The overlay is not part of a board release or a public export. Never put credentials, private host addresses
or email addresses in either part of the checkout. Real configurations and credentials stay on their hosts.

## Configuration

New installations start from `lighthouse/server/config.example.json` and the kit's neutral example.
Keep `ownerId` stable when changing `ownerName`; names shown on screen do not grant authority.
Token names and board access keys use the stable identity. Explicit `ownerAliases` can recognize retained
identities. The owner role in a conversation is semantic, not an authentication principal.
Kit placeholders `__OWNER_ID__` and `__OWNER_NAME__` become installed `ownerId` and `ownerName`.
Keep the kit's `ownerAliases` array aligned with the server: an explicit kit configuration takes precedence over
profile `kit.ownerAliases`, then profile `server.ownerAliases`. An explicit empty array disables aliases; updates
retain installed values. Non-array watcher aliases are ignored. The watcher, collector and gate default to
`the captain`; explicitly configured display names are unchanged. Owner aliases use that display name in message
and bundle labels. An exact non-owner display-name collision is marked `[non-owner]` to keep that label from
matching an owner message.

Set `timeZone` (IANA), `windowsTimeZone` (Windows) and optional `timeZoneLabel` together.
The neutral example uses UTC. The server's digest buckets, page and installed runner use the same business
clock. Kit equivalents are `__TIME_ZONE__`, `__WINDOWS_TIME_ZONE__` and `__TIME_ZONE_LABEL__`.
Daily API usage remains explicitly UTC: it records provider-day totals, not business schedules.

Boards come only from configuration, with optional `displayName` and `order`. No identifier selects
special presentation. Configure `defaultBoard` or supply an explicit archive target. The CRM lane is
absent by default; enabling `crm.base` requires an explicit configured `crm.board`. Its optional
`needsOwnerKind` preserves an existing external contract without baking it into shared code.
Existing judge consent and explicit `rulingsFile` selection are unchanged.

Kit configurations can name a `profile` JSON file with `kit` defaults. Paths resolve beside the source
configuration and become absolute in the installed configuration. `roleContent` is an explicit array of
local document paths; board identifiers never select it. Set `__BOARD_REPO__` to `none` to disable
board-repository polling. An update preserves filled installed placeholder values; new defaults fill missing keys.
Profile and document selections resolve from the selected source, including the first update driven by an older
bootstrap. Profile `kit.documentContent` maps installed document names to paths relative to the profile.
Edit the home's `config.json` deliberately before updating to change a retained setting, or reinstall with
`--set KEY=VALUE`. Machine-config changes apply to fresh homes, not silently to existing ones.

## Compatibility and rollout

An optional local profile can preserve historical owner/field spellings, clocks, labels, policy digest, target
and integration contract. Its codec preserves selected disk/archive names and authors on round trips;
it does not backfill history, change IDs or introduce a store schema. Responses also include canonical field
aliases so the page and older installed clients can coexist. Free message text is never rewritten.

The profile application command supports an inspection-only dry run:

```text
node scripts/apply-profile.cjs --config CONFIG_COPY --profile LOCAL_PROFILE_JSON --dry-run
```

Without `--dry-run` it keeps a numbered backup first, preserves tokens, custom policies and judge consent,
verifies the selected policy digest before creating a missing local policy, then atomically replaces config.
Explicit configuration values win; the result reports conflicting profile defaults without replacing them.
Preserve the existing runtime `pushSubject` explicitly before rollout; contact addresses belong only in host
configuration, never in a committed profile or checkout.
Inspect the redacted key diff; values outside the non-secret presentation whitelist stay hidden. Repeating an
unchanged application writes no new backup. Test profile changes against scratch copies first.

Live rollout is separate and requires authorization: **apply profile with backup → deploy board → update
each operator home → reconnect each MCP session**. A merge does none of those. Retain config backups and old
releases; a code rollback never restores old stores over newer work.

## Export proof

```text
node scripts/check-private.cjs
node scripts/export-public.cjs --ref COMMIT --out EMPTY_SCRATCH_DIRECTORY
bash lighthouse/test-all.sh
node scripts/release-check.cjs
```

The scanner reads `PRIVATE_TERMS_PATH` or `PRIVATE_TERMS` and never prints matched terms. Without a dictionary
it runs generic checks. The exporter refuses repository or nonempty destinations and reads committed bytes
at the selected revision. Untracked, modified and locally deleted files do not affect that tree.
The exclusion report explains omitted paths; private ledgers remain outside the export.
See [release checks](clean-room-release.md) for the fresh-repository proof.
