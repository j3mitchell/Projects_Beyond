"""Verified Stripe subscription events for J.I. Systems memberships."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import httpx
import stripe
from fastapi import APIRouter, HTTPException, Request

router = APIRouter()


def _required(name: str) -> str:
    """Read a private server setting and fail closed when it is absent."""
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required server setting: {name}")
    return value


def _headers(prefer: str = "return=minimal") -> dict[str, str]:
    """Build server-only Supabase headers; never send this key to a browser."""
    secret = _required("SUPABASE_SECRET_KEY")
    return {
        "apikey": secret,
        "Authorization": f"Bearer {secret}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


async def _supabase(
    method: str,
    table: str,
    *,
    params: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    prefer: str = "return=minimal",
) -> httpx.Response:
    """Call one Supabase table through its protected Data API."""
    url = f"{_required('SUPABASE_URL').rstrip('/')}/rest/v1/{table}"

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.request(
            method,
            url,
            headers=_headers(prefer),
            params=params,
            json=body,
        )

    response.raise_for_status()
    return response


def _iso_time(unix_seconds: int | None) -> str | None:
    """Convert a Stripe Unix timestamp into a Supabase timestamp."""
    if not unix_seconds:
        return None

    return datetime.fromtimestamp(
        unix_seconds,
        tz=timezone.utc,
    ).isoformat()


def _status(value: str | None) -> str:
    """Map Stripe's detailed states into J.I. Systems membership states."""
    return {
        "active": "active",
        "trialing": "trialing",
        "past_due": "past_due",
        "unpaid": "past_due",
        "paused": "paused",
        "canceled": "canceled",
        "incomplete_expired": "canceled",
    }.get(value or "", "past_due")


def _plan(stripe_object: dict[str, Any]) -> tuple[str, str]:
    """Accept plan identity only from trusted Stripe metadata."""
    metadata = stripe_object.get("metadata") or {}

    plan_slug = str(metadata.get("plan_slug", "")).lower()
    billing_period = str(metadata.get("billing_period", "")).lower()

    if plan_slug not in {"spark", "surge", "apex"}:
        raise ValueError("Missing valid plan_slug metadata")

    if billing_period not in {"monthly", "annual"}:
        raise ValueError("Missing valid billing_period metadata")

    return plan_slug, billing_period


async def _event_exists(event_id: str) -> bool:
    """Detect retries so repeated Stripe deliveries remain harmless."""
    response = await _supabase(
        "GET",
        "stripe_webhook_events",
        params={
            "stripe_event_id": f"eq.{event_id}",
            "select": "stripe_event_id",
            "limit": "1",
        },
    )

    return bool(response.json())


async def _remember(event: dict[str, Any]) -> None:
    """Write a successfully processed event to the private audit ledger."""
    await _supabase(
        "POST",
        "stripe_webhook_events",
        body={
            "stripe_event_id": event["id"],
            "event_type": event["type"],
        },
    )


async def _provision(session: dict[str, Any]) -> None:
    """Upgrade the authenticated Supabase user after completed checkout."""
    user_id = str(session.get("client_reference_id", ""))

    UUID(user_id)

    plan_slug, billing_period = _plan(session)

    await _supabase(
        "POST",
        "memberships",
        params={
            "on_conflict": "user_id",
        },
        prefer="resolution=merge-duplicates,return=minimal",
        body={
            "user_id": user_id,
            "plan_slug": plan_slug,
            "status": "active",
            "billing_period": billing_period,
            "stripe_customer_id": session.get("customer"),
            "stripe_subscription_id": session.get("subscription"),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )


async def _sync_subscription(
    subscription: dict[str, Any],
) -> None:
    """Synchronize renewal, pause, and cancellation state."""
    subscription_id = str(subscription.get("id", ""))

    if not subscription_id:
        raise ValueError("Missing Stripe subscription ID")

    body: dict[str, Any] = {
        "status": _status(subscription.get("status")),
        "stripe_customer_id": subscription.get("customer"),
        "current_period_ends_at": _iso_time(
            subscription.get("current_period_end")
        ),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        plan_slug, billing_period = _plan(subscription)

        body.update(
            {
                "plan_slug": plan_slug,
                "billing_period": billing_period,
            }
        )

    except ValueError:
        # Checkout already saved the plan; later events may omit metadata.
        pass

    await _supabase(
        "PATCH",
        "memberships",
        params={
            "stripe_subscription_id": f"eq.{subscription_id}",
        },
        body=body,
    )


async def _sync_invoice(
    invoice: dict[str, Any],
    status: str,
) -> None:
    """Continue or restrict access after a recurring invoice result."""
    subscription_id = invoice.get("subscription")

    if not subscription_id:
        parent = invoice.get("parent") or {}

        subscription_id = (
            parent.get("subscription_details") or {}
        ).get("subscription")

    if not subscription_id:
        return

    await _supabase(
        "PATCH",
        "memberships",
        params={
            "stripe_subscription_id": f"eq.{subscription_id}",
        },
        body={
            "status": status,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )


def _is_provisionable_checkout(
    session: dict[str, Any],
) -> bool:
    """
    Return True only when a checkout session contains the application data
    required to provision a real J.I. Systems membership.

    Stripe-generated generic test events often omit these values.
    Those events should still be acknowledged successfully without creating
    or modifying a membership.
    """
    client_reference_id = session.get("client_reference_id")
    metadata = session.get("metadata") or {}

    return bool(
        client_reference_id
        and metadata.get("plan_slug")
        and metadata.get("billing_period")
    )


@router.post(
    "/v1/webhooks/stripe",
    include_in_schema=False,
)
async def receive_stripe_webhook(
    request: Request,
) -> dict[str, bool]:
    """
    Verify Stripe's signature, update Supabase, and acknowledge delivery.
    """
    try:
        event = stripe.Webhook.construct_event(
            await request.body(),
            request.headers.get("stripe-signature", ""),
            _required("STRIPE_WEBHOOK_SECRET"),
        )

    except (
        ValueError,
        stripe.error.SignatureVerificationError,
    ) as error:
        raise HTTPException(
            status_code=400,
            detail="Invalid Stripe webhook",
        ) from error

    event_data = event.to_dict_recursive()

    try:
        if await _event_exists(event_data["id"]):
            return {"received": True}

        event_type = event_data["type"]
        stripe_object = event_data["data"]["object"]

        if event_type == "checkout.session.completed":
            if _is_provisionable_checkout(stripe_object):
                await _provision(stripe_object)

        elif event_type in {
            "customer.subscription.created",
            "customer.subscription.updated",
            "customer.subscription.deleted",
        }:
            await _sync_subscription(stripe_object)

        elif event_type == "invoice.paid":
            await _sync_invoice(
                stripe_object,
                "active",
            )

        elif event_type == "invoice.payment_failed":
            await _sync_invoice(
                stripe_object,
                "past_due",
            )

        await _remember(event_data)

    except (
        httpx.HTTPError,
        RuntimeError,
        ValueError,
        KeyError,
    ) as error:
        # A 500 response makes Stripe retry rather than lose an access change.
        raise HTTPException(
            status_code=500,
            detail="Webhook processing failed",
        ) from error

    return {"received": True}