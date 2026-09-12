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
Approval to accept the policy and complete the CAPTCHA remains pending. No
mailbox grant, receipt upload, subscription, or payment occurred. Contact details
are intentionally omitted from this public-repository record.

[WellyBox's security page](https://www.wellybox.com/security/) was also inspected
in the browser. It exposes deletion instructions and a responsible-disclosure
contact. This page did not establish independent audit results. Navigating its
free-trial link reached signup; no account was created and no Gmail permission
screen was approved.

## Remaining Gates

The full requirements and live-test sequence remain in
[method validation](gmail-method-validation.md). None are superseded by this
checkpoint. Next steps are obtaining the restricted assurance reports and
testing at least two complete pipelines with a disposable Gmail account. A
forwarding-only parser is not credited with historical discovery. A real-mail
coverage evaluation must follow successful disposable-account security tests.

No candidate is approved for the primary inbox. No live Gmail retrieval,
extraction-quality measurement, revocation test, or compromised-backend
isolation test has yet occurred. Local counterexamples are only counterexamples.
