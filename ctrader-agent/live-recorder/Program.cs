using System.Text.Json;
using CTraderRecorder;
using Google.Protobuf;
using OpenAPI.Net;
using Serilog;

// ─────────────────────────────────────────────────────────────────────────────
// cTrader Open API — READ-ONLY account recorder.
//
// This program connects to your cTrader account via the Open API and journals
// account activity (positions, orders, balance) to disk. It NEVER places, amends,
// or closes orders — there are deliberately no order-execution message types used
// anywhere in this project. See docs/RECORDER_SETUP.md and docs/LIVE_TRADING.md.
// ─────────────────────────────────────────────────────────────────────────────

var baseDir = AppContext.BaseDirectory;
var workingDir = Directory.GetCurrentDirectory();
var config = LoadConfig(Path.Combine(baseDir, "appsettings.json"));

var logsRoot = Path.GetFullPath(Path.Combine(workingDir, config.Logging.Directory));
Directory.CreateDirectory(logsRoot);
Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Is(Enum.Parse<Serilog.Events.LogEventLevel>(config.Logging.MinimumLevel))
    .WriteTo.Console()
    .WriteTo.File(Path.Combine(logsRoot, "recorder-.log"), rollingInterval: RollingInterval.Day)
    .CreateLogger();

var api = config.OpenApi;

// ── Safety gate ──────────────────────────────────────────────────────────────
if (api.IsLive && !api.AllowLive)
{
    Log.Error("Host is 'live' but OpenApi.AllowLive is false. Refusing to connect to the LIVE account. " +
              "Start with Host='demo'; set AllowLive=true only when you deliberately want read-only live monitoring.");
    return 1;
}
if (string.IsNullOrWhiteSpace(api.ClientId) || string.IsNullOrWhiteSpace(api.ClientSecret) || string.IsNullOrWhiteSpace(api.AccessToken))
{
    Log.Error("ClientId, ClientSecret and AccessToken are required. See docs/RECORDER_SETUP.md to obtain them.");
    return 1;
}

var journal = new Journal(Path.GetFullPath(Path.Combine(workingDir, config.Recorder.JournalDir)), Log.Logger);

Log.Information("Connecting to cTrader Open API ({Host}:{Port}) — READ-ONLY recorder.", api.ResolveHostName(), api.Port);

// The 3rd parameter is the heartbeat interval (the SDK sends heartbeats for us).
using var client = new OpenClient(api.ResolveHostName(), api.Port, TimeSpan.FromSeconds(10));

long accountId = api.CtidTraderAccountId;

client.Subscribe(OnMessage, OnError, OnCompleted);

await client.Connect();

// App auth MUST be the first message after connecting.
await SendAsync(new ProtoOAApplicationAuthReq { ClientId = api.ClientId, ClientSecret = api.ClientSecret },
                ProtoOAPayloadType.ProtoOaApplicationAuthReq);

// Keep running until Ctrl+C.
var stop = new TaskCompletionSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; stop.TrySetResult(); };
Log.Information("Recorder running. Press Ctrl+C to stop.");
_ = SnapshotLoopAsync(stop.Task);
await stop.Task;

Log.Information("Stopping recorder.");
Log.CloseAndFlush();
return 0;

