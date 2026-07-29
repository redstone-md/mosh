//! Two-ended reachability probe for the Mosh DM stack.
//!
//! The desktop app is the only way to exercise this code path today, which
//! makes every diagnosis a screenshot-reading exercise across two humans. This
//! binary drives the same adapters headlessly so one end can sit on a server
//! and the other on a laptop, and both emit a machine-readable timeline that
//! merges into a single ordered story.
//!
//! Three subcommands: `doctor` reports local facts and exits, `listen` creates
//! an invite and waits for the peer, `dial` accepts an invite and pushes a
//! message through to delivery.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use clap::{Parser, Subcommand};
use mosh_core::attachment_store::AttachmentStore;
use mosh_core::moss_ffi::MossFfiRuntime;
use mosh_core::moss_runtime::{MossDynamicRuntime, MossRuntime};
use mosh_core::network_inventory;
use mosh_core::private_dm_runtime::{
    AcceptInviteRequest, PrivateDmRuntime, SessionSnapshot, StartSessionRequest,
};

/// How often the poll loop ticks. `poll_session` is what drives the runtime's
/// state machine — nothing advances between calls — so this doubles as the
/// runtime's heartbeat, not just a sampling rate.
const TICK: Duration = Duration::from_millis(500);

#[derive(Parser)]
#[command(
    name = "mosh-probe",
    about = "Headless two-ended reachability probe for the Mosh DM stack"
)]
struct Cli {
    /// Explicit path to the moss shared library. Defaults to the same
    /// candidate search the desktop app uses.
    #[arg(long, global = true)]
    moss_lib: Option<std::path::PathBuf>,

