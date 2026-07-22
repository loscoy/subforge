const TOKEN_PLACEHOLDER = '<MCP_TOKEN>'

export function resolveMcpEndpoint(origin: string, endpoint: string): string {
  return new URL(endpoint, origin).toString()
}

export function buildMcpExamples(endpoint: string): { claudeCode: string; codex: string; json: string } {
  return {
    claudeCode: `claude mcp add --transport http subforge "${endpoint}" --header "Authorization: Bearer ${TOKEN_PLACEHOLDER}"`,
    codex: [
      `export SUBFORGE_MCP_TOKEN="${TOKEN_PLACEHOLDER}"`,
      `codex mcp add subforge --url "${endpoint}" --bearer-token-env-var SUBFORGE_MCP_TOKEN`,
    ].join('\n'),
    json: JSON.stringify(
      {
        mcpServers: {
          subforge: {
            type: 'http',
            url: endpoint,
            headers: { Authorization: `Bearer ${TOKEN_PLACEHOLDER}` },
          },
        },
      },
      null,
      2,
    ),
  }
}
