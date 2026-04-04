"""
Build docs/KRISP-TRANSCRIPT-WORKFLOW-GUIDE.pdf from the markdown guide.
Requires: pip install fpdf2
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


def ascii_safe(s: str) -> str:
    return (
        s.replace("\u2014", "-")
        .replace("\u2013", "-")
        .replace("\u2019", "'")
        .replace("\u2018", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2026", "...")
        .replace("\u2192", "->")
        .replace("\u2022", "*")
        .replace("\u00a0", " ")
    )


def strip_inline_md(s: str) -> str:
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    s = re.sub(r"`([^`]+)`", r"\1", s)
    return s


def main() -> int:
    try:
        from fpdf import FPDF
    except ImportError:
        print("Install fpdf2:  pip install fpdf2", file=sys.stderr)
        return 1

    root = Path(__file__).resolve().parents[1]
    md_path = root / "docs" / "KRISP-TRANSCRIPT-WORKFLOW-GUIDE.md"
    if not md_path.is_file():
        print(f"Missing {md_path}", file=sys.stderr)
        return 1

    raw = ascii_safe(md_path.read_text(encoding="utf-8"))
    lines = raw.splitlines()

    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(18, 18, 18)
    pdf.add_page()
    pdf.set_font("Helvetica", size=10)

    def body():
        pdf.set_font("Helvetica", size=10)

    def mc(h: float, text: str) -> None:
        w = pdf.epw
        if w < 10:
            w = pdf.w - 36
        safe = text if text.strip() else " "
        safe = safe.encode("latin-1", "replace").decode("latin-1")
        pdf.multi_cell(w, h, safe)

    in_fence = False
    for line in lines:
        stripped = line.rstrip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            pdf.set_font("Courier", size=8)
            mc(4.5, strip_inline_md(stripped) or " ")
            body()
            continue

        line = strip_inline_md(stripped)

        if line.startswith("# "):
            pdf.set_font("Helvetica", "B", 16)
            mc(8, line[2:])
            pdf.ln(3)
            body()
        elif line.startswith("## "):
            pdf.set_font("Helvetica", "B", 13)
            mc(7, line[3:])
            pdf.ln(2)
            body()
        elif line.startswith("### "):
            pdf.set_font("Helvetica", "B", 11)
            mc(6, line[4:])
            pdf.ln(1)
            body()
        elif line.strip() == "---":
            pdf.ln(3)
        elif not line.strip():
            pdf.ln(2)
        elif line.startswith("|"):
            pdf.set_font("Helvetica", size=8)
            mc(4.5, line)
            body()
        else:
            mc(5, line)

    out = md_path.with_suffix(".pdf")
    pdf.output(str(out))
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