    /// Bind moss to a specific network interface, mirroring the desktop app's
    /// VPN-bypass toggle. Pass the adapter name exactly as `doctor` prints it.
    #[arg(long, global = true)]
    bind_interface: Option<String>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Print local network, library and node facts, then exit.
    Doctor {
        /// Also start a throwaway node and report what it observes about
        /// itself. Costs a few seconds; skip it for a pure offline check.
        #[arg(long)]
        with_node: bool,
        /// Port for the throwaway node. 0 lets the OS choose.
        #[arg(long, default_value_t = 0)]
        listen_port: u16,
    },
    /// Create an invite, print it, and wait for the peer to complete MLS.
    Listen {
        #[arg(long, default_value = "probe-listen")]
        display_name: String,
        #[arg(long, default_value_t = 0)]
        listen_port: u16,
        #[arg(long)]
        static_peer: Option<String>,
        /// Give up after this many seconds.
        #[arg(long, default_value_t = 180)]
        timeout_secs: u64,
    },
    /// Accept SEVERAL invites in one process, then send on each and require
    /// every one to be delivered.
    ///
    /// This is the shape the desktop app actually has and `dial` does not: one
    /// process, one identity, several conversations at once. Each session used
    /// to start its own moss node, so N conversations meant N nodes sharing one
    /// peer id — a remote peer keeps one connection per identity and closed the
    /// rest, which is why a chat only worked once every other chat was closed.
    /// One `dial` can never show that; N concurrent ones can.
    DialMany {
        /// Repeat once per invite.
        #[arg(long = "invite", required = true)]
        invites: Vec<String>,
        #[arg(long, default_value = "probe-dial-many")]
        display_name: String,
        #[arg(long, default_value_t = 0)]
        listen_port: u16,
        #[arg(long, default_value = "probe ping")]
        message: String,
        #[arg(long, default_value_t = 180)]
        timeout_secs: u64,
    },
    /// Accept an invite, then send a message and wait for it to be delivered.
    Dial {
        #[arg(long)]
        invite: String,
        #[arg(long, default_value = "probe-dial")]
        display_name: String,
        #[arg(long, default_value_t = 0)]
        listen_port: u16,
        #[arg(long)]
        static_peer: Option<String>,
        #[arg(long, default_value = "probe ping")]
        message: String,
        #[arg(long, default_value_t = 180)]
        timeout_secs: u64,
    },
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Every line of output is one JSON object on stdout. Two probes' logs
/// concatenate and sort into a single timeline without any parsing rules
/// beyond "one object per line".
fn emit(role: &str, kind: &str, body: serde_json::Value) {
    let line = serde_json::json!({
        "ts": now_ms(),
        "role": role,
        "kind": kind,
        "data": body,
    });
    println!("{line}");
}

/// The subset of a snapshot worth a line every tick. The full snapshot carries
/// message bodies and attachment state that would drown the signal; these are
/// the fields that actually distinguish one failure from another.
fn snapshot_line(role: &str, snap: &SessionSnapshot) {
    let mesh = snap.mesh.as_ref();
    emit(
        role,
        "snapshot",
        serde_json::json!({
            "session_id": snap.session_id,
            "mesh_id": snap.mesh_id,
            "state": snap.state,
            "path": snap.path,
            "relay_ready": snap.relay_ready,
            "peer_display_name": snap.peer_display_name,
            "messages": snap.messages.len(),
            "mesh": mesh.map(|m| serde_json::json!({
                "advertised_addr": m.advertised_addr,
                "listen_port": m.listen_port,
                "nat_type": m.nat_type,
                "peer_count": m.peer_count,
                "direct_peer_count": m.direct_peer_count,
                "relayed_peer_count": m.relayed_peer_count,
                "relay_capable_peer_count": m.relay_capable_peer_count,
                "relay_route_count": m.relay_route_count,
                "known_peer_count": m.known_peer_count,
                "supernode_ready": m.supernode_ready,
                "channels": m.channels.len(),
            })),
            "events": snap.events.iter().map(|e| serde_json::json!({
                "name": e.event_name,
                "detail": e.detail_json,
                "at": e.epoch_millis,
            })).collect::<Vec<_>>(),
        }),
    );
}

/// A node whose advertised port differs from the port it bound is being
/// translated, which is what makes a hole punch impossible. Surfacing it as a
/// flag costs nothing and is invisible in the desktop UI today.
fn warn_flags(snap: &SessionSnapshot) -> Vec<&'static str> {
    let mut flags = Vec::new();
    let Some(mesh) = snap.mesh.as_ref() else {
        return flags;
    };
    if mesh.relay_capable_peer_count == 0 {
        flags.push("no_relay_capable_peer");
    }
    if mesh.nat_type == "unknown" {
        flags.push("nat_unclassified");
    }
    if mesh.nat_type == "symmetric_nat" {
        flags.push("symmetric_nat");
    }
    if mesh.listen_port != 0 && !mesh.advertised_addr.is_empty() {
        let advertised_port = mesh
            .advertised_addr
            .rsplit_once(':')
            .and_then(|(_, p)| p.parse::<i32>().ok());
        if advertised_port.is_some_and(|p| p != mesh.listen_port) {
            flags.push("advertised_port_translated");
        }
    }
    flags
}

fn load_runtime(
    moss_lib: Option<std::path::PathBuf>,
) -> Result<Arc<MossFfiRuntime>, Box<dyn std::error::Error>> {
    let runtime = match moss_lib {
        Some(path) => MossFfiRuntime::load_from_path(&path)?,
        None => MossFfiRuntime::load_default()?,
    };
    Ok(Arc::new(runtime))
}

/// The attachment store is required by the DM runtime but irrelevant to a
/// reachability probe, so it lives in a temp dir nobody has to clean up.
fn scratch_store() -> Result<Arc<AttachmentStore>, Box<dyn std::error::Error>> {
    let mut path = std::env::temp_dir();
    path.push(format!("mosh-probe-attachments-{}", std::process::id()));
    Ok(Arc::new(AttachmentStore::new(&path)?))
}

