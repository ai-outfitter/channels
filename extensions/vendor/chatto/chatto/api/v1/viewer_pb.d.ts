import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3, Timestamp } from "@bufbuild/protobuf";
import { User } from "./users_pb.js";
import { CapabilityGrant, PermissionGrant } from "./permissions_pb.js";
import { NotificationPreference } from "./notification_preferences_pb.js";
/**
 * User preference for rendering times in clients.
 *
 * @generated from enum chatto.api.v1.TimeFormat
 */
export declare enum TimeFormat {
    /**
     * No explicit preference was stored.
     *
     * @generated from enum value: TIME_FORMAT_UNSPECIFIED = 0;
     */
    TIME_FORMAT_UNSPECIFIED = 0,
    /**
     * Let the client choose based on locale and browser settings.
     *
     * @generated from enum value: TIME_FORMAT_AUTO = 1;
     */
    TIME_FORMAT_AUTO = 1,
    /**
     * Render times using a 12-hour clock.
     *
     * @generated from enum value: TIME_FORMAT_12_HOUR = 2;
     */
    TIME_FORMAT_12_HOUR = 2,
    /**
     * Render times using a 24-hour clock.
     *
     * @generated from enum value: TIME_FORMAT_24_HOUR = 3;
     */
    TIME_FORMAT_24_HOUR = 3
}
/**
 * Server-level display settings for the authenticated user.
 *
 * @generated from message chatto.api.v1.UserSettings
 */
