/**
 * ui-shared — superfície pública do código compartilhado.
 *
 * Não é uma extensão Pi (não registra tool/widget/evento); é só código
 * importável. Os pacotes de UI (`pi-header`, `pi-footer`,
 * `pi-tool-renderers`, `pi-diff`) importam daqui, nunca de arquivos
 * internos.
 *
 * Superfície estável: exports existentes não mudam de assinatura nem saem
 * sem coordenar com os consumidores; novos exports podem ser adicionados
 * livremente.
 */
export {
	visibleWidth,
	truncateToWidth,
	formatUsage,
	formatTps,
	PREVIEW_LINES,
	COMPACT_BASH_MAX_LINES,
	DIFF_COLLAPSED_LINES,
	EXPANDED_MAX_LINES,
	DIFF_WORD_WRAP,
	formatContextPct,
	splitLines,
	countLines,
	previewLines,
	headSlice,
	compactBashOutput,
	bashOutputPresentation,
	splitBashError,
	shortenCommand,
	shortenPathDisplay,
	formatPath,
	prioritizeFooter,
} from "./lib.ts";
export type { BashOutputPresentation, FooterItem } from "./lib.ts";

export {
	parseDiffLines,
	WORD_SIMILARITY_FLOOR,
	countDiffChanges,
	wordDiffRanges,
} from "./diff-lib.ts";
export type { DiffLine, DiffLineKind, WordDiffResult } from "./diff-lib.ts";

export {
	DIFF_BG_ADD,
	DIFF_BG_ADD_GUTTER,
	DIFF_BG_ADD_WORD,
	DIFF_BG_DEL,
	DIFF_BG_DEL_GUTTER,
	DIFF_BG_DEL_WORD,
	hexToBgAnsi,
} from "./diff-palette.ts";

export {
	ADD_BG,
	DEL_BG,
	diffBgFor,
	diffLineNumber,
	diffNumberWidth,
	formatDiffGutter,
	formatGapSeparator,
	injectBgInAnsiLine,
	applyWordBg,
	WORD_SIMILARITY_THRESHOLD,
	pairWordRanges,
	wordEmphasisMap,
	MAX_HIGHLIGHT_CHARS,
	canHighlight,
} from "./diff-render.ts";
export type { DiffBgSet } from "./diff-render.ts";

export { LRUCache } from "./lru.ts";

export { INDENT, displayPath, errorBody, indentLines, promptMeta, resultText, toolTitle } from "./present.ts";
