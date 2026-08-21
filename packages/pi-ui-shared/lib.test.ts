import { test } from "node:test";
import assert from "node:assert/strict";
import {
	formatContextPct,
	formatPath,
	formatTps,
	bashOutputPresentation,
	compactBashOutput,
	countLines,
	DIFF_COLLAPSED_LINES,
	EXPANDED_MAX_LINES,
	formatUsage,
	headSlice,
	previewLines,
	PREVIEW_LINES,
	prioritizeFooter,
	shortenCommand,
	shortenPathDisplay,
	splitBashError,
	splitLines,
	truncateToWidth,
	visibleWidth,
} from "./lib.ts";

test("visibleWidth: vazio e ASCII", () => {
	assert.equal(visibleWidth(""), 0);
	assert.equal(visibleWidth("hello"), 5);
	assert.equal(visibleWidth("hello world"), 11);
});

test("visibleWidth: ignora ANSI (CSI, OSC, APC)", () => {
	assert.equal(visibleWidth("\x1b[31mred\x1b[0m"), 3);
	assert.equal(visibleWidth("\x1b[38;2;255;0;0mX\x1b[0m"), 1);
	assert.equal(visibleWidth("\x1b]8;;https://example.com\x07link\x1b]8;;\x07"), 4);
	assert.equal(visibleWidth("\x1b_apc-marker\x1b\\x"), 1);
});

test("visibleWidth: unicode", () => {
	assert.equal(visibleWidth("olá"), 3); // á pré-composto
	assert.equal(visibleWidth("e\u0301"), 1); // acento combinante
	assert.equal(visibleWidth("日本語"), 6); // CJK = 2 colunas cada
	assert.equal(visibleWidth("👋"), 2); // emoji
	assert.equal(visibleWidth("👋 world"), 8);
	assert.equal(visibleWidth("👨\u200d👩\u200d👧"), 2); // família (ZWJ) = 1 grafema
});

test("visibleWidth: tabs viram 3 colunas", () => {
	assert.equal(visibleWidth("\t"), 3);
	assert.equal(visibleWidth("a\tb"), 5);
});

test("truncateToWidth: texto que cabe não é alterado", () => {
	assert.equal(truncateToWidth("hello", 10), "hello");
	assert.equal(truncateToWidth("hello world", 11), "hello world");
	assert.equal(truncateToWidth("", 5), "");
});

test("truncateToWidth: casos de borda de largura", () => {
	assert.equal(truncateToWidth("hello", 0), "");
	assert.equal(truncateToWidth("hello", -1), "");
	assert.equal(truncateToWidth("hello", 5), "hello");
});

test("truncateToWidth: trunca por largura visível com elipse", () => {
	// o resultado termina com reset de estilo (comportamento do pi-tui)
	const out = truncateToWidth("hello world", 5);
	assert.equal(out, "hell\x1b[0m…\x1b[0m");
	assert.equal(visibleWidth(out), 5);
});

test("truncateToWidth: longos", () => {
	const out = truncateToWidth("a".repeat(500), 100);
	assert.equal(visibleWidth(out), 100);
	assert.ok(out.includes("…"));
	assert.ok(out.startsWith("a".repeat(99)));
});

test("truncateToWidth: preserva ANSI sem quebrar sequências", () => {
	const out = truncateToWidth("\x1b[31mhello world\x1b[0m", 8);
	// cor aplicada ao prefixo, reset antes da elipse, reset no fim
	assert.equal(out, "\x1b[31mhello w\x1b[0m…\x1b[0m");
	assert.equal(visibleWidth(out), 8);
});

test("truncateToWidth: ANSI no meio do texto", () => {
	const out = truncateToWidth("ab\x1b[32mcd\x1b[0mef", 4);
	assert.equal(out, "ab\x1b[32mc\x1b[0m…\x1b[0m");
	assert.equal(visibleWidth(out), 4);
});

test("truncateToWidth: texto só de ANSI permanece intacto", () => {
	assert.equal(truncateToWidth("\x1b[31m", 5), "\x1b[31m");
});

test("truncateToWidth: unicode largo", () => {
	const out = truncateToWidth("日本語テスト", 5);
	assert.equal(out, "日本\x1b[0m…\x1b[0m");
	assert.equal(visibleWidth(out), 5);

	const emoji = truncateToWidth("👋👋👋", 5);
	assert.equal(emoji, "👋👋\x1b[0m…\x1b[0m");
	assert.equal(visibleWidth(emoji), 5);
});

