/**
 * Helpers de apresentação compartilhados pelos renderers de ferramentas
 * (pi-tool-renderers e pi-diff). Nenhum import em runtime de pacotes pi-*:
 * apenas tipos (Theme), removidos na transpilação.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";

export const INDENT = "  ";

export function toolTitle(theme: Theme, title: string): string {
	return theme.fg("toolTitle", `• ${title}`);
}

export function indentLines(text: string): string {
	return text.split("\n").map((line) => `${INDENT}${line}`).join("\n");
}

export function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((c) => c.type === "text")
		.map((c) => c.text ?? "")
		.join("\n");
}

/** Corpo de erro compartilhado; mensagens vazias usam o fallback `Error`. */
export function errorBody(theme: Theme, message: string): string {
	const body = message.trim() || "Error";
	return theme.fg("error", indentLines(body));
}

/** Caminho exibido nas chamadas (tolerante à chave antiga file_path de sessões retomadas). */
export function displayPath(args: { path?: string; file_path?: string }): string {
	return args.path ?? args.file_path ?? "…";
}

/** Preserva os metadados oficiais do prompt quando a ferramenta os fornece. */
export function promptMeta(tool: { execute: unknown }): { promptSnippet?: string; promptGuidelines?: string[] } {
	const t = tool as { promptSnippet?: string; promptGuidelines?: string[] };
	return { promptSnippet: t.promptSnippet, promptGuidelines: t.promptGuidelines };
}