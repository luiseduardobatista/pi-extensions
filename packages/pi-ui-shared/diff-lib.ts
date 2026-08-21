/**
 * Módulo puro de diff do ui-shared: parsing do diff oficial do Pi
 * (EditToolDetails.diff) e análise word-level. O único módulo externo é o
 * pacote `diff`, declarado como dependência; mesmo que a aquisição falhe,
 * `wordDiffRanges` retorna null e o renderer omite a ênfase.
 */
import { LRUCache } from "./lru.ts";

export type DiffLineKind = "add" | "del" | "ctx" | "gap";

export interface DiffLine {
	kind: DiffLineKind;
	oldNum: number | null;
	newNum: number | null;
	content: string;
	skipped: number | null;
}

/**
 * Converte o diff oficial do Pi em linhas tipadas: `+<num>` → add,
 * `-<num>` → del, ` <num>` → ctx, linha de espaços + `...` → gap.
 *
 * Para cada gap, `skipped` é derivado dos vizinhos numerados; regras
 * completas do formato (padding, quebra no primeiro espaço, derivação
 * de `skipped`) ficam no pipeline do pi-diff.
 */
export function parseDiffLines(diff: string): DiffLine[] {
	const parsed: DiffLine[] = [];

	for (const rawLine of diff.split("\n")) {
		// Linha vazia: artefato da quebra final (ou entrada vazia) — ignora.
		if (rawLine === "") continue;

		const prefix = rawLine[0];
		if (prefix !== "+" && prefix !== "-" && prefix !== " ") continue;

		const rest = rawLine.slice(1);

		// Marcador de contexto omitido: espaços seguidos de "..."
		if (prefix === " " && /^ *\.\.\.$/.test(rest)) {
			parsed.push({ kind: "gap", oldNum: null, newNum: null, content: "...", skipped: null });
			continue;
		}

		// Número da linha: espaços de preenchimento opcionais + dígitos.
		// Conteúdo: tudo após o primeiro espaço que segue o número
		// (o conteúdo em si pode começar com espaços).
		const match = /^([ ]*)(\d+)(.*)$/.exec(rest);
		if (!match) continue;
		const num = parseInt(match[2], 10);
		const content = match[3].startsWith(" ") ? match[3].slice(1) : match[3];

		if (prefix === "+") {
			parsed.push({ kind: "add", oldNum: null, newNum: num, content, skipped: null });
		} else if (prefix === "-") {
			parsed.push({ kind: "del", oldNum: num, newNum: null, content, skipped: null });
		} else {
			parsed.push({ kind: "ctx", oldNum: num, newNum: num, content, skipped: null });
		}
	}

	for (let i = 0; i < parsed.length; i++) {
		if (parsed[i].kind === "gap") {
			parsed[i].skipped = computeGapSkipped(parsed, i);
		}
	}

	return parsed;
}

function computeGapSkipped(lines: DiffLine[], gapIndex: number): number | null {
	// Próxima linha mostrada após o marcador (pula marcadores consecutivos).
	let next: DiffLine | undefined;
	for (let i = gapIndex + 1; i < lines.length; i++) {
		if (lines[i].kind !== "gap") {
			next = lines[i];
			break;
		}
	}

	// Última linha mostrada antes do marcador (mesma regra).
	let prev: DiffLine | undefined;
	for (let i = gapIndex - 1; i >= 0; i--) {
		if (lines[i].kind !== "gap") {
			prev = lines[i];
			break;
		}
	}

	// Marcador no início ou no fim do diff — sem vizinho numerado.
	if (!prev || !next) return null;

	// Lado preferido: o do kind da próxima linha (oldNum para del/ctx,
	// newNum para add) — o mesmo lado vale para a linha anterior. Se algum
	// vizinho não tiver número nesse lado, tenta o outro (ctx tem os dois;
	// add tem newNum; del tem oldNum).
	const sides: Array<[number | null, number | null]> =
		next.kind === "add"
			? [[next.newNum, prev.newNum], [next.oldNum, prev.oldNum]]
			: [[next.oldNum, prev.oldNum], [next.newNum, prev.newNum]];
	for (const [nextNum, prevNum] of sides) {
		if (nextNum === null || prevNum === null) continue;
		const skipped = nextNum - prevNum - 1;
		// Numeração inconsistente (próximo <= anterior) não deriva contagem.
		if (skipped >= 0) return skipped;
	}
	return null;
}

