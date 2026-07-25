import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3, Timestamp } from "@bufbuild/protobuf";
import { RoomSummary } from "./rooms_pb.js";
import { User } from "./users_pb.js";
/**
 * Request for active room call snapshots.
 *
 * @generated from message chatto.api.v1.ListActiveCallsRequest
 */
export declare class ListActiveCallsRequest extends Message<ListActiveCallsRequest> {
    constructor(data?: PartialMessage<ListActiveCallsRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListActiveCallsRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListActiveCallsRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListActiveCallsRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListActiveCallsRequest;
    static equals(a: ListActiveCallsRequest | PlainMessage<ListActiveCallsRequest> | undefined, b: ListActiveCallsRequest | PlainMessage<ListActiveCallsRequest> | undefined): boolean;
}
/**
 * Finite runtime snapshot of active room calls.
 *
 * @generated from message chatto.api.v1.ListActiveCallsResponse
 */
export declare class ListActiveCallsResponse extends Message<ListActiveCallsResponse> {
    /**
     * Active calls in room order returned by the call-state projection.
     *
     * @generated from field: repeated chatto.api.v1.ActiveCall calls = 1;
     */
    calls: ActiveCall[];
    constructor(data?: PartialMessage<ListActiveCallsResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListActiveCallsResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListActiveCallsResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListActiveCallsResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListActiveCallsResponse;
    static equals(a: ListActiveCallsResponse | PlainMessage<ListActiveCallsResponse> | undefined, b: ListActiveCallsResponse | PlainMessage<ListActiveCallsResponse> | undefined): boolean;
}
/**
 * Current active call snapshot for one room.
 *
 * @generated from message chatto.api.v1.ActiveCall
 */
export declare class ActiveCall extends Message<ActiveCall> {
    /**
     * Room containing the active call.
     *
     * @generated from field: chatto.api.v1.RoomSummary room = 4;
     */
    room?: RoomSummary;
    /**
     * Active call session ID.
     *
     * @generated from field: string call_id = 2;
     */
    callId: string;
    /**
     * Participants currently projected for this call.
     *
     * @generated from field: repeated chatto.api.v1.CallParticipant participants = 3;
     */
    participants: CallParticipant[];
    constructor(data?: PartialMessage<ActiveCall>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ActiveCall";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ActiveCall;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ActiveCall;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ActiveCall;
    static equals(a: ActiveCall | PlainMessage<ActiveCall> | undefined, b: ActiveCall | PlainMessage<ActiveCall> | undefined): boolean;
}
/**
 * Request for one room's active call snapshot.
 *
 * @generated from message chatto.api.v1.GetActiveCallRequest
 */
export declare class GetActiveCallRequest extends Message<GetActiveCallRequest> {
    /**
     * Required. Room whose active call should be inspected.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    constructor(data?: PartialMessage<GetActiveCallRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetActiveCallRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetActiveCallRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetActiveCallRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetActiveCallRequest;
    static equals(a: GetActiveCallRequest | PlainMessage<GetActiveCallRequest> | undefined, b: GetActiveCallRequest | PlainMessage<GetActiveCallRequest> | undefined): boolean;
}
/**
 * Response for one room's active call snapshot.
 *
 * @generated from message chatto.api.v1.GetActiveCallResponse
 */
export declare class GetActiveCallResponse extends Message<GetActiveCallResponse> {
    /**
     * Current active call.
     *
     * @generated from field: chatto.api.v1.ActiveCall call = 1;
     */
    call?: ActiveCall;
    constructor(data?: PartialMessage<GetActiveCallResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetActiveCallResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetActiveCallResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetActiveCallResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetActiveCallResponse;
    static equals(a: GetActiveCallResponse | PlainMessage<GetActiveCallResponse> | undefined, b: GetActiveCallResponse | PlainMessage<GetActiveCallResponse> | undefined): boolean;
}
/**
 * Request active call snapshots for many rooms.
 *
 * @generated from message chatto.api.v1.BatchGetActiveCallsRequest
 */
export declare class BatchGetActiveCallsRequest extends Message<BatchGetActiveCallsRequest> {
    /**
     * Required room IDs. Unknown, inaccessible, and inactive rooms are omitted.
     *
     * @generated from field: repeated string room_ids = 1;
     */
    roomIds: string[];
    constructor(data?: PartialMessage<BatchGetActiveCallsRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.BatchGetActiveCallsRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): BatchGetActiveCallsRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): BatchGetActiveCallsRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): BatchGetActiveCallsRequest;
    static equals(a: BatchGetActiveCallsRequest | PlainMessage<BatchGetActiveCallsRequest> | undefined, b: BatchGetActiveCallsRequest | PlainMessage<BatchGetActiveCallsRequest> | undefined): boolean;
}
/**
 * Active call batch response.
 *
 * @generated from message chatto.api.v1.BatchGetActiveCallsResponse
 */
export declare class BatchGetActiveCallsResponse extends Message<BatchGetActiveCallsResponse> {
    /**
     * Active calls in first-seen request order.
     *
     * @generated from field: repeated chatto.api.v1.ActiveCall calls = 1;
     */
    calls: ActiveCall[];
    constructor(data?: PartialMessage<BatchGetActiveCallsResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.BatchGetActiveCallsResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): BatchGetActiveCallsResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): BatchGetActiveCallsResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): BatchGetActiveCallsResponse;
    static equals(a: BatchGetActiveCallsResponse | PlainMessage<BatchGetActiveCallsResponse> | undefined, b: BatchGetActiveCallsResponse | PlainMessage<BatchGetActiveCallsResponse> | undefined): boolean;
}
/**
 * Request for participants in a room call.
 *
 * @generated from message chatto.api.v1.ListCallParticipantsRequest
 */
export declare class ListCallParticipantsRequest extends Message<ListCallParticipantsRequest> {
    /**
     * Required. Room whose active call should be inspected.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    constructor(data?: PartialMessage<ListCallParticipantsRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListCallParticipantsRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListCallParticipantsRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListCallParticipantsRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListCallParticipantsRequest;
    static equals(a: ListCallParticipantsRequest | PlainMessage<ListCallParticipantsRequest> | undefined, b: ListCallParticipantsRequest | PlainMessage<ListCallParticipantsRequest> | undefined): boolean;
}
/**
 * Finite runtime snapshot of participants in one room call.
 *
 * @generated from message chatto.api.v1.ListCallParticipantsResponse
 */
export declare class ListCallParticipantsResponse extends Message<ListCallParticipantsResponse> {
    /**
     * Participants currently projected for the room call.
     *
     * @generated from field: repeated chatto.api.v1.CallParticipant participants = 1;
     */
    participants: CallParticipant[];
    constructor(data?: PartialMessage<ListCallParticipantsResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListCallParticipantsResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListCallParticipantsResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListCallParticipantsResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListCallParticipantsResponse;
    static equals(a: ListCallParticipantsResponse | PlainMessage<ListCallParticipantsResponse> | undefined, b: ListCallParticipantsResponse | PlainMessage<ListCallParticipantsResponse> | undefined): boolean;
}
/**
 * User currently participating in a room call.
 *
 * @generated from message chatto.api.v1.CallParticipant
 */
export declare class CallParticipant extends Message<CallParticipant> {
    /**
     * Participant user.
     *
     * @generated from field: chatto.api.v1.User user = 1;
     */
    user?: User;
    /**
     * When the user joined this call.
     *
     * @generated from field: google.protobuf.Timestamp joined_at = 2;
     */
    joinedAt?: Timestamp;
    /**
     * Active call session ID.
     *
     * @generated from field: string call_id = 3;
     */
    callId: string;
    constructor(data?: PartialMessage<CallParticipant>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.CallParticipant";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): CallParticipant;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): CallParticipant;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): CallParticipant;
    static equals(a: CallParticipant | PlainMessage<CallParticipant> | undefined, b: CallParticipant | PlainMessage<CallParticipant> | undefined): boolean;
}
/**
 * Request to record joining a room call.
 *
 * @generated from message chatto.api.v1.JoinCallRequest
 */
export declare class JoinCallRequest extends Message<JoinCallRequest> {
    /**
     * Required. Room whose call is being joined.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    constructor(data?: PartialMessage<JoinCallRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.JoinCallRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): JoinCallRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): JoinCallRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): JoinCallRequest;
    static equals(a: JoinCallRequest | PlainMessage<JoinCallRequest> | undefined, b: JoinCallRequest | PlainMessage<JoinCallRequest> | undefined): boolean;
}
/**
 * Response from recording a join intent.
 *
 * @generated from message chatto.api.v1.JoinCallResponse
 */
export declare class JoinCallResponse extends Message<JoinCallResponse> {
    /**
     * True when a join fact was recorded.
     *
     * @generated from field: bool joined = 1;
     */
    joined: boolean;
    constructor(data?: PartialMessage<JoinCallResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.JoinCallResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): JoinCallResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): JoinCallResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): JoinCallResponse;
    static equals(a: JoinCallResponse | PlainMessage<JoinCallResponse> | undefined, b: JoinCallResponse | PlainMessage<JoinCallResponse> | undefined): boolean;
}
/**
 * Request for a LiveKit token for a room call.
 *
 * @generated from message chatto.api.v1.GetCallTokenRequest
 */
export declare class GetCallTokenRequest extends Message<GetCallTokenRequest> {
    /**
     * Required. Room whose active call should be joined.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    constructor(data?: PartialMessage<GetCallTokenRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetCallTokenRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetCallTokenRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetCallTokenRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetCallTokenRequest;
    static equals(a: GetCallTokenRequest | PlainMessage<GetCallTokenRequest> | undefined, b: GetCallTokenRequest | PlainMessage<GetCallTokenRequest> | undefined): boolean;
}
/**
 * LiveKit token details for joining a room call.
 *
 * @generated from message chatto.api.v1.GetCallTokenResponse
 */
export declare class GetCallTokenResponse extends Message<GetCallTokenResponse> {
    /**
     * LiveKit JWT token.
     *
     * @generated from field: string token = 1;
     */
    token: string;
    /**
     * Shared E2EE key for this active call.
     *
     * @generated from field: string e2ee_key = 2;
     */
    e2eeKey: string;
    /**
     * Active call session ID.
     *
     * @generated from field: string call_id = 3;
     */
    callId: string;
    constructor(data?: PartialMessage<GetCallTokenResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetCallTokenResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetCallTokenResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetCallTokenResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetCallTokenResponse;
    static equals(a: GetCallTokenResponse | PlainMessage<GetCallTokenResponse> | undefined, b: GetCallTokenResponse | PlainMessage<GetCallTokenResponse> | undefined): boolean;
}
/**
 * Request to record leaving a room call.
 *
 * @generated from message chatto.api.v1.LeaveCallRequest
 */
export declare class LeaveCallRequest extends Message<LeaveCallRequest> {
    /**
     * Required. Room whose call is being left.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    constructor(data?: PartialMessage<LeaveCallRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.LeaveCallRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): LeaveCallRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): LeaveCallRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): LeaveCallRequest;
    static equals(a: LeaveCallRequest | PlainMessage<LeaveCallRequest> | undefined, b: LeaveCallRequest | PlainMessage<LeaveCallRequest> | undefined): boolean;
}
/**
 * Response from recording a leave intent.
 *
 * @generated from message chatto.api.v1.LeaveCallResponse
 */
export declare class LeaveCallResponse extends Message<LeaveCallResponse> {
    /**
     * True when a leave fact was recorded.
     *
     * @generated from field: bool left = 1;
     */
    left: boolean;
    constructor(data?: PartialMessage<LeaveCallResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.LeaveCallResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): LeaveCallResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): LeaveCallResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): LeaveCallResponse;
    static equals(a: LeaveCallResponse | PlainMessage<LeaveCallResponse> | undefined, b: LeaveCallResponse | PlainMessage<LeaveCallResponse> | undefined): boolean;
}
