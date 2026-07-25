import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3 } from "@bufbuild/protobuf";
import { PermissionGrant } from "./permissions_pb.js";
import { Room } from "./rooms_pb.js";
/**
 * Room kinds to include in directory responses.
 *
 * @generated from enum chatto.api.v1.RoomDirectoryScope
 */
export declare enum RoomDirectoryScope {
    /**
     * Include both visible channel rooms and the caller's active DM rooms.
     *
     * @generated from enum value: ROOM_DIRECTORY_SCOPE_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * Include both visible channel rooms and the caller's active DM rooms.
     *
     * @generated from enum value: ROOM_DIRECTORY_SCOPE_ALL = 1;
     */
    ALL = 1,
    /**
     * Include visible channel rooms only.
     *
     * @generated from enum value: ROOM_DIRECTORY_SCOPE_CHANNELS = 2;
     */
    CHANNELS = 2,
    /**
     * Include the caller's active DM rooms only.
     *
     * @generated from enum value: ROOM_DIRECTORY_SCOPE_DMS = 3;
     */
    DMS = 3
}
/**
 * Viewer-specific state and permission decisions for one room.
 *
 * @generated from message chatto.api.v1.RoomViewerState
 */
export declare class RoomViewerState extends Message<RoomViewerState> {
    /**
     * True when the current user is an effective room member.
     *
     * @generated from field: bool is_member = 1;
     */
    isMember: boolean;
    /**
     * True when the room has unread root messages for the current user.
     *
     * @generated from field: bool has_unread = 2;
     */
    hasUnread: boolean;
    /**
     * Effective room-scoped permission decisions after room state constraints.
     *
     * @generated from field: repeated chatto.api.v1.PermissionGrant permissions = 3;
     */
    permissions: PermissionGrant[];
    constructor(data?: PartialMessage<RoomViewerState>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RoomViewerState";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RoomViewerState;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RoomViewerState;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RoomViewerState;
    static equals(a: RoomViewerState | PlainMessage<RoomViewerState> | undefined, b: RoomViewerState | PlainMessage<RoomViewerState> | undefined): boolean;
}
/**
 * Room metadata plus state and capabilities resolved for the authenticated
 * viewer.
 *
 * @generated from message chatto.api.v1.RoomWithViewerState
 */
export declare class RoomWithViewerState extends Message<RoomWithViewerState> {
    /**
     * Public room metadata.
     *
     * @generated from field: chatto.api.v1.Room room = 1;
     */
    room?: Room;
    /**
     * State and permission decisions resolved for the current user.
     *
     * @generated from field: chatto.api.v1.RoomViewerState viewer_state = 14;
     */
    viewerState?: RoomViewerState;
    constructor(data?: PartialMessage<RoomWithViewerState>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RoomWithViewerState";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RoomWithViewerState;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RoomWithViewerState;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RoomWithViewerState;
    static equals(a: RoomWithViewerState | PlainMessage<RoomWithViewerState> | undefined, b: RoomWithViewerState | PlainMessage<RoomWithViewerState> | undefined): boolean;
}
/**
 * Sidebar link metadata for room group navigation.
 *
 * @generated from message chatto.api.v1.SidebarLink
 */
export declare class SidebarLink extends Message<SidebarLink> {
    /**
     * Stable sidebar link ID.
     *
     * @generated from field: string id = 1;
     */
    id: string;
    /**
     * Display label.
     *
     * @generated from field: string label = 2;
     */
    label: string;
    /**
     * Absolute http(s) URL or server-local path.
     *
     * @generated from field: string url = 3;
     */
    url: string;
    constructor(data?: PartialMessage<SidebarLink>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.SidebarLink";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): SidebarLink;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): SidebarLink;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): SidebarLink;
    static equals(a: SidebarLink | PlainMessage<SidebarLink> | undefined, b: SidebarLink | PlainMessage<SidebarLink> | undefined): boolean;
}
/**
 * One ordered item in a room group.
 *
 * @generated from message chatto.api.v1.RoomGroupItem
 */
export declare class RoomGroupItem extends Message<RoomGroupItem> {
    /**
     * @generated from oneof chatto.api.v1.RoomGroupItem.item
     */
    item: {
        /**
         * Visible room entry.
         *
         * @generated from field: chatto.api.v1.RoomWithViewerState room = 1;
         */
        value: RoomWithViewerState;
        case: "room";
    } | {
        /**
         * Sidebar link entry.
         *
         * @generated from field: chatto.api.v1.SidebarLink sidebar_link = 2;
         */
        value: SidebarLink;
        case: "sidebarLink";
    } | {
        case: undefined;
        value?: undefined;
    };
    constructor(data?: PartialMessage<RoomGroupItem>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RoomGroupItem";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RoomGroupItem;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RoomGroupItem;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RoomGroupItem;
    static equals(a: RoomGroupItem | PlainMessage<RoomGroupItem> | undefined, b: RoomGroupItem | PlainMessage<RoomGroupItem> | undefined): boolean;
}
/**
 * Viewer-specific state for one room group.
 *
 * @generated from message chatto.api.v1.RoomGroupViewerState
 */
export declare class RoomGroupViewerState extends Message<RoomGroupViewerState> {
    /**
     * Effective group-scoped permission decisions after group state constraints.
     *
     * @generated from field: repeated chatto.api.v1.PermissionGrant permissions = 2;
     */
    permissions: PermissionGrant[];
    constructor(data?: PartialMessage<RoomGroupViewerState>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RoomGroupViewerState";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RoomGroupViewerState;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RoomGroupViewerState;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RoomGroupViewerState;
    static equals(a: RoomGroupViewerState | PlainMessage<RoomGroupViewerState> | undefined, b: RoomGroupViewerState | PlainMessage<RoomGroupViewerState> | undefined): boolean;
}
/**
 * Ordered group of channel rooms and sidebar links.
 *
 * @generated from message chatto.api.v1.RoomGroup
 */
export declare class RoomGroup extends Message<RoomGroup> {
    /**
     * Stable room group ID.
     *
     * @generated from field: string id = 1;
     */
    id: string;
    /**
     * Display name.
     *
     * @generated from field: string name = 2;
     */
    name: string;
    /**
     * Public group description, when set.
     *
     * @generated from field: string description = 3;
     */
    description: string;
    /**
     * Mixed room/sidebar-link entries in sidebar order.
     *
     * @generated from field: repeated chatto.api.v1.RoomGroupItem items = 5;
     */
    items: RoomGroupItem[];
    /**
     * State and permissions resolved for the current user.
     *
     * @generated from field: chatto.api.v1.RoomGroupViewerState viewer_state = 6;
     */
    viewerState?: RoomGroupViewerState;
    constructor(data?: PartialMessage<RoomGroup>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.RoomGroup";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): RoomGroup;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RoomGroup;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): RoomGroup;
    static equals(a: RoomGroup | PlainMessage<RoomGroup> | undefined, b: RoomGroup | PlainMessage<RoomGroup> | undefined): boolean;
}
/**
 * Request for rooms visible to the current user.
 *
 * @generated from message chatto.api.v1.ListRoomsRequest
 */
export declare class ListRoomsRequest extends Message<ListRoomsRequest> {
    /**
     * Which room kinds to include. Defaults to all.
     *
     * @generated from field: chatto.api.v1.RoomDirectoryScope scope = 1;
     */
    scope: RoomDirectoryScope;
    constructor(data?: PartialMessage<ListRoomsRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListRoomsRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListRoomsRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListRoomsRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListRoomsRequest;
    static equals(a: ListRoomsRequest | PlainMessage<ListRoomsRequest> | undefined, b: ListRoomsRequest | PlainMessage<ListRoomsRequest> | undefined): boolean;
}
/**
 * Finite snapshot of rooms visible to the current user.
 *
 * @generated from message chatto.api.v1.ListRoomsResponse
 */
export declare class ListRoomsResponse extends Message<ListRoomsResponse> {
    /**
     * Rooms matching the requested scope.
     *
     * @generated from field: repeated chatto.api.v1.RoomWithViewerState rooms = 1;
     */
    rooms: RoomWithViewerState[];
    constructor(data?: PartialMessage<ListRoomsResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListRoomsResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListRoomsResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListRoomsResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListRoomsResponse;
    static equals(a: ListRoomsResponse | PlainMessage<ListRoomsResponse> | undefined, b: ListRoomsResponse | PlainMessage<ListRoomsResponse> | undefined): boolean;
}
/**
 * Request for ordered room groups visible to the current user.
 *
 * @generated from message chatto.api.v1.ListRoomGroupsRequest
 */
export declare class ListRoomGroupsRequest extends Message<ListRoomGroupsRequest> {
    constructor(data?: PartialMessage<ListRoomGroupsRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListRoomGroupsRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListRoomGroupsRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListRoomGroupsRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListRoomGroupsRequest;
    static equals(a: ListRoomGroupsRequest | PlainMessage<ListRoomGroupsRequest> | undefined, b: ListRoomGroupsRequest | PlainMessage<ListRoomGroupsRequest> | undefined): boolean;
}
/**
 * Finite snapshot of ordered room groups visible to the current user.
 *
 * @generated from message chatto.api.v1.ListRoomGroupsResponse
 */
export declare class ListRoomGroupsResponse extends Message<ListRoomGroupsResponse> {
    /**
     * Channel room groups in sidebar order.
     *
     * @generated from field: repeated chatto.api.v1.RoomGroup groups = 1;
     */
    groups: RoomGroup[];
    constructor(data?: PartialMessage<ListRoomGroupsResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.ListRoomGroupsResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): ListRoomGroupsResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): ListRoomGroupsResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): ListRoomGroupsResponse;
    static equals(a: ListRoomGroupsResponse | PlainMessage<ListRoomGroupsResponse> | undefined, b: ListRoomGroupsResponse | PlainMessage<ListRoomGroupsResponse> | undefined): boolean;
}
/**
 * Request for one ordered room group visible to the current user.
 *
 * @generated from message chatto.api.v1.GetRoomGroupRequest
 */
export declare class GetRoomGroupRequest extends Message<GetRoomGroupRequest> {
    /**
     * Required. Room group to resolve.
     *
     * @generated from field: string group_id = 1;
     */
    groupId: string;
    constructor(data?: PartialMessage<GetRoomGroupRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetRoomGroupRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetRoomGroupRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetRoomGroupRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetRoomGroupRequest;
    static equals(a: GetRoomGroupRequest | PlainMessage<GetRoomGroupRequest> | undefined, b: GetRoomGroupRequest | PlainMessage<GetRoomGroupRequest> | undefined): boolean;
}
/**
 * One ordered room group visible to the current user.
 *
 * @generated from message chatto.api.v1.GetRoomGroupResponse
 */
export declare class GetRoomGroupResponse extends Message<GetRoomGroupResponse> {
    /**
     * Resolved room group. Hidden and archived room entries are omitted.
     *
     * @generated from field: chatto.api.v1.RoomGroup group = 1;
     */
    group?: RoomGroup;
    constructor(data?: PartialMessage<GetRoomGroupResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetRoomGroupResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetRoomGroupResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetRoomGroupResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetRoomGroupResponse;
    static equals(a: GetRoomGroupResponse | PlainMessage<GetRoomGroupResponse> | undefined, b: GetRoomGroupResponse | PlainMessage<GetRoomGroupResponse> | undefined): boolean;
}
/**
 * Request visible room groups by stable group ID.
 *
 * @generated from message chatto.api.v1.BatchGetRoomGroupsRequest
 */
export declare class BatchGetRoomGroupsRequest extends Message<BatchGetRoomGroupsRequest> {
    /**
     * Required room group IDs. Unknown groups are omitted from the response.
     *
     * @generated from field: repeated string group_ids = 1;
     */
    groupIds: string[];
    constructor(data?: PartialMessage<BatchGetRoomGroupsRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.BatchGetRoomGroupsRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): BatchGetRoomGroupsRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): BatchGetRoomGroupsRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): BatchGetRoomGroupsRequest;
    static equals(a: BatchGetRoomGroupsRequest | PlainMessage<BatchGetRoomGroupsRequest> | undefined, b: BatchGetRoomGroupsRequest | PlainMessage<BatchGetRoomGroupsRequest> | undefined): boolean;
}
/**
 * Visible room group batch response for direct group hydration.
 *
 * @generated from message chatto.api.v1.BatchGetRoomGroupsResponse
 */
export declare class BatchGetRoomGroupsResponse extends Message<BatchGetRoomGroupsResponse> {
    /**
     * Resolved room groups in first-seen request order.
     *
     * @generated from field: repeated chatto.api.v1.RoomGroup groups = 1;
     */
    groups: RoomGroup[];
    constructor(data?: PartialMessage<BatchGetRoomGroupsResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.BatchGetRoomGroupsResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): BatchGetRoomGroupsResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): BatchGetRoomGroupsResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): BatchGetRoomGroupsResponse;
    static equals(a: BatchGetRoomGroupsResponse | PlainMessage<BatchGetRoomGroupsResponse> | undefined, b: BatchGetRoomGroupsResponse | PlainMessage<BatchGetRoomGroupsResponse> | undefined): boolean;
}
/**
 * Request for one room visible to the current user.
 *
 * @generated from message chatto.api.v1.GetRoomRequest
 */
export declare class GetRoomRequest extends Message<GetRoomRequest> {
    /**
     * Required. Room to resolve.
     *
     * @generated from field: string room_id = 1;
     */
    roomId: string;
    constructor(data?: PartialMessage<GetRoomRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetRoomRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetRoomRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetRoomRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetRoomRequest;
    static equals(a: GetRoomRequest | PlainMessage<GetRoomRequest> | undefined, b: GetRoomRequest | PlainMessage<GetRoomRequest> | undefined): boolean;
}
/**
 * Room visible to the current user.
 *
 * @generated from message chatto.api.v1.GetRoomResponse
 */
export declare class GetRoomResponse extends Message<GetRoomResponse> {
    /**
     * Resolved room and viewer state.
     *
     * @generated from field: chatto.api.v1.RoomWithViewerState room = 1;
     */
    room?: RoomWithViewerState;
    constructor(data?: PartialMessage<GetRoomResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.GetRoomResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): GetRoomResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): GetRoomResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): GetRoomResponse;
    static equals(a: GetRoomResponse | PlainMessage<GetRoomResponse> | undefined, b: GetRoomResponse | PlainMessage<GetRoomResponse> | undefined): boolean;
}
/**
 * Request visible rooms by stable room ID.
 *
 * @generated from message chatto.api.v1.BatchGetRoomsRequest
 */
export declare class BatchGetRoomsRequest extends Message<BatchGetRoomsRequest> {
    /**
     * Required room IDs. Unknown rooms and rooms hidden from the caller are
     * omitted from the response. Archived rooms may be returned when the caller
     * can still refresh them directly.
     *
     * @generated from field: repeated string room_ids = 1;
     */
    roomIds: string[];
    constructor(data?: PartialMessage<BatchGetRoomsRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.BatchGetRoomsRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): BatchGetRoomsRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): BatchGetRoomsRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): BatchGetRoomsRequest;
    static equals(a: BatchGetRoomsRequest | PlainMessage<BatchGetRoomsRequest> | undefined, b: BatchGetRoomsRequest | PlainMessage<BatchGetRoomsRequest> | undefined): boolean;
}
/**
 * Visible room batch response for direct room hydration.
 *
 * @generated from message chatto.api.v1.BatchGetRoomsResponse
 */
export declare class BatchGetRoomsResponse extends Message<BatchGetRoomsResponse> {
    /**
     * Resolved rooms in first-seen request order.
     *
     * @generated from field: repeated chatto.api.v1.RoomWithViewerState rooms = 1;
     */
    rooms: RoomWithViewerState[];
    constructor(data?: PartialMessage<BatchGetRoomsResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.BatchGetRoomsResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): BatchGetRoomsResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): BatchGetRoomsResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): BatchGetRoomsResponse;
    static equals(a: BatchGetRoomsResponse | PlainMessage<BatchGetRoomsResponse> | undefined, b: BatchGetRoomsResponse | PlainMessage<BatchGetRoomsResponse> | undefined): boolean;
}
