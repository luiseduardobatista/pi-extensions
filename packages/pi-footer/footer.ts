/**
 * Mantém o footer em no máximo duas linhas: identidade na primeira e consumo
 * na segunda.
 */
import { homedir } from "node:os";
import type { TUI } from "@earendil-works/pi-tui";
import type {
	ExtensionAPI,
	ExtensionContext,
	ReadonlyFooterDataProvider,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	formatContextPct,
	formatPath,
	formatTps,
	formatUsage,
	prioritizeFooter,
	type FooterItem,
} from "pi-ui-shared";

/**
 * Mantém os listeners globais no escopo da factory: dentro do session_start,
 * eles se acumulariam a cada fork/switch/newSession.
 */
export function installFooter(pi: ExtensionAPI): void {
	let tuiRef: TUI | undefined;
	// Velocidade média em tempo de parede da última mensagem do assistant
	// (tokens de saída por segundo), medida entre message_start e message_end.
	// Como Usage inclui reasoning, representa todo o stream (pensamento +
	// geração), não apenas a geração.
	let assistantStartedAt: number | undefined;
	let lastTps: number | undefined;
	const rerender = () => tuiRef?.requestRender();
	pi.on("message_end", rerender);
	pi.on("model_select", rerender);
	pi.on("thinking_level_select", rerender);

	pi.on("message_start", (event) => {
		if (event.message.role === "assistant") assistantStartedAt = Date.now();
	});
	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		const elapsedMs =
			assistantStartedAt !== undefined ? Date.now() - assistantStartedAt : undefined;
		assistantStartedAt = undefined;
		const output = event.message.usage?.output;
		if (elapsedMs !== undefined && elapsedMs > 0 && output !== undefined && output > 0) {
			lastTps = (output / elapsedMs) * 1000;
		}
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setFooter((tui, _theme, footerData) => {
			tuiRef = tui;
			const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: unsubscribe,
				invalidate() {},
				render(width: number): string[] {
					// Consulta o tema a cada render para refletir trocas de tema.
					return buildFooterLines(ctx.ui.theme, ctx, pi, footerData, width, lastTps);
				},
			};
		});
	});
}

function buildFooterLines(
	theme: Theme,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	footerData: ReadonlyFooterDataProvider,
	width: number,
	lastTps: number | undefined,
): string[] {
	const model = ctx.model;
	const modelId = model
		? model.provider && model.provider.length > 0
			? `${model.provider}/${model.id}`
			: model.id
		: "no-model";
	const identity: FooterItem[] = [
		{ priority: 1, text: theme.fg("accent", `${modelId} · ${pi.getThinkingLevel() || "off"}`) },
		{ priority: 2, text: theme.fg("dim", formatPath(ctx.cwd, homedir())) },
	];
	const branch = footerData.getGitBranch();
	if (branch) identity.push({ priority: 3, text: theme.fg("dim", `⎇  ${branch}`) });

	// Consumo acumulado da branch ativa e contexto atual.
	let input = 0;
	let output = 0;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		input += entry.message.usage?.input ?? 0;
		output += entry.message.usage?.output ?? 0;
	}

	const usage: FooterItem[] = [
		{ priority: 1, text: theme.fg("muted", `↑${formatUsage(input)}`) },
		{ priority: 1, text: theme.fg("muted", `↓${formatUsage(output)}`) },
	];
	const contextUsage = ctx.getContextUsage();
	if (contextUsage) {
		const pct =
			contextUsage.percent === null || contextUsage.tokens === null
				? "?"
				: formatContextPct(contextUsage.tokens, contextUsage.contextWindow);
		const tokens = contextUsage.tokens === null ? "?" : formatUsage(contextUsage.tokens);
		usage.push({
			priority: 2,
			text: theme.fg("muted", `◧ ${tokens}/${formatUsage(contextUsage.contextWindow)} (${pct})`),
		});
	}
	if (lastTps !== undefined) {
		usage.push({ priority: 3, text: theme.fg("muted", `${formatTps(lastTps)} t/s`) });
	}

	// O footer só mostra estado da sessão; status publicados por outras
	// extensões não participam da renderização.
	return [prioritizeFooter(width, identity), prioritizeFooter(width, usage)];
}
