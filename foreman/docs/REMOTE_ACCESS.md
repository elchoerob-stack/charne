# Using Foreman away from the Wi-Fi

The phone app talks to the server on your laptop. On the same Wi-Fi that is a
LAN address. On the road it is not reachable, because your home network does
not accept connections from the internet — which is a feature, not a fault.

Two ways to fix it. **Tailscale is the one to use.**

## 1. Tailscale (recommended)

A private network between your own devices. Nothing is exposed to the
internet; the laptop is reachable only by devices signed into your account.

1. Install Tailscale on the laptop: `winget install tailscale.tailscale`
2. Install the Tailscale app on the S25+ from the Play Store.
3. Sign both into the same account.
4. Foreman detects it and the Phone popup shows the Tailscale address
   (`100.x.x.x`). Scan that QR once and the phone works anywhere with signal.

No tunnel to switch on, nothing public, and the address does not change.

## 2. Cloudflare tunnel (a public link, nothing to install on the phone)

Gives a `https://….trycloudflare.com` address that works on any device. Use it
when you want to hand someone a link, or when installing Tailscale on a device
is not practical.

**This puts Foreman on the public internet.** Foreman therefore refuses to
open a tunnel unless the access code is at least 20 characters. `Foreman.exe`
generates a 32-character one on its first run, so this is already satisfied;
if you are running from the source, put a `CMS_AGENT_TOKEN=` line in
`server/.env` and restart.

It also gives you a *different* address every time it starts, which is why it
is no good as the everyday answer: an app added to your home screen would
point at yesterday's tunnel. Use it to hand someone a one-off link, and use
Tailscale for your own phone.

1. Install cloudflared: `winget install Cloudflare.cloudflared`
2. In the console, press **Phone**, then **Open a Cloudflare tunnel**.
3. The QR switches to the public address, with the token built into the link.

Understand what you are handing out: anyone with that link **and** the token
can reach Foreman, and Foreman can drive your CMS session. Treat the link like
a password, and close the tunnel when you are done.

## Which address the QR shows

`/api/connect` prefers, in order: an open tunnel → Tailscale → `PUBLIC_URL`
from the settings → the detected LAN address. Among the machine's own
addresses, anything in Tailscale's range (100.64.0.0/10) wins over a Wi-Fi
address, because it is the one that still works tomorrow somewhere else. The
popup tells you which one you are looking at and shows the Wi-Fi address
alongside when they differ.

## What Foreman listens on

With an access code set — which `Foreman.exe` always does — Foreman listens on
every interface, so the phone can reach it over Wi-Fi or Tailscale, and every
single request has to carry that code. With no access code set it listens only
on the laptop itself: an open Foreman on dealership Wi-Fi would let anyone on
that network drive a browser that is signed into your systems.

To pin it down further, set `FOREMAN_BIND` in the settings file to a single
address.

## What is not supported

Port forwarding on your router. It exposes the laptop directly, it breaks when
your ISP changes your address, and there is no reason to choose it over the
two options above.
