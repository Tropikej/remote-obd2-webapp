using System.ComponentModel;
using PcanBenchmark.Core;

namespace PcanBenchmark.App;

public sealed class MainForm : Form
{
    private const int MaxFrames = 1000;

    private readonly IPcanTransport _transport;
    private readonly OrderedPayloadGenerator _orderedGenerator = new();
    private readonly FuzzPayloadGenerator _fuzzGenerator = new();
    private readonly BindingList<FrameRecord> _frames = new();

    private readonly ComboBox _channelCombo = new();
    private readonly ComboBox _bitrateCombo = new();
    private readonly Button _refreshButton = new();
    private readonly Button _connectButton = new();
    private readonly Button _applyBitrateButton = new();
    private readonly Button _disconnectButton = new();
    private readonly Label _statusLabel = new();
    private readonly Label _frameCountLabel = new();

    private readonly ComboBox _sendModeCombo = new();
    private readonly TextBox _canIdText = new();
    private readonly NumericUpDown _dlcInput = new();
    private readonly NumericUpDown _delayInput = new();
    private readonly CheckBox _extendedCheck = new();
    private readonly Button _startSendButton = new();
    private readonly Button _stopSendButton = new();

    private readonly DataGridView _frameGrid = new();

    private CancellationTokenSource? _sendCts;

    public MainForm(IPcanTransport transport, bool simulate)
    {
        _transport = transport;
        Text = simulate ? "PCAN Benchmark (Simulated)" : "PCAN Benchmark";
        Width = 980;
        Height = 720;
        StartPosition = FormStartPosition.CenterScreen;

        BuildLayout();
        WireEvents();
        LoadBitrates();
        LoadChannels();

        UpdateStatus(simulate ? "Simulation mode enabled." : "Ready.");
    }

