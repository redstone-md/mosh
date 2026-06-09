import type { NativeMessagingGateway, VoiceMeta } from "./native/native-messaging-gateway";

export type ChatTarget =
  | { readonly type: "dm"; readonly id: string }
  | { readonly type: "channel"; readonly name: string }
  | { readonly type: "group"; readonly id: string };

export interface ChatAttachmentPayload {
  readonly fileName: string;
  readonly mime: string;
  readonly dataBase64: string;
  readonly thumbnail?: string;
  readonly voice?: VoiceMeta;
}

export function sameChatTarget(left: ChatTarget, right: ChatTarget): boolean {
  if (left.type !== right.type) {
    return false;
  }
  if (left.type === "channel" && right.type === "channel") {
    return left.name === right.name;
  }
  return "id" in left && "id" in right && left.id === right.id;
}

export async function sendChatText(
  gateway: NativeMessagingGateway,
  target: ChatTarget,
  body: string,
): Promise<void> {
  if (target.type === "dm") {
    await gateway.sendPrivateMessage(target.id, body);
    return;
  }
  if (target.type === "channel") {
    await gateway.sendChannelMessage(target.name, body);
    return;
  }
  await gateway.sendGroupMessage(target.id, body);
}

export async function retryChatMessage(
  gateway: NativeMessagingGateway,
  target: ChatTarget,
  messageId: string,
): Promise<void> {
  if (target.type === "dm") {
    await gateway.retryPrivateMessage(target.id, messageId);
    return;
  }
  if (target.type === "channel") {
    await gateway.retryChannelMessage(target.name, messageId);
    return;
  }
  await gateway.retryGroupMessage(target.id, messageId);
}

export async function sendChatAttachment(
  gateway: NativeMessagingGateway,
  target: ChatTarget,
  payload: ChatAttachmentPayload,
): Promise<void> {
  if (target.type === "dm") {
    await gateway.sendPrivateAttachment(
      target.id,
      payload.fileName,
      payload.mime,
      payload.dataBase64,
      payload.thumbnail,
      payload.voice,
    );
    return;
  }
  if (target.type === "channel") {
    await gateway.sendChannelAttachment(
      target.name,
      payload.fileName,
      payload.mime,
      payload.dataBase64,
      payload.thumbnail,
      payload.voice,
    );
    return;
  }
  await gateway.sendGroupAttachment(
    target.id,
    payload.fileName,
    payload.mime,
    payload.dataBase64,
    payload.thumbnail,
    payload.voice,
  );
}

export async function downloadChatAttachment(
  gateway: NativeMessagingGateway,
  target: ChatTarget,
  attachmentId: string,
): Promise<void> {
  if (target.type === "dm") {
    await gateway.downloadPrivateAttachment(target.id, attachmentId);
    return;
  }
  if (target.type === "channel") {
    await gateway.downloadChannelAttachment(target.name, attachmentId);
    return;
  }
  await gateway.downloadGroupAttachment(target.id, attachmentId);
}

export async function cancelChatAttachment(
  gateway: NativeMessagingGateway,
  target: ChatTarget,
  attachmentId: string,
): Promise<void> {
  if (target.type === "dm") {
    await gateway.cancelPrivateAttachment(target.id, attachmentId);
    return;
  }
  if (target.type === "channel") {
    await gateway.cancelChannelAttachment(target.name, attachmentId);
    return;
  }
  await gateway.cancelGroupAttachment(target.id, attachmentId);
}

export async function closeChatTarget(
  gateway: NativeMessagingGateway,
  target: ChatTarget,
): Promise<void> {
  if (target.type === "dm") {
    await gateway.closePrivateSession(target.id);
    return;
  }
  if (target.type === "channel") {
    await gateway.leaveChannel(target.name);
    return;
  }
  await gateway.closePrivateGroup(target.id);
}
