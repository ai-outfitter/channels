import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3 } from "@bufbuild/protobuf";
import { Message as Message$1 } from "./message_types_pb.js";
/**
 * Request to create a message in a room or thread.
 *
 * @generated from message chatto.api.v1.CreateMessageRequest
 */
export declare class CreateMessageRequest extends Message<CreateMessageRequest> {
    /**
     * Required. Room where the message should be created.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Message body text. Required unless attachment_asset_ids is non-empty.
     *
     * @generated from field: string body = 2;
     */
    body: string;
    /**
     * Existing room-scoped attachment asset IDs to include with the message.
     * At most 10 IDs may be supplied.
     *
     * @generated from field: repeated string attachment_asset_ids = 3;
     */
    attachmentAssetIds: string[];
    /**
     * Event ID of the thread root message when posting a thread reply.
     *
     * @generated from field: string thread_root_event_id = 4;
     */
    threadRootEventId: string;
    /**
     * Event ID this message replies to for attribution.
     *
     * @generated from field: string in_reply_to = 5;
     */
    inReplyTo: string;
    /**
     * True to also echo a thread reply into the main room timeline.
     *
     * @generated from field: bool also_send_to_channel = 6;
     */
    alsoSendToChannel: boolean;
    /**
     * Short-lived token returned by FetchLinkPreview for the selected URL. The
     * server resolves the token to cached, server-fetched metadata during post.
     *
     * @generated from field: string link_preview_token = 10;
     */
    linkPreviewToken: string;
    constructor(data?: PartialMessage<CreateMessageRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.CreateMessageRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): CreateMessageRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): CreateMessageRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): CreateMessageRequest;
    static equals(a: CreateMessageRequest | PlainMessage<CreateMessageRequest> | undefined, b: CreateMessageRequest | PlainMessage<CreateMessageRequest> | undefined): boolean;
}
/**
 * Result of creating a message.
 *
 * @generated from message chatto.api.v1.CreateMessageResponse
 */
export declare class CreateMessageResponse extends Message<CreateMessageResponse> {
    /**
     * Renderable message created by the request.
     *
     * @generated from field: chatto.api.v1.Message message = 1;
     */
    message?: Message$1;
    constructor(data?: PartialMessage<CreateMessageResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.CreateMessageResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): CreateMessageResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): CreateMessageResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): CreateMessageResponse;
    static equals(a: CreateMessageResponse | PlainMessage<CreateMessageResponse> | undefined, b: CreateMessageResponse | PlainMessage<CreateMessageResponse> | undefined): boolean;
}
/**
 * Request to patch a message.
 *
 * @generated from message chatto.api.v1.UpdateMessageRequest
 */
