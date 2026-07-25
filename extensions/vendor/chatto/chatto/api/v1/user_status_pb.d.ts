import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3, Timestamp } from "@bufbuild/protobuf";
/**
 * Custom status shown on a user profile, separate from presence.
 *
 * @generated from message chatto.api.v1.CustomUserStatus
 */
export declare class CustomUserStatus extends Message<CustomUserStatus> {
    /**
     * Short emoji marker displayed with the status.
     *
     * @generated from field: string emoji = 1;
     */
    emoji: string;
    /**
     * User-written status text.
     *
     * @generated from field: string text = 2;
     */
    text: string;
    /**
     * Optional time after which clients should stop showing the status.
     *
     * @generated from field: google.protobuf.Timestamp expires_at = 3;
     */
    expiresAt?: Timestamp;
    constructor(data?: PartialMessage<CustomUserStatus>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.CustomUserStatus";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): CustomUserStatus;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): CustomUserStatus;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): CustomUserStatus;
    static equals(a: CustomUserStatus | PlainMessage<CustomUserStatus> | undefined, b: CustomUserStatus | PlainMessage<CustomUserStatus> | undefined): boolean;
}
/**
 * Request to update or replace the current user's custom status.
 *
 * @generated from message chatto.api.v1.UpdateCustomStatusRequest
 */
export declare class UpdateCustomStatusRequest extends Message<UpdateCustomStatusRequest> {
    /**
     * Short emoji marker displayed with the status.
     *
     * @generated from field: string emoji = 1;
     */
    emoji: string;
    /**
     * User-written status text.
     *
     * @generated from field: string text = 2;
     */
    text: string;
    /**
     * Optional future time after which clients should stop showing the status.
     *
     * @generated from field: google.protobuf.Timestamp expires_at = 3;
     */
    expiresAt?: Timestamp;
    constructor(data?: PartialMessage<UpdateCustomStatusRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UpdateCustomStatusRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UpdateCustomStatusRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UpdateCustomStatusRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UpdateCustomStatusRequest;
    static equals(a: UpdateCustomStatusRequest | PlainMessage<UpdateCustomStatusRequest> | undefined, b: UpdateCustomStatusRequest | PlainMessage<UpdateCustomStatusRequest> | undefined): boolean;
}
/**
 * Result of updating the current user's custom status.
 *
 * @generated from message chatto.api.v1.UpdateCustomStatusResponse
 */
export declare class UpdateCustomStatusResponse extends Message<UpdateCustomStatusResponse> {
    /**
     * Stored custom status after validation and normalization.
     *
     * @generated from field: chatto.api.v1.CustomUserStatus status = 1;
     */
    status?: CustomUserStatus;
    constructor(data?: PartialMessage<UpdateCustomStatusResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UpdateCustomStatusResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UpdateCustomStatusResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UpdateCustomStatusResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UpdateCustomStatusResponse;
    static equals(a: UpdateCustomStatusResponse | PlainMessage<UpdateCustomStatusResponse> | undefined, b: UpdateCustomStatusResponse | PlainMessage<UpdateCustomStatusResponse> | undefined): boolean;
}
/**
 * Request to delete the current user's custom status.
 *
 * @generated from message chatto.api.v1.DeleteCustomStatusRequest
 */
export declare class DeleteCustomStatusRequest extends Message<DeleteCustomStatusRequest> {
    constructor(data?: PartialMessage<DeleteCustomStatusRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.DeleteCustomStatusRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DeleteCustomStatusRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DeleteCustomStatusRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DeleteCustomStatusRequest;
    static equals(a: DeleteCustomStatusRequest | PlainMessage<DeleteCustomStatusRequest> | undefined, b: DeleteCustomStatusRequest | PlainMessage<DeleteCustomStatusRequest> | undefined): boolean;
}
/**
 * Result of deleting the current user's custom status.
 *
 * @generated from message chatto.api.v1.DeleteCustomStatusResponse
 */
export declare class DeleteCustomStatusResponse extends Message<DeleteCustomStatusResponse> {
    /**
     * Current custom status after the operation. Usually absent after a clear.
     *
     * @generated from field: chatto.api.v1.CustomUserStatus status = 1;
     */
    status?: CustomUserStatus;
    constructor(data?: PartialMessage<DeleteCustomStatusResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.DeleteCustomStatusResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DeleteCustomStatusResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DeleteCustomStatusResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DeleteCustomStatusResponse;
    static equals(a: DeleteCustomStatusResponse | PlainMessage<DeleteCustomStatusResponse> | undefined, b: DeleteCustomStatusResponse | PlainMessage<DeleteCustomStatusResponse> | undefined): boolean;
}
