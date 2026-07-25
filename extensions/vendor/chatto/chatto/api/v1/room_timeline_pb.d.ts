import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3, Timestamp } from "@bufbuild/protobuf";
import { User } from "./users_pb.js";
import { Message as Message$1 } from "./message_types_pb.js";
/**
 * Related entities included beside timeline/feed events.
 *
 * Includes are reserved for hot paginated feed paths where many events may
 * repeatedly reference the same render data. Other APIs should return resources
 * directly and rely on BatchGet-style follow-up hydration instead of adding
 * includes maps.
 *
 * @generated from message chatto.api.v1.RoomTimelineIncludes
 */
export declare class RoomTimelineIncludes extends Message<RoomTimelineIncludes> {
    /**
     * Users keyed by user ID.
     *
     * @generated from field: map<string, chatto.api.v1.User> users = 1;
     */
    users: {
        [key: string]: User;
    };
    constructor(data?: PartialMessage<RoomTimelineIncludes>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RoomTimelineIncludes";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RoomTimelineIncludes;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RoomTimelineIncludes;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RoomTimelineIncludes;
    static equals(a: RoomTimelineIncludes | PlainMessage<RoomTimelineIncludes> | undefined, b: RoomTimelineIncludes | PlainMessage<RoomTimelineIncludes> | undefined): boolean;
}
/**
 * Payload for room lifecycle and membership timeline events.
 *
 * @generated from message chatto.api.v1.RoomTimelineRoomEvent
 */
export declare class RoomTimelineRoomEvent extends Message<RoomTimelineRoomEvent> {
    /**
     * Room affected by the event.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    constructor(data?: PartialMessage<RoomTimelineRoomEvent>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RoomTimelineRoomEvent";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RoomTimelineRoomEvent;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RoomTimelineRoomEvent;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RoomTimelineRoomEvent;
    static equals(a: RoomTimelineRoomEvent | PlainMessage<RoomTimelineRoomEvent> | undefined, b: RoomTimelineRoomEvent | PlainMessage<RoomTimelineRoomEvent> | undefined): boolean;
}
/**
 * Payload for a message-posted timeline event.
 *
 * @generated from message chatto.api.v1.RoomMessagePosted
 */
export declare class RoomMessagePosted extends Message<RoomMessagePosted> {
    /**
     * Renderable message created by this timeline event.
     *
     * @generated from field: chatto.api.v1.Message message = 1;
     */
    message?: Message$1;
    constructor(data?: PartialMessage<RoomMessagePosted>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RoomMessagePosted";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RoomMessagePosted;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RoomMessagePosted;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RoomMessagePosted;
    static equals(a: RoomMessagePosted | PlainMessage<RoomMessagePosted> | undefined, b: RoomMessagePosted | PlainMessage<RoomMessagePosted> | undefined): boolean;
}
/**
 * One event in a room or thread timeline.
 *
 * Clients should inspect the event oneof to choose the renderer for the event.
 *
 * @generated from message chatto.api.v1.RoomTimelineEvent
 */
export declare class RoomTimelineEvent extends Message<RoomTimelineEvent> {
    /**
     * Stable event ID.
     *
     * @generated from field: string id = 1;
     */
    id: string;
    /**
     * Time when the event was created.
     *
     * @generated from field: google.protobuf.Timestamp created_at = 2;
     */
    createdAt?: Timestamp;
    /**
     * User ID of the event actor.
     *
     * @generated from field: string actor_id = 3;
     */
    actorId: string;
    /**
     * Concrete event payload.
     *
     * @generated from oneof chatto.api.v1.RoomTimelineEvent.event
     */
    event: {
        /**
         * A message was posted.
         *
         * @generated from field: chatto.api.v1.RoomMessagePosted message_posted = 10;
         */
        value: RoomMessagePosted;
        case: "messagePosted";
    } | {
        /**
         * The room was created.
         *
         * @generated from field: chatto.api.v1.RoomTimelineRoomEvent room_created = 20;
         */
        value: RoomTimelineRoomEvent;
        case: "roomCreated";
    } | {
        /**
         * The room metadata was updated.
         *
         * @generated from field: chatto.api.v1.RoomTimelineRoomEvent room_updated = 21;
         */
        value: RoomTimelineRoomEvent;
        case: "roomUpdated";
    } | {
        /**
         * The room was deleted.
         *
         * @generated from field: chatto.api.v1.RoomTimelineRoomEvent room_deleted = 22;
         */
        value: RoomTimelineRoomEvent;
        case: "roomDeleted";
    } | {
        /**
         * The room was archived.
         *
         * @generated from field: chatto.api.v1.RoomTimelineRoomEvent room_archived = 23;
         */
        value: RoomTimelineRoomEvent;
        case: "roomArchived";
    } | {
        /**
         * The room was unarchived.
         *
         * @generated from field: chatto.api.v1.RoomTimelineRoomEvent room_unarchived = 24;
         */
        value: RoomTimelineRoomEvent;
        case: "roomUnarchived";
    } | {
        /**
         * A user joined the room.
         *
         * @generated from field: chatto.api.v1.RoomTimelineRoomEvent user_joined_room = 30;
         */
        value: RoomTimelineRoomEvent;
        case: "userJoinedRoom";
    } | {
        /**
         * A user left the room.
         *
         * @generated from field: chatto.api.v1.RoomTimelineRoomEvent user_left_room = 31;
         */
        value: RoomTimelineRoomEvent;
        case: "userLeftRoom";
    } | {
        case: undefined;
        value?: undefined;
    };
    constructor(data?: PartialMessage<RoomTimelineEvent>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RoomTimelineEvent";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RoomTimelineEvent;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RoomTimelineEvent;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RoomTimelineEvent;
    static equals(a: RoomTimelineEvent | PlainMessage<RoomTimelineEvent> | undefined, b: RoomTimelineEvent | PlainMessage<RoomTimelineEvent> | undefined): boolean;
}
/**
 * Cursor page of room or thread timeline events.
 *
 * Use opaque start_cursor and end_cursor values with before/after requests to
 * continue paging in either direction. Clients must treat cursor values as
 * server-owned tokens and must not parse, construct, share between users, or
 * reuse them for another room or thread. The server binds each cursor to the
 * authenticated viewer and exact timeline resource. The has_older and
 * has_newer flags tell clients whether another request can extend the current
 * window.
 *
 * @generated from message chatto.api.v1.RoomTimelinePage
 */
export declare class RoomTimelinePage extends Message<RoomTimelinePage> {
    /**
     * Events in display order.
     *
     * @generated from field: repeated chatto.api.v1.RoomTimelineEvent events = 1;
     */
    events: RoomTimelineEvent[];
    /**
     * Opaque cursor for the first event in the page.
     *
     * @generated from field: string start_cursor = 2;
     */
    startCursor: string;
    /**
     * Opaque cursor for the last event in the page.
     *
     * @generated from field: string end_cursor = 3;
     */
    endCursor: string;
    /**
     * True when older events are available before start_cursor.
     *
     * @generated from field: bool has_older = 4;
     */
    hasOlder: boolean;
    /**
     * True when newer events are available after end_cursor.
     *
     * @generated from field: bool has_newer = 5;
     */
    hasNewer: boolean;
    /**
     * Hot-path related entities needed to render the page without per-event hydration.
     *
     * @generated from field: chatto.api.v1.RoomTimelineIncludes includes = 6;
     */
    includes?: RoomTimelineIncludes;
    constructor(data?: PartialMessage<RoomTimelinePage>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RoomTimelinePage";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RoomTimelinePage;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RoomTimelinePage;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RoomTimelinePage;
    static equals(a: RoomTimelinePage | PlainMessage<RoomTimelinePage> | undefined, b: RoomTimelinePage | PlainMessage<RoomTimelinePage> | undefined): boolean;
}
/**
 * Request for a page of room timeline events.
 *
 * Omit the cursor to load the initial page. Set before to a previously returned
 * start_cursor to page toward older events, or after to a previously returned
 * end_cursor to page toward newer events.
 *
 * @generated from message chatto.api.v1.GetRoomEventsRequest
 */
export declare class GetRoomEventsRequest extends Message<GetRoomEventsRequest> {
    /**
     * Required. Room whose timeline should be loaded.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Maximum number of events to return. The server may clamp very large limits.
     *
     * @generated from field: int32 limit = 2;
     */
    limit: number;
    /**
     * Cursor direction for paging.
     *
     * @generated from oneof chatto.api.v1.GetRoomEventsRequest.cursor
     */
    cursor: {
        /**
         * Return events older than this opaque cursor.
         *
         * @generated from field: string before = 3;
         */
        value: string;
        case: "before";
    } | {
        /**
         * Return events newer than this opaque cursor.
         *
         * @generated from field: string after = 4;
         */
        value: string;
        case: "after";
    } | {
        case: undefined;
        value?: undefined;
    };
    constructor(data?: PartialMessage<GetRoomEventsRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetRoomEventsRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetRoomEventsRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetRoomEventsRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetRoomEventsRequest;
    static equals(a: GetRoomEventsRequest | PlainMessage<GetRoomEventsRequest> | undefined, b: GetRoomEventsRequest | PlainMessage<GetRoomEventsRequest> | undefined): boolean;
}
/**
 * Response containing one room timeline page.
 *
 * @generated from message chatto.api.v1.GetRoomEventsResponse
 */
export declare class GetRoomEventsResponse extends Message<GetRoomEventsResponse> {
    /**
     * Loaded timeline page.
     *
     * @generated from field: chatto.api.v1.RoomTimelinePage page = 1;
     */
    page?: RoomTimelinePage;
    constructor(data?: PartialMessage<GetRoomEventsResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetRoomEventsResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetRoomEventsResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetRoomEventsResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetRoomEventsResponse;
    static equals(a: GetRoomEventsResponse | PlainMessage<GetRoomEventsResponse> | undefined, b: GetRoomEventsResponse | PlainMessage<GetRoomEventsResponse> | undefined): boolean;
}
/**
 * Request for room timeline events around a specific event.
 *
 * Use this when a client needs to jump to a known event and render enough
 * context around it.
 *
 * @generated from message chatto.api.v1.GetRoomEventsAroundRequest
 */
export declare class GetRoomEventsAroundRequest extends Message<GetRoomEventsAroundRequest> {
    /**
     * Required. Room whose timeline should be loaded.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Required. Anchor event ID that should appear in the returned page.
     *
     * @generated from field: string event_id = 2;
     */
    eventId: string;
    /**
     * Maximum number of events to return around the anchor.
     *
     * @generated from field: int32 limit = 3;
     */
    limit: number;
    constructor(data?: PartialMessage<GetRoomEventsAroundRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetRoomEventsAroundRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetRoomEventsAroundRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetRoomEventsAroundRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetRoomEventsAroundRequest;
    static equals(a: GetRoomEventsAroundRequest | PlainMessage<GetRoomEventsAroundRequest> | undefined, b: GetRoomEventsAroundRequest | PlainMessage<GetRoomEventsAroundRequest> | undefined): boolean;
}
/**
 * Response containing a room timeline window around a specific event.
 *
 * @generated from message chatto.api.v1.GetRoomEventsAroundResponse
 */
export declare class GetRoomEventsAroundResponse extends Message<GetRoomEventsAroundResponse> {
    /**
     * Loaded timeline page.
     *
     * @generated from field: chatto.api.v1.RoomTimelinePage page = 1;
     */
    page?: RoomTimelinePage;
    /**
     * Zero-based index of the anchor event within page.events.
     *
     * @generated from field: int32 target_index = 2;
     */
    targetIndex: number;
    constructor(data?: PartialMessage<GetRoomEventsAroundResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetRoomEventsAroundResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetRoomEventsAroundResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetRoomEventsAroundResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetRoomEventsAroundResponse;
    static equals(a: GetRoomEventsAroundResponse | PlainMessage<GetRoomEventsAroundResponse> | undefined, b: GetRoomEventsAroundResponse | PlainMessage<GetRoomEventsAroundResponse> | undefined): boolean;
}
/**
 * Request for a page of events in one thread.
 *
 * Omit the cursor to load the latest visible part of the thread, including the
 * root message. Set before to a previously returned start_cursor to page toward
 * older replies, or after to a previously returned end_cursor to page toward
 * newer replies without repeating the root message.
 *
 * @generated from message chatto.api.v1.GetThreadEventsRequest
 */
export declare class GetThreadEventsRequest extends Message<GetThreadEventsRequest> {
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
    /**
     * Maximum number of events to return. The server may clamp very large limits.
     *
     * @generated from field: int32 limit = 3;
     */
    limit: number;
    /**
     * Cursor direction for paging.
     *
     * @generated from oneof chatto.api.v1.GetThreadEventsRequest.cursor
     */
    cursor: {
        /**
         * Return thread events older than this opaque cursor.
         *
         * @generated from field: string before = 4;
         */
        value: string;
        case: "before";
    } | {
        /**
         * Return thread events newer than this opaque cursor.
         *
         * @generated from field: string after = 5;
         */
        value: string;
        case: "after";
    } | {
        case: undefined;
        value?: undefined;
    };
    constructor(data?: PartialMessage<GetThreadEventsRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetThreadEventsRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetThreadEventsRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetThreadEventsRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetThreadEventsRequest;
    static equals(a: GetThreadEventsRequest | PlainMessage<GetThreadEventsRequest> | undefined, b: GetThreadEventsRequest | PlainMessage<GetThreadEventsRequest> | undefined): boolean;
}
/**
 * Response containing one thread timeline page.
 *
 * @generated from message chatto.api.v1.GetThreadEventsResponse
 */
export declare class GetThreadEventsResponse extends Message<GetThreadEventsResponse> {
    /**
     * Loaded timeline page.
     *
     * @generated from field: chatto.api.v1.RoomTimelinePage page = 1;
     */
    page?: RoomTimelinePage;
    constructor(data?: PartialMessage<GetThreadEventsResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetThreadEventsResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetThreadEventsResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetThreadEventsResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetThreadEventsResponse;
    static equals(a: GetThreadEventsResponse | PlainMessage<GetThreadEventsResponse> | undefined, b: GetThreadEventsResponse | PlainMessage<GetThreadEventsResponse> | undefined): boolean;
}
/**
 * Request for thread events around a specific event.
 *
 * Use this when a client needs to jump to a known reply and render surrounding
 * thread context.
 *
 * @generated from message chatto.api.v1.GetThreadEventsAroundRequest
 */
export declare class GetThreadEventsAroundRequest extends Message<GetThreadEventsAroundRequest> {
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
    /**
     * Required. Anchor event ID inside the thread. The event should belong to the
     * requested thread.
     *
     * @generated from field: string event_id = 3;
     */
    eventId: string;
    /**
     * Maximum number of events to return around the anchor.
     *
     * @generated from field: int32 limit = 4;
     */
    limit: number;
    constructor(data?: PartialMessage<GetThreadEventsAroundRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetThreadEventsAroundRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetThreadEventsAroundRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetThreadEventsAroundRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetThreadEventsAroundRequest;
    static equals(a: GetThreadEventsAroundRequest | PlainMessage<GetThreadEventsAroundRequest> | undefined, b: GetThreadEventsAroundRequest | PlainMessage<GetThreadEventsAroundRequest> | undefined): boolean;
}
/**
 * Response containing a thread timeline window around a specific event.
 *
 * @generated from message chatto.api.v1.GetThreadEventsAroundResponse
 */
export declare class GetThreadEventsAroundResponse extends Message<GetThreadEventsAroundResponse> {
    /**
     * Loaded timeline page.
     *
     * @generated from field: chatto.api.v1.RoomTimelinePage page = 1;
     */
    page?: RoomTimelinePage;
    /**
     * Zero-based index of the anchor event within page.events.
     *
     * @generated from field: int32 target_index = 2;
     */
    targetIndex: number;
    constructor(data?: PartialMessage<GetThreadEventsAroundResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetThreadEventsAroundResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetThreadEventsAroundResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetThreadEventsAroundResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetThreadEventsAroundResponse;
    static equals(a: GetThreadEventsAroundResponse | PlainMessage<GetThreadEventsAroundResponse> | undefined, b: GetThreadEventsAroundResponse | PlainMessage<GetThreadEventsAroundResponse> | undefined): boolean;
}