// ── message handling ─────────────────────────────────────────────────────────
void OnMessage(ProtoMessage message)
{
    try
    {
        switch (message.PayloadType)
        {
            case (uint)ProtoOAPayloadType.ProtoOaApplicationAuthRes:
                Log.Information("Application authenticated.");
                if (accountId == 0)
                    _ = SendAsync(new ProtoOAGetAccountListByAccessTokenReq { AccessToken = api.AccessToken },
                                  ProtoOAPayloadType.ProtoOaGetAccountsByAccessTokenReq);
                else
                    AuthenticateAccount();
                break;

            case (uint)ProtoOAPayloadType.ProtoOaGetAccountsByAccessTokenRes:
            {
                var res = ProtoOAGetAccountListByAccessTokenRes.Parser.ParseFrom(message.Payload);
                var chosen = res.CtidTraderAccount.FirstOrDefault(a => a.IsLive == api.IsLive)
                             ?? res.CtidTraderAccount.FirstOrDefault();
                if (chosen is null)
                {
                    Log.Error("No trading accounts are authorised for this access token.");
                    break;
                }
                accountId = (long)chosen.CtidTraderAccountId;
                Log.Information("Using ctidTraderAccountId {AccountId} (isLive={IsLive}).", accountId, chosen.IsLive);
                AuthenticateAccount();
                break;
            }

            case (uint)ProtoOAPayloadType.ProtoOaAccountAuthRes:
                Log.Information("Account {AccountId} authenticated. Fetching current state…", accountId);
                RequestSnapshot();
                break;

            case (uint)ProtoOAPayloadType.ProtoOaTraderRes:
            {
                var res = ProtoOATraderRes.Parser.ParseFrom(message.Payload);
                var t = res.Trader;
                journal.Record("account", new
                {
                    ctidTraderAccountId = accountId,
                    balance = t.Balance / 100.0,
                    balanceRaw = t.Balance,
                    depositCurrency = t.DepositAssetId,
                    leverage = t.LeverageInCents / 100.0
                });
                break;
            }

            case (uint)ProtoOAPayloadType.ProtoOaReconcileRes:
            {
                var res = ProtoOAReconcileRes.Parser.ParseFrom(message.Payload);
                journal.Record("reconcile", new
                {
                    ctidTraderAccountId = accountId,
                    openPositions = res.Position.Select(PositionSummary).ToArray(),
                    pendingOrders = res.Order.Select(OrderSummary).ToArray()
                });
                break;
            }

            case (uint)ProtoOAPayloadType.ProtoOaExecutionEvent:
            {
                var e = ProtoOAExecutionEvent.Parser.ParseFrom(message.Payload);
                journal.Record("execution", new
                {
                    executionType = e.ExecutionType.ToString(),
                    order = e.Order is null ? null : OrderSummary(e.Order),
                    position = e.Position is null ? null : PositionSummary(e.Position)
                });
                break;
            }

            case (uint)ProtoOAPayloadType.ProtoOaErrorRes:
            {
                var e = ProtoOAErrorRes.Parser.ParseFrom(message.Payload);
                Log.Error("Open API error: {Code} {Description}", e.ErrorCode, e.Description);
                break;
            }

            // Heartbeats, spot events (not subscribed), and anything else: ignore.
        }
    }
    catch (Exception ex)
    {
        Log.Error(ex, "Failed to handle message payloadType={PayloadType}", message.PayloadType);
    }
}

void AuthenticateAccount()
    => _ = SendAsync(new ProtoOAAccountAuthReq { CtidTraderAccountId = accountId, AccessToken = api.AccessToken },
                     ProtoOAPayloadType.ProtoOaAccountAuthReq);

void RequestSnapshot()
{
    if (accountId == 0) return;
    _ = SendAsync(new ProtoOATraderReq { CtidTraderAccountId = accountId }, ProtoOAPayloadType.ProtoOaTraderReq);
    _ = SendAsync(new ProtoOAReconcileReq { CtidTraderAccountId = accountId }, ProtoOAPayloadType.ProtoOaReconcileReq);
}

async Task SnapshotLoopAsync(Task until)
{
    var interval = TimeSpan.FromSeconds(Math.Max(30, config.Recorder.SnapshotIntervalSeconds));
    while (!until.IsCompleted)
    {
        try { await Task.Delay(interval, CancellationToken.None); } catch { }
        if (until.IsCompleted) break;
        if (accountId != 0) RequestSnapshot();
    }
}

async Task SendAsync(IMessage message, ProtoOAPayloadType payloadType)
{
    try { await client.SendMessage(message, payloadType); }
    catch (Exception ex) { Log.Error(ex, "Failed to send {PayloadType}", payloadType); }
}

void OnError(Exception ex) => Log.Error(ex, "Open API stream error");
void OnCompleted() => Log.Warning("Open API stream closed.");

static object OrderSummary(ProtoOAOrder o) => new
{
    orderId = o.OrderId,
    type = o.OrderType.ToString(),
    side = o.TradeData?.TradeSide.ToString(),
    symbolId = o.TradeData?.SymbolId,
    volume = o.TradeData?.Volume,
    status = o.OrderStatus.ToString()
};

static object PositionSummary(ProtoOAPosition p) => new
{
    positionId = p.PositionId,
    side = p.TradeData?.TradeSide.ToString(),
    symbolId = p.TradeData?.SymbolId,
    volume = p.TradeData?.Volume,
    entryPrice = p.Price,
    status = p.PositionStatus.ToString(),
    swap = p.Swap / 100.0
};

static RecorderAppConfig LoadConfig(string path)
{
    var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
    return JsonSerializer.Deserialize<RecorderAppConfig>(File.ReadAllText(path), options)
           ?? throw new InvalidOperationException($"Failed to load config from '{path}'.");
}
