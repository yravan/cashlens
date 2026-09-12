# Gmail Security Architecture for Cash Lens

## Executive Summary

Cash Lens should not put a primary-mailbox Gmail refresh token into its existing
web application's credential store. That store protects persisted credentials,
but the application has the key and code needed to decrypt them. A compromise
of the authorized runtime is a different threat from theft of the database.

No architecture can honestly promise an unbreakable email integration. A useful,
testable objective is narrower: compromise of Cash Lens's website, application
server, or ordinary deployment credentials must not grant arbitrary access to
the primary mailbox. This requires an authority boundary outside those systems,
not merely narrower search queries inside them.

There are two recommended paths, serving different product requirements:

- **Lowest-complexity exposure limit:** connect only a separate receipts mailbox
  populated with deliberately selected financial messages. It must not be an
  account-recovery destination. This sacrifices complete historical investigation.
- **Preferred research prototype for full-inbox investigation:** an independently
  installed, locally controlled connector that searches and processes email on
  the device. Ordinary web-runtime or deployment compromise must not allow
  arbitrary email queries or replacement of its trusted code. This assumes the
  device, OS/browser, connector, update roots, and enrollment/recovery authority
  remain uncompromised and the isolation is correctly implemented. A compromised
  website may see data deliberately uploaded to it,
  but must not acquire mailbox credentials or an unrestricted search interface.

A separately administered cloud broker is an intermediate option. Attested
confidential computing can strengthen it against host compromise, but only with
carefully controlled code, outputs, OAuth handling, and release authority. It is
not a simple setting on the current Vercel deployment.

The central unresolved engineering problem is **authorized output**, not just
token custody. A connector that protects tokens but obediently answers
server-supplied questions about email can still expose account-recovery material.
An LLM deciding that a message is financial is not a hard security boundary.

## Scope and Evidence

This assessment reflects public documentation accessed on September 12, 2026,
and a source-level inspection of Cash Lens. Recommendations and threat analyses
are architectural judgments, not vendor guarantees. No mailbox, credentials,
production configuration, or live account-recovery flow was accessed or tested.
No provider prices, integration timelines, or statistical security guarantees
are asserted.

The local baseline is commit `70e0a08`, with the transaction-understanding roadmap
from PR80. `apps/web/lib/crypto/credentials.ts` reads a runtime keyring, derives
an encryption key, uses AES-256-GCM with owner/connection-bound associated data,
and exposes a decryption function. `SecretString` suppresses accidental display.
These are useful controls against ciphertext substitution and accidental leakage;
they cannot stop arbitrary code executing with the same runtime authority.
`docs/production.md` places that keyring in deployment configuration. This is a
design observation, not evidence that a credential has been compromised.

The existing roadmap's relevant-email filtering and minimal-retention commitments
remain useful, but do not establish resistance to full web-runtime compromise.
Architecture selection must become a Gmail launch prerequisite. The research
below does not itself modify the feature tree or authorize inbox access.

## Threat Model

Email read access can expose password-reset links, sign-in links, recovery
correspondence, and security codes. Whether any particular account can then be
taken over depends on that service's recovery flow and additional authentication.
It is inaccurate to claim that every account necessarily falls, or that read-only
access is harmless because the attacker cannot send email.

| Attacker capability | Required distinction |
| --- | --- |
| Steals a database dump or backup | Encryption can help if keys are genuinely unavailable to that attacker. |
| Steals a Cash Lens login/session | Application authorization should prevent credential export; a trusted connector must not treat that session as unrestricted mailbox authority. |
| Executes code in the web backend | Assume runtime secrets, authorized database operations, and application-side filters are compromised. |
| Controls web deployment or served JavaScript | Assume the UI can misrepresent requests and read anything rendered inside it. |
| Controls connector update signing or policy approval | Can potentially authorize malicious connector behavior; separate this from ordinary web deployment. |
| Controls the connector host or user's device | Local protection may fail. An attested cloud workload can address some host attacks, under stated assumptions. |
| Sends malicious email or poisons transaction inputs | Can attempt prompt injection, parser exploitation, misleading matching, and output leakage. |
| Compromises Google or the primary account itself | Outside the promise of isolating Cash Lens; account/provider security remains necessary. |

