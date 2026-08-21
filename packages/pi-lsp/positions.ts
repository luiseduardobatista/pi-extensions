/**
 * Posições (spec §3.1): entrada/saída 1-based; conversão para o LSP (0-based)
 * nas unidades do encoding negociado (utf-16 por padrão; utf-8 se o servidor
 * anunciar positionEncoding utf-8).
 */

export type PositionEncoding = "utf-16" | "utf-8";

export function linesOf(text: string): string[] {
	return text.split("\n");
}

export function lineAt(text: string, line0: number): string {
	return (linesOf(text)[line0] ?? "").replace(/\r$/, "");
}

/** Posição 1-based (humano) → posição LSP 0-based no encoding do servidor. */
export function toLspPosition(
	text: string,
	line1: number,
	column1: number,
	encoding: PositionEncoding,
): { line: number; character: number } {
	if (!Number.isInteger(line1) || line1 < 1) {
		throw new Error(`lsp: line deve ser inteiro 1-based (recebido ${line1})`);
	}
	if (!Number.isInteger(column1) || column1 < 1) {
		throw new Error(`lsp: column deve ser inteiro 1-based (recebido ${column1})`);
	}
	const lines = linesOf(text);
	if (line1 > lines.length) {
		throw new Error(`lsp: linha ${line1} fora do documento (${lines.length} linhas)`);
	}
	const raw = lineAt(text, line1 - 1);
	if (column1 - 1 > raw.length) {
		throw new Error(`lsp: coluna ${column1} fora da linha ${line1} (${raw.length + 1} colunas)`);
	}
	const prefix = raw.slice(0, column1 - 1);
	const character = encoding === "utf-8" ? Buffer.byteLength(prefix, "utf8") : prefix.length;
	return { line: line1 - 1, character };
}

/** Fim do documento (para substituição integral em didChange incremental). */
export function fullRangeEnd(text: string): { start: { line: number; character: number }; end: { line: number; character: number } } {
	const lines = linesOf(text);
	const last = lines.length - 1;
	return {
		start: { line: 0, character: 0 },
		end: { line: last, character: text.endsWith("\n") ? 0 : lines[last]!.length },
	};
}
