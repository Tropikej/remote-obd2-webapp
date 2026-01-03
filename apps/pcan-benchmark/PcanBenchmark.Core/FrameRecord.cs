namespace PcanBenchmark.Core;

public sealed record FrameRecord(
    DateTime TimestampUtc,
    double DeltaMs,
    string CanIdHex,
    byte Dlc,
    string PayloadHex,
    string ChannelName)
{
    public string Timestamp => TimestampUtc.ToString("HH:mm:ss.fff");
}
