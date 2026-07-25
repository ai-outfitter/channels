import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3 } from "@bufbuild/protobuf";
/**
 * Fit mode used when generating transformed image URLs.
 *
 * @generated from enum chatto.api.v1.ImageFitMode
 */
export declare enum ImageFitMode {
    /**
     * The fit mode was not specified.
     *
     * @generated from enum value: IMAGE_FIT_MODE_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * Preserve the whole source image within the requested bounds.
     *
     * @generated from enum value: IMAGE_FIT_MODE_CONTAIN = 1;
     */
    CONTAIN = 1,
    /**
     * Fill the requested bounds, cropping when needed.
     *
     * @generated from enum value: IMAGE_FIT_MODE_COVER = 2;
     */
    COVER = 2
}
/**
 * Image transform parameters for generated image URLs.
 *
 * @generated from message chatto.api.v1.ImageTransformOptions
 */
export declare class ImageTransformOptions extends Message<ImageTransformOptions> {
    /**
     * Target image width in pixels.
     *
     * @generated from field: int32 width = 1;
     */
    width: number;
    /**
     * Target image height in pixels.
     *
     * @generated from field: int32 height = 2;
     */
    height: number;
    /**
     * Image crop/fit behavior.
     *
     * @generated from field: chatto.api.v1.ImageFitMode fit = 3;
     */
    fit: ImageFitMode;
    constructor(data?: PartialMessage<ImageTransformOptions>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ImageTransformOptions";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ImageTransformOptions;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ImageTransformOptions;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ImageTransformOptions;
    static equals(a: ImageTransformOptions | PlainMessage<ImageTransformOptions> | undefined, b: ImageTransformOptions | PlainMessage<ImageTransformOptions> | undefined): boolean;
}
/**
 * Browser-supplied image upload payload.
 *
 * @generated from message chatto.api.v1.ImageUpload
 */
export declare class ImageUpload extends Message<ImageUpload> {
    /**
     * Raw image bytes.
     *
     * @generated from field: bytes image = 1;
     */
    image: Uint8Array<ArrayBuffer>;
    /**
     * Original browser filename, for diagnostics and future compatibility.
     *
     * @generated from field: string filename = 2;
     */
    filename: string;
    /**
     * Browser-provided content type, for diagnostics and future compatibility.
     *
     * @generated from field: string content_type = 3;
     */
    contentType: string;
    constructor(data?: PartialMessage<ImageUpload>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ImageUpload";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ImageUpload;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ImageUpload;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ImageUpload;
    static equals(a: ImageUpload | PlainMessage<ImageUpload> | undefined, b: ImageUpload | PlainMessage<ImageUpload> | undefined): boolean;
}
/**
 * Public login/provider metadata shared by discovery and account-linking APIs.
 *
 * @generated from message chatto.api.v1.ProviderMetadata
 */
export declare class ProviderMetadata extends Message<ProviderMetadata> {
    /**
     * Stable configured provider ID.
     *
     * @generated from field: string id = 1;
     */
    id: string;
    /**
     * Provider type, such as "password", "oidc", "github", or "discord".
     *
     * @generated from field: string type = 2;
     */
    type: string;
    /**
     * Human-readable provider label.
     *
     * @generated from field: string label = 3;
     */
    label: string;
    /**
     * URL that starts login for this provider.
     *
     * @generated from field: string login_url = 4;
     */
    loginUrl: string;
    constructor(data?: PartialMessage<ProviderMetadata>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ProviderMetadata";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ProviderMetadata;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ProviderMetadata;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ProviderMetadata;
    static equals(a: ProviderMetadata | PlainMessage<ProviderMetadata> | undefined, b: ProviderMetadata | PlainMessage<ProviderMetadata> | undefined): boolean;
}
