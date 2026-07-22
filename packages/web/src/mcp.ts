const TOKEN_PLACEHOLDER = '<MCP_TOKEN>'

export function resolveMcpEndpoint(origin: string, endpoint: string): string {
  return new URL(endpoint, origin).toString()
}

export function buildMcpExamples(endpoint: string): { claudeCode: string; json: string } {
  return {
    claudeCode: `claude mcp add --transport http subforge "${endpoint}" --header "Authorization: Bearer ${TOKEN_PLACEHOLDER}"`,
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
