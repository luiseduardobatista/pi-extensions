import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiffLines } from "./diff-lib.ts";
import type { DiffLine } from "./diff-lib.ts";
import {
	DIFF_BG_ADD,
	DIFF_BG_ADD_GUTTER,
	DIFF_BG_ADD_WORD,
	DIFF_BG_DEL,
	DIFF_BG_DEL_GUTTER,
	DIFF_BG_DEL_WORD,
	hexToBgAnsi,
} from "./diff-palette.ts";
import {
	ADD_BG,
	DEL_BG,
	applyWordBg,
	canHighlight,
	diffBgFor,
	diffLineNumber,
	diffNumberWidth,
	formatDiffGutter,
	formatGapSeparator,
	injectBgInAnsiLine,
	pairWordRanges,
	wordEmphasisMap,
} from "./diff-render.ts";

/** Constrói a expectativa de uma DiffLine de forma compacta. */
function dl(
	kind: DiffLine["kind"],
	oldNum: number | null,
	newNum: number | null,
	content: string,
	skipped: number | null = null,
): DiffLine {
	return { kind, oldNum, newNum, content, skipped };
}

test("paleta: referências de design e variantes derivadas (gutter mais escura, word mais clara)", () => {
	assert.equal(DIFF_BG_ADD, "#203b2b");
	assert.equal(DIFF_BG_DEL, "#4a231f");
	// O gutter escurece o fundo; a ênfase word-level usa a variante clara.
	assert.equal(DIFF_BG_ADD_GUTTER, "#16281e");
	assert.equal(DIFF_BG_ADD_WORD, "#2d5c3a");
	assert.equal(DIFF_BG_DEL_GUTTER, "#301c1c");
	assert.equal(DIFF_BG_DEL_WORD, "#5c2d2d");
	assert.deepEqual(ADD_BG, { base: DIFF_BG_ADD, gutter: DIFF_BG_ADD_GUTTER, word: DIFF_BG_ADD_WORD });
	assert.deepEqual(DEL_BG, { base: DIFF_BG_DEL, gutter: DIFF_BG_DEL_GUTTER, word: DIFF_BG_DEL_WORD });
});

test("hexToBgAnsi: converte hex no código ANSI truecolor de fundo", () => {
	assert.equal(hexToBgAnsi("#203b2b"), "\x1b[48;2;32;59;43m");
	assert.equal(hexToBgAnsi("#4a231f"), "\x1b[48;2;74;35;31m");
});

test("diffBgFor: add/del têm paleta; ctx/gap não têm fundo", () => {
	assert.equal(diffBgFor("add"), ADD_BG);
	assert.equal(diffBgFor("del"), DEL_BG);
	assert.equal(diffBgFor("ctx"), null);
	assert.equal(diffBgFor("gap"), null);
});

test("diffLineNumber: antigo para del/ctx, novo para add, null para gap", () => {
	assert.equal(diffLineNumber(dl("add", null, 5, "x")), 5);
	assert.equal(diffLineNumber(dl("del", 4, null, "x")), 4);
	assert.equal(diffLineNumber(dl("ctx", 7, 7, "x")), 7);
	assert.equal(diffLineNumber(dl("gap", null, null, "...", 3)), null);
});

test("diffNumberWidth: maior número exibido (mínimo 1)", () => {
	assert.equal(diffNumberWidth([dl("add", null, 5, "x")]), 1);
	assert.equal(diffNumberWidth([dl("add", null, 5, "x"), dl("del", 42, null, "y")]), 2);
	assert.equal(diffNumberWidth([dl("gap", null, null, "...", 5)]), 1);
	assert.equal(diffNumberWidth([]), 1);
});

test("formatDiffGutter: barra ▌ e sinal + nas adições, número alinhado à direita", () => {
	assert.deepEqual(formatDiffGutter(dl("add", null, 3, "x"), 2), { bar: "▌", number: " 3", sign: "+" });
	assert.deepEqual(formatDiffGutter(dl("del", 12, null, "x"), 2), { bar: "▌", number: "12", sign: "-" });
});

