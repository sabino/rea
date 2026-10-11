import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parse } from "smol-toml";
import { expect } from "vitest";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const configurationSchema = z.object({
  mcp_servers: z.object({
    rea: z.object({
      command: z.string(),
      args: z.array(z.string()),
      startup_timeout_sec: z.literal(30),
    }),
  }),
});

cliTest(
  "direct setup starts its written Codex MCP launcher with the invoking runtime",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-direct-runtime-");
    const environment = {
      HOME: home,
      USERPROFILE: home,
      CODEX_HOME: join(home, ".codex"),
      PATH: process.env.PATH ?? "",
    };
    const run = (arguments_: readonly string[]) =>
      cli.run({ arguments: [...arguments_, "--json"], environment });
    const installed = await run(["setup", "--client", "codex", "--yes"]);
    expect(installed.exitCode, installed.stderr).toBe(0);
    expect(installed.json).toMatchObject({
      status: "ready",
      doctor: { healthy: true, identity: { skill: { state: "aligned" } } },
    });

    const { rea } = configurationSchema.parse(
      parse(
        await readFile(join(environment.CODEX_HOME, "config.toml"), "utf8"),
      ),
    ).mcp_servers;
    const usesRuntime =
      process.platform === "win32" || process.versions.bun !== undefined;
    expect([rea.command, ...rea.args]).toEqual(
      usesRuntime
        ? [process.execPath, resolve("scripts/rea.mjs"), "mcp"]
        : [resolve("scripts/rea.mjs"), "mcp"],
    );
    const repeated = await run(["setup", "--client", "codex", "--dry-run"]);
    expect(repeated.exitCode, repeated.stderr).toBe(0);
    expect(repeated.json).toMatchObject({ plannedActions: [] });

    const client = new Client({
      name: "rea-direct-runtime-test",
      version: "1",
    });
    const transport = new StdioClientTransport({
      command: rea.command,
      args: rea.args,
      env: environment,
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
      expect(client.getServerVersion()?.name).toBe("rea");
      const { tools } = await client.listTools();
      expect(tools.some(({ name }) => name === "binary_session")).toBe(true);
      const session = await client.callTool({
        name: "binary_session",
        arguments: {},
      });
      expect(session.isError).not.toBe(true);
    } finally {
      await client.close();
    }
  },
);
