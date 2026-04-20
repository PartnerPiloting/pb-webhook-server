"""Airtable REST helpers for the InMail pipeline MCP server."""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import aiohttp

# --- Hardcoded configuration (per product spec) ---
AIRTABLE_BASE_ID = "appXySOLo6V9PfMfa"
AIRTABLE_TABLE_ID = "tbluGVPzz6XYbqtLD"

FIELD_AI_SCORE = "fldZb8o0KXiUdDOga"
FIELD_DATE_CONNECTED = "fldcHqu3sJC66ofLY"
FIELD_NOTES = "fldGXXfljIQlxy70f"
FIELD_INMAIL_EVALUATED_AT = "fldf9hljrTCPnRiV9"
FIELD_RAW_PROFILE = "fldXGwWnJNffmGQAW"
FIELD_POSTS_CONTENT = "fldAIchLIdFjEJUm4"
FIELD_LINKEDIN_URL = "fldwC8NfmL84YoaoT"
FIELD_FIRST_NAME = "fldLmMkRsMzm8f8ix"
FIELD_LAST_NAME = "fldINb0q5ku7KVYen"
FIELD_HEADLINE = "fldUmFykRyJrcyImv"
FIELD_JOB_TITLE = "fldIVZaG0SLfTjMEe"
FIELD_COMPANY = "fldV1tqySH83k5QBe"

LIGHTWEIGHT_FIELDS = [
    FIELD_AI_SCORE,
    FIELD_DATE_CONNECTED,
    FIELD_NOTES,
    FIELD_INMAIL_EVALUATED_AT,
    FIELD_LINKEDIN_URL,
    FIELD_FIRST_NAME,
    FIELD_LAST_NAME,
    FIELD_HEADLINE,
    FIELD_JOB_TITLE,
    FIELD_COMPANY,
]

PROFILE_FIELDS = [FIELD_RAW_PROFILE, FIELD_POSTS_CONTENT]

FILTER_PULL = (
    "AND("
    "{AI Score}>=50,"
    "{AI Score}<=70,"
    '{Date Connected}="",'
    '{Notes}="",'
    '{InMail Evaluated At}=""'
    ")"
)

AIRTABLE_PAGE_SIZE = 100
PATCH_BATCH_SIZE = 10


def _api_key() -> str:
    key = os.environ.get("AIRTABLE_API_KEY", "").strip()
    if not key:
        raise RuntimeError("AIRTABLE_API_KEY is not set")
    return key


def _table_url() -> str:
    return f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{AIRTABLE_TABLE_ID}"


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_api_key()}",
        "Content-Type": "application/json",
    }


def _normalize_iso_timestamp(ts: str | None) -> str:
    if ts:
        return ts
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _field_value(fields: dict[str, Any], field_id: str) -> Any:
    return fields.get(field_id)


def record_to_lead_row(rec: dict[str, Any]) -> dict[str, Any]:
    fid = rec.get("id", "")
    fields = rec.get("fields") or {}
    first = (_field_value(fields, FIELD_FIRST_NAME) or "") or ""
    last = (_field_value(fields, FIELD_LAST_NAME) or "") or ""
    first_s, last_s = str(first).strip(), str(last).strip()
    name = f"{first_s} {last_s}".strip()
    score = _field_value(fields, FIELD_AI_SCORE)
    try:
        ai_score = int(score) if score is not None else 0
    except (TypeError, ValueError):
        ai_score = 0
    return {
        "id": fid,
        "name": name,
        "first_name": first_s,
        "last_name": last_s,
        "headline": (_field_value(fields, FIELD_HEADLINE) or "") or "",
        "job_title": (_field_value(fields, FIELD_JOB_TITLE) or "") or "",
        "company": (_field_value(fields, FIELD_COMPANY) or "") or "",
        "linkedin_url": (_field_value(fields, FIELD_LINKEDIN_URL) or "") or "",
        "ai_score": ai_score,
    }


