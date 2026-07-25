import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3, Timestamp } from "@bufbuild/protobuf";
import { Asset } from "./attachments_pb.js";
/**
 * Upload lifecycle state for a room-scoped attachment upload.
 *
 * @generated from enum chatto.api.v1.AssetUploadStatus
 */
export declare enum AssetUploadStatus {
    /**
     * The upload status was not specified.
     *
     * @generated from enum value: ASSET_UPLOAD_STATUS_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * The upload accepts more chunks.
     *
     * @generated from enum value: ASSET_UPLOAD_STATUS_OPEN = 1;
     */
    OPEN = 1,
    /**
     * The upload has been completed and produced an attachment asset.
     *
     * @generated from enum value: ASSET_UPLOAD_STATUS_COMPLETED = 2;
     */
    COMPLETED = 2,
    /**
     * The upload was cancelled or expired.
     *
     * @generated from enum value: ASSET_UPLOAD_STATUS_CANCELLED = 3;
     */
    CANCELLED = 3
}
/**
 * Current server-side state for one room-scoped attachment upload.
 *
 * @generated from message chatto.api.v1.AssetUpload
 */
export declare class AssetUpload extends Message<AssetUpload> {
    /**
     * Upload session ID.
     *
     * @generated from field: string upload_id = 1;
     */
    uploadId: string;
    /**
     * Room the resulting attachment asset will belong to.
     *
     * @generated from field: string room_id = 2;
     */
    roomId: string;
    /**
     * Current upload status.
     *
     * @generated from field: chatto.api.v1.AssetUploadStatus status = 3;
     */
    status: AssetUploadStatus;
    /**
     * Number of bytes committed so far.
     *
     * @generated from field: int64 committed_offset = 4;
     */
    committedOffset: bigint;
    /**
     * Total declared file size in bytes.
     *
     * @generated from field: int64 size = 5;
     */
    size: bigint;
    /**
     * Maximum accepted chunk size in bytes.
     *
     * @generated from field: int32 max_chunk_size = 6;
     */
    maxChunkSize: number;
    /**
     * SHA-256 digest of the complete file, lowercase hexadecimal.
     *
     * @generated from field: string sha256 = 7;
     */
    sha256: string;
    /**
     * Upload expiry. Clients should create a new upload after this time.
     *
     * @generated from field: google.protobuf.Timestamp expires_at = 8;
     */
    expiresAt?: Timestamp;
    /**
     * Asset ID after completion.
     *
     * @generated from field: string asset_id = 9;
     */
    assetId: string;
    constructor(data?: PartialMessage<AssetUpload>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.AssetUpload";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): AssetUpload;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): AssetUpload;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): AssetUpload;
    static equals(a: AssetUpload | PlainMessage<AssetUpload> | undefined, b: AssetUpload | PlainMessage<AssetUpload> | undefined): boolean;
}
/**
 * Request to start a room-scoped attachment upload.
 *
 * @generated from message chatto.api.v1.CreateUploadRequest
 */
export declare class CreateUploadRequest extends Message<CreateUploadRequest> {
    /**
     * Required room ID.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Original filename supplied by the client.
     *
     * @generated from field: string filename = 2;
     */
    filename: string;
    /**
     * MIME content type. Empty values are treated as application/octet-stream.
     *
     * @generated from field: string content_type = 3;
     */
    contentType: string;
    /**
     * Required total file size in bytes.
     *
     * @generated from field: int64 size = 4;
     */
    size: bigint;
    /**
     * Required SHA-256 digest of the complete file, lowercase hexadecimal.
     *
     * @generated from field: string sha256 = 5;
     */
    sha256: string;
    constructor(data?: PartialMessage<CreateUploadRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.CreateUploadRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): CreateUploadRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): CreateUploadRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): CreateUploadRequest;
    static equals(a: CreateUploadRequest | PlainMessage<CreateUploadRequest> | undefined, b: CreateUploadRequest | PlainMessage<CreateUploadRequest> | undefined): boolean;
}
/**
 * Response after creating an upload.
 *
 * @generated from message chatto.api.v1.CreateUploadResponse
 */
export declare class CreateUploadResponse extends Message<CreateUploadResponse> {
    /**
     * Created upload session.
     *
     * @generated from field: chatto.api.v1.AssetUpload upload = 1;
     */
    upload?: AssetUpload;
    constructor(data?: PartialMessage<CreateUploadResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.CreateUploadResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): CreateUploadResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): CreateUploadResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): CreateUploadResponse;
    static equals(a: CreateUploadResponse | PlainMessage<CreateUploadResponse> | undefined, b: CreateUploadResponse | PlainMessage<CreateUploadResponse> | undefined): boolean;
}
/**
 * Request to append one chunk to an upload.
 *
 * @generated from message chatto.api.v1.UploadChunkRequest
 */
