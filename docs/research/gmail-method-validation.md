# Gmail Method Validation

## Status

September 12, 2026. Research remains incomplete: no primary mailbox has been
connected and no vendor has been certified. Live Google-hosted pagination and
purchase-category payload retrieval are now recorded in the
[live checkpoint](gmail-live-checkpoint.md); full pipeline validation remains
incomplete. Companion reports cover the [architecture](gmail-security-architecture.md)
and [vendors](gmail-vendor-assessment.md). This record adds executable
counterexamples and a Google-hosted, independently administered candidate.

The release policy distinguishes financial evidence from general correspondence.
Financial amounts and purchases may reach Cash Lens. General email, login codes,
recovery links, private quoted conversations, and unrelated attachments may not.
This is a field-level distinction: a financial email is not necessarily safe to
copy in full. Removing the entire mixed message also fails the completeness goal.

## Executed Experiments

Run from the repository root with Node 24:

```sh
node --test docs/research/experiments/gmail-release.test.mjs
```

Observed on Node v24.4.1: **7 tests passed, 0 failed, 0 skipped**. These are
successful reproductions of counterexamples, NOT seven security acceptance tests
passing. Parsed messages and extractor outputs are invented, visibly labeled
canaries. The HTTP experiment uses actual Node fetch and two temporary loopback
servers; both servers close before the command exits. No paid calls, external
transmissions, real credentials, or production data were used.

Two in-memory mutation checks each made the command fail with exit code 1:
removing the item-name field broke the string-channel reproduction, and disabling
the first fetch's redirect following broke the redirect reproduction. Neither
mutation changed the checked-in experiment. These checks establish that those
assertions respond to the demonstrated behavior, not that the full suite is an
adequate security verifier.

| Method / property | Executed result | Consequence |
| --- | --- | --- |
| Forward messages whose subjects contain receipt/invoice | A genuine receipt also exported its login-link canary | A selection filter cannot authorize copying the entire message |
| Same discovery filter | Missed appointment evidence identifying a haircut | Receipt keywords alone do not satisfy transaction investigation |
| Exclude messages containing sign-in/password text | Discarded both legitimate receipt items | A denylist can reduce leakage while destroying required coverage |
| Export only total and item-name/amount fields | Removed the body canary, but accepted a canary in the item name | A typed JSON schema is not a semantic privacy boundary |
| Export only fixed category IDs and integer amounts | Removed that text canary but omitted the service/person detail | Narrow output is useful, but not a substitute for supported notes and product detail |
| Reconcile integer allocations to a fixed total | Still admitted arbitrarily selected allocations | Reconciliation alone cannot prevent a malicious extractor encoding information in numbers |
| Fixed HTTP destination with a 307 response | Default Node fetch transmitted the POST body to the second server; manual redirect mode did not | Pinning the first URL is insufficient; redirects require explicit handling |

These original Node fixtures deliberately supply contaminated extraction results. They do not
show that a particular LLM produces them, measure their frequency, or test Gmail
search syntax, MIME parsing, OCR, vendor webhooks, TLS, or Google Apps Script.
The integer example demonstrates a channel, not an observed model exploit.
Likewise, default Node redirect behavior is not evidence of a vendor's behavior.

Subsequent [offline actual-model tests](gmail-offline-validation.md) added five
invented security cases using the real extraction call: unrelated-code and
role-delimiter cases both abstained; receipt-only, receipt-plus-code, and
receipt-plus-code-with-malicious-instructions cases all preserved exact known
purchase amounts without copying the code. These two unsuccessful attacks are
bounded observations, not proof that the output channel is safe. Real-mail
accuracy and richer-output privacy remain unverified.

These counterexamples reject broad guarantees based only on filters or output
schemas. They do not reject automatic investigation: keep rich evidence inside
the trusted processor and evaluate selective release independently. An execution
and authority boundary outside the compromised Cash Lens systems is necessary,
but is not sufficient to make its parser or model infallible.

## Google-Hosted Personal Collector

