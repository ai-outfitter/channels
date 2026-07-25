import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3, Timestamp } from "@bufbuild/protobuf";
/**
 * Request to mark a room timeline as read.
 *
 * @generated from message chatto.api.v1.MarkRoomAsReadRequest
 */
export declare class MarkRoomAsReadRequest extends Message<MarkRoomAsReadRequest> {
    /**
     * Required. Room whose timeline should be marked read.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Highest room event ID the current user has read. When set, the event must
     * exist as a root event in the room timeline. Leave empty to mark through the
     * room's current latest root event.
     *
     * @generated from field: string up_to_event_id = 2;
     */
    upToEventId: string;
    constructor(data?: PartialMessage<MarkRoomAsReadRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.MarkRoomAsReadRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): MarkRoomAsReadRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): MarkRoomAsReadRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): MarkRoomAsReadRequest;
    static equals(a: MarkRoomAsReadRequest | PlainMessage<MarkRoomAsReadRequest> | undefined, b: MarkRoomAsReadRequest | PlainMessage<MarkRoomAsReadRequest> | undefined): boolean;
}
/**
 * Result of marking a room timeline as read.
 *
 * Clients can use the previous timestamp to decide whether unread badges or
 * local notification state need to be reconciled.
 *
 * @generated from message chatto.api.v1.MarkRoomAsReadResponse
 */
export declare class MarkRoomAsReadResponse extends Message<MarkRoomAsReadResponse> {
    /**
     * New room read timestamp stored for the current user.
     *
     * @generated from field: google.protobuf.Timestamp last_read_at = 1;
     */
    lastReadAt?: Timestamp;
    /**
     * Previous room read timestamp, when one existed.
     *
     * @generated from field: google.protobuf.Timestamp previous_last_read_at = 2;
     */
    previousLastReadAt?: Timestamp;
    constructor(data?: PartialMessage<MarkRoomAsReadResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.MarkRoomAsReadResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): MarkRoomAsReadResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): MarkRoomAsReadResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): MarkRoomAsReadResponse;
    static equals(a: MarkRoomAsReadResponse | PlainMessage<MarkRoomAsReadResponse> | undefined, b: MarkRoomAsReadResponse | PlainMessage<MarkRoomAsReadResponse> | undefined): boolean;
}
/**
 * Request to mark a message thread as read.
 *
 * @generated from message chatto.api.v1.MarkThreadAsReadRequest
 */
export declare class MarkThreadAsReadRequest extends Message<MarkThreadAsReadRequest> {
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
     * Highest thread event ID the current user has read. The event should belong
     * to the thread identified by thread_root_event_id.
     *
     * @generated from field: string up_to_event_id = 3;
     */
    upToEventId: string;
    constructor(data?: PartialMessage<MarkThreadAsReadRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.MarkThreadAsReadRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): MarkThreadAsReadRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): MarkThreadAsReadRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): MarkThreadAsReadRequest;
    static equals(a: MarkThreadAsReadRequest | PlainMessage<MarkThreadAsReadRequest> | undefined, b: MarkThreadAsReadRequest | PlainMessage<MarkThreadAsReadRequest> | undefined): boolean;
}
/**
 * Result of marking a message thread as read.
 *
 * @generated from message chatto.api.v1.MarkThreadAsReadResponse
 */
export declare class MarkThreadAsReadResponse extends Message<MarkThreadAsReadResponse> {
    /**
     * Previous thread read timestamp, when one existed.
     *
     * @generated from field: google.protobuf.Timestamp previous_read_at = 1;
     */
    previousReadAt?: Timestamp;
    constructor(data?: PartialMessage<MarkThreadAsReadResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.MarkThreadAsReadResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): MarkThreadAsReadResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): MarkThreadAsReadResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): MarkThreadAsReadResponse;
    static equals(a: MarkThreadAsReadResponse | PlainMessage<MarkThreadAsReadResponse> | undefined, b: MarkThreadAsReadResponse | PlainMessage<MarkThreadAsReadResponse> | undefined): boolean;
}
