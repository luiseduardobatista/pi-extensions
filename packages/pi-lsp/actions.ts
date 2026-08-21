/**
 * Code actions (spec §3.2/§5.4): consulta read-only com id opaco e preview;
 * aplicação somente via apply_code_action com re-consulta no local original e
 * match exato por identidade estrutural (data + título/kind + fingerprint do
 * efeito); divergência/ambiguidade → stale. Command actions são executadas
 * com workspace/applyEdit interceptado (política §3.5).
 */

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { applyWorkspaceEdit, summarizeWorkspaceEdit } from "./apply.ts";
import { LspConnection } from "./client.ts";
import type { ManagedServer } from "./server-manager.ts";
import type { LspConfig } from "./config.ts";

export interface ActionEntry {
	id: string;
	file: string;
	line: number;
	column: number;
	docHash: string;
	title: string;
	kind?: string;
	isPreferred?: boolean;
	data?: unknown;
	edit?: unknown;
	command?: unknown;
}

interface CodeActionShape {
	title?: string;
	kind?: string;
	isPreferred?: boolean;
	data?: unknown;
	edit?: unknown;
	command?: unknown;
}

const MAX_CACHED_ACTIONS = 50;

export function docHashOf(text: string): string {
	return createHash("sha1").update(text).digest("hex");
}

/** Fingerprint do efeito (edit + command + data) para match estrutural. */
export function fingerprint(action: CodeActionShape): string {
	const { edit, command, data, title, kind } = action;
	return JSON.stringify({ edit: edit ?? null, command: command ?? null, data: data ?? null, title: title ?? null, kind: kind ?? null });
}

/**
 * Match exato contra os candidatos re-consultados: exige EXATAMENTE um match
 * cujo fingerprint (data + título/kind + edit/command, igualdade profunda)
 * seja idêntico ao da ação guardada. Zero ou múltiplos → null (stale — §5.4).
 */
export function matchExact(entry: ActionEntry, candidates: CodeActionShape[]): CodeActionShape | null {
	const expected = fingerprint({
		edit: entry.edit,
		command: entry.command,
		data: entry.data,
		title: entry.title,
		kind: entry.kind,
	});
	const matches = candidates.filter((c) => fingerprint(c) === expected);
	return matches.length === 1 ? matches[0]! : null;
}

