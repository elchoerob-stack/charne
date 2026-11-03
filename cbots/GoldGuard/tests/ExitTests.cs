// Unit tests for ExitMath.DesiredStop: break-even, ATR trail, and the runner exit
// (lock most of the target, then trail close behind price instead of taking profit).

using System;
using cAlgo.Robots;

internal static class ExitTests
{
    private static int _failures;

    private static void Check(string name, bool ok, string detail = "")
    {
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + name + (ok || detail == "" ? "" : "  -> " + detail));
        if (!ok) _failures++;
    }

    private static bool Close(double a, double b) => Math.Abs(a - b) < 1e-9;

    // Bot defaults: BE at 1R locking 0.1R; ATR trail from 1.5R at 1.5 ATR;
    // runner locks 80% of the target and trails 0.6 ATR behind price.
    private static ExitRules Rules(bool runner = true) => new ExitRules
    {
        BreakEvenAtR = 1.0, BreakEvenLockR = 0.1,
        Trail = true, TrailStartR = 1.5, TrailAtrMult = 1.5,
        Runner = runner, RunnerLock = 0.8, RunnerTrailAtr = 0.6,
    };

    internal static int Run()
    {
        Console.WriteLine("\n-- Exit management --");
        // Buy at 100, stop 90 (1R = 10), target 120 (2R), ATR 4.
        const double E = 100, R = 10, T = 20, A = 4;
        var rules = Rules();
        bool at;

        double s1 = ExitMath.DesiredStop(true, E, 105, 90, R, T, A, rules, out at);
        Check("0.5R in profit: stop stays at 90", Close(s1, 90) && !at, s1.ToString());

        double s2 = ExitMath.DesiredStop(true, E, 110, 90, R, T, A, rules, out at);
        Check("1R: break-even + 0.1R = 101", Close(s2, 101), s2.ToString());

        double s3 = ExitMath.DesiredStop(true, E, 116, 101, R, T, A, rules, out at);
        Check("1.6R: ATR trail 116 - 1.5x4 = 110", Close(s3, 110) && !at, s3.ToString());

        double s4 = ExitMath.DesiredStop(true, E, 120, 110, R, T, A, rules, out at);
        Check("target hit: runner on, close trail 120 - 0.6x4 = 117.6 (above the 116 lock)", Close(s4, 117.6) && at, s4 + " at=" + at);

        double s5 = ExitMath.DesiredStop(true, E, 130, 117.6, R, T, A, rules, out at);
        Check("price runs to 130: stop follows to 127.6", Close(s5, 127.6) && at, s5.ToString());

        double s6 = ExitMath.DesiredStop(true, E, 128.5, 127.6, R, T, A, rules, out at);
        Check("pull-back to 128.5: stop never loosens (stays 127.6)", Close(s6, 127.6), s6.ToString());

        double s7 = ExitMath.DesiredStop(true, E, 135, 90, R, T, A, rules, out at);
        Check("first look already past target (gap): straight to 135 - 2.4 = 132.6", Close(s7, 132.6) && at, s7.ToString());

        // Wide ATR: the close trail would sit below the lock, so the lock wins.
        double s8 = ExitMath.DesiredStop(true, E, 120, 101, R, T, 10, rules, out at);
        Check("wide ATR at target: 80% lock (116) beats trail (114)", Close(s8, 116) && at, s8.ToString());

        // Runner off: no lock at target; only the normal ATR trail (fixed TP closes it).
        var fixedTp = Rules(runner: false);
        double s9 = ExitMath.DesiredStop(true, E, 130, 110, R, T, A, fixedTp, out at);
        Check("runner off: plain ATR trail 130 - 6 = 124, no runner state", Close(s9, 124) && !at, s9 + " at=" + at);

        // Sell: entry 100, stop 110, target 80.
        double b1 = ExitMath.DesiredStop(false, E, 90, 110, R, T, A, rules, out at);
        Check("sell 1R: break-even - 0.1R = 99", Close(b1, 99), b1.ToString());
        double b2 = ExitMath.DesiredStop(false, E, 80, 99, R, T, A, rules, out at);
        Check("sell target hit: 80 + 2.4 = 82.4", Close(b2, 82.4) && at, b2.ToString());
        double b3 = ExitMath.DesiredStop(false, E, 70, 82.4, R, T, A, rules, out at);
        Check("sell runs to 70: stop follows down to 72.4", Close(b3, 72.4), b3.ToString());
        double b4 = ExitMath.DesiredStop(false, E, 71.5, 72.4, R, T, A, rules, out at);
        Check("sell pull-back: stop never loosens (stays 72.4)", Close(b4, 72.4), b4.ToString());

        // Missing target (old position comment): runner can't fire; nothing breaks.
        double n1 = ExitMath.DesiredStop(true, E, 130, 110, R, double.NaN, A, rules, out at);
        Check("unknown target: falls back to the ATR trail", Close(n1, 124) && !at, n1.ToString());

        // Bad input never moves the stop.
        double z = ExitMath.DesiredStop(true, E, 130, 90, 0, T, A, rules, out at);
        Check("zero stop distance: stop untouched", Close(z, 90) && !at, z.ToString());

        return _failures;
    }
}