export declare class UploadChunkRequest extends Message<UploadChunkRequest> {
    /**
     * Required upload session ID.
     *
     * @generated from field: string upload_id = 1;
     */
    uploadId: string;
    /**
     * Byte offset where this chunk starts.
     *
     * @generated from field: int64 offset = 2;
     */
    offset: bigint;
    /**
     * Chunk bytes. The server enforces a per-RPC size limit.
     *
     * @generated from field: bytes content = 3;
     */
    content: Uint8Array<ArrayBuffer>;
    /**
     * SHA-256 digest of this chunk, lowercase hexadecimal.
     *
     * @generated from field: string chunk_sha256 = 4;
     */
    chunkSha256: string;
    constructor(data?: PartialMessage<UploadChunkRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UploadChunkRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UploadChunkRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UploadChunkRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UploadChunkRequest;
    static equals(a: UploadChunkRequest | PlainMessage<UploadChunkRequest> | undefined, b: UploadChunkRequest | PlainMessage<UploadChunkRequest> | undefined): boolean;
}
/**
 * Response after committing an upload chunk.
 *
 * @generated from message chatto.api.v1.UploadChunkResponse
 */
export declare class UploadChunkResponse extends Message<UploadChunkResponse> {
    /**
     * Updated upload session.
     *
     * @generated from field: chatto.api.v1.AssetUpload upload = 1;
     */
    upload?: AssetUpload;
    constructor(data?: PartialMessage<UploadChunkResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UploadChunkResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UploadChunkResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UploadChunkResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UploadChunkResponse;
    static equals(a: UploadChunkResponse | PlainMessage<UploadChunkResponse> | undefined, b: UploadChunkResponse | PlainMessage<UploadChunkResponse> | undefined): boolean;
}
/**
 * Request to fetch upload state.
 *
 * @generated from message chatto.api.v1.GetUploadRequest
 */
export declare class GetUploadRequest extends Message<GetUploadRequest> {
    /**
     * Required upload session ID.
     *
     * @generated from field: string upload_id = 1;
     */
    uploadId: string;
    constructor(data?: PartialMessage<GetUploadRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetUploadRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetUploadRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetUploadRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetUploadRequest;
    static equals(a: GetUploadRequest | PlainMessage<GetUploadRequest> | undefined, b: GetUploadRequest | PlainMessage<GetUploadRequest> | undefined): boolean;
}
/**
 * Response containing upload state.
 *
 * @generated from message chatto.api.v1.GetUploadResponse
 */
export declare class GetUploadResponse extends Message<GetUploadResponse> {
    /**
     * Current upload session.
     *
     * @generated from field: chatto.api.v1.AssetUpload upload = 1;
     */
    upload?: AssetUpload;
    constructor(data?: PartialMessage<GetUploadResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetUploadResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetUploadResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetUploadResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetUploadResponse;
    static equals(a: GetUploadResponse | PlainMessage<GetUploadResponse> | undefined, b: GetUploadResponse | PlainMessage<GetUploadResponse> | undefined): boolean;
}
/**
 * Request to complete an upload and create its attachment asset.
 *
 * @generated from message chatto.api.v1.CompleteUploadRequest
 */
export declare class CompleteUploadRequest extends Message<CompleteUploadRequest> {
    /**
     * Required upload session ID.
     *
     * @generated from field: string upload_id = 1;
     */
    uploadId: string;
    constructor(data?: PartialMessage<CompleteUploadRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.CompleteUploadRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): CompleteUploadRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): CompleteUploadRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): CompleteUploadRequest;
    static equals(a: CompleteUploadRequest | PlainMessage<CompleteUploadRequest> | undefined, b: CompleteUploadRequest | PlainMessage<CompleteUploadRequest> | undefined): boolean;
}
/**
 * Response after an upload completes.
 *
 * @generated from message chatto.api.v1.CompleteUploadResponse
 */
export declare class CompleteUploadResponse extends Message<CompleteUploadResponse> {
    /**
     * Completed upload session.
     *
     * @generated from field: chatto.api.v1.AssetUpload upload = 1;
     */
    upload?: AssetUpload;
    /**
     * Attachment asset produced by this upload.
     *
     * @generated from field: chatto.api.v1.Asset asset = 2;
     */
    asset?: Asset;
    constructor(data?: PartialMessage<CompleteUploadResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.CompleteUploadResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): CompleteUploadResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): CompleteUploadResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): CompleteUploadResponse;
    static equals(a: CompleteUploadResponse | PlainMessage<CompleteUploadResponse> | undefined, b: CompleteUploadResponse | PlainMessage<CompleteUploadResponse> | undefined): boolean;
}
/**
 * Request to cancel an upload.
 *
 * @generated from message chatto.api.v1.CancelUploadRequest
 */
export declare class CancelUploadRequest extends Message<CancelUploadRequest> {
    /**
     * Required upload session ID.
     *
     * @generated from field: string upload_id = 1;
     */
    uploadId: string;
    constructor(data?: PartialMessage<CancelUploadRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.CancelUploadRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): CancelUploadRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): CancelUploadRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): CancelUploadRequest;
    static equals(a: CancelUploadRequest | PlainMessage<CancelUploadRequest> | undefined, b: CancelUploadRequest | PlainMessage<CancelUploadRequest> | undefined): boolean;
}
/**
 * Response after cancelling an upload.
 *
 * @generated from message chatto.api.v1.CancelUploadResponse
 */
export declare class CancelUploadResponse extends Message<CancelUploadResponse> {
    /**
     * Updated upload session.
     *
     * @generated from field: chatto.api.v1.AssetUpload upload = 1;
     */
    upload?: AssetUpload;
    constructor(data?: PartialMessage<CancelUploadResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.CancelUploadResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): CancelUploadResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): CancelUploadResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): CancelUploadResponse;
    static equals(a: CancelUploadResponse | PlainMessage<CancelUploadResponse> | undefined, b: CancelUploadResponse | PlainMessage<CancelUploadResponse> | undefined): boolean;
}
