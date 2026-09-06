from __future__ import annotations

import re
from typing import Any

# Canonical organization names for common resume/employment acronyms.
# The parser preserves the text exactly as written on the resume; these names
# are used only for internal classification and matching.
ORGANIZATION_ALIASES: dict[str, str] = {
    # U.S. federal departments and agencies
    "DHS": "Department of Homeland Security",
    "DOD": "Department of Defense",
    "DOE": "Department of Energy",
    "DOJ": "Department of Justice",
    "DOL": "Department of Labor",
    "DOT": "Department of Transportation",
    "HHS": "Department of Health and Human Services",
    "HUD": "Department of Housing and Urban Development",
    "VA": "Department of Veterans Affairs",
    "USDA": "United States Department of Agriculture",
    "EPA": "Environmental Protection Agency",
    "FBI": "Federal Bureau of Investigation",
    "CIA": "Central Intelligence Agency",
    "NSA": "National Security Agency",
    "DIA": "Defense Intelligence Agency",
    "DISA": "Defense Information Systems Agency",
    "GSA": "General Services Administration",
    "SSA": "Social Security Administration",
    "IRS": "Internal Revenue Service",
    "FAA": "Federal Aviation Administration",
    "TSA": "Transportation Security Administration",
    "CBP": "U.S. Customs and Border Protection",
    "USCIS": "U.S. Citizenship and Immigration Services",
    "FEMA": "Federal Emergency Management Agency",
    "NASA": "National Aeronautics and Space Administration",
    "NIH": "National Institutes of Health",
    "CDC": "Centers for Disease Control and Prevention",
    "NIST": "National Institute of Standards and Technology",
    "SEC": "Securities and Exchange Commission",
    "FCC": "Federal Communications Commission",
    "FTC": "Federal Trade Commission",
    "FDIC": "Federal Deposit Insurance Corporation",
    "OPM": "Office of Personnel Management",
    "OMB": "Office of Management and Budget",
    "GAO": "Government Accountability Office",
    "USAF": "United States Air Force",
    "USN": "United States Navy",
    "USMC": "United States Marine Corps",
    "USACE": "United States Army Corps of Engineers",

    # Common technology/company abbreviations seen in resumes
    "AWS": "Amazon Web Services",
    "IBM": "International Business Machines",
    "HP": "Hewlett-Packard",
    "HPE": "Hewlett Packard Enterprise",
    "GM": "General Motors",
    "GE": "General Electric",
    "PwC": "PricewaterhouseCoopers",
}

# Acronyms that are much more likely to be job titles, credentials, or skills
# than organization names when they appear alone.
NON_ORG_ACRONYMS = {
    "CEO", "CFO", "CIO", "CTO", "COO", "CMO", "CISO", "VP", "SVP", "EVP",
    "DBA", "PM", "BA", "QA", "RN", "MD", "CPA", "PMP", "PE", "EIT",
    "SQL", "API", "ETL", "ERP", "CRM", "SaaS", "PaaS", "IaaS",
}


def _acronym_key(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", value).upper()


def _reasonable_long_name(value: str) -> bool:
    words = re.findall(r"[A-Za-z0-9&'-]+", value)
    return 2 <= len(words) <= 14 and len(value.strip()) <= 140


def organization_alias_match(value: str) -> dict[str, Any]:
    """Resolve known or explicitly defined organization acronyms.

    Examples:
      DHS -> Department of Homeland Security
      DHS: Department of Homeland Security -> Department of Homeland Security
      Department of Homeland Security (DHS) -> Department of Homeland Security

    Returned canonical names are internal metadata only; callers can preserve
    the original resume spelling for display/output.
    """
    clean = re.sub(r"\s+", " ", value).strip()
    if not clean:
        return {"valid": False, "confidence": 0.0, "source": "empty"}

    key = _acronym_key(clean)
    for alias, canonical in ORGANIZATION_ALIASES.items():
        if key == _acronym_key(alias):
            return {
                "valid": True,
                "confidence": 0.99,
                "source": "known-alias",
                "alias": clean,
                "canonical": canonical,
            }

    # Explicit resume definition: DHS: Department of Homeland Security
    match = re.match(r"^([A-Za-z][A-Za-z0-9.&/-]{1,11})\s*[:=-]\s*(.+)$", clean)
    if match:
        alias, long_name = match.groups()
        alias_key = _acronym_key(alias)
        if 2 <= len(alias_key) <= 10 and alias_key not in {_acronym_key(x) for x in NON_ORG_ACRONYMS} and _reasonable_long_name(long_name):
            return {
                "valid": True,
                "confidence": 0.98,
                "source": "explicit-alias",
                "alias": alias,
                "canonical": long_name.strip(),
            }

    # Explicit resume definition: Department of Homeland Security (DHS)
    match = re.match(r"^(.+?)\s*\(([A-Za-z][A-Za-z0-9.&/-]{1,11})\)\s*$", clean)
    if match:
        long_name, alias = match.groups()
        alias_key = _acronym_key(alias)
        if 2 <= len(alias_key) <= 10 and alias_key not in {_acronym_key(x) for x in NON_ORG_ACRONYMS} and _reasonable_long_name(long_name):
            return {
                "valid": True,
                "confidence": 0.98,
                "source": "explicit-alias",
                "alias": alias,
                "canonical": long_name.strip(),
            }

    # Unknown all-caps acronym: treat as a plausible organization, but at a
    # lower confidence than a known/explicit alias. Position/context still has
    # to support selecting it as the company.
    raw_acronym = re.sub(r"[^A-Za-z0-9]", "", clean)
    upper_key = raw_acronym.upper()
    non_org_keys = {_acronym_key(x) for x in NON_ORG_ACRONYMS}
    if (
        2 <= len(raw_acronym) <= 8
        and raw_acronym == raw_acronym.upper()
        and upper_key not in non_org_keys
        and any(char.isalpha() for char in raw_acronym)
    ):
        return {
            "valid": True,
            "confidence": 0.72,
            "source": "unresolved-acronym",
            "alias": clean,
            "canonical": clean,
        }

    return {"valid": False, "confidence": 0.0, "source": "no-alias-match"}
