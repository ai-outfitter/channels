import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3 } from "@bufbuild/protobuf";
/**
 * Public role metadata used for rendering role mentions, labels, and catalogs.
 *
 * @generated from message chatto.api.v1.Role
 */
export declare class Role extends Message<Role> {
    /**
     * Stable role name used in permission and assignment records.
     *
     * @generated from field: string name = 1;
     */
    name: string;
    /**
     * Display name shown in user-facing role UIs.
     *
     * @generated from field: string display_name = 2;
     */
    displayName: string;
    /**
     * Optional role description.
     *
     * @generated from field: string description = 3;
     */
    description: string;
    /**
     * Whether this is a built-in role.
     *
     * @generated from field: bool is_system = 4;
     */
    isSystem: boolean;
    /**
     * Display/order position.
     *
     * @generated from field: int32 position = 5;
     */
    position: number;
    /**
     * Whether messages may notify users assigned to this role.
     *
     * @generated from field: bool pingable = 6;
     */
    pingable: boolean;
    constructor(data?: PartialMessage<Role>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.Role";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): Role;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): Role;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): Role;
    static equals(a: Role | PlainMessage<Role> | undefined, b: Role | PlainMessage<Role> | undefined): boolean;
}
/**
 * Request the current role catalog.
 *
 * @generated from message chatto.api.v1.ListRolesRequest
 */
export declare class ListRolesRequest extends Message<ListRolesRequest> {
    constructor(data?: PartialMessage<ListRolesRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListRolesRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListRolesRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListRolesRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListRolesRequest;
    static equals(a: ListRolesRequest | PlainMessage<ListRolesRequest> | undefined, b: ListRolesRequest | PlainMessage<ListRolesRequest> | undefined): boolean;
}
/**
 * Snapshot of the role catalog visible to the authenticated viewer.
 *
 * @generated from message chatto.api.v1.ListRolesResponse
 */
export declare class ListRolesResponse extends Message<ListRolesResponse> {
    /**
     * Roles sorted by position.
     *
     * @generated from field: repeated chatto.api.v1.Role roles = 1;
     */
    roles: Role[];
    constructor(data?: PartialMessage<ListRolesResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListRolesResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListRolesResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListRolesResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListRolesResponse;
    static equals(a: ListRolesResponse | PlainMessage<ListRolesResponse> | undefined, b: ListRolesResponse | PlainMessage<ListRolesResponse> | undefined): boolean;
}
/**
 * Request one public role by stable role name.
 *
 * @generated from message chatto.api.v1.GetRoleRequest
 */
export declare class GetRoleRequest extends Message<GetRoleRequest> {
    /**
     * Required stable role name.
     *
     * @generated from field: string name = 1;
     */
    name: string;
    constructor(data?: PartialMessage<GetRoleRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetRoleRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetRoleRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetRoleRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetRoleRequest;
    static equals(a: GetRoleRequest | PlainMessage<GetRoleRequest> | undefined, b: GetRoleRequest | PlainMessage<GetRoleRequest> | undefined): boolean;
}
/**
 * Public role lookup response.
 *
 * @generated from message chatto.api.v1.GetRoleResponse
 */
export declare class GetRoleResponse extends Message<GetRoleResponse> {
    /**
     * Requested role.
     *
     * @generated from field: chatto.api.v1.Role role = 1;
     */
    role?: Role;
    constructor(data?: PartialMessage<GetRoleResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetRoleResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetRoleResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetRoleResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetRoleResponse;
    static equals(a: GetRoleResponse | PlainMessage<GetRoleResponse> | undefined, b: GetRoleResponse | PlainMessage<GetRoleResponse> | undefined): boolean;
}
/**
 * Request public role records for a set of stable role names.
 *
 * @generated from message chatto.api.v1.BatchGetRolesRequest
 */
export declare class BatchGetRolesRequest extends Message<BatchGetRolesRequest> {
    /**
     * Required role names. Unknown names are omitted from the response.
     *
     * @generated from field: repeated string names = 1;
     */
    names: string[];
    constructor(data?: PartialMessage<BatchGetRolesRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.BatchGetRolesRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): BatchGetRolesRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): BatchGetRolesRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): BatchGetRolesRequest;
    static equals(a: BatchGetRolesRequest | PlainMessage<BatchGetRolesRequest> | undefined, b: BatchGetRolesRequest | PlainMessage<BatchGetRolesRequest> | undefined): boolean;
}
/**
 * Batch public role response.
 *
 * @generated from message chatto.api.v1.BatchGetRolesResponse
 */
export declare class BatchGetRolesResponse extends Message<BatchGetRolesResponse> {
    /**
     * Found roles. The server preserves first-seen request order and
     * de-duplicates repeated names.
     *
     * @generated from field: repeated chatto.api.v1.Role roles = 1;
     */
    roles: Role[];
    constructor(data?: PartialMessage<BatchGetRolesResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.BatchGetRolesResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): BatchGetRolesResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): BatchGetRolesResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): BatchGetRolesResponse;
    static equals(a: BatchGetRolesResponse | PlainMessage<BatchGetRolesResponse> | undefined, b: BatchGetRolesResponse | PlainMessage<BatchGetRolesResponse> | undefined): boolean;
}
