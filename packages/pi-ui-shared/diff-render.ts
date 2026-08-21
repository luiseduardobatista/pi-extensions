import type { DiffLine } from "./diff-lib.ts";
import { WORD_SIMILARITY_FLOOR, wordDiffRanges } from "./diff-lib.ts";
import {
	DIFF_BG_ADD,
	DIFF_BG_ADD_GUTTER,
	DIFF_BG_ADD_WORD,
	DIFF_BG_DEL,
	DIFF_BG_DEL_GUTTER,
	DIFF_BG_DEL_WORD,
	hexToBgAnsi,
} from "./diff-palette.ts";

export interface DiffBgSet {
	base: string;
	gutter: string;
	word: string;
}

export const ADD_BG: DiffBgSet = {
	base: DIFF_BG_ADD,
	gutter: DIFF_BG_ADD_GUTTER,
	word: DIFF_BG_ADD_WORD,
};

export const DEL_BG: DiffBgSet = {
	base: DIFF_BG_DEL,
	gutter: DIFF_BG_DEL_GUTTER,
	word: DIFF_BG_DEL_WORD,
};

export function diffBgFor(kind: DiffLine["kind"]): DiffBgSet | null {
	switch (kind) {
		case "add":
			return ADD_BG;
		case "del":
			return DEL_BG;
		default:
			return null;
	}
}

/**
 * Número exibido da linha: antigo para del/ctx, novo para add.
 * Gap não tem número → null.
 */
export function diffLineNumber(line: DiffLine): number | null {
	switch (line.kind) {
		case "add":
			return line.newNum;
		case "del":
		case "ctx":
			return line.oldNum;
		case "gap":
			return null;
	}
}

export function diffNumberWidth(lines: DiffLine[]): number {
	let width = 1;
	for (const line of lines) {
		const num = diffLineNumber(line);
		if (num !== null) width = Math.max(width, String(num).length);
	}
	return width;
}

export function formatDiffGutter(
	line: DiffLine,
	numberWidth: number,
): { bar: string; number: string; sign: string } {
	const num = diffLineNumber(line);
	const bar = line.kind === "ctx" || line.kind === "gap" ? " " : "▌";
	const number = num === null ? " ".repeat(numberWidth) : String(num).padStart(numberWidth, " ");
	const sign = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
	return { bar, number, sign };
}

/**
 * Separador de hunk: contagem real de linhas omitidas quando derivável.
 * Texto atenuado é responsabilidade do renderer.
 */
export function formatGapSeparator(skipped: number | null): string {
	return skipped === null ? "··· unmodified lines ···" : `··· ${skipped} unmodified lines ···`;
}

/**
 * Reaplica o fundo `bg` (hex) numa linha ANSI fg-only: injeta o código de
 * fundo no início da linha e após cada reset (`\x1b[0m`, `\x1b[39m`,
 * `\x1b[49m` — sozinhos ou combinados). Sequências que apenas mudam o
 * foreground não alteram o fundo e são preservadas intactas.
 */
export function injectBgInAnsiLine(line: string, bg: string): string {
	const bgCode = hexToBgAnsi(bg);
	let out = bgCode;
	let i = 0;
	while (i < line.length) {
		if (line[i] === "\x1b" && line[i + 1] === "[") {
			const end = line.indexOf("m", i + 2);
			if (end === -1) {
				out += line.slice(i);
				break;
			}
			const seq = line.slice(i, end + 1);
			out += seq;
			// SGR sem parâmetros (`\x1b[m` = reset total) ou só com resets
			// (0/39/49) limpa o fundo → o bg precisa ser re-injetado.
			const params = seq.slice(2, -1);
			if (params === "" || params.split(";").every((p) => p === "0" || p === "39" || p === "49")) {
				out += bgCode;
			}
			i = end + 1;
		} else {
			out += line[i];
			i++;
		}
	}
	return out;
}

/**
 * Aplica a ênfase word-level: os caracteres nas faixas [start, end) (índices
 * de caractere visível) recebem a variante mais clara `word` do fundo, sobre
 * uma linha que já tem o fundo base injetado. Sequências ANSI são percorridas
 * sem consumir índice visível. Sem faixas → linha intacta.
 */
export function applyWordBg(line: string, ranges: Array<[number, number]>, base: string, word: string): string {
	if (ranges.length === 0) return line;
	const baseCode = hexToBgAnsi(base);
	const wordCode = hexToBgAnsi(word);
	let out = "";
	let visible = 0;
	let rangeIdx = 0;
	let active = false;
	let i = 0;
	while (i < line.length) {
		if (line[i] === "\x1b") {
			const end = line.indexOf("m", i + 2);
			if (end === -1) {
				out += line.slice(i);
				break;
			}
			out += line.slice(i, end + 1);
			i = end + 1;
			continue;
		}
		while (rangeIdx < ranges.length && visible >= ranges[rangeIdx][1]) rangeIdx++;
		const inRange = rangeIdx < ranges.length && visible >= ranges[rangeIdx][0] && visible < ranges[rangeIdx][1];
		if (inRange !== active) {
			out += inRange ? wordCode : baseCode;
			active = inRange;
		}
		out += line[i];
		visible++;
		i++;
	}
	// Restaura o fundo base no fim da linha (o bg de ênfase não vaza
	// para a próxima linha renderizada).
	if (active) out += baseCode;
	return out;
}

/** Limiar de similaridade do contrato de diff-lib (wordDiffRanges). */
export const WORD_SIMILARITY_THRESHOLD = WORD_SIMILARITY_FLOOR;

export function pairWordRanges(
	delContent: string,
	addContent: string,
): { oldRanges: Array<[number, number]>; newRanges: Array<[number, number]> } | null {
	const result = wordDiffRanges(delContent, addContent);
	if (result === null) return null;
	if (result.similarity < WORD_SIMILARITY_THRESHOLD) return null;
	if (result.oldRanges.length === 0 || result.newRanges.length === 0) return null;
	return { oldRanges: result.oldRanges, newRanges: result.newRanges };
}

/**
 * Mapeia índice da linha → faixas de ênfase, para pares 1:1 (uma remoção
 * seguida imediatamente de uma adição, sem outras do mesmo lado em volta)
 * que satisfazem o contrato. Linhas sem ênfase ficam fora do mapa.
 */
export function wordEmphasisMap(lines: DiffLine[]): Map<number, Array<[number, number]>> {
	const map = new Map<number, Array<[number, number]>>();
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.kind !== "del") continue;
		const next = lines[i + 1];
		if (next === undefined || next.kind !== "add") continue;
		const prevIsDel = i > 0 && lines[i - 1].kind === "del";
		const nextNextIsAdd = i + 2 < lines.length && lines[i + 2].kind === "add";
		if (prevIsDel || nextNextIsAdd) continue;
		const pair = pairWordRanges(line.content, next.content);
		if (pair === null) continue;
		map.set(i, pair.oldRanges);
		map.set(i + 1, pair.newRanges);
	}
	return map;
}

export const MAX_HIGHLIGHT_CHARS = 80_000;

export function canHighlight(lang: string | undefined, lines: DiffLine[]): boolean {
	if (lang === undefined) return false;
	let chars = 0;
	for (const line of lines) {
		if (line.kind === "add" || line.kind === "del") chars += line.content.length;
	}
	return chars <= MAX_HIGHLIGHT_CHARS;
}