export declare class UpdateMessageRequest extends Message<UpdateMessageRequest> {
    /**
     * Required. Room containing the message.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Required. Event ID of the message to edit.
     *
     * @generated from field: string event_id = 2;
     */
    eventId: string;
    /**
     * New message body text. Omit to preserve the current body.
     *
     * @generated from field: optional string body = 3;
     */
    body?: string;
    /**
     * For thread replies, whether a channel echo should exist after saving.
     * Omit to preserve the current echo state.
     *
     * @generated from field: optional bool also_send_to_channel = 4;
     */
    alsoSendToChannel?: boolean;
    constructor(data?: PartialMessage<UpdateMessageRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UpdateMessageRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UpdateMessageRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UpdateMessageRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UpdateMessageRequest;
    static equals(a: UpdateMessageRequest | PlainMessage<UpdateMessageRequest> | undefined, b: UpdateMessageRequest | PlainMessage<UpdateMessageRequest> | undefined): boolean;
}
/**
 * Result of editing a message.
 *
 * @generated from message chatto.api.v1.UpdateMessageResponse
 */
export declare class UpdateMessageResponse extends Message<UpdateMessageResponse> {
    /**
     * Renderable message after the edit.
     *
     * @generated from field: chatto.api.v1.Message message = 2;
     */
    message?: Message$1;
    constructor(data?: PartialMessage<UpdateMessageResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UpdateMessageResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UpdateMessageResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UpdateMessageResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UpdateMessageResponse;
    static equals(a: UpdateMessageResponse | PlainMessage<UpdateMessageResponse> | undefined, b: UpdateMessageResponse | PlainMessage<UpdateMessageResponse> | undefined): boolean;
}
/**
 * Request to retract a message.
 *
 * @generated from message chatto.api.v1.DeleteMessageRequest
 */
export declare class DeleteMessageRequest extends Message<DeleteMessageRequest> {
    /**
     * Required. Room containing the message.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Required. Event ID of the message to retract.
     *
     * @generated from field: string event_id = 2;
     */
    eventId: string;
    constructor(data?: PartialMessage<DeleteMessageRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.DeleteMessageRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DeleteMessageRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DeleteMessageRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DeleteMessageRequest;
    static equals(a: DeleteMessageRequest | PlainMessage<DeleteMessageRequest> | undefined, b: DeleteMessageRequest | PlainMessage<DeleteMessageRequest> | undefined): boolean;
}
/**
 * Result of retracting a message.
 *
 * @generated from message chatto.api.v1.DeleteMessageResponse
 */
export declare class DeleteMessageResponse extends Message<DeleteMessageResponse> {
    /**
     * True when the delete/retract request was accepted.
     *
     * @generated from field: bool deleted = 1;
     */
    deleted: boolean;
    constructor(data?: PartialMessage<DeleteMessageResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.DeleteMessageResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DeleteMessageResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DeleteMessageResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DeleteMessageResponse;
    static equals(a: DeleteMessageResponse | PlainMessage<DeleteMessageResponse> | undefined, b: DeleteMessageResponse | PlainMessage<DeleteMessageResponse> | undefined): boolean;
}
/**
 * Request to remove one attachment from a message.
 *
 * @generated from message chatto.api.v1.DeleteAttachmentRequest
 */
export declare class DeleteAttachmentRequest extends Message<DeleteAttachmentRequest> {
    /**
     * Required. Room containing the message.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Required. Event ID of the message containing the attachment.
     *
     * @generated from field: string event_id = 2;
     */
    eventId: string;
    /**
     * Required. Attachment ID to remove from the message.
     *
     * @generated from field: string attachment_id = 3;
     */
    attachmentId: string;
    constructor(data?: PartialMessage<DeleteAttachmentRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.DeleteAttachmentRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DeleteAttachmentRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DeleteAttachmentRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DeleteAttachmentRequest;
    static equals(a: DeleteAttachmentRequest | PlainMessage<DeleteAttachmentRequest> | undefined, b: DeleteAttachmentRequest | PlainMessage<DeleteAttachmentRequest> | undefined): boolean;
}
/**
 * Result of removing one attachment from a message.
 *
 * @generated from message chatto.api.v1.DeleteAttachmentResponse
 */
export declare class DeleteAttachmentResponse extends Message<DeleteAttachmentResponse> {
    /**
     * True when the attachment removal was accepted.
     *
     * @generated from field: bool deleted = 1;
     */
    deleted: boolean;
    constructor(data?: PartialMessage<DeleteAttachmentResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.DeleteAttachmentResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DeleteAttachmentResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DeleteAttachmentResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DeleteAttachmentResponse;
    static equals(a: DeleteAttachmentResponse | PlainMessage<DeleteAttachmentResponse> | undefined, b: DeleteAttachmentResponse | PlainMessage<DeleteAttachmentResponse> | undefined): boolean;
}
/**
 * Request to remove the accepted link preview from a message.
 *
 * @generated from message chatto.api.v1.DeleteLinkPreviewRequest
 */
export declare class DeleteLinkPreviewRequest extends Message<DeleteLinkPreviewRequest> {
    /**
     * Required. Room containing the message.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Required. Event ID of the message containing the link preview.
     *
     * @generated from field: string event_id = 2;
     */
    eventId: string;
    /**
     * Required. URL of the link preview to remove.
     *
     * @generated from field: string url = 3;
     */
    url: string;
    constructor(data?: PartialMessage<DeleteLinkPreviewRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.DeleteLinkPreviewRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DeleteLinkPreviewRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DeleteLinkPreviewRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DeleteLinkPreviewRequest;
    static equals(a: DeleteLinkPreviewRequest | PlainMessage<DeleteLinkPreviewRequest> | undefined, b: DeleteLinkPreviewRequest | PlainMessage<DeleteLinkPreviewRequest> | undefined): boolean;
}
/**
 * Result of removing a link preview from a message.
 *
 * @generated from message chatto.api.v1.DeleteLinkPreviewResponse
 */
export declare class DeleteLinkPreviewResponse extends Message<DeleteLinkPreviewResponse> {
    /**
     * True when the link preview removal was accepted.
     *
     * @generated from field: bool deleted = 1;
     */
    deleted: boolean;
    constructor(data?: PartialMessage<DeleteLinkPreviewResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.DeleteLinkPreviewResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DeleteLinkPreviewResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DeleteLinkPreviewResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DeleteLinkPreviewResponse;
    static equals(a: DeleteLinkPreviewResponse | PlainMessage<DeleteLinkPreviewResponse> | undefined, b: DeleteLinkPreviewResponse | PlainMessage<DeleteLinkPreviewResponse> | undefined): boolean;
}
/**
 * Request to read one visible message.
 *
 * @generated from message chatto.api.v1.GetMessageRequest
 */
export declare class GetMessageRequest extends Message<GetMessageRequest> {
    /**
     * Required. Room containing the message.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Required. Message event ID.
     *
     * @generated from field: string event_id = 2;
     */
    eventId: string;
    constructor(data?: PartialMessage<GetMessageRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetMessageRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetMessageRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetMessageRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetMessageRequest;
    static equals(a: GetMessageRequest | PlainMessage<GetMessageRequest> | undefined, b: GetMessageRequest | PlainMessage<GetMessageRequest> | undefined): boolean;
}
/**
 * Response containing one renderable message.
 *
 * @generated from message chatto.api.v1.GetMessageResponse
 */
export declare class GetMessageResponse extends Message<GetMessageResponse> {
    /**
     * Renderable message.
     *
     * @generated from field: chatto.api.v1.Message message = 1;
     */
    message?: Message$1;
    constructor(data?: PartialMessage<GetMessageResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetMessageResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetMessageResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetMessageResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetMessageResponse;
    static equals(a: GetMessageResponse | PlainMessage<GetMessageResponse> | undefined, b: GetMessageResponse | PlainMessage<GetMessageResponse> | undefined): boolean;
}
/**
 * Request to read many visible messages in one room.
 *
 * @generated from message chatto.api.v1.BatchGetMessagesRequest
 */
export declare class BatchGetMessagesRequest extends Message<BatchGetMessagesRequest> {
    /**
     * Required. Room containing the messages.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Required. Message event IDs. Missing, retracted, non-message, and
     * wrong-room event IDs are omitted from the response.
     *
     * @generated from field: repeated string event_ids = 2;
     */
    eventIds: string[];
    constructor(data?: PartialMessage<BatchGetMessagesRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.BatchGetMessagesRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): BatchGetMessagesRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): BatchGetMessagesRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): BatchGetMessagesRequest;
    static equals(a: BatchGetMessagesRequest | PlainMessage<BatchGetMessagesRequest> | undefined, b: BatchGetMessagesRequest | PlainMessage<BatchGetMessagesRequest> | undefined): boolean;
}
/**
 * Response containing renderable messages.
 *
 * @generated from message chatto.api.v1.BatchGetMessagesResponse
 */
export declare class BatchGetMessagesResponse extends Message<BatchGetMessagesResponse> {
    /**
     * Renderable messages in first-seen request order.
     *
     * @generated from field: repeated chatto.api.v1.Message messages = 1;
     */
    messages: Message$1[];
    constructor(data?: PartialMessage<BatchGetMessagesResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.BatchGetMessagesResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): BatchGetMessagesResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): BatchGetMessagesResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): BatchGetMessagesResponse;
    static equals(a: BatchGetMessagesResponse | PlainMessage<BatchGetMessagesResponse> | undefined, b: BatchGetMessagesResponse | PlainMessage<BatchGetMessagesResponse> | undefined): boolean;
}
