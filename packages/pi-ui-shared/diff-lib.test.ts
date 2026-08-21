import { test } from "node:test";
import assert from "node:assert/strict";
import { countDiffChanges, parseDiffLines, wordDiffRanges } from "./diff-lib.ts";
import type { DiffLine } from "./diff-lib.ts";

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

test("parseDiffLines: adds, dels e ctx com oldNum/newNum corretos", () => {
	const parsed = parseDiffLines("+1 foo\n-2 bar\n 3 baz");
	assert.deepEqual(parsed, [
		dl("add", null, 1, "foo"),
		dl("del", 2, null, "bar"),
		dl("ctx", 3, 3, "baz"),
	]);
});

test("parseDiffLines: ctx tem oldNum === newNum", () => {
	const [line] = parseDiffLines(" 42 contexto");
	assert.equal(line.kind, "ctx");
	assert.equal(line.oldNum, 42);
	assert.equal(line.newNum, 42);
});

test("parseDiffLines: números com zero-padding são normalizados", () => {
	const parsed = parseDiffLines("+007 foo\n-042 bar\n 003 baz");
	assert.deepEqual(parsed, [
		dl("add", null, 7, "foo"),
		dl("del", 42, null, "bar"),
		dl("ctx", 3, 3, "baz"),
	]);
});

test("parseDiffLines: números com padding de espaços (formato real do Pi)", () => {
	const parsed = parseDiffLines("- 1 linha\n+ 1 linha alterada\n 12 contexto");
	assert.deepEqual(parsed, [
		dl("del", 1, null, "linha"),
		dl("add", null, 1, "linha alterada"),
		dl("ctx", 12, 12, "contexto"),
	]);
});

test("parseDiffLines: conteúdo quebrado no primeiro espaço após o número", () => {
	// O conteúdo pode começar com espaços — eles são preservados.
	const [line] = parseDiffLines("+003   indented");
	assert.deepEqual(line, dl("add", null, 3, "  indented"));
});

test("parseDiffLines: conteúdo vazio (linha adicionada/removida em branco)", () => {
	assert.deepEqual(parseDiffLines("+5\n-7 "), [dl("add", null, 5, ""), dl("del", 7, null, "")]);
});

test("parseDiffLines: conteúdo unicode é preservado", () => {
	const parsed = parseDiffLines("+1 olá mundo ✓\n-1 olá mundo");
	assert.deepEqual(parsed, [
		dl("add", null, 1, "olá mundo ✓"),
		dl("del", 1, null, "olá mundo"),
	]);
});

test("parseDiffLines: quebra final não gera linha extra; linhas vazias ignoradas", () => {
	assert.deepEqual(parseDiffLines(" 1 a\n 2 b\n"), [
		dl("ctx", 1, 1, "a"),
		dl("ctx", 2, 2, "b"),
	]);
	assert.deepEqual(parseDiffLines(""), []);
});

test("parseDiffLines: linhas fora do formato oficial são ignoradas defensivamente", () => {
	const parsed = parseDiffLines("--- a/x.ts\n+++ b/x.ts\n@@ -1,3 +1,3 @@\n+1 foo\n foo");
	assert.deepEqual(parsed, [dl("add", null, 1, "foo")]);
});

test("parseDiffLines: gap com contagem derivável dos vizinhos", () => {
	// 28 − 8 − 1 = 19
	const parsed = parseDiffLines(" 8 x\n    ...\n 28 y");
	assert.deepEqual(parsed, [
		dl("ctx", 8, 8, "x"),
		dl("gap", null, null, "...", 19),
		dl("ctx", 28, 28, "y"),
	]);
});

test("parseDiffLines: gap usa o lado da próxima linha (newNum para add)", () => {
	const parsed = parseDiffLines("+ 8 x\n    ...\n+28 y");
	assert.deepEqual(parsed, [
		dl("add", null, 8, "x"),
		dl("gap", null, null, "...", 19),
		dl("add", null, 28, "y"),
	]);
});

test("parseDiffLines: gap sem vizinho numerado → skipped null, sem exceção", () => {
	assert.deepEqual(parseDiffLines("    ..."), [dl("gap", null, null, "...", null)]);
	assert.deepEqual(parseDiffLines("    ...\n 28 y"), [
		dl("gap", null, null, "...", null),
		dl("ctx", 28, 28, "y"),
	]);
	assert.deepEqual(parseDiffLines(" 8 x\n    ..."), [
		dl("ctx", 8, 8, "x"),
		dl("gap", null, null, "...", null),
	]);
});

