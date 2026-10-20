#!/usr/bin/env python3
"""Quotes and invoices as PDFs, from an agreed deal, sent to the owner on Telegram to forward.

  invoice.py quote <lead id> [--send]      e.g. invoice.py invoice L0004 --send
  invoice.py invoice <lead id> [--send]

Line items come from business/deals.tsv (written by `lead.sh agree`), the client from leads.tsv, and the
business name, contact and payment terms from its profile.md. No dependencies: the PDF is written by hand
(standard Helvetica, so amounts use "Rs." rather than the rupee sign, and EUR for €). Files go to business/docs/.
"""
import datetime, json, os, re, shlex, sys, time, urllib.request, uuid

W = os.path.expanduser("~/.hermes/workspace")
B = f"{W}/business"
try:   # the owner's settings, written by bin/fixup from max.config
    CFG = dict(w.split("=", 1) for l in open(f"{W}/max.env") for w in shlex.split(l, comments=True) if "=" in w)
except OSError:
    CFG = {}
os.environ["TZ"] = CFG.get("MAX_TZ", "UTC")   # dates on documents are the owner's, not the sandbox's UTC
getattr(time, "tzset", lambda: None)()
CUR = CFG.get("CURRENCY", "₹")


def rows(path):
    return [l.rstrip("\n").split("\t") for l in open(path)] if os.path.exists(path) else []


def money(v):
    s = f"{float(v):,.2f}".rstrip("0").rstrip(".")
    return {"₹": "Rs. ", "€": "EUR "}.get(CUR, CUR) + s


def business(slug):
    prof = open(f"{B}/{slug}/profile.md").read() if os.path.exists(f"{B}/{slug}/profile.md") else ""
    name = re.sub(r"\s*\(.*?\)\s*$", "", (re.search(r"(?m)^#\s+(.+)$", prof) or [None, slug])[1]).strip()
    line = lambda k: re.sub(r"\*\*|\(.*?\)", "", (re.search(rf"(?mi)^[-*\s]*\**{k}:?\**:?\s*(.+)$", prof) or [None, ""])[1]).strip()
    # "Payment terms:" is the client-facing line; the profile's other payment notes are instructions for Max
    # and must never be printed on a document.
    return {"name": name, "contact": line("Channels"), "payment": line("Payment terms")}


def pdf(lines):
    """lines: [(x, y, size, bold, text)] plus ("rule", y) for horizontal lines. One A4 page."""
    esc = lambda t: t.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)").encode("latin-1", "replace").decode("latin-1")
    ops = []
    for item in lines:
        if item[0] == "rule":
            ops.append(f"0.75 w 0.6 0.6 0.6 RG 50 {item[1]} m 545 {item[1]} l S")
        else:
            x, y, size, bold, text = item
            ops.append(f"BT /{'F2' if bold else 'F1'} {size} Tf {x} {y} Td ({esc(text)}) Tj ET")
    stream = "\n".join(ops).encode("latin-1", "replace")
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
            b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out)


def build(kind, lead_id, today=None):
    today = today or datetime.date.today()
    lead = next((r for r in rows(f"{B}/leads.tsv") if r[0] == lead_id), None)
    if not lead or len(lead) < 10:
        sys.exit(f"no lead {lead_id}")
    items = [r for r in rows(f"{B}/deals.tsv") if r[0] == lead_id]
    if not items:
        sys.exit(f"no agreed deal for {lead_id}: record it first with lead.sh agree {lead_id} <product> <qty> <price>")
    items = [r for r in items if r[1] == items[-1][1]]   # the latest agreement's lines
    biz = business(lead[3])
    number = f"{'Q' if kind == 'quote' else 'INV'}-{lead_id}-{today:%Y%m%d}"
    total = sum(float(r[3]) * float(r[4]) for r in items)
    y, L = 780, []
    L.append((50, y, 20, True, biz["name"]))
    L.append((400, y, 20, True, "QUOTATION" if kind == "quote" else "INVOICE"))
    y -= 18
    if biz["contact"]:
        L.append((50, y, 9, False, biz["contact"][:95]))
    y -= 34
    L += [(50, y, 10, True, "Bill to"), (400, y, 10, True, "No."), (450, y, 10, False, number)]
    y -= 15
    L += [(50, y, 10, False, lead[4][:50]), (400, y, 10, True, "Date"), (450, y, 10, False, today.strftime("%d %b %Y"))]
    if kind == "invoice":
        y -= 15
        L += [(400, y, 10, True, "Due"), (450, y, 10, False, (today + datetime.timedelta(days=7)).strftime("%d %b %Y"))]
    y -= 36
    L += [(50, y, 10, True, "Item"), (330, y, 10, True, "Qty"), (390, y, 10, True, "Rate"), (475, y, 10, True, "Amount"), ("rule", y - 6)]
    for r in items:
        y -= 24
        q, p = float(r[3]), float(r[4])
        L += [(50, y, 10, False, r[2][:45].capitalize()), (330, y, 10, False, f"{q:g}"), (390, y, 10, False, money(p)), (475, y, 10, False, money(q * p))]
    L.append(("rule", y - 10))
    y -= 30
    L += [(390, y, 12, True, "Total"), (475, y, 12, True, money(total))]
    y -= 44
    terms = biz["payment"] or ("Due within 7 days of the invoice date." if kind == "invoice" else "")
    if terms:
        L += [(50, y, 10, True, "Payment"), (50, y - 14, 9, False, terms[:110])]
        y -= 30
    note = "This quotation is valid for 14 days." if kind == "quote" else "Thank you for your business."
    L.append((50, y - 10, 9, False, note))
    os.makedirs(f"{B}/docs", exist_ok=True)
    path = f"{B}/docs/{number}.pdf"
    open(path, "wb").write(pdf(L))
    return path, number, total, lead


