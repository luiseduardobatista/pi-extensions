/**
 * Integra perguntas interativas ao Pi.
 *
 * Expõe a tool `questionnaire` para perguntas com opções e respostas livres.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installQuestionnaire } from "./questionnaire.ts";

export default function questionnaire(pi: ExtensionAPI): void {
	installQuestionnaire(pi);
}
