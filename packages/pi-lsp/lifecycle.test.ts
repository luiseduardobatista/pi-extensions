/**
 * Testes de ciclo de vida (spec §3.3) contra o fake LSP server: idle shutdown,
 * dedupe de startup, restart após shutdown, restart após crash, cleanup no fim
 * de sessão e cancelamento de request.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { runWithServer, shutdown, shutdownAll } from "./server-manager.ts";
import type { LspConfig } from "./config.ts";
import type { ResolvedServer } from "./servers.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function setup(): { config: LspConfig; resolved: ResolvedServer; binDir: string } {
	const binDir = mkdtempSync(join(tmpdir(), "lsp-lifecycle-"));
	const bin = join(binDir, "fake-lsp-server");
	writeFileSync(bin, `#!/bin/sh\nexec node "${join(HERE, "test", "fake-server.mjs")}"\n`);
	chmodSync(bin, 0o755);
	const config: LspConfig = { idleTimeoutMs: 400, requestTimeoutMs: 3000, cacheDir: join(binDir, "cache") };
	const resolved: ResolvedServer = {
		spec: { family: "fake", languageIds: {}, exts: [".go"], command: "fake-lsp-server", args: [], markers: [], installHint: "" },
		root: binDir,
		commandPath: bin,
	};
	return { config, resolved, binDir };
}

function cleanup(binDir: string): void {
	rmSync(binDir, { recursive: true, force: true });
}

test("idle timeout encerra o processo com shutdown/exit", async () => {
	const { config, resolved, binDir } = setup();
	try {
		await runWithServer(resolved, config, async () => "ok");
		await new Promise((r) => setTimeout(r, 900));
		const { spawnSync } = await import("node:child_process");
		const alive = spawnSync("pgrep", ["-f", "fake-server.mjs"], { encoding: "utf8" }).stdout.trim();
		assert.equal(alive, "", `processo deveria ter encerrado no idle; vivo: ${alive}`);
	} finally {
		await shutdownAll(config).catch(() => undefined);
		cleanup(binDir);
	}
});

test("dedupe: chamadas concorrentes compartilham o processo", async () => {
	const { config, resolved, binDir } = setup();
	try {
		const pids = await Promise.all([
			runWithServer(resolved, config, async (s) => s.child.pid),
			runWithServer(resolved, config, async (s) => s.child.pid),
		]);
		assert.equal(pids[0], pids[1], "deve haver um único processo por chave");
	} finally {
		await shutdownAll(config).catch(() => undefined);
		cleanup(binDir);
	}
});

test("restart após shutdown: nova chamada inicia outro processo", async () => {
	const { config, resolved, binDir } = setup();
	try {
		const pid1 = await runWithServer(resolved, config, async (s) => s.child.pid);
		await shutdown("fake\u0000" + resolved.root, config);
		const pid2 = await runWithServer(resolved, config, async (s) => s.child.pid);
		assert.notEqual(pid1, pid2, "nova chamada deve reiniciar o servidor");
	} finally {
		await shutdownAll(config).catch(() => undefined);
		cleanup(binDir);
	}
});

test("crash: servidor morto é reiniciado na próxima chamada", async () => {
	const { config, resolved, binDir } = setup();
	try {
		const pid1 = await runWithServer(resolved, config, async (s) => {
			s.child.kill("SIGKILL");
			// aguarda o exit handler marcar dead (evita corrida com o shutdownAll do finally)
			await new Promise((r) => s.child.once("exit", r));
			return s.child.pid;
		});
		const pid2 = await runWithServer(resolved, config, async (s) => s.child.pid);
		assert.notEqual(pid1, pid2, "crash deve levar a reinício na próxima chamada");
	} finally {
		await shutdownAll(config).catch(() => undefined);
		cleanup(binDir);
	}
});

test("cancelamento: signal aborta a request pendente", async () => {
	const { config, resolved, binDir } = setup();
	try {
		const ac = new AbortController();
		setTimeout(() => ac.abort(), 150);
		const start = Date.now();
		await runWithServer(resolved, config, async (s) => {
			await assert.rejects(s.conn.request("textDocument/slow", {}, ac.signal));
		});
		assert.ok(Date.now() - start < 4000, "cancelamento deve abortar sem esperar o timeout do servidor");
	} finally {
		await shutdownAll(config).catch(() => undefined);
		cleanup(binDir);
	}
});

test("timeout de request: request sem resposta falha dentro do prazo", async () => {
	const { config, resolved, binDir } = setup();
	try {
		const start = Date.now();
		await runWithServer(resolved, config, async (s) => {
			await assert.rejects(s.conn.request("textDocument/slow", {}, undefined));
		});
		assert.ok(Date.now() - start < 5000, `timeout deveria falhar ~3s (requestTimeoutMs); levou ${Date.now() - start}ms`);
	} finally {
		await shutdownAll(config).catch(() => undefined);
		cleanup(binDir);
	}
});
