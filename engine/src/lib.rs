//! Finance Simulator engine: projections, federal tax, Monte Carlo, estate.
//!
//! This crate is deliberately free of Tauri/DB dependencies so it can be
//! unit-tested and benchmarked on its own.

pub mod model;
pub mod project;

pub use project::{Allocation, FixedReturns, YearRow, project_fixed};

/// Engine version, surfaced in the app's About/Settings screen.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
