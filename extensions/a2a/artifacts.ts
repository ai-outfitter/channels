import { createHash } from "node:crypto";
import { chmod, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileOnceAtomically } from "../durable-file.ts";

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
		validateArtifact(bytes, mediaType, filename);
		const digest = createHash("sha256").update(bytes).digest("hex");
		const path = join(this.#rootPath, digest);
		// Only bytes another writer put there need verifying; ours were fsynced
		// from the buffer we just hashed.
		if (!(await writeFileOnceAtomically(path, bytes))) {
			const stored = await readFile(path);
			if (createHash("sha256").update(stored).digest("hex") !== digest) {
				throw new Error("stored artifact digest mismatch");
			}
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

function validateArtifact(bytes: Uint8Array, mediaType: string, filename?: string): void {
	if (bytes.byteLength === 0 || bytes.byteLength > MAX_LARGE_ARTIFACT_BYTES) {
		throw new Error(`artifact must contain 1-${MAX_LARGE_ARTIFACT_BYTES} bytes`);
	}
	if (!/^[-+.a-zA-Z0-9]+\/[-+.a-zA-Z0-9]+$/.test(mediaType)) {
		throw new Error("artifact mediaType is invalid");
	}
	if (filename !== undefined && (filename.length === 0 || filename.length > 255)) {
		throw new Error("artifact filename is invalid");
	}
}
