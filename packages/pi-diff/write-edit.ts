/**
 * Renderers de `write` e `edit` da extensão pi-diff.
 *
 * `write` apresenta o conteúdo gravado como linhas adicionadas; `edit` usa o
 * diff oficial (`EditToolDetails.diff`) para as contagens e linhas exibidas.
 * Ambos compartilham o pipeline visual de diff de `pi-ui-shared`. A execução
 * e os metadados permanecem nas fábricas oficiais.
 */
import type { EditToolDetails, ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
	createEditTool,
	createWriteTool,
	getLanguageFromPath,
	highlightCode,
} from "@earendil-works/pi-coding-agent";
import { type Component, Container, Text, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	DIFF_COLLAPSED_LINES,
	DIFF_WORD_WRAP,
	EXPANDED_MAX_LINES,
	INDENT,
	PREVIEW_LINES,
	LRUCache,
	applyWordBg,
	canHighlight,
	countDiffChanges,
	countLines,
	diffBgFor,
	diffNumberWidth,
	displayPath,
	errorBody,
	formatDiffGutter,
	formatGapSeparator,
	hexToBgAnsi,
	injectBgInAnsiLine,
	indentLines,
	parseDiffLines,
	previewLines,
	promptMeta,
	resultText,
	shortenPathDisplay,
	toolTitle,
	wordEmphasisMap,
	type DiffLine,
} from "pi-ui-shared";

/**
 * Cacheia o realce por bloco (`lang\0código`), pois `DiffBody` é reconstruído
 * a cada update ou expansão e o realce pode ser caro em blocos grandes.
 */
const HIGHLIGHT_BLOCK_CACHE = new LRUCache<string, string[]>(192);

/**
 * Realça cada bloco contíguo de linhas adicionadas ou removidas de uma vez,
 * preservando construções multilinha (como comentários) antes de devolver o
 * resultado ao diff individual. Se a linguagem não for reconhecida ou exceder
 * o limite de `canHighlight`, o renderer usa texto plano.
 */
function highlightDiffBlocks(lines: DiffLine[], lang: string): Map<number, string> {
	const map = new Map<number, string>();
	let i = 0;
	while (i < lines.length) {
		const kind = lines[i].kind;
		if (kind !== "add" && kind !== "del") {
			i++;
			continue;
		}
		let j = i;
		const block: string[] = [];
		while (j < lines.length && lines[j].kind === kind) {
			block.push(lines[j].content);
			j++;
		}
		const code = block.join("\n");
		const key = `${lang}\0${code}`;
		let highlighted = HIGHLIGHT_BLOCK_CACHE.get(key);
		if (highlighted === undefined) {
			highlighted = highlightCode(code, lang);
			HIGHLIGHT_BLOCK_CACHE.set(key, highlighted);
		}
		for (let k = 0; k < block.length; k++) {
			map.set(i + k, highlighted[k] ?? block[k]);
		}
		i = j;
	}
	return map;
}

/**
 * Renderiza o diff com gutter, fundo, realce de sintaxe e ênfase word-level.
 * Barra, número e sinal também são textuais para que as alterações não
 * dependam apenas de cor; ao quebrar linhas, o gutter permanece alinhado.
 */
class DiffBody implements Component {
	private readonly numberWidth: number;
	private readonly emphasis: Map<number, Array<[number, number]>>;
	private readonly highlighted: Map<number, string>;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;
	private lines: DiffLine[];
	private readonly theme: Theme;
	private readonly wordWrap: boolean;

