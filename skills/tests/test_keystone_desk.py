#!/usr/bin/env python3
"""Self-test for the keystone-desk skill scripts. Run: python3 skills/tests/test_keystone_desk.py"""

import csv
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent / "keystone-desk" / "scripts"
TMP = Path(tempfile.mkdtemp(prefix="keystone-test-"))
FAILS = []


def load(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def expect(name, cond, detail=""):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        FAILS.append(name)
        print(str(detail)[:2000])


def run(*args):
    r = subprocess.run([sys.executable, *map(str, args)], capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


costs = load("costs")

# Transfer duty against the SARS table (1 April 2025 onward, unchanged 2026)
cases = {1_000_000: 0, 1_210_000: 0, 1_500_000: 8_700, 1_663_800: 13_614,
         2_099_900: 39_780, 3_000_000: 107_356, 15_000_000: 1_461_156}
for price, want in cases.items():
    got = costs.transfer_duty(price)
    expect(f"transfer duty on R{price:,}", abs(got - want) < 0.5, f"got {got}, want {want}")
expect("VAT sale has no transfer duty", costs.transfer_duty(2_500_000, vat_sale=True) == 0)
# Continuity at every bracket edge
for floor, _, _ in costs.DUTY_BRACKETS:
    lo, hi = costs.transfer_duty(floor), costs.transfer_duty(floor + 1)
    expect(f"no jump at R{floor:,}", 0 <= hi - lo < 1, (lo, hi))

# Bond repayment: R1m at 12% over 20 years is R11,010.86 a month
expect("repayment formula", abs(costs.repayment(1_000_000, 12, 20) - 11_010.86) < 0.01,
       costs.repayment(1_000_000, 12, 20))

# Commission
c = costs.commission(2_000_000, pct=6, agency_split=50)
expect("6% plus VAT on R2m", round(c["commission_incl_vat"]) == 138_000 and round(c["agent_share"]) == 60_000, c)
c = costs.commission(2_000_000, pct=6, vat_inclusive=True, agency_split=40)
expect("6% VAT-inclusive splits on the excl. amount",
       abs(c["commission_excl_vat"] - 104_347.83) < 0.01 and abs(c["agent_share"] - 62_608.70) < 0.01, c)
c = costs.commission(2_000_000, fixed=100_000, partner_split=50, agency_split=50)
expect("partner agency comes off the top", round(c["partner_agency"]) == 50_000 and round(c["agent_share"]) == 25_000, c)

# CLI: buyer sheet flags missing attorney quotes and checks affordability
code, out = run(SCRIPTS / "costs.py", "buyer", "--price", 2099900, "--deposit", 200000,
                "--rate", 10.75, "--income", 50000)
expect("buyer sheet says quotes are needed", "quote needed" in out and "Transfer duty" in out, out)
expect("buyer sheet flags a stretch on R50k income", "NO, stretch" in out, out)
code, out = run(SCRIPTS / "costs.py", "buyer", "--price", 2099900, "--deposit", 200000, "--json")
j = json.loads(out)
expect("no rate means no invented repayment", j["monthly_repayment"] is None
       and any("No interest rate" in s for s in j["assumptions"]), j)
code, out = run(SCRIPTS / "costs.py", "seller", "--price", 2000000, "--commission", 6,
                "--bond-cancel", 900000, "--cancel-fees", 8000, "--certs", 6000)
expect("seller net", "R 948 000" in out, out)

# Matching
listings = TMP / "listings.csv"
with open(listings, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["ID", "Title", "Suburb", "Price", "Type", "Bedrooms", "Bathrooms", "Garages", "Features", "Status"])
    w.writerow([1, "Modern 3-Bed Townhouse", "Equestria", "R 2 099 900", "Townhouse", 3, 2, 2, "covered patio; built-in braai; communal pool", "Just Listed"])
    w.writerow([2, "Solar Family Home", "Equestria", "R 2 450 000", "House", 3, 2, 2, "solar system; braai; automated garage", "For Sale"])
    w.writerow([3, "Garden Simplex", "Equestria", "R 1 150 000", "Townhouse", 2, 1, 1, "wrap-around garden; pet friendly", "For Sale"])
    w.writerow([4, "Hartbeespoort Views", "Kosmos", "R 4 950 000", "House", 4, 3, 2, "dam views; off-grid capable", "For Sale"])
    w.writerow([5, "Sold Townhouse", "Equestria", "R 1 900 000", "Townhouse", 3, 2, 2, "solar", "Sold"])
buyers = TMP / "buyers.json"
buyers.write_text(json.dumps([
    {"name": "Pieter & Anri", "pre_approved": 2_400_000, "areas": "Equestria; Lynnwood", "types": "house, townhouse",
     "min_beds": 3, "must_haves": "solar", "nice_to_haves": "braai, automated garage"},
    {"name": "Lerato", "budget": 1_200_000, "areas": "Equestria", "min_beds": 2, "nice_to_haves": "pet friendly"},
    {"name": "Big budget, wants Kosmos", "budget": 2_000_000, "areas": "Kosmos", "min_beds": 4},
]))
code, out = run(SCRIPTS / "match.py", "--listings", listings, "--buyers", buyers, "--json", TMP / "m.json")
m = {x["buyer"]: x for x in json.loads((TMP / "m.json").read_text())}
pa = m["Pieter & Anri"]
expect("must-have solar picks the solar house, as a stretch",
       [x["listing"] for x in pa["matches"]] == ["2"] and pa["matches"][0]["warnings"], pa)
expect("sold listing never offered", all(x["listing"] != "5" for b in m.values() for x in b["matches"]), m)
expect("Lerato gets the pet-friendly simplex first",
       m["Lerato"]["matches"][0]["listing"] == "3" and "pet friendly" in " ".join(m["Lerato"]["matches"][0]["reasons"]), m["Lerato"])
expect("no fit shows closest misses", "No listing fits" in out and "over ceiling" in out, out)

print(f"\n{'all passed' if not FAILS else str(len(FAILS)) + ' failed'}")
sys.exit(1 if FAILS else 0)
