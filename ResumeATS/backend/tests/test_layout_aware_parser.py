from __future__ import annotations

import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch

from docx import Document

from app.parser_pipeline import pipeline
from app.resume_io import read_resume_text


class LayoutAwareResumeParserTests(unittest.TestCase):
    def _word_resume_bytes(self) -> bytes:
        doc = Document()
        doc.add_paragraph("EXPERIENCE SUMMARY:")
        doc.add_paragraph("Senior database professional supporting secure systems.")
        doc.add_paragraph("EDUCATION | CLEARANCES:")
        p = doc.add_paragraph()
        p.add_run("Example University")
        p.add_run().add_break()
        p.add_run("Bachelor of Science: Information Systems")
        doc.add_paragraph("TECHNICAL SKILL SETS:")
        doc.add_paragraph("RDBMS:\tOracle, SQL Server, PostgreSQL")
        doc.add_paragraph("PROFESSIONAL EXPERIENCE:")
        p = doc.add_paragraph()
        p.add_run("Example Consulting Group, LLC\t\t06/2015 - current")
        p.add_run().add_break()
        p.add_run("Title: Database Consultant")
        doc.add_paragraph("Provided database architecture and production support.")
        doc.add_paragraph("Federal Security Operations; Arlington, VA\t02/2013 - 06/2015")
        doc.add_paragraph("Title: Database Team Lead | SME Contract: Example Systems")
        doc.add_paragraph("Environment: Classified systems and secure databases")
        doc.add_paragraph("PROFESSIONAL EXPERIENCE (CONT)…")
        doc.add_paragraph("U.S. Government Program; Washington, DC\t06/2009 - 02/2013")
        doc.add_paragraph("Title: Oracle DBA | Team Lead & SharePoint Administrator Contract: Example Digital, LLC")
        doc.add_paragraph("Managed database operations across secure enterprise systems.")
        doc.add_paragraph("REFERENCES: Furnished upon request")

        buffer = BytesIO()
        doc.save(buffer)
        return buffer.getvalue()

    def test_ingestion_preserves_manual_breaks_and_tabs(self):
        raw = self._word_resume_bytes()
        file = SimpleNamespace(filename="resume.docx")
        text = read_resume_text(file, raw)

        self.assertIn("Example Consulting Group, LLC | 06/2015 - current", text)
        self.assertIn("\nTitle: Database Consultant\n", text)
        self.assertIn("Example University\nBachelor of Science", text)

    @patch("app.parser_pipeline.classifier.organization_match", return_value={"valid": False, "confidence": 0.0})
    @patch("app.parser_pipeline.classifier.job_title_match", return_value={"valid": False, "confidence": 0.0})
    def test_non_ats_word_layout_extracts_sections_and_jobs(self, _title_match, _org_match):
        raw = self._word_resume_bytes()
        file = SimpleNamespace(filename="resume.docx")
        text = read_resume_text(file, raw)
        result = pipeline.parse(text)

        self.assertIn("database professional", result.executive_summary.lower())
        self.assertIn("Oracle", result.skills)
        self.assertEqual(len(result.education), 1)
        self.assertIn("Example University", result.education[0])
        self.assertGreaterEqual(len(result.experience), 3)
        self.assertEqual(result.experience[0].job, "Database Consultant")
        self.assertEqual(result.experience[0].company, "Example Consulting Group, LLC")
        self.assertEqual(result.experience[1].job, "Database Team Lead")
        self.assertIn("Federal Security Operations", result.experience[1].company)
        self.assertIn("Oracle DBA", result.experience[2].job)
        self.assertNotIn("Furnished upon request", " ".join(result.experience[-1].descriptions))
        self.assertEqual(result.target_position_title, "Database Consultant")


if __name__ == "__main__":
    unittest.main()
