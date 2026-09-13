# Gmail Financial Evidence Vendor Assessment

## Decision Summary

Assessment date: September 12, 2026. Public documentation review, not a live
vendor integration test or security certification. A subsequent Parseur
assurance-report request was submitted with explicit approval; reports have
not been received or reviewed. No vendor mailbox grant, receipt forwarding,
vendor subscription, or purchase occurred. The
[live checkpoint](gmail-live-checkpoint.md) records that request, and separate
Google-owned/local experiments are recorded in [method validation](gmail-method-validation.md).

There are credible managed alternatives. A custom desktop connector is not the
default decision until these alternatives have been evaluated. However, no
reviewed public contract establishes the complete combination of autonomous
historical investigation, appointment evidence, exact item allocations, and
isolation from a compromised Cash Lens runtime.

Two shortlist tracks should remain separate:

1. **Automatic mailbox collection: WellyBox, conditional hold.** Closest documented
   collection workflow; insufficient public evidence for the required security
   and item-level delivery contract. It is not inherently disqualified merely
   because the vendor holds a Gmail token.
2. **Selected-email intake: Parseur and Veryfi Email Collector, conditional pilot
   candidates.** Their forwarding workflows can avoid source-mailbox credentials
   entirely in Cash Lens. They do not independently search unforwarded history.

Nylas, Nango, and Aurinko are useful integration infrastructure, but their ordinary
read/proxy integrations do not satisfy the threat model when their read-capable
credentials reside in Cash Lens. This is not a judgment that those vendors are
insecure; it is a mismatch between their normal capability and this requirement.

## Security Requirement

Assume an attacker controls Cash Lens's web backend, deployment, and runtime
credentials. The attacker must not be able to read arbitrary source-mailbox
messages, change what the upstream processor searches, or change its release
policy. The vendor account, its administration, and the primary Gmail account
remain outside that particular compromise scenario.

The desirable contract is **push-only extracted evidence**. Cash Lens receives
events but holds no Gmail token, vendor session, broad vendor API key, or vendor
management credential. An inbound webhook secret must be newly generated for
that purpose, not a reused vendor API key. A verification public key is preferable
where supported because stealing it does not enable signing forged events.

Vendor compromise is a separate residual risk. A vendor retaining primary-mailbox
authority can expose that mailbox if it is compromised. Forwarding-only processing
limits the vendor's accessible corpus to the messages actually supplied, but those
copies can still contain private information or authentication links.

## Evidence Matrix

"Documented" means a vendor's published description or API contract, not an
independently measured outcome. "Unknown" is not equivalent to unavailable.

| Candidate | Intake and output documented | Cash Lens compromise boundary | Outstanding capability |
| --- | --- | --- | --- |
| WellyBox | Automatic financial-document collection; document JSON webhooks | Potentially suitable if strictly push-only and independently administered | Structured item arrays, authenticated events, least-privilege administration, target-driven appointment investigation |
| Parseur | Forward selected Gmail messages; body/attachment extraction; tables and JSON webhooks | No source-mailbox token needed in the documented forwarding workflow | Historical selection, target-driven search, extraction quality, exact retention behavior and account controls |
| Veryfi Email Collector | Assigned intake address; asynchronous body/attachment processing; receipt/invoice API with item arrays | No Gmail token needed for forwarding-only intake | Authenticated event delivery, account/key permissions, asynchronous deletion, non-receipt appointments |
| Nylas | Managed mailbox grants and read/search APIs | Normal read-capable runtime credentials preserve mailbox-reading authority | Need a separately isolated extraction-only boundary, not just hosted OAuth |
| Nango | Authenticated proxy requests to provider APIs | Normal environment secret can authorize provider requests | A proxy credential in Cash Lens is not extraction-only permission |
| Aurinko | Unified mail access; Mail.Read covers messages and attachments | Read permission is broad, not financial-document-only | A managed email API does not itself establish push-only isolation |

## WellyBox

