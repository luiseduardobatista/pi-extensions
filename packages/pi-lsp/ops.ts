/**
 * Despacha as operações do tool lsp() (spec §3.2), separando leituras,
 * capabilities e mutações.
 *
 * Respostas são normalizadas e truncadas; cada chamada retorna somente a
 * informação da operação solicitada.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyCodeAction, listCodeActions } from "./actions.ts";
import { applyWorkspaceEdit, summarizeWorkspaceEdit } from "./apply.ts";
import { ensureServerBinary, installedServersWithVersions, type InstallUI } from "./installer.ts";
import { runWithServer } from "./server-manager.ts";
import { resolveServer } from "./servers.ts";
import { toLspPosition, lineAt } from "./positions.ts";
import { syncDocument } from "./sync.ts";
import type { LspConfig } from "./config.ts";

export interface LspParams {
	action: string;
	file?: string;
	line?: number;
	column?: number;
	new_name?: string;
	query?: string;
	apply?: boolean;
	id?: string;
}

// ---------------------------------------------------------------------------
// Helpers puros (exportados para testes — spec §5.10)
// ---------------------------------------------------------------------------

/** Truncamento explícito: nunca dump ilimitado (spec §3.2). */
export function capEntries(entries: string[], cap: number): string[] {
	if (entries.length <= cap) return entries;
	return [...entries.slice(0, cap), `… (${entries.length - cap} a mais)`];
}

const SYMBOL_KINDS = [
	"", "File", "Module", "Namespace", "Package", "Class", "Method", "Property",
	"Field", "Constructor", "Enum", "Interface", "Function", "Variable", "Constant",
	"String", "Number", "Boolean", "Array", "Object", "Key", "Null", "EnumMember",
	"Struct", "Event", "Operator", "TypeParameter",
] as const;

export function symbolKindName(kind: number): string {
	return SYMBOL_KINDS[kind] ?? "Symbol";
}

interface Loc {
	uri: string;
	line0: number;
	char0: number;
}

/** Normaliza Location | Location[] | LocationLink[] para Loc[]. */
export function toLocs(result: unknown): Loc[] {
	if (!result) return [];
	const arr = Array.isArray(result) ? result : [result];
	const out: Loc[] = [];
	for (const r of arr) {
		const anyR = r as { targetUri?: string; uri?: string; targetRange?: { start: { line: number; character: number } }; range?: { start: { line: number; character: number } } };
		const uri = anyR.targetUri ?? anyR.uri;
		const range = anyR.targetRange ?? anyR.range;
		if (uri && range?.start) out.push({ uri, line0: range.start.line, char0: range.start.character });
	}
	return out;
}

/** "path:linha:col" (1-based) + trecho da linha no disco. */
export function formatLoc(loc: Loc): string {
	const path = fileURLToPath(loc.uri);
	let snippet = "";
	try {
		snippet = lineAt(readFileSync(path, "utf8"), loc.line0).trim();
	} catch {
		// arquivo ausente/ilegível: sem trecho
	}
	const line1 = loc.line0 + 1;
	const col1 = loc.char0 + 1;
	return snippet ? `${path}:${line1}:${col1}\n  ${snippet}` : `${path}:${line1}:${col1}`;
}

/** Normaliza MarkupContent | MarkedString | MarkedString[] para texto puro. */
export function hoverText(contents: unknown): string {
	if (typeof contents === "string") return contents;
	if (Array.isArray(contents)) return contents.map(hoverText).filter(Boolean).join("\n");
	if (contents && typeof contents === "object") {
		const c = contents as { kind?: string; value?: string; language?: string };
		if (typeof c.value === "string") return c.value;
		if (typeof c.language === "string") return "";
	}
	return "";
}

/** Achata DocumentSymbol[] (com children) e SymbolInformation[] para entradas planas. */
export function flattenSymbols(result: unknown, depth = 0): Array<{ name: string; kind: string; line1: number; indent: string }> {
	if (!result) return [];
	const out: Array<{ name: string; kind: string; line1: number; indent: string }> = [];
	for (const r of result as Array<{ name?: string; kind?: number; range?: { start: { line: number } }; location?: { range: { start: { line: number } } }; children?: unknown[] }>) {
		const name = r.name;
		if (typeof name === "string" && typeof r.kind === "number") {
			const line1 = (r.range?.start.line ?? r.location?.range.start.line ?? 0) + 1;
			out.push({ name, kind: symbolKindName(r.kind), line1, indent: "  ".repeat(depth) });
		}
		if (Array.isArray(r.children)) out.push(...flattenSymbols(r.children, depth + 1));
	}
	return out;
}

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

