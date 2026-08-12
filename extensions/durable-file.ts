/**
 * One crash-safe file write for every durable store on the task plane.
 *
 * The sequence is load-bearing: write to a fresh temp file, fsync it, rename
 * over the target, then fsync the containing directory so the rename itself
 * survives a power loss. Each store used to spell this out, and the copies had
 * already drifted apart on whether the directory sync happened — which is
 * exactly the kind of durability gap that only shows up after a hard reboot.
 */
import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";

/** Hold one process lease for a durable store. A live owner is never stolen. */
export async function acquireProcessLease(path: string): Promise<() => Promise<void>> {
	const owner = { host: hostname(), pid: process.pid };
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (await writeFileOnceAtomically(path, Buffer.from(JSON.stringify(owner)))) {
			return async () => {
				const current = await readLease(path);
				if (current?.host === owner.host && current.pid === owner.pid) {
					await unlink(path).catch((error) => {
						if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					});
				}
			};
		}
		await reclaimStaleLease(path, owner);
	}
	throw new Error(`could not acquire task-plane store lease: ${path}`);
}

async function reclaimStaleLease(
	path: string,
	owner: { readonly host: string; readonly pid: number },
): Promise<void> {
	const recoveryPath = `${path}.recovery`;
	if (!(await writeFileOnceAtomically(recoveryPath, Buffer.from(JSON.stringify(owner))))) {
		await new Promise((resolve) => setTimeout(resolve, 10));
		return;
	}
	try {
		const current = await readLease(path);
		if (!current && !(await fileExists(path))) return;
		if (current?.host !== owner.host || (current && processAlive(current.pid))) {
			throw new Error(`task-plane store is already in use: ${path}`);
		}
		await unlink(path).catch((error) => {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		});
	} finally {
		await unlink(recoveryPath).catch(() => {});
	}
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await readFile(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

async function readLease(path: string): Promise<{ host: string; pid: number } | undefined> {
	try {
		const value = JSON.parse(await readFile(path, "utf8")) as { host?: unknown; pid?: unknown };
		return typeof value.host === "string" && Number.isSafeInteger(value.pid)
			? { host: value.host, pid: value.pid as number }
			: undefined;
	} catch {
		return undefined;
	}
}

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** Replace `path` with `contents`, atomically and durably. */
export async function writeFileAtomically(
	path: string,
	contents: string,
	mode = 0o600,
): Promise<void> {
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	const file = await open(temporary, "wx", mode);
	try {
		await file.writeFile(contents, "utf8");
		await file.sync();
	} finally {
		await file.close();
	}
	try {
		await rename(temporary, path);
		const directory = await open(dirname(path), "r");
		try {
			await directory.sync();
		} finally {
			await directory.close();
		}
	} catch (error) {
		await unlink(temporary).catch(() => {});
		throw error;
	}
}

/** Create a content-addressed file atomically. Return false if it already exists. */
export async function writeFileOnceAtomically(
	path: string,
	contents: Uint8Array,
	mode = 0o600,
): Promise<boolean> {
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	const file = await open(temporary, "wx", mode);
	try {
		await file.writeFile(contents);
		await file.sync();
	} finally {
		await file.close();
	}
	try {
		await link(temporary, path);
		await unlink(temporary);
		const directory = await open(dirname(path), "r");
		try {
			await directory.sync();
		} finally {
			await directory.close();
		}
		return true;
	} catch (error) {
		await unlink(temporary).catch(() => {});
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw error;
	}
}
