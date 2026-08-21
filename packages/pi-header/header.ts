import { homedir } from "node:os";
import type { TUI } from "@earendil-works/pi-tui";
import {
	VERSION,
	type ExtensionAPI,
	type ExtensionContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { formatPath, truncateToWidth, visibleWidth } from "pi-ui-shared";

/** Largura fixa para manter os rótulos alinhados. */
const LABEL_WIDTH = 11;

/**
 * Mantém os listeners globais no escopo da factory: dentro do session_start,
 * eles se acumulariam a cada fork/switch/newSession.
 */
export function installHeader(pi: ExtensionAPI): void {
	let tuiRef: TUI | undefined;
	const rerender = () => tuiRef?.requestRender();
	pi.on("model_select", rerender);
	pi.on("thinking_level_select", rerender);

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setHeader((tui) => {
			tuiRef = tui;
			return {
				invalidate() {},
				render(width: number): string[] {
					// Consulta o tema a cada render para refletir trocas de tema.
					return renderHeader(ctx.ui.theme, ctx, pi, width);
				},
			};
		});
	});
}

function renderHeader(
	theme: Theme,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	width: number,
): string[] {
	const inner = Math.max(0, width - 2);
	const border = (s: string) => theme.fg("borderMuted", s);

	const version = VERSION && VERSION.length > 0 ? theme.fg("dim", ` (v${VERSION})`) : "";
	const title = theme.fg("accent", ">_") + theme.fg("text", " Pi Coding Agent") + version;

	const modelText = buildModelText(ctx, pi, theme);

	const directory = formatPath(ctx.cwd, homedir());

	const labelModel = theme.fg("muted", "model:".padEnd(LABEL_WIDTH));
	const labelDir = theme.fg("muted", "directory:".padEnd(LABEL_WIDTH));

	const boxLines = [
		border(`┌${"─".repeat(inner)}┐`),
		frameLine(theme, inner, title),
		frameLine(theme, inner, ""),
		frameLine(theme, inner, labelModel + modelText),
		frameLine(theme, inner, labelDir + directory),
		border(`└${"─".repeat(inner)}┘`),
	];

	return [...boxLines, ""];
}

function buildModelText(ctx: ExtensionContext, pi: ExtensionAPI, theme: Theme): string {
	const model = ctx.model;
	if (!model) {
		return `${theme.fg("muted", "(none)")}  ${theme.fg("dim", "/model")}`;
	}
	const id = model.provider && model.provider.length > 0 ? `${model.provider}/${model.id}` : model.id;
	const level = pi.getThinkingLevel();
	const thinking = level && level !== "off" ? ` ${level}` : "";
	return `${id}${thinking}  ${theme.fg("dim", "/model")}`;
}

function frameLine(theme: Theme, inner: number, content: string): string {
	const truncated = truncateToWidth(content, inner);
	const pad = " ".repeat(Math.max(0, inner - visibleWidth(truncated)));
	return theme.fg("borderMuted", "│") + truncated + pad + theme.fg("borderMuted", "│");
}
