import { FollowThreadRequest, FollowThreadResponse, ListFollowedThreadsRequest, ListFollowedThreadsResponse, UnfollowThreadRequest, UnfollowThreadResponse } from "./threads_pb.js";
import { MethodKind } from "@bufbuild/protobuf";
import { GetThreadEventsAroundRequest, GetThreadEventsAroundResponse, GetThreadEventsRequest, GetThreadEventsResponse } from "./room_timeline_pb.js";
import { MarkThreadAsReadRequest, MarkThreadAsReadResponse } from "./read_state_pb.js";
/**
 * Manages thread follow state for the current user.
 *
 * @generated from service chatto.api.v1.ThreadService
 */
export declare const ThreadService: {
    readonly typeName: "chatto.api.v1.ThreadService";
    readonly methods: {
        /**
         * Returns followed threads for the current user, including enough root-message
         * data for clients to render the list without extra per-field fetches.
         *
         * @generated from rpc chatto.api.v1.ThreadService.ListFollowedThreads
         */
        readonly listFollowedThreads: {
            readonly name: "ListFollowedThreads";
            readonly I: typeof ListFollowedThreadsRequest;
            readonly O: typeof ListFollowedThreadsResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Follows a thread for the current user. Followed threads can be surfaced in
         * clients and can participate in thread notification behavior.
         *
         * @generated from rpc chatto.api.v1.ThreadService.FollowThread
         */
        readonly followThread: {
            readonly name: "FollowThread";
            readonly I: typeof FollowThreadRequest;
            readonly O: typeof FollowThreadResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Stops following a thread for the current user. The response reports the
         * resulting follow state so clients can update local UI immediately.
         *
         * @generated from rpc chatto.api.v1.ThreadService.UnfollowThread
         */
        readonly unfollowThread: {
            readonly name: "UnfollowThread";
            readonly I: typeof UnfollowThreadRequest;
            readonly O: typeof UnfollowThreadResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Returns one page of events in a message thread. Initial pages include the
         * thread root message; cursor pages return replies in the requested direction.
         *
         * @generated from rpc chatto.api.v1.ThreadService.GetThreadEvents
         */
        readonly getThreadEvents: {
            readonly name: "GetThreadEvents";
            readonly I: typeof GetThreadEventsRequest;
            readonly O: typeof GetThreadEventsResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Returns a thread timeline window centered around a specific event. Use this
         * to open a reply from a notification or search result in context. Returns
         * NOT_FOUND when the thread root or anchor event is missing or hidden and
         * PERMISSION_DENIED when the room is inaccessible.
         *
         * @generated from rpc chatto.api.v1.ThreadService.GetThreadEventsAround
         */
        readonly getThreadEventsAround: {
            readonly name: "GetThreadEventsAround";
            readonly I: typeof GetThreadEventsAroundRequest;
            readonly O: typeof GetThreadEventsAroundResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Marks a thread timeline as read through the supplied event without changing
         * the room-level read marker.
         *
         * @generated from rpc chatto.api.v1.ThreadService.MarkThreadAsRead
         */
        readonly markThreadAsRead: {
            readonly name: "MarkThreadAsRead";
            readonly I: typeof MarkThreadAsReadRequest;
            readonly O: typeof MarkThreadAsReadResponse;
            readonly kind: MethodKind.Unary;
        };
    };
};
