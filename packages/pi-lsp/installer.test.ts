/**
 * Testes das partes puras do instalador (spec §5.10): manifest, lock e
 * resolução sem rede/instalação.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LspConfig } from "./config.ts";
import { ensureServerBinary, platformAsset, readManifest, writeManifestAtomic, withLock } from "./installer.ts";

function fakeConfig(): LspConfig {
	return { idleTimeoutMs: 1000, requestTimeoutMs: 1000, cacheDir: mkdtempSync(join(tmpdir(), "lsp-install-")) };
}

function noUi() {
	return { hasUI: false, confirm: async () => true };
}

test("manifest: roundtrip atômico", () => {
	const config = fakeConfig();
	const m = readManifest(config);
	assert.deepEqual(m.servers, {});
	m.servers.ts = {
		command: "typescript-language-server",
		channel: "npm",
		version: "1.0.0",
		installedAt: "now",
		confirmed: true,
	};
	writeManifestAtomic(config, m);
	const read = readManifest(config);
	assert.equal(read.servers.ts?.version, "1.0.0");
	assert.equal(read.servers.ts?.confirmed, true);
	assert.equal(existsSync(`${join(config.cacheDir, "manifest.json")}.tmp`), false);
	rmSync(config.cacheDir, { recursive: true, force: true });
});

test("withLock: serializa e libera", async () => {
	const config = fakeConfig();
	let inside = 0;
	let maxInside = 0;
	const work = async (): Promise<void> => {
		await withLock(config, "teste", async () => {
			inside++;
			maxInside = Math.max(maxInside, inside);
			await new Promise((r) => setTimeout(r, 30));
			inside--;
		});
	};
	await Promise.all([work(), work(), work()]);
	assert.equal(maxInside, 1, "apenas um dentro do lock por vez");
	rmSync(config.cacheDir, { recursive: true, force: true });
});

test("ensureServerBinary: servidor no PATH não exige UI nem instalação", async () => {
	const config = fakeConfig();
	const binDir = mkdtempSync(join(tmpdir(), "lsp-fakebin-"));
	const fake = join(binDir, "typescript-language-server");
	writeFileSync(fake, "#!/bin/sh\n");
	chmodSync(fake, 0o755);
	const oldPath = process.env.PATH;
	process.env.PATH = binDir;
	try {
		const path = await ensureServerBinary(
			{ spec: { family: "ts", languageIds: {}, exts: [], command: "typescript-language-server", args: ["--stdio"], markers: [], installHint: "hint" }, root: "/tmp" },
			config,
			noUi(),
		);
		assert.equal(path, fake);
	} finally {
		process.env.PATH = oldPath;
		rmSync(binDir, { recursive: true, force: true });
		rmSync(config.cacheDir, { recursive: true, force: true });
	}
});

test("ensureServerBinary: sem PATH e sem UI → erro acionável, nada instalado", async () => {
	const config = fakeConfig();
	const oldPath = process.env.PATH;
	process.env.PATH = "/nonexistent-bin-dir";
	try {
		await assert.rejects(
			ensureServerBinary(
				{ spec: { family: "ts", languageIds: {}, exts: [], command: "typescript-language-server", args: ["--stdio"], markers: [], installHint: "npm install -g x" }, root: "/tmp" },
				config,
				noUi(),
			),
			/exige UI|Instale manualmente/,
		);
		assert.equal(existsSync(join(config.cacheDir, "servers")), false);
	} finally {
		process.env.PATH = oldPath;
		rmSync(config.cacheDir, { recursive: true, force: true });
	}
});

test("platformAsset: padrão por plataforma/arquitetura", () => {
	const pattern = "rust-analyzer-{platform}.gz";
	const os = process.platform === "linux" ? "unknown-linux-gnu" : process.platform === "darwin" ? "apple-darwin" : "pc-windows-msvc";
	const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch;
	assert.equal(platformAsset(pattern), `rust-analyzer-${arch}-${os}.gz`);
});

test("manifest: arquivo corrompido volta ao vazio sem quebrar", () => {
	const config = fakeConfig();
	mkdirSync(config.cacheDir, { recursive: true });
	writeFileSync(join(config.cacheDir, "manifest.json"), "{corrompido");
	const m = readManifest(config);
	assert.deepEqual(m.servers, {});
	rmSync(config.cacheDir, { recursive: true, force: true });
});

test("readManifest: cache dir ausente não quebra", () => {
	const config = fakeConfig();
	rmSync(config.cacheDir, { recursive: true, force: true });
	const m = readManifest(config);
	assert.deepEqual(m.servers, {});
	rmSync(config.cacheDir, { recursive: true, force: true });
});

test("manifest: gravação atômica persiste JSON legível", () => {
	const config = fakeConfig();
	const m = readManifest(config);
	m.servers.go = { command: "gopls", channel: "go-install", installedAt: "x", confirmed: true };
	writeManifestAtomic(config, m);
	const raw = readFileSync(join(config.cacheDir, "manifest.json"), "utf8");
	JSON.parse(raw);
	rmSync(config.cacheDir, { recursive: true, force: true });
});
