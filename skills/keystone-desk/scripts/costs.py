#!/usr/bin/env python3
"""
Property money for South African sales: transfer duty, bond repayment,
the buyer's cash-on-transfer, the seller's net, and the agent's commission.

  python costs.py buyer  --price 2099900 --deposit 200000 --rate 10.5 [--years 20]
                         [--transfer-fees 45000 --bond-fees 38000] [--income 65000] [--vat-sale]
  python costs.py seller --price 2099900 --commission 6 [--vat-inclusive]
                         [--bond-cancel 1200000 --cancel-fees 9000 --certs 6500]
  python costs.py commission --price 2099900 --commission 6 --agency-split 50
                         [--partner-split 0] [--referral 0] [--vat-inclusive | --fixed 95000]
  python costs.py duty --price 2099900

Add --json for machine-readable output. Standard library only.

Attorney fees, bond registration costs and rates are deliberately NOT guessed:
they come from the attorney's or bank's quote and are passed in. Every output
lists what it assumed.
"""

import argparse
import json
import math
import sys

# SARS transfer duty, natural persons and entities alike. Source:
# https://www.sars.gov.za/tax-rates/transfer-duty/ (page updated 25 Feb 2026):
# brackets effective 1 April 2025, "no changes" for 1 April 2026 onward.
# Re-check after every February Budget and update DUTY_TABLE_VALID.
DUTY_TABLE_VALID = "property acquired on or after 1 April 2025 (unchanged from 1 April 2026)"
DUTY_BRACKETS = [  # (lower bound exclusive, base duty, marginal rate)
    (13_310_000, 1_241_456, 0.13),
    (2_994_800, 106_784, 0.11),
    (2_329_300, 53_544, 0.08),
    (1_663_800, 13_614, 0.06),
    (1_210_000, 0, 0.03),
]
VAT_RATE = 0.15  # South African VAT
AFFORDABILITY_SHARE = 0.30  # banks' usual ceiling: repayment ≤ 30% of gross monthly income


def rand(x):
    return "R " + f"{x:,.0f}".replace(",", " ")


def transfer_duty(price: float, vat_sale: bool = False) -> float:
    """Duty on the purchase price. A sale by a VAT vendor carries VAT, not duty."""
    if vat_sale:
        return 0.0
    for floor, base, rate in DUTY_BRACKETS:
        if price > floor:
            return base + rate * (price - floor)
    return 0.0


def repayment(principal: float, annual_rate_pct: float, years: int) -> float:
    if principal <= 0:
        return 0.0
    r = annual_rate_pct / 100 / 12
    n = years * 12
    if r == 0:
        return principal / n
    return principal * r / (1 - (1 + r) ** -n)


def commission(price, pct=None, fixed=None, vat_inclusive=False, agency_split=50.0,
               partner_split=0.0, referral=0.0):
    """Gross commission and who gets what.

    pct/fixed is the mandate's fee. vat_inclusive means the fee already contains
    VAT. Splits work on the commission excluding VAT: a partner agency's share and
    a referral fee come off the top, then the rest divides agency / agent by
    agency_split (the agency's percentage).
    """
    if fixed is not None:
        gross = float(fixed)
    elif pct is not None:
        gross = price * pct / 100
    else:
        raise SystemExit("give --commission (percent) or --fixed (rand)")
    if vat_inclusive:
        excl = gross / (1 + VAT_RATE)
    else:
        excl = gross
    vat = excl * VAT_RATE
    incl = excl + vat
    partner = excl * partner_split / 100
    ref = excl * referral / 100
    pool = excl - partner - ref
    agency = pool * agency_split / 100
    agent = pool - agency
    return {
        "commission_excl_vat": excl, "vat": vat, "commission_incl_vat": incl,
        "partner_agency": partner, "referral": ref, "agency_share": agency, "agent_share": agent,
        "effective_rate_incl_vat_pct": incl / price * 100 if price else None,
    }


