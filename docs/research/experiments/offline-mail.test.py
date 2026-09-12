"""Disposable archive/sandbox experiment, not a production extractor."""

import email.policy
import errno
import mailbox
import os
import socket
import tempfile
import unittest
from email.message import EmailMessage
from email.parser import BytesParser
from pathlib import Path


class OfflineMailTests(unittest.TestCase):
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
    unittest.main()
