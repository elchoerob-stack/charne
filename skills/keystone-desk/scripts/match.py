#!/usr/bin/env python3
"""
Match buyers to listings and say why.

  python match.py --listings listings.csv --buyers buyers.csv [--top 3] [--json out.json]

Either file can be CSV or JSON (a list of objects). Column names are matched
loosely. Listings: id, title, area, price, type, beds, baths, garages,
features (separated by ; or |), status, url. Buyers: name, budget (or
budget_max), pre_approved, areas, types, min_beds, min_baths, min_garages,
must_haves, nice_to_haves, phone. List fields split on ; , or |.

Rules, in order:
- Hard no: over the buyer's ceiling by more than 5%, too few bedrooms, wrong
  type when types are given, a must-have that is missing, or status Sold.
- A ceiling is pre_approved when known (what the bank will lend plus deposit),
  else budget. Within 5% over it is shown as a stretch, never hidden.
- Score: area 35, price fit 25, rooms 20, nice-to-haves 20.
Standard library only.
"""

import argparse
import csv
import json
import re
import sys
from pathlib import Path

STRETCH = 0.05


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).strip()


def num(v):
    if v is None or v == "":
        return None
    s = re.sub(r"[^\d.,\-]", "", str(v)).replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def items(v):
    if isinstance(v, list):
        return [norm(x) for x in v if norm(x)]
    return [norm(x) for x in re.split(r"[;,|]", str(v or "")) if norm(x)]


ALIASES = {
    "id": ["id", "ref", "listing id", "web ref"],
    "title": ["title", "name", "heading", "listing"],
    "area": ["area", "suburb", "location", "estate"],
    "price": ["price", "asking price", "list price"],
    "type": ["type", "property type"],
    "beds": ["beds", "bedrooms", "bed"],
    "baths": ["baths", "bathrooms", "bath"],
    "garages": ["garages", "garage", "parking"],
    "features": ["features", "highlights", "extras"],
    "status": ["status"],
    "url": ["url", "link"],
    "budget": ["budget max", "budget", "max price", "max budget"],
    "pre_approved": ["pre approved", "preapproved", "pre approval", "approved amount"],
    "areas": ["areas", "suburbs", "preferred areas", "area"],
    "types": ["types", "property types", "type"],
    "min_beds": ["min beds", "beds", "bedrooms"],
    "min_baths": ["min baths", "baths", "bathrooms"],
    "min_garages": ["min garages", "garages"],
    "must_haves": ["must haves", "must have", "needs"],
    "nice_to_haves": ["nice to haves", "nice to have", "wants"],
    "phone": ["phone", "cell", "mobile", "whatsapp"],
}