test("parseDiffLines: gap com vizinho sem o número do lado certo → skipped null", () => {
	// Próxima linha é add (lado novo); a anterior é del (só tem oldNum).
	const parsed = parseDiffLines("-5 x\n    ...\n+9 y");
	assert.deepEqual(parsed, [
		dl("del", 5, null, "x"),
		dl("gap", null, null, "...", null),
		dl("add", null, 9, "y"),
	]);
});

test("parseDiffLines: gap entre bloco add e contexto deriva pelo lado novo", () => {
	// Anterior é add (só newNum) e a próxima é ctx (tem os dois): o lado
	// preferido (oldNum da próxima) falta na anterior — cai para o lado novo.
	const parsed = parseDiffLines("+ 8 x\n    ...\n 28 y");
	assert.deepEqual(parsed, [
		dl("add", null, 8, "x"),
		dl("gap", null, null, "...", 19),
		dl("ctx", 28, 28, "y"),
	]);
});

test("parseDiffLines: gap entre contexto e bloco add deriva pelo lado novo", () => {
	// Próxima é add (só newNum); a anterior ctx tem os dois números.
	const parsed = parseDiffLines(" 8 x\n    ...\n+28 y");
	assert.deepEqual(parsed, [
		dl("ctx", 8, 8, "x"),
		dl("gap", null, null, "...", 19),
		dl("add", null, 28, "y"),
	]);
});

test("parseDiffLines: gap entre bloco del e contexto deriva pelo lado antigo", () => {
	const parsed = parseDiffLines("- 8 x\n    ...\n 28 y");
	assert.deepEqual(parsed, [
		dl("del", 8, null, "x"),
		dl("gap", null, null, "...", 19),
		dl("ctx", 28, 28, "y"),
	]);
});

test("parseDiffLines: marcador no início/fim não deriva contagem mesmo com vizinho numerado", () => {
	// Sem o vizinho do lado oposto não há par para derivar a contagem.
	assert.deepEqual(parseDiffLines("    ...\n+28 y"), [
		dl("gap", null, null, "...", null),
		dl("add", null, 28, "y"),
	]);
	assert.deepEqual(parseDiffLines("- 8 x\n    ..."), [
		dl("del", 8, null, "x"),
		dl("gap", null, null, "...", null),
	]);
});

test("parseDiffLines: marcadores consecutivos pulam até a próxima linha mostrada", () => {
	const parsed = parseDiffLines(" 8 x\n    ...\n    ...\n 28 y");
	assert.equal(parsed[1].kind, "gap");
	assert.equal(parsed[2].kind, "gap");
	assert.equal(parsed[1].skipped, 19);
	assert.equal(parsed[2].skipped, 19);
});

test("parseDiffLines: diff realista multi-linha no formato oficial (gerado pelo Pi)", () => {
	// Fixture real: saída de generateDiffString (contexto 4) para um arquivo
	// de 30 linhas com mudanças no início, no meio e perto do fim.
	const diff = [
		"- 1 linha 01",
		"- 2 linha 02",
		"+ 1 linha 01 alterada no início",
		"+ 2 linha 02 alterada também",
		"  3 linha 03",
		"  4 linha 04",
		"  5 linha 05",
		"  6 linha 06",
		"  7 linha 07",
		"  8 linha 08",
		"  9 linha 09",
		"-10 linha 10",
		"-11 linha 11",
		"+10 linha 10 mudou",
		"+11 linha 11 mudou também",
		" 12 linha 12",
		" 13 linha 13",
		" 14 linha 14",
		" 15 linha 15",
		"    ...",
		" 21 linha 21",
		" 22 linha 22",
		" 23 linha 23",
		" 24 linha 24",
		"-25 linha 25",
		"+25 linha 25 mudou perto do fim",
		" 26 linha 26",
		" 27 linha 27",
		" 28 linha 28",
		" 29 linha 29",
		"    ...",
	].join("\n");

	const expected = [
		dl("del", 1, null, "linha 01"),
		dl("del", 2, null, "linha 02"),
		dl("add", null, 1, "linha 01 alterada no início"),
		dl("add", null, 2, "linha 02 alterada também"),
		dl("ctx", 3, 3, "linha 03"),
		dl("ctx", 4, 4, "linha 04"),
		dl("ctx", 5, 5, "linha 05"),
		dl("ctx", 6, 6, "linha 06"),
		dl("ctx", 7, 7, "linha 07"),
		dl("ctx", 8, 8, "linha 08"),
		dl("ctx", 9, 9, "linha 09"),
		dl("del", 10, null, "linha 10"),
		dl("del", 11, null, "linha 11"),
		dl("add", null, 10, "linha 10 mudou"),
		dl("add", null, 11, "linha 11 mudou também"),
		dl("ctx", 12, 12, "linha 12"),
		dl("ctx", 13, 13, "linha 13"),
		dl("ctx", 14, 14, "linha 14"),
		dl("ctx", 15, 15, "linha 15"),
		// 21 − 15 − 1 = 5 (linhas 16..20 omitidas)
		dl("gap", null, null, "...", 5),
		dl("ctx", 21, 21, "linha 21"),
		dl("ctx", 22, 22, "linha 22"),
		dl("ctx", 23, 23, "linha 23"),
		dl("ctx", 24, 24, "linha 24"),
		dl("del", 25, null, "linha 25"),
		dl("add", null, 25, "linha 25 mudou perto do fim"),
		dl("ctx", 26, 26, "linha 26"),
		dl("ctx", 27, 27, "linha 27"),
		dl("ctx", 28, 28, "linha 28"),
		dl("ctx", 29, 29, "linha 29"),
		// Marcador no fim do diff — sem linha seguinte, contagem não derivável.
		dl("gap", null, null, "...", null),
	];

	assert.deepEqual(parseDiffLines(diff), expected);
});

