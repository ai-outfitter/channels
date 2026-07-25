import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3, Timestamp } from "@bufbuild/protobuf";
import { MessageAssetUrl, MessageVideoProcessing } from "./message_types_pb.js";
import { ImageTransformOptions } from "./common_pb.js";
/**
 * Room-scoped binary asset metadata and freshly signed URLs.
 *
 * @generated from message chatto.api.v1.Asset
 */
export declare class Asset extends Message<Asset> {
    /**
     * Stable asset ID.
     *
     * @generated from field: string id = 1;
     */
    id: string;
    /**
     * Original filename.
     *
     * @generated from field: string filename = 2;
     */
    filename: string;
    /**
     * MIME content type.
     *
     * @generated from field: string content_type = 3;
     */
    contentType: string;
    /**
     * Stored file size in bytes.
     *
     * @generated from field: int64 size = 4;
     */
    size: bigint;
    /**
     * Media width when known.
     *
     * @generated from field: int32 width = 5;
     */
    width: number;
    /**
     * Media height when known.
     *
     * @generated from field: int32 height = 6;
     */
    height: number;
    /**
     * Signed URL for the original asset bytes.
     *
     * @generated from field: chatto.api.v1.MessageAssetUrl asset_url = 7;
     */
    assetUrl?: MessageAssetUrl;
    /**
     * Signed URL for a transformed image thumbnail.
     *
     * @generated from field: chatto.api.v1.MessageAssetUrl thumbnail_asset_url = 8;
     */
    thumbnailAssetUrl?: MessageAssetUrl;
    /**
     * Video processing state when this asset is a video attachment.
     *
     * @generated from field: chatto.api.v1.MessageVideoProcessing video_processing = 9;
     */
    videoProcessing?: MessageVideoProcessing;
    constructor(data?: PartialMessage<Asset>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.Asset";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): Asset;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): Asset;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): Asset;
    static equals(a: Asset | PlainMessage<Asset> | undefined, b: Asset | PlainMessage<Asset> | undefined): boolean;
}
/**
 * One current room attachment and its message anchor.
 *
 * @generated from message chatto.api.v1.RoomAttachmentListItem
 */
export declare class RoomAttachmentListItem extends Message<RoomAttachmentListItem> {
    /**
     * Attachment metadata and signed URLs.
     *
     * @generated from field: chatto.api.v1.Asset attachment = 1;
     */
    attachment?: Asset;
    /**
     * Message event containing the attachment.
     *
     * @generated from field: string message_event_id = 2;
     */
    messageEventId: string;
    /**
     * Thread root event ID when the containing message is a thread reply.
     *
     * @generated from field: string thread_root_event_id = 3;
     */
    threadRootEventId: string;
    /**
     * Message creation timestamp.
     *
     * @generated from field: google.protobuf.Timestamp created_at = 4;
     */
    createdAt?: Timestamp;
    constructor(data?: PartialMessage<RoomAttachmentListItem>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RoomAttachmentListItem";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RoomAttachmentListItem;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RoomAttachmentListItem;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RoomAttachmentListItem;
    static equals(a: RoomAttachmentListItem | PlainMessage<RoomAttachmentListItem> | undefined, b: RoomAttachmentListItem | PlainMessage<RoomAttachmentListItem> | undefined): boolean;
}
/**
 * Request to read one room-scoped asset with freshly signed URLs.
 *
 * @generated from message chatto.api.v1.GetAssetRequest
 */
export declare class GetAssetRequest extends Message<GetAssetRequest> {
    /**
     * Required. Room that owns the asset.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Required. Asset ID.
     *
     * @generated from field: string asset_id = 2;
     */
    assetId: string;
    /**
     * Thumbnail URL options. Defaults are applied when absent.
     *
     * @generated from field: chatto.api.v1.ImageTransformOptions thumbnail = 3;
     */
    thumbnail?: ImageTransformOptions;
    constructor(data?: PartialMessage<GetAssetRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetAssetRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetAssetRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetAssetRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetAssetRequest;
    static equals(a: GetAssetRequest | PlainMessage<GetAssetRequest> | undefined, b: GetAssetRequest | PlainMessage<GetAssetRequest> | undefined): boolean;
}
/**
 * Response containing one room-scoped asset.
 *
 * @generated from message chatto.api.v1.GetAssetResponse
 */
export declare class GetAssetResponse extends Message<GetAssetResponse> {
    /**
     * Asset metadata and signed URLs.
     *
     * @generated from field: chatto.api.v1.Asset asset = 1;
     */
    asset?: Asset;
    constructor(data?: PartialMessage<GetAssetResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetAssetResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetAssetResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetAssetResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetAssetResponse;
    static equals(a: GetAssetResponse | PlainMessage<GetAssetResponse> | undefined, b: GetAssetResponse | PlainMessage<GetAssetResponse> | undefined): boolean;
}
/**
 * Request to read many room-scoped assets with freshly signed URLs.
 *
 * @generated from message chatto.api.v1.BatchGetAssetsRequest
 */
export declare class BatchGetAssetsRequest extends Message<BatchGetAssetsRequest> {
    /**
     * Required. Room that owns the assets.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Required. Asset IDs. Missing, deleted, and wrong-room asset IDs are omitted.
     *
     * @generated from field: repeated string asset_ids = 2;
     */
    assetIds: string[];
    /**
     * Thumbnail URL options. Defaults are applied when absent.
     *
     * @generated from field: chatto.api.v1.ImageTransformOptions thumbnail = 3;
     */
    thumbnail?: ImageTransformOptions;
    constructor(data?: PartialMessage<BatchGetAssetsRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.BatchGetAssetsRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): BatchGetAssetsRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): BatchGetAssetsRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): BatchGetAssetsRequest;
    static equals(a: BatchGetAssetsRequest | PlainMessage<BatchGetAssetsRequest> | undefined, b: BatchGetAssetsRequest | PlainMessage<BatchGetAssetsRequest> | undefined): boolean;
}
/**
 * Response containing room-scoped assets.
 *
 * @generated from message chatto.api.v1.BatchGetAssetsResponse
 */
export declare class BatchGetAssetsResponse extends Message<BatchGetAssetsResponse> {
    /**
     * Assets in first-seen request order.
     *
     * @generated from field: repeated chatto.api.v1.Asset assets = 1;
     */
    assets: Asset[];
    constructor(data?: PartialMessage<BatchGetAssetsResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.BatchGetAssetsResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): BatchGetAssetsResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): BatchGetAssetsResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): BatchGetAssetsResponse;
    static equals(a: BatchGetAssetsResponse | PlainMessage<BatchGetAssetsResponse> | undefined, b: BatchGetAssetsResponse | PlainMessage<BatchGetAssetsResponse> | undefined): boolean;
}
