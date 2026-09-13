"""Structural source checks, not receipt classification or ground truth."""

import json
import re
import runpy
import sys
import unittest
from html.parser import HTMLParser


class TextAuditParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.excluded = None
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if self.excluded is None and tag in {'script', 'style'}:
            self.excluded = tag

    def handle_endtag(self, tag):
        if self.excluded == tag:
            self.excluded = None

    def handle_data(self, data):
        if self.excluded is None:
            self.parts.append(data)


def html_text(source):
    if len(source) > 500_000:
        raise ValueError('HTML outside audit limit')
    parser = TextAuditParser()
    parser.feed(source)
    parser.close()
    return ' '.join(parser.parts)


def has_money_syntax(text):
    return bool(re.search(r'(?:[$\u20ac\u00a3]\s*\d|\b(?:USD|EUR|GBP|INR|CAD|AUD)\s*\d|\d\s*(?:USD|EUR|GBP|INR|CAD|AUD)\b)', text))


def audit():
    reader = runpy.run_path('/work/offline-mail.test.py')['archive_messages']
    counts = dict(purchase_labeled=0, plain_text=0, explicit_money_syntax=0,
                  all_messages=0, all_plain_text=0, all_money_syntax=0,
                  html_bodies=0, html_only=0, html_money_syntax=0,
                  html_additional_money_syntax=0, either_money_syntax=0,
                  html_over_limit=0)
    for _, message in reader('/input.zip'):
        labels = {label.strip().lower() for label in str(
            message.get('X-Gmail-Labels', '')).split(',')}
        purchase = bool(labels.intersection({'purchases', 'category purchases'}))
        counts['all_messages'] += 1
        counts['purchase_labeled'] += int(purchase)
        body = message.get_body(preferencelist=('plain',))
        plain_money = body is not None and has_money_syntax(body.get_content())
        counts['all_plain_text'] += int(body is not None)
        counts['plain_text'] += int(purchase and body is not None)
        counts['all_money_syntax'] += int(plain_money)
        counts['explicit_money_syntax'] += int(purchase and plain_money)
        html = message.get_body(preferencelist=('html',))
        html_money = False
        if html is not None:
            counts['html_bodies'] += 1
            counts['html_only'] += int(body is None)
            source = html.get_content()
            if len(source) > 500_000:
                counts['html_over_limit'] += 1
            else:
                html_money = has_money_syntax(html_text(source))
        counts['html_money_syntax'] += int(html_money)
        counts['html_additional_money_syntax'] += int(html_money and not plain_money)
        counts['either_money_syntax'] += int(html_money or plain_money)
    print(json.dumps(counts))


class HtmlAuditTests(unittest.TestCase):
    def test_decodes_text_but_not_attributes_scripts_styles_or_comments(self):
        source = ('<style>$800</style><script>$900</script><!-- $700 -->'
                  '<img src="https://example.invalid/$600" alt="$500">'
                  '<table><tr><td>Lotion</td><td>&#36;12.00</td></tr></table>'
                  '<a href="https://example.invalid/private">Receipt</a>')
        self.assertEqual(html_text(source), 'Lotion $12.00 Receipt')
        self.assertTrue(has_money_syntax(html_text(source)))

    def test_attributes_alone_are_not_money_evidence(self):
        self.assertFalse(has_money_syntax(html_text('<img alt="$10">Hello')))

    def test_large_html_is_rejected_not_silently_truncated(self):
        with self.assertRaises(ValueError):
            html_text('x' * 500_001)


if __name__ == '__main__':
    if len(sys.argv) == 2 and sys.argv[1] == '--test':
        unittest.main(argv=[sys.argv[0]])
    else:
        try:
            audit()
        except Exception:
            print('Source audit failed; details suppressed.', file=sys.stderr)
            sys.exit(1)
