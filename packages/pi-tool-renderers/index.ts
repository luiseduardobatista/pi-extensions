/**
 * Renderers próprios de bash, read, grep, find e ls.
 *
 * A execução, os parâmetros e os metadados continuam vindo das fábricas
 * oficiais; `write` e `edit` são responsabilidade do pacote pi-diff.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerToolRenderers } from "./tools.ts";

export default function piToolRenderers(pi: ExtensionAPI): void {
	registerToolRenderers(pi);
}