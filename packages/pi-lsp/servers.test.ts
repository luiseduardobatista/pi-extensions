/**
 * Testes das funções puras de resolução (spec §5.10): linguagem, root e PATH.
 * Roda com `node --test extensions/lsp/` (Node 24, type stripping).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	findInPath,
	gitRootFor,
	languageIdFor,
	nearestMarkerRoot,
	resolveRoot,
	specForFile,
	SERVER_MAP,
} from "./servers.ts";

test("specForFile: mapeia extensões conhecidas e rejeita desconhecidas", () => {
	assert.equal(specForFile("a/b.ts")?.family, "ts");
	assert.equal(specForFile("a/b.tsx")?.family, "ts");
	assert.equal(specForFile("a/b.py")?.family, "py");
	assert.equal(specForFile("a/b.go")?.family, "go");
	assert.equal(specForFile("a/b.rs")?.family, "rs");
	assert.equal(specForFile("a/b.sh")?.family, "bash");
	assert.equal(specForFile("a/b.yaml")?.family, "yaml");
	assert.equal(specForFile("a/b.json")?.family, "json");
	assert.equal(specForFile("a/b.css")?.family, "css");
	assert.equal(specForFile("a/b.html")?.family, "html");
	assert.equal(specForFile("a/b.xyz"), null);
});

test("languageIdFor: TS/JS se distinguem por extensão", () => {
	const ts = specForFile("a.ts")!;
	assert.equal(languageIdFor(ts, "a.ts"), "typescript");
	assert.equal(languageIdFor(ts, "a.tsx"), "typescript");
	assert.equal(languageIdFor(ts, "a.js"), "javascript");
	assert.equal(languageIdFor(ts, "a.jsx"), "javascript");
});

test("nearestMarkerRoot: sobe até o primeiro ancestral com marcador", () => {
	const base = mkdtempSync(join(tmpdir(), "lsp-root-"));
	try {
		const a = join(base, "a");
		const b = join(a, "b");
		mkdirSync(b, { recursive: true });
		writeFileSync(join(a, "tsconfig.json"), "{}");
		assert.equal(nearestMarkerRoot(join(b, "f.ts"), ["tsconfig.json", "jsconfig.json"]), a);
		// marcador no próprio diretório do arquivo tem precedência
		writeFileSync(join(b, "jsconfig.json"), "{}");
		assert.equal(nearestMarkerRoot(join(b, "f.ts"), ["tsconfig.json", "jsconfig.json"]), b);
		assert.equal(nearestMarkerRoot(join(b, "f.ts"), []), null);
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("resolveRoot: marcador → git root → diretório do arquivo", () => {
	const base = mkdtempSync(join(tmpdir(), "lsp-root2-"));
	try {
		const sub = join(base, "sub");
		mkdirSync(sub, { recursive: true });
		writeFileSync(join(sub, "go.mod"), "module x\n");
		const go = specForFile("f.go")!;
		assert.equal(resolveRoot(join(sub, "f.go"), go), sub);
		const ts = specForFile("f.ts")!;
		assert.equal(resolveRoot(join(sub, "f.ts"), ts), sub);
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("gitRootFor: null fora de repo git", () => {
	const base = mkdtempSync(join(tmpdir(), "lsp-git-"));
	try {
		assert.equal(gitRootFor(join(base, "f.go")), null);
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("findInPath: encontra executável no PATH e retorna null quando ausente", () => {
	const base = mkdtempSync(join(tmpdir(), "lsp-path-"));
	try {
		const bin = join(base, "fake-lsp-bin");
		writeFileSync(bin, "#!/bin/sh\n");
		chmodSync(bin, 0o755);
		const oldPath = process.env.PATH;
		process.env.PATH = base;
		try {
			assert.equal(findInPath("fake-lsp-bin"), bin);
			assert.equal(findInPath("fake-lsp-ausente"), null);
		} finally {
			process.env.PATH = oldPath;
		}
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("SERVER_MAP: integridade (famílias únicas, comandos e marcadores presentes)", () => {
	const families = new Set(SERVER_MAP.map((s) => s.family));
	assert.equal(families.size, SERVER_MAP.length, "famílias devem ser únicas");
	for (const s of SERVER_MAP) {
		assert.ok(s.command.length > 0, `comando vazio em ${s.family}`);
		assert.ok(s.exts.length > 0, `extensões vazias em ${s.family}`);
		assert.ok(Object.keys(s.languageIds).length > 0, `languageIds vazio em ${s.family}`);
	}
});
