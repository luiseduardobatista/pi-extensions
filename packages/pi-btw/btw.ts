/**
 * Estado, contexto e execução da pergunta lateral /btw.
 *
 * Cada pergunta usa uma sessão em memória separada, com ferramentas somente
 * leitura. A conversa principal entra apenas no system prompt; a resposta
 * lateral não contamina o transcript nem é gravada em disco.
 *
 * O histórico fica em globalThis, indexado por Symbol.for, para sobreviver a
 * reimportações e trocas de sessão (/new, /fork, /resume e /reload), mas some
 * quando o processo termina. Só as 20 trocas mais recentes são reenviadas.
 */

import { readFileSync } from "node:fs";
import type { AgentSession, ExtensionAPI, ExtensionCommandContext, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
	type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { type BtwOverlayController, showBtwOverlay } from "./btw-ui.ts";

export const BTW_COMMAND_NAME = "btw";

/** Compartilha o estado entre reimportações, sem persistir além do processo. */
const BTW_STATE_KEY = Symbol.for("luisb-btw");

/** Limita o histórico reenviado para preservar espaço para a nova pergunta. */
export const BTW_REPLAY_LIMIT = 20;

/** Ferramentas disponíveis ao modelo lateral; nenhuma altera o projeto. */
export const BTW_TOOLS = ["read", "grep", "find", "ls"] as const;

/** Reserva 25% da janela para a resposta e para o overhead da sessão. */
const BRANCH_MAX_FRACTION = 0.75;
/** Definições de tools + system prompt base do pi (estimativa em tokens). */
const TOOLS_OVERHEAD_TOKENS = 2048;

/** Janela de contexto assumida quando o modelo não informa (modelos modernos comuns). */
const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Truncamento de resultados de ferramenta serializados como contexto. */
const TOOL_RESULT_MAX_CHARS = 800;

const MSG_NO_UI = "/btw exige modo interativo";
const MSG_USAGE = "Uso: /btw <pergunta>";
const MSG_NO_MODEL = "/btw exige um modelo ativo";

const ERR_EMPTY = "/btw retornou resposta vazia.";
const errCallFailed = (m: string) => `/btw falhou: ${m}`;

export interface BtwTurn {
	question: string;
	answer: string;
}

type BtwExecResult =
	| { kind: "success"; turn: BtwTurn }
	| { kind: "error"; error: string }
	| { kind: "aborted" };

interface BtwState {
	histories: Map<string, BtwTurn[]>;
	snapshots: Map<string, SessionEntry[]>;
}

function getState(): BtwState {
	const g = globalThis as unknown as { [k: symbol]: BtwState | undefined };
	let state = g[BTW_STATE_KEY];
	if (!state) {
		state = { histories: new Map(), snapshots: new Map() };
		g[BTW_STATE_KEY] = state;
	}
	return state;
}

function getSessionKey(ctx: ExtensionContext): string {
	return ctx.sessionManager.getSessionFile() ?? `memory:${ctx.sessionManager.getSessionId()}`;
}

export function getSessionHistory(ctx: ExtensionContext): BtwTurn[] {
	const key = getSessionKey(ctx);
	const state = getState();
	let turns = state.histories.get(key);
	if (!turns) {
		turns = [];
		state.histories.set(key, turns);
	}
	return turns;
}

export function clearSessionHistory(ctx: ExtensionContext): void {
	getState().histories.set(getSessionKey(ctx), []);
}

function pushSessionTurn(ctx: ExtensionContext, turn: BtwTurn): void {
	getSessionHistory(ctx).push(turn);
}

function getSnapshot(ctx: ExtensionContext): SessionEntry[] | undefined {
	return getState().snapshots.get(getSessionKey(ctx));
}

function setSnapshot(ctx: ExtensionContext, entries: SessionEntry[]): void {
	getState().snapshots.set(getSessionKey(ctx), entries);
}

function invalidateSnapshot(ctx: ExtensionContext): void {
	getState().snapshots.delete(getSessionKey(ctx));
}

/** Instruções do modelo lateral, carregadas uma vez de prompts/btw-system.txt. */
export const BTW_SYSTEM_PROMPT = readFileSync(new URL("./prompts/btw-system.txt", import.meta.url), "utf-8").trimEnd();

/** Estimativa de tokens pela heurística chars/4 (a mesma do estimateTokens do pi). */
function tokenEstimate(text: string): number {
	return Math.ceil(text.length / 4);
}

function textOf(content: readonly unknown[]): string {
	return content
		.filter(
			(c): c is { type: "text"; text: string } =>
				typeof c === "object" &&
				c !== null &&
				(c as { type?: unknown }).type === "text" &&
				typeof (c as { text?: unknown }).text === "string",
		)
		.map((c) => c.text)
		.join("\n");
}

function messageText(msg: unknown): string {
	const content = (msg as { content?: unknown }).content;
	if (typeof content === "string") return content;
	return Array.isArray(content) ? textOf(content) : "";
}

function toolCallSummary(args: Record<string, unknown>): string {
	const picked = ["path", "pattern", "glob", "limit"]
		.filter((k) => args[k] !== undefined)
		.map((k) => `${k}=${String(args[k])}`);
	return picked.length > 0 ? picked.join(" ") : "(sem argumentos)";
}

/**
 * Converte o branch principal no contexto textual do modelo lateral.
 * Preserva mensagens, chamadas e resumos; resultados de ferramentas são
 * truncados para não deixar uma saída grande consumir o contexto.
 */
export function branchToText(entries: SessionEntry[]): string {
	const parts: string[] = [];
	for (const entry of entries) {
		if (entry.type === "message") {
			const msg = entry.message;
			if (msg.role === "user") {
				const t = messageText(msg).trim();
				if (t) parts.push(`[Usuário] ${t}`);
			} else if (msg.role === "assistant") {
				const am = msg as AssistantMessage;
				const t = messageText(am).trim();
				if (t) parts.push(`[Assistente] ${t}`);
				for (const c of am.content) {
					if (c.type === "toolCall") {
						parts.push(`[Ferramenta: ${c.name}] ${toolCallSummary(c.arguments)}`);
					}
				}
			} else if (msg.role === "toolResult") {
				const tr = msg as ToolResultMessage;
				const t = messageText(tr).trim();
				if (t) {
					const truncated = t.length > TOOL_RESULT_MAX_CHARS ? `${t.slice(0, TOOL_RESULT_MAX_CHARS)}…` : t;
					parts.push(`[Resultado: ${tr.toolName}${tr.isError ? " (erro)" : ""}] ${truncated}`);
				}
			}
		} else if (entry.type === "compaction") {
			parts.push(`[Resumo] ${entry.summary}`);
		}
	}
	return parts.join("\n\n");
}

/** Últimas `BTW_REPLAY_LIMIT` trocas /btw (pergunta + resposta) em texto. */
export function turnsToText(turns: BtwTurn[]): string {
	return turns
		.slice(-BTW_REPLAY_LIMIT)
		.map((t) => `[Pergunta /btw] ${t.question}\n[Resposta /btw] ${t.answer}`)
		.join("\n\n");
}

/**
 * Orçamento simples: inclui o branch no contexto só se tudo couber com folga
 * na janela do modelo. Caso contrário a pergunta vai sem o branch (o histórico
 * /btw e a pergunta são pequenos e sempre entram).
 */
export function shouldIncludeBranch(branchTokens: number, baseTokens: number, contextWindow: number): boolean {
	return branchTokens + baseTokens + TOOLS_OVERHEAD_TOKENS <= contextWindow * BRANCH_MAX_FRACTION;
}

function buildContextBlock(branchText: string, turnsText: string): string {
	const parts: string[] = [];
	if (branchText) parts.push(`# Conversa principal da sessão\n\n${branchText}`);
	if (turnsText) parts.push(`# Perguntas laterais anteriores (/btw)\n\n${turnsText}`);
	return parts.length === 0 ? "" : `\n\n${parts.join("\n\n")}`;
}

/** Atualiza o contexto reutilizável somente após uma resposta concluída. */
export function registerMessageEndSnapshot(pi: ExtensionAPI): void {
	pi.on("message_end", async (event, ctx) => {
		const msg = event.message;
		if (msg.role !== "assistant" || msg.stopReason === "toolUse") return;
		setSnapshot(ctx, ctx.sessionManager.getBranch() as SessionEntry[]);
	});
}

/** Descarta o contexto salvo quando a sessão é compactada ou re-ramificada. */
export function registerInvalidationHooks(pi: ExtensionAPI): void {
	pi.on("session_compact", async (_e, ctx) => safeInvalidateSnapshot(ctx));
	pi.on("session_tree", async (_e, ctx) => safeInvalidateSnapshot(ctx));
}

// Durante a auto-compactação, o pi-core substitui a sessão enquanto ainda
// emite session_compact. Nesse intervalo, o ctx pode ser um proxy inválido;
// não há snapshot a invalidar porque a sessão antiga está sendo descartada.
function safeInvalidateSnapshot(ctx: ExtensionContext): void {
	try {
		invalidateSnapshot(ctx);
	} catch (e) {
		if (!/stale after session replacement/.test(String(e))) throw e;
	}
}

function toolStatus(toolName: string, args: Record<string, unknown>): string | null {
	switch (toolName) {
		case "read":
			return `lendo ${String(args.path)}…`;
		case "grep":
			return `grep: ${String(args.pattern)}…`;
		case "find":
			return `find: ${String(args.pattern)}…`;
		case "ls":
			return `ls ${String(args.path ?? ".")}…`;
		default:
			return null;
	}
}

function lastAssistantMessage(session: AgentSession): { text: string; error?: string } {
	const entries = session.sessionManager.getBranch() as SessionEntry[];
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const msg = entry.message as AssistantMessage;
		if (msg.stopReason === "error") {
			return { text: "", error: msg.errorMessage ?? "erro desconhecido" };
		}
		const text = messageText(msg).trim();
		if (text) return { text };
	}
	return { text: "" };
}