	constructor(
		lines: DiffLine[],
		theme: Theme,
		wordWrap: boolean,
		lang: string | undefined,
	) {
		// Expande tabs uma única vez: todas as etapas precisam usar os mesmos
		// índices, e aplicar a expansão novamente quebraria essa correspondência.
		this.lines = lines;
		this.theme = theme;
		this.wordWrap = wordWrap;
		this.lines = lines.map((line) =>
			line.kind === "gap" ? line : { ...line, content: line.content.replace(/\t/g, "   ") },
		);
		this.numberWidth = diffNumberWidth(this.lines);
		this.emphasis = wordEmphasisMap(this.lines);
		const hl = canHighlight(lang, this.lines) ? lang : undefined;
		this.highlighted = hl !== undefined ? highlightDiffBlocks(this.lines, hl) : new Map();
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	render(width: number): string[] {
		if (this.cachedLines !== undefined && this.cachedWidth === width) return this.cachedLines;
		const out: string[] = [];
		const prefixWidth = this.numberWidth + 6;
		const emptyGutter = " ".repeat(prefixWidth);
		for (let i = 0; i < this.lines.length; i++) {
			const line = this.lines[i];
			if (line.kind === "gap") {
				out.push(this.theme.fg("dim", `${INDENT}${formatGapSeparator(line.skipped)}`));
				continue;
			}
			const gutter = formatDiffGutter(line, this.numberWidth);
			const bg = diffBgFor(line.kind);
			let prefix: string;
			let body: string;
			let contPrefix: string;
			if (line.kind === "ctx") {
				prefix = this.theme.fg("dim", `${INDENT}${gutter.bar} ${gutter.number} ${gutter.sign}`);
				body = this.theme.fg("dim", line.content);
				contPrefix = emptyGutter;
			} else {
				const token = line.kind === "add" ? "toolDiffAdded" : "toolDiffRemoved";
				prefix =
					`${hexToBgAnsi(bg!.gutter)}${INDENT}` +
					`${this.theme.fg(token, gutter.bar)} ${this.theme.fg("dim", gutter.number)} ` +
					`${this.theme.fg(token, gutter.sign)}`;
				// O realce fornece apenas foreground; o fundo base é reinjetado para
				// manter a faixa do diff, com word-level na variante mais clara.
				body = this.highlighted.get(i) ?? this.theme.fg(token, line.content);
				body = injectBgInAnsiLine(body, bg!.base);
				const ranges = this.emphasis.get(i);
				if (ranges !== undefined) body = applyWordBg(body, ranges, bg!.base, bg!.word);
				contPrefix = `${hexToBgAnsi(bg!.gutter)}${emptyGutter}${hexToBgAnsi(bg!.base)}`;
			}
			if (!this.wordWrap) {
				out.push(`${prefix}${body}`);
				continue;
			}
			const contentWidth = Math.max(1, width - prefixWidth);
			const wrapped = wrapTextWithAnsi(body, contentWidth);
			for (let k = 0; k < wrapped.length; k++) {
				out.push(k === 0 ? `${prefix}${wrapped[k]}` : `${contPrefix}${wrapped[k]}`);
			}
		}
		this.cachedWidth = width;
		this.cachedLines = out;
		return out;
	}
}

/**
 * `write` não fornece remoções no resultado oficial; o conteúdo é apresentado
 * como adições pelo mesmo pipeline visual de diff usado por `edit`.
 */
export function registerWriteTool(pi: ExtensionAPI, cwd: string, home: string): void {
	const original = createWriteTool(cwd);
	pi.registerTool({
		name: "write",
		label: original.label,
		description: original.description,
		parameters: original.parameters,
		renderShell: "self",
		...promptMeta(original),
		async execute(toolCallId, params, signal, onUpdate) {
			return original.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme) {
			const n = countLines(args.content ?? "");
			const path = shortenPathDisplay(displayPath(args), cwd, home);
			let text = toolTitle(theme, "Added ");
			text += theme.fg("accent", path);
			text += theme.fg("dim", " (");
			text += theme.fg("toolDiffAdded", `+${n}`);
			text += theme.fg("dim", ")");
			return new Text(text, 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme, context) {
			if (context.isError) return new Text(errorBody(theme, resultText(result)), 0, 0);
			if (isPartial) return new Text(theme.fg("warning", `${INDENT}Writing…`), 0, 0);
			const text = resultText(result);
			if (!text.trim().startsWith("Successfully wrote")) {
				return new Text(theme.fg("toolOutput", indentLines(text.trim())), 0, 0);
			}
			const content = context.args?.content ?? "";
			const preview = previewLines(content, expanded ? EXPANDED_MAX_LINES : PREVIEW_LINES);
			const diffLines: DiffLine[] = preview.lines.map((line, i) => ({
				kind: "add",
				oldNum: null,
				newNum: i + 1,
				content: line,
				skipped: null,
			}));
			const lang = getLanguageFromPath(displayPath(context.args));
			const container = new Container();
			container.addChild(new DiffBody(diffLines, theme, DIFF_WORD_WRAP, lang));
			return container;
		},
	});
}

/**
 * Usa o diff oficial como fonte das contagens `(+N -M)` e das linhas
 * renderizadas, sem reconstruir essas informações na apresentação.
 */
export function registerEditTool(pi: ExtensionAPI, cwd: string, home: string): void {
	const original = createEditTool(cwd);
	pi.registerTool({
		name: "edit",
		label: original.label,
		description: original.description,
		parameters: original.parameters,
		renderShell: "self",
		...promptMeta(original),
		async execute(toolCallId, params, signal, onUpdate) {
			return original.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme) {
			return new Text(`${toolTitle(theme, "Edited")} ${theme.fg("accent", shortenPathDisplay(displayPath(args), cwd, home))}`, 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme, context) {
			if (context.isError) return new Text(errorBody(theme, resultText(result)), 0, 0);
			if (isPartial) return new Text(theme.fg("warning", `${INDENT}Editing…`), 0, 0);
			const details = result.details as EditToolDetails | undefined;
			if (!details?.diff) {
				const text = resultText(result);
				if (text.trim()) return new Text(theme.fg("toolOutput", indentLines(text.trim())), 0, 0);
				return new Text(theme.fg("success", `${INDENT}Applied`), 0, 0);
			}
			const diffLines = parseDiffLines(details.diff);
			const { added, removed } = countDiffChanges(diffLines);
			let detail = theme.fg("dim", `${INDENT}(`);
			detail += theme.fg("toolDiffAdded", `+${added}`);
			detail += theme.fg("dim", " ");
			detail += theme.fg("toolDiffRemoved", `-${removed}`);
			detail += theme.fg("dim", ")");
			const shown = diffLines.slice(0, expanded ? EXPANDED_MAX_LINES : DIFF_COLLAPSED_LINES);
			const lang = getLanguageFromPath(displayPath(context.args));
			const container = new Container();
			container.addChild(new Text(detail, 0, 0));
			container.addChild(new DiffBody(shown, theme, DIFF_WORD_WRAP, lang));
			return container;
		},
	});
}