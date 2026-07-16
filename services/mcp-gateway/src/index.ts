// MCP gateway entrypoint.
// Exposes tools: search(query, k), ask(question), list_sources().

async function main(): Promise<void> {
  throw new Error("MCP server registration not implemented yet");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