export async function executeBtw(
	question: string,
	ctx: ExtensionContext,
	overlay: BtwOverlayController,
	controller: AbortController,
): Promise<BtwExecResult> {
	const model = ctx.model!;
	const cwd = ctx.cwd;
	const agentDir = getAgentDir();

	const snapshot = getSnapshot(ctx) ?? (ctx.sessionManager.getBranch() as SessionEntry[]);
	const branchText = branchToText(snapshot);
	const turnsText = turnsToText(getSessionHistory(ctx));
	const baseTokens = tokenEstimate(`${BTW_SYSTEM_PROMPT}\n${turnsText}\n${question}`);
	const branchTokens = tokenEstimate(branchText);
	const contextWindow = model.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
	const contextBlock = buildContextBlock(
		shouldIncludeBranch(branchTokens, baseTokens, contextWindow) ? branchText : "",
		turnsText,
	);

	let session: AgentSession | undefined;
	let unsubscribe: (() => void) | undefined;
	try {
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			systemPromptOverride: () => BTW_SYSTEM_PROMPT + contextBlock,
			appendSystemPromptOverride: () => [],
		});
		await loader.reload();

		// Reaproveita o runtime da sessão principal para manter a autenticação do usuário.
		const parentRuntime = (ctx.modelRegistry as unknown as { runtime?: unknown }).runtime;
		({ session } = await createAgentSession({
			cwd,
			agentDir,
			modelRuntime: parentRuntime as ModelRuntime | undefined,
			model,
			tools: [...BTW_TOOLS],
			resourceLoader: loader,
			sessionManager: SessionManager.inMemory(cwd),
			settingsManager: SettingsManager.create(cwd, agentDir),
		}));

		unsubscribe = session.subscribe((event) => {
			if (event.type === "tool_execution_start") {
				overlay.setToolStatus(toolStatus(event.toolName, event.args));
			} else if (event.type === "tool_execution_end") {
				overlay.setToolStatus(null);
			} else if (event.type === "message_update") {
				const text = messageText(event.message).trim();
				if (text) overlay.setStreaming(text);
			}
		});

		await session.prompt(question, { expandPromptTemplates: false });
		const { text, error } = lastAssistantMessage(session);
		if (error) return { kind: "error", error: errCallFailed(error) };
		if (!text) return { kind: "error", error: ERR_EMPTY };
		return { kind: "success", turn: { question, answer: text } };
	} catch (err) {
		if (controller.signal.aborted) return { kind: "aborted" };
		return { kind: "error", error: errCallFailed(err instanceof Error ? err.message : String(err)) };
	} finally {
		unsubscribe?.();
		session?.dispose();
	}
}

