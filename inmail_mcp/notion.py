"""Notion API helpers for InMail shortlist pages."""

from __future__ import annotations

import os
import re
from typing import Any

from notion_client import Client

NOTION_PARENT_PAGE_ID = "34647cb5-1305-81d2-a55b-d86b3083de24"

VERDICT_ORDER = ("Strong CC", "Good CC", "Borderline")

STATUS_EMOJI = {
    "SENT": "✅",
    "SKIPPED": "⏭️",
    "BORDERLINE": "⚠️",
}


def _client() -> Client:
    key = os.environ.get("NOTION_API_KEY", "").strip()
    if not key:
        raise RuntimeError("NOTION_API_KEY is not set")
    return Client(auth=key)


def _rich_paragraph(text: str) -> dict[str, Any]:
    return {
        "object": "block",
        "type": "paragraph",
        "paragraph": {
            "rich_text": [{"type": "text", "text": {"content": text[:2000]}}],
        },
    }


def _rich_heading_2(text: str) -> dict[str, Any]:
    return {
        "object": "block",
        "type": "heading_2",
        "heading_2": {
            "rich_text": [{"type": "text", "text": {"content": text[:2000]}}],
        },
    }


def _rich_heading_3(text: str) -> dict[str, Any]:
    return {
        "object": "block",
        "type": "heading_3",
        "heading_3": {
            "rich_text": [{"type": "text", "text": {"content": text[:2000]}}],
        },
    }


def _append_chunks(notion: Client, page_id: str, blocks: list[dict[str, Any]]) -> None:
    chunk = 100
    for i in range(0, len(blocks), chunk):
        notion.blocks.children.append(page_id, children=blocks[i : i + chunk])


def _plain_from_rich(rich: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for seg in rich or []:
        if seg.get("type") == "text":
            parts.append(seg.get("text", {}).get("content") or "")
        elif seg.get("type") == "mention":
            plain = seg.get("plain_text")
            if plain:
                parts.append(plain)
    return "".join(parts)


def create_inmail_shortlist_page(
    title: str,
    run_summary: str,
    candidates: list[dict[str, Any]],
) -> str:
    """
    Create a child page under Guy's Operating System with grouped candidate sections.
    Omits candidates whose verdict is 'Not a fit'. Returns the public Notion URL.
    """
    notion = _client()
    filtered = [c for c in candidates if (c.get("verdict") or "") != "Not a fit"]

    by_verdict: dict[str, list[dict[str, Any]]] = {v: [] for v in VERDICT_ORDER}
    for c in filtered:
        v = c.get("verdict") or ""
        if v in by_verdict:
            by_verdict[v].append(c)

    for v in VERDICT_ORDER:
        by_verdict[v].sort(key=lambda x: int(x.get("score") or 0), reverse=True)

    blocks: list[dict[str, Any]] = [_rich_paragraph(run_summary)]

    n = 0
    for group in VERDICT_ORDER:
        group_list = by_verdict[group]
        if not group_list:
            continue
        blocks.append(_rich_heading_2(group))
        for c in group_list:
            n += 1
            name = (c.get("name") or "").strip()
            score = int(c.get("score") or 0)
            linkedin = (c.get("linkedin_url") or "").strip()
            reason = (c.get("reason") or "").strip()
            hook = (c.get("best_hook") or "").strip()
            tier = (c.get("ai_tier") or "").strip()
            flags = c.get("red_flags") or []

            heading = f"#{n} {name} | Score: {score}/10"
            blocks.append(_rich_heading_3(heading))
            if linkedin:
                blocks.append(_rich_paragraph(f"LinkedIn: {linkedin}"))
            blocks.append(_rich_paragraph(f"Verdict: {c.get('verdict') or group}"))
            if reason:
                blocks.append(_rich_paragraph(f"Reason: {reason}"))
            if hook:
                blocks.append(_rich_paragraph(f"Best hook: {hook}"))
            if tier:
                blocks.append(_rich_paragraph(f"AI tier: {tier}"))
            if flags:
                flags_s = "; ".join(str(f) for f in flags)
                blocks.append(_rich_paragraph(f"Red flags: {flags_s}"))

    page = notion.pages.create(
        parent={"page_id": NOTION_PARENT_PAGE_ID},
        properties={
            "title": {
                "title": [{"type": "text", "text": {"content": title[:2000]}}],
            },
        },
    )
    pid = page["id"]
    if blocks:
        _append_chunks(notion, pid, blocks)
    return page.get("url") or f"https://www.notion.so/{pid.replace('-', '')}"


def _heading_plain(block: dict[str, Any]) -> str | None:
    if block.get("type") != "heading_3":
        return None
    h = block.get("heading_3") or {}
    return _plain_from_rich(h.get("rich_text") or [])


def _strikesegment_for_heading(plain: str) -> str | None:
    """Return the text segment that should be struck through (before ' | Score:')."""
    plain = plain.strip()
    m = re.match(r"^(#\d+\s+.+?)(\s*\|\s*Score:\s*\d+/10)\s*$", plain)
    if m:
        return m.group(1)
    return None


def update_shortlist_candidate_status(
    page_id: str,
    candidate_name: str,
    status: str,
    date_str: str | None,
) -> dict[str, Any]:
    """
    Find the heading_3 whose candidate name matches Tool 4's pattern exactly and
    replace the line with a strikethrough prefix segment plus status suffix.
    """
    status_u = status.strip().upper()
    if status_u not in STATUS_EMOJI:
        raise ValueError(f"status must be one of {list(STATUS_EMOJI)}")

    notion = _client()
    name = candidate_name.strip()
    emoji = STATUS_EMOJI[status_u]

    cursor = None
    found_id: str | None = None
    found_plain: str | None = None

    while True:
        kw: dict[str, Any] = {"block_id": page_id, "page_size": 100}
        if cursor:
            kw["start_cursor"] = cursor
        resp = notion.blocks.children.list(**kw)
        for block in resp.get("results") or []:
            plain = _heading_plain(block)
            if not plain:
                continue
            m = re.match(r"^#\d+\s+(.+?)\s*\|\s*Score:\s*\d+/10\s*$", plain.strip())
            if m and m.group(1) == name:
                found_id = block["id"]
                found_plain = plain
                break
        if found_id:
            break
        if not resp.get("has_more"):
            break
        cursor = resp["next_cursor"]

    if not found_id or not found_plain:
        raise RuntimeError(f"No heading found for candidate name {name!r}")

    strike = _strikesegment_for_heading(found_plain)
    if not strike:
        raise RuntimeError(f"Could not parse heading for strikethrough: {found_plain!r}")

    if date_str:
        suffix = f" {emoji} {status_u} — {date_str}"
    else:
        suffix = f" {emoji} {status_u}"

    def _ann(strike_only: bool) -> dict[str, Any]:
        return {
            "bold": False,
            "italic": False,
            "strikethrough": strike_only,
            "underline": False,
            "code": False,
            "color": "default",
        }

    rich_text: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": {"content": strike[:2000]},
            "annotations": _ann(True),
        },
        {
            "type": "text",
            "text": {"content": suffix[:2000]},
            "annotations": _ann(False),
        },
    ]

    notion.blocks.update(
        found_id,
        heading_3={"rich_text": rich_text},
    )
    return {"updated": True, "block_id": found_id, "previous_heading": found_plain}
