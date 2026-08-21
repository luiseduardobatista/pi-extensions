import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installHeader } from "./header.ts";

export default function piHeader(pi: ExtensionAPI): void {
	installHeader(pi);
}
