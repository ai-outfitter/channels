import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3 } from "@bufbuild/protobuf";
import { ProviderMetadata } from "./common_pb.js";
/**
 * Public server profile, identity, and branding fields.
 *
 * @generated from message chatto.api.v1.ServerPublicProfile
 */
export declare class ServerPublicProfile extends Message<ServerPublicProfile> {
    /**
     * Display name of the Chatto server.
     *
     * @generated from field: string name = 1;
     */
    name: string;
    /**
     * Server software version.
     *
     * @generated from field: string version = 2;
     */
    version: string;
    /**
     * Optional server logo URL.
     *
     * @generated from field: optional string logo_url = 3;
     */
    logoUrl?: string;
    /**
     * Optional server banner URL.
     *
     * @generated from field: optional string banner_url = 4;
     */
    bannerUrl?: string;
    /**
     * Optional welcome message.
     *
     * @generated from field: optional string welcome_message = 5;
     */
    welcomeMessage?: string;
    /**
     * Optional server description.
     *
     * @generated from field: optional string description = 6;
     */
    description?: string;
    constructor(data?: PartialMessage<ServerPublicProfile>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ServerPublicProfile";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ServerPublicProfile;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ServerPublicProfile;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ServerPublicProfile;
    static equals(a: ServerPublicProfile | PlainMessage<ServerPublicProfile> | undefined, b: ServerPublicProfile | PlainMessage<ServerPublicProfile> | undefined): boolean;
}
/**
 * Login and registration options exposed before authentication.
 *
 * @generated from message chatto.api.v1.ServerLogin
 */
export declare class ServerLogin extends Message<ServerLogin> {
    /**
     * Whether users can create accounts through the public UI.
     *
     * @generated from field: bool direct_registration_enabled = 1;
     */
    directRegistrationEnabled: boolean;
    /**
     * Configured login providers.
     *
     * @generated from field: repeated chatto.api.v1.ProviderMetadata providers = 2;
     */
    providers: ProviderMetadata[];
    /**
     * URL for the legacy authorization flow, when enabled.
     *
     * @generated from field: string authorize_url = 3;
     */
    authorizeUrl: string;
    constructor(data?: PartialMessage<ServerLogin>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ServerLogin";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ServerLogin;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ServerLogin;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ServerLogin;
    static equals(a: ServerLogin | PlainMessage<ServerLogin> | undefined, b: ServerLogin | PlainMessage<ServerLogin> | undefined): boolean;
}
