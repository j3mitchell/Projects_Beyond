import unittest
import os
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.api import app

from app.job_requirements import extract_requirements
from app.resume_generator import generate_resume
from app.job_source import analyze_job_text


class GenerationRequirementsTests(unittest.TestCase):
    def test_generate_api_returns_tailored_preview_and_full_requirements(self):
        source = 'Jane Example\nEngineer, Example\n- Wrote documentation.\n- Built Python services.\n'
        posting = 'Title: Platform Engineer\nRequired Skills:\nAt least five years building Python services for enterprise customers in production.\nPreferred Skills:\nKubernetes certification.'
        with patch.dict(os.environ, {'RESUMEATS_ENV': 'development'}):
            response = TestClient(app).post('/generate', files={'resume': ('resume.txt', source)},
                                            data={'job_description': posting})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertIn('Engineer, Example\n- Built Python services.\n- Wrote documentation.', result['preview'])
        self.assertTrue(result['changes'])
        self.assertEqual(result['analysis']['ranked_categories']['qualifications_min'][0]['skill'], 'Python')
        self.assertEqual(result['analysis']['ats_keywords']['Python'], 1)
        self.assertIn('enterprise customers in production', result['analysis']['requirements'][0]['text'])

    def test_pasted_job_identity_and_requirements(self):
        result = analyze_job_text('Job Title: Platform Engineer\nCompany: Example Systems\nRequired Skills:\nAt least five years building production Python services for enterprise customers.\nPreferred Skills:\nKubernetes certification.')
        self.assertEqual(result['title'], 'Platform Engineer')
        self.assertEqual(result['company'], 'Example Systems')
        self.assertEqual(result['requirements'][0]['kind'], 'required')
        self.assertIn('enterprise customers', result['requirements'][0]['text'])

    def test_full_requirements_inline_headings_and_preferred_isolation(self):
        text = """Requirements: At least five years of experience building Python services in production.
SQL experience is required.
Kubernetes experience is preferred.
Preferred Qualifications
Cloud certification.
Responsibilities
Build reliable services for customers.
Benefits
Free Python training and medical coverage.
"""
        result = extract_requirements(text)
        self.assertEqual([item['kind'] for item in result],
                         ['required', 'required', 'preferred', 'preferred', 'responsibility'])
        self.assertEqual(result[0]['text'], 'At least five years of experience building Python services in production.')
        self.assertIn('Requirements:', result[0]['evidence'])
        self.assertFalse(any('medical' in item['text'] for item in result))

    def test_relevance_order_preserves_employers_dates_and_all_source_lines(self):
        original = 'Jane Example\nEngineer, Alpha, 2022–Present\n- Wrote documentation.\n- Built Python services.\n\nEngineer, Beta, 2020–2022\n- Managed SQL reports.\n'
        result = generate_resume(original, {'skills': [{'name': 'Python'}, {'name': 'Kubernetes'}]})
        self.assertIn('Alpha, 2022–Present\n- Built Python services.\n- Wrote documentation.', result['preview'])
        self.assertIn('Beta, 2020–2022\n- Managed SQL reports.', result['preview'])
        self.assertCountEqual(original.strip().splitlines(), result['preview'].splitlines())
        self.assertNotIn('Kubernetes', result['preview'])
        self.assertTrue(result['changes'])

    def test_keywords_are_not_substring_claims(self):
        result = generate_resume('JavaScript development', {'skills': [{'name': 'Java'}]})
        self.assertEqual(result['keywords'][0]['status'], 'review')

    def test_multiline_bullets_stay_attached(self):
        original = '- Documentation\n- Python\n  continuation of the Python bullet'
        self.assertEqual(generate_resume(original, {'skills': [{'name': 'Python'}]})['preview'], original)

    def test_job_only_has_no_resume(self):
        self.assertEqual(generate_resume('', {'skills': [{'name': 'Python'}]})['preview'], '')