Protect confidentiality, integrity, and availability separately. A malicious web
server can still hide results, alter reports, or stop synchronization even when
it cannot read email. The proposed boundary must not be marketed as protection
against every consequence of a Cash Lens compromise.

## What Google Actually Enforces

### Read-only is mailbox-wide

Google classifies `gmail.readonly` as restricted. It provides message-reading
access without granting sending or modification. There is no documented receipt,
sender, date-range, or Gmail-label restriction attached to that scope. Current
message add-on permissions have a different, interaction-bound scope; they do
not provide unattended inbox-wide investigation.[^1]

`messages.list` supports search queries and labels, but those are request
parameters supplied by the caller. A stolen authorized token can issue a
different request. The metadata-only scope also does not allow the `q` search
parameter and cannot read receipt bodies.[^2] Cloud Storage Credential Access
Boundaries are not a mechanism for narrowing Gmail tokens to selected mail.[^3]

Consequently, naming a Gmail label "Receipts" does not isolate the remaining
mailbox. A genuinely separate account containing only selected copies changes
the accessible dataset; a label in the primary mailbox does not.

### OAuth protection is necessary but narrower than isolation

Installed applications can use Google's system-browser authorization flow with
PKCE. The native-app OAuth standard addresses interception and redirect handling;
neither makes a deliberately malicious authorized client trustworthy.[^4][^5]
OAuth security best practice also distinguishes token replay prevention from
the broader risks of compromised clients.[^6]

Google now documents DPoP binding for refresh tokens: exchanging or refreshing
them requires proof from a cryptographic key. Its web-server documentation
explicitly says the resulting access tokens remain bearer tokens, not DPoP-bound
resource-access tokens.[^7][^8] This is a valuable defense against theft of a
refresh token without its associated key. It is not Gmail downscoping.

An attacker who can invoke the protected signing operation, steal a live access
token, or control the authorized Gmail-fetching code may still read mail. Keep
both token exchange and actual Gmail access inside the protected component.
Do not build an enclave that returns usable access tokens to Vercel. Validate
the exact OAuth client type, nonce handling, key storage, reauthorization, and
revocation behavior in a disposable-account prototype before claiming DPoP
support for a particular desktop design.

### Verification and policy are separate from security proof

Google's verification guidance includes personal-use exceptions, while broader
restricted-scope applications and server-side data access can require assessment.
A personal prototype is not automatically prohibited, nor does an exemption make
its architecture secure. Confirm the actual deployment's eligibility rather
than assuming public-app rules or exemptions apply universally.[^9]

Google's current Workspace policy constrains use and transfer, human access,
generalized model training, and persistent copies/caching. It also addresses
agentic consent. Obtain an explicit review of the proposed financial use case,
background authorization, retained extracts, and model-provider flow before
launch. "Read-only" and a no-training setting alone do not settle compliance.
Do not treat selected-document retention or automated agent consent in the
existing roadmap as already approved by Google.[^10]

## Architecture Comparison

The table describes expected boundaries if implemented correctly, not tested
properties of the current app.

| Design | Primary mailbox exposed by main-web compromise? | Automation / coverage | Main residual risk |
| --- | --- | --- | --- |
| Token encrypted in current backend | Potentially yes; runtime can use it | Full cloud automation | Same runtime owns policy and decryption |
| Browser-only connector served by Cash Lens | Potentially yes while used | Interactive; possible local processing | Compromised origin supplies the trusted code |
| Selected imports / current-message add-on | Not through an unrestricted mailbox token held by the web app | Limited to selected evidence | Exported messages themselves can contain secrets |
| Separate receipts mailbox | Primary mailbox not directly authorized | Cloud automation over that subset | Over-forwarding, sensitive copies, recovery-address misuse |
| Independent ordinary cloud broker | Not directly, if API and administration are truly separate | Full coverage possible | Broker compromise or abuse of its allowed outputs |
| Installed local connector | Not directly, with locally enforced authority | Full-inbox investigation possible; device must run | Device/update compromise and server-triggered inference |
| Attested cloud processor | Potentially resists web and host compromise | Full cloud coverage possible | Approved-code bugs, output abuse, policy-owner compromise |

