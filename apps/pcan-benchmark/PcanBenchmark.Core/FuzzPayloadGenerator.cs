namespace PcanBenchmark.Core;

public sealed class FuzzPayloadGenerator
{
    private readonly Random _random = new();

    public CanFrame NextFrame(byte dlc, bool extended)
    {
        var length = Math.Clamp(dlc, (byte)0, (byte)8);
        var data = new byte[8];
        _random.NextBytes(data);
        var id = extended
            ? (uint)_random.NextInt64(0, 0x1FFFFFFF + 1L)
            : (uint)_random.Next(0, 0x7FF + 1);
        return new CanFrame(id, data, length, extended);
    }
}
