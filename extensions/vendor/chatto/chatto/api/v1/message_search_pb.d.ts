import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Duration, Message, proto3, Timestamp } from "@bufbuild/protobuf";
import { Message as Message$1 } from "./message_types_pb.js";
/**
 * Ordering for message-search results.
 *
 * @generated from enum chatto.api.v1.MessageSearchOrder
 */
export declare enum MessageSearchOrder {
    /**
     * Use relevance order.
     *
     * @generated from enum value: MESSAGE_SEARCH_ORDER_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * Return the most relevant messages first.
     *
     * @generated from enum value: MESSAGE_SEARCH_ORDER_RELEVANCE = 1;
     */
    RELEVANCE = 1,
    /**
     * Return the most recently created messages first.
     *
     * @generated from enum value: MESSAGE_SEARCH_ORDER_NEWEST = 2;
     */
    NEWEST = 2
}
/**
 * Current availability of message search on this server.
 *
 * @generated from enum chatto.api.v1.MessageSearchState
 */
export declare enum MessageSearchState {
    /**
     * The server did not report a meaningful state.
     *
     * @generated from enum value: MESSAGE_SEARCH_STATE_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * Search is disabled by the server operator.
     *
     * @generated from enum value: MESSAGE_SEARCH_STATE_DISABLED = 1;
     */
    DISABLED = 1,
    /**
     * Search is enabled but its provider has not established index state yet.
     *
     * @generated from enum value: MESSAGE_SEARCH_STATE_STARTING = 2;
     */
    STARTING = 2,
    /**
     * The provider is rebuilding or catching up and cannot answer queries yet.
     *
     * @generated from enum value: MESSAGE_SEARCH_STATE_INDEXING = 3;
     */
    INDEXING = 3,
    /**
     * Search is ready to answer queries.
     *
     * @generated from enum value: MESSAGE_SEARCH_STATE_READY = 4;
     */
    READY = 4,
    /**
     * Search can answer queries but has a known non-fatal limitation.
     *
     * @generated from enum value: MESSAGE_SEARCH_STATE_DEGRADED = 5;
     */
    DEGRADED = 5,
    /**
     * Search is enabled but no provider can currently answer.
     *
     * @generated from enum value: MESSAGE_SEARCH_STATE_UNAVAILABLE = 6;
     */
    UNAVAILABLE = 6
}
/**
 * Request to search current message bodies visible to the authenticated user.
 *
 * @generated from message chatto.api.v1.SearchMessagesRequest
 */
export declare class SearchMessagesRequest extends Message<SearchMessagesRequest> {
    /**
     * Required query text. Words are required terms, quoted text is an exact
     * phrase, and `AND` may separate terms. The query also accepts `in:`,
     * `from:`, `before:`, `after:`, and `has:attachment` filters.
     *
     * @generated from field: string query = 1;
     */
    query: string;
    /**
     * Optional room-ID scope. The server intersects this room with rooms the
     * current user may read and with any `in:` filters in query.
     *
     * @generated from field: optional string room_id = 2;
     */
    roomId?: string;
    /**
     * Optional author-ID scope. The server intersects this author with any
     * `from:` filters in query.
     *
     * @generated from field: optional string author_id = 3;
     */
    authorId?: string;
    /**
     * Exclusive lower bound on message creation time. The stricter bound wins
     * when query also contains `after:`.
     *
     * @generated from field: google.protobuf.Timestamp created_after = 4;
     */
    createdAfter?: Timestamp;
    /**
     * Exclusive upper bound on message creation time. The stricter bound wins
     * when query also contains `before:`.
     *
     * @generated from field: google.protobuf.Timestamp created_before = 5;
     */
    createdBefore?: Timestamp;
    /**
     * When true, return only messages that currently have attachments.
     *
     * @generated from field: bool has_attachments = 6;
     */
    hasAttachments: boolean;
    /**
     * Result ordering. Unspecified defaults to relevance.
     *
     * @generated from field: chatto.api.v1.MessageSearchOrder order = 7;
     */
    order: MessageSearchOrder;
    /**
     * Maximum messages to return. Zero uses the server default of 50; the
     * maximum is 100. Stale or no-longer-visible provider hits are omitted, so a
     * page may contain fewer messages than requested even when next_cursor is
     * present.
     *
     * @generated from field: uint32 page_size = 8;
     */
    pageSize: number;
    /**
     * Opaque cursor returned by the preceding response. It is bound to the
     * authenticated user and every other query field.
     *
     * @generated from field: string cursor = 9;
     */
    cursor: string;
    constructor(data?: PartialMessage<SearchMessagesRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.SearchMessagesRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): SearchMessagesRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): SearchMessagesRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): SearchMessagesRequest;
    static equals(a: SearchMessagesRequest | PlainMessage<SearchMessagesRequest> | undefined, b: SearchMessagesRequest | PlainMessage<SearchMessagesRequest> | undefined): boolean;
}
/**
 * One ordered page of current, authorized messages. Pagination reads a live
 * search index rather than a pinned snapshot, so results may move, repeat, or
 * disappear between page requests while the index advances.
 *
 * @generated from message chatto.api.v1.SearchMessagesResponse
 */
export declare class SearchMessagesResponse extends Message<SearchMessagesResponse> {
    /**
     * Current renderable messages in provider result order. Clients can batch
     * hydrate the referenced room and actor IDs through the existing APIs.
     *
     * @generated from field: repeated chatto.api.v1.Message messages = 1;
     */
    messages: Message$1[];
    /**
     * Opaque cursor for the next provider page. Empty means no more matches.
     *
     * @generated from field: string next_cursor = 2;
     */
    nextCursor: string;
    constructor(data?: PartialMessage<SearchMessagesResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.SearchMessagesResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): SearchMessagesResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): SearchMessagesResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): SearchMessagesResponse;
    static equals(a: SearchMessagesResponse | PlainMessage<SearchMessagesResponse> | undefined, b: SearchMessagesResponse | PlainMessage<SearchMessagesResponse> | undefined): boolean;
}
/**
 * Request for current message-search availability.
 *
 * @generated from message chatto.api.v1.GetStatusRequest
 */
export declare class GetStatusRequest extends Message<GetStatusRequest> {
    constructor(data?: PartialMessage<GetStatusRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetStatusRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetStatusRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetStatusRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetStatusRequest;
    static equals(a: GetStatusRequest | PlainMessage<GetStatusRequest> | undefined, b: GetStatusRequest | PlainMessage<GetStatusRequest> | undefined): boolean;
}
/**
 * Current message-search availability.
 *
 * @generated from message chatto.api.v1.GetStatusResponse
 */
export declare class GetStatusResponse extends Message<GetStatusResponse> {
    /**
     * Current feature/provider state.
     *
     * @generated from field: chatto.api.v1.MessageSearchState state = 1;
     */
    state: MessageSearchState;
    /**
     * Suggested delay before checking again while search is not ready.
     *
     * @generated from field: google.protobuf.Duration retry_after = 4;
     */
    retryAfter?: Duration;
    constructor(data?: PartialMessage<GetStatusResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetStatusResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetStatusResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetStatusResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetStatusResponse;
    static equals(a: GetStatusResponse | PlainMessage<GetStatusResponse> | undefined, b: GetStatusResponse | PlainMessage<GetStatusResponse> | undefined): boolean;
}