interface WordChange {
	value: string;
	added?: boolean;
	removed?: boolean;
	count?: number;
}

type DiffWordsFn = (oldStr: string, newStr: string, options?: Record<string, unknown>) => WordChange[];

/**
 * Adquire `diffWords` do pacote `diff` de forma defensiva. O pacote está
 * declarado como dependência do ui-shared; a aquisição é defensiva para o
 * caso de resolução falhar (wordDiffRanges retorna null e o renderer omite
 * a ênfase word-level em vez de quebrar).
 */
let diffWordsImpl: DiffWordsFn | null = null;
try {
	const nodeRequire: unknown =
		typeof require === "function"
			? require
			: process.getBuiltinModule?.("module")?.createRequire?.(import.meta.url);
	if (typeof nodeRequire === "function") {
		const diffModule = (nodeRequire as (id: string) => unknown)("diff") as { diffWords?: DiffWordsFn };
		diffWordsImpl = diffModule.diffWords ?? null;
	}
} catch {
	diffWordsImpl = null;
}

export const WORD_SIMILARITY_FLOOR = 0.15;

/** Resultado da comparação word-level entre os dois lados de um par. */
export interface WordDiffResult {
	/** Fração de caracteres comuns sobre max(a.length, b.length). */
	similarity: number;
	/** Intervalos [start, end) de caracteres alterados no lado antigo. */
	oldRanges: Array<[number, number]>;
	/** Intervalos [start, end) de caracteres alterados no lado novo. */
	newRanges: Array<[number, number]>;
}

/**
 * Cache LRU de resultados por par (chave `a\0b`). O custo de diffWords é
 * O(n²); o mesmo par é recomparado a cada reconstrução do DiffBody.
 */
const WORD_DIFF_CACHE = new LRUCache<string, WordDiffResult>(192);

/**
 * Conta adições/remoções das linhas tipadas (linha de detalhe do edit
 * "  (+N -M)"). Equivale a contar as linhas `+`/`-` do diff oficial, cujo
 * formato sempre tem número de linha (generateDiffString) — por isso toda
 * add/del é capturada pelo parse.
 */
export function countDiffChanges(lines: DiffLine[]): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of lines) {
		if (line.kind === "add") added++;
		else if (line.kind === "del") removed++;
	}
	return { added, removed };
}

/**
 * Faixas de ênfase word-level entre `a` e `b` (diffWords). Contrato com o
 * renderer em docs/diff.md: similarity >= 0.15 E faixas nos dois lados.
 * Strings idênticas → similarity 1, sem faixas. Null sem o pacote `diff`.
 */
export function wordDiffRanges(a: string, b: string): WordDiffResult | null {
	if (diffWordsImpl === null) return null;
	if (a === b) return { similarity: 1, oldRanges: [], newRanges: [] };

	// Pré-filtro barato: abaixo do piso de tamanho a similaridade nunca
	// alcança o limiar do renderer (≥ 0.15 com faixas nos dois lados) —
	// evita o diffWords O(n²) em pares descartáveis.
	const minLen = Math.min(a.length, b.length);
	const maxLen = Math.max(a.length, b.length);
	if (minLen / maxLen < WORD_SIMILARITY_FLOOR) {
		return { similarity: minLen / maxLen, oldRanges: [], newRanges: [] };
	}

	const key = `${a}\0${b}`;
	const cached = WORD_DIFF_CACHE.get(key);
	if (cached !== undefined) return cached;

	const changes = diffWordsImpl(a, b);
	let oldPos = 0;
	let newPos = 0;
	let commonChars = 0;
	const oldRanges: Array<[number, number]> = [];
	const newRanges: Array<[number, number]> = [];

	for (const change of changes) {
		const length = change.value.length;
		if (change.removed) {
			oldRanges.push([oldPos, oldPos + length]);
			oldPos += length;
		} else if (change.added) {
			newRanges.push([newPos, newPos + length]);
			newPos += length;
		} else {
			commonChars += length;
			oldPos += length;
			newPos += length;
		}
	}

	const result: WordDiffResult = {
		similarity: commonChars / maxLen,
		oldRanges,
		newRanges,
	};
	WORD_DIFF_CACHE.set(key, result);
	return result;
}
