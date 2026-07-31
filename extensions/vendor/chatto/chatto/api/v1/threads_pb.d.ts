import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3 } from "@bufbuild/protobuf";
import { Message as Message$1, ThreadSummary } from "./message_types_pb.js";
import { RoomSummary } from "./rooms_pb.js";
import { PageInfo, PageRequest } from "./pagination_pb.js";
import { RoomTimelineIncludes } from "./room_timeline_pb.js";
/**
 * Current follow state for one thread and viewer.
 *
 * @generated from message chatto.api.v1.ThreadFollowState
 */
export declare class ThreadFollowState extends Message<ThreadFollowState> {
    /**
     * Room containing the thread.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Event ID of the root message for the thread.
     *
     * @generated from field: string thread_root_event_id = 2;
     */
    threadRootEventId: string;
    /**
     * True when the current user follows the thread.
     *
     * @generated from field: bool following = 3;
     */
    following: boolean;
    constructor(data?: PartialMessage<ThreadFollowState>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ThreadFollowState";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ThreadFollowState;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ThreadFollowState;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ThreadFollowState;
    static equals(a: ThreadFollowState | PlainMessage<ThreadFollowState> | undefined, b: ThreadFollowState | PlainMessage<ThreadFollowState> | undefined): boolean;
}
/**
 * Request to follow one message thread.
 *
 * @generated from message chatto.api.v1.FollowThreadRequest
 */
export declare class FollowThreadRequest extends Message<FollowThreadRequest> {
    /**
     * Required. Room containing the thread.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Required. Event ID of the root message for the thread.
     *
     * @generated from field: string thread_root_event_id = 2;
     */
    threadRootEventId: string;
    constructor(data?: PartialMessage<FollowThreadRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.FollowThreadRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): FollowThreadRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): FollowThreadRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): FollowThreadRequest;
    static equals(a: FollowThreadRequest | PlainMessage<FollowThreadRequest> | undefined, b: FollowThreadRequest | PlainMessage<FollowThreadRequest> | undefined): boolean;
}
/**
 * Result of following a thread.
 *
 * @generated from message chatto.api.v1.FollowThreadResponse
 */
export declare class FollowThreadResponse extends Message<FollowThreadResponse> {
    /**
     * True when the current user follows the thread after the operation.
     *
     * @generated from field: bool following = 1;
     */
    following: boolean;
    /**
     * Current follow state after the operation.
     *
     * @generated from field: chatto.api.v1.ThreadFollowState state = 2;
     */
    state?: ThreadFollowState;
    constructor(data?: PartialMessage<FollowThreadResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.FollowThreadResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): FollowThreadResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): FollowThreadResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): FollowThreadResponse;
    static equals(a: FollowThreadResponse | PlainMessage<FollowThreadResponse> | undefined, b: FollowThreadResponse | PlainMessage<FollowThreadResponse> | undefined): boolean;
}
/**
 * Request to stop following one message thread.
 *
 * @generated from message chatto.api.v1.UnfollowThreadRequest
 */
export declare class UnfollowThreadRequest extends Message<UnfollowThreadRequest> {
    /**
     * Required. Room containing the thread.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Required. Event ID of the root message for the thread.
     *
     * @generated from field: string thread_root_event_id = 2;
     */
    threadRootEventId: string;
    constructor(data?: PartialMessage<UnfollowThreadRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UnfollowThreadRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UnfollowThreadRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UnfollowThreadRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UnfollowThreadRequest;
    static equals(a: UnfollowThreadRequest | PlainMessage<UnfollowThreadRequest> | undefined, b: UnfollowThreadRequest | PlainMessage<UnfollowThreadRequest> | undefined): boolean;
}
/**
 * Result of unfollowing a thread.
 *
 * @generated from message chatto.api.v1.UnfollowThreadResponse
 */
export declare class UnfollowThreadResponse extends Message<UnfollowThreadResponse> {
    /**
     * True when the current user follows the thread after the operation.
     *
     * @generated from field: bool following = 1;
     */
    following: boolean;
    /**
     * Current follow state after the operation.
     *
     * @generated from field: chatto.api.v1.ThreadFollowState state = 2;
     */
    state?: ThreadFollowState;
    constructor(data?: PartialMessage<UnfollowThreadResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UnfollowThreadResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UnfollowThreadResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UnfollowThreadResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UnfollowThreadResponse;
    static equals(a: UnfollowThreadResponse | PlainMessage<UnfollowThreadResponse> | undefined, b: UnfollowThreadResponse | PlainMessage<UnfollowThreadResponse> | undefined): boolean;
}
/**
 * One followed thread for the current user.
 *
 * @generated from message chatto.api.v1.FollowedThread
 */
export declare class FollowedThread extends Message<FollowedThread> {
    /**
     * Renderable root message, when the root is still visible.
     *
     * @generated from field: chatto.api.v1.Message root_message = 4;
     */
    rootMessage?: Message$1;
    /**
     * Room containing the thread.
     *
     * @generated from field: chatto.api.v1.RoomSummary room = 8;
     */
    room?: RoomSummary;
    /**
     * Aggregated thread state.
     *
     * @generated from field: chatto.api.v1.ThreadSummary thread = 9;
     */
    thread?: ThreadSummary;
    constructor(data?: PartialMessage<FollowedThread>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.FollowedThread";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): FollowedThread;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): FollowedThread;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): FollowedThread;
    static equals(a: FollowedThread | PlainMessage<FollowedThread> | undefined, b: FollowedThread | PlainMessage<FollowedThread> | undefined): boolean;
}
/**
 * Request for a page of followed threads for the current user.
 *
 * @generated from message chatto.api.v1.ListFollowedThreadsRequest
 */
export declare class ListFollowedThreadsRequest extends Message<ListFollowedThreadsRequest> {
    /**
     * Page request. Defaults to 20 results when absent or limit is zero.
     *
     * @generated from field: chatto.api.v1.PageRequest page = 3;
     */
    page?: PageRequest;
    constructor(data?: PartialMessage<ListFollowedThreadsRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListFollowedThreadsRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListFollowedThreadsRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListFollowedThreadsRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListFollowedThreadsRequest;
    static equals(a: ListFollowedThreadsRequest | PlainMessage<ListFollowedThreadsRequest> | undefined, b: ListFollowedThreadsRequest | PlainMessage<ListFollowedThreadsRequest> | undefined): boolean;
}
/**
 * Response containing one followed-thread page.
 *
 * @generated from message chatto.api.v1.ListFollowedThreadsResponse
 */
export declare class ListFollowedThreadsResponse extends Message<ListFollowedThreadsResponse> {
    /**
     * Followed threads in newest-activity-first order.
     *
     * @generated from field: repeated chatto.api.v1.FollowedThread threads = 1;
     */
    threads: FollowedThread[];
    /**
     * Hot-path related entities needed to render this feed page without
     * per-thread hydration.
     *
     * @generated from field: chatto.api.v1.RoomTimelineIncludes includes = 4;
     */
    includes?: RoomTimelineIncludes;
    /**
     * Page metadata.
     *
     * @generated from field: chatto.api.v1.PageInfo page = 5;
     */
    page?: PageInfo;
    constructor(data?: PartialMessage<ListFollowedThreadsResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListFollowedThreadsResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListFollowedThreadsResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListFollowedThreadsResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListFollowedThreadsResponse;
    static equals(a: ListFollowedThreadsResponse | PlainMessage<ListFollowedThreadsResponse> | undefined, b: ListFollowedThreadsResponse | PlainMessage<ListFollowedThreadsResponse> | undefined): boolean;
}