### Feasibility

A user-owned Apps Script project is a candidate between a desktop connector and
a managed mailbox vendor. Google documents scheduled triggers that execute under
their creator's identity. This could perform unattended collection without an
awake laptop. It is a design candidate, not a deployed or live-tested system. [1]

Use the Advanced Gmail service with an explicit read-only scope manifest, then
verify the actual consent and allowed API operations in a disposable account.
The service exposes Gmail API objects and methods. Avoid assuming a convenient
`GmailApp` example is read-only: its reference lists full-mail scope for many
operations. Automatic scope inference is not an acceptable substitute for scope
inspection. [2][3][4]

Consumer-account quotas currently include six minutes per execution and 90
minutes of trigger runtime daily. Historical collection must be checkpointed,
resumable, and measured; a short successful test says nothing about completing a
large history. Related API quotas also apply. [5]

### Proposed Boundary

The collector would be owned and administered through an independently protected
Google account, never by the Cash Lens runtime or deployment credentials. No
public web-app endpoint, remote script execution endpoint, general mailbox proxy,
remote code loading, or server-controlled release policy. Project edit access
is security-critical: Google documents inherited folder editing rights for script
projects. Do not place it in a broadly shared folder. [6]

Cash Lens would receive bounded financial evidence through a fixed push endpoint.
The collector must ignore response bodies as instructions and reject redirects.
Google's UrlFetchApp follows redirects by default and provides an explicit switch
to disable that behavior; its actual behavior must be tested separately from the
Node experiment above. Leave certificate validation enabled. [7]

Target transactions received from Cash Lens are untrusted hints, not permission
to disclose email. A compromised backend can invent them. Discovery/release
authorization must come from standing policy controlled outside Cash Lens, with
no arbitrary query, message-ID fetch, destination override, or policy reset
exposed to the backend. Full historical discovery remains required; a fixed
merchant allowlist alone cannot cover unknown intermediaries and appointments.

Moving retrieval into Google does not settle extraction. Sending raw messages to
an external OCR or LLM service creates another plaintext recipient. Apps Script
is not a native local-model runtime. Candidate configurations need separate
evaluation for extraction quality, processor isolation, data handling, and
Google's applicable API policy. Do not silently replace rich extraction with
regular expressions just to claim this method is finished.

### Residual Risks

Google account/project takeover, malicious authorized code edits, unsafe
dependencies, parsing errors, prompt injection, and output leakage remain.
Apps Script's authorization model requires consent for access and provides a
revocation path; revocation cannot recall data already exported. [4]

This candidate reduces the number of independently operated services that need
mailbox authority. It does not cryptographically prove that only financial
information can leave, and is not yet preferred over a properly isolated local
collector or independently administered managed service.

## Requirement Evidence

| Requirement | Current evidence | Next necessary proof |
| --- | --- | --- |
| Full available history, unknown merchants, relevant non-receipt context | Secondary-account API enumerated 187 IDs; Takeout parsed 187 messages; identity reconciliation not performed. HTML audit found four money-syntax candidates missed by plain text | Held-out, independently labeled relevant documents and measured discovery recall; counts and currency syntax are not ground truth |
| Exact receipt items, adjustments, refunds, split categories | Three purchase-labeled bodies all abstained. Five later HTML/plain money-syntax candidates produced one unverified monetary claim and four abstentions; no accuracy result | Real body/PDF/image extraction, annotated amounts and reconciliation, unknowns retained |
| Supported subscription and payment-purpose notes | Roadmap scope only | Source-grounded notes evaluated for unsupported assertions and private-content leakage |
| Cash Lens compromise cannot read general Gmail | Architectural conditions; no deployed candidate tested | Operate from a compromised test backend with all its credentials and attempt upstream reads/policy changes |
| Reject mixed-content and prompt-injection leakage | Counterexamples reproduced; actual local model excluded the exact numeric canary in five invented cases, including two unsuccessful injection attempts | Held-out adversarial MIME/HTML/PDF corpus, richer outputs, and actual release controls; five cases cannot establish a failure rate |
| Multiple retrieval methods tested end to end | Live Apps Script retrieval and Takeout/local parsing exercised; neither complete financial-evidence pipeline validated | At least two complete candidate pipelines with measured coverage and release behavior |
| Automatic ongoing operation and backfill | Google scheduling and quotas documented | Measured restarts, sleep independence, retries, cursor correctness, quota recovery |
| Revocation, deletion, recovery, independent administration | Apps Script access removed; rerun required authorization and was cancelled. Copied tokens, in-flight requests, deletion, and recovery not tested | Remaining account-level tests plus vendor evidence for inaccessible infrastructure/backups |
| Vendor security assurance | Public claims; Parseur report request submitted and awaiting approval | Audit scope/report, credential/data lifecycle, incident and recovery controls, subprocessors |

