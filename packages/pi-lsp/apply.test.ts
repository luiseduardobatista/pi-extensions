/**
 * Testes da política de WorkspaceEdit (spec §3.5/§5.10): offsets, aplicação
 * com ordem/inserções, rejeições e match de code action.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyEditsToText, lineOffsets, offsetAt, normalizeWorkspaceEdit, summarizeWorkspaceEdit } from "./apply.ts";
import { docHashOf, fingerprint, matchExact, type ActionEntry } from "./actions.ts";

const r = (line: number, character: number): { start: { line: number; character: number }; end: { line: number; character: number } } => ({
	start: { line, character },
	end: { line, character },
});

test("lineOffsets/offsetAt: posições por linha", () => {
	const text = "ab\ncd\nef";
	assert.deepEqual(lineOffsets(text), [0, 3, 6]);
	assert.equal(offsetAt(text, { line: 1, character: 1 }), 4);
	assert.throws(() => offsetAt(text, { line: 3, character: 0 }), /fora do documento/);
	assert.throws(() => offsetAt(text, { line: 2, character: 3 }), /fora do documento/);
});

test("applyEditsToText: substituição simples e múltiplas em ordem", () => {
	const text = "const a = 1;\nconst b = 2;\n";
	assert.equal(
		applyEditsToText(text, [{ range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } }, newText: "x" }]),
		"const x = 1;\nconst b = 2;\n",
	);
	const out = applyEditsToText(text, [
		{ range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } }, newText: "X" },
		{ range: { start: { line: 1, character: 6 }, end: { line: 1, character: 7 } }, newText: "Y" },
	]);
	assert.equal(out, "const X = 1;\nconst Y = 2;\n");
});

test("applyEditsToText: inserções no mesmo ponto preservam ordem do array", () => {
	const text = "ab";
	const out = applyEditsToText(text, [
		{ range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } }, newText: "1" },
		{ range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } }, newText: "2" },
	]);
	assert.equal(out, "a12b");
});

test("applyEditsToText: rejeita sobreposição e inserção dentro de edit", () => {
	const text = "abcdef";
	assert.throws(
		() =>
			applyEditsToText(text, [
				{ range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } }, newText: "X" },
				{ range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } }, newText: "Y" },
			]),
		/sobrepostos|inserção/,
	);
	assert.throws(
		() =>
			applyEditsToText(text, [
				{ range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } }, newText: "X" },
				{ range: { start: { line: 0, character: 2 }, end: { line: 0, character: 2 } }, newText: "Y" },
			]),
		/sobrepostos|inserção/,
	);
	// Inserção imediatamente após outro edit é válida.
	assert.equal(
		applyEditsToText(text, [
			{ range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } }, newText: "X" },
			{ range: { start: { line: 0, character: 4 }, end: { line: 0, character: 4 } }, newText: "!" },
		]),
		"aX!ef",
	);
});

test("applyEditsToText: range invertido e fora do documento rejeitados", () => {
	assert.throws(() => applyEditsToText("ab", [{ range: { start: { line: 0, character: 2 }, end: { line: 0, character: 1 } }, newText: "x" }]), /invertido/);
	assert.throws(() => applyEditsToText("ab", [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: "x" }]), /fora do documento/);
});

test("normalizeWorkspaceEdit: rejeita resource ops, mistura e URI fora do root", () => {
	const root = mkdtempSync(join(tmpdir(), "lsp-edit-"));
	try {
		mkdirSync(join(root, "sub"));
		const inside = `${root}/sub/a.go`;
		writeFileSync(inside, "package sub\n");
		const outside = `${tmpdir()}/lsp-fora-do-root.go`;
		writeFileSync(outside, "x\n");
		try {
			assert.throws(
				() => normalizeWorkspaceEdit({ documentChanges: [{ kind: "create", uri: `file://${root}/new.go` }] }, root),
				/resource operation/,
			);
			assert.throws(
				() =>
					normalizeWorkspaceEdit(
						{
							changes: { [`file://${inside}`]: [{ range: r(0, 0), newText: "y" }] },
							documentChanges: [{ uri: `file://${inside}`, edits: [{ range: r(0, 0), newText: "z" }] }],
						},
						root,
					),
				/mistura/,
			);
			assert.throws(
				() => normalizeWorkspaceEdit({ changes: { [`file://${outside}`]: [{ range: r(0, 0), newText: "y" }] } }, root),
				/fora do root/,
			);
			assert.throws(() => normalizeWorkspaceEdit({ changes: { "untitled:1": [] } }, root), /não-file/);
			const files = normalizeWorkspaceEdit(
				{ changes: { [`file://${inside}`]: [{ range: r(0, 0), newText: "y" }] } },
				root,
			);
			assert.equal(files.length, 1);
			assert.equal(files[0]!.path, inside);
		} finally {
			rmSync(outside, { force: true });
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("summarizeWorkspaceEdit: contagem por arquivo com cap", () => {
	const root = mkdtempSync(join(tmpdir(), "lsp-edit2-"));
	try {
		const a = join(root, "a.go");
		writeFileSync(a, "x\n");
		const edit = { changes: { [`file://${a}`]: [{ range: r(0, 0), newText: "y" }, { range: r(0, 1), newText: "z" }] } };
		const summary = summarizeWorkspaceEdit(edit, root);
		assert.match(summary, /a\.go: 2 edit\(s\)/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("docHashOf: estável por conteúdo", () => {
	assert.equal(docHashOf("abc"), docHashOf("abc"));
	assert.notEqual(docHashOf("abc"), docHashOf("abd"));
});

test("matchExact: exige exatamente um match por data + título + fingerprint", () => {
	const entry: ActionEntry = {
		id: "x",
		file: "/a.go",
		line: 1,
		column: 1,
		docHash: "h",
		title: "Fix",
		data: { d: 1 },
		edit: { changes: { "file:///a.go": [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: "y" }] } },
	};
	const same = { title: "Fix", data: { d: 1 }, edit: entry.edit };
	const other = { title: "Outra", data: { d: 1 }, edit: entry.edit };
	const diffData = { title: "Fix", data: { d: 2 }, edit: entry.edit };
	assert.ok(matchExact(entry, [same]));
	assert.equal(matchExact(entry, [other]), null);
	assert.equal(matchExact(entry, [diffData]), null);
	assert.equal(matchExact(entry, [same, same]), null, "ambiguidade → stale");
	assert.equal(matchExact(entry, []), null);
});

test("fingerprint: normaliza ausências", () => {
	assert.equal(fingerprint({}), fingerprint({ title: undefined, edit: undefined }));
	assert.notEqual(fingerprint({ edit: { a: 1 } }), fingerprint({ edit: { a: 2 } }));
});
