import re, json, os
import pymupdf

COLLEGE_RE = re.compile(r"^(\d{5})\s*-\s*(.+)$")
COURSE_RE  = re.compile(r"^(\d{9,11}[A-Z]?)\s*-\s*(.+)$")
CAT_RE     = re.compile(r"^[A-Z][A-Z0-9]{1,14}$")
PCT_RE     = re.compile(r"^\(\d{1,3}\.\d+\)$")
NUM_RE     = re.compile(r"^\d{1,7}$")
STAGE_RE   = re.compile(r"^(I{1,3}|IV|VI{0,3}|IX|XI{0,2})(-\S+)?$")

XCUT = 65.0   # left of this = label column, right = data columns


def get_lines(page):
    rows = [(w[1], w[0], w[2], w[4]) for w in page.get_text("words")]
    rows.sort(key=lambda r: (r[0], r[1]))
    lines, cur, cury = [], [], None
    for y0, x0, x1, t in rows:
        if cury is None:
            cur, cury = [(x0, x1, t)], y0
        elif abs(y0 - cury) <= 2.0:
            cur.append((x0, x1, t))
        else:
            cur.sort(); lines.append((cury, cur)); cur, cury = [(x0, x1, t)], y0
    if cur:
        cur.sort(); lines.append((cury, cur))
    return lines


def assign(vals, headers):
    res = {}
    for x0, x1, t in vals:
        c = (x0 + x1) / 2.0
        best = min(headers, key=lambda h: abs(h[0] - c))
        res[best[1]] = t
    return res


def parse_pdf(path, round_no, out, stats):
    doc = pymupdf.open(path)
    cc = cn = bc = bn = None
    status = hu = ""
    sec = ""
    headers = []
    stage_label = None
    ranks = None

    for pno in range(len(doc)):
        for y, toks in get_lines(doc[pno]):
            if y < 80 or y > 755:
                continue
            text = " ".join(t for _, _, t in toks).strip()
            if not text:
                continue

            m = COURSE_RE.match(text)
            if m:
                bc, bn = m.group(1), m.group(2).strip()
                headers, stage_label, sec = [], None, ""
                continue
            m = COLLEGE_RE.match(text)
            if m:
                cc, cn = m.group(1), m.group(2).strip()
                bc = bn = None; headers, stage_label, sec = [], None, ""
                continue
            if text.startswith("Status:"):
                body = text[7:].strip()
                if "Home University :" in body:
                    a, b = body.split("Home University :", 1)
                    status, hu = a.strip(), b.strip()
                else:
                    status, hu = body, ""
                continue
            if text.startswith(("Legends", "Maharashtra State Seats", "* Maharashtra", "PWDR")):
                continue

            label = [t for x0, _, t in toks if x0 < XCUT]
            data = [(x0, x1, t) for x0, x1, t in toks if x0 >= XCUT]

            if not data:
                lt = " ".join(label)
                if lt != "Stage":
                    sec = lt
                    headers, stage_label = [], None
                continue

            dtxt = [t for _, _, t in data]

            if re.search(r"[a-z]", " ".join(dtxt)):
                sec = text
                headers, stage_label = [], None
                continue

            if all(CAT_RE.match(t) for t in dtxt):
                headers = [((a + b) / 2.0, t) for a, b, t in data]
                stage_label = None
                continue

            if all(NUM_RE.match(t) for t in dtxt) and headers:
                stage_label = " ".join(label) if label else stage_label
                ranks = assign(data, headers)
                stats["ranks"] += len(data)
                continue

            if all(PCT_RE.match(t) for t in dtxt):
                stats["pcts"] += len(data)
                if not headers or not bc or ranks is None:
                    stats["dropped"] += len(data)
                    continue
                pcts = assign(data, headers)
                lbl = (stage_label or "I")
                if label:
                    extra = " ".join(label)
                    if not STAGE_RE.match(extra):
                        lbl = (lbl + " " + extra).strip()
                for code, pv in pcts.items():
                    rk = ranks.get(code)
                    out.append([cc, cn, bc, bn, status, hu, sec, code, round_no,
                                lbl, int(rk) if rk else None, float(pv.strip("()"))])
                ranks = None
                stage_label = None
                continue

            stats["unknown"] += 1
            if stats["unknown"] < 12:
                stats["samples"].append((pno + 1, text[:90]))
    doc.close()


if __name__ == "__main__":
    out = []
    # Put the three CAP PDFs next to this script, or edit the paths below.
    for f, r in [("2026ENGG_CAP1_MH_CutOff_V1.pdf", 1),
                 ("2026ENGG_CAP2_MH_CutOff.pdf", 2),
                 ("2026ENGG_CAP3_MH_CutOff.pdf", 3)]:
        st = {"ranks": 0, "pcts": 0, "dropped": 0, "unknown": 0, "samples": []}
        n0 = len(out)
        parse_pdf(f, r, out, st)
        print(f"round {r}: rows={len(out)-n0} pcts_seen={st['pcts']} dropped={st['dropped']} unknown={st['unknown']}")
        for s in st["samples"]:
            print("   ", s)
    json.dump(out, open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "raw_cutoffs.json"), "w"))
    print("TOTAL", len(out))