def buyer(a):
    duty = transfer_duty(a.price, a.vat_sale)
    loan = max(a.price - a.deposit, 0)
    pay = repayment(loan, a.rate, a.years) if a.rate is not None else None
    cash = a.deposit + duty + (a.transfer_fees or 0) + (a.bond_fees or 0)
    out = {
        "price": a.price, "deposit": a.deposit, "bond": loan,
        "deposit_pct": a.deposit / a.price * 100 if a.price else 0,
        "transfer_duty": duty, "transfer_fees": a.transfer_fees, "bond_fees": a.bond_fees,
        "cash_needed": cash, "rate_pct": a.rate, "years": a.years, "monthly_repayment": pay,
        "total_repaid": pay * a.years * 12 if pay else None,
        "income_needed": pay / AFFORDABILITY_SHARE if pay else None,
        "income": a.income,
        "assumptions": [
            f"Transfer duty per SARS table for {DUTY_TABLE_VALID}" if not a.vat_sale
            else "VAT sale: the developer/VAT vendor charges VAT in the price, so no transfer duty",
            "Attorney transfer fees and bond registration costs are " +
            ("from the quote supplied" if a.transfer_fees or a.bond_fees else
             "NOT included; get both attorneys' quotes"),
            f"Affordability uses the banks' usual {AFFORDABILITY_SHARE:.0%} of gross income; "
            "the bank's own assessment decides",
        ],
    }
    if a.rate is None:
        out["assumptions"].append("No interest rate given, so no repayment calculated")
    if a.income and pay:
        out["affordable"] = pay <= a.income * AFFORDABILITY_SHARE
        out["max_bond_at_income"] = (a.income * AFFORDABILITY_SHARE) * (
            1 - (1 + a.rate / 1200) ** -(a.years * 12)) / (a.rate / 1200) if a.rate else None
    return out


def seller(a):
    c = commission(a.price, a.commission, a.fixed, a.vat_inclusive)
    costs = c["commission_incl_vat"] + (a.bond_cancel or 0) + (a.cancel_fees or 0) + (a.certs or 0)
    return {
        "price": a.price, "commission_incl_vat": c["commission_incl_vat"],
        "bond_settlement": a.bond_cancel, "cancellation_fees": a.cancel_fees,
        "compliance_certificates": a.certs, "net_to_seller": a.price - costs,
        "assumptions": [
            "Commission " + ("fixed fee" if a.fixed is not None else f"{a.commission}% of price")
            + (", VAT inclusive" if a.vat_inclusive else f", plus VAT at {VAT_RATE:.0%}"),
            "Bond settlement from the seller's bank figures; cancellation attorney fee from quote"
            if a.bond_cancel else "No bond to cancel entered",
            "Seller usually pays the compliance certificates; rates/levy clearance shortfalls "
            "are extra and come from the attorney's figures",
        ],
    }


