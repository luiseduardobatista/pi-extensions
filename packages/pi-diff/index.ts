/**
 * Renderers de `write` e `edit` com o pipeline visual de diff compartilhado.
 *
 * A execução continua sendo a oficial do Pi; este pacote substitui apenas a
 * apresentação e mantém a leitura do diff oficial para contagens e linhas.
 */
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerEditTool, registerWriteTool } from "./write-edit.ts";

export default function piDiff(pi: ExtensionAPI): void {
	const cwd = process.cwd();
	const home = homedir();
	registerWriteTool(pi, cwd, home);
	registerEditTool(pi, cwd, home);
}