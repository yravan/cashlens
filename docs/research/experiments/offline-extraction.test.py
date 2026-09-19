import json
import runpy
import unittest


parse_response = runpy.run_path('/work/pilot.py')['parse_response']


class ResponseTests(unittest.TestCase):
    def test_numeric_and_abstention_responses(self):
        for expected in [
            dict(monetary_evidence=True, currency='USD', total_minor=2000,
                 item_amounts_minor=[1200, 800]),
            dict(monetary_evidence=False, currency=None, total_minor=None,
                 item_amounts_minor=[]),
        ]:
            self.assertEqual(parse_response(json.dumps(expected) + '\n[end of text]'), expected)

    def test_rejects_wrong_types_and_extra_fields(self):
        valid = dict(monetary_evidence=True, currency='USD', total_minor=2000,
                     item_amounts_minor=[1200, 800])
        for patch in [
            {'monetary_evidence': 1}, {'currency': {}}, {'currency': []},
            {'currency': 'unknown'}, {'total_minor': True},
            {'total_minor': '2000'}, {'item_amounts_minor': [True]},
            {'item_amounts_minor': '2000'}, {'note': 'INVENTED_PRIVATE_CANARY'},
        ]:
            with self.subTest(patch=patch):
                self.assertIsNone(parse_response(json.dumps(valid | patch)))

    def test_rejects_truncated_nonobject_and_missing_fields(self):
        for output in ['{"monetary_evidence":', '[]', 'null', '{}']:
            with self.subTest(output=output):
                self.assertIsNone(parse_response(output))


if __name__ == '__main__':
    unittest.main()
