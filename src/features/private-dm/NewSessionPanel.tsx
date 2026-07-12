import { useState } from "react";
import { OnboardMenu } from "./NewSessionPanelMenu";
import { PersistenceWarningBanner } from "./NewSessionPanel.parts";
import {
  ChannelJoinStep,
  ChatCreateStep,
  GroupCreateStep,
  OnboardJoinStep,
} from "./NewSessionPanelSteps";
import type { OnboardStep } from "./NewSessionPanel.types";
import type { NativeMessagingGateway } from "./native/native-messaging-gateway";
import type { InviteCreateState } from "./private-dm-setup.types";
import type { PersistenceWarning } from "./use-runtime-persistence-status";
import { VpnBanner } from "./vpn/VpnBanner";

export function NewSessionPanel(props: {
  displayName: string;
  staticPeer: string;
  listenPort: number;
  busy: boolean;
  createState: InviteCreateState;
  groupCreateState: InviteCreateState;
  error?: string;
  persistenceWarning?: PersistenceWarning | null;
  gateway: NativeMessagingGateway;
  onDisplayName: (value: string) => void;
  onStaticPeer: (value: string) => void;
  onListenPort: (value: number) => void;
  onCreate: () => void;
  onAccept: (uri: string) => void;
  onJoinChannel: (name: string) => void;
  onCreateGroup: (label: string) => void;
  onJoinGroup: (uri: string) => void;
  onJoinOrg: (uri: string) => void;
  onCopyInvite: () => void;
  onCopyGroupInvite: () => void;
}) {
  const [step, setStep] = useState<OnboardStep>("menu");
  const [joinValue, setJoinValue] = useState("");
  const [channelValue, setChannelValue] = useState("");
  const [groupLabelValue, setGroupLabelValue] = useState("");
  const backToMenu = () => setStep("menu");

  return (
    <div className="onboard scroll">
      <div className="onboard-shell">
        <VpnBanner gateway={props.gateway} />
        {props.persistenceWarning ? (
          <PersistenceWarningBanner warning={props.persistenceWarning} />
        ) : null}
        {step === "menu" ? (
          <OnboardMenu
            displayName={props.displayName}
            staticPeer={props.staticPeer}
            listenPort={props.listenPort}
            gateway={props.gateway}
            onDisplayName={props.onDisplayName}
            onStaticPeer={props.onStaticPeer}
            onListenPort={props.onListenPort}
            onPick={setStep}
          />
        ) : step === "chat" ? (
          <ChatCreateStep
            busy={props.busy}
            createState={props.createState}
            onBack={backToMenu}
            onCreate={props.onCreate}
            onCopyInvite={props.onCopyInvite}
          />
        ) : step === "group" ? (
          <GroupCreateStep
            value={groupLabelValue}
            busy={props.busy}
            createState={props.groupCreateState}
            onChange={setGroupLabelValue}
            onBack={backToMenu}
            onCreateGroup={props.onCreateGroup}
            onCopyGroupInvite={props.onCopyGroupInvite}
          />
        ) : step === "join" ? (
          <OnboardJoinStep
            value={joinValue}
            busy={props.busy}
            onChange={setJoinValue}
            onBack={backToMenu}
            onAccept={props.onAccept}
            onJoinGroup={props.onJoinGroup}
            onJoinOrg={props.onJoinOrg}
          />
        ) : (
          <ChannelJoinStep
            value={channelValue}
            busy={props.busy}
            onChange={setChannelValue}
            onBack={backToMenu}
            onJoinChannel={props.onJoinChannel}
          />
        )}

        {props.error ? (
          <div className="inline-error" role="alert">
            {props.error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
