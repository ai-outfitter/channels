import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";

export const OUTFITTER_ARTIFACT_EXTENSION_URI =
	"https://github.com/ai-outfitter/channels/a2a-extensions/outfitter-artifact/v1" as const;
export const OUTFITTER_ARTIFACT_METADATA_KEY = "outfitter-artifact/v1" as const;
export const MAX_LARGE_ARTIFACT_BYTES = 32 * 1024 * 1024;

export interface StoredArtifactReference {
	readonly digest: string;
	readonly byteSize: number;
	readonly mediaType: string;
	readonly url: string;
	readonly filename?: string;
}

export class A2aArtifactStore {
	readonly #rootPath: string;
	readonly #publicUrl: string;

	constructor(rootPath: string, publicUrl: string) {
		if (!rootPath.startsWith("/")) throw new Error("artifact store path must be absolute");
		new URL(publicUrl);
		this.#rootPath = rootPath;
		this.#publicUrl = publicUrl.replace(/\/+$/, "");
	}

	async initialize(): Promise<void> {
		await mkdir(this.#rootPath, { recursive: true, mode: 0o700 });
		await chmod(this.#rootPath, 0o700);
	}

	async put(
		bytes: Uint8Array,
		mediaType: string,
		filename?: string,
	): Promise<StoredArtifactReference> {
		if (bytes.byteLength === 0 || bytes.byteLength > MAX_LARGE_ARTIFACT_BYTES) {
			throw new Error(`artifact must contain 1-${MAX_LARGE_ARTIFACT_BYTES} bytes`);
		}
		if (!/^[-+.a-zA-Z0-9]+\/[-+.a-zA-Z0-9]+$/.test(mediaType)) {
			throw new Error("artifact mediaType is invalid");
		}
		if (filename !== undefined && (filename.length === 0 || filename.length > 255)) {
			throw new Error("artifact filename is invalid");
		}
		const digest = createHash("sha256").update(bytes).digest("hex");
		const path = join(this.#rootPath, digest);
		try {
			const temporary = join(this.#rootPath, `.${digest}.${process.pid}.${randomUUID()}.tmp`);
			const handle = await open(temporary, "wx", 0o600);
			try {
				await handle.writeFile(bytes);
				await handle.sync();
			} finally {
				await handle.close();
			}
			try {
				await rename(temporary, path);
			} catch (error) {
				await unlink(temporary).catch(() => {});
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
		const stored = await readFile(path);
		if (createHash("sha256").update(stored).digest("hex") !== digest) {
			throw new Error("stored artifact digest mismatch");
		}
		return {
			digest: `sha256:${digest}`,
			byteSize: bytes.byteLength,
			mediaType,
			url: `${this.#publicUrl}/artifacts/${digest}`,
			...(filename ? { filename } : {}),
		};
	}

	async get(hexDigest: string): Promise<Buffer> {
		if (!/^[0-9a-f]{64}$/.test(hexDigest)) throw new Error("artifact digest is invalid");
		const bytes = await readFile(join(this.#rootPath, hexDigest));
		if (createHash("sha256").update(bytes).digest("hex") !== hexDigest) {
			throw new Error("stored artifact digest mismatch");
		}
		return bytes;
	}
}
