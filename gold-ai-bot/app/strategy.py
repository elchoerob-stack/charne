"""Deterministic setup detection. Decides which bars are worth asking the
models about, and proposes mechanical baseline levels for each setup.

Each setup is a separate module with a mode:
  live   - candidates go to the models, and can become demo orders
  shadow - candidates are only recorded as shadow trades (shadow.py), so the
           module proves itself on live data before it may trade
  off    - ignored

A module moves from shadow to live only after its shadow record passes
cbot-gate (`python -m app.main export-shadow ...`). Changing a mode changes
the test-period fingerprint (fingerprint.py), so old results don't carry
over to the new configuration.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from . import ict
from .models import MarketSnapshot, Side
from .structure import SWING_RIGHT, Swing, displacement, last_intact, liquidity_sweep, swings, tstr

Mode = Literal["live", "shadow", "off"]
STRATEGY_MODES: dict[str, Mode] = {
    "ict_2022": "live",            # the ICT model below: the one that trades (demo)
    "trend_breakout": "shadow",    # plain non-ICT baseline, kept for comparison
    "liquidity_sweep": "shadow",   # sweep-and-reclaim only, no MSS/FVG: shows what MSS adds
}
SESSION_UTC = (7, 20)        # London open to late New York
FRIDAY_CUTOFF_UTC = 18       # no new trades into the weekend
MAX_SPREAD_TO_ATR = 0.25
BASELINE_RR = 2.5            # mechanical target for shadow/baseline trades
STOP_BUFFER_ATR = 0.1        # stop sits this far beyond the anchor
MAX_STOP_ATR = 3.0           # an anchor further than this is not a usable stop


@dataclass(frozen=True)
class IctRules:
    """The ICT model, one rule per field. Every field is part of the
    test-period fingerprint: change one and a new test period starts.

    Sequence for a BUY (SELL mirrors it):
      1. H4 bias bullish: the last H4 close beyond a confirmed swing was above
         a swing high. Entry in discount: below the H4 dealing range's 50%.
      2. Decision bar closes inside a killzone (New York time, DST-aware).
      3. Within `max_setup_bars`, a bar took sell-side liquidity: traded
         below an untaken PDL, Asian low or confirmed M15 swing low. That
         sweep low must still be the lowest point since.
      4. Market structure shift: within `mss_max_bars` of the sweep, a bar
         closes above the last confirmed M15 swing high formed before the
         sweep, with a displacement body of at least
         `displacement_body_atr` x ATR, leaving a fair-value gap of at least
         `min_fvg_atr` x ATR.
      5. Entry: the current bar is the FIRST to trade back into that FVG
         (within `entry_max_bars` of the MSS) and did not close through it.
      6. Stop: `stop_buffer_atr` x ATR beyond the sweep low. Rejected if
         wider than `max_stop_atr` x ATR.
      7. Target: the nearest untaken buy-side liquidity (PDH, Asian high, H1
         or M15 swing high) at least `min_target_rr` R away. No such level, no
         trade: the target is a draw on liquidity, never an arbitrary multiple.
    """
    killzones_ny: tuple = (("London", 2.0, 5.0), ("NY AM", 7.0, 10.0))
    require_htf_bias: bool = True
    require_premium_discount: bool = True
    sweep_pools: tuple = ("PDH/PDL", "Asia", "M15 swing", "H1 swing")
    max_setup_bars: int = 24          # sweep to entry within 6 hours
    mss_max_bars: int = 8             # sweep to MSS within 2 hours
    entry_max_bars: int = 12          # MSS to first FVG touch within 3 hours
    displacement_body_atr: float = 1.0
    min_fvg_atr: float = 0.15
    stop_buffer_atr: float = 0.1
    max_stop_atr: float = 3.0
    min_target_rr: float = 2.0        # matches the risk policy minimum
    max_target_h1_atr: float = 8.0    # matches evidence.MAX_TARGET_H1_ATR


ICT = IctRules()
TARGET_PRIORITY = {"PDH/PDL": 0, "Asia": 1, "H1 swing": 2, "M15 swing": 3}


@dataclass(frozen=True)
class Candidate:
    side: Side
    reason: str
    strategy: str = "manual"
    stop: float = 0.0          # mechanical baseline levels
    target: float = 0.0
    anchor: Swing | None = field(default=None, compare=False)
    mode: Mode = "live"


def window_open(s: MarketSnapshot) -> bool:
    """Weekday, and not into the weekend. Session rules are per setup."""
    t = s.created_at
    if t.weekday() >= 5:
        return False
    return not (t.weekday() == 4 and t.hour >= FRIDAY_CUTOFF_UTC)


def in_session(s: MarketSnapshot) -> bool:
    return SESSION_UTC[0] <= s.created_at.hour < SESSION_UTC[1]


def _levels(s: MarketSnapshot, side: Side, anchor_price: float) -> tuple[float, float] | None:
    atr = float(s.features["atr14_m15"])
    entry = s.quote.ask if side == "BUY" else s.quote.bid
    sign = 1 if side == "BUY" else -1
    stop = round(anchor_price - sign * STOP_BUFFER_ATR * atr, 2)
    dist = (entry - stop) * sign
    if dist <= 0 or dist > MAX_STOP_ATR * atr:
        return None
    return stop, round(entry + sign * BASELINE_RR * dist, 2)


def trend_breakout(s: MarketSnapshot) -> Candidate | None:
    """H1 trend (close vs rising/falling EMA50) + M15 close beyond the prior
    20-bar range. Stop beyond the last intact opposite M15 swing."""
    if not in_session(s):
        return None
    f = s.features
    up = f["h1_close"] > f["ema50_h1"] and float(f["ema50_h1_slope_5"]) > 0
    down = f["h1_close"] < f["ema50_h1"] and float(f["ema50_h1_slope_5"]) < 0
    close = float(f["m15_close"])
    if up and close > float(f["m15_prior20_high"]):
        side, kind = "BUY", "low"
    elif down and close < float(f["m15_prior20_low"]):
        side, kind = "SELL", "high"
    else:
        return None
    anchor = last_intact(swings(s.m15), s.m15, kind)
    lv = _levels(s, side, anchor.price) if anchor else None
    if lv is None:
        return None
    return Candidate(side, f"H1 trend + M15 range break; stop beyond swing {kind} "
                           f"{anchor.price} ({anchor.time})", "trend_breakout", *lv, anchor)


def liquidity_sweep_setup(s: MarketSnapshot) -> Candidate | None:
    """The last M15 bar ran a recent swing and closed back inside, with the
    H1 trend not against it. Stop beyond the sweep bar's extreme."""
    if not in_session(s):
        return None
    hit = liquidity_sweep(s.m15, swings(s.m15))
    if hit is None:
        return None
    side, swept = hit
    f = s.features
    if (side == "BUY" and f["h1_close"] < f["ema50_h1"]) or \
            (side == "SELL" and f["h1_close"] > f["ema50_h1"]):
        return None
    bar = s.m15[-1]
    extreme = bar.low if side == "BUY" else bar.high
    lv = _levels(s, side, extreme)
    if lv is None:
        return None
    disp = displacement(bar, float(f["atr14_m15"]), 0.6)
    anchor = Swing("low" if side == "BUY" else "high", bar.time.strftime("%Y-%m-%d %H:%M"),
                   extreme, len(s.m15) - 1)
    return Candidate(side, f"swept {swept.kind} {swept.price} ({swept.time}) and closed back"
                           f"{' with displacement' if disp else ''}", "liquidity_sweep", *lv,
                     anchor)