test("formatDiffGutter: contexto sem barra e sem sinal; gap sem número", () => {
	assert.deepEqual(formatDiffGutter(dl("ctx", 3, 3, "x"), 2), { bar: " ", number: " 3", sign: " " });
	assert.deepEqual(formatDiffGutter(dl("gap", null, null, "...", 5), 2), { bar: " ", number: "  ", sign: " " });
});

test("formatGapSeparator: contagem real quando derivável, sem contagem caso contrário", () => {
	assert.equal(formatGapSeparator(19), "··· 19 unmodified lines ···");
	assert.equal(formatGapSeparator(1), "··· 1 unmodified lines ···");
	assert.equal(formatGapSeparator(null), "··· unmodified lines ···");
	assert.equal(formatGapSeparator(0), "··· 0 unmodified lines ···");
});

test("injectBgInAnsiLine: linha plana recebe o fundo no início", () => {
	assert.equal(injectBgInAnsiLine("const x = 1;", DIFF_BG_ADD), `\x1b[48;2;32;59;43mconst x = 1;`);
});

test("injectBgInAnsiLine: linha vazia vira apenas o fundo", () => {
	assert.equal(injectBgInAnsiLine("", DIFF_BG_ADD), "\x1b[48;2;32;59;43m");
});

test("injectBgInAnsiLine: re-injeta o fundo após resets 39m/0m/49m (e combinados)", () => {
	const line = "\x1b[38;2;86;156;214mconst\x1b[39m x;";
	const expected = "\x1b[48;2;32;59;43m\x1b[38;2;86;156;214mconst\x1b[39m\x1b[48;2;32;59;43m x;";
	assert.equal(injectBgInAnsiLine(line, DIFF_BG_ADD), expected);

	assert.equal(
		injectBgInAnsiLine("a\x1b[0mb", DIFF_BG_ADD),
		"\x1b[48;2;32;59;43ma\x1b[0m\x1b[48;2;32;59;43mb",
	);
	assert.equal(
		injectBgInAnsiLine("a\x1b[49mb", DIFF_BG_ADD),
		"\x1b[48;2;32;59;43ma\x1b[49m\x1b[48;2;32;59;43mb",
	);
	assert.equal(
		injectBgInAnsiLine("a\x1b[0;39mb", DIFF_BG_ADD),
		"\x1b[48;2;32;59;43ma\x1b[0;39m\x1b[48;2;32;59;43mb",
	);
});

test("injectBgInAnsiLine: sequência que só muda o foreground não re-injeta o fundo", () => {
	const line = "\x1b[38;2;86;156;214mconst\x1b[39m";
	const result = injectBgInAnsiLine(line, DIFF_BG_ADD);
	assert.equal(result, "\x1b[48;2;32;59;43m\x1b[38;2;86;156;214mconst\x1b[39m\x1b[48;2;32;59;43m");
});

test("applyWordBg: sem faixas → linha intacta", () => {
	const line = "\x1b[48;2;32;59;43mstatus: rascunho";
	assert.equal(applyWordBg(line, [], DIFF_BG_ADD, DIFF_BG_ADD_WORD), line);
});

test("applyWordBg: faixas aplicam a variante mais clara e restauram o base no fim", () => {
	const base = injectBgInAnsiLine("status: rascunho", DIFF_BG_ADD);
	const result = applyWordBg(base, [[8, 16]], DIFF_BG_ADD, DIFF_BG_ADD_WORD);
	assert.equal(
		result,
		"\x1b[48;2;32;59;43mstatus: \x1b[48;2;45;92;58mrascunho\x1b[48;2;32;59;43m",
	);
});

test("applyWordBg: faixas ignoram sequências ANSI no índice visível", () => {
	const highlighted = "\x1b[38;2;86;156;214mconst\x1b[39m x = 1;";
	const base = injectBgInAnsiLine(highlighted, DIFF_BG_ADD);
	const result = applyWordBg(base, [[10, 11]], DIFF_BG_ADD, DIFF_BG_ADD_WORD);
	assert.ok(result.includes("\x1b[48;2;45;92;58m1\x1b[48;2;32;59;43m"));
	assert.ok(result.startsWith("\x1b[48;2;32;59;43m\x1b[38;2;86;156;214mconst\x1b[39m\x1b[48;2;32;59;43m x = "));
});

