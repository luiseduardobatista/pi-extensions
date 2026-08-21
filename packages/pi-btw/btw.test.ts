import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	BTW_REPLAY_LIMIT,
	BTW_SYSTEM_PROMPT,
	branchToText,
	clearSessionHistory,
	getSessionHistory,
	shouldIncludeBranch,
	turnsToText,
} from "./btw.ts";

function fakeCtx(sessionFile = "/fake/session.jsonl"): ExtensionContext {
	return {
		sessionManager: {
			getSessionFile: () => sessionFile,
			getSessionId: () => "sid",
			getBranch: () => [],
		},
	} as unknown as ExtensionContext;
}

function entry(message: unknown, overrides: Record<string, unknown> = {}): SessionEntry {
	return { type: "message", id: "e", parentId: null, timestamp: "0", message, ...overrides } as unknown as SessionEntry;
}

const userMsg = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });
const assistantMsg = (content: unknown[], stopReason = "stop") =>
	({ role: "assistant", content, stopReason, timestamp: 2 });
const toolResultMsg = (toolName: string, text: string, isError = false) =>
	({ role: "toolResult", toolCallId: "t1", toolName, content: [{ type: "text", text }], isError, timestamp: 3 });

describe("branchToText", () => {
	it("serializa usuário, assistente, tool calls e resultados", () => {
		const entries = [
			entry(userMsg("oi, vamos mexer no parser")),
			entry(
				assistantMsg([
					{ type: "text", text: "vou olhar o arquivo" },
					{ type: "toolCall", id: "t1", name: "read", arguments: { path: "src/parser.ts", limit: 10 } },
				], "toolUse"),
			),
			entry(toolResultMsg("read", "linha 1\nlinha 2")),
		];
		const text = branchToText(entries);
		assert.ok(text.includes("[Usuário] oi, vamos mexer no parser"));
		assert.ok(text.includes("[Assistente] vou olhar o arquivo"));
		assert.ok(text.includes("[Ferramenta: read] path=src/parser.ts limit=10"));
		assert.ok(text.includes("[Resultado: read] linha 1\nlinha 2"));
	});

	it("marca erro e trunca resultados longos", () => {
		const long = "x".repeat(900);
		const text = branchToText([entry(toolResultMsg("grep", long, true))]);
		assert.ok(text.includes("[Resultado: grep (erro)]"));
		assert.ok(text.length < long.length + 40);
		assert.match(text.trimEnd(), /…$/);
	});

	it("inclui resumos de compactação e ignora toolUse sem texto", () => {
		const entries = [
			{ type: "compaction", id: "c", parentId: null, timestamp: "0", summary: "resumo da compactação", firstKeptEntryId: "e1", tokensBefore: 0 },
			entry(assistantMsg([{ type: "toolCall", id: "t2", name: "grep", arguments: { pattern: "foo" } }], "toolUse")),
		] as unknown as SessionEntry[];
		const text = branchToText(entries);
		assert.ok(text.includes("[Resumo] resumo da compactação"));
		assert.ok(text.includes("[Ferramenta: grep] pattern=foo"));
	});

	it("retorna vazio para entradas irrelevantes", () => {
		const text = branchToText([
			{ type: "label", id: "l", parentId: null, timestamp: "0", label: "x" },
		] as unknown as SessionEntry[]);
		assert.equal(text, "");
	});
});

describe("turnsToText", () => {
	it("rejoga no máximo as últimas BTW_REPLAY_LIMIT trocas", () => {
		const turns = Array.from({ length: BTW_REPLAY_LIMIT + 5 }, (_, i) => ({ question: `q${i + 1}`, answer: `a${i + 1}` }));
		const text = turnsToText(turns);
		assert.ok(text.includes("[Pergunta /btw] q6"));
		assert.ok(text.includes("[Pergunta /btw] q25"));
		assert.ok(!text.split("\n").includes("[Pergunta /btw] q1"));
		assert.ok(!text.split("\n").includes("[Pergunta /btw] q5"));
	});

	it("formata pergunta e resposta e aceita lista vazia", () => {
		assert.equal(turnsToText([]), "");
		assert.equal(
			turnsToText([{ question: "por quê?", answer: "porque sim" }]),
			"[Pergunta /btw] por quê?\n[Resposta /btw] porque sim",
		);
	});
});

describe("shouldIncludeBranch", () => {
	it("inclui branch pequeno", () => {
		assert.equal(shouldIncludeBranch(1000, 2000, 100_000), true);
	});

	it("descarta branch grande demais", () => {
		assert.equal(shouldIncludeBranch(200_000, 2000, 100_000), false);
	});

	it("respeita o limite de 75% da janela", () => {
		// O branch cabe abaixo do teto de 75% da janela.
		assert.equal(shouldIncludeBranch(10_000, 10_000, 40_000), true);
		// Ultrapassar o teto faz o branch ser omitido.
		assert.equal(shouldIncludeBranch(15_000, 15_000, 40_000), false);
	});
});

describe("histórico por sessão", () => {
	it("é isolado por session file", () => {
		const ctxA = fakeCtx("/a.jsonl");
		const ctxB = fakeCtx("/b.jsonl");
		getSessionHistory(ctxA).push({ question: "q", answer: "a" });
		assert.equal(getSessionHistory(ctxA).length, 1);
		assert.equal(getSessionHistory(ctxB).length, 0);
	});

	it("clearSessionHistory esvazia apenas a sessão alvo", () => {
		const ctxA = fakeCtx("/a.jsonl");
		const ctxB = fakeCtx("/b.jsonl");
		getSessionHistory(ctxA).push({ question: "q", answer: "a" });
		getSessionHistory(ctxB).push({ question: "q", answer: "a" });
		clearSessionHistory(ctxA);
		assert.equal(getSessionHistory(ctxA).length, 0);
		assert.equal(getSessionHistory(ctxB).length, 1);
	});

	it("usa chave memory quando não há session file", () => {
		const ctx = fakeCtx(undefined as unknown as string);
		getSessionHistory(ctx).push({ question: "q", answer: "a" });
		assert.equal(getSessionHistory(ctx).length, 1);
	});
});

describe("system prompt", () => {
	it("carrega o prompt lateral com instruções de tools read-only", () => {
		assert.ok(BTW_SYSTEM_PROMPT.length > 100);
		assert.ok(BTW_SYSTEM_PROMPT.includes("read"));
		assert.ok(BTW_SYSTEM_PROMPT.includes("somente-leitura"));
	});
});
