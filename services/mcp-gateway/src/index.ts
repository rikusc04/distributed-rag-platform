// MCP gateway entrypoint. Filled in during Week 2.
// Exposes tools: search(query, k), ask(question), list_sources().

async function main(): Promise<void> {
  throw new Error("Week 2: register MCP server and tools");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
