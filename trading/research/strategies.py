"""The four pre-registered candidates from RESEARCH_PLAN.md. Rules are frozen."""
import numpy as np
import pandas as pd

from engine import Strategy


def atr(bars, n):
    pc = bars.close.shift()
    tr = pd.concat([bars.high - bars.low, (bars.high - pc).abs(), (bars.low - pc).abs()], axis=1).max(axis=1)
    return tr.rolling(n).mean().to_numpy()


def rsi_wilder(close, n):
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return (100 - 100 / (1 + up / dn)).to_numpy()


class C1H4Trend(Strategy):
    """H4TrendBot defaults. Run on H4 bars."""
    def prepare(self, b):
        self.warmup = 220
        c = b.close
        self.f = c.ewm(span=50, adjust=False).mean().to_numpy()
        self.s = c.ewm(span=200, adjust=False).mean().to_numpy()
        self.a = atr(b, 14)
        self.dh = b.high.shift(1).rolling(20).max().to_numpy()
        self.dl = b.low.shift(1).rolling(20).min().to_numpy()
        self.h, self.l, self.c = b.high.to_numpy(), b.low.to_numpy(), c.to_numpy()

    def on_bar(self, k, pos):
        a = self.a[k]
        if not a > 0:
            return None
        if pos is not None:
            if pos["side"] == 1:
                pos["ext"] = max(pos.get("ext", self.h[k]), self.h[k])
                return {"stop": pos["ext"] - 3.0 * a}
            pos["ext"] = min(pos.get("ext", self.l[k]), self.l[k])
            return {"stop": pos["ext"] + 3.0 * a}
        if self.f[k] > self.s[k] and self.c[k] > self.dh[k]:
            return {"enter": 1, "stop_dist": 2.0 * a}
        if self.f[k] < self.s[k] and self.c[k] < self.dl[k]:
            return {"enter": -1, "stop_dist": 2.0 * a}
        return None


class C2GoldAsia(Strategy):
    """Long from server 01:00 to 10:00 on weekdays. Run on H1 bars."""
    def prepare(self, b):
        self.warmup = 24 * 20
        d1 = b.resample("1D").agg(dict(open="first", high="max", low="min", close="last")).dropna()
        d_atr = pd.Series(atr(d1, 14), index=d1.index).shift(1)  # yesterday's ATR, known today
        self.datr = d_atr.reindex(b.index.normalize()).to_numpy()
        self.hour = b.index.hour.to_numpy()
        self.dow = b.index.dayofweek.to_numpy()

    def on_bar(self, k, pos):
        # bar k closes at hour+1: hour 0 bar close = 01:00 open of the next bar
        if pos is None and self.hour[k] == 0 and self.dow[k] < 5 and self.datr[k] > 0:
            return {"enter": 1, "stop_dist": 2.0 * self.datr[k]}
        if pos is not None and self.hour[k] == 9:
            return {"exit": True}
        return None


class C3Turtle(Strategy):
    """55-day breakout entry, 20-day opposite breakout exit, 2N stop. Run on D1 bars."""
    def prepare(self, b):
        self.warmup = 60
        self.a = atr(b, 20)
        self.h55 = b.high.shift(1).rolling(55).max().to_numpy()
        self.l55 = b.low.shift(1).rolling(55).min().to_numpy()
        self.h20 = b.high.shift(1).rolling(20).max().to_numpy()
        self.l20 = b.low.shift(1).rolling(20).min().to_numpy()
        self.c = b.close.to_numpy()

    def on_bar(self, k, pos):
        c = self.c[k]
        if pos is not None:
            if (pos["side"] == 1 and c < self.l20[k]) or (pos["side"] == -1 and c > self.h20[k]):
                return {"exit": True}
            return None
        if not self.a[k] > 0:
            return None
        if c > self.h55[k]:
            return {"enter": 1, "stop_dist": 2.0 * self.a[k]}
        if c < self.l55[k]:
            return {"enter": -1, "stop_dist": 2.0 * self.a[k]}
        return None


class C4RSI2(Strategy):
    """Connors RSI(2) pullback with SMA200 trend filter, SMA5 exit, 3xATR stop. Run on D1 bars."""
    def prepare(self, b):
        self.warmup = 205
        c = b.close
        self.sma200 = c.rolling(200).mean().to_numpy()
        self.sma5 = c.rolling(5).mean().to_numpy()
        self.r = rsi_wilder(c, 2)
        self.a = atr(b, 14)
        self.c = c.to_numpy()

    def on_bar(self, k, pos):
        c = self.c[k]
        if pos is not None:
            if (pos["side"] == 1 and c > self.sma5[k]) or (pos["side"] == -1 and c < self.sma5[k]):
                return {"exit": True}
            return None
        if not self.a[k] > 0:
            return None
        if c > self.sma200[k] and self.r[k] < 10:
            return {"enter": 1, "stop_dist": 3.0 * self.a[k]}
        if c < self.sma200[k] and self.r[k] > 90:
            return {"enter": -1, "stop_dist": 3.0 * self.a[k]}
        return None


CANDIDATES = {
    "C1_H4_trend": (C1H4Trend, "4h", ("gold", "wti")),
    "C2_gold_asia": (C2GoldAsia, "1h", ("gold",)),
    "C3_turtle_D1": (C3Turtle, "1D", ("gold", "wti")),
    "C4_rsi2_D1": (C4RSI2, "1D", ("gold", "wti")),
}


class R2aGoldAsiaCore(Strategy):
    """Round 2: long gold from server 03:00 to 06:00 on weekdays. Run on H1 bars.
    Robust to missing hourly bars: enters on the first bar closing in [03:00, 06:00),
    exits on the first bar closing at or after 06:00."""
    entry_h, exit_h = 3, 6

    def prepare(self, b):
        self.warmup = 24 * 20
        d1 = b.resample("1D").agg(dict(open="first", high="max", low="min", close="last")).dropna()
        d_atr = pd.Series(atr(d1, 14), index=d1.index).shift(1)
        self.datr = d_atr.reindex(b.index.normalize()).to_numpy()
        close_t = b.index + pd.Timedelta(hours=1)
        self.ch = close_t.hour.to_numpy()
        self.day = b.index.normalize().to_numpy()
        self.dow = b.index.dayofweek.to_numpy()
        self.done_day = None

    def on_bar(self, k, pos):
        if pos is None and self.dow[k] < 5 and self.entry_h <= self.ch[k] < self.exit_h \
                and self.done_day != self.day[k] and self.datr[k] > 0:
            self.done_day = self.day[k]
            return {"enter": 1, "stop_dist": 2.0 * self.datr[k]}
        if pos is not None and (self.ch[k] >= self.exit_h or self.day[k] != self.done_day):
            return {"exit": True}
        return None


CANDIDATES["R2a_gold_asia_core"] = (R2aGoldAsiaCore, "1h", ("gold",))
