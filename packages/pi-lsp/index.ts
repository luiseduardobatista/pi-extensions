/**
 * lsp — lazy, agent-driven semantic tool.
 *
 * Invariante central (spec §4): nenhuma atividade LSP acontece sem chamada
 * explícita do agente. Nenhum hook de evento inicia servidor; o único hook é
 * o passivo `session_shutdown`, somente para cleanup dos processos já
 * iniciados por chamadas explícitas.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { loadConfig } from "./config.ts";
import { runOp } from "./ops.ts";
import { shutdownAll } from "./server-manager.ts";

const ACTIONS = [
	"definition",
	"references",
	"implementation",
	"type_definition",
	"hover",
	"symbols",
	"code_actions",
	"apply_code_action",
	"rename",
	"capabilities",
] as const;

const config = loadConfig();

export default function (pi: ExtensionAPI): void {
	pi.registerTool({
		name: "lsp",
		label: "LSP",
		description:
			"Consulta semântica sob demanda via language server (LSP). Resolve o que texto não resolve: a definição REAL de um símbolo quando grep é ambíguo " +
			"(aliases, re-exports, overloads), referências semânticas, implementações de interface, tipo inferido, hover, símbolos do arquivo, code actions e " +
			"rename com conhecimento do projeto. TRIGGERS: (1) grep achou vários candidatos para um símbolo → definition no uso; (2) precisa de TODOS os usos " +
			"de um símbolo → references; (3) tipo/doc de um símbolo → hover; (4) mapear um arquivo sem ler inteiro → symbols; (5) automatizar uma edição " +
			"(imports, quickfix) → code_actions + apply_code_action; (6) renomear símbolo em vários arquivos → rename (preview, depois apply=true). " +
			"Custo: a primeira chamada por linguagem pode instalar (com confirmação) e iniciar o servidor — segundos a minutos; chamadas seguintes reutilizam o " +
			"processo. Posições line/column são 1-based. NÃO use para localizar arquivos/buscar strings (grep/find/read) nem para validar (typecheck/lint/build/test).",
		promptSnippet: "Resolve semantic queries (real definition, references, types, symbols, code actions, rename) via on-demand language server",
		promptGuidelines: [
			"Use lsp() para definition/references quando grep/find deixarem a resolução ambígua (aliases, re-exports, overloads) — a primeira chamada por linguagem inicia o servidor sob demanda (segundos a minutos); chamadas próximas reutilizam o processo.",
			"Use lsp() para hover (tipo/doc), symbols (mapear um arquivo sem lê-lo inteiro), code_actions + apply_code_action (automatizar edições como imports e quickfixes) e rename (preview antes de aplicar).",
			"lsp() retorna somente o que a operação solicitou; diagnostics/progress/logs do servidor nunca aparecem no retorno.",
			"typecheck, lint, build e testes continuam sendo a fonte de verdade para validação; lsp() nunca os substitui.",
		],
		parameters: Type.Object({
			action: StringEnum(ACTIONS, {
				description: "Operação semântica a executar.",
			}),
			file: Type.Optional(
				Type.String({ description: "Arquivo-alvo (obrigatório nas operações posicionais e em symbols; opcional em capabilities)." }),
			),
			line: Type.Optional(
				Type.Number({ description: "Linha 1-based do alvo (obrigatória nas operações posicionais)." }),
			),
			column: Type.Optional(
				Type.Number({ description: "Coluna 1-based do alvo (obrigatória nas operações posicionais)." }),
			),
			new_name: Type.Optional(
				Type.String({ description: "Novo nome para rename." }),
			),
			query: Type.Optional(
				Type.String({ description: "Filtro de exibição para symbols." }),
			),
			apply: Type.Optional(
				Type.Boolean({ description: "rename: true aplica as mudanças; ausente/false retorna preview sem efeito." }),
			),
			id: Type.Optional(
				Type.String({ description: "Identificador da code action escolhida (retornado por code_actions)." }),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const ui = {
				hasUI: ctx.hasUI,
				confirm: (message: string) => ctx.ui.confirm("lsp", message),
			};
			const text = await runOp(
				params as { action: string; file?: string },
				signal ?? undefined,
				config,
				ui,
			);
			return { content: [{ type: "text", text }], details: {} };
		},
	});

	// Hook passivo: limpeza dos processos próprios no fim da sessão (spec §3.3.5).
	// Nunca inicia atividade LSP.
	pi.on("session_shutdown", () => {
		void shutdownAll(config);
	});
}