test("truncateToWidth: elipse customizada e vazia", () => {
	assert.equal(truncateToWidth("hello world", 6, ".."), "hell\x1b[0m..\x1b[0m");
	assert.equal(truncateToWidth("hello world", 5, ""), "hello\x1b[0m");
	assert.equal(visibleWidth(truncateToWidth("hello world", 5, "")), 5);
});

test("truncateToWidth: elipse maior que a largura é truncada", () => {
	const out = truncateToWidth("abcdef", 1);
	assert.equal(visibleWidth(out), 1);
	assert.ok(out.startsWith("…"));
	const out2 = truncateToWidth("abcdef", 2);
	assert.equal(out2, "a\x1b[0m…\x1b[0m");
	assert.equal(visibleWidth(out2), 2);
});

test("truncateToWidth: nunca estoura a largura pedida", () => {
	const samples = [
		"hello world foo bar",
		"\x1b[31mhello\x1b[0m \x1b[32mworld\x1b[0m",
		"日本語のテキストです",
		"a".repeat(300),
		"👋 emoji 👋 aqui",
	];
	for (const sample of samples) {
		for (const width of [0, 1, 2, 3, 5, 8, 13, 21]) {
			const out = truncateToWidth(sample, width);
			assert.ok(visibleWidth(out) <= width, `width=${width} → ${JSON.stringify(out)}`);
		}
	}
});

test("formatUsage: unidades e casas decimais", () => {
	assert.equal(formatUsage(0), "0");
	assert.equal(formatUsage(512), "512");
	assert.equal(formatUsage(999), "999");
	assert.equal(formatUsage(999.4), "999");
	assert.equal(formatUsage(1000), "1.0K");
	assert.equal(formatUsage(1500), "1.5K");
	assert.equal(formatUsage(33333), "33.3K");
	assert.equal(formatUsage(999999), "1000.0K");
	assert.equal(formatUsage(1_000_000), "1.0M");
	assert.equal(formatUsage(1_234_567), "1.2M");
	assert.equal(formatUsage(-5), "0");
});

test("formatTps: tokens por segundo", () => {
	assert.equal(formatTps(0), "0.0");
	assert.equal(formatTps(3.25), "3.3");
	assert.equal(formatTps(9.94), "9.9");
	assert.equal(formatTps(12.34), "12.3");
	assert.equal(formatTps(99.9), "99.9");
	assert.equal(formatTps(99.95), "100.0");
	assert.equal(formatTps(100), "100");
	assert.equal(formatTps(123.6), "124");
	assert.equal(formatTps(999.4), "999");
	assert.equal(formatTps(999.5), "1.0K");
	assert.equal(formatTps(1000), "1.0K");
	assert.equal(formatTps(1234), "1.2K");
	assert.equal(formatTps(-5), "0.0");
});

test("formatContextPct: percentuais inteiros e com 1 casa", () => {
	assert.equal(formatContextPct(300, 10000), "3%");
	assert.equal(formatContextPct(4250, 10000), "42.5%");
	assert.equal(formatContextPct(0, 10000), "0%");
	assert.equal(formatContextPct(10000, 10000), "100%");
	assert.equal(formatContextPct(500, 10000), "5%");
	assert.equal(formatContextPct(1234, 10000), "12.3%");
	assert.equal(formatContextPct(12345, 10000), "123.5%");
	assert.equal(formatContextPct(1, 3), "33.3%");
});

test("formatContextPct: limites inválidos", () => {
	assert.equal(formatContextPct(100, 0), "0%");
	assert.equal(formatContextPct(100, -10), "0%");
	assert.equal(formatContextPct(-100, 10000), "0%");
});

test("formatPath: encurta home para ~/", () => {
	assert.equal(formatPath("/home/luisb/projeto/src", "/home/luisb"), "~/projeto/src");
	assert.equal(formatPath("/home/luisb", "/home/luisb"), "~");
	assert.equal(formatPath("/home/luisb/projeto", "/home/luisb/"), "~/projeto");
});

