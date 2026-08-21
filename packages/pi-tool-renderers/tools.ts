/**
 * Renderers próprios das ferramentas internas do Pi (bash, read, grep, find, ls).
 *
 * Os registros reutilizam as fábricas oficiais para manter parâmetros, execução
 * e metadados do Pi; somente a apresentação é substituída. `write` e `edit`
 * são registrados pelo pacote pi-diff.
 */
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
	createBashTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
} from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";
import {
	EXPANDED_MAX_LINES,
	INDENT,
	bashOutputPresentation,
	displayPath,
	errorBody,
	headSlice,
	indentLines,
	promptMeta,
	resultText,
	shortenCommand,
	shortenPathDisplay,
	splitLines,
	toolTitle,
} from "pi-ui-shared";
import { homedir } from "node:os";

/**
 * Reusa o `Text` da renderização anterior quando ele é compatível com a saída.
 * Só é seguro nos renderers cujos caminhos sempre retornam `Text`; `write` e
 * `edit`, que podem devolver `Container`, criam um componente novo.
 */
function reuseText(context: { lastComponent: Component | undefined }): Text {
	return context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
}


function registerBashTool(pi: ExtensionAPI, cwd: string): void {
	const original = createBashTool(cwd);
	pi.registerTool({
		name: "bash",
		label: original.label,
		description: original.description,
		parameters: original.parameters,
		renderShell: "self",
		...promptMeta(original),
		async execute(toolCallId, params, signal, onUpdate) {
			return original.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme, context) {
			const text = reuseText(context);
			const command = shortenCommand(args.command, cwd);
			const timeout = args.timeout ? theme.fg("dim", ` (timeout: ${args.timeout}s)`) : "";
			// Comandos bash multilinha permanecem completos de propósito:
			// encurtá-los ocultaria a estrutura que o usuário precisa inspecionar.
			text.setText(`${toolTitle(theme, "Ran")} ${theme.fg("accent", command)}${timeout}`);
			return text;
		},
		renderResult(result, { expanded, isPartial }, theme, context) {
			const text = reuseText(context);
			const view = bashOutputPresentation(resultText(result), {
				expanded,
				isPartial,
				isError: context.isError,
			});
			if (view.kind === "error") {
				if (!expanded) {
					text.setText(errorBody(theme, view.status));
					return text;
				}
				text.setText(view.output ? theme.fg("error", indentLines(resultText(result))) : errorBody(theme, view.status));
				return text;
			}
			if (view.kind === "empty") {
				text.setText("");
			} else if (view.kind === "summary") {
				text.setText(theme.fg("muted", `${INDENT}${view.lineCount} lines`));
			} else if (view.kind === "lines") {
				text.setText(theme.fg("toolOutput", indentLines(view.lines.join("\n"))));
			} else {
				text.setText(theme.fg("toolOutput", indentLines(view.output)));
			}
			return text;
		},
	});
}

/** Mantém a chamada compacta no estado recolhido; o conteúdo só aparece expandido. */
function registerReadTool(pi: ExtensionAPI, cwd: string, home: string): void {
	const original = createReadTool(cwd);
	pi.registerTool({
		name: "read",
		label: original.label,
		description: original.description,
		parameters: original.parameters,
		renderShell: "self",
		...promptMeta(original),
		async execute(toolCallId, params, signal, onUpdate) {
			return original.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme) {
			const parts: string[] = [];
			if (args.offset) parts.push(`offset=${args.offset}`);
			if (args.limit) parts.push(`limit=${args.limit}`);
			const path = shortenPathDisplay(displayPath(args), cwd, home);
			let text = toolTitle(theme, "Read ");
			text += theme.fg("accent", path);
			if (parts.length > 0) text += theme.fg("dim", ` (${parts.join(", ")})`);
			return new Text(text, 0, 0);
		},
		renderResult(result, { expanded }, theme, context) {
			const text = reuseText(context);
			if (context.isError) {
				text.setText(errorBody(theme, resultText(result)));
				return text;
			}
			if (!expanded) {
				text.setText("");
				return text;
			}
			const content = result.content[0];
			if (content?.type === "image") {
				text.setText(theme.fg("success", `${INDENT}Image loaded`));
				return text;
			}
			const lines = splitLines(content?.type === "text" ? content.text : "");
			const shown = headSlice(lines, EXPANDED_MAX_LINES);
			if (shown.length === 0) {
				text.setText("");
				return text;
			}
			const width = String(lines.length).length;
			const numbered = shown
				.map((line, i) => `${INDENT}${String(i + 1).padStart(width, " ")} ${line}`)
				.join("\n");
			text.setText(theme.fg("toolOutput", numbered));
			return text;
		},
	});
}