function reopenOverlay(ctx: ExtensionCommandContext): Promise<void> {
	const history = getSessionHistory(ctx);
	if (history.length === 0) {
		ctx.ui.notify(MSG_USAGE, "warning");
		return Promise.resolve();
	}
	const controller = new AbortController();
	const { overlayPromise } = showBtwOverlay({
		ctx,
		question: "",
		history: [...history],
		reopen: true,
		onAbort: () => controller.abort(),
		onClearHistory: () => clearSessionHistory(ctx),
	});
	return overlayPromise;
}

export function registerBtwCommand(pi: ExtensionAPI): void {
	pi.registerCommand(BTW_COMMAND_NAME, {
		description: "Pergunta lateral sem poluir a conversa principal (tools read-only)",
		handler: (args: string, ctx: ExtensionCommandContext) => handleBtwCommand(args, ctx),
	});
}

async function handleBtwCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify(MSG_NO_UI, "error");
		return;
	}
	const question = args.trim();
	if (!question) {
		await reopenOverlay(ctx);
		return;
	}
	if (!ctx.model) {
		ctx.ui.notify(MSG_NO_MODEL, "error");
		return;
	}

	const controller = new AbortController();
	const { overlayPromise, controllerReady } = showBtwOverlay({
		ctx,
		question,
		history: [...getSessionHistory(ctx)],
		onAbort: () => controller.abort(),
		onClearHistory: () => clearSessionHistory(ctx),
	});

	const overlay = await controllerReady;
	const result = await executeBtw(question, ctx, overlay, controller);

	switch (result.kind) {
		case "success":
			overlay.setAnswer(result.turn);
			pushSessionTurn(ctx, result.turn);
			break;
		case "aborted":
			// O overlay já foi dispensado; não há resposta para exibir.
			break;
		case "error":
			overlay.setError(result.error);
			break;
	}

	await overlayPromise;
}
