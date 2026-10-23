//! Recurring schedules are append-only rule versions plus explicit occurrence exceptions.
//! Review facts live on occurrence rows and are never rewritten by schedule edits.
use super::*;

pub(super) const MIGRATION: &str = r#"
    CREATE TABLE recurring_rule_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recurring_item_id TEXT NOT NULL REFERENCES recurring_items(id) ON DELETE CASCADE,
        effective_from TEXT NOT NULL,
        min_date TEXT NOT NULL,
        suppress_date TEXT,
        rule_json TEXT NOT NULL
    );
    CREATE INDEX idx_recurring_versions_item ON recurring_rule_versions(recurring_item_id, id);
    CREATE TABLE recurring_status_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recurring_item_id TEXT NOT NULL REFERENCES recurring_items(id) ON DELETE CASCADE,
        effective_from TEXT NOT NULL,
        status TEXT NOT NULL
    );
    -- Remove the old item/date uniqueness: a moved exception may share a date with
    -- another occurrence. IDs and all existing review facts are copied verbatim.
    CREATE TABLE recurring_occurrences_versioned (
        id TEXT PRIMARY KEY,
        recurring_item_id TEXT NOT NULL REFERENCES recurring_items(id) ON DELETE CASCADE,
        occurrence_date TEXT NOT NULL,
        outcome TEXT CHECK(outcome IN ('completed','partial','not_completed')),
        review_notes TEXT, reviewed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        original_date TEXT NOT NULL,
        rule_version_id INTEGER REFERENCES recurring_rule_versions(id),
        is_exception INTEGER NOT NULL DEFAULT 0,
        snapshot_title TEXT NOT NULL, snapshot_notes TEXT,
        snapshot_time TEXT, snapshot_duration INTEGER, snapshot_tags TEXT NOT NULL,
        UNIQUE(recurring_item_id, rule_version_id, original_date)
    );
    INSERT INTO recurring_occurrences_versioned
        (id,recurring_item_id,occurrence_date,outcome,review_notes,reviewed_at,created_at,updated_at,
         original_date,snapshot_title,snapshot_notes,snapshot_time,snapshot_duration,snapshot_tags)
    SELECT o.id,o.recurring_item_id,o.occurrence_date,o.outcome,o.review_notes,o.reviewed_at,o.created_at,o.updated_at,
           o.occurrence_date,i.title,i.notes,i.display_time,i.display_duration_minutes,i.tags_json
    FROM recurring_occurrences o JOIN recurring_items i ON i.id=o.recurring_item_id;
    DROP TABLE recurring_occurrences;
    ALTER TABLE recurring_occurrences_versioned RENAME TO recurring_occurrences;
    CREATE INDEX idx_recurring_occurrences_date ON recurring_occurrences(occurrence_date, recurring_item_id);
"#;

#[derive(Clone)]
struct Version {
    id: i64,
    effective: NaiveDate,
    min_date: NaiveDate,
    suppress: Option<NaiveDate>,
    rule: RecurringItemDto,
}

fn versions(connection: &Connection, item_id: &str) -> AppResult<Vec<Version>> {
    let mut stmt = connection.prepare("SELECT id,effective_from,min_date,suppress_date,rule_json FROM recurring_rule_versions WHERE recurring_item_id=?1 ORDER BY id")?;
    let rows = stmt.query_map([item_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, String>(4)?)))?.collect::<Result<Vec<_>, _>>()?;
    rows.into_iter().map(|(id, effective, min, suppress, json)| Ok(Version {
        id, effective: parse_plan_date(&effective)?, min_date: parse_plan_date(&min)?,
        suppress: suppress.as_deref().map(parse_plan_date).transpose()?, rule: serde_json::from_str(&json)?,
    })).collect()
}

fn version_on(versions: &[Version], date: NaiveDate) -> Option<&Version> {
    versions.iter().rev().find(|v| v.effective <= date)
}

pub(super) fn insert_initial_version(tx: &Transaction<'_>, item: &RecurringItemDto) -> AppResult<()> {
    tx.execute("INSERT INTO recurring_rule_versions(recurring_item_id,effective_from,min_date,rule_json) VALUES(?1,?2,?2,?3)",
        params![item.id, item.starts_on, serde_json::to_string(item)?])?;
    Ok(())
}

