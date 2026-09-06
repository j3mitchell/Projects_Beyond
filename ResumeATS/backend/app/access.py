"""Verify platform identity and ResumeATS entitlement using the user's RLS scope."""
import os
from datetime import datetime, timezone

import requests
from fastapi import Header, HTTPException


def require_access(authorization: str | None = Header(default=None)) -> dict:
    if os.getenv("RESUMEATS_ENV", "development") != "production":
        return {"id": "local-development"}
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
        return {"id": user["id"]}
    except HTTPException:
        raise
    except (requests.RequestException, ValueError, KeyError, TypeError, IndexError):
        raise HTTPException(503, "Platform access could not be verified. Please try again.")
