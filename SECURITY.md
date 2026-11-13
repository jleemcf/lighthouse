# Security

Lighthouse is intended for a private network, not an unauthenticated internet service. Keep configuration, tokens,
claim codes, model-service keys, subscriptions, attachments, transcripts, live state and real operating policies
outside Git. Use separate random credentials and the least role needed for each board.

Identity headers are trusted only when explicitly enabled behind the local Tailscale proxy. A direct listener must
not accept them as proof of identity. Use HTTPS and restrict access before enabling phone push. Set `pushSubject` to
a contact you control; the example address is deliberately not deliverable.

The optional wake gate and judgment services receive the work excerpts needed for their judgments. The advice
steward has a restricted input pack and no action credential in its model context. Do not assume these boundaries
make sensitive transcripts suitable for an external model. Treat model output and all quoted work records as data,
not authority. See the design notes for the limits of redaction and prompt-injection defenses.

Report a vulnerability through GitHub's private vulnerability reporting if it is available. Otherwise ask the
maintainer for a private channel before sharing details. Do not include credentials, personal data or exploit
material in public issues. There is no published security-response SLA.
