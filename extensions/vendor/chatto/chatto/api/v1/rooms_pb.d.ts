import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3, Timestamp } from "@bufbuild/protobuf";
import { DirectoryMember } from "./member_directory_pb.js";
import { PageInfo, PageRequest } from "./pagination_pb.js";
import { ImageTransformOptions } from "./common_pb.js";
import { RoomAttachmentListItem } from "./attachments_pb.js";
/**
 * Kind of room represented by the public API.
 *
 * @generated from enum chatto.api.v1.RoomKind
 */
export declare enum RoomKind {
    /**
     * The room kind was not specified.
     *
     * @generated from enum value: ROOM_KIND_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * A regular channel governed by server and room permissions.
     *
     * @generated from enum value: ROOM_KIND_CHANNEL = 1;
     */
    CHANNEL = 1,
    /**
     * A direct-message conversation between members.
     *
     * @generated from enum value: ROOM_KIND_DM = 2;
     */
    DM = 2
}
/**
 * Public room metadata returned by room commands.
 *
 * @generated from message chatto.api.v1.Room
 */
export declare class Room extends Message<Room> {
    /**
     * Stable room ID.
     *
     * @generated from field: string id = 1;
     */
    id: string;
    /**
     * Room kind.
     *
     * @generated from field: chatto.api.v1.RoomKind kind = 2;
     */
    kind: RoomKind;
    /**
     * Room name. Direct-message rooms may have an empty name because clients
     * derive their display label from participants.
     *
     * @generated from field: string name = 3;
     */
    name: string;
    /**
     * Optional room description.
     *
     * @generated from field: string description = 4;
     */
    description: string;
    /**
     * True when the room is archived and hidden from active room lists.
     *
     * @generated from field: bool archived = 5;
     */
    archived: boolean;
    /**
     * Room group ID for channel rooms. Empty for direct-message rooms.
     *
     * @generated from field: string group_id = 6;
     */
    groupId: string;
    /**
     * True when a channel grants effective membership to eligible server members.
     *
     * @generated from field: bool universal = 7;
     */
    universal: boolean;
    constructor(data?: PartialMessage<Room>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.Room";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): Room;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): Room;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): Room;
    static equals(a: Room | PlainMessage<Room> | undefined, b: Room | PlainMessage<Room> | undefined): boolean;
}
/**
 * Lightweight room reference for cross-resource rows.
 *
 * @generated from message chatto.api.v1.RoomSummary
 */
export declare class RoomSummary extends Message<RoomSummary> {
    /**
     * Stable room ID.
     *
     * @generated from field: string id = 1;
     */
    id: string;
    /**
     * Room kind.
     *
     * @generated from field: chatto.api.v1.RoomKind kind = 2;
     */
    kind: RoomKind;
    /**
     * Room name. Direct-message rooms may have an empty name because clients
     * derive their display label from participants.
     *
     * @generated from field: string name = 3;
     */
    name: string;
    constructor(data?: PartialMessage<RoomSummary>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RoomSummary";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RoomSummary;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RoomSummary;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RoomSummary;
    static equals(a: RoomSummary | PlainMessage<RoomSummary> | undefined, b: RoomSummary | PlainMessage<RoomSummary> | undefined): boolean;
}
/**
 * Request to create a channel room.
 *
 * @generated from message chatto.api.v1.CreateRoomRequest
 */
export declare class CreateRoomRequest extends Message<CreateRoomRequest> {
    /**
     * Required. NFC-normalized name of the new channel room. Names accept
     * Unicode letters, decimal digits, hyphens, and underscores.
     *
     * @generated from field: string name = 1;
     */
    name: string;
    /**
     * Optional room description.
     *
     * @generated from field: string description = 2;
     */
    description: string;
    /**
     * Required. Room group that should contain the new channel.
     *
     * @generated from field: string group_id = 3;
     */
    groupId: string;
    /**
     * Whether the new channel should grant effective membership to eligible
     * server members.
     *
     * @generated from field: bool universal = 4;
     */
    universal: boolean;
    constructor(data?: PartialMessage<CreateRoomRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.CreateRoomRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): CreateRoomRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): CreateRoomRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): CreateRoomRequest;
    static equals(a: CreateRoomRequest | PlainMessage<CreateRoomRequest> | undefined, b: CreateRoomRequest | PlainMessage<CreateRoomRequest> | undefined): boolean;
}
/**
 * Result of creating a room.
 *
 * @generated from message chatto.api.v1.CreateRoomResponse
 */
