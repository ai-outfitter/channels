import { chmod } from "node:fs/promises";

const commands = ["outfitter-channel-send.js", "outfitter-channel-reconcile.js"];

await Promise.all(
	commands.map((command) => chmod(new URL(`../dist/bin/${command}`, import.meta.url), 0o755)),
);
