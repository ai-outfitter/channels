import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3 } from "@bufbuild/protobuf";
import { ProviderMetadata } from "./common_pb.js";
/**
 * Public metadata for a configured external login provider.
 *
 * @generated from message chatto.api.v1.ExternalIdentityProvider
 */
export declare class ExternalIdentityProvider extends Message<ExternalIdentityProvider> {
    /**
     * URL that starts authenticated account linking for this provider. Clients
     * should use StartExternalIdentityLink instead of navigating here directly.
     *
     * @generated from field: string link_url = 5;
     */
    linkUrl: string;
    /**
     * True when this provider is already linked to the authenticated user.
     *
     * @generated from field: bool linked = 6;
     */
    linked: boolean;
    /**
     * Linked identity subject hash for this provider, when linked.
     *
     * @generated from field: string linked_identity_subject_hash = 7;
     */
    linkedIdentitySubjectHash: string;
    /**
     * Shared provider metadata.
     *
     * @generated from field: chatto.api.v1.ProviderMetadata provider = 8;
     */
    provider?: ProviderMetadata;
    constructor(data?: PartialMessage<ExternalIdentityProvider>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ExternalIdentityProvider";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ExternalIdentityProvider;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ExternalIdentityProvider;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ExternalIdentityProvider;
    static equals(a: ExternalIdentityProvider | PlainMessage<ExternalIdentityProvider> | undefined, b: ExternalIdentityProvider | PlainMessage<ExternalIdentityProvider> | undefined): boolean;
}
/**
 * Linked provider identity metadata for the authenticated user's settings UI.
 *
 * @generated from message chatto.api.v1.LinkedExternalIdentity
 */
export declare class LinkedExternalIdentity extends Message<LinkedExternalIdentity> {
    /**
     * Provider ID recorded when the identity was linked.
     *
     * @generated from field: string provider_id = 1;
     */
    providerId: string;
    /**
     * Provider type recorded when the identity was linked.
     *
     * @generated from field: string provider_type = 2;
     */
    providerType: string;
    /**
     * Current or fallback provider label.
     *
     * @generated from field: string provider_label = 3;
     */
    providerLabel: string;
    /**
     * Stable one-way subject hash, useful only as a UI/list key.
     *
     * @generated from field: string subject_hash = 4;
     */
    subjectHash: string;
    constructor(data?: PartialMessage<LinkedExternalIdentity>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.LinkedExternalIdentity";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): LinkedExternalIdentity;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): LinkedExternalIdentity;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): LinkedExternalIdentity;
    static equals(a: LinkedExternalIdentity | PlainMessage<LinkedExternalIdentity> | undefined, b: LinkedExternalIdentity | PlainMessage<LinkedExternalIdentity> | undefined): boolean;
}
/**
 * Request to list configured and linked external identities for the current user.
 *
 * @generated from message chatto.api.v1.ListExternalIdentitiesRequest
 */
export declare class ListExternalIdentitiesRequest extends Message<ListExternalIdentitiesRequest> {
    constructor(data?: PartialMessage<ListExternalIdentitiesRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListExternalIdentitiesRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListExternalIdentitiesRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListExternalIdentitiesRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListExternalIdentitiesRequest;
    static equals(a: ListExternalIdentitiesRequest | PlainMessage<ListExternalIdentitiesRequest> | undefined, b: ListExternalIdentitiesRequest | PlainMessage<ListExternalIdentitiesRequest> | undefined): boolean;
}
/**
 * Finite snapshot of configured providers and linked external identities.
 *
 * @generated from message chatto.api.v1.ListExternalIdentitiesResponse
 */
export declare class ListExternalIdentitiesResponse extends Message<ListExternalIdentitiesResponse> {
    /**
     * Configured providers the user may link.
     *
     * @generated from field: repeated chatto.api.v1.ExternalIdentityProvider providers = 1;
     */
    providers: ExternalIdentityProvider[];
    /**
     * Provider identities already linked to the authenticated user.
     *
     * @generated from field: repeated chatto.api.v1.LinkedExternalIdentity linked_identities = 2;
     */
    linkedIdentities: LinkedExternalIdentity[];
    constructor(data?: PartialMessage<ListExternalIdentitiesResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListExternalIdentitiesResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListExternalIdentitiesResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListExternalIdentitiesResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListExternalIdentitiesResponse;
    static equals(a: ListExternalIdentitiesResponse | PlainMessage<ListExternalIdentitiesResponse> | undefined, b: ListExternalIdentitiesResponse | PlainMessage<ListExternalIdentitiesResponse> | undefined): boolean;
}
/**
 * Request to start linking a configured provider to the current user.
 *
 * @generated from message chatto.api.v1.StartExternalIdentityLinkRequest
 */
export declare class StartExternalIdentityLinkRequest extends Message<StartExternalIdentityLinkRequest> {
    /**
     * Provider ID to link.
     *
     * @generated from field: string provider_id = 1;
     */
    providerId: string;
    /**
     * Internal path to return to after confirmation.
     *
     * @generated from field: string redirect_path = 2;
     */
    redirectPath: string;
    /**
     * Current password proof for accounts with a password when the active
     * runtime credential is no longer fresh.
     *
     * @generated from field: string current_password = 3;
     */
    currentPassword: string;
    constructor(data?: PartialMessage<StartExternalIdentityLinkRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.StartExternalIdentityLinkRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): StartExternalIdentityLinkRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): StartExternalIdentityLinkRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): StartExternalIdentityLinkRequest;
    static equals(a: StartExternalIdentityLinkRequest | PlainMessage<StartExternalIdentityLinkRequest> | undefined, b: StartExternalIdentityLinkRequest | PlainMessage<StartExternalIdentityLinkRequest> | undefined): boolean;
}
/**
 * Result of preparing an external identity link flow.
 *
 * @generated from message chatto.api.v1.StartExternalIdentityLinkResponse
 */
export declare class StartExternalIdentityLinkResponse extends Message<StartExternalIdentityLinkResponse> {
    /**
     * Browser URL that starts provider authorization on the target server origin.
     *
     * @generated from field: string start_url = 1;
     */
    startUrl: string;
    constructor(data?: PartialMessage<StartExternalIdentityLinkResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.StartExternalIdentityLinkResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): StartExternalIdentityLinkResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): StartExternalIdentityLinkResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): StartExternalIdentityLinkResponse;
    static equals(a: StartExternalIdentityLinkResponse | PlainMessage<StartExternalIdentityLinkResponse> | undefined, b: StartExternalIdentityLinkResponse | PlainMessage<StartExternalIdentityLinkResponse> | undefined): boolean;
}
/**
 * Request to disconnect a linked provider identity from the authenticated user.
 *
 * @generated from message chatto.api.v1.DisconnectExternalIdentityRequest
 */
