/**
 * /effort — altera o nível de thinking do modelo atual.
 *
 * Extensão independente; não depende de outras extensões.
 * Descobre os níveis via `getSupportedThinkingLevels` para respeitar as
 * capacidades do modelo atual.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("effort", {
		description: "Change the thinking level of the current model",
		handler: async (_args, ctx) => {
			const model = ctx.model;
			if (!model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			const supportedLevels = getSupportedThinkingLevels(model as any) as string[];
			const currentLevel = pi.getThinkingLevel();

			const options = supportedLevels.map((level) =>
				level === currentLevel ? `${level}  ← current` : level,
			);

			const selected = await ctx.ui.select("Thinking Level:", options);
			if (!selected) return;

			const level = selected.split(/\s+/)[0] as Parameters<typeof pi.setThinkingLevel>[0];
			pi.setThinkingLevel(level);
			ctx.ui.notify(`Thinking level set to: ${pi.getThinkingLevel()}`, "info");
		},
	});
}