export declare class UserSettings extends Message<UserSettings> {
    /**
     * Optional IANA timezone override. Absent means the client should use the
     * browser's local timezone.
     *
     * @generated from field: optional string timezone = 1;
     */
    timezone?: string;
    /**
     * Preferred time format.
     *
     * @generated from field: chatto.api.v1.TimeFormat time_format = 2;
     */
    timeFormat: TimeFormat;
    constructor(data?: PartialMessage<UserSettings>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UserSettings";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UserSettings;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UserSettings;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UserSettings;
    static equals(a: UserSettings | PlainMessage<UserSettings> | undefined, b: UserSettings | PlainMessage<UserSettings> | undefined): boolean;
}
/**
 * Current authenticated user's public profile plus self-only settings.
 *
 * @generated from message chatto.api.v1.ViewerUser
 */
export declare class ViewerUser extends Message<ViewerUser> {
    /**
     * Whether the account has at least one verified email address.
     *
     * @generated from field: bool has_verified_email = 7;
     */
    hasVerifiedEmail: boolean;
    /**
     * Current user's display settings.
     *
     * @generated from field: chatto.api.v1.UserSettings settings = 8;
     */
    settings?: UserSettings;
    /**
     * Whether the authenticated user may delete this account.
     *
     * @generated from field: bool viewer_can_delete_account = 9;
     */
    viewerCanDeleteAccount: boolean;
    /**
     * Last time a login credential changed, when known.
     *
     * @generated from field: google.protobuf.Timestamp last_login_change = 10;
     */
    lastLoginChange?: Timestamp;
    /**
     * Public user fields for the authenticated user.
     *
     * @generated from field: chatto.api.v1.User profile = 11;
     */
    profile?: User;
    /**
     * Whether this account currently has a password sign-in credential.
     *
     * @generated from field: bool has_password = 12;
     */
    hasPassword: boolean;
    constructor(data?: PartialMessage<ViewerUser>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ViewerUser";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ViewerUser;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ViewerUser;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ViewerUser;
    static equals(a: ViewerUser | PlainMessage<ViewerUser> | undefined, b: ViewerUser | PlainMessage<ViewerUser> | undefined): boolean;
}
/**
 * Permission-derived capabilities for the authenticated user.
 *
 * @generated from message chatto.api.v1.ViewerCapabilities
 */
export declare class ViewerCapabilities extends Message<ViewerCapabilities> {
    /**
     * Keyed capability decisions for the authenticated user.
     *
     * @generated from field: repeated chatto.api.v1.CapabilityGrant grants = 1;
     */
    grants: CapabilityGrant[];
    /**
     * Whether the user has unread followed threads.
     *
     * @generated from field: bool has_unread_followed_threads = 2;
     */
    hasUnreadFollowedThreads: boolean;
    constructor(data?: PartialMessage<ViewerCapabilities>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ViewerCapabilities";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ViewerCapabilities;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ViewerCapabilities;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ViewerCapabilities;
    static equals(a: ViewerCapabilities | PlainMessage<ViewerCapabilities> | undefined, b: ViewerCapabilities | PlainMessage<ViewerCapabilities> | undefined): boolean;
}
/**
 * Effective server/channel permission decisions for the authenticated user.
 *
 * @generated from message chatto.api.v1.ServerViewerPermissions
 */
export declare class ServerViewerPermissions extends Message<ServerViewerPermissions> {
    /**
     * One row per permission known to the server.
     *
     * @generated from field: repeated chatto.api.v1.PermissionGrant permissions = 1;
     */
    permissions: PermissionGrant[];
    constructor(data?: PartialMessage<ServerViewerPermissions>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ServerViewerPermissions";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ServerViewerPermissions;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ServerViewerPermissions;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ServerViewerPermissions;
    static equals(a: ServerViewerPermissions | PlainMessage<ServerViewerPermissions> | undefined, b: ServerViewerPermissions | PlainMessage<ServerViewerPermissions> | undefined): boolean;
}
/**
 * Non-permission server state for the authenticated user.
 *
 * @generated from message chatto.api.v1.ServerViewerState
 */
export declare class ServerViewerState extends Message<ServerViewerState> {
    /**
     * Whether any joined channel room has unread messages.
     *
     * @generated from field: bool has_unread_rooms = 1;
     */
    hasUnreadRooms: boolean;
    constructor(data?: PartialMessage<ServerViewerState>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ServerViewerState";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ServerViewerState;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ServerViewerState;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ServerViewerState;
    static equals(a: ServerViewerState | PlainMessage<ServerViewerState> | undefined, b: ServerViewerState | PlainMessage<ServerViewerState> | undefined): boolean;
}
/**
 * Room notification preference for one joined room.
 *
 * @generated from message chatto.api.v1.RoomNotificationPreference
 */
export declare class RoomNotificationPreference extends Message<RoomNotificationPreference> {
    /**
     * Room whose preference is represented.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Stored and effective notification preference.
     *
     * @generated from field: chatto.api.v1.NotificationPreference preference = 4;
     */
    preference?: NotificationPreference;
    constructor(data?: PartialMessage<RoomNotificationPreference>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RoomNotificationPreference";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RoomNotificationPreference;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RoomNotificationPreference;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RoomNotificationPreference;
    static equals(a: RoomNotificationPreference | PlainMessage<RoomNotificationPreference> | undefined, b: RoomNotificationPreference | PlainMessage<RoomNotificationPreference> | undefined): boolean;
}
/**
 * Request for the authenticated viewer snapshot.
 *
 * @generated from message chatto.api.v1.GetViewerRequest
 */
export declare class GetViewerRequest extends Message<GetViewerRequest> {
    constructor(data?: PartialMessage<GetViewerRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetViewerRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetViewerRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetViewerRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetViewerRequest;
    static equals(a: GetViewerRequest | PlainMessage<GetViewerRequest> | undefined, b: GetViewerRequest | PlainMessage<GetViewerRequest> | undefined): boolean;
}
/**
 * Authenticated viewer snapshot needed by application shells.
 *
 * @generated from message chatto.api.v1.GetViewerResponse
 */
export declare class GetViewerResponse extends Message<GetViewerResponse> {
    /**
     * Current authenticated user.
     *
     * @generated from field: chatto.api.v1.ViewerUser user = 1;
     */
    user?: ViewerUser;
    /**
     * Permission-derived capabilities.
     *
     * @generated from field: chatto.api.v1.ViewerCapabilities capabilities = 2;
     */
    capabilities?: ViewerCapabilities;
    /**
     * Server-wide notification preference.
     *
     * @generated from field: chatto.api.v1.NotificationPreference server_notification_preference = 3;
     */
    serverNotificationPreference?: NotificationPreference;
    /**
     * Notification preferences for rooms the user participates in.
     *
     * @generated from field: repeated chatto.api.v1.RoomNotificationPreference room_notification_preferences = 4;
     */
    roomNotificationPreferences: RoomNotificationPreference[];
    /**
     * Effective server/channel permission decisions for the authenticated user.
     *
     * @generated from field: chatto.api.v1.ServerViewerPermissions viewer_permissions = 5;
     */
    viewerPermissions?: ServerViewerPermissions;
    /**
     * Non-permission server state for the authenticated user.
     *
     * @generated from field: chatto.api.v1.ServerViewerState viewer_state = 6;
     */
    viewerState?: ServerViewerState;
    constructor(data?: PartialMessage<GetViewerResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetViewerResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetViewerResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetViewerResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetViewerResponse;
    static equals(a: GetViewerResponse | PlainMessage<GetViewerResponse> | undefined, b: GetViewerResponse | PlainMessage<GetViewerResponse> | undefined): boolean;
}
