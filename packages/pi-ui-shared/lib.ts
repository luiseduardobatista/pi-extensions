const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Largura visível (em colunas de terminal) de um texto, ignorando
 * sequências ANSI (CSI, OSC e APC), expandindo tabs para 3 colunas e
 * contando grafemas largos (CJK/emoji) como 2.
 */
export function visibleWidth(text: string): number {
	if (text.length === 0) return 0;
	let clean = text;
	if (clean.includes("\t")) clean = clean.replace(/\t/g, "   ");
	if (clean.includes("\x1b")) clean = stripAnsi(clean);
	let width = 0;
	for (const { segment } of graphemeSegmenter.segment(clean)) {
		width += graphemeWidth(segment);
	}
	return width;
}

/**
 * Trunca `text` pela largura visível, sem quebrar sequências ANSI.
 * Estilos ativos no ponto de corte são zerados antes da elipse para não
 * vazar cor para o restante da linha. Se a elipse não couber inteira,
 * ela própria é truncada.
 */
export function truncateToWidth(text: string, width: number, ellipsis = "…"): string {
	if (width <= 0 || text.length === 0) return "";
	const ellipsisWidth = visibleWidth(ellipsis);
	if (visibleWidth(text) <= width) return text;
	if (ellipsisWidth >= width) {
		return truncateToWidth(ellipsis, width, "");
	}
	const targetWidth = width - ellipsisWidth;
	let result = "";
	let pendingAnsi = "";
	let keptWidth = 0;
	let i = 0;
	for (const seg of graphemeSegmenter.segment(text)) {
		if (seg.index < i) continue;
		if (seg.segment.startsWith("\x1b")) {
			const ansi = extractAnsiCode(text, seg.index);
			if (ansi) {
				pendingAnsi += ansi.code;
				i = seg.index + ansi.length;
				continue;
			}
			// Sequência ANSI malformada: preserva os bytes como estão.
			pendingAnsi += seg.segment;
			i = seg.index + seg.segment.length;
			continue;
		}
		const w = graphemeWidth(seg.segment);
		if (keptWidth + w > targetWidth) break;
		if (pendingAnsi) {
			result += pendingAnsi;
			pendingAnsi = "";
		}
		result += seg.segment;
		keptWidth += w;
		i = seg.index + seg.segment.length;
	}
	const reset = "\x1b[0m";
	return ellipsis.length > 0 ? `${result}${reset}${ellipsis}${reset}` : `${result}${reset}`;
}

