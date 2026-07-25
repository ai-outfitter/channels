import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3 } from "@bufbuild/protobuf";
/**
 * Notification delivery level for a room.
 *
 * @generated from enum chatto.api.v1.NotificationLevel
 */
export declare enum NotificationLevel {
    /**
     * The level was not specified.
     *
     * @generated from enum value: NOTIFICATION_LEVEL_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * Use the inherited default for the room.
     *
     * @generated from enum value: NOTIFICATION_LEVEL_DEFAULT = 1;
     */
    DEFAULT = 1,
    /**
     * Do not notify for this room.
     *
     * @generated from enum value: NOTIFICATION_LEVEL_MUTED = 2;
     */
    MUTED = 2,
    /**
     * Notify according to the normal room rules.
     *
     * @generated from enum value: NOTIFICATION_LEVEL_NORMAL = 3;
     */
    NORMAL = 3,
    /**
     * Notify for every message in the room.
     *
     * @generated from enum value: NOTIFICATION_LEVEL_ALL_MESSAGES = 4;
     */
    ALL_MESSAGES = 4
}
/**
 * Stored and effective notification preference.
 *
 * @generated from message chatto.api.v1.NotificationPreference
 */
export declare class NotificationPreference extends Message<NotificationPreference> {
    /**
     * Explicit level stored for the current user.
     *
     * @generated from field: chatto.api.v1.NotificationLevel level = 1;
     */
    level: NotificationLevel;
    /**
     * Level after applying defaults and inheritance.
     *
     * @generated from field: chatto.api.v1.NotificationLevel effective_level = 2;
     */
    effectiveLevel: NotificationLevel;
    constructor(data?: PartialMessage<NotificationPreference>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.NotificationPreference";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): NotificationPreference;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): NotificationPreference;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): NotificationPreference;
    static equals(a: NotificationPreference | PlainMessage<NotificationPreference> | undefined, b: NotificationPreference | PlainMessage<NotificationPreference> | undefined): boolean;
}
/**
 * Current notification preference.
 *
 * @generated from message chatto.api.v1.GetNotificationPreferenceResponse
 */
export declare class GetNotificationPreferenceResponse extends Message<GetNotificationPreferenceResponse> {
    /**
     * Current stored and effective notification preference.
     *
     * @generated from field: chatto.api.v1.NotificationPreference preference = 3;
     */
    preference?: NotificationPreference;
    constructor(data?: PartialMessage<GetNotificationPreferenceResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetNotificationPreferenceResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetNotificationPreferenceResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetNotificationPreferenceResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetNotificationPreferenceResponse;
    static equals(a: GetNotificationPreferenceResponse | PlainMessage<GetNotificationPreferenceResponse> | undefined, b: GetNotificationPreferenceResponse | PlainMessage<GetNotificationPreferenceResponse> | undefined): boolean;
}
/**
 * Updated notification preference.
 *
 * @generated from message chatto.api.v1.UpdateNotificationPreferenceResponse
 */
export declare class UpdateNotificationPreferenceResponse extends Message<UpdateNotificationPreferenceResponse> {
    /**
     * Stored and effective notification preference after the update.
     *
     * @generated from field: chatto.api.v1.NotificationPreference preference = 3;
     */
    preference?: NotificationPreference;
    constructor(data?: PartialMessage<UpdateNotificationPreferenceResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UpdateNotificationPreferenceResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UpdateNotificationPreferenceResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UpdateNotificationPreferenceResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UpdateNotificationPreferenceResponse;
    static equals(a: UpdateNotificationPreferenceResponse | PlainMessage<UpdateNotificationPreferenceResponse> | undefined, b: UpdateNotificationPreferenceResponse | PlainMessage<UpdateNotificationPreferenceResponse> | undefined): boolean;
}
/**
 * Request for the current user's server-level notification preference.
 *
 * @generated from message chatto.api.v1.GetServerNotificationPreferenceRequest
 */
export declare class GetServerNotificationPreferenceRequest extends Message<GetServerNotificationPreferenceRequest> {
    constructor(data?: PartialMessage<GetServerNotificationPreferenceRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetServerNotificationPreferenceRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetServerNotificationPreferenceRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetServerNotificationPreferenceRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetServerNotificationPreferenceRequest;
    static equals(a: GetServerNotificationPreferenceRequest | PlainMessage<GetServerNotificationPreferenceRequest> | undefined, b: GetServerNotificationPreferenceRequest | PlainMessage<GetServerNotificationPreferenceRequest> | undefined): boolean;
}
/**
 * Request to update the current user's server-level notification level.
 *
 * @generated from message chatto.api.v1.UpdateServerNotificationPreferenceRequest
 */
export declare class UpdateServerNotificationPreferenceRequest extends Message<UpdateServerNotificationPreferenceRequest> {
    /**
     * Required. New explicit notification level. Use NOTIFICATION_LEVEL_DEFAULT
     * to return the server to default behavior.
     *
     * @generated from field: chatto.api.v1.NotificationLevel level = 1;
     */
    level: NotificationLevel;
    constructor(data?: PartialMessage<UpdateServerNotificationPreferenceRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UpdateServerNotificationPreferenceRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UpdateServerNotificationPreferenceRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UpdateServerNotificationPreferenceRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UpdateServerNotificationPreferenceRequest;
    static equals(a: UpdateServerNotificationPreferenceRequest | PlainMessage<UpdateServerNotificationPreferenceRequest> | undefined, b: UpdateServerNotificationPreferenceRequest | PlainMessage<UpdateServerNotificationPreferenceRequest> | undefined): boolean;
}
/**
 * Request for the current user's notification preference in one room.
 *
 * @generated from message chatto.api.v1.GetRoomNotificationPreferenceRequest
 */
export declare class GetRoomNotificationPreferenceRequest extends Message<GetRoomNotificationPreferenceRequest> {
    /**
     * Required. Room whose notification preference should be loaded for the current user.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    constructor(data?: PartialMessage<GetRoomNotificationPreferenceRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetRoomNotificationPreferenceRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetRoomNotificationPreferenceRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetRoomNotificationPreferenceRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetRoomNotificationPreferenceRequest;
    static equals(a: GetRoomNotificationPreferenceRequest | PlainMessage<GetRoomNotificationPreferenceRequest> | undefined, b: GetRoomNotificationPreferenceRequest | PlainMessage<GetRoomNotificationPreferenceRequest> | undefined): boolean;
}
/**
 * Request to update the current user's notification level in one room.
 *
 * @generated from message chatto.api.v1.UpdateRoomNotificationPreferenceRequest
 */
export declare class UpdateRoomNotificationPreferenceRequest extends Message<UpdateRoomNotificationPreferenceRequest> {
    /**
     * Required. Room whose notification level should be changed for the current user.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Required. New explicit notification level. Use NOTIFICATION_LEVEL_DEFAULT
     * to return the room to inherited/default behavior.
     *
     * @generated from field: chatto.api.v1.NotificationLevel level = 2;
     */
    level: NotificationLevel;
    constructor(data?: PartialMessage<UpdateRoomNotificationPreferenceRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UpdateRoomNotificationPreferenceRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UpdateRoomNotificationPreferenceRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UpdateRoomNotificationPreferenceRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UpdateRoomNotificationPreferenceRequest;
    static equals(a: UpdateRoomNotificationPreferenceRequest | PlainMessage<UpdateRoomNotificationPreferenceRequest> | undefined, b: UpdateRoomNotificationPreferenceRequest | PlainMessage<UpdateRoomNotificationPreferenceRequest> | undefined): boolean;
}
