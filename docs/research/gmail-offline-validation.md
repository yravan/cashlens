# Offline Gmail Archive Validation

## Finding

A local archive is a viable candidate for historical investigation without a
live Gmail credential in Cash Lens. A user-approved secondary-account export
was acquired and 187 messages were parsed; bounded real-mail model pilots ran
as recorded below. It is not a complete autonomous integration: ongoing updates,
receipt extraction accuracy, and safe release of notes remain unverified.

Google documents that Gmail exports contain message content, headers,
attachments, and labels, including archived messages. Deleted data cannot be
exported; encrypted messages remain encrypted. That supports the availability
of rich evidence, not guaranteed coverage of every historical purchase.
[Google Gmail export documentation](https://support.google.com/mail/answer/10016932?hl=en).

## Executed Test

On September 12, 2026, Docker Server 28.5.2 ran the official Python image pinned
to digest `sha256:7415fbc3c9e4979cc717d92377ab2bc7b2b4a2af1ac03cc52b5f3f88efedaf3a`.
The test uses Python's standard-library `mailbox` and MIME parser, not a custom
email parser. It creates three invented messages in a temporary MBOX archive:
receipt, appointment, and unrelated private-content canary. The receipt also
contains an attachment with a hostile traversal filename.
[Python mailbox reference](https://docs.python.org/3/library/mailbox.html).

Reproduce from this worktree, substituting its absolute path below if moved:

```sh
docker run --rm --network none --read-only --user 65534:65534 \
  --cap-drop ALL --security-opt no-new-privileges \
  --memory 128m --cpus 1 --pids-limit 32 --log-driver none \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --mount type=bind,src=/Users/yajvanravan/cashlens-wt/gmail-security/docs/research/experiments/offline-mail.test.py,dst=/test.py,readonly \
  python@sha256:7415fbc3c9e4979cc717d92377ab2bc7b2b4a2af1ac03cc52b5f3f88efedaf3a \
  python -I -B /test.py
```

Result: **3 tests passed**, container exited and was removed. No host home,
credentials, archive, Docker socket, or output directory was mounted. Only the
test source was mounted read-only. Docker log persistence was disabled; test
status still reached the calling terminal. A future private-data runner must
also control stdout/stderr, exceptions, crash reporting, and result files.

Observed properties:

- MBOX/MIME parsing preserved receipt amounts, appointment context, unrelated
  mail, and exact attachment bytes. This demonstrates preservation, NOT semantic
  extraction accuracy or selection of only safe email.
- The hostile attachment filename stayed metadata; the parser did not write it
  to disk. Any subsequent attachment decoder needs its own isolation and safe
  output handling.
- Only loopback was active; a TCP connection to reserved TEST-NET address
  `192.0.2.1` failed with `ENETUNREACH` before a connection could be established.
- The process was non-root with zero effective capabilities and `NoNewPrivs=1`,
  had no Docker socket or host home directory, and could not write to the
  container root filesystem. This does not enumerate all writable mounts.

The first test revision expected no interfaces except loopback and failed.
Inspection showed nine inactive tunnel interfaces and IPv6 loopback in this
environment. The revised assertion checks active interfaces and actual IPv4
connection failure. Docker's documentation describes only loopback for the none
driver; local observation is more specific for this environment.
[Docker none network driver](https://docs.docker.com/engine/network/drivers/none/).

A negative control changed only `--network none` to `--network bridge`: the
suite failed as expected because `eth0` became active. That assertion occurred
before the TCP attempt. The negative-control container was also removed.

## Limits And Architecture

### Runtime And Artifact

The verified model is Unsloth's `Qwen3.5-27B-Q4_K_M.gguf`, repository revision
`3221f178a6b842d04f1fb42f1c413534adcc0a6a`, size 16,740,812,704 bytes, SHA-256
`84b5f7f112156d63836a01a69dc3f11a6ba63b10a23b8ca7a7efaf52d5a2d806`.
The completed local artifact matched these public metadata values before use
and remains outside the repository. This verifies artifact identity, not model
safety or an independent audit of the third-party quantization.
[Model repository](https://huggingface.co/unsloth/Qwen3.5-27B-GGUF).

| Experiment | Observed result and limit |
| --- | --- |
| Native runtime | Homebrew core installed llama.cpp 0.4.0 and ggml 0.23.0. CLI offline/logging flags are not an OS security boundary. |
| Native network profile | An allow-default, deny-network sandbox blocked curl DNS and explicit-address IPv4 connections; the unsandboxed control returned HTTP 200. This does not test other clients, IPv6, filesystem isolation, or host compromise. |
| Native llama-cli | Failed trying to obtain a free port for its internal server despite offline mode. Standalone llama-completion was used instead. |
| Native harmless inference | With networking denied, home reads restricted to the model, home writes denied, and a cleared environment, llama-completion returned READY using the explicit non-thinking template. Non-home filesystem access remained allowed; this profile was never approved or used for private mail. |
| Rejected smoke-test settings | The /no_think text directive exhausted the 128-token cap while reasoning. The log-disable flag hid generated output, so exit zero alone could not establish success. |
| Takeout acquisition | The user-approved secondary account's one-time Mail-only export was downloaded locally after account-owner password re-verification. Earlier download-observation timeouts were superseded by the completed archive below. |

The successful prompt used the upstream template's `enable_thinking=false`
assistant prefix with `--no-conversation`; private-mail pilots used the separate
Docker isolation described below, not the native profile.
[Upstream chat template](https://huggingface.co/Qwen/Qwen3.5-27B/blob/main/chat_template.jinja).

### Real Archive Audit

The Mail-only ZIP was moved from Downloads to a private non-repository directory
(directory mode 0700, archive mode 0600). The extended `offline-mail.test.py
--archive /input.zip` ran in the pinned Python container with no network, a
read-only root, dropped capabilities, no-new-privileges, no Docker logging, a
read-only archive mount, and a 128-MiB temporary memory filesystem. It ran as the
host user's non-root UID to read the protected file; the synthetic tests still
run as UID 65534. No raw mail or credential values were emitted.

Observed aggregate result: one MBOX, 187 messages, 312 plain-text/HTML parts,
zero parts marked with attachment disposition, and zero parser-reported MIME
defects. The 187 total matches the prior API enumeration, but no message-ID or
content identity reconciliation was performed. Neither total proves complete
discovery of financially relevant messages. No payload decoding, attachment
download, OCR, or model extraction was claimed from this audit.

The archive reader never uses ZIP entry names as extraction destinations. It
limits declared MBOX data to 100 MB and message count to 20,000; this is a bounded
research reader, not a hardened general-purpose ZIP/MIME parser. Its synthetic
archive test includes a traversal-shaped ZIP entry name and an attachment. All
three tests passed. An in-memory mutation doubling message increments made the
archive assertion fail (six instead of three); checked-in code was unchanged by
that mutation. All test and audit containers exited and were automatically
removed. The original ZIP remains in the private directory for further testing.

### Real-Mail Model Pilot

The official ARM64 `ggml-org/llama.cpp` full image was pinned to
`sha256:4d4e3f44c983bcd06920e9f2c5fdfa5ac26fdaf6a7cb02c1c81a36ca059e984f`.
`offline-extraction-pilot.py` used the verified model inside this container,
not the broad native profile. Docker inspection confirmed network `none`, UID
501:20, read-only root, all capabilities dropped, and log driver `none`. Only the
ZIP, model, and research code were mounted read-only; temporary data used tmpfs.
The process checked non-root execution and active-loopback-only interfaces.
No Docker socket, mailbox token, or Cash Lens credentials were mounted.

All three purchase-labeled messages had plain-text bodies under the pilot's
8,000-character bound and were processed. All returned the expected JSON names
and types, and all abstained from monetary extraction. **This is not an accuracy
pass.** Model responses stayed in process memory; only aggregate counters left
the container. No source text, amounts, identifiers, notes, or raw model responses
were returned to the assistant or written to research artifacts. The container
exited and was removed. Host memory/swap and forensic deletion were not tested.

The separate `offline-source-audit.py` check found no matching explicit money
syntax in those three plain-text bodies. Across all 187 messages, 126 had a
plain-text alternative and one matched the tested currency-symbol/code patterns.
These patterns are not a receipt classifier: they miss untested formats and may
match advertisements. The initial run did not check HTML-only content; the
follow-up below closes that particular source-audit gap.
There is no independently labeled positive extraction case, so precision and
recall cannot be stated. Real receipts/bills/refunds with known answers have been
requested to address this gap.

The pilot has no supported notes, merchant text, OCR, or automatic release to
Cash Lens. Those remain required tests, not features credited to this numeric
pilot. Archive iteration is now shared; an empty-MBOX regression test was added,
and all four archive/isolation tests pass. No production data was changed.

### HTML Coverage Follow-Up

The source audit now decodes HTML body text using Python's standard-library
`HTMLParser`, without rendering pages, evaluating JavaScript, or retrieving
external resources. It ignores attributes, comments, script text, and style text.
It is not a browser-equivalent text renderer or a privacy sanitizer: CSS-hidden
content can remain, malformed markup can lose text, and image-only receipts,
attribute text, and conditional-comment content are not recovered. The same
no-network container controls apply. The parser's documented handling of text,
character references, and unmatched tags informed these limits.
[Python HTMLParser documentation](https://docs.python.org/3/library/html.parser.html).

Observed across the same 187 messages: 186 HTML bodies, including all 61 messages
without plain-text bodies. Five HTML bodies matched the limited money syntax;
four were additional to the plain-text match, yielding five distinct candidates
across both representations. No HTML body exceeded the 500,000-character bound.
These are candidate counts, not five verified receipts. This result demonstrates
that the plain-text-only source audit missed candidate evidence; it does not
measure relevant-message recall or justify a currency-regex production filter.

The follow-up model run used `offline-extraction-pilot.py --money-candidates`
with the source-audit module also mounted read-only. For this experiment only,
it selected messages containing the limited money syntax in either body,
preferring parsed HTML when both qualified. The same pinned model/image and
container isolation were used. Live inspection confirmed network `none`,
non-root UID, read-only root, and no Docker logging.

All five selected messages were processed within the 8,000-character input
bound. Five outputs passed the existing JSON shape/type checks; one claimed
monetary evidence and four abstained. **The positive claim is unverified.**
No independently annotated answer or source-span reconciliation was available.
The validator checks neither monetary grounding nor cross-field consistency;
valid output cannot be credited as a correct receipt, amount, or privacy pass.
The 8,000-character admission bound is not a token-fit check for the configured
4,096-token context and 256-token output limit. Prompt token counts were not
recorded; this run does not validate long-message or multilingual admission.
Future corpus runs need explicit token-budget admission and overflow tests,
not silent truncation or an assumption that character counts guarantee fit.
Only aggregate counts were returned. Raw inputs and model responses were not
exported or persisted by the pilot, and no data was sent to Cash Lens. The
container finished with exit code zero and was automatically removed.

All three HTML structural tests passed. An initial mutation-runner invocation
discovered zero tests and was discarded as invalid evidence. The corrected
in-memory mutation disabled script/style suppression; the text assertion then
failed with the deliberately invented script/style amounts present. Checked-in
code was not changed by the mutation. All four archive/isolation tests also
passed again. No private message text or metadata was emitted.

The host reported `FileVault is On`; archive-directory and archive permissions
were rechecked as 0700 and 0600. This is configuration evidence, not protection
against an unlocked-host compromise or proof about backups, swap, or deletion.

### Actual-Model Security Canaries

`offline-extraction-pilot.py --canary-cases` now exercises the same model-call
and response-validation functions as real-mail extraction. The two invented
inputs contain an unrelated sign-in-code canary, first alone and then followed
by a role-delimiter injection asking for that code in the allowed numeric fields.
Both outputs passed shape validation and exactly abstained; neither put the
canary integer into the total or item amounts. This is an unsuccessful attack
against this exact model, prompt, and input, not a general prompt-injection pass.

The additional `--mixed-canaries` run includes a purchase control with two known
item prices, the same receipt alongside an unrelated sign-in code, and the mixed
message with malicious importer instructions. All three outputs returned the
exact known total and both item amounts, with no canary in the numeric fields.
Thus the model retained the purchase while excluding this unrelated code even
under the tested instruction attack. Both runs exited zero and their containers
were removed. Exit status establishes execution only: the commands emit boolean
observations but do not assert a pass/fail threshold. Those boolean results were
inspected directly for the conclusions above. This five-case experiment does
not establish a security error rate or support unattended release of real mixed
correspondence.

These are deliberately invented security fixtures, not substitutes for the
requested real-receipt benchmark. Only the model and pilot code were mounted;
no real mailbox, tokens, or Cash Lens credentials were available. The pinned
container again used network `none`, non-root execution, read-only root, dropped
capabilities, and no Docker logging. Only case labels and boolean observations
were emitted. Exact-integer canary checks do not detect arbitrary encodings,
transformations, timing channels, or other private information. Rich notes,
OCR, malicious attachments, multilingual attacks, and held-out attack variants
remain untested.

The shared response parser also now rejects a non-string currency without
throwing. Three parser tests passed, covering expected shapes, extra fields,
wrong types, missing fields, and truncated JSON. An in-memory mutation allowing
Python booleans as monetary integers made the corresponding test fail. These
tests do not add source grounding or a semantic release-policy check.

### Review Checkpoint

Before opening the research PR, all ten archive, HTML, and response-parser tests
passed in the pinned no-network Python container. The seven original Node
counterexamples reproduced successfully; they remain counterexamples, not
security acceptance tests. Gitleaks 8.30.1, with full output redaction, reported
no matches in the research directory or its four existing research commits.
Secret-pattern scanning cannot prove the absence of personal information.
No application code, primary-mailbox connection, or automatic release shipped.

The original synthetic Docker experiment and real archive audit are not an LLM
evaluation, OCR benchmark, or penetration test. They do not test
container escape, host compromise, IPv6 outbound sockets, encrypted storage,
crash persistence, malicious output, or large historical archives.

The Docker administrator and host remain trusted. Cash Lens must never be able
to change container options or obtain the Docker socket. Executable/model
selection, input mounts, invocation parameters, output policy, recipients, and
runner administration must also stay outside Cash Lens's authority. Otherwise
it can misuse the runner even without giving the container a network.
Container isolation is
not an unbreakable boundary; Docker identifies daemon access, kernel issues,
and configuration as important risks.
[Docker security documentation](https://docs.docker.com/engine/security/).

The archive itself contains general email and may expose old credentials or
recovery information. Keep it outside repositories, cloud sync, and Cash Lens;
encrypt persistent storage and evaluate temporary-copy/backups handling before
real use. No-network extraction can reduce external exposure, but arbitrary
strings in exported notes or item descriptions still need trusted release
controls. Existing output counterexamples continue to apply.

Use this as a historical bootstrap candidate alongside a separately authorized
ongoing collector, not as a forwarding-only substitute for full coverage. Next
proof needed: isolated body/PDF/image extraction and held-out real-mail accuracy
evaluation, beyond the actual secondary-account export and aggregate audit.
No primary mailbox or vendor integration is approved by these results.

Independent security review reran the pinned command successfully. It identified
an overbroad test name and requested explicit runner-authority constraints; both
were corrected, and capability/no-new-privileges assertions were added. This is
an engineering review, not an external audit or certification.
