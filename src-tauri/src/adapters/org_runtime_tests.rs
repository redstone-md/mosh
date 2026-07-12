use super::*;
use crate::adapters::moss_ffi::{drain_received_messages, MOSS_TEST_LOCK};
use std::path::PathBuf;

const ORG_KEY_HEX: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn bundle(mesh: &str) -> String {
    format!("mosh://org?mesh={mesh}&name=acme#org={ORG_KEY_HEX}")
}

fn org_key() -> SigningKey {
    SigningKey::from_bytes(&[2u8; 32])
}

fn org_key_hex() -> String {
    hex::encode(org_key().verifying_key().to_bytes())
}

fn org_bundle(mesh: &str) -> String {
    format!("mosh://org?mesh={mesh}&name=acme#org={}", org_key_hex())
}

fn signed_roster(version: u64, members: &[(&str, &str, &str)]) -> Vec<u8> {
    let mut doc = serde_json::json!({
        "org_pubkey": org_key_hex(),
        "org_name": "acme",
        "version": version,
        "members": members
            .iter()
            .map(|(id, name, role)| serde_json::json!({
                "moss_peer_id": id, "name": name, "role": role,
            }))
            .collect::<Vec<_>>(),
    });
    org_roster::sign_roster(&mut doc, &org_key()).unwrap()
}

fn roster_wire(bytes: &[u8]) -> Vec<u8> {
    serde_json::to_vec(&OrgWire::Roster {
        roster_b64: encode(bytes),
    })
    .unwrap()
}

fn signed_wire(sender: &SigningKey, mesh: &str, message: &OrgMessage) -> Vec<u8> {
    let org = org_key_hex();
    let ctx = OrgContext {
        org_pubkey: &org,
        mesh_id: mesh,
        channel_kind: ORG_CHANNEL_KIND,
    };
    let env = org_envelope::sign(sender, &ctx, &serde_json::to_vec(message).unwrap());
    serde_json::to_vec(&OrgWire::Signed {
        payload_b64: encode(&env.payload),
        peer_id: env.peer_id,
        sig_b64: encode(&env.sig),
    })
    .unwrap()
}

fn identity_blob(seed: [u8; 32]) -> Vec<u8> {
    let key = SigningKey::from_bytes(&seed);
    let mut blob = vec![1u8];
    blob.extend_from_slice(&seed);
    blob.extend_from_slice(&key.verifying_key().to_bytes());
    blob.extend_from_slice(&[0u8; 64]);
    blob
}

