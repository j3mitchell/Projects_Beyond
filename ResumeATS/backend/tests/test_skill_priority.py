import unittest

from app.skill_priority import rank_job_skills


class SkillPriorityTests(unittest.TestCase):
    def test_ranks_categories_and_preserves_cross_category_keywords(self):
        result = rank_job_skills({'requirements': [
            {'kind': 'required', 'text': 'SQL experience.'},
            {'kind': 'required', 'text': 'Python is required.'},
            {'kind': 'required', 'text': 'Python services experience.'},
            {'kind': 'required', 'text': 'Bachelor degree or equivalent experience.'},
            {'kind': 'preferred', 'text': 'Python is preferred.'},
            {'kind': 'preferred', 'text': 'AWS certification preferred.'},
            {'kind': 'responsibility', 'text': 'Manage payroll.'},
        ], 'skills': [{'name': 'Python'}, {'name': 'SQL'}]})
        minimum = result['ranked_categories']['qualifications_min']
        self.assertEqual([entry['skill'] for entry in minimum], ['Python', 'SQL'])
        self.assertEqual([entry['rank'] for entry in minimum], [1, 2])
        self.assertEqual(minimum[0]['priority'], 91)
        credentials = result['ranked_categories']['credentials']
        self.assertEqual(credentials[0]['skill'], 'Bachelor degree or equivalent experience.')
        self.assertEqual(credentials[1]['requirement'], 'preferred')
        self.assertEqual(result['ats_keywords']['Python'], 1)
        self.assertEqual(result['ranked_categories']['preferred_max'][0]['skill'], 'Python')
        self.assertNotIn('Manage payroll.', result['ats_keywords'])

    def test_empty_and_legacy_inputs(self):
        self.assertEqual(rank_job_skills({})['ats_keywords'], {})
        result = rank_job_skills({'skills_min': ['Unknown specialized skill'], 'skills_max': ['Another skill']})
        self.assertIn('Unknown specialized skill', result['ats_keywords'])
        self.assertEqual(result['ranked_categories']['preferred_max'][0]['rank'], 1)

    def test_each_category_keeps_only_six_and_dictionary_is_numeric(self):
        result = rank_job_skills({'skills_min': [f'Skill {i}' for i in range(10)],
                                 'skills_max': [f'Preferred {i}' for i in range(9)],
                                 'qual': [f'Certification {i}' for i in range(8)]})
        self.assertTrue(all(len(items) == 6 for items in result['ranked_categories'].values()))
        self.assertEqual(len(result['ats_keywords']), 18)
        self.assertTrue(all(isinstance(value, int) for value in result['ats_keywords'].values()))

    def test_skill_names_use_word_boundaries_and_stable_ties(self):
        result = rank_job_skills({'requirements': [
            {'kind': 'required', 'text': 'JavaScript development'},
            {'kind': 'required', 'text': 'Python development'},
        ], 'skills': [{'name': 'Java'}, {'name': 'Python'}]})
        self.assertNotIn('Java', result['ats_keywords'])
        self.assertEqual(list(result['ats_keywords']), ['JavaScript development', 'Python'])
