using System.Text;
using PcanBenchmark.Core;
using Peak.Can.Basic;
using static Peak.Can.Basic.PCANBasic;

namespace PcanBenchmark.App;

internal sealed class PcanBasicTransport : IPcanTransport
{
    private readonly object _sync = new();
    private CancellationTokenSource? _readCts;
    private Task? _readTask;
    private ulong? _lastTimestampUs;

    public event EventHandler<FrameRecord>? FrameReceived;

    public bool IsConnected { get; private set; }
    public PcanChannel? ConnectedChannel { get; private set; }
    public PcanBitrate? CurrentBitrate { get; private set; }

    public IReadOnlyList<PcanChannel> ListChannels()
    {
        var status = GetValue(PCAN_NONEBUS, TPCANParameter.PCAN_ATTACHED_CHANNELS_COUNT, out uint count, sizeof(uint));
        if (status != TPCANStatus.PCAN_ERROR_OK || count == 0)
        {
            return Array.Empty<PcanChannel>();
        }

        var channels = new TPCANChannelInformation[count];
        status = GetValue(PCAN_NONEBUS, TPCANParameter.PCAN_ATTACHED_CHANNELS, channels);
        if (status != TPCANStatus.PCAN_ERROR_OK)
        {
            return Array.Empty<PcanChannel>();
        }

        return channels
            .Select(channel => new PcanChannel(
                channel.channel_handle,
                $"{channel.device_name} 0x{channel.channel_handle:X}",
                channel.device_name,
                channel.device_id,
                channel.channel_condition))
            .ToArray();
    }

    public void Connect(PcanChannel channel, PcanBitrate bitrate)
    {
        lock (_sync)
        {
            DisconnectInternal();
            var status = Initialize(channel.Handle, ToPcanBaudrate(bitrate));
            if (status != TPCANStatus.PCAN_ERROR_OK)
            {
                throw new InvalidOperationException(FormatStatus(status));
            }

            ConnectedChannel = channel;
            CurrentBitrate = bitrate;
            IsConnected = true;
            _lastTimestampUs = null;
            StartReadLoop(channel.Handle);
        }
    }

    public void SetBitrate(PcanBitrate bitrate)
    {
        if (!IsConnected || ConnectedChannel is null)
        {
            throw new InvalidOperationException("No channel connected.");
        }

        Connect(ConnectedChannel, bitrate);
    }

    public void Disconnect()
    {
        lock (_sync)
        {
            DisconnectInternal();
        }
    }

    public void SendFrame(CanFrame frame)
    {
        if (!IsConnected || ConnectedChannel is null)
        {
            throw new InvalidOperationException("No channel connected.");
        }

        var msg = new TPCANMsg
        {
            ID = frame.Id,
            LEN = frame.Dlc,
            MSGTYPE = frame.Extended ? TPCANMessageType.PCAN_MESSAGE_EXTENDED : TPCANMessageType.PCAN_MESSAGE_STANDARD,
            DATA = frame.GetPayload(frame.Dlc)
        };

        var status = Write(ConnectedChannel.Handle, ref msg);
        if (status != TPCANStatus.PCAN_ERROR_OK)
        {
            throw new InvalidOperationException(FormatStatus(status));
        }
    }

    public void Dispose()
    {
        Disconnect();
    }

    private void StartReadLoop(ushort handle)
    {
        _readCts = new CancellationTokenSource();
        _readTask = Task.Run(() => ReadLoop(handle, _readCts.Token));
    }

    private void DisconnectInternal()
    {
        _readCts?.Cancel();
        _readTask?.Wait(TimeSpan.FromSeconds(1));
        _readCts?.Dispose();
        _readCts = null;
        _readTask = null;

        if (ConnectedChannel is not null)
        {
            Uninitialize(ConnectedChannel.Handle);
        }

        ConnectedChannel = null;
        CurrentBitrate = null;
        IsConnected = false;
    }

    private void ReadLoop(ushort handle, CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            var status = Read(handle, out TPCANMsg msg, out TPCANTimestamp timestamp);
            if (status == TPCANStatus.PCAN_ERROR_QRCVEMPTY)
            {
                Thread.Sleep(1);
                continue;
            }
            if (status != TPCANStatus.PCAN_ERROR_OK)
            {
                Thread.Sleep(5);
                continue;
            }

            var deltaMs = CalculateDeltaMs(timestamp);
            var payloadHex = FormatPayload(msg.DATA, msg.LEN);
            var record = new FrameRecord(
                DateTime.UtcNow,
                deltaMs,
                FormatId(msg.ID, msg.MSGTYPE),
                msg.LEN,
                payloadHex,
                ConnectedChannel?.Name ?? "PCAN");

            FrameReceived?.Invoke(this, record);
        }
    }

    private double CalculateDeltaMs(TPCANTimestamp timestamp)
    {
        var totalMicros = (ulong)timestamp.micros +
                          (1000UL * timestamp.millis) +
                          (0x100000000UL * 1000UL * timestamp.millis_overflow);
        if (_lastTimestampUs is null)
        {
            _lastTimestampUs = totalMicros;
            return 0;
        }
        var deltaUs = totalMicros - _lastTimestampUs.Value;
        _lastTimestampUs = totalMicros;
        return deltaUs / 1000.0;
    }

    private static string FormatPayload(byte[] data, byte dlc)
    {
        var length = Math.Clamp(dlc, (byte)0, (byte)8);
        if (length == 0 || data.Length == 0)
        {
            return string.Empty;
        }
        return BitConverter.ToString(data, 0, length).Replace("-", " ");
    }

    private static string FormatId(uint id, TPCANMessageType type)
    {
        var extended = (type & TPCANMessageType.PCAN_MESSAGE_EXTENDED) != 0;
        return extended ? $"0x{id:X8}" : $"0x{id:X3}";
    }

    private static string FormatStatus(TPCANStatus status)
    {
        var buffer = new StringBuilder(256);
        var result = GetErrorText(status, 0x09, buffer);
        if (result != TPCANStatus.PCAN_ERROR_OK)
        {
            return $"PCAN error 0x{((uint)status):X}";
        }
        return buffer.ToString();
    }

    private static TPCANBaudrate ToPcanBaudrate(PcanBitrate bitrate)
    {
        return bitrate switch
        {
            PcanBitrate.Bps125K => TPCANBaudrate.PCAN_BAUD_125K,
            PcanBitrate.Bps250K => TPCANBaudrate.PCAN_BAUD_250K,
            PcanBitrate.Bps500K => TPCANBaudrate.PCAN_BAUD_500K,
            PcanBitrate.Bps1M => TPCANBaudrate.PCAN_BAUD_1M,
            _ => TPCANBaudrate.PCAN_BAUD_500K,
        };
    }
}