fn report_interfaces(role: &str) {
    match network_inventory::list_interfaces() {
        Ok(interfaces) => {
            let rows: Vec<_> = interfaces
                .iter()
                .filter(|i| i.is_up && !i.is_loopback)
                .map(|i| {
                    serde_json::json!({
                        "name": i.name,
                        "description": i.description,
                        "index": i.index,
                        "ipv4": i.ipv4,
                        "is_virtual": i.is_virtual,
                        "is_vpn": i.is_vpn,
                        "is_default_route": i.is_default_route,
                    })
                })
                .collect();
            emit(role, "interfaces", serde_json::json!(rows));
        }
        Err(error) => emit(role, "interfaces_error", serde_json::json!(error)),
    }
}

fn doctor(
    moss_lib: Option<std::path::PathBuf>,
    bind_interface: Option<String>,
    with_node: bool,
    listen_port: u16,
) -> Result<(), Box<dyn std::error::Error>> {
    let role = "doctor";
    report_interfaces(role);

    let status = MossDynamicRuntime::from_default_candidates().status();
    emit(
        role,
        "moss_library",
        serde_json::json!({
            "link_mode": status.link_mode,
            "library_name": status.library_name,
            "available": status.available,
            "checked_paths": status.checked_paths,
            "required_symbols": status.required_symbols,
        }),
    );

    emit(
        role,
        "bind_interface",
        serde_json::json!({
            "requested": bind_interface,
            "effective": mosh_core::moss_ffi::current_bind_interface(),
        }),
    );

    if !with_node {
        return Ok(());
    }

    let runtime = load_runtime(moss_lib)?;
    let store = scratch_store()?;
    let mut dm = PrivateDmRuntime::from_shared(runtime, store, None);
    let created = dm.create_invite(StartSessionRequest {
        display_name: "probe-doctor".to_string(),
        listen_port,
        static_peer: None,
    })?;
    emit(
        role,
        "node_started",
        serde_json::json!({ "mesh_id": created.mesh_id, "listen_address": created.listen_address }),
    );

    // A node needs a moment to bind, probe STUN and pick up its first peers;
    // sampling immediately would only ever report "unknown".
    for _ in 0..20 {
        std::thread::sleep(TICK);
        let snap = dm.poll_session(&created.session_id)?;
        snapshot_line(role, &snap);
    }
    let snap = dm.poll_session(&created.session_id)?;
    emit(
        role,
        "verdict",
        serde_json::json!({ "flags": warn_flags(&snap) }),
    );
    Ok(())
}

/// Drives the runtime until `done` is satisfied or the budget runs out,
/// emitting one snapshot line per tick. Returns whether `done` was reached.
fn pump(
    role: &str,
    dm: &mut PrivateDmRuntime,
    session_id: &str,
    timeout: Duration,
    mut done: impl FnMut(&SessionSnapshot) -> bool,
) -> Result<bool, Box<dyn std::error::Error>> {
    let deadline = std::time::Instant::now() + timeout;
    let mut reached = false;
    while std::time::Instant::now() < deadline {
        let snap = dm.poll_session(session_id)?;
        snapshot_line(role, &snap);
        if done(&snap) {
            reached = true;
            break;
        }
        std::thread::sleep(TICK);
    }
    Ok(reached)
}

/// `pump` across several sessions at once: one snapshot line per session per
/// tick, finishing only when EVERY session satisfies `done`. Concurrency is the
/// point — checking them one after another would let an earlier session finish
/// and go quiet while a later one is still starting.
fn pump_all(
    role: &str,
    dm: &mut PrivateDmRuntime,
    session_ids: &[String],
    timeout: Duration,
    mut done: impl FnMut(&SessionSnapshot) -> bool,
) -> Result<bool, Box<dyn std::error::Error>> {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        let mut all = true;
        for session_id in session_ids {
            let snap = dm.poll_session(session_id)?;
            snapshot_line(role, &snap);
            if !done(&snap) {
                all = false;
            }
        }
        if all {
            return Ok(true);
        }
        std::thread::sleep(TICK);
    }
    Ok(false)
}

