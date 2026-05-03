import {
  appShellText,
  diagnosticsText,
  dmText,
  invitePanelText,
  messages,
  trustSteps,
} from "./private-dm.content";

export function PrivateDmScreen() {
  return (
    <main className="mosh-shell" aria-label={appShellText.productName}>
      <aside className="mosh-rail">
        <div className="brand-mark">{appShellText.productName}</div>
        <nav className="rail-nav" aria-label={appShellText.sectionLabel}>
          <button className="rail-item rail-item-active" type="button">
            {appShellText.navDirect}
          </button>
          <button className="rail-item" type="button">
            {appShellText.navInvite}
          </button>
          <button className="rail-item" type="button">
            {appShellText.navDiagnostics}
          </button>
        </nav>
        <div className="rail-user">
          <span className="presence-dot" />
          {appShellText.localUser}
        </div>
      </aside>

      <section className="session-column" aria-labelledby="session-title">
        <div className="section-kicker">{appShellText.statusLabel}</div>
        <h1 id="session-title">{invitePanelText.title}</h1>
        <p>{invitePanelText.subtitle}</p>

        <div className="invite-card">
          <div className="invite-actions">
            <button className="btn btn-primary" type="button">
              {invitePanelText.createLabel}
            </button>
            <button className="btn" type="button">
              {invitePanelText.pasteLabel}
            </button>
          </div>
          <code className="invite-uri">{invitePanelText.inviteValue}</code>
        </div>

        <div className="fingerprint-card">
          <span>{invitePanelText.fingerprintLabel}</span>
          <strong>{invitePanelText.fingerprintValue}</strong>
          <button className="btn btn-primary" type="button">
            {invitePanelText.confirmLabel}
          </button>
        </div>

        <ol className="trust-rail" aria-label={appShellText.sectionLabel}>
          {trustSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="chat-column" aria-labelledby="dm-title">
        <header className="chat-header">
          <div>
            <h2 id="dm-title">{dmText.contactName}</h2>
            <p>{dmText.contactStatus}</p>
          </div>
          <span className="status-pill">{appShellText.statusLabel}</span>
        </header>

        <div className="crypto-banner">
          <div className="shield-mark">OK</div>
          <div>
            <strong>{dmText.bannerTitle}</strong>
            <p>{dmText.bannerBody}</p>
          </div>
        </div>

        <div className="message-list" aria-label={dmText.contactName}>
          {messages.map((message) => (
            <article className={`message message-${message.author}`} key={message.id}>
              <span>{message.time}</span>
              <p>{message.body}</p>
            </article>
          ))}
        </div>

        <form className="composer">
          <input aria-label={dmText.composerPlaceholder} placeholder={dmText.composerPlaceholder} />
          <button className="btn btn-primary" type="button">
            {dmText.sendLabel}
          </button>
        </form>
      </section>

      <aside className="diagnostics-panel" aria-labelledby="diagnostics-title">
        <h2 id="diagnostics-title">{diagnosticsText.title}</h2>
        <DiagnosticRow label={diagnosticsText.mossLinkLabel} value={diagnosticsText.mossLinkValue} />
        <DiagnosticRow label={diagnosticsText.discoveryLabel} value={diagnosticsText.discoveryValue} />
        <DiagnosticRow label={diagnosticsText.storageLabel} value={diagnosticsText.storageValue} />
        <DiagnosticRow label={diagnosticsText.mlsLabel} value={diagnosticsText.mlsValue} />
      </aside>
    </main>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="diagnostic-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
