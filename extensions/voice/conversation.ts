import { createHash } from "node:crypto";
import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export type VoiceState = "queued" | "running" | "completed" | "failed" | "uncertain";
export type VoiceEvent =
	| { seq: number; type: "assistant-text"; text: string }
	| { seq: number; type: "status" | "terminal"; state: string };
export interface VoiceScope {
	callId: string;
	organizationId: string;
	userId: string;
}
type Owner = VoiceScope & { principal: string };
interface Turn {
	owner: Owner;
	turnId: string;
	text: string;
	state: VoiceState;
	events: VoiceEvent[];
}
interface Lease {
	owner: Owner;
	expiresAt: number;
	released: boolean;
}
type RecordEntry =
	| { kind: "lease"; lease: Lease | null }
	| { kind: "turn"; turn: Turn }
	| { kind: "event"; turnId: string; event: VoiceEvent; state: VoiceState };
export class VoiceError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}
export interface VoiceJournal {
	read(): RecordEntry[];
	append(record: RecordEntry): void;
}
/** Dedicated durable journal: Pi may buffer appendEntry until the first assistant message. */
export class FileVoiceJournal implements VoiceJournal {
	private readonly path: string;
	private readonly audit: (record: RecordEntry) => void;
	constructor(path: string, audit: (record: RecordEntry) => void) {
		this.path = path;
		this.audit = audit;
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	}
	read(): RecordEntry[] {
		if (!existsSync(this.path)) return [];
		if (statSync(this.path).size > 64 * 1024 * 1024)
			throw new Error("voice journal capacity reached");
		// A torn record fails closed instead of discarding an accepted receipt.
		return readFileSync(this.path, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as RecordEntry);
	}
	append(record: RecordEntry): void {
		const content = `${JSON.stringify(record)}\n`;
		if (
			(existsSync(this.path) ? statSync(this.path).size : 0) + Buffer.byteLength(content) >
			64 * 1024 * 1024
		)
			throw new Error("voice journal capacity reached");
		const fd = openSync(this.path, "a", 0o600);
		try {
			writeFileSync(fd, content);
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		// Side journal is authoritative even if the session audit append fails.
		if (record.kind !== "event" || record.event.type !== "assistant-text") {
			try {
				this.audit(record);
			} catch {
				console.error(JSON.stringify({ event: "voice_session_audit_failed" }));
			}
		}
	}
}
export interface MainPiHost {
	idle(): boolean;
	send(text: string): void;
}
const sameOwner = (a: Owner, b: Owner): boolean =>
	a.principal === b.principal &&
	a.callId === b.callId &&
	a.organizationId === b.organizationId &&
	a.userId === b.userId;
const terminal = (state: VoiceState): boolean =>
	state === "completed" || state === "failed" || state === "uncertain";
const identifier = (value: unknown): value is string =>
	typeof value === "string" &&
	value.length > 0 &&
	value.length <= 128 &&
	Array.from(value).every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127);