    private void BuildLayout()
    {
        var mainLayout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 3,
        };
        mainLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        mainLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        mainLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var connectionGroup = new GroupBox
        {
            Text = "Connection",
            Dock = DockStyle.Fill,
            Padding = new Padding(10),
        };
        var connectionFlow = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            WrapContents = true,
        };

        _channelCombo.Name = "channelCombo";
        _channelCombo.AccessibleName = "Channel";
        _channelCombo.Width = 280;

        _bitrateCombo.Name = "bitrateCombo";
        _bitrateCombo.AccessibleName = "Bitrate";
        _bitrateCombo.Width = 140;

        _refreshButton.Text = "Refresh";
        _refreshButton.Name = "refreshButton";
        _connectButton.Text = "Connect";
        _connectButton.Name = "connectButton";
        _applyBitrateButton.Text = "Apply Bitrate";
        _applyBitrateButton.Name = "applyBitrateButton";
        _applyBitrateButton.Enabled = false;
        _disconnectButton.Text = "Disconnect";
        _disconnectButton.Name = "disconnectButton";
        _disconnectButton.Enabled = false;

        _statusLabel.AutoSize = true;
        _statusLabel.Margin = new Padding(10, 8, 0, 0);
        _statusLabel.Name = "statusLabel";
        _statusLabel.AccessibleName = "Status";
        _frameCountLabel.AutoSize = true;
        _frameCountLabel.Margin = new Padding(10, 8, 0, 0);
        _frameCountLabel.Name = "frameCountLabel";
        _frameCountLabel.AccessibleName = "Frame Count";
        _frameCountLabel.Text = "Frames: 0";

        connectionFlow.Controls.Add(new Label { Text = "Channel", AutoSize = true, Margin = new Padding(0, 8, 4, 0) });
        connectionFlow.Controls.Add(_channelCombo);
        connectionFlow.Controls.Add(new Label { Text = "Bitrate", AutoSize = true, Margin = new Padding(10, 8, 4, 0) });
        connectionFlow.Controls.Add(_bitrateCombo);
        connectionFlow.Controls.Add(_refreshButton);
        connectionFlow.Controls.Add(_connectButton);
        connectionFlow.Controls.Add(_applyBitrateButton);
        connectionFlow.Controls.Add(_disconnectButton);
        connectionFlow.Controls.Add(_statusLabel);
        connectionFlow.Controls.Add(_frameCountLabel);
        connectionGroup.Controls.Add(connectionFlow);

        var sendGroup = new GroupBox
        {
            Text = "Send",
            Dock = DockStyle.Fill,
            Padding = new Padding(10),
        };
        var sendLayout = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            WrapContents = true,
        };

        _sendModeCombo.Name = "sendModeCombo";
        _sendModeCombo.AccessibleName = "Send Mode";
        _sendModeCombo.Width = 120;
        _sendModeCombo.DropDownStyle = ComboBoxStyle.DropDownList;
        _sendModeCombo.Items.AddRange(new object[] { "Ordered", "Fuzz" });
        _sendModeCombo.SelectedIndex = 0;

        _canIdText.Name = "canIdText";
        _canIdText.AccessibleName = "CAN ID";
        _canIdText.Width = 120;
        _canIdText.Text = "0x100";

        _dlcInput.Name = "dlcInput";
        _dlcInput.AccessibleName = "DLC";
        _dlcInput.Width = 60;
        _dlcInput.Minimum = 0;
        _dlcInput.Maximum = 8;
        _dlcInput.Value = 8;

        _delayInput.Name = "delayInput";
        _delayInput.AccessibleName = "Delay (ms)";
        _delayInput.Width = 80;
        _delayInput.Minimum = 1;
        _delayInput.Maximum = 5000;
        _delayInput.Value = 100;

        _extendedCheck.Text = "Extended";
        _extendedCheck.Name = "extendedCheck";
        _extendedCheck.AccessibleName = "Extended";

        _startSendButton.Text = "Start Sending";
        _startSendButton.Name = "startSendButton";
        _startSendButton.Enabled = false;

        _stopSendButton.Text = "Stop Sending";
        _stopSendButton.Name = "stopSendButton";
        _stopSendButton.Enabled = false;

        sendLayout.Controls.Add(new Label { Text = "Mode", AutoSize = true, Margin = new Padding(0, 8, 4, 0) });
        sendLayout.Controls.Add(_sendModeCombo);
        sendLayout.Controls.Add(new Label { Text = "CAN ID", AutoSize = true, Margin = new Padding(10, 8, 4, 0) });
        sendLayout.Controls.Add(_canIdText);
        sendLayout.Controls.Add(new Label { Text = "DLC", AutoSize = true, Margin = new Padding(10, 8, 4, 0) });
        sendLayout.Controls.Add(_dlcInput);
        sendLayout.Controls.Add(new Label { Text = "Delay (ms)", AutoSize = true, Margin = new Padding(10, 8, 4, 0) });
        sendLayout.Controls.Add(_delayInput);
        sendLayout.Controls.Add(_extendedCheck);
        sendLayout.Controls.Add(_startSendButton);
        sendLayout.Controls.Add(_stopSendButton);
        sendGroup.Controls.Add(sendLayout);

        _frameGrid.Name = "frameGrid";
        _frameGrid.AccessibleName = "Frame Grid";
        _frameGrid.Dock = DockStyle.Fill;
        _frameGrid.AutoGenerateColumns = false;
        _frameGrid.AllowUserToAddRows = false;
        _frameGrid.AllowUserToDeleteRows = false;
        _frameGrid.ReadOnly = true;
        _frameGrid.DataSource = _frames;
        _frameGrid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Timestamp", DataPropertyName = nameof(FrameRecord.Timestamp), Width = 140 });
        _frameGrid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Delta (ms)", DataPropertyName = nameof(FrameRecord.DeltaMs), Width = 90 });
        _frameGrid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "CAN ID", DataPropertyName = nameof(FrameRecord.CanIdHex), Width = 90 });
        _frameGrid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "DLC", DataPropertyName = nameof(FrameRecord.Dlc), Width = 60 });
        _frameGrid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Payload", DataPropertyName = nameof(FrameRecord.PayloadHex), Width = 260 });
        _frameGrid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Channel", DataPropertyName = nameof(FrameRecord.ChannelName), Width = 140 });

        mainLayout.Controls.Add(connectionGroup, 0, 0);
        mainLayout.Controls.Add(sendGroup, 0, 1);
        mainLayout.Controls.Add(_frameGrid, 0, 2);
        Controls.Add(mainLayout);
    }

    private void WireEvents()
    {
        _transport.FrameReceived += (_, record) => AppendFrame(record);
        _refreshButton.Click += (_, _) => LoadChannels();
        _connectButton.Click += (_, _) => Connect();
        _applyBitrateButton.Click += (_, _) => ApplyBitrate();
        _disconnectButton.Click += (_, _) => Disconnect();
        _startSendButton.Click += (_, _) => StartSending();
        _stopSendButton.Click += (_, _) => StopSending();
        FormClosing += (_, _) => Shutdown();
    }

    private void LoadBitrates()
    {
        var options = new List<PcanBitrateOption>
        {
            new("125 kbit/s", PcanBitrate.Bps125K),
            new("250 kbit/s", PcanBitrate.Bps250K),
            new("500 kbit/s", PcanBitrate.Bps500K),
            new("1 Mbit/s", PcanBitrate.Bps1M),
        };
        _bitrateCombo.DataSource = options;
    }

    private void LoadChannels()
    {
        try
        {
            var channels = _transport.ListChannels();
            var list = channels.ToList();
            _channelCombo.DataSource = list;
            _channelCombo.DisplayMember = nameof(PcanChannel.DisplayName);
            if (list.Count > 0)
            {
                _channelCombo.SelectedIndex = 0;
            }
        }
        catch (Exception ex)
        {
            UpdateStatus($"Failed to list channels: {ex.Message}");
        }
    }

    private void Connect()
    {
        if (_channelCombo.SelectedItem is not PcanChannel channel)
        {
            UpdateStatus("Select a channel first.");
            return;
        }

        if (_bitrateCombo.SelectedItem is not PcanBitrateOption bitrate)
        {
            UpdateStatus("Select a bitrate.");
            return;
        }

        try
        {
            _transport.Connect(channel, bitrate.Value);
            _frames.Clear();
            UpdateFrameCount();
            UpdateStatus($"Connected to {channel.DisplayName} @ {bitrate.Label}.");
            _connectButton.Enabled = false;
            _applyBitrateButton.Enabled = true;
            _disconnectButton.Enabled = true;
            _startSendButton.Enabled = true;
        }
        catch (Exception ex)
        {
            UpdateStatus($"Connect failed: {ex.Message}");
        }
    }

    private void Disconnect()
    {
        StopSending();
        _transport.Disconnect();
        UpdateStatus("Disconnected.");
        UpdateFrameCount();
        _connectButton.Enabled = true;
        _applyBitrateButton.Enabled = false;
        _disconnectButton.Enabled = false;
        _startSendButton.Enabled = false;
    }

    private void ApplyBitrate()
    {
        if (!_transport.IsConnected)
        {
            UpdateStatus("Connect to a channel before updating bitrate.");
            return;
        }

        if (_bitrateCombo.SelectedItem is not PcanBitrateOption bitrate)
        {
            UpdateStatus("Select a bitrate.");
            return;
        }

        try
        {
            _transport.SetBitrate(bitrate.Value);
            UpdateStatus($"Bitrate set to {bitrate.Label}.");
        }
        catch (Exception ex)
        {
            UpdateStatus($"Bitrate update failed: {ex.Message}");
        }
    }

    private void StartSending()
    {
        if (!_transport.IsConnected)
        {
            UpdateStatus("Connect to a channel before sending.");
            return;
        }

        if (_sendCts != null)
        {
            return;
        }

        _sendCts = new CancellationTokenSource();
        _startSendButton.Enabled = false;
        _stopSendButton.Enabled = true;

        var mode = _sendModeCombo.SelectedItem?.ToString() ?? "Ordered";
        var dlc = (byte)_dlcInput.Value;
        var delayMs = (int)_delayInput.Value;
        var extended = _extendedCheck.Checked;
        var baseId = 0u;
        if (mode != "Fuzz")
        {
            try
            {
                baseId = ParseCanId(_canIdText.Text);
            }
            catch (Exception ex)
            {
                UpdateStatus(ex.Message);
                StopSending();
                return;
            }
        }

        Task.Run(async () =>
        {
            while (!_sendCts.IsCancellationRequested)
            {
                try
                {
                    var frame = mode == "Fuzz"
                        ? _fuzzGenerator.NextFrame(dlc, extended)
                        : _orderedGenerator.NextFrame(baseId, dlc, extended);
                    _transport.SendFrame(frame);
                }
                catch (Exception ex)
                {
                    BeginInvoke(() => UpdateStatus($"Send failed: {ex.Message}"));
                }

                try
                {
                    await Task.Delay(delayMs, _sendCts.Token);
                }
                catch (TaskCanceledException)
                {
                    break;
                }
            }
        });
    }

    private void StopSending()
    {
        if (_sendCts == null)
        {
            return;
        }

        _sendCts.Cancel();
        _sendCts.Dispose();
        _sendCts = null;
        _startSendButton.Enabled = _transport.IsConnected;
        _stopSendButton.Enabled = false;
    }

    private void AppendFrame(FrameRecord record)
    {
        if (InvokeRequired)
        {
            BeginInvoke(() => AppendFrame(record));
            return;
        }

        _frames.Add(record);
        if (_frames.Count > MaxFrames)
        {
            _frames.RemoveAt(0);
        }
        UpdateFrameCount();
    }

    private void UpdateStatus(string message)
    {
        _statusLabel.Text = message;
    }

    private void UpdateFrameCount()
    {
        _frameCountLabel.Text = $"Frames: {_frames.Count}";
    }

    private void Shutdown()
    {
        StopSending();
        _transport.Dispose();
    }

    private static uint ParseCanId(string input)
    {
        var trimmed = input.Trim();
        if (trimmed.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
        {
            trimmed = trimmed[2..];
        }

        if (!uint.TryParse(trimmed, System.Globalization.NumberStyles.HexNumber, null, out var id))
        {
            throw new InvalidOperationException("Invalid CAN ID.");
        }

        return id;
    }
}
