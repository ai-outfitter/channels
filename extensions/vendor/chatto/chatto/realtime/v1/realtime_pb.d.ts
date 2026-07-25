import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3, Timestamp } from "@bufbuild/protobuf";
import { ServerPublicProfile } from "../../api/v1/server_pb.js";
import { GetViewerResponse } from "../../api/v1/viewer_pb.js";
import { DirectoryMember } from "../../api/v1/member_directory_pb.js";
import { ServerRuntimeConfig } from "../../api/v1/server_state_pb.js";
import { RoomGroup, RoomViewerState, RoomWithViewerState } from "../../api/v1/room_directory_pb.js";
import { PresenceStatus } from "../../api/v1/presence_pb.js";
import { ThreadViewerState } from "../../api/v1/message_types_pb.js";
import { RoomTimelineEvent, RoomTimelineIncludes, RoomTimelinePage } from "../../api/v1/room_timeline_pb.js";
import { ListNotificationsResponse, RoomNotificationCount } from "../../api/v1/notifications_pb.js";
import { ActiveCall } from "../../api/v1/voice_calls_pb.js";
/**
 * Kind of live notification transition.
 *
 * @generated from enum chatto.realtime.v1.RealtimeProjectionNotificationAction
 */
export declare enum RealtimeProjectionNotificationAction {
    /**
     * @generated from enum value: REALTIME_PROJECTION_NOTIFICATION_ACTION_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * @generated from enum value: REALTIME_PROJECTION_NOTIFICATION_ACTION_CREATED = 1;
     */
    CREATED = 1,
    /**
     * @generated from enum value: REALTIME_PROJECTION_NOTIFICATION_ACTION_DISMISSED = 2;
     */
    DISMISSED = 2
}
/**
 * Kind of reaction transition.
 *
 * @generated from enum chatto.realtime.v1.RealtimeProjectionReactionAction
 */
export declare enum RealtimeProjectionReactionAction {
    /**
     * Unknown action.
     *
     * @generated from enum value: REALTIME_PROJECTION_REACTION_ACTION_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * A reaction was added.
     *
     * @generated from enum value: REALTIME_PROJECTION_REACTION_ACTION_ADDED = 1;
     */
    ADDED = 1,
    /**
     * A reaction was removed.
     *
     * @generated from enum value: REALTIME_PROJECTION_REACTION_ACTION_REMOVED = 2;
     */
    REMOVED = 2
}
/**
 * Client-to-server frame for Chatto's protobuf WebSocket realtime protocol.
 *
 * Clients send binary protobuf frames to `/api/realtime`. The first frame must
 * be `hello`; after the server replies with `hello`, clients send
 * `subscribe_events` to start the authenticated server-projection stream.
 *
 * @generated from message chatto.realtime.v1.RealtimeClientFrame
 */
