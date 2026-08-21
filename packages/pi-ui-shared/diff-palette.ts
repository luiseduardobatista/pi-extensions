/**
 * Paleta FECHADA de fundos do diff: o Pi não expõe tokens
 * públicos de background para diff. Sem cores literais fora deste módulo —
 * o restante da interface usa tokens do tema. Tabela e derivações em
 * docs/diff.md.
 */

export const DIFF_BG_ADD = "#203b2b";
export const DIFF_BG_ADD_GUTTER = "#16281e";
export const DIFF_BG_ADD_WORD = "#2d5c3a";

export const DIFF_BG_DEL = "#4a231f";
export const DIFF_BG_DEL_GUTTER = "#301c1c";
export const DIFF_BG_DEL_WORD = "#5c2d2d";

export function hexToBgAnsi(hex: string): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `\x1b[48;2;${r};${g};${b}m`;
}
