//! A family of households: yours (the main file, `household.sqlite`) plus a full household
//! for any child, each in its own SQLite file (`children/<id>.sqlite`) with the same schema.
//! A child's household can be linked to yours: the gifts, 529s, loans and inheritance in the
//! plan you pick then arrive as money in their forecast (`Household::incoming`).

use std::path::{Path, PathBuf};

use engine::model::{Household, HouseholdInfo, Id, IncomingTransfer, Person, Role};
use engine::projection;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use crate::backup::{HouseholdBackup, Link, display_name};
use crate::db::{self, Error};

pub const MAIN_FILE: &str = "household.sqlite";

pub struct Family {
    dir: PathBuf,
    main: Connection,
    /// The child household being viewed, if not the main one.
    active: Option<(i64, Connection)>,
}

/// One household in the switcher.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HouseholdEntry {
    /// `None` = your (main) household.
    pub id: Option<i64>,
    pub name: String,
    pub active: bool,
    /// The child (in your household) this one belongs to, when linked.
    pub linked_person_id: Option<Id>,
    /// Which of your plans feeds it (`None` = base plan).
    pub parent_plan: Option<Id>,
}

/// A child listed in your household.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildRef {
    pub person_id: Id,
    pub name: String,
    /// Their own household, once built.
    pub household_id: Option<i64>,
}

/// Where a one-household backup goes.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum LoadTarget {
    /// Replace every household with the file's.
    Everything,
    /// Replace your own household (child households are kept).
    Main,
    /// This child's household (made if they don't have one yet), linked to them.
    Child { person_id: Id },
    /// A new child household, not linked to anyone.
    NewChild,
}

struct Row {
    id: i64,
    name: String,
    file: String,
    parent_person_id: Option<Id>,
    parent_plan: Option<Id>,
}

/// A link counts only while it points at a child in the main household.
fn linked_child(main: &Household, person_id: Option<Id>) -> Option<&Person> {
    person_id.and_then(|id| main.people.iter().find(|p| p.id == Some(id) && p.role == Role::Child))
}

impl Family {
    pub fn open(dir: &Path) -> db::Result<Family> {
        std::fs::create_dir_all(dir.join("children")).map_err(|e| Error::Invalid(e.to_string()))?;
        let main = db::open(&dir.join(MAIN_FILE))?;
        Ok(Family { dir: dir.to_path_buf(), main, active: None })
    }

    pub fn main_path(&self) -> PathBuf {
        self.dir.join(MAIN_FILE)
    }

    /// The household being viewed (edits go here).
    pub fn conn(&mut self) -> &mut Connection {
        match &mut self.active {
            Some((_, c)) => c,
            None => &mut self.main,
        }
    }

    pub fn conn_ref(&self) -> &Connection {
        self.active.as_ref().map_or(&self.main, |(_, c)| c)
    }

    /// Your own household's file, which also holds app settings and the list of households.
    pub fn main(&self) -> &Connection {
        &self.main
    }

    pub fn active_id(&self) -> Option<i64> {
        self.active.as_ref().map(|(id, _)| *id)
    }