def load(path):
    p = Path(path)
    text = p.read_text(encoding="utf-8-sig")
    if p.suffix.lower() == ".json":
        rows = json.loads(text)
        rows = rows if isinstance(rows, list) else rows.get("items", [])
    else:
        try:
            dialect = csv.Sniffer().sniff(text[:5000], delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        rows = list(csv.DictReader(text.splitlines(), dialect=dialect))
    out = []
    for r in rows:
        lower = {norm(k): v for k, v in r.items()}
        rec = {}
        for key, names in ALIASES.items():
            for n in names:
                if n in lower and lower[n] not in (None, ""):
                    rec[key] = lower[n]
                    break
        rec["_raw"] = r
        out.append(rec)
    return out


def has(feature, listing_text):
    """Feature present if all its words appear in the listing's text."""
    words = feature.split()
    return all(w in listing_text for w in words)


def score(b, l):
    reasons, warnings = [], []
    price = num(l.get("price"))
    ceiling = num(b.get("pre_approved")) or num(b.get("budget"))
    ltype = norm(l.get("type"))
    text = " ".join(norm(x) for x in (l.get("title"), l.get("area"), l.get("type"),
                                      l.get("features"), l.get("_raw", {}).get("desc")))
    if norm(l.get("status")) in ("sold", "withdrawn", "off market"):
        return None, ["not available"], []
    if ceiling and price:
        if price > ceiling * (1 + STRETCH):
            return None, [f"over ceiling ({price:,.0f} vs {ceiling:,.0f})"], []
        if price > ceiling:
            warnings.append(f"stretch: {(price / ceiling - 1) * 100:.1f}% over "
                            + ("pre-approval" if b.get("pre_approved") else "budget"))
    for key, label in (("min_beds", "beds"), ("min_baths", "baths"), ("min_garages", "garages")):
        need, got = num(b.get(key)), num(l.get(label))
        if need and got is not None and got < need:
            return None, [f"{label}: {got:.0f} < {need:.0f}"], []
    types = items(b.get("types"))
    if types and ltype and not any(t in ltype or ltype in t for t in types):
        return None, [f"type {ltype} not in {', '.join(types)}"], []
    for m in items(b.get("must_haves")):
        if not has(m, text):
            return None, [f"missing must-have: {m}"], []

    s = 0.0
    areas = items(b.get("areas"))
    larea = norm(l.get("area"))
    if not areas:
        s += 20
    elif any(a in larea or larea in a for a in areas):
        s += 35
        reasons.append(f"in {l.get('area')}")
    if ceiling and price:
        fit = price / ceiling
        s += 25 if 0.85 <= fit <= 1.0 else (18 if fit < 0.85 else 8)
        if fit < 0.85:
            reasons.append(f"well under budget ({(1 - fit) * 100:.0f}% headroom)")
        elif fit <= 1.0:
            reasons.append("uses the budget well")
    else:
        s += 12
    extra = 0
    for key, label in (("min_beds", "beds"), ("min_baths", "baths"), ("min_garages", "garages")):
        need, got = num(b.get(key)), num(l.get(label))
        if need and got is not None and got > need:
            extra += 1
    s += min(20, 14 + 3 * extra)
    if extra:
        reasons.append("more rooms than asked for")
    nice = items(b.get("nice_to_haves"))
    hits = [n for n in nice if has(n, text)]
    if nice:
        s += 20 * len(hits) / len(nice)
    else:
        s += 10
    if hits:
        reasons.append("has " + ", ".join(hits))
    for m in items(b.get("must_haves")):
        reasons.insert(0, f"has {m}")
    return round(s, 1), reasons, warnings


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--listings", required=True)
    ap.add_argument("--buyers", required=True)
    ap.add_argument("--top", type=int, default=3)
    ap.add_argument("--json")
    a = ap.parse_args()
    listings, buyers = load(a.listings), load(a.buyers)
    if not listings or not buyers:
        sys.exit("need at least one listing and one buyer")

    result = []
    print("# Buyer matches\n")
    for b in buyers:
        name = b.get("_raw", {}).get("name") or b.get("title") or "Buyer"
        ranked, excluded = [], []
        for l in listings:
            sc, reasons, warns = score(b, l)
            label = l.get("title") or l.get("id") or "listing"
            if sc is None:
                excluded.append((label, reasons[0]))
            else:
                ranked.append((sc, l, reasons, warns))
        ranked.sort(key=lambda x: -x[0])
        top = ranked[: a.top]
        print(f"## {name}\n")
        if not top:
            print("No listing fits. Closest misses:")
            for label, why in excluded[:3]:
                print(f"- {label}: {why}")
            print()
        for sc, l, reasons, warns in top:
            price = num(l.get("price"))
            line = f"- **{l.get('title') or l.get('id')}**, {l.get('area', '')}" \
                   f"{', R ' + f'{price:,.0f}'.replace(',', ' ') if price else ''} — score {sc:.0f}"
            print(line)
            if reasons:
                print(f"  - why: {'; '.join(reasons)}")
            if warns:
                print(f"  - note: {'; '.join(warns)}")
            if l.get("url"):
                print(f"  - {l['url']}")
        print()
        result.append({"buyer": name, "matches": [
            {"listing": l.get("id") or l.get("title"), "title": l.get("title"), "score": sc,
             "reasons": r, "warnings": w} for sc, l, r, w in top],
            "excluded": [{"listing": x, "why": y} for x, y in excluded]})
    if a.json:
        Path(a.json).write_text(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
