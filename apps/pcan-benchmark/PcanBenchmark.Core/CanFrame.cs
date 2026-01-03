namespace PcanBenchmark.Core;

public sealed record CanFrame(uint Id, byte[] Data, byte Dlc, bool Extended)
{
    public byte[] GetPayload(int length)
    {
        var payload = new byte[8];
        if (Data.Length > 0)
        {
            Array.Copy(Data, payload, Math.Min(8, Data.Length));
        }
        return payload;
    }
}
