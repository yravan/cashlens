# Offline Gmail Archive Validation

## Finding

A local archive is a viable candidate for historical investigation without a
live Gmail credential in Cash Lens. It is not a complete autonomous integration:
export acquisition, ongoing updates, real receipt extraction, and safe release
of notes remain unverified. No real mailbox was exported or processed here.

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

This is an actual local archive/sandbox experiment, not a live Google Takeout
test, LLM evaluation, OCR benchmark, or penetration test. It does not test
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
proof needed: an actual disposable Gmail export through this boundary, then
isolated body/PDF/image extraction and held-out real-mail accuracy evaluation.
No primary mailbox or vendor integration is approved by these results.

Independent security review reran the pinned command successfully. It identified
an overbroad test name and requested explicit runner-authority constraints; both
were corrected, and capability/no-new-privileges assertions were added. This is
an engineering review, not an external audit or certification.
