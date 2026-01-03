namespace PcanBenchmark.Core;

public sealed record PcanChannel(ushort Handle, string Name, string DeviceName, uint DeviceId, uint Condition)
{
    public string DisplayName => $"{Name} ({DeviceName} #{DeviceId}) - {ConditionLabel}";
    public string ConditionLabel => Condition switch
    {
        1 => "Available",
        2 => "Occupied",
        3 => "In Use",
        _ => "Unavailable",
    };
}