async def fetch_leads_batch(
    session: aiohttp.ClientSession,
    batch_size: int,
) -> list[dict[str, Any]]:
    """Pull up to batch_size records matching FILTER_PULL, lightweight fields only."""
    out: list[dict[str, Any]] = []
    offset: str | None = None
    url = _table_url()

    while len(out) < batch_size:
        params: list[tuple[str, str]] = [
            ("filterByFormula", FILTER_PULL),
            ("pageSize", str(min(AIRTABLE_PAGE_SIZE, batch_size - len(out)))),
        ]
        for fid in LIGHTWEIGHT_FIELDS:
            params.append(("fields[]", fid))
        params.append(("sort[0][field]", "AI Score"))
        params.append(("sort[0][direction]", "desc"))
        if offset:
            params.append(("offset", offset))

        qs = urlencode(params)
        full_url = f"{url}?{qs}"
        async with session.get(full_url, headers=_headers()) as resp:
            body = await resp.text()
            if resp.status >= 400:
                raise RuntimeError(f"Airtable GET failed {resp.status}: {body[:2000]}")
            data = json.loads(body)
        for rec in data.get("records") or []:
            out.append(rec)
            if len(out) >= batch_size:
                return out
        offset = data.get("offset")
        if not offset:
            break
    return out


def _chunks(items: list[str], size: int) -> list[list[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


async def _patch_batch(
    session: aiohttp.ClientSession,
    url: str,
    record_chunk: list[dict[str, Any]],
) -> tuple[list[str], str | None]:
    """Returns (successful_ids, error_message)."""
    payload = {"records": record_chunk}
    async with session.patch(url, headers=_headers(), json=payload) as resp:
        body = await resp.text()
        if resp.status < 400:
            ids = [r["id"] for r in record_chunk]
            return ids, None
        return [], f"{resp.status}: {body[:2000]}"


async def stamp_record_ids(
    record_ids: list[str],
    timestamp: str | None = None,
) -> dict[str, Any]:
    """
    PATCH InMail Evaluated At for all record IDs in parallel batches of 10.
    Returns summary with successes, failures, and failed_batches detail.
    """
    stamp = _normalize_iso_timestamp(timestamp)
    url = _table_url()
    batches = _chunks(record_ids, PATCH_BATCH_SIZE)
    records_payloads: list[list[dict[str, Any]]] = [
        [
            {"id": rid, "fields": {FIELD_INMAIL_EVALUATED_AT: stamp}}
            for rid in chunk
        ]
        for chunk in batches
    ]

    succeeded: list[str] = []
    failed: list[dict[str, Any]] = []

    timeout = aiohttp.ClientTimeout(total=120)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        tasks = [
            _patch_batch(session, url, chunk) for chunk in records_payloads
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for chunk, result in zip(records_payloads, results):
            if isinstance(result, Exception):
                ids = [r["id"] for r in chunk]
                failed.append(
                    {
                        "record_ids": ids,
                        "error": str(result),
                    }
                )
                continue
            ids_ok, err = result
            if err is None:
                succeeded.extend(ids_ok)
            else:
                failed.append(
                    {
                        "record_ids": [r["id"] for r in chunk],
                        "error": err,
                    }
                )

    return {
        "success_count": len(succeeded),
        "failed_count": sum(len(b["record_ids"]) for b in failed),
        "failed_batches": failed,
    }


def _record_id_filter_formula(record_ids: list[str]) -> str:
    parts = [f"RECORD_ID()='{rid}'" for rid in record_ids]
    return "OR(" + ",".join(parts) + ")"


async def fetch_profiles_by_ids(
    session: aiohttp.ClientSession,
    record_ids: list[str],
) -> list[dict[str, Any]]:
    """Fetch Raw Profile and Posts Content for specific record IDs (single formula OR)."""
    if not record_ids:
        return []
    params: list[tuple[str, str]] = [
        ("filterByFormula", _record_id_filter_formula(record_ids)),
        ("pageSize", str(min(100, len(record_ids)))),
    ]
    for fid in [FIELD_RAW_PROFILE, FIELD_POSTS_CONTENT]:
        params.append(("fields[]", fid))

    qs = urlencode(params)
    full_url = f"{_table_url()}?{qs}"
    async with session.get(full_url, headers=_headers()) as resp:
        body = await resp.text()
        if resp.status >= 400:
            raise RuntimeError(f"Airtable GET profiles failed {resp.status}: {body[:2000]}")
        data = json.loads(body)
    return list(data.get("records") or [])


def profiles_to_payload(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for rec in records:
        fields = rec.get("fields") or {}
        out.append(
            {
                "id": rec.get("id", ""),
                "raw_profile": _field_value(fields, FIELD_RAW_PROFILE),
                "posts_content": _field_value(fields, FIELD_POSTS_CONTENT),
            }
        )
    return out
