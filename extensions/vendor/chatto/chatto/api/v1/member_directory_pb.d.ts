import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3, Timestamp } from "@bufbuild/protobuf";
import { User } from "./users_pb.js";
import { PageInfo, PageRequest } from "./pagination_pb.js";
/**
 * Public user/member row used by user directory, room membership, and mention
 * surfaces.
 *
 * @generated from message chatto.api.v1.DirectoryMember
 */
export declare class DirectoryMember extends Message<DirectoryMember> {
    /**
     * Public user fields.
     *
     * @generated from field: chatto.api.v1.User user = 1;
     */
    user?: User;
    /**
     * Explicit roles assigned to the user. Member listings include the virtual
     * `everyone` role for parity with Chatto's permission model.
     *
     * @generated from field: repeated string roles = 2;
     */
    roles: string[];
    /**
     * Account creation time when known.
     *
     * @generated from field: google.protobuf.Timestamp created_at = 3;
     */
    createdAt?: Timestamp;
    constructor(data?: PartialMessage<DirectoryMember>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.DirectoryMember";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DirectoryMember;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DirectoryMember;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DirectoryMember;
    static equals(a: DirectoryMember | PlainMessage<DirectoryMember> | undefined, b: DirectoryMember | PlainMessage<DirectoryMember> | undefined): boolean;
}
/**
 * Request for users visible to the authenticated user.
 *
 * @generated from message chatto.api.v1.ListUsersRequest
 */
export declare class ListUsersRequest extends Message<ListUsersRequest> {
    /**
     * Optional case-insensitive search against login and display name.
     *
     * @generated from field: string search = 1;
     */
    search: string;
    /**
     * Page request. Defaults to 20 results when absent or limit is zero.
     *
     * @generated from field: chatto.api.v1.PageRequest page = 4;
     */
    page?: PageRequest;
    constructor(data?: PartialMessage<ListUsersRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListUsersRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListUsersRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListUsersRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListUsersRequest;
    static equals(a: ListUsersRequest | PlainMessage<ListUsersRequest> | undefined, b: ListUsersRequest | PlainMessage<ListUsersRequest> | undefined): boolean;
}
/**
 * User directory page.
 *
 * @generated from message chatto.api.v1.ListUsersResponse
 */
export declare class ListUsersResponse extends Message<ListUsersResponse> {
    /**
     * Users in the requested page.
     *
     * @generated from field: repeated chatto.api.v1.DirectoryMember users = 1;
     */
    users: DirectoryMember[];
    /**
     * Page metadata.
     *
     * @generated from field: chatto.api.v1.PageInfo page = 4;
     */
    page?: PageInfo;
    constructor(data?: PartialMessage<ListUsersResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListUsersResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListUsersResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListUsersResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListUsersResponse;
    static equals(a: ListUsersResponse | PlainMessage<ListUsersResponse> | undefined, b: ListUsersResponse | PlainMessage<ListUsersResponse> | undefined): boolean;
}
/**
 * Request one visible user by stable user ID or login.
 *
 * @generated from message chatto.api.v1.GetUserRequest
 */
export declare class GetUserRequest extends Message<GetUserRequest> {
    /**
     * @generated from oneof chatto.api.v1.GetUserRequest.target
     */
    target: {
        /**
         * Target stable user ID.
         *
         * @generated from field: string user_id = 1;
         */
        value: string;
        case: "userId";
    } | {
        /**
         * Target login identifier.
         *
         * @generated from field: string login = 2;
         */
        value: string;
        case: "login";
    } | {
        case: undefined;
        value?: undefined;
    };
    constructor(data?: PartialMessage<GetUserRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetUserRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetUserRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetUserRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetUserRequest;
    static equals(a: GetUserRequest | PlainMessage<GetUserRequest> | undefined, b: GetUserRequest | PlainMessage<GetUserRequest> | undefined): boolean;
}
/**
 * User directory response.
 *
 * @generated from message chatto.api.v1.GetUserResponse
 */
export declare class GetUserResponse extends Message<GetUserResponse> {
    /**
     * Requested user.
     *
     * @generated from field: chatto.api.v1.DirectoryMember user = 1;
     */
    user?: DirectoryMember;
    constructor(data?: PartialMessage<GetUserResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetUserResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetUserResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetUserResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetUserResponse;
    static equals(a: GetUserResponse | PlainMessage<GetUserResponse> | undefined, b: GetUserResponse | PlainMessage<GetUserResponse> | undefined): boolean;
}
/**
 * Request user directory rows for a set of stable user IDs.
 *
 * @generated from message chatto.api.v1.BatchGetUsersRequest
 */
export declare class BatchGetUsersRequest extends Message<BatchGetUsersRequest> {
    /**
     * Required target user IDs. Unknown IDs are omitted from the response.
     *
     * @generated from field: repeated string user_ids = 1;
     */
    userIds: string[];
    constructor(data?: PartialMessage<BatchGetUsersRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.BatchGetUsersRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): BatchGetUsersRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): BatchGetUsersRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): BatchGetUsersRequest;
    static equals(a: BatchGetUsersRequest | PlainMessage<BatchGetUsersRequest> | undefined, b: BatchGetUsersRequest | PlainMessage<BatchGetUsersRequest> | undefined): boolean;
}
/**
 * Batch user directory response.
 *
 * @generated from message chatto.api.v1.BatchGetUsersResponse
 */
export declare class BatchGetUsersResponse extends Message<BatchGetUsersResponse> {
    /**
     * Found users. The server preserves first-seen request order and
     * de-duplicates repeated IDs.
     *
     * @generated from field: repeated chatto.api.v1.DirectoryMember users = 1;
     */
    users: DirectoryMember[];
    constructor(data?: PartialMessage<BatchGetUsersResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.BatchGetUsersResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): BatchGetUsersResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): BatchGetUsersResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): BatchGetUsersResponse;
    static equals(a: BatchGetUsersResponse | PlainMessage<BatchGetUsersResponse> | undefined, b: BatchGetUsersResponse | PlainMessage<BatchGetUsersResponse> | undefined): boolean;
}
/**
 * Request for members of one room.
 *
 * @generated from message chatto.api.v1.ListRoomMembersRequest
 */
export declare class ListRoomMembersRequest extends Message<ListRoomMembersRequest> {
    /**
     * Required. Room whose effective members should be listed. Existing members
     * and room.manage holders may list a channel room; other nonmembers need both
     * room.list and room.join.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Optional case-insensitive search against login and display name.
     *
     * @generated from field: string search = 2;
     */
    search: string;
    /**
     * Page request. Defaults to 250 results when absent or limit is zero.
     *
     * @generated from field: chatto.api.v1.PageRequest page = 5;
     */
    page?: PageRequest;
    constructor(data?: PartialMessage<ListRoomMembersRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListRoomMembersRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListRoomMembersRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListRoomMembersRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListRoomMembersRequest;
    static equals(a: ListRoomMembersRequest | PlainMessage<ListRoomMembersRequest> | undefined, b: ListRoomMembersRequest | PlainMessage<ListRoomMembersRequest> | undefined): boolean;
}
/**
 * Room member page.
 *
 * @generated from message chatto.api.v1.ListRoomMembersResponse
 */
export declare class ListRoomMembersResponse extends Message<ListRoomMembersResponse> {
    /**
     * Members in the requested page.
     *
     * @generated from field: repeated chatto.api.v1.DirectoryMember members = 1;
     */
    members: DirectoryMember[];
    /**
     * Page metadata.
     *
     * @generated from field: chatto.api.v1.PageInfo page = 4;
     */
    page?: PageInfo;
    constructor(data?: PartialMessage<ListRoomMembersResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListRoomMembersResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListRoomMembersResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListRoomMembersResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListRoomMembersResponse;
    static equals(a: ListRoomMembersResponse | PlainMessage<ListRoomMembersResponse> | undefined, b: ListRoomMembersResponse | PlainMessage<ListRoomMembersResponse> | undefined): boolean;
}
/**
 * Request one member of one room by stable user ID.
 *
 * @generated from message chatto.api.v1.GetRoomMemberRequest
 */
export declare class GetRoomMemberRequest extends Message<GetRoomMemberRequest> {
    /**
     * Required room ID.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Required target user ID.
     *
     * @generated from field: string user_id = 2;
     */
    userId: string;
    constructor(data?: PartialMessage<GetRoomMemberRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetRoomMemberRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetRoomMemberRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetRoomMemberRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetRoomMemberRequest;
    static equals(a: GetRoomMemberRequest | PlainMessage<GetRoomMemberRequest> | undefined, b: GetRoomMemberRequest | PlainMessage<GetRoomMemberRequest> | undefined): boolean;
}
/**
 * Room member response.
 *
 * @generated from message chatto.api.v1.GetRoomMemberResponse
 */
export declare class GetRoomMemberResponse extends Message<GetRoomMemberResponse> {
    /**
     * Requested room member.
     *
     * @generated from field: chatto.api.v1.DirectoryMember member = 1;
     */
    member?: DirectoryMember;
    constructor(data?: PartialMessage<GetRoomMemberResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetRoomMemberResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetRoomMemberResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetRoomMemberResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetRoomMemberResponse;
    static equals(a: GetRoomMemberResponse | PlainMessage<GetRoomMemberResponse> | undefined, b: GetRoomMemberResponse | PlainMessage<GetRoomMemberResponse> | undefined): boolean;
}
/**
 * Request room member rows for a set of stable user IDs.
 *
 * @generated from message chatto.api.v1.BatchGetRoomMembersRequest
 */
export declare class BatchGetRoomMembersRequest extends Message<BatchGetRoomMembersRequest> {
    /**
     * Required room ID.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Required target user IDs. Unknown IDs and users that are not members of the
     * room are omitted from the response.
     *
     * @generated from field: repeated string user_ids = 2;
     */
    userIds: string[];
    constructor(data?: PartialMessage<BatchGetRoomMembersRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.BatchGetRoomMembersRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): BatchGetRoomMembersRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): BatchGetRoomMembersRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): BatchGetRoomMembersRequest;
    static equals(a: BatchGetRoomMembersRequest | PlainMessage<BatchGetRoomMembersRequest> | undefined, b: BatchGetRoomMembersRequest | PlainMessage<BatchGetRoomMembersRequest> | undefined): boolean;
}
/**
 * Batch room member response.
 *
 * @generated from message chatto.api.v1.BatchGetRoomMembersResponse
 */
export declare class BatchGetRoomMembersResponse extends Message<BatchGetRoomMembersResponse> {
    /**
     * Found members. The server preserves first-seen request order and
     * de-duplicates repeated IDs.
     *
     * @generated from field: repeated chatto.api.v1.DirectoryMember members = 1;
     */
    members: DirectoryMember[];
    constructor(data?: PartialMessage<BatchGetRoomMembersResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.BatchGetRoomMembersResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): BatchGetRoomMembersResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): BatchGetRoomMembersResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): BatchGetRoomMembersResponse;
    static equals(a: BatchGetRoomMembersResponse | PlainMessage<BatchGetRoomMembersResponse> | undefined, b: BatchGetRoomMembersResponse | PlainMessage<BatchGetRoomMembersResponse> | undefined): boolean;
}
