import { AddMemberRequest, AddMemberResponse, ArchiveRoomRequest, ArchiveRoomResponse, BanMemberRequest, BanMemberResponse, CreateRoomRequest, CreateRoomResponse, JoinRoomGroupRequest, JoinRoomGroupResponse, JoinRoomRequest, JoinRoomResponse, LeaveRoomRequest, LeaveRoomResponse, ListBansRequest, ListBansResponse, ListRoomAttachmentsRequest, ListRoomAttachmentsResponse, RemoveMemberRequest, RemoveMemberResponse, StartDMRequest, StartDMResponse, UnarchiveRoomRequest, UnarchiveRoomResponse, UnbanMemberRequest, UnbanMemberResponse, UpdateRoomRequest, UpdateRoomResponse, UpdateTypingIndicatorRequest, UpdateTypingIndicatorResponse } from "./rooms_pb.js";
import { MethodKind } from "@bufbuild/protobuf";
import { BatchGetRoomMembersRequest, BatchGetRoomMembersResponse, GetRoomMemberRequest, GetRoomMemberResponse, ListRoomMembersRequest, ListRoomMembersResponse } from "./member_directory_pb.js";
import { GetRoomEventsAroundRequest, GetRoomEventsAroundResponse, GetRoomEventsRequest, GetRoomEventsResponse } from "./room_timeline_pb.js";
import { MarkRoomAsReadRequest, MarkRoomAsReadResponse } from "./read_state_pb.js";
/**
 * Manages room-scoped operations for the current user.
 *
 * RoomService owns operations whose authorization and state are primarily scoped
 * to one room, including lifecycle, membership, moderation, room timeline reads,
 * room read state, attachments, and live typing. Resource-specific services
 * should still be preferred when an operation is not naturally room-scoped or
 * when the resource needs an independent CRUD/batch surface.
 *
 * @generated from service chatto.api.v1.RoomService
 */
