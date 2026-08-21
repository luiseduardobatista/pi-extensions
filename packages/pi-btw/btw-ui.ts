/**
 * Overlay ancorado na parte inferior para o /btw.
 *
 * O painel mantém as perguntas recentes no topo, o status da ferramenta e a
 * resposta abaixo delas, com as dicas condicionais fixadas no rodapé. A
 * resposta segue em pending/streaming/answer ou error, sem entrar no transcript.
 *
 * Conteúdo que excede a altura disponível rola dentro do painel; o footer fica
 * visível e o offset inicial privilegia as perguntas. A navegação entre respostas
 * expande a janela do histórico e mantém o destaque visível.
 *
 * Esc aborta e dispensa; Space/Enter dispensam após a resposta; ↑/↓ (k/j) rolam;
 * ←/→ (h/l) navegam; c copia a resposta exibida; x limpa o histórico da sessão.
 */

import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { copyToClipboard, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Key,
	Markdown,
	matchesKey,
	type OverlayOptions,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { BtwTurn } from "./btw.ts";

const PANEL_HEIGHT_RATIO = 0.5; // Mantém o painel previsível; conteúdo excedente rola dentro dele.
const OVERLAY_MAX_HEIGHT = "55%"; // Folga para o arredondamento do TUI sem alterar a altura efetiva.
const HISTORY_VISIBLE = 5; // Limita o histórico inicial; a navegação pode revelar perguntas antigas.

const OVERLAY_OPTIONS: OverlayOptions = {
	anchor: "bottom-center",
	width: "100%",
	maxHeight: OVERLAY_MAX_HEIGHT,
	margin: { left: 0, right: 0, bottom: 0 },
};

const SIDE_PAD = "  ";
const ANSWER_PAD = "    ";
const BTW_LITERAL = "/btw";
const PENDING_GLYPH = "…";

const FOOTER_SCROLL = "k/j rolar";
const FOOTER_NAV = "h/l respostas";
const FOOTER_COPY = "c copiar";
const FOOTER_CLEAR = "x limpar";
const FOOTER_DISMISS = "Esc dispensar";
const FOOTER_SEP = " · ";
const OLDER_COUNT = "…e %d mais antigas";

type Mode = "pending" | "streaming" | "answer" | "error";

export interface ShowBtwOverlayParams {
	ctx: ExtensionCommandContext;
	question: string;
	history: BtwTurn[];
	/** Reabre o overlay sem nova pergunta, exibindo a última troca disponível. */
	reopen?: boolean;
	onAbort: () => void;
	onClearHistory: () => void;
}

export interface ShowBtwOverlayResult {
	overlayPromise: Promise<void>;
	controllerReady: Promise<BtwOverlayController>;
}

export class BtwOverlayController implements Component {
	private mode: Mode;
	private answerText = "";
	private error = "";
	private toolStatus: string | null = null;
	private revealed = 0; // A navegação pode expandir a janela além das cinco perguntas padrão.
	private scrollOffset = 0; // Deslocamento do viewport; zero mantém o topo do conteúdo.
	private followHighlight = false; // Após navegar, mantém o destaque visível sem ocultar o contexto anterior.
	private turns: BtwTurn[];
	private viewIndex: number; // Índice da troca exibida; durante a chamada, aponta para além do fim.
	private readonly markdown: Markdown;
	private readonly question: string;
	private readonly theme: Theme;
	private readonly tui: TUI;
	private readonly done: (result?: undefined) => void;
	private readonly onAbort: () => void;
	private readonly onClearHistory: () => void;

	constructor(
		question: string,
		history: BtwTurn[],
		reopen: boolean,
		theme: Theme,
		tui: TUI,
		done: (result?: undefined) => void,
		onAbort: () => void,
		onClearHistory: () => void,
	) {
		this.question = question;
		this.theme = theme;
		this.tui = tui;
		this.done = done;
		this.onAbort = onAbort;
		this.onClearHistory = onClearHistory;
		this.turns = [...history];
		this.mode = reopen ? "answer" : "pending";
		this.viewIndex = reopen ? Math.max(0, this.turns.length - 1) : this.turns.length;
		this.markdown = new Markdown("", 0, 0, getMarkdownTheme());
	}

	/** Atualiza o texto parcial enquanto o modelo ainda está trabalhando. */
	setStreaming(text: string): void {
		if (this.mode === "pending") this.mode = "streaming";
		this.answerText = text;
		this.tui.requestRender();
	}

	/** Exibe a resposta final e adiciona a troca ao histórico navegável. */
	setAnswer(turn: BtwTurn): void {
		this.mode = "answer";
		this.answerText = turn.answer;
		this.turns.push(turn);
		this.viewIndex = this.turns.length - 1;
		this.toolStatus = null;
		this.tui.requestRender();
	}

	setError(message: string): void {
		this.mode = "error";
		this.error = message;
		this.toolStatus = null;
		this.tui.requestRender();
	}

	setToolStatus(line: string | null): void {
		this.toolStatus = line;
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.onAbort();
			this.done();
			return;
		}
		if ((matchesKey(data, Key.space) || matchesKey(data, Key.enter)) && this.mode === "answer") {
			this.done();
			return;
		}
		if (matchesKey(data, Key.down) || data === "j") {
			// Rolagem e navegação entre respostas são estados independentes.
			this.scrollOffset = this.scrollOffset + 1;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.up) || data === "k") {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
			this.tui.requestRender();
			return;
		}
		if ((matchesKey(data, Key.left) || data === "h") && this.mode === "answer") {
			this.viewIndex = Math.max(0, this.viewIndex - 1);
			this.ensureViewVisible();
			this.followHighlight = true;
			this.tui.requestRender();
			return;
		}
		if ((matchesKey(data, Key.right) || data === "l") && this.mode === "answer") {
			this.viewIndex = Math.min(this.turns.length - 1, this.viewIndex + 1);
			this.ensureViewVisible();
			this.followHighlight = true;
			this.tui.requestRender();
			return;
		}
		if (data === "c" && this.mode === "answer") {
			void copyToClipboard(this.turns[this.viewIndex].answer);
			return;
		}
		if (data === "x") {
			this.turns = [];
			this.viewIndex = 0;
			this.revealed = 0;
			this.scrollOffset = 0;
			this.onClearHistory();
			this.tui.requestRender();
			return;
		}
	}

	render(width: number): string[] {
		const displayed = this.viewIndex < this.turns.length ? this.turns[this.viewIndex] : null;
		const questionLines = this.renderQuestions(width);
		const statusLine =
			this.toolStatus !== null && this.mode !== "answer"
				? SIDE_PAD + this.theme.fg("muted", this.toolStatus)
				: null;
		const answerLines = this.renderAnswer(width, displayed);

		// As perguntas ficam no topo e o footer no fim; espaço vazio fica entre a
		// resposta e o footer, enquanto o excesso pode ser rolado.
		const termRows = (this.tui.terminal as { rows?: number }).rows ?? 24;
		const maxRows = Math.max(4, Math.floor(termRows * PANEL_HEIGHT_RATIO));
		const content = [...questionLines, ...(statusLine ? [statusLine] : []), ...answerLines, ""];
		const footer = this.renderFooter(width, content.length + 1 > maxRows);

		if (content.length + 1 <= maxRows) {
			this.followHighlight = false;
			const pad = maxRows - (content.length + 1);
			return [...content, ...Array.from({ length: pad }, () => ""), footer];
		}
		// O footer não participa da rolagem. O topo começa nas perguntas visíveis;
		// após ←/→, ajusta-se apenas o necessário para manter o destaque no viewport.
		const excess = content.length - (maxRows - 1);
		if (this.scrollOffset > excess) this.scrollOffset = excess;
		if (this.followHighlight) {
			this.followHighlight = false;
			const qStart = this.questionStart();
			const highlightLine = (qStart > 0 ? 1 : 0) + (this.viewIndex - qStart);
			// Se o destaque já couber, preserva a âncora no topo.
			const maxTop = highlightLine - (maxRows - 2);
			this.scrollOffset = maxTop > 0 ? Math.min(excess, maxTop) : 0;
		}
		const start = this.scrollOffset;
		return [...content.slice(start, start + maxRows - 1), footer];
	}

	invalidate(): void {
		// Não há estado derivado para invalidar: render() recalcula a cada ciclo.
	}

	private renderBanner(question: string, width: number): string {
		const prefix = `${SIDE_PAD}${BTW_LITERAL} `;
		const qAvail = Math.max(0, width - visibleWidth(prefix));
		const raw = prefix + truncateToWidth(question.replace(/\s+/g, " ").trim(), qAvail, "…", false);
		const padded = raw + " ".repeat(Math.max(0, width - visibleWidth(raw)));
		return this.theme.bg("customMessageBg", this.theme.fg("customMessageText", padded));
	}

	private renderQuestions(width: number): string[] {
		// Mostra as perguntas recentes e resume as antigas no topo. ↑/↓ não alteram
		// essa lista; ←/→ podem expandi-la e destacam a resposta escolhida.
		const inFlight = this.viewIndex >= this.turns.length;
		const start = this.questionStart();
		const qAvail = Math.max(0, width - SIDE_PAD.length);
		const lines: string[] = [];
		if (start > 0) {
			lines.push(SIDE_PAD + this.theme.fg("muted", OLDER_COUNT.replace("%d", String(start))));
		}
		for (let i = start; i < this.turns.length; i++) {
			const question = this.turns[i].question;
			if (i === this.viewIndex) {
				lines.push(this.renderBanner(question, width));
			} else {
				lines.push(
					SIDE_PAD +
						this.theme.fg(
							"muted",
							truncateToWidth(`${BTW_LITERAL} ${question.replace(/\s+/g, " ").trim()}`, qAvail, "…", false),
						),
				);
			}
		}
		if (inFlight) {
			lines.push(this.renderBanner(this.question, width));
		}
		return lines;
	}

	private totalQuestions(): number {
		return this.turns.length + (this.viewIndex >= this.turns.length ? 1 : 0);
	}

	private hiddenCount(): number {
		return Math.max(0, this.totalQuestions() - HISTORY_VISIBLE);
	}

	/** Calcula o início da janela de perguntas atualmente renderizada. */
	private questionStart(): number {
		const total = this.totalQuestions();
		return total - Math.min(total, HISTORY_VISIBLE + this.revealed);
	}

	/** Expande a janela quando a navegação levar o destaque para fora dela. */
	private ensureViewVisible(): void {
		const start = this.questionStart();
		if (this.viewIndex < start) {
			this.revealed = Math.min(this.hiddenCount(), this.revealed + (start - this.viewIndex));
		}
	}

	private wrapBodyLines(text: string, bodyWidth: number, colorFn?: (s: string) => string): string[] {
		const out: string[] = [];
		for (const ln of text.split("\n")) {
			const src = ln.length === 0 ? " " : ln;
			out.push(...wrapTextWithAnsi(colorFn ? colorFn(src) : src, bodyWidth));
		}
		return out;
	}

	private renderAnswer(width: number, displayed: BtwTurn | null): string[] {
		const bodyWidth = Math.max(1, width - ANSWER_PAD.length);
		const indent = (lines: string[]) => lines.map((l) => ANSWER_PAD + l);

		if (this.mode === "pending") {
			return indent([this.theme.fg("warning", PENDING_GLYPH)]);
		}
		if (this.mode === "error") {
			return indent(this.wrapBodyLines(this.error, bodyWidth, (s) => this.theme.fg("error", s)));
		}
		this.markdown.setText(displayed ? displayed.answer : this.answerText);
		return indent(this.markdown.render(bodyWidth));
	}

	private renderFooter(width: number, overflow: boolean): string {
		const parts: string[] = [];
		if (overflow) parts.push(FOOTER_SCROLL);
		if (this.mode === "answer" && this.turns.length > 1) parts.push(FOOTER_NAV);
		if (this.mode === "answer") parts.push(FOOTER_COPY);
		if (this.turns.length > 0) parts.push(FOOTER_CLEAR);
		parts.push(FOOTER_DISMISS);
		const avail = Math.max(1, width - SIDE_PAD.length);
		return SIDE_PAD + truncateToWidth(this.theme.fg("dim", parts.join(FOOTER_SEP)), avail, "…", false);
	}
}

export function showBtwOverlay(params: ShowBtwOverlayParams): ShowBtwOverlayResult {
	let resolveReady!: (controller: BtwOverlayController) => void;
	const controllerReady = new Promise<BtwOverlayController>((resolve) => {
		resolveReady = resolve;
	});

	const overlayPromise = params.ctx.ui.custom<void>(
		(tui, theme, _kb, done) => {
			const controller = new BtwOverlayController(
				params.question,
				params.history,
				params.reopen ?? false,
				theme,
				tui,
				done,
				params.onAbort,
				params.onClearHistory,
			);
			resolveReady(controller);
			return controller;
		},
		{ overlay: true, overlayOptions: OVERLAY_OPTIONS },
	);

	return { overlayPromise, controllerReady };
}
