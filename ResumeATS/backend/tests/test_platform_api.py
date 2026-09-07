import json
import os
import unittest
from io import BytesIO
from unittest.mock import Mock, patch

from docx import Document
from fastapi.testclient import TestClient
from pypdf import PdfReader
from striprtf.striprtf import rtf_to_text

from app.api import app
from app.job_source import analyze_job, analyze_job_text, fetch_public_html, public_target


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

    def test_generate_returns_selected_deterministic_analysis(self):
        analysis = {
            "mode": "deterministic", "source_url": "", "title": "Target Role", "company": "",
            "industry": "technology", "summary": "Python cloud database role. " * 8,
            "raw_text": "Python cloud database role. " * 8, "metadata": {},
            "skills": [{"name": "Python", "score": 80.0, "evidence": ["python"], "source": "taxonomy"}],
        }
        with patch("app.api.analyze_job_text", return_value=analysis):
            response = self.client.post('/generate', files={'resume': ('resume.txt', 'Jane Example\nSummary\n' + 'Experienced analyst. ' * 20)},
                                        data={'job_description': 'Python cloud database role. ' * 8, 'job_model': 'deterministic'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['analysis']['mode'], 'deterministic')
        self.assertEqual(response.json()['analysis']['skills'][0]['name'], 'Python')

    def test_generate_allows_job_url_without_resume(self):
        analysis = {
            "mode": "deterministic", "source_url": "https://example.com/job", "title": "Cloud Platform Engineer", "company": "Example",
            "industry": "technology", "summary": "Build Python cloud services and data systems. " * 5,
            "raw_text": "Build Python cloud services and data systems. " * 5, "metadata": {},
            "skills": [{"name": "Python", "score": 80.0, "evidence": ["python"], "source": "taxonomy"}],
        }
        with patch("app.api.analyze_job", return_value=analysis):
            response = self.client.post('/generate', data={'job_url': 'https://example.com/job', 'job_model': 'deterministic'})
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload['job_title'], 'Cloud Platform Engineer')
        self.assertEqual(payload['company'], 'Example')
        self.assertEqual(payload['preview'], '')
        self.assertEqual(payload['analysis']['skills'][0]['name'], 'Python')

    def test_generate_returns_selected_ai_analysis(self):
        analysis = {
            "mode": "ai", "source_url": "https://example.com/job", "title": "Platform Engineer", "company": "Example",
            "industry": "technology", "summary": "AI summary. " * 15, "raw_text": "Cloud platform role. " * 15,
            "metadata": {"site_name": "Example"},
            "skills": [{"name": "Kubernetes", "score": 92.0, "evidence": ["container platform"], "source": "ai"}],
        }
        with patch("app.api.analyze_job", return_value=analysis):
            response = self.client.post('/generate', files={'resume': ('resume.txt', 'Jane Example\nSummary\n' + 'Experienced analyst. ' * 20)},
                                        data={'job_url': 'https://example.com/job', 'job_model': 'ai'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['analysis']['mode'], 'ai')

    def test_ai_without_provider_key_is_explicitly_unavailable(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}, clear=False):
            with self.assertRaises(Exception) as caught:
                analyze_job_text('Python cloud database role. ' * 8, 'ai')
        self.assertEqual(caught.exception.status_code, 503)

    def test_ai_analysis_normalizes_provider_json(self):
        provider = Mock()
        provider.json.return_value = {"choices": [{"message": {"content": '{"title":"Data Engineer","company":"Example","industry":"technology","description":"Build data systems for customers","location":"Austin, TX","type":"Hybrid","work":"Build data systems","task":"Lead data platform delivery","qual":["Bachelor degree"],"skills_min":["Python"],"skills_max":["Kubernetes"],"pay":"$120,000–$140,000 / yr","summary":"Build data systems.","skills":[{"name":"Python","score":88,"evidence":["Python services"]}]}'}}]}
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key", "OPENAI_MODEL": "test-model"}), patch('app.job_source.requests.post', return_value=provider) as post:
            analysis = analyze_job_text('Build Python cloud services and data systems. ' * 5, 'ai')
        self.assertEqual(analysis['mode'], 'ai')
        self.assertEqual(analysis['skills'][0]['score'], 88.0)
        self.assertEqual(analysis['type'], 'Hybrid')
        self.assertEqual(analysis['description'], 'Build data systems for customers')
        self.assertEqual(analysis['skills_min'], ['Python'])
        self.assertEqual(analysis['skills_max'], ['Kubernetes'])
        self.assertEqual(post.call_args.kwargs['json']['model'], 'test-model')

    def test_deterministic_url_analysis_extracts_taxonomy(self):
        html = b'''<html><head><title>Cloud Platform Engineer | Example</title><meta property="og:site_name" content="Example">
        <meta property="og:title" content="Job: Cloud Platform Engineer at Example"></head>
        <body><main><h1>Cloud Platform Engineer</h1><p>Build Python services with Docker and Kubernetes for a cloud data platform.</p>
        <p>Partner with engineering teams and communicate clearly. Python Python Python.</p></main></body></html>'''
        with patch('app.job_source.fetch_public_html', return_value=html):
            analysis = analyze_job('https://example.com/job', 'deterministic')
        self.assertEqual(analysis['mode'], 'deterministic')
        self.assertEqual(analysis['title'], 'Cloud Platform Engineer')
        self.assertEqual(analysis['company'], 'Example')
        self.assertEqual(analysis['industry'], 'technology')
        self.assertEqual(analysis['skills'][0]['name'], 'Python')

    def test_fetch_public_html_requests_decoded_content(self):
        response = Mock(status=200, headers={})
        response.read.return_value = b'<html><main>' + (b'job description ' * 20) + b'</main></html>'
        pool = Mock()
        pool.urlopen.return_value = response
        with patch('app.job_source.urllib3.HTTPSConnectionPool', return_value=pool), \
             patch('app.job_source.socket.getaddrinfo', return_value=[(0, 0, 0, '', ('93.184.216.34', 443))]):
            raw = fetch_public_html('https://example.com/job')
        self.assertIn(b'job description', raw)
        response.read.assert_called_once_with(2 * 1024 * 1024 + 1, decode_content=True)

    def test_icims_iframe_and_jobposting_metadata_are_extracted(self):
        wrapper = b'''<html><body><noscript><iframe id="noscript_icims_content_iframe" src="/jobs/4180/software-developer/job?in_iframe=1"></iframe></noscript></body></html>'''
        posting = {
            "@type": "JobPosting", "title": "Software Developer", "hiringOrganization": {"name": "Cayuse Holdings"},
            "jobLocationType": "TELECOMMUTE", "jobLocation": [{"address": {"addressLocality": "Arlington", "addressRegion": "VA", "addressCountry": "US"}}],
            "baseSalary": {"minValue": 110000, "maxValue": 160000, "currency": "USD"},
            "description": "<h2>The Work</h2><p>Build and test software applications for customers.</p><h2>Responsibilities</h2><p><strong>Key Responsibilities</strong></p><ul><li>Design and ship reliable software.</li></ul><h2>Qualifications</h2><ul><li>Bachelor's degree or equivalent experience.</li><li>Active security clearance.</li></ul><p><strong>Minimum Skills:</strong></p><ul><li>JavaScript and SQL.</li></ul><p><strong>Preferred Qualifications:</strong></p><ul><li>Kubernetes experience.</li></ul>"
        }
        frame = b'<html><head><title>iCIMS Careers Portal</title><script type="application/ld+json">' + json.dumps(posting).encode() + b'''</script></head>
        <body><div class="iCIMS_JobContent"><h1 class="iCIMS_Header">Software Developer</h1><p>Build and test software applications with JavaScript, SQL, secure coding, and CI/CD practices. </p></div></body></html>'''
        with patch('app.job_source.fetch_public_html', side_effect=[wrapper, frame]) as fetch:
            analysis = analyze_job('https://careers.example.com/jobs/4180/software-developer/job', 'deterministic')
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(analysis['title'], 'Software Developer')
        self.assertEqual(analysis['company'], 'Cayuse Holdings')
        self.assertIn('JavaScript', [skill['name'] for skill in analysis['skills']])
        self.assertEqual(analysis['location'], 'Arlington, VA')
        self.assertEqual(analysis['type'], 'Remote')
        self.assertLess(len(analysis['description'].split()), 7)
        self.assertLess(len(analysis['work'].split()), 7)
        self.assertLess(len(analysis['task'].split()), 7)
        for field in ('qual', 'skills_min', 'skills_max'):
            for item in analysis[field]:
                self.assertLess(len(item.split()), 7)
        self.assertIn("Bachelor's degree or equivalent experience.", analysis['qual'])
        self.assertEqual(analysis['skills_min'], ['JavaScript and SQL.'])
        self.assertEqual(analysis['skills_max'], ['Kubernetes experience.'])
        self.assertEqual(analysis['pay'], '$110,000–$160,000 / yr')
        self.assertEqual(analysis['description'], 'Build and test software applications for…')

    def test_paylocity_job_template_extracts_fields(self):
        html = b'''<html><head><title>Red Drum Holdings - Database Engineers</title></head><body>
        <div id="LayoutLogoName">Red Drum Holdings</div>
        <div class="job-preview" role="main"><div class="job-preview-header">
          <span class="job-preview-title"><span>Database Engineers</span></span>
          <div class="preview-location">Annapolis Junction, MD</div>
        </div><div class="job-preview-details">
          <div class="job-listing-header">Description</div><div><p>We solve complex data challenges and develop secure solutions.</p></div>
          <div class="job-listing-header">Requirements</div><div>
            <p>Requirements for database engineers include: Oracle database, database design and modeling, My SQL, and others.</p>
            <p>Education Requirements: Bachelor's degree in computer science or related discipline.</p>
            <p>A Current TS clearance plus Polygraph is required for all openings.</p>
            <p>Pay Range: 185K-275K.</p>
          </div></div></div></body></html>'''
        with patch('app.job_source.fetch_public_html', return_value=html):
            analysis = analyze_job('https://recruiting.paylocity.com/recruiting/jobs/Details/2567762/Red-Drum-Holdings/Database-Engineers', 'deterministic')
        self.assertEqual(analysis['title'], 'Database Engineers')
        self.assertEqual(analysis['company'], 'Red Drum Holdings')
        self.assertEqual(analysis['location'], 'Annapolis Junction, MD')
        self.assertEqual(analysis['description'], 'We solve complex data challenges and…')
        self.assertEqual(analysis['work'], 'We solve complex data challenges and…')
        self.assertIn('Oracle database', analysis['skills_min'])
        self.assertIn('database design and modeling', analysis['skills_min'])
        self.assertEqual(analysis['pay'], '$185,000–$275,000 / yr')

    def test_text_analysis_returns_job_labels(self):
        text = """The Work
        Build secure cloud services for customers.
        Responsibilities
        Key Responsibilities
        Design and ship reliable APIs.
        Qualifications
        - Bachelor's degree in Computer Science.
        Minimum Skills:
        - Python and SQL.
        Preferred Qualifications:
        - Kubernetes certification.
        Pay Range: $100,000 - $120,000 per year.
        """
        analysis = analyze_job_text(text, 'deterministic')
        self.assertEqual(analysis['description'], 'Build secure cloud services for customers.')
        self.assertEqual(analysis['work'], 'Build secure cloud services for customers.')
        self.assertEqual(analysis['task'], 'Design and ship reliable APIs.')
        self.assertEqual(analysis['qual'], ["Bachelor's degree in Computer Science."])
        self.assertEqual(analysis['skills_min'], ['Python and SQL.'])
        self.assertEqual(analysis['skills_max'], ['Kubernetes certification.'])
        self.assertEqual(analysis['pay'], '$100,000–$120,000 per year')
        for field in ('qual', 'skills_min', 'skills_max'):
            for item in analysis[field]:
                self.assertLess(len(item.split()), 7)
                self.assertFalse(item.startswith('-'))

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