/** One exclusive caller lease over the resident's existing main Pi session. Never aborts Pi. */
export class MainPiConversation {
	private lease: Lease | null = null;
	private readonly turns = new Map<string, Turn>();
	private readonly queue: Turn[] = [];
	private active: Turn | undefined;
	private correlated = false;
	private sawUser = false;
	private runFailed = false;
	private sawEnd = false;
	private sawAssistant = false;
	private pendingText = "";
	private outputBytes = 0;
	private flushTimer: ReturnType<typeof setTimeout> | undefined;
	private dispatchTimer: ReturnType<typeof setTimeout> | undefined;
	private quarantined = false;
	private closed = false;
	private faulted = false;
	private readonly journal: VoiceJournal;
	private readonly host: MainPiHost;
	private readonly principals: readonly string[];
	private readonly now: () => number;
	constructor(
		journal: VoiceJournal,
		host: MainPiHost,
		principals: readonly string[],
		now: () => number = Date.now,
	) {
		this.journal = journal;
		this.host = host;
		this.principals = principals;
		this.now = now;
		for (const record of journal.read()) {
			if (record.kind === "lease") this.lease = record.lease;
			else if (record.kind === "turn") this.turns.set(record.turn.turnId, record.turn);
			else if (record.kind === "event") {
				const turn = this.turns.get(record.turnId);
				if (!turn || record.event.seq !== turn.events.length + 1)
					throw new Error("invalid voice journal sequence");
				turn.events.push(record.event);
				turn.state = record.state;
			} else throw new Error("invalid voice journal");
		}
		for (const turn of this.turns.values())
			if (!terminal(turn.state)) this.finish(turn, "uncertain");
		// A recovered lease remains scoped until expiry/release; no unfinished work is replayed.
	}
	private persist(record: RecordEntry): void {
		try {
			this.journal.append(structuredClone(record));
		} catch (error) {
			this.faulted = true;
			throw error;
		}
	}
	private owner(principal: string, body: Record<string, unknown>): Owner {
		if (this.closed || this.faulted) throw new VoiceError(503, "conversation unavailable");
		if (!this.principals.includes(principal))
			throw new VoiceError(403, "principal cannot access main conversation");
		if (![body.callId, body.organizationId, body.userId].every(identifier))
			throw new VoiceError(400, "invalid caller scope");
		return {
			principal,
			callId: body.callId as string,
			organizationId: body.organizationId as string,
			userId: body.userId as string,
		};
	}
	private busy(): boolean {
		return Boolean(this.active || this.queue.length);
	}
	private expire(): void {
		if (this.lease && !this.busy() && (this.lease.released || this.lease.expiresAt <= this.now())) {
			this.persist({ kind: "lease", lease: null });
			this.lease = null;
		}
	}
	private authorizeLease(owner: Owner): void {
		this.expire();
		if (
			!this.lease ||
			!sameOwner(this.lease.owner, owner) ||
			this.lease.released ||
			this.lease.expiresAt <= this.now()
		)
			throw new VoiceError(409, "caller does not hold active lease");
	}
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: explicit authenticated route boundary
	handle(path: string, principal: string, body: Record<string, unknown>): unknown {
		const owner = this.owner(principal, body);
		if (path === "/voice/lease") {
			if (this.quarantined)
				throw new VoiceError(503, "dispatch uncertain; conversation quarantined");
			this.expire();
			const expiresAt = typeof body.expiresAt === "number" ? body.expiresAt : Number.NaN;
			if (
				!Number.isFinite(expiresAt) ||
				expiresAt <= this.now() ||
				expiresAt > this.now() + 16 * 60 * 1000
			)
				throw new VoiceError(400, "expiresAt must be within sixteen minutes");
			if ((this.lease && !sameOwner(this.lease.owner, owner)) || (!this.lease && !this.host.idle()))
				throw new VoiceError(409, "main session busy");
			this.persist({ kind: "lease", lease: { owner, expiresAt, released: false } });
			this.lease = { owner, expiresAt, released: false };
			return { leased: true };
		}
		if (path === "/voice/lease/release") {
			if (!this.lease || !sameOwner(this.lease.owner, owner))
				throw new VoiceError(409, "caller does not hold lease");
			this.persist({ kind: "lease", lease: { ...this.lease, released: true } });
			this.lease.released = true;
			this.expire();
			return { released: true };
		}
		if (!identifier(body.turnId)) throw new VoiceError(400, "invalid turnId");
		const prior = this.turns.get(body.turnId);
		if (prior && !sameOwner(prior.owner, owner)) throw new VoiceError(404, "turn not found");
		if (path === "/voice/turns/poll") {
			if (!prior) throw new VoiceError(404, "turn not found");
			if (
				!Number.isSafeInteger(body.afterSeq) ||
				(body.afterSeq as number) < 0 ||
				(body.afterSeq as number) > prior.events.length
			)
				throw new VoiceError(400, "invalid cursor");
			const events: VoiceEvent[] = [];
			for (const event of prior.events.slice(body.afterSeq as number)) {
				if (
					events.length === 32 ||
					Buffer.byteLength(JSON.stringify({ turnId: prior.turnId, events: [...events, event] })) >
						16000
				)
					break;
				events.push(event);
			}
			return { turnId: prior.turnId, events };
		}
		if (path !== "/voice/turns") throw new VoiceError(404, "route not found");
		if (
			typeof body.text !== "string" ||
			!body.text.trim() ||
			body.text.length > 8000 ||
			Buffer.byteLength(body.text) > 16000
		)
			throw new VoiceError(400, "invalid text");
		if (prior) {
			if (prior.text !== body.text) throw new VoiceError(409, "turnId payload conflict");
			return { turnId: prior.turnId, state: prior.state };
		}
		if (this.quarantined) throw new VoiceError(503, "dispatch uncertain; conversation quarantined");
		this.authorizeLease(owner);
		if (this.queue.length >= 16 || this.turns.size >= 10000)
			throw new VoiceError(429, "conversation capacity reached");
		const turn: Turn = {
			owner,
			turnId: body.turnId,
			text: body.text,
			state: "queued",
			events: [{ seq: 1, type: "status", state: "queued" }],
		};
		this.persist({ kind: "turn", turn });
		this.turns.set(turn.turnId, turn);
		this.queue.push(turn);
		// Receipt is durable before dispatch. HTTP retries observe this same turn.
		queueMicrotask(() => this.pump());
		return { turnId: turn.turnId, state: turn.state };
	}
	pump(): void {
		if (this.closed || this.faulted || this.quarantined || this.active || !this.host.idle()) return;
		const turn = this.queue.shift();
		if (!turn) {
			this.expire();
			return;
		}
		if (this.dispatchTimer) clearTimeout(this.dispatchTimer);
		this.active = turn;
		this.correlated = false;
		this.sawUser = false;
		this.runFailed = false;
		this.sawEnd = false;
		this.sawAssistant = false;
		this.pendingText = "";
		this.outputBytes = 0;
		try {
			turn.state = "running";
			this.event(turn, { type: "status", state: "running" });
			this.host.send(turn.text);
			this.dispatchTimer = setTimeout(() => {
				try {
					if (this.active === turn) this.checkDispatch();
				} catch {
					this.faulted = true;
				}
			}, 10000);
			this.dispatchTimer.unref();
		} catch {
			if (!this.faulted) this.finish(turn, "uncertain");
			this.active = undefined;
		}
	}
	/** Fire-and-forget preflight may never start. A late dispatch remains possible, so quarantine. */
	checkDispatch(): void {
		if (!this.active || this.correlated || this.closed || this.faulted) return;
		this.finish(this.active, "uncertain");
		this.active = undefined;
		this.quarantined = true;
	}
	beforeStart(prompt: string): void {
		if (!this.active) return;
		if (prompt !== this.active.text || this.correlated) {
			if (!this.correlated) this.quarantined = true;
			this.finish(this.active, "uncertain");
			this.active = undefined;
			this.correlated = false;
			return;
		}
		this.correlated = true;
		if (this.dispatchTimer) clearTimeout(this.dispatchTimer);
	}
	userMessage(text: string): void {
		if (!this.active) return;
		if (!this.correlated || this.sawUser || text !== this.active.text) {
			if (!this.correlated || !this.sawUser) this.quarantined = true;
			this.flushText();
			if (!this.active) return;
			this.finish(this.active, "uncertain");
			this.active = undefined;
			this.correlated = false;
		} else this.sawUser = true;
	}
	messageRole(role: string): void {
		if (!this.active || !this.correlated || !this.sawUser || this.faulted) return;
		if (role === "assistant") {
			if (this.sawEnd && this.runFailed) {
				this.flushText();
				if (!this.active) return;
				this.event(this.active, { type: "status", state: "retrying" });
				this.sawEnd = false;
				this.runFailed = false;
			}
			this.sawAssistant = true;
		} else if (role !== "toolResult" && this.sawAssistant) {
			this.flushText();
			if (!this.active) return;
			this.finish(this.active, "uncertain");
			this.active = undefined;
			this.correlated = false;
		}
	}
	text(delta: string): void {
		if (!this.active || !this.correlated || !this.sawUser || this.faulted) return;
		if (this.outputBytes + Buffer.byteLength(delta) > 256 * 1024) {
			this.flushText();
			if (!this.active) return;
			this.finish(this.active, "uncertain");
			this.active = undefined;
			this.correlated = false;
			return;
		}
		this.outputBytes += Buffer.byteLength(delta);
		this.pendingText += delta;
		while (this.pendingText.length >= 2048 && this.active) {
			let end = 2048;
			if (/[\uD800-\uDBFF]/.test(this.pendingText[end - 1] ?? "")) end--;
			const chunk = this.pendingText.slice(0, end);
			this.pendingText = this.pendingText.slice(end);
			if (!this.event(this.active, { type: "assistant-text", text: chunk })) return;
		}
		if (this.pendingText && !this.flushTimer) {
			this.flushTimer = setTimeout(() => {
				try {
					this.flushText();
				} catch {
					this.faulted = true;
				}
			}, 250);
			this.flushTimer.unref();
		}
	}
	flushText(): void {
		if (this.flushTimer) clearTimeout(this.flushTimer);
		this.flushTimer = undefined;
		const text = this.pendingText;
		this.pendingText = "";
		if (text && this.active && !this.faulted)
			this.event(this.active, { type: "assistant-text", text });
	}
	status(state: string): void {
		this.flushText();
		if (this.active && this.correlated && this.sawUser && !this.faulted && state)
			this.event(this.active, { type: "status", state: state.slice(0, 128) });
	}
	end(failed: boolean): void {
		this.flushText();
		this.runFailed = failed;
		this.sawEnd = true;
	}
	settled(): void {
		this.flushText();
		if (this.quarantined) return;
		if (this.active && !this.correlated) {
			this.finish(this.active, "uncertain");
			this.active = undefined;
			this.quarantined = true;
			return;
		}
		if (this.active && !this.faulted) {
			this.finish(
				this.active,
				this.correlated && this.sawUser && this.sawEnd
					? this.runFailed
						? "failed"
						: "completed"
					: "uncertain",
			);
			this.active = undefined;
			this.correlated = false;
		}
		// Only agent_settled is terminal: agent_end may be followed by auto-retry/compaction.
		this.expire();
		this.pump();
	}
	close(): void {
		this.closed = true;
		if (this.flushTimer) clearTimeout(this.flushTimer);
		if (this.dispatchTimer)
			clearTimeout(
				this.dispatchTimer,
			); /* Never abort/cancel running or queued Pi work. Recovery reports uncertainty. */
	}
	private event(
		turn: Turn,
		value:
			| Omit<Extract<VoiceEvent, { type: "assistant-text" }>, "seq">
			| Omit<Extract<VoiceEvent, { type: "status" | "terminal" }>, "seq">,
	): boolean {
		if (value.type !== "terminal" && turn.events.length >= 4096) {
			this.finish(turn, "uncertain");
			if (this.active === turn) this.active = undefined;
			this.correlated = false;
			this.pendingText = "";
			return false;
		}
		const event = { ...value, seq: turn.events.length + 1 } as VoiceEvent;
		this.persist({ kind: "event", turnId: turn.turnId, event, state: turn.state });
		turn.events.push(event);
		return true;
	}
	private finish(turn: Turn, state: "completed" | "failed" | "uncertain"): void {
		if (this.active === turn && this.dispatchTimer) {
			clearTimeout(this.dispatchTimer);
			this.dispatchTimer = undefined;
		}
		turn.state = state;
		this.event(turn, { type: "terminal", state });
	}
}
export function voiceJournalName(sessionId: string): string {
	return createHash("sha256").update(sessionId).digest("hex");
}
