import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3 } from "@bufbuild/protobuf";
/**
 * Request for the authenticated message of the day.
 *
 * @generated from message chatto.api.v1.GetMotdRequest
 */
export declare class GetMotdRequest extends Message<GetMotdRequest> {
    constructor(data?: PartialMessage<GetMotdRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetMotdRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetMotdRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetMotdRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetMotdRequest;
    static equals(a: GetMotdRequest | PlainMessage<GetMotdRequest> | undefined, b: GetMotdRequest | PlainMessage<GetMotdRequest> | undefined): boolean;
}
/**
 * Authenticated message of the day response.
 *
 * @generated from message chatto.api.v1.GetMotdResponse
 */
export declare class GetMotdResponse extends Message<GetMotdResponse> {
    /**
     * Optional message of the day shown to authenticated members.
     *
     * @generated from field: optional string motd = 1;
     */
    motd?: string;
    constructor(data?: PartialMessage<GetMotdResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetMotdResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetMotdResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetMotdResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetMotdResponse;
    static equals(a: GetMotdResponse | PlainMessage<GetMotdResponse> | undefined, b: GetMotdResponse | PlainMessage<GetMotdResponse> | undefined): boolean;
}
/**
 * Authenticated server runtime settings used by clients.
 *
 * @generated from message chatto.api.v1.ServerRuntimeConfig
 */
export declare class ServerRuntimeConfig extends Message<ServerRuntimeConfig> {
    /**
     * Whether Web Push notifications are fully configured.
     *
     * @generated from field: bool push_notifications_enabled = 1;
     */
    pushNotificationsEnabled: boolean;
    /**
     * Optional VAPID public key for Web Push registration.
     *
     * @generated from field: optional string vapid_public_key = 2;
     */
    vapidPublicKey?: string;
    /**
     * Optional LiveKit URL for voice and video calls.
     *
     * @generated from field: optional string livekit_url = 3;
     */
    livekitUrl?: string;
    /**
     * Whether video processing is enabled.
     *
     * @generated from field: bool video_processing_enabled = 5;
     */
    videoProcessingEnabled: boolean;
    /**
     * Maximum general upload size in bytes.
     *
     * @generated from field: int64 max_upload_size = 6;
     */
    maxUploadSize: bigint;
    /**
     * Maximum video upload size in bytes.
     *
     * @generated from field: int64 max_video_upload_size = 7;
     */
    maxVideoUploadSize: bigint;
    /**
     * Message edit window in seconds.
     *
     * @generated from field: int32 message_edit_window_seconds = 8;
     */
    messageEditWindowSeconds: number;
    constructor(data?: PartialMessage<ServerRuntimeConfig>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ServerRuntimeConfig";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ServerRuntimeConfig;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ServerRuntimeConfig;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ServerRuntimeConfig;
    static equals(a: ServerRuntimeConfig | PlainMessage<ServerRuntimeConfig> | undefined, b: ServerRuntimeConfig | PlainMessage<ServerRuntimeConfig> | undefined): boolean;
}
/**
 * Request for authenticated server runtime configuration.
 *
 * @generated from message chatto.api.v1.GetRuntimeConfigRequest
 */
export declare class GetRuntimeConfigRequest extends Message<GetRuntimeConfigRequest> {
    constructor(data?: PartialMessage<GetRuntimeConfigRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetRuntimeConfigRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetRuntimeConfigRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetRuntimeConfigRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetRuntimeConfigRequest;
    static equals(a: GetRuntimeConfigRequest | PlainMessage<GetRuntimeConfigRequest> | undefined, b: GetRuntimeConfigRequest | PlainMessage<GetRuntimeConfigRequest> | undefined): boolean;
}
/**
 * Authenticated server runtime configuration response.
 *
 * @generated from message chatto.api.v1.GetRuntimeConfigResponse
 */
export declare class GetRuntimeConfigResponse extends Message<GetRuntimeConfigResponse> {
    /**
     * Authenticated runtime settings used by clients.
     *
     * @generated from field: chatto.api.v1.ServerRuntimeConfig runtime = 1;
     */
    runtime?: ServerRuntimeConfig;
    constructor(data?: PartialMessage<GetRuntimeConfigResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetRuntimeConfigResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetRuntimeConfigResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetRuntimeConfigResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetRuntimeConfigResponse;
    static equals(a: GetRuntimeConfigResponse | PlainMessage<GetRuntimeConfigResponse> | undefined, b: GetRuntimeConfigResponse | PlainMessage<GetRuntimeConfigResponse> | undefined): boolean;
}