export declare class RealtimeClientFrame extends Message<RealtimeClientFrame> {
    /**
     * @generated from oneof chatto.realtime.v1.RealtimeClientFrame.frame
     */
    frame: {
        /**
         * Opens the protocol session and optionally carries a bearer token.
         *
         * @generated from field: chatto.realtime.v1.RealtimeClientHello hello = 1;
         */
        value: RealtimeClientHello;
        case: "hello";
    } | {
        /**
         * Starts the caller's authorized server-projection stream.
         *
         * @generated from field: chatto.realtime.v1.RealtimeSubscribeEvents subscribe_events = 2;
         */
        value: RealtimeSubscribeEvents;
        case: "subscribeEvents";
    } | {
        /**
         * Application-level ping. The server replies with `pong`.
         *
         * @generated from field: chatto.realtime.v1.RealtimePing ping = 3;
         */
        value: RealtimePing;
        case: "ping";
    } | {
        /**
         * Adds one joined room's recent timeline to the retained projection.
         *
         * @generated from field: chatto.realtime.v1.RealtimeHydrateRoom hydrate_room = 4;
         */
        value: RealtimeHydrateRoom;
        case: "hydrateRoom";
    } | {
        case: undefined;
        value?: undefined;
    };
    constructor(data?: PartialMessage<RealtimeClientFrame>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeClientFrame";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeClientFrame;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeClientFrame;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeClientFrame;
    static equals(a: RealtimeClientFrame | PlainMessage<RealtimeClientFrame> | undefined, b: RealtimeClientFrame | PlainMessage<RealtimeClientFrame> | undefined): boolean;
}
/**
 * Server-to-client frame for Chatto's protobuf WebSocket realtime protocol.
 *
 * @generated from message chatto.realtime.v1.RealtimeServerFrame
 */
export declare class RealtimeServerFrame extends Message<RealtimeServerFrame> {
    /**
     * @generated from oneof chatto.realtime.v1.RealtimeServerFrame.frame
     */
    frame: {
        /**
         * Confirms protocol version, server version, and capabilities.
         *
         * @generated from field: chatto.realtime.v1.RealtimeServerHello hello = 1;
         */
        value: RealtimeServerHello;
        case: "hello";
    } | {
        /**
         * Confirms the server-projection stream has started.
         *
         * @generated from field: chatto.realtime.v1.RealtimeSubscribed subscribed = 2;
         */
        value: RealtimeSubscribed;
        case: "subscribed";
    } | {
        /**
         * An authorized transient, non-replayable event.
         *
         * @generated from field: chatto.realtime.v1.RealtimeEventEnvelope event = 3;
         */
        value: RealtimeEventEnvelope;
        case: "event";
    } | {
        /**
         * Application-level heartbeat used for liveness checks.
         *
         * @generated from field: chatto.realtime.v1.RealtimeHeartbeat heartbeat = 4;
         */
        value: RealtimeHeartbeat;
        case: "heartbeat";
    } | {
        /**
         * Protocol or authorization error.
         *
         * @generated from field: chatto.realtime.v1.RealtimeError error = 5;
         */
        value: RealtimeError;
        case: "error";
    } | {
        /**
         * Server-requested close with reconnect guidance.
         *
         * @generated from field: chatto.realtime.v1.RealtimeClose close = 6;
         */
        value: RealtimeClose;
        case: "close";
    } | {
        /**
         * Reply to a client ping.
         *
         * @generated from field: chatto.realtime.v1.RealtimePong pong = 7;
         */
        value: RealtimePong;
        case: "pong";
    } | {
        /**
         * Confirms that durable replay reached the live-stream boundary.
         *
         * @generated from field: chatto.realtime.v1.RealtimeCaughtUp caught_up = 8;
         */
        value: RealtimeCaughtUp;
        case: "caughtUp";
    } | {
        /**
         * One idempotent mutation of the caller's server projection.
         *
         * @generated from field: chatto.realtime.v1.RealtimeProjectionEvent projection_event = 9;
         */
        value: RealtimeProjectionEvent;
        case: "projectionEvent";
    } | {
        case: undefined;
        value?: undefined;
    };
    constructor(data?: PartialMessage<RealtimeServerFrame>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeServerFrame";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeServerFrame;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeServerFrame;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeServerFrame;
    static equals(a: RealtimeServerFrame | PlainMessage<RealtimeServerFrame> | undefined, b: RealtimeServerFrame | PlainMessage<RealtimeServerFrame> | undefined): boolean;
}
/**
 * Initial client hello.
 *
 * @generated from message chatto.realtime.v1.RealtimeClientHello
 */
export declare class RealtimeClientHello extends Message<RealtimeClientHello> {
    /**
     * Protocol version requested by the client. The only supported version is 2.
     *
     * @generated from field: uint32 protocol_version = 1;
     */
    protocolVersion: number;
    /**
     * Optional bearer token. When present, it takes precedence over cookie auth.
     *
     * @generated from field: optional string bearer_token = 2;
     */
    bearerToken?: string;
    constructor(data?: PartialMessage<RealtimeClientHello>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeClientHello";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeClientHello;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeClientHello;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeClientHello;
    static equals(a: RealtimeClientHello | PlainMessage<RealtimeClientHello> | undefined, b: RealtimeClientHello | PlainMessage<RealtimeClientHello> | undefined): boolean;
}
/**
 * Initial server hello.
 *
 * @generated from message chatto.realtime.v1.RealtimeServerHello
 */
export declare class RealtimeServerHello extends Message<RealtimeServerHello> {
    /**
     * Protocol version accepted by the server.
     *
     * @generated from field: uint32 protocol_version = 1;
     */
    protocolVersion: number;
    /**
     * Chatto server software version.
     *
     * @generated from field: string server_version = 2;
     */
    serverVersion: string;
    /**
     * Approximate heartbeat interval clients should expect.
     *
     * @generated from field: uint32 heartbeat_interval_seconds = 4;
     */
    heartbeatIntervalSeconds: number;
    /**
     * Stable protocol capability keys supported by this server. Current keys:
     * `chatto.realtime.events.live.v1`, `chatto.realtime.heartbeat.v1`,
     * `chatto.realtime.ping.v1`, `chatto.realtime.events.resume.v1`, and
     * `chatto.realtime.projection.v1`.
     *
     * @generated from field: repeated string capabilities = 5;
     */
    capabilities: string[];
    constructor(data?: PartialMessage<RealtimeServerHello>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeServerHello";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeServerHello;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeServerHello;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeServerHello;
    static equals(a: RealtimeServerHello | PlainMessage<RealtimeServerHello> | undefined, b: RealtimeServerHello | PlainMessage<RealtimeServerHello> | undefined): boolean;
}
/**
 * Request to start the caller's authorized server-projection stream.
 *
 * @generated from message chatto.realtime.v1.RealtimeSubscribeEvents
 */
export declare class RealtimeSubscribeEvents extends Message<RealtimeSubscribeEvents> {
    /**
     * Opaque cursor from a previously received durable event or caught-up
     * frame. The server replays authorized durable projection changes after
     * this cursor before continuing with live delivery. Omit it to receive a
     * compacted reset of the current authorised server projection. Cursors
     * expire 24 hours after issue; an expired cursor also receives a compacted
     * reset rather than historical replay.
     *
     * @generated from field: optional string resume_cursor = 1;
     */
    resumeCursor?: string;
    /**
     * Joined rooms whose timeline windows the client already retains. A fresh
     * compacted projection includes only these timelines, and resumed delivery
     * emits timeline mutations only for these rooms. Lightweight room, unread,
     * notification, and call state remains server-wide. At most 64 room IDs
     * may be supplied in one subscription.
     *
     * @generated from field: repeated string retained_room_ids = 2;
     */
    retainedRoomIds: string[];
    constructor(data?: PartialMessage<RealtimeSubscribeEvents>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeSubscribeEvents";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeSubscribeEvents;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeSubscribeEvents;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeSubscribeEvents;
    static equals(a: RealtimeSubscribeEvents | PlainMessage<RealtimeSubscribeEvents> | undefined, b: RealtimeSubscribeEvents | PlainMessage<RealtimeSubscribeEvents> | undefined): boolean;
}
/**
 * Requests lazy materialisation of one joined room's recent timeline.
 *
 * The server replies on the same ordered projection stream with a
 * `room_timeline_replace` operation. Once hydrated, later timeline mutations
 * for the room are included for the lifetime of this connection. Clients send
 * all still-retained room IDs again in their next subscription. A connection
 * may retain at most 64 distinct room IDs; excess requests receive a
 * non-fatal `too_many_retained_rooms` error.
 *
 * @generated from message chatto.realtime.v1.RealtimeHydrateRoom
 */
export declare class RealtimeHydrateRoom extends Message<RealtimeHydrateRoom> {
    /**
     * Joined room to materialise. Repeating a retained room is idempotent.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    constructor(data?: PartialMessage<RealtimeHydrateRoom>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeHydrateRoom";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeHydrateRoom;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeHydrateRoom;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeHydrateRoom;
    static equals(a: RealtimeHydrateRoom | PlainMessage<RealtimeHydrateRoom> | undefined, b: RealtimeHydrateRoom | PlainMessage<RealtimeHydrateRoom> | undefined): boolean;
}
/**
 * Confirms projection streaming has started.
 *
 * @generated from message chatto.realtime.v1.RealtimeSubscribed
 */
export declare class RealtimeSubscribed extends Message<RealtimeSubscribed> {
    /**
     * Opaque cursor from which this subscription starts. When the request
     * supplied a resume cursor, this is that validated cursor. Otherwise it is
     * the current live boundary.
     *
     * @generated from field: optional string start_cursor = 2;
     */
    startCursor?: string;
    constructor(data?: PartialMessage<RealtimeSubscribed>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeSubscribed";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeSubscribed;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeSubscribed;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeSubscribed;
    static equals(a: RealtimeSubscribed | PlainMessage<RealtimeSubscribed> | undefined, b: RealtimeSubscribed | PlainMessage<RealtimeSubscribed> | undefined): boolean;
}
/**
 * Confirms that durable replay is complete and live delivery has begun.
 *
 * Clients can retain `cursor` after applying every preceding event. A cursor
 * must not outlive the projection state it describes. Events after this frame
 * are live. Transient events are never replayed. A cursor is usable for up to
 * 24 hours after issue and should be replaced by each later caught-up cursor.
 *
 * @generated from message chatto.realtime.v1.RealtimeCaughtUp
 */
export declare class RealtimeCaughtUp extends Message<RealtimeCaughtUp> {
    /**
     * Opaque cursor at the replay-to-live handoff boundary.
     *
     * @generated from field: string cursor = 1;
     */
    cursor: string;
    constructor(data?: PartialMessage<RealtimeCaughtUp>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeCaughtUp";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeCaughtUp;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeCaughtUp;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeCaughtUp;
    static equals(a: RealtimeCaughtUp | PlainMessage<RealtimeCaughtUp> | undefined, b: RealtimeCaughtUp | PlainMessage<RealtimeCaughtUp> | undefined): boolean;
}
/**
 * One ordered, idempotent mutation of the caller's authorised server view.
 *
 * A fresh subscription starts with a reset operation followed by current
 * resource upserts. A resumed subscription derives operations from EVT after
 * the supplied cursor. Both paths use this envelope and the same client
 * reducer. The stream is a convergence feed, not an immutable audit log:
 * replay uses current authorisation, deletion, and erasure state.
 *
 * @generated from message chatto.realtime.v1.RealtimeProjectionEvent
 */
export declare class RealtimeProjectionEvent extends Message<RealtimeProjectionEvent> {
    /**
     * Stable event ID. Synthetic compacted-replay events use server-generated IDs.
     *
     * @generated from field: string id = 1;
     */
    id: string;
    /**
     * Time the source fact occurred or the compacted event was generated.
     *
     * @generated from field: google.protobuf.Timestamp created_at = 2;
     */
    createdAt?: Timestamp;
    /**
     * User or system actor that caused the source fact, when known.
     *
     * @generated from field: optional string actor_id = 3;
     */
    actorId?: string;
    /**
     * Opaque cursor safe to retain with the resulting projection state after
     * applying every operation in this event.
     *
     * @generated from field: optional string resume_cursor = 4;
     */
    resumeCursor?: string;
    /**
     * Operations applied atomically and in order by the client reducer.
     *
     * @generated from field: repeated chatto.realtime.v1.RealtimeProjectionOperation operations = 5;
     */
    operations: RealtimeProjectionOperation[];
    constructor(data?: PartialMessage<RealtimeProjectionEvent>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeProjectionEvent";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeProjectionEvent;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeProjectionEvent;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeProjectionEvent;
    static equals(a: RealtimeProjectionEvent | PlainMessage<RealtimeProjectionEvent> | undefined, b: RealtimeProjectionEvent | PlainMessage<RealtimeProjectionEvent> | undefined): boolean;
}
/**
 * One mutation of a server-scoped client projection.
 *
 * @generated from message chatto.realtime.v1.RealtimeProjectionOperation
 */
export declare class RealtimeProjectionOperation extends Message<RealtimeProjectionOperation> {
    /**
     * @generated from oneof chatto.realtime.v1.RealtimeProjectionOperation.operation
     */
    operation: {
        /**
         * Clears all canonical server projection state before compacted replay.
         *
         * @generated from field: chatto.realtime.v1.RealtimeProjectionReset reset = 1;
         */
        value: RealtimeProjectionReset;
        case: "reset";
    } | {
        /**
         * Replaces the public server profile.
         *
         * @generated from field: chatto.api.v1.ServerPublicProfile server_upsert = 2;
         */
        value: ServerPublicProfile;
        case: "serverUpsert";
    } | {
        /**
         * Replaces the authenticated viewer resource.
         *
         * @generated from field: chatto.api.v1.GetViewerResponse viewer_upsert = 3;
         */
        value: GetViewerResponse;
        case: "viewerUpsert";
    } | {
        /**
         * Adds or replaces one server directory member.
         *
         * @generated from field: chatto.api.v1.DirectoryMember user_upsert = 4;
         */
        value: DirectoryMember;
        case: "userUpsert";
    } | {
        /**
         * Removes one server directory member.
         *
         * @generated from field: chatto.realtime.v1.RealtimeProjectionUserRemove user_remove = 5;
         */
        value: RealtimeProjectionUserRemove;
        case: "userRemove";
    } | {
        /**
         * Adds or replaces one room and its viewer state. Channel membership is
         * complete only after that room's timeline has been materialised.
         *
         * @generated from field: chatto.realtime.v1.RealtimeProjectionRoom room_upsert = 6;
         */
        value: RealtimeProjectionRoom;
        case: "roomUpsert";
    } | {
        /**
         * Removes one room and all locally retained room state.
         *
         * @generated from field: chatto.realtime.v1.RealtimeProjectionRoomRemove room_remove = 7;
         */
        value: RealtimeProjectionRoomRemove;
        case: "roomRemove";
    } | {
        /**
         * Replaces the complete visible room-group layout.
         *
         * @generated from field: chatto.realtime.v1.RealtimeProjectionRoomGroupsReplace room_groups_replace = 8;
         */
        value: RealtimeProjectionRoomGroupsReplace;
        case: "roomGroupsReplace";
    } | {
        /**
         * Replaces the lazily retained recent timeline window for one joined room.
         *
         * @generated from field: chatto.realtime.v1.RealtimeProjectionRoomTimelineReplace room_timeline_replace = 9;
         */
        value: RealtimeProjectionRoomTimelineReplace;
        case: "roomTimelineReplace";
    } | {
        /**
         * Adds or replaces one renderable event in a retained room timeline.
         *
         * @generated from field: chatto.realtime.v1.RealtimeProjectionRoomTimelineEventUpsert room_timeline_event_upsert = 10;
         */
        value: RealtimeProjectionRoomTimelineEventUpsert;
        case: "roomTimelineEventUpsert";
    } | {
        /**
         * Replaces authenticated server-wide presentation and runtime state.
         *
         * @generated from field: chatto.realtime.v1.RealtimeProjectionServerState server_state_upsert = 11;
         */
        value: RealtimeProjectionServerState;
        case: "serverStateUpsert";
    } | {
        /**
         * Removes one event from a retained room timeline. This is distinct from
         * a message tombstone: projection-only channel echoes disappear when the
         * underlying thread reply is no longer echoed into the room.
         *
         * @generated from field: chatto.realtime.v1.RealtimeProjectionRoomTimelineEventRemove room_timeline_event_remove = 12;
         */
        value: RealtimeProjectionRoomTimelineEventRemove;
        case: "roomTimelineEventRemove";
    } | {
        /**
         * Replaces the viewer's current pending-notification page and room counts.
         *
         * @generated from field: chatto.realtime.v1.RealtimeProjectionNotificationsReplace notifications_replace = 13;
         */
        value: RealtimeProjectionNotificationsReplace;
        case: "notificationsReplace";
    } | {
        /**
         * Replaces one room's current viewer state without
         * retransmitting room metadata or membership.
         *
         * @generated from field: chatto.realtime.v1.RealtimeProjectionRoomViewerStateReplace room_viewer_state_replace = 14;
         */
        value: RealtimeProjectionRoomViewerStateReplace;
        case: "roomViewerStateReplace";
    } | {
        /**
         * Replaces every active call visible to the caller.
         *
         * @generated from field: chatto.realtime.v1.RealtimeProjectionActiveCallsReplace active_calls_replace = 15;
         */
        value: RealtimeProjectionActiveCallsReplace;
        case: "activeCallsReplace";
    } | {
        /**
         * Replaces the latest presence status for every server member. Presence
         * is transient and not replayed from EVT, so every subscription emits
         * this reconciliation before caught_up.
         *
         * @generated from field: chatto.realtime.v1.RealtimeProjectionPresencesReplace presences_replace = 16;
         */
        value: RealtimeProjectionPresencesReplace;
        case: "presencesReplace";
    } | {
        /**
         * Replaces viewer-specific follow and unread state for every followed
         * thread. Missing entries authoritatively mean not followed and not
         * unread for retained thread roots.
         *
         * @generated from field: chatto.realtime.v1.RealtimeProjectionThreadViewerStatesReplace thread_viewer_states_replace = 17;
         */
        value: RealtimeProjectionThreadViewerStatesReplace;
        case: "threadViewerStatesReplace";
    } | {
        /**
         * Signals root-message activity for lightweight room ordering even when
         * that room's timeline is not retained.
         *
         * @generated from field: chatto.realtime.v1.RealtimeProjectionRoomActivity room_activity = 18;
         */
        value: RealtimeProjectionRoomActivity;
        case: "roomActivity";
    } | {
        case: undefined;
        value?: undefined;
    };
    constructor(data?: PartialMessage<RealtimeProjectionOperation>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeProjectionOperation";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeProjectionOperation;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeProjectionOperation;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeProjectionOperation;
    static equals(a: RealtimeProjectionOperation | PlainMessage<RealtimeProjectionOperation> | undefined, b: RealtimeProjectionOperation | PlainMessage<RealtimeProjectionOperation> | undefined): boolean;
}
/**
 * Reset marker for a compacted projection replay.
 *
 * @generated from message chatto.realtime.v1.RealtimeProjectionReset
 */
export declare class RealtimeProjectionReset extends Message<RealtimeProjectionReset> {
    constructor(data?: PartialMessage<RealtimeProjectionReset>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeProjectionReset";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeProjectionReset;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeProjectionReset;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeProjectionReset;
    static equals(a: RealtimeProjectionReset | PlainMessage<RealtimeProjectionReset> | undefined, b: RealtimeProjectionReset | PlainMessage<RealtimeProjectionReset> | undefined): boolean;
}
/**
 * Authenticated server state required by every signed-in client.
 *
 * @generated from message chatto.realtime.v1.RealtimeProjectionServerState
 */
export declare class RealtimeProjectionServerState extends Message<RealtimeProjectionServerState> {
    /**
     * Optional message of the day shown to authenticated members.
     *
     * @generated from field: optional string motd = 1;
     */
    motd?: string;
    /**
     * Runtime capabilities and limits advertised to the client.
     *
     * @generated from field: chatto.api.v1.ServerRuntimeConfig runtime = 2;
     */
    runtime?: ServerRuntimeConfig;
    constructor(data?: PartialMessage<RealtimeProjectionServerState>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeProjectionServerState";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeProjectionServerState;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeProjectionServerState;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeProjectionServerState;
    static equals(a: RealtimeProjectionServerState | PlainMessage<RealtimeProjectionServerState> | undefined, b: RealtimeProjectionServerState | PlainMessage<RealtimeProjectionServerState> | undefined): boolean;
}
/**
 * Canonical lightweight room state retained by a server-scoped projection.
 *
 * @generated from message chatto.realtime.v1.RealtimeProjectionRoom
 */
export declare class RealtimeProjectionRoom extends Message<RealtimeProjectionRoom> {
    /**
     * Public room metadata and viewer-specific state.
     *
     * @generated from field: chatto.api.v1.RoomWithViewerState room = 1;
     */
    room?: RoomWithViewerState;
    /**
     * Current room membership expressed as references into the projection's
     * server-wide user directory. DM participants are always present. Channel
     * membership is empty in a cold room summary and complete after that room's
     * timeline has been materialised.
     *
     * @generated from field: repeated string member_user_ids = 2;
     */
    memberUserIds: string[];
    /**
     * Current pending notifications targeting this room for the viewer.
     *
     * @generated from field: uint32 viewer_notification_count = 3;
     */
    viewerNotificationCount: number;
    /**
     * Whether this DM room has ever received a root message. False means the
     * durable room exists only so its initiator can compose the first message.
     * Once true, message deletion does not reset it. Absent for channel rooms
     * and servers that predate this field.
     *
     * @generated from field: optional bool has_message_history = 4;
     */
    hasMessageHistory?: boolean;
    constructor(data?: PartialMessage<RealtimeProjectionRoom>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeProjectionRoom";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeProjectionRoom;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeProjectionRoom;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeProjectionRoom;
    static equals(a: RealtimeProjectionRoom | PlainMessage<RealtimeProjectionRoom> | undefined, b: RealtimeProjectionRoom | PlainMessage<RealtimeProjectionRoom> | undefined): boolean;
}
/**
 * Root-message activity that affects lightweight room navigation state.
 *
 * This deliberately carries no message content. Retained rooms receive the
 * corresponding timeline mutation separately; unretained rooms still use this
 * operation to keep DM ordering current without materialising their timeline.
 *
 * @generated from message chatto.realtime.v1.RealtimeProjectionRoomActivity
 */
export declare class RealtimeProjectionRoomActivity extends Message<RealtimeProjectionRoomActivity> {
    /**
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    constructor(data?: PartialMessage<RealtimeProjectionRoomActivity>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeProjectionRoomActivity";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeProjectionRoomActivity;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeProjectionRoomActivity;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeProjectionRoomActivity;
    static equals(a: RealtimeProjectionRoomActivity | PlainMessage<RealtimeProjectionRoomActivity> | undefined, b: RealtimeProjectionRoomActivity | PlainMessage<RealtimeProjectionRoomActivity> | undefined): boolean;
}
/**
 * Removes one user from the client projection. Reducers must also purge copied
 * render data for this user from retained rooms, timelines, notifications, and
 * calls while preserving stable IDs on historical facts.
 *
 * @generated from message chatto.realtime.v1.RealtimeProjectionUserRemove
 */
export declare class RealtimeProjectionUserRemove extends Message<RealtimeProjectionUserRemove> {
    /**
     * Stable user ID to remove.
     *
     * @generated from field: string user_id = 1;
     */
    userId: string;
    constructor(data?: PartialMessage<RealtimeProjectionUserRemove>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeProjectionUserRemove";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeProjectionUserRemove;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeProjectionUserRemove;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeProjectionUserRemove;
    static equals(a: RealtimeProjectionUserRemove | PlainMessage<RealtimeProjectionUserRemove> | undefined, b: RealtimeProjectionUserRemove | PlainMessage<RealtimeProjectionUserRemove> | undefined): boolean;
}
/**
 * Complete latest-value presence state for the projected user directory.
 * Missing map entries are offline; the server normally includes every member
 * explicitly so reducers can converge without retaining an older value.
 *
 * @generated from message chatto.realtime.v1.RealtimeProjectionPresencesReplace
 */
export declare class RealtimeProjectionPresencesReplace extends Message<RealtimeProjectionPresencesReplace> {
    /**
     * @generated from field: map<string, chatto.api.v1.PresenceStatus> statuses = 1;
     */
    statuses: {
        [key: string]: PresenceStatus;
    };
    constructor(data?: PartialMessage<RealtimeProjectionPresencesReplace>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeProjectionPresencesReplace";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeProjectionPresencesReplace;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeProjectionPresencesReplace;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeProjectionPresencesReplace;
    static equals(a: RealtimeProjectionPresencesReplace | PlainMessage<RealtimeProjectionPresencesReplace> | undefined, b: RealtimeProjectionPresencesReplace | PlainMessage<RealtimeProjectionPresencesReplace> | undefined): boolean;
}
/**
 * Complete current viewer state for followed threads. This reconciles durable
 * follow changes and RUNTIME_STATE read markers that may change while a client
 * is dormant without retransmitting room timelines.
 *
 * @generated from message chatto.realtime.v1.RealtimeProjectionThreadViewerStatesReplace
 */
export declare class RealtimeProjectionThreadViewerStatesReplace extends Message<RealtimeProjectionThreadViewerStatesReplace> {
    /**
     * @generated from field: repeated chatto.realtime.v1.RealtimeProjectionThreadViewerState states = 1;
     */
    states: RealtimeProjectionThreadViewerState[];
    constructor(data?: PartialMessage<RealtimeProjectionThreadViewerStatesReplace>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeProjectionThreadViewerStatesReplace";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeProjectionThreadViewerStatesReplace;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeProjectionThreadViewerStatesReplace;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeProjectionThreadViewerStatesReplace;
    static equals(a: RealtimeProjectionThreadViewerStatesReplace | PlainMessage<RealtimeProjectionThreadViewerStatesReplace> | undefined, b: RealtimeProjectionThreadViewerStatesReplace | PlainMessage<RealtimeProjectionThreadViewerStatesReplace> | undefined): boolean;
}
/**
 * Viewer-specific state for one followed thread root.
 *
 * @generated from message chatto.realtime.v1.RealtimeProjectionThreadViewerState
 */
export declare class RealtimeProjectionThreadViewerState extends Message<RealtimeProjectionThreadViewerState> {
    /**
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * @generated from field: string thread_root_event_id = 2;
     */
    threadRootEventId: string;
    /**
     * @generated from field: chatto.api.v1.ThreadViewerState viewer_state = 3;
     */
    viewerState?: ThreadViewerState;
    constructor(data?: PartialMessage<RealtimeProjectionThreadViewerState>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeProjectionThreadViewerState";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeProjectionThreadViewerState;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeProjectionThreadViewerState;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeProjectionThreadViewerState;
    static equals(a: RealtimeProjectionThreadViewerState | PlainMessage<RealtimeProjectionThreadViewerState> | undefined, b: RealtimeProjectionThreadViewerState | PlainMessage<RealtimeProjectionThreadViewerState> | undefined): boolean;
}
/**
 * Removes one room from the client projection.
 *
 * @generated from message chatto.realtime.v1.RealtimeProjectionRoomRemove
 */
export declare class RealtimeProjectionRoomRemove extends Message<RealtimeProjectionRoomRemove> {
    /**
     * Stable room ID to remove.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    constructor(data?: PartialMessage<RealtimeProjectionRoomRemove>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeProjectionRoomRemove";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeProjectionRoomRemove;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeProjectionRoomRemove;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeProjectionRoomRemove;
    static equals(a: RealtimeProjectionRoomRemove | PlainMessage<RealtimeProjectionRoomRemove> | undefined, b: RealtimeProjectionRoomRemove | PlainMessage<RealtimeProjectionRoomRemove> | undefined): boolean;
}
/**
 * Complete ordered room-group layout visible to the caller.
 *
 * @generated from message chatto.realtime.v1.RealtimeProjectionRoomGroupsReplace
 */
export declare class RealtimeProjectionRoomGroupsReplace extends Message<RealtimeProjectionRoomGroupsReplace> {
    /**
     * Visible room groups in sidebar order.
     *
     * @generated from field: repeated chatto.api.v1.RoomGroup groups = 1;
     */
    groups: RoomGroup[];
    constructor(data?: PartialMessage<RealtimeProjectionRoomGroupsReplace>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeProjectionRoomGroupsReplace";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeProjectionRoomGroupsReplace;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeProjectionRoomGroupsReplace;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeProjectionRoomGroupsReplace;
    static equals(a: RealtimeProjectionRoomGroupsReplace | PlainMessage<RealtimeProjectionRoomGroupsReplace> | undefined, b: RealtimeProjectionRoomGroupsReplace | PlainMessage<RealtimeProjectionRoomGroupsReplace> | undefined): boolean;
}
/**
 * Complete retained recent timeline window for one room.
 *
 * @generated from message chatto.realtime.v1.RealtimeProjectionRoomTimelineReplace
 */
export declare class RealtimeProjectionRoomTimelineReplace extends Message<RealtimeProjectionRoomTimelineReplace> {
    /**
     * Room whose retained window is replaced.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Renderable current timeline state. Deleted and crypto-shredded message
     * bodies are absent and represented by their normal tombstone fields.
     *
     * @generated from field: chatto.api.v1.RoomTimelinePage page = 2;
     */
    page?: RoomTimelinePage;
    /**
     * Opaque cursor for every retained row, keyed by timeline event ID.
     *
     * @generated from field: map<string, string> event_cursors = 3;
     */
    eventCursors: {
        [key: string]: string;
    };
    constructor(data?: PartialMessage<RealtimeProjectionRoomTimelineReplace>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeProjectionRoomTimelineReplace";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeProjectionRoomTimelineReplace;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeProjectionRoomTimelineReplace;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeProjectionRoomTimelineReplace;
    static equals(a: RealtimeProjectionRoomTimelineReplace | PlainMessage<RealtimeProjectionRoomTimelineReplace> | undefined, b: RealtimeProjectionRoomTimelineReplace | PlainMessage<RealtimeProjectionRoomTimelineReplace> | undefined): boolean;
}
/**
 * Current renderable state for one timeline event.
 *
 * @generated from message chatto.realtime.v1.RealtimeProjectionRoomTimelineEventUpsert
 */
export declare class RealtimeProjectionRoomTimelineEventUpsert extends Message<RealtimeProjectionRoomTimelineEventUpsert> {
    /**
     * Room containing the event.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Current renderable event state.
     *
     * @generated from field: chatto.api.v1.RoomTimelineEvent event = 2;
     */
    event?: RoomTimelineEvent;
    /**
     * Related users needed to render this event.
     *
     * @generated from field: chatto.api.v1.RoomTimelineIncludes includes = 3;
     */
    includes?: RoomTimelineIncludes;
    /**
     * Reaction transition that caused this upsert, when applicable.
     *
     * @generated from field: optional chatto.realtime.v1.RealtimeProjectionReactionChange reaction_change = 4;
     */
    reactionChange?: RealtimeProjectionReactionChange;
    /**
     * Preserve a deleted echo row as a tombstone. Directly deleted echoes use a
     * remove operation instead; this flag identifies canonical-reply deletion.
     *
     * @generated from field: bool retain_deleted_row = 5;
     */
    retainDeletedRow: boolean;
    /**
     * Opaque room-timeline cursor for this canonical row. Clients use retained
     * row cursors to advance a bounded window without a separate refresh read.
     *
     * @generated from field: string event_cursor = 6;
     */
    eventCursor: string;
    constructor(data?: PartialMessage<RealtimeProjectionRoomTimelineEventUpsert>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeProjectionRoomTimelineEventUpsert";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeProjectionRoomTimelineEventUpsert;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeProjectionRoomTimelineEventUpsert;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeProjectionRoomTimelineEventUpsert;
    static equals(a: RealtimeProjectionRoomTimelineEventUpsert | PlainMessage<RealtimeProjectionRoomTimelineEventUpsert> | undefined, b: RealtimeProjectionRoomTimelineEventUpsert | PlainMessage<RealtimeProjectionRoomTimelineEventUpsert> | undefined): boolean;
}
/**
 * Removes one projection-only row from a retained room timeline.
 *
 * @generated from message chatto.realtime.v1.RealtimeProjectionRoomTimelineEventRemove
 */
export declare class RealtimeProjectionRoomTimelineEventRemove extends Message<RealtimeProjectionRoomTimelineEventRemove> {
    /**
     * Room containing the retained row.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Stable event ID of the row to remove.
     *
     * @generated from field: string event_id = 2;
     */
    eventId: string;
    constructor(data?: PartialMessage<RealtimeProjectionRoomTimelineEventRemove>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeProjectionRoomTimelineEventRemove";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeProjectionRoomTimelineEventRemove;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeProjectionRoomTimelineEventRemove;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeProjectionRoomTimelineEventRemove;
    static equals(a: RealtimeProjectionRoomTimelineEventRemove | PlainMessage<RealtimeProjectionRoomTimelineEventRemove> | undefined, b: RealtimeProjectionRoomTimelineEventRemove | PlainMessage<RealtimeProjectionRoomTimelineEventRemove> | undefined): boolean;
}
/**
 * Finite current notification state emitted on bootstrap and every resume.
 *
 * @generated from message chatto.realtime.v1.RealtimeProjectionNotificationsReplace
 */
export declare class RealtimeProjectionNotificationsReplace extends Message<RealtimeProjectionNotificationsReplace> {
    /**
     * Newest pending notifications and total pending count.
     *
     * @generated from field: chatto.api.v1.ListNotificationsResponse page = 1;
     */
    page?: ListNotificationsResponse;
    /**
     * Complete current counts for rooms with pending notifications.
     *
     * @generated from field: repeated chatto.api.v1.RoomNotificationCount room_counts = 2;
     */
    roomCounts: RoomNotificationCount[];
    /**
     * Live transition that caused this replacement, when one exists. Bootstrap,
     * replay reconciliation, and compacted reset replacements omit this field.
     *
     * @generated from field: optional chatto.realtime.v1.RealtimeProjectionNotificationChange change = 3;
     */
    change?: RealtimeProjectionNotificationChange;
    constructor(data?: PartialMessage<RealtimeProjectionNotificationsReplace>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeProjectionNotificationsReplace";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeProjectionNotificationsReplace;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeProjectionNotificationsReplace;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeProjectionNotificationsReplace;
    static equals(a: RealtimeProjectionNotificationsReplace | PlainMessage<RealtimeProjectionNotificationsReplace> | undefined, b: RealtimeProjectionNotificationsReplace | PlainMessage<RealtimeProjectionNotificationsReplace> | undefined): boolean;
}
/**
 * One live notification transition accompanying authoritative current state.
 *
 * This metadata exists for one-shot presentation effects such as sounds. The
 * enclosing replacement remains the canonical notification state.
 *
 * @generated from message chatto.realtime.v1.RealtimeProjectionNotificationChange
 */
export declare class RealtimeProjectionNotificationChange extends Message<RealtimeProjectionNotificationChange> {
    /**
     * @generated from field: chatto.realtime.v1.RealtimeProjectionNotificationAction action = 1;
     */
    action: RealtimeProjectionNotificationAction;
    /**
     * @generated from field: string notification_id = 2;
     */
    notificationId: string;
    /**
     * True when a created notification must not produce an alert.
     *
     * @generated from field: bool silent = 3;
     */
    silent: boolean;
    constructor(data?: PartialMessage<RealtimeProjectionNotificationChange>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeProjectionNotificationChange";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeProjectionNotificationChange;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeProjectionNotificationChange;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeProjectionNotificationChange;
    static equals(a: RealtimeProjectionNotificationChange | PlainMessage<RealtimeProjectionNotificationChange> | undefined, b: RealtimeProjectionNotificationChange | PlainMessage<RealtimeProjectionNotificationChange> | undefined): boolean;
}
/**
 * Lightweight current viewer state for one projected room.
 *
 * @generated from message chatto.realtime.v1.RealtimeProjectionRoomViewerStateReplace
 */
export declare class RealtimeProjectionRoomViewerStateReplace extends Message<RealtimeProjectionRoomViewerStateReplace> {
    /**
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * @generated from field: chatto.api.v1.RoomViewerState viewer_state = 2;
     */
    viewerState?: RoomViewerState;
    constructor(data?: PartialMessage<RealtimeProjectionRoomViewerStateReplace>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeProjectionRoomViewerStateReplace";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeProjectionRoomViewerStateReplace;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeProjectionRoomViewerStateReplace;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeProjectionRoomViewerStateReplace;
    static equals(a: RealtimeProjectionRoomViewerStateReplace | PlainMessage<RealtimeProjectionRoomViewerStateReplace> | undefined, b: RealtimeProjectionRoomViewerStateReplace | PlainMessage<RealtimeProjectionRoomViewerStateReplace> | undefined): boolean;
}
/**
 * Finite current active-call state visible to the caller.
 *
 * @generated from message chatto.realtime.v1.RealtimeProjectionActiveCallsReplace
 */
export declare class RealtimeProjectionActiveCallsReplace extends Message<RealtimeProjectionActiveCallsReplace> {
    /**
     * @generated from field: repeated chatto.api.v1.ActiveCall calls = 1;
     */
    calls: ActiveCall[];
    constructor(data?: PartialMessage<RealtimeProjectionActiveCallsReplace>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeProjectionActiveCallsReplace";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeProjectionActiveCallsReplace;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeProjectionActiveCallsReplace;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeProjectionActiveCallsReplace;
    static equals(a: RealtimeProjectionActiveCallsReplace | PlainMessage<RealtimeProjectionActiveCallsReplace> | undefined, b: RealtimeProjectionActiveCallsReplace | PlainMessage<RealtimeProjectionActiveCallsReplace> | undefined): boolean;
}
/**
 * Reaction transition retained for integrations while the containing timeline
 * row carries the authoritative aggregate reaction state.
 *
 * @generated from message chatto.realtime.v1.RealtimeProjectionReactionChange
 */
export declare class RealtimeProjectionReactionChange extends Message<RealtimeProjectionReactionChange> {
    /**
     * Whether the actor added or removed the reaction.
     *
     * @generated from field: chatto.realtime.v1.RealtimeProjectionReactionAction action = 1;
     */
    action: RealtimeProjectionReactionAction;
    /**
     * Canonical reacted-to message event ID.
     *
     * @generated from field: string message_event_id = 2;
     */
    messageEventId: string;
    /**
     * Reaction emoji.
     *
     * @generated from field: string emoji = 3;
     */
    emoji: string;
    /**
     * User who changed the reaction.
     *
     * @generated from field: string user_id = 4;
     */
    userId: string;
    constructor(data?: PartialMessage<RealtimeProjectionReactionChange>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeProjectionReactionChange";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeProjectionReactionChange;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeProjectionReactionChange;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeProjectionReactionChange;
    static equals(a: RealtimeProjectionReactionChange | PlainMessage<RealtimeProjectionReactionChange> | undefined, b: RealtimeProjectionReactionChange | PlainMessage<RealtimeProjectionReactionChange> | undefined): boolean;
}
/**
 * Application-level ping.
 *
 * @generated from message chatto.realtime.v1.RealtimePing
 */
export declare class RealtimePing extends Message<RealtimePing> {
    /**
     * Client-chosen opaque value echoed in the pong.
     *
     * @generated from field: string nonce = 1;
     */
    nonce: string;
    constructor(data?: PartialMessage<RealtimePing>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimePing";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimePing;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimePing;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimePing;
    static equals(a: RealtimePing | PlainMessage<RealtimePing> | undefined, b: RealtimePing | PlainMessage<RealtimePing> | undefined): boolean;
}
/**
 * Application-level pong.
 *
 * @generated from message chatto.realtime.v1.RealtimePong
 */
export declare class RealtimePong extends Message<RealtimePong> {
    /**
     * Echo of the ping nonce.
     *
     * @generated from field: string nonce = 1;
     */
    nonce: string;
    constructor(data?: PartialMessage<RealtimePong>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimePong";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimePong;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimePong;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimePong;
    static equals(a: RealtimePong | PlainMessage<RealtimePong> | undefined, b: RealtimePong | PlainMessage<RealtimePong> | undefined): boolean;
}
/**
 * Application-level heartbeat.
 *
 * @generated from message chatto.realtime.v1.RealtimeHeartbeat
 */
export declare class RealtimeHeartbeat extends Message<RealtimeHeartbeat> {
    /**
     * Stable event ID for this heartbeat.
     *
     * @generated from field: string id = 1;
     */
    id: string;
    /**
     * Time the heartbeat was emitted.
     *
     * @generated from field: google.protobuf.Timestamp created_at = 2;
     */
    createdAt?: Timestamp;
    constructor(data?: PartialMessage<RealtimeHeartbeat>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeHeartbeat";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeHeartbeat;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeHeartbeat;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeHeartbeat;
    static equals(a: RealtimeHeartbeat | PlainMessage<RealtimeHeartbeat> | undefined, b: RealtimeHeartbeat | PlainMessage<RealtimeHeartbeat> | undefined): boolean;
}
/**
 * Protocol error.
 *
 * @generated from message chatto.realtime.v1.RealtimeError
 */
export declare class RealtimeError extends Message<RealtimeError> {
    /**
     * Stable machine-readable error code.
     *
     * @generated from field: string code = 1;
     */
    code: string;
    /**
     * Human-readable diagnostic message.
     *
     * @generated from field: string message = 2;
     */
    message: string;
    /**
     * True when the server will close the socket after sending this error.
     *
     * @generated from field: bool fatal = 3;
     */
    fatal: boolean;
    /**
     * Suggested retry delay for a non-fatal rejected request. Omitted when the
     * request should not be retried automatically.
     *
     * @generated from field: optional uint32 retry_after_ms = 4;
     */
    retryAfterMs?: number;
    /**
     * Room associated with a room-hydration error. Omitted for errors that are
     * not caused by `hydrate_room`.
     *
     * @generated from field: optional string room_id = 5;
     */
    roomId?: string;
    constructor(data?: PartialMessage<RealtimeError>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeError";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeError;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeError;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeError;
    static equals(a: RealtimeError | PlainMessage<RealtimeError> | undefined, b: RealtimeError | PlainMessage<RealtimeError> | undefined): boolean;
}
/**
 * Close instruction sent before the socket is closed when possible.
 *
 * @generated from message chatto.realtime.v1.RealtimeClose
 */
export declare class RealtimeClose extends Message<RealtimeClose> {
    /**
     * Stable machine-readable close code.
     *
     * @generated from field: string code = 1;
     */
    code: string;
    /**
     * Human-readable diagnostic message.
     *
     * @generated from field: string message = 2;
     */
    message: string;
    /**
     * True when the client should reconnect after a delay.
     *
     * @generated from field: bool reconnect = 3;
     */
    reconnect: boolean;
    /**
     * Suggested reconnect delay in milliseconds.
     *
     * @generated from field: uint32 retry_after_ms = 4;
     */
    retryAfterMs: number;
    constructor(data?: PartialMessage<RealtimeClose>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeClose";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeClose;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeClose;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeClose;
    static equals(a: RealtimeClose | PlainMessage<RealtimeClose> | undefined, b: RealtimeClose | PlainMessage<RealtimeClose> | undefined): boolean;
}
/**
 * One authorized transient event delivered over the realtime WebSocket.
 *
 * These events have no resume cursor and are never replayed. Durable state is
 * delivered only as RealtimeProjectionEvent operations.
 *
 * @generated from message chatto.realtime.v1.RealtimeEventEnvelope
 */
export declare class RealtimeEventEnvelope extends Message<RealtimeEventEnvelope> {
    /**
     * Stable event ID.
     *
     * @generated from field: string id = 1;
     */
    id: string;
    /**
     * Time the event was created.
     *
     * @generated from field: google.protobuf.Timestamp created_at = 2;
     */
    createdAt?: Timestamp;
    /**
     * User or system actor that caused the event, when known.
     *
     * @generated from field: optional string actor_id = 3;
     */
    actorId?: string;
    /**
     * @generated from oneof chatto.realtime.v1.RealtimeEventEnvelope.event
     */
    event: {
        /**
         * A user is typing in a room or thread.
         *
         * @generated from field: chatto.realtime.v1.RealtimeTypingEvent user_typing = 30;
         */
        value: RealtimeTypingEvent;
        case: "userTyping";
    } | {
        /**
         * A user's live presence changed.
         *
         * @generated from field: chatto.realtime.v1.RealtimePresenceChangedEvent presence_changed = 31;
         */
        value: RealtimePresenceChangedEvent;
        case: "presenceChanged";
    } | {
        /**
         * The current user was mentioned in a room.
         *
         * @generated from field: chatto.realtime.v1.RealtimeMentionNotificationEvent mention_notification = 88;
         */
        value: RealtimeMentionNotificationEvent;
        case: "mentionNotification";
    } | {
        /**
         * The current user received a new direct message.
         *
         * @generated from field: chatto.realtime.v1.RealtimeNewDirectMessageNotificationEvent new_direct_message_notification = 89;
         */
        value: RealtimeNewDirectMessageNotificationEvent;
        case: "newDirectMessageNotification";
    } | {
        /**
         * The current user's session was terminated.
         *
         * @generated from field: chatto.realtime.v1.RealtimeSessionTerminatedEvent session_terminated = 90;
         */
        value: RealtimeSessionTerminatedEvent;
        case: "sessionTerminated";
    } | {
        case: undefined;
        value?: undefined;
    };
    constructor(data?: PartialMessage<RealtimeEventEnvelope>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeEventEnvelope";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeEventEnvelope;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeEventEnvelope;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeEventEnvelope;
    static equals(a: RealtimeEventEnvelope | PlainMessage<RealtimeEventEnvelope> | undefined, b: RealtimeEventEnvelope | PlainMessage<RealtimeEventEnvelope> | undefined): boolean;
}
/**
 * Typing signal.
 *
 * This is an ephemeral signal. `room_id` and `thread_root_event_id` identify
 * where to display typing state; clients normally do not hydrate it.
 *
 * @generated from message chatto.realtime.v1.RealtimeTypingEvent
 */
export declare class RealtimeTypingEvent extends Message<RealtimeTypingEvent> {
    /**
     * Room where the actor is typing.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Thread root event ID when the actor is typing in a thread.
     *
     * @generated from field: optional string thread_root_event_id = 2;
     */
    threadRootEventId?: string;
    constructor(data?: PartialMessage<RealtimeTypingEvent>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeTypingEvent";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeTypingEvent;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeTypingEvent;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeTypingEvent;
    static equals(a: RealtimeTypingEvent | PlainMessage<RealtimeTypingEvent> | undefined, b: RealtimeTypingEvent | PlainMessage<RealtimeTypingEvent> | undefined): boolean;
}
/**
 * Presence-changed signal.
 *
 * The latest presence status is inline. Use `UserService.GetUser` when
 * the surrounding user profile or custom status also needs refreshing.
 *
 * @generated from message chatto.realtime.v1.RealtimePresenceChangedEvent
 */
export declare class RealtimePresenceChangedEvent extends Message<RealtimePresenceChangedEvent> {
    /**
     * User whose presence changed.
     *
     * @generated from field: string user_id = 1;
     */
    userId: string;
    /**
     * Latest presence status.
     *
     * @generated from field: chatto.api.v1.PresenceStatus status = 2;
     */
    status: PresenceStatus;
    constructor(data?: PartialMessage<RealtimePresenceChangedEvent>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimePresenceChangedEvent";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimePresenceChangedEvent;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimePresenceChangedEvent;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimePresenceChangedEvent;
    static equals(a: RealtimePresenceChangedEvent | PlainMessage<RealtimePresenceChangedEvent> | undefined, b: RealtimePresenceChangedEvent | PlainMessage<RealtimePresenceChangedEvent> | undefined): boolean;
}
/**
 * Mention attention signal for the connected user.
 *
 * Inline names are display hints. Hydrate referenced rooms through
 * `RoomDirectoryService.BatchGetRooms` and users through
 * `UserService.BatchGetUsers` when local caches are missing or stale.
 *
 * @generated from message chatto.realtime.v1.RealtimeMentionNotificationEvent
 */
export declare class RealtimeMentionNotificationEvent extends Message<RealtimeMentionNotificationEvent> {
    /**
     * Room where the mention occurred.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Author user ID.
     *
     * @generated from field: string actor_user_id = 2;
     */
    actorUserId: string;
    /**
     * Display name of the room where the mention occurred, when hydrated for the caller.
     *
     * @generated from field: optional string room_name = 3;
     */
    roomName?: string;
    /**
     * Display name of the author who mentioned the connected user, when hydrated.
     *
     * @generated from field: optional string actor_display_name = 4;
     */
    actorDisplayName?: string;
    constructor(data?: PartialMessage<RealtimeMentionNotificationEvent>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeMentionNotificationEvent";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeMentionNotificationEvent;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeMentionNotificationEvent;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeMentionNotificationEvent;
    static equals(a: RealtimeMentionNotificationEvent | PlainMessage<RealtimeMentionNotificationEvent> | undefined, b: RealtimeMentionNotificationEvent | PlainMessage<RealtimeMentionNotificationEvent> | undefined): boolean;
}
/**
 * New-DM attention signal for the connected user.
 *
 * Inline names and avatar URLs are display hints. Hydrate the DM room through
 * `RoomDirectoryService.GetRoom` or `RoomDirectoryService.BatchGetRooms`, and
 * the sender through `UserService.GetUser` or `UserService.BatchGetUsers` when
 * local caches are missing or stale.
 *
 * @generated from message chatto.realtime.v1.RealtimeNewDirectMessageNotificationEvent
 */
export declare class RealtimeNewDirectMessageNotificationEvent extends Message<RealtimeNewDirectMessageNotificationEvent> {
    /**
     * DM room ID.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Sender user ID.
     *
     * @generated from field: string sender_id = 2;
     */
    senderId: string;
    /**
     * Display name of the sender, when hydrated.
     *
     * @generated from field: optional string sender_display_name = 3;
     */
    senderDisplayName?: string;
    /**
     * Avatar URL of the sender, when one is available.
     *
     * @generated from field: optional string sender_avatar_url = 4;
     */
    senderAvatarUrl?: string;
    /**
     * Display name for the DM conversation from the connected user's perspective, when hydrated.
     *
     * @generated from field: optional string conversation_name = 5;
     */
    conversationName?: string;
    constructor(data?: PartialMessage<RealtimeNewDirectMessageNotificationEvent>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeNewDirectMessageNotificationEvent";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeNewDirectMessageNotificationEvent;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeNewDirectMessageNotificationEvent;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeNewDirectMessageNotificationEvent;
    static equals(a: RealtimeNewDirectMessageNotificationEvent | PlainMessage<RealtimeNewDirectMessageNotificationEvent> | undefined, b: RealtimeNewDirectMessageNotificationEvent | PlainMessage<RealtimeNewDirectMessageNotificationEvent> | undefined): boolean;
}
/**
 * Session-terminated signal for the connected user's current session.
 *
 * @generated from message chatto.realtime.v1.RealtimeSessionTerminatedEvent
 */
export declare class RealtimeSessionTerminatedEvent extends Message<RealtimeSessionTerminatedEvent> {
    /**
     * Termination reason.
     *
     * @generated from field: string reason = 1;
     */
    reason: string;
    constructor(data?: PartialMessage<RealtimeSessionTerminatedEvent>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.realtime.v1.RealtimeSessionTerminatedEvent";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RealtimeSessionTerminatedEvent;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RealtimeSessionTerminatedEvent;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RealtimeSessionTerminatedEvent;
    static equals(a: RealtimeSessionTerminatedEvent | PlainMessage<RealtimeSessionTerminatedEvent> | undefined, b: RealtimeSessionTerminatedEvent | PlainMessage<RealtimeSessionTerminatedEvent> | undefined): boolean;
}
