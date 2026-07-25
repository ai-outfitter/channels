import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3, Timestamp } from "@bufbuild/protobuf";
/**
 * Request to fetch server-side link preview metadata for a URL.
 *
 * @generated from message chatto.api.v1.FetchLinkPreviewRequest
 */
export declare class FetchLinkPreviewRequest extends Message<FetchLinkPreviewRequest> {
    /**
     * URL to preview.
     *
     * @generated from field: string url = 1;
     */
    url: string;
    constructor(data?: PartialMessage<FetchLinkPreviewRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.FetchLinkPreviewRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): FetchLinkPreviewRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): FetchLinkPreviewRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): FetchLinkPreviewRequest;
    static equals(a: FetchLinkPreviewRequest | PlainMessage<FetchLinkPreviewRequest> | undefined, b: FetchLinkPreviewRequest | PlainMessage<FetchLinkPreviewRequest> | undefined): boolean;
}
/**
 * Link preview metadata used by message composers and room timeline events.
 *
 * Clients should treat optional metadata as unavailable when absent. Message
 * creation accepts only the preview_token returned by FetchLinkPreview, not
 * client-provided metadata fields.
 *
 * @generated from message chatto.api.v1.LinkPreview
 */
export declare class LinkPreview extends Message<LinkPreview> {
    /**
     * Previewed URL.
     *
     * @generated from field: string url = 1;
     */
    url: string;
    /**
     * Page or embed title.
     *
     * @generated from field: optional string title = 2;
     */
    title?: string;
    /**
     * Page or embed description.
     *
     * @generated from field: optional string description = 3;
     */
    description?: string;
    /**
     * Preview image URL, when available.
     *
     * @generated from field: optional string image_url = 4;
     */
    imageUrl?: string;
    /**
     * Existing server asset ID for the preview image, when cached or stored with
     * the message.
     *
     * @generated from field: optional string image_asset_id = 5;
     */
    imageAssetId?: string;
    /**
     * Site name, when known.
     *
     * @generated from field: optional string site_name = 6;
     */
    siteName?: string;
    /**
     * Embed provider or type, when recognized.
     *
     * @generated from field: optional string embed_type = 7;
     */
    embedType?: string;
    /**
     * Provider-specific embed ID, when recognized.
     *
     * @generated from field: optional string embed_id = 8;
     */
    embedId?: string;
    /**
     * Structured, provider-neutral social-post data for native rendering.
     *
     * @generated from field: chatto.api.v1.SocialPostPreview social_post = 9;
     */
    socialPost?: SocialPostPreview;
    constructor(data?: PartialMessage<LinkPreview>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.LinkPreview";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): LinkPreview;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): LinkPreview;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): LinkPreview;
    static equals(a: LinkPreview | PlainMessage<LinkPreview> | undefined, b: LinkPreview | PlainMessage<LinkPreview> | undefined): boolean;
}
/**
 * Bounded, provider-neutral social-post data used for native preview cards.
 *
 * @generated from message chatto.api.v1.SocialPostPreview
 */
export declare class SocialPostPreview extends Message<SocialPostPreview> {
    /**
     * Stable lowercase provider identifier, such as "bluesky".
     *
     * @generated from field: string provider = 1;
     */
    provider: string;
    /**
     * Author shown on the post.
     *
     * @generated from field: chatto.api.v1.SocialPostAuthor author = 2;
     */
    author?: SocialPostAuthor;
    /**
     * Plain-text post body.
     *
     * @generated from field: string text = 3;
     */
    text: string;
    /**
     * Post publication time.
     *
     * @generated from field: google.protobuf.Timestamp published_at = 4;
     */
    publishedAt?: Timestamp;
    /**
     * Images attached directly to the post, in display order.
     *
     * @generated from field: repeated chatto.api.v1.SocialPostImage images = 5;
     */
    images: SocialPostImage[];
    /**
     * Website card embedded in the post, when present.
     *
     * @generated from field: chatto.api.v1.SocialPostExternalLink external_link = 6;
     */
    externalLink?: SocialPostExternalLink;
    /**
     * Provider-supplied content warning, when present.
     *
     * @generated from field: optional string content_warning = 7;
     */
    contentWarning?: string;
    /**
     * Canonical URL for this post. Always set for quoted posts; the outer post
     * may also use LinkPreview.url.
     *
     * @generated from field: string url = 8;
     */
    url: string;
    /**
     * Post quoted by this post, when present. Quotes inside this snapshot are
     * omitted so preview size and rendering depth remain bounded.
     *
     * @generated from field: chatto.api.v1.SocialPostPreview quoted_post = 9;
     */
    quotedPost?: SocialPostPreview;
    constructor(data?: PartialMessage<SocialPostPreview>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.SocialPostPreview";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): SocialPostPreview;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): SocialPostPreview;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): SocialPostPreview;
    static equals(a: SocialPostPreview | PlainMessage<SocialPostPreview> | undefined, b: SocialPostPreview | PlainMessage<SocialPostPreview> | undefined): boolean;
}
/**
 * Author shown on a social-post preview.
 *
 * @generated from message chatto.api.v1.SocialPostAuthor
 */
export declare class SocialPostAuthor extends Message<SocialPostAuthor> {
    /**
     * Author display name.
     *
     * @generated from field: string display_name = 1;
     */
    displayName: string;
    /**
     * Provider-native handle without a leading at-sign when applicable.
     *
     * @generated from field: string handle = 2;
     */
    handle: string;
    /**
     * Locally served author avatar URL, when available.
     *
     * @generated from field: optional string avatar_url = 3;
     */
    avatarUrl?: string;
    /**
     * Locally stored author avatar asset ID, when available.
     *
     * @generated from field: optional string avatar_asset_id = 4;
     */
    avatarAssetId?: string;
    constructor(data?: PartialMessage<SocialPostAuthor>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.SocialPostAuthor";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): SocialPostAuthor;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): SocialPostAuthor;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): SocialPostAuthor;
    static equals(a: SocialPostAuthor | PlainMessage<SocialPostAuthor> | undefined, b: SocialPostAuthor | PlainMessage<SocialPostAuthor> | undefined): boolean;
}
/**
 * One image attached directly to a social post.
 *
 * @generated from message chatto.api.v1.SocialPostImage
 */
export declare class SocialPostImage extends Message<SocialPostImage> {
    /**
     * Locally served image URL.
     *
     * @generated from field: string url = 1;
     */
    url: string;
    /**
     * Locally stored image asset ID.
     *
     * @generated from field: string asset_id = 2;
     */
    assetId: string;
    /**
     * Author-provided alternative text.
     *
     * @generated from field: optional string alt = 3;
     */
    alt?: string;
    /**
     * Source aspect-ratio width, when known.
     *
     * @generated from field: optional uint32 width = 4;
     */
    width?: number;
    /**
     * Source aspect-ratio height, when known.
     *
     * @generated from field: optional uint32 height = 5;
     */
    height?: number;
    constructor(data?: PartialMessage<SocialPostImage>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.SocialPostImage";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): SocialPostImage;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): SocialPostImage;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): SocialPostImage;
    static equals(a: SocialPostImage | PlainMessage<SocialPostImage> | undefined, b: SocialPostImage | PlainMessage<SocialPostImage> | undefined): boolean;
}
/**
 * Website card embedded in a social post.
 *
 * @generated from message chatto.api.v1.SocialPostExternalLink
 */
export declare class SocialPostExternalLink extends Message<SocialPostExternalLink> {
    /**
     * Destination URL.
     *
     * @generated from field: string url = 1;
     */
    url: string;
    /**
     * Card title, when available.
     *
     * @generated from field: optional string title = 2;
     */
    title?: string;
    /**
     * Card description, when available.
     *
     * @generated from field: optional string description = 3;
     */
    description?: string;
    /**
     * Locally served card image URL, when available.
     *
     * @generated from field: optional string image_url = 4;
     */
    imageUrl?: string;
    /**
     * Locally stored card image asset ID, when available.
     *
     * @generated from field: optional string image_asset_id = 5;
     */
    imageAssetId?: string;
    constructor(data?: PartialMessage<SocialPostExternalLink>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.SocialPostExternalLink";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): SocialPostExternalLink;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): SocialPostExternalLink;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): SocialPostExternalLink;
    static equals(a: SocialPostExternalLink | PlainMessage<SocialPostExternalLink> | undefined, b: SocialPostExternalLink | PlainMessage<SocialPostExternalLink> | undefined): boolean;
}
/**
 * Result of fetching link preview metadata.
 *
 * @generated from message chatto.api.v1.FetchLinkPreviewResponse
 */
export declare class FetchLinkPreviewResponse extends Message<FetchLinkPreviewResponse> {
    /**
     * Preview metadata, or absent when the URL cannot be previewed.
     *
     * @generated from field: chatto.api.v1.LinkPreview preview = 1;
     */
    preview?: LinkPreview;
    /**
     * Short-lived opaque token to pass to CreateMessage.link_preview_token when
     * the user posts this preview.
     *
     * @generated from field: string preview_token = 2;
     */
    previewToken: string;
    constructor(data?: PartialMessage<FetchLinkPreviewResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.FetchLinkPreviewResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): FetchLinkPreviewResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): FetchLinkPreviewResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): FetchLinkPreviewResponse;
    static equals(a: FetchLinkPreviewResponse | PlainMessage<FetchLinkPreviewResponse> | undefined, b: FetchLinkPreviewResponse | PlainMessage<FetchLinkPreviewResponse> | undefined): boolean;
}
