/**
 * Testes dos helpers puros das operações (spec §5.10): posições, caps,
 * normalização de locations/hover/symbols.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { toLspPosition, fullRangeEnd, lineAt } from "./positions.ts";
import { capEntries, hoverText, flattenSymbols, symbolKindName, toLocs } from "./ops.ts";

test("toLspPosition: 1-based para 0-based em utf-16", () => {
	const text = "const a = 1;\nconst b = 2;\n";
	assert.deepEqual(toLspPosition(text, 1, 1, "utf-16"), { line: 0, character: 0 });
	assert.deepEqual(toLspPosition(text, 2, 7, "utf-16"), { line: 1, character: 6 });
	// coluna no fim da linha (após o último caractere) é válida
	assert.deepEqual(toLspPosition(text, 1, 13, "utf-16"), { line: 0, character: 12 });
});

test("toLspPosition: utf-8 conta bytes, utf-16 conta code units", () => {
	const text = "const x = 'café';\n";
	const colFim = text.indexOf("'", 11) + 1;
	assert.equal(toLspPosition(text, 1, colFim, "utf-16").character, "const x = 'café".length);
	assert.equal(toLspPosition(text, 1, colFim, "utf-8").character, Buffer.byteLength("const x = 'café", "utf8"));
});

test("toLspPosition: emoji (surrogate pair) conta 2 code units em utf-16 e 4 bytes em utf-8", () => {
	const text = "const x = '😀';\n";
	const colFim = text.indexOf(";") + 1;
	assert.equal(toLspPosition(text, 1, colFim, "utf-16").character, "const x = '😀'".length);
	assert.equal(toLspPosition(text, 1, colFim, "utf-8").character, Buffer.byteLength("const x = '😀'", "utf8"));
});

test("toLspPosition: valida linha/coluna fora do documento", () => {
	const text = "abc\ndef";
	assert.throws(() => toLspPosition(text, 3, 1, "utf-16"), /fora do documento/);
	assert.throws(() => toLspPosition(text, 1, 5, "utf-16"), /fora da linha/);
	assert.throws(() => toLspPosition(text, 0, 1, "utf-16"), /1-based/);
	assert.throws(() => toLspPosition(text, 1, 0, "utf-16"), /1-based/);
});

test("lineAt: ignora \r de quebra CRLF", () => {
	assert.equal(lineAt("a\r\nb\r\n", 1), "b");
});

test("fullRangeEnd: fim do documento com e sem quebra final", () => {
	assert.deepEqual(fullRangeEnd("a\nb\n"), { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } });
	assert.deepEqual(fullRangeEnd("a\nb"), { start: { line: 0, character: 0 }, end: { line: 1, character: 1 } });
});

test("capEntries: truncamento explícito com aviso", () => {
	assert.deepEqual(capEntries(["a", "b"], 5), ["a", "b"]);
	assert.deepEqual(capEntries(["a", "b", "c"], 2), ["a", "b", "… (1 a mais)"]);
});

test("toLocs: Location, Location[] e LocationLink[]", () => {
	assert.deepEqual(toLocs(null), []);
	assert.deepEqual(toLocs({ uri: "file:///a.ts", range: { start: { line: 3, character: 4 } } }), [{ uri: "file:///a.ts", line0: 3, char0: 4 }]);
	assert.deepEqual(toLocs([{ uri: "file:///a.ts", range: { start: { line: 1, character: 2 } } }]), [{ uri: "file:///a.ts", line0: 1, char0: 2 }]);
	assert.deepEqual(toLocs([{ targetUri: "file:///b.ts", targetRange: { start: { line: 9, character: 0 } } }]), [{ uri: "file:///b.ts", line0: 9, char0: 0 }]);
});

test("hoverText: string, MarkupContent, array e vazio", () => {
	assert.equal(hoverText("x"), "x");
	assert.equal(hoverText({ kind: "markdown", value: "**doc**" }), "**doc**");
	assert.equal(hoverText([{ language: "go", value: "func x()" }, "segunda linha"]), "func x()\nsegunda linha");
	assert.equal(hoverText({ language: "go" }), "");
	assert.equal(hoverText(null), "");
});

test("flattenSymbols: DocumentSymbol aninhado e SymbolInformation plano", () => {
	const docSymbols = [
		{ name: "main", kind: 12, range: { start: { line: 0 } }, children: [{ name: "helper", kind: 12, range: { start: { line: 2 } }, children: [] }] },
	];
	const flat = flattenSymbols(docSymbols);
	assert.equal(flat.length, 2);
	assert.equal(flat[0]!.indent, "");
	assert.equal(flat[1]!.indent, "  ");
	assert.equal(flat[1]!.line1, 3);

	const infoSymbols = [{ name: "g", kind: 12, location: { range: { start: { line: 5 } } } }];
	assert.equal(flattenSymbols(infoSymbols)[0]!.line1, 6);
	assert.equal(flattenSymbols(null).length, 0);
});

test("symbolKindName: nomes conhecidos e fallback", () => {
	assert.equal(symbolKindName(12), "Function");
	assert.equal(symbolKindName(5), "Class");
	assert.equal(symbolKindName(999), "Symbol");
});
