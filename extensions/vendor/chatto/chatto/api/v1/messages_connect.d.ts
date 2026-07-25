import { FetchLinkPreviewRequest, FetchLinkPreviewResponse } from "./link_previews_pb.js";
import { MethodKind } from "@bufbuild/protobuf";
import { BatchGetMessagesRequest, BatchGetMessagesResponse, CreateMessageRequest, CreateMessageResponse, DeleteAttachmentRequest, DeleteAttachmentResponse, DeleteLinkPreviewRequest, DeleteLinkPreviewResponse, DeleteMessageRequest, DeleteMessageResponse, GetMessageRequest, GetMessageResponse, UpdateMessageRequest, UpdateMessageResponse } from "./messages_pb.js";
import { AddReactionRequest, AddReactionResponse, RemoveReactionRequest, RemoveReactionResponse } from "./reactions_pb.js";
/**
 * Creates messages in room and thread timelines.
 *
 * @generated from service chatto.api.v1.MessageService
 */
export declare const MessageService: {
    readonly typeName: "chatto.api.v1.MessageService";
    readonly methods: {
        /**
         * Fetches and caches metadata for a composer URL. Authentication is required
         * to avoid exposing the preview fetcher as an unauthenticated network proxy.
         * Successful responses include a short-lived token accepted by CreateMessage.
         *
         * @generated from rpc chatto.api.v1.MessageService.FetchLinkPreview
         */
        readonly fetchLinkPreview: {
            readonly name: "FetchLinkPreview";
            readonly I: typeof FetchLinkPreviewRequest;
            readonly O: typeof FetchLinkPreviewResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Creates a message for the current user. The user must be a room member and
         * must have message.post for room messages or message.post-in-thread for
         * thread replies. Echoing a thread reply also requires message.echo and
         * message.post.
         *
         * @generated from rpc chatto.api.v1.MessageService.CreateMessage
         */
        readonly createMessage: {
            readonly name: "CreateMessage";
            readonly I: typeof CreateMessageRequest;
            readonly O: typeof CreateMessageResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Edits a message body. Authors can edit their own messages within the edit
         * window. Non-authors need message.manage and cannot change channel echo
         * state.
         *
         * @generated from rpc chatto.api.v1.MessageService.UpdateMessage
         */
        readonly updateMessage: {
            readonly name: "UpdateMessage";
            readonly I: typeof UpdateMessageRequest;
            readonly O: typeof UpdateMessageResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Retracts a message. Authors can delete their own messages. Non-authors need
         * message.manage.
         *
         * @generated from rpc chatto.api.v1.MessageService.DeleteMessage
         */
        readonly deleteMessage: {
            readonly name: "DeleteMessage";
            readonly I: typeof DeleteMessageRequest;
            readonly O: typeof DeleteMessageResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Removes one attachment from the author's own message.
         *
         * @generated from rpc chatto.api.v1.MessageService.DeleteAttachment
         */
        readonly deleteAttachment: {
            readonly name: "DeleteAttachment";
            readonly I: typeof DeleteAttachmentRequest;
            readonly O: typeof DeleteAttachmentResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Removes the accepted link preview from the author's own message.
         *
         * @generated from rpc chatto.api.v1.MessageService.DeleteLinkPreview
         */
        readonly deleteLinkPreview: {
            readonly name: "DeleteLinkPreview";
            readonly I: typeof DeleteLinkPreviewRequest;
            readonly O: typeof DeleteLinkPreviewResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Reads one renderable message, including current body, attachment metadata,
         * link preview, reactions, and thread metadata. Authentication and room
         * membership are required. Returns NOT_FOUND when the event does not exist,
         * is not a message, has been retracted, or belongs to a different room.
         *
         * @generated from rpc chatto.api.v1.MessageService.GetMessage
         */
        readonly getMessage: {
            readonly name: "GetMessage";
            readonly I: typeof GetMessageRequest;
            readonly O: typeof GetMessageResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Reads many renderable messages in one room. Authentication and room
         * membership are required. Missing, retracted, non-message, and wrong-room
         * event IDs are omitted. Results preserve first-seen request order and
         * repeated event IDs are de-duplicated.
         *
         * @generated from rpc chatto.api.v1.MessageService.BatchGetMessages
         */
        readonly batchGetMessages: {
            readonly name: "BatchGetMessages";
            readonly I: typeof BatchGetMessagesRequest;
            readonly O: typeof BatchGetMessagesResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Adds a reaction to a message. The user must be a room member and have
         * message.react in the target room.
         *
         * @generated from rpc chatto.api.v1.MessageService.AddReaction
         */
        readonly addReaction: {
            readonly name: "AddReaction";
            readonly I: typeof AddReactionRequest;
            readonly O: typeof AddReactionResponse;
            readonly kind: MethodKind.Unary;
        };
        /**
         * Removes a reaction from a message. The user must be a room member and have
         * message.react in the target room.
         *
         * @generated from rpc chatto.api.v1.MessageService.RemoveReaction
         */
        readonly removeReaction: {
            readonly name: "RemoveReaction";
            readonly I: typeof RemoveReactionRequest;
            readonly O: typeof RemoveReactionResponse;
            readonly kind: MethodKind.Unary;
        };
    };
};