pub(super) fn backfill(tx: &Transaction<'_>) -> AppResult<()> {
    let ids = {
        let mut stmt = tx.prepare("SELECT id FROM recurring_items")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        rows
    };
    for id in ids {
        let item = load_recurring_item_in_transaction(tx, &id)?;
        insert_initial_version(tx, &item)?;
        let version = tx.last_insert_rowid();
        tx.execute("UPDATE recurring_occurrences SET rule_version_id=?2, is_exception=CASE WHEN occurrence_date<?3 OR outcome IS NOT NULL THEN 1 ELSE 0 END WHERE recurring_item_id=?1", params![id, version, shanghai_today()])?;
        if item.status != "active" { record_status(tx, &id, &item.status)?; }
    }
    Ok(())
}

pub(super) fn record_status(tx: &Transaction<'_>, item_id: &str, status: &str) -> AppResult<()> {
    // Like the existing lifecycle, today's schedule remains available for review.
    // Unlike the old lifecycle, unvisited history also remains reconstructible.
    let tomorrow = parse_plan_date(&shanghai_today())?.succ_opt().ok_or_else(|| AppError::Schema("日期超出范围".into()))?;
    tx.execute("INSERT INTO recurring_status_versions(recurring_item_id,effective_from,status) VALUES(?1,?2,?3)",
        params![item_id, tomorrow.to_string(), status])?;
    Ok(())
}

fn active_on(connection: &Connection, item_id: &str, date: &str) -> AppResult<bool> {
    let status: Option<String> = connection.query_row("SELECT status FROM recurring_status_versions WHERE recurring_item_id=?1 AND effective_from<=?2 ORDER BY id DESC LIMIT 1", params![item_id, date], |r| r.get(0)).optional()?;
    Ok(status.as_deref().unwrap_or("active") == "active")
}

pub(super) fn load_snapshot(connection: &Connection, id: &str) -> AppResult<RecurringOccurrenceDto> {
    connection.query_row("SELECT o.id,o.recurring_item_id,o.snapshot_title,o.snapshot_notes,o.occurrence_date,o.snapshot_time,o.snapshot_duration,o.snapshot_tags,o.outcome,o.review_notes,o.reviewed_at,o.created_at,o.updated_at,v.rule_json FROM recurring_occurrences o LEFT JOIN recurring_rule_versions v ON v.id=o.rule_version_id WHERE o.id=?1", [id], |row| {
        let mut occurrence = recurring_occurrence_dto_from_row(row)?;
        let rule_json: Option<String> = row.get(13)?;
        occurrence.schedule_rule = rule_json.map(|json| -> rusqlite::Result<RecurringItemInput> {
            let rule: RecurringItemDto = serde_json::from_str(&json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(13, rusqlite::types::Type::Text, Box::new(error))
            })?;
            Ok(RecurringItemInput {
                title: rule.title, notes: rule.notes, frequency: rule.frequency,
                interval_value: rule.interval_value, weekdays: rule.weekdays, month_day: rule.month_day,
                starts_on: rule.starts_on, ends_on: rule.ends_on, display_time: rule.display_time,
                display_duration_minutes: rule.display_duration_minutes, tags: rule.tags,
            })
        }).transpose()?;
        Ok(occurrence)
    }).optional()?.ok_or_else(|| AppError::NotFound(format!("重复事项发生记录 {id}")))
}