Its privacy policy describes automatic financial-document collection under broad
read-only mailbox authorization and acknowledges false-positive documents. It
also describes retaining Gmail-derived data while the account is open. These are
vendor-custody and retention risks, not proof that Cash Lens would receive the
underlying token. [Privacy policy](https://www.wellybox.com/privacy/)

The published webhook contract includes totals, currency, vendor, document IDs,
extracted text, and a document link. It does not establish a structured line-item
array or event-signature/replay protocol. Its UI configures the destination.
Absence from this page is an evidence gap, not proof the product lacks a feature.
The link's access semantics also need testing; do not assume it is public or
credential-protected. [Webhook documentation](https://help.wellybox.com/en/article/api-webhooks-documentation-1oynibf/)

Historical coverage is plan-dependent. The pricing page lists 12 months for
Basic, 24 months for monthly Business, and 48 months for annual Business. It
lists Business at $59 monthly or $49/month paid annually ($588 upfront). Confirm
current terms and webhook eligibility before buying; the page also carries an
old promotional banner. These are not costs incurred or authorization to spend.
[Pricing](https://www.wellybox.com/pricing/)

The security/deletion page documents account closure and deletion but does not
establish selective retention TTLs or independently controlled runtime/admin
roles. Obtain those details rather than infer them from a generic security label.
[Deletion instructions](https://www.wellybox.com/security/)

**Verdict:** keep on the shortlist for the full automatic-collection requirement,
but do not connect the primary inbox yet. Require proof of push-only operation,
authenticated events, safe output selection, and exact item-level delivery.
Receipt discovery does not prove it can resolve a platform charge from a separate
appointment confirmation. Ask specifically about that scenario.

## Parseur

The documented Gmail workflow forwards selected messages to a Parseur address,
then extracts fields from email bodies and attachments, including tables. It does
not require giving Cash Lens Gmail search access. It processes the supplied
messages, not arbitrary unforwarded history. [Gmail workflow](https://parseur.com/integration/extract-data-from-gmail)

The developer webhook guide documents JSON output, custom authentication headers,
delivery/retry behavior, and document IDs. Prefer the whole-document event for
reconciling line items to a total; its table-event descriptions differ from the
marketing page and need a payload test. Custom auth headers are not body signatures
or freshness proofs. Keep management credentials out of Cash Lens, prohibit
dynamic destinations, use HTTPS, and deduplicate deliveries. Never test private
documents with the public webhook inspectors suggested in the guide.
[Developer webhook contract](https://developer.parseur.com/webhooks),
[integration overview](https://parseur.com/integration/webhook-document-parsing)

Its support documentation states EU storage, encryption, configurable retention
as short as one day, and immediate post-processing deletion for templates. It
offers access to assurance reports on qualifying plans. Those are vendor claims;
neither the underlying reports nor deletion behavior were independently tested.
Confirm whether deletion is supported by the chosen AI/template mode and happens
only after successful durable delivery, including retries and backups.
[Security and privacy](https://help.parseur.com/en/articles/4578268-security-and-privacy-at-parseur)

**Verdict:** promising low-complexity pilot for selected-email intake, not a complete
replacement for 4.5.2 investigation. Keep sender selection outside Cash Lens's
control, and do not share a general Parseur API key merely for convenient setup.
Account MFA/recovery, administrator permissions, model subprocessors, and current
contract terms still need validation. The DPA is a diligence input, not an audit
certificate. [DPA](https://parseur.com/dpa)

## Veryfi

Email Collector accepts messages at an assigned address and asynchronously
processes bodies and attachments. Its documented supported endpoint is receipts
and invoices; it does not establish a general appointment-investigation service.
[Email Collector](https://faq.veryfi.com/en/articles/5254326-email-collector)
The receipt/invoice API explicitly defines `line_items`. Presence of fields is
not measured extraction accuracy or proof that category amounts reconcile.
[Document API](https://docs.veryfi.com/api/receipts-invoices/process-a-document/)

Veryfi documents webhook registration/confirmation, but setup confirmation must
not be confused with authenticating every later event. Establish whether each
delivery carries verifiable body authentication and freshness. If events only
notify completion and require a follow-up fetch, that changes the credential
contract. [Webhook registration](https://docs.veryfi.com/api/settings/add-a-webhook/)

The API-key guide describes newer scoped-key functionality marked beta/early
access. Do not assume availability or adequate endpoint restrictions. A full
vendor key must not be installed just to retrieve one result. An independently
isolated ingestion service could fetch selected documents, but adds a component
and needs its own threat model. [API keys](https://faq.veryfi.com/en/articles/5963432-veryfi-api-keys)

Document retention controls include deletion and `auto_delete`; asynchronous
Email Collector behavior, backup expiry, and delivery failures require testing.
Do not extrapolate synchronous request behavior to all intake paths.
[Retention controls](https://faq.veryfi.com/en/articles/6716494-document-retention-management)
Clarify training/model-improvement use and opt-out terms before supplying private
records; the accessible privacy page is not sufficient evidence of the exact
commercial configuration. [Privacy](https://www.veryfi.com/privacy)

**Verdict:** strong extraction-component candidate for a forwarding pilot. Not yet
approved for production, and not established as a turnkey full-history solution.

## Why Generic Email APIs Do Not Solve This Alone

Nylas explicitly warns that its application API key grants access to connected
accounts. Its authentication API supports mailbox requests using a vendor API key
or user access token. Neither hides those capabilities from an attacker controlling
the calling runtime. [Agent security](https://developer.nylas.com/docs/v3/getting-started/agent-security/),
[authentication API](https://developer.nylas.com/docs/reference/api/authentication-apis/)

Nango's proxy authenticates using an environment secret and lets the caller specify
the provider request path. Aurinko's Mail.Read covers messages and attachments.
They can be building blocks inside an independently controlled service, but moving
the token behind a proxy does not revoke the caller's authority to read mail.
[Nango proxy](https://nango.dev/docs/reference/backend/http-api/proxy/get),
[Aurinko scopes](https://docs.aurinko.io/authentication/authentication-scopes)

## Proposed Integration Contract

This is a design proposal, not an implemented or verified vendor feature.

1. The owner independently configures the processor or Gmail forwarding. Cash Lens
   cannot change source permissions, processing prompts/schema, or destinations.
2. The vendor sends a minimal financial-evidence event to a fixed HTTPS endpoint.
   Cash Lens has only inbound verification material, never a vendor control key.
3. Include tenant binding, stable document/event identity, revision, currency,
   totals, items and adjustments, and narrowly scoped provenance. Establish which
   fields the vendor actually supports rather than inventing an adapter contract.
4. Omit raw email bodies, security links, and arbitrary document text at the vendor
   before transmission wherever possible. Dropping them after receipt does not
   protect against a compromised receiver. Item descriptions remain a possible
   semantic leakage channel and require adversarial evaluation.
5. Verify and bound events, queue durably before acknowledging, deduplicate, reject
   mismatched tenants, and reconcile amounts in exact minor units. Receipt arrival
   proposes evidence/matches; it must not create another cash transaction by default.
6. Treat vendor content as untrusted. Never auto-follow a document URL or instructions
   inside an extracted note; address SSRF and hostile-document risks explicitly.
7. Keep deletion and configuration administration independent. If automated deletion
   requires a broad runtime key, prefer vendor-configured retention or a separately
   controlled maintenance path instead of weakening the push-only boundary.

Signed webhooks protect provenance against ordinary forgery; they do not protect
a runtime already controlled by an attacker. That attacker can falsify its own
database regardless. The confidentiality benefit is the absence of an upstream
read/management capability. A shared inbound secret must not authorize any vendor
API. Redirect/retry behavior and response handling must not let a malicious receiver
change future destinations or request broader upstream data.

## Acceptance Tests Before Primary-Inbox Use

- Inventory every runtime credential. Attempt mailbox listing/search, document
  enumeration, prompt/schema changes, destination changes, account recovery, and
  vendor-key creation using only those credentials. All unauthorized actions fail.
- Validate real event authentication, tenant binding, replay/duplicate behavior,
  retries, failure recovery, version changes, and out-of-order arrivals.
- Exercise mixed-item receipts, discounts/tax/tips, multiple currencies, duplicate
  forwarded copies, partial refunds, and invoices that were never paid. Require
  exact allocation and independent evidence for match identity.
- Test appointment confirmations separately. A processor that only recognizes
  receipts must not be advertised as resolving all platform charges.
- Send hostile and non-financial documents through a disposable test inbox. Include
  fake financial wrappers around canary security links/codes. Measure false positives
  and text leakage without using real recovery material.
- Verify history limits, ingestion completeness, deleted-source handling, and recovery
  after outages. Then verify deletion across raw files, extracted text, logs, caches,
  backups, and model providers to the extent the vendor contract allows.

No real-mailbox pilot has been run. Public capability claims cannot establish
quality or security outcomes on Cash Lens's records.

## Vendor Questions Ready to Send

The following is a draft inquiry, not a message already sent. It contains no
private transactions or account identifiers.

> We are evaluating a personal-finance integration. Our application must receive
> extracted financial evidence without possessing any credential capable of
> reading arbitrary Gmail messages or administering your service.
>
> Can you support a push-only integration with separately controlled administration?
> Please provide the precise payload schema, authentication/signature scheme,
> replay protection, retry semantics, event identity, and credential permission matrix.
>
> Can delivery exclude raw message/document text and include structured line items,
> quantities, prices, discounts, tax, tips, currency, and provenance? Does it require
> a follow-up API fetch, and if so can that key be strictly limited?
>
> What historical coverage and targeted reprocessing are supported? Can the system
> identify a service from a separate appointment confirmation, or only receipt/invoice
> documents? Please distinguish supported behavior from roadmap functionality.
>
> Please specify deletion/backup retention, supported automatic deletion modes,
> model subprocessors and training use, MFA/recovery and admin-role controls,
> available independent assurance reports, and protection against unauthorized
> submissions to intake addresses. Can destination changes and runtime privileges
> be kept outside our application's authority?
>
> Which plan includes these capabilities, and what are the billing units, historical
> backfill charges, API limits, and any embedded/multi-user licensing restrictions?

WellyBox follow-up: request the structured item schema, event authentication, and
whether the documented free-text/link fields can be omitted before delivery.
Parseur follow-up: clarify AI-mode retention, whole-document table payloads, sender
controls, and the exact admin/runtime credential boundary.
Veryfi follow-up: confirm scoped-key availability, complete Email Collector webhook
payload, per-event authentication, and `auto_delete` behavior on async failures.

## Next Decision

Do not buy or connect a primary inbox on this evidence alone. Pursue WellyBox
for automatic discovery and Parseur/Veryfi for a smaller forwarding pilot, obtaining
written answers and disposable-account evidence first. If WellyBox cannot meet
the gates, that does not prove no vendor can; it narrows the remaining search.

This assessment supplements [the architecture report](gmail-security-architecture.md).
It corrects its build-first emphasis: managed extraction should be evaluated before
authorizing a desktop or confidential-compute implementation. It does not weaken
the original requirement for full-history, evidence-backed transaction understanding.
