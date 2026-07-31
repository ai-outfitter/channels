import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message as Message$1, proto3, Timestamp } from "@bufbuild/protobuf";
import { LinkPreview } from "./link_previews_pb.js";
/**
 * Processing state for a video attachment.
 *
 * @generated from enum chatto.api.v1.MessageVideoProcessingStatus
 */
export declare enum MessageVideoProcessingStatus {
    /**
     * The processing status was not specified.
     *
     * @generated from enum value: MESSAGE_VIDEO_PROCESSING_STATUS_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * Video processing is still running.
     *
     * @generated from enum value: MESSAGE_VIDEO_PROCESSING_STATUS_PROCESSING = 1;
     */
    PROCESSING = 1,
    /**
     * Video processing completed successfully.
     *
     * @generated from enum value: MESSAGE_VIDEO_PROCESSING_STATUS_COMPLETED = 2;
     */
    COMPLETED = 2,
    /**
     * Video processing failed.
     *
     * @generated from enum value: MESSAGE_VIDEO_PROCESSING_STATUS_FAILED = 3;
     */
    FAILED = 3
}
/**
 * Time-limited URL for an asset attached to a message.
 *
 * Clients should expect these URLs to expire and refresh the asset through
 * AssetService when a URL is no longer usable.
 *
 * @generated from message chatto.api.v1.MessageAssetUrl
 */
