"""InMail Pipeline MCP server (FastMCP)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import aiohttp
from dotenv import load_dotenv
from fastmcp import FastMCP

from airtable import (
    fetch_leads_batch,
    fetch_profiles_by_ids,
    profiles_to_payload,
    record_to_lead_row,
    stamp_record_ids,
)
from notion import create_inmail_shortlist_page, update_shortlist_candidate_status

load_dotenv()

mcp = FastMCP("InMail Pipeline")


_EN_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


def _default_status_date() -> str:
    now = datetime.now(timezone.utc)
    return f"{_EN_MONTHS[now.month - 1]} {now.year}"


@mcp.tool
async def pull_and_stamp_leads(batch_size: int = 500) -> dict[str, Any]:
    """Pull fresh InMail leads from Airtable (AI Score 50–70, key fields empty), stamp
    InMail Evaluated At immediately in parallel batches, return lightweight rows plus stamp summary."""
    if batch_size < 1:
        raise ValueError("batch_size must be at least 1")

    timeout = aiohttp.ClientTimeout(total=120)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        raw = await fetch_leads_batch(session, batch_size)

    leads = [record_to_lead_row(r) for r in raw]
    ids = [r["id"] for r in leads if r.get("id")]

    if not ids:
        stamp = await stamp_record_ids([])
        return {"leads": [], "stamp": stamp}

    stamp = await stamp_record_ids(ids)
    return {"leads": leads, "stamp": stamp}


@mcp.tool
async def get_lead_profiles(record_ids: list[str]) -> dict[str, Any]:
    """Fetch Raw Profile Data and Posts Content for up to 50 Airtable record IDs."""
    if len(record_ids) > 50:
        raise ValueError("record_ids must contain at most 50 items")
    if not record_ids:
        return {"records": []}

    timeout = aiohttp.ClientTimeout(total=120)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        recs = await fetch_profiles_by_ids(session, record_ids)

    by_id = {r.get("id"): r for r in recs}
    ordered_recs = [by_id[rid] for rid in record_ids if rid in by_id]
    missing = [rid for rid in record_ids if rid not in by_id]
    flat = profiles_to_payload(ordered_recs)
    out: dict[str, Any] = {"records": flat}
    if missing:
        out["missing_record_ids"] = missing
    return out


@mcp.tool
async def stamp_leads_evaluated(
    record_ids: list[str],
    timestamp: str | None = None,
) -> dict[str, Any]:
    """Stamp InMail Evaluated At for the given record IDs (parallel batches of 10)."""
    return await stamp_record_ids(record_ids, timestamp)


@mcp.tool
def create_notion_shortlist(
    title: str,
    run_summary: str,
    candidates: list[dict[str, Any]],
) -> dict[str, Any]:
    """Create an InMail shortlist page under Guy's Operating System (omits Not a fit). Returns the page URL."""
    url = create_inmail_shortlist_page(title, run_summary, candidates)
    return {"url": url}


@mcp.tool
def update_notion_shortlist_status(
    page_id: str,
    candidate_name: str,
    status: str,
    date: str | None = None,
) -> dict[str, Any]:
    """Update a candidate heading on a shortlist page (strikethrough + status emoji). Name must match Tool 4 exactly."""
    date_s = date if date is not None else _default_status_date()
    return update_shortlist_candidate_status(page_id, candidate_name, status, date_s)


if __name__ == "__main__":
    mcp.run()
