"""The "Download my data" report: a readable PDF, not a data dump.

Written with ReportLab and the DejaVu Sans font (bundled in app/assets/fonts), which covers Latin, Greek,
Cyrillic and many other scripts. Chinese, Japanese and Korean text is not in that font and shows as blanks.
"""

from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import HRFlowable, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

_FONTS = Path(__file__).resolve().parents[2] / "assets" / "fonts"
_registered = False

INK = colors.HexColor("#17332b")
MUTED = colors.HexColor("#5d6b66")
ACCENT = colors.HexColor("#1f5c4a")
LINE = colors.HexColor("#ddd7c9")


def _fonts() -> None:
    global _registered
    if _registered:
        return
    pdfmetrics.registerFont(TTFont("Body", str(_FONTS / "DejaVuSans.ttf")))
    pdfmetrics.registerFont(TTFont("Body-Bold", str(_FONTS / "DejaVuSans-Bold.ttf")))
    pdfmetrics.registerFontFamily("Body", normal="Body", bold="Body-Bold", italic="Body", boldItalic="Body-Bold")
    _registered = True


def _styles() -> dict[str, ParagraphStyle]:
    base = dict(fontName="Body", textColor=INK, alignment=TA_LEFT)
    return {
        "title": ParagraphStyle("title", fontSize=22, leading=27, fontName="Body-Bold", textColor=INK, spaceAfter=2),
        "sub": ParagraphStyle("sub", fontSize=9.5, leading=13, fontName="Body", textColor=MUTED, spaceAfter=10),
        "h1": ParagraphStyle("h1", fontSize=14, leading=18, fontName="Body-Bold", textColor=ACCENT, spaceBefore=16, spaceAfter=6),
        "h2": ParagraphStyle("h2", fontSize=11, leading=15, fontName="Body-Bold", textColor=INK, spaceBefore=8, spaceAfter=2),
        "p": ParagraphStyle("p", fontSize=9.5, leading=13.5, spaceAfter=3, **base),
        "small": ParagraphStyle("small", fontSize=8.5, leading=12, fontName="Body", textColor=MUTED, spaceAfter=2),
        "q": ParagraphStyle("q", fontSize=10, leading=14, fontName="Body-Bold", textColor=INK, spaceBefore=6, spaceAfter=1),
        "a": ParagraphStyle("a", fontSize=9.5, leading=13.5, fontName="Body", textColor=INK, leftIndent=8, spaceAfter=2),
        "code": ParagraphStyle("code", fontSize=8, leading=10.5, fontName="Courier", textColor=INK, leftIndent=8, backColor=colors.HexColor("#f3f0e8"), borderPadding=4, spaceBefore=2, spaceAfter=4),
        "bullet": ParagraphStyle("bullet", fontSize=9.5, leading=13.5, leftIndent=12, bulletIndent=2, fontName="Body", textColor=INK, spaceAfter=1),
    }


def _t(value: Any) -> str:
    return escape(str(value if value is not None else "")).replace("\n", "<br/>")


def _date(value: Any) -> str:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).strftime("%d %b %Y, %H:%M")
    except ValueError:
        return str(value or "")


def _page(canvas, doc) -> None:  # footer on every page
    canvas.saveState()
    canvas.setFont("Body", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 10 * mm, "Vren AI · your report")
    canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {doc.page}")
    canvas.restoreState()


