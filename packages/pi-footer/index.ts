/** Footer compacto nativo do pacote pi-footer. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installFooter } from "./footer.ts";

export default function piFooter(pi: ExtensionAPI): void {
	installFooter(pi);
}