test("applyWordBg: faixa no início e no fim da linha", () => {
	const base = injectBgInAnsiLine("abc", DIFF_BG_ADD);
	const result = applyWordBg(base, [[0, 1], [2, 3]], DIFF_BG_ADD, DIFF_BG_ADD_WORD);
	assert.equal(
		result,
		"\x1b[48;2;32;59;43m\x1b[48;2;45;92;58ma\x1b[48;2;32;59;43mb\x1b[48;2;45;92;58mc\x1b[48;2;32;59;43m",
	);
});

test("pairWordRanges: par similar (status: rascunho → pronto) gera faixas nos dois lados", () => {
	const pair = pairWordRanges("status: rascunho", "status: pronto");
	assert.deepEqual(pair, { oldRanges: [[8, 16]], newRanges: [[8, 14]] });
});

test("pairWordRanges: mudança só de um lado → null (sem faixas nos dois lados)", () => {
	assert.equal(pairWordRanges("foo", "foo bar"), null);
	assert.equal(pairWordRanges("foo bar", "foo"), null);
});

test("pairWordRanges: strings idênticas ou muito diferentes → null", () => {
	assert.equal(pairWordRanges("olá mundo", "olá mundo"), null);
	assert.equal(pairWordRanges("aaaa", "bbbb"), null);
});

test("wordEmphasisMap: par 1:1 adjacente similar → faixas nas duas linhas", () => {
	const lines = parseDiffLines("- 1 status: rascunho\n+ 1 status: pronto");
	const map = wordEmphasisMap(lines);
	assert.deepEqual(map.get(0), [[8, 16]]);
	assert.deepEqual(map.get(1), [[8, 14]]);
});

test("wordEmphasisMap: bloco 2:1 não recebe ênfase", () => {
	const lines = parseDiffLines("- 1 a\n- 2 b\n+ 1 a b");
	assert.deepEqual(wordEmphasisMap(lines), new Map());
});

test("wordEmphasisMap: del seguida de add + outra add (1:2) não recebe ênfase", () => {
	const lines = parseDiffLines("- 1 a\n+ 1 a b\n+ 2 c");
	assert.deepEqual(wordEmphasisMap(lines), new Map());
});

test("wordEmphasisMap: del sem add adjacente → sem ênfase", () => {
	const lines = parseDiffLines("- 1 a\n 2 b");
	assert.deepEqual(wordEmphasisMap(lines), new Map());
});

test("wordEmphasisMap: pares separados por contexto recebem ênfase independente", () => {
	const lines = parseDiffLines("- 1 status: rascunho\n+ 1 status: pronto\n 2 ctx\n- 3 foo = 1\n+ 3 foo = 2");
	const map = wordEmphasisMap(lines);
	assert.ok(map.has(0) && map.has(1));
	assert.ok(map.has(3) && map.has(4));
});

test("canHighlight: sem linguagem → false; linguagem + corpo pequeno → true", () => {
	assert.equal(canHighlight(undefined, [dl("add", null, 1, "x")]), false);
	assert.equal(canHighlight("typescript", [dl("add", null, 1, "const x = 1;")]), true);
});

test("canHighlight: corpo acima do limite (80.000 caracteres) → false (texto plano)", () => {
	const big = "x".repeat(80_001);
	assert.equal(canHighlight("typescript", [dl("add", null, 1, big)]), false);
	const atLimit = "x".repeat(80_000);
	assert.equal(canHighlight("typescript", [dl("add", null, 1, atLimit)]), true);
});

test("canHighlight: contexto e gaps não contam para o limite", () => {
	const lines = [dl("ctx", 1, 1, "c".repeat(80_000)), dl("gap", null, null, "...", 5)];
	assert.equal(canHighlight("typescript", lines), true);
});
