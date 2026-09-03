# FuelBTC Binance egress gateway

This service gives Supabase Edge Functions one fixed Binance egress IP: the VPS public IP.
It is an authenticated, Binance-only relay rather than a general-purpose proxy.

## Security defaults

- Requests require HMAC authentication with a 60-second timestamp window and one-time nonce.
- Only official Binance production and testnet HTTPS hosts are accepted.
- Only Binance API key and content-type headers are forwarded.
- Redirects are not followed.
- Read-only mode is enabled by default.
- Trading, transfers, and withdrawals are independently disabled by default.
- API secrets remain in the existing backend; they are never stored in this container.

## DNS prerequisite

Create an `A` record for `api.fuelbtc.com` pointing to the VPS public IPv4 address. Do not change the root-domain record.

## VPS deployment

```bash
cd /home/deploy/fuelbtc/deploy/binance-gateway
cp .env.example .env
chmod 600 .env
# Edit .env and replace GATEWAY_SHARED_SECRET with: openssl rand -hex 32
docker compose config
docker compose up -d --build
docker compose ps
curl https://api.fuelbtc.com/health
```

Set these Supabase Edge Function secrets only after the HTTPS health check succeeds:

```text
BINANCE_GATEWAY_URL=https://api.fuelbtc.com
BINANCE_GATEWAY_SECRET=<same random value stored in the VPS .env>
BINANCE_GATEWAY_REQUIRED=true
```

Never commit `.env`, paste the shared secret into chat, or enable write operations during initial testing.
