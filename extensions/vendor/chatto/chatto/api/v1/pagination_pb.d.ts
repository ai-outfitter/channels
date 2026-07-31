import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3 } from "@bufbuild/protobuf";
/**
 * Offset-based page request for list RPCs whose result order is stable enough
 * for simple list browsing.
 *
 * @generated from message chatto.api.v1.PageRequest
 */
export declare class PageRequest extends Message<PageRequest> {
    /**
     * Maximum number of items to request. Each RPC defines its default and
     * effective maximum; this shared request shape accepts values up to 500.
     *
     * @generated from field: int32 limit = 1;
     */
    limit: number;
    /**
     * Zero-based number of matching items to skip.
     *
     * @generated from field: int32 offset = 2;
     */
    offset: number;
    constructor(data?: PartialMessage<PageRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.PageRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): PageRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): PageRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): PageRequest;
    static equals(a: PageRequest | PlainMessage<PageRequest> | undefined, b: PageRequest | PlainMessage<PageRequest> | undefined): boolean;
}
/**
 * Offset-based page metadata returned by list RPCs.
 *
 * @generated from message chatto.api.v1.PageInfo
 */
export declare class PageInfo extends Message<PageInfo> {
    /**
     * Total matching item count before pagination.
     *
     * @generated from field: int64 total_count = 1;
     */
    totalCount: bigint;
    /**
     * True when another page exists after this response.
     *
     * @generated from field: bool has_more = 2;
     */
    hasMore: boolean;
    constructor(data?: PartialMessage<PageInfo>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.PageInfo";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): PageInfo;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): PageInfo;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): PageInfo;
    static equals(a: PageInfo | PlainMessage<PageInfo> | undefined, b: PageInfo | PlainMessage<PageInfo> | undefined): boolean;
}
