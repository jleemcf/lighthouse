# Operating policies (rulings)

Rulings are numbered decisions used by the advice steward as evidence. They are not source-code permissions, and a
sample ruling grants no authority over a real fleet. Real captain policies and their history belong outside Git.

The clean tree includes `lighthouse/DIRECTION.example.md` and its generated `lighthouse/server/rulings.json`.
All wording is invented. Sparse numbers intentionally exercise the format the existing steward consumes:
8 is superseded by 59; 47 and 48 by 60; 54 is a citable policy; scene numbers cover the generator's hand-written set.
Do not copy these numbers into an operator brief as though they were a particular captain's decisions.

## Format

Under `## Captain rulings`, use `N. **Short title.** (attribution) Body text.`. Paragraphs
continue until the next numbered bold title or heading. The generator joins wrapped text and writes records in
number order with `n`, `title`, `attribution`, `text` and `source`. A relayed attribution marks the source as relayed.
The maintained `SCENE` and `SUPERSEDED` tables add `scene` and `supersededBy`; update those tables for your own scheme.

Run `python lighthouse/server/make-rulings.py` to build the sample. For your own local record use
`python lighthouse/server/make-rulings.py --source <private-policy-file> --out <private-board-home>/rulings.json`.
Do not point the output into this checkout or publish that generated private record. A deployment of the sample
will overwrite a board home's policies with the sample: restore the private generated record before enabling advice.
Review all policies before deployment, not just whether their JSON parses. The server gives the record a hash so
advice can identify which version it read.
