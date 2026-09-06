import os
import unittest
from io import BytesIO
from unittest.mock import Mock, patch

from docx import Document
from fastapi.testclient import TestClient
from pypdf import PdfReader
from striprtf.striprtf import rtf_to_text

from app.api import app
from app.job_source import public_target, fetch_public_html


class PlatformAPITests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"RESUMEATS_ENV": "development"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.client = TestClient(app)

    def test_production_rejects_unsigned_requests_before_body_parsing(self):
        with patch.dict(os.environ, {"RESUMEATS_ENV": "production"}):
            for route in ("/extract", "/generate", "/export"):
                self.assertEqual(self.client.post(route).status_code, 401)
            self.assertEqual(self.client.get("/access").status_code, 401)
            self.assertEqual(self.client.get("/health").status_code, 200)

    def test_active_expired_revoked_and_invalid_tokens(self):
        env = {"RESUMEATS_ENV": "production", "SUPABASE_URL": "https://example.supabase.co", "SUPABASE_PUBLISHABLE_KEY": "public"}
        with patch.dict(os.environ, env), patch("app.access.requests.get") as get:
            for row, status in [({"status": "active"}, 200), ({"status": "revoked"}, 403),
                                ({"status": "active", "expires_at": "2020-01-01T00:00:00Z"}, 403)]:
                get.side_effect = [Mock(status_code=200, json=lambda: {"id": "user-a"}), Mock(json=lambda: [row])]
                self.assertEqual(self.client.get("/access", headers={"Authorization": "Bearer token"}).status_code, status)
                self.assertEqual(get.call_args.kwargs['params']['tool_slug'], 'eq.resumeats')
            get.side_effect = [Mock(status_code=401)]
            self.assertEqual(self.client.get('/access', headers={'Authorization': 'Bearer invalid'}).status_code, 401)

    def test_complete_preview_and_edited_downloads(self):
        original = 'Jane Example\nProfessional Summary\n' + ('Managed PostgreSQL database systems and automation.\n' * 70)
        response = self.client.post('/generate', files={'resume': ('resume.txt', original)},
                                    data={'job_description': 'Database engineer supporting PostgreSQL, automation, monitoring and reliable enterprise systems. ' * 3})
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data['preview'], original.strip())
        self.assertTrue(data['keywords'])
        edited = data['preview'] + '\nEdited final line: José — résumé.\n' + ('Long-line-marker ' * 45) + 'ENDMARKER'
        for extension in ('docx', 'pdf', 'rtf'):
            response = self.client.post('/export', json={'content': edited, 'job_title': 'Database Engineer', 'output_format': extension})
            self.assertEqual(response.status_code, 200)
            self.assertIn('attachment', response.headers['content-disposition'])
            if extension == 'docx':
                text = '\n'.join(p.text for p in Document(BytesIO(response.content)).paragraphs)
            elif extension == 'pdf':
                text = '\n'.join(p.extract_text() for p in PdfReader(BytesIO(response.content)).pages)
            else:
                text = rtf_to_text(response.content.decode('ascii'))
            self.assertIn('Edited final line', text)
            self.assertIn('ENDMARKER', text)
            self.assertIn('José', text)
        self.assertEqual(self.client.get('/download/anything.docx').status_code, 404)

    def test_bad_input(self):
        self.assertEqual(self.client.post('/extract', files={'resume': ('bad.exe', b'no')}).status_code, 400)
        self.assertEqual(self.client.post('/extract', files={'resume': ('bad.docx', b'no')}).status_code, 400)
        self.assertEqual(self.client.post('/export', json={'content': ' ', 'output_format': 'pdf'}).status_code, 400)
        self.assertEqual(self.client.post('/export', json={'content': 'valid', 'output_format': 'exe'}).status_code, 400)
        self.assertEqual(self.client.post('/extract', files={'resume': ('huge.txt', b'x' * (10 * 1024 * 1024 + 1))}).status_code, 413)

    def test_private_addresses_and_redirects_are_blocked(self):
        for address in ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1']:
            with patch('app.job_source.socket.getaddrinfo', return_value=[(0,0,0,'',(address,80))]):
                with self.assertRaises(Exception) as caught:
                    public_target('http://example.com/job')
                self.assertEqual(caught.exception.status_code, 400)
        pool = Mock()
        pool.urlopen.return_value = Mock(status=302, headers={'Location':'http://169.254.169.254/latest/meta-data'})
        with patch('app.job_source.urllib3.HTTPSConnectionPool', return_value=pool), patch('app.job_source.socket.getaddrinfo', side_effect=[[(0,0,0,'',('93.184.216.34',443))], [(0,0,0,'',('169.254.169.254',80))]]):
            with self.assertRaises(Exception) as caught:
                fetch_public_html('https://example.com/job')
            self.assertEqual(caught.exception.status_code, 400)