export function formatUsage(tokens: number): string {
	const n = Math.max(0, tokens);
	if (n < 1000) return String(Math.round(n));
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Formata velocidade de geração: "4.2", "42.3", "123", "1.5K". */
export function formatTps(tps: number): string {
	const n = Math.max(0, tps);
	if (n < 100) return n.toFixed(1);
	const rounded = Math.round(n);
	if (rounded < 1000) return String(rounded);
	return `${(rounded / 1000).toFixed(1)}K`;
}

/** Limites de apresentação compartilhados com os renderers. */
export const PREVIEW_LINES = 8;
export const COMPACT_BASH_MAX_LINES = 3;
export const DIFF_COLLAPSED_LINES = 24;
export const EXPANDED_MAX_LINES = 4000;
export const DIFF_WORD_WRAP = true;

export function formatContextPct(tokens: number, limit: number): string {
	if (limit <= 0 || tokens <= 0) return "0%";
	const rounded = Math.round((tokens / limit) * 1000) / 10;
	return `${rounded}%`;
}

/** Divide texto em linhas sem contar a quebra de linha final como linha extra. */
export function splitLines(text: string): string[] {
	if (text === "") return [];
	const lines = text.split("\n");
	if (text.endsWith("\n")) lines.pop();
	return lines;
}

/** Conta linhas com semântica de arquivo; linhas vazias internas contam. */
export function countLines(text: string): number {
	return text === "" ? 0 : splitLines(text).length;
}

/** Prévia das primeiras linhas, sem adicionar hints à apresentação. */
export function previewLines(text: string, maxLines: number): { lines: string[]; truncated: boolean } {
	const lines = splitLines(text);
	if (maxLines <= 0) return { lines: [], truncated: lines.length > 0 };
	if (lines.length <= maxLines) return { lines, truncated: false };
	return { lines: lines.slice(0, maxLines), truncated: true };
}

/** Limita a expansão visual sem modificar o texto das linhas. */
export function headSlice(lines: string[], maxLines: number): string[] {
	return lines.slice(0, Math.max(0, maxLines));
}

/**
 * Apresentação recolhida do bash: saída vazia não recebe marcador; até três
 * linhas são preservadas e resultados maiores viram somente uma contagem.
 */
export function compactBashOutput(output: string):
	| { kind: "empty" }
	| { kind: "lines"; lines: string[] }
	| { kind: "summary"; lineCount: number } {
	if (output.trim() === "" || output.trim() === "(no output)") return { kind: "empty" };
	const lines = splitLines(output);
	return lines.length <= COMPACT_BASH_MAX_LINES
		? { kind: "lines", lines }
		: { kind: "summary", lineCount: lines.length };
}

export type BashOutputPresentation =
	| { kind: "empty" }
	| { kind: "lines"; lines: string[] }
	| { kind: "summary"; lineCount: number }
	| { kind: "expanded"; output: string }
	| { kind: "error"; output: string; status: string };

/**
 * Decide a apresentação do bash sem truncar a expansão nem o contrato oficial.
 * O partial permanece vazio e o erro expõe seu status antes do corpo.
 */
export function bashOutputPresentation(
	output: string,
	options: { expanded: boolean; isPartial: boolean; isError: boolean },
): BashOutputPresentation {
	if (options.isError) {
		const { output: body, status } = splitBashError(output);
		return { kind: "error", output: body, status };
	}
	if (options.isPartial) return { kind: "empty" };
	if (options.expanded) {
		return compactBashOutput(output).kind === "empty" ? { kind: "empty" } : { kind: "expanded", output };
	}
	return compactBashOutput(output);
}

/** Separa corpo e status oficial de um erro do bash sem alterar o texto expandido. */
export function splitBashError(message: string): { output: string; status: string } {
	const idx = message.lastIndexOf("\n\nCommand ");
	if (idx !== -1) {
		return { output: message.slice(0, idx), status: message.slice(idx + 2) };
	}
	return { output: "", status: message };
}

/**
 * Prefixo `cd` da chamada bash, encurtado apenas para exibição. O comando
 * recebido pela factory oficial permanece intacto.
 */
export function shortenCommand(command: string, cwd: string): string {
	const match = command.match(/^cd\s+(\S+)(\s*&&\s*|\s*;\s*|$)/);
	if (!match) return command;
	const target = match[1]!;
	const separator = match[2]!;
	const normalize = (path: string): string =>
		path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
	if (normalize(target) === normalize(cwd)) {
		const rest = command.slice(match[0].length);
		return rest.trim() !== "" ? rest : command;
	}
	if (target.length > 50) {
		const basename = target.slice(target.lastIndexOf("/") + 1);
		return `cd …/${basename}${separator}${command.slice(match[0].length)}`;
	}
	return command;
}

/** Exibe caminhos relativos ao cwd; fora dele, usa "~" ou os últimos segmentos. */
export function shortenPathDisplay(path: string, cwd: string, home: string): string {
	if (!path || path === ".") return path;
	const normalize = (value: string): string =>
		value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value;
	const value = normalize(path);
	const workingDirectory = normalize(cwd);
	if (value === workingDirectory) return ".";
	if (value.startsWith(`${workingDirectory}/`)) return value.slice(workingDirectory.length + 1);
	const homeDirectory = home.length > 1 ? normalize(home) : "";
	if (homeDirectory && value === homeDirectory) return "~";
	if (homeDirectory && value.startsWith(`${homeDirectory}/`)) return `~${value.slice(homeDirectory.length)}`;
	if (value.length > 50) {
		const segments = value.split("/").filter(Boolean);
		if (segments.length > 3) return `…/${segments.slice(-3).join("/")}`;
	}
	return value;
}

/**
 * Encurta `path` substituindo o prefixo `home` por "~/" ("~/projeto/src").
 * O próprio home vira "~". Caminhos fora do home ou home raiz ("/")
 * permanecem intactos.
 */
export function formatPath(path: string, home: string): string {
	if (!path) return path;
	if (home.length > 1) {
		const base = home.endsWith("/") ? home.slice(0, -1) : home;
		if (path === base) return "~";
		if (path.startsWith(base + "/")) return "~" + path.slice(base.length);
	}
	return path;
}

/** Item do footer com prioridade (1 = mais importante, mantido por último). */
export interface FooterItem {
	text: string;
	priority: number;
}

const FOOTER_SEPARATOR = " · ";

/**
 * Seleciona os itens do footer que cabem em `width`, removendo do menos
 * importante (maior número de priority) para o mais importante (priority 1,
 * mantido por último), unidos por " · ". Nunca estoura `width`: se nem o
 * item mais importante couber inteiro, ele é truncado previsivelmente.
 */
export function prioritizeFooter(width: number, items: FooterItem[]): string {
	if (width <= 0 || items.length === 0) return "";
	const remaining = items.map((item, index) => ({ ...item, index }));
	while (remaining.length > 1) {
		const joined = joinItems(remaining);
		if (visibleWidth(joined) <= width) return joined;
		// Remove o item de maior número de priority (menos importante);
		// empates removem o último da lista.
		let maxPriority = -Infinity;
		let removeIndex = -1;
		for (let i = 0; i < remaining.length; i++) {
			const p = remaining[i]!.priority;
			if (p >= maxPriority) {
				maxPriority = p;
				removeIndex = i;
			}
		}
		remaining.splice(removeIndex, 1);
	}
	const joined = joinItems(remaining);
	if (visibleWidth(joined) <= width) return joined;
	return truncateToWidth(remaining[0]!.text, width);
}

function joinItems(items: { text: string }[]): string {
	return items.map((item) => item.text).join(FOOTER_SEPARATOR);
}

/**
 * Extrai uma sequência de escape ANSI em `pos` (CSI com final em
 * m/G/K/H/J, OSC e APC terminados por BEL ou ST). Espelha o
 * comportamento do pi-tui para consistência de largura.
 */
function extractAnsiCode(
	text: string,
	pos: number,
): { code: string; length: number } | null {
	if (pos >= text.length || text[pos] !== "\x1b") return null;
	const next = text[pos + 1];
	// CSI: ESC [ ... m/G/K/H/J
	if (next === "[") {
		let j = pos + 2;
		while (j < text.length && !/[mGKHJ]/.test(text[j]!)) j++;
		if (j < text.length) return { code: text.slice(pos, j + 1), length: j + 1 - pos };
		return null;
	}
	// OSC (ESC ]) e APC (ESC _): terminados por BEL ou ST (ESC \)
	if (next === "]" || next === "_") {
		let j = pos + 2;
		while (j < text.length) {
			if (text[j] === "\x07") return { code: text.slice(pos, j + 1), length: j + 1 - pos };
			if (text[j] === "\x1b" && text[j + 1] === "\\")
				return { code: text.slice(pos, j + 2), length: j + 2 - pos };
			j++;
		}
		return null;
	}
	return null;
}

function stripAnsi(text: string): string {
	let out = "";
	let i = 0;
	while (i < text.length) {
		const ansi = extractAnsiCode(text, i);
		if (ansi) {
			i += ansi.length;
			continue;
		}
		out += text[i];
		i++;
	}
	return out;
}

function graphemeWidth(grapheme: string): number {
	if (grapheme === "\t") return 3;
	const first = grapheme.codePointAt(0)!;
	if (isZeroWidth(first)) return 0;
	if (isWide(first)) return 2;
	return 1;
}

/** Faixas Unicode de largura zero (combining, variation selectors, ZWJ...). */
function isZeroWidth(code: number): boolean {
	return (
		code === 0x00ad || // hífen discreto
		(code >= 0x0300 && code <= 0x036f) || // diacríticos combinantes
		(code >= 0x1ab0 && code <= 0x1aff) || // combinantes estendidos
		(code >= 0x1dc0 && code <= 0x1dff) || // suplemento de combinantes
		(code >= 0x200b && code <= 0x200f) || // ZWSP / ZWJ / LRM / RLM
		(code >= 0x20d0 && code <= 0x20ff) || // combinantes de símbolos
		(code >= 0xfe00 && code <= 0xfe0f) || // seletores de variação
		(code >= 0xfe20 && code <= 0xfe2f) // meios sinais combinantes
	);
}

/** Faixas Unicode de largura dupla (CJK, fullwidth, emoji...). */
function isWide(code: number): boolean {
	return (
		(code >= 0x1100 && code <= 0x115f) || // jamo hangul
		(code >= 0x2e80 && code <= 0x303e) || // radicais CJK / símbolos
		(code >= 0x3041 && code <= 0x33ff) || // hiragana..compatibilidade CJK
		(code >= 0x3400 && code <= 0x4dbf) || // extensão A do CJK
		(code >= 0x4e00 && code <= 0x9fff) || // CJK unificado
		(code >= 0xa000 && code <= 0xa4cf) || // yi
		(code >= 0xac00 && code <= 0xd7a3) || // sílabas hangul
		(code >= 0xf900 && code <= 0xfaff) || // ideogramas CJK de compatibilidade
		(code >= 0xfe30 && code <= 0xfe4f) || // formas CJK de compatibilidade
		(code >= 0xff00 && code <= 0xff60) || // formas de largura total
		(code >= 0xffe0 && code <= 0xffe6) || // sinais de largura total
		(code >= 0x1f300 && code <= 0x1faff) || // emoji
		(code >= 0x20000 && code <= 0x2fffd) || // extensões B-F do CJK
		(code >= 0x30000 && code <= 0x3fffd) // extensão G do CJK
	);
}
