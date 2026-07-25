import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3 } from "@bufbuild/protobuf";
import { User } from "./users_pb.js";
import { ImageUpload } from "./common_pb.js";
import { TimeFormat, UserSettings } from "./viewer_pb.js";
/**
 * Request to update the authenticated user's profile. At least one field must
 * be present.
 *
 * @generated from message chatto.api.v1.UpdateProfileRequest
 */
export declare class UpdateProfileRequest extends Message<UpdateProfileRequest> {
    /**
     * New display name, when changing it. Empty clears the explicit display
     * name. The server also rejects control and confusing invisible characters.
     *
     * @generated from field: optional string display_name = 1;
     */
    displayName?: string;
    /**
     * New login identifier, when changing it. The server accepts ASCII letters,
     * digits, period, underscore, and hyphen, starting with a letter or digit.
     *
     * @generated from field: optional string login = 2;
     */
    login?: string;
    constructor(data?: PartialMessage<UpdateProfileRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UpdateProfileRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UpdateProfileRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UpdateProfileRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UpdateProfileRequest;
    static equals(a: UpdateProfileRequest | PlainMessage<UpdateProfileRequest> | undefined, b: UpdateProfileRequest | PlainMessage<UpdateProfileRequest> | undefined): boolean;
}
/**
 * Result of a profile update.
 *
 * @generated from message chatto.api.v1.UpdateProfileResponse
 */
export declare class UpdateProfileResponse extends Message<UpdateProfileResponse> {
    /**
     * Updated user profile.
     *
     * @generated from field: chatto.api.v1.User user = 1;
     */
    user?: User;
    constructor(data?: PartialMessage<UpdateProfileResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UpdateProfileResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UpdateProfileResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UpdateProfileResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UpdateProfileResponse;
    static equals(a: UpdateProfileResponse | PlainMessage<UpdateProfileResponse> | undefined, b: UpdateProfileResponse | PlainMessage<UpdateProfileResponse> | undefined): boolean;
}
/**
 * Request to upload and set the authenticated user's avatar.
 *
 * @generated from message chatto.api.v1.UploadAvatarRequest
 */
export declare class UploadAvatarRequest extends Message<UploadAvatarRequest> {
    /**
     * Image payload. The server validates, resizes, and stores a WebP avatar.
     *
     * @generated from field: chatto.api.v1.ImageUpload image = 4;
     */
    image?: ImageUpload;
    constructor(data?: PartialMessage<UploadAvatarRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UploadAvatarRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UploadAvatarRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UploadAvatarRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UploadAvatarRequest;
    static equals(a: UploadAvatarRequest | PlainMessage<UploadAvatarRequest> | undefined, b: UploadAvatarRequest | PlainMessage<UploadAvatarRequest> | undefined): boolean;
}
/**
 * Result of uploading the authenticated user's avatar.
 *
 * @generated from message chatto.api.v1.UploadAvatarResponse
 */
export declare class UploadAvatarResponse extends Message<UploadAvatarResponse> {
    /**
     * Updated user profile.
     *
     * @generated from field: chatto.api.v1.User user = 1;
     */
    user?: User;
    constructor(data?: PartialMessage<UploadAvatarResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UploadAvatarResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UploadAvatarResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UploadAvatarResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UploadAvatarResponse;
    static equals(a: UploadAvatarResponse | PlainMessage<UploadAvatarResponse> | undefined, b: UploadAvatarResponse | PlainMessage<UploadAvatarResponse> | undefined): boolean;
}
/**
 * Request to delete the authenticated user's avatar.
 *
 * @generated from message chatto.api.v1.DeleteAvatarRequest
 */
export declare class DeleteAvatarRequest extends Message<DeleteAvatarRequest> {
    constructor(data?: PartialMessage<DeleteAvatarRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.DeleteAvatarRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DeleteAvatarRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DeleteAvatarRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DeleteAvatarRequest;
    static equals(a: DeleteAvatarRequest | PlainMessage<DeleteAvatarRequest> | undefined, b: DeleteAvatarRequest | PlainMessage<DeleteAvatarRequest> | undefined): boolean;
}
/**
 * Result of deleting the authenticated user's avatar.
 *
 * @generated from message chatto.api.v1.DeleteAvatarResponse
 */
export declare class DeleteAvatarResponse extends Message<DeleteAvatarResponse> {
    /**
     * Updated user profile.
     *
     * @generated from field: chatto.api.v1.User user = 1;
     */
    user?: User;
    constructor(data?: PartialMessage<DeleteAvatarResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.DeleteAvatarResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DeleteAvatarResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DeleteAvatarResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DeleteAvatarResponse;
    static equals(a: DeleteAvatarResponse | PlainMessage<DeleteAvatarResponse> | undefined, b: DeleteAvatarResponse | PlainMessage<DeleteAvatarResponse> | undefined): boolean;
}
/**
 * Request to update or add the authenticated user's password.
 *
 * @generated from message chatto.api.v1.UpdatePasswordRequest
 */
export declare class UpdatePasswordRequest extends Message<UpdatePasswordRequest> {
    /**
     * New password. The server applies the same password policy as registration
     * and password reset.
     *
     * @generated from field: string password = 1;
     */
    password: string;
    /**
     * Current password. Required when the account already has a password; omitted
     * when adding the first password to a passwordless account.
     *
     * @generated from field: string current_password = 2;
     */
    currentPassword: string;
    constructor(data?: PartialMessage<UpdatePasswordRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UpdatePasswordRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UpdatePasswordRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UpdatePasswordRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UpdatePasswordRequest;
    static equals(a: UpdatePasswordRequest | PlainMessage<UpdatePasswordRequest> | undefined, b: UpdatePasswordRequest | PlainMessage<UpdatePasswordRequest> | undefined): boolean;
}
/**
 * Result of updating or adding the authenticated account password.
 *
 * @generated from message chatto.api.v1.UpdatePasswordResponse
 */
export declare class UpdatePasswordResponse extends Message<UpdatePasswordResponse> {
    /**
     * Current authenticated user profile after the password update.
     *
     * @generated from field: chatto.api.v1.User user = 1;
     */
    user?: User;
    constructor(data?: PartialMessage<UpdatePasswordResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UpdatePasswordResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UpdatePasswordResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UpdatePasswordResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UpdatePasswordResponse;
    static equals(a: UpdatePasswordResponse | PlainMessage<UpdatePasswordResponse> | undefined, b: UpdatePasswordResponse | PlainMessage<UpdatePasswordResponse> | undefined): boolean;
}
/**
 * Request to update the authenticated user's display preferences. Omitted
 * fields are left unchanged. An empty timezone clears the explicit timezone.
 *
 * @generated from message chatto.api.v1.UpdateSettingsRequest
 */
export declare class UpdateSettingsRequest extends Message<UpdateSettingsRequest> {
    /**
     * IANA timezone override. Empty clears the override.
     *
     * @generated from field: optional string timezone = 1;
     */
    timezone?: string;
    /**
     * Preferred time format.
     *
     * @generated from field: optional chatto.api.v1.TimeFormat time_format = 2;
     */
    timeFormat?: TimeFormat;
    constructor(data?: PartialMessage<UpdateSettingsRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UpdateSettingsRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UpdateSettingsRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UpdateSettingsRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UpdateSettingsRequest;
    static equals(a: UpdateSettingsRequest | PlainMessage<UpdateSettingsRequest> | undefined, b: UpdateSettingsRequest | PlainMessage<UpdateSettingsRequest> | undefined): boolean;
}
/**
 * Result of updating display preferences.
 *
 * @generated from message chatto.api.v1.UpdateSettingsResponse
 */
export declare class UpdateSettingsResponse extends Message<UpdateSettingsResponse> {
    /**
     * Stored settings after merging the request.
     *
     * @generated from field: chatto.api.v1.UserSettings settings = 1;
     */
    settings?: UserSettings;
    constructor(data?: PartialMessage<UpdateSettingsResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UpdateSettingsResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UpdateSettingsResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UpdateSettingsResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UpdateSettingsResponse;
    static equals(a: UpdateSettingsResponse | PlainMessage<UpdateSettingsResponse> | undefined, b: UpdateSettingsResponse | PlainMessage<UpdateSettingsResponse> | undefined): boolean;
}
/**
 * Request a short-lived confirmation token for deleting the authenticated
 * account.
 *
 * @generated from message chatto.api.v1.RequestAccountDeletionRequest
 */
export declare class RequestAccountDeletionRequest extends Message<RequestAccountDeletionRequest> {
    constructor(data?: PartialMessage<RequestAccountDeletionRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RequestAccountDeletionRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RequestAccountDeletionRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RequestAccountDeletionRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RequestAccountDeletionRequest;
    static equals(a: RequestAccountDeletionRequest | PlainMessage<RequestAccountDeletionRequest> | undefined, b: RequestAccountDeletionRequest | PlainMessage<RequestAccountDeletionRequest> | undefined): boolean;
}
/**
 * Result of issuing an account deletion confirmation token.
 *
 * @generated from message chatto.api.v1.RequestAccountDeletionResponse
 */
export declare class RequestAccountDeletionResponse extends Message<RequestAccountDeletionResponse> {
    /**
     * Confirmation token. Clients must pass this to DeleteMyAccount.
     *
     * @generated from field: string confirmation_token = 1;
     */
    confirmationToken: string;
    constructor(data?: PartialMessage<RequestAccountDeletionResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RequestAccountDeletionResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RequestAccountDeletionResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RequestAccountDeletionResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RequestAccountDeletionResponse;
    static equals(a: RequestAccountDeletionResponse | PlainMessage<RequestAccountDeletionResponse> | undefined, b: RequestAccountDeletionResponse | PlainMessage<RequestAccountDeletionResponse> | undefined): boolean;
}
/**
 * Request to permanently delete the authenticated account.
 *
 * @generated from message chatto.api.v1.DeleteMyAccountRequest
 */
export declare class DeleteMyAccountRequest extends Message<DeleteMyAccountRequest> {
    /**
     * Confirmation token obtained from RequestAccountDeletion.
     *
     * @generated from field: string confirmation_token = 1;
     */
    confirmationToken: string;
    constructor(data?: PartialMessage<DeleteMyAccountRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.DeleteMyAccountRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DeleteMyAccountRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DeleteMyAccountRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DeleteMyAccountRequest;
    static equals(a: DeleteMyAccountRequest | PlainMessage<DeleteMyAccountRequest> | undefined, b: DeleteMyAccountRequest | PlainMessage<DeleteMyAccountRequest> | undefined): boolean;
}
/**
 * Result of deleting the authenticated account.
 *
 * @generated from message chatto.api.v1.DeleteMyAccountResponse
 */
export declare class DeleteMyAccountResponse extends Message<DeleteMyAccountResponse> {
    /**
     * True when the account was deleted.
     *
     * @generated from field: bool deleted = 1;
     */
    deleted: boolean;
    constructor(data?: PartialMessage<DeleteMyAccountResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.DeleteMyAccountResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DeleteMyAccountResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DeleteMyAccountResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DeleteMyAccountResponse;
    static equals(a: DeleteMyAccountResponse | PlainMessage<DeleteMyAccountResponse> | undefined, b: DeleteMyAccountResponse | PlainMessage<DeleteMyAccountResponse> | undefined): boolean;
}
