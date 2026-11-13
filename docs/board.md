# Board design

This is the self-hosted part of the board design. The old hosted-artifact experiments are not installation advice.

## Purpose and lanes

A captain should see what needs a decision without reading a coding transcript. Each board describes one configured
work area. Its cards move through Queued, In flight, Waiting on you, Held and Done. Waiting means an open ask;
a status line by itself cannot settle one. Each card keeps a conversation, context and a short activity record.
General is for captain conversation; Ops keeps instrument noise out of that view.

The page includes Home, board tabs, task conversations, advice and a compact phone layout. In a live installation,
board names and your display name come from configuration. The island scene is an illustrative view of board
state, not a separate source of truth. Weather is optional and must use locally chosen settings.

## Data flow

The board server owns its JSON store. The collector submits operator lines and transcript entries; in tool mode,
structured calls change state and return a receipt. A browser reads the permitted state and an event stream. The
server records captain messages and approved prompts; the operator watches for them and relays only approved text.
An event replay is de-duplicated so it cannot reopen a previously settled question.

The page is generated from `lighthouse/board/` by `server/make-page.py`. Never hand-edit `server/public/index.html`.
The server-layer source is the supported API connection; the artifact-layer source is retained reference material.

## State and permissions

Configuration defines boards and per-identity roles: viewer, commenter, operator and the captain's full-access role
(`owner` in configuration), plus the watch role. That legacy spelling is a permission value, not a display label.
Tokens identify a surface as well as a name; an API credential is not silently a page credential. Read filtering and
write checks run on the server. The client is not a permissions boundary.
The live stream uses the same per-board read checks as the polling feed; a reader with access to one board receives
no change records for another board.

Store changes survive restart; tool receipts wait for durable writes. Old completed cards can be archived outside
Git. Keep backups, attachments, subscriptions and live transcripts in the private board home. Backups contain the
same sensitive work as the live store.

## Attention and failure

Only a real ask should need your attention. Phone subscriptions are per device and board; service workers
and push need HTTPS. A stale card, failed instrument or silent steward is visible as a fault, not a healthy state.
A routine Monitor re-arm is not work news. The conduct report supports the watch operator; it cannot replace human
judgment about whether an explanation was useful.

Use a Held `maintainer-inbox` card on each board for kit reports and proposals. Captain-only decisions keep their
own cards and asks. Optional `standingCards` can exempt long-lived conversations from task-aging signals; optional
`cardDoorbells` can wake a receiver on card updates without sending their contents. Both are empty by default and
independent of the inbox convention. See the [server settings](../lighthouse/server/README.md#standing-cards-and-card-doorbells).

## Deliberate limits

This is a single-host prototype backed by JSON files, not a multi-tenant hosted platform. The UI, agents and external
models can fail independently. Start on a disposable local installation and inspect the records before trusting it
with unattended supervision. The sample policies are invented and grant no real-world authority.