export declare const RoomService: {
    readonly typeName: "chatto.api.v1.RoomService";
    readonly methods: {
        /**
         * Creates a new channel room in a room group. The caller must be allowed to
         * create rooms in the target group.
         *
         * @generated from rpc chatto.api.v1.RoomService.CreateRoom
         */
        readonly createRoom: {
            readonly name: "CreateRoom";
            readonly I: typeof CreateRoomRequest;
            readonly O: typeof CreateRoomResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Updates a room's editable metadata. The caller must be allowed to manage
         * rooms. Direct-message rooms cannot be universal.
         *
         * @generated from rpc chatto.api.v1.RoomService.UpdateRoom
         */
        readonly updateRoom: {
            readonly name: "UpdateRoom";
            readonly I: typeof UpdateRoomRequest;
            readonly O: typeof UpdateRoomResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Archives a room so it is hidden from active room lists. The caller must be
         * allowed to manage rooms.
         *
         * @generated from rpc chatto.api.v1.RoomService.ArchiveRoom
         */
        readonly archiveRoom: {
            readonly name: "ArchiveRoom";
            readonly I: typeof ArchiveRoomRequest;
            readonly O: typeof ArchiveRoomResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Restores an archived room to active room lists. The caller must be allowed
         * to manage rooms.
         *
         * @generated from rpc chatto.api.v1.RoomService.UnarchiveRoom
         */
        readonly unarchiveRoom: {
            readonly name: "UnarchiveRoom";
            readonly I: typeof UnarchiveRoomRequest;
            readonly O: typeof UnarchiveRoomResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Joins the room as the current user when room permissions allow it.
         *
         * @generated from rpc chatto.api.v1.RoomService.JoinRoom
         */
        readonly joinRoom: {
            readonly name: "JoinRoom";
            readonly I: typeof JoinRoomRequest;
            readonly O: typeof JoinRoomResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Joins every unarchived room in a group that the current user can join.
         * Already-joined and non-joinable rooms are skipped.
         *
         * @generated from rpc chatto.api.v1.RoomService.JoinRoomGroup
         */
        readonly joinRoomGroup: {
            readonly name: "JoinRoomGroup";
            readonly I: typeof JoinRoomGroupRequest;
            readonly O: typeof JoinRoomGroupResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Starts or fetches a direct-message room for the current user and the
         * requested participant set. The caller must be allowed to start DMs.
         *
         * @generated from rpc chatto.api.v1.RoomService.StartDM
         */
        readonly startDM: {
            readonly name: "StartDM";
            readonly I: typeof StartDMRequest;
            readonly O: typeof StartDMResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Leaves the room as the current user. Direct-message and universal rooms
         * cannot be left.
         *
         * @generated from rpc chatto.api.v1.RoomService.LeaveRoom
         */
        readonly leaveRoom: {
            readonly name: "LeaveRoom";
            readonly I: typeof LeaveRoomRequest;
            readonly O: typeof LeaveRoomResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Lists effective room members. Existing members and room.manage holders may
         * list a channel room; other nonmembers need both room.list and room.join.
         *
         * @generated from rpc chatto.api.v1.RoomService.ListMembers
         */
        readonly listMembers: {
            readonly name: "ListMembers";
            readonly I: typeof ListRoomMembersRequest;
            readonly O: typeof ListRoomMembersResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Gets one explicit member of a room. Existing members and room.manage
         * holders may read channel-room members; DMs remain membership-only. Returns
         * NOT_FOUND when the target is unknown or not a room member.
         *
         * @generated from rpc chatto.api.v1.RoomService.GetMember
         */
        readonly getMember: {
            readonly name: "GetMember";
            readonly I: typeof GetRoomMemberRequest;
            readonly O: typeof GetRoomMemberResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Gets explicit room member rows for multiple users. Existing members and
         * room.manage holders may read channel-room members; DMs remain
         * membership-only.
         *
         * @generated from rpc chatto.api.v1.RoomService.BatchGetMembers
         */
        readonly batchGetMembers: {
            readonly name: "BatchGetMembers";
            readonly I: typeof BatchGetRoomMembersRequest;
            readonly O: typeof BatchGetRoomMembersResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Adds a user as an explicit member of a channel room. The caller must be
         * allowed to manage the room. Direct-message and universal rooms cannot be
         * managed this way.
         *
         * @generated from rpc chatto.api.v1.RoomService.AddMember
         */
        readonly addMember: {
            readonly name: "AddMember";
            readonly I: typeof AddMemberRequest;
            readonly O: typeof AddMemberResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Removes a user from a channel room's explicit members. The caller must be
         * allowed to manage the room. Direct-message and universal rooms cannot be
         * managed this way.
         *
         * @generated from rpc chatto.api.v1.RoomService.RemoveMember
         */
        readonly removeMember: {
            readonly name: "RemoveMember";
            readonly I: typeof RemoveMemberRequest;
            readonly O: typeof RemoveMemberResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Lists active channel room bans. The caller must be allowed to moderate room
         * membership bans.
         *
         * @generated from rpc chatto.api.v1.RoomService.ListBans
         */
        readonly listBans: {
            readonly name: "ListBans";
            readonly I: typeof ListBansRequest;
            readonly O: typeof ListBansResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Lists current message-owned room attachments. Authentication and room
         * membership are required. Returns PERMISSION_DENIED when the room is
         * inaccessible to the caller.
         *
         * @generated from rpc chatto.api.v1.RoomService.ListRoomAttachments
         */
        readonly listRoomAttachments: {
            readonly name: "ListRoomAttachments";
            readonly I: typeof ListRoomAttachmentsRequest;
            readonly O: typeof ListRoomAttachmentsResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Refreshes the current user's live-only typing indicator for a room or
         * thread. Room membership is required; message posting permission is not.
         *
         * @generated from rpc chatto.api.v1.RoomService.UpdateTypingIndicator
         */
        readonly updateTypingIndicator: {
            readonly name: "UpdateTypingIndicator";
            readonly I: typeof UpdateTypingIndicatorRequest;
            readonly O: typeof UpdateTypingIndicatorResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Returns one page of room timeline events, including related user data needed
         * to render the page.
         *
         * @generated from rpc chatto.api.v1.RoomService.GetRoomEvents
         */
        readonly getRoomEvents: {
            readonly name: "GetRoomEvents";
            readonly I: typeof GetRoomEventsRequest;
            readonly O: typeof GetRoomEventsResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Returns a room timeline window centered around a specific event. Use this to
         * open a permalink, search result, or notification target in context. Returns
         * NOT_FOUND when the anchor event is missing or not visible in the room
         * timeline and PERMISSION_DENIED when the room is inaccessible.
         *
         * @generated from rpc chatto.api.v1.RoomService.GetRoomEventsAround
         */
        readonly getRoomEventsAround: {
            readonly name: "GetRoomEventsAround";
            readonly I: typeof GetRoomEventsAroundRequest;
            readonly O: typeof GetRoomEventsAroundResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Marks a room timeline as read through the supplied event. If no event is
         * supplied, the server marks through the room's latest root event. Clients
         * usually call this after the user has viewed the latest visible event in the
         * room.
         *
         * @generated from rpc chatto.api.v1.RoomService.MarkRoomAsRead
         */
        readonly markRoomAsRead: {
            readonly name: "MarkRoomAsRead";
            readonly I: typeof MarkRoomAsReadRequest;
            readonly O: typeof MarkRoomAsReadResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Bans a member from a channel room. Direct-message rooms cannot be moderated
         * this way, and the target must currently be a room member.
         *
         * @generated from rpc chatto.api.v1.RoomService.BanMember
         */
        readonly banMember: {
            readonly name: "BanMember";
            readonly I: typeof BanMemberRequest;
            readonly O: typeof BanMemberResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Removes an active channel room ban. Calling this when no active ban exists
         * is allowed and still returns success.
         *
         * @generated from rpc chatto.api.v1.RoomService.UnbanMember
         */
        readonly unbanMember: {
            readonly name: "UnbanMember";
            readonly I: typeof UnbanMemberRequest;
            readonly O: typeof UnbanMemberResponse;
            readonly kind: MethodKind.Unary;
        };
    };
};