function previewOf(action: CodeActionShape, root: string): string {
	const parts: string[] = [];
	if (action.edit) {
		try {
			parts.push(`edita:\n${summarizeWorkspaceEdit(action.edit, root, 3)}`);
		} catch (e) {
			parts.push(`edit inválido: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
	if (action.command) {
		parts.push("command — efeito não totalmente previsível; aplicável somente via apply_code_action explícito");
	}
	return parts.join("\n") || "sem efeito declarado";
}

function storeEntry(s: ManagedServer, file: string, line: number, column: number, text: string, action: CodeActionShape): ActionEntry {
	const id = `${s.resolved.spec.family}-${s.root.length}-${s.actions.size}-${Math.random().toString(36).slice(2, 10)}`;
	const entry: ActionEntry = {
		id,
		file,
		line,
		column,
		docHash: docHashOf(text),
		title: action.title ?? "(sem título)",
		kind: action.kind,
		isPreferred: action.isPreferred,
		data: action.data,
		edit: action.edit,
		command: action.command,
	};
	s.actions.set(id, entry);
	// Mantém o cache limitado conforme a spec §5.4.
	while (s.actions.size > MAX_CACHED_ACTIONS) {
		const oldest = s.actions.keys().next().value;
		if (oldest === undefined) break;
		s.actions.delete(oldest);
	}
	return entry;
}

/** Diagnostics internos (estado de protocolo, spec §3.4) filtrados por linha — alimentam
 * context.diagnostics do codeAction para quickfixes; nunca expostos ao agente. */
function codeActionContext(s: ManagedServer, uri: string, line0: number): { diagnostics: Array<{ range: { start: { line: number; character: number }; end: { line: number; character: number } }; message: string }> } {
	const conn = s.conn as LspConnection;
	const diags = (conn.latestDiagnostics.get(uri) ?? [])
		.filter((d) => d.range.start.line <= line0 && d.range.end.line >= line0)
		.map((d) => ({
			range: { start: { line: d.range.start.line, character: 0 }, end: { line: d.range.end.line, character: 0 } },
			message: d.message,
		}));
	return { diagnostics: diags };
}

/** Consulta somente leitura: lista + preview, registra ids (spec §3.2). Nenhum efeito colateral. */
export async function listCodeActions(
	s: ManagedServer,
	file: string,
	line: number,
	column: number,
	text: string,
	root: string,
	signal: AbortSignal | undefined,
): Promise<string> {
	const uri = pathToFileURL(file).href;
	const line0 = line - 1;
	const result = (await s.conn.request(
		"textDocument/codeAction",
		{
			textDocument: { uri },
			range: { start: { line: line0, character: column - 1 }, end: { line: line0, character: column - 1 } },
			context: codeActionContext(s, uri, line0),
		},
		signal,
	)) as CodeActionShape[] | null;
	if (!result || result.length === 0) return "nenhuma code action disponível no local";

	const lines: string[] = [];
	for (const action of result.slice(0, 20)) {
		const entry = storeEntry(s, file, line, column, text, action);
		const preferred = entry.isPreferred ? " (preferida)" : "";
		lines.push(`[${entry.id}] ${entry.title}${preferred}\n${previewOf(action, root)}`);
	}
	if (result.length > 20) lines.push(`… (${result.length - 20} ações a mais)`);
	return lines.join("\n");
}

/** Executa um Command com workspace/applyEdit interceptado (spec §5.8). */
export async function runCommandFlow(
	s: ManagedServer,
	command: unknown,
	signal: AbortSignal | undefined,
	config: LspConfig,
): Promise<string> {
	const conn = s.conn as LspConnection;
	conn.applyEditFlow = {
		apply: async (edit) => {
			try {
				await applyWorkspaceEdit(s, edit, s.root);
				return { applied: true };
			} catch (e) {
				return { applied: false, failureReason: e instanceof Error ? e.message : String(e) };
			}
		},
	};
	try {
		await conn.request("workspace/executeCommand", command, signal);
		return "command executado (efeitos reportados via workspace/applyEdit foram aplicados)";
	} finally {
		conn.applyEditFlow = null;
	}
}

/**
 * Aplica a ação identificada (spec §3.2): valida local/hash; re-consulta no
 * local original; match exato; edit → política §3.5; command → flow com
 * applyEdit interceptado; edit+command → edit primeiro, command depois.
 */
export async function applyCodeAction(
	s: ManagedServer,
	id: string,
	file: string,
	line: number,
	column: number,
	text: string,
	signal: AbortSignal | undefined,
	config: LspConfig,
): Promise<string> {
	const entry = s.actions.get(id);
	if (!entry) {
		throw new Error(`lsp: code action '${id}' não encontrada (cache expirado ou servidor reiniciado) — consulte code_actions novamente`);
	}
	if (entry.file !== file || entry.line !== line || entry.column !== column) {
		throw new Error("lsp: file/line/column divergem da consulta original da code action — reconsulte code_actions");
	}
	if (entry.docHash !== docHashOf(text)) {
		throw new Error("lsp: documento mudou desde a consulta — ação stale; reconsulte code_actions");
	}

	const uri = pathToFileURL(file).href;
	const line0 = line - 1;
	const result = (await s.conn.request(
		"textDocument/codeAction",
		{
			textDocument: { uri },
			range: { start: { line: line0, character: column - 1 }, end: { line: line0, character: column - 1 } },
			context: codeActionContext(s, uri, line0),
		},
		signal,
	)) as CodeActionShape[] | null;

	const match = matchExact(entry, result ?? []);
	if (!match) {
		throw new Error("lsp: code action não resolvida com match exato na re-consulta — stale; reconsulte code_actions");
	}

	const out: string[] = [];
	if (match.edit) {
		out.push("edit aplicado:\n" + (await applyWorkspaceEdit(s, match.edit, s.root)));
	}
	if (match.command) {
		out.push(await runCommandFlow(s, match.command, signal, config));
	}
	return out.length > 0 ? out.join("\n") : "ação sem efeito declarado";
}
