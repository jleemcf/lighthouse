# Upgrade without a second setup

Existing boards and operator homes are not fresh installations. Do not run init or operator setup on them,
replace their configuration with an example, enroll them again, or rotate working credentials merely to upgrade.
An absent enrollment setting stays off. Merging source changes never deploys or restarts a running installation.

An existing page-token login continues to use that identity. The administrator-file sign-in form appears only
when the page is signed out. Use a fresh private browser window for file-based administration, or use the host
commands with the protected administrator file; no existing page token needs to be replaced.

## Plan and back up first

Use a reviewed release checkout. Inventory the existing board IDs, names/order, owner/operator/watch roles,
protocols, optional adapters, policy bytes, business time zones, shift clocks, CRM lane and operator settings.
Keep this inventory and the private profile outside the checkout. Back up the complete host home, including
config, store, policy, registry snapshots, attachments, archives, release links and manager files; back up each
operator home's config, credential files, journals and Windows/WSL provenance too. Protect backups like secrets.

Rehearse on copies first. Use other loopback ports and remove TYPESAFE_API_KEY before starting scratch servers.
Never point a copy at production services. No test here authorizes live deployment or a service interruption.
Arrange an approved maintenance window or a separately reviewed single-writer drain plan before the real steps.
Never run two independent writers against the same JSON store.

## Profile, registry, then release

1.  Stop all writers at the approved boundary. Retain a pre-profile safety copy. Apply only a digest-verified
    private compatibility profile whose effective settings match the inventory:

        node scripts/apply-profile.cjs --config BOARD_HOME/config.json --profile PRIVATE_PROFILE.json

    Use the profile's real policy path and digest, not bundled example policies. Equal parsed policy content
    retains the running policy bytes so old citations remain valid. See [generic configuration](generic-core.md).

2.  Convert schema 1 once, offline, with a new protected backup destination:

        node lighthouse/server/registry-cli.js migrate --config BOARD_HOME/config.json --backup PRIVATE_BACKUP

    Migration imports board IDs, labels/order, roles, protocols and settings in place. It does not enable
    enrollment or revoke existing tokens. The backup includes a schema-2-compatible retained baseline.
    Read the [release contract](../lighthouse/server/REGISTRY.md#release-contract-and-going-live) before proceeding.

3.  Start that retained compatible baseline, then use the staged deployer from the reviewed checkout:

        LH_HOME=BOARD_HOME bash lighthouse/server/deploy-board.sh

    Verify authorized discovery, feeds, scene, saved links, policies, clocks, CRM delivery and preserved work.
    No setup prompt should appear when enrollment is off. Compare every card, not just the total count.
    Registry metadata is now authoritative: changing config access/labels alone does not silently adopt it.

4.  If membership adoption is needed, bootstrap local host administration once using a protected output file,
    then use [audited membership commands](board-management.md#membership-adoption-after-migration).
    This works with enrollment screens still off; operators and watches cannot do it. Protocol, feature and
    default-role edits are not implicit membership adoption.

The migration and deploy commands make safety copies but do not replace the independent pre-profile backup.
Never restore an old store over newer accepted work. Roll back code only to a release declaring support for
the current schema; if none is compatible, stop and roll forward. Old binaries outside the release manager
must not be started against schema 2.

## Update one operator home at a time

Update the recorded release checkout, then run bash shift.sh update in each existing home. The existing update
driver preserves configuration, token files, binding, journals and twin provenance. Follow its verification and
MCP reconnect notice. Reconnect every affected MCP process at a controlled boundary; an update or reconnect is
not a new shift or an ownership transfer. Do not stop/start an active shift simply to reconnect tools.

Legacy homes keep their existing optional adapters. New guided homes keep adapters off unless explicitly
configured. Doctor's redacted page report is available only for guided, enrolled installations, after a
successful authorized board read. A missing page report does not mean a legacy home needs enrollment.

For a normal later shift, start before arming Monitors: start clears leftover lease launchers. Keep the working
single-operator convention; cross-machine/session handoff and generation fencing are separate work.

## Repeatable fixture rehearsal

On Linux or WSL, from this checkout, with TYPESAFE_API_KEY removed:

    node lighthouse/verification/upgrade-rehearsal.cjs

The script creates only disposable homes and an allocated loopback port. Its fictional fixture has three boards
(two tools, one lines), nontrivial labels/order, owner/operator/watch roles, an advice steward, CRM lane, profile,
policy and stored shift clocks. It takes a safety copy, applies the profile, migrates to schema 2, starts a
compatible baseline, deploys the current runtime and runs the real legacy kit-update driver for all three homes.
It compares all card/comment fields, roles, features, policy digest, clocks, lanes and config/credential bytes.

This is a preservation regression, not a live-fleet rehearsal or a claim of Windows adapter health. It uses the
current source on both sides with synthetic release IDs, and simulates Windows/WSL helper commands for the kit
driver; it never pulls a real operator repository or contacts CRM/firstmate/paid services. Separately verify
real release provenance, optional adapters, ACLs and reconnect behavior before any authorized fleet rollout.

The [manual setup appendix](../lighthouse/operator-kit/SETUP.md#advanced-manual-configuration) remains available
for deliberately hand-configured new installations. It is not the existing-home upgrade procedure.
