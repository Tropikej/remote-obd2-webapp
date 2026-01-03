using System.Diagnostics;
using System.Threading;

namespace PcanBenchmark.Core;

public sealed class SimulatedPcanTransport : IPcanTransport
{
    private readonly Random _random = new();
    private readonly Stopwatch _stopwatch = new();
    private Timer? _timer;
    private long _lastTick;

    public event EventHandler<FrameRecord>? FrameReceived;

    public bool IsConnected { get; private set; }
    public PcanChannel? ConnectedChannel { get; private set; }
    public PcanBitrate? CurrentBitrate { get; private set; }

    public IReadOnlyList<PcanChannel> ListChannels()
    {
        return new[]
        {
            new PcanChannel(1, "SIM-USB1", "Simulated", 1, 1)
        };
    }

    public void Connect(PcanChannel channel, PcanBitrate bitrate)
    {
        Disconnect();
        ConnectedChannel = channel;
        CurrentBitrate = bitrate;
        IsConnected = true;
        _stopwatch.Restart();
        _lastTick = 0;
        _timer = new Timer(_ => EmitRandomFrame(), null, TimeSpan.Zero, TimeSpan.FromMilliseconds(100));
    }

    public void SetBitrate(PcanBitrate bitrate)
    {
        if (!IsConnected)
        {
            throw new InvalidOperationException("No channel connected.");
        }

        CurrentBitrate = bitrate;
    }

    public void Disconnect()
    {
        _timer?.Dispose();
        _timer = null;
        IsConnected = false;
        ConnectedChannel = null;
        CurrentBitrate = null;
        _stopwatch.Reset();
        _lastTick = 0;
    }

    public void SendFrame(CanFrame frame)
    {
        if (!IsConnected || ConnectedChannel is null)
        {
            throw new InvalidOperationException("No channel connected.");
        }

        EmitFrame(frame.Id, frame.Dlc, frame.Data);
    }

    public void Dispose()
    {
        Disconnect();
    }

    private void EmitRandomFrame()
    {
        if (!IsConnected || ConnectedChannel is null)
        {
            return;
        }

        var data = new byte[8];
        _random.NextBytes(data);
        var id = (uint)_random.Next(0, 0x7FF + 1);
        EmitFrame(id, 8, data);
    }

    private void EmitFrame(uint id, byte dlc, byte[] data)
    {
        var now = _stopwatch.ElapsedTicks;
        var deltaTicks = _lastTick == 0 ? 0 : now - _lastTick;
        _lastTick = now;
        var deltaMs = deltaTicks == 0 ? 0 : deltaTicks * 1000.0 / Stopwatch.Frequency;

        var payloadHex = FormatPayload(data, dlc);
        var record = new FrameRecord(
            DateTime.UtcNow,
            deltaMs,
            $"0x{id:X}",
            dlc,
            payloadHex,
            ConnectedChannel?.Name ?? "SIM");

        FrameReceived?.Invoke(this, record);
    }

    private static string FormatPayload(byte[] data, byte dlc)
    {
        var length = Math.Clamp(dlc, (byte)0, (byte)8);
        if (length == 0)
        {
            return string.Empty;
        }
        return BitConverter.ToString(data, 0, length).Replace("-", " ");
    }
}
