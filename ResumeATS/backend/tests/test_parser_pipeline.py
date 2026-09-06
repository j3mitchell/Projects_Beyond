import unittest

from app.parser_pipeline import (
    _embedded_organization,
    _job_date_range,
    _location_like,
    _organization_from_context,
    _strict_title_fallback,
)


class ResumeParserPipelineTests(unittest.TestCase):
    def test_action_sentence_is_not_a_title(self):
        self.assertFalse(
            _strict_title_fallback(
                "Maintained database availability, security, performance and backup readiness"
            )
        )
        self.assertFalse(
            _strict_title_fallback(
                "Led 5 DBAs, 1 Oracle Developer, 2 Testers and 2 Web Developers"
            )
        )

    def test_real_role_title_passes_fallback(self):
        self.assertTrue(_strict_title_fallback("Senior Data Engineer"))
        self.assertTrue(_strict_title_fallback("Oracle DBA Team Lead"))
        self.assertTrue(_strict_title_fallback("Web Applications Developer"))

    def test_known_org_alias_is_detected_inside_context(self):
        match = _embedded_organization("Classified DHS Security Operations")
        self.assertIsNotNone(match)
        self.assertEqual(match.text, "DHS")

        context = _organization_from_context("Environment: Classified DHS Security Operations")
        self.assertIsNotNone(context)
        self.assertEqual(context.text, "DHS")

    def test_location_is_not_company(self):
        self.assertTrue(_location_like("Washington, DC"))
        self.assertTrue(_location_like("Remote"))

    def test_position_date_range_supports_two_digit_month_year(self):
        self.assertEqual(_job_date_range("Example Systems | 06/15 - 08/19"), "06/15 - 08/19")
        self.assertEqual(_job_date_range("Example Systems | 06/2015 to present"), "06/2015 - present")


if __name__ == "__main__":
    unittest.main()