### Separate receipts mailbox

Gmail supports forwarding selected messages with filters.[^11] Configure selection
under the primary account's control, and authorize Cash Lens only for the receiving
account. Cash Lens must not receive permission to change the primary account's
forwarding rules. Do not use the receiving account for password recovery or
merchant login identities.

This is the simplest structural reduction in the accessible dataset. It is not
a perfect filter: a merchant may send both receipts and sign-in links from the
same address; broad sender-based forwarding could include both. Misconfiguration
and maliciously crafted mail can place sensitive content in the receiving account.
Treat the receiving mailbox as sensitive, inspect forwarding behavior, and avoid
promising that security-message filtering is infallible.

This option is a useful safety-first mode, not a complete substitute for the
desired product. Historical appointment confirmations, unexpectedly named
receipts, and context outside forwarding rules will be unavailable. Do not
silently trade away that investigation capability in the roadmap.

### Browser-only encryption and extensions

Encrypting data in a normal Cash Lens web page does not protect it from an attacker
who can replace that page's JavaScript. Non-extractable browser keys can restrict
key export, but malicious authorized script can still misuse cryptographic
operations or read decrypted results. W3C's Web Crypto security discussion
expressly addresses malicious script risks.[^12]

A separately packaged extension changes code delivery. Manifest V3 prohibits
remotely hosted executable code.[^13] Native messaging can restrict callers to
particular extension origins.[^14] These are useful building blocks, not proof
that a permitted caller's request is legitimate. A compromised cashlens.org is
still cashlens.org, so an origin allowlist cannot establish user intent.

Chrome warns both that content-script messages may be attacker-crafted and that
compromised publisher accounts can distribute malicious updates.[^15] Prefer a
small native connector with a trusted local UI, adding an extension only if it
materially improves interaction. Avoid Gmail DOM scraping, broad browsing-history
permissions, and a generic local HTTP proxy. Local network interfaces introduce
their own caller-authentication and request-forgery risks.

### Locally controlled investigation

The local connector should own OAuth, refresh and access tokens, Gmail requests,
MIME and attachment parsing, evidence selection, and output policy. Keychain
storage is appropriate to investigate, but macOS protection differs from iOS;
do not claim every OAuth token is an unextractable Secure Enclave object.[^16]
An authorized process must still use the token. Requiring biometric presence on
every use would also conflict with unattended processing.

The important design improvement is to make this **mailbox-driven, not a remote
search proxy**. Locally authorized background work may identify and process
financial evidence independently. The server can deliver transaction data as
untrusted hints, but cannot select arbitrary search expressions, output fields,
prompts, destinations, or wider permissions. Raw evidence stays in the trusted
local view unless explicitly released.

This preserves a path to automation without demanding permanent per-transaction
confirmation. Local standing policies can authorize a well-defined class of
processing. During the first release, grouped export/financial-change proposals
are confirmed locally. Later promotion concerns both classification quality and
safe release behavior; a good category accuracy score says nothing about resistance
to secret exfiltration.

The guarantee remains conditional. If an extraction model sees sensitive text and
can place arbitrary strings in an uploaded note, the note becomes an exfiltration
channel. Restrict types and lengths, minimize free text, reject credential-like
fields, test hostile documents, and keep unrestricted notes local where needed.
These reduce risk but cannot prove a semantic classifier never misidentifies a
secret as an item name. For stronger protection among the considered modes,
initially release only locally approved evidence or use the separate-mailbox
mode. A trusted approval surface stops silent server authorization; it cannot
guarantee that a person recognizes every deceptive message or proposed extract.

