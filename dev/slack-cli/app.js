import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const channelsRoot = fileURLToPath(new URL("../..", import.meta.url));
const child = spawn("npm", ["run", "dev:slack"], {
	cwd: channelsRoot,
	env: process.env,
	stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
	} else {
		process.exit(code ?? 1);
	}
});
