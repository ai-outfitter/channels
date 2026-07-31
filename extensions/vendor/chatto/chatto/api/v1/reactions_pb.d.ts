import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3 } from "@bufbuild/protobuf";
import { MessageReaction } from "./message_types_pb.js";
/**
 * Request to add the current user's reaction to a message.
 *
 * When `message_event_id` names a channel echo of a thread reply, the server
 * treats it as an alias for the original thread reply and stores the reaction
 * on that original event.
 *
 * @generated from message chatto.api.v1.AddReactionRequest
 */
export declare class AddReactionRequest extends Message<AddReactionRequest> {
    /**
     * Required. Room containing the message event.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Required. Event ID of the message being reacted to, or a channel echo of
     * the message.
     *
     * @generated from field: string message_event_id = 2;
     */
    messageEventId: string;
    /**
     * Required. Emoji shortcode name, such as "thumbsup" or "heart".
     *
     * @generated from field: string emoji = 3;
     */
    emoji: string;
    constructor(data?: PartialMessage<AddReactionRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.AddReactionRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): AddReactionRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): AddReactionRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): AddReactionRequest;
    static equals(a: AddReactionRequest | PlainMessage<AddReactionRequest> | undefined, b: AddReactionRequest | PlainMessage<AddReactionRequest> | undefined): boolean;
}
/**
 * Result of adding a reaction.
 *
 * @generated from message chatto.api.v1.AddReactionResponse
 */
export declare class AddReactionResponse extends Message<AddReactionResponse> {
    /**
     * True when the reaction was newly added, false when it already existed.
     *
     * @generated from field: bool added = 1;
     */
    added: boolean;
    /**
     * Updated aggregate reaction state for this emoji.
     *
     * @generated from field: chatto.api.v1.MessageReaction reaction = 2;
     */
    reaction?: MessageReaction;
    constructor(data?: PartialMessage<AddReactionResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.AddReactionResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): AddReactionResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): AddReactionResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): AddReactionResponse;
    static equals(a: AddReactionResponse | PlainMessage<AddReactionResponse> | undefined, b: AddReactionResponse | PlainMessage<AddReactionResponse> | undefined): boolean;
}
/**
 * Request to remove the current user's reaction from a message.
 *
 * When `message_event_id` names a channel echo of a thread reply, the server
 * treats it as an alias for the original thread reply and removes the reaction
 * from that original event.
 *
 * @generated from message chatto.api.v1.RemoveReactionRequest
 */
export declare class RemoveReactionRequest extends Message<RemoveReactionRequest> {
    /**
     * Required. Room containing the message event.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Required. Event ID of the message whose reaction should be removed, or a
     * channel echo of the message.
     *
     * @generated from field: string message_event_id = 2;
     */
    messageEventId: string;
    /**
     * Required. Emoji shortcode name, such as "thumbsup" or "heart".
     *
     * @generated from field: string emoji = 3;
     */
    emoji: string;
    constructor(data?: PartialMessage<RemoveReactionRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RemoveReactionRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RemoveReactionRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RemoveReactionRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RemoveReactionRequest;
    static equals(a: RemoveReactionRequest | PlainMessage<RemoveReactionRequest> | undefined, b: RemoveReactionRequest | PlainMessage<RemoveReactionRequest> | undefined): boolean;
}
/**
 * Result of removing a reaction.
 *
 * @generated from message chatto.api.v1.RemoveReactionResponse
 */
export declare class RemoveReactionResponse extends Message<RemoveReactionResponse> {
    /**
     * True when the reaction was removed, false when it did not exist.
     *
     * @generated from field: bool removed = 1;
     */
    removed: boolean;
    /**
     * Updated aggregate reaction state for this emoji. Empty when no reactions for
     * the emoji remain.
     *
     * @generated from field: chatto.api.v1.MessageReaction reaction = 2;
     */
    reaction?: MessageReaction;
    constructor(data?: PartialMessage<RemoveReactionResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RemoveReactionResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RemoveReactionResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RemoveReactionResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RemoveReactionResponse;
    static equals(a: RemoveReactionResponse | PlainMessage<RemoveReactionResponse> | undefined, b: RemoveReactionResponse | PlainMessage<RemoveReactionResponse> | undefined): boolean;
}