fn dial_many(
    moss_lib: Option<std::path::PathBuf>,
    invites: Vec<String>,
    display_name: String,
    listen_port: u16,
    message: String,
    timeout_secs: u64,
) -> Result<(), Box<dyn std::error::Error>> {
    let role = "dial-many";
    report_interfaces(role);
    let runtime = load_runtime(moss_lib)?;
    let store = scratch_store()?;
    let mut dm = PrivateDmRuntime::from_shared(runtime, store, None);

    let mut session_ids = Vec::new();
    for invite in invites {
        let accepted = dm.accept_invite(AcceptInviteRequest {
            invite_uri: invite,
            display_name: display_name.clone(),
            listen_port,
            static_peer: None,
        })?;
        emit(
            role,
            "accepted",
            serde_json::json!({
                "session_id": accepted.session_id,
                "mesh_id": accepted.mesh_id,
            }),
        );
        session_ids.push(accepted.session_id);
    }

    let budget = Duration::from_secs(timeout_secs);
    let started = std::time::Instant::now();
    let ready = pump_all(role, &mut dm, &session_ids, budget, |snap| {
        snap.state == "ready"
    })?;

    // One node or N is visible from here: every session reports the port of the
    // node carrying it, so N distinct ports means N nodes under one identity —
    // the thing that used to break the second conversation.
    let ports: Vec<i32> = session_ids
        .iter()
        .filter_map(|id| dm.poll_session(id).ok())
        .filter_map(|snap| snap.mesh.map(|mesh| mesh.listen_port))
        .collect();
    let mut distinct = ports.clone();
    distinct.sort_unstable();
    distinct.dedup();
    emit(
        role,
        "topology",
        serde_json::json!({
            "sessions": session_ids.len(),
            "listen_ports": ports,
            "distinct_nodes": distinct.len(),
        }),
    );

    if !ready {
        emit(
            role,
            "verdict",
            serde_json::json!({ "ok": false, "stage": "mls_handshake" }),
        );
        std::process::exit(1);
    }

    let mut sent_ids = Vec::new();
    for session_id in &session_ids {
        let sent = dm.send_message(session_id, message.clone())?;
        emit(
            role,
            "sent",
            serde_json::json!({ "session_id": session_id, "message_id": sent.message_id }),
        );
        sent_ids.push(sent.message_id);
    }

    let remaining = budget.saturating_sub(started.elapsed());
    let delivered = pump_all(role, &mut dm, &session_ids, remaining, |snap| {
        snap.messages.iter().any(|message| {
            sent_ids
                .iter()
                .any(|id| message.message_id.as_deref() == Some(id.as_str()))
                && format!("{:?}", message.delivery_status).contains("Delivered")
        })
    })?;

    emit(
        role,
        "verdict",
        serde_json::json!({
            "ok": delivered && distinct.len() == 1,
            "stage": if delivered { "delivered" } else { "delivery" },
            "sessions": session_ids.len(),
            "distinct_nodes": distinct.len(),
        }),
    );
    if !delivered || distinct.len() != 1 {
        std::process::exit(1);
    }
    Ok(())
}

fn listen(
    moss_lib: Option<std::path::PathBuf>,
    display_name: String,
    listen_port: u16,
    static_peer: Option<String>,
    timeout_secs: u64,
) -> Result<(), Box<dyn std::error::Error>> {
    let role = "listen";
    report_interfaces(role);
    let runtime = load_runtime(moss_lib)?;
    let store = scratch_store()?;
    let mut dm = PrivateDmRuntime::from_shared(runtime, store, None);

    let created = dm.create_invite(StartSessionRequest {
        display_name,
        listen_port,
        static_peer,
    })?;
    // The runner script greps this line to hand the URI to the other end, so
    // it is emitted before anything can fail downstream.
    emit(
        role,
        "invite",
        serde_json::json!({
            "invite_uri": created.invite_uri,
            "session_id": created.session_id,
            "mesh_id": created.mesh_id,
            "fingerprint": created.fingerprint,
            "listen_address": created.listen_address,
        }),
    );

    let ready = pump(
        role,
        &mut dm,
        &created.session_id,
        Duration::from_secs(timeout_secs),
        |snap| snap.state == "ready" && !snap.messages.is_empty(),
    )?;

    let snap = dm.poll_session(&created.session_id)?;
    emit(
        role,
        "verdict",
        serde_json::json!({
            "ok": ready,
            "state": snap.state,
            "path": snap.path,
            "messages": snap.messages.len(),
            "flags": warn_flags(&snap),
        }),
    );
    if !ready {
        std::process::exit(1);
    }
    Ok(())
}

