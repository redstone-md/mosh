import {
  FormEvent,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  cancelChatAttachment,
  downloadChatAttachment,
  sameChatTarget,
  sendChatAttachment,
  sendChatText,
  type ChatTarget,
} from "./chat-actions";
import {
  createThumbnail,
  isAttachmentTooLarge,
  isStreamableMedia,
  localFileSrc,
  readFileAsBase64,
  streamingMediaSrc,
} from "./attachment-utils";
import { readableError } from "./format";
import type {
  AttachmentDescriptor,
  AttachmentView,
  NativeMessagingGateway,
} from "./native/native-messaging-gateway";
import type { OperationKind } from "./use-operation-busy";
import type { VoiceSend } from "./voice/VoiceComposer";

export interface AttachmentApi {
  readonly views: ReadonlyMap<string, AttachmentView>;
  readonly busy: boolean;
  readonly onSend: (file: File) => void;
  readonly onSendVoice: (voice: VoiceSend) => void;
  readonly onVoiceError: (message: string) => void;
  readonly onDownload: (attachmentId: string) => void;
  readonly onCancel: (attachmentId: string) => void;
  readonly onOpen: (descriptor: AttachmentDescriptor) => void;
}

export interface ChatViewerState {
  readonly descriptor: AttachmentDescriptor;
  readonly src: string;
}

interface FailedSend {
  readonly target: ChatTarget;
  readonly body: string;
}

type RunOperation = <T>(
  kind: OperationKind,
  action: () => Promise<T>,
) => Promise<T>;

interface UseChatOrchestrationOptions {
  readonly active: ChatTarget | null;
  readonly activeAttachments: readonly AttachmentView[];
  readonly composer: string;
  readonly gateway: NativeMessagingGateway;
  readonly refresh: (quiet?: boolean) => Promise<void>;
  readonly runOperation: RunOperation;
  readonly setComposer: Dispatch<SetStateAction<string>>;
  readonly transferBusy: boolean;
  readonly onError: Dispatch<SetStateAction<string | undefined>>;
}

