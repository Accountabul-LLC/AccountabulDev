# Accountabul Restream chat bridge

This Cloudflare Worker and Durable Object owns the single company Restream chat connection. It keeps the OAuth access token server-side, reconnects when Restream's 60-second heartbeat window expires, backfills Event Chat History after a reconnect, derives stable composite message IDs, and sends normalized messages to Accountabul's restricted operations API.

Required Worker secrets:

- `OPERATIONS_API_KEY`
- `RESTREAM_BRIDGE_API_KEY` (matches the Accountabul token-broker secret)
- `ACCOUNTABUL_ORIGIN`

Start a room by sending an authenticated `POST` to `/?eventId=<Accountabul event UUID>` with:

```json
{
  "accountabulEventId": "...",
  "restreamEventId": "..."
}
```

Deploy only after Restream OAuth is completed with the minimum `chat.read` scope. The Worker fetches short-lived access tokens from Accountabul's authenticated token broker, so rotating Restream OAuth tokens never requires redeploying the Worker. `OPERATIONS_API_KEY` authenticates normalized chat ingestion; `RESTREAM_BRIDGE_API_KEY` independently authenticates token retrieval.
