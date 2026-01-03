using System.Diagnostics;
using FlaUI.Core;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Definitions;
using FlaUI.Core.Tools;
using FlaUI.UIA3;
using Xunit;

namespace PcanBenchmark.E2E;

public class UiTests
{
    [Fact]
    public void SimulatedSessionDisplaysFrames()
    {
        var appPath = ResolveAppPath();
        using var app = Application.Launch(new ProcessStartInfo(appPath, "--simulate")
        {
            UseShellExecute = true
        });
        using var automation = new UIA3Automation();

        var window = Retry.WhileNull(
            () => app.GetMainWindow(automation),
            timeout: TimeSpan.FromSeconds(5)).Result;
        Assert.NotNull(window);

        var channelCombo = window.FindFirstDescendant(cf => cf.ByAutomationId("channelCombo"))?.AsComboBox();
        Assert.NotNull(channelCombo);

        var connectButton = window.FindFirstDescendant(cf => cf.ByAutomationId("connectButton"))?.AsButton();
        Assert.NotNull(connectButton);
        connectButton!.Invoke();

        var statusLabel = window.FindFirstDescendant(cf => cf.ByAutomationId("statusLabel"))?.AsLabel();
        Assert.NotNull(statusLabel);
        Retry.WhileFalse(
            () => statusLabel!.Text.Contains("Connected", StringComparison.OrdinalIgnoreCase),
            timeout: TimeSpan.FromSeconds(5));

        var startButton = window.FindFirstDescendant(cf => cf.ByAutomationId("startSendButton"))?.AsButton();
        Assert.NotNull(startButton);
        startButton!.Invoke();

        var frameCountLabel = window.FindFirstDescendant(cf => cf.ByAutomationId("frameCountLabel"))?.AsLabel();
        Assert.NotNull(frameCountLabel);

        var framesAppeared = Retry.WhileFalse(
            () => !string.Equals(frameCountLabel!.Text, "Frames: 0", StringComparison.OrdinalIgnoreCase),
            timeout: TimeSpan.FromSeconds(8));

        Assert.True(framesAppeared.Result, "No frames were received in simulated mode.");

        app.Close();
    }

    private static string ResolveAppPath()
    {
        var root = FindRepoRoot();
        var candidates = new[]
        {
            Path.Combine(root, "apps", "pcan-benchmark", "PcanBenchmark.App", "bin", "x64", "Debug", "net8.0-windows", "PcanBenchmark.App.exe"),
            Path.Combine(root, "apps", "pcan-benchmark", "PcanBenchmark.App", "bin", "Debug", "net8.0-windows", "PcanBenchmark.App.exe"),
        };

        foreach (var candidate in candidates)
        {
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new FileNotFoundException("PcanBenchmark.App.exe not found. Build the app before running E2E tests.");
    }

    private static string FindRepoRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current != null)
        {
            var planPath = Path.Combine(current.FullName, "apps", "pcan-benchmark", "PcanBenchmark.sln");
            if (File.Exists(planPath))
            {
                return current.FullName;
            }
            current = current.Parent;
        }

        throw new DirectoryNotFoundException("Repository root not found.");
    }
}