def ict_2022(s: MarketSnapshot, r: IctRules = ICT) -> Candidate | None:
    """The ICT sequence described in IctRules, on the bar that just closed."""
    zone = ict.killzone(s.created_at, r.killzones_ny)
    if not zone:
        return None
    m15, h1, f = s.m15, s.h1, s.features
    atr, atr_h1 = float(f["atr14_m15"]), float(f["atr14_h1"])
    if atr <= 0:
        return None
    bias = ict.htf_bias(ict.resample_h4(h1, s.created_at))
    all_pools = ict.liquidity_pools(m15, h1)
    pools = [p for p in all_pools if ict.pool_kind(p.label) in r.sweep_pools]
    piv = swings(m15)
    n = len(m15) - 1
    for side in ("BUY", "SELL"):
        sign = 1 if side == "BUY" else -1
        if r.require_htf_bias and bias.direction != sign:
            continue
        entry = s.quote.ask if side == "BUY" else s.quote.bid
        if r.require_premium_discount and bias.direction == sign and \
                (entry - bias.equilibrium) * sign > 0:
            continue  # BUY only in discount, SELL only in premium

        def against(b):   # the extreme that hurts this side: low for BUY, high for SELL
            return b.low if side == "BUY" else b.high

        def beyond(a, b):  # a is further against us than b
            return a < b if side == "BUY" else a > b

        for sw_i in range(n - 1, max(0, n - r.max_setup_bars) - 1, -1):
            sweep = m15[sw_i]
            if any(beyond(against(b), against(sweep)) for b in m15[sw_i + 1:]):
                continue  # sweep extreme no longer protected
            taken = [p for p in pools
                     if p.side == ("low" if side == "BUY" else "high") and p.from_idx <= sw_i
                     and beyond(against(sweep), p.price) and ict.untaken(p, m15, h1, sw_i)]
            if not taken:
                continue
            ref = next((p for p in reversed(piv)
                        if p.kind == ("high" if side == "BUY" else "low")
                        and p.index + SWING_RIGHT < sw_i), None)
            if ref is None:
                continue
            mss = None
            for m in range(sw_i + 1, min(sw_i + r.mss_max_bars, n - 1) + 1):
                if (m15[m].close - ref.price) * sign > 0:
                    mss = m
                    break
            if mss is None or mss + 1 > n:
                continue
            bar = m15[mss]
            if (bar.close - bar.open) * sign < r.displacement_body_atr * atr:
                break  # MSS without displacement: this setup failed
            a, c = m15[mss - 1], m15[mss + 1]
            top, bottom = (c.low, a.high) if side == "BUY" else (a.low, c.high)
            if (top - bottom) < r.min_fvg_atr * atr:
                break  # no meaningful FVG
            # first return into the FVG, on the bar that just closed
            if n < mss + 2 or n - mss > r.entry_max_bars:
                break
            def touches(b):
                return b.low <= top if side == "BUY" else b.high >= bottom
            if any(touches(b) for b in m15[mss + 2:n]):
                break  # not the first touch
            last = m15[n]
            closed_through = last.close < bottom if side == "BUY" else last.close > top
            if not touches(last) or closed_through:
                break
            stop = round(against(sweep) - sign * r.stop_buffer_atr * atr, 2)
            risk = (entry - stop) * sign
            if risk <= 0 or risk > r.max_stop_atr * atr:
                break
            targets = sorted(
                (p for p in all_pools
                 if p.side == ("high" if side == "BUY" else "low") and p.from_idx <= n
                 and ict.untaken(p, m15, h1, n + 1)
                 and (p.price - entry) * sign >= r.min_target_rr * risk
                 and abs(p.price - entry) <= r.max_target_h1_atr * atr_h1),
                # nearest first; on a tie, the more significant pool names the target
                key=lambda p: (round(abs(p.price - entry), 2), TARGET_PRIORITY[ict.pool_kind(p.label)]))
            if not targets:
                break
            tgt = targets[0]
            swept = min(taken, key=lambda p: r.sweep_pools.index(ict.pool_kind(p.label)))
            anchor = Swing("low" if side == "BUY" else "high", tstr(sweep), against(sweep), sw_i)
            htf = {1: "bullish", -1: "bearish", 0: "no"}[bias.direction] + " H4 bias"
            if r.require_premium_discount and bias.direction == sign:
                htf += ", in discount" if side == "BUY" else ", in premium"
            reason = (f"ICT {side}: {htf}; {zone} killzone; "
                      f"swept {swept.label} {swept.price} at {tstr(sweep)}; MSS beyond "
                      f"{ref.price} at {tstr(bar)} with displacement; first return to FVG "
                      f"{round(bottom, 2)}-{round(top, 2)}; target {tgt.label} {tgt.price}")
            return Candidate(side, reason, "ict_2022", stop, round(tgt.price, 2), anchor)
    return None


SETUPS = {"ict_2022": ict_2022, "trend_breakout": trend_breakout,
          "liquidity_sweep": liquidity_sweep_setup}


def find_candidates(s: MarketSnapshot) -> list[Candidate]:
    if not window_open(s):
        return []
    atr = float(s.features["atr14_m15"])
    if atr <= 0 or float(s.features["spread"]) > MAX_SPREAD_TO_ATR * atr:
        return []
    out = []
    for name, fn in SETUPS.items():
        mode = STRATEGY_MODES.get(name, "off")
        if mode == "off":
            continue
        c = fn(s)
        if c is not None:
            out.append(Candidate(c.side, c.reason, c.strategy, c.stop, c.target, c.anchor, mode))
    return out


def find_candidate(s: MarketSnapshot) -> Candidate | None:
    """The first live candidate, if any."""
    return next((c for c in find_candidates(s) if c.mode == "live"), None)