test("formatPath: fora do home ou home raiz permanece intacto", () => {
	assert.equal(formatPath("/etc/passwd", "/home/luisb"), "/etc/passwd");
	assert.equal(formatPath("/home/luisb2/x", "/home/luisb"), "/home/luisb2/x");
	assert.equal(formatPath("/", "/"), "/");
	assert.equal(formatPath("/x", "/"), "/x");
	assert.equal(formatPath("", "/home/luisb"), "");
});

test("prioritizeFooter: tudo cabe, junta com ' · '", () => {
	const items = [
		{ text: "a", priority: 1 },
		{ text: "b", priority: 2 },
		{ text: "c", priority: 3 },
	];
	assert.equal(prioritizeFooter(30, items), "a · b · c");
});

test("prioritizeFooter: remove do menos importante para o mais", () => {
	const items = [
		{ text: "a", priority: 1 },
		{ text: "b", priority: 2 },
		{ text: "c", priority: 3 },
	];
	assert.equal(prioritizeFooter(5, items), "a · b");
	assert.equal(prioritizeFooter(4, items), "a");
	assert.equal(prioritizeFooter(1, items), "a");
});

test("prioritizeFooter: priority 1 vence independente da ordem", () => {
	const items = [
		{ text: "x", priority: 5 },
		{ text: "y", priority: 1 },
	];
	assert.equal(prioritizeFooter(1, items), "y");
});

test("prioritizeFooter: empate de prioridade remove o último", () => {
	const items = [
		{ text: "a", priority: 1 },
		{ text: "b", priority: 1 },
	];
	assert.equal(prioritizeFooter(3, items), "a");
});

test("prioritizeFooter: respeita largura visível com ANSI", () => {
	const items = [
		{ text: "\x1b[31mab\x1b[0m", priority: 1 },
		{ text: "cd", priority: 2 },
	];
	assert.equal(prioritizeFooter(5, items), "\x1b[31mab\x1b[0m");
});

test("prioritizeFooter: trunca o item mais importante quando necessário", () => {
	const items = [{ text: "abcdefgh", priority: 1 }];
	const out = prioritizeFooter(5, items);
	assert.equal(out, "abcd\x1b[0m…\x1b[0m");
	assert.equal(visibleWidth(out), 5);
});

test("prioritizeFooter: casos de borda", () => {
	assert.equal(prioritizeFooter(0, [{ text: "a", priority: 1 }]), "");
	assert.equal(prioritizeFooter(5, []), "");
	assert.equal(prioritizeFooter(-3, [{ text: "a", priority: 1 }]), "");
	const items = [
		{ text: "a", priority: 1 },
		{ text: "b", priority: 2 },
	];
	assert.equal(prioritizeFooter(5, items), "a · b");
});

test("prioritizeFooter: nunca estoura a largura", () => {
	const items = [
		{ text: "modelo-longuíssimo/anthropic-claude", priority: 1 },
		{ text: "high", priority: 2 },
		{ text: "~/projeto/src", priority: 3 },
		{ text: "33.3K used", priority: 4 },
		{ text: "Context 42.5% used", priority: 5 },
		{ text: "PLAN MODE", priority: 6 },
		{ text: "feature/better-ui", priority: 7 },
	];
	for (const width of [0, 1, 5, 10, 20, 30, 50, 80, 120]) {
		const out = prioritizeFooter(width, items);
		assert.ok(visibleWidth(out) <= width, `width=${width} → ${JSON.stringify(out)}`);
	}
});

test("countLines: texto vazio → 0", () => {
	assert.equal(countLines(""), 0);
});

test("countLines: linha única sem quebra final → 1", () => {
	assert.equal(countLines("a"), 1);
});

test("countLines: duas linhas → 2", () => {
	assert.equal(countLines("a\nb"), 2);
});

test("countLines: quebra de linha final não conta linha extra", () => {
	assert.equal(countLines("a\n"), 1);
	assert.equal(countLines("a\nb\n"), 2);
});

test("countLines: linhas vazias internas contam", () => {
	assert.equal(countLines("a\n\nb"), 3);
});

test("countLines: apenas quebra de linha → 1 linha vazia", () => {
	assert.equal(countLines("\n"), 1);
});

test("countLines: unicode", () => {
	assert.equal(countLines("olá\nmundo\n"), 2);
	assert.equal(countLines("α\nβ\nγ"), 3);
});