interface PositionalArgs {
	file: string;
	line: number;
	column: number;
}

function requirePosition(params: LspParams): PositionalArgs {
	if (!params.file || params.line === undefined || params.column === undefined) {
		throw new Error("lsp: operações posicionais exigem file, line e column (1-based)");
	}
	return { file: params.file, line: params.line, column: params.column };
}

function uriOf(file: string): string {
	return pathToFileURL(file).href;
}

export async function runOp(
	params: LspParams,
	signal: AbortSignal | undefined,
	config: LspConfig,
	ui: InstallUI,
): Promise<string> {
	switch (params.action) {
		case "capabilities":
			return capabilitiesOp(params.file, config, ui);
		case "definition":
		case "references":
		case "implementation":
		case "type_definition":
		case "hover":
		case "symbols":
			return readOp(params, signal, config, ui);
		case "code_actions":
			return codeActionsOp(params, signal, config, ui);
		case "apply_code_action":
			return applyCodeActionOp(params, signal, config, ui);
		case "rename":
			return renameOp(params, signal, config, ui);
		default:
			throw new Error(
				`lsp: operação '${params.action}' ainda não implementada (milestone 4 — code_actions/rename chegam no milestone 5)`,
			);
	}
}

async function capabilitiesOp(file: string | undefined, config: LspConfig, ui: InstallUI): Promise<string> {
	if (!file) {
		const list = installedServersWithVersions(config);
		return (
			"servidores do mapa v1:\n" +
			list
				.map((s) => `${s.family}: ${s.command} — ${s.path ?? "não instalado"}${s.version ? ` (${s.version})` : ""}`)
				.join("\n")
		);
	}
	const base = resolveServer(file);
	const commandPath = await ensureServerBinary(base, config, ui);
	return runWithServer({ ...base, commandPath }, config, async (s) => {
		const c = s.capabilities;
		const op = (k: string): string => (c[k] ? "✓" : "—");
		const sync = s.syncKind
			? `openClose=${s.syncKind.openClose} change=${s.syncKind.change}`
			: "—";
		return [
			`servidor: ${base.spec.command} (${commandPath})`,
			`root: ${s.root}`,
			`positionEncoding: ${s.encoding}`,
			`textDocumentSync: ${sync}`,
			`operações: definition ${op("definitionProvider")} · references ${op("referencesProvider")} · implementation ${op("implementationProvider")} · type_definition ${op("typeDefinitionProvider")} · hover ${op("hoverProvider")} · symbols ${op("documentSymbolProvider")} · code_actions ${op("codeActionProvider")}`,
		].join("\n");
	});
}

const POSITIONAL_CAP: Record<string, string> = {
	definition: "definitionProvider",
	references: "referencesProvider",
	implementation: "implementationProvider",
	type_definition: "typeDefinitionProvider",
	hover: "hoverProvider",
	symbols: "documentSymbolProvider",
};

async function readOp(params: LspParams, signal: AbortSignal | undefined, config: LspConfig, ui: InstallUI): Promise<string> {
	if (params.action === "symbols") {
		// symbols exige somente file (spec §3.1); query filtra.
		if (!params.file) throw new Error("lsp: symbols exige file");
		return symbolsOp(params.file, params.query, signal, config, ui);
	}
	const { file, line, column } = requirePosition(params);
	const base = resolveServer(file);
	const commandPath = await ensureServerBinary(base, config, ui);
	return runWithServer({ ...base, commandPath }, config, async (s) => {
		// Capacidade não anunciada → erro acionável antes do request (spec §4.8).
		const capabilityKey = POSITIONAL_CAP[params.action]!;
		if (!s.capabilities[capabilityKey]) {
			throw new Error(`lsp: servidor ${base.spec.command} não anuncia ${capabilityKey} — consulte capabilities`);
		}
		// Sync antes da posição: posição e queries usam o conteúdo atual (spec §4.9).
		const text = syncDocument(s, file);
		const position = toLspPosition(text, line, column, s.encoding);
		const uri = uriOf(file);

		switch (params.action) {
			case "definition":
			case "implementation":
			case "type_definition": {
				const method = params.action === "definition" ? "textDocument/definition" : params.action === "implementation" ? "textDocument/implementation" : "textDocument/typeDefinition";
				const result = await s.conn.request(method, { textDocument: { uri }, position }, signal);
				const locs = toLocs(result);
				if (locs.length === 0) return "nenhum resultado";
				return capEntries(locs.map(formatLoc), 5).join("\n");
			}
			case "references": {
				const result = await s.conn.request("textDocument/references", { textDocument: { uri }, position, context: { includeDeclaration: true } }, signal);
				const locs = toLocs(result);
				if (locs.length === 0) return "nenhuma referência";
				return capEntries(locs.map(formatLoc), 30).join("\n");
			}
			case "hover": {
				const result = (await s.conn.request("textDocument/hover", { textDocument: { uri }, position }, signal)) as { contents?: unknown } | null;
				const textHover = result ? hoverText(result.contents) : "";
				if (!textHover.trim()) return "sem hover";
				return capEntries(textHover.trim().split("\n"), 50).join("\n");
			}
			default:
				throw new Error(`lsp: operação '${params.action}' não suportada`);
		}
	});
}

