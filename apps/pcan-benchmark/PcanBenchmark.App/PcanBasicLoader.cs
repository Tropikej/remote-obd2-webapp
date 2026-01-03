using System.Runtime.InteropServices;

namespace PcanBenchmark.App;

internal static class PcanBasicLoader
{
    private const string DefaultBaseDir = @"E:\Projets\STM32\workspace\PCAN-Basic";

    internal static bool TryLoad(out string error)
    {
        var baseDir = Environment.GetEnvironmentVariable("PCAN_BASIC_DIR");
        if (string.IsNullOrWhiteSpace(baseDir))
        {
            baseDir = DefaultBaseDir;
        }

        var dllPath = Path.Combine(baseDir, "x64", "PCANBasic.dll");
        if (!File.Exists(dllPath))
        {
            error = "PCANBasic.dll not found. Set PCAN_BASIC_DIR or place the DLL in the output folder. " +
                    $"Missing: {dllPath}";
            return false;
        }

        try
        {
            NativeLibrary.Load(dllPath);
            error = string.Empty;
            return true;
        }
        catch (Exception ex)
        {
            error = $"Failed to load PCANBasic.dll: {ex.Message}";
            return false;
        }
    }
}