test("parseDiffLines: diff realista com marcador no início (gerado pelo Pi)", () => {
	const diff = [
		"    ...",
		" 16 linha 16",
		" 17 linha 17",
		" 18 linha 18",
		" 19 linha 19",
		"-20 linha 20",
		"+20 linha 20 mudou no meio",
		" 21 linha 21",
		" 22 linha 22",
		" 23 linha 23",
		" 24 linha 24",
		"    ...",
	].join("\n");

	const parsed = parseDiffLines(diff);
	assert.equal(parsed.length, 12);
	assert.deepEqual(parsed[0], dl("gap", null, null, "...", null));
	assert.deepEqual(parsed[1], dl("ctx", 16, 16, "linha 16"));
	assert.deepEqual(parsed[11], dl("gap", null, null, "...", null));
});

test("wordDiffRanges: par similar gera faixas nos dois lados e similarity >= 0.15", () => {
	const result = wordDiffRanges("status: rascunho", "status: pronto");
	assert.ok(result, "diffWords deve estar disponível (pacote diff resolve neste ambiente)");
	assert.equal(result.similarity, 8 / 16); // 0.5 — acima do limiar de 0.15
	assert.ok(result.similarity >= 0.15);
	assert.deepEqual(result.oldRanges, [[8, 16]]); // "rascunho"
	assert.deepEqual(result.newRanges, [[8, 14]]); // "pronto"
});

test("wordDiffRanges: mudança apenas de um lado não produz faixas nos dois lados", () => {
	// Palavra apenas adicionada: lado antigo sem faixas.
	const added = wordDiffRanges("foo", "foo bar");
	assert.ok(added);
	assert.deepEqual(added.oldRanges, []);
	assert.deepEqual(added.newRanges, [[4, 7]]); // " bar"
	assert.equal(added.similarity, 4 / 7);

	// Palavra apenas removida: lado novo sem faixas.
	// (Tokenização assimétrica de espaços do diffWords: aqui o espaço fica
	// no token removido — 3/7 em vez de 4/7.)
	const removed = wordDiffRanges("foo bar", "foo");
	assert.ok(removed);
	assert.deepEqual(removed.oldRanges, [[3, 7]]);
	assert.deepEqual(removed.newRanges, []);
	assert.equal(removed.similarity, 3 / 7);
});

test("wordDiffRanges: strings idênticas → similarity 1 e sem faixas", () => {
	const result = wordDiffRanges("olá mundo", "olá mundo");
	assert.ok(result);
	assert.deepEqual(result, { similarity: 1, oldRanges: [], newRanges: [] });
});

test("wordDiffRanges: strings vazias → similarity 1 e sem faixas", () => {
	const result = wordDiffRanges("", "");
	assert.ok(result);
	assert.deepEqual(result, { similarity: 1, oldRanges: [], newRanges: [] });
});

test("wordDiffRanges: strings totalmente diferentes → similarity abaixo do limiar", () => {
	const result = wordDiffRanges("aaaa", "bbbb");
	assert.ok(result);
	assert.equal(result.similarity, 0);
	assert.ok(result.similarity < 0.15); // renderer omite a ênfase
	assert.deepEqual(result.oldRanges, [[0, 4]]);
	assert.deepEqual(result.newRanges, [[0, 4]]);
});

test("wordDiffRanges: mudança pontual em linha de código", () => {
	const result = wordDiffRanges("const x = 1;", "const x = 2;");
	assert.ok(result);
	assert.equal(result.similarity, 11 / 12);
	assert.deepEqual(result.oldRanges, [[10, 11]]);
	assert.deepEqual(result.newRanges, [[10, 11]]);
});