export declare class CreateRoomResponse extends Message<CreateRoomResponse> {
    /**
     * Created room.
     *
     * @generated from field: chatto.api.v1.Room room = 1;
     */
    room?: Room;
    constructor(data?: PartialMessage<CreateRoomResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.CreateRoomResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): CreateRoomResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): CreateRoomResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): CreateRoomResponse;
    static equals(a: CreateRoomResponse | PlainMessage<CreateRoomResponse> | undefined, b: CreateRoomResponse | PlainMessage<CreateRoomResponse> | undefined): boolean;
}
/**
 * Request to update a room's editable metadata.
 *
 * @generated from message chatto.api.v1.UpdateRoomRequest
 */
export declare class UpdateRoomRequest extends Message<UpdateRoomRequest> {
    /**
     * Required. Room to update.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * New NFC-normalized room name, when changing it. Names accept Unicode
     * letters, decimal digits, hyphens, and underscores.
     *
     * @generated from field: optional string name = 2;
     */
    name?: string;
    /**
     * New room description, when changing it. Empty clears the description.
     *
     * @generated from field: optional string description = 3;
     */
    description?: string;
    /**
     * New universal membership state, when changing it. Direct-message rooms
     * cannot be universal.
     *
     * @generated from field: optional bool universal = 4;
     */
    universal?: boolean;
    constructor(data?: PartialMessage<UpdateRoomRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UpdateRoomRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UpdateRoomRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UpdateRoomRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UpdateRoomRequest;
    static equals(a: UpdateRoomRequest | PlainMessage<UpdateRoomRequest> | undefined, b: UpdateRoomRequest | PlainMessage<UpdateRoomRequest> | undefined): boolean;
}
/**
 * Result of updating a room.
 *
 * @generated from message chatto.api.v1.UpdateRoomResponse
 */
export declare class UpdateRoomResponse extends Message<UpdateRoomResponse> {
    /**
     * Updated room.
     *
     * @generated from field: chatto.api.v1.Room room = 1;
     */
    room?: Room;
    constructor(data?: PartialMessage<UpdateRoomResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UpdateRoomResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UpdateRoomResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UpdateRoomResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UpdateRoomResponse;
    static equals(a: UpdateRoomResponse | PlainMessage<UpdateRoomResponse> | undefined, b: UpdateRoomResponse | PlainMessage<UpdateRoomResponse> | undefined): boolean;
}
/**
 * Request to archive a room.
 *
 * @generated from message chatto.api.v1.ArchiveRoomRequest
 */
export declare class ArchiveRoomRequest extends Message<ArchiveRoomRequest> {
    /**
     * Required. Room to archive.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    constructor(data?: PartialMessage<ArchiveRoomRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ArchiveRoomRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ArchiveRoomRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ArchiveRoomRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ArchiveRoomRequest;
    static equals(a: ArchiveRoomRequest | PlainMessage<ArchiveRoomRequest> | undefined, b: ArchiveRoomRequest | PlainMessage<ArchiveRoomRequest> | undefined): boolean;
}
/**
 * Result of archiving a room.
 *
 * @generated from message chatto.api.v1.ArchiveRoomResponse
 */
export declare class ArchiveRoomResponse extends Message<ArchiveRoomResponse> {
    /**
     * Archived room.
     *
     * @generated from field: chatto.api.v1.Room room = 1;
     */
    room?: Room;
    constructor(data?: PartialMessage<ArchiveRoomResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ArchiveRoomResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ArchiveRoomResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ArchiveRoomResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ArchiveRoomResponse;
    static equals(a: ArchiveRoomResponse | PlainMessage<ArchiveRoomResponse> | undefined, b: ArchiveRoomResponse | PlainMessage<ArchiveRoomResponse> | undefined): boolean;
}
/**
 * Request to unarchive a room.
 *
 * @generated from message chatto.api.v1.UnarchiveRoomRequest
 */
export declare class UnarchiveRoomRequest extends Message<UnarchiveRoomRequest> {
    /**
     * Required. Room to unarchive.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    constructor(data?: PartialMessage<UnarchiveRoomRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UnarchiveRoomRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UnarchiveRoomRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UnarchiveRoomRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UnarchiveRoomRequest;
    static equals(a: UnarchiveRoomRequest | PlainMessage<UnarchiveRoomRequest> | undefined, b: UnarchiveRoomRequest | PlainMessage<UnarchiveRoomRequest> | undefined): boolean;
}
/**
 * Result of unarchiving a room.
 *
 * @generated from message chatto.api.v1.UnarchiveRoomResponse
 */
export declare class UnarchiveRoomResponse extends Message<UnarchiveRoomResponse> {
    /**
     * Unarchived room.
     *
     * @generated from field: chatto.api.v1.Room room = 1;
     */
    room?: Room;
    constructor(data?: PartialMessage<UnarchiveRoomResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UnarchiveRoomResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UnarchiveRoomResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UnarchiveRoomResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UnarchiveRoomResponse;
    static equals(a: UnarchiveRoomResponse | PlainMessage<UnarchiveRoomResponse> | undefined, b: UnarchiveRoomResponse | PlainMessage<UnarchiveRoomResponse> | undefined): boolean;
}
/**
 * Request to join a room as the current user.
 *
 * @generated from message chatto.api.v1.JoinRoomRequest
 */
export declare class JoinRoomRequest extends Message<JoinRoomRequest> {
    /**
     * Required. Room to join.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    constructor(data?: PartialMessage<JoinRoomRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.JoinRoomRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): JoinRoomRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): JoinRoomRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): JoinRoomRequest;
    static equals(a: JoinRoomRequest | PlainMessage<JoinRoomRequest> | undefined, b: JoinRoomRequest | PlainMessage<JoinRoomRequest> | undefined): boolean;
}
/**
 * Result of joining a room.
 *
 * @generated from message chatto.api.v1.JoinRoomResponse
 */
export declare class JoinRoomResponse extends Message<JoinRoomResponse> {
    /**
     * Joined room.
     *
     * @generated from field: chatto.api.v1.Room room = 1;
     */
    room?: Room;
    constructor(data?: PartialMessage<JoinRoomResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.JoinRoomResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): JoinRoomResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): JoinRoomResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): JoinRoomResponse;
    static equals(a: JoinRoomResponse | PlainMessage<JoinRoomResponse> | undefined, b: JoinRoomResponse | PlainMessage<JoinRoomResponse> | undefined): boolean;
}
/**
 * Request to join all joinable rooms in one room group.
 *
 * @generated from message chatto.api.v1.JoinRoomGroupRequest
 */
export declare class JoinRoomGroupRequest extends Message<JoinRoomGroupRequest> {
    /**
     * Required. Room group whose rooms should be joined.
     *
     * @generated from field: string group_id = 1;
     */
    groupId: string;
    constructor(data?: PartialMessage<JoinRoomGroupRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.JoinRoomGroupRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): JoinRoomGroupRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): JoinRoomGroupRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): JoinRoomGroupRequest;
    static equals(a: JoinRoomGroupRequest | PlainMessage<JoinRoomGroupRequest> | undefined, b: JoinRoomGroupRequest | PlainMessage<JoinRoomGroupRequest> | undefined): boolean;
}
/**
 * Result of joining all joinable rooms in one room group.
 *
 * @generated from message chatto.api.v1.JoinRoomGroupResponse
 */
export declare class JoinRoomGroupResponse extends Message<JoinRoomGroupResponse> {
    /**
     * Room IDs that transitioned from not joined to joined.
     *
     * @generated from field: repeated string joined_room_ids = 1;
     */
    joinedRoomIds: string[];
    constructor(data?: PartialMessage<JoinRoomGroupResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.JoinRoomGroupResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): JoinRoomGroupResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): JoinRoomGroupResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): JoinRoomGroupResponse;
    static equals(a: JoinRoomGroupResponse | PlainMessage<JoinRoomGroupResponse> | undefined, b: JoinRoomGroupResponse | PlainMessage<JoinRoomGroupResponse> | undefined): boolean;
}
/**
 * Request to start or fetch a direct-message room.
 *
 * @generated from message chatto.api.v1.StartDMRequest
 */
export declare class StartDMRequest extends Message<StartDMRequest> {
    /**
     * Other participants to include in the direct-message room. The current user
     * is always included by the server. An empty list creates or fetches the
     * caller's self-DM.
     *
     * @generated from field: repeated string participant_ids = 1;
     */
    participantIds: string[];
    constructor(data?: PartialMessage<StartDMRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.StartDMRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): StartDMRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): StartDMRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): StartDMRequest;
    static equals(a: StartDMRequest | PlainMessage<StartDMRequest> | undefined, b: StartDMRequest | PlainMessage<StartDMRequest> | undefined): boolean;
}
/**
 * Result of starting or fetching a direct-message room.
 *
 * @generated from message chatto.api.v1.StartDMResponse
 */