async function symbolsOp(file: string, query: string | undefined, signal: AbortSignal | undefined, config: LspConfig, ui: InstallUI): Promise<string> {
	const base = resolveServer(file);
	const commandPath = await ensureServerBinary(base, config, ui);
	return runWithServer({ ...base, commandPath }, config, async (s) => {
		if (!s.capabilities.documentSymbolProvider) {
			throw new Error(`lsp: servidor ${base.spec.command} não anuncia documentSymbolProvider — consulte capabilities`);
		}
		syncDocument(s, file);
		const uri = uriOf(file);
		const result = await s.conn.request("textDocument/documentSymbol", { textDocument: { uri } }, signal);
		let symbols = flattenSymbols(result);
		if (query) {
			const q = query.toLowerCase();
			symbols = symbols.filter((x) => x.name.toLowerCase().includes(q));
		}
		if (symbols.length === 0) return "nenhum símbolo";
		return capEntries(symbols.map((x) => `${x.indent}${x.name} (${x.kind}, linha ${x.line1})`), 100).join("\n");
	});
}

async function codeActionsOp(params: LspParams, signal: AbortSignal | undefined, config: LspConfig, ui: InstallUI): Promise<string> {
	const { file, line, column } = requirePosition(params);
	const base = resolveServer(file);
	const commandPath = await ensureServerBinary(base, config, ui);
	return runWithServer({ ...base, commandPath }, config, async (s) => {
		if (!s.capabilities.codeActionProvider) {
			throw new Error(`lsp: servidor ${base.spec.command} não anuncia codeActionProvider — consulte capabilities`);
		}
		const text = syncDocument(s, file);
		return listCodeActions(s, file, line, column, text, s.root, signal);
	});
}

async function applyCodeActionOp(params: LspParams, signal: AbortSignal | undefined, config: LspConfig, ui: InstallUI): Promise<string> {
	const { file, line, column } = requirePosition(params);
	if (!params.id) throw new Error("lsp: apply_code_action exige id (retornado por code_actions)");
	const base = resolveServer(file);
	const commandPath = await ensureServerBinary(base, config, ui);
	return runWithServer({ ...base, commandPath }, config, async (s) => {
		const text = syncDocument(s, file);
		return applyCodeAction(s, params.id!, file, line, column, text, signal, config);
	});
}

async function renameOp(params: LspParams, signal: AbortSignal | undefined, config: LspConfig, ui: InstallUI): Promise<string> {
	const { file, line, column } = requirePosition(params);
	if (!params.new_name) throw new Error("lsp: rename exige new_name");
	const base = resolveServer(file);
	const commandPath = await ensureServerBinary(base, config, ui);
	return runWithServer({ ...base, commandPath }, config, async (s) => {
		if (!s.capabilities.renameProvider) {
			throw new Error(`lsp: servidor ${base.spec.command} não anuncia renameProvider — consulte capabilities`);
		}
		const text = syncDocument(s, file);
		const position = toLspPosition(text, line, column, s.encoding);
		const result = (await s.conn.request(
			"textDocument/rename",
			{ textDocument: { uri: uriOf(file) }, position, newName: params.new_name },
			signal,
		)) as unknown;
		if (params.apply) {
			return "rename aplicado:\n" + (await applyWorkspaceEdit(s, result, s.root));
		}
		return (
			"preview (nada aplicado — chame com apply=true para aplicar):\n" +
			summarizeWorkspaceEdit(result, s.root, 50)
		);
	});
}
