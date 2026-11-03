// Runs every GoldGuard v3 unit test. Exit code 0 when all pass.
//
//   cd cbots/GoldGuard/tests && dotnet run

using System;

internal static class Program
{
    private static int Main()
    {
        int failures = HarmonicTests.Run() + ExitTests.Run();
        Console.WriteLine(failures == 0 ? "\nAll tests passed." : "\n" + failures + " test(s) FAILED.");
        return failures == 0 ? 0 : 1;
    }
}
