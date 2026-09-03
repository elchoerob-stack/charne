#!/usr/bin/env bash
# One-command installer for Foreman (CMS Agent) on macOS / Linux.
#   bash setup.sh [--api-key KEY] [--no-autostart] [--port 8787] [--dir ~/charne] [--non-interactive]
set -euo pipefail
BRANCH="claude/grokbot-cms-agent-5vkq13"; PORT=8787; DIR="$HOME/charne"; API_KEY="${ANTHROPIC_API_KEY:-}"; AUTOSTART=1; INTERACTIVE=1
while [[ $# -gt 0 ]]; do case "$1" in
  --api-key) API_KEY="$2"; shift 2;; --no-autostart) AUTOSTART=0; shift;; --port) PORT="$2"; shift 2;; --dir) DIR="$2"; shift 2;; --non-interactive) INTERACTIVE=0; shift;; --branch) BRANCH="$2"; shift 2;;
  *) echo "unknown option $1"; exit 1;; esac; done
step(){ printf '\n\033[36m== %s\033[0m\n' "$1"; }; ok(){ printf '   \033[32m%s\033[0m\n' "$1"; }; warn(){ printf '   \033[33m%s\033[0m\n' "$1"; }

step "1/6 Prerequisites"
if ! command -v node >/dev/null; then
  if command -v brew >/dev/null; then brew install node@22 >/dev/null; elif command -v apt-get >/dev/null; then curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs; else echo "Install Node.js 22 from https://nodejs.org and re-run"; exit 1; fi
fi
command -v git >/dev/null || { echo "Install git and re-run"; exit 1; }
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]'); [[ $NODE_MAJOR -ge 20 ]] || { echo "Node $(node --version) is too old (need 20+)"; exit 1; }
ok "node $(node --version), git $(git --version | cut -d' ' -f3)"

step "2/6 Code"
if [[ -d "$DIR/.git" ]]; then git -C "$DIR" fetch -q origin "$BRANCH"; git -C "$DIR" checkout -q "$BRANCH"; git -C "$DIR" pull -q origin "$BRANCH"; ok "Updated $DIR"; else git clone -q --branch "$BRANCH" https://github.com/elchoerob-stack/charne.git "$DIR"; ok "Cloned to $DIR"; fi
SERVER="$DIR/cms-agent/server"

step "3/6 Dependencies and build"
( cd "$SERVER" && npm install --no-audit --no-fund --loglevel=error && npm run build --silent )
ok "Built $SERVER/dist"

step "4/6 Configuration"
ENV="$SERVER/.env"; [[ -f "$ENV" ]] || cp "$SERVER/.env.example" "$ENV"
setenv(){ if grep -q "^$1=" "$ENV"; then sed -i.bak "s|^$1=.*|$1=$2|" "$ENV" && rm -f "$ENV.bak"; else printf '%s=%s\n' "$1" "$2" >> "$ENV"; fi; }
if [[ -z "$API_KEY" ]] && ! grep -q '^ANTHROPIC_API_KEY=.\+' "$ENV" && [[ $INTERACTIVE -eq 1 ]]; then read -r -s -p "   Paste your Anthropic API key (blank to add later): " API_KEY; echo; fi
if [[ -n "$API_KEY" ]]; then setenv ANTHROPIC_API_KEY "$API_KEY"; ok "API key saved"; elif grep -q '^ANTHROPIC_API_KEY=.\+' "$ENV"; then ok "API key already set"; else warn "No API key yet: chat is off until ANTHROPIC_API_KEY is set in $ENV"; fi
if ! grep -q '^CMS_AGENT_TOKEN=.\+' "$ENV"; then TOKEN=$(node -p 'require("crypto").randomBytes(24).toString("base64url")'); setenv CMS_AGENT_TOKEN "$TOKEN"; else TOKEN=$(grep '^CMS_AGENT_TOKEN=' "$ENV" | cut -d= -f2-); fi
LAN_IP=$( (ip route get 1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -1) || true ); [[ -n "${LAN_IP:-}" ]] || LAN_IP=$( (ipconfig getifaddr en0 2>/dev/null) || echo localhost )
setenv PORT "$PORT"; setenv PUBLIC_URL "http://$LAN_IP:$PORT"
ok "PUBLIC_URL=http://$LAN_IP:$PORT  token=$TOKEN"

step "5/6 Start at login"
if [[ $AUTOSTART -eq 1 ]]; then
  if [[ "$(uname)" == "Darwin" ]]; then
    PLIST="$HOME/Library/LaunchAgents/za.co.cms.foreman.plist"; mkdir -p "$(dirname "$PLIST")"
    cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>za.co.cms.foreman</string><key>ProgramArguments</key><array><string>$(command -v node)</string><string>$SERVER/dist/index.js</string></array>
<key>WorkingDirectory</key><string>$SERVER</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$SERVER/data/foreman.log</string><key>StandardErrorPath</key><string>$SERVER/data/foreman.log</string></dict></plist>
PL
    mkdir -p "$SERVER/data"; launchctl unload "$PLIST" 2>/dev/null || true; launchctl load "$PLIST"; ok "launchd agent loaded (za.co.cms.foreman)"
  elif command -v systemctl >/dev/null && [[ $INTERACTIVE -eq 1 || -n "${XDG_RUNTIME_DIR:-}" ]]; then
    mkdir -p "$HOME/.config/systemd/user"
    cat > "$HOME/.config/systemd/user/foreman.service" <<SV
[Unit]
Description=Foreman (CMS Agent)
[Service]
WorkingDirectory=$SERVER
ExecStart=$(command -v node) $SERVER/dist/index.js
Restart=on-failure
[Install]
WantedBy=default.target
SV
    (systemctl --user daemon-reload && systemctl --user enable --now foreman.service && ok "systemd user service enabled (foreman.service)") || warn "Could not enable the systemd user service; start manually with: node $SERVER/dist/index.js"
  else warn "No service manager configured; start manually with: node $SERVER/dist/index.js"; fi
else warn "Skipped autostart"; fi

step "6/6 Check"
for i in $(seq 1 20); do curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break || sleep 0.5; done
if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; then ok "Foreman is up: http://localhost:$PORT"; else warn "Not reachable yet; start it with: cd $SERVER && node dist/index.js"; fi
printf '\nDone.\n  Computer: open http://localhost:%s and click Install app\n  Phone   : http://%s:%s (same Wi-Fi), Add to Home screen, token %s\n  Recorder: load %s/cms-agent/recorder-extension unpacked in Chrome\n' "$PORT" "$LAN_IP" "$PORT" "$TOKEN" "$DIR"
