# Live recorder (app 2) — setup

A **read-only** recorder that connects to your cTrader account via the Open API
and journals positions/orders/balance to disk. It never trades. **Start on
DEMO.**

## 1. Register an Open API application

1. Go to <https://openapi.ctrader.com/> and sign in with your cTrader ID.
2. Create a new application. Note its **Client ID** and **Client Secret**.
3. Add a **Redirect URI** — `http://localhost/` is fine for getting a token.

## 2. Authorise your account and get an access token

The Open API uses OAuth. Easiest path:

1. Open this URL in a browser (replace `CLIENT_ID` and the redirect if you used
   a different one). Scope `accounts` is read-only; if reconcile later returns a
   permission error, redo this with `scope=trading` (that scope permits trading,
   but this recorder never sends orders):

   ```
   https://openapi.ctrader.com/apps/auth?client_id=CLIENT_ID&redirect_uri=http://localhost/&scope=accounts
   ```

2. Approve. You'll be redirected to `http://localhost/?code=XXXX`. Copy the
   `code`.
3. Exchange the code for a token (PowerShell):

   ```powershell
   $r = Invoke-RestMethod -Method Post -Uri "https://openapi.ctrader.com/apps/token" -Body @{
     grant_type="authorization_code"; code="XXXX";
     redirect_uri="http://localhost/"; client_id="CLIENT_ID"; client_secret="CLIENT_SECRET"
   }
   $r.access_token
   ```

   Save the `access_token` (and `refresh_token` for later — tokens expire).

## 3. Fill in config

Edit `live-recorder/appsettings.json`:

```jsonc
{
  "OpenApi": {
    "Host": "demo",              // START WITH DEMO
    "ClientId": "…",
    "ClientSecret": "…",
    "AccessToken": "…",
    "CtidTraderAccountId": 0,     // 0 = auto-discover from the token
    "AllowLive": false            // must be true to connect to the live host
  }
}
```

## 4. Build and run

```powershell
cd ctrader-agent\live-recorder
# If restore complains about the OpenAPI.Net version, let the CLI pick one:
#   dotnet add package OpenAPI.Net
dotnet build
dotnet run
```

You should see it authenticate, then log an `account` and `reconcile` snapshot,
and thereafter `execution` events as trades happen. Records are written to
`ctrader-agent/journal/<date>.jsonl`.

## 5. Going to live (read-only)

Only after it works on demo: set `Host: "live"` and `AllowLive: true`. It stays
read-only — it just monitors and journals your live account. Order execution is
Phase 3b and is a separate, deliberately-gated build (see
`docs/LIVE_TRADING.md`).

## Notes

- This is a first pass built without a machine to test against, like the
  backtest agent was. The Open API SDK's exact type/method names can vary by
  version — if the build flags an unknown type or method, paste the error and
  it's a quick fix, same as we did before.
- Money fields are journalled both raw and as an approximate decimal
  (raw / 100); exact precision uses the account's money-digits and can be
  refined once we see live values.
