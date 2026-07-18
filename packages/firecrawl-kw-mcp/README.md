# firecrawl-kw-mcp

Stdio MCP proxy for the hosted Firecrawl KW MCP server.

Default endpoint:

```txt
https://azegdjbrznxdhyeaztqm.supabase.co/functions/v1/mcp-server
```

## MCP client config

```json
{
  "mcpServers": {
    "firecrawl-kw": {
      "command": "npx",
      "args": ["-y", "firecrawl-kw-mcp"],
      "env": {
        "MCP_SECRET": "fc_kw-FULL_KEY_KAMU"
      }
    }
  }
}
```

`MCP_SECRET` must be a full per-user secret generated from the Firecrawl KW dashboard's **MCP Secrets** page. Do not use the displayed prefix only.

## Optional env vars

- `MCP_ENDPOINT` — override the hosted endpoint.
- `MCP_SECRET` or `X_MCP_SECRET` — per-user MCP secret forwarded as `X-MCP-Secret`.
- `GITHUB_TOKEN` or `X_GITHUB_TOKEN` — forwarded as `X-GitHub-Token`.
- `SUPABASE_ACCESS_TOKEN` or `AUTHORIZATION_BEARER_TOKEN` — forwarded as `Authorization: Bearer ...`.
- `MCP_REQUEST_TIMEOUT_MS` — request timeout, default `120000`.
- `MCP_STDIO_DEBUG` — set to `1` or `true` for stderr debug logs.

## Publish

```bash
cd packages/firecrawl-kw-mcp
npm publish --access public
```

Versi `0.1.1` adalah rilis pertama yang membawa metadata dan file MIT License ke paket npm.

## License

Paket ini dilisensikan di bawah [MIT License](./LICENSE). Copyright (c) 2026 Muhammad Lutfi Firdaus.
