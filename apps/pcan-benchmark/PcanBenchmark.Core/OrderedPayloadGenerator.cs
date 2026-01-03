namespace PcanBenchmark.Core;

public sealed class OrderedPayloadGenerator
{
    private readonly byte[] _payload = new byte[8];

    public CanFrame NextFrame(uint baseId, byte dlc, bool extended)
    {
        var data = NextPayload(dlc);
        return new CanFrame(baseId, data, dlc, extended);
    }

    public byte[] NextPayload(byte dlc)
    {
        var length = Math.Clamp(dlc, (byte)0, (byte)8);
        var snapshot = new byte[8];
        Array.Copy(_payload, snapshot, 8);
        Increment(length);
        return snapshot;
    }

    private void Increment(int length)
    {
        if (length <= 0)
        {
            return;
        }

        for (var i = 0; i < length; i += 1)
        {
            if (_payload[i] == 0xFF)
            {
                _payload[i] = 0x00;
                continue;
            }

            _payload[i] += 1;
            break;
        }
    }
}