test("previewLines: texto vazio", () => {
	assert.deepEqual(previewLines("", 5), { lines: [], truncated: false });
});

test("previewLines: dentro do limite → sem truncamento", () => {
	assert.deepEqual(previewLines("a\nb", 5), { lines: ["a", "b"], truncated: false });
});

test("previewLines: exatamente no limite → sem truncamento", () => {
	assert.deepEqual(previewLines("a\nb", 2), { lines: ["a", "b"], truncated: false });
});

test("previewLines: além do limite → truncado", () => {
	assert.deepEqual(previewLines("a\nb\nc", 2), { lines: ["a", "b"], truncated: true });
});

test("previewLines: quebra de linha final não gera linha extra", () => {
	assert.deepEqual(previewLines("a\nb\n", 5), { lines: ["a", "b"], truncated: false });
	assert.deepEqual(previewLines("a\nb\n", 1), { lines: ["a"], truncated: true });
});

test("previewLines: maxLines zero → sempre vazio (truncado se houver conteúdo)", () => {
	assert.deepEqual(previewLines("a\nb", 0), { lines: [], truncated: true });
	assert.deepEqual(previewLines("", 0), { lines: [], truncated: false });
});

test("previewLines: unicode preservado", () => {
	assert.deepEqual(previewLines("α\nβ\nγ", 2), { lines: ["α", "β"], truncated: true });
});

test("previewLines: linha longa única não é fatiada", () => {
	const long = "x".repeat(500);
	assert.deepEqual(previewLines(long, 3), { lines: [long], truncated: false });
});


const CWD = "/home/luisb/.pi/agent";
const HOME = "/home/luisb";
const NIX_DIR =
	"/nix/store/rx1k7llc934jfy10ysfrnyvalbkjbl26-pi-coding-agent-0.84.1/lib/node_modules/@earendil-works/pi-coding-agent";

const NIX_CMD = `cd ${NIX_DIR} && grep -rni fork docs/ | head -5`;

function shorten(cmd: string, cwd = CWD): string {
	return shortenCommand(cmd, cwd);
}

function shortenPath(p: string, cwd = CWD, home = HOME): string {
	return shortenPathDisplay(p, cwd, home);
}

test("shortenCommand: cd do cwd removido (com && ou ;)", () => {
	assert.equal(shorten(`cd ${CWD} && ls`), "ls");
	assert.equal(shorten(`cd ${CWD} ; ls`), "ls");
});

test("shortenCommand: cd do cwd sem comando seguinte mantém o original", () => {
	assert.equal(shorten(`cd ${CWD}`), `cd ${CWD}`);
});

test("shortenCommand: cwd com trailing slash casa", () => {
	assert.equal(shorten(`cd ${CWD}/ && ls`), "ls");
});

test("shortenCommand: cd longo abreviado no basename", () => {
	assert.equal(shorten(NIX_CMD), `cd …/pi-coding-agent && grep -rni fork docs/ | head -5`);
});

test("shortenCommand: cd longo com ; preserva o separador", () => {
	assert.equal(shorten(`cd ${NIX_DIR} ; pwd`), "cd …/pi-coding-agent ; pwd");
});

test("shortenCommand: cd curto não muda", () => {
	assert.equal(shorten("cd /tmp && ls"), "cd /tmp && ls");
});

test("shortenCommand: sem cd no início não muda", () => {
	assert.equal(shorten("echo cd /x && ls"), "echo cd /x && ls");
	assert.equal(shorten("grep -rn cd /x"), "grep -rn cd /x");
});

test("shortenCommand: alvo igual ao cwd informado é removido", () => {
	assert.equal(shorten(`cd /home/outro/agente && ls`, "/home/outro/agente"), "ls");
	assert.equal(shorten(NIX_CMD, NIX_DIR), "grep -rni fork docs/ | head -5");
});

test("shortenPathDisplay: sob o cwd → relativo", () => {
	assert.equal(shortenPath(`${CWD}/extensions/better-ui/tools.ts`), "extensions/better-ui/tools.ts");
});

test("shortenPathDisplay: o próprio cwd → .", () => {
	assert.equal(shortenPath(CWD), ".");
	assert.equal(shortenPath(`${CWD}/`), ".");
});