def show(title, rows, assumptions):
    w = max(len(k) for k, _ in rows)
    print(f"## {title}\n")
    for k, v in rows:
        print(f"{k.ljust(w)}  {v}")
    print("\nAssumptions:")
    for s in assumptions:
        print(f"- {s}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="mode", required=True)
    for name in ("buyer", "seller", "commission", "duty"):
        p = sub.add_parser(name)
        p.add_argument("--price", type=float, required=True)
        p.add_argument("--json", action="store_true")
        if name == "buyer":
            p.add_argument("--deposit", type=float, default=0)
            p.add_argument("--rate", type=float, help="bond interest rate, % a year (prime ± the bank's offer)")
            p.add_argument("--years", type=int, default=20)
            p.add_argument("--transfer-fees", type=float)
            p.add_argument("--bond-fees", type=float)
            p.add_argument("--income", type=float, help="gross monthly household income")
            p.add_argument("--vat-sale", action="store_true")
        if name in ("seller", "commission"):
            p.add_argument("--commission", type=float, help="percent of price")
            p.add_argument("--fixed", type=float, help="fixed fee in rand instead of a percent")
            p.add_argument("--vat-inclusive", action="store_true")
        if name == "seller":
            p.add_argument("--bond-cancel", type=float)
            p.add_argument("--cancel-fees", type=float)
            p.add_argument("--certs", type=float)
        if name == "commission":
            p.add_argument("--agency-split", type=float, default=50.0, help="agency's % of the pool")
            p.add_argument("--partner-split", type=float, default=0.0, help="partner agency %")
            p.add_argument("--referral", type=float, default=0.0, help="referral fee %")
        if name == "duty":
            p.add_argument("--vat-sale", action="store_true")
    a = ap.parse_args()

    if a.mode == "duty":
        d = transfer_duty(a.price, a.vat_sale)
        out = {"price": a.price, "transfer_duty": d, "table": DUTY_TABLE_VALID}
        if a.json:
            print(json.dumps(out, indent=2))
        else:
            show("Transfer duty", [("Price", rand(a.price)), ("Transfer duty", rand(d))],
                 [f"SARS table for {DUTY_TABLE_VALID}"])
        return

    if a.mode == "buyer":
        o = buyer(a)
        if a.json:
            print(json.dumps(o, indent=2))
            return
        rows = [("Purchase price", rand(o["price"])),
                ("Deposit", f"{rand(o['deposit'])} ({o['deposit_pct']:.0f}%)"),
                ("Bond", rand(o["bond"])),
                ("Transfer duty", rand(o["transfer_duty"])),
                ("Transfer attorney", rand(o["transfer_fees"]) if o["transfer_fees"] else "quote needed"),
                ("Bond attorney", rand(o["bond_fees"]) if o["bond_fees"] else "quote needed"),
                ("Cash needed on transfer" if (o["transfer_fees"] and o["bond_fees"]) or o["deposit"] == o["price"]
                 else "Cash needed (before attorney fees)", rand(o["cash_needed"]))]
        if o["monthly_repayment"]:
            rows += [(f"Repayment ({o['rate_pct']}% over {o['years']} yrs)", rand(o["monthly_repayment"]) + " / month"),
                     ("Gross income banks look for", rand(o["income_needed"]) + " / month")]
        if o.get("income"):
            rows.append(("Affordable on stated income", "yes" if o.get("affordable") else "NO, stretch"))
            if o.get("max_bond_at_income"):
                rows.append(("Largest bond on that income", rand(o["max_bond_at_income"])))
        show("Buyer's costs", rows, o["assumptions"])
        return

    if a.mode == "seller":
        o = seller(a)
        if a.json:
            print(json.dumps(o, indent=2))
            return
        rows = [("Selling price", rand(o["price"])),
                ("Commission incl. VAT", "− " + rand(o["commission_incl_vat"]))]
        if o["bond_settlement"]:
            rows.append(("Bond settlement", "− " + rand(o["bond_settlement"])))
        if o["cancellation_fees"]:
            rows.append(("Bond cancellation fees", "− " + rand(o["cancellation_fees"])))
        if o["compliance_certificates"]:
            rows.append(("Compliance certificates", "− " + rand(o["compliance_certificates"])))
        rows.append(("Estimated net to seller", rand(o["net_to_seller"])))
        show("Seller's net", rows, o["assumptions"])
        return

    c = commission(a.price, a.commission, a.fixed, a.vat_inclusive, a.agency_split,
                   a.partner_split, a.referral)
    if a.json:
        print(json.dumps(c, indent=2))
        return
    rows = [("Price", rand(a.price)),
            ("Commission excl. VAT", rand(c["commission_excl_vat"])),
            ("VAT (15%)", rand(c["vat"])),
            ("Commission incl. VAT", rand(c["commission_incl_vat"])
             + f"  ({c['effective_rate_incl_vat_pct']:.2f}% of price)")]
    if c["partner_agency"]:
        rows.append(("Partner agency", rand(c["partner_agency"])))
    if c["referral"]:
        rows.append(("Referral fee", rand(c["referral"])))
    rows += [(f"Agency ({a.agency_split:.0f}%)", rand(c["agency_share"])),
             ("Agent", rand(c["agent_share"]))]
    show("Commission", rows, ["Splits are on the commission excluding VAT",
                              "Agent's share is before income tax and any desk fees"])


if __name__ == "__main__":
    main()
