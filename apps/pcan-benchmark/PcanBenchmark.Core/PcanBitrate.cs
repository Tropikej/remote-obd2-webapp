namespace PcanBenchmark.Core;

public enum PcanBitrate
{
    Bps125K,
    Bps250K,
    Bps500K,
    Bps1M,
}

public sealed record PcanBitrateOption(string Label, PcanBitrate Value)
{
    public override string ToString() => Label;
}