test("shortenPathDisplay: prefixo parecido não é cwd (agent2 ≠ agent)", () => {
	assert.equal(shortenPath("/home/luisb/.pi/agent2/foo.ts"), "~/.pi/agent2/foo.ts");
});

test("shortenPathDisplay: fora do cwd sob o home → ~/", () => {
	assert.equal(shortenPath("/home/luisb/other/x.ts"), "~/other/x.ts");
	assert.equal(shortenPath(HOME), "~");
});

test("shortenPathDisplay: fora do home e longo → …/ últimos 3 segmentos", () => {
	assert.equal(shortenPath(`${NIX_DIR}/docs/sessions.md`), "…/pi-coding-agent/docs/sessions.md");
});

test("shortenPathDisplay: fora do home e curto → intacto", () => {
	assert.equal(shortenPath("/tmp/x.ts"), "/tmp/x.ts");
});

test("shortenPathDisplay: . e vazio passam direto", () => {
	assert.equal(shortenPath("."), ".");
	assert.equal(shortenPath(""), "");
	assert.equal(shortenPath("…"), "…");
});

test("shortenPathDisplay: home com trailing slash", () => {
	assert.equal(shortenPath("/home/luisb/other/x.ts", CWD, "/home/luisb/"), "~/other/x.ts");
});


test("constantes de apresentação permanecem fixas", () => {
	assert.equal(PREVIEW_LINES, 8);
	assert.equal(DIFF_COLLAPSED_LINES, 24);
	assert.equal(EXPANDED_MAX_LINES, 4000);
});

test("splitLines: ignora somente a quebra final", () => {
	assert.deepEqual(splitLines(""), []);
	assert.deepEqual(splitLines("a\n\n"), ["a", ""]);
	assert.deepEqual(splitLines("a\nb"), ["a", "b"]);
});

test("headSlice: corta apenas a expansão sem adicionar hint", () => {
	assert.deepEqual(headSlice(["a", "b", "c"], 2), ["a", "b"]);
	assert.deepEqual(headSlice(["a", "b"], 4), ["a", "b"]);
});

test("bash vazio não cria marcador", () => {
	assert.deepEqual(compactBashOutput(""), { kind: "empty" });
	assert.deepEqual(compactBashOutput("(no output)"), { kind: "empty" });
});

test("bash de uma e três linhas preserva a ordem", () => {
	assert.deepEqual(compactBashOutput("one"), { kind: "lines", lines: ["one"] });
	assert.deepEqual(compactBashOutput("one\ntwo\nthree"), {
		kind: "lines",
		lines: ["one", "two", "three"],
	});
});

test("bash acima de três linhas vira somente contagem", () => {
	assert.deepEqual(compactBashOutput("one\ntwo\nthree\nfour"), { kind: "summary", lineCount: 4 });
});

test("bash não conta a quebra de linha final", () => {
	assert.deepEqual(compactBashOutput("one\ntwo\nthree\n"), {
		kind: "lines",
		lines: ["one", "two", "three"],
	});
	assert.deepEqual(compactBashOutput("one\ntwo\nthree\nfour\n"), { kind: "summary", lineCount: 4 });
});

test("bash parcial não renderiza corpo", () => {
	assert.deepEqual(bashOutputPresentation("already emitted", { expanded: false, isPartial: true, isError: false }), {
		kind: "empty",
	});
});

test("bash erro mostra status recolhido e preserva corpo expandido", () => {
	const output = "details\n\nCommand exited with code 1";
	assert.deepEqual(splitBashError(output), { output: "details", status: "Command exited with code 1" });
	assert.deepEqual(bashOutputPresentation(output, { expanded: false, isPartial: false, isError: true }), {
		kind: "error",
		output: "details",
		status: "Command exited with code 1",
	});
	assert.deepEqual(bashOutputPresentation(output, { expanded: true, isPartial: false, isError: true }), {
		kind: "error",
		output: "details",
		status: "Command exited with code 1",
	});
});

test("bash expandido não recebe truncagem do renderer", () => {
	const output = Array.from({ length: EXPANDED_MAX_LINES + 1 }, (_, i) => `line ${i}`).join("\n");
	const view = bashOutputPresentation(output, { expanded: true, isPartial: false, isError: false });
	assert.equal(view.kind, "expanded");
	assert.equal(view.kind === "expanded" ? view.output : "", output);
});