### Independent cloud broker

A separate service can hold mailbox authority outside Vercel, provided web-runtime
credentials cannot administer it, decrypt its tokens, alter its policy, or deploy
its code. Separate a token vault from a *permission oracle*: a service that keeps
tokens secret but returns arbitrary Gmail results still fails the objective.

Use a fixed processing contract, independent identity and deployment controls,
restricted network paths, per-user budgets, and a bounded output schema. A
general-purpose "search email" endpoint is incompatible with the strongest claim.
If the same stolen administrator session controls the app, broker, secrets, and
release policy, nominal service separation provides less protection than advertised.

This may be operationally simpler than confidential computing, but compromise of
the broker runtime remains a primary-mailbox compromise. It is a risk-reduction
option, not the recommended strongest isolation boundary.

### Attested confidential computing

AWS Nitro Enclaves isolate enclave memory from the parent host and provide no
direct external networking or persistent storage.[^17] AWS KMS supports policy
conditions tied to enclave measurements, allowing key release to be restricted
to an approved workload.[^18] Exact-image measurements and signer identity have
different upgrade implications; authorizing every image signed by a key grants
that signer continuing authority.[^19]

Google Confidential Space similarly separates workload operation from access to
protected data and supports attestation-based resource authorization.[^20][^21]
For either approach, protect the entire path: OAuth enrollment, code exchange,
DPoP key, token refresh, Gmail TLS connection, parsing, inference, and output.
With an untrusted network proxy, terminate TLS inside the protected workload.
Otherwise the host may observe plaintext before the enclave protects it.
An escaped live bearer access token remains usable until expiry or effective
revocation, even if its refresh token is safely key-bound inside the workload.

Attestation proves an identity or measurement under the platform's assumptions;
it does not prove the measured code is correct. An approved image that exports
mail, interprets a hostile prompt, or accepts arbitrary jobs remains dangerous.
The policy authority must be separated from ordinary deployment authority, with
reviewed exact-image changes or explicitly governed signing roots. Deny debug
workloads, plaintext diagnostics, and permissive alternate key-release paths.

Apple's Private Cloud Compute is useful architectural prior art: it combines
attestation with release transparency and constrained data handling, rather than
presenting memory encryption alone as the solution.[^22] Its published design is
not a turnkey Gmail platform available to Cash Lens. Reproducing comparable
assurance would require substantial engineering and ongoing review.

The cloud options are technically credible, but a small application should not
choose them merely for the label "confidential." Prototype first, including
malicious-host and malicious-job tests. No implementation cost estimate is justified
without sizing the worker, inference, assessments, and operational responsibilities.

## The Forged-Transaction Problem

Consider an attacker who changes a ledger description to resemble a security
message, or creates many plausible transactions to probe mailbox contents. A
local connector receives these over an authenticated Cash Lens session. That
authentication proves which compromised server sent them, not that the owner
authorized the searches.

Signing requests with a backend key does not fix this if the attacker controls
that key. A local signature proves local execution, not human authorization,
unless it is bound to locally verified intent or an independently established
standing policy. The same issue applies to an enclave receiving web-server jobs.

Required controls are therefore architectural:

1. Establish mailbox ownership and consent through trusted connector UI, not only
   a web session. Verify the Google account independently from a caller-supplied ID.
2. Treat server transactions, categories, personal context, model prompts, and
   job metadata as untrusted. Schema validation alone does not prove authenticity.
3. Do not allow the server to select arbitrary search syntax, callback URLs,
   output templates, or model/tool instructions. Keep policy and model configuration
   under the connector's independently controlled release process.
4. Use local limits on frequency, windows, fetched bytes, output, and total work.
   Report budget exhaustion as incomplete coverage, never as no supporting mail.
5. Bind operations to owner, local policy version, expiry, and replay-resistant
   identifiers. These stop replay and cross-user substitution, not malicious
   requests already permitted by the policy.