fn exception_rows(connection: &Connection, item_id: &str) -> AppResult<Vec<(String, String, String)>> {
    let mut stmt = connection.prepare("SELECT id,original_date,occurrence_date FROM recurring_occurrences WHERE recurring_item_id=?1 AND is_exception=1 ORDER BY occurrence_date,snapshot_time,id")?;
    let rows = stmt.query_map([item_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn materialize(tx: &Transaction<'_>, version: &Version, date: NaiveDate) -> AppResult<String> {
    let date = date.to_string();
    let existing: Option<String> = tx.query_row("SELECT id FROM recurring_occurrences WHERE recurring_item_id=?1 AND rule_version_id=?2 AND original_date=?3 AND is_exception=0", params![version.rule.id, version.id, date], |r| r.get(0)).optional()?;
    if let Some(id) = existing { return Ok(id); }
    let id = Uuid::new_v4().to_string();
    let rule = &version.rule;
    tx.execute("INSERT INTO recurring_occurrences(id,recurring_item_id,occurrence_date,original_date,rule_version_id,snapshot_title,snapshot_notes,snapshot_time,snapshot_duration,snapshot_tags,created_at,updated_at) VALUES(?1,?2,?3,?3,?4,?5,?6,?7,?8,?9,?10,?10)",
        params![id, rule.id, date, version.id, rule.title, rule.notes, rule.display_time, rule.display_duration_minutes, serde_json::to_string(&rule.tags)?, now()])?;
    Ok(id)
}

fn base_occurs(version: &Version, date: NaiveDate, exceptions: &[(String, String, String)]) -> AppResult<bool> {
    Ok(date >= version.min_date && version.suppress != Some(date)
        && !exceptions.iter().any(|(_, origin, _)| origin == &date.to_string())
        && recurring_item_occurs_on(&version.rule, date)?)
}

impl Database {
    pub fn list_recurring_occurrences_range(&mut self, from_date: &str, to_date: &str) -> AppResult<Vec<RecurringOccurrenceDto>> {
        let from = parse_plan_date(from_date)?;
        let to = parse_plan_date(to_date)?;
        if to < from || (to - from).num_days() >= 62 {
            return Err(AppError::Schema("重复事项日历范围必须为 1 至 62 天".into()));
        }
        let tx = self.connection.transaction()?;
        let ids = {
            let mut stmt = tx.prepare("SELECT id FROM recurring_items ORDER BY id")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
            rows
        };
        let mut result = Vec::new();
        for id in ids {
            let rules = versions(&tx, &id)?;
            let exceptions = exception_rows(&tx, &id)?;
            for offset in 0..=(to - from).num_days() {
                let date = from + Duration::days(offset);
                let text = date.to_string();
                if !active_on(&tx, &id, &text)? { continue; }
                for (exception_id, _, moved) in &exceptions {
                    if moved == &text { result.push(load_snapshot(&tx, exception_id)?); }
                }
                if let Some(version) = version_on(&rules, date) {
                    if base_occurs(version, date, &exceptions)? {
                        let occurrence_id = materialize(&tx, version, date)?;
                        result.push(load_snapshot(&tx, &occurrence_id)?);
                    }
                }
            }
        }
        result.sort_by(|a,b| (&a.occurrence_date, &a.display_time, &a.title, &a.id).cmp(&(&b.occurrence_date, &b.display_time, &b.title, &b.id)));
        tx.commit()?;
        Ok(result)
    }

    pub(super) fn update_recurring_item_versioned(&mut self, item_id: &str, input: RecurringItemInput) -> AppResult<RecurringItemDto> {
        let tx = self.connection.transaction()?;
        let target = Self::resolve_recurring_target_in_transaction(&tx, item_id)?
            .ok_or_else(|| AppError::Domain("重复事项没有可修改的今日或未来发生记录".into()))?;
        let item = Self::update_recurring_occurrence_in_transaction(&tx, &target.id, input, &target.occurrence_date, "future")?;
        tx.commit()?;
        Ok(item)
    }

    pub fn resolve_recurring_edit_target(&mut self, item_id: &str) -> AppResult<Option<RecurringOccurrenceDto>> {
        let tx = self.connection.transaction()?;
        let result = Self::resolve_recurring_target_in_transaction(&tx, item_id)?;
        tx.commit()?;
        Ok(result)
    }

    fn resolve_recurring_target_in_transaction(tx: &Transaction<'_>, item_id: &str) -> AppResult<Option<RecurringOccurrenceDto>> {
        let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM recurring_items WHERE id=?1)", [item_id], |r| r.get(0))?;
        if !exists { return Ok(None); }
        let item = load_recurring_item_in_transaction(&tx, item_id)?;
        if item.deleted_at.is_some() || item.status == "ended" { return Ok(None); }
        let today = parse_plan_date(&shanghai_today())?;
        let first_editable = if active_on(tx, item_id, &today.to_string())? { today } else {
            today.succ_opt().ok_or_else(|| AppError::Schema("日期超出范围".into()))?
        };
        let rules = versions(&tx, item_id)?;
        let exceptions = exception_rows(&tx, item_id)?;
        let mut best: Option<(NaiveDate, String)> = None;
        // Paused items can be edited without reactivating their schedules.
        for (id, _, moved) in &exceptions {
            let date = parse_plan_date(moved)?;
            if date >= first_editable && best.as_ref().is_none_or(|b| date < b.0) {
                best = Some((date, id.clone()));
            }
        }
        let mut cuts = vec![first_editable];
        cuts.extend(rules.iter().filter(|v| v.effective > first_editable).map(|v| v.effective));
        cuts.sort_unstable(); cuts.dedup();
        for (index, start) in cuts.iter().enumerate() {
            if best.as_ref().is_some_and(|b| b.0 < *start) { break; }
            let Some(version) = version_on(&rules, *start) else { continue; };
            let upper = cuts.get(index + 1).copied();
            let mut cursor = (*start).max(version.min_date);
            while let Some(candidate) = next_rule_date(&version.rule, cursor)? {
                if upper.is_some_and(|end| candidate >= end) || best.as_ref().is_some_and(|b| candidate > b.0) { break; }
                if base_occurs(version, candidate, &exceptions)? {
                    let id = materialize(&tx, version, candidate)?;
                    if best.as_ref().is_none_or(|b| candidate < b.0) { best = Some((candidate, id)); }
                    break;
                }
                let Some(next) = candidate.succ_opt() else { break; };
                cursor = next;
            }
        }
        let result = best.map(|(_, id)| load_snapshot(&tx, &id)).transpose()?;
        Ok(result)
    }

    pub fn update_recurring_occurrence(&mut self, occurrence_id: &str, input: RecurringItemInput, target_date: &str, scope: &str) -> AppResult<RecurringItemDto> {
        let tx = self.connection.transaction()?;
        let item = Self::update_recurring_occurrence_in_transaction(&tx, occurrence_id, input, target_date, scope)?;
        tx.commit()?;
        Ok(item)
    }

    fn update_recurring_occurrence_in_transaction(tx: &Transaction<'_>, occurrence_id: &str, input: RecurringItemInput, target_date: &str, scope: &str) -> AppResult<RecurringItemDto> {
        if !matches!(scope, "this" | "future") { return Err(AppError::Schema("修改范围必须为 this 或 future".into())); }
        let target = parse_plan_date(target_date)?;
        let target_date = target.to_string();
        let today = parse_plan_date(&shanghai_today())?;
        let mut input = normalize_recurring_item_input(input)?;
        if target < today { return Err(AppError::Domain("不能将重复事项移动到过去".into())); }
        let selected = load_snapshot(&tx, occurrence_id)?;
        let current = load_recurring_item_in_transaction(&tx, &selected.recurring_item_id)?;
        if current.deleted_at.is_some() || current.status == "ended" { return Err(AppError::Domain("已结束或已删除的重复事项不能修改".into())); }
        let (origin, version_id, is_exception): (String, i64, bool) = tx.query_row("SELECT original_date,rule_version_id,is_exception FROM recurring_occurrences WHERE id=?1", [occurrence_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
        let origin_date = parse_plan_date(&origin)?;
        let selected_date = parse_plan_date(&selected.occurrence_date)?;
        if selected_date < today { return Err(AppError::Domain("过去的重复事项日程不可修改".into())); }
        let rules = versions(&tx, &current.id)?;
        let exceptions = exception_rows(&tx, &current.id)?;
        let original_version = rules.iter().find(|v| v.id == version_id).ok_or_else(|| AppError::Domain("重复事项规则已失效".into()))?;
        if !is_exception && (version_on(&rules, origin_date).map(|v| v.id) != Some(version_id) || !base_occurs(original_version, origin_date, &exceptions)?) {
            return Err(AppError::Domain("该发生记录已被后续规则替代，请刷新后重试".into()));
        }
        database_tags::validate_selection(&input.tags, &selected.tags)?;
        database_tags::register_tags(&tx, &input.tags)?;
        let mut new_version_id = version_id;
        if scope == "future" {
            // Anchor version effectiveness at the source occurrence. An explicit
            // validity start is independent of that boundary and must survive.
            let old = &original_version.rule;
            let same_pattern = input.frequency == old.frequency && input.interval_value == old.interval_value
                && input.weekdays == old.weekdays && input.month_day == old.month_day;
            let delta = (target - selected_date).num_days();
            let unchanged_start = input.starts_on == old.starts_on;
            if same_pattern && unchanged_start {
                input.starts_on = parse_plan_date(&old.starts_on)?.checked_add_signed(Duration::days(delta))
                    .ok_or_else(|| AppError::Schema("移动后的规则日期超出范围".into()))?.to_string();
                if delta != 0 && input.frequency == "weekly" {
                    input.weekdays = old.weekdays.iter().map(|d| ((*d as i64 - 1 + delta).rem_euclid(7) + 1) as u32).collect();
                    input.weekdays.sort_unstable();
                }
                if delta != 0 && input.frequency == "monthly" { input.month_day = Some(target.day()); }
            } else if !same_pattern && unchanged_start {
                input.starts_on = target.to_string();
            }
            input = normalize_recurring_item_input(input)?;
            // Keep every old rule and every other explicit exception. Later
            // versions supersede earlier versions only from this boundary on.
            let boundary = selected_date;
            let mut rule = current.clone();
            apply_input(&mut rule, &input);
            tx.execute("INSERT INTO recurring_rule_versions(recurring_item_id,effective_from,min_date,suppress_date,rule_json) VALUES(?1,?2,?3,?4,?5)",
                params![current.id, boundary.to_string(), boundary.max(target).to_string(), target_date, serde_json::to_string(&rule)?])?;
            new_version_id = tx.last_insert_rowid();
            tx.execute("UPDATE recurring_items SET title=?2,notes=?3,frequency=?4,interval_value=?5,weekdays_json=?6,month_day=?7,starts_on=?8,ends_on=?9,display_time=?10,display_duration_minutes=?11,tags_json=?12,updated_at=?13 WHERE id=?1",
                params![current.id,input.title,input.notes,input.frequency,input.interval_value,serde_json::to_string(&input.weekdays)?,input.month_day,input.starts_on,input.ends_on,input.display_time,input.display_duration_minutes,serde_json::to_string(&input.tags)?,now()])?;
        }
        // Do not touch outcome, review_notes, reviewed_at, or review drafts.
        tx.execute("UPDATE recurring_occurrences SET occurrence_date=?2,is_exception=1,rule_version_id=?3,snapshot_title=?4,snapshot_notes=?5,snapshot_time=?6,snapshot_duration=?7,snapshot_tags=?8,updated_at=?9 WHERE id=?1",
            params![occurrence_id,target_date,new_version_id,input.title,input.notes,input.display_time,input.display_duration_minutes,serde_json::to_string(&input.tags)?,now()])?;
        let item = load_recurring_item_in_transaction(&tx, &current.id)?;
        Ok(item)
    }
}

fn apply_input(item: &mut RecurringItemDto, input: &RecurringItemInput) {
    item.title = input.title.clone(); item.notes = input.notes.clone();
    item.frequency = input.frequency.clone(); item.interval_value = input.interval_value;
    item.weekdays = input.weekdays.clone(); item.month_day = input.month_day;
    item.starts_on = input.starts_on.clone(); item.ends_on = input.ends_on.clone();
    item.display_time = input.display_time.clone(); item.display_duration_minutes = input.display_duration_minutes;
    item.tags = input.tags.clone(); item.updated_at = now();
}

// Find the next candidate without scanning infinite history or imposing an
// arbitrary look-ahead limit (monthly interval=365 may skip decades).
fn next_rule_date(rule: &RecurringItemDto, from: NaiveDate) -> AppResult<Option<NaiveDate>> {
    let anchor = parse_plan_date(&rule.starts_on)?;
    let from = from.max(anchor);
    let end = rule.ends_on.as_deref().map(parse_plan_date).transpose()?.unwrap_or(NaiveDate::MAX);
    if from > end { return Ok(None); }
    let interval = rule.interval_value;
    let candidate = match rule.frequency.as_str() {
        "daily" => {
            let days = (from-anchor).num_days();
            anchor.checked_add_signed(Duration::days(((days+interval-1)/interval)*interval))
        }
        "weekly" => {
            let period = interval * 7;
            rule.weekdays.iter().filter_map(|day| {
                let offset = (*day as i64 - anchor.weekday().number_from_monday() as i64).rem_euclid(7);
                let base = anchor.checked_add_signed(Duration::days(offset))?;
                let days = (from-base).num_days().max(0);
                base.checked_add_signed(Duration::days(((days+period-1)/period)*period))
            }).min()
        }
        "monthly" => {
            let anchor_month = anchor.year() as i64*12 + anchor.month0() as i64;
            let from_month = from.year() as i64*12 + from.month0() as i64;
            let mut month = anchor_month + ((from_month-anchor_month)/interval)*interval;
            let mut found = None;
            // Gregorian month/day validity repeats every 4,800 months.
            // One full cycle also proves that rules like annual February 31
            // have no next occurrence, without scanning to the date type limit.
            for _ in 0..=4800 {
                let year = month.div_euclid(12);
                if year > end.year() as i64 || year > NaiveDate::MAX.year() as i64 { break; }
                if let Some(date) = NaiveDate::from_ymd_opt(year as i32, month.rem_euclid(12) as u32+1, rule.month_day.unwrap_or(1)) {
                    if date >= from { found = Some(date); break; }
                }
                month += interval;
            }
            found
        }
        "weekdays" => {
            let calendar = official_workday_calendar();
            let mut cursor = from;
            let mut found = None;
            while cursor <= end.min(calendar.to) {
                if recurring_item_occurs_on(rule, cursor)? { found = Some(cursor); break; }
                let Some(next) = cursor.succ_opt() else { break; }; cursor = next;
            }
            found
        }
        _ => None,
    };
    Ok(candidate.filter(|date| *date <= end))
}