export declare class StartDMResponse extends Message<StartDMResponse> {
    /**
     * Direct-message room for the participant set.
     *
     * @generated from field: chatto.api.v1.Room room = 1;
     */
    room?: Room;
    constructor(data?: PartialMessage<StartDMResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.StartDMResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): StartDMResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): StartDMResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): StartDMResponse;
    static equals(a: StartDMResponse | PlainMessage<StartDMResponse> | undefined, b: StartDMResponse | PlainMessage<StartDMResponse> | undefined): boolean;
}
/**
 * Request to leave a room as the current user.
 *
 * @generated from message chatto.api.v1.LeaveRoomRequest
 */
export declare class LeaveRoomRequest extends Message<LeaveRoomRequest> {
    /**
     * Required. Room to leave.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    constructor(data?: PartialMessage<LeaveRoomRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.LeaveRoomRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): LeaveRoomRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): LeaveRoomRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): LeaveRoomRequest;
    static equals(a: LeaveRoomRequest | PlainMessage<LeaveRoomRequest> | undefined, b: LeaveRoomRequest | PlainMessage<LeaveRoomRequest> | undefined): boolean;
}
/**
 * Result of leaving a room.
 *
 * @generated from message chatto.api.v1.LeaveRoomResponse
 */
export declare class LeaveRoomResponse extends Message<LeaveRoomResponse> {
    /**
     * True when the current user is no longer an explicit member after the call.
     *
     * @generated from field: bool left = 1;
     */
    left: boolean;
    constructor(data?: PartialMessage<LeaveRoomResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.LeaveRoomResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): LeaveRoomResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): LeaveRoomResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): LeaveRoomResponse;
    static equals(a: LeaveRoomResponse | PlainMessage<LeaveRoomResponse> | undefined, b: LeaveRoomResponse | PlainMessage<LeaveRoomResponse> | undefined): boolean;
}
/**
 * Request to add a user to a channel room.
 *
 * @generated from message chatto.api.v1.AddMemberRequest
 */