def send(path, caption):
    """Telegram sendDocument to the owner (multipart by hand; OpenShell swaps in the real bot token)."""
    users = os.environ.get("TELEGRAM_ALLOWED_USERS", "")
    if not users and os.path.exists(os.path.expanduser("~/.hermes/.env")):
        users = next((l.split("=", 1)[1] for l in open(os.path.expanduser("~/.hermes/.env")) if l.startswith("TELEGRAM_ALLOWED_USERS=")), "")
    chat = users.split(",")[0].strip().strip("\"'")
    if not chat:
        return "not sent: no TELEGRAM_ALLOWED_USERS"
    bnd = uuid.uuid4().hex
    part = lambda name, value: f"--{bnd}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode()
    body = part("chat_id", chat) + part("caption", caption[:1000]) + (
        f"--{bnd}\r\nContent-Disposition: form-data; name=\"document\"; filename=\"{os.path.basename(path)}\"\r\n"
        "Content-Type: application/pdf\r\n\r\n").encode() + open(path, "rb").read() + f"\r\n--{bnd}--\r\n".encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{os.environ.get('TELEGRAM_BOT_TOKEN', '')}/sendDocument",
                                 data=body, headers={"Content-Type": f"multipart/form-data; boundary={bnd}"})
    return "sent to you on Telegram" if json.load(urllib.request.urlopen(req, timeout=30)).get("ok") else "telegram refused"


def main(a):
    if len(a) < 2 or a[0] not in ("quote", "invoice"):
        sys.exit(__doc__)
    path, number, total, lead = build(a[0], a[1])
    print(f"{number}: {money(total)} for {lead[4]} -> {path}")
    if "--send" in a:
        print(send(path, f"{'Quote' if a[0] == 'quote' else 'Invoice'} {number} for {lead[4]}: {money(total)}. Forward it to the client."))


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        import tempfile
        W = tempfile.mkdtemp(); B = f"{W}/business"; os.makedirs(f"{B}/shop")
        open(f"{B}/shop/profile.md", "w").write("# Test Shop (working name)\n\nChannels: hi@test.in\n- **Payment:** never ask for an advance.\nPayment terms: after the preview.\n")
        open(f"{B}/leads.tsv", "w").write("id\tcreated\tupdated\tbusiness\tcontact\tchannel\tstatus\tvalue\tnext\tneed\n"
                                          "L0001\t2026-10-01\t2026-10-02\tshop\tCafe Bloom\twhatsapp\tagreed\t6749\t\tsite\n")
        open(f"{B}/deals.tsv", "w").write("L0001\t2026-10-02\tbasic\t1\t6749\n")
        path, number, total, _ = build("invoice", "L0001", datetime.date(2026, 10, 20))
        data = open(path, "rb").read()
        assert data.startswith(b"%PDF-1.4") and data.rstrip().endswith(b"%%EOF"), "pdf framing"
        assert number == "INV-L0001-20261020" and total == 6749, (number, total)
        for want in (b"Test Shop", b"INVOICE", b"Cafe Bloom", b"Rs. 6,749", b"after the preview", b"27 Oct 2026"):
            assert want in data, want
        assert b"advance" not in data, "internal payment notes must not reach the client"
        print("self-test ok")
    else:
        main(sys.argv[1:])
