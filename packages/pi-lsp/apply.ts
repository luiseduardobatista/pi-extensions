/**
 * Aplicação de WorkspaceEdit (spec §3.5): política fechada — somente URIs
 * file: canônicas dentro do root autorizado; formas suportadas (changes /
 * documentChanges com TextEdit); resource operations e mistura de formas
 * rejeitadas; ranges validados contra o snapshot atual; fila do Pi por
 * arquivo em ordem canônica; falha no meio → erro claro com o que foi
 * aplicado e o que falhou (sem rollback automático).
 */

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, dirname, join, sep } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { markDocumentText } from "./sync.ts";
import type { ManagedServer } from "./server-manager.ts";

export interface TextEditShape {
	range: { start: { line: number; character: number }; end: { line: number; character: number } };
	newText: string;
}

interface Position {
	line: number;
	character: number;
}

function posLess(a: Position, b: Position): number {
	return a.line - b.line || a.character - b.character;
}

function posEq(a: Position, b: Position): boolean {
	return a.line === b.line && a.character === b.character;
}

export function lineOffsets(text: string): number[] {
	const offsets = [0];
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === 10) offsets.push(i + 1);
	}
	return offsets;
}

export function offsetAt(text: string, pos: Position): number {
	if (!Number.isInteger(pos.line) || pos.line < 0) {
		throw new Error(`lsp: posição ${pos.line}:${pos.character} inválida`);
	}
	if (!Number.isInteger(pos.character) || pos.character < 0) {
		throw new Error(`lsp: posição ${pos.line}:${pos.character} inválida`);
	}
	const offsets = lineOffsets(text);
	if (pos.line >= offsets.length) {
		throw new Error(`lsp: posição ${pos.line}:${pos.character} fora do documento`);
	}
	const lineStart = offsets[pos.line]!;
	const lineEnd = pos.line + 1 < offsets.length ? offsets[pos.line + 1]! - 1 : text.length; // exclui o \n
	const maxChar = lineEnd - lineStart;
	if (pos.character > maxChar) {
		throw new Error(`lsp: posição ${pos.line}:${pos.character} fora do documento`);
	}
	return lineStart + pos.character;
}

/**
 * Valida e aplica edits sobre um snapshot. Regras (spec §3.5):
 * não-sobreposição entre edits não-vazios; inserções no mesmo ponto na ordem
 * do array; inserção estritamente dentro do range de outro edit → rejeita.
 */
export function applyEditsToText(text: string, edits: TextEditShape[]): string {
	if (edits.length === 0) return text;
	// Em posições iguais, preserva a ordem declarada pelo servidor.
	const sorted = [...edits].map((e, i) => ({ e, i })).sort((a, b) => posLess(a.e.range.start, b.e.range.start) || a.i - b.i);

	for (const { e } of sorted) {
		if (posLess(e.range.start, e.range.end) > 0) {
			throw new Error("lsp: range invertido no WorkspaceEdit — rejeitado");
		}
	}

	const textLen = text.length;
	const parts: string[] = [];
	let cursor = 0;
	for (const { e } of sorted) {
		const start = offsetAt(text, e.range.start);
		const end = posEq(e.range.start, e.range.end) ? start : offsetAt(text, e.range.end);
		if (start > textLen || end > textLen) {
			throw new Error("lsp: range fora do documento — rejeitado");
		}
		// sobreposição de edits não-vazios ou inserção estritamente dentro de
		// outro edit: detectadas pela regra do cursor (spec §3.5)
		if (start < cursor) {
			throw new Error("lsp: edits sobrepostos ou inserção dentro de outro edit — rejeitado");
		}
		parts.push(text.slice(cursor, start));
		parts.push(e.newText);
		cursor = end > start ? end : start;
	}
	parts.push(text.slice(cursor));
	return parts.join("");
}

interface NormalizedEdit {
	path: string;
	version?: number;
	edits: TextEditShape[];
}

interface ParsedWorkspaceEdit {
	/** changes: uri → edits */
	changes?: Record<string, TextEditShape[]>;
	/** documentChanges: TextDocumentEdit ({ textDocument: { uri, version }, edits }) ou resource operation */
	documentChanges?: Array<{ kind?: string; uri?: string; version?: number; edits?: TextEditShape[]; textDocument?: { uri?: string; version?: number } }>;
}

function parseWorkspaceEdit(edit: unknown): ParsedWorkspaceEdit {
	const e = edit as ParsedWorkspaceEdit;
	if (!e || typeof e !== "object") throw new Error("lsp: WorkspaceEdit inválido");
	return { changes: e.changes, documentChanges: e.documentChanges };
}