6. Keep evidence inspection in the trusted local surface where confidentiality
   from a compromised web page matters. Anything displayed in that page is exposed.

Enrollment and recovery must enforce the same boundary. Device replacement,
policy reset, Google-account rebinding, device/policy-key changes, and output
destination or recipient-key changes require trusted local authorization and
independent reauthorization appropriate to the operation. A web session alone
must not replace an existing trusted device or policy. Pin account identity and
approved destinations locally, show canonical changes in the trusted UI, and
reject silent substitutions. Lost-device recovery is an explicit break-glass
trust path requiring its own threat model, not an email-link shortcut controlled
by the ordinary web backend. Test malicious enrollment, downgrade, recovery,
key substitution, and cross-user result routing.

If the product insists on arbitrary, unattended, server-chosen investigations
whose free-form results return to that server, a blanket promise that the server
cannot learn sensitive email contents is untenable. The product must constrain
the computation or the release, not merely hide the credential.

## Models, Retention, and Recovery

Local retrieval does not imply local inference. Sending selected email to a
cloud model introduces another plaintext recipient. A no-training or retention
contract does not cryptographically prevent that provider from processing the
input. A strict local mode needs local extraction/inference or explicit release
of selected content. Measure its quality on receipts and appointments before
claiming it can match a larger cloud model.

Never give the LLM OAuth credentials, an unconstrained Gmail tool, arbitrary
network execution, or authority to expand consent. Email and attachment content
must be treated as untrusted input. Prompt-injection defenses need external
permission enforcement, not only instructions to ignore malicious text.[^23]

Retention should distinguish transient unmatched messages, selected supporting
evidence, structured financial facts, logs, and backups. A deleted source can
invalidate an explanation without requiring silent deletion of a manually
confirmed ledger fact. Define that policy explicitly. Do not permanently retain
message bodies, embeddings, or copied extracts before reconciling the intended
lifecycle with Google's rules and the app's deletion contract.

Store consent, revocation, and release-policy state outside the compromised app's
sole control where possible. A website logout is not equivalent to revoking its
Google access. Revocation removes future access but cannot retract data already
copied; Google explicitly distinguishes third-party access from retained data.[^24]

Passkeys/security keys and hardened recovery protect the Google, developer,
publisher, and cloud-administrator accounts. Google Advanced Protection also
restricts third-party access and recovery; it may block an unverified prototype,
so compatibility must be checked before relying on it.[^25] These controls do not
re-authenticate every Gmail request made with an already authorized token.

## Verifiable Security Objectives

Replace "unbreakable" with claims that have an attacker model, assumptions,
observable evidence, and a regression test. A finite test suite does not prove
absence of vulnerabilities. Independent review, constrained design, and repeatable
adversarial tests can nevertheless establish substantially stronger assurance.
OWASP ASVS provides a useful verification baseline, not a certification that this
particular architecture is safe.[^26]

| Claim | Verification exercise | Important limit |
| --- | --- | --- |
| Main web runtime never receives Gmail tokens | Capture application/connector traffic and inspect test logs, stores, backups, and error paths | Absence in one happy path is insufficient |
| Main-server takeover cannot request arbitrary mail | Give testers full control of the test backend; mutate transactions, context, categories, prompts, jobs, and callback destinations | Must test allowed-output abuse, not only raw query rejection |
| Database theft cannot recover mailbox authority | Restore stolen test ciphertext without connector keys; attempt decryption and refresh | Does not cover simultaneous compromise of key authority |
| Search policy cannot be replaced by web deployment | Deploy malicious web code; attempt policy changes, consent reset, downgrade, and new-device enrollment | Trusted connector/update root remains an assumption |
| Email content cannot invoke privileged actions | Send hostile MIME, HTML, attachments, fake receipts, links, and injected model instructions | Parser bugs and semantic leakage require continued testing |
| Results cannot contain security-message secrets | Seed disposable mailboxes with canary reset links/codes and misleading financial wrappers; exercise normal and malicious jobs | Passing canary tests is not proof for every possible secret |
| Revocation/deletion work across the lifecycle | Revoke during queued/running work; inspect caches, indexes, evidence, backups, and replayed jobs | Previously exported copies cannot be recalled |
| Protected cloud code is the reviewed code | Verify production attestation and key-release policy; reject altered/debug/old measurements | Approved code may still have flaws |
| Updates resist one stolen deployment credential | Attempt unauthorized release, rollback, and policy replacement | Shared custodians can collapse nominal independence |

