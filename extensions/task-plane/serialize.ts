import { createHash } from "node:crypto";

/**
 * Chain `operation` onto `prior` so durable mutations never interleave. The
 * same handler runs on both settlement paths: a rejected operation must not
 * poison the chain for every operation queued behind it.
 */
export function serialize<T>(prior: Promise<unknown>, operation: () => Promise<T>): Promise<T> {
	return prior.then(operation, operation);
}

export function sha256Hex(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

/** A stable, collision-resistant record id derived from its identifying key. */
export function derivedId(prefix: string, key: string): string {
	return `${prefix}-${sha256Hex(key).slice(0, 40)}`;
}
