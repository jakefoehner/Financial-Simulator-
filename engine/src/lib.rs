//! Finance Simulator engine: projections, federal tax, Monte Carlo, estate.
//!
//! This crate is deliberately free of Tauri/DB dependencies so it can be
//! unit-tested and benchmarked on its own.

pub mod history;
pub mod model;
pub mod montecarlo;
pub mod projection;
pub mod social_security;
pub mod tax;
pub mod tax_tables;

/// Engine version, surfaced in the app's About/Settings screen.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
