//! The adapter layer lives in the Tauri-free `mosh-core` crate so a headless
//! CLI can link it on platforms without webkit2gtk/gtk. This shim keeps the
//! historic `crate::adapters::…` paths working inside the desktop shell.
pub use mosh_core::*;