export declare class MessageAssetUrl extends Message$1<MessageAssetUrl> {
    /**
     * Signed asset URL.
     *
     * @generated from field: string url = 1;
     */
    url: string;
    /**
     * Time when the signed URL expires.
     *
     * @generated from field: google.protobuf.Timestamp expires_at = 2;
     */
    expiresAt?: Timestamp;
    constructor(data?: PartialMessage<MessageAssetUrl>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.MessageAssetUrl";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): MessageAssetUrl;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): MessageAssetUrl;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): MessageAssetUrl;
    static equals(a: MessageAssetUrl | PlainMessage<MessageAssetUrl> | undefined, b: MessageAssetUrl | PlainMessage<MessageAssetUrl> | undefined): boolean;
}
/**
 * One transcoded video rendition.
 *
 * @generated from message chatto.api.v1.MessageVideoVariant
 */
export declare class MessageVideoVariant extends Message$1<MessageVideoVariant> {
    /**
     * Quality label for the rendition.
     *
     * @generated from field: string quality = 1;
     */
    quality: string;
    /**
     * Video width in pixels.
     *
     * @generated from field: int32 width = 2;
     */
    width: number;
    /**
     * Video height in pixels.
     *
     * @generated from field: int32 height = 3;
     */
    height: number;
    /**
     * Rendition size in bytes.
     *
     * @generated from field: int64 size = 4;
     */
    size: bigint;
    /**
     * Signed URL for the rendition.
     *
     * @generated from field: chatto.api.v1.MessageAssetUrl asset_url = 5;
     */
    assetUrl?: MessageAssetUrl;
    constructor(data?: PartialMessage<MessageVideoVariant>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.MessageVideoVariant";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): MessageVideoVariant;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): MessageVideoVariant;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): MessageVideoVariant;
    static equals(a: MessageVideoVariant | PlainMessage<MessageVideoVariant> | undefined, b: MessageVideoVariant | PlainMessage<MessageVideoVariant> | undefined): boolean;
}
/**
 * HLS adaptive-streaming metadata for a processed video.
 *
 * @generated from message chatto.api.v1.MessageVideoHLS
 */
export declare class MessageVideoHLS extends Message$1<MessageVideoHLS> {
    /**
     * Signed URL for the HLS master playlist. The URL authorises all playlists
     * and segments in this video generation and expires with the attachment URL.
     *
     * @generated from field: chatto.api.v1.MessageAssetUrl master_playlist_url = 1;
     */
    masterPlaylistUrl?: MessageAssetUrl;
    constructor(data?: PartialMessage<MessageVideoHLS>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.MessageVideoHLS";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): MessageVideoHLS;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): MessageVideoHLS;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): MessageVideoHLS;
    static equals(a: MessageVideoHLS | PlainMessage<MessageVideoHLS> | undefined, b: MessageVideoHLS | PlainMessage<MessageVideoHLS> | undefined): boolean;
}
/**
 * Processing metadata for a video attachment.
 *
 * Clients can use this object to show upload/transcoding progress and decide
 * whether to play a processed variant, show a thumbnail, or display a failure
 * state.
 *
 * @generated from message chatto.api.v1.MessageVideoProcessing
 */
export declare class MessageVideoProcessing extends Message$1<MessageVideoProcessing> {
    /**
     * Current processing status.
     *
     * @generated from field: chatto.api.v1.MessageVideoProcessingStatus status = 1;
     */
    status: MessageVideoProcessingStatus;
    /**
     * Video duration in milliseconds.
     *
     * @generated from field: int64 duration_ms = 2;
     */
    durationMs: bigint;
    /**
     * Source video width in pixels.
     *
     * @generated from field: int32 width = 3;
     */
    width: number;
    /**
     * Source video height in pixels.
     *
     * @generated from field: int32 height = 4;
     */
    height: number;
    /**
     * True when the original source asset is currently available.
     *
     * @generated from field: bool source_available = 5;
     */
    sourceAvailable: boolean;
    /**
     * Stable reason code for a failed or incomplete processing state.
     *
     * @generated from field: string reason_code = 6;
     */
    reasonCode: string;
    /**
     * Signed URL for the generated thumbnail, when available.
     *
     * @generated from field: chatto.api.v1.MessageAssetUrl thumbnail_asset_url = 7;
     */
    thumbnailAssetUrl?: MessageAssetUrl;
    /**
     * Available transcoded renditions.
     *
     * @generated from field: repeated chatto.api.v1.MessageVideoVariant variants = 8;
     */
    variants: MessageVideoVariant[];
    /**
     * Adaptive-streaming metadata. Absent on MP4-only historical results and
     * servers that do not support HLS processing.
     *
     * @generated from field: chatto.api.v1.MessageVideoHLS hls = 9;
     */
    hls?: MessageVideoHLS;
    constructor(data?: PartialMessage<MessageVideoProcessing>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.MessageVideoProcessing";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): MessageVideoProcessing;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): MessageVideoProcessing;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): MessageVideoProcessing;
    static equals(a: MessageVideoProcessing | PlainMessage<MessageVideoProcessing> | undefined, b: MessageVideoProcessing | PlainMessage<MessageVideoProcessing> | undefined): boolean;
}
/**
 * Attachment metadata included with a message.
 *
 * Image and video dimensions are best-effort metadata for layout. Asset URLs can
 * be absent while processing is pending or when the source is unavailable.
 *
 * @generated from message chatto.api.v1.MessageAttachment
 */
export declare class MessageAttachment extends Message$1<MessageAttachment> {
    /**
     * Stable attachment ID.
     *
     * @generated from field: string id = 1;
     */
    id: string;
    /**
     * Original filename.
     *
     * @generated from field: string filename = 2;
     */
    filename: string;
    /**
     * MIME content type.
     *
     * @generated from field: string content_type = 3;
     */
    contentType: string;
    /**
     * Image or video width in pixels, when known.
     *
     * @generated from field: int32 width = 4;
     */
    width: number;
    /**
     * Image or video height in pixels, when known.
     *
     * @generated from field: int32 height = 5;
     */
    height: number;
    /**
     * Signed URL for the original asset, when available.
     *
     * @generated from field: chatto.api.v1.MessageAssetUrl asset_url = 6;
     */
    assetUrl?: MessageAssetUrl;
    /**
     * Signed URL for a thumbnail image, when available.
     *
     * @generated from field: chatto.api.v1.MessageAssetUrl thumbnail_asset_url = 7;
     */
    thumbnailAssetUrl?: MessageAssetUrl;
    /**
     * Video-specific processing metadata, when this attachment is a video.
     *
     * @generated from field: chatto.api.v1.MessageVideoProcessing video_processing = 8;
     */
    videoProcessing?: MessageVideoProcessing;
    constructor(data?: PartialMessage<MessageAttachment>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.MessageAttachment";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): MessageAttachment;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): MessageAttachment;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): MessageAttachment;
    static equals(a: MessageAttachment | PlainMessage<MessageAttachment> | undefined, b: MessageAttachment | PlainMessage<MessageAttachment> | undefined): boolean;
}
/**
 * Aggregated reaction state for one emoji on one message.
 *
 * This state is scoped to the current message and includes whether the current
 * user has reacted with the same emoji.
 *
 * @generated from message chatto.api.v1.MessageReaction
 */
export declare class MessageReaction extends Message$1<MessageReaction> {
    /**
     * Emoji or reaction key.
     *
     * @generated from field: string emoji = 1;
     */
    emoji: string;
    /**
     * Number of users who reacted with this emoji.
     *
     * @generated from field: int32 count = 2;
     */
    count: number;
    /**
     * True when the current user reacted with this emoji.
     *
     * @generated from field: bool has_reacted = 3;
     */
    hasReacted: boolean;
    /**
     * Preview of up to five user IDs that reacted with this emoji.
     *
     * @generated from field: repeated string preview_user_ids = 4;
     */
    previewUserIds: string[];
    constructor(data?: PartialMessage<MessageReaction>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.MessageReaction";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): MessageReaction;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): MessageReaction;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): MessageReaction;
    static equals(a: MessageReaction | PlainMessage<MessageReaction> | undefined, b: MessageReaction | PlainMessage<MessageReaction> | undefined): boolean;
}
/**
 * Viewer-specific state for one message thread.
 *
 * @generated from message chatto.api.v1.ThreadViewerState
 */
export declare class ThreadViewerState extends Message$1<ThreadViewerState> {
    /**
     * Whether the current user follows this message's thread, when known.
     *
     * @generated from field: optional bool is_following = 1;
     */
    isFollowing?: boolean;
    /**
     * True when the thread has unread replies for the current user, when known.
     *
     * @generated from field: optional bool has_unread = 2;
     */
    hasUnread?: boolean;
    constructor(data?: PartialMessage<ThreadViewerState>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ThreadViewerState";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ThreadViewerState;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ThreadViewerState;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ThreadViewerState;
    static equals(a: ThreadViewerState | PlainMessage<ThreadViewerState> | undefined, b: ThreadViewerState | PlainMessage<ThreadViewerState> | undefined): boolean;
}
/**
 * Aggregated state for one message thread.
 *
 * @generated from message chatto.api.v1.ThreadSummary
 */
export declare class ThreadSummary extends Message$1<ThreadSummary> {
    /**
     * Event ID of the root message for the thread.
     *
     * @generated from field: string thread_root_event_id = 1;
     */
    threadRootEventId: string;
    /**
     * Number of replies in this message's thread.
     *
     * @generated from field: int32 reply_count = 2;
     */
    replyCount: number;
    /**
     * Creation time of the most recent reply in this message's thread.
     *
     * @generated from field: google.protobuf.Timestamp last_reply_at = 3;
     */
    lastReplyAt?: Timestamp;
    /**
     * Preview of up to five user IDs that have participated in this message's
     * thread.
     *
     * @generated from field: repeated string participant_preview_user_ids = 4;
     */
    participantPreviewUserIds: string[];
    /**
     * Total number of distinct users that have participated in this message's
     * thread.
     *
     * @generated from field: int32 participant_count = 5;
     */
    participantCount: number;
    /**
     * State resolved for the current user.
     *
     * @generated from field: chatto.api.v1.ThreadViewerState viewer_state = 6;
     */
    viewerState?: ThreadViewerState;
    constructor(data?: PartialMessage<ThreadSummary>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ThreadSummary";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ThreadSummary;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ThreadSummary;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ThreadSummary;
    static equals(a: ThreadSummary | PlainMessage<ThreadSummary> | undefined, b: ThreadSummary | PlainMessage<ThreadSummary> | undefined): boolean;
}
/**
 * Renderable message data.
 *
 * The same shape is used for top-level room messages, thread replies, and
 * thread echo entries. Thread-related fields let clients render reply counts,
 * thread participants, and follow state without additional per-message
 * requests.
 *
 * @generated from message chatto.api.v1.Message
 */
export declare class Message extends Message$1<Message> {
    /**
     * Stable message event ID.
     *
     * @generated from field: string id = 1;
     */
    id: string;
    /**
     * Room containing the message.
     *
     * @generated from field: string room_id = 2;
     */
    roomId: string;
    /**
     * Time when the message was created.
     *
     * @generated from field: google.protobuf.Timestamp created_at = 3;
     */
    createdAt?: Timestamp;
    /**
     * User ID of the message actor.
     *
     * @generated from field: string actor_id = 4;
     */
    actorId: string;
    /**
     * Message body text, when available. A present empty string is distinct from
     * an absent body.
     *
     * @generated from field: optional string body = 5;
     */
    body?: string;
    /**
     * Attachments sent with the message.
     *
     * @generated from field: repeated chatto.api.v1.MessageAttachment attachments = 6;
     */
    attachments: MessageAttachment[];
    /**
     * Link preview extracted for the message, when available.
     *
     * @generated from field: chatto.api.v1.LinkPreview link_preview = 7;
     */
    linkPreview?: LinkPreview;
    /**
     * Time when the message was last edited.
     *
     * @generated from field: google.protobuf.Timestamp updated_at = 8;
     */
    updatedAt?: Timestamp;
    /**
     * Event ID this message directly replies to, when this is a reply.
     *
     * @generated from field: string in_reply_to = 9;
     */
    inReplyTo: string;
    /**
     * Event ID of the root message for the thread this message belongs to.
     *
     * @generated from field: string thread_root_event_id = 10;
     */
    threadRootEventId: string;
    /**
     * Event ID this event echoes into the current view, when applicable. Echoes
     * allow thread activity to appear in another timeline context.
     *
     * @generated from field: string echo_of_event_id = 11;
     */
    echoOfEventId: string;
    /**
     * Thread root ID of the echoed event, when applicable.
     *
     * @generated from field: string echo_from_thread_root_event_id = 12;
     */
    echoFromThreadRootEventId: string;
    /**
     * Channel timeline event ID for a thread echo, when applicable.
     *
     * @generated from field: string channel_echo_event_id = 13;
     */
    channelEchoEventId: string;
    /**
     * Reaction summaries for this message.
     *
     * @generated from field: repeated chatto.api.v1.MessageReaction reactions = 19;
     */
    reactions: MessageReaction[];
    /**
     * Aggregated thread state, when known for a thread root message.
     *
     * @generated from field: chatto.api.v1.ThreadSummary thread = 20;
     */
    thread?: ThreadSummary;
    /**
     * Time when the message content was deleted through retraction or account
     * crypto-shredding. Absent when unavailable body content is not a deletion.
     *
     * @generated from field: google.protobuf.Timestamp deleted_at = 21;
     */
    deletedAt?: Timestamp;
    constructor(data?: PartialMessage<Message>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.Message";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): Message;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): Message;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): Message;
    static equals(a: Message | PlainMessage<Message> | undefined, b: Message | PlainMessage<Message> | undefined): boolean;
}
