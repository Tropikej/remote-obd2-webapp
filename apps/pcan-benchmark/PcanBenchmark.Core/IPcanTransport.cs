namespace PcanBenchmark.Core;

public interface IPcanTransport : IDisposable
{
    event EventHandler<FrameRecord>? FrameReceived;

    IReadOnlyList<PcanChannel> ListChannels();
    bool IsConnected { get; }
    PcanChannel? ConnectedChannel { get; }
    PcanBitrate? CurrentBitrate { get; }

    void Connect(PcanChannel channel, PcanBitrate bitrate);
    void SetBitrate(PcanBitrate bitrate);
    void Disconnect();
    void SendFrame(CanFrame frame);
}
