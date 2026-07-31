import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3 } from "@bufbuild/protobuf";
/**
 * Effective decision for one permission key.
 *
 * @generated from message chatto.api.v1.PermissionGrant
 */
export declare class PermissionGrant extends Message<PermissionGrant> {
    /**
     * Stable permission key, such as "server.manage".
     *
     * @generated from field: string permission = 1;
     */
    permission: string;
    /**
     * Whether the permission is currently granted.
     *
     * @generated from field: bool granted = 2;
     */
    granted: boolean;
    constructor(data?: PartialMessage<PermissionGrant>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.PermissionGrant";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): PermissionGrant;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): PermissionGrant;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): PermissionGrant;
    static equals(a: PermissionGrant | PlainMessage<PermissionGrant> | undefined, b: PermissionGrant | PlainMessage<PermissionGrant> | undefined): boolean;
}
/**
 * Effective decision for one capability key.
 *
 * Built-in keys currently include:
 * - admin.view
 * - dm.start
 * - admin.view-users
 * - user.manage-accounts
 * - role.assign
 * - role.view
 * - role.manage
 * - admin.view-system
 * - admin.view-audit
 * - user.manage-permissions
 *
 * Clients should ignore unknown keys so servers can add capabilities over time.
 *
 * @generated from message chatto.api.v1.CapabilityGrant
 */
export declare class CapabilityGrant extends Message<CapabilityGrant> {
    /**
     * Stable capability key, such as "admin.view" or "dm.start".
     *
     * @generated from field: string capability = 1;
     */
    capability: string;
    /**
     * Whether the capability is currently available.
     *
     * @generated from field: bool granted = 2;
     */
    granted: boolean;
    constructor(data?: PartialMessage<CapabilityGrant>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.CapabilityGrant";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): CapabilityGrant;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): CapabilityGrant;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): CapabilityGrant;
    static equals(a: CapabilityGrant | PlainMessage<CapabilityGrant> | undefined, b: CapabilityGrant | PlainMessage<CapabilityGrant> | undefined): boolean;
}