fn temp_persistence(tag: &str, seed: [u8; 32]) -> (Arc<Persistence>, PathBuf) {
    let mut path = std::env::temp_dir();
    path.push(format!("mosh-org-rt-{tag}-{}.redb", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let p = Persistence::open_with_dek(&path, [9u8; 32]).expect("store should open");
    p.put_moss_identity(&identity_blob(seed)).unwrap();
    (Arc::new(p), path)
}

#[test]
fn parses_bundle_uri() {
    let parsed = ParsedOrgBundle::parse(&bundle("orgmesh-1")).unwrap();
    assert_eq!(parsed.mesh_id, "orgmesh-1");
    assert_eq!(parsed.org_name, "acme");
    assert_eq!(parsed.org_pubkey, ORG_KEY_HEX);
}

#[test]
fn rejects_bad_bundles() {
    for bad in [
        "mosh://org?mesh=m&name=x#org=zz",
        &format!("mosh://org?name=x#org={ORG_KEY_HEX}"),
        &format!("mosh://org?mesh=m#org={ORG_KEY_HEX}"),
        &format!("https://org?mesh=m&name=x#org={ORG_KEY_HEX}"),
        "mosh://org?mesh=m&name=x",
        &format!("mosh://org?mesh=m&name=x#{ORG_KEY_HEX}"),
    ] {
        assert!(ParsedOrgBundle::parse(bad).is_err(), "accepted: {bad}");
    }
}

#[test]
fn join_persists_record_and_reports_confirmation_code() {
    let _guard = MOSS_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    drain_received_messages();

    let seed = [42u8; 32];
    let (persistence, path) = temp_persistence("join", seed);
    let moss = Arc::new(MossFfiRuntime::load_default().expect("moss should load"));
    let mut runtime = OrgRuntime::from_shared(Arc::clone(&moss), Some(persistence.clone()));

    let snapshot = runtime
        .join_org(JoinOrgRequest {
            bundle_uri: bundle("orgmesh-join"),
            display_name: "Alice".into(),
            listen_port: 42310,
            static_peer: None,
        })
        .expect("join should succeed");

    let expected_peer = org_signing::peer_id_hex(&SigningKey::from_bytes(&seed));
    assert_eq!(snapshot.own_peer_id, expected_peer);
    assert_eq!(
        snapshot.confirmation_code,
        org_signing::confirmation_code(&expected_peer)
    );
    assert!(!snapshot.in_roster);
    assert!(snapshot.members.is_empty());
    assert!(persistence.get_org_record(ORG_KEY_HEX).unwrap().is_some());

    // Same org twice = duplicate.
    assert!(matches!(
        runtime.join_org(JoinOrgRequest {
            bundle_uri: bundle("orgmesh-join"),
            display_name: "Alice".into(),
            listen_port: 42311,
            static_peer: None,
        }),
        Err(OrgError::Duplicate(_))
    ));

    runtime.leave_org(ORG_KEY_HEX).expect("leave should work");
    assert!(persistence.get_org_record(ORG_KEY_HEX).unwrap().is_none());
    assert!(matches!(
        runtime.poll(ORG_KEY_HEX),
        Err(OrgError::NotJoined(_))
    ));

    let _ = std::fs::remove_file(&path);
}

#[test]
fn rehydrate_restores_sessions_from_records() {
    let _guard = MOSS_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    drain_received_messages();

    let (persistence, path) = temp_persistence("rehydrate", [43u8; 32]);
    let moss = Arc::new(MossFfiRuntime::load_default().expect("moss should load"));
    {
        let mut runtime = OrgRuntime::from_shared(Arc::clone(&moss), Some(persistence.clone()));
        runtime
            .join_org(JoinOrgRequest {
                bundle_uri: bundle("orgmesh-re"),
                display_name: "Alice".into(),
                listen_port: 42320,
                static_peer: None,
            })
            .expect("join should succeed");
    }

    let mut revived = OrgRuntime::from_shared(moss, Some(persistence));
    revived.rehydrate();
    let listing = revived.list();
    assert_eq!(listing.len(), 1);
    assert_eq!(listing[0].org_pubkey, ORG_KEY_HEX);
    assert_eq!(listing[0].org_name, "acme");

    let _ = std::fs::remove_file(&path);
}

#[test]
fn roster_gossip_verifies_persists_and_tracks_removals() {
    let _guard = MOSS_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    drain_received_messages();

    let seed = [44u8; 32];
    let own_peer = org_signing::peer_id_hex(&SigningKey::from_bytes(&seed));
    let other_peer = hex::encode([0x55u8; 32]);
    let (persistence, path) = temp_persistence("roster", seed);
    let moss = Arc::new(MossFfiRuntime::load_default().expect("moss should load"));
    let mut runtime = OrgRuntime::from_shared(moss, Some(persistence.clone()));
    let org = org_key_hex();
    runtime
        .join_org(JoinOrgRequest {
            bundle_uri: org_bundle("orgmesh-roster"),
            display_name: "Alice".into(),
            listen_port: 42330,
            static_peer: None,
        })
        .unwrap();

    // Verified roster lands: members visible, self recognized, persisted.
    let v2 = signed_roster(
        2,
        &[
            (own_peer.as_str(), "alice", "admin"),
            (other_peer.as_str(), "bob", "member"),
        ],
    );
    runtime.ingest_for_test(&org, &roster_wire(&v2));
    let snap = runtime.poll(&org).unwrap();
    assert!(snap.in_roster);
    assert_eq!(snap.roster_version, Some(2));
    assert_eq!(snap.members.len(), 2);
    assert!(snap.members.iter().any(|m| m.is_self));
    assert_eq!(persistence.get_org_roster(&org).unwrap().unwrap(), v2);

    // Rollback rejected, tamper rejected.
    let v1 = signed_roster(1, &[(own_peer.as_str(), "alice", "admin")]);
    runtime.ingest_for_test(&org, &roster_wire(&v1));
    let mut tampered = signed_roster(3, &[(other_peer.as_str(), "eve", "admin")]);
    let byte = tampered.len() / 2;
    tampered[byte] ^= 0x01;
    runtime.ingest_for_test(&org, &roster_wire(&tampered));
    let snap = runtime.poll(&org).unwrap();
    assert_eq!(snap.roster_version, Some(2));

    // Removal surfaces exactly once via take_pending_removals.
    let v3 = signed_roster(3, &[(own_peer.as_str(), "alice", "admin")]);
    runtime.ingest_for_test(&org, &roster_wire(&v3));
    assert_eq!(
        runtime.take_pending_removals(&org),
        vec![other_peer.clone()]
    );
    assert!(runtime.take_pending_removals(&org).is_empty());
    let snap = runtime.poll(&org).unwrap();
    assert_eq!(snap.members.len(), 1);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn hello_and_stale_roster_trigger_republish() {
    let _guard = MOSS_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    drain_received_messages();

    let seed = [45u8; 32];
    let own_peer = org_signing::peer_id_hex(&SigningKey::from_bytes(&seed));
    let (persistence, path) = temp_persistence("serve", seed);
    let moss = Arc::new(MossFfiRuntime::load_default().expect("moss should load"));
    let mut runtime = OrgRuntime::from_shared(moss, Some(persistence));
    let org = org_key_hex();
    runtime
        .join_org(JoinOrgRequest {
            bundle_uri: org_bundle("orgmesh-serve"),
            display_name: "Alice".into(),
            listen_port: 42340,
            static_peer: None,
        })
        .unwrap();
    let v2 = signed_roster(2, &[(own_peer.as_str(), "alice", "admin")]);
    runtime.ingest_for_test(&org, &roster_wire(&v2));

    // A newcomer's (envelope-valid) hello makes the member serve the roster.
    let newcomer = SigningKey::from_bytes(&[46u8; 32]);
    let hello = OrgMessage::Hello {
        moss_peer_id: org_signing::peer_id_hex(&newcomer),
        display_name: "Bob".into(),
    };
    let mesh = "orgmesh-serve".to_string();
    let ctx = OrgContext {
        org_pubkey: &org,
        mesh_id: &mesh,
        channel_kind: ORG_CHANNEL_KIND,
    };
    let env = org_envelope::sign(&newcomer, &ctx, &serde_json::to_vec(&hello).unwrap());
    let wire = serde_json::to_vec(&OrgWire::Signed {
        payload_b64: encode(&env.payload),
        peer_id: env.peer_id.clone(),
        sig_b64: encode(&env.sig),
    })
    .unwrap();
    runtime.ingest_for_test(&org, &wire);
    assert_eq!(runtime.orgs.get(&org).unwrap().roster_publishes, 1);

    // A hello with a broken signature must NOT be served.
    let mut bad = wire.clone();
    let flip = bad.len() / 2;
    bad[flip] ^= 0x01;
    runtime.ingest_for_test(&org, &bad);
    assert_eq!(runtime.orgs.get(&org).unwrap().roster_publishes, 1);

    // A STALE roster from a lagging peer triggers convergence republish;
    // an equal-version duplicate stays silent.
    let v1 = signed_roster(1, &[(own_peer.as_str(), "alice", "admin")]);
    runtime.ingest_for_test(&org, &roster_wire(&v1));
    assert_eq!(runtime.orgs.get(&org).unwrap().roster_publishes, 2);
    runtime.ingest_for_test(&org, &roster_wire(&v2));
    assert_eq!(runtime.orgs.get(&org).unwrap().roster_publishes, 2);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn dm_offers_are_roster_gated_targeted_and_accept_once() {
    let _guard = MOSS_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    drain_received_messages();

    let seed = [47u8; 32];
    let own_peer = org_signing::peer_id_hex(&SigningKey::from_bytes(&seed));
    let member_key = SigningKey::from_bytes(&[48u8; 32]);
    let member_peer = org_signing::peer_id_hex(&member_key);
    let stranger_key = SigningKey::from_bytes(&[49u8; 32]);
    let (persistence, path) = temp_persistence("dmoffer", seed);
    let moss = Arc::new(MossFfiRuntime::load_default().expect("moss should load"));
    let mut runtime = OrgRuntime::from_shared(moss, Some(persistence.clone()));
    let org = org_key_hex();
    let mesh = "orgmesh-dm";
    runtime
        .join_org(JoinOrgRequest {
            bundle_uri: org_bundle(mesh),
            display_name: "Alice".into(),
            listen_port: 42350,
            static_peer: None,
        })
        .unwrap();
    let roster = signed_roster(
        1,
        &[
            (own_peer.as_str(), "alice", "admin"),
            (member_peer.as_str(), "bob", "member"),
        ],
    );
    runtime.ingest_for_test(&org, &roster_wire(&roster));

    let offer = |id: &str, target: &str| OrgMessage::DmOffer {
        offer_id: id.into(),
        target_peer_id: target.into(),
        from_name: "Bob".into(),
        invite_uri: "mosh://dm?mesh=x&session=y".into(),
    };

    // From a member, to us: surfaces exactly once despite redelivery.
    runtime.ingest_for_test(
        &org,
        &signed_wire(&member_key, mesh, &offer("o1", &own_peer)),
    );
    runtime.ingest_for_test(
        &org,
        &signed_wire(&member_key, mesh, &offer("o1", &own_peer)),
    );
    // From a stranger (envelope valid, not in roster): dropped.
    runtime.ingest_for_test(
        &org,
        &signed_wire(&stranger_key, mesh, &offer("o2", &own_peer)),
    );
    // Aimed at someone else: ignored.
    runtime.ingest_for_test(
        &org,
        &signed_wire(&member_key, mesh, &offer("o3", &member_peer)),
    );

    let snap = runtime.poll(&org).unwrap();
    assert_eq!(snap.dm_offers.len(), 1);
    assert_eq!(snap.dm_offers[0].offer_id, "o1");
    assert_eq!(snap.dm_offers[0].from_peer_id, member_peer);

    // Accept: returns the offer view, records a link, persists it.
    let accepted = runtime.accept_dm_offer(&org, "o1").unwrap();
    assert_eq!(accepted.invite_uri, "mosh://dm?mesh=x&session=y");
    assert_eq!(accepted.from_peer_id, member_peer);
    runtime.link_dm(&org, &member_peer, "session-1").unwrap();
    let snap = runtime.poll(&org).unwrap();
    assert!(snap.dm_offers.is_empty());
    assert_eq!(snap.dm_links.len(), 1);
    assert_eq!(snap.dm_links[0].session_id.as_deref(), Some("session-1"));
    // A replay of the accepted offer does not resurface.
    runtime.ingest_for_test(
        &org,
        &signed_wire(&member_key, mesh, &offer("o1", &own_peer)),
    );
    assert!(runtime.poll(&org).unwrap().dm_offers.is_empty());
    // Link (with its session id) survives a restart via the record.
    let record_bytes = persistence.get_org_record(&org).unwrap().unwrap();
    let record: PersistedOrgRecord = serde_json::from_slice(&record_bytes).unwrap();
    assert_eq!(record.dm_links.len(), 1);
    assert_eq!(record.dm_links[0].session_id.as_deref(), Some("session-1"));

    // Revocation keeps the link (badge data) while future offers drop.
    let v2 = signed_roster(2, &[(own_peer.as_str(), "alice", "admin")]);
    runtime.ingest_for_test(&org, &roster_wire(&v2));
    runtime.ingest_for_test(
        &org,
        &signed_wire(&member_key, mesh, &offer("o4", &own_peer)),
    );
    let snap = runtime.poll(&org).unwrap();
    assert!(snap.dm_offers.is_empty());
    assert_eq!(snap.dm_links.len(), 1);

    let _ = std::fs::remove_file(&path);
}