def build_report_pdf(data: dict[str, Any]) -> bytes:
    """`data` is what the export collects. Sections with nothing in them are left out."""
    _fonts()
    s = _styles()
    out: list[Any] = []

    def h1(text: str) -> None:
        out.append(Paragraph(_t(text), s["h1"]))
        out.append(HRFlowable(width="100%", thickness=0.6, color=LINE, spaceAfter=4))

    def para(text: str, style: str = "p") -> None:
        if text and str(text).strip():
            out.append(Paragraph(_t(text), s[style]))

    def bullets(items: list[str]) -> None:
        for item in items:
            if item and str(item).strip():
                out.append(Paragraph(_t(item), s["bullet"], bulletText="•"))

    user, profile = data.get("user", {}), data.get("profile", {})
    out.append(Paragraph("Your Vren AI report", s["title"]))
    out.append(Paragraph(_t(f"{profile.get('full_name') or user.get('email', '')} · made {_date(data.get('exported_at'))}"), s["sub"]))

    # ------------------------------------------------------------ summary table
    sessions, practice = data.get("sessions", []), data.get("practice", [])
    counts = [
        ["Interviews", str(len(sessions))],
        ["Questions answered", str(sum(len(x.get("questions", [])) for x in sessions))],
        ["Practice interviews", str(len(practice))],
        ["Jobs saved", str(len(data.get("jobs", [])))],
        ["CV items", str(len(data.get("profile_items", [])))],
    ]
    table = Table(counts, colWidths=[60 * mm, 25 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([("FONTNAME", (0, 0), (-1, -1), "Body"), ("FONTSIZE", (0, 0), (-1, -1), 9.5), ("TEXTCOLOR", (0, 0), (-1, -1), INK),
                               ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE), ("ALIGN", (1, 0), (1, -1), "RIGHT"), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    out.append(table)

    # ------------------------------------------------------------ profile
    if any(profile.get(k) for k in ("full_name", "headline", "summary", "location", "role_focus")):
        h1("About you")
        para(profile.get("headline"), "h2")
        para(" · ".join(x for x in (profile.get("location"), profile.get("role_focus")) if x), "small")
        para(profile.get("summary"))

    items = data.get("profile_items", [])
    for kind, title in (("experience", "Experience"), ("education", "Education"), ("project", "Projects"), ("certification", "Certifications")):
        group = [i for i in items if i.get("kind") == kind and i.get("active", True)]
        if not group:
            continue
        h1(title)
        for i in group:
            head = " · ".join(x for x in (i.get("title"), i.get("organization"), i.get("dates_text")) if x)
            out.append(KeepTogether([Paragraph(_t(head), s["h2"])] + ([Paragraph(_t(i["summary"]), s["p"])] if i.get("summary") else [])))
    skills = [k.get("name") for k in data.get("skills", []) if k.get("name")]
    if skills:
        h1("Skills")
        para(", ".join(skills))

    # ------------------------------------------------------------ jobs
    jobs = data.get("jobs", [])
    if jobs:
        h1("Jobs you saved")
        for j in jobs:
            out.append(Paragraph(_t(" at ".join(x for x in (j.get("title"), j.get("company")) if x) + (" (archived)" if j.get("archived") else "")), s["h2"]))
            if j.get("required_skills"):
                para("Asks for: " + ", ".join(j["required_skills"]), "small")

    # ------------------------------------------------------------ interviews
    if sessions:
        h1("Your interviews")
    for n, sess in enumerate(sessions, 1):
        snap = sess.get("snapshot", {}) or {}
        title = " at ".join(x for x in (snap.get("job_title") or sess.get("job_title"), sess.get("company")) if x) or "General interview"
        out.append(Paragraph(_t(f"{n}. {title}"), s["h2"]))
        para(f"{_date(sess.get('started_at'))} · {sess.get('duration_min', 0)} min · {sess.get('state', '')}", "small")
        review = (snap.get("review") or {}).get("ai") or {}
        para(review.get("summary"))
        if sess.get("strengths"):
            para("Went well", "small"); bullets(sess["strengths"])
        if sess.get("improvements"):
            para("To work on", "small"); bullets(sess["improvements"])
        for q in sess.get("questions", []):
            block = [Paragraph(_t(q.get("question_text")), s["q"]), Paragraph(_t(" ".join(q.get("outline", []))), s["a"])]
            if q.get("code"):
                block.append(Paragraph(_t(q["code"]).replace(" ", "&nbsp;"), s["code"]))
            if q.get("evidence_ref"):
                block.append(Paragraph(_t(q["evidence_ref"]), s["small"]))
            out.append(KeepTogether(block))
        if sess.get("transcript"):
            para("What was said", "small")
            for line in sess["transcript"]:
                out.append(Paragraph(f"<b>{_t(line.get('speaker'))}:</b> {_t(line.get('text'))}", s["small"]))
        if sess.get("note"):
            para("Your notes", "small"); para(sess["note"])

    # ------------------------------------------------------------ practice
    if practice:
        h1("Practice interviews")
    for m in practice:
        summ = m.get("summary") or {}
        score = f" · average {summ['average_score']}/5" if summ.get("average_score") else ""
        out.append(Paragraph(_t(f"{m.get('title')}{score}"), s["h2"]))
        para(_date(m.get("created_at")), "small")
        para(summ.get("overall"))
        for t in m.get("turns", []):
            if not t.get("answer"):
                continue
            fb = t.get("feedback") or {}
            block = [Paragraph(_t(t.get("question")), s["q"]), Paragraph(_t(t.get("answer")), s["a"])]
            if fb.get("score"):
                block.append(Paragraph(_t(f"Score {fb['score']}/5. " + " ".join(fb.get("improve", []))), s["small"]))
            out.append(KeepTogether(block))

    # ------------------------------------------------------------ settings
    prefs = data.get("preferences", {})
    h1("Your settings")
    bullets([f"{k.replace('_', ' ').capitalize()}: {v}" for k, v in prefs.items()])
    consents = data.get("consents", [])
    if consents:
        h1("Your consent history")
        bullets([f"{_date(c.get('created_at'))}: {c.get('label')}" for c in consents])

    buf = BytesIO()
    SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=18 * mm,
                      title="Your Vren AI report", author="Vren AI").build(out, onFirstPage=_page, onLaterPages=_page)
    return buf.getvalue()