export declare class DisconnectExternalIdentityRequest extends Message<DisconnectExternalIdentityRequest> {
    /**
     * Stable one-way subject hash of the linked identity to disconnect.
     *
     * @generated from field: string subject_hash = 1;
     */
    subjectHash: string;
    /**
     * Current password proof for accounts with a password when the active
     * runtime credential is no longer fresh.
     *
     * @generated from field: string current_password = 2;
     */
    currentPassword: string;
    constructor(data?: PartialMessage<DisconnectExternalIdentityRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.DisconnectExternalIdentityRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DisconnectExternalIdentityRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DisconnectExternalIdentityRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DisconnectExternalIdentityRequest;
    static equals(a: DisconnectExternalIdentityRequest | PlainMessage<DisconnectExternalIdentityRequest> | undefined, b: DisconnectExternalIdentityRequest | PlainMessage<DisconnectExternalIdentityRequest> | undefined): boolean;
}
/**
 * Result of disconnecting a provider identity.
 *
 * @generated from message chatto.api.v1.DisconnectExternalIdentityResponse
 */
export declare class DisconnectExternalIdentityResponse extends Message<DisconnectExternalIdentityResponse> {
    /**
     * True when the identity was disconnected.
     *
     * @generated from field: bool disconnected = 1;
     */
    disconnected: boolean;
    constructor(data?: PartialMessage<DisconnectExternalIdentityResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.DisconnectExternalIdentityResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): DisconnectExternalIdentityResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): DisconnectExternalIdentityResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): DisconnectExternalIdentityResponse;
    static equals(a: DisconnectExternalIdentityResponse | PlainMessage<DisconnectExternalIdentityResponse> | undefined, b: DisconnectExternalIdentityResponse | PlainMessage<DisconnectExternalIdentityResponse> | undefined): boolean;
}