export declare class AddMemberRequest extends Message<AddMemberRequest> {
    /**
     * Required. Channel room to add the user to.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Required. User to add as an explicit room member.
     *
     * @generated from field: string user_id = 2;
     */
    userId: string;
    constructor(data?: PartialMessage<AddMemberRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.AddMemberRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): AddMemberRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): AddMemberRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): AddMemberRequest;
    static equals(a: AddMemberRequest | PlainMessage<AddMemberRequest> | undefined, b: AddMemberRequest | PlainMessage<AddMemberRequest> | undefined): boolean;
}
/**
 * Result of adding a user to a room.
 *
 * @generated from message chatto.api.v1.AddMemberResponse
 */
export declare class AddMemberResponse extends Message<AddMemberResponse> {
    /**
     * Added room member.
     *
     * @generated from field: chatto.api.v1.DirectoryMember member = 1;
     */
    member?: DirectoryMember;
    constructor(data?: PartialMessage<AddMemberResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.AddMemberResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): AddMemberResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): AddMemberResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): AddMemberResponse;
    static equals(a: AddMemberResponse | PlainMessage<AddMemberResponse> | undefined, b: AddMemberResponse | PlainMessage<AddMemberResponse> | undefined): boolean;
}
/**
 * Request to remove a user from a channel room.
 *
 * @generated from message chatto.api.v1.RemoveMemberRequest
 */