test("wordDiffRanges: pré-filtro — razão < 0.15 não chama diffWords e retorna faixas vazias", () => {
	// diffWords para pares totalmente diferentes produziria faixas nos dois
	// lados (ver teste acima); faixas vazias + similarity = razão exata
	// provam que o pré-filtro desviou antes de diffWords.
	assert.deepEqual(wordDiffRanges("a", "xxxxxxxx"), {
		similarity: 1 / 8, // 0.125 < 0.15
		oldRanges: [],
		newRanges: [],
	});
	// Ordem invertida (lado novo menor) também cai no pré-filtro.
	assert.deepEqual(wordDiffRanges("xxxxxxxx", "a"), {
		similarity: 1 / 8,
		oldRanges: [],
		newRanges: [],
	});
	// Lado menor contido no maior: mesmo assim a similarity fica no piso.
	assert.deepEqual(wordDiffRanges("abcdefghij", "a"), {
		similarity: 0.1,
		oldRanges: [],
		newRanges: [],
	});
});

test("wordDiffRanges: pré-filtro não atua na razão exatamente no limiar (0.15)", () => {
	// 3/20 = 0.15: passa pelo filtro e segue para diffWords, que produz
	// faixas não vazias mesmo com similarity 0.
	const result = wordDiffRanges("aaa", "x".repeat(20));
	assert.ok(result);
	assert.equal(result.similarity, 0);
	assert.ok(result.oldRanges.length > 0);
	assert.ok(result.newRanges.length > 0);
});

test("wordDiffRanges: mesmo par retorna resultado idêntico em chamadas repetidas (cache)", () => {
	const a = "status: rascunho";
	const b = "status: pronto";
	const first = wordDiffRanges(a, b);
	const second = wordDiffRanges(a, b);
	const third = wordDiffRanges(a, b);
	assert.deepEqual(second, first);
	assert.deepEqual(third, first);
});

test("wordDiffRanges: eviction do cache LRU (300 pares, capacidade 192) mantém resultados corretos", () => {
	for (let i = 0; i < 300; i++) {
		const a = `linha ${i} com conteúdo comum aqui`;
		const b = `linha ${i} com conteúdo comum alterado`;
		const result = wordDiffRanges(a, b);
		assert.ok(result, `par ${i} deve ter resultado`);
		assert.ok(result.similarity >= 0.15, `par ${i} acima do limiar`);
		assert.ok(result.oldRanges.length > 0 && result.newRanges.length > 0, `par ${i} com faixas nos dois lados`);
	}
});

test("countDiffChanges: contagens derivadas do parse no formato display do edit", () => {
	const lines = parseDiffLines("+1 novo\n-1 antigo\n 2 contexto\n    ...\n+3 adicionada");
	assert.deepEqual(countDiffChanges(lines), { added: 2, removed: 1 });
});

test("countDiffChanges: cabeçalhos e linhas fora do formato não contam", () => {
	const lines = parseDiffLines("--- a/x.ts\n+++ b/x.ts\n@@ -1,3 +1,3 @@\n+1 foo\n foo");
	assert.deepEqual(countDiffChanges(lines), { added: 1, removed: 0 });
});

test("countDiffChanges: diff realista do Pi (fixture de 30 linhas) → 5 adds / 5 dels", () => {
	const diff = [
		"- 1 linha 01",
		"- 2 linha 02",
		"+ 1 linha 01 alterada no início",
		"+ 2 linha 02 alterada também",
		"  3 linha 03",
		"  4 linha 04",
		"  5 linha 05",
		"  6 linha 06",
		"  7 linha 07",
		"  8 linha 08",
		"  9 linha 09",
		"-10 linha 10",
		"-11 linha 11",
		"+10 linha 10 mudou",
		"+11 linha 11 mudou também",
		" 12 linha 12",
		" 13 linha 13",
		" 14 linha 14",
		" 15 linha 15",
		"    ...",
		" 21 linha 21",
		" 22 linha 22",
		" 23 linha 23",
		" 24 linha 24",
		"-25 linha 25",
		"+25 linha 25 mudou perto do fim",
		" 26 linha 26",
		" 27 linha 27",
		" 28 linha 28",
		" 29 linha 29",
		"    ...",
	].join("\n");
	assert.deepEqual(countDiffChanges(parseDiffLines(diff)), { added: 5, removed: 5 });
});

test("countDiffChanges: sem mudanças (só contexto/gaps) → zero", () => {
	assert.deepEqual(countDiffChanges(parseDiffLines(" 1 linha\n 2 outra\n    ...")), { added: 0, removed: 0 });
	assert.deepEqual(countDiffChanges([]), { added: 0, removed: 0 });
});