export function useChatOrchestration({
  active,
  activeAttachments,
  composer,
  gateway,
  refresh,
  runOperation,
  setComposer,
  transferBusy,
  onError,
}: UseChatOrchestrationOptions) {
  const [lastFailedSend, setLastFailedSend] = useState<FailedSend | null>(null);
  const [viewer, setViewer] = useState<ChatViewerState | null>(null);
  const [pendingOpen, setPendingOpen] = useState<AttachmentDescriptor | null>(null);

  const attachmentViews = useMemo(
    () => new Map(activeAttachments.map((view) => [view.attachment_id, view])),
    [activeAttachments],
  );

  const clearFailedSend = useCallback(() => setLastFailedSend(null), []);

  const run = useCallback(
    async (
      kind: OperationKind,
      action: () => Promise<void>,
      onFailure?: () => void,
    ) => {
      onError(undefined);
      if (kind !== "message") {
        setLastFailedSend(null);
      }
      try {
        await runOperation(kind, action);
      } catch (err) {
        onError(readableError(err));
        onFailure?.();
      }
    },
    [onError, runOperation],
  );

  const sendMessageBody = useCallback(
    (target: ChatTarget, body: string) => {
      void run(
        "message",
        async () => {
          await sendChatText(gateway, target, body);
          setLastFailedSend(null);
          setComposer((current) => (current.trim() === body ? "" : current));
          await refresh(true);
        },
        () => setLastFailedSend({ target, body }),
      );
    },
    [gateway, refresh, run, setComposer],
  );

  const sendMessage = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const body = composer.trim();
      if (!body || !active) {
        return;
      }
      sendMessageBody(active, body);
    },
    [active, composer, sendMessageBody],
  );

  const retryFailedSend = useCallback(() => {
    if (!active || !lastFailedSend || !sameChatTarget(active, lastFailedSend.target)) {
      return;
    }
    sendMessageBody(lastFailedSend.target, lastFailedSend.body);
  }, [active, lastFailedSend, sendMessageBody]);

  const sendAttachment = useCallback(
    (file: File) => {
      if (!active) {
        return;
      }
      if (isAttachmentTooLarge(file)) {
        onError("Attachment exceeds the 50 MB limit");
        return;
      }
      const target = active;
      void run("transfer", async () => {
        const dataBase64 = await readFileAsBase64(file);
        const thumbnail = await createThumbnail(file);
        const mime = file.type ?? "";
        await sendChatAttachment(gateway, target, {
          fileName: file.name,
          mime,
          dataBase64,
          thumbnail,
        });
        await refresh(true);
      });
    },
    [active, gateway, onError, refresh, run],
  );

  const sendVoice = useCallback(
    (voice: VoiceSend) => {
      if (!active) {
        return;
      }
      const target = active;
      const fileName = voice.mime.includes("ogg")
        ? "voice-message.ogg"
        : "voice-message.webm";
      const meta = { duration_ms: voice.durationMs, peaks_b64: voice.peaksB64 };
      void run("transfer", async () => {
        const dataBase64 = await readFileAsBase64(
          new File([voice.blob], fileName, { type: voice.mime }),
        );
        await sendChatAttachment(gateway, target, {
          fileName,
          mime: voice.mime,
          dataBase64,
          voice: meta,
        });
        await refresh(true);
      });
    },
    [active, gateway, refresh, run],
  );

  const downloadAttachment = useCallback(
    (attachmentId: string) => {
      if (!active) {
        return;
      }
      const target = active;
      void run("transfer", async () => {
        await downloadChatAttachment(gateway, target, attachmentId);
        await refresh(true);
      });
    },
    [active, gateway, refresh, run],
  );

  const cancelAttachment = useCallback(
    (attachmentId: string) => {
      if (!active) {
        return;
      }
      const target = active;
      void run("transfer", async () => {
        await cancelChatAttachment(gateway, target, attachmentId);
        await refresh(true);
      });
    },
    [active, gateway, refresh, run],
  );

  const openAttachment = useCallback(
    (descriptor: AttachmentDescriptor) => {
      if (!active) {
        return;
      }
      const view = attachmentViews.get(descriptor.attachment_id);
      if (view?.local_path) {
        setViewer({ descriptor, src: localFileSrc(view.local_path) });
        return;
      }
      if (isStreamableMedia(descriptor.mime)) {
        const host = active.type === "channel" ? active.name : active.id;
        downloadAttachment(descriptor.attachment_id);
        setViewer({
          descriptor,
          src: streamingMediaSrc(active.type, host, descriptor.attachment_id),
        });
        return;
      }
      setPendingOpen(descriptor);
      downloadAttachment(descriptor.attachment_id);
    },
    [active, attachmentViews, downloadAttachment],
  );

  useEffect(() => {
    if (!pendingOpen) {
      return;
    }
    const view = activeAttachments.find(
      (candidate) => candidate.attachment_id === pendingOpen.attachment_id,
    );
    if (view?.local_path) {
      setViewer({ descriptor: pendingOpen, src: localFileSrc(view.local_path) });
      setPendingOpen(null);
    } else if (view && (view.state === "failed" || view.state === "cancelled")) {
      setPendingOpen(null);
    }
  }, [activeAttachments, pendingOpen]);

  const attachmentApi = useMemo<AttachmentApi>(
    () => ({
      views: attachmentViews,
      busy: transferBusy,
      onSend: sendAttachment,
      onSendVoice: sendVoice,
      onVoiceError: onError,
      onDownload: downloadAttachment,
      onCancel: cancelAttachment,
      onOpen: openAttachment,
    }),
    [
      attachmentViews,
      cancelAttachment,
      downloadAttachment,
      onError,
      openAttachment,
      sendAttachment,
      sendVoice,
      transferBusy,
    ],
  );

  const canRetrySend = Boolean(
    active && lastFailedSend && sameChatTarget(active, lastFailedSend.target),
  );

  return {
    attachmentApi,
    canRetrySend,
    clearFailedSend,
    retryFailedSend,
    sendMessage,
    setViewer,
    viewer,
  };
}