export declare class RemoveMemberRequest extends Message<RemoveMemberRequest> {
    /**
     * Required. Channel room to remove the user from.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Required. User to remove from the room's explicit members.
     *
     * @generated from field: string user_id = 2;
     */
    userId: string;
    constructor(data?: PartialMessage<RemoveMemberRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RemoveMemberRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RemoveMemberRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RemoveMemberRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RemoveMemberRequest;
    static equals(a: RemoveMemberRequest | PlainMessage<RemoveMemberRequest> | undefined, b: RemoveMemberRequest | PlainMessage<RemoveMemberRequest> | undefined): boolean;
}
/**
 * Result of removing a user from a room.
 *
 * @generated from message chatto.api.v1.RemoveMemberResponse
 */
export declare class RemoveMemberResponse extends Message<RemoveMemberResponse> {
    /**
     * True when an explicit room membership was removed by this call.
     *
     * @generated from field: bool removed = 1;
     */
    removed: boolean;
    constructor(data?: PartialMessage<RemoveMemberResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RemoveMemberResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RemoveMemberResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RemoveMemberResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RemoveMemberResponse;
    static equals(a: RemoveMemberResponse | PlainMessage<RemoveMemberResponse> | undefined, b: RemoveMemberResponse | PlainMessage<RemoveMemberResponse> | undefined): boolean;
}
/**
 * Request to ban a member from a channel room.
 *
 * @generated from message chatto.api.v1.BanMemberRequest
 */
export declare class BanMemberRequest extends Message<BanMemberRequest> {
    /**
     * Required. Channel room to ban the user from.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Required. User to ban from the room.
     *
     * @generated from field: string user_id = 2;
     */
    userId: string;
    /**
     * Required moderator-entered reason stored for audit.
     *
     * @generated from field: string reason = 3;
     */
    reason: string;
    /**
     * Optional future time when the ban expires.
     *
     * @generated from field: google.protobuf.Timestamp expires_at = 4;
     */
    expiresAt?: Timestamp;
    constructor(data?: PartialMessage<BanMemberRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.BanMemberRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): BanMemberRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): BanMemberRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): BanMemberRequest;
    static equals(a: BanMemberRequest | PlainMessage<BanMemberRequest> | undefined, b: BanMemberRequest | PlainMessage<BanMemberRequest> | undefined): boolean;
}
/**
 * Result of banning a room member.
 *
 * @generated from message chatto.api.v1.BanMemberResponse
 */
export declare class BanMemberResponse extends Message<BanMemberResponse> {
    /**
     * True when the ban operation completed.
     *
     * @generated from field: bool banned = 1;
     */
    banned: boolean;
    constructor(data?: PartialMessage<BanMemberResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.BanMemberResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): BanMemberResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): BanMemberResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): BanMemberResponse;
    static equals(a: BanMemberResponse | PlainMessage<BanMemberResponse> | undefined, b: BanMemberResponse | PlainMessage<BanMemberResponse> | undefined): boolean;
}
/**
 * Request to remove a channel room ban.
 *
 * @generated from message chatto.api.v1.UnbanMemberRequest
 */
