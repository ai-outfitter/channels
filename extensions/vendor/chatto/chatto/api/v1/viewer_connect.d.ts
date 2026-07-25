import { GetViewerRequest, GetViewerResponse } from "./viewer_pb.js";
import { MethodKind } from "@bufbuild/protobuf";
/**
 * Provides authenticated user profile, preferences, and capability state.
 *
 * @generated from service chatto.api.v1.ViewerService
 */
export declare const ViewerService: {
    readonly typeName: "chatto.api.v1.ViewerService";
    readonly methods: {
        /**
         * Returns the current authenticated viewer. This RPC requires a logged-in
         * user; unauthenticated callers receive an UNAUTHENTICATED error.
         *
         * @generated from rpc chatto.api.v1.ViewerService.GetViewer
         */
        readonly getViewer: {
            readonly name: "GetViewer";
            readonly I: typeof GetViewerRequest;
            readonly O: typeof GetViewerResponse;
            readonly kind: MethodKind.Unary;
        };
    };
};
