export class PayloadTooLarge extends Error {}
export async function readBody(request: Request | Response, maximum = 65_536): Promise<string> {
	const reader = request.body?.getReader();
	if (!reader) return "";
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		size += value.length;
		if (size > maximum) {
			await reader.cancel();
			throw new PayloadTooLarge("Request too large");
		}
		chunks.push(value);
	}
	const output = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	return new TextDecoder().decode(output);
}
