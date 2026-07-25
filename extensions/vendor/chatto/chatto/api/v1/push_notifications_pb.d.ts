import type { BinaryReadOptions, FieldList, JsonReadOptions, JsonValue, PartialMessage, PlainMessage } from "@bufbuild/protobuf";
import { Message, proto3 } from "@bufbuild/protobuf";
/**
 * Request to store a PushSubscription returned by the browser Push API.
 *
 * @generated from message chatto.api.v1.SubscribePushRequest
 */
export declare class SubscribePushRequest extends Message<SubscribePushRequest> {
    /**
     * Push service endpoint URL.
     *
     * @generated from field: string endpoint = 1;
     */
    endpoint: string;
    /**
     * Client P-256 ECDH public key from PushSubscription.keys.p256dh.
     *
     * @generated from field: string p256dh = 2;
     */
    p256dh: string;
    /**
     * Authentication secret from PushSubscription.keys.auth.
     *
     * @generated from field: string auth = 3;
     */
    auth: string;
    /**
     * Optional browser user-agent string for device identification.
     *
     * @generated from field: optional string user_agent = 4;
     */
    userAgent?: string;
    constructor(data?: PartialMessage<SubscribePushRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.SubscribePushRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): SubscribePushRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): SubscribePushRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): SubscribePushRequest;
    static equals(a: SubscribePushRequest | PlainMessage<SubscribePushRequest> | undefined, b: SubscribePushRequest | PlainMessage<SubscribePushRequest> | undefined): boolean;
}
/**
 * Response from storing a browser push subscription.
 *
 * @generated from message chatto.api.v1.SubscribePushResponse
 */
export declare class SubscribePushResponse extends Message<SubscribePushResponse> {
    /**
     * True when the subscription was stored.
     *
     * @generated from field: bool subscribed = 1;
     */
    subscribed: boolean;
    constructor(data?: PartialMessage<SubscribePushResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.SubscribePushResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): SubscribePushResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): SubscribePushResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): SubscribePushResponse;
    static equals(a: SubscribePushResponse | PlainMessage<SubscribePushResponse> | undefined, b: SubscribePushResponse | PlainMessage<SubscribePushResponse> | undefined): boolean;
}
/**
 * Request to remove a browser push subscription.
 *
 * @generated from message chatto.api.v1.UnsubscribePushRequest
 */
export declare class UnsubscribePushRequest extends Message<UnsubscribePushRequest> {
    /**
     * Push service endpoint URL to remove.
     *
     * @generated from field: string endpoint = 1;
     */
    endpoint: string;
    constructor(data?: PartialMessage<UnsubscribePushRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UnsubscribePushRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UnsubscribePushRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UnsubscribePushRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UnsubscribePushRequest;
    static equals(a: UnsubscribePushRequest | PlainMessage<UnsubscribePushRequest> | undefined, b: UnsubscribePushRequest | PlainMessage<UnsubscribePushRequest> | undefined): boolean;
}
/**
 * Response from removing a browser push subscription.
 *
 * @generated from message chatto.api.v1.UnsubscribePushResponse
 */
export declare class UnsubscribePushResponse extends Message<UnsubscribePushResponse> {
    /**
     * True when the request completed.
     *
     * @generated from field: bool unsubscribed = 1;
     */
    unsubscribed: boolean;
    constructor(data?: PartialMessage<UnsubscribePushResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.UnsubscribePushResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): UnsubscribePushResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): UnsubscribePushResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): UnsubscribePushResponse;
    static equals(a: UnsubscribePushResponse | PlainMessage<UnsubscribePushResponse> | undefined, b: UnsubscribePushResponse | PlainMessage<UnsubscribePushResponse> | undefined): boolean;
}
/**
 * Request to test the current user's registered browser push subscriptions.
 *
 * @generated from message chatto.api.v1.SendTestPushNotificationRequest
 */
export declare class SendTestPushNotificationRequest extends Message<SendTestPushNotificationRequest> {
    constructor(data?: PartialMessage<SendTestPushNotificationRequest>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.SendTestPushNotificationRequest";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): SendTestPushNotificationRequest;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): SendTestPushNotificationRequest;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): SendTestPushNotificationRequest;
    static equals(a: SendTestPushNotificationRequest | PlainMessage<SendTestPushNotificationRequest> | undefined, b: SendTestPushNotificationRequest | PlainMessage<SendTestPushNotificationRequest> | undefined): boolean;
}
/**
 * Result of sending a test Web Push notification.
 *
 * @generated from message chatto.api.v1.SendTestPushNotificationResponse
 */
export declare class SendTestPushNotificationResponse extends Message<SendTestPushNotificationResponse> {
    /**
     * True when the push provider accepted the notification.
     *
     * @generated from field: bool sent = 1;
     */
    sent: boolean;
    constructor(data?: PartialMessage<SendTestPushNotificationResponse>);
    static readonly runtime: typeof proto3;
    static readonly typeName = "chatto.api.v1.SendTestPushNotificationResponse";
    static readonly fields: FieldList;
    static fromBinary(bytes: Uint8Array, options?: Partial<BinaryReadOptions>): SendTestPushNotificationResponse;
    static fromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): SendTestPushNotificationResponse;
    static fromJsonString(jsonString: string, options?: Partial<JsonReadOptions>): SendTestPushNotificationResponse;
    static equals(a: SendTestPushNotificationResponse | PlainMessage<SendTestPushNotificationResponse> | undefined, b: SendTestPushNotificationResponse | PlainMessage<SendTestPushNotificationResponse> | undefined): boolean;
}