fn dial(
    moss_lib: Option<std::path::PathBuf>,
    invite: String,
    display_name: String,
    listen_port: u16,
    static_peer: Option<String>,
    message: String,
    timeout_secs: u64,
) -> Result<(), Box<dyn std::error::Error>> {
    let role = "dial";
    report_interfaces(role);
    let runtime = load_runtime(moss_lib)?;
    let store = scratch_store()?;
    let mut dm = PrivateDmRuntime::from_shared(runtime, store, None);

    let accepted = dm.accept_invite(AcceptInviteRequest {
        invite_uri: invite,
        display_name,
        listen_port,
        static_peer,
    })?;
    emit(
        role,
        "accepted",
        serde_json::json!({ "session_id": accepted.session_id, "mesh_id": accepted.mesh_id }),
    );

    let budget = Duration::from_secs(timeout_secs);
    let started = std::time::Instant::now();
    let ready = pump(role, &mut dm, &accepted.session_id, budget, |snap| {
        snap.state == "ready"
    })?;
    if !ready {
        let snap = dm.poll_session(&accepted.session_id)?;
        emit(
            role,
            "verdict",
            serde_json::json!({
                "ok": false,
                "stage": "mls_handshake",
                "state": snap.state,
                "path": snap.path,
                "flags": warn_flags(&snap),
            }),
        );
        std::process::exit(1);
    }

    let sent = dm.send_message(&accepted.session_id, message)?;
    emit(
        role,
        "sent",
        serde_json::json!({ "message_id": sent.message_id }),
    );

    // Whatever is left of the budget after the handshake belongs to delivery.
    let remaining = budget.saturating_sub(started.elapsed());
    let delivered = pump(role, &mut dm, &accepted.session_id, remaining, |snap| {
        snap.messages.iter().any(|m| {
            m.message_id.as_deref() == Some(sent.message_id.as_str())
                && format!("{:?}", m.delivery_status).contains("Delivered")
        })
    })?;

    let snap = dm.poll_session(&accepted.session_id)?;
    emit(
        role,
        "verdict",
        serde_json::json!({
            "ok": delivered,
            "stage": if delivered { "delivered" } else { "delivery" },
            "state": snap.state,
            "path": snap.path,
            "flags": warn_flags(&snap),
        }),
    );
    if !delivered {
        std::process::exit(1);
    }
    Ok(())
}

fn main() {
    let cli = Cli::parse();
    if let Some(name) = cli.bind_interface.clone() {
        mosh_core::moss_ffi::set_bind_interface(Some(name));
    }

    let result = match cli.command {
        Command::Doctor {
            with_node,
            listen_port,
        } => doctor(cli.moss_lib, cli.bind_interface, with_node, listen_port),
        Command::Listen {
            display_name,
            listen_port,
            static_peer,
            timeout_secs,
        } => listen(
            cli.moss_lib,
            display_name,
            listen_port,
            static_peer,
            timeout_secs,
        ),
        Command::DialMany {
            invites,
            display_name,
            listen_port,
            message,
            timeout_secs,
        } => dial_many(
            cli.moss_lib,
            invites,
            display_name,
            listen_port,
            message,
            timeout_secs,
        ),
        Command::Dial {
            invite,
            display_name,
            listen_port,
            static_peer,
            message,
            timeout_secs,
        } => dial(
            cli.moss_lib,
            invite,
            display_name,
            listen_port,
            static_peer,
            message,
            timeout_secs,
        ),
    };

    if let Err(error) = result {
        emit("probe", "error", serde_json::json!(error.to_string()));
        std::process::exit(1);
    }
}