Use disposable accounts for compromise simulations. Financial-quality evaluations
with authorized real data are a separate activity. Do not conduct account-recovery
attacks or inbox-leakage experiments against the primary account.

For verifiable distribution, publish source, build provenance, reviewed artifact
hashes, policy versions, and a clear record of production releases. Reproducible
builds can help compare source and binaries but do not prove source correctness.
TUF supplies maintained patterns for signed update metadata, expiry, role
separation, and compromise recovery; do not invent a custom update protocol.[^27]
Independent reviewers must not share the ordinary web deployer's signing authority.
TUF cannot make an authorized malicious release safe. Independent approval and
threshold custody are additional policy requirements; transparency and reproducible
builds aid detection and verification, not prevention of every malicious update.

## Recommended Decision and Delivery Gates

**Recommendation:** retain full-inbox investigation as a product goal, but prototype
it as a locally controlled component before considering unrestricted cloud Gmail
access. Offer selected imports or a separate receipts mailbox as the lower-complexity
mode. Do not represent that mode as equivalent historical coverage.

The proposed local architecture is not yet approved for production. Its key
experiment is whether useful automatic extraction and matching can operate with
bounded, locally controlled outputs while resisting a malicious backend. If that
cannot be demonstrated, retain grouped release confirmation or reduce the data
available to the connector. Do not weaken the stated threat model to get automation.

The release-policy decision is explicit: locally approve each released evidence
item (potentially through grouped review); authorize a narrow standing policy for
automatic release and accept its bounded inference and semantic-leakage risks; or
restrict the accessible data to a separate mailbox/selected imports. Full automation
is still a valid goal, but it cannot carry the same confidentiality promise as no
release without local approval. None of these modes promises perfect human or
model judgment.

| Gate | Required outcome |
| --- | --- |
| 1. Product/security decision | Choose full local investigation versus subset mailbox; choose local release approval versus a standing automatic-release policy; define model recipients and the evidence allowed on the website. |
| 2. Threat model and Google review | Specify attacker boundaries, permitted use, consent, token/client configuration, data lifecycle, and applicable verification/assessment obligations. |
| 3. Disposable-account prototype | Demonstrate OAuth, local custody, revocation, bounded extraction, no raw web search endpoint, and workable device-offline behavior. |
| 4. Adversarial validation | Independent reviewer controls backend and sends hostile mail; test exfiltration, replay, enrollment, model configuration, and update attacks. |
| 5. Limited real-data pilot | Explicit authorization, confirmation-first releases, sensitive logging disabled, measured utility and failure cases. |
| 6. Graduated operation | Promote only independently evaluated capabilities; keep a local pause/revoke control, audit trail, regression gates, and a documented rollback path. |

Before implementation, update leaf 2.3.1 with the selected authorization boundary
and connect it explicitly to 4.5.1/4.5.2, 9.2, and 10.8. Add a focused connector
isolation/release-security leaf if the chosen architecture needs its own ownership.
This is proposed follow-up, not an automatic expansion into desktop or enclave
implementation under the existing Gmail node.

Unresolved questions are concrete: acceptable offline delay, approved model/data
recipients, local update custody, output confidentiality, retention interpretation,
Google verification eligibility, and the strength of the automatic-release tests.
None is solved by adding encryption, a stronger LLM, or a separate service name.

## Sources

All online sources below were accessed September 12, 2026. Dates are publication
or update dates where established; otherwise they are current undated documentation.
Linked sources describe platform behavior; application-specific recommendations
and proposed tests above are analysis. No quoted tokens or private account data
are included.