## Required Qualification Sequence

1. Use a disposable Gmail account that is not anyone's recovery address. Populate
   it with known receipt, appointment, refund, unrelated-mail, and fake recovery
   cases. Include mixed threads, attachments, encoded HTML, and fake instruction
   injection. Never exercise a real account-recovery link.
2. Test full-history retrieval with an independently owned read-only collector.
   Check actual OAuth scopes and denied write operations; keep tokens out of
   Cash Lens, logs, and research artifacts. Inspect message-level selection, not
   only matching threads. Measure discovery before tuning on held-out cases.
3. Test a managed financial-evidence pipeline against the same corpus. A
   forwarding-only candidate must be paired with historical discovery or marked
   incomplete, not credited with full-mailbox recall. Verify actual item output,
   admin separation, authentication, replay handling, and document-link access.
4. Attack only our test receiver/collector with forged transaction hints,
   destination changes, redirects, replays, cross-tenant identifiers, and fake
   reset requests. Vendor infrastructure penetration testing requires explicit
   vendor authorization and is not part of ordinary integration testing.
5. Only after disposable tests pass, approve a bounded real-mail evaluation inside
   the chosen trusted boundary. Synthetic security canaries cannot establish real
   receipt coverage. General messages must not appear in public artifacts or be
   sent to an unapproved model/vendor during this evaluation.

### Recorded Deviation

The executed work did not complete this sequence before processing real mail.
The user approved a secondary account containing existing personal correspondence
for testing. Its status as a disposable account or a non-recovery address was
not established. Google-owned retrieval and isolated local archive/model probes
then used that account before the planned complete-pipeline, compromised-backend,
and disposable-corpus gates had passed. The later five synthetic model-canary
cases do not retroactively satisfy those gates.

Account-use approval is not security qualification. These runs provide bounded
feasibility observations, not evidence that the required admission sequence was
followed or that primary-mailbox integration is ready. The absent qualification
tests remain prerequisites for expanding real-mail access or automatic release.

Initial browser attempts failed before navigation; browser access subsequently
recovered. The current [live checkpoint](gmail-live-checkpoint.md) records vendor
page observations and the submitted audit request awaiting reports. No vendor account or
vendor Gmail OAuth grant was created. The user subsequently approved a secondary
account with existing correspondence for testing. Its Google-owned script has
executed read-only connectivity and message-retrieval probes; consult the live
checkpoint for exact evidence and limits. Independent
security/simplification review reran
all seven experiments successfully and requested the authority-boundary wording
clarification incorporated above. That review is not an external security audit.

## Sources

Official Google documentation, accessed September 12, 2026:

1. [Installable triggers](https://developers.google.com/apps-script/guides/triggers/installable).
2. [Advanced Gmail service](https://developers.google.com/apps-script/advanced/gmail).
3. [GmailApp reference](https://developers.google.com/apps-script/reference/gmail/gmail-app).
4. [Authorization for Google services](https://developers.google.com/apps-script/guides/services/authorization).
5. [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).
6. [Collaborate with other developers](https://developers.google.com/apps-script/guides/collaborating).
7. [UrlFetchApp reference](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app).
