import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3 } from "@bufbuild/protobuf";
/**
 * Live presence status returned by public read APIs.
 *
 * Offline is a read-side state only. Clients cannot update their presence to
 * Offline through the account presence RPC; they should stop refreshing and let
 * the server's live presence record expire.
 *
 * @generated from enum chatto.api.v1.PresenceStatus
 */
export declare enum PresenceStatus {
    /**
     * No presence status was specified.
     *
     * @generated from enum value: PRESENCE_STATUS_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * The user is actively available.
     *
     * @generated from enum value: PRESENCE_STATUS_ONLINE = 1;
     */
    ONLINE = 1,
    /**
     * The user is connected but away or idle.
     *
     * @generated from enum value: PRESENCE_STATUS_AWAY = 2;
     */
    AWAY = 2,
    /**
     * The user does not want notifications while this live status is active.
     *
     * @generated from enum value: PRESENCE_STATUS_DO_NOT_DISTURB = 3;
     */
    DO_NOT_DISTURB = 3,
    /**
     * The user has no active live presence record.
     *
     * @generated from enum value: PRESENCE_STATUS_OFFLINE = 4;
     */
    OFFLINE = 4
}
/**
 * Request to update the current user's live presence status.
 *
 * @generated from message chatto.api.v1.UpdatePresenceRequest
 */
export declare class UpdatePresenceRequest extends Message<UpdatePresenceRequest> {
    /**
     * Live status to store for the authenticated user. Offline is rejected.
     *
     * @generated from field: chatto.api.v1.PresenceStatus status = 1;
     */
    status: PresenceStatus;
    /**
     * True when this update comes from a deliberate user selection rather than
     * automatic idle/refresh updates. Automatic updates do not overwrite an
     * active manually selected Away or Do Not Disturb status from another client.
     *
     * @generated from field: bool user_selected = 2;
     */
    userSelected: boolean;
    constructor(data?: PartialMessage<UpdatePresenceRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UpdatePresenceRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UpdatePresenceRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UpdatePresenceRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UpdatePresenceRequest;
    static equals(a: UpdatePresenceRequest | PlainMessage<UpdatePresenceRequest> | undefined, b: UpdatePresenceRequest | PlainMessage<UpdatePresenceRequest> | undefined): boolean;
}
/**
 * Result of updating live presence.
 *
 * @generated from message chatto.api.v1.UpdatePresenceResponse
 */
export declare class UpdatePresenceResponse extends Message<UpdatePresenceResponse> {
    /**
     * Reportable status accepted and stored by the server.
     *
     * @generated from field: chatto.api.v1.PresenceStatus status = 1;
     */
    status: PresenceStatus;
    constructor(data?: PartialMessage<UpdatePresenceResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UpdatePresenceResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UpdatePresenceResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UpdatePresenceResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UpdatePresenceResponse;
    static equals(a: UpdatePresenceResponse | PlainMessage<UpdatePresenceResponse> | undefined, b: UpdatePresenceResponse | PlainMessage<UpdatePresenceResponse> | undefined): boolean;
}