[^1]: Google, [Choose Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), updated September 10, 2026. Scope extent and sensitivity classes.
[^2]: Google, [users.messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list), updated April 15, 2026. Query parameters and metadata restriction.
[^3]: Google Cloud, [Credential Access Boundaries for Cloud Storage](https://docs.cloud.google.com/iam/docs/downscoping-short-lived-credentials). Storage-specific downscoping, not Gmail label authorization.
[^4]: Google, [OAuth 2.0 for iOS and Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app). Installed-client flow and PKCE.
[^5]: IETF, [RFC 8252: OAuth 2.0 for Native Apps](https://www.rfc-editor.org/rfc/rfc8252.html), October 2017. External browser and redirect security.
[^6]: IETF, [RFC 9700: Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700.html), January 2025. OAuth attack model and token protection.
[^7]: Google, [DPoP Adoption Guide](https://developers.google.com/identity/protocols/oauth2/resources/dpop-adoption), updated July 31, 2026. Key-bound refresh-token exchanges.
[^8]: Google, [OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server). Explicit statement that access tokens remain bearer tokens with DPoP refresh binding.
[^9]: Google, [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), updated August 19, 2026. Assessment and personal-use exceptions.
[^10]: Google, [Workspace user data and developer policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy), updated September 3, 2026. Appropriate use, Limited Use, consent, retention, and security obligations. Applicability requires review of the specific design.
[^11]: Google, [Automatically forward Gmail messages to another account](https://support.google.com/mail/answer/10957?hl=en). Selective forwarding configuration.
[^12]: W3C, [Web Cryptography Level 2](https://www.w3.org/TR/webcrypto/), First Public Working Draft, April 22, 2025. Security considerations on malicious scripts; a draft, not a finalized new guarantee.
[^13]: Google Chrome, [Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3). Packaged executable-code restrictions.
[^14]: Google Chrome, [Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging). Extension-to-native caller restrictions.
[^15]: Google Chrome, [Stay secure](https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure). Publisher-account compromise and untrusted content-script messages. The page displays a 2018 update date; use it for enduring security guidance, with current APIs covered by sources 13-14.
[^16]: Apple, [Keychain data protection](https://support.apple.com/guide/security/keychain-data-protection-secb0694df1a/web), December 19, 2024. Token storage and platform differences.
[^17]: AWS, [Nitro Enclaves concepts](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave-concepts.html). Host isolation and enclave networking/storage constraints.
[^18]: AWS, [Condition keys for Nitro Enclaves](https://docs.aws.amazon.com/kms/latest/developerguide/conditions-nitro-enclave.html). Measurement-bound KMS policy.
[^19]: AWS, [Cryptographic attestation](https://docs.aws.amazon.com/enclaves/latest/user/set-up-attestation.html). Image, signer, and related measurements.
[^20]: Google Cloud, [Confidential Space overview](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/confidential-space-overview). Workload/operator trust separation.
[^21]: Google Cloud, [Create and grant access to confidential resources](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/create-grant-access-confidential-resources). Attested resource-access configuration.
[^22]: Apple Security Research, [Private Cloud Compute](https://security.apple.com/blog/private-cloud-compute/), June 10, 2024. Attestation and release transparency as architectural prior art, not an available Cash Lens integration.
[^23]: OWASP, [LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html). Untrusted retrieved content and permission enforcement.
[^24]: Google, [Share access to your Google Account with third-party apps](https://support.google.com/accounts/answer/14012355). Revocation versus already-held third-party data.
[^25]: Google, [Advanced Protection Program questions](https://support.google.com/accounts/answer/7539956). Third-party-app restrictions and stronger account protection.
[^26]: OWASP, [Application Security Verification Standard](https://owasp.github.io/www-project-application-security-verification-standard/). Verification baseline.
[^27]: The Update Framework, [Overview](https://theupdateframework.io/docs/overview/). Update roles, signed metadata, and compromise resilience.
