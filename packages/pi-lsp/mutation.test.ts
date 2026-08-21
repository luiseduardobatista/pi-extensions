/**
 * Testes das correções do review: notificação didChange pós-mutação,
 * applyWorkspaceEdit end-to-end (disco + version + registro) e spawn falho.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { applyWorkspaceEdit } from "./apply.ts";
import { markDocumentText } from "./sync.ts";
import type { ManagedServer } from "./server-manager.ts";
import type { LspConfig } from "./config.ts";

interface NotifyCall {
	method: string;
	params: unknown;
}

function stubServer(syncChange: number): { s: ManagedServer; calls: NotifyCall[] } {
	const calls: NotifyCall[] = [];
	const s = {
		conn: { notify: (method: string, params: unknown) => calls.push({ method, params }) },
		syncKind: { openClose: true, change: syncChange },
		documents: new Map(),
	} as unknown as ManagedServer;
	return { s, calls };
}

test("markDocumentText: envia didChange Full após mutação (spec §3.3.6)", () => {
	const { s, calls } = stubServer(1);
	const file = join(tmpdir(), "mut-full.go");
	s.documents.set(pathToFileURL(file).href, { text: "a", version: 1 });
	markDocumentText(s, file, "ab");
	const didChange = calls.find((c) => c.method === "textDocument/didChange");
	assert.ok(didChange, "didChange deve ser enviado após mutação própria");
	const p = didChange!.params as { textDocument: { uri: string; version: number }; contentChanges: Array<{ text: string }> };
	assert.equal(p.textDocument.version, 2);
	assert.deepEqual(p.contentChanges, [{ text: "ab" }]); // Sincronização completa: sem range.
	assert.equal(s.documents.get(pathToFileURL(file).href)?.text, "ab");
});

test("markDocumentText: didChange Incremental substitui o range integral do texto anterior", () => {
	const { s, calls } = stubServer(2);
	const file = join(tmpdir(), "mut-inc.go");
	s.documents.set(pathToFileURL(file).href, { text: "a\nb\n", version: 1 });
	markDocumentText(s, file, "a\nb\nc\n");
	const didChange = calls.find((c) => c.method === "textDocument/didChange");
	const p = didChange!.params as { contentChanges: Array<{ range: unknown; text: string }> };
	assert.deepEqual(p.contentChanges[0]!.range, { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } });
	assert.equal(p.contentChanges[0]!.text, "a\nb\nc\n");
});

test("markDocumentText: normaliza chave por realpath (symlink)", async () => {
	const base = mkdtempSync(join(tmpdir(), "lsp-symlink-"));
	try {
		const real = join(base, "real.go");
		writeFileSync(real, "a");
		const link = join(base, "link.go");
		const { symlinkSync } = await import("node:fs");
		symlinkSync(real, link);
		const { s, calls } = stubServer(1);
		// O registro usa a URI real, como após realpath em syncDocument.
		s.documents.set(pathToFileURL(real).href, { text: "a", version: 1 });
		markDocumentText(s, link, "b");
		const didChange = calls.find((c) => c.method === "textDocument/didChange");
		assert.ok(didChange, "didChange deve encontrar o registro via realpath");
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("applyWorkspaceEdit end-to-end: escreve no disco e notifica o servidor", async () => {
	const root = mkdtempSync(join(tmpdir(), "lsp-apply-e2e-"));
	try {
		const a = join(root, "a.go");
		writeFileSync(a, "x\n");
		const { s, calls } = stubServer(1);
		const uri = pathToFileURL(a).href;
		s.documents.set(uri, { text: "x\n", version: 1 });
		const out = await applyWorkspaceEdit(s, { changes: { [uri]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: "y" }] } }, root);
		assert.match(out, /a\.go: 1 edit\(s\)/);
		assert.equal(await importFsRead(a), "y\n");
		const doc = s.documents.get(uri)!;
		assert.equal(doc.text, "y\n");
		assert.equal(doc.version, 2);
		assert.ok(calls.some((c) => c.method === "textDocument/didChange"), "servidor notificado pós-mutação");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

async function importFsRead(p: string): Promise<string> {
	return (await import("node:fs")).readFileSync(p, "utf8");
}

test("applyWorkspaceEdit: version divergente → erro stale sem escrita", async () => {
	const root = mkdtempSync(join(tmpdir(), "lsp-apply-ver-"));
	try {
		const a = join(root, "a.go");
		writeFileSync(a, "x\n");
		const { s } = stubServer(1);
		const uri = pathToFileURL(a).href;
		s.documents.set(uri, { text: "x\n", version: 1 });
		await assert.rejects(
			applyWorkspaceEdit(
				s,
				{ documentChanges: [{ textDocument: { uri, version: 99 }, edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: "y" }] }] },
				root,
			),
			/divergente|stale/,
		);
		assert.equal(await importFsRead(a), "x\n", "nada deve ser escrito");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("applyWorkspaceEdit: arquivo inexistente é criado (dirname real validado)", async () => {
	const root = mkdtempSync(join(tmpdir(), "lsp-apply-new-"));
	try {
		const novo = join(root, "novo.go");
		const { s } = stubServer(1);
		const uri = pathToFileURL(novo).href;
		const out = await applyWorkspaceEdit(s, { changes: { [uri]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "package novo\n" }] } }, root);
		assert.match(out, /novo\.go: 1 edit\(s\)/);
		assert.equal(await importFsRead(novo), "package novo\n");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("spawn falho: runWithServer rejeita sem órfão (fake config)", async () => {
	const { runWithServer } = await import("./server-manager.ts");
	const binDir = mkdtempSync(join(tmpdir(), "lsp-spawn-fail-"));
	try {
		const config: LspConfig = { idleTimeoutMs: 1000, requestTimeoutMs: 1000, cacheDir: join(binDir, "cache") };
		const resolved = {
			spec: { family: "fake", languageIds: {}, exts: [".go"], command: "fake-lsp-server", args: [], markers: [], installHint: "" },
			root: binDir,
			commandPath: join(binDir, "nao-existe"),
		};
		await assert.rejects(runWithServer(resolved, config, async () => "nunca"), /ENOENT|spawn|error/i);
	} finally {
		rmSync(binDir, { recursive: true, force: true });
	}
});
