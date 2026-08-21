/**
 * Extensão /btw para o Pi.
 *
 * Registra o comando e mantém o contexto lateral coerente com o ciclo de vida
 * da sessão: salva o branch após respostas concluídas e o descarta quando a
 * sessão é compactada ou re-ramificada. Não registra ferramentas nem persiste
 * dados em disco.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBtwCommand, registerInvalidationHooks, registerMessageEndSnapshot } from "./btw.ts";

export default function btw(pi: ExtensionAPI): void {
	registerBtwCommand(pi);
	registerMessageEndSnapshot(pi);
	registerInvalidationHooks(pi);
}
