/**
 * Integra a lista de tarefas ao Pi.
 *
 * Expõe a tool `todo` e o widget persistente que resume o estado da lista.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installTodo } from "./todo.ts";

export default function todo(pi: ExtensionAPI): void {
	installTodo(pi);
}