/** Mantém grep/find/ls compactos e, ao expandir, mostra a saída sem fabricar um resumo. */
function renderExplorationResult(
	result: { content: Array<{ type: string; text?: string }> },
	expanded: boolean,
	theme: Theme,
	context: { isError: boolean; lastComponent: Component | undefined },
): Text {
	const text = reuseText(context);
	if (context.isError) {
		text.setText(errorBody(theme, resultText(result)));
		return text;
	}
	if (!expanded) {
		text.setText("");
		return text;
	}
	const lines = headSlice(splitLines(resultText(result)), EXPANDED_MAX_LINES);
	text.setText(lines.length === 0 ? "" : theme.fg("toolOutput", indentLines(lines.join("\n"))));
	return text;
}

function registerGrepTool(pi: ExtensionAPI, cwd: string, home: string): void {
	const original = createGrepTool(cwd);
	pi.registerTool({
		name: "grep",
		label: original.label,
		description: original.description,
		parameters: original.parameters,
		renderShell: "self",
		...promptMeta(original),
		async execute(toolCallId, params, signal, onUpdate) {
			return original.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme) {
			const path = shortenPathDisplay(args.path ?? ".", cwd, home);
			let text = toolTitle(theme, "Search ");
			text += theme.fg("accent", args.pattern);
			text += theme.fg("dim", " in ");
			text += theme.fg("accent", path);
			return new Text(text, 0, 0);
		},
		renderResult(result, { expanded }, theme, context) {
			return renderExplorationResult(result, expanded, theme, context);
		},
	});
}

function registerFindTool(pi: ExtensionAPI, cwd: string, home: string): void {
	const original = createFindTool(cwd);
	pi.registerTool({
		name: "find",
		label: original.label,
		description: original.description,
		parameters: original.parameters,
		renderShell: "self",
		...promptMeta(original),
		async execute(toolCallId, params, signal, onUpdate) {
			return original.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme) {
			const path = shortenPathDisplay(args.path ?? ".", cwd, home);
			let text = toolTitle(theme, "Find ");
			text += theme.fg("accent", args.pattern);
			text += theme.fg("dim", " in ");
			text += theme.fg("accent", path);
			return new Text(text, 0, 0);
		},
		renderResult(result, { expanded }, theme, context) {
			return renderExplorationResult(result, expanded, theme, context);
		},
	});
}

function registerLsTool(pi: ExtensionAPI, cwd: string, home: string): void {
	const original = createLsTool(cwd);
	pi.registerTool({
		name: "ls",
		label: original.label,
		description: original.description,
		parameters: original.parameters,
		renderShell: "self",
		...promptMeta(original),
		async execute(toolCallId, params, signal, onUpdate) {
			return original.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme) {
			return new Text(`${toolTitle(theme, "List ")}${theme.fg("accent", shortenPathDisplay(args.path ?? ".", cwd, home))}`, 0, 0);
		},
		renderResult(result, { expanded }, theme, context) {
			return renderExplorationResult(result, expanded, theme, context);
		},
	});
}

export function registerToolRenderers(pi: ExtensionAPI): void {
	const cwd = process.cwd();
	const home = homedir();
	registerBashTool(pi, cwd);
	registerReadTool(pi, cwd, home);
	registerGrepTool(pi, cwd, home);
	registerFindTool(pi, cwd, home);
	registerLsTool(pi, cwd, home);
}