function realWithin(root: string, path: string): string {
	const realRoot = realpathSync(root);
	let real: string;
	try {
		real = realpathSync(path);
	} catch (e) {
		// arquivo inexistente (ex.: criação via TextEdit): valida o dirname real e
		// concatena o basename — a política de root continua valendo (§3.5)
		if ((e as NodeJS.ErrnoException).code === "ENOENT") {
			const realDir = realpathSync(dirname(path));
			if (realDir !== realRoot && !realDir.startsWith(realRoot + sep)) {
				throw new Error(`lsp: WorkspaceEdit tenta alterar arquivo fora do root autorizado: ${path}`);
			}
			return join(realDir, basename(path));
		}
		throw e;
	}
	if (real === realRoot || real.startsWith(realRoot + sep)) return real;
	throw new Error(`lsp: WorkspaceEdit tenta alterar arquivo fora do root autorizado: ${path}`);
}

/**
 * Normaliza e valida um WorkspaceEdit contra a política §3.5.
 * Retorna uma entrada por arquivo, com caminhos reais canônicos em ordem lexicográfica.
 */
export function normalizeWorkspaceEdit(edit: unknown, root: string): NormalizedEdit[] {
	const parsed = parseWorkspaceEdit(edit);
	const hasChanges = parsed.changes !== undefined && Object.keys(parsed.changes).length > 0;
	const hasDocChanges = parsed.documentChanges !== undefined && parsed.documentChanges.length > 0;
	if (hasChanges && hasDocChanges) {
		throw new Error("lsp: WorkspaceEdit mistura changes e documentChanges — não suportado na v1");
	}

	const perFile = new Map<string, NormalizedEdit>();
	const push = (uri: string, version: number | undefined, edits: TextEditShape[]): void => {
		const url = new URL(uri);
		if (url.protocol !== "file:") throw new Error(`lsp: URI não-file: no WorkspaceEdit: ${uri}`);
		const raw = fileURLToPath(url);
		const path = realWithin(root, raw);
		const existing = perFile.get(path);
		if (existing) existing.edits.push(...edits);
		else perFile.set(path, { path, version, edits: [...edits] });
	};

	if (hasChanges) {
		for (const [uri, edits] of Object.entries(parsed.changes!)) {
			if (!Array.isArray(edits)) throw new Error("lsp: changes inválido no WorkspaceEdit");
			push(uri, undefined, edits);
		}
	} else if (hasDocChanges) {
		for (const dc of parsed.documentChanges!) {
			if (dc.kind && dc.kind !== "edit") {
				throw new Error(`lsp: resource operation (${dc.kind}) no WorkspaceEdit — não suportado na v1`);
			}
			const uri = dc.uri ?? dc.textDocument?.uri;
			const version = dc.version ?? dc.textDocument?.version;
			if (!uri || !Array.isArray(dc.edits)) throw new Error("lsp: documentChanges inválido no WorkspaceEdit");
			push(uri, version, dc.edits);
		}
	} else {
		throw new Error("lsp: WorkspaceEdit vazio");
	}

	return [...perFile.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** Preview compacto do efeito (spec §3.2 code_actions/rename): arquivos + contagem. */
export function summarizeWorkspaceEdit(edit: unknown, root: string, capFiles = 50): string {
	const files = normalizeWorkspaceEdit(edit, root);
	if (files.length === 0) return "sem mudanças";
	const lines = files.slice(0, capFiles).map((f) => `${f.path}: ${f.edits.length} edit(s)`);
	if (files.length > capFiles) lines.push(`… (${files.length - capFiles} arquivos a mais)`);
	return lines.join("\n");
}

/**
 * Aplica um WorkspaceEdit (política §3.5): validação completa antes de
 * qualquer escrita; escrita por arquivo em ordem canônica via fila do Pi;
 * version numérica deve casar com o documento sincronizado; falha no meio →
 * erro com o que foi aplicado e o que falhou.
 */
export async function applyWorkspaceEdit(s: ManagedServer, edit: unknown, root: string): Promise<string> {
	const files = normalizeWorkspaceEdit(edit, root);
	const applied: string[] = [];

	for (const file of files) {
		try {
			await withFileMutationQueue(file.path, async () => {
				let current: string;
				try {
					current = readFileSync(file.path, "utf8");
				} catch (e) {
					if ((e as NodeJS.ErrnoException).code === "ENOENT") current = "";
					else throw e;
				}
				if (file.version !== undefined) {
					const doc = s.documents.get(pathToFileURL(file.path).href);
					const syncedVersion = doc?.version;
					if (syncedVersion !== undefined && syncedVersion !== file.version) {
						throw new Error(
							`lsp: version do documento divergente (servidor=${file.version}, sincronizada=${syncedVersion}) — ação stale`,
						);
					}
				}
				const next = applyEditsToText(current, file.edits);
				writeFileSync(file.path, next);
				markDocumentText(s, file.path, next);
				return next;
			});
			applied.push(`${file.path}: ${file.edits.length} edit(s)`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			throw new Error(
				`lsp: falha ao aplicar ${file.path}: ${msg}. Já aplicado: ${applied.length ? applied.join(", ") : "nada"} — nada mais foi escrito`,
			);
		}
	}

	return applied.length > 0 ? applied.join("\n") : "nenhuma mudança aplicada";
}
