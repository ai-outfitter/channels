import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3 } from "@bufbuild/protobuf";
import { PresenceStatus } from "./presence_pb.js";
import { CustomUserStatus } from "./user_status_pb.js";
/**
 * Public user fields.
 *
 * @generated from message chatto.api.v1.User
 */
export declare class User extends Message<User> {
    /**
     * Stable user ID.
     *
     * @generated from field: string id = 1;
     */
    id: string;
    /**
     * Login name.
     *
     * @generated from field: string login = 2;
     */
    login: string;
    /**
     * Display name, when set.
     *
     * @generated from field: string display_name = 3;
     */
    displayName: string;
    /**
     * True when the user account has been deleted.
     *
     * @generated from field: bool deleted = 4;
     */
    deleted: boolean;
    /**
     * Avatar image URL, when available.
     *
     * @generated from field: optional string avatar_url = 5;
     */
    avatarUrl?: string;
    /**
     * Current live presence status.
     *
     * @generated from field: chatto.api.v1.PresenceStatus presence_status = 6;
     */
    presenceStatus: PresenceStatus;
    /**
     * Custom profile status, when set.
     *
     * @generated from field: chatto.api.v1.CustomUserStatus custom_status = 7;
     */
    customStatus?: CustomUserStatus;
    constructor(data?: PartialMessage<User>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.User";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): User;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): User;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): User;
    static equals(a: User | PlainMessage<User> | undefined, b: User | PlainMessage<User> | undefined): boolean;
}
