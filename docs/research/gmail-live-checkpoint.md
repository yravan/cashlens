# Gmail Live Validation Checkpoint

## Verified Browser Observations

September 12, 2026. The execution connection recovered and the Codex in-app
browser loaded vendor pages successfully. Chrome was not available in the
browser inventory. Earlier `sandboxPolicy` errors are no longer the current
blocker. These observations are UI checks, not end-to-end Gmail integration tests.

The [Parseur trust center](https://trust.parseur.com/?tab=documents) lists two
restricted documents: `Q1 2026 Parseur Pentest` and `Parseur SOC 2 Type 2 Final
Report`. Neither report has been obtained or read. Report titles and passing
control badges do not establish audit scope, exceptions, or remediation.

The [subprocessor page](https://trust.parseur.com/?tab=subprocessors) lists:

| Provider | Listed data description |
| --- | --- |
| Azure | All application data except payment details |
| Google Cloud Platform | All application data except payment details |
| CloudConvert | A subset of uploaded documents for extraction processing, EU |
| Mailgun | Email addresses, IP addresses, and email content sent to `@eu.parseur.com` |
| Postmark | Email addresses, IP addresses, and email content sent to `@in.parseur.com` |

These are vendor disclosures, not independently verified data-flow measurements.
They require clarification of model providers, processing locations, retention,
and whether optional conversion paths can be disabled. They do not demonstrate
that every document reaches every listed processor.

The audit-access form requests an email, name, company, and request reason. It
also requires agreement to Oneleet's privacy policy and a CAPTCHA. The form was
prepared with contact details supplied for this purpose, but NOT submitted.
The user subsequently approved the pending policy/CAPTCHA/request action. The
policy checkbox was selected, but browser coordinate clicks dismissed the image
challenge and form instead of selecting targets. The challenge menu offered no
text challenge. The form was restored and preserved for manual completion; no
submission confirmation was observed initially. The user then completed the
CAPTCHA; both reports were selected and submitted. The trust center displayed
`Access Request Sent` and confirmed an email notification will follow approval.
The reports themselves have not been received or reviewed. No
mailbox grant, receipt upload, subscription, or payment occurred. Contact details
are intentionally omitted from this public-repository record.

[WellyBox's security page](https://www.wellybox.com/security/) was also inspected
in the browser. It exposes deletion instructions and a responsible-disclosure
contact. This page did not establish independent audit results. Navigating its
free-trial link reached signup; no account was created and no Gmail permission
screen was approved.

## Remaining Gates

A user-approved secondary Gmail account is now signed in. It contains existing
personal correspondence, which must not be treated as synthetic or copied into
research artifacts. A new user-owned Apps Script project contains the checked-in
`experiments/google-probe` connectivity probe and explicit `gmail.readonly`
manifest. It has no external destination, trigger, or deployment. The probe only
requests label types, never message content, and emits a fixed status string.
The editor saved the code and recognized its function and Gmail dependency.
Run reached `Authorization required`; Review permissions did not expose a consent
window in the available browser tabs initially. A subsequent observation showed
`Gmail read probe succeeded; no message content requested.` followed by
`Execution completed`. The overview lists one execution, zero errors, ownership
by the signed-in account, and exactly one requested scope: `gmail.readonly`.
The consent action itself was not observed; do not infer who completed it or
claim the issued token's exact scope was independently inspected. This proves
the label-read call ran, not message extraction, denied-write enforcement,
revocation, or isolation from a compromised Cash Lens backend.

The subsequent `verifyMessageRetrieval` execution completed successfully in the
same project: 187 unique message IDs enumerated across two API pages, three
`category:purchases` candidates retrieved with `format: full`, six inline body
parts, and zero attachment references. Queries included spam/trash and no date
filter; enumeration stopped at the API's exhausted page token. This is not an
independent count reconciliation or a snapshot-consistent mailbox inventory.
Raw payloads were only processed in script memory; the probe emitted these
aggregate counters, not subjects, bodies, addresses, IDs, or provider errors.
No attachment retrieval, decoding, OCR, classification, or source-grounded note
extraction was tested. Gmail's purchase category is a baseline candidate set,
not ground truth for relevant-message recall. Code syntax was checked locally;
this probe is not production collector code and has no retry/checkpoint engine.

Revocation was exercised next. The project was renamed `Cash Lens Gmail Security
Probe`; Google's account-access details reflected that name, a recent grant,
and permission to view email messages and settings. Removing only this project's
access produced Google's confirmation that it no longer had access. Rerunning
`verifyMessageRetrieval` stopped at `Authorization required`; cancelling produced
the execution warning that account access is required to run. Access remains
revoked. This validates the interactive Apps Script execution gate after removal,
not invalidation latency of previously issued/copied bearer tokens, in-flight
requests, triggers, or deletion of already copied data. No tokens were extracted
to test those separate cases.

The full requirements and live-test sequence remain in
[method validation](gmail-method-validation.md). None are superseded by this
checkpoint. Next steps are obtaining the restricted assurance reports and
testing at least two complete pipelines with a disposable Gmail account. A
forwarding-only parser is not credited with historical discovery. A real-mail
coverage evaluation must follow successful disposable-account security tests.

No candidate is approved for the primary inbox. Live Gmail retrieval has now
been exercised as described above, including the limited revocation test. No
extraction-quality measurement or compromised-backend
isolation test has yet occurred. Local counterexamples are only counterexamples.
