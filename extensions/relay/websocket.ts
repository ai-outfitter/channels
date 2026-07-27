import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";
import { RELAY_MAX_FRAME_BYTES } from "./protocol.ts";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function websocketAccept(key: string): string {
	return createHash("sha1").update(`${key}${WEBSOCKET_GUID}`).digest("base64");
}

export function encodeTextFrame(text: string): Buffer {
	const payload = Buffer.from(text);
	if (payload.length > RELAY_MAX_FRAME_BYTES) throw new Error("frame is too large");
	if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
	return Buffer.concat([
		Buffer.from([0x81, 126, (payload.length >> 8) & 0xff, payload.length & 0xff]),
		payload,
	]);
}

export class ServerWebSocket {
	readonly #socket: Duplex;
	readonly #onText: (text: string) => void;
	readonly #onClose: () => void;
	#buffer = Buffer.alloc(0);
	#closed = false;

	constructor(socket: Duplex, head: Buffer, onText: (text: string) => void, onClose: () => void) {
		this.#socket = socket;
		this.#onText = onText;
		this.#onClose = onClose;
		socket.on("data", (chunk: Buffer) => this.#consume(chunk));
		socket.on("close", () => this.#finish());
		socket.on("error", () => this.#finish());
		if (head.length > 0) this.#consume(head);
	}

	send(value: unknown): void {
		if (!this.#closed) this.#socket.write(encodeTextFrame(JSON.stringify(value)));
	}

	close(code = 1000): void {
		if (this.#closed) return;
		const payload = Buffer.alloc(2);
		payload.writeUInt16BE(code);
		this.#socket.write(Buffer.concat([Buffer.from([0x88, 2]), payload]));
		this.#socket.end();
		this.#finish();
	}

	#consume(chunk: Buffer): void {
		this.#buffer = Buffer.concat([this.#buffer, chunk]);
		try {
			while (this.#parseOne()) {
				// Parse every complete frame already buffered.
			}
		} catch {
			this.close(1002);
		}
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the RFC frame parser is kept atomic for bounds checks
	#parseOne(): boolean {
		if (this.#buffer.length < 2) return false;
		const first = this.#buffer[0];
		const second = this.#buffer[1];
		if (first === undefined || second === undefined) return false;
		if ((first & 0x80) === 0) throw new Error("fragmented frames are unsupported");
		const opcode = first & 0x0f;
		if ((second & 0x80) === 0) throw new Error("client frames must be masked");
		let length = second & 0x7f;
		let offset = 2;
		if (length === 126) {
			if (this.#buffer.length < 4) return false;
			length = this.#buffer.readUInt16BE(2);
			offset = 4;
		} else if (length === 127) {
			throw new Error("frame is too large");
		}
		if (length > RELAY_MAX_FRAME_BYTES) throw new Error("frame is too large");
		if (this.#buffer.length < offset + 4 + length) return false;
		const mask = this.#buffer.subarray(offset, offset + 4);
		offset += 4;
		const payload = Buffer.from(this.#buffer.subarray(offset, offset + length));
		this.#buffer = this.#buffer.subarray(offset + length);
		for (let index = 0; index < payload.length; index += 1) {
			const maskByte = mask[index % 4];
			if (maskByte !== undefined) payload[index] = (payload[index] ?? 0) ^ maskByte;
		}
		if (opcode === 0x8) {
			this.close();
		} else if (opcode === 0x9) {
			this.#socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
		} else if (opcode === 0x1) {
			this.#onText(payload.toString("utf8"));
		} else {
			throw new Error("unsupported websocket opcode");
		}
		return true;
	}

	#finish(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#onClose();
	}
}
