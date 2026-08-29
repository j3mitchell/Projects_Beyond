"""Shared J.I. Systems backend endpoints.

This service receives trusted server-to-server notifications. Private Stripe
and Supabase credentials must be configured in Google Secret Manager and Cloud
Run, never in browser code.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import requests
import stripe
from fastapi import FastAPI, HTTPException, Request


app = FastAPI(title="J.I. Systems Platform API", version="1.0.0")


def required_setting(name: str) -> str:
    """Read a required server secret and fail closed when it is missing."""
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required server setting: {name}")
    return value


def supabase_headers() -> dict[str, str]:
    """Create private headers for Supabase's server-only Data API access."""
    secret = required_setting("SUPABASE_SECRET_KEY")
    return {
        "apikey": secret,
        "Authorization": f"Bearer {secret}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


def supabase_request(method: str, table: str, *, params: dict[str, str] | None = None,
                     json: dict[str, Any] | None = None) -> requests.Response:
    """Make one authenticated request to a Supabase table."""
    base_url = required_setting("SUPABASE_URL").rstrip("/")
    response = requests.request(
        method,
        f"{base_url}/rest/v1/{table}",
        headers=supabase_headers(),
        params=params,
        json=json,
        timeout=15,
    )
    response.raise_for_status()
    return response


def utc_timestamp(unix_seconds: int | None) -> str | None:
    """Convert Stripe's Unix timestamp into the format Supabase stores."""
    if not unix_seconds:
        return None
    return datetime.fromtimestamp(unix_seconds, tz=timezone.utc).isoformat()


def stripe_status(value: str | None) -> str:
    """Translate Stripe subscription states into the database's smaller list."""
    return {
        "active": "active",
        "trialing": "trialing",
        "past_due": "past_due",
        "unpaid": "past_due",
        "paused": "paused",
        "canceled": "canceled",
        "incomplete_expired": "canceled",
    }.get(value or "", "past_due")


def valid_plan_metadata(obj: dict[str, Any]) -> tuple[str, str]:
    """Read the plan identity that was securely attached to the Stripe link."""
    metadata = obj.get("metadata") or {}
    plan_slug = str(metadata.get("plan_slug", "")).lower()
    billing_period = str(metadata.get("billing_period", "")).lower()
    if plan_slug not in {"spark", "surge", "apex"}:
        raise ValueError("Stripe object is missing valid plan_slug metadata")
    if billing_period not in {"monthly", "annual"}:
        raise ValueError("Stripe object is missing valid billing_period metadata")
    return plan_slug, billing_period


def provision_checkout(session: dict[str, Any]) -> None:
    """Activate the Supabase account associated with a completed checkout."""
    user_id = str(session.get("client_reference_id", ""))
    UUID(user_id)  # Reject random browser references and malformed identities.
    plan_slug, billing_period = valid_plan_metadata(session)
    subscription_id = session.get("subscription")

    payload = {
        "user_id": user_id,
        "plan_slug": plan_slug,
        "status": "active",
        "billing_period": billing_period,
        "stripe_customer_id": session.get("customer"),
        "stripe_subscription_id": subscription_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    supabase_request(
        "POST",
        "memberships",
        params={"on_conflict": "user_id"},
        json=payload,
    )


def update_subscription(subscription: dict[str, Any]) -> None:
    """Keep renewal, cancellation, and billing-period state synchronized."""
    subscription_id = str(subscription.get("id", ""))
    if not subscription_id:
        raise ValueError("Stripe subscription event has no subscription ID")

    payload: dict[str, Any] = {
        "status": stripe_status(subscription.get("status")),
        "stripe_customer_id": subscription.get("customer"),
        "current_period_ends_at": utc_timestamp(subscription.get("current_period_end")),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        plan_slug, billing_period = valid_plan_metadata(subscription)
        payload.update({"plan_slug": plan_slug, "billing_period": billing_period})
    except ValueError:
        # Checkout already stored the plan. Later renewal events may omit metadata.
        pass

    supabase_request(
        "PATCH",
        "memberships",
        params={"stripe_subscription_id": f"eq.{subscription_id}"},
        json=payload,
    )


def mark_invoice_state(invoice: dict[str, Any], status: str) -> None:
    """Record whether the most recent recurring invoice succeeded or failed."""
    subscription_id = invoice.get("subscription")
    if not subscription_id:
        parent = invoice.get("parent") or {}
        subscription_id = (parent.get("subscription_details") or {}).get("subscription")
    if not subscription_id:
        return
    supabase_request(
        "PATCH",
        "memberships",
        params={"stripe_subscription_id": f"eq.{subscription_id}"},
        json={"status": status, "updated_at": datetime.now(timezone.utc).isoformat()},
    )


def event_was_processed(event_id: str) -> bool:
    """Check the event ledger so Stripe retries are safe and idempotent."""
    response = supabase_request(
        "GET",
        "stripe_webhook_events",
        params={"stripe_event_id": f"eq.{event_id}", "select": "stripe_event_id", "limit": "1"},
    )
    return bool(response.json())


def remember_event(event: dict[str, Any]) -> None:
    """Save a successfully processed Stripe event in the audit ledger."""
    supabase_request(
        "POST",
        "stripe_webhook_events",
        json={"stripe_event_id": event["id"], "event_type": event["type"]},
    )


@app.get("/health")
def health() -> dict[str, str]:
    """Let Cloud Run and uptime checks confirm that the service is running."""
    return {"status": "ok"}


@app.post("/v1/webhooks/stripe")
async def stripe_webhook(request: Request) -> dict[str, bool]:
    """Verify and process Stripe subscription lifecycle notifications."""
    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(
            payload,
            signature,
            required_setting("STRIPE_WEBHOOK_SECRET"),
        )
    except (ValueError, stripe.error.SignatureVerificationError) as error:
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook") from error

    event_dict = event.to_dict_recursive()
    if event_was_processed(event_dict["id"]):
        return {"received": True}

    event_type = event_dict["type"]
    stripe_object = event_dict["data"]["object"]
    try:
        if event_type == "checkout.session.completed":
            provision_checkout(stripe_object)
        elif event_type in {"customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"}:
            update_subscription(stripe_object)
        elif event_type == "invoice.paid":
            mark_invoice_state(stripe_object, "active")
        elif event_type == "invoice.payment_failed":
            mark_invoice_state(stripe_object, "past_due")
        remember_event(event_dict)
    except (requests.RequestException, RuntimeError, ValueError) as error:
        # A non-2xx response tells Stripe to retry rather than silently losing access changes.
        raise HTTPException(status_code=500, detail="Webhook processing failed") from error

    return {"received": True}
