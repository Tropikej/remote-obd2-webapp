using PcanBenchmark.Core;

namespace PcanBenchmark.App;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();

        var simulate = args.Any(arg => string.Equals(arg, "--simulate", StringComparison.OrdinalIgnoreCase));
        IPcanTransport transport;

        if (simulate)
        {
            transport = new SimulatedPcanTransport();
        }
        else
        {
            if (!PcanBasicLoader.TryLoad(out var error))
            {
                MessageBox.Show(error, "PCAN Basic", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            transport = new PcanBasicTransport();
        }

        Application.Run(new MainForm(transport, simulate));
    }
}
