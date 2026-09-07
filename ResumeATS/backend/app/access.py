"""Verify platform identity and ResumeATS entitlement using the user's RLS scope."""
import os
from datetime import datetime, timezone

import requests
from fastapi import Header, HTTPException


PAID_MEMBERSHIP_PLANS = frozenset(
    value.strip().lower()
    for value in os.getenv("RESUMEATS_PAID_PLANS", "spark,surge,apex").split(",")
    if value.strip()
)
ACTIVE_MEMBERSHIP_STATUSES = frozenset({"active", "trialing"})


def _membership_access(url: str, headers: dict[str, str], user_id: str) -> dict:
    """Read the optional membership tier without blocking the free tool path."""
    try:
        response = requests.get(
            f"{url}/rest/v1/memberships",
            headers=headers,
            timeout=10,
            params={
                "user_id": f"eq.{user_id}",
                "select": "plan_slug,status,current_period_ends_at",
                "limit": "1",
            },
        )
        if response.status_code >= 400:
            return {"plan_slug": "origin", "paid_member": False}
        rows = response.json()
        membership = rows[0] if rows else {}
    except (requests.RequestException, ValueError, KeyError, TypeError, IndexError):
        return {"plan_slug": "origin", "paid_member": False}

    plan_slug = str(membership.get("plan_slug") or "origin").strip().lower()
    status = str(membership.get("status") or "").strip().lower()
    paid_member = plan_slug in PAID_MEMBERSHIP_PLANS and status in ACTIVE_MEMBERSHIP_STATUSES
    period_end = membership.get("current_period_ends_at")
    if paid_member and period_end:
        try:
            paid_member = datetime.fromisoformat(str(period_end).replace("Z", "+00:00")) > datetime.now(timezone.utc)
        except (TypeError, ValueError):
            paid_member = False
    return {"plan_slug": plan_slug, "paid_member": paid_member}


def require_access(authorization: str | None = Header(default=None)) -> dict:
    if os.getenv("RESUMEATS_ENV", "development") != "production":
        return {"id": "local-development", "plan_slug": "development", "paid_member": True}
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign in to use ResumeATS.")
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
    if not url or not key:
        raise HTTPException(503, "Platform authentication is not configured.")
    headers = {"apikey": key, "Authorization": authorization}
    try:
        identity = requests.get(f"{url}/auth/v1/user", headers=headers, timeout=10)
        if identity.status_code != 200:
            raise HTTPException(401, "Your session expired. Sign in again.")
        user = identity.json()
        response = requests.get(
            f"{url}/rest/v1/tool_entitlements", headers=headers, timeout=10,
            params={"user_id": f"eq.{user['id']}", "tool_slug": "eq.resumeats",
                    "select": "status,expires_at", "limit": "1"},
        )
        response.raise_for_status()
        rows = response.json()
        entitlement = rows[0] if rows else {}
        expires = entitlement.get("expires_at")
        active = entitlement.get("status") == "active"
        if expires:
            active = active and datetime.fromisoformat(expires.replace("Z", "+00:00")) > datetime.now(timezone.utc)
        if not active:
            raise HTTPException(403, "Your account does not currently include ResumeATS access.")
        membership = _membership_access(url, headers, user["id"])
        return {"id": user["id"], **membership}
    except HTTPException:
        raise
    except (requests.RequestException, ValueError, KeyError, TypeError, IndexError):
        raise HTTPException(503, "Platform access could not be verified. Please try again.")
