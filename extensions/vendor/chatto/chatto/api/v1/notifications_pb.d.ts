import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3, Timestamp } from "@bufbuild/protobuf";
import { RoomSummary } from "./rooms_pb.js";
import { User } from "./users_pb.js";
import { PageInfo, PageRequest } from "./pagination_pb.js";
/**
 * Direct-message notification payload.
 *
 * @generated from message chatto.api.v1.DirectMessageNotification
 */
export declare class DirectMessageNotification extends Message<DirectMessageNotification> {
    /**
     * Message event ID.
     *
     * @generated from field: string event_id = 2;
     */
    eventId: string;
    /**
     * DM room where the message was posted.
     *
     * @generated from field: chatto.api.v1.RoomSummary room = 3;
     */
    room?: RoomSummary;
    constructor(data?: PartialMessage<DirectMessageNotification>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.DirectMessageNotification";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DirectMessageNotification;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DirectMessageNotification;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DirectMessageNotification;
    static equals(a: DirectMessageNotification | PlainMessage<DirectMessageNotification> | undefined, b: DirectMessageNotification | PlainMessage<DirectMessageNotification> | undefined): boolean;
}
/**
 * Mention notification payload.
 *
 * @generated from message chatto.api.v1.MentionNotification
 */
export declare class MentionNotification extends Message<MentionNotification> {
    /**
     * Room where the mention occurred.
     *
     * @generated from field: chatto.api.v1.RoomSummary room = 1;
     */
    room?: RoomSummary;
    /**
     * Message event ID.
     *
     * @generated from field: string event_id = 2;
     */
    eventId: string;
    /**
     * Thread root event ID when the mention happened inside a thread.
     *
     * @generated from field: optional string thread_root_event_id = 3;
     */
    threadRootEventId?: string;
    constructor(data?: PartialMessage<MentionNotification>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.MentionNotification";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): MentionNotification;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): MentionNotification;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): MentionNotification;
    static equals(a: MentionNotification | PlainMessage<MentionNotification> | undefined, b: MentionNotification | PlainMessage<MentionNotification> | undefined): boolean;
}
/**
 * Reply notification payload.
 *
 * @generated from message chatto.api.v1.ReplyNotification
 */
export declare class ReplyNotification extends Message<ReplyNotification> {
    /**
     * Room where the reply occurred.
     *
     * @generated from field: chatto.api.v1.RoomSummary room = 1;
     */
    room?: RoomSummary;
    /**
     * Reply event ID.
     *
     * @generated from field: string event_id = 2;
     */
    eventId: string;
    /**
     * Event ID of the message being replied to.
     *
     * @generated from field: string in_reply_to_id = 3;
     */
    inReplyToId: string;
    /**
     * Thread root event ID when the reply happened inside a thread.
     *
     * @generated from field: optional string thread_root_event_id = 4;
     */
    threadRootEventId?: string;
    constructor(data?: PartialMessage<ReplyNotification>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ReplyNotification";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ReplyNotification;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ReplyNotification;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ReplyNotification;
    static equals(a: ReplyNotification | PlainMessage<ReplyNotification> | undefined, b: ReplyNotification | PlainMessage<ReplyNotification> | undefined): boolean;
}
/**
 * All-messages room notification payload.
 *
 * @generated from message chatto.api.v1.RoomMessageNotification
 */
export declare class RoomMessageNotification extends Message<RoomMessageNotification> {
    /**
     * Room where the message was posted.
     *
     * @generated from field: chatto.api.v1.RoomSummary room = 1;
     */
    room?: RoomSummary;
    /**
     * Message event ID.
     *
     * @generated from field: string event_id = 2;
     */
    eventId: string;
    constructor(data?: PartialMessage<RoomMessageNotification>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RoomMessageNotification";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RoomMessageNotification;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RoomMessageNotification;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RoomMessageNotification;
    static equals(a: RoomMessageNotification | PlainMessage<RoomMessageNotification> | undefined, b: RoomMessageNotification | PlainMessage<RoomMessageNotification> | undefined): boolean;
}
/**
 * One pending notification for the authenticated viewer.
 *
 * @generated from message chatto.api.v1.NotificationItem
 */
export declare class NotificationItem extends Message<NotificationItem> {
    /**
     * Stable notification ID.
     *
     * @generated from field: string id = 1;
     */
    id: string;
    /**
     * Creation time.
     *
     * @generated from field: google.protobuf.Timestamp created_at = 2;
     */
    createdAt?: Timestamp;
    /**
     * User who triggered the notification, when still resolvable.
     *
     * @generated from field: chatto.api.v1.User actor = 3;
     */
    actor?: User;
    /**
     * @generated from oneof chatto.api.v1.NotificationItem.kind
     */
    kind: {
        /**
         * Direct-message notification.
         *
         * @generated from field: chatto.api.v1.DirectMessageNotification direct_message = 10;
         */
        value: DirectMessageNotification;
        case: "directMessage";
    } | {
        /**
         * Mention notification.
         *
         * @generated from field: chatto.api.v1.MentionNotification mention = 11;
         */
        value: MentionNotification;
        case: "mention";
    } | {
        /**
         * Reply notification.
         *
         * @generated from field: chatto.api.v1.ReplyNotification reply = 12;
         */
        value: ReplyNotification;
        case: "reply";
    } | {
        /**
         * All-messages room notification.
         *
         * @generated from field: chatto.api.v1.RoomMessageNotification room_message = 13;
         */
        value: RoomMessageNotification;
        case: "roomMessage";
    } | {
        case: undefined;
        value?: undefined;
    };
    constructor(data?: PartialMessage<NotificationItem>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.NotificationItem";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): NotificationItem;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): NotificationItem;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): NotificationItem;
    static equals(a: NotificationItem | PlainMessage<NotificationItem> | undefined, b: NotificationItem | PlainMessage<NotificationItem> | undefined): boolean;
}
/**
 * Request for the authenticated viewer's pending notifications.
 *
 * @generated from message chatto.api.v1.ListNotificationsRequest
 */
export declare class ListNotificationsRequest extends Message<ListNotificationsRequest> {
    /**
     * Page request. Defaults to 50 results when absent or limit is zero.
     *
     * @generated from field: chatto.api.v1.PageRequest page = 3;
     */
    page?: PageRequest;
    constructor(data?: PartialMessage<ListNotificationsRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListNotificationsRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListNotificationsRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListNotificationsRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListNotificationsRequest;
    static equals(a: ListNotificationsRequest | PlainMessage<ListNotificationsRequest> | undefined, b: ListNotificationsRequest | PlainMessage<ListNotificationsRequest> | undefined): boolean;
}
/**
 * Request for pending notifications scoped to one room.
 *
 * @generated from message chatto.api.v1.ListRoomNotificationsRequest
 */
export declare class ListRoomNotificationsRequest extends Message<ListRoomNotificationsRequest> {
    /**
     * Required. Room whose notifications should be listed.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Page request. Defaults to 50 results when absent or limit is zero.
     *
     * @generated from field: chatto.api.v1.PageRequest page = 4;
     */
    page?: PageRequest;
    constructor(data?: PartialMessage<ListRoomNotificationsRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListRoomNotificationsRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListRoomNotificationsRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListRoomNotificationsRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListRoomNotificationsRequest;
    static equals(a: ListRoomNotificationsRequest | PlainMessage<ListRoomNotificationsRequest> | undefined, b: ListRoomNotificationsRequest | PlainMessage<ListRoomNotificationsRequest> | undefined): boolean;
}
/**
 * Pending notification page.
 *
 * @generated from message chatto.api.v1.ListNotificationsResponse
 */
export declare class ListNotificationsResponse extends Message<ListNotificationsResponse> {
    /**
     * Page notifications, newest first.
     *
     * @generated from field: repeated chatto.api.v1.NotificationItem notifications = 1;
     */
    notifications: NotificationItem[];
    /**
     * Page metadata.
     *
     * @generated from field: chatto.api.v1.PageInfo page = 5;
     */
    page?: PageInfo;
    constructor(data?: PartialMessage<ListNotificationsResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListNotificationsResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListNotificationsResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListNotificationsResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListNotificationsResponse;
    static equals(a: ListNotificationsResponse | PlainMessage<ListNotificationsResponse> | undefined, b: ListNotificationsResponse | PlainMessage<ListNotificationsResponse> | undefined): boolean;
}
/**
 * Request one pending notification for the authenticated viewer.
 *
 * @generated from message chatto.api.v1.GetNotificationRequest
 */
export declare class GetNotificationRequest extends Message<GetNotificationRequest> {
    /**
     * Required notification ID.
     *
     * @generated from field: string notification_id = 1;
     */
    notificationId: string;
    constructor(data?: PartialMessage<GetNotificationRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetNotificationRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetNotificationRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetNotificationRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetNotificationRequest;
    static equals(a: GetNotificationRequest | PlainMessage<GetNotificationRequest> | undefined, b: GetNotificationRequest | PlainMessage<GetNotificationRequest> | undefined): boolean;
}
/**
 * Pending notification response.
 *
 * @generated from message chatto.api.v1.GetNotificationResponse
 */
export declare class GetNotificationResponse extends Message<GetNotificationResponse> {
    /**
     * Requested notification.
     *
     * @generated from field: chatto.api.v1.NotificationItem notification = 1;
     */
    notification?: NotificationItem;
    constructor(data?: PartialMessage<GetNotificationResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetNotificationResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetNotificationResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetNotificationResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetNotificationResponse;
    static equals(a: GetNotificationResponse | PlainMessage<GetNotificationResponse> | undefined, b: GetNotificationResponse | PlainMessage<GetNotificationResponse> | undefined): boolean;
}
/**
 * Request pending notifications for a set of stable notification IDs.
 *
 * @generated from message chatto.api.v1.BatchGetNotificationsRequest
 */
export declare class BatchGetNotificationsRequest extends Message<BatchGetNotificationsRequest> {
    /**
     * Required notification IDs. Unknown or dismissed IDs are omitted from the
     * response.
     *
     * @generated from field: repeated string notification_ids = 1;
     */
    notificationIds: string[];
    constructor(data?: PartialMessage<BatchGetNotificationsRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.BatchGetNotificationsRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): BatchGetNotificationsRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): BatchGetNotificationsRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): BatchGetNotificationsRequest;
    static equals(a: BatchGetNotificationsRequest | PlainMessage<BatchGetNotificationsRequest> | undefined, b: BatchGetNotificationsRequest | PlainMessage<BatchGetNotificationsRequest> | undefined): boolean;
}
/**
 * Batch pending notification response.
 *
 * @generated from message chatto.api.v1.BatchGetNotificationsResponse
 */
export declare class BatchGetNotificationsResponse extends Message<BatchGetNotificationsResponse> {
    /**
     * Found notifications. The server preserves first-seen request order and
     * de-duplicates repeated IDs.
     *
     * @generated from field: repeated chatto.api.v1.NotificationItem notifications = 1;
     */
    notifications: NotificationItem[];
    constructor(data?: PartialMessage<BatchGetNotificationsResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.BatchGetNotificationsResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): BatchGetNotificationsResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): BatchGetNotificationsResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): BatchGetNotificationsResponse;
    static equals(a: BatchGetNotificationsResponse | PlainMessage<BatchGetNotificationsResponse> | undefined, b: BatchGetNotificationsResponse | PlainMessage<BatchGetNotificationsResponse> | undefined): boolean;
}
/**
 * Pending notification page scoped to one room.
 *
 * @generated from message chatto.api.v1.ListRoomNotificationsResponse
 */
export declare class ListRoomNotificationsResponse extends Message<ListRoomNotificationsResponse> {
    /**
     * Page notifications, newest first.
     *
     * @generated from field: repeated chatto.api.v1.NotificationItem notifications = 1;
     */
    notifications: NotificationItem[];
    /**
     * Page metadata.
     *
     * @generated from field: chatto.api.v1.PageInfo page = 5;
     */
    page?: PageInfo;
    constructor(data?: PartialMessage<ListRoomNotificationsResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListRoomNotificationsResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListRoomNotificationsResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListRoomNotificationsResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListRoomNotificationsResponse;
    static equals(a: ListRoomNotificationsResponse | PlainMessage<ListRoomNotificationsResponse> | undefined, b: ListRoomNotificationsResponse | PlainMessage<ListRoomNotificationsResponse> | undefined): boolean;
}
/**
 * Request for a lightweight pending notification check.
 *
 * @generated from message chatto.api.v1.HasNotificationsRequest
 */
export declare class HasNotificationsRequest extends Message<HasNotificationsRequest> {
    constructor(data?: PartialMessage<HasNotificationsRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.HasNotificationsRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): HasNotificationsRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): HasNotificationsRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): HasNotificationsRequest;
    static equals(a: HasNotificationsRequest | PlainMessage<HasNotificationsRequest> | undefined, b: HasNotificationsRequest | PlainMessage<HasNotificationsRequest> | undefined): boolean;
}
/**
 * Lightweight pending notification check.
 *
 * @generated from message chatto.api.v1.HasNotificationsResponse
 */
export declare class HasNotificationsResponse extends Message<HasNotificationsResponse> {
    /**
     * True when the authenticated viewer has at least one pending notification.
     *
     * @generated from field: bool has_notifications = 1;
     */
    hasNotifications: boolean;
    constructor(data?: PartialMessage<HasNotificationsResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.HasNotificationsResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): HasNotificationsResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): HasNotificationsResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): HasNotificationsResponse;
    static equals(a: HasNotificationsResponse | PlainMessage<HasNotificationsResponse> | undefined, b: HasNotificationsResponse | PlainMessage<HasNotificationsResponse> | undefined): boolean;
}
/**
 * Pending notification count for one room.
 *
 * @generated from message chatto.api.v1.RoomNotificationCount
 */
export declare class RoomNotificationCount extends Message<RoomNotificationCount> {
    /**
     * Room ID.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Pending notification count for the authenticated viewer in this room.
     *
     * @generated from field: int32 total_count = 2;
     */
    totalCount: number;
    constructor(data?: PartialMessage<RoomNotificationCount>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RoomNotificationCount";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RoomNotificationCount;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RoomNotificationCount;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RoomNotificationCount;
    static equals(a: RoomNotificationCount | PlainMessage<RoomNotificationCount> | undefined, b: RoomNotificationCount | PlainMessage<RoomNotificationCount> | undefined): boolean;
}
/**
 * Request for pending notification counts grouped by room.
 *
 * @generated from message chatto.api.v1.ListRoomNotificationCountsRequest
 */
export declare class ListRoomNotificationCountsRequest extends Message<ListRoomNotificationCountsRequest> {
    constructor(data?: PartialMessage<ListRoomNotificationCountsRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListRoomNotificationCountsRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListRoomNotificationCountsRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListRoomNotificationCountsRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListRoomNotificationCountsRequest;
    static equals(a: ListRoomNotificationCountsRequest | PlainMessage<ListRoomNotificationCountsRequest> | undefined, b: ListRoomNotificationCountsRequest | PlainMessage<ListRoomNotificationCountsRequest> | undefined): boolean;
}
/**
 * Finite snapshot of pending notification counts grouped by room.
 *
 * @generated from message chatto.api.v1.ListRoomNotificationCountsResponse
 */
export declare class ListRoomNotificationCountsResponse extends Message<ListRoomNotificationCountsResponse> {
    /**
     * Counts for rooms with at least one pending notification.
     *
     * @generated from field: repeated chatto.api.v1.RoomNotificationCount room_counts = 1;
     */
    roomCounts: RoomNotificationCount[];
    constructor(data?: PartialMessage<ListRoomNotificationCountsResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListRoomNotificationCountsResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListRoomNotificationCountsResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListRoomNotificationCountsResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListRoomNotificationCountsResponse;
    static equals(a: ListRoomNotificationCountsResponse | PlainMessage<ListRoomNotificationCountsResponse> | undefined, b: ListRoomNotificationCountsResponse | PlainMessage<ListRoomNotificationCountsResponse> | undefined): boolean;
}
/**
 * Request to dismiss one pending notification.
 *
 * @generated from message chatto.api.v1.DismissNotificationRequest
 */
export declare class DismissNotificationRequest extends Message<DismissNotificationRequest> {
    /**
     * Required. Notification to dismiss.
     *
     * @generated from field: string notification_id = 1;
     */
    notificationId: string;
    constructor(data?: PartialMessage<DismissNotificationRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.DismissNotificationRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DismissNotificationRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DismissNotificationRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DismissNotificationRequest;
    static equals(a: DismissNotificationRequest | PlainMessage<DismissNotificationRequest> | undefined, b: DismissNotificationRequest | PlainMessage<DismissNotificationRequest> | undefined): boolean;
}
/**
 * Result of dismissing one pending notification.
 *
 * @generated from message chatto.api.v1.DismissNotificationResponse
 */
export declare class DismissNotificationResponse extends Message<DismissNotificationResponse> {
    /**
     * True when the notification is no longer pending.
     *
     * @generated from field: bool dismissed = 1;
     */
    dismissed: boolean;
    constructor(data?: PartialMessage<DismissNotificationResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.DismissNotificationResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DismissNotificationResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DismissNotificationResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DismissNotificationResponse;
    static equals(a: DismissNotificationResponse | PlainMessage<DismissNotificationResponse> | undefined, b: DismissNotificationResponse | PlainMessage<DismissNotificationResponse> | undefined): boolean;
}
/**
 * Request to dismiss all pending notifications.
 *
 * @generated from message chatto.api.v1.DismissAllNotificationsRequest
 */
export declare class DismissAllNotificationsRequest extends Message<DismissAllNotificationsRequest> {
    constructor(data?: PartialMessage<DismissAllNotificationsRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.DismissAllNotificationsRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DismissAllNotificationsRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DismissAllNotificationsRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DismissAllNotificationsRequest;
    static equals(a: DismissAllNotificationsRequest | PlainMessage<DismissAllNotificationsRequest> | undefined, b: DismissAllNotificationsRequest | PlainMessage<DismissAllNotificationsRequest> | undefined): boolean;
}
/**
 * Result of dismissing all pending notifications.
 *
 * @generated from message chatto.api.v1.DismissAllNotificationsResponse
 */
export declare class DismissAllNotificationsResponse extends Message<DismissAllNotificationsResponse> {
    /**
     * Number of notifications dismissed.
     *
     * @generated from field: int32 dismissed_count = 1;
     */
    dismissedCount: number;
    constructor(data?: PartialMessage<DismissAllNotificationsResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.DismissAllNotificationsResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DismissAllNotificationsResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DismissAllNotificationsResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DismissAllNotificationsResponse;
    static equals(a: DismissAllNotificationsResponse | PlainMessage<DismissAllNotificationsResponse> | undefined, b: DismissAllNotificationsResponse | PlainMessage<DismissAllNotificationsResponse> | undefined): boolean;
}