    fn rows(&self) -> db::Result<Vec<Row>> {
        let mut stmt = self
            .main
            .prepare("SELECT id, name, file, parent_person_id, parent_plan FROM family_household ORDER BY id")?;
        let rows = stmt.query_map([], |r| {
            Ok(Row {
                id: r.get(0)?,
                name: r.get(1)?,
                file: r.get(2)?,
                parent_person_id: r.get(3)?,
                parent_plan: r.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    fn row(&self, id: i64) -> db::Result<Row> {
        self.rows()?.into_iter().find(|r| r.id == id).ok_or(Error::NotFound("household"))
    }

    pub fn list(&self) -> db::Result<Vec<HouseholdEntry>> {
        let main = db::load_household(&self.main)?;
        let mut out = vec![HouseholdEntry {
            id: None,
            name: display_name(&main),
            active: self.active.is_none(),
            linked_person_id: None,
            parent_plan: None,
        }];
        for r in self.rows()? {
            let linked = linked_child(&main, r.parent_person_id);
            out.push(HouseholdEntry {
                id: Some(r.id),
                name: linked.map_or(r.name, |p| p.name.clone()),
                active: self.active_id() == Some(r.id),
                linked_person_id: linked.and_then(|p| p.id),
                parent_plan: r.parent_plan.filter(|plan| main.scenario(*plan).is_some()),
            });
        }
        Ok(out)
    }

    /// The children listed in your household, with their household if they have one.
    pub fn children(&self) -> db::Result<Vec<ChildRef>> {
        let main = db::load_household(&self.main)?;
        let rows = self.rows()?;
        Ok(main
            .people
            .iter()
            .filter(|p| p.role == Role::Child)
            .filter_map(|p| {
                let id = p.id?;
                let household_id = rows.iter().find(|r| r.parent_person_id == Some(id)).map(|r| r.id);
                Some(ChildRef { person_id: id, name: p.name.clone(), household_id })
            })
            .collect())
    }

    /// View `id` (`None` = your own household).
    pub fn switch(&mut self, id: Option<i64>) -> db::Result<()> {
        self.active = match id {
            None => None,
            Some(id) => {
                let row = self.row(id)?;
                Some((id, db::open(&self.dir.join(&row.file))?))
            }
        };
        Ok(())
    }

    /// Adds a child household holding `h`.
    pub fn add(&mut self, name: &str, link: Option<Link>, h: &Household) -> db::Result<i64> {
        self.main.execute(
            "INSERT INTO family_household (name, file, parent_person_id, parent_plan) VALUES (?1, '', ?2, ?3)",
            params![name, link.map(|l| l.person_id), link.and_then(|l| l.plan)],
        )?;
        let id = self.main.last_insert_rowid();
        let file = format!("children/{id}.sqlite");
        remove_db_files(&self.dir.join(&file));
        self.main.execute("UPDATE family_household SET file = ?2 WHERE id = ?1", params![id, file])?;
        let mut conn = db::open(&self.dir.join(&file))?;
        db::replace_household(&mut conn, h)?;
        Ok(id)
    }

    /// Starts a household for a child listed in yours, linked to them. Returns its id
    /// (the existing one if they already have a household).
    pub fn build_child(&mut self, person_id: Id) -> db::Result<i64> {
        if self.active.is_some() {
            return Err(Error::Invalid("Switch to your own household to do this.".into()));
        }
        let main = db::load_household(&self.main)?;
        let child = linked_child(&main, Some(person_id))
            .ok_or_else(|| Error::Invalid("That person isn't listed as one of your children.".into()))?
            .clone();
        if let Some(existing) = self.rows()?.into_iter().find(|r| r.parent_person_id == Some(person_id)) {
            return Ok(existing.id);
        }
        let h = Household {
            info: HouseholdInfo {
                name: format!("{}'s household", child.name),
                state: main.info.state.clone(),
                flat_state_rate: main.info.flat_state_rate,
                ..Default::default()
            },
            people: vec![Person {
                id: None,
                name: child.name.clone(),
                birth_year: child.birth_year,
                role: Role::Primary,
                life_expectancy: child.life_expectancy,
                ss_monthly_benefit: None,
                ss_claim_age: 67,
                ss_already_claiming: false,
            }],
            assumptions: main.assumptions,
            ..Default::default()
        };
        self.add(&child.name, Some(Link { person_id, plan: None }), &h)
    }

    /// Deletes a child household and its file.
    pub fn delete(&mut self, id: i64) -> db::Result<()> {
        let row = self.row(id)?;
        if self.active_id() == Some(id) {
            self.active = None;
        }
        self.main.execute("DELETE FROM family_household WHERE id = ?1", [id])?;
        remove_db_files(&self.dir.join(&row.file));
        Ok(())
    }

    /// Which of your plans feeds a linked child household (`None` = base plan).
    pub fn set_parent_plan(&mut self, id: i64, plan: Option<Id>) -> db::Result<()> {
        self.row(id)?;
        self.main.execute("UPDATE family_household SET parent_plan = ?2 WHERE id = ?1", params![id, plan])?;
        Ok(())
    }

    /// A child was removed from your household: their own household stays, unlinked.
    pub fn unlink_person(&self, person_id: Id) -> db::Result<()> {
        self.main
            .execute("UPDATE family_household SET parent_person_id = NULL WHERE parent_person_id = ?1", [person_id])?;
        Ok(())
    }

    fn load_row(&self, row: &Row) -> db::Result<Household> {
        match &self.active {
            Some((id, conn)) if *id == row.id => db::load_household(conn),
            _ => db::load_household(&db::open(&self.dir.join(&row.file))?),
        }
    }

    /// Every household, yours first, for a backup.
    pub fn export_all(&self) -> db::Result<Vec<HouseholdBackup>> {
        let mut out = vec![HouseholdBackup::alone(db::load_household(&self.main)?)];
        for row in self.rows()? {
            let household = self.load_row(&row)?;
            let linked_to = row.parent_person_id.map(|person_id| Link { person_id, plan: row.parent_plan });
            out.push(HouseholdBackup { name: row.name.clone(), linked_to, household });
        }
        Ok(out)
    }

    /// Just the household being viewed (e.g. a child sending theirs), unlinked.
    pub fn export_active(&self) -> db::Result<HouseholdBackup> {
        Ok(HouseholdBackup::alone(db::load_household(self.conn_ref())?))
    }

    /// Replaces every household with `all` (yours first) and views yours.
    pub fn import_all(&mut self, all: &[HouseholdBackup]) -> db::Result<()> {
        let first = all.first().ok_or_else(|| Error::Invalid("That backup has no households in it.".into()))?;
        self.active = None;
        db::replace_household(&mut self.main, &first.household)?;
        for row in self.rows()? {
            self.delete(row.id)?;
        }
        for h in &all[1..] {
            self.add(&h.name, h.linked_to, &h.household)?;
        }
        Ok(())
    }

    /// Loads one household where `target` says. Returns the household to view.
    pub fn import_one(&mut self, h: &HouseholdBackup, target: LoadTarget) -> db::Result<Option<i64>> {
        match target {
            LoadTarget::Everything => {
                self.import_all(std::slice::from_ref(h))?;
                Ok(None)
            }
            LoadTarget::Main => {
                self.active = None;
                db::replace_household(&mut self.main, &h.household)?;
                Ok(None)
            }
            LoadTarget::Child { person_id } => {
                let main = db::load_household(&self.main)?;
                let child = linked_child(&main, Some(person_id))
                    .ok_or_else(|| Error::Invalid("That person isn't listed as one of your children.".into()))?
                    .name
                    .clone();
                match self.rows()?.into_iter().find(|r| r.parent_person_id == Some(person_id)) {
                    Some(row) => {
                        self.active = None;
                        db::replace_household(&mut db::open(&self.dir.join(&row.file))?, &h.household)?;
                        Ok(Some(row.id))
                    }
                    None => self.add(&child, Some(Link { person_id, plan: None }), &h.household).map(Some),
                }
            }
            LoadTarget::NewChild => self.add(&h.name, None, &h.household).map(Some),
        }
    }

    /// Erases the household being viewed. Erasing your own also removes every child household.
    pub fn clear(&mut self) -> db::Result<()> {
        if self.active.is_none() {
            for row in self.rows()? {
                self.delete(row.id)?;
            }
        }
        db::clear_household(self.conn())
    }

    /// The active household's link, if it's a child household linked to a child in yours.
    fn active_link(&self) -> db::Result<Option<(Household, Id, Option<Id>)>> {
        let Some(id) = self.active_id() else { return Ok(None) };
        let row = self.row(id)?;
        let main = db::load_household(&self.main)?;
        let Some(person_id) = linked_child(&main, row.parent_person_id).and_then(|p| p.id) else { return Ok(None) };
        let plan = row.parent_plan.filter(|p| main.scenario(*p).is_some());
        Ok(Some((main, person_id, plan)))
    }

    /// The active household as the engine needs it: with money arriving from your plan when linked.
    pub fn household_for_engine(&self, start_year: i32) -> db::Result<Household> {
        let mut h = db::load_household(self.conn_ref())?;
        if let Some((main, person_id, plan)) = self.active_link()?
            && let Ok((incoming, _)) = incoming_for(&main, person_id, plan, start_year)
        {
            h.incoming = incoming;
        }
        Ok(h)
    }

    /// What arrives from your plan, for the linked child household being viewed.
    pub fn incoming_summary(&self, start_year: i32) -> db::Result<Option<IncomingSummary>> {
        let Some((main, person_id, plan)) = self.active_link()? else { return Ok(None) };
        Ok(Some(match incoming_for(&main, person_id, plan, start_year) {
            Ok((_, summary)) => summary,
            Err(problem) => IncomingSummary { problem: Some(problem), ..summary_base(&main, person_id, plan) },
        }))
    }
}

fn remove_db_files(path: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let mut p = path.as_os_str().to_owned();
        p.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(p));
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanChoice {
    pub id: Option<Id>,
    pub name: String,
}

/// What a linked child household receives from the parent's plan (for the forecast card).
/// `*_real` totals are in today's dollars.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingSummary {
    pub parent_name: String,
    pub child_name: String,
    pub plan: Option<Id>,
    pub plan_name: String,
    pub plans: Vec<PlanChoice>,
    /// By year, in that year's dollars.
    pub years: Vec<IncomingTransfer>,
    pub gifts_real: f64,
    pub education_real: f64,
    pub paid_for_you_real: f64,
    pub loans_in_real: f64,
    pub loan_payments_real: f64,
    pub inheritance_real: f64,
    pub inheritance_year: Option<i32>,
    pub parent_estate_age: u32,
    /// Set when the parent's plan can't be run (e.g. no main person yet).
    pub problem: Option<String>,
}

fn summary_base(parent: &Household, child: Id, plan: Option<Id>) -> IncomingSummary {
    let plan_name = |id: Option<Id>| match id {
        None => "Base plan".to_string(),
        Some(id) => parent.scenario(id).map_or_else(|| "Base plan".into(), |s| s.name.clone()),
    };
    IncomingSummary {
        parent_name: display_name(parent),
        child_name: parent.people.iter().find(|p| p.id == Some(child)).map(|p| p.name.clone()).unwrap_or_default(),
        plan,
        plan_name: plan_name(plan),
        plans: std::iter::once(None)
            .chain(parent.scenarios.iter().map(|s| s.id))
            .map(|id| PlanChoice { id, name: plan_name(id) })
            .collect(),
        ..Default::default()
    }
}

/// Runs the parent's plan (steady path) and collects what reaches `child` each year,
/// plus their share of the inheritance the year after the parent's estate age.
pub fn incoming_for(
    parent: &Household,
    child: Id,
    plan: Option<Id>,
    start_year: i32,
) -> Result<(Vec<IncomingTransfer>, IncomingSummary), String> {
    let proj = projection::project(parent, plan, start_year).map_err(|e| e.to_string())?;
    let mut s = summary_base(parent, child, plan);
    let mut years: Vec<IncomingTransfer> = Vec::new();
    for (i, y) in proj.years.iter().enumerate() {
        let Some(t) = y.transfers_by_child.iter().find(|t| t.child_id == child) else { continue };
        let level = if i == 0 { 1.0 } else { proj.years[i - 1].price_level };
        s.gifts_real += (t.cash + t.assets) / level;
        s.education_real += t.education / level;
        s.paid_for_you_real += t.paid_for_you / level;
        s.loans_in_real += t.loan_in / level;
        s.loan_payments_real += t.loan_payment / level;
        years.push(IncomingTransfer {
            year: y.year,
            cash: t.cash,
            assets: t.assets,
            assets_basis: t.assets_basis,
            education: t.education,
            paid_for_you: t.paid_for_you,
            loan_in: t.loan_in,
            loan_payment: t.loan_payment,
            inheritance: 0.0,
        });
    }
    let estate = &proj.summary.estate;
    s.parent_estate_age = estate.age;
    if let Some(share) = estate.children.iter().find(|c| c.child_id == Some(child)).map(|c| c.inheritance_real)
        && share > 0.0
    {
        let level = proj.years.iter().find(|y| y.year == estate.year).map_or(1.0, |y| y.price_level);
        let year = estate.year + 1;
        s.inheritance_real = share;
        s.inheritance_year = Some(year);
        years.push(IncomingTransfer { year, inheritance: share * level, ..Default::default() });
    }
    s.years = years.clone();
    Ok((years, s))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::demo::{Demo, family};

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fsim-family-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn demo_family(name: &str) -> (Family, PathBuf) {
        let dir = temp_dir(name);
        let mut f = Family::open(&dir).unwrap();
        f.import_all(&family(Demo::Retiree)).unwrap();
        (f, dir)
    }

    #[test]
    fn households_are_separate_and_switchable() {
        let (mut f, dir) = demo_family("switch");
        let list = f.list().unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "Pat");
        assert!(list[0].active);
        assert_eq!(list[1].name, "Sam");
        assert_eq!(list[1].linked_person_id, Some(2));
        let pat_accounts = db::load_household(f.conn()).unwrap().accounts.len();
        f.switch(list[1].id).unwrap();
        let sam = db::load_household(f.conn()).unwrap();
        assert_eq!(sam.people[0].name, "Sam");
        assert_ne!(sam.accounts.len(), pat_accounts);
        // Edits go to the household being viewed only.
        db::clear_household(f.conn()).unwrap();
        f.switch(None).unwrap();
        assert_eq!(db::load_household(f.conn()).unwrap().accounts.len(), pat_accounts);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn building_a_childs_household_links_it_once() {
        let (mut f, dir) = demo_family("build");
        let jordan = f.build_child(3).unwrap();
        assert_eq!(f.build_child(3).unwrap(), jordan, "building again opens the same one");
        f.switch(Some(jordan)).unwrap();
        let h = db::load_household(f.conn()).unwrap();
        assert_eq!(h.people.len(), 1);
        assert_eq!((h.people[0].name.as_str(), h.people[0].role), ("Jordan", Role::Primary));
        assert!(f.build_child(2).is_err(), "only from your own household");
        f.switch(None).unwrap();
        assert!(f.build_child(1).is_err(), "Pat isn't a child");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_linked_child_receives_money_from_the_chosen_plan() {
        let (mut f, dir) = demo_family("incoming");
        let sam = f.list().unwrap()[1].id;
        f.switch(sam).unwrap();
        // Base plan: no gifts, but an inheritance after Pat's estate age.
        let base = f.incoming_summary(2026).unwrap().unwrap();
        assert_eq!(base.gifts_real, 0.0);
        assert!(base.inheritance_real > 1_000_000.0);
        assert_eq!(base.inheritance_year, Some(1968 + 100 + 1));
        // Plan 1 helps Sam with a down payment.
        f.set_parent_plan(sam.unwrap(), Some(1)).unwrap();
        let helped = f.incoming_summary(2026).unwrap().unwrap();
        assert_eq!(helped.plan_name, "Help Sam with a down payment");
        assert!(helped.gifts_real > 140_000.0);
        let h = f.household_for_engine(2026).unwrap();
        assert!(h.incoming.iter().any(|t| t.cash > 140_000.0));
        let proj = projection::project(&h, None, 2026).unwrap();
        assert!(proj.years.iter().any(|y| y.received_from_parent > 140_000.0));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn removing_the_child_unlinks_but_keeps_their_household() {
        let (mut f, dir) = demo_family("unlink");
        f.unlink_person(2).unwrap();
        let list = f.list().unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[1].linked_person_id, None);
        f.switch(list[1].id).unwrap();
        assert!(f.incoming_summary(2026).unwrap().is_none());
        assert!(f.household_for_engine(2026).unwrap().incoming.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn export_import_round_trip_and_load_as_a_child() {
        let (mut f, dir) = demo_family("export");
        let all = f.export_all().unwrap();
        assert_eq!(
            all,
            family(Demo::Retiree)
                .into_iter()
                .map(|mut h| {
                    // Ids are assigned by the database; the demo fixtures already use them.
                    h.household.incoming.clear();
                    h
                })
                .collect::<Vec<_>>()
        );
        // Load Sam's household from a file as Jordan's.
        let target = f.import_one(&all[1], LoadTarget::Child { person_id: 3 }).unwrap();
        let list = f.list().unwrap();
        assert_eq!(list.len(), 3);
        assert_eq!(list[2].linked_person_id, Some(3));
        assert_eq!(target, list[2].id);
        // Loading as Sam again replaces his household rather than adding one.
        f.import_one(&all[1], LoadTarget::Child { person_id: 2 }).unwrap();
        assert_eq!(f.list().unwrap().len(), 3);
        // Clearing your own household also removes the children's.
        f.clear().unwrap();
        assert_eq!(f.list().unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }
}
