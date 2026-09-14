"""Explainable job-specific keyword priorities, not employer ATS scores."""
import re


CREDENTIAL = re.compile(r"\b(?:degree|bachelor\w*|master\w*|doctorate|ph\.?d|certif\w*|licen[cs]\w*|clearance|credential\w*)\b", re.I)
MANDATORY = re.compile(r"\b(?:must|required|minimum|mandatory)\b", re.I)


def rank_job_skills(analysis: dict) -> dict:
    groups = {key: {} for key in ('credentials', 'qualifications_min', 'preferred_max')}
    requirements = analysis.get('requirements', [])
    records = [(item['text'], item['kind']) for item in requirements
               if item['kind'] in ('required', 'preferred')]
    if not records:
        records = [(text, kind) for field, kind in
                   (('qual', 'required'), ('skills_min', 'required'), ('skills_max', 'preferred'))
                   for text in analysis.get(field, [])]
    names = [item['name'] for item in analysis.get('skills', []) if item.get('name')]
    for text, kind in records:
        credential = bool(CREDENTIAL.search(text))
        category = 'credentials' if credential else 'preferred_max' if kind == 'preferred' else 'qualifications_min'
        # Credentials retain their complete requirement, including alternatives
        # and minimum levels. Unknown domain skills also retain source wording.
        matched = [name for name in names if re.search(r'(?<!\w)' + re.escape(name) + r'(?!\w)', text, re.I)]
        keywords = [text] if credential or not matched else matched
        for name in keywords:
            key = name.casefold()
            entry = groups[category].setdefault(key, {'skill': name, 'priority': 0, 'rank': 0,
                                                      'requirement': kind, 'evidence': []})
            base = 40 if kind == 'preferred' else 90 if MANDATORY.search(text) else 80
            entry['priority'] = max(entry['priority'], base)
            if kind == 'required':
                entry['requirement'] = 'required'
            if text not in entry['evidence']:
                entry['evidence'].append(text)
    ranked = {}
    dictionary = {}
    for category, entries in groups.items():
        values = list(entries.values())
        for entry in values:
            entry['priority'] = min(100, entry['priority'] + min(9, len(entry['evidence']) - 1))
        values.sort(key=lambda entry: -entry['priority'])
        values = values[:6]
        for rank, entry in enumerate(values, 1):
            entry['rank'] = rank
            key = entry['skill'].casefold()
            aggregate = dictionary.setdefault(key, {'skill': entry['skill'], 'priority': 0, 'rank': 0,
                                                    'category_ranks': {}})
            aggregate['priority'] = max(aggregate['priority'], entry['priority'])
            aggregate['category_ranks'][category] = rank
        ranked[category] = values
    ordered = sorted(dictionary.values(), key=lambda entry: -entry['priority'])
    for rank, entry in enumerate(ordered, 1):
        entry['rank'] = rank
    return {'ranked_categories': ranked,
            'ats_keywords': {entry['skill']: entry['rank'] for entry in ordered}}
