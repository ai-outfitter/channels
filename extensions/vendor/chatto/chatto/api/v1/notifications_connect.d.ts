import { BatchGetNotificationsRequest, BatchGetNotificationsResponse, DismissAllNotificationsRequest, DismissAllNotificationsResponse, DismissNotificationRequest, DismissNotificationResponse, GetNotificationRequest, GetNotificationResponse, HasNotificationsRequest, HasNotificationsResponse, ListNotificationsRequest, ListNotificationsResponse, ListRoomNotificationCountsRequest, ListRoomNotificationCountsResponse, ListRoomNotificationsRequest, ListRoomNotificationsResponse } from "./notifications_pb.js";
import { MethodIdempotency, MethodKind } from "@bufbuild/protobuf";
/**
 * Reads and dismisses pending notifications for the authenticated viewer.
 *
 * @generated from service chatto.api.v1.NotificationService
 */
export declare const NotificationService: {
    readonly typeName: "chatto.api.v1.NotificationService";
    readonly methods: {
        /**
         * Lists the authenticated viewer's pending notifications.
         *
         * @generated from rpc chatto.api.v1.NotificationService.ListNotifications
         */
        readonly listNotifications: {
            readonly name: "ListNotifications";
            readonly I: typeof ListNotificationsRequest;
            readonly O: typeof ListNotificationsResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Gets one pending notification. Returns NOT_FOUND when the notification is
         * unknown or has been dismissed.
         *
         * @generated from rpc chatto.api.v1.NotificationService.GetNotification
         */
        readonly getNotification: {
            readonly name: "GetNotification";
            readonly I: typeof GetNotificationRequest;
            readonly O: typeof GetNotificationResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Gets pending notifications by ID.
         *
         * @generated from rpc chatto.api.v1.NotificationService.BatchGetNotifications
         */
        readonly batchGetNotifications: {
            readonly name: "BatchGetNotifications";
            readonly I: typeof BatchGetNotificationsRequest;
            readonly O: typeof BatchGetNotificationsResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Lists pending notifications for one room. Non-members receive an empty page.
         *
         * @generated from rpc chatto.api.v1.NotificationService.ListRoomNotifications
         */
        readonly listRoomNotifications: {
            readonly name: "ListRoomNotifications";
            readonly I: typeof ListRoomNotificationsRequest;
            readonly O: typeof ListRoomNotificationsResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Lists pending notification counts grouped by room as a finite snapshot.
         *
         * @generated from rpc chatto.api.v1.NotificationService.ListRoomNotificationCounts
         */
        readonly listRoomNotificationCounts: {
            readonly name: "ListRoomNotificationCounts";
            readonly I: typeof ListRoomNotificationCountsRequest;
            readonly O: typeof ListRoomNotificationCountsResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Checks whether the authenticated viewer has any pending notifications.
         *
         * @generated from rpc chatto.api.v1.NotificationService.HasNotifications
         */
        readonly hasNotifications: {
            readonly name: "HasNotifications";
            readonly I: typeof HasNotificationsRequest;
            readonly O: typeof HasNotificationsResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Dismisses one pending notification. Already-dismissed notifications are
         * treated as idempotent success.
         *
         * @generated from rpc chatto.api.v1.NotificationService.DismissNotification
         */
        readonly dismissNotification: {
            readonly name: "DismissNotification";
            readonly I: typeof DismissNotificationRequest;
            readonly O: typeof DismissNotificationResponse;
            readonly kind: MethodKind.Unary;
            readonly idempotency: MethodIdempotency.Idempotent;
        };
        /**
         * Dismisses all pending notifications.
         *
         * @generated from rpc chatto.api.v1.NotificationService.DismissAllNotifications
         */
        readonly dismissAllNotifications: {
            readonly name: "DismissAllNotifications";
            readonly I: typeof DismissAllNotificationsRequest;
            readonly O: typeof DismissAllNotificationsResponse;
            readonly kind: MethodKind.Unary;
        };
    };
};