export declare class UnbanMemberRequest extends Message<UnbanMemberRequest> {
    /**
     * Required. Channel room to unban the user from.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Required. User to unban.
     *
     * @generated from field: string user_id = 2;
     */
    userId: string;
    /**
     * Required moderator-entered reason stored for audit.
     *
     * @generated from field: string reason = 3;
     */
    reason: string;
    constructor(data?: PartialMessage<UnbanMemberRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UnbanMemberRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UnbanMemberRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UnbanMemberRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UnbanMemberRequest;
    static equals(a: UnbanMemberRequest | PlainMessage<UnbanMemberRequest> | undefined, b: UnbanMemberRequest | PlainMessage<UnbanMemberRequest> | undefined): boolean;
}
/**
 * Result of removing a room ban.
 *
 * @generated from message chatto.api.v1.UnbanMemberResponse
 */
export declare class UnbanMemberResponse extends Message<UnbanMemberResponse> {
    /**
     * True when the unban operation completed.
     *
     * @generated from field: bool unbanned = 1;
     */
    unbanned: boolean;
    constructor(data?: PartialMessage<UnbanMemberResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UnbanMemberResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UnbanMemberResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UnbanMemberResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UnbanMemberResponse;
    static equals(a: UnbanMemberResponse | PlainMessage<UnbanMemberResponse> | undefined, b: UnbanMemberResponse | PlainMessage<UnbanMemberResponse> | undefined): boolean;
}
/**
 * Active channel room ban with optional hydrated room and user references.
 *
 * @generated from message chatto.api.v1.RoomBan
 */
export declare class RoomBan extends Message<RoomBan> {
    /**
     * Stable ban event ID.
     *
     * @generated from field: string id = 1;
     */
    id: string;
    /**
     * Channel room ID.
     *
     * @generated from field: string room_id = 2;
     */
    roomId: string;
    /**
     * Channel room metadata, when the referenced room still exists.
     *
     * @generated from field: chatto.api.v1.Room room = 3;
     */
    room?: Room;
    /**
     * Banned user ID.
     *
     * @generated from field: string user_id = 4;
     */
    userId: string;
    /**
     * Banned user profile, when the referenced user still exists.
     *
     * @generated from field: chatto.api.v1.DirectoryMember user = 5;
     */
    user?: DirectoryMember;
    /**
     * Moderator user ID that created the ban.
     *
     * @generated from field: string moderator_id = 6;
     */
    moderatorId: string;
    /**
     * Moderator profile, when the referenced user still exists.
     *
     * @generated from field: chatto.api.v1.DirectoryMember moderator = 7;
     */
    moderator?: DirectoryMember;
    /**
     * Moderator-entered ban reason.
     *
     * @generated from field: string reason = 8;
     */
    reason: string;
    /**
     * Time the ban was created.
     *
     * @generated from field: google.protobuf.Timestamp created_at = 9;
     */
    createdAt?: Timestamp;
    /**
     * Optional future time when the ban expires.
     *
     * @generated from field: google.protobuf.Timestamp expires_at = 10;
     */
    expiresAt?: Timestamp;
    constructor(data?: PartialMessage<RoomBan>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RoomBan";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RoomBan;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RoomBan;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RoomBan;
    static equals(a: RoomBan | PlainMessage<RoomBan> | undefined, b: RoomBan | PlainMessage<RoomBan> | undefined): boolean;
}
/**
 * Request to list active room bans.
 *
 * @generated from message chatto.api.v1.ListBansRequest
 */
export declare class ListBansRequest extends Message<ListBansRequest> {
    /**
     * Optional channel room filter. Empty lists active bans across all rooms.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Page request. Defaults are applied when absent or limit is zero.
     *
     * @generated from field: chatto.api.v1.PageRequest page = 2;
     */
    page?: PageRequest;
    constructor(data?: PartialMessage<ListBansRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListBansRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListBansRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListBansRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListBansRequest;
    static equals(a: ListBansRequest | PlainMessage<ListBansRequest> | undefined, b: ListBansRequest | PlainMessage<ListBansRequest> | undefined): boolean;
}
/**
 * Active room bans visible to the current moderator.
 *
 * @generated from message chatto.api.v1.ListBansResponse
 */
export declare class ListBansResponse extends Message<ListBansResponse> {
    /**
     * Active bans, newest first.
     *
     * @generated from field: repeated chatto.api.v1.RoomBan bans = 1;
     */
    bans: RoomBan[];
    /**
     * Page metadata.
     *
     * @generated from field: chatto.api.v1.PageInfo page = 2;
     */
    page?: PageInfo;
    constructor(data?: PartialMessage<ListBansResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListBansResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListBansResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListBansResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListBansResponse;
    static equals(a: ListBansResponse | PlainMessage<ListBansResponse> | undefined, b: ListBansResponse | PlainMessage<ListBansResponse> | undefined): boolean;
}
/**
 * Request for room-scoped attachment list pages.
 *
 * @generated from message chatto.api.v1.ListRoomAttachmentsRequest
 */
export declare class ListRoomAttachmentsRequest extends Message<ListRoomAttachmentsRequest> {
    /**
     * Required room ID.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Thumbnail URL options. Defaults are applied when absent.
     *
     * @generated from field: chatto.api.v1.ImageTransformOptions thumbnail = 4;
     */
    thumbnail?: ImageTransformOptions;
    /**
     * Page request. Defaults are applied when absent or limit is zero.
     *
     * @generated from field: chatto.api.v1.PageRequest page = 5;
     */
    page?: PageRequest;
    constructor(data?: PartialMessage<ListRoomAttachmentsRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListRoomAttachmentsRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListRoomAttachmentsRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListRoomAttachmentsRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListRoomAttachmentsRequest;
    static equals(a: ListRoomAttachmentsRequest | PlainMessage<ListRoomAttachmentsRequest> | undefined, b: ListRoomAttachmentsRequest | PlainMessage<ListRoomAttachmentsRequest> | undefined): boolean;
}
/**
 * Room-scoped attachment list response.
 *
 * @generated from message chatto.api.v1.ListRoomAttachmentsResponse
 */
export declare class ListRoomAttachmentsResponse extends Message<ListRoomAttachmentsResponse> {
    /**
     * Current attachments in newest message order.
     *
     * @generated from field: repeated chatto.api.v1.RoomAttachmentListItem attachments = 1;
     */
    attachments: RoomAttachmentListItem[];
    /**
     * Page metadata.
     *
     * @generated from field: chatto.api.v1.PageInfo page = 4;
     */
    page?: PageInfo;
    constructor(data?: PartialMessage<ListRoomAttachmentsResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListRoomAttachmentsResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListRoomAttachmentsResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListRoomAttachmentsResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListRoomAttachmentsResponse;
    static equals(a: ListRoomAttachmentsResponse | PlainMessage<ListRoomAttachmentsResponse> | undefined, b: ListRoomAttachmentsResponse | PlainMessage<ListRoomAttachmentsResponse> | undefined): boolean;
}
/**
 * Request to refresh the current user's live-only typing indicator.
 *
 * @generated from message chatto.api.v1.UpdateTypingIndicatorRequest
 */
export declare class UpdateTypingIndicatorRequest extends Message<UpdateTypingIndicatorRequest> {
    /**
     * Required. Room where the current user is typing.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    /**
     * Event ID of the thread root when typing inside a thread.
     *
     * @generated from field: string thread_root_event_id = 2;
     */
    threadRootEventId: string;
    constructor(data?: PartialMessage<UpdateTypingIndicatorRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UpdateTypingIndicatorRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UpdateTypingIndicatorRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UpdateTypingIndicatorRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UpdateTypingIndicatorRequest;
    static equals(a: UpdateTypingIndicatorRequest | PlainMessage<UpdateTypingIndicatorRequest> | undefined, b: UpdateTypingIndicatorRequest | PlainMessage<UpdateTypingIndicatorRequest> | undefined): boolean;
}
/**
 * Result of refreshing a typing indicator.
 *
 * @generated from message chatto.api.v1.UpdateTypingIndicatorResponse
 */
export declare class UpdateTypingIndicatorResponse extends Message<UpdateTypingIndicatorResponse> {
    /**
     * True when the typing indicator was accepted for publish.
     *
     * @generated from field: bool updated = 1;
     */
    updated: boolean;
    constructor(data?: PartialMessage<UpdateTypingIndicatorResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UpdateTypingIndicatorResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UpdateTypingIndicatorResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UpdateTypingIndicatorResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UpdateTypingIndicatorResponse;
    static equals(a: UpdateTypingIndicatorResponse | PlainMessage<UpdateTypingIndicatorResponse> | undefined, b: UpdateTypingIndicatorResponse | PlainMessage<UpdateTypingIndicatorResponse> | undefined): boolean;
}
