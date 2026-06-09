import { type Dispatch, type SetStateAction, useMemo, useState } from "react";
import { type ChatTarget } from "./chat-actions";
import { copyText } from "./clipboard";
import type { NativeMessagingGateway } from "./native/native-messaging-gateway";

interface InviteCreateState {
  readonly inviteUri?: string;
  readonly copied: boolean;
}

export interface PrivateDmRequestBase {
  readonly display_name: string;
  readonly listen_port: number;
  readonly static_peer: string | null;
}

type RunSetupOperation = (
  kind: "setup",
  action: () => Promise<void>,
) => Promise<void>;

const DEFAULT_LISTEN_PORT = 0;

function defaultDisplayName(): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `mosh-${suffix}`;
}

export function usePrivateDmSetup({
  gateway,
  refresh,
  run,
  setActive,
  setShowSetup,
}: {
  gateway: NativeMessagingGateway;
  refresh: (quiet?: boolean) => Promise<void>;
  run: RunSetupOperation;
  setActive: Dispatch<SetStateAction<ChatTarget | null>>;
  setShowSetup: Dispatch<SetStateAction<boolean>>;
}) {
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [staticPeer, setStaticPeer] = useState("");
  const [listenPort, setListenPort] = useState<number>(DEFAULT_LISTEN_PORT);
  const [createState, setCreateState] = useState<InviteCreateState>({ copied: false });
  const [groupCreateState, setGroupCreateState] = useState<InviteCreateState>({
    copied: false,
  });

  const requestBase = useMemo<PrivateDmRequestBase>(
    () => ({
      display_name: displayName.trim() || defaultDisplayName(),
      listen_port: Number.isFinite(listenPort) ? listenPort : DEFAULT_LISTEN_PORT,
      static_peer: staticPeer.trim() ? staticPeer.trim() : null,
    }),
    [displayName, listenPort, staticPeer],
  );

  const createInvite = () =>
    run("setup", async () => {
      const invite = await gateway.createPrivateInvite(requestBase);
      await copyText(invite.invite_uri);
      setCreateState({ inviteUri: invite.invite_uri, copied: true });
      setActive({ type: "dm", id: invite.session_id });
      setShowSetup(true);
      await refresh(true);
    });

  const acceptInvite = (uri: string) =>
    run("setup", async () => {
      const trimmed = uri.trim();
      if (!trimmed) {
        return;
      }
      const snapshot = await gateway.acceptPrivateInvite({
        ...requestBase,
        invite_uri: trimmed,
      });
      setActive({ type: "dm", id: snapshot.session_id });
      setShowSetup(false);
      await refresh(true);
    });

  const joinChannel = (name: string) =>
    run("setup", async () => {
      const trimmed = name.trim();
      if (!trimmed) {
        return;
      }
      const snapshot = await gateway.joinChannel({
        ...requestBase,
        name: trimmed,
      });
      setActive({ type: "channel", name: snapshot.name });
      setShowSetup(false);
      await refresh(true);
    });

  const createGroup = (label: string) =>
    run("setup", async () => {
      const created = await gateway.createPrivateGroup({
        ...requestBase,
        label: label.trim() || null,
      });
      await copyText(created.invite_uri);
      setGroupCreateState({ inviteUri: created.invite_uri, copied: true });
      setActive({ type: "group", id: created.group_id });
      setShowSetup(true);
      await refresh(true);
    });

  const joinGroup = (uri: string) =>
    run("setup", async () => {
      const trimmed = uri.trim();
      if (!trimmed) {
        return;
      }
      const snapshot = await gateway.joinPrivateGroup({
        ...requestBase,
        invite_uri: trimmed,
      });
      setActive({ type: "group", id: snapshot.group_id });
      setShowSetup(false);
      await refresh(true);
    });

  const copyInvite = async () => {
    const uri = createState.inviteUri;
    if (!uri) {
      return;
    }
    await copyText(uri);
    setCreateState((state) => ({ ...state, copied: true }));
  };

  const copyGroupInvite = async () => {
    const uri = groupCreateState.inviteUri;
    if (!uri) {
      return;
    }
    await copyText(uri);
    setGroupCreateState((state) => ({ ...state, copied: true }));
  };

  const resetInviteState = () => {
    setCreateState({ copied: false });
    setGroupCreateState({ copied: false });
  };

  return {
    acceptInvite,
    copyGroupInvite,
    copyInvite,
    createGroup,
    createInvite,
    createState,
    displayName,
    groupCreateState,
    joinChannel,
    joinGroup,
    listenPort,
    requestBase,
    resetInviteState,
    setDisplayName,
    setListenPort,
    setStaticPeer,
    staticPeer,
  };
}
