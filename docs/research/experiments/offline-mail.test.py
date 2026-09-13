"""Disposable archive/sandbox experiment, not a production extractor."""

import email.policy
import errno
import json
import mailbox
import os
import socket
import sys
import tempfile
import unittest
import zipfile
from email.message import EmailMessage
from email.parser import BytesParser
from pathlib import Path


def archive_messages(path):
    messages = 0
    with zipfile.ZipFile(path) as source, tempfile.TemporaryDirectory() as directory:
        entries = [entry for entry in source.infolist() if entry.filename.endswith('.mbox')]
        if not entries or sum(entry.file_size for entry in entries) > 100_000_000:
            raise ValueError('Archive outside probe limits')
        for index, entry in enumerate(entries):
            target = Path(directory) / 'mail.mbox'
            with source.open(entry) as stream, target.open('wb') as output:
                written = 0
                while chunk := stream.read(1024 * 1024):
                    written += len(chunk)
                    if written > 100_000_000:
                        raise ValueError('Archive outside probe limits')
                    output.write(chunk)
            parsed = mailbox.mbox(
                target, create=False,
                factory=lambda stream: BytesParser(policy=email.policy.default).parse(stream),
            )
            try:
                for message in parsed:
                    messages += 1
                    if messages > 20000:
                        raise ValueError('Archive outside probe limits')
                    yield index, message
            finally:
                parsed.close()


def audit_archive(path):
    counts = dict(mboxes=0, messages=0, text_parts=0, attachments=0, mime_defects=0)
    with zipfile.ZipFile(path) as source:
        counts['mboxes'] = sum(entry.filename.endswith('.mbox') for entry in source.infolist())
    for index, message in archive_messages(path):
        counts['messages'] += 1
        for part in message.walk():
            counts['mime_defects'] += len(part.defects)
            if part.get_content_disposition() == 'attachment':
                counts['attachments'] += 1
            elif part.get_content_type() in ('text/plain', 'text/html'):
                counts['text_parts'] += 1
    return counts


class OfflineMailTests(unittest.TestCase):
    def test_empty_mbox_is_counted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'empty.zip'
            with zipfile.ZipFile(path, 'w') as source:
                source.writestr('mail.mbox', '')
            self.assertEqual(audit_archive(path), dict(
                mboxes=1, messages=0, text_parts=0, attachments=0, mime_defects=0,
            ))

    def test_archive_preserves_context_and_attachments(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.mbox"
            archive = mailbox.mbox(path)
            fixtures = [
                ("Receipt", "Contact solution 12.00; lotion 8.00; paid 20.00."),
                ("Booking confirmed", "Haircut at Example Studio, paid 35.00."),
                ("Private conversation", "PRIVATE_TEST_CANARY"),
            ]
            for subject, body in fixtures:
                message = EmailMessage()
                message["Subject"] = subject
                message["From"] = "test@example.invalid"
                message.set_content(body)
                if subject == "Receipt":
                    message.add_attachment(
                        b"INVENTED_ATTACHMENT_CANARY",
                        maintype="application", subtype="octet-stream",
                        filename="../../escaped.txt",
                    )
                archive.add(message)
            archive.close()
            zip_path = Path(directory) / 'export.zip'
            with zipfile.ZipFile(zip_path, 'w') as exported:
                exported.write(path, '../../mail.mbox')
            self.assertEqual(audit_archive(zip_path), dict(
                mboxes=1, messages=3, text_parts=3, attachments=1, mime_defects=0,
            ))
            zip_path.unlink()
            parsed = mailbox.mbox(
                path, create=False,
                factory=lambda stream: BytesParser(policy=email.policy.default).parse(stream),
            )
            try:
                messages = list(parsed)
                self.assertEqual(len(messages), 3)
                self.assertIn("lotion 8.00", messages[0].get_body().get_content())
                self.assertIn("Haircut", messages[1].get_body().get_content())
                self.assertIn("PRIVATE_TEST_CANARY", messages[2].get_body().get_content())
                attachment = list(messages[0].iter_attachments())[0]
                self.assertEqual(attachment.get_payload(decode=True), b"INVENTED_ATTACHMENT_CANARY")
                self.assertEqual(attachment.get_filename(), "../../escaped.txt")
                self.assertEqual(sorted(os.listdir(directory)), ["fixture.mbox"])
            finally:
                parsed.close()

    def test_network_namespace_has_only_active_loopback(self):
        active = [
            name for _, name in socket.if_nameindex()
            if int(Path(f"/sys/class/net/{name}/flags").read_text().strip(), 16) & 1
        ]
        self.assertEqual(sorted(active), ["lo"])
        with socket.socket() as connection:
            connection.settimeout(1)
            with self.assertRaises(OSError) as failure:
                connection.connect(("192.0.2.1", 443))
            self.assertEqual(failure.exception.errno, errno.ENETUNREACH)

    def test_nonroot_no_effective_capabilities_or_named_host_mounts(self):
        self.assertNotEqual(os.getuid(), 0)
        status = dict(line.split(":", 1) for line in Path("/proc/self/status").read_text().splitlines())
        self.assertEqual(int(status["CapEff"].strip(), 16), 0)
        self.assertEqual(int(status["NoNewPrivs"].strip()), 1)
        self.assertFalse(Path("/var/run/docker.sock").exists())
        self.assertFalse(Path("/Users/yajvanravan").exists())
        with self.assertRaises(OSError):
            Path("/should-not-write").write_text("invented")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == '--archive':
        try:
            print(json.dumps(audit_archive(sys.argv[2])))
        except Exception:
            print('Archive audit failed; private details suppressed.', file=sys.stderr)
            sys.exit(1)
    else:
        unittest.main()